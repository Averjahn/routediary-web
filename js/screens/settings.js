import { DB, getSetting, setSetting } from '../db.js';
import {
  AppState, setThemeId, setLanguage, setCurrency, setUnits, setWeight, setRegion,
  getPrimaryVehicle, getVehicles, getSevereConditions, setSevereConditions, recalcIntervals,
} from '../state.js';
import { CURRENCY_SYMBOLS } from '../format.js';
import { t, getLang, LANGUAGES, LANGUAGE_ORDER } from '../i18n.js';
import { REGION_ORDER } from '../vehicleRegion.js';
import { applyI18nTree, openModal, closeModal, toast, icon, restoreScroll, escapeHtml } from '../ui.js';
import { THEMES, THEME_ORDER, isFreeTheme } from '../theme.js';
import {
  HUD_COLORS, HUD_FONTS, HUD_DEFAULT_COLOR, HUD_DEFAULT_FONT, getHudStyle, setHudStyle,
  MOTION_KEY, motionAvailable, requestMotionAccess, HUD_COLOR_AUTO,
} from '../hud.js';
import { applyDigits } from '../segmentDigits.js';
import { MAP_LAYERS, getMapProvider, setMapProvider } from '../mapLayers.js';
import { currentTier, TIER, TEST_MODE, resetPurchase, hasFeature } from '../subscription.js';
import { openPaywall } from '../paywall.js';
import { getReferralCode, getShareUrl, getInvitedBy, getLocalCode } from '../referral.js';
import { qrSvg } from '../qr.js';
import { Sync, syncQuietly, startAutoSync, stopAutoSync, deviceLabel } from '../syncClient.js';
import { AUTO_TRACK_KEY } from '../tracking.js';
import { openSignals } from './signals.js';
import { SIGNALS_ENABLED } from '../features.js';
import {
  generateSecret, normalizeSecret, formatSecret, isValidSecret,
  loginFor, savedSecret, rememberSecret, forgetSecret,
} from '../quickAccount.js';
import { isEnabled as poolEnabled, setEnabled as setPoolEnabled } from '../signalPoolClient.js';
import { isEnabled as roadEnabled, setEnabled as setRoadEnabled, cachedTileCount, clearCache as clearRoadCache } from '../roadData.js';

let containerRef = null;

export function render(container) {
  containerRef = container;
  container.innerHTML = `<h1 class="page-title" data-i18n="settings.title"></h1><div id="settings-body"></div>`;
  applyI18nTree(container);
  refresh();
}

/** Контейнер с прокруткой, в котором лежит экран. */
function scrollBox() {
  return containerRef?.closest('.screen') || containerRef;
}

/**
 * Перерисовка экрана с сохранением позиции прокрутки.
 * Нужна для действий внутри самого экрана — смены темы, единиц, валюты:
 * они пересобирают содержимое и без этого выбрасывают человека наверх.
 */
async function refreshKeepingScroll() {
  const box = scrollBox();
  const top = box ? box.scrollTop : 0;
  await refresh();
  restoreScroll(box, top);
}

