/**
 * Подключение к машине через установленную сигнализацию.
 *
 * Работают две системы: Pandora (вход логином от кабинета p-on.ru) и
 * StarLine (официальное API, наше приложение зарегистрировано). Штатные
 * приложения новых машин — Haval, Chery, Geely, Lada и прочих — сторонним
 * программам закрыты, и экран говорит об этом прямо, а не показывает
 * кнопки, которые никуда не ведут.
 *
 * Что где хранится. Пароль — нигде: он уходит один раз, чтобы получить ключ
 * доступа (у Pandora — токен, у StarLine — cookie на сутки). На устройстве
 * остаётся только этот ключ и список машин, в локальных настройках, которые
 * не синхронизируются. Запросы идут через наш сервер: обе системы не
 * принимают обращения прямо со страниц сайтов, а у StarLine вдобавок есть
 * секрет приложения, которому в браузере не место.
 *
 * Различия двух систем живут в carProviders.js — здесь только окно.
 */
import { getSetting, setSetting } from './db.js';
import { t } from './i18n.js';
import { openModal, closeModal, toast, escapeHtml } from './ui.js';
import { syncOrigin } from './syncClient.js';
import {
  PROVIDERS, PROVIDER_ORDER, providerOf, commandsFor, needsConfirm,
  summarizeFor, migrateStore, deviceLabel,
} from './carProviders.js';

const STORE_KEY = 'carlink.connection';
/** Запись, оставшаяся с тех пор, когда система была одна. */
const LEGACY_KEY = 'carlink.pandora';
const REQUEST_TIMEOUT_MS = 30_000;
/** Сколько ждать второго нажатия на «снять с охраны» и «завести». */
const CONFIRM_WINDOW_MS = 4_000;

const COMMAND_LABELS = {
  lock: 'carlink.cmd_lock',
  unlock: 'carlink.cmd_unlock',
  start: 'carlink.cmd_start',
  stop: 'carlink.cmd_stop',
  trunk: 'carlink.cmd_trunk',
  trunk_disarm: 'carlink.cmd_trunk_disarm',
  heater_on: 'carlink.cmd_heater_on',
  heater_off: 'carlink.cmd_heater_off',
  horn: 'carlink.cmd_horn',
  light: 'carlink.cmd_light',
  locate: 'carlink.cmd_locate',
};

const ERROR_LABELS = {
  not_configured: 'carlink.err_not_configured',
  bad_credentials: 'carlink.err_credentials',
  session_expired: 'carlink.err_session',
  rejected: 'carlink.err_rejected',
  unavailable: 'carlink.err_unavailable',
  too_many_attempts: 'carlink.err_too_many',
  network: 'carlink.err_network',
};

/** Честная приписка про каждую систему: одна официальная, другая нет. */
const NOTE_KEYS = { pandora: 'carlink.note_pandora', starline: 'carlink.note_starline' };

function errorText(err) {
  const key = ERROR_LABELS[err?.code] || 'carlink.err_unavailable';
  return t(key, { detail: err?.detail || '' });
}

async function relay(path, action, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${syncOrigin()}/api/car/${path}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw Object.assign(new Error('network'), { code: 'network' });
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error || 'unavailable'), {
      code: data.error || 'unavailable', detail: data.detail || '',
    });
  }
  return data;
}

async function loadStore() {
  const current = migrateStore(await getSetting(STORE_KEY, null));
  if (current) return current;
  // Подключение, сделанное до появления второй системы, переносим молча:
  // заставлять человека входить заново незачем.
  const legacy = migrateStore(await getSetting(LEGACY_KEY, null));
  if (legacy) {
    await setSetting(STORE_KEY, legacy);
    await setSetting(LEGACY_KEY, null);
    return legacy;
  }
  return null;
}

const saveStore = (value) => setSetting(STORE_KEY, value);

