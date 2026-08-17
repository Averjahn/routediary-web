import { AppState } from './state.js';
import { t } from './i18n.js';
import { getSetting, setSetting } from './db.js';
import { ensureAround, roadContext, isEnabled as roadDataEnabled } from './roadData.js';
import { overspeedState } from './roadRules.js';

/**
 * Проекция скорости на лобовое стекло.
 *
 * Телефон кладётся экраном вверх на панель, и в стекле видно отражение.
 * Отсюда всё устройство экрана:
 *
 *   — цифры зеркальные, иначе в отражении они читаются наоборот;
 *   — фон чёрный, светится только число: любой светлый участок отразится
 *     мутным пятном поверх дороги;
 *   — янтарный цвет, а не белый: он заметно меньше слепит ночью и не спорит
 *     с фарами встречных;
 *   — ничего лишнего на экране. Человек за рулём, и всё, что не скорость,
 *     здесь только отвлекает.
 *
 * Отдельно про «залипшую» скорость: если связь со спутниками потерялась,
 * показывать последнее известное число нельзя — на стекле оно неотличимо
 * от настоящего, и водитель будет уверен, что едет 60. Поэтому через
 * несколько секунд без свежих данных вместо числа появляются прочерки.
 */

/**
 * Стили проекции — проверенный набор, а не произвольный выбор цвета.
 *
 * Почему не колесо RGB: это экран, который отражается в лобовом стекле
 * ночью. Белый и голубой на полной яркости слепят и накладываются на
 * дорогу; произвольный выбор позволил бы человеку невольно сделать себе
 * хуже. Поэтому цветов три, и каждый существует в настоящих автомобильных
 * и авиационных приборах:
 *   amber — классика приборных панелей, минимально слепит (по умолчанию);
 *   green — цвет авиационных HUD, максимальная различимость;
 *   red   — тускло-красный, лучше всех сохраняет ночную адаптацию глаза
 *           (им светят в кабинах и обсерваториях).
 */
export const HUD_COLORS = {
  amber: { id: 'amber', hex: '#ffb000' },
  green: { id: 'green', hex: '#39d27a' },
  red:   { id: 'red',   hex: '#e8544a' },
};

/** Начертания цифры. Все — системные шрифты: грузить веб-шрифт ради HUD
    значило бы задержать открытие ровно того экрана, что нужен на ходу. */
export const HUD_FONTS = {
  mono:    { id: 'mono' },     // моноширинный жирный — по умолчанию
  rounded: { id: 'rounded' },  // скруглённый — мягче в отражении
  thin:    { id: 'thin' },     // тонкий — меньше света в тёмной машине
};

export const HUD_DEFAULT_COLOR = 'amber';
export const HUD_DEFAULT_FONT = 'mono';
const HUD_COLOR_KEY = 'hudColor';
const HUD_FONT_KEY = 'hudFont';

export async function getHudStyle() {
  const color = await getSetting(HUD_COLOR_KEY, HUD_DEFAULT_COLOR);
  const font = await getSetting(HUD_FONT_KEY, HUD_DEFAULT_FONT);
  return {
    color: HUD_COLORS[color] ? color : HUD_DEFAULT_COLOR,
    font: HUD_FONTS[font] ? font : HUD_DEFAULT_FONT,
  };
}

export async function setHudStyle({ color, font }) {
  if (color && HUD_COLORS[color]) await setSetting(HUD_COLOR_KEY, color);
  if (font && HUD_FONTS[font]) await setSetting(HUD_FONT_KEY, font);
}

// Точность хуже 50 м — то же ограничение, что и в записи маршрута:
// по таким данным скорость получается фантастической.
const ACCURACY_LIMIT_M = 50;

// Дольше этого без свежих данных — показываем прочерки вместо числа.
const STALE_MS = 5000;

// Разрыв между отсчётами, при котором ещё можно считать скорость по пройденному
// расстоянию. Больше — слишком грубо, чтобы этому верить.
const MAX_GAP_S = 10;

// Быстрее этого по земле не ездят: скачок координат, а не движение.
const MAX_PLAUSIBLE_MS = 70;

// Сглаживание. Меньше — спокойнее цифра, но медленнее реакция на разгон.
const SMOOTHING = 0.4;

const MS_TO_KMH = 3.6;
const KMH_TO_MPH = 1 / 1.60934;

