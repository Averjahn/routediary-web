import { DB } from '../db.js';
import { AppState } from '../state.js';
import { uuid } from '../format.js';
import { t, plural } from '../i18n.js';
import { applyI18nTree, openModal, closeModal, toast, escapeHtml } from '../ui.js';
import {
  applyMeasurement, predict, programAt, estimateCycle, PROGRAMS,
} from '../signalTiming.js';
import { loadedAround, ensureAround, isEnabled as roadEnabled } from '../roadData.js';
import { distanceMeters } from '../roadRules.js';
import { fetchEstimates } from '../signalPoolClient.js';

/**
 * Замер фаз светофоров вручную.
 *
 * Готовых данных о фазах не существует, но измерить светофор можно самому:
 * стоя на перекрёстке, отмечать нажатием момент переключения. Тогда число
 * на экране не выдумано, а измерено — и приложение обязано показывать,
 * насколько ему можно верить.
 *
 * Экран устроен под реальную обстановку: человек стоит в машине и смотрит
 * на светофор, а не на телефон. Поэтому кнопок ровно две, они во весь экран,
 * и промахнуться мимо них нельзя.
 */

const PROGRAM_KEY = {
  night: 'signal.program_night',
  morning: 'signal.program_morning',
  day: 'signal.program_day',
  evening: 'signal.program_evening',
  late: 'signal.program_late',
};

export async function openSignals() {
  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="signal.title"></h2><button class="modal-close">✕</button></div>
    <div class="muted" style="font-size:13px;" data-i18n="signal.intro"></div>
    <div id="signal-list" style="margin-top:14px;"></div>
    <button class="btn primary block" id="signal-add" style="margin-top:14px;" data-i18n="signal.add"></button>
    <div class="muted guide-disclaimer" data-i18n="signal.note"></div>
  `, {
    onMount: (root) => {
      root.querySelector('.modal-close').addEventListener('click', closeModal);
      root.querySelector('#signal-add').addEventListener('click', () => addHere(root));
      renderList(root);
    },
  });
  applyI18nTree(overlay);
  return overlay;
}

async function renderList(root) {
  const list = root.querySelector('#signal-list');
  const signals = await DB.getAll('signals');

  // Общие оценки подтягиваются только для светофоров, у которых есть номер
  // узла на карте: без него сопоставить наблюдения не с чем.
  const osmIds = signals.map(s => s.osmId).filter(Boolean);
  const shared = new Map();
  for (const estimate of await fetchEstimates(osmIds).catch(() => [])) {
    shared.set(`${estimate.signalKey}|${estimate.program}`, estimate);
  }

  if (signals.length === 0) {
    list.innerHTML = `<div class="muted">${t('signal.empty')}</div>`;
    return;
  }

  const now = Date.now();
  list.innerHTML = signals.map(signal => {
    const measured = Object.entries(signal.programs || {}).filter(([, p]) => p.ok);
    const state = predict(signal, now);
    const pooled = signal.osmId ? shared.get(`${signal.osmId}|${programAt(now)}`) : null;
    return `
      <div class="signal-row" data-signal="${signal.id}">
        <div class="grow">
          <div><b>${escapeHtml(signal.name || t('signal.unnamed'))}</b></div>
          <div class="muted" style="font-size:12px;">${statusLine(signal, state, measured)}</div>
          ${pooled ? `<div class="muted" style="font-size:12px;">${t('signal.pooled', { cycle: Math.round(pooled.cycleSec), days: pooled.days })}</div>` : ''}
        </div>
        <button class="btn sm" data-measure="${signal.id}">${t('signal.measure')}</button>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-measure]').forEach(btn => btn.addEventListener('click', async () => {
    const signal = (await DB.getAll('signals')).find(s => s.id === btn.dataset.measure);
    openMeasure(signal, () => renderList(root));
  }));
}

function statusLine(signal, state, measured) {
  if (measured.length === 0) return t('signal.not_measured');

  const programs = measured
    .map(([id, p]) => `${t(PROGRAM_KEY[id])} ${p.cycleSec} ${t('signal.sec')}`)
    .join(' · ');

  if (state.state === 'unknown') {
    const reason = {
      stale: 'signal.reason_stale',
      unstable: 'signal.reason_unstable',
      not_measured: 'signal.reason_no_program',
      not_enough: 'signal.reason_not_enough',
    }[state.reason] || 'signal.reason_no_program';
    return `${programs} · ${t(reason)}`;
  }
  return `${programs} · ${t(state.state === 'green' ? 'signal.now_green' : 'signal.now_red', { seconds: state.remainingSec })}`;
}

