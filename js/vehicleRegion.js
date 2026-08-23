/**
 * Какие марки поднимать наверх списка в зависимости от страны.
 *
 * Зачем. В справочнике 408 марок. Без сортировки человек в Германии, чтобы
 * добраться до Volkswagen, листает мимо «212», «Abarth», «AC», «Acura» и ещё
 * трёх сотен марок, которых он в жизни не видел. Раньше наверх поднимались
 * марки, популярные в России, — и немцу это помогало примерно никак.
 *
 * Списки составлены по реальной статистике продаж 2025 года
 * (best-selling-cars.com, ACEA, отраслевые сводки по каждому рынку),
 * а не по ощущению «что на слуху». Порядок внутри списка примерно
 * соответствует доле рынка, но точность рейтинга здесь не важна: задача —
 * чтобы нужная марка была в первом экране, а не на 200-й строке.
 *
 * Регион берётся из настроек системы (см. detectRegion) и его можно
 * поменять руками: человек мог переехать, купить машину за границей или
 * просто выставить в телефоне другую страну.
 */

/**
 * Рынок России и ближнего зарубежья — отечественные, китайские и корейские
 * марки. Порядок соответствует продажам 2025 года.
 */
const RU_MARKET = [
  'Lada', 'Haval', 'Geely', 'Chery', 'Changan', 'Toyota', 'Kia', 'Hyundai',
  'Volkswagen', 'BMW', 'Mercedes-Benz', 'Renault', 'Nissan', 'Skoda', 'Exeed',
  'Omoda', 'Jetour', 'Tank', 'Belgee', 'Great Wall', 'Audi', 'Mazda',
  'Mitsubishi', 'Ford', 'Chevrolet', 'Opel', 'UAZ', 'GAZ', 'Moskvich',
  'Volvo', 'Land Rover', 'Lexus', 'Suzuki', 'Subaru', 'Honda', 'Peugeot',
  'Citroen', 'Datsun', 'SsangYong', 'Daewoo', 'BYD', 'Li Auto', 'Zeekr',
];

/**
 * Северная Америка — пикапы и внедорожники, поэтому наверху американские
 * марки, которых в Европе почти нет (Ram, GMC, Buick), и отсутствуют
 * европейские бюджетные (Dacia, Skoda).
 */
const US_MARKET = [
  'Toyota', 'Ford', 'Chevrolet', 'Honda', 'Nissan', 'Jeep', 'Hyundai', 'Kia',
  'Subaru', 'Ram', 'GMC', 'Tesla', 'Mazda', 'Volkswagen', 'BMW',
  'Mercedes-Benz', 'Lexus', 'Dodge', 'Buick', 'Cadillac', 'Chrysler',
  'Volvo', 'Audi', 'Acura', 'Infiniti', 'Mitsubishi', 'Land Rover', 'Porsche',
  'Lincoln', 'Genesis', 'MINI', 'Rivian', 'Lucid',
];

/** Западная Европа — общий список, дальше уточняется по стране. */
const EU_MARKET = [
  'Volkswagen', 'Toyota', 'Skoda', 'BMW', 'Renault', 'Mercedes-Benz', 'Audi',
  'Peugeot', 'Dacia', 'Hyundai', 'Kia', 'Opel', 'Citroen', 'Ford', 'Volvo',
  'Fiat', 'SEAT', 'Cupra', 'Nissan', 'MG', 'Tesla', 'MINI', 'Suzuki',
  'Mazda', 'BYD', 'Jeep', 'Land Rover', 'Porsche', 'Alfa Romeo', 'Honda',
  'Mitsubishi', 'Lexus', 'Smart', 'DS', 'Subaru',
];

/**
 * Отличия стран внутри Европы существенные: во Франции Renault и Peugeot
 * занимают почти половину рынка, а Skoda далеко не в первых; в Германии
 * наоборот. Поэтому у крупных рынков свой порядок, а не общеевропейский.
 */
const DE_MARKET = [
  'Volkswagen', 'Skoda', 'BMW', 'Mercedes-Benz', 'Audi', 'Opel', 'Toyota',
  'Hyundai', 'SEAT', 'Cupra', 'Ford', 'Kia', 'Renault', 'Dacia', 'Peugeot',
  'Fiat', 'Volvo', 'Tesla', 'MINI', 'Porsche', 'Mazda', 'Nissan', 'Citroen',
  'Suzuki', 'MG', 'Jeep', 'Smart', 'Land Rover', 'Honda', 'BYD',
];

