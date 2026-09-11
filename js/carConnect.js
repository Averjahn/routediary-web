/**
 * Подключение к машине через установленную сигнализацию.
 *
 * Сейчас работает одна система — Pandora: к ней можно подключиться своим
 * логином от кабинета p-on.ru, без заявки и ключа разработчика. StarLine
 * требует одобренного ключа, а штатные приложения новых машин (Haval,
 * Chery, Geely и другие) сторонним программам закрыты — экран говорит об
 * этом прямо, а не показывает кнопки, которые никуда не ведут.
 *
 * Что где хранится. Пароль — нигде: он уходит один раз, чтобы получить ключ
 * доступа. На устройстве остаётся ключ доступа и список машин — в локальных
 * настройках, которые не синхронизируются. Запросы идут через наш сервер,
 * потому что Pandora не принимает их прямо со страниц сайтов; сервер ничего
 * из этого не запоминает (см. server/pandora.js).
 */
import { getSetting, setSetting } from './db.js';
import { t } from './i18n.js';
import { openModal, closeModal, toast, escapeHtml } from './ui.js';
import { syncOrigin } from './syncClient.js';
import { summarize, availableCommands, NEEDS_CONFIRM } from './pandoraState.js';

const STORE_KEY = 'carlink.pandora';
/** Как часто обновлять состояние, пока окно открыто. Закрыто — не спрашиваем вовсе. */
const POLL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;
/** Сколько ждать второго нажатия на «снять с охраны» и «завести». */
const CONFIRM_WINDOW_MS = 4_000;

const COMMAND_LABELS = {
  lock: 'carlink.cmd_lock',
  unlock: 'carlink.cmd_unlock',
  start: 'carlink.cmd_start',
  stop: 'carlink.cmd_stop',
  trunk: 'carlink.cmd_trunk',
  heater_on: 'carlink.cmd_heater_on',
  heater_off: 'carlink.cmd_heater_off',
  horn: 'carlink.cmd_horn',
  light: 'carlink.cmd_light',
};

const ERROR_LABELS = {
  bad_credentials: 'carlink.err_credentials',
  session_expired: 'carlink.err_session',
  rejected: 'carlink.err_rejected',
  unavailable: 'carlink.err_unavailable',
  too_many_attempts: 'carlink.err_too_many',
  network: 'carlink.err_network',
};

function errorText(err) {
  const key = ERROR_LABELS[err?.code] || 'carlink.err_unavailable';
  return t(key, { detail: err?.detail || '' });
}

