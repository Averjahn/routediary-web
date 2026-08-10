import { getSetting, setSetting } from '../db.js';
import { AppState } from '../state.js';
import { t } from '../i18n.js';
import { applyI18nTree, openModal, closeModal, toast, escapeHtml } from '../ui.js';
import { classifyVehicle } from '../maintenance.js';
import { guideFor, toolName, text as gtext, LEVEL, CHECK_MANUAL } from '../guides.js';
import { diagram } from '../guideArt.js';

/**
 * Руководство по замене узла.
 *
 * Отмеченные шаги сохраняются: замена масла редко делается в один присест,
 * человек уходит за фильтром или бросает на полдороге, и возвращаться
 * к списку без отметок — значит каждый раз заново искать, где остановился.
 *
 * Работы, которые не делают в гараже, показывают не пустой список шагов,
 * а причину. «Обратитесь в сервис» без объяснения человек проигнорирует.
 */

const progressKey = (componentId) => `guideProgress:${componentId}`;

/**
 * @param {object} opts
 * @param {string} opts.componentId
 * @param {string} opts.title      название узла, как оно показано в регламенте
 * @param {object} opts.vehicle    машина — от неё зависит класс
 * @param {function} [opts.onDone] «заменил»: отметить в регламенте
 */
export async function openGuide({ componentId, title, vehicle, onDone }) {
  const vehicleClass = vehicle ? classifyVehicle(vehicle).vehicleClass : null;
  const guide = guideFor(componentId, vehicleClass);
  if (!guide) {
    toast(t('guide.none'));
    return;
  }

  const lang = AppState.lang === 'en' ? 'en' : 'ru';
  const done = new Set((await getSetting(progressKey(componentId))) || []);

  const overlay = openModal(
    guide.level === LEVEL.SERVICE
      ? serviceMarkup(guide, title, lang)
      : guideMarkup(guide, title, lang, done),
    {
      onMount: (root) => {
        root.querySelector('.modal-close').addEventListener('click', closeModal);

        root.querySelectorAll('[data-step]').forEach(row => {
          row.addEventListener('click', async () => {
            const index = Number(row.dataset.step);
            if (done.has(index)) done.delete(index);
            else done.add(index);
            row.classList.toggle('done', done.has(index));
            await setSetting(progressKey(componentId), [...done]);
            updateProgress(root, done.size, guide.steps.length);
          });
        });

        root.querySelector('[data-guide-done]')?.addEventListener('click', async () => {
          // Работа закончена — отметки шагов больше не нужны, иначе в
          // следующий раз откроется наполовину зачёркнутый список.
          await setSetting(progressKey(componentId), undefined);
          closeModal();
          onDone?.();
        });

        root.querySelector('[data-guide-reset]')?.addEventListener('click', async () => {
          await setSetting(progressKey(componentId), undefined);
          root.querySelectorAll('[data-step]').forEach(r => r.classList.remove('done'));
          done.clear();
          updateProgress(root, 0, guide.steps.length);
        });
      },
    }
  );
  applyI18nTree(overlay);
  return overlay;
}

function updateProgress(root, doneCount, total) {
  const label = root.querySelector('[data-guide-progress]');
  if (label) label.textContent = t('guide.progress', { done: doneCount, total });
  const fill = root.querySelector('[data-guide-fill]');
  if (fill) fill.style.width = `${total ? (doneCount / total) * 100 : 0}%`;
}

const LEVEL_KEY = {
  [LEVEL.DIY]: 'guide.level_diy',
  [LEVEL.ASSISTED]: 'guide.level_assisted',
  [LEVEL.SERVICE]: 'guide.level_service',
};

function guideMarkup(guide, title, lang, done) {
  const steps = guide.steps.map((s, i) => `
    <div class="guide-step${done.has(i) ? ' done' : ''}" data-step="${i}">
      <div class="guide-step-num">${i + 1}</div>
      <div class="guide-step-body">
        <div>${escapeHtml(gtext(s, lang))}</div>
        ${s.warn ? `<div class="guide-warn">${escapeHtml(gtext(s.warn, lang))}</div>` : ''}
        ${s.manual ? `<div class="guide-manual">${escapeHtml(gtext(CHECK_MANUAL, lang))}</div>` : ''}
      </div>
    </div>`).join('');

  const parts = (guide.parts?.[lang] || guide.parts?.ru || []);

  return `
    <div class="modal-header">
      <h2>${escapeHtml(title)}</h2>
      <button class="modal-close">✕</button>
    </div>

    <div class="guide-meta">
      <span class="guide-badge ${guide.level}">${t(LEVEL_KEY[guide.level])}</span>
      <span class="muted">${t('guide.minutes', { minutes: guide.minutes })}</span>
      <span class="muted">${t('guide.difficulty', { level: guide.difficulty })}</span>
    </div>

    ${guide.classNote ? `<div class="guide-note">${escapeHtml(gtext(guide.classNote, lang))}</div>` : ''}

    ${(guide.warnings || []).length ? `
      <div class="guide-warnings">
        <div class="guide-warnings-title">${t('guide.safety')}</div>
        ${guide.warnings.map(w => `<div>${escapeHtml(gtext(w, lang))}</div>`).join('')}
      </div>` : ''}

    ${guide.diagram ? `<div class="guide-diagram">${diagram(guide.diagram, lang)}</div>` : ''}

    <div class="section-title">${t('guide.tools')}</div>
    <div class="guide-chips">
      ${guide.tools.map(id => `<span class="guide-chip">${escapeHtml(toolName(id, lang))}</span>`).join('')}
    </div>

    ${parts.length ? `
      <div class="section-title">${t('guide.parts')}</div>
      <div class="guide-chips">
        ${parts.map(p => `<span class="guide-chip">${escapeHtml(p)}</span>`).join('')}
      </div>` : ''}

    <div class="section-title">${t('guide.steps')}</div>
    <div class="guide-progress">
      <div class="progress-track"><div class="progress-fill" data-guide-fill
           style="width:${guide.steps.length ? (done.size / guide.steps.length) * 100 : 0}%"></div></div>
      <span class="muted" data-guide-progress>${t('guide.progress', { done: done.size, total: guide.steps.length })}</span>
    </div>
    <div class="guide-steps">${steps}</div>
    <div class="muted guide-tap-hint">${t('guide.tap_hint')}</div>

    <div class="row" style="gap:10px;margin-top:16px;">
      <button class="btn block" data-guide-reset>${t('guide.reset')}</button>
      <button class="btn primary" data-guide-done>${t('guide.finished')}</button>
    </div>
    <div class="guide-disclaimer">${t('guide.disclaimer')}</div>
  `;
}

function serviceMarkup(guide, title, lang) {
  return `
    <div class="modal-header">
      <h2>${escapeHtml(title)}</h2>
      <button class="modal-close">✕</button>
    </div>
    <div class="guide-meta">
      <span class="guide-badge service">${t(LEVEL_KEY[LEVEL.SERVICE])}</span>
    </div>
    <div class="guide-service">
      <div class="guide-service-why">${t('guide.why_service')}</div>
      <div>${escapeHtml(gtext(guide.reason, lang))}</div>
    </div>
    <div class="muted guide-disclaimer">${t('guide.service_hint')}</div>
  `;
}
