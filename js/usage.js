import { getSetting, setSetting } from './db.js';

/**
 * Отметка «приложением сегодня пользовались».
 *
 * Нужна ровно для одного: знать, сколько людей им пользуется. Поэтому
 * отправляется случайное число, которое устройство придумало себе само, и
 * больше ничего — ни аккаунта, ни координат, ни того, что человек делал.
 *
 * Раз в сутки, а не при каждом запуске: чаще незачем, а по частым отметкам
 * восстанавливается распорядок дня.
 *
 * Молчит при любой ошибке. Счётчик установок не та вещь, ради которой можно
 * показать человеку сообщение об ошибке или задержать открытие приложения.
 */

const ID_KEY = 'installId';
const LAST_KEY = 'installPingDay';

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Случайный номер этой установки. Создаётся один раз и никуда не выводится. */
export async function installId() {
  const existing = await getSetting(ID_KEY);
  if (existing) return existing;

  const fresh = crypto.randomUUID();
  await setSetting(ID_KEY, fresh);
  return fresh;
}

/** Где приложение открыто. Влияет только на разбивку в сводке. */
export function platform() {
  if (window.Telegram?.WebApp?.initData) return 'telegram';
  return 'web';
}

export async function ping({ force = false } = {}) {
  try {
    if (!force && (await getSetting(LAST_KEY)) === today()) return false;

    const { syncOrigin } = await import('./syncClient.js');
    const { trafficSource } = await import('./trafficSource.js');
    const res = await fetch(`${syncOrigin()}/api/usage/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installId: await installId(),
        platform: platform(),
        version: document.querySelector('meta[name="app-version"]')?.content || null,
        // Источник шлётся при каждом пинге, а не только при первом: если
        // отметка о вчерашнем дне потерялась (например, человек снёс и
        // поставил приложение заново), сервер должен получить её снова.
        source: await trafficSource(),
      }),
    });

    // День помечаем только при доставленной отметке: иначе один запуск в
    // самолёте съел бы отметку за сутки.
    if (!res.ok) return false;
    await setSetting(LAST_KEY, today());
    return true;
  } catch {
    return false;
  }
}