export async function refresh() {
  if (!containerRef) return;
  const body = containerRef.querySelector('#settings-body');

  const [tier, severe, vehicles, sync, road, roadTiles, pool, hudStyle, savedRegion, motionAssist, autoTrack] = await Promise.all([
    currentTier(),
    getSevereConditions(),
    getVehicles(),
    Sync.status(),
    roadEnabled(),
    cachedTileCount(),
    poolEnabled(),
    // Стиль проекции нужен здесь же: под чипами показывается живой образец
    // с этими цифрами, шрифтом и цветом — тот же, что окажется на стекле.
    getHudStyle(),
    // Сохранённая страна, а не действующая: в списке надо показать «авто»,
    // если человек её не выбирал, — иначе он не отличит свой выбор от догадки.
    getSetting('region', null),
    getSetting(MOTION_KEY, false),
    getSetting(AUTO_TRACK_KEY, false),
  ]);
  const provider = getMapProvider();
  // Замочки видны только тем, кому функция реально закрыта: у Про (и в
  // тестовом режиме) их нет — рисовать замок на доступном значит врать.
  const styleLocked = !TEST_MODE && tier !== TIER.PRO;

  body.innerHTML = `
    ${subscriptionCard(tier)}

    <div class="section-title" data-i18n="settings.section_look"></div>
    <div class="card">
      <div class="settings-row">
        <span data-i18n="settings.theme"></span>
      </div>
      <div class="theme-row" id="set-themes">
        ${THEME_ORDER.map(id => themeSwatch(id, styleLocked)).join('')}
      </div>
      <div class="muted" style="font-size:12px;padding-top:6px;" data-i18n="theme.pro_hint"></div>

      <div class="settings-row" style="margin-top:18px;">
        <span data-i18n="hud.style_title"></span>
      </div>
      <div class="hud-preview hud-font-${hudStyle.font}" id="hud-preview"
           data-font="${hudStyle.font}"
           style="--hud-color:${HUD_COLORS[hudStyle.color].hex}">
        <div class="hud-preview-value hud-digits" id="hud-preview-value"></div>
        <div class="hud-preview-unit" data-i18n="unit.kmh"></div>
      </div>
      <div class="theme-row">
        <button class="theme-swatch hud-auto ${hudStyle.auto ? 'active' : ''}"
                data-hud-color="${HUD_COLOR_AUTO}"
                aria-label="${t('hud.color_auto')}">A</button>
        ${Object.keys(HUD_COLORS).map(id =>
          hudColorSwatch(id, !hudStyle.auto && hudStyle.color === id, styleLocked)).join('')}
      </div>
      <div class="theme-row" style="margin-top:2px;">
        ${Object.keys(HUD_FONTS).map(id => hudFontSwatch(id, hudStyle.font === id, styleLocked)).join('')}
      </div>
      <div class="muted" style="font-size:12px;padding-top:6px;" data-i18n="hud.style_hint"></div>
      <div class="muted" style="font-size:12px;padding-top:4px;" data-i18n="hud.color_auto_hint"></div>
      <button class="btn" id="set-ad-mode" style="margin-top:10px;" data-i18n="settings.ad_mode"></button>
      <div class="muted" style="font-size:12px;" data-i18n="settings.ad_mode_hint"></div>
      <div class="settings-row" style="margin-top:10px;">
        <span data-i18n="settings.auto_tracking"></span>
        <input type="checkbox" id="set-auto-track" style="width:auto;"${autoTrack ? ' checked' : ''}>
      </div>
      <div class="muted" style="font-size:12px;" data-i18n="settings.auto_tracking_hint"></div>
      ${motionAvailable() ? `
        <div class="settings-row" style="margin-top:10px;">
          <span data-i18n="hud.motion"></span>
          <input type="checkbox" id="set-hud-motion" style="width:auto;"${motionAssist ? ' checked' : ''}>
        </div>
        <div class="muted" style="font-size:12px;" data-i18n="hud.motion_hint"></div>
      ` : ''}
    </div>

    <div class="section-title" data-i18n="settings.section_regional"></div>
    <div class="card">
      <div class="settings-row"><span data-i18n="settings.language"></span>
        <select id="set-lang" style="width:auto;">
          ${LANGUAGE_ORDER.map(code => `<option value="${code}" ${AppState.lang === code ? 'selected' : ''}>${LANGUAGES[code].nativeName}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row"><span data-i18n="settings.region"></span>
        <select id="set-region" style="width:auto;">
          <option value="" ${!savedRegion ? 'selected' : ''}>${t('settings.region_auto')}</option>
          ${REGION_ORDER.map(code => `<option value="${code}" ${savedRegion === code ? 'selected' : ''}>${t('region.' + code)}</option>`).join('')}
        </select>
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

    <div class="section-title" data-i18n="settings.section_road"></div>
    <div class="card">
      <label class="settings-row" style="cursor:pointer;">
        <span>
          <span data-i18n="settings.road_enable"></span>
          <span class="muted" style="display:block;font-size:12px;" data-i18n="settings.road_hint"></span>
        </span>
        <input type="checkbox" id="set-road" style="width:auto;"${road ? ' checked' : ''}>
      </label>
      ${road ? `
        <div class="settings-row"><span data-i18n="settings.road_cached"></span>
          <span class="muted">${roadTiles}</span></div>
        <div class="settings-row" style="cursor:pointer;" id="set-road-clear">
          <span data-i18n="settings.road_clear"></span></div>` : ''}
      ${SIGNALS_ENABLED ? `
      <label class="settings-row" style="cursor:pointer;">
        <span>
          <span data-i18n="settings.pool"></span>
          <span class="muted" style="display:block;font-size:12px;" data-i18n="settings.pool_hint"></span>
          ${road ? '' : '<span class="muted" style="display:block;font-size:12px;color:var(--danger);" data-i18n="settings.pool_needs_road"></span>'}
        </span>
        <input type="checkbox" id="set-pool" style="width:auto;"${pool ? ' checked' : ''}${road ? '' : ' disabled'}>
      </label>
      <div class="muted" style="font-size:12px;padding-top:8px;" data-i18n="settings.pool_what"></div>
      <div class="muted" style="font-size:12px;padding-top:8px;" data-i18n="settings.pool_honest"></div>

      <div class="settings-row" style="cursor:pointer;" id="set-signals">
        <span>
          <span data-i18n="settings.signals"></span>
          <span class="muted" style="display:block;font-size:12px;" data-i18n="settings.signals_hint"></span>
        </span>
      </div>` : ''}
      <div class="muted" style="font-size:12px;padding-top:8px;" data-i18n="settings.road_privacy"></div>
      <div class="muted" style="font-size:12px;padding-top:8px;" data-i18n="settings.road_accuracy"></div>
    </div>

    <div class="section-title" data-i18n="settings.section_export"></div>
    <div class="card">
      <div class="settings-row" style="cursor:pointer;" id="set-export">
        <span>
          <span data-i18n="settings.export"></span>
          <span class="muted" style="display:block;font-size:12px;" data-i18n="settings.export_hint"></span>
        </span>
      </div>
    </div>

    <div class="section-title" data-i18n="settings.section_sync"></div>
    <div class="card" id="sync-card">${syncCard(sync)}</div>

    <div class="section-title" data-i18n="settings.section_share"></div>
    <div class="card">
      <div class="settings-row" style="cursor:pointer;" id="set-share">
        <span data-i18n="settings.share"></span>
        <span class="muted" id="set-share-code">…</span>
      </div>
      <div class="muted" style="font-size:12px;" data-i18n="settings.share_hint"></div>
    </div>

    <div class="section-title" data-i18n="settings.section_data"></div>
    <div class="card">
      <div class="settings-row"><span data-i18n="settings.storage"></span>
        <span class="muted" id="set-storage">…</span>
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
  bind(body);
  showStorageUsage(body);

}