async function relay(action, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${syncOrigin()}/api/car/pandora/${action}`, {
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

const loadStore = () => getSetting(STORE_KEY, null);
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
  else renderLogin(overlay);
}

function stopPolling(overlay) {
  if (overlay._carPoll) clearInterval(overlay._carPoll);
  overlay._carPoll = null;
}

function renderLogin(overlay) {
  stopPolling(overlay);
  const body = overlay.querySelector('#car-body');
  body.innerHTML = `
    <div class="muted" style="font-size:13px;margin-bottom:12px;">${escapeHtml(t('carlink.intro'))}</div>
    <div class="card" style="margin-bottom:12px;">
      <div class="settings-row"><span>Pandora</span><b style="color:var(--success);">${escapeHtml(t('carlink.system_ready'))}</b></div>
      <div class="settings-row"><span>StarLine</span><span class="muted">${escapeHtml(t('carlink.system_starline'))}</span></div>
      <div class="muted" style="font-size:12px;padding-top:8px;">${escapeHtml(t('carlink.system_oem'))}</div>
    </div>
    <form id="car-login">
      <label class="field"><span class="field-label">${escapeHtml(t('carlink.login'))}</span>
        <input name="login" autocomplete="off" autocapitalize="off" spellcheck="false" required maxlength="200"></label>
      <label class="field"><span class="field-label">${escapeHtml(t('carlink.password'))}</span>
        <input name="password" type="password" autocomplete="off" required maxlength="200"></label>
      <button class="btn primary block" type="submit">${escapeHtml(t('carlink.connect'))}</button>
    </form>
    <div class="muted" style="font-size:12px;padding-top:10px;">${escapeHtml(t('carlink.privacy'))}</div>
    <div class="muted" style="font-size:12px;padding-top:8px;">${escapeHtml(t('carlink.unofficial'))}</div>`;

  const form = body.querySelector('#car-login');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button');
    const login = form.login.value.trim();
    const password = form.password.value;
    if (!login || !password) return;
    button.disabled = true;
    try {
      const { token, devices } = await relay('login', { login, password });
      // Пароль дальше этой функции не живёт: сохраняется только ключ.
      form.password.value = '';
      const store = { token, devices: devices || [], deviceId: devices?.[0]?.id ?? null };
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
  const body = overlay.querySelector('#car-body');
  const device = store.devices.find(d => d.id === store.deviceId) || store.devices[0] || null;
  const commands = device ? availableCommands(device.features) : [];

  body.innerHTML = `
    ${store.devices.length > 1 ? `
    <label class="field"><span class="field-label">${escapeHtml(t('carlink.device'))}</span>
      <select id="car-device">${store.devices.map(d => `
        <option value="${d.id}"${device && d.id === device.id ? ' selected' : ''}>${escapeHtml(d.name || d.model || String(d.id))}</option>`).join('')}
      </select></label>` : device ? `
    <div class="settings-row"><b>${escapeHtml(device.name || device.model || String(device.id))}</b>
      <span class="muted">${escapeHtml(device.model || '')}</span></div>` : ''}
    <div class="card" id="car-state" style="margin:10px 0;">
      <div class="muted">${escapeHtml(t('carlink.loading'))}</div>
    </div>
    <div id="car-commands" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      ${commands.map(name => `
        <button class="btn" data-car-command="${name}">${escapeHtml(t(COMMAND_LABELS[name]))}</button>`).join('')}
    </div>
    <div class="settings-row" style="cursor:pointer;margin-top:10px;" id="car-refresh">
      <span>${escapeHtml(t('carlink.refresh'))}</span></div>
    <div class="settings-row" style="cursor:pointer;" id="car-disconnect">
      <span style="color:var(--danger);">${escapeHtml(t('carlink.disconnect'))}</span></div>
    <div class="muted" style="font-size:12px;padding-top:8px;">${escapeHtml(t('carlink.unofficial'))}</div>`;

  body.querySelector('#car-device')?.addEventListener('change', async (e) => {
    store.deviceId = Number(e.target.value);
    await saveStore(store);
    renderCar(overlay, store);
  });

  body.querySelector('#car-refresh').addEventListener('click', () => refreshState(overlay, store));

  body.querySelector('#car-disconnect').addEventListener('click', async () => {
    await saveStore(null);
    toast(t('carlink.disconnected'));
    renderLogin(overlay);
  });

  body.querySelectorAll('[data-car-command]').forEach(btn => {
    btn.addEventListener('click', () => onCommand(overlay, store, device, btn));
  });

  stopPolling(overlay);
  if (device) {
    refreshState(overlay, store);
    overlay._carPoll = setInterval(() => {
      // Окно закрыли мимо onClose или вкладка ушла в фон — не дёргаем
      // сигнализацию зря: каждый запрос — это связь блока с сервером Pandora.
      if (!overlay.isConnected) { stopPolling(overlay); return; }
      if (document.visibilityState === 'visible') refreshState(overlay, store);
    }, POLL_MS);
  }
}

async function onCommand(overlay, store, device, btn) {
  const name = btn.dataset.carCommand;
  if (NEEDS_CONFIRM.has(name) && btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.classList.add('primary');
    btn.textContent = t('carlink.tap_again');
    setTimeout(() => {
      if (!btn.isConnected) return;
      btn.dataset.armed = '';
      btn.classList.remove('primary');
      btn.textContent = t(COMMAND_LABELS[name]);
    }, CONFIRM_WINDOW_MS);
    return;
  }

  btn.dataset.armed = '';
  btn.classList.remove('primary');
  btn.textContent = t(COMMAND_LABELS[name]);
  btn.disabled = true;
  try {
    await relay('command', { token: store.token, deviceId: device.id, command: name });
    toast(t('carlink.sent'));
    // Блок выполняет команду несколько секунд — состояние сразу после
    // отправки было бы ещё старым и выглядело бы как отказ.
    setTimeout(() => { if (overlay.isConnected) refreshState(overlay, store); }, 5_000);
  } catch (err) {
    await handleError(overlay, err);
  } finally {
    btn.disabled = false;
  }
}

async function handleError(overlay, err) {
  toast(errorText(err));
  if (err?.code === 'session_expired') {
    await saveStore(null);
    renderLogin(overlay);
  }
}

async function refreshState(overlay, store) {
  const box = overlay.querySelector('#car-state');
  if (!box) return;
  let states;
  try {
    ({ devices: states } = await relay('state', { token: store.token }));
  } catch (err) {
    if (err?.code === 'session_expired') { await handleError(overlay, err); return; }
    box.innerHTML = `<div class="muted">${escapeHtml(errorText(err))}</div>`;
    return;
  }
  const s = summarize(states?.[String(store.deviceId)]);
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
