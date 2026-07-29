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
};

export const THEME_ORDER = ['classic', 'midnight', 'sunset', 'ocean'];

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
