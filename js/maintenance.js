/**
 * Регламент обслуживания: классификация автомобиля и расчёт ресурса узлов.
 *
 * Модуль намеренно ЧИСТЫЙ — ни IndexedDB, ни DOM, ни i18n. Всё, что он делает,
 * это математика над обычными объектами. Благодаря этому весь расчёт целиком
 * прогоняется тестами в node (tools/test/maintenance.test.js), а не только
 * вручную в браузере.
 *
 * Почему не таблица «модель → регламент»: моделей в справочнике 323, реальных
 * сервисных книжек на них не достать, а выдумывать цифры на каждую — враньё.
 * Вместо этого автомобиль классифицируется по объективным признакам
 * (тип питания, наддув, топливо, эпоха, тип КПП, привод), а интервалы берутся
 * из таблицы по классу. Это то, как устроены реальные регламенты: у всех
 * карбюраторных «Жигулей» масло через 5000 км, независимо от того, 2101 это
 * или 2106.
 */

// --- Классификация -------------------------------------------------------

/** Классы, по которым различаются интервалы. */
export const VEHICLE_CLASS = {
  SOVIET_CARB: 'soviet_carb',     // карбюратор: ВАЗ 2101–2107, Москвич, ЗАЗ, УАЗ
  RU_INJECTED: 'ru_injected',     // отеч. инжектор: 2108–2115, Priora, Kalina, Granta, Niva
  MODERN_NA: 'modern_na',         // современный атмосферный бензин
  MODERN_TURBO: 'modern_turbo',   // современный турбобензин (TSI/TFSI/GDI)
  DIESEL: 'diesel',
  HYBRID: 'hybrid',
  ELECTRIC: 'electric',
};

/** Марки, которые считаем отечественными/советскими по происхождению. */
const RU_MAKES = new Set([
  'lada', 'vaz', 'uaz', 'gaz', 'moskvich', 'izh', 'zaz', 'luaz', 'raf', 'seaz', 'ntfs',
]);

const TURBO_MARKERS = ['tsi', 'tfsi', 'tdi', 'turbo', 'турбо', 'gdi', 'crdi', 'dci', 'thp'];

/**
 * Разбирает год начала выпуска из строки вида «1977–2002», «2011–», «2025–».
 * Возвращает null, если года нет — тогда классификация опирается на прочие признаки.
 */
