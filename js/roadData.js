import { DB, getSetting, setSetting } from './db.js';
import { speedLimitAt, signalAhead } from './roadRules.js';

/**
 * Дорожные данные из OpenStreetMap: ограничения скорости и светофоры.
 *
 * Это единственное место, где приложение по своей воле обращается наружу
 * ради данных о том, где человек едет. Поэтому устроено так, чтобы отдавать
 * наружу как можно меньше:
 *
 *   — запрос идёт не по точке, а по КВАДРАТУ примерно два на два километра.
 *     Внешний сервер узнаёт «кто-то в этом районе», а не «машина вот здесь»;
 *   — каждый квадрат запрашивается один раз и хранится месяц. По привычному
 *     маршруту запросов не будет вовсе;
 *   — всё выключено, пока человек не включил сам.
 *
 * Знаки и разметка в OSM неполны и местами устарели. Поэтому подсказка
 * молчит там, где не уверена, а в интерфейсе прямо сказано, что это данные
 * карты, а не показания дорожного знака.
 */

const ENABLED_KEY = 'roadDataEnabled';
const ENDPOINT = 'https://overpass-api.de/api/interpreter';

// Сторона квадрата в градусах. На широте Нижнего Новгорода это примерно
// 2,2 км по вертикали и 1,2 км по горизонтали — достаточно крупно, чтобы
// по запросу нельзя было понять, где именно машина.
const TILE_DEG = 0.02;

// Месяц: знаки меняются нечасто, а лишние запросы — это и нагрузка на
// чужой бесплатный сервер, и лишние поводы засветиться.
const TILE_TTL_MS = 30 * 864e5;

const REQUEST_TIMEOUT_MS = 25_000;

let memory = new Map();          // квадрат → данные, чтобы не читать базу на каждой точке
const inFlight = new Map();      // квадрат → обещание, чтобы не запрашивать дважды

export async function isEnabled() {
  return (await getSetting(ENABLED_KEY, false)) === true;
}

export async function setEnabled(on) {
  await setSetting(ENABLED_KEY, !!on);
  if (!on) {
    memory.clear();
    inFlight.clear();
  }
}

/** Ключ квадрата, в котором лежит точка. */
export function tileKey(lat, lon) {
  const y = Math.floor(lat / TILE_DEG);
  const x = Math.floor(lon / TILE_DEG);
  return `${y}:${x}`;
}

/** Границы квадрата по его ключу. */
export function tileBounds(key) {
  const [y, x] = key.split(':').map(Number);
  return {
    south: y * TILE_DEG,
    west: x * TILE_DEG,
    north: (y + 1) * TILE_DEG,
    east: (x + 1) * TILE_DEG,
  };
}

/** Соседние квадраты: у края квадрата дорога впереди лежит уже в следующем. */
export function tilesAround(lat, lon) {
  const keys = new Set();
  for (const dy of [-TILE_DEG, 0, TILE_DEG]) {
    for (const dx of [-TILE_DEG, 0, TILE_DEG]) {
      keys.add(tileKey(lat + dy, lon + dx));
    }
  }
  return [...keys];
}

/** Запрос к Overpass по квадрату. Возвращает дороги с ограничением и светофоры. */
export function buildQuery(bounds) {
  const box = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  return `[out:json][timeout:25];(way["highway"]["maxspeed"](${box});node["highway"="traffic_signals"](${box}););out geom;`;
}

/** Разбор ответа Overpass в наш вид. */
export function parseOverpass(body) {
  const ways = [];
  const signals = [];
  for (const element of body?.elements || []) {
    if (element.type === 'way' && element.geometry?.length) {
      ways.push({
        id: element.id,
        maxspeed: element.tags?.maxspeed,
        nodes: element.geometry.map(g => ({ lat: g.lat, lon: g.lon })),
      });
    } else if (element.type === 'node') {
      signals.push({ id: element.id, lat: element.lat, lon: element.lon });
    }
  }
  return { ways, signals };
}

async function loadTile(key, fetchImpl = fetch) {
  if (memory.has(key)) return memory.get(key);
  if (inFlight.has(key)) return inFlight.get(key);

  const cached = await DB.get('roadTiles', key);
  if (cached && Date.now() - cached.fetchedAt < TILE_TTL_MS) {
    memory.set(key, cached);
    return cached;
  }

  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(buildQuery(tileBounds(key))),
      });
      if (!res.ok) throw new Error('overpass_' + res.status);

      const tile = { key, ...parseOverpass(await res.json()), fetchedAt: Date.now() };
      await DB.put('roadTiles', tile);
      memory.set(key, tile);
      return tile;
    } catch {
      // Сеть недоступна или сервер отказал — это не повод ломать поездку.
      // Просроченные данные лучше никаких: знаки меняются редко.
      if (cached) {
        memory.set(key, cached);
        return cached;
      }
      return null;
    } finally {
      clearTimeout(timer);
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/**
 * Подгрузить данные вокруг точки. Вызывается редко — при смене квадрата,
 * а не на каждом отсчёте GPS.
 */
export async function ensureAround(lat, lon, fetchImpl) {
  if (!(await isEnabled())) return;
  await Promise.all(tilesAround(lat, lon).map(key => loadTile(key, fetchImpl)));
}

/** Данные вокруг точки из того, что уже загружено. Ничего не запрашивает. */
export function loadedAround(lat, lon) {
  const ways = [];
  const signals = [];
  for (const key of tilesAround(lat, lon)) {
    const tile = memory.get(key);
    if (!tile) continue;
    ways.push(...tile.ways);
    signals.push(...tile.signals);
  }
  return { ways, signals };
}

/**
 * Что показать водителю в этой точке.
 * @returns {{limit, signal}} любое поле может быть null — это норма.
 */
export function roadContext(point, headingDeg) {
  const { ways, signals } = loadedAround(point.lat, point.lon);
  return {
    limit: speedLimitAt(point, ways),
    signal: signalAhead(point, headingDeg, signals),
  };
}

/** Сколько квадратов лежит в кэше — показывается в настройках. */
export async function cachedTileCount() {
  return (await DB.getAll('roadTiles')).length;
}

export async function clearCache() {
  await DB.clear('roadTiles');
  memory.clear();
}

export const ROAD_DATA_DEFAULTS = { TILE_DEG, TILE_TTL_MS, ENDPOINT };
