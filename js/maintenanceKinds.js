/**
 * Не только автомобили: мотоциклы, катера и яхты, авиация.
 *
 * ГЛАВНОЕ РАЗЛИЧИЕ — В ЧЁМ СЧИТАТЬ РЕСУРС. У машины и мотоцикла это
 * километры. У лодочного мотора километров нет вовсе: он работает на месте,
 * на волне, на холостых, и ресурс там считают МОТОЧАСАМИ. Поэтому у техники
 * есть единица наработки, а не «пробег» на все случаи.
 *
 * ПОЧЕМУ У САМОЛЁТОВ И ВЕРТОЛЁТОВ НЕТ РЕГЛАМЕНТА. Обслуживание воздушного
 * судна ведётся по утверждённой программе его разработчика, а выполненные
 * работы записываются в бортовой журнал — документ, а не заметку в телефоне.
 * Наш движок считает ориентиры «по классу мотора»; для самолёта такой
 * ориентир не просто бесполезен — по нему можно принять решение, которое
 * стоит жизни. Поэтому для авиации приложение ведёт журнал налёта, топлива
 * и расходов, и молчит про сроки замен. Это не «пока не сделали»: этого
 * здесь не будет.
 *
 * ОТКУДА ИНТЕРВАЛЫ. Это общепринятые ориентиры из руководств по эксплуатации
 * распространённой техники, а не выписка из книжки конкретной модели.
 * Поэтому у всех них честная пометка «ориентировочно», и любой интервал
 * человек может исправить на свой.
 */

/** Единица, в которой считается наработка. */
export const USAGE_UNIT = { KM: 'km', HOURS: 'hours' };

/**
 * Виды техники. car и moto считаются по километрам, boat и aircraft —
 * по моточасам (у авиации это часы налёта).
 */
export const KIND_INFO = Object.freeze({
  car: { id: 'car', unit: USAGE_UNIT.KM, titleKey: 'vehicle.kind.car', hasSchedule: true },
  moto: { id: 'moto', unit: USAGE_UNIT.KM, titleKey: 'vehicle.kind.moto', hasSchedule: true },
  boat: { id: 'boat', unit: USAGE_UNIT.HOURS, titleKey: 'vehicle.kind.boat', hasSchedule: true },
  aircraft: { id: 'aircraft', unit: USAGE_UNIT.HOURS, titleKey: 'vehicle.kind.aircraft', hasSchedule: false },
});

export const KIND_ORDER = Object.freeze(['car', 'moto', 'boat', 'aircraft']);

export function kindInfo(kind) {
  return Object.hasOwn(KIND_INFO, String(kind)) ? KIND_INFO[String(kind)] : KIND_INFO.car;
}

export function usageUnit(kind) {
  return kindInfo(kind).unit;
}

/** Есть ли у этого вида техники регламент. У авиации — нет, и не будет. */
export function hasSchedule(kind) {
  return kindInfo(kind).hasSchedule;
}

/**
 * Мотоцикл.
 *
 * Отличия от машины, из-за которых нельзя просто взять автомобильный набор:
 * цепь требует ухода каждую тысячу километров (у машины такого узла нет
 * вовсе), масло стареет быстрее — мотор оборотистее и объём масла меньше,
 * а клапаны на многих моторах регулируются, а не «стоят до капремонта».
 */
const MOTO_COMPONENTS = [
  { id: 'engine_oil', titleKey: 'maint.default.engine_oil', km: 6000, months: 12 },
  { id: 'oil_filter', titleKey: 'maint.moto.oil_filter', km: 6000, months: 12 },
  { id: 'chain_care', titleKey: 'maint.moto.chain_care', km: 800 },
  { id: 'chain_kit', titleKey: 'maint.moto.chain_kit', km: 25000 },
  { id: 'air_filter', titleKey: 'maint.default.air_filter', km: 12000, months: 24 },
  { id: 'spark_plugs', titleKey: 'maint.default.spark_plugs', km: 15000, months: 24 },
  { id: 'brake_pads_front', titleKey: 'maint.default.brake_pads_front', km: 15000 },
  { id: 'brake_pads_rear', titleKey: 'maint.default.brake_pads_rear', km: 20000 },
  { id: 'brake_fluid', titleKey: 'maint.default.brake_fluid', months: 24 },
  { id: 'coolant', titleKey: 'maint.default.coolant', km: 30000, months: 24 },
  { id: 'fork_oil', titleKey: 'maint.moto.fork_oil', km: 20000, months: 48 },
  { id: 'valve_clearance', titleKey: 'maint.moto.valve_clearance', km: 24000 },
  { id: 'tires', titleKey: 'maint.default.tires', km: 15000, months: 60 },
];

