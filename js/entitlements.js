import { THEMES, FREE_THEMES } from './theme.js';
import { HUD_COLORS, HUD_FONTS, HUD_DEFAULT_COLOR, HUD_DEFAULT_FONT } from './hud.js';

/**
 * Что должно стать с оформлением, когда Про закончился.
 *
 * Вынесено отдельно и без единого обращения к хранилищу: решение здесь
 * денежное — оно определяет, за что человек продолжает получать премиальный
 * вид после того, как перестал платить, — и его нужно уметь проверять
 * тестами, а не только глазами в браузере.
 *
 * Зачем это вообще понадобилось: проверки стояли только на ПЕРЕКЛЮЧЕНИЕ
 * платной темы и платного стиля проекции. Уже выбранные оставались после
 * окончания подписки, и покупка одного месяца давала премиальную внешность
 * навсегда — то есть подписка была разовой покупкой.
 */

/**
 * Бесплатная замена платной теме.
 *
 * Тёмная меняется на тёмную, светлая на светлую: внезапный переход дня в ночь
 * пугает сильнее, чем сама потеря оформления, и читается как поломка, а не
 * как окончание подписки.
 */
export function freeThemeFor(themeId) {
  const wasDark = !!THEMES[themeId]?.isDark;
  return FREE_THEMES.find(id => !!THEMES[id]?.isDark === wasDark) || FREE_THEMES[0];
}

/**
 * Какие изменения нужны, чтобы вид соответствовал уровню доступа.
 *
 * @param {object} current {isPro, theme, hudColor, hudFont}
 * @returns {object} только то, что надо поменять; пустой объект — менять нечего
 */
export function downgradePlan(current) {
  const plan = {};
  if (current?.isPro) return plan;   // у оплатившего не отбирают ничего

  const theme = current?.theme;
  // Незнакомую тему не трогаем: это чужие данные или будущая версия,
  // и подменять её бесплатной означало бы ломать то, чего мы не понимаем.
  if (theme && THEMES[theme] && !FREE_THEMES.includes(theme)) {
    plan.theme = freeThemeFor(theme);
  }

  if (current?.hudColor && HUD_COLORS[current.hudColor] && current.hudColor !== HUD_DEFAULT_COLOR) {
    plan.hudColor = HUD_DEFAULT_COLOR;
  }
  if (current?.hudFont && HUD_FONTS[current.hudFont] && current.hudFont !== HUD_DEFAULT_FONT) {
    plan.hudFont = HUD_DEFAULT_FONT;
  }

  return plan;
}
