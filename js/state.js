import { DB, getSetting, setSetting } from './db.js';
import { detectDefaultCurrency, detectDefaultLang, uuid, todayKey } from './format.js';
import { setLang } from './i18n.js';
import { applyTheme, THEME_ORDER } from './theme.js';

export const DEFAULT_MAINTENANCE = [
  { title: 'maint.default.engine_oil', intervalKm: 10000 },
  { title: 'maint.default.air_filter', intervalKm: 15000 },
  { title: 'maint.default.cabin_filter', intervalKm: 15000 },
  { title: 'maint.default.spark_plugs', intervalKm: 30000 },
  { title: 'maint.default.brake_pads', intervalKm: 40000 },
  { title: 'maint.default.brake_fluid', intervalKm: 60000 },
  { title: 'maint.default.coolant', intervalKm: 60000 },
  { title: 'maint.default.timing_belt', intervalKm: 80000 },
  { title: 'maint.default.tires', intervalKm: 10000 },
];

export const DEFAULT_TEMPLATES = [
  { title: 'expense.wash', categoryKey: 'wash', amount: 500, isRefuel: false },
  { title: 'expense.fuel', categoryKey: 'fuel', amount: 0, liters: 40, pricePerLiter: 55, isRefuel: true },
  { title: 'expense.parking', categoryKey: 'parking', amount: 150, isRefuel: false },
];

export const AppState = {
  theme: 'classic',
  lang: 'ru',
  currency: 'RUB',
  units: 'metric',
  weightKg: 75,
  currentDay: todayKey(),
  recording: false,
  recordingStartedAt: null,
  watchId: null,
};

export async function loadSettings() {
  const theme = await getSetting('theme', 'classic');
  let lang = await getSetting('lang', null);
  let currency = await getSetting('currency', null);
  const units = await getSetting('units', 'metric');
  const weightKg = await getSetting('weightKg', 75);
  const firstRun = lang === null;

  if (lang === null) lang = detectDefaultLang();
  if (currency === null) currency = detectDefaultCurrency();

  if (firstRun) {
    await setSetting('lang', lang);
    await setSetting('currency', currency);
  }

  AppState.theme = THEME_ORDER.includes(theme) ? theme : 'classic';
  AppState.lang = lang;
  AppState.currency = currency;
  AppState.units = units;
  AppState.weightKg = weightKg;

  setLang(AppState.lang);
  applyTheme(AppState.theme);

  await seedDefaultsIfNeeded();
}

export async function setThemeId(id) {
  AppState.theme = id;
  applyTheme(id);
  await setSetting('theme', id);
}

export async function setLanguage(lang) {
  AppState.lang = lang;
  setLang(lang);
  await setSetting('lang', lang);
}

export async function setCurrency(code) {
  AppState.currency = code;
  await setSetting('currency', code);
}

export async function setUnits(u) {
  AppState.units = u;
  await setSetting('units', u);
}

export async function setWeight(kg) {
  AppState.weightKg = kg;
  await setSetting('weightKg', kg);
}

async function seedDefaultsIfNeeded() {
  const seeded = await getSetting('seeded', false);
  if (seeded) return;
  await setSetting('seeded', true);

  const items = DEFAULT_MAINTENANCE.map((m, i) => ({
    id: uuid(), title: m.title, intervalKm: m.intervalKm,
    lastServiceOdometerKm: 0, note: '', sortOrder: i, isDefaultKey: m.title,
  }));
  await DB.putMany('maintenanceItems', items);

  const templates = DEFAULT_TEMPLATES.map((tpl, i) => ({
    id: uuid(), title: tpl.title, categoryKey: tpl.categoryKey,
    amount: tpl.amount || 0, liters: tpl.liters || 0, pricePerLiter: tpl.pricePerLiter || 0,
    isRefuel: !!tpl.isRefuel, sortOrder: i, useCount: 0, isDefaultKey: tpl.title,
  }));
  await DB.putMany('expenseTemplates', templates);
}

export async function getPrimaryVehicle() {
  const vehicles = await DB.getAll('vehicles');
  return vehicles.find(v => v.isPrimary) || vehicles[0] || null;
}

export async function currentOdometerKm(vehicle) {
  if (!vehicle) return 0;
  const trips = await DB.getAllByIndex('trips', 'dayKey', null).catch(() => []);
  // trips index by dayKey is per-day; для суммарного пробега читаем все.
  const all = await DB.getAll('trips');
  const base = new Date(vehicle.odometerBaseDate).getTime();
  const carDistanceM = all
    .filter(t => t.mode === 'car' && new Date(t.startTime).getTime() >= base)
    .reduce((s, t) => s + t.distanceMeters, 0);
  return vehicle.odometerBaseKm + carDistanceM / 1000;
}
