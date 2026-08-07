import { DB, getSetting, setSetting } from '../db.js';
import {
  AppState, setThemeId, setLanguage, setCurrency, setUnits, setWeight,
  getPrimaryVehicle, getVehicles, getSevereConditions, setSevereConditions, recalcIntervals,
} from '../state.js';
import { CURRENCY_SYMBOLS } from '../format.js';
import { t } from '../i18n.js';
import { applyI18nTree, openModal, closeModal, toast, icon } from '../ui.js';
import { THEMES, THEME_ORDER } from '../theme.js';
import { MAP_LAYERS, getMapProvider, setMapProvider } from '../mapLayers.js';
import { currentTier, TIER, TEST_MODE, resetPurchase } from '../subscription.js';
import { openPaywall } from '../paywall.js';

let containerRef = null;

/**
 * Темы сверх бесплатных — платные.
 *
 * Косметика — единственное, что можно закрыть без обиды: она ничего не ломает
 * в работе приложения. Запирать за деньги учёт пробега или регламент нельзя,
 * ради них приложение и скачивают.
 */
const FREE_THEMES = ['classic', 'midnight'];

export function render(container) {
  containerRef = container;
  container.innerHTML = `<h1 class="page-title" data-i18n="settings.title"></h1><div id="settings-body"></div>`;
  applyI18nTree(container);
  refresh();
}