/**
 * Катер и яхта.
 *
 * Всё считается моточасами. Два узла, которых нет ни у машины, ни у
 * мотоцикла: крыльчатка помпы (сгорает за минуты, если мотор запустили
 * без воды) и аноды — их съедает электрохимия, и в солёной воде втрое
 * быстрее, чем в пресной.
 */
const BOAT_COMPONENTS = [
  { id: 'engine_oil', titleKey: 'maint.default.engine_oil', hours: 100, months: 12 },
  { id: 'oil_filter', titleKey: 'maint.moto.oil_filter', hours: 100, months: 12 },
  { id: 'gear_oil', titleKey: 'maint.boat.gear_oil', hours: 100, months: 12 },
  { id: 'impeller', titleKey: 'maint.boat.impeller', hours: 200, months: 36 },
  { id: 'anodes', titleKey: 'maint.boat.anodes', months: 12 },
  { id: 'spark_plugs', titleKey: 'maint.default.spark_plugs', hours: 200, months: 24 },
  { id: 'fuel_filter', titleKey: 'maint.default.fuel_filter', hours: 100, months: 12 },
  { id: 'water_separator', titleKey: 'maint.boat.water_separator', hours: 100, months: 12 },
  { id: 'coolant', titleKey: 'maint.default.coolant', hours: 300, months: 24 },
];

const COMPONENTS_BY_KIND = { moto: MOTO_COMPONENTS, boat: BOAT_COMPONENTS };

/**
 * Регламент для техники, которая не автомобиль.
 *
 * Возвращает те же поля, что и автомобильный движок, — экран один на всё.
 * Интервал в моточасах живёт в intervalHours; intervalKm у такой техники
 * пустой, и подставлять туда километры нельзя: они там ничего не значат.
 */
export function buildKindPlan(vehicle, opts = {}) {
  const kind = String(vehicle?.kind || 'car');
  const components = Object.hasOwn(COMPONENTS_BY_KIND, kind) ? COMPONENTS_BY_KIND[kind] : null;
  if (!components) return { profile: null, items: [] };

  const usage = Number(opts.usage) || 0;
  const now = opts.now || Date.now();
  // Тяжёлые условия: для лодки это солёная вода, для мотоцикла — город и
  // бездорожье. Ресурс того, что тратится работой мотора, срезается вдвое.
  const factor = opts.severe ? 0.5 : 1;

  return {
    profile: { kind, unit: usageUnit(kind) },
    items: components.map((component, index) => {
      const timeOnly = component.km == null && component.hours == null;
      const scale = timeOnly ? 1 : factor;
      return {
        componentId: component.id,
        titleKey: component.titleKey,
        intervalKm: component.km != null ? Math.round(component.km * scale) : null,
        intervalHours: component.hours != null ? Math.round(component.hours * scale) : null,
        intervalMonths: component.months != null ? Math.round(component.months * (timeOnly ? 1 : scale)) : null,
        lastServiceOdometerKm: usageUnit(kind) === USAGE_UNIT.KM ? usage : 0,
        lastServiceHours: usageUnit(kind) === USAGE_UNIT.HOURS ? usage : 0,
        lastServiceDate: now,
        needsConfirm: false,
        // Ориентир из общих руководств, а не из книжки конкретной модели.
        // Честная пометка обязательна: человек должен знать, что сверяться
        // нужно со своим руководством.
        confidence: 'low',
        sortOrder: index,
      };
    }),
  };
}
