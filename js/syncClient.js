import { DB, getSetting, setSetting } from './db.js';
import { createSync, SyncError } from './sync.js';

/**
 * Готовый к работе экземпляр синхронизации для приложения.
 *
 * Сам движок ничего не знает ни про IndexedDB, ни про сеть — это сделано,
 * чтобы его можно было прогнать двумя «устройствами» против настоящего
 * сервера в тестах. Здесь он связывается с реальным хранилищем и fetch.
 */

// Приложение живёт в двух местах: на своём сервере и копией на GitHub Pages.
// Со своего сервера запросы идут по тому же адресу, копия ходит к нему через
// сеть — поэтому адрес выбирается по источнику страницы, а не жёстко.
const REMOTE_ORIGIN = 'https://avtopuls.80-242-61-200.sslip.io';
/**
 * Адрес сервера вычисляется при обращении, а не при загрузке модуля:
 * на уровне модуля обращение к location делало бы файл незагружаемым
 * везде, кроме браузера, и утягивало бы за собой всех, кто его импортирует.
 */
export function syncOrigin() {
  return location.origin.includes('averjahn.github.io') ? REMOTE_ORIGIN : '';
}

const REQUEST_TIMEOUT_MS = 30_000;

async function request(method, path, body, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(syncOrigin() + path, {
      method,
      signal: controller.signal,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let parsed = null;
    try { parsed = await res.json(); } catch { /* пустой ответ — не беда */ }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (err) {
    // Сеть недоступна — это штатное состояние офлайнового приложения,
    // а не сбой: движок отличит его по коду и просто отложит обмен.
    return { ok: false, status: 0, body: { error: err.name === 'AbortError' ? 'timeout' : 'offline' } };
  } finally {
    clearTimeout(timer);
  }
}

export const Sync = createSync({ db: DB, request, getSetting, setSetting });
export { SyncError };

/**
 * Метка устройства для сессии. Уходит на сервер, в интерфейсе не показывается,
 * поэтому не переводится. Ничего, что опознаёт человека, в неё не попадает.
 */
function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Web';
}
export { deviceLabel };

const AUTO_INTERVAL_MS = 5 * 60 * 1000;
let autoTimer = null;

/**
 * Фоновый обмен.
 *
 * Молча проглатывает ошибки: приложение офлайновое, отсутствие сети — норма,
 * и всплывающее сообщение при каждой поездке в метро только раздражало бы.
 * О состоянии обмена человек узнаёт на экране настроек, где оно показано явно.
 */
export async function syncQuietly() {
  if (!(await getSetting('syncToken'))) return null;
  try {
    const result = await Sync.syncNow();
    document.dispatchEvent(new CustomEvent('sync-done', { detail: result }));
    return result;
  } catch (err) {
    document.dispatchEvent(new CustomEvent('sync-failed', { detail: err?.code || 'unknown' }));
    return null;
  }
}

export function startAutoSync() {
  if (autoTimer) return;
  syncQuietly();
  autoTimer = setInterval(syncQuietly, AUTO_INTERVAL_MS);
  // Возврат к приложению — самый вероятный момент, когда на другом устройстве
  // что-то изменилось, а сеть только что появилась.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncQuietly();
  });
  window.addEventListener('online', syncQuietly);
}

export function stopAutoSync() {
  clearInterval(autoTimer);
  autoTimer = null;
}
