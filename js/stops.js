import { haversineMeters } from './geo.js';

/**
 * Места, где вы регулярно стоите.
 *
 * Чего здесь НЕТ и не будет: обратного отсчёта светофора. Фазы светофоров
 * раздаются только там, где город договорился отдавать их наружу, и в общем
 * случае этих данных не существует; телефон светофор не видит. Показать
 * «переключится через 12 секунд» можно было бы только выдумав число — а по
 * нему человек тронется. Поэтому вместо предсказания здесь измерение:
 * сколько вы на самом деле простояли в этом месте в прошлые разы.
 *
 * По той же причине это «остановки», а не «светофоры»: по треку не отличить
 * светофор от знака, пробки или очереди на выезд. Называть это светофором
 * означало бы обещать больше, чем измерено.
 */

// Меньше — обычно замедление в потоке, а не остановка.
const MIN_STOP_SEC = 15;
// Дольше — это уже стоянка, магазин или ожидание человека, а не перекрёсток.
const MAX_STOP_SEC = 300;
// Разброс координат у стоящей машины: GPS «плавает» даже без движения.
const STILL_RADIUS_M = 25;
// Насколько близко должны быть две остановки, чтобы считаться одним местом.
const SAME_PLACE_M = 45;
// Сколько раз надо там постоять, чтобы это перестало быть случайностью.
const MIN_VISITS = 3;
// Хвост трека: остановка в самом начале и конце поездки — это парковка.
const TRIP_EDGE_SEC = 45;

/**
 * Остановки внутри одного трека.
 *
 * @param {Array} points точки одной поездки: {timestamp, lat, lon}
 * @returns {Array} {lat, lon, startedAt, seconds}
 */
export function findStops(points, {
  minSeconds = MIN_STOP_SEC,
  maxSeconds = MAX_STOP_SEC,
  radiusM = STILL_RADIUS_M,
  edgeSeconds = TRIP_EDGE_SEC,
} = {}) {
  const sorted = [...(points || [])]
    .filter(p => Number.isFinite(p?.timestamp) && Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length < 2) return [];

  const tripStart = sorted[0].timestamp;
  const tripEnd = sorted[sorted.length - 1].timestamp;
  const stops = [];

  let anchor = 0;
  for (let i = 1; i <= sorted.length; i++) {
    const outOfRange = i === sorted.length
      || haversineMeters(sorted[anchor], sorted[i]) > radiusM;
    if (!outOfRange) continue;

    const first = sorted[anchor];
    const last = sorted[i - 1];
    const seconds = (last.timestamp - first.timestamp) / 1000;

    const atTripEdge = (first.timestamp - tripStart) / 1000 < edgeSeconds
      || (tripEnd - last.timestamp) / 1000 < edgeSeconds;

    if (seconds >= minSeconds && seconds <= maxSeconds && !atTripEdge) {
      stops.push({
        lat: (first.lat + last.lat) / 2,
        lon: (first.lon + last.lon) / 2,
        startedAt: first.timestamp,
        seconds: Math.round(seconds),
      });
    }
    anchor = i;
  }
  return stops;
}

/**
 * Группировка остановок по месту.
 * Жадная: каждая остановка идёт в первое достаточно близкое место, иначе
 * заводит новое. Точности достаточно — расстояния здесь десятки метров,
 * а не сантиметры.
 */
export function clusterStops(stops, { radiusM = SAME_PLACE_M } = {}) {
  const places = [];
  for (const stop of stops || []) {
    const place = places.find(p => haversineMeters(p, stop) <= radiusM);
    if (place) {
      place.stops.push(stop);
      // Центр подтягиваем к среднему: иначе место «уползает» за первой точкой.
      place.lat = place.stops.reduce((s, x) => s + x.lat, 0) / place.stops.length;
      place.lon = place.stops.reduce((s, x) => s + x.lon, 0) / place.stops.length;
    } else {
      places.push({ lat: stop.lat, lon: stop.lon, stops: [stop] });
    }
  }
  return places;
}

/** Медиана. Одно десятиминутное стояние за поездом не должно двигать оценку. */
export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * Места, где стоите регулярно, от самых затратных по времени.
 *
 * Сортировка по суммарным потерям, а не по длительности одной остановки:
 * перекрёсток, где вы стоите по сорок секунд дважды в день, забирает больше
 * жизни, чем шлагбаум, у которого вы простояли три минуты один раз.
 */
export function recurringStops(tripsPoints, {
  minVisits = MIN_VISITS,
  ...options
} = {}) {
  const all = [];
  for (const points of tripsPoints || []) all.push(...findStops(points, options));

  return clusterStops(all, options)
    .filter(place => place.stops.length >= minVisits)
    .map(place => {
      const seconds = place.stops.map(s => s.seconds);
      return {
        lat: place.lat,
        lon: place.lon,
        visits: place.stops.length,
        medianSeconds: median(seconds),
        maxSeconds: Math.max(...seconds),
        totalSeconds: seconds.reduce((a, b) => a + b, 0),
        // По часам — видно, что утром здесь дольше, чем днём.
        byHour: hourBuckets(place.stops),
      };
    })
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
}

function hourBuckets(stops) {
  const buckets = new Map();
  for (const stop of stops) {
    const hour = new Date(stop.startedAt).getHours();
    if (!buckets.has(hour)) buckets.set(hour, []);
    buckets.get(hour).push(stop.seconds);
  }
  return [...buckets.entries()]
    .map(([hour, seconds]) => ({ hour, visits: seconds.length, medianSeconds: median(seconds) }))
    .sort((a, b) => a.hour - b.hour);
}

export const DEFAULTS = {
  MIN_STOP_SEC, MAX_STOP_SEC, STILL_RADIUS_M, SAME_PLACE_M, MIN_VISITS, TRIP_EDGE_SEC,
};