/** Карточка синхронизации: разное содержимое до и после входа. */
function syncCard(sync) {
  if (!sync.signedIn) {
    return `
      <button class="btn primary block" id="sync-quick" data-i18n="quick.create"></button>
      <div class="muted" style="font-size:12px;padding-top:8px;" data-i18n="quick.create_hint"></div>
      <div class="settings-row" style="cursor:pointer;margin-top:6px;" id="sync-restore">
        <span data-i18n="quick.restore"></span></div>
      <div class="settings-row" style="cursor:pointer;" id="sync-signin">
        <span data-i18n="sync.sign_in"></span>
        <span class="muted" data-i18n="sync.off"></span>
      </div>`;
  }

  const last = sync.lastAt
    ? new Date(sync.lastAt).toLocaleString(AppState.lang === 'en' ? 'en-GB' : 'ru-RU')
    : t('sync.never');

  // Остаток Pro считается от серверной даты: местные часы её не двигают.
  const proUntil = sync.proUntil ? new Date(sync.proUntil) : null;
  const proDaysLeft = proUntil && proUntil > new Date()
    ? Math.ceil((proUntil - Date.now()) / 864e5) : 0;
  const isCodeLogin = (sync.login || '').endsWith('@code.invalid');

  return `
    <div class="settings-row"><span data-i18n="sync.account"></span>
      <span class="muted">${isCodeLogin ? t('quick.device_account') : escapeHtml(sync.login || '')}</span></div>
    ${proDaysLeft > 0 ? `
    <div class="settings-row"><span data-i18n="pro.status"></span>
      <b style="color:var(--success);">${t('pro.until', {
        date: proUntil.toLocaleDateString(), days: proDaysLeft })}</b></div>` : ''}
    <div class="settings-row"><span data-i18n="sync.last"></span>
      <span class="muted" id="sync-last">${escapeHtml(last)}</span></div>
    ${sync.pending ? `<div class="settings-row"><span data-i18n="sync.pending"></span>
      <span class="muted">${sync.pending}</span></div>` : ''}
    <div class="row" style="gap:10px;margin-top:12px;">
      <button class="btn primary block" id="sync-now" data-i18n="sync.now"></button>
    </div>
    <div class="settings-row" style="cursor:pointer;margin-top:6px;" id="sync-show-code">
      <span data-i18n="quick.show_code"></span></div>
    ${isCodeLogin ? `
    <div class="settings-row" style="cursor:pointer;" id="sync-attach-email">
      <span>
        <span data-i18n="quick.attach_email"></span>
        <span class="muted" style="display:block;font-size:12px;" data-i18n="quick.attach_email_hint"></span>
      </span>
    </div>` : ''}
    <div class="settings-row" style="cursor:pointer;" id="sync-password">
      <span data-i18n="sync.change_password"></span></div>
    <div class="settings-row" style="cursor:pointer;" id="sync-signout">
      <span data-i18n="sync.sign_out"></span></div>
    <div class="settings-row" style="cursor:pointer;" id="sync-delete">
      <span style="color:var(--danger);" data-i18n="sync.delete_account"></span></div>`;
}