export async function refresh() {
  if (!containerRef) return;
  const body = containerRef.querySelector('#settings-body');

  const [tier, severe, vehicles] = await Promise.all([
    currentTier(),
    getSevereConditions(),
    getVehicles(),
  ]);
  // Темы — единственное место, где замок показывается по РЕАЛЬНОМУ уровню,
  // а не через hasFeature (тот в тестовом режиме открывает всё). Так виден
  // весь цикл: замок → витрина → «покупка» → тема открылась. Пройти его
  // насквозь нужно, чтобы проверить подачу монетизации, а не только код.
  const canThemes = tier !== TIER.FREE;
  const provider = getMapProvider();

  body.innerHTML = `
    ${subscriptionCard(tier)}

    <div class="section-title" data-i18n="settings.section_look"></div>
    <div class="card">
      <div class="settings-row">
        <span data-i18n="settings.theme"></span>
      </div>
      <div class="theme-row" id="set-themes">
        ${THEME_ORDER.map(id => themeSwatch(id, canThemes)).join('')}
      </div>
      ${!canThemes ? `<div class="muted" style="font-size:12px;margin-top:8px;" data-i18n="settings.themes_locked"></div>` : ''}
    </div>

    <div class="section-title" data-i18n="settings.section_regional"></div>
    <div class="card">
      <div class="settings-row"><span data-i18n="settings.language"></span>
        <div class="chip-row">
          <button class="chip ${AppState.lang === 'ru' ? 'active' : ''}" data-lang="ru">RU</button>
          <button class="chip ${AppState.lang === 'en' ? 'active' : ''}" data-lang="en">EN</button>
        </div>
      </div>
      <div class="settings-row"><span data-i18n="settings.units"></span>
        <div class="chip-row">
          <button class="chip ${AppState.units === 'metric' ? 'active' : ''}" data-units="metric" data-i18n="settings.units.metric"></button>
          <button class="chip ${AppState.units === 'imperial' ? 'active' : ''}" data-units="imperial" data-i18n="settings.units.imperial"></button>
        </div>
      </div>
      <div class="settings-row"><span data-i18n="settings.currency"></span>
        <select id="set-currency" style="width:auto;">
          ${Object.keys(CURRENCY_SYMBOLS).map(c => `<option value="${c}" ${AppState.currency === c ? 'selected' : ''}>${c} ${CURRENCY_SYMBOLS[c]}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row">
        <span>
          <span data-i18n="settings.weight"></span>
          <span class="muted" style="display:block;font-size:12px;" data-i18n="settings.weight_hint"></span>
        </span>
        <input id="set-weight" type="number" style="width:84px;" value="${AppState.weightKg}">
      </div>
    </div>

    <div class="section-title" data-i18n="settings.section_map"></div>
    <div class="card">
      <div class="settings-row"><span data-i18n="settings.map_layer"></span>
        <select id="set-map" style="width:auto;">
          ${Object.keys(MAP_LAYERS).map(id => `<option value="${id}" ${provider === id ? 'selected' : ''}>${t(MAP_LAYERS[id].nameKey)}</option>`).join('')}
        </select>
      </div>
      <div class="muted" style="font-size:12px;" data-i18n="settings.map_hint"></div>
    </div>

    <div class="section-title" data-i18n="settings.section_maintenance"></div>
    <div class="card">
      <label class="settings-row" style="cursor:pointer;">
        <span>
          <span data-i18n="maint.severe"></span>
          <span class="muted" style="display:block;font-size:12px;" data-i18n="maint.severe_hint"></span>
        </span>
        <input type="checkbox" id="set-severe" style="width:auto;"${severe ? ' checked' : ''}>
      </label>
    </div>

    <div class="section-title" data-i18n="settings.section_data"></div>
    <div class="card">
      <div class="settings-row"><span data-i18n="settings.storage"></span>
        <span class="muted" id="set-storage">…</span>
      </div>
      <div class="settings-row" style="cursor:pointer;" id="set-export">
        <span>
          <span data-i18n="settings.export"></span>
          <span class="muted" style="display:block;font-size:12px;" data-i18n="settings.export_hint"></span>
        </span>
        <span class="lock-badge" data-i18n="settings.paid"></span>
      </div>
      <div class="settings-row" style="cursor:pointer;" id="set-wipe">
        <span style="color:var(--danger);" data-i18n="settings.wipe"></span>
      </div>
    </div>

    <div class="section-title" data-i18n="settings.section_about"></div>
    <div class="card">
      <div class="settings-row"><span data-i18n="settings.version"></span><span class="muted">1.0.0</span></div>
      <div class="settings-row"><span data-i18n="settings.vehicles_count"></span><span class="muted">${vehicles.length}</span></div>
      <div class="muted" style="font-size:12px;padding-top:8px;" data-i18n="settings.privacy_note"></div>
    </div>
  `;
  applyI18nTree(body);
  bind(body, canThemes);
  showStorageUsage(body);
}

/** Карточка уровня доступа — единственная точка входа в оплату из настроек. */
function subscriptionCard(tier) {
  const isPaid = tier !== TIER.FREE;
  const nameKey = tier === TIER.PRO ? 'pay.plan.pro' : tier === TIER.PLUS ? 'pay.plan.plus' : 'pay.plan.free';
  return `
    <div class="card sub-card${isPaid ? ' paid' : ''}">
      <div class="row between">
        <div>
          <div class="sub-tier">${t(nameKey)}</div>
          <div class="muted" style="font-size:13px;">${t(isPaid ? 'settings.sub_active' : 'settings.sub_free')}</div>
        </div>
        <button class="btn ${isPaid ? 'sm' : 'primary'}" id="set-upgrade">
          ${t(isPaid ? 'settings.sub_manage' : 'settings.sub_upgrade')}
        </button>
      </div>
      ${TEST_MODE ? `<div class="muted" style="font-size:12px;margin-top:10px;padding-top:10px;border-top:1px solid var(--separator);">
        ${t('pay.test_mode')} · <a href="#" id="set-reset-tier">${t('pay.test_reset')}</a>
      </div>` : ''}
    </div>`;
}

function themeSwatch(id, unlocked) {
  const theme = THEMES[id];
  const locked = !unlocked && !FREE_THEMES.includes(id);
  return `
    <button class="theme-swatch ${AppState.theme === id ? 'active' : ''}${locked ? ' locked' : ''}"
            data-theme="${id}" data-locked="${locked ? '1' : ''}"
            style="background:${theme.background};color:${theme.accent};border-color:${AppState.theme === id ? theme.accent : 'transparent'}"
            aria-label="${t('theme.' + id)}">${locked ? '🔒' : '●'}</button>`;
}

function bind(body, canThemes) {
  body.querySelector('#set-upgrade').addEventListener('click', () => {
    openPaywall({ reason: 'pay.reason_default', onDone: refresh });
  });
  body.querySelector('#set-reset-tier')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await resetPurchase();
    toast(t('pay.test_reset_done'));
    refresh();
  });

  body.querySelectorAll('[data-theme]').forEach(btn => btn.addEventListener('click', async () => {
    if (btn.dataset.locked) {
      openPaywall({ reason: 'pay.reason_themes', onDone: refresh });
      return;
    }
    await setThemeId(btn.dataset.theme);
    document.dispatchEvent(new CustomEvent('theme-changed'));
    refresh();
  }));

  body.querySelectorAll('[data-lang]').forEach(btn => btn.addEventListener('click', async () => {
    await setLanguage(btn.dataset.lang);
    document.dispatchEvent(new CustomEvent('lang-changed'));
  }));

  body.querySelectorAll('[data-units]').forEach(btn => btn.addEventListener('click', async () => {
    await setUnits(btn.dataset.units);
    refresh();
  }));

  body.querySelector('#set-currency').addEventListener('change', async (e) => {
    await setCurrency(e.target.value);
    refresh();
  });

  body.querySelector('#set-weight').addEventListener('change', async (e) => {
    await setWeight(parseFloat(e.target.value) || 75);
  });

  body.querySelector('#set-map').addEventListener('change', (e) => {
    setMapProvider(e.target.value);
    toast(t('settings.map_saved'));
  });

  body.querySelector('#set-severe').addEventListener('change', async (e) => {
    // Режим эксплуатации меняет интервалы регламента, но не историю замен.
    await setSevereConditions(e.target.checked);
    const vehicle = await getPrimaryVehicle();
    if (vehicle) await recalcIntervals(vehicle, e.target.checked);
    toast(t('settings.severe_saved'));
  });

  body.querySelector('#set-export').addEventListener('click', () => {
    openPaywall({ reason: 'pay.reason_export', onDone: refresh });
  });

  body.querySelector('#set-wipe').addEventListener('click', confirmWipe);
}

/**
 * Сколько места занято. Показываем честно: приложение хранит всё локально,
 * и человек вправе знать объём, особенно если ведёт трек каждый день.
 */
async function showStorageUsage(body) {
  const el = body.querySelector('#set-storage');
  if (!el) return;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est && est.usage != null) {
      el.textContent = `${(est.usage / 1024 / 1024).toFixed(1)} ${t('unit.mb')}`;
      return;
    }
  } catch { /* оценка недоступна — не беда, показываем число записей */ }
  const [trips, points] = await Promise.all([DB.getAll('trips'), DB.getAll('trackPoints')]);
  el.textContent = t('settings.storage_rows', { trips: trips.length, points: points.length });
}

/**
 * Удаление всех данных. Двухшаговое подтверждение: отменить это нельзя,
 * а на телефоне промахнуться по строке легко.
 */
function confirmWipe() {
  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="settings.wipe"></h2><button class="modal-close">✕</button></div>
    <p data-i18n="settings.wipe_warning"></p>
    <div class="row" style="gap:10px;margin-top:14px;">
      <button class="btn block" id="wipe-cancel" data-i18n="common.cancel"></button>
      <button class="btn danger" id="wipe-go" data-i18n="settings.wipe_confirm"></button>
    </div>
  `, {
    onMount: (root) => {
      root.querySelector('.modal-close').addEventListener('click', closeModal);
      root.querySelector('#wipe-cancel').addEventListener('click', closeModal);
      root.querySelector('#wipe-go').addEventListener('click', async () => {
        for (const store of ['trips', 'trackPoints', 'vehicles', 'refuels', 'expenses', 'maintenanceItems']) {
          await DB.clear(store);
        }
        closeModal();
        toast(t('settings.wipe_done'));
        // Перезагрузка — проще и надёжнее, чем разослать событие всем экранам:
        // после стирания у каждого из них состояние на руках уже недействительно.
        setTimeout(() => location.reload(), 600);
      });
    }
  });
  applyI18nTree(overlay);
}