const FR_MARKET = [
  'Renault', 'Peugeot', 'Dacia', 'Citroen', 'Volkswagen', 'Toyota', 'Opel',
  'BMW', 'Mercedes-Benz', 'Audi', 'Hyundai', 'Kia', 'Skoda', 'Fiat', 'Ford',
  'MG', 'Tesla', 'Nissan', 'Volvo', 'SEAT', 'Cupra', 'DS', 'Suzuki', 'MINI',
  'Mazda', 'Land Rover', 'Jeep', 'Porsche', 'Alfa Romeo', 'BYD',
];

const ES_MARKET = [
  'Toyota', 'SEAT', 'Cupra', 'Volkswagen', 'Dacia', 'Renault', 'Peugeot',
  'Hyundai', 'Kia', 'Citroen', 'Skoda', 'Opel', 'BMW', 'Mercedes-Benz',
  'Audi', 'MG', 'Ford', 'Nissan', 'Fiat', 'Mazda', 'Suzuki', 'Volvo',
  'Tesla', 'Jeep', 'MINI', 'Land Rover', 'Honda', 'BYD', 'Porsche', 'DS',
];

const PL_MARKET = [
  'Toyota', 'Skoda', 'Volkswagen', 'Kia', 'Hyundai', 'Dacia', 'BMW',
  'Mercedes-Benz', 'Audi', 'Renault', 'Opel', 'Ford', 'Peugeot', 'Citroen',
  'Volvo', 'SEAT', 'Cupra', 'Suzuki', 'Nissan', 'Mazda', 'Fiat', 'MG',
  'Tesla', 'Mitsubishi', 'Jeep', 'Honda', 'MINI', 'Land Rover', 'Porsche',
];

/**
 * Япония — рынок кэй-каров: Suzuki и Daihatsu держат вместе почти четверть,
 * а европейских марок почти нет вовсе.
 */
const JP_MARKET = [
  'Toyota', 'Suzuki', 'Honda', 'Daihatsu', 'Nissan', 'Mazda', 'Subaru',
  'Mitsubishi', 'Lexus', 'Isuzu', 'Volkswagen', 'Mercedes-Benz', 'BMW',
  'Audi', 'Volvo', 'MINI', 'Porsche', 'Tesla', 'Peugeot', 'Renault',
];

/**
 * Индия — Maruti Suzuki занимает около сорока процентов рынка. В нашем
 * справочнике марка называется Suzuki: отдельной записи Maruti нет,
 * и заводить её ради одной страны означало бы раздвоить модельный ряд.
 */
const IN_MARKET = [
  'Suzuki', 'Hyundai', 'Tata', 'Mahindra', 'Toyota', 'Kia', 'Honda',
  'MG', 'Renault', 'Nissan', 'Skoda', 'Volkswagen', 'Jeep', 'Citroen',
  'BMW', 'Mercedes-Benz', 'Audi', 'Volvo', 'Land Rover', 'Lexus',
];

/** Китай — свои марки заняли больше половины рынка. */
const CN_MARKET = [
  'BYD', 'Geely', 'Changan', 'Chery', 'Haval', 'Great Wall', 'Wuling',
  'Volkswagen', 'Toyota', 'Honda', 'Nissan', 'Tesla', 'Li Auto', 'Zeekr',
  'Buick', 'Audi', 'BMW', 'Mercedes-Benz', 'Hongqi', 'GAC', 'Jetour',
  'Exeed', 'Omoda', 'Tank', 'Voyah', 'Xpeng', 'Dongfeng', 'FAW', 'JAC',
];

/**
 * Страна → список марок. Страны без своей записи получают ближайший
 * подходящий рынок: Австрия и Швейцария — немецкий, Бельгия — французский,
 * и так далее. Полный перечень стран мира здесь не нужен: незнакомая
 * страна откатывается на общеевропейский список, а он для большинства
 * рынков разумен.
 */
