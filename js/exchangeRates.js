import { Fmt, CURRENCY_SYMBOLS } from './format.js';

/**
 * Рублёвая цена, подписанная в валюте человека, — только для показа.
 *
 * Заряд всегда идёт в рублях (ЮKassa другого не умеет) или в TON — курс
 * здесь ничего не решает и не участвует в оплате. Единственная задача:
 * рядом с «199 ₽» показать «≈ 2 €», чтобы немцу не пришлось самому лезть
 * в конвертер, прежде чем понять, дорого это или нет.
 *
 * Курсы приходят с сервера (см. server/exchangeRates.js — источник Банк
 * России) вместе с тарифами. Своей копии курсов на клиенте нет: тянуть их
 * отдельным запросом ради одной строки текста — сеть без пользы.
 */

/**
 * @param {number} amountRub
 * @param {string} currency  код целевой валюты, напр. 'EUR'
 * @param {object} rubRates  { USD: 83.28, EUR: 97.44, ... } — рублей за единицу
 * @returns {string|null} null — рубль сам по себе, курса нет, либо конвертировать нечего
 */
export function approxInCurrency(amountRub, currency, rubRates) {
  if (!currency || currency === 'RUB') return null;
  if (!Number.isFinite(amountRub) || amountRub <= 0) return null;
  const rate = rubRates?.[currency];
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (!CURRENCY_SYMBOLS[currency]) return null;   // валюта, которую мы вовсе не показываем

  const converted = amountRub / rate;
  return `≈ ${Fmt.money(converted, currency)}`;
}