/** Карточка уровня доступа — единственная точка входа в оплату из настроек. */
function subscriptionCard(tier) {
  const isPaid = tier !== TIER.FREE;
  const nameKey = tier === TIER.PRO ? 'pay.plan.pro' : 'pay.plan.free';
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

function themeSwatch(id, styleLocked) {
  const theme = THEMES[id];
  // Замочек на платных темах — честное предупреждение до нажатия,
  // а не сюрприз после. У Про замочков нет.
  const locked = styleLocked && !isFreeTheme(id);
  return `
    <button class="theme-swatch ${AppState.theme === id ? 'active' : ''}"
            data-theme="${id}"
            style="background:${theme.background};color:${theme.accent};border-color:${AppState.theme === id ? theme.accent : 'transparent'}"
            aria-label="${t('theme.' + id)}">${locked ? '<span class="swatch-lock">🔒</span>' : '●'}</button>`;
}

/**
 * Сэмпл цвета проекции: сплошной кружок самого цвета, без подписи под ним.
 * Название остаётся аудио-названием кнопки (aria-label) — его не видно
 * глазами, но экранный диктор его произнесёт.
 */
function hudColorSwatch(id, active, styleLocked) {
  const locked = styleLocked && id !== HUD_DEFAULT_COLOR;
  return `
    <button class="theme-swatch ${active ? 'active' : ''}"
            data-hud-color="${id}"
            style="background:${HUD_COLORS[id].hex}"
            aria-label="${t('hud.color.' + id)}">${locked ? '<span class="swatch-lock">🔒</span>' : ''}</button>`;
}

/**
 * Сэмпл начертания: кнопка сама показывает цифру этим шрифтом — форму видно
 * сразу, а не после чтения названия, которое всё равно ничего не объясняет
 * про то, как это будет выглядеть на стекле.
 */
function hudFontSwatch(id, active, styleLocked) {
  const locked = styleLocked && id !== HUD_DEFAULT_FONT;
  const inner = locked ? '<span class="swatch-lock">🔒</span>' : '<span class="hud-digits" data-font-sample></span>';
  return `
    <button class="hud-font-swatch hud-font-${id} ${active ? 'active' : ''}"
            data-hud-font="${id}"
            aria-label="${t('hud.font.' + id)}">${inner}</button>`;
}

function bind(body) {
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
    // Платная тема без Про открывает экран покупки, а не применяется молча.
    if (!isFreeTheme(btn.dataset.theme) && !(await hasFeature('themes'))) {
      openPaywall({ reason: 'pay.reason_themes', onDone: refresh });
      return;
    }
    await setThemeId(btn.dataset.theme);
    document.dispatchEvent(new CustomEvent('theme-changed'));
    refreshKeepingScroll();
  }));

  const preview = body.querySelector('#hud-preview');
  // 88 — не случайное число: на сегментном начертании горят все палочки
  // сразу, и сразу видно и цвет, и «призрак восьмёрки».
  const previewValue = body.querySelector('#hud-preview-value');
  applyDigits(previewValue, '88', preview?.dataset.font);

  // Сэмплы шрифтов — живые образцы, а не подписи: цифру собирает тот же
  // код, что рисует её на самом стекле, иначе можно было бы описать шрифт
  // словами и забыть отрисовать его здесь по-настоящему.
  body.querySelectorAll('[data-hud-font] [data-font-sample]').forEach(span => {
    const id = span.closest('[data-hud-font]').dataset.hudFont;
    applyDigits(span, '8', id);
  });

  body.querySelectorAll('[data-hud-color]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.hudColor;
    if (id !== HUD_DEFAULT_COLOR && id !== HUD_COLOR_AUTO && !(await hasFeature('hud_style'))) {
      openPaywall({ reason: 'pay.reason_hud', onDone: refresh });
      return;
    }
    // Образец и отметка выбора меняются сразу, запись в базу — следом.
    // Перерисовывать весь экран настроек ради двух свойств незачем: это
    // и медленнее, и сбивает прокрутку.
    preview?.style.setProperty('--hud-color', HUD_COLORS[id].hex);
    body.querySelectorAll('[data-hud-color]').forEach(c => c.classList.toggle('active', c === btn));
    await setHudStyle({ color: id });
  }));

  body.querySelectorAll('[data-hud-font]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.hudFont;
    if (id !== HUD_DEFAULT_FONT && !(await hasFeature('hud_style'))) {
      openPaywall({ reason: 'pay.reason_hud', onDone: refresh });
      return;
    }
    if (preview) {
      Object.keys(HUD_FONTS).forEach(f => preview.classList.remove('hud-font-' + f));
      preview.classList.add('hud-font-' + id);
      preview.dataset.font = id;
      // Сегментное начертание — не шрифт, а рисунок, поэтому цифры образца
      // надо пересобрать: сменой класса тут не обойтись.
      applyDigits(previewValue, '88', id);
    }
    body.querySelectorAll('[data-hud-font]').forEach(c => c.classList.toggle('active', c === btn));
    await setHudStyle({ font: id });
  }));

  body.querySelector('#set-lang').addEventListener('change', async (e) => {
    // Словарь может не загрузиться (нет сети при первом выборе языка) —
    // тогда язык не меняется, и список возвращается к прежнему значению,
    // а не показывает выбранным то, чего на экране нет.
    const ok = await setLanguage(e.target.value);
    if (!ok) { e.target.value = AppState.lang; toast(t('settings.lang_failed')); return; }
    document.dispatchEvent(new CustomEvent('lang-changed'));
  });

  body.querySelector('#set-region').addEventListener('change', async (e) => {
    await setRegion(e.target.value);
    refreshKeepingScroll();
  });

  body.querySelectorAll('[data-units]').forEach(btn => btn.addEventListener('click', async () => {
    await setUnits(btn.dataset.units);
    refreshKeepingScroll();
  }));

  body.querySelector('#set-currency').addEventListener('change', async (e) => {
    await setCurrency(e.target.value);
    refreshKeepingScroll();
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

  // Разрешение на датчик спрашивается ЗДЕСЬ, а не при открытии проекции:
  // на iOS запрос обязан идти прямо из касания, а проекция открывается
  // асинхронно — к тому моменту жест уже не считается, и запрос пропал бы
  // молча, причём второй раз его не покажут.
  body.querySelector('#set-ad-mode')?.addEventListener('click', async () => {
    // Модуль подтягивается по нажатию: рекламный режим открывают редко, и
    // возить его в общем бандле ради этого незачем.
    const { openAd } = await import('../adMode.js');
    await openAd();
  });

  body.querySelector('#set-auto-track')?.addEventListener('change', async (e) => {
    await setSetting(AUTO_TRACK_KEY, e.target.checked);
  });

  body.querySelector('#set-hud-motion')?.addEventListener('change', async (e) => {
    if (!e.target.checked) {
      await setSetting(MOTION_KEY, false);
      refreshKeepingScroll();
      return;
    }
    const granted = await requestMotionAccess();
    await setSetting(MOTION_KEY, granted);
    if (!granted) {
      e.target.checked = false;
      toast(t('hud.motion_denied'));
    }
    refreshKeepingScroll();
  });

  body.querySelector('#set-road').addEventListener('change', async (e) => {
    await setRoadEnabled(e.target.checked);
    refreshKeepingScroll();
  });
  body.querySelector('#set-road-clear')?.addEventListener('click', async () => {
    await clearRoadCache();
    toast(t('settings.road_cleared'));
    refreshKeepingScroll();
  });

  body.querySelector('#set-pool')?.addEventListener('change', async (e) => {
    await setPoolEnabled(e.target.checked);
    refreshKeepingScroll();
  });
  body.querySelector('#set-signals')?.addEventListener('click', openSignals);
  body.querySelector('#set-export').addEventListener('click', async () => {
    // Экспорт — платная возможность: это главный премиум-крючок всей ниши.
    // В тестовом режиме открыт всем, чтобы его можно было пощупать.
    if (!(await hasFeature('export'))) {
      openPaywall({ reason: 'pay.reason_export', onDone: refresh });
      return;
    }
    openExportDialog();
  });

  bindSync(body);

  body.querySelector('#set-share').addEventListener('click', openShare);
  getReferralCode().then(code => {
    const el = body.querySelector('#set-share-code');
    if (el) el.textContent = code;
  });

  body.querySelector('#set-wipe').addEventListener('click', confirmWipe);
}

// --- Экспорт данных ------------------------------------------------------

/** Название категории: расходной, доходной или как есть. */
function categoryName(code) {
  for (const key of ['expense.' + code, 'income.' + code]) {
    if (t(key) !== key) return t(key);
  }
  return code;
}

function downloadFile(name, text, type) {
  // BOM — только у CSV и только тут: без него Excel читает UTF-8 «кракозябрами».
  const blob = new Blob([type === 'text/csv' ? '\ufeff' + text : text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function openExportDialog() {
  const vehicle = await getPrimaryVehicle();
  if (!vehicle) { toast(t('export.no_vehicle')); return; }

  let period = 'all';   // 'all' | 'year' | 'month'
  const fromOf = () => period === 'all' ? 0
    : Date.now() - (period === 'year' ? 365 : 30) * 864e5;

  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="export.title"></h2><button class="modal-close">✕</button></div>
    <div class="field"><span class="field-label" data-i18n="export.period"></span>
      <div class="chip-row" id="exp-period">
        <button class="chip active" data-p="all" data-i18n="export.period_all"></button>
        <button class="chip" data-p="year" data-i18n="export.period_year"></button>
        <button class="chip" data-p="month" data-i18n="export.period_month"></button>
      </div>
    </div>
    <button class="btn primary block" id="exp-csv" data-i18n="export.csv"></button>
    <button class="btn block" id="exp-print" style="margin-top:8px;" data-i18n="export.print"></button>
    <div class="muted" style="font-size:12px;margin-top:10px;" data-i18n="export.print_hint"></div>
  `, {
    onMount: (root) => {
      root.querySelector('.modal-close').addEventListener('click', closeModal);
      root.querySelector('#exp-period').addEventListener('click', (e) => {
        const btn = e.target.closest('.chip'); if (!btn) return;
        root.querySelectorAll('#exp-period .chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active'); period = btn.dataset.p;
      });

      const loadData = async () => {
        const [refuels, expenses, incomes, trips, maintenance] = await Promise.all([
          DB.getAllByIndex('refuels', 'vehicleId', vehicle.id),
          DB.getAllByIndex('expenses', 'vehicleId', vehicle.id),
          DB.getAllByIndex('incomes', 'vehicleId', vehicle.id),
          DB.getAllByIndex('trips', 'vehicleId', vehicle.id),
          DB.getAllByIndex('maintenanceItems', 'vehicleId', vehicle.id),
        ]);
        return { refuels, expenses, incomes, trips, maintenance };
      };

      root.querySelector('#exp-csv').addEventListener('click', async () => {
        const { buildCsvBundle } = await import('../exportData.js');
        const data = await loadData();
        const files = buildCsvBundle(data, {
          lang: getLang(), fromMs: fromOf(),
          categoryName, modeName: (m) => t('mode.' + m) !== 'mode.' + m ? t('mode.' + m) : m,
        });
        if (files.length === 0) { toast(t('export.empty')); return; }
        // Пауза между скачиваниями: браузер молча роняет мгновенную очередь.
        for (const file of files) {
          downloadFile(file.name, file.csv, 'text/csv');
          await new Promise(r => setTimeout(r, 300));
        }
        toast(t('export.done', { n: files.length }));
      });

      root.querySelector('#exp-print').addEventListener('click', async () => {
        const { reportHtml } = await import('../exportData.js');
        const data = await loadData();
        const html = reportHtml({
          vehicleName: vehicle.displayName || vehicle.name || '',
          ...data, fromMs: fromOf(), lang: getLang(),
          categoryName, currency: AppState.currency === 'USD' ? '$' : '₽',
        });
        const win = window.open('', '_blank');
        if (!win) { toast(t('export.popup_blocked')); return; }
        win.document.write(html);
        win.document.close();
        // Печать после отрисовки: сразу вызванный print застаёт пустую страницу.
        setTimeout(() => win.print(), 400);
      });
    }
  });
  applyI18nTree(overlay);
}

// --- Аккаунт в один клик -------------------------------------------------

/**
 * Завести аккаунт: код придумывается здесь, на устройстве, и он же служит
 * и логином (через производную), и паролем. Человеку не нужно вводить
 * ничего — но код обязан быть показан сразу: восстановить его нам нечем.
 */
async function createQuickAccount(button) {
  const code = generateSecret();
  if (button) {
    button.disabled = true;
    // Растяжение ключа занимает около секунды — без подписи кажется,
    // что кнопка не сработала.
    button.textContent = t('sync.working');
  }
  try {
    await Sync.register(await loginFor(code), normalizeSecret(code), deviceLabel(),
      { referralCode: await getLocalCode(), invitedBy: await getInvitedBy() });
    await rememberSecret(code);
    refresh();
    showRecoveryCode(code, { firstTime: true });
    return true;
  } catch (err) {
    toast(syncErrorText(err?.code));
    return false;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = t('quick.create');
    }
  }
}

function showRecoveryCode(code, { firstTime }) {
  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="${firstTime ? 'quick.created_title' : 'quick.code_title'}"></h2>
      <button class="modal-close">✕</button></div>
    <div class="muted" style="font-size:13px;margin-bottom:12px;" data-i18n="quick.code_why"></div>
    <div class="quick-code" id="quick-code">${escapeHtml(formatSecret(code))}</div>
    <button class="btn primary block" id="quick-copy" data-i18n="quick.copy"></button>
    <div class="muted" style="font-size:12px;margin-top:10px;" data-i18n="quick.code_warning"></div>
  `, {
    onMount: (root) => {
      root.querySelector('.modal-close').addEventListener('click', closeModal);
      root.querySelector('#quick-copy').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(formatSecret(code));
          toast(t('quick.copied'));
        } catch {
          // Буфер обмена доступен не везде (старый Safari, небезопасный
          // контекст) — тогда просто выделяем код, чтобы скопировать вручную.
          const node = root.querySelector('#quick-code');
          const range = document.createRange();
          range.selectNodeContents(node);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          toast(t('quick.copy_manual'));
        }
      });
    }
  });
  applyI18nTree(overlay);
}

