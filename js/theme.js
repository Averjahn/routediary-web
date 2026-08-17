// Палитра оформления — портирована 1:1 из ios/Sources/Models/Theme.swift (hex-значения не менять).
export const THEMES = {
  classic: {
    id: 'classic', isDark: false,
    nameKey: 'theme.classic', subtitleKey: 'theme.classic.subtitle',
    accent: '#0A66D6', onAccent: '#FFFFFF',
    background: '#F2F3F7', surface: '#FFFFFF', surfaceAlt: '#E6E9F0',
    textPrimary: '#14161A', textSecondary: '#5C6470', separator: '#D3D8E0',
    success: '#1E7F3C', warning: '#8A5A00', danger: '#C62828',
    walk: '#1E7F3C', run: '#B24700', bike: '#6A3FC0', car: '#0A66D6',
  },
  midnight: {
    id: 'midnight', isDark: true,
    nameKey: 'theme.midnight', subtitleKey: 'theme.midnight.subtitle',
    accent: '#5AA9FF', onAccent: '#0D1117',
    background: '#0D1117', surface: '#171D26', surfaceAlt: '#232B36',
    textPrimary: '#EEF2F7', textSecondary: '#9BA7B5', separator: '#2C3542',
    success: '#4CC97A', warning: '#F2C14E', danger: '#FF7A70',
    walk: '#4CC97A', run: '#FF9F4A', bike: '#B98CFF', car: '#5AA9FF',
  },
  sunset: {
    id: 'sunset', isDark: false,
    nameKey: 'theme.sunset', subtitleKey: 'theme.sunset.subtitle',
    accent: '#C2410C', onAccent: '#FFFFFF',
    background: '#FFF4EA', surface: '#FFFFFF', surfaceAlt: '#FCE6D4',
    textPrimary: '#2E1A10', textSecondary: '#7A4F36', separator: '#EBD3BF',
    success: '#1F7A46', warning: '#8A5A00', danger: '#B3261E',
    walk: '#1F7A46', run: '#C2410C', bike: '#7E3AA8', car: '#9A3412',
  },
  ocean: {
    id: 'ocean', isDark: true,
    nameKey: 'theme.ocean', subtitleKey: 'theme.ocean.subtitle',
    accent: '#3EC8DC', onAccent: '#05222B',
    background: '#05222B', surface: '#0D3542', surfaceAlt: '#164654',
    textPrimary: '#E8F6F9', textSecondary: '#95BDC7', separator: '#1C5162',
    success: '#41D19B', warning: '#FFD166', danger: '#FF8085',
    walk: '#41D19B', run: '#FFB067', bike: '#9AA9FF', car: '#3EC8DC',
  },
  forest: {
    id: 'forest', isDark: false,
    nameKey: 'theme.forest', subtitleKey: 'theme.forest.subtitle',
    accent: '#1F6E43', onAccent: '#FFFFFF',
    background: '#F0F5EE', surface: '#FFFFFF', surfaceAlt: '#E1EBDD',
    textPrimary: '#15211A', textSecondary: '#4E6455', separator: '#CDDCC9',
    success: '#1F6E43', warning: '#8A5A00', danger: '#B3261E',
    walk: '#1F6E43', run: '#B24700', bike: '#6A3FC0', car: '#20655F',
  },
  graphite: {
    id: 'graphite', isDark: true,
    nameKey: 'theme.graphite', subtitleKey: 'theme.graphite.subtitle',
    accent: '#FF9F45', onAccent: '#1A1A1C',
    background: '#151517', surface: '#1F1F23', surfaceAlt: '#2A2A30',
    textPrimary: '#F0F0F2', textSecondary: '#A3A3AD', separator: '#333339',
    success: '#4CC97A', warning: '#F2C14E', danger: '#FF7A70',
    walk: '#4CC97A', run: '#FF9F45', bike: '#B98CFF', car: '#6FB1FF',
  },
  lavender: {
    id: 'lavender', isDark: false,
    nameKey: 'theme.lavender', subtitleKey: 'theme.lavender.subtitle',
    accent: '#6D4FC2', onAccent: '#FFFFFF',
    background: '#F4F2FA', surface: '#FFFFFF', surfaceAlt: '#E8E3F5',
    textPrimary: '#1C1726', textSecondary: '#5C5470', separator: '#D8D0EA',
    success: '#1E7F3C', warning: '#8A5A00', danger: '#B3261E',
    walk: '#1E7F3C', run: '#B24700', bike: '#6D4FC2', car: '#4356C0',
  },
  mocha: {
    id: 'mocha', isDark: true,
    nameKey: 'theme.mocha', subtitleKey: 'theme.mocha.subtitle',
    accent: '#E8B04B', onAccent: '#241A10',
    background: '#1E1610', surface: '#2A211A', surfaceAlt: '#382C22',
    textPrimary: '#F4EDE4', textSecondary: '#B3A493', separator: '#443729',
    success: '#5CC97A', warning: '#E8B04B', danger: '#FF7A70',
    walk: '#5CC97A', run: '#E8804B', bike: '#C89CFF', car: '#E8B04B',
  },
};

/**
 * Порядок показа. Первые две темы бесплатные — по одной светлой и тёмной,
 * этого достаточно, чтобы приложением было комфортно пользоваться в любое
 * время суток. Остальные шесть — оформление сверх необходимого, то есть
 * ровно то, за что честно просить деньги: Про не отбирает удобство, а
 * добавляет вкус.
 */
export const THEME_ORDER = ['classic', 'midnight', 'sunset', 'ocean', 'forest', 'graphite', 'lavender', 'mocha'];
export const FREE_THEMES = ['classic', 'midnight'];

export function isFreeTheme(id) {
  return FREE_THEMES.includes(id);
}

export function applyTheme(id) {
  const theme = THEMES[id] || THEMES.classic;
  const root = document.documentElement;
  root.setAttribute('data-theme', theme.id);
  root.style.setProperty('--color-scheme', theme.isDark ? 'dark' : 'light');
  for (const [key, value] of Object.entries(theme)) {
    if (typeof value === 'string' && value.startsWith('#')) {
      root.style.setProperty('--' + key.replace(/([A-Z])/g, '-$1').toLowerCase(), value);
    }
  }
  root.style.setProperty('--on-fill', theme.isDark ? theme.background : '#FFFFFF');
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', theme.background);
  return theme;
}

export function modeColor(theme, mode) {
  return theme[mode] || theme.textSecondary;
}
