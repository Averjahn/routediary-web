import { AppState } from './state.js';
import { t } from './i18n.js';
import { getSetting, setSetting } from './db.js';
import { ensureAround, roadContext, isEnabled as roadDataEnabled } from './roadData.js';
import { overspeedState } from './roadRules.js';
import { applyDigits } from './segmentDigits.js';
import { createMotionBridge } from './motionSpeed.js';
import { isRecording, startRecording } from './tracking.js';

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
 * Стили проекции — набор проверенный, а не колесо RGB.
 *
 * Это экран, который отражается в лобовом стекле. Цвет здесь не украшение:
 * он решает, различима ли цифра днём и не слепит ли ночью. Поэтому каждый
 * вариант существует в настоящих приборах, а не подобран на глаз.
 *
 * Свойство, о котором стоит знать заранее: чем краснее свет, тем он темнее
 * при той же насыщенности — так устроен глаз, у него пик чувствительности
 * лежит в жёлто-зелёном. Отсюда и порядок: лаймовый и ледяной видно лучше
 * всего днём, красный — хуже всех, зато он единственный не сбивает ночную
 * адаптацию зрения.
 */
export const HUD_COLORS = {
  amber:  { id: 'amber',  hex: '#ffb000' },  // классика приборных панелей (по умолчанию)
  green:  { id: 'green',  hex: '#39d27a' },  // цвет авиационных HUD
  red:    { id: 'red',    hex: '#e8544a' },  // сохраняет ночную адаптацию глаза
  ice:    { id: 'ice',    hex: '#4fd8e8' },  // холодный голубой заводских автомобильных HUD
  white:  { id: 'white',  hex: '#edeff2' },  // максимальная различимость днём, ночью резковат
  lime:   { id: 'lime',   hex: '#c8e645' },  // пик чувствительности глаза — виден дальше всех
  violet: { id: 'violet', hex: '#b18cff' },
  pink:   { id: 'pink',   hex: '#ff7bb0' },
};

/**
 * Начертания цифры.
 *
 * Все, кроме сегментного, — системные: веб-шрифт задержал бы ровно тот экран,
 * который нужен уже на ходу, и потянул бы загрузку со стороннего сервера.
 * Сегментное начертание системным быть не может — его нет ни в одной системе,
 * поэтому цифры собираются из палочек и рисуются (см. segmentDigits.js).
 */
