import { getSetting, setSetting } from './db.js';
import { findStops } from './stops.js';
import { distanceMeters } from './roadRules.js';
import { loadedAround, ensureAround, isEnabled as roadEnabled } from './roadData.js';
import { programAt } from './signalTiming.js';
import { SIGNALS_ENABLED } from './features.js';

/**
 * Участие в общей копилке наблюдений за светофорами.
 *
 * Что уходит наружу: номер узла светофора в OpenStreetMap, момент старта,
 * длительность ожидания и программа суток. Всё. Ни аккаунта, ни
 * идентификатора устройства, ни координат, ни маршрута — наблюдения нельзя
 * связать ни друг с другом, ни с человеком. Запрос идёт БЕЗ токена
 * авторизации намеренно: токен как раз и связал бы их с аккаунтом.
 *
 * Выключено по умолчанию. Включается только вместе с дорожными данными:
 * без них неизвестно, где вообще светофоры.
 *
 * Про пользу говорим честно: чтобы вывести цикл одного светофора для одной
 * программы суток, нужны десятки наблюдений из разных дней. Пока людей мало,
 * это не даст ничего — и сервер вернёт «не знаю», а не догадку.
 */

const ENABLED_KEY = 'signalPoolEnabled';
// Отправленные поездки: без этого одни и те же наблюдения уезжали бы
// при каждом пересчёте сегментации и раздували чужую статистику.
const SENT_KEY = 'signalPoolSentTrips';
// Держим ограниченный хвост: список нужен, чтобы не слать повторно,
// а не чтобы хранить всю историю.
const SENT_MEMORY = 500;

// Насколько близко к светофору должна быть остановка, чтобы считаться его.
// Очередь на перекрёстке растягивается, но дальше это уже другой стоп.
const NEAR_SIGNAL_M = 40;

export async function isEnabled() {
  // Флаг сборки решает первым: пока светофоры выключены в MVP, копилка молчит
  // даже у тех, кто успел включить её раньше, — иначе наблюдения продолжали
  // бы уходить с экрана, которого в приложении уже нет.
  if (!SIGNALS_ENABLED) return false;
  return (await roadEnabled()) && (await getSetting(ENABLED_KEY, false)) === true;
}

export async function setEnabled(on) {
  await setSetting(ENABLED_KEY, !!on);
}

/**
 * Наблюдения из трека поездки.
 *
 * Берутся только остановки рядом с известным светофором: стояние в пробке
 * посреди улицы к фазам отношения не имеет и в копилку не идёт.
 */
export function observationsFromTrack(points, signals, { nearM = NEAR_SIGNAL_M } = {}) {
  const out = [];
  for (const stop of findStops(points)) {
    let nearest = null;
    for (const signal of signals || []) {
      const distance = distanceMeters(stop, signal);
      if (distance <= nearM && (!nearest || distance < nearest.distance)) {
        nearest = { signal, distance };
      }
    }
    if (!nearest) continue;

    // Момент старта — конец стояния: именно тогда загорелся зелёный.
    const departedAt = stop.startedAt + stop.seconds * 1000;
    out.push({
      signalKey: String(nearest.signal.id),
      program: programAt(departedAt),
      departedAt,
      waitSec: stop.seconds,
    });
  }
  return out;
}

async function post(path, body) {
  const { syncOrigin } = await import('./syncClient.js');
  const res = await fetch(syncOrigin() + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok ? res.json().catch(() => null) : null;
}

/**
 * Отправить наблюдения по поездкам, которые ещё не отправляли.
 * Молча ничего не делает, если участие выключено.
 *
 * @param {Array} trips [{id, points}]
 */
// Одновременные отправки: сегментация запускает свою в фоне, и второй
// вызов успевал прочитать ещё не обновлённый список отправленного — на
// сервер уходил дубль. Сервер его теперь отвергает, но и слать незачем.
let inFlight = null;

export async function contribute(trips) {
  if (inFlight) await inFlight.catch(() => {});
  inFlight = contributeInner(trips);
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

async function contributeInner(trips) {
  if (!(await isEnabled())) return 0;

  const sentIds = new Set((await getSetting(SENT_KEY)) || []);
  const fresh = (trips || []).filter(trip => trip?.id && !sentIds.has(trip.id));
  if (fresh.length === 0) return 0;

  const observations = [];
  for (const trip of fresh) {
    const points = trip.points || [];
    if (points.length === 0) continue;
    const middle = points[Math.floor(points.length / 2)];
    await ensureAround(middle.lat, middle.lon).catch(() => {});
    const { signals } = loadedAround(middle.lat, middle.lon);
    observations.push(...observationsFromTrack(points, signals));
  }

  // Поездку помечаем отправленной, даже если наблюдений в ней не нашлось:
  // иначе мы будем перебирать её заново после каждой пересегментации.
  const updated = [...sentIds, ...fresh.map(t => t.id)].slice(-SENT_MEMORY);
  await setSetting(SENT_KEY, updated);

  if (observations.length === 0) return 0;

  // Отправляем пачками: сервер принимает не больше полусотни за раз.
  let sent = 0;
  for (let i = 0; i < observations.length; i += 50) {
    const result = await post('/api/signals/observe', { observations: observations.slice(i, i + 50) });
    sent += result?.accepted || 0;
  }
  return sent;
}

/**
 * Собрать треки поездок за день и отправить.
 * Вызывается после пересчёта сегментации — тогда поездки уже нарезаны.
 */
export async function contributeDay(dayKey) {
  if (!(await isEnabled())) return 0;

  const { DB } = await import('./db.js');
  const trips = (await DB.getAllByIndex('trips', 'dayKey', dayKey))
    .filter(trip => trip.mode === 'car');

  const withPoints = [];
  for (const trip of trips) {
    withPoints.push({ id: trip.id, points: await DB.getAllByIndex('trackPoints', 'tripId', trip.id) });
  }
  return contribute(withPoints);
}

/**
 * Что известно по светофорам поблизости.
 *
 * Возвращает и готовые оценки, и счётчики по тем, где данных ещё не хватает:
 * «копится» и «ничего нет» — разные вещи, и человек должен видеть, какая
 * из них его случай.
 */
export async function fetchEstimates(keys) {
  const empty = { estimates: [], progress: [], needed: null };
  if (!keys?.length) return empty;
  const { syncOrigin } = await import('./syncClient.js');
  try {
    const res = await fetch(`${syncOrigin()}/api/signals/estimates?keys=${keys.join(',')}`);
    if (!res.ok) return empty;
    const body = await res.json();
    return { estimates: body.estimates || [], progress: body.progress || [], needed: body.needed || null };
  } catch {
    return empty;
  }
}

export const POOL_CLIENT_DEFAULTS = { NEAR_SIGNAL_M };
