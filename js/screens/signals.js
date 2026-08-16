import { DB } from '../db.js';
import { uuid } from '../format.js';
import { t, plural } from '../i18n.js';
import { applyI18nTree, openModal, closeModal, toast, escapeHtml } from '../ui.js';
import {
  applyMeasurement, predict, programAt, estimateCycle, PROGRAMS,
} from '../signalTiming.js';
import { loadedAround, ensureAround, isEnabled as roadEnabled } from '../roadData.js';
import { distanceMeters } from '../roadRules.js';
import { fetchEstimates, isEnabled as poolEnabled } from '../signalPoolClient.js';

/**
 * Светофоры вокруг.
 *
 * Расставлять их вручную не нужно: перекрёстки со светофорами уже размечены
 * в открытой карте OpenStreetMap, и мы берём их оттуда по номеру узла. К
 * этому же номеру привязаны наблюдения — поэтому данные разных людей об
 * одном перекрёстке складываются.
 *
 * Откуда берутся длительности: приложение само замечает, что машина стояла
 * у светофора, и запоминает момент старта. Моменты стартов, собранные за
 * несколько дней, укладываются в один период — это и есть цикл. Время
 * стояния даёт длину красного: подъезжают в случайный момент красного, так
 * что самые долгие ожидания и есть почти весь красный.
 *
 * Чего здесь принципиально нет — правдоподобных чисел на малых данных. Пока
 * наблюдений мало, экран показывает счётчик «собрано столько-то», а не
 * отсчёт. Ошибочный отсчёт на перекрёстке опаснее его отсутствия.
 */

const PROGRAM_KEY = {
  night: 'signal.program_night',
  morning: 'signal.program_morning',
  day: 'signal.program_day',
  evening: 'signal.program_evening',
  late: 'signal.program_late',
};

// Сколько светофоров показывать: список — чтобы понять обстановку вокруг,
// а не чтобы пролистывать весь город.
const NEARBY_LIMIT = 12;
// Свой замер привязывается к узлу карты, если он в этих пределах.
const SNAP_M = 40;

export async function openSignals() {
  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="signal.title"></h2><button class="modal-close">✕</button></div>
    <div class="muted" style="font-size:13px;" data-i18n="signal.intro"></div>
    <div id="signal-list" style="margin-top:14px;">
      <div class="muted" data-i18n="signal.searching"></div>
    </div>
    <div class="muted guide-disclaimer" data-i18n="signal.note"></div>
  `, {
    onMount: (root) => {
      root.querySelector('.modal-close').addEventListener('click', closeModal);
      renderList(root);
    },
  });
  applyI18nTree(overlay);
  return overlay;
}

/** Светофоры из карты вокруг точки, ближние первыми. */
async function nearbySignals(here) {
  await ensureAround(here.lat, here.lon).catch(() => {});
  const { signals } = loadedAround(here.lat, here.lon);

  // Один и тот же перекрёсток приходит из нескольких соседних квадратов
  // карты. Без склейки по номеру узла список забивается повторами, а
  // светофоры подальше в него уже не помещаются.
  const unique = new Map();
  for (const signal of signals || []) {
    if (!unique.has(String(signal.id))) unique.set(String(signal.id), signal);
  }

  return [...unique.values()]
    .map(signal => ({ ...signal, distance: distanceMeters(here, signal) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, NEARBY_LIMIT);
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('no geolocation'));
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });
}

async function renderList(root) {
  const list = root.querySelector('#signal-list');
  if (!list) return;

  if (!(await roadEnabled())) {
    list.innerHTML = `<div class="muted">${t('signal.pool_off')}</div>`;
    return;
  }

  let here;
  try {
    here = await currentPosition();
  } catch {
    list.innerHTML = `<div class="muted">${t('map.permission_denied')}</div>`;
    return;
  }

  const signals = await nearbySignals(here);
  if (signals.length === 0) {
    list.innerHTML = `<div class="muted">${t('signal.none_nearby')}</div>`;
    return;
  }

  // Свои ручные замеры лежат отдельно и привязаны к тому же номеру узла.
  const mine = new Map();
  for (const own of await DB.getAll('signals')) {
    if (own.osmId) mine.set(String(own.osmId), own);
  }

  const pool = await fetchEstimates(signals.map(s => s.id)).catch(() => null);
  const program = programAt(Date.now());
  const shared = new Map();
  for (const estimate of pool?.estimates || []) {
    shared.set(`${estimate.signalKey}|${estimate.program}`, estimate);
  }
  const progress = new Map();
  for (const item of pool?.progress || []) {
    progress.set(`${item.signalKey}|${item.program}`, item);
  }
  const needed = pool?.needed || { samples: 20, days: 4 };
  const collecting = await poolEnabled();

  const now = Date.now();
  list.innerHTML = signals.map((signal) => {
    const key = `${signal.id}|${program}`;
    const own = mine.get(String(signal.id));
    return `
      <div class="signal-row" data-signal="${signal.id}">
        <div class="grow">
          <div><b>${escapeHtml(own?.name || t('signal.meters', { meters: Math.round(signal.distance) }))}</b></div>
          ${describe({
            estimate: shared.get(key), progress: progress.get(key), needed, collecting, own, now,
          })}
        </div>
        <button class="btn sm" data-measure="${signal.id}">${t('signal.measure')}</button>
      </div>`;
  }).join('') + `<div class="muted" style="font-size:12px;margin-top:10px;">${t('signal.why_wait')}</div>`;

  list.querySelectorAll('[data-measure]').forEach(btn => btn.addEventListener('click', async () => {
    const osmId = btn.dataset.measure;
    const signal = mine.get(osmId) || {
      id: uuid(),
      name: '',
      osmId,
      ...signals.find(s => String(s.id) === osmId),
      addedAt: Date.now(),
      programs: {},
    };
    openMeasure(signal, () => renderList(root));
  }));
}

/**
 * Что известно про светофор — одной-двумя строками.
 *
 * Порядок важен: сначала то, что измерено самим человеком (он этому верит
 * обоснованно), затем общий расчёт, затем честный счётчик сбора.
 */
function describe({ estimate, progress, needed, collecting, own, now }) {
  const lines = [];

  if (own) {
    const measured = Object.entries(own.programs || {}).filter(([, p]) => p.ok);
    if (measured.length > 0) lines.push(ownLine(own, measured, now));
  }

  if (estimate) {
    lines.push(estimate.redSec && estimate.greenSec
      ? t('signal.phases', {
        cycle: Math.round(estimate.cycleSec),
        red: Math.round(estimate.redSec),
        green: Math.round(estimate.greenSec),
      })
      : t('signal.phases_cycle_only', { cycle: Math.round(estimate.cycleSec) }));
    lines.push(t('signal.based_on', { samples: estimate.samples, days: estimate.days }));
  } else if (!collecting) {
    lines.push(t('signal.pool_off'));
  } else if (progress) {
    lines.push(t('signal.collecting', {
      samples: progress.samples, samples_needed: needed.samples,
      days: progress.days, days_needed: needed.days,
    }));
  } else {
    lines.push(t('signal.collecting_none'));
  }

  return lines.map(line => `<div class="muted" style="font-size:12px;">${line}</div>`).join('');
}

function ownLine(signal, measured, now) {
  const state = predict(signal, now);
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

/**
 * Ручной замер.
 *
 * Остаётся как быстрый путь: общий расчёт набирается неделями, а замерить
 * конкретный перекрёсток можно за пять минут. Две кнопки во весь экран —
 * человек стоит в машине и смотрит на светофор, а не на телефон.
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

export { PROGRAMS, SNAP_M };
