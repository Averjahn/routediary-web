/**
 * Какие языки знает приложение.
 *
 * Русский и английский встроены в сборку: русский — базовый, английский —
 * запасной для всех остальных. Остальные подгружаются файлом при выборе,
 * а не лежат в сборке все сразу: девять словарей — это почти триста
 * килобайт, и офлайновое приложение открывалось бы заметно дольше ради
 * восьми языков, которыми конкретный человек никогда не воспользуется.
 *
 * nativeName пишется на самом языке, а не по-русски: человек, открывший
 * список на незнакомом ему языке, ищет глазами «Deutsch», а не «Немецкий».
 */

export const LANGUAGES = {
  ru: { code: 'ru', nativeName: 'Русский', bundled: true },
  en: { code: 'en', nativeName: 'English', bundled: true },
  de: { code: 'de', nativeName: 'Deutsch' },
  es: { code: 'es', nativeName: 'Español' },
  fr: { code: 'fr', nativeName: 'Français' },
  pl: { code: 'pl', nativeName: 'Polski' },
  zh: { code: 'zh', nativeName: '中文' },
  ja: { code: 'ja', nativeName: '日本語' },
  hi: { code: 'hi', nativeName: 'हिन्दी' },
};

/** Порядок в списке выбора: сначала базовые, дальше по алфавиту кода. */
export const LANGUAGE_ORDER = ['ru', 'en', 'de', 'es', 'fr', 'hi', 'ja', 'pl', 'zh'];

export const DEFAULT_LANG = 'ru';
export const FALLBACK_LANG = 'en';

/**
 * Язык из строки браузера: «de-AT» → «de», «zh-Hans-CN» → «zh».
 * Возвращает null для незнакомых — тогда решает следующий кандидат.
 */
export function normalizeLang(tag) {
  if (!tag) return null;
  const base = String(tag).toLowerCase().split(/[-_]/)[0];
  return LANGUAGES[base] ? base : null;
}

/**
 * Определение языка по настройкам браузера.
 *
 * navigator.languages — список по убыванию предпочтения, и он важнее
 * одного navigator.language: человек с системой на английском, но с
 * немецким вторым, скорее прочтёт немецкий, чем русский.
 */
export function detectLang(navigatorLike = globalThis.navigator) {
  const candidates = [
    ...(navigatorLike?.languages || []),
    navigatorLike?.language,
  ];
  for (const tag of candidates) {
    const lang = normalizeLang(tag);
    if (lang) return lang;
  }
  return DEFAULT_LANG;
}