export const HUD_FONTS = {
  mono:    { id: 'mono' },     // моноширинный жирный — по умолчанию
  segment: { id: 'segment' },  // электронные часы: цифра из семи палочек
  rounded: { id: 'rounded' },  // скруглённый — мягче в отражении
  thin:    { id: 'thin' },     // тонкий — меньше света в тёмной машине
  heavy:   { id: 'heavy' },    // плотный — самый заметный днём
  italic:  { id: 'italic' },   // наклонный
  serif:   { id: 'serif' },    // с засечками
  outline: { id: 'outline' },  // контурный — светится только обводка
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
// по таким данным скорость, посчитанная ПО КООРДИНАТАМ, получается
// фантастической.
const ACCURACY_LIMIT_M = 50;

// Отдельный, куда более мягкий порог для скорости от самого приёмника.
//
// Он меряет её по доплеровскому сдвигу частоты, а не по разности точек,
// поэтому обычная городская погрешность места (60–150 м среди домов) на
// скорость почти не влияет. Но связь всё же есть на краю: точность в
// сотни метров означает, что спутников почти не видно, — а без них не
// сойдётся и решение по скорости. Здесь проходит граница между «место
// знаем плохо, скорость знаем хорошо» и «не знаем ничего».
const SPEED_ACCURACY_LIMIT_M = 200;

// Дольше этого без свежих данных — показываем прочерки вместо числа.
const STALE_MS = 5000;

// Разрыв между отсчётами, при котором ещё можно считать скорость по пройденному
// расстоянию. Больше — слишком грубо, чтобы этому верить.
const MAX_GAP_S = 10;

// Быстрее этого по земле не ездят: скачок координат, а не движение.
const MAX_PLAUSIBLE_MS = 70;

// Сглаживание в спокойном состоянии. Меньше — ровнее цифра.
const SMOOTHING = 0.4;

// Насколько должна измениться скорость между отсчётами, чтобы поверить ей
// целиком и показать сразу.
//
// Дрожание приёмника — это десятые доли метра в секунду. Настоящее
// торможение — метры: даже спокойное это 2–3 м/с², а между отсчётами
// проходит около секунды. Числа разделяются больше чем на порядок, поэтому
// одно и то же сглаживание для обоих случаев выбирать не нужно: на мелких
// колебаниях остаётся прежняя выдержка, на настоящем изменении она уходит.
//
// Раньше выдержка была одна на всё, и после торможения с 90 до 50 стекло
// ещё несколько секунд показывало числа, которых уже нет: до 63% значение
// доходило за пару отсчётов, до 90% — за четыре-пять.
const REAL_CHANGE_MS = 3;

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
  speedAccuracyLimitM = SPEED_ACCURACY_LIMIT_M,
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

    // Точность КООРДИНАТЫ и точность СКОРОСТИ — разные вещи, и это главное
    // здесь. Приёмник меряет скорость по доплеровскому сдвигу частоты, а не
    // по разности двух точек: в городе среди домов точность места легко
    // уходит за сотню метров, а скорость при этом остаётся верной до
    // десятых долей м/с.
    //
    // Раньше порог точности отбрасывал ВЕСЬ отсчёт, вместе с исправной
    // доплеровской скоростью — отсюда и брались прочерки на ровном месте,
    // особенно в городе. Теперь порог сторожит только тот путь, где
    // погрешность места действительно превращается в погрешность скорости:
    // расчёт по двум координатам.
    const placeIsAccurate = !Number.isFinite(sample.accuracy) || sample.accuracy <= accuracyLimitM;
    const fixIsUsable = !Number.isFinite(sample.accuracy) || sample.accuracy <= speedAccuracyLimitM;

    let speedMs = null;
    if (fixIsUsable && Number.isFinite(sample.speed) && sample.speed >= 0) {
      speedMs = sample.speed;
    } else if (placeIsAccurate && lastFix) {
      const dtSec = (sample.timestamp - lastFix.timestamp) / 1000;
      if (dtSec > 0 && dtSec <= MAX_GAP_S) {
        speedMs = metersBetween(lastFix, sample) / dtSec;
      }
    }

    // Опорной точкой для расчёта по расстоянию становится только та, которой
    // можно верить. Неточную запоминать нельзя: следующий отсчёт посчитал бы
    // расстояние от заведомо кривого места и выдал бы фантастическую скорость.
    if (placeIsAccurate) lastFix = sample;
    if (speedMs == null || speedMs > MAX_PLAUSIBLE_MS) return false;

    if (smoothed == null) {
      smoothed = speedMs;
    } else {
      // Доля доверия к новому отсчёту растёт вместе с величиной изменения:
      // от обычной выдержки на мелком дрожании до полного доверия, когда
      // скорость изменилась настолько, что случайностью это быть не может.
      // Ослабить сглаживание можно, усилить — нет: при smoothing = 1 (без
      // сглаживания вовсе) доля остаётся единицей при любом изменении.
      const change = Math.abs(speedMs - smoothed);
      const trust = smoothing + (1 - smoothing) * Math.min(1, change / REAL_CHANGE_MS);
      smoothed += trust * (speedMs - smoothed);
    }
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
// Панель ещё создаётся: overlay пуст, но открывать вторую уже нельзя.
let opening = false;
// Мост по акселерометру и подписка на него — живут ровно пока открыта панель.
let bridge = null;
let onMotion = null;
let watchId = null;
let wakeLock = null;
let timer = null;
let roadTimer = null;
let hideControlsTimer = null;

const MIRROR_KEY = 'hudMirror';

/**
 * Достраивать ли скорость датчиком между отсчётами спутников.
 *
 * Выключено по умолчанию, и это не осторожность ради осторожности:
 * на iOS датчик требует отдельного разрешения, а работает всё это только
 * когда телефон ЗАКРЕПЛЁН. Человек, который держит телефон в руке,
 * получил бы бодро скачущее и неверное число вместо честно устаревшего.
 * Включается осознанно, из настроек, где рядом написано про держатель.
 */
export const MOTION_KEY = 'hudMotionAssist';

/** Есть ли датчик в принципе. */
export function motionAvailable() {
  return typeof DeviceMotionEvent !== 'undefined';
}

/**
 * Спросить разрешение на датчик.
 *
 * Вызывать ТОЛЬКО прямо из обработчика касания: на iOS 13+ запрос вне
 * жеста молча отклоняется, а второй раз его уже не покажут. Поэтому
 * переключатель в настройках зовёт эту функцию синхронно, а проекция
 * потом лишь подписывается на события — разрешение к тому моменту есть.
 */
export async function requestMotionAccess() {
  if (!motionAvailable()) return false;
  const ask = DeviceMotionEvent.requestPermission;
  if (typeof ask !== 'function') return true;   // Android и настольные — без спроса
  try {
    return (await ask.call(DeviceMotionEvent)) === 'granted';
  } catch {
    // На iOS запрос вне жеста бросает исключение. Отказ — это отказ.
    return false;
  }
}

export function isOpen() {
  return !!overlay;
}

/**
 * Начать запись поездки, если она ещё не идёт.
 *
 * Проекцию открывают в одном случае: человек сел за руль и поехал.
 * Раньше он всю дорогу видел скорость, а поездка при этом не писалась —
 * маршрут терялся целиком, и узнавал он об этом только вечером, открыв
 * пустой день. Просить его нажать ещё и «Запись» бессмысленно: он уже
 * сказал приложению, что едет, самим фактом открытия спидометра.
 *
 * Возвращает true, только если запись начали ИМЕННО СЕЙЧАС, — чтобы не
 * сообщать о начале сессии тому, кто включил её сам минуту назад.
 */
async function startSession() {
  try {
    if (await isRecording()) return false;
    await startRecording();
    return true;
  } catch {
    // Отказ в геолокации гасим здесь намеренно. Без неё проекция всё
    // равно откроется и покажет прочерк вместо скорости — решение о
    // том, показывать её или нет, принимает openHud ниже, и падение
    // записи не должно подменять собой это решение.
    return false;
  }
}

/**
 * Открыть проекцию.
 * Возвращает false, если геолокация недоступна — звать её незачем.
 */
export async function openHud() {
  // Проверка стоит перед await'ами, а функция асинхронная: между ней и
  // созданием панели overlay ещё пуст, и второе нажатие проходило её
  // насквозь. Получались ДВЕ панели во весь экран, а ссылка оставалась
  // только на вторую — первая становилась неснимаемой и закрывала собой
  // всё приложение, включая собственную кнопку закрытия.
  if (overlay || opening) return true;
  if (!('geolocation' in navigator)) return false;

  let mirrored, meter, style;
  opening = true;
  try {
    mirrored = (await getSetting(MIRROR_KEY, true)) !== false;
    meter = createSpeedMeter();
    style = await getHudStyle();
  } finally {
    // Снимаем сразу после последнего await: дальше до появления overlay
    // идёт только синхронный код, прерваться там уже нечему. А через
    // finally флаг не залипнет, если чтение настроек не удалось.
    opening = false;
  }

  overlay = document.createElement('div');
  overlay.className = `hud hud-font-${style.font}`;
  overlay.style.setProperty('--hud-color', HUD_COLORS[style.color].hex);
  overlay.innerHTML = `
    <div class="hud-plate${mirrored ? ' mirrored' : ''}" id="hud-plate">
      <div class="hud-limit" id="hud-limit" hidden>
        <div class="hud-limit-sign" id="hud-limit-value"></div>
        <div class="hud-limit-note" id="hud-limit-note"></div>
      </div>
      <div class="hud-value hud-digits" id="hud-value"></div>
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
    const now = Date.now();
    const gpsKmh = meter.read(now);
    // Мост достраивает скорость между отсчётами спутников. Он сам решает,
    // когда молчать: без калибровки, на несвежих данных и при слабом
    // сопоставлении возвращает то же, что дал приёмник. Здесь только
    // выбираем — и падаем обратно на GPS при малейшем сомнении.
    let kmh = gpsKmh;
    if (bridge && gpsKmh != null) {
      const guess = bridge.read(now);
      if (guess && guess.bridged && Number.isFinite(guess.speedMs)) {
        kmh = guess.speedMs * MS_TO_KMH;
      }
    }
    const { value, unit } = displaySpeed(kmh, AppState.units);
    applyDigits(valueEl, value, style.font);
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

  // Датчик подключаем, только если человек включил его сам и разрешение
  // уже дано: спрашивать отсюда нельзя, вызов вне жеста на iOS пропадёт.
  if (await getSetting(MOTION_KEY, false) === true && motionAvailable()) {
    bridge = createMotionBridge();
    onMotion = (e) => {
      // acceleration — уже без гравитации, её считает сама система по
      // гироскопу, и делает это заведомо лучше любого нашего фильтра.
      // Без гироскопа поле пустое: тогда достраивать нечем, и это честно.
      const a = e.acceleration;
      const withG = e.accelerationIncludingGravity;
      if (!a || !withG || a.x == null || withG.x == null) return;
      bridge.addMotion(Date.now(),
        [a.x, a.y, a.z],
        [withG.x - a.x, withG.y - a.y, withG.z - a.z]);
    };
    window.addEventListener('devicemotion', onMotion);
  }

  // Чаще, когда есть чему меняться между отсчётами: смысл датчика в том,
  // что цифра идёт за торможением, а не ждёт следующей секунды.
  timer = setInterval(render, bridge ? 100 : 250);

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

      // Мост держится за то, что показано, а не за сырой отсчёт: иначе в
      // момент прихода спутников цифра дёргалась бы на разницу между ними.
      if (bridge) {
        const shown = meter.read(Date.now());
        if (shown != null) bridge.addFix(pos.timestamp || Date.now(), shown / MS_TO_KMH);
      }

      position = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (Number.isFinite(pos.coords.heading)) heading = pos.coords.heading;
      road = roadContext(position, heading);
      render();
    },
    () => { /* отказ в доступе — на экране останутся прочерки */ },
    // maximumAge: 0 — не отдавать сохранённый отсчёт вовсе. Была секунда, и
    // это ровно секунда задержки на стекле: браузер имел право вернуть
    // положение, снятое до того, как водитель нажал на тормоз. Для карты
    // такой запас экономил бы батарею, для спидометра он и есть «долго
    // обновляется».
    //
    // enableHighAccuracy обязателен по другой причине: без него браузер
    // считает положение по вышкам и Wi-Fi, а у такого решения скорости нет
    // вовсе — coords.speed приходит null, и на стекле висят прочерки.
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
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

  // Запись поднимаем ПОСЛЕ того, как панель собрана и показана: открытие
  // проекции не должно ждать разрешения на геолокацию для записи, у неё
  // уже есть своя. Сообщаем об этом в той же подсказке, где живёт совет
  // положить телефон на панель, — человек за рулём, отдельный диалог с
  // кнопкой «понятно» ему сейчас показывать нельзя.
  if (await startSession()) {
    hint.textContent = t('hud.session_started');
    showControls();
  }

  return true;
}

export function closeHud() {
  // Блокировку прокрутки снимаем безусловно, ДО всех проверок: если
  // панели уже нет, а класс остался, на body навсегда висит
  // overflow:hidden — страница выглядит совершенно обычной и просто не
  // прокручивается, без единой подсказки почему.
  document.body.classList.remove('hud-open');
  // Панель во весь экран, поверх всего (z-index 9000). Осиротевшая — та,
  // на которую потеряна ссылка, — закрыла бы приложение целиком, и закрыть
  // её было бы уже нечем: её собственная кнопка зовёт этот же closeHud().
  document.querySelectorAll('.hud').forEach(node => { if (node !== overlay) node.remove(); });
  // Датчик отписываем тоже безусловно и по той же причине: подписка
  // переживёт закрытие панели и будет будить процессор всю дорогу,
  // ничего при этом не показывая. Снаружи это видно только как
  // подозрительно быстро садящаяся батарея.
  if (onMotion) {
    window.removeEventListener('devicemotion', onMotion);
    onMotion = null;
  }
  bridge = null;

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
}

/**
 * Экран не должен гаснуть, пока открыта проекция.
 *
 * Способ первый — Screen Wake Lock API. Он правильный, но в Safari появился
 * только в iOS 16.4, а приложение живёт и на более старых айфонах: там
 * `navigator.wakeLock` отсутствует, и раньше это молча означало «экран
 * погаснет через минуту». Для проекции на стекло это не мелочь, а отказ
 * функции: водителю приходится разблокировать телефон на ходу — ровно то,
 * ради чего проекция и делалась.
 *
 * Способ второй, запасной — беззвучное видео в цикле. Пока на странице
 * проигрывается видео, система считает, что человек его смотрит, и экран
 * не гасит. Приём старый и общеизвестный, работает с iOS 10.
 *
 * Видео тут своё, а не из библиотеки: два кадра чёрного 64×64, полтора
 * килобайта, сгенерировано ffmpeg и вшито прямо сюда. Тянуть ради этого
 * зависимость или отдельный файл — дороже самого файла.
 *
 * `muted` + `playsinline` обязательны: без первого iOS не даст запустить
 * без нажатия, без второго — развернёт на весь экран поверх проекции.
 */
const KEEP_AWAKE_MP4 = 'data:video/mp4;base64,' +
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMsbW9vdgAAAGxtdmhkAAAAAAAAAAAA' +
  'AAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAA' +
  'AABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAlZ0cmFrAAAAXHRraGQAAAADAAAA' +
  'AAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAA' +
  'AAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAA' +
  'AAHObWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAgABVxAAAAAAALWhkbHIAAAAAAAAAAHZp' +
  'ZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABeW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAA' +
  'ACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAATlzdGJsAAAAuXN0c2QAAAAAAAAA' +
  'AQAAAKlhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFUxhdmM2' +
  'Mi4yOC4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAL2F2Y0MBQsAe/+EAF2dCwB7ZBCbARAAA' +
  'AwAEAAADAAg8WLkgAQAFaMuDyyAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAKcAAAAAAA' +
  'AAAYc3R0cwAAAAAAAAABAAAAAgAAQAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAA' +
  'AAEAAAABAAAAAgAAAAEAAAAcc3RzegAAAAAAAAAAAAAAAgAAApIAAAAKAAAAFHN0Y28AAAAAAAAA' +
  'AQAAA1wAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAA' +
  'AAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYyLjEyLjEwMgAAAAhmcmVlAAAC' +
  'pG1kYXQAAAJwBgX//2zcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIzIDA0ODBj' +
  'YjAgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDov' +
  'L3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MyBkZWJs' +
  'b2NrPTE6MDowIGFuYWx5c2U9MHgxOjB4MTExIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0x' +
  'LjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4' +
  'OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0' +
  'PS0yIHRocmVhZHM9MiBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBk' +
  'ZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9' +
  'MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD0yNTAga2V5aW50X21pbj0xIHNjZW5lY3V0PTQw' +
  'IGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4w' +
  'IHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6' +
  'MS4wMACAAAAAGmWIhAW///8PRQABT38nJyddddddddddddeAAAAABkGaOAr4Rg==';

let wakeVideo = null;

async function requestWakeLock() {
  // Правильный способ, если он есть.
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
    if (wakeLock) return;
  } catch {
    wakeLock = null;
  }

  // Запасной: беззвучное видео в цикле.
  if (wakeVideo) return;
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.muted = true;
  video.loop = true;
  video.src = KEEP_AWAKE_MP4;
  // Не display:none и не visibility:hidden — с ними воспроизведение
  // останавливается, и вместе с ним пропадает весь смысл. Поэтому видео
  // остаётся «видимым» для браузера, но не видимым для человека.
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0;';
  document.body.appendChild(video);
  wakeVideo = video;
  try {
    await video.play();
  } catch {
    // Не дали запустить — значит этого пути тут нет. Убираем за собой,
    // чтобы в теле страницы не болтался мёртвый элемент.
    releaseWakeLock();
  }
}

function releaseWakeLock() {
  try { wakeLock?.release(); } catch { /* уже отпущен */ }
  wakeLock = null;
  if (wakeVideo) {
    try { wakeVideo.pause(); } catch { /* уже остановлено */ }
    wakeVideo.remove();
    wakeVideo = null;
  }
}

/** Блокировка сна теряется при сворачивании — возвращаем её при возврате. */
function onVisibility() {
  if (document.visibilityState === 'visible' && overlay) requestWakeLock();
}
