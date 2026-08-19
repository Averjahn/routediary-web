import { getSetting, setSetting } from './db.js';

/**
 * Откуда пришла установка: с какой конкретно вывески или QR-кода.
 *
 * Задача та же, что у счётчика установок (usage.js), только с одной меткой
 * сверху — не «сколько людей», а «через какую вывеску». Поэтому и правила
 * те же: ни адреса, ни времени с точностью до секунды, ни истории заходов.
 * Одна метка на устройство, а не запись на каждый переход по ссылке.
 *
 * Первое касание побеждает и остаётся навсегда. Человек мог отсканировать
 * QR у подъезда сегодня и у другого подъезда через месяц — переписывать
 * источник задним числом значило бы приписывать заслугу не той вывеске,
 * которая реально его привела.
 */

const PARAM = 'src';
const KEY = 'trafficSource';

// То же ограничение символов, что и у кода приглашения: метка живёт в URL
// вывески, и после неё не должно остаться мусора, только то, что мы сами
// туда положили.
const VALID = /^[a-zA-Z0-9_-]{1,40}$/;

/**
 * Разбор адреса: что из него нужно убрать и какой источник он несёт.
 *
 * Вынесено отдельно от чтения/записи настроек и не трогает ничего снаружи —
 * поэтому проверяется тестами напрямую, без подделки IndexedDB и history.
 *
 * @param {string} href
 * @returns {{ cleanedPath: string|null, source: string|null }}
 *   cleanedPath — путь без параметра src, если он был; null, если убирать нечего.
 *   source — валидный источник или null (параметра нет либо он не прошёл проверку).
 */
export function parseIncomingSource(href) {
  const url = new URL(href);
  const incoming = url.searchParams.get(PARAM);
  if (incoming === null) return { cleanedPath: null, source: null };

  url.searchParams.delete(PARAM);
  const cleanedPath = url.pathname + url.search + url.hash;
  const source = VALID.test(incoming) ? incoming : null;
  return { cleanedPath, source };
}

/**
 * Запомнить источник из адресной строки, если он там есть и ещё не запомнен.
 * Параметр убирается из URL сразу — те же соображения, что у приглашений:
 * ссылка не должна оседать в истории браузера с чужой меткой внутри.
 */
export async function captureTrafficSource() {
  const { cleanedPath, source } = parseIncomingSource(location.href);
  if (cleanedPath === null) return null;

  history.replaceState(null, '', cleanedPath);
  if (!source) return null;

  // Уже есть источник — не переписываем: первое касание остаётся первым.
  if (await getSetting(KEY)) return null;

  await setSetting(KEY, source);
  return source;
}

/** Источник этой установки, если он был. */
export async function trafficSource() {
  return getSetting(KEY);
}
