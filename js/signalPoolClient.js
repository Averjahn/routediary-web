import { getSetting, setSetting } from './db.js';
import { findStops } from './stops.js';
import { distanceMeters } from './roadRules.js';
import { loadedAround, ensureAround, isEnabled as roadEnabled } from './roadData.js';
import { programAt } from './signalTiming.js';

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
const SENT_KEY = 'signalPoolSentUpTo';

// Насколько близко к светофору должна быть остановка, чтобы считаться его.
// Очередь на перекрёстке растягивается, но дальше это уже другой стоп.
const NEAR_SIGNAL_M = 40;

export async function isEnabled() {
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
 * Отправить наблюдения из недавних поездок.
 * Молча ничего не делает, если участие выключено.
 */
export async function contribute(tracks) {
  if (!(await isEnabled())) return 0;

  const observations = [];
  for (const points of tracks || []) {
    if (!points.length) continue;
    const middle = points[Math.floor(points.length / 2)];
    await ensureAround(middle.lat, middle.lon).catch(() => {});
    const { signals } = loadedAround(middle.lat, middle.lon);
    observations.push(...observationsFromTrack(points, signals));
  }
  if (observations.length === 0) return 0;

  // Отправляем пачками: сервер принимает не больше полусотни за раз.
  let sent = 0;
  for (let i = 0; i < observations.length; i += 50) {
    const result = await post('/api/signals/observe', { observations: observations.slice(i, i + 50) });
    sent += result?.accepted || 0;
  }
  await setSetting(SENT_KEY, Date.now());
  return sent;
}

/** Готовые оценки по светофорам поблизости. */
export async function fetchEstimates(keys) {
  if (!keys?.length) return [];
  const { syncOrigin } = await import('./syncClient.js');
  try {
    const res = await fetch(`${syncOrigin()}/api/signals/estimates?keys=${keys.join(',')}`);
    if (!res.ok) return [];
    return (await res.json()).estimates || [];
  } catch {
    return [];
  }
}

export const POOL_CLIENT_DEFAULTS = { NEAR_SIGNAL_M };