export function parseYearFrom(years) {
  if (!years) return null;
  const m = String(years).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Тип коробки из названия комплектации.
 * AMT (робот с одним сцеплением) и DSG/DCT (преселектив) различаются:
 * у них разные регламенты по маслу и по сцеплению.
 */
export function detectTransmission(trimName) {
  const n = (trimName || '').toLowerCase();
  if (/\bamt\b/.test(n)) return 'amt';
  if (/\b(dsg|dct)\b/.test(n)) return 'dsg';
  if (/\bcvt\b|вариатор/.test(n)) return 'cvt';
  if (/\bat\b|\bакпп\b/.test(n)) return 'at';
  if (/\bmt\b|\bмкпп\b/.test(n)) return 'mt';
  return null;
}

/** Полный привод — по маркерам 4WD/AWD/4x4 в названии или модели. */
export function detectAwd(trimName, modelName) {
  const n = `${trimName || ''} ${modelName || ''}`.toLowerCase();
  return /\b4wd\b|\bawd\b|4x4|4х4/.test(n);
}

/**
 * Наддув. Кроме явных маркеров (TSI/TDI/Turbo) смотрим на удельную мощность:
 * больше ~85 л.с. с литра для массового мотора почти наверняка означает наддув.
 * Порог намеренно консервативный — атмосферники такое выдают редко.
 */
export function detectTurbo(trimName, engineVolumeL, powerHp) {
  const n = (trimName || '').toLowerCase();
  if (TURBO_MARKERS.some(m => n.includes(m))) return true;
  if (/\bt\b/.test(n)) return true;
  if (engineVolumeL > 0 && powerHp > 0 && powerHp / engineVolumeL >= 85) return true;
  return false;
}

/**
 * Определяет класс автомобиля — основу всего регламента.
 *
 * vehicle: { makeId, modelId, trimName, years, fuelType, engineVolumeL, powerHp }
 * Любое поле может отсутствовать (например, у машины, заведённой вручную) —
 * тогда возвращается наиболее нейтральный класс MODERN_NA.
 */
export function classifyVehicle(vehicle = {}) {
  const trimName = vehicle.trimName || '';
  const n = trimName.toLowerCase();
  const fuel = vehicle.fuelType || 'petrol';
  const yearFrom = parseYearFrom(vehicle.years);
  const isRuMake = RU_MAKES.has((vehicle.makeId || '').toLowerCase());

  // Топливо решает первым: у электромобиля нет ни масла, ни свечей,
  // и никакая «эпоха» этого не меняет.
  if (fuel === 'electric') return VEHICLE_CLASS.ELECTRIC;
  if (fuel === 'hybrid') return VEHICLE_CLASS.HYBRID;
  if (fuel === 'diesel') return VEHICLE_CLASS.DIESEL;

  // Карбюратор — либо прямо назван, либо это отечественная машина
  // старше 1995 года без пометки «инжектор».
  const saysCarb = n.includes('карбюратор') || n.includes('carb');
  const saysInjector = n.includes('инжектор') || n.includes('injector');
  if (saysCarb) return VEHICLE_CLASS.SOVIET_CARB;
  if (isRuMake && !saysInjector && yearFrom != null && yearFrom < 1995) {
    return VEHICLE_CLASS.SOVIET_CARB;
  }

  if (isRuMake) return VEHICLE_CLASS.RU_INJECTED;

  return detectTurbo(trimName, vehicle.engineVolumeL, vehicle.powerHp)
    ? VEHICLE_CLASS.MODERN_TURBO
    : VEHICLE_CLASS.MODERN_NA;
}

/** Полный профиль машины — класс плюс признаки, влияющие на состав работ. */
export function vehicleProfile(vehicle = {}) {
  const cls = classifyVehicle(vehicle);
  return {
    class: cls,
    fuel: vehicle.fuelType || 'petrol',
    yearFrom: parseYearFrom(vehicle.years),
    transmission: detectTransmission(vehicle.trimName),
    awd: detectAwd(vehicle.trimName, vehicle.displayName),
    turbo: cls === VEHICLE_CLASS.MODERN_TURBO
      || detectTurbo(vehicle.trimName, vehicle.engineVolumeL, vehicle.powerHp),
    combustion: cls !== VEHICLE_CLASS.ELECTRIC,
  };
}

// --- Таблица регламентов -------------------------------------------------

/**
 * Интервалы: { km, months }. Срабатывает то, что наступит РАНЬШЕ, — так
 * написаны все настоящие сервисные книжки: «15 000 км или 12 месяцев».
 * null в km означает «только по времени» (тормозная жидкость стареет
 * от влаги, а не от пробега), null в months — «только по пробегу».
 *
 * severe: во сколько раз сокращать интервал в тяжёлых условиях
 * (город, короткие поездки, пыль, мороз, реагенты, плохое топливо).
 * По регламенту LADA Vesta это 0.5–0.67, у большинства производителей 0.5–0.7.
 * К «чисто временным» узлам не применяется: тормозная жидкость набирает влагу
 * одинаково и у таксиста, и у дачника.
 *
 * confidence: насколько цифре можно верить.
 *   high   — есть официальный регламент производителя или норма закона;
 *   medium — сходятся несколько независимых профильных источников;
 *   low    — источники противоречат друг другу, цифра выбрана консервативно.
 * В интерфейсе всё, что ниже high, показывается как «ориентировочно» —
 * выдавать неподтверждённое число за точный срок замены нельзя.
 */
const C = VEHICLE_CLASS;

export const SERVICE_COMPONENTS = [
  {
    id: 'engine_oil', titleKey: 'maint.default.engine_oil', severe: 0.5,
    appliesTo: p => p.combustion,
    confidence: 'high',
    intervals: {
      // Классика: источники расходятся (8–10 тыс. против заявленных 15) —
      // берём нижнюю границу, на минералке ресурс ещё короче.
      [C.SOVIET_CARB]: { km: 8000, months: 12, confidence: 'medium' },
      // Официальная сетка ТО АвтоВАЗ: 15 000 км, в тяжёлых условиях 7 500.
      [C.RU_INJECTED]: { km: 15000, months: 12 },
      [C.MODERN_NA]: { km: 10000, months: 12 },
      // Наддув: масляная плёнка в подшипнике турбины не прощает усталое масло.
      [C.MODERN_TURBO]: { km: 7500, months: 12 },
      [C.DIESEL]: { km: 10000, months: 12, confidence: 'low' },
      // Миф «гибрид ездит на ДВС меньше, значит интервал длиннее» не подтвердился:
      // Toyota в России даёт те же 10 000 км, что и для обычного мотора.
      [C.HYBRID]: { km: 10000, months: 12, confidence: 'medium' },
    },
  },
  {
    id: 'air_filter', titleKey: 'maint.default.air_filter', severe: 0.5,
    appliesTo: p => p.combustion,
    confidence: 'medium',
    intervals: {
      [C.SOVIET_CARB]: { km: 10000, months: 24, confidence: 'low' },
      [C.RU_INJECTED]: { km: 15000, months: 24 },
      [C.MODERN_NA]: { km: 20000, months: 24 },
      [C.MODERN_TURBO]: { km: 20000, months: 24 },
      [C.DIESEL]: { km: 20000, months: 24 },
      [C.HYBRID]: { km: 20000, months: 24 },
    },
  },
  {
    id: 'cabin_filter', titleKey: 'maint.default.cabin_filter', severe: 0.5,
    // На «Жигулях» и «Москвичах» салонного фильтра просто нет.
    // У электромобиля — есть: это про воздух в салоне, а не про мотор.
    appliesTo: p => p.class !== C.SOVIET_CARB,
    confidence: 'medium',
    intervals: {
      [C.RU_INJECTED]: { km: 15000, months: 12 },
      [C.ELECTRIC]: { km: null, months: 24 },
      default: { km: 10000, months: 12 },
    },
  },
  {
    id: 'fuel_filter', titleKey: 'maint.default.fuel_filter', severe: 0.5,
    appliesTo: p => p.combustion,
    confidence: 'medium',
    needsConfirm: true,   // выносной меняется отдельно, погружной — с бензонасосом
    intervals: {
      [C.SOVIET_CARB]: { km: 30000, months: null },
      // У современных LADA фильтр погружной и ходит до 120 тыс.,
      // у классики и «Нивы» — выносной на 30 тыс. Берём середину и просим уточнить.
      [C.RU_INJECTED]: { km: 60000, months: null },
      [C.MODERN_NA]: { km: 60000, months: null },
      // Непосредственный впрыск: забитый фильтр убивает ТНВД высокого давления.
      [C.MODERN_TURBO]: { km: 20000, months: null },
      // У дизеля фильтр — расходник первой линии: вода и сера убивают ТНВД.
      [C.DIESEL]: { km: 15000, months: 12 },
      [C.HYBRID]: { km: 60000, months: null },
    },
  },
  {
    id: 'spark_plugs', titleKey: 'maint.default.spark_plugs', severe: 0.7,
    // У дизеля свечей зажигания нет — там свечи накаливания, отдельный пункт.
    appliesTo: p => p.combustion && p.fuel !== 'diesel',
    confidence: 'medium',
    intervals: {
      [C.SOVIET_CARB]: { km: 15000, months: 24, confidence: 'low' },
      // Регламент АвтоВАЗ для Приоры/Калины/Гранты/Весты: медные свечи, 30 тыс.
      [C.RU_INJECTED]: { km: 30000, months: 24, confidence: 'high' },
      [C.MODERN_NA]: { km: 60000, months: 48 },
      // Наддув перебивает материал свечи: у VAG для турбомоторов
      // регламент 30 тыс. даже на иридии.
      [C.MODERN_TURBO]: { km: 30000, months: 24 },
      [C.HYBRID]: { km: 90000, months: 60 },
    },
  },
  {
    id: 'glow_plugs', titleKey: 'maint.default.glow_plugs', severe: 0.5,
    appliesTo: p => p.fuel === 'diesel',
    confidence: 'medium',
    // Меняются комплектом. Частые холодные пуски режут ресурс до ~25 тыс.
    intervals: { default: { km: 60000, months: null } },
  },
  {
    id: 'timing_belt', titleKey: 'maint.default.timing_belt', severe: 0.7,
    // Ремень или цепь — зависит от конкретного мотора, а не от класса.
    // Поэтому пункт создаётся всегда для ДВС, но помечается как требующий
    // подтверждения: у цепного мотора пользователь его просто удалит.
    appliesTo: p => p.combustion,
    needsConfirm: true,
    confidence: 'medium',
    intervals: {
      [C.SOVIET_CARB]: { km: 60000, months: 60 },
      // 16-клапанные ВАЗ гнут клапаны при обрыве — здесь запас критичен,
      // поэтому берём нижнюю границу регламента (40–60 тыс.), а не верхнюю.
      [C.RU_INJECTED]: { km: 45000, months: 60 },
      // Возрастное правило срабатывает даже при нулевом пробеге: резина стареет.
      [C.MODERN_NA]: { km: 60000, months: 60 },
      [C.MODERN_TURBO]: { km: 60000, months: 60 },
      [C.DIESEL]: { km: 60000, months: 60, confidence: 'low' },
      [C.HYBRID]: { km: 60000, months: 60 },
    },
  },
  {
    id: 'accessory_belt', titleKey: 'maint.default.accessory_belt', severe: 0.7,
    appliesTo: p => p.combustion,
    confidence: 'medium',
    // Ни один источник не даёт срок в годах — только пробег.
    intervals: {
      [C.SOVIET_CARB]: { km: 20000, months: null, confidence: 'low' },
      default: { km: 60000, months: null },
    },
  },
  {
    id: 'brake_pads_front', titleKey: 'maint.default.brake_pads_front', severe: 0.6,
    appliesTo: () => true,
    confidence: 'high',
    intervals: {
      // На рекуперации колодки почти не изнашиваются — но именно поэтому
      // закисают суппорты, см. отдельный пункт caliper_service.
      [C.HYBRID]: { km: 100000, months: null },
      [C.ELECTRIC]: { km: 100000, months: null },
      default: { km: 40000, months: null },
    },
  },
  {
    id: 'brake_pads_rear', titleKey: 'maint.default.brake_pads_rear', severe: 0.6,
    appliesTo: () => true,
    confidence: 'medium',
    intervals: {
      // Задние барабаны на классике и бюджетных LADA ходят заметно дольше дисков.
      [C.SOVIET_CARB]: { km: 80000, months: null, confidence: 'low' },
      [C.RU_INJECTED]: { km: 80000, months: null, confidence: 'low' },
      [C.HYBRID]: { km: 120000, months: null },
      [C.ELECTRIC]: { km: 120000, months: null },
      default: { km: 60000, months: null },
    },
  },
  {
    id: 'caliper_service', titleKey: 'maint.default.caliper_service', severe: 1,
    // Самый пропускаемый пункт у электричек и гибридов: колодки живут вечно,
    // а направляющие суппортов за это время закисают от реагентов.
    appliesTo: p => p.class === C.ELECTRIC || p.class === C.HYBRID,
    confidence: 'high',
    intervals: { default: { km: null, months: 12 } },
  },
  {
    id: 'brake_fluid', titleKey: 'maint.default.brake_fluid', severe: 1,
    // Гигроскопична: набирает влагу из воздуха независимо от того, ездят на
    // машине или она стоит. При 3% влаги температура кипения падает с ~265 до ~155 °C.
    appliesTo: () => true,
    confidence: 'high',
    intervals: {
      [C.RU_INJECTED]: { km: 45000, months: 36 },
      default: { km: 40000, months: 24 },
    },
  },
  {
    id: 'coolant', titleKey: 'maint.default.coolant', severe: 0.7,
    appliesTo: () => true,
    confidence: 'medium',
    intervals: {
      // ТОСОЛ/G11 на силикатах: защитная плёнка срабатывается за пару лет.
      [C.SOVIET_CARB]: { km: 45000, months: 24 },
      [C.RU_INJECTED]: { km: 60000, months: 36 },
      // Карбоксилатные G12+ живут долго, но «пожизненный» — это маркетинг:
      // ограничиваем пятью годами.
      [C.MODERN_NA]: { km: 120000, months: 60 },
      [C.MODERN_TURBO]: { km: 120000, months: 60 },
      [C.DIESEL]: { km: 120000, months: 60 },
      // У гибрида два независимых контура — силовой и инверторный.
      [C.HYBRID]: { km: 120000, months: 84 },
      [C.ELECTRIC]: { km: null, months: 60, confidence: 'low' },
    },
  },
  {
    id: 'transmission_oil', titleKey: 'maint.default.transmission_oil', severe: 0.5,
    appliesTo: p => p.class !== C.ELECTRIC,
    confidence: 'medium',
    // Тип коробки влияет сильнее, чем класс машины.
    byTransmission: {
      mt: { km: 70000, months: 60 },
      // «Заправлено на весь срок службы» в наших условиях не работает.
      at: { km: 60000, months: 48 },
      // Вариатор: два фильтра меняются вместе с маслом, перегрев ремня
      // лечится только свежей жидкостью.
      cvt: { km: 60000, months: 48, confidence: 'medium' },
      amt: { km: 60000, months: 60, confidence: 'low' },
      // Сухой преселектив в городе — самый спорный узел, берём короткий интервал.
      dsg: { km: 50000, months: 48 },
    },
    intervals: { default: { km: 60000, months: 60 } },
  },
  {
    id: 'transfer_case_oil', titleKey: 'maint.default.transfer_case_oil', severe: 0.6,
    appliesTo: p => p.awd,
    confidence: 'medium',
    intervals: { default: { km: 40000, months: null } },
  },
  {
    id: 'diff_oil', titleKey: 'maint.default.diff_oil', severe: 0.6,
    appliesTo: p => p.awd,
    confidence: 'medium',
    intervals: { default: { km: 40000, months: null } },
  },
  {
    id: 'reducer_oil', titleKey: 'maint.default.reducer_oil', severe: 0.6,
    appliesTo: p => p.class === C.ELECTRIC,
    confidence: 'low',
    // Разброс по источникам огромный (30–100 тыс.), берём середину.
    intervals: { default: { km: 60000, months: 48 } },
  },
  {
    id: 'power_steering_fluid', titleKey: 'maint.default.power_steering_fluid', severe: 0.7,
    // Только для гидроусилителя. У электроусилителя (ЭУР) жидкости нет вовсе,
    // а на него перешли и современные LADA, и почти все новые иномарки —
    // поэтому пункт требует подтверждения владельцем.
    appliesTo: p => p.combustion && p.class !== C.RU_INJECTED,
    needsConfirm: true,
    confidence: 'medium',
    intervals: { default: { km: 60000, months: 24 } },
  },
  {
    id: 'shock_absorbers', titleKey: 'maint.default.shock_absorbers', severe: 0.6,
    appliesTo: () => true,
    confidence: 'medium',
    intervals: { default: { km: 70000, months: null } },
  },
  {
    id: 'battery', titleKey: 'maint.default.battery', severe: 1,
    // Умирает от возраста и холодных пусков, а не от пробега.
    // При −20 °C ёмкость падает на 40–50%, при −30 °C — больше половины.
    appliesTo: () => true,
    confidence: 'medium',
    intervals: { default: { km: null, months: 48 } },
  },
  {
    id: 'tires', titleKey: 'maint.default.tires', severe: 0.8,
    appliesTo: () => true,
    confidence: 'medium',
    // Резина стареет и без пробега. С 5–6 лет её осматривают,
    // после 10 лет с даты производства (DOT) меняют независимо от протектора.
    intervals: {
      // Электромобиль тяжелее и мгновенно даёт крутящий момент — резина
      // стирается на 20–30% быстрее.
      [C.ELECTRIC]: { km: 35000, months: 72 },
      default: { km: 45000, months: 72 },
    },
  },
  {
    id: 'wheel_alignment', titleKey: 'maint.default.wheel_alignment', severe: 0.6,
    appliesTo: () => true,
    confidence: 'medium',
    intervals: { default: { km: 20000, months: 12 } },
  },
  {
    id: 'carbon_cleaning', titleKey: 'maint.default.carbon_cleaning', severe: 0.7,
    // Непосредственный впрыск: бензин больше не омывает впускные клапаны,
    // и картерные газы запекают на них нагар.
    appliesTo: p => p.class === C.MODERN_TURBO,
    confidence: 'medium',
    intervals: { default: { km: 60000, months: null } },
  },
  {
    id: 'dpf', titleKey: 'maint.default.dpf', severe: 0.7,
    appliesTo: p => p.fuel === 'diesel',
    confidence: 'medium',
    needsConfirm: true,   // на дорестайлах и «евро-3» дизелях его может не быть
    // Расчётный ресурс ~150 тыс., на нашей солярке выхаживает меньше.
    intervals: { default: { km: 150000, months: null } },
  },
];

/** Интервал компонента для конкретного профиля. */
export function intervalFor(component, profile) {
  if (component.byTransmission && profile.transmission) {
    const byTx = component.byTransmission[profile.transmission];
    if (byTx) return byTx;
  }
  return component.intervals[profile.class] || component.intervals.default || null;
}

/** Достоверность цифры: уточнение на уровне класса важнее общего значения. */
export function confidenceFor(component, profile) {
  const interval = intervalFor(component, profile);
  return (interval && interval.confidence) || component.confidence || 'medium';
}

/**
 * Собирает персональный регламент под конкретную машину.
 *
 * opts.severe — тяжёлые условия эксплуатации (город/пыль/мороз/короткие
 * поездки). Сокращает интервалы по коэффициенту каждого узла.
 * opts.odometerKm — текущий пробег; от него отсчитывается первый интервал,
 * иначе у машины с пробегом 200 000 всё оказалось бы просрочено в день установки.
 */
export function buildServicePlan(vehicle, opts = {}) {
  const profile = vehicleProfile(vehicle);
  const severe = !!opts.severe;
  const odometerKm = opts.odometerKm || 0;
  const now = opts.now || Date.now();

  const plan = [];
  for (const component of SERVICE_COMPONENTS) {
    if (!component.appliesTo(profile)) continue;
    const base = intervalFor(component, profile);
    if (!base) continue;

    // Тяжёлые условия сокращают ресурс только там, где он тратится ездой.
    // У узлов с одним лишь временным интервалом (тормозная жидкость, АКБ,
    // старение резины) режим эксплуатации ни на что не влияет.
    const timeOnly = base.km == null;
    const factor = severe && !timeOnly ? component.severe : 1;

    plan.push({
      componentId: component.id,
      titleKey: component.titleKey,
      intervalKm: base.km != null ? Math.round(base.km * factor) : null,
      intervalMonths: base.months != null ? Math.round(base.months * factor) : null,
      lastServiceOdometerKm: odometerKm,
      lastServiceDate: now,
      needsConfirm: !!component.needsConfirm,
      confidence: confidenceFor(component, profile),
      sortOrder: plan.length,
    });
  }
  return { profile, items: plan };
}

// --- Расчёт остатка ресурса ---------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30.44 * DAY_MS;   // средняя длина месяца — считаем в днях, не в календаре

export const STATUS = { OK: 'ok', SOON: 'soon', DUE: 'due', OVERDUE: 'overdue' };

/**
 * Состояние одного узла.
 *
 * ctx: { odometerKm, now, avgKmPerDay }
 * avgKmPerDay берётся из реальной истории поездок — именно это превращает
 * «осталось 4000 км» в «осталось 4000 км, это примерно до 15 октября».
 *
 * Возвращает остаток по обоим измерениям и общий вердикт по тому,
 * которое закончится раньше.
 */
/**
 * Отметка времени к миллисекундам.
 *
 * Записи приезжают не только из этого приложения: синхронизация возит их
 * между вебом, iOS и Android, а там даты сериализуются строкой ISO. Строка,
 * попавшая в арифметику напрямую, давала NaN, и на экране появлялось
 * «Состояние NaN%» — молча неверное вместо честно неизвестного.
 *
 * Возвращает null для всего, из чего не выходит осмысленной даты.
 */
export function toMillis(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function componentStatus(item, ctx = {}) {
  const odometerKm = ctx.odometerKm || 0;
  const now = ctx.now || Date.now();
  const avgKmPerDay = ctx.avgKmPerDay > 0 ? ctx.avgKmPerDay : 0;

  let kmLeft = null, kmFraction = null;
  if (item.intervalKm > 0) {
    const used = odometerKm - (item.lastServiceOdometerKm || 0);
    kmLeft = item.intervalKm - used;
    kmFraction = kmLeft / item.intervalKm;
  }

  let daysLeft = null, timeFraction = null;
  const servicedAt = toMillis(item.lastServiceDate);
  if (item.intervalMonths > 0 && servicedAt != null) {
    const totalMs = item.intervalMonths * MONTH_MS;
    const usedMs = now - servicedAt;
    daysLeft = Math.round((totalMs - usedMs) / DAY_MS);
    timeFraction = (totalMs - usedMs) / totalMs;
  }

  // Ресурс узла — то из двух измерений, которого осталось меньше.
  // Number.isFinite отсекает и NaN: испорченное поле должно означать
  // «про этот срок ничего не известно», а не отравлять всю оценку.
  const fractions = [kmFraction, timeFraction].filter(f => Number.isFinite(f));
  const fraction = fractions.length ? Math.min(...fractions) : 1;
  const limitedBy = fractions.length === 0 ? null
    : (kmFraction != null && kmFraction === fraction ? 'km' : 'time');

  // Прогноз даты: по пробегу — если знаем среднесуточный пробег;
  // по времени — напрямую. Берём более раннюю из двух.
  let dueDate = null;
  if (daysLeft != null) dueDate = now + daysLeft * DAY_MS;
  if (kmLeft != null && avgKmPerDay > 0) {
    const byKm = now + (kmLeft / avgKmPerDay) * DAY_MS;
    dueDate = dueDate == null ? byKm : Math.min(dueDate, byKm);
  }

  let status = STATUS.OK;
  if (fraction <= 0) status = STATUS.OVERDUE;
  else if (fraction <= 0.1) status = STATUS.DUE;
  else if (fraction <= 0.25) status = STATUS.SOON;

  return {
    kmLeft, daysLeft, fraction: Math.max(0, Math.min(1, fraction)),
    limitedBy, dueDate, status,
  };
}

/**
 * Средний пробег в сутки по истории поездок — основа всех прогнозов дат.
 * Считаем по фактическому окну наблюдения (от первой поездки до сегодня),
 * а не по «сумме / 365»: у человека, который завёл приложение неделю назад,
 * второй вариант занизил бы результат в 50 раз.
 */
export function averageKmPerDay(trips, now = Date.now()) {
  const carTrips = (trips || []).filter(t => t.mode === 'car' && t.distanceMeters > 0);
  if (carTrips.length === 0) return 0;
  const times = carTrips.map(t => new Date(t.startTime).getTime()).filter(Number.isFinite);
  if (times.length === 0) return 0;
  const first = Math.min(...times);
  const spanDays = Math.max(1, (now - first) / DAY_MS);
  const totalKm = carTrips.reduce((s, t) => s + t.distanceMeters, 0) / 1000;
  return totalKm / spanDays;
}

/**
 * «Здоровье» автомобиля 0..100 — минимальный, а не средний остаток ресурса.
 *
 * Среднее врёт: девять свежих узлов и один умерший дают 90% «здоровья»,
 * хотя ехать на этом нельзя. Поэтому берём взвешенную оценку, где
 * просроченные узлы тянут результат вниз непропорционально.
 */
export function fleetHealth(items, ctx) {
  if (!items || items.length === 0) return 100;
  const stats = items.map(i => componentStatus(i, ctx));
  const avg = stats.reduce((s, st) => s + st.fraction, 0) / stats.length;
  const worst = Math.min(...stats.map(st => st.fraction));
  // Худший узел весит столько же, сколько все остальные вместе.
  return Math.round(Math.max(0, Math.min(1, avg * 0.5 + worst * 0.5)) * 100);
}

/** Ближайшие работы — то, что показывать на главном экране. */
export function upcoming(items, ctx, limit = 5) {
  return (items || [])
    .map(item => ({ item, status: componentStatus(item, ctx) }))
    .sort((a, b) => a.status.fraction - b.status.fraction)
    .slice(0, limit);
}
