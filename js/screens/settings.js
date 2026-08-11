import { DB, getSetting, setSetting } from '../db.js';
import {
  AppState, setThemeId, setLanguage, setCurrency, setUnits, setWeight,
  getPrimaryVehicle, getVehicles, getSevereConditions, setSevereConditions, recalcIntervals,
} from '../state.js';
import { CURRENCY_SYMBOLS } from '../format.js';
import { t } from '../i18n.js';
import { applyI18nTree, openModal, closeModal, toast, icon, restoreScroll, escapeHtml } from '../ui.js';
import { THEMES, THEME_ORDER } from '../theme.js';
import { MAP_LAYERS, getMapProvider, setMapProvider } from '../mapLayers.js';
import { currentTier, TIER, TEST_MODE, resetPurchase, hasFeature } from '../subscription.js';
import { openPaywall } from '../paywall.js';
import { getReferralCode, getShareUrl, getInvitedBy, getLocalCode } from '../referral.js';
import { qrSvg } from '../qr.js';
import { Sync, syncQuietly, startAutoSync, stopAutoSync, deviceLabel } from '../syncClient.js';
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

  const [tier, severe, vehicles, sync, road, roadTiles] = await Promise.all([
    currentTier(),
    getSevereConditions(),
    getVehicles(),
    Sync.status(),
    roadEnabled(),
    cachedTileCount(),
  ]);
  const provider = getMapProvider();

  body.innerHTML = `
    ${subscriptionCard(tier)}

    <div class="section-title" data-i18n="settings.section_look"></div>
    <div class="card">
      <div class="settings-row">
        <span data-i18n="settings.theme"></span>
      </div>
      <div class="theme-row" id="set-themes">
        ${THEME_ORDER.map(themeSwatch).join('')}
      </div>
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
      <div class="muted" style="font-size:12px;padding-top:8px;" data-i18n="settings.road_privacy"></div>
      <div class="muted" style="font-size:12px;padding-top:8px;" data-i18n="settings.road_accuracy"></div>
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
      <div class="settings-row" style="cursor:pointer;" id="sync-signin">
        <span data-i18n="sync.sign_in"></span>
        <span class="muted" data-i18n="sync.off"></span>
      </div>
      <div class="muted" style="font-size:12px;" data-i18n="sync.hint_off"></div>`;
  }

  const last = sync.lastAt
    ? new Date(sync.lastAt).toLocaleString(AppState.lang === 'en' ? 'en-GB' : 'ru-RU')
    : t('sync.never');

  return `
    <div class="settings-row"><span data-i18n="sync.account"></span>
      <span class="muted">${escapeHtml(sync.login || '')}</span></div>
    <div class="settings-row"><span data-i18n="sync.last"></span>
      <span class="muted" id="sync-last">${escapeHtml(last)}</span></div>
    ${sync.pending ? `<div class="settings-row"><span data-i18n="sync.pending"></span>
      <span class="muted">${sync.pending}</span></div>` : ''}
    <div class="row" style="gap:10px;margin-top:12px;">
      <button class="btn primary block" id="sync-now" data-i18n="sync.now"></button>
    </div>
    <div class="settings-row" style="cursor:pointer;margin-top:6px;" id="sync-password">
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

function themeSwatch(id) {
  const theme = THEMES[id];
  return `
    <button class="theme-swatch ${AppState.theme === id ? 'active' : ''}"
            data-theme="${id}"
            style="background:${theme.background};color:${theme.accent};border-color:${AppState.theme === id ? theme.accent : 'transparent'}"
            aria-label="${t('theme.' + id)}">●</button>`;
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
    await setThemeId(btn.dataset.theme);
    document.dispatchEvent(new CustomEvent('theme-changed'));
    refreshKeepingScroll();
  }));

  body.querySelectorAll('[data-lang]').forEach(btn => btn.addEventListener('click', async () => {
    await setLanguage(btn.dataset.lang);
    document.dispatchEvent(new CustomEvent('lang-changed'));
  }));

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

  body.querySelector('#set-road').addEventListener('change', async (e) => {
    await setRoadEnabled(e.target.checked);
    refreshKeepingScroll();
  });
  body.querySelector('#set-road-clear')?.addEventListener('click', async () => {
    await clearRoadCache();
    toast(t('settings.road_cleared'));
    refreshKeepingScroll();
  });

  bindSync(body);

  body.querySelector('#set-share').addEventListener('click', openShare);
  getReferralCode().then(code => {
    const el = body.querySelector('#set-share-code');
    if (el) el.textContent = code;
  });

  body.querySelector('#set-wipe').addEventListener('click', confirmWipe);
}

// --- Синхронизация ---

function syncErrorText(code) {
  const key = 'sync.err.' + code;
  const text = t(key);
  return text === key ? t('sync.err.unknown') : text;
}

function bindSync(body) {
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