export const REGION_MAKES = {
  RU: RU_MARKET, BY: RU_MARKET, KZ: RU_MARKET, UA: RU_MARKET,
  AM: RU_MARKET, GE: RU_MARKET, KG: RU_MARKET, UZ: RU_MARKET,

  US: US_MARKET, CA: US_MARKET, MX: US_MARKET,

  DE: DE_MARKET, AT: DE_MARKET, CH: DE_MARKET,
  FR: FR_MARKET, BE: FR_MARKET, LU: FR_MARKET,
  ES: ES_MARKET, PT: ES_MARKET,
  PL: PL_MARKET, CZ: PL_MARKET, SK: PL_MARKET, HU: PL_MARKET,
  LT: PL_MARKET, LV: PL_MARKET, EE: PL_MARKET, RO: PL_MARKET,

  JP: JP_MARKET,
  IN: IN_MARKET,
  CN: CN_MARKET, HK: CN_MARKET, TW: CN_MARKET,
};

/**
 * Страны для выбора руками — по одной на каждый набор марок, а не все
 * тридцать записей таблицы: показывать отдельно Австрию и Швейцарию, если
 * список у них немецкий, значит предлагать выбор без разницы.
 */
export const REGION_ORDER = ['RU', 'US', 'DE', 'FR', 'ES', 'PL', 'JP', 'IN', 'CN'];

/** Список для стран, которых нет в таблице. */
export const FALLBACK_MAKES = EU_MARKET;

/**
 * Страна из настроек системы.
 *
 * Спрашиваем именно регион, а не язык: у немецкоговорящего швейцарца язык
 * немецкий, а рынок швейцарский; у испаноговорящего в США — рынок
 * американский. Определять страну по языку означало бы систематически
 * ошибаться на всех, кто живёт не там, где говорят на его языке.
 */
export function detectRegion(navigatorLike = globalThis.navigator) {
  const tags = [
    ...(navigatorLike?.languages || []),
    navigatorLike?.language,
  ].filter(Boolean);

  for (const tag of tags) {
    // «de-AT» → AT. Однобуквенных и трёхбуквенных регионов не бывает,
    // поэтому берём только двухбуквенный хвост.
    const parts = String(tag).split(/[-_]/);
    const last = parts[parts.length - 1];
    if (parts.length > 1 && /^[A-Za-z]{2}$/.test(last)) {
      const region = last.toUpperCase();
      if (REGION_MAKES[region]) return region;
    }
  }

  // Регион не удалось прочитать — пробуем часовой пояс: он есть почти
  // всегда и меняется реже, чем язык интерфейса.
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const byZone = ZONE_REGION[zone];
    if (byZone) return byZone;
  } catch { /* Intl без данных о поясе — не беда, ниже откат */ }

  return null;
}

/**
 * Часовые пояса крупнейших городов целевых рынков. Не полная таблица мира —
 * только то, что реально уточняет ответ, когда регион в языке не указан.
 */
const ZONE_REGION = {
  'Europe/Moscow': 'RU', 'Europe/Samara': 'RU', 'Asia/Yekaterinburg': 'RU',
  'Asia/Novosibirsk': 'RU', 'Asia/Krasnoyarsk': 'RU', 'Asia/Vladivostok': 'RU',
  'Europe/Minsk': 'BY', 'Europe/Kiev': 'UA', 'Asia/Almaty': 'KZ',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
  'America/Los_Angeles': 'US', 'America/Phoenix': 'US', 'America/Toronto': 'CA',
  'Europe/Berlin': 'DE', 'Europe/Vienna': 'AT', 'Europe/Zurich': 'CH',
  'Europe/Paris': 'FR', 'Europe/Brussels': 'BE',
  'Europe/Madrid': 'ES', 'Europe/Lisbon': 'PT',
  'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ', 'Europe/Budapest': 'HU',
  'Asia/Tokyo': 'JP', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
  'Asia/Shanghai': 'CN', 'Asia/Hong_Kong': 'HK', 'Asia/Taipei': 'TW',
};

/** Марки, поднимаемые наверх для этой страны. */
export function makesForRegion(region) {
  return REGION_MAKES[region] || FALLBACK_MAKES;
}

/**
 * Порядковый вес марки: чем меньше, тем выше в списке.
 *
 * Марки не из регионального списка получают одинаковый большой вес и дальше
 * сортируются по алфавиту — так «хвост» из трёхсот редких марок остаётся
 * предсказуемым, а не перемешанным.
 */
export function makeRank(nameEn, region) {
  const list = makesForRegion(region);
  const index = list.indexOf(nameEn);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}
