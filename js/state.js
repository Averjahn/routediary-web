import { DB, getSetting, setSetting } from './db.js';
import { detectDefaultCurrency, detectDefaultLang, uuid, todayKey } from './format.js';
import { setLang } from './i18n.js';
import { applyTheme, THEME_ORDER } from './theme.js';
import { buildServicePlan, averageKmPerDay } from './maintenance.js';

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

  // Регламент больше не заводится «вслепую» при первом запуске: он строится
  // под конкретную машину в ensureServicePlan(), когда её выбирают. Иначе
  // владелец электромобиля получал бы пункт «замена свечей».

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

// --- Гараж: несколько машин ---------------------------------------------

/** Все машины гаража. Порядок стабильный — по времени добавления. */
export async function getVehicles() {
  const vehicles = await DB.getAll('vehicles');
  return vehicles.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
}

/**
 * Делает машину основной. Основная — та, на которую по умолчанию
 * записываются новые поездки и которую показывает экран «Авто».
 */
export async function setPrimaryVehicle(vehicleId) {
  const vehicles = await DB.getAll('vehicles');
  const updated = vehicles.map(v => ({ ...v, isPrimary: v.id === vehicleId }));
  await DB.putMany('vehicles', updated);
  return updated.find(v => v.isPrimary) || null;
}

/** Удаляет машину вместе с её регламентом. Поездки остаются, но станут «ничьими». */
export async function removeVehicle(vehicleId) {
  const items = await getMaintenanceFor(vehicleId);
  for (const item of items) await DB.delete('maintenanceItems', item.id);

  const trips = await DB.getAllByIndex('trips', 'vehicleId', vehicleId).catch(() => []);
  if (trips.length) {
    await DB.putMany('trips', trips.map(t => ({ ...t, vehicleId: null })));
  }

  await DB.delete('vehicles', vehicleId);

  // Если удалили основную — основной становится первая из оставшихся,
  // иначе гараж окажется без «машины по умолчанию».
  const rest = await getVehicles();
  if (rest.length && !rest.some(v => v.isPrimary)) {
    await setPrimaryVehicle(rest[0].id);
  }
}

/**
 * Привязывает поездку к машине и пересчитывает пробег обеих.
 * Отдельная функция, потому что смена машины у поездки меняет пробег
 * сразу у двух автомобилей — у прежнего он уменьшится.
 */
export async function assignTripToVehicle(tripId, vehicleId) {
  const trip = await DB.get('trips', tripId);
  if (!trip) return null;
  trip.vehicleId = vehicleId;
  await DB.put('trips', trip);
  return trip;
}

/**
 * Поездки без машины — из версии до появления гаража либо оставшиеся
 * после удаления автомобиля. Отдаются основной машине при первом запуске.
 */
export async function adoptOrphanTrips(vehicleId) {
  const all = await DB.getAll('trips');
  const orphans = all.filter(t => t.vehicleId == null);
  if (orphans.length === 0) return 0;
  await DB.putMany('trips', orphans.map(t => ({ ...t, vehicleId })));
  return orphans.length;
}

// --- Регламент обслуживания ---------------------------------------------

/** Тяжёлые условия: город, короткие поездки, пыль, мороз. Сокращают интервалы. */
export async function getSevereConditions() {
  return !!(await getSetting('severeConditions', false));
}
export async function setSevereConditions(value) {
  await setSetting('severeConditions', !!value);
}

/** Записи регламента конкретной машины. */
export async function getMaintenanceFor(vehicleId) {
  const all = await DB.getAll('maintenanceItems');
  return all.filter(i => i.vehicleId === vehicleId);
}

/**
 * Гарантирует, что у машины есть регламент.
 *
 * Порядок важен:
 *   1. если записи уже есть — ничего не трогаем, там история замен;
 *   2. если есть «ничьи» записи из версии до v2 — отдаём их этой машине,
 *      чтобы человек не потерял то, что уже отмечал;
 *   3. иначе строим регламент под класс автомобиля.
 */