function metersBetween(a, b) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Счётчик скорости.
 *
 * Держит сглаженное значение и умеет честно сказать «не знаю».
 * Вынесен отдельно от экрана, чтобы его можно было проверить тестами:
 * ошибка здесь смотрит водителю в лобовое стекло.
 */
export function createSpeedMeter({
  accuracyLimitM = ACCURACY_LIMIT_M,
  staleMs = STALE_MS,
  smoothing = SMOOTHING,
} = {}) {
  let smoothed = null;      // м/с
  let lastFix = null;       // последний принятый отсчёт
  let lastAcceptedAt = null;

  /**
   * @param {object} sample {timestamp, lat, lon, speed (м/с или null), accuracy}
   * @returns {boolean} принят ли отсчёт
   */
  function update(sample) {
    if (!sample || !Number.isFinite(sample.timestamp)) return false;
    if (Number.isFinite(sample.accuracy) && sample.accuracy > accuracyLimitM) return false;

    let speedMs = null;

    // Скорость от приёмника точнее посчитанной по двум точкам: она берётся
    // из доплеровского сдвига, а не из разности координат с их погрешностью.
    if (Number.isFinite(sample.speed) && sample.speed >= 0) {
      speedMs = sample.speed;
    } else if (lastFix) {
      const dtSec = (sample.timestamp - lastFix.timestamp) / 1000;
      if (dtSec > 0 && dtSec <= MAX_GAP_S) {
        speedMs = metersBetween(lastFix, sample) / dtSec;
      }
    }

    lastFix = sample;
    if (speedMs == null || speedMs > MAX_PLAUSIBLE_MS) return false;

    smoothed = smoothed == null ? speedMs : smoothed + smoothing * (speedMs - smoothed);
    lastAcceptedAt = sample.timestamp;
    return true;
  }

  /** Что показывать сейчас. null — данных нет или они устарели. */
  function read(now) {
    if (smoothed == null || lastAcceptedAt == null) return null;
    if (now - lastAcceptedAt > staleMs) return null;
    return smoothed * MS_TO_KMH;
  }

  function reset() {
    smoothed = null;
    lastFix = null;
    lastAcceptedAt = null;
  }

  return { update, read, reset };
}

/** Число и подпись для экрана. Прочерки, когда скорости нет. */
export function displaySpeed(kmh, units) {
  const imperial = units === 'imperial';
  const unit = t(imperial ? 'unit.mph' : 'unit.kmh');
  if (kmh == null) return { value: '– –', unit };
  const shown = imperial ? kmh * KMH_TO_MPH : kmh;
  return { value: String(Math.max(0, Math.round(shown))), unit };
}

// --- Экран ---

let overlay = null;
let watchId = null;
let wakeLock = null;
let timer = null;
let roadTimer = null;
let hideControlsTimer = null;

const MIRROR_KEY = 'hudMirror';

export function isOpen() {
  return !!overlay;
}

/**
 * Открыть проекцию.
 * Возвращает false, если геолокация недоступна — звать её незачем.
 */