export async function openCarConnect() {
  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="carlink.title"></h2><button class="modal-close">✕</button></div>
    <div id="car-body"></div>`, {
    onClose: () => stopPolling(overlay),
  });
  overlay.querySelector('.modal-close').addEventListener('click', closeModal);
  const store = await loadStore();
  if (store?.token) renderCar(overlay, store);
  else renderLogin(overlay, PROVIDER_ORDER[0]);
}

function stopPolling(overlay) {
  if (overlay._carPoll) clearInterval(overlay._carPoll);
  overlay._carPoll = null;
}

/**
 * Экран входа.
 *
 * step — что система попросила дополнительно:
 *   null                              — обычный вход;
 *   {needs:'sms', phone}              — код из сообщения (двухфакторный вход);
 *   {needs:'captcha', captchaSid, captchaImg} — код с картинки.
 */
function renderLogin(overlay, providerId, step = null, prefill = null) {
  stopPolling(overlay);
  const provider = providerOf(providerId) || PROVIDERS[PROVIDER_ORDER[0]];
  const body = overlay.querySelector('#car-body');

  body.innerHTML = `
    <div class="muted" style="font-size:13px;margin-bottom:12px;">${escapeHtml(t('carlink.intro'))}</div>
    <div class="row" style="gap:8px;margin-bottom:12px;">
      ${PROVIDER_ORDER.map(id => `
        <button class="chip${id === provider.id ? ' active' : ''}" data-car-provider="${id}">${escapeHtml(PROVIDERS[id].title)}</button>`).join('')}
    </div>
    <form id="car-login">
      <label class="field"><span class="field-label">${escapeHtml(t('carlink.login_for', { system: provider.title }))}</span>
        <input name="login" autocomplete="off" autocapitalize="off" spellcheck="false" required maxlength="200"
               value="${escapeHtml(prefill?.login || '')}"></label>
      <label class="field"><span class="field-label">${escapeHtml(t('carlink.password_for', { system: provider.title }))}</span>
        <input name="password" type="password" autocomplete="off" required maxlength="200"></label>
      ${step?.needs === 'sms' ? `
      <div class="muted" style="font-size:12px;margin-bottom:6px;">${escapeHtml(t('carlink.sms_hint', { phone: step.phone || '' }))}</div>
      <label class="field"><span class="field-label">${escapeHtml(t('carlink.sms_code'))}</span>
        <input name="smsCode" inputmode="numeric" autocomplete="off" maxlength="10"></label>` : ''}
      ${step?.needs === 'captcha' ? `
      <div class="muted" style="font-size:12px;margin-bottom:6px;">${escapeHtml(t('carlink.captcha_hint'))}</div>
      ${step.captchaImg ? `<img src="${escapeHtml(step.captchaImg)}" alt="" style="max-width:100%;border-radius:8px;margin-bottom:6px;">` : ''}
      <label class="field"><span class="field-label">${escapeHtml(t('carlink.captcha_code'))}</span>
        <input name="captchaCode" autocomplete="off" maxlength="20"></label>` : ''}
      <button class="btn primary block" type="submit">${escapeHtml(t(step ? 'carlink.continue' : 'carlink.connect'))}</button>
    </form>
    <div class="muted" style="font-size:12px;padding-top:10px;">${escapeHtml(t('carlink.privacy', { system: provider.title }))}</div>
    <div class="muted" style="font-size:12px;padding-top:8px;">${escapeHtml(t(NOTE_KEYS[provider.id]))}</div>
    <div class="muted" style="font-size:12px;padding-top:8px;">${escapeHtml(t('carlink.system_oem'))}</div>`;

  body.querySelectorAll('[data-car-provider]').forEach(btn => btn.addEventListener('click', () => {
    // Смена системы сбрасывает и просьбу о коде: она относилась к прежней.
    renderLogin(overlay, btn.dataset.carProvider);
  }));

  const form = body.querySelector('#car-login');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button[type=submit]');
    const login = form.login.value.trim();
    const password = form.password.value;
    if (!login || !password) return;

    const payload = { login, password };
    if (form.smsCode?.value.trim()) payload.smsCode = form.smsCode.value.trim();
    if (form.captchaCode?.value.trim()) {
      payload.captchaCode = form.captchaCode.value.trim();
      payload.captchaSid = step?.captchaSid || '';
    }

    button.disabled = true;
    try {
      const data = await relay(provider.path, 'login', payload);
      if (data.needs) {
        // Логин подставим обратно, пароль — нет: пусть человек введёт его
        // сам, а мы не храним его между шагами дольше нужного.
        renderLogin(overlay, provider.id, data, { login });
        return;
      }
      const { token, userId, devices } = provider.fromLogin(data);
      form.password.value = '';
      const store = {
        provider: provider.id, token, userId,
        devices: devices || [],
        deviceId: devices?.[0]?.id ?? null,
      };
      await saveStore(store);
      if (!store.devices.length) toast(t('carlink.no_devices'));
      renderCar(overlay, store);
    } catch (err) {
      toast(errorText(err));
      button.disabled = false;
    }
  });
}

function renderCar(overlay, store) {
  const provider = providerOf(store.provider);
  if (!provider) { renderLogin(overlay, PROVIDER_ORDER[0]); return; }

  const body = overlay.querySelector('#car-body');
  const device = store.devices.find(d => d.id === store.deviceId) || store.devices[0] || null;
  const commands = device ? commandsFor(provider.id, device) : [];

  body.innerHTML = `
    <div class="settings-row"><span class="muted">${escapeHtml(provider.title)}</span>
      ${store.devices.length > 1 ? '' : `<b>${escapeHtml(device ? deviceLabel(device) : '')}</b>`}</div>
    ${store.devices.length > 1 ? `
    <label class="field"><span class="field-label">${escapeHtml(t('carlink.device'))}</span>
      <select id="car-device">${store.devices.map(d => `
        <option value="${d.id}"${device && d.id === device.id ? ' selected' : ''}>${escapeHtml(deviceLabel(d))}</option>`).join('')}
      </select></label>` : ''}
    <div class="card" id="car-state" style="margin:10px 0;">
      <div class="muted">${escapeHtml(t('carlink.loading'))}</div>
    </div>
    <div id="car-commands" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      ${commands.map(name => `
        <button class="btn" data-car-command="${name}">${escapeHtml(t(COMMAND_LABELS[name] || name))}</button>`).join('')}
    </div>
    <div class="settings-row" style="cursor:pointer;margin-top:10px;" id="car-refresh">
      <span>${escapeHtml(t('carlink.refresh'))}</span></div>
    <div class="settings-row" style="cursor:pointer;" id="car-disconnect">
      <span style="color:var(--danger);">${escapeHtml(t('carlink.disconnect'))}</span></div>
    <div class="muted" style="font-size:12px;padding-top:8px;">${escapeHtml(t(NOTE_KEYS[provider.id]))}</div>`;

  body.querySelector('#car-device')?.addEventListener('change', async (e) => {
    store.deviceId = Number(e.target.value);
    await saveStore(store);
    renderCar(overlay, store);
  });

  body.querySelector('#car-refresh').addEventListener('click', () => refreshState(overlay, store));

  body.querySelector('#car-disconnect').addEventListener('click', async () => {
    await saveStore(null);
    toast(t('carlink.disconnected'));
    renderLogin(overlay, provider.id);
  });

  body.querySelectorAll('[data-car-command]').forEach(btn => {
    btn.addEventListener('click', () => onCommand(overlay, store, device, btn));
  });

  stopPolling(overlay);
  if (device) {
    refreshState(overlay, store);
    overlay._carPoll = setInterval(() => {
      // Окно закрыли мимо onClose или вкладка ушла в фон — не дёргаем
      // сигнализацию зря: у StarLine вдобавок дневной лимит запросов.
      if (!overlay.isConnected) { stopPolling(overlay); return; }
      if (document.visibilityState === 'visible') refreshState(overlay, store);
    }, provider.pollMs);
  }
}

async function onCommand(overlay, store, device, btn) {
  const name = btn.dataset.carCommand;
  const label = () => t(COMMAND_LABELS[name] || name);

  if (needsConfirm(store.provider, name) && btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.classList.add('primary');
    btn.textContent = t('carlink.tap_again');
    setTimeout(() => {
      if (!btn.isConnected) return;
      btn.dataset.armed = '';
      btn.classList.remove('primary');
      btn.textContent = label();
    }, CONFIRM_WINDOW_MS);
    return;
  }

  btn.dataset.armed = '';
  btn.classList.remove('primary');
  btn.textContent = label();
  btn.disabled = true;
  try {
    const provider = providerOf(store.provider);
    await relay(provider.path, 'command', { token: store.token, deviceId: device.id, command: name });
    toast(t('carlink.sent'));
    // Блок выполняет команду несколько секунд — состояние сразу после
    // отправки было бы ещё старым и выглядело бы как отказ.
    setTimeout(() => { if (overlay.isConnected) refreshState(overlay, store); }, 5_000);
  } catch (err) {
    await handleError(overlay, store, err);
  } finally {
    btn.disabled = false;
  }
}

async function handleError(overlay, store, err) {
  toast(errorText(err));
  if (err?.code === 'session_expired') {
    await saveStore(null);
    renderLogin(overlay, store.provider);
  }
}

async function refreshState(overlay, store) {
  const box = overlay.querySelector('#car-state');
  if (!box) return;
  const provider = providerOf(store.provider);
  let states;
  try {
    states = provider.indexState(await relay(provider.path, 'state', provider.stateBody(store)));
  } catch (err) {
    if (err?.code === 'session_expired') { await handleError(overlay, store, err); return; }
    box.innerHTML = `<div class="muted">${escapeHtml(errorText(err))}</div>`;
    return;
  }
  const s = summarizeFor(store.provider, states?.[String(store.deviceId)]);
  if (!overlay.isConnected || !box.isConnected) return;
  if (!s) {
    box.innerHTML = `<div class="muted">${escapeHtml(t('carlink.no_state'))}</div>`;
    return;
  }
  box.innerHTML = stateHtml(s);
}

function row(label, value, color) {
  if (value === null || value === undefined || value === '') return '';
  return `<div class="settings-row"><span>${escapeHtml(label)}</span>
    <span${color ? ` style="color:${color};font-weight:600;"` : ' class="muted"'}>${escapeHtml(String(value))}</span></div>`;
}

function stateHtml(s) {
  const b = s.bits;
  const seen = s.seenAgoSec === null ? ''
    : s.seenAgoSec < 90 ? t('carlink.seen_now')
      : t('carlink.seen_min', { n: Math.round(s.seenAgoSec / 60) });
  const warnings = b ? [
    b.anyDoorOpen && t('carlink.door_open'),
    b.trunkOpen && t('carlink.trunk_open'),
    b.hoodOpen && t('carlink.hood_open'),
    b.alarm && t('carlink.alarm'),
  ].filter(Boolean) : [];
  const round1 = (v) => (v === null ? null : Math.round(v * 10) / 10);

  return `
    ${row(t('carlink.connection'), `${t(s.online ? 'carlink.online' : 'carlink.offline')}${seen ? ' · ' + seen : ''}`,
      s.online ? 'var(--success)' : 'var(--danger)')}
    ${b ? row(t('carlink.guard'), t(b.locked ? 'carlink.locked' : 'carlink.unlocked'), b.locked ? 'var(--success)' : 'var(--danger)') : ''}
    ${b ? row(t('carlink.engine'), t(b.engineRunning ? 'carlink.engine_on' : 'carlink.engine_off')) : ''}
    ${warnings.map(w => `<div class="settings-row"><span style="color:var(--danger);font-weight:600;">${escapeHtml(w)}</span></div>`).join('')}
    ${row(t('carlink.fuel'), s.fuelPct === null ? null : `${Math.round(s.fuelPct)} %`)}
    ${row(t('carlink.voltage'), s.voltage === null ? null : `${round1(s.voltage)} V`)}
    ${row(t('carlink.engine_temp'), s.engineTemp === null ? null : `${Math.round(s.engineTemp)} °C`)}
    ${row(t('carlink.cabin_temp'), s.cabinTemp === null ? null : `${Math.round(s.cabinTemp)} °C`)}
    ${row(t('carlink.out_temp'), s.outTemp === null ? null : `${Math.round(s.outTemp)} °C`)}
    ${row(t('carlink.mileage'), s.mileageKm === null || s.mileageKm <= 0 ? null : `${Math.round(s.mileageKm).toLocaleString()} km`)}
    ${s.hasPosition ? `<div class="settings-row"><span>${escapeHtml(t('carlink.position'))}</span>
      <a href="https://yandex.ru/maps/?pt=${s.lon},${s.lat}&z=17&l=map" target="_blank" rel="noopener noreferrer">${escapeHtml(t('carlink.open_map'))}</a></div>` : ''}`;
}
