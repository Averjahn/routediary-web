/**
 * Разбор дорожных данных OpenStreetMap: ограничения скорости и светофоры.
 *
 * Чего здесь нет: обратного отсчёта светофора. Тайминги в OSM существуют
 * только как непринятое предложение, и в самом обсуждении сказано почему —
 * цикл плавает (две минуты в час пик против 75 секунд ночью), а часть
 * светофоров адаптивные. Положения светофоров размечены хорошо, и это всё,
 * что можно брать оттуда честно.
 *
 * Про ограничения скорости важно различать два случая, которые выглядят
 * одинаково в данных, но по-разному для водителя:
 *   — числовое значение: на дороге стоит знак;
 *   — RU:urban и подобное: знака нет, действует общее ограничение.
 * Показывать второе как «знак» нельзя: человек будет искать его глазами
 * и не найдёт, а доверие к подсказке потеряет.
 */

/**
 * Общие ограничения по странам. Значения — из правил дорожного движения,
 * а не из данных: в OSM они записаны именно ссылкой на закон.
 */
const IMPLICIT_LIMITS = {
  'RU:living_street': 20,
  'RU:urban': 60,
  'RU:rural': 90,
  'RU:motorway': 110,
  'DE:living_street': 7,
  'DE:urban': 50,
  'DE:rural': 100,
};

/** Значения, означающие «ограничения нет». */
const NO_LIMIT = new Set(['none', 'signals', 'variable']);

/**
 * Разбор значения maxspeed.
 *
 * @returns {{kmh: number|null, source: 'sign'|'default'|'unknown'}}
 *   sign    — на дороге есть знак с этим числом;
 *   default — знака нет, действует общее ограничение;
 *   unknown — прочитать не удалось, показывать нечего.
 */
export function parseMaxspeed(value) {
  if (value == null) return { kmh: null, source: 'unknown' };
  const raw = String(value).trim().toLowerCase();
  if (!raw || NO_LIMIT.has(raw)) return { kmh: null, source: 'unknown' };

  // Пешеходная скорость записывается словом. Числа у неё нет, и придумывать
  // его не нужно: важно само ограничение «шагом».
  if (raw === 'walk') return { kmh: 5, source: 'default' };

  const implicit = IMPLICIT_LIMITS[String(value).trim()];
  if (implicit) return { kmh: implicit, source: 'default' };

  const mph = raw.match(/^(\d+(?:\.\d+)?)\s*mph$/);
  if (mph) return { kmh: Math.round(Number(mph[1]) * 1.60934), source: 'sign' };

  const kmh = raw.match(/^(\d+(?:\.\d+)?)(\s*km\/h)?$/);
  if (kmh) {
    const number = Number(kmh[1]);
    // Ноль и заведомая чушь — это ошибка разметки, а не ограничение.
    if (number > 0 && number <= 200) return { kmh: Math.round(number), source: 'sign' };
  }

  return { kmh: null, source: 'unknown' };
}

// --- Геометрия ---

const R = 6371000;
const toRad = (d) => d * Math.PI / 180;

export function distanceMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Расстояние от точки до отрезка дороги.
 * На городских масштабах достаточно плоской проекции: ошибка на сотне
 * метров — сантиметры, а тригонометрия сферы здесь только замедлит.
 */
export function distanceToSegment(point, a, b) {
  const kx = Math.cos(toRad(point.lat)) * 111320;
  const ky = 110540;
  const px = (point.lon - a.lon) * kx;
  const py = (point.lat - a.lat) * ky;
  const bx = (b.lon - a.lon) * kx;
  const by = (b.lat - a.lat) * ky;

  const lengthSq = bx * bx + by * by;
  if (lengthSq === 0) return Math.hypot(px, py);

  // Проекция точки на отрезок, зажатая его концами.
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lengthSq));
  return Math.hypot(px - bx * t, py - by * t);
}

/** Кратчайшее расстояние до ломаной. */
export function distanceToWay(point, nodes) {
  if (!nodes || nodes.length === 0) return Infinity;
  if (nodes.length === 1) return distanceMeters(point, nodes[0]);
  let best = Infinity;
  for (let i = 1; i < nodes.length; i++) {
    best = Math.min(best, distanceToSegment(point, nodes[i - 1], nodes[i]));
  }
  return best;
}