function openRestoreForm() {
  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="quick.restore_title"></h2><button class="modal-close">✕</button></div>
    <label class="field"><span class="field-label" data-i18n="quick.code_field"></span>
      <input id="quick-in" autocapitalize="characters" autocomplete="off" spellcheck="false"
             placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"></label>
    <div class="muted" id="quick-error" style="color:var(--danger);font-size:13px;min-height:18px;"></div>
    <button class="btn primary block" id="quick-go" data-i18n="quick.restore_submit"></button>
  `, {
    onMount: (root) => {
      const error = root.querySelector('#quick-error');
      const button = root.querySelector('#quick-go');
      root.querySelector('.modal-close').addEventListener('click', closeModal);

      button.addEventListener('click', async () => {
        const code = root.querySelector('#quick-in').value;
        if (!isValidSecret(code)) return (error.textContent = t('quick.bad_code'));

        error.textContent = '';
        button.disabled = true;
        button.textContent = t('sync.working');
        try {
          await Sync.login(await loginFor(code), normalizeSecret(code), deviceLabel());
          await rememberSecret(code);
          closeModal();
          toast(t('sync.running'));
          refresh();
        } catch (err) {
          error.textContent = syncErrorText(err?.code);
        } finally {
          button.disabled = false;
          button.textContent = t('quick.restore_submit');
        }
      });
    }
  });
  applyI18nTree(overlay);
}

/**
 * Привязка почты к кодовому аккаунту.
 *
 * Почта вводится дважды: подтверждения письмом нет (осознанно — писем мы не
 * шлём вовсе), и опечатка иначе всплывёт только при попытке входа с другого
 * устройства, когда исправить её будет уже нечем.
 */
function openAttachEmailForm() {
  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="quick.attach_email"></h2><button class="modal-close">✕</button></div>
    <div class="muted" style="font-size:13px;margin-bottom:12px;" data-i18n="quick.attach_why"></div>
    <label class="field"><span class="field-label" data-i18n="sync.login"></span>
      <input id="ae-email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false"></label>
    <label class="field"><span class="field-label" data-i18n="quick.email_repeat"></span>
      <input id="ae-email2" type="email" autocapitalize="none" spellcheck="false"></label>
    <label class="field"><span class="field-label" data-i18n="sync.password"></span>
      <input id="ae-pass" type="password" autocomplete="new-password"></label>
    <label class="field"><span class="field-label" data-i18n="sync.password_repeat"></span>
      <input id="ae-pass2" type="password" autocomplete="new-password"></label>
    <div class="muted" style="font-size:12px;margin:6px 0;" data-i18n="quick.attach_code_note"></div>
    <div class="muted" id="ae-error" style="color:var(--danger);font-size:13px;min-height:18px;"></div>
    <button class="btn primary block" id="ae-go" data-i18n="quick.attach_submit"></button>
  `, {
    onMount: (root) => {
      const error = root.querySelector('#ae-error');
      const button = root.querySelector('#ae-go');
      root.querySelector('.modal-close').addEventListener('click', closeModal);

      button.addEventListener('click', async () => {
        const email = root.querySelector('#ae-email').value.trim().toLowerCase();
        const email2 = root.querySelector('#ae-email2').value.trim().toLowerCase();
        const pass = root.querySelector('#ae-pass').value;
        const pass2 = root.querySelector('#ae-pass2').value;

        if (!email.includes('@') || email.length < 5) return (error.textContent = t('sync.login_short'));
        if (email !== email2) return (error.textContent = t('quick.email_mismatch'));
        if (pass.length < 8) return (error.textContent = t('sync.password_short'));
        if (pass !== pass2) return (error.textContent = t('sync.password_mismatch'));

        error.textContent = '';
        button.disabled = true;
        button.textContent = t('sync.working');
        try {
          await Sync.attachEmail(email, pass);
          // Код с этого момента для входа не годится: логин сменился.
          await forgetSecret();
          closeModal();
          toast(t('quick.attach_done'));
          refresh();
        } catch (err) {
          error.textContent = syncErrorText(err?.code);
        } finally {
          button.disabled = false;
          button.textContent = t('quick.attach_submit');
        }
      });
    }
  });
  applyI18nTree(overlay);
}