export async function ensureServicePlan(vehicle, odometerKm = 0) {
  if (!vehicle) return [];

  const existing = await getMaintenanceFor(vehicle.id);
  if (existing.length > 0) return existing;

  const all = await DB.getAll('maintenanceItems');
  const orphans = all.filter(i => i.vehicleId == null);
  if (orphans.length > 0) {
    const adopted = orphans.map(i => ({ ...i, vehicleId: vehicle.id }));
    await DB.putMany('maintenanceItems', adopted);
    return adopted;
  }

  const severe = await getSevereConditions();
  const { items } = buildServicePlan(vehicle, { odometerKm, severe });
  const rows = items.map(i => ({
    id: uuid(),
    vehicleId: vehicle.id,
    componentId: i.componentId,
    title: i.titleKey,
    intervalKm: i.intervalKm,
    intervalMonths: i.intervalMonths,
    lastServiceOdometerKm: i.lastServiceOdometerKm,
    lastServiceDate: i.lastServiceDate,
    needsConfirm: i.needsConfirm,
    confidence: i.confidence,
    note: '',
    sortOrder: i.sortOrder,
  }));
  await DB.putMany('maintenanceItems', rows);
  return rows;
}

/**
 * Пересобирает интервалы под новый режим эксплуатации, сохраняя историю замен.
 * Меняются только интервалы — отметки «когда меняли» остаются нетронутыми.
 */
export async function recalcIntervals(vehicle, severe) {
  const existing = await getMaintenanceFor(vehicle.id);
  if (existing.length === 0) return [];
  const { items } = buildServicePlan(vehicle, { severe });
  const byComponent = new Map(items.map(i => [i.componentId, i]));

  const updated = existing.map(row => {
    const fresh = byComponent.get(row.componentId);
    if (!fresh) return row;                       // пункт добавлен вручную — не трогаем
    return { ...row, intervalKm: fresh.intervalKm, intervalMonths: fresh.intervalMonths };
  });
  await DB.putMany('maintenanceItems', updated);
  return updated;
}

/**
 * Сдвигает нетронутые пункты регламента на новый пробег.
 *
 * Зачем: естественный порядок действий — сначала выбрать машину, потом ввести
 * реальный пробег. Регламент строится в первый момент, когда одометр ещё нулевой,
 * и после ввода «96 000» весь список оказался бы просрочен на 96 000 км.
 *
 * Сдвигаем только те пункты, которых пользователь не касался: если он уже
 * отметил «заменил сейчас» или поправил пункт руками, там настоящая история
 * обслуживания, и переписывать её нельзя.
 */
export async function rebaseUntouchedItems(vehicle, newOdometerKm, prevOdometerKm) {
  const items = await getMaintenanceFor(vehicle.id);
  const untouched = items.filter(i => i.lastServiceOdometerKm === prevOdometerKm && !i.serviced);
  if (untouched.length === 0) return items;

  const shifted = untouched.map(i => ({ ...i, lastServiceOdometerKm: newOdometerKm }));
  await DB.putMany('maintenanceItems', shifted);
  return getMaintenanceFor(vehicle.id);
}

/** Среднесуточный пробег по истории — основа прогноза дат обслуживания. */
export async function currentAvgKmPerDay(vehicle = null) {
  const trips = await DB.getAll('trips');
  // Прогноз обслуживания строится по пробегу КОНКРЕТНОЙ машины: если человек
  // ездит на рабочей каждый день, а дачную заводит раз в месяц, общий
  // среднесуточный пробег наврал бы обеим.
  const mine = vehicle
    ? trips.filter(t => t.vehicleId === vehicle.id || (t.vehicleId == null && vehicle.isPrimary))
    : trips;
  return averageKmPerDay(mine);
}

/**
 * Текущий пробег машины: введённая база плюс её поездки после ввода базы.
 *
 * Считаем ТОЛЬКО поездки этой машины. В гараже их может быть несколько,
 * и без фильтра пробег второй машины наматывался бы на первую.
 * Поездки без машины (из версии до гаража) достаются основной — иначе
 * при обновлении приложения пробег обнулился бы.
 */
export async function currentOdometerKm(vehicle) {
  if (!vehicle) return 0;
  const all = await DB.getAll('trips');
  const base = new Date(vehicle.odometerBaseDate).getTime();
  const carDistanceM = all
    .filter(t => t.mode === 'car'
      && (t.vehicleId === vehicle.id || (t.vehicleId == null && vehicle.isPrimary))
      && new Date(t.startTime).getTime() >= base)
    .reduce((s, t) => s + t.distanceMeters, 0);
  return vehicle.odometerBaseKm + carDistanceM / 1000;
}