// --- Подбор дороги ---

// Дальше этого дорога уже не «под нами»: точность GPS в городе редко лучше.
const MATCH_RADIUS_M = 25;
// На сколько метров ближайшая дорога должна опережать следующую с ДРУГИМ
// ограничением, чтобы выбор считался уверенным.
//
// Именно метры, а не отношение расстояний: стоя ровно на дороге, мы имеем
// до неё ноль, и любое отношение объявляет выбор уверенным — хотя соседняя
// улица в двенадцати метрах, а городской GPS промахивается на столько же.
const AMBIGUITY_MARGIN_M = 15;

/**
 * Ограничение на дороге под машиной.
 *
 * Главная опасность — соседняя дорога: дублёр вдоль проспекта, эстакада над
 * улицей, встречная сторона с другим знаком. Ошибиться здесь означает
 * ругаться на водителя, который ничего не нарушает, и после двух таких раз
 * подсказку выключат. Поэтому при неоднозначности мы молчим: отсутствие
 * подсказки безвредно, ложная — нет.
 *
 * @param {{lat,lon}} point
 * @param {Array} ways [{ id, nodes: [{lat,lon}], maxspeed }]
 * @returns {{kmh, source, wayId, distance}|null}
 */
export function speedLimitAt(point, ways, {
  radiusM = MATCH_RADIUS_M,
  ambiguityMarginM = AMBIGUITY_MARGIN_M,
} = {}) {
  const candidates = [];
  for (const way of ways || []) {
    const limit = parseMaxspeed(way.maxspeed);
    if (limit.kmh == null) continue;
    const distance = distanceToWay(point, way.nodes);
    if (distance <= radiusM) candidates.push({ ...limit, wayId: way.id, distance });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.distance - b.distance);
  const best = candidates[0];

  const rival = candidates.find(c => c.kmh !== best.kmh);
  if (rival && rival.distance - best.distance < ambiguityMarginM) return null;

  return best;
}

// --- Превышение ---

// Запас перед предупреждением. Спидометр машины врёт в большую сторону,
// GPS шумит, и ругаться на 61 км/ч в зоне 60 — верный способ быть выключенным.
const TOLERANCE_KMH = 10;

/**
 * @returns {'ok'|'near'|'over'}
 *   near — идём вплотную к пределу, но ещё в допуске;
 *   over — превышение сверх допуска.
 */
export function overspeedState(speedKmh, limitKmh, { toleranceKmh = TOLERANCE_KMH } = {}) {
  if (!Number.isFinite(speedKmh) || !Number.isFinite(limitKmh) || limitKmh <= 0) return 'ok';
  if (speedKmh > limitKmh + toleranceKmh) return 'over';
  if (speedKmh > limitKmh) return 'near';
  return 'ok';
}

// --- Светофоры ---

/**
 * Ближайший светофор ПО ХОДУ движения.
 *
 * Без учёта направления подсказка бессмысленна: только что проеханный
 * перекрёсток находится ровно так же близко, как и следующий.
 *
 * @param {{lat,lon}} point
 * @param {number} headingDeg куда едем, градусы от севера
 * @param {Array} signals [{id, lat, lon}]
 */
export function signalAhead(point, headingDeg, signals, {
  maxDistanceM = 300,
  coneDeg = 50,
} = {}) {
  if (!Number.isFinite(headingDeg)) return null;

  let best = null;
  for (const signal of signals || []) {
    const distance = distanceMeters(point, signal);
    if (distance > maxDistanceM || distance < 5) continue;

    const bearing = bearingDeg(point, signal);
    if (angleDiff(bearing, headingDeg) > coneDeg) continue;

    if (!best || distance < best.distance) best = { ...signal, distance: Math.round(distance) };
  }
  return best;
}

export function bearingDeg(from, to) {
  const y = Math.sin(toRad(to.lon - from.lon)) * Math.cos(toRad(to.lat));
  const x = Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat))
    - Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lon - from.lon));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Разница между направлениями с учётом перехода через 360°. */
export function angleDiff(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export const RULES_DEFAULTS = { MATCH_RADIUS_M, AMBIGUITY_MARGIN_M, TOLERANCE_KMH };