// --- Синхронизация ---

function syncErrorText(code) {
  const key = 'sync.err.' + code;
  const text = t(key);
  return text === key ? t('sync.err.unknown') : text;
}

function bindSync(body) {
  body.querySelector('#sync-quick')?.addEventListener('click', (e) => {
    createQuickAccount(e.currentTarget);
  });
  body.querySelector('#sync-restore')?.addEventListener('click', openRestoreForm);
  body.querySelector('#sync-attach-email')?.addEventListener('click', openAttachEmailForm);
  body.querySelector('#sync-show-code')?.addEventListener('click', async () => {
    const code = await savedSecret();
    if (code) showRecoveryCode(code, { firstTime: false });
    else toast(t('quick.no_code'));
  });

  body.querySelector('#sync-signin')?.addEventListener('click', async () => {
    // Синхронизация — платная возможность. В тестовом режиме доступ открыт
    // всем, чтобы её можно было пощупать до появления настоящих покупок.
    if (!(await hasFeature('sync'))) {
      openPaywall({ reason: 'pay.reason_sync', onDone: refresh });
      return;
    }
    openSyncAuth();
  });

  body.querySelector('#sync-now')?.addEventListener('click', async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    button.textContent = t('sync.running');
    try {
      const { received, sent } = await Sync.syncNow();
      toast(t('sync.done_counts', { received, sent }));
    } catch (err) {
      toast(syncErrorText(err?.code));
    } finally {
      refreshKeepingScroll();
    }
  });

  body.querySelector('#sync-password')?.addEventListener('click', openPasswordChange);
  body.querySelector('#sync-signout')?.addEventListener('click', confirmSignOut);
  body.querySelector('#sync-delete')?.addEventListener('click', confirmDeleteAccount);
}

