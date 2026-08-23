import { getLang, t } from './i18n.js';

export const CURRENCY_SYMBOLS = {
  RUB: '₽', USD: '$', EUR: '€', GBP: '£', KZT: '₸', UAH: '₴', BYN: 'Br',
  CNY: '¥', JPY: '¥', INR: '₹', PLN: 'zł', CHF: 'CHF', CAD: 'CA$', AUD: 'A$',
};

/**
 * Валюта по стране, а не по языку.
 *
 * Язык и валюта — разные вещи: у немецкоговорящего швейцарца интерфейс
 * немецкий, а деньги франки; у испаноговорящего мексиканца — песо, а не евро.
 * Поэтому сначала спрашиваем регион самой системы, и только если его нет —
 * гадаем по языку.
 */
const CURRENCY_BY_REGION = {
  RU: 'RUB', BY: 'BYN', KZ: 'KZT', UA: 'UAH',
  US: 'USD', CA: 'CAD', AU: 'AUD', GB: 'GBP', CH: 'CHF',
  DE: 'EUR', AT: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR',
  BE: 'EUR', PT: 'EUR', IE: 'EUR', FI: 'EUR', GR: 'EUR',
  PL: 'PLN', CN: 'CNY', JP: 'JPY', IN: 'INR',
};

const CURRENCY_BY_LANG = {
  ru: 'RUB', uk: 'UAH', kk: 'KZT', be: 'BYN',
  zh: 'CNY', ja: 'JPY', hi: 'INR', pl: 'PLN',
  de: 'EUR', fr: 'EUR', es: 'EUR', it: 'EUR',
};

export function detectDefaultCurrency() {
  try {
    const opts = Intl.NumberFormat().resolvedOptions();
    if (opts.currency) return opts.currency;
  } catch (e) { /* система без данных о валюте — идём дальше */ }

  const tag = (navigator.language || '').toLowerCase();
  const parts = tag.split(/[-_]/);
  const region = parts[parts.length - 1]?.toUpperCase();
  if (region && CURRENCY_BY_REGION[region]) return CURRENCY_BY_REGION[region];

  return CURRENCY_BY_LANG[parts[0]] || 'USD';
}


export const Fmt = {
  currencySymbol(code) { return CURRENCY_SYMBOLS[code] || code; },

  money(value, currency) {
    const symbol = this.currencySymbol(currency);
    const rounded = Math.round(value * 100) / 100;
    return `${rounded.toLocaleString(getLang() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 0 })} ${symbol}`;
  },

  distanceKm(meters, units) {
    if (units === 'imperial') {
      const mi = meters / 1609.344;
      return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} ${t('unit.mi')}`;
    }
    const km = meters / 1000;
    return `${km < 10 ? km.toFixed(1) : Math.round(km)} ${t('unit.km')}`;
  },

  speed(kmh, units) {
    if (units === 'imperial') return `${Math.round(kmh / 1.60934)} ${t('unit.mph')}`;
    return `${Math.round(kmh)} ${t('unit.kmh')}`;
  },

  liters(l) { return `${l.toFixed(1)} ${t('unit.liters')}`; },
  kcal(v) { return `${Math.round(v)} ${t('unit.kcal')}`; },

  duration(sec) {
    // Единицы берём из словаря, а не ветвлением по языку: иначе третий язык
    // потребует правки кода, а не перевода.
    const totalMin = Math.round(sec / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const mm = String(m).padStart(2, '0');
    if (h > 0) return `${h}${t('unit.hour_short')} ${mm}${t('unit.min_short')}`;
    return `${m}${t('unit.min_short')}`;
  },

  time(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString(getLang() === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  },

  dateShort(dayKey) {
    const d = new Date(dayKey + 'T00:00:00');
    return d.toLocaleDateString(getLang() === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long' });
  },

  percent(v) { return `${Math.round(v * 100)}%`; },

  /**
   * Дата из timestamp — для прогнозов обслуживания.
   * Год показываем только если он не текущий: «12 октября» читается легче,
   * чем «12 октября 2026 г.», а вот «12 октября 2029 г.» без года соврал бы.
   */
  dateFromTs(ts) {
    const d = new Date(ts);
    const opts = { day: 'numeric', month: 'long' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(getLang() === 'ru' ? 'ru-RU' : 'en-US', opts);
  },
};

export function todayKey() {
  return dayKeyOf(new Date());
}

export function dayKeyOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(dayKey, delta) {
  const d = new Date(dayKey + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return dayKeyOf(d);
}

export function dayLabel(dayKey) {
  const today = todayKey();
  if (dayKey === today) return t('day.today');
  if (dayKey === addDays(today, -1)) return t('day.yesterday');
  if (dayKey === addDays(today, 1)) return t('day.tomorrow');
  return Fmt.dateShort(dayKey);
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
