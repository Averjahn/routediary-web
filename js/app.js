import { loadSettings, AppState } from './state.js';
import { applyI18nTree } from './ui.js';
import { applyTheme } from './theme.js';
import * as MapScreen from './screens/map.js';
import * as TripsScreen from './screens/trips.js';
import * as CarScreen from './screens/car.js';
import * as PlannerScreen from './screens/planner.js';
import * as StatsScreen from './screens/stats.js';

const SCREENS = {
  map: { module: MapScreen, el: null, rendered: false },
  trips: { module: TripsScreen, el: null, rendered: false },
  car: { module: CarScreen, el: null, rendered: false },
  planner: { module: PlannerScreen, el: null, rendered: false },
  stats: { module: StatsScreen, el: null, rendered: false },
};

let currentTab = null;

async function init() {
  await loadSettings();
  applyI18nTree(document.body);

  for (const key of Object.keys(SCREENS)) {
    SCREENS[key].el = document.getElementById('screen-' + key);
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.addEventListener('lang-changed', () => {
    applyI18nTree(document.body);
    for (const key of Object.keys(SCREENS)) SCREENS[key].rendered = false;
    switchTab(currentTab, true);
  });
  document.addEventListener('theme-changed', () => {
    // темы влияют на цвета карты/графиков — просто перерисуем текущий и соседние экраны
    if (SCREENS.map.rendered) MapScreen.refresh?.();
  });

  switchTab('map');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
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

init().catch(err => console.error('RouteDiary init failed:', err));