/**
 * Вход и регистрация.
 *
 * Про невосстановимость пароля сказано прямо в окне, а не спрятано в справке:
 * это единственное необратимое следствие того, что сервер не знает ключа,
 * и человек должен встретить его до того, как доверит данные, а не после.
 */
function openSyncAuth() {
  let mode = 'in';

  const overlay = openModal(`
    <div class="modal-header"><h2 id="sync-title" data-i18n="sync.title_in"></h2><button class="modal-close">✕</button></div>
    <div class="chip-row" style="margin-bottom:14px;">
      <button class="chip active" data-mode="in" data-i18n="sync.tab_in"></button>
      <button class="chip" data-mode="up" data-i18n="sync.tab_up"></button>
    </div>
    <label class="field"><span class="field-label" data-i18n="sync.login"></span>
      <input id="sync-in-login" type="email" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
    <label class="field"><span class="field-label" data-i18n="sync.password"></span>
      <input id="sync-in-pass" type="password" autocomplete="current-password"></label>
    <label class="field" id="sync-repeat-field" hidden><span class="field-label" data-i18n="sync.password_repeat"></span>
      <input id="sync-in-pass2" type="password" autocomplete="new-password"></label>
    <div class="muted" style="font-size:12px;margin:10px 0;" data-i18n="sync.encryption_note"></div>
    <div class="muted" id="sync-in-error" style="color:var(--danger);font-size:13px;min-height:18px;"></div>
    <button class="btn primary block" id="sync-in-go" data-i18n="sync.submit_in"></button>
  `, {
    onMount: (root) => {
      const error = root.querySelector('#sync-in-error');
      const button = root.querySelector('#sync-in-go');
      const repeat = root.querySelector('#sync-repeat-field');

      root.querySelector('.modal-close').addEventListener('click', closeModal);

      root.querySelectorAll('[data-mode]').forEach(chip => chip.addEventListener('click', () => {
        mode = chip.dataset.mode;
        root.querySelectorAll('[data-mode]').forEach(c => c.classList.toggle('active', c === chip));
        repeat.hidden = mode !== 'up';
        root.querySelector('#sync-title').textContent = t(mode === 'up' ? 'sync.title_up' : 'sync.title_in');
        button.textContent = t(mode === 'up' ? 'sync.submit_up' : 'sync.submit_in');
        root.querySelector('#sync-in-pass').setAttribute(
          'autocomplete', mode === 'up' ? 'new-password' : 'current-password');
        error.textContent = '';
      }));

      button.addEventListener('click', async () => {
        const login = root.querySelector('#sync-in-login').value.trim();
        const password = root.querySelector('#sync-in-pass').value;
        const repeated = root.querySelector('#sync-in-pass2').value;

        if (login.length < 3) return (error.textContent = t('sync.login_short'));
        if (password.length < 8) return (error.textContent = t('sync.password_short'));
        if (mode === 'up' && password !== repeated) return (error.textContent = t('sync.password_mismatch'));

        error.textContent = '';
        button.disabled = true;
        // Растяжение пароля занимает около секунды: без подписи кажется,
        // что кнопка не сработала, и на неё жмут второй раз.
        button.textContent = t('sync.working');
        try {
          if (mode === 'up') {
            await Sync.register(login, password, deviceLabel(),
              { referralCode: await getLocalCode(), invitedBy: await getInvitedBy() });
          }
          else await Sync.login(login, password, deviceLabel());

          closeModal();
          toast(t('sync.running'));
          await syncQuietly();
          startAutoSync();
          toast(t('sync.done'));
        } catch (err) {
          error.textContent = syncErrorText(err?.code);
        } finally {
          button.disabled = false;
          button.textContent = t(mode === 'up' ? 'sync.submit_up' : 'sync.submit_in');
          refresh();
        }
      });
    }
  });
  applyI18nTree(overlay);
}