/** Новый светофор в текущей точке. */
async function addHere(root) {
  if (!('geolocation' in navigator)) return toast(t('hud.unavailable'));

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const here = { lat: pos.coords.latitude, lon: pos.coords.longitude };

    // Привязываем к узлу светофора на карте, если он рядом: только по этому
    // номеру можно потом сопоставить общие наблюдения. Без дорожных данных
    // светофор остаётся личным — это рабочий вариант, просто без копилки.
    let osmId = null;
    if (await roadEnabled()) {
      await ensureAround(here.lat, here.lon).catch(() => {});
      const { signals } = loadedAround(here.lat, here.lon);
      let nearest = null;
      for (const candidate of signals) {
        const distance = distanceMeters(here, candidate);
        if (distance <= 40 && (!nearest || distance < nearest.distance)) {
          nearest = { id: candidate.id, distance };
        }
      }
      osmId = nearest ? String(nearest.id) : null;
    }

    const signal = {
      id: uuid(),
      name: '',
      ...here,
      osmId,
      addedAt: Date.now(),
      programs: {},
    };
    await DB.put('signals', signal);
    renderList(root);
    openMeasure(signal, () => renderList(root));
  }, () => toast(t('map.permission_denied')), { enableHighAccuracy: true, timeout: 15000 });
}

/**
 * Замер.
 *
 * Две кнопки во весь экран: человек смотрит на светофор, а не на телефон,
 * и попасть должен не глядя. Оценка обновляется на ходу, чтобы было видно,
 * хватило ли циклов и сходятся ли замеры.
 */
function openMeasure(signal, onSaved) {
  if (!signal) return;
  let taps = [];

  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="signal.measure_title"></h2><button class="modal-close">✕</button></div>

    <label class="field"><span class="field-label" data-i18n="signal.name"></span>
      <input id="signal-name" value="${escapeHtml(signal.name || '')}" placeholder="${t('signal.name_hint')}"></label>

    <div class="muted" style="font-size:13px;margin:10px 0;">
      ${t('signal.program_now', { program: t(PROGRAM_KEY[programAt(Date.now())]) })}
    </div>

    <div class="signal-buttons">
      <button class="signal-btn green" data-tap="green">${t('signal.tap_green')}</button>
      <button class="signal-btn red" data-tap="red">${t('signal.tap_red')}</button>
    </div>

    <div class="signal-estimate" id="signal-estimate">${t('signal.tap_hint')}</div>

    <div class="row" style="gap:10px;margin-top:14px;">
      <button class="btn block" id="signal-undo" data-i18n="signal.undo"></button>
      <button class="btn primary" id="signal-save" data-i18n="common.save"></button>
    </div>
    <div class="settings-row" style="cursor:pointer;margin-top:8px;" id="signal-delete">
      <span style="color:var(--danger);" data-i18n="signal.delete"></span></div>
  `, {
    onMount: (root) => {
      const estimate = root.querySelector('#signal-estimate');
      root.querySelector('.modal-close').addEventListener('click', closeModal);

      const refresh = () => {
        if (taps.length === 0) {
          estimate.textContent = t('signal.tap_hint');
          return;
        }
        const result = estimateCycle(taps);
        if (result.ok) {
          estimate.textContent = t('signal.estimate_ok', {
            green: result.greenSec, red: result.redSec, cycle: result.cycleSec,
            cycles: result.samples,
            times: plural(result.samples, t('signal.cycle_one'), t('signal.cycle_few'), t('signal.cycle_many')),
          });
          estimate.className = 'signal-estimate ok';
        } else if (result.reason === 'unstable') {
          // Прямо говорим, что светофор адаптивный: продолжать замер
          // бессмысленно, и человек должен это узнать сразу.
          estimate.textContent = t('signal.estimate_unstable', { spread: result.spreadSec });
          estimate.className = 'signal-estimate bad';
        } else {
          estimate.textContent = t('signal.estimate_more', { taps: taps.length });
          estimate.className = 'signal-estimate';
        }
      };

      root.querySelectorAll('[data-tap]').forEach(btn => btn.addEventListener('click', () => {
        taps.push({ at: Date.now(), phase: btn.dataset.tap });
        try { navigator.vibrate?.(30); } catch { /* не везде есть */ }
        refresh();
      }));

      root.querySelector('#signal-undo').addEventListener('click', () => {
        taps.pop();
        refresh();
      });

      root.querySelector('#signal-save').addEventListener('click', async () => {
        const name = root.querySelector('#signal-name').value.trim();
        const result = estimateCycle(taps);
        if (!result.ok && taps.length > 0) {
          // Сохраняем и неудачный замер: «здесь цикл плавает» — тоже знание,
          // и повторять безнадёжный замер незачем.
          toast(t(result.reason === 'unstable' ? 'signal.saved_unstable' : 'signal.saved_partial'));
        }
        await DB.put('signals', { ...applyMeasurement(signal, taps), name });
        closeModal();
        onSaved?.();
      });

      root.querySelector('#signal-delete').addEventListener('click', async () => {
        await DB.delete('signals', signal.id);
        closeModal();
        onSaved?.();
      });
    },
  });
  applyI18nTree(overlay);
}

export { PROGRAMS };
