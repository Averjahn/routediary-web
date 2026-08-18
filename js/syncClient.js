import { DB, getSetting, setSetting } from './db.js';
import { createSync, SyncError } from './sync.js';

/**
 * Готовый к работе экземпляр синхронизации для приложения.
 *
 * Сам движок ничего не знает ни про IndexedDB, ни про сеть — это сделано,
 * чтобы его можно было прогнать двумя «устройствами» против настоящего
 * сервера в тестах. Здесь он связывается с реальным хранилищем и fetch.
 */

// Приложение раздаётся из нескольких мест: со своего сервера, где рядом
// живёт и API, и статическими копиями на обычном хостинге, где никакого API
// нет. Копия обязана ходить к серверу по сети.
const REMOTE_ORIGIN = 'https://avtopuls.80-242-61-200.sslip.io';

// Хосты, на которых страницу отдаёт сам сервер приложения. Список белый, а
// не чёрный: неизвестный адрес — это почти наверняка копия на статическом
// хостинге, и для неё ошибиться в сторону «ходи по сети» безопасно (запрос
// просто уйдёт на сервер), а в сторону «API рядом» — нет: там его нет, и
// приложение молча останется без синхронизации.
const API_HOSTS = new Set(['avtopuls.80-242-61-200.sslip.io']);

// Своя машина — всегда «API рядом», на каком угодно порту. Порт нельзя
// зашивать: тесты и проверки поднимают сервер на свободном, и приложение
// начинало ломиться на боевой сервер, который чужой localhost не пускает.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

/**
 * Адрес сервера вычисляется при обращении, а не при загрузке модуля:
 * на уровне модуля обращение к location делало бы файл незагружаемым
 * везде, кроме браузера, и утягивало бы за собой всех, кто его импортирует.
 *
 * Пустая строка означает «API рядом, по тому же адресу».
 */
export function syncOrigin() {
  const sameOrigin = API_HOSTS.has(location.hostname) || LOOPBACK.has(location.hostname);
  return sameOrigin ? '' : REMOTE_ORIGIN;
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
    // Время сервера из заголовка Date. По нему проверяется срок подписки:
    // часы телефона для этого не годятся, их переводят назад в две секунды.
    // Здесь — на каждом ответе, а не только при входе: чем чаще отметка
    // обновляется, тем меньше окно, в котором отмотка вообще что-то даёт.
    import('./serverClock.js')
      .then(({ noteServerTime }) => noteServerTime(res.headers.get('date')))
      .catch(() => {});
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