export async function openHud() {
  if (overlay) return true;
  if (!('geolocation' in navigator)) return false;

  const mirrored = (await getSetting(MIRROR_KEY, true)) !== false;
  const meter = createSpeedMeter();

  const style = await getHudStyle();
  overlay = document.createElement('div');
  overlay.className = `hud hud-font-${style.font}`;
  overlay.style.setProperty('--hud-color', HUD_COLORS[style.color].hex);
  overlay.innerHTML = `
    <div class="hud-plate${mirrored ? ' mirrored' : ''}" id="hud-plate">
      <div class="hud-limit" id="hud-limit" hidden>
        <div class="hud-limit-sign" id="hud-limit-value"></div>
        <div class="hud-limit-note" id="hud-limit-note"></div>
      </div>
      <div class="hud-value" id="hud-value">– –</div>
      <div class="hud-unit" id="hud-unit"></div>
      <div class="hud-signal" id="hud-signal" hidden></div>
    </div>
    <div class="hud-controls" id="hud-controls">
      <button class="hud-btn" id="hud-mirror" aria-pressed="${mirrored}"></button>
      <button class="hud-btn" id="hud-close"></button>
    </div>
    <div class="hud-hint" id="hud-hint" data-i18n="hud.hint"></div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('hud-open');

  const plate = overlay.querySelector('#hud-plate');
  const valueEl = overlay.querySelector('#hud-value');
  const unitEl = overlay.querySelector('#hud-unit');
  const limitBox = overlay.querySelector('#hud-limit');
  const limitValue = overlay.querySelector('#hud-limit-value');
  const limitNote = overlay.querySelector('#hud-limit-note');
  const signalEl = overlay.querySelector('#hud-signal');
  const controls = overlay.querySelector('#hud-controls');
  const hint = overlay.querySelector('#hud-hint');

  overlay.querySelector('#hud-mirror').textContent = t('hud.mirror');
  overlay.querySelector('#hud-close').textContent = t('common.close');
  hint.textContent = t('hud.hint');

  // Последнее известное положение и курс — для подсказок по дороге.
  let position = null;
  let heading = NaN;
  let road = { limit: null, signal: null };

  function render() {
    const kmh = meter.read(Date.now());
    const { value, unit } = displaySpeed(kmh, AppState.units);
    valueEl.textContent = value;
    unitEl.textContent = unit;

    // Цифра краснеет при превышении: на стекле это единственное, что водитель
    // успевает заметить боковым зрением, не отводя глаз от дороги.
    const state = road.limit ? overspeedState(kmh, road.limit.kmh) : 'ok';
    plate.classList.toggle('over', state === 'over');
    plate.classList.toggle('near', state === 'near');

    if (road.limit) {
      limitBox.hidden = false;
      limitValue.textContent = road.limit.kmh;
      // Общее ограничение и знак выглядят одинаково в данных, но по-разному
      // для водителя: под знаком он его увидит, под общим — искать нечего.
      limitNote.textContent = t(road.limit.source === 'sign' ? 'road.from_sign' : 'road.from_default');
    } else {
      limitBox.hidden = true;
    }

    if (road.signal) {
      signalEl.hidden = false;
      signalEl.textContent = t('road.signal_ahead', { meters: road.signal.distance });
    } else {
      signalEl.hidden = true;
    }
  }
  render();

  timer = setInterval(render, 250);

  // Дорожные данные подтягиваются редко: раз в несколько секунд, и только
  // когда человек включил их сам. Внутри проверяется, не загружен ли квадрат
  // уже — по привычному маршруту сеть не тревожится вовсе.
  if (await roadDataEnabled()) {
    roadTimer = setInterval(() => {
      if (position) ensureAround(position.lat, position.lon).then(() => {
        road = roadContext(position, heading);
      }).catch(() => {});
    }, 5000);
  }

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      meter.update({
        timestamp: pos.timestamp || Date.now(),
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        speed: pos.coords.speed,
        accuracy: pos.coords.accuracy,
      });

      position = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (Number.isFinite(pos.coords.heading)) heading = pos.coords.heading;
      road = roadContext(position, heading);
      render();
    },
    () => { /* отказ в доступе — на экране останутся прочерки */ },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
  );

  // Экран не должен гаснуть: смысл проекции в том, что на неё не смотрят
  // и не трогают руками.
  await requestWakeLock();
  document.addEventListener('visibilitychange', onVisibility);

  overlay.querySelector('#hud-mirror').addEventListener('click', async (e) => {
    e.stopPropagation();
    const next = !plate.classList.contains('mirrored');
    plate.classList.toggle('mirrored', next);
    e.currentTarget.setAttribute('aria-pressed', String(next));
    await setSetting(MIRROR_KEY, next);
    showControls();
  });

  overlay.querySelector('#hud-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeHud();
  });

  // Кнопки прячутся сами: на стекле отражается всё, что светится.
  overlay.addEventListener('click', showControls);
  function showControls() {
    controls.classList.remove('faded');
    hint.classList.remove('faded');
    clearTimeout(hideControlsTimer);
    hideControlsTimer = setTimeout(() => {
      controls.classList.add('faded');
      hint.classList.add('faded');
    }, 4000);
  }
  showControls();

  return true;
}

export function closeHud() {
  if (!overlay) return;
  clearInterval(timer);
  clearInterval(roadTimer);
  clearTimeout(hideControlsTimer);
  timer = roadTimer = hideControlsTimer = null;

  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  document.removeEventListener('visibilitychange', onVisibility);
  releaseWakeLock();

  overlay.remove();
  overlay = null;
  document.body.classList.remove('hud-open');
}

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    // Не во всех браузерах есть; тогда экран погаснет по системным правилам.
    wakeLock = null;
  }
}

function releaseWakeLock() {
  try { wakeLock?.release(); } catch { /* уже отпущен */ }
  wakeLock = null;
}

/** Блокировка сна теряется при сворачивании — возвращаем её при возврате. */
function onVisibility() {
  if (document.visibilityState === 'visible' && overlay) requestWakeLock();
}