function openPasswordChange() {
  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="sync.change_password"></h2><button class="modal-close">✕</button></div>
    <label class="field"><span class="field-label" data-i18n="sync.new_password"></span>
      <input id="pw-new" type="password" autocomplete="new-password"></label>
    <label class="field"><span class="field-label" data-i18n="sync.password_repeat"></span>
      <input id="pw-new2" type="password" autocomplete="new-password"></label>
    <div class="muted" id="pw-error" style="color:var(--danger);font-size:13px;min-height:18px;"></div>
    <button class="btn primary block" id="pw-go" data-i18n="common.save"></button>
  `, {
    onMount: (root) => {
      root.querySelector('.modal-close').addEventListener('click', closeModal);
      root.querySelector('#pw-go').addEventListener('click', async (e) => {
        const error = root.querySelector('#pw-error');
        const password = root.querySelector('#pw-new').value;
        if (password.length < 8) return (error.textContent = t('sync.password_short'));
        if (password !== root.querySelector('#pw-new2').value) {
          return (error.textContent = t('sync.password_mismatch'));
        }
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = t('sync.working');
        try {
          await Sync.changePassword(password);
          closeModal();
          toast(t('sync.password_changed'));
        } catch (err) {
          error.textContent = syncErrorText(err?.code);
          e.currentTarget.disabled = false;
          e.currentTarget.textContent = t('common.save');
        }
      });
    }
  });
  applyI18nTree(overlay);
}

function confirmSignOut() {
  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="sync.sign_out"></h2><button class="modal-close">✕</button></div>
    <p data-i18n="sync.sign_out_warning"></p>
    <div class="row" style="gap:10px;margin-top:14px;">
      <button class="btn block" id="so-cancel" data-i18n="common.cancel"></button>
      <button class="btn primary" id="so-go" data-i18n="sync.sign_out"></button>
    </div>
  `, {
    onMount: (root) => {
      root.querySelector('.modal-close').addEventListener('click', closeModal);
      root.querySelector('#so-cancel').addEventListener('click', closeModal);
      root.querySelector('#so-go').addEventListener('click', async () => {
        stopAutoSync();
        await Sync.logout();
        closeModal();
        refresh();
      });
    }
  });
  applyI18nTree(overlay);
}

function confirmDeleteAccount() {
  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="sync.delete_account"></h2><button class="modal-close">✕</button></div>
    <p data-i18n="sync.delete_warning"></p>
    <div class="row" style="gap:10px;margin-top:14px;">
      <button class="btn block" id="da-cancel" data-i18n="common.cancel"></button>
      <button class="btn danger" id="da-go" data-i18n="settings.wipe_confirm"></button>
    </div>
  `, {
    onMount: (root) => {
      root.querySelector('.modal-close').addEventListener('click', closeModal);
      root.querySelector('#da-cancel').addEventListener('click', closeModal);
      root.querySelector('#da-go').addEventListener('click', async () => {
        try {
          stopAutoSync();
          await Sync.deleteAccount();
          toast(t('sync.account_deleted'));
        } catch (err) {
          toast(syncErrorText(err?.code));
        }
        closeModal();
        refresh();
      });
    }
  });
  applyI18nTree(overlay);
}

/**
 * Приглашение друга. QR рисуется на устройстве: обращение к внешнему
 * генератору выдало бы наружу и ссылку, и IP — ровно то, чего приложение
 * не делает нигде больше.
 */
async function openShare() {
  const [code, url, invitedBy, sync] = await Promise.all([
    getReferralCode(), getShareUrl(), getInvitedBy(), Sync.status(),
  ]);

  const locale = AppState.lang === 'en' ? 'en-GB' : 'ru-RU';
  const proUntil = sync.proUntil && new Date(sync.proUntil) > new Date()
    ? new Date(sync.proUntil).toLocaleDateString(locale)
    : null;

  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="share.title"></h2><button class="modal-close">✕</button></div>
    <div class="share-qr">${qrSvg(url, { size: 232, dark: '#000', light: '#fff' })}</div>
    <div class="muted" style="text-align:center;font-size:12px;" data-i18n="share.scan_hint"></div>
    <div class="share-code-box">
      <div class="muted" style="font-size:12px;" data-i18n="share.your_code"></div>
      <div class="share-code">${code}</div>
    </div>
    <input class="share-link" id="share-link" readonly value="${url}">
    <div class="row" style="gap:10px;margin-top:12px;">
      <button class="btn block" id="share-copy" data-i18n="share.copy"></button>
      ${navigator.share ? `<button class="btn primary" id="share-send" data-i18n="share.send"></button>` : ''}
    </div>

    <div class="card" style="margin-top:16px;">
      <div class="muted" style="font-size:13px;">${t('share.reward', { days: sync.rewardDays })}</div>
      ${sync.inviteeRewardDays > 0 ? `<div class="muted" style="font-size:13px;padding-top:4px;">${t('share.reward_friend', { days: sync.inviteeRewardDays })}</div>` : ''}
      ${sync.signedIn ? `
        <div class="settings-row" style="margin-top:8px;">
          <span data-i18n="share.invited_count"></span><b>${sync.invitedCount}</b></div>
        ${proUntil ? `<div class="settings-row">
          <span data-i18n="share.pro_until"></span><b>${escapeHtml(proUntil)}</b></div>` : ''}
      ` : `<div class="muted" style="font-size:12px;margin-top:8px;color:var(--danger);"
             data-i18n="share.need_account"></div>`}
    </div>

    ${invitedBy ? `<div class="muted" style="font-size:12px;margin-top:14px;">
      <span data-i18n="share.invited_by"></span>: <b>${escapeHtml(invitedBy)}</b>
    </div>` : ''}
    <div class="muted" style="font-size:12px;margin-top:10px;padding-top:10px;border-top:1px solid var(--separator);"
         data-i18n="share.counting_note"></div>
  `, {
    onMount: (root) => {
      root.querySelector('.modal-close').addEventListener('click', closeModal);

      root.querySelector('#share-copy').addEventListener('click', async () => {
        const field = root.querySelector('#share-link');
        try {
          await navigator.clipboard.writeText(url);
          toast(t('share.copied'));
        } catch {
          // Без https или с закрытым доступом к буферу — выделяем текст,
          // чтобы скопировать вручную было одним движением.
          field.focus();
          field.select();
          toast(t('share.copy_failed'));
        }
      });

      root.querySelector('#share-send')?.addEventListener('click', async () => {
        try {
          await navigator.share({ title: t('app.name'), text: t('share.message'), url });
        } catch { /* человек передумал в системном окне — это не ошибка */ }
      });
    }
  });
  applyI18nTree(overlay);
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
