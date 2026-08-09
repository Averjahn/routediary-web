import { loadSettings, AppState } from './state.js';
import { applyI18nTree, keepScroll } from './ui.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { applyTheme } from './theme.js';
import { initInstallBanner } from './installBanner.js';
import { captureIncomingReferral } from './referral.js';
import { startAutoSync } from './syncClient.js';
import * as MapScreen from './screens/map.js';
import * as TripsScreen from './screens/trips.js';
import * as CarScreen from './screens/car.js';
import * as SettingsScreen from './screens/settings.js';
import * as StatsScreen from './screens/stats.js';

const SCREENS = {
  map: { module: MapScreen, el: null, rendered: false },
  trips: { module: TripsScreen, el: null, rendered: false },
  car: { module: CarScreen, el: null, rendered: false },
  settings: { module: SettingsScreen, el: null, rendered: false },
  stats: { module: StatsScreen, el: null, rendered: false },
};

let currentTab = null;

async function init() {
  await loadSettings();
  // До первой отрисовки: код приглашения убирается из адресной строки,
  // чтобы не осесть в истории и закладках.
  await captureIncomingReferral().catch(() => {});
  applyI18nTree(document.body);

  for (const key of Object.keys(SCREENS)) {
    SCREENS[key].el = document.getElementById('screen-' + key);
  }

  applyBrand();

  document.querySelectorAll('.tab-icon[data-icon]').forEach(span => {
    span.innerHTML = icon(span.dataset.icon, { size: 22 });
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.addEventListener('lang-changed', () => {
    // Экран собирается заново, поэтому положение прокрутки удерживаем сами:
    // смена языка не должна выбрасывать человека в начало страницы.
    keepScroll(SCREENS[currentTab]?.el, () => {
      applyI18nTree(document.body);
      applyBrand();
      for (const key of Object.keys(SCREENS)) SCREENS[key].rendered = false;
      switchTab(currentTab, true);
    });
    initInstallBanner();
  });
  document.addEventListener('theme-changed', () => {
    // темы влияют на цвета карты/графиков — просто перерисуем текущий и соседние экраны
    if (SCREENS.map.rendered) MapScreen.refresh?.();
  });

  switchTab('map');
  initInstallBanner();
  // Обмен идёт молча и только если человек вошёл: офлайн — штатное
  // состояние приложения, и отсутствие сети не должно ничего ломать.
  startAutoSync();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

/** Название приложения в боковом меню (широкий экран) — через атрибут: см. CSS. */
function applyBrand() {
  document.getElementById('tabbar')?.setAttribute('data-brand', t('app.name'));
}

function switchTab(tab, force) {
  if (tab === currentTab && !force) return;
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  for (const key of Object.keys(SCREENS)) {
    SCREENS[key].el.classList.toggle('active', key === tab);
  }
  const screen = SCREENS[tab];
  if (!screen.rendered) {
    screen.module.render(screen.el);
    screen.rendered = true;
  } else if (screen.module.refresh) {
    screen.module.refresh();
  }
}

init().catch(err => console.error('Avtopuls init failed:', err));
