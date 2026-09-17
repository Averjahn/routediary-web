/**
 * Состояние машины с сигнализацией StarLine — разбор для экрана.
 *
 * Чистый модуль: без сети и без DOM. Отдаёт РОВНО ТОТ ЖЕ вид, что и
 * pandoraState.js, — иначе экран пришлось бы писать дважды, и подписи на
 * двух сигнализациях со временем разъехались бы.
 *
 * У StarLine флаги приходят готовыми полями (arm, ign, door…), а не битами
 * одного числа, как у Pandora. Зато нет уровня топлива, пробега и оборотов:
 * там, где их нет, честный null, а не ноль.
 */

/** Порядок кнопок. Имена совпадают с COMMANDS в server/starline.js. */
export const COMMAND_ORDER = Object.freeze([
  'lock', 'unlock', 'start', 'stop', 'heater_on', 'heater_off', 'horn', 'trunk_disarm', 'locate',
]);

/** Снять с охраны и завести — только со второго нажатия, как и у Pandora. */
export const NEEDS_CONFIRM = Object.freeze(new Set(['unlock', 'start']));

/**
 * Какая кнопка StarLine нужна блоку, чтобы наша кнопка имела смысл.
 * Слева — наше имя, справа — любые подходящие псевдонимы StarLine.
 */
const REQUIRES = Object.freeze({
  lock: ['arm', 'arm_start'],
  unlock: ['arm', 'arm_stop'],
  start: ['ign', 'ign_start'],
  stop: ['ign', 'ign_stop'],
  heater_on: ['webasto', 'webasto_on'],
  heater_off: ['webasto', 'webasto_off'],
  horn: ['poke'],
  trunk_disarm: ['disarm_trunk'],
});

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function summarize(raw, nowMs = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const cs = raw.car_state && typeof raw.car_state === 'object' ? raw.car_state : null;
  const pos = raw.position && typeof raw.position === 'object' ? raw.position : {};
  const lat = num(pos.x);
  const lon = num(pos.y);
  const hasPosition = lat !== null && lon !== null
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
  const seenAt = num(raw.seen_at);

  return {
    online: Boolean(raw.online),
    hasPosition,
    lat: hasPosition ? lat : null,
    lon: hasPosition ? lon : null,
    speedKmh: num(pos.s),
    // Этих датчиков у StarLine в сводке нет — и придумывать их нельзя.
    fuelPct: null,
    mileageKm: null,
    rpm: null,
    outTemp: null,
    voltage: num(raw.battery),
    engineTemp: num(raw.etemp),
    cabinTemp: num(raw.ctemp),
    bits: cs ? {
      locked: Boolean(cs.arm),
      alarm: Boolean(cs.alarm),
      engineRunning: Boolean(cs.ign),
      ignition: Boolean(cs.run),
      autostartActive: Boolean(cs.r_start),
      anyDoorOpen: Boolean(cs.door),
      trunkOpen: Boolean(cs.trunk),
      hoodOpen: Boolean(cs.hood),
      heaterActive: Boolean(cs.webasto),
      serviceMode: Boolean(cs.valet),
    } : null,
    seenAgoSec: seenAt ? Math.max(0, Math.round(nowMs / 1000 - seenAt)) : null,
  };
}

/**
 * Кнопки для этого блока. controls — список псевдонимов из ctrls_library
 * или null, если спросить не удалось: тогда показываем всё, и блок сам
 * откажет, если чего-то не умеет.
 *
 * «Обновить координаты» показываем всегда: это не кнопка управления
 * машиной, а просьба прислать свежую точку.
 */
export function availableCommands(controls) {
  if (!Array.isArray(controls)) return [...COMMAND_ORDER];
  const has = new Set(controls);
  return COMMAND_ORDER.filter((name) => {
    const need = REQUIRES[name];
    return !need || need.some(alias => has.has(alias));
  });
}
