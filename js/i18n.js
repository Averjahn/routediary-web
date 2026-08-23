import ru from './i18n/ru.js';
import en from './i18n/en.js';
import { LANGUAGES, DEFAULT_LANG, FALLBACK_LANG } from './i18n/registry.js';

export { LANGUAGES, LANGUAGE_ORDER, DEFAULT_LANG, detectLang, normalizeLang } from './i18n/registry.js';

/**
 * Переводы.
 *
 * Русский и английский встроены: русский — базовый, английский — запасной
 * для всех остальных языков. Остальные словари подгружаются файлом при
 * выборе языка (см. loadLang) — держать все девять в сборке значило бы
 * замедлить открытие ради восьми языков, которыми конкретный человек
 * никогда не воспользуется.
 *
 * Порядок поиска строки: выбранный язык → английский → русский → сам ключ.
 * Ключ как последнее средство лучше пустого места: в интерфейсе сразу видно,
 * чего не хватает, а не «просто ничего не нарисовалось».
 */

const LOADED = { ru, en };

/** Совместимость: тесты и часть кода читают словари напрямую. */
export const STRINGS = LOADED;

let currentLang = DEFAULT_LANG;

/**
 * Загрузить словарь языка. Возвращает false, если файла нет или он не
 * прочитался — тогда язык не переключается, и человек остаётся на прежнем,
 * а не проваливается в интерфейс из голых ключей.
 */
export async function loadLang(lang) {
  if (!LANGUAGES[lang]) return false;
  if (LOADED[lang]) return true;
  try {
    const mod = await import(`./i18n/${lang}.js`);
    LOADED[lang] = mod.default;
    return true;
  } catch {
    return false;
  }
}

/**
 * Переключить язык. Синхронная — словарь к этому моменту должен быть
 * загружен (см. loadLang): t() вызывается из отрисовки, которая ждать не умеет.
 */
export function setLang(lang) {
  // Откат на английский, а не на русский: если у немца словарь не загрузился,
  // английский он прочтёт, а русский — нет. Русскоязычных это не задевает —
  // их словарь встроен в сборку и не может не загрузиться.
  currentLang = LOADED[lang] ? lang : FALLBACK_LANG;
}

export function getLang() { return currentLang; }

/** Загружен ли словарь — для случаев, когда переключение делается заранее. */
export function isLoaded(lang) { return !!LOADED[lang]; }

export function t(key, params) {
  const dict = LOADED[currentLang];
  let str = (dict && dict[key]) || LOADED[FALLBACK_LANG][key] || LOADED[DEFAULT_LANG][key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
    }
  }
  return str;
}

/**
 * Множественное число.
 *
 * Правила берутся из Intl.PluralRules, а не пишутся руками: в русском три
 * формы, в польском тоже три, но границы у них РАЗНЫЕ, в китайском и
 * японском форма одна, а во французском ноль ведёт себя как единственное
 * число. Захардкоженная русская логика (как было раньше) на польском давала
 * бы неверную форму молча — ошибка, которую по-русски не увидишь вовсе.
 *
 *   plural(1, 'раз', 'раза', 'раз')  → 'раз'
 *   plural(4, 'раз', 'раза', 'раз')  → 'раза'
 *   plural(11, 'раз', 'раза', 'раз') → 'раз'
 */
export function plural(n, one, few, many) {
  const count = Math.abs(Math.trunc(n));

  let category;
  try {
    category = new Intl.PluralRules(currentLang).select(count);
  } catch {
    // Intl без данных этого языка — считаем по-английски: одна форма
    // единственного числа, всё остальное множественное.
    category = count === 1 ? 'one' : 'other';
  }

  // Intl различает шесть категорий, у нас на месте три слова. Раскладываем:
  // zero/two/other сводятся к «many» — это та форма, которой в русском
  // считают пять и больше, а в двухформенных языках она и есть множественная.
  if (category === 'one') return one;
  if (category === 'few') return few || many || one;
  return many || few || one;
}
