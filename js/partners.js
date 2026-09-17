/**
 * Где купить то, что пора менять.
 *
 * ЗАЧЕМ. Приложение и так знает, что у конкретной машины подошёл срок
 * масляного фильтра. Дальше человек всё равно идёт искать его в магазине —
 * и набирает руками «фильтр масляный Лада Гранта 1.6». Ссылка на уже
 * собранный поиск экономит ему эту возню, а нам приносит партнёрское
 * вознаграждение. Это честный размен, но только при трёх условиях.
 *
 * УСЛОВИЕ ПЕРВОЕ: ЭТО РЕКЛАМА, И ОНА ПОМЕЧЕНА. Партнёрская ссылка по
 * российскому закону — реклама. У неё обязан быть токен erid из ОРД и
 * пометка «Реклама» с названием рекламодателя. Поэтому ссылка, у которой
 * в настройках нет erid, НЕ ПОКАЗЫВАЕТСЯ ВОВСЕ — забыть про маркировку
 * здесь технически нельзя, это не вопрос дисциплины.
 *
 * УСЛОВИЕ ВТОРОЕ: НИЧЕГО НЕ УХОДИТ НА НАШ СЕРВЕР. Ссылка собирается прямо
 * на устройстве из названия машины и названия узла. Ни марка, ни пробег, ни
 * сам факт нажатия к нам не попадают — иначе это противоречило бы обещанию,
 * на котором построено всё приложение. Магазин, разумеется, увидит переход:
 * человек сам на него нажал.
 *
 * УСЛОВИЕ ТРЕТЬЕ: ЭТО НЕ СОВЕТ, ЧТО КУПИТЬ. Мы не знаем ни артикула для
 * конкретной машины, ни того, подойдёт ли найденное. Ссылка ведёт в ПОИСК
 * магазина, а не на «правильный товар»: обещать подбор по VIN, не умея его
 * делать, — прямой способ подставить человека на деньги и на ремонт.
 */
import { PARTNER_CONFIG } from './partnersConfig.js';

/**
 * Магазины. Пока только российские: партнёрские программы, до которых
 * реально дотянуться из России, — тоже российские.
 */
export const PARTNER_SHOPS = Object.freeze([
  {
    id: 'ozon',
    title: 'Ozon',
    markets: ['RU'],
    searchUrl: 'https://www.ozon.ru/search/?text={query}',
  },
  {
    id: 'wildberries',
    title: 'Wildberries',
    markets: ['RU'],
    searchUrl: 'https://www.wildberries.ru/catalog/0/search.aspx?search={query}',
  },
  {
    id: 'avtodok',
    title: 'Автодок',
    markets: ['RU'],
    searchUrl: 'https://www.autodoc.ru/search?q={query}',
  },
  {
    id: 'emex',
    title: 'Emex',
    markets: ['RU'],
    searchUrl: 'https://emex.ru/search?detailNum={query}',
  },
]);

/**
 * Как называется узел в магазине.
 *
 * Названия из регламента («Масло двигателя») и поисковые запросы — разные
 * вещи: в магазине ищут «моторное масло», а не «масло двигателя», и по
 * первому находится не то.
 */
const PART_QUERIES = Object.freeze({
  engine_oil: 'моторное масло',
  air_filter: 'воздушный фильтр',
  cabin_filter: 'салонный фильтр',
  fuel_filter: 'топливный фильтр',
  spark_plugs: 'свечи зажигания',
  glow_plugs: 'свечи накаливания',
  timing_belt: 'ремень грм комплект',
  accessory_belt: 'ремень приводной',
  brake_pads_front: 'тормозные колодки передние',
  brake_pads_rear: 'тормозные колодки задние',
  brake_fluid: 'тормозная жидкость',
  coolant: 'антифриз',
  transmission_oil: 'масло трансмиссионное',
  transfer_case_oil: 'масло раздаточной коробки',
  diff_oil: 'масло в редуктор моста',
  reducer_oil: 'масло в редуктор',
  power_steering_fluid: 'жидкость гур',
  shock_absorbers: 'амортизаторы',
  battery: 'аккумулятор',
  tires: 'шины',
  // Узлы, которые не покупают, а делают в сервисе: ссылки на товар для них
  // были бы враньём. caliper_service, wheel_alignment, carbon_cleaning, dpf.
});

/** Узлы, которые нельзя купить коробкой. */
export function isPurchasable(componentId) {
  return Object.hasOwn(PART_QUERIES, String(componentId));
}

/**
 * Поисковый запрос: что и к какой машине.
 *
 * Год и комплектацию намеренно НЕ добавляем: в поиске магазина они дают
 * пустую выдачу чаще, чем точное попадание. Объём двигателя добавляем —
 * по нему фильтры и свечи отличаются по-настоящему.
 */
export function partQuery(componentId, vehicle) {
  if (!isPurchasable(componentId)) return null;
  const part = PART_QUERIES[componentId];
  const car = String(vehicle?.displayName || '').trim();
  const engine = Number(vehicle?.engineVolumeL);
  const parts = [part, car];
  // Объём двигателя важен маслу, фильтрам и свечам; шинам и аккумулятору
  // он не нужен и только сужает выдачу.
  const engineMatters = !['tires', 'battery', 'brake_fluid', 'coolant'].includes(componentId);
  if (engineMatters && Number.isFinite(engine) && engine > 0) {
    parts.push(engine.toFixed(1).replace(/\.0$/, '.0'));
  }
  return parts.filter(Boolean).join(' ');
}

/**
 * Готовые предложения по узлу.
 *
 * Возвращает только те магазины, у которых в настройках есть И партнёрская
 * ссылка, И токен erid. Нет токена — нет ссылки: показать её было бы
 * нарушением, а молча показать без пометки — обманом.
 */
export function offersFor(componentId, vehicle, {
  config = PARTNER_CONFIG, region = 'RU', shops = PARTNER_SHOPS,
} = {}) {
  const query = partQuery(componentId, vehicle);
  if (!query) return [];

  const out = [];
  for (const shop of shops) {
    if (!shop.markets.includes(region)) continue;
    const settings = Object.hasOwn(config, shop.id) ? config[shop.id] : null;
    if (!settings || !settings.deeplink || !settings.erid) continue;

    const target = shop.searchUrl.replace('{query}', encodeURIComponent(query));
    // Адрес магазина уходит внутрь партнёрской ссылки параметром, поэтому
    // кодируется ещё раз — иначе его «хвост» обрежется на первом же &.
    const url = settings.deeplink.replace('{url}', encodeURIComponent(target));
    out.push({
      shopId: shop.id,
      title: shop.title,
      url,
      erid: settings.erid,
      advertiser: settings.advertiser || shop.title,
      query,
    });
  }
  return out;
}

/** Есть ли вообще что показывать. Пустая настройка — ни одной ссылки. */
export function partnersReady(config = PARTNER_CONFIG) {
  return Object.values(config).some(item => item && item.deeplink && item.erid);
}
