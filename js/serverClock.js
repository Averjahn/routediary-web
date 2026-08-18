import { getSetting, setSetting } from './db.js';

/**
 * Время, которое нельзя отмотать назад.
 *
 * Срок подписки проверяется на устройстве — иначе офлайновое приложение
 * пришлось бы держать в сети ради каждого нажатия. Но сравнивать срок с
 * часами телефона нельзя: перевести их на год назад умеет кто угодно, и
 * истёкшая подписка оживает. Это было проверено — и работало.
 *
 * Поэтому хранится отметка самого позднего времени, которое мы когда-либо
 * видели. Она берётся из заголовка Date любого ответа нашего сервера — его
 * ставит сервер, а не телефон, — и никогда не уменьшается. Действующим
 * временем считается наибольшее из двух: часы телефона и эта отметка.
 *
 * Что это даёт и чего не даёт. Отмотать часы назад больше не помогает:
 * отметка уже помнит более позднее время. Перевести часы ВПЕРЁД по-прежнему
 * можно, но это лишь ускорит окончание подписки — вредить себе никто не
 * станет. Настоящую защиту от правки данных на устройстве это не заменяет:
 * всё, что лежит на телефоне, теоретически правится. Задача скромнее —
 * закрыть способ, для которого не нужно ничего, кроме настроек телефона.
 */

const KEY = 'clockHighWater';

/**
 * Наибольшее из двух: часы устройства и запомненная отметка.
 * Вынесено без ввода-вывода, чтобы проверять тестами.
 */
export function pickNow(deviceMs, highWaterMs) {
  const device = Number.isFinite(deviceMs) ? deviceMs : 0;
  const mark = Number.isFinite(highWaterMs) ? highWaterMs : 0;
  return Math.max(device, mark);
}

/** Разбор заголовка Date. Мусор и будущее из ниоткуда не принимаются. */
export function parseServerDate(header, deviceMs = Date.now()) {
  if (!header) return null;
  const ms = Date.parse(header);
  if (!Number.isFinite(ms)) return null;
  // Год вперёд от часов устройства — это уже не расхождение, а подстава:
  // такой отметкой можно было бы разом завершить чужую подписку.
  const YEAR = 365 * 864e5;
  if (ms > deviceMs + YEAR) return null;
  return ms;
}

/** Запомнить время из ответа сервера. Отметка только растёт. */
export async function noteServerTime(dateHeader) {
  const ms = parseServerDate(dateHeader);
  if (ms == null) return null;
  const current = Number(await getSetting(KEY, 0)) || 0;
  if (ms <= current) return current;
  await setSetting(KEY, ms);
  return ms;
}

/** Время, по которому решается, действует ли подписка. */
export async function effectiveNow() {
  const mark = Number(await getSetting(KEY, 0)) || 0;
  return new Date(pickNow(Date.now(), mark));
}
