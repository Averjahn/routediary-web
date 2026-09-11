/**
 * Состояние машины с сигнализацией Pandora — разбор для экрана.
 *
 * Чистый модуль: без сети и без DOM, поэтому проверяется в node целиком.
 * Сеть и окно — в carConnect.js.
 *
 * Флаги (закрыта ли машина, открыты ли двери, работает ли двигатель) лежат
 * в одном числе bit_state_1. Сервер присылает его строкой: как число оно
 * больше 2^53, и JavaScript потерял бы как раз младшие биты. Раскладываем
 * через BigInt.
 */

/** Номера битов bit_state_1 — из BitStatus библиотеки python-pandora-cas. */
export const BITS = Object.freeze({
  locked: 0,
  alarm: 1,
  engineRunning: 2,
  ignition: 3,
  autostartActive: 4,
  doorDriver: 21,
  doorPassenger: 22,
  doorBackLeft: 23,
  doorBackRight: 24,
  trunkOpen: 25,
  hoodOpen: 26,
  handbrake: 27,
  heaterActive: 29,
  serviceMode: 34,
});

/** Порядок кнопок на экране. Имена совпадают с COMMANDS в server/pandora.js. */
export const COMMAND_ORDER = Object.freeze([
  'lock', 'unlock', 'start', 'stop', 'trunk', 'heater_on', 'heater_off', 'horn', 'light',
]);

/**
 * Команды, которые требуют второго нажатия. Снять с охраны и завести
 * мотор — то, что не должно случиться от случайного касания в кармане.
 */
export const NEEDS_CONFIRM = Object.freeze(new Set(['unlock', 'start', 'trunk']));

export function decodeBits(value) {
  if (value === undefined || value === null || value === '') return null;
  let n;
  try { n = BigInt(String(value)); } catch { return null; }
  if (n < 0n) return null;
  const out = {};
  for (const [name, bit] of Object.entries(BITS)) {
    out[name] = ((n >> BigInt(bit)) & 1n) === 1n;
  }
  out.anyDoorOpen = out.doorDriver || out.doorPassenger || out.doorBackLeft || out.doorBackRight;
  return out;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Состояние для экрана. Всё, чего блок не прислал, — null, а не ноль:
 * «0 % топлива» и «датчика топлива нет» — разные вещи.
 */
export function summarize(raw, nowMs = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = num(raw.x);
  const lon = num(raw.y);
  // Ноль-ноль — не место в Гвинейском заливе, а «координат нет».
  const hasPosition = lat !== null && lon !== null
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
  const seenAt = num(raw.seen_at);
  return {
    online: Boolean(raw.online),
    hasPosition,
    lat: hasPosition ? lat : null,
    lon: hasPosition ? lon : null,
    speedKmh: num(raw.speed),
    fuelPct: num(raw.fuel),
    voltage: num(raw.voltage),
    engineTemp: num(raw.engine_temp),
    cabinTemp: num(raw.cabin_temp),
    outTemp: num(raw.out_temp),
    mileageKm: num(raw.mileage),
    rpm: num(raw.engine_rpm),
    bits: decodeBits(raw.bit_state_1),
    seenAgoSec: seenAt ? Math.max(0, Math.round(nowMs / 1000 - seenAt)) : null,
  };
}

/**
 * Какие кнопки показывать. Блок сообщает, что умеет; если не сообщил
 * (features === null), показываем всё — лучше честный отказ от Pandora
 * на нажатие, чем спрятанный автозапуск у машины, где он есть.
 */
export function availableCommands(features) {
  if (!features) return [...COMMAND_ORDER];
  return COMMAND_ORDER.filter((name) => {
    if (name === 'start' || name === 'stop') return features.autostart;
    if (name === 'heater_on' || name === 'heater_off') return features.heater;
    if (name === 'trunk') return features.trunk;
    return true;
  });
}
