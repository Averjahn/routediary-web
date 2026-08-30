import { DB, setSetting, getSetting } from './db.js';
import { AppState, getPrimaryVehicle } from './state.js';
import { uuid, todayKey, dayKeyOf } from './format.js';
import { segmentDay, detectMode, computeMetrics, userFreeFlowSpeed, congestionScore } from './geo.js';

/**
 * Разрешена ли записи начинаться САМОЙ — без нажатия кнопки.
 *
 * Выключено по умолчанию, и это осознанно. Непрерывная геолокация — самая
 * дорогая по батарее вещь в приложении, а человек, только что открывший
 * приложение, ещё не выбирал такой размен. Пусть решает сам: кнопка
 * «Начать запись» работает всегда и ни от чего здесь не зависит.
 */
export const AUTO_TRACK_KEY = 'autoTrackingEnabled';

export async function autoTrackingEnabled() {
  return await getSetting(AUTO_TRACK_KEY, false) === true;
}

let lastRecordedPoint = null;
let liveTrackListeners = [];

export function onLivePoint(cb) { liveTrackListeners.push(cb); }

function haversine(a, b) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function isRecording() {
  return await getSetting('recording', false);
}

export async function startRecording() {
  if (!('geolocation' in navigator)) {
    throw new Error('geolocation_unavailable');
  }
  AppState.recording = true;
  AppState.recordingStartedAt = Date.now();
  await setSetting('recording', true);
  await setSetting('recordingStartedAt', AppState.recordingStartedAt);
  lastRecordedPoint = null;

  AppState.watchId = navigator.geolocation.watchPosition(
    onPosition,
    onPositionError,
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
  );
}

export async function stopRecording() {
  AppState.recording = false;
  if (AppState.watchId != null) {
    navigator.geolocation.clearWatch(AppState.watchId);
    AppState.watchId = null;
  }
  await setSetting('recording', false);
  await recomputeSegmentation(AppState.currentDay);
}

async function onPosition(pos) {
  const point = {
    id: uuid(),
    timestamp: pos.timestamp || Date.now(),
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    speed: pos.coords.speed != null ? pos.coords.speed : -1,
    horizontalAccuracy: pos.coords.accuracy != null ? pos.coords.accuracy : 9999,
    altitude: pos.coords.altitude != null ? pos.coords.altitude : 0,
    tripId: null,
    dayKey: dayKeyOf(new Date(pos.timestamp || Date.now())),
  };

  if (point.horizontalAccuracy > 50) return;

  let write = true;
  if (lastRecordedPoint) {
    const dtSec = (point.timestamp - lastRecordedPoint.timestamp) / 1000;
    if (dtSec < 30) {
      const dist = haversine(lastRecordedPoint, point);
      write = dist >= 10;
    }
  }

  if (write) {
    await DB.put('trackPoints', point);
    lastRecordedPoint = point;
    for (const cb of liveTrackListeners) cb(point);
  }
}

function onPositionError(err) {
  console.warn('geolocation error', err);
  for (const cb of liveTrackListeners) cb(null, err);
}

// Пересчёт сегментации дня: превратить сырые точки в Trip-записи.
/**
 * Отправка наблюдений в общую копилку после нарезки поездок.
 *
 * Именно здесь, а не в момент остановки: пока поездка не сегментирована,
 * неизвестно, где она началась и кончилась, и стоянка у дома попала бы
 * в копилку наравне с перекрёстком.
 *
 * Выключено, пока человек сам не включил. Ошибки глушим: приложение
 * офлайновое, и отсутствие сети не должно ломать запись поездок.
 */
async function contributeSignalObservations(dayKey) {
  try {
    const { contributeDay } = await import('./signalPoolClient.js');
    await contributeDay(dayKey);
  } catch { /* участие выключено или нет сети */ }
}

export async function recomputeSegmentation(dayKey) {
  const points = await DB.getAllByIndex('trackPoints', 'dayKey', dayKey);
  if (points.length === 0) return [];

  const existingTrips = await DB.getAllByIndex('trips', 'dayKey', dayKey);
  const manualOverrides = new Map(
    existingTrips.filter(t => t.isManual || t.userEdited).map(t => [t.id, t])
  );
  // удаляем старые авто-сегментированные поездки этого дня (не ручные)
  for (const t of existingTrips) {
    if (!t.isManual) await DB.delete('trips', t.id);
  }

  const segments = segmentDay(points);
  const allCarTrips = (await DB.getAll('trips')).filter(t => t.mode === 'car');
  const freeFlow = userFreeFlowSpeed(allCarTrips);

  const newTrips = [];
  // Машина по умолчанию — основная. Спрашивать в момент завершения поездки
  // не даём: человек только что вышел из машины, ему не до диалогов.
  // Вместо вопроса — ненавязчивое сообщение с возможностью переназначить,
  // и смена машины всегда доступна в карточке поездки.
  const primary = await getPrimaryVehicle();

  for (const seg of segments) {
    const metrics = computeMetrics(seg);
    const mode = detectMode(seg);
    const trip = {
      id: uuid(),
      dayKey,
      // Пешие прогулки к машине не относятся — привязываем только поездки.
      vehicleId: mode === 'car' && primary ? primary.id : null,
      startTime: seg[0].timestamp,
      endTime: seg[seg.length - 1].timestamp,
      mode,
      isModeManual: false,
      label: '',
      category: 'none',
      distanceMeters: metrics.distanceMeters,
      movingTimeSec: metrics.movingTimeSec,
      avgMovingSpeedKmh: metrics.avgMovingSpeedKmh,
      maxSpeedKmh: metrics.maxSpeedKmh,
      congestionScore: mode === 'car' ? congestionScore(metrics.avgMovingSpeedKmh, freeFlow) : 0,
      notes: '',
      isManual: false,
    };
    await DB.put('trips', trip);
    for (const p of seg) { p.tripId = trip.id; await DB.put('trackPoints', p); }
    newTrips.push(trip);
  }

  // Поездки нарезаны — можно отдать наблюдения в общую копилку.
  // Не ждём: отправка не должна задерживать показ поездок на экране.
  contributeSignalObservations(dayKey);

  return newTrips;
}

export async function addManualTrip({ dayKey, startTime, endTime, distanceKm, mode, category, label, notes }) {
  const durationSec = Math.max(1, (endTime - startTime) / 1000);
  const distanceMeters = distanceKm * 1000;
  const avgSpeedKmh = (distanceMeters / durationSec) * 3.6;
  const primary = await getPrimaryVehicle();
  const trip = {
    id: uuid(), dayKey, startTime, endTime,
    vehicleId: mode === 'car' && primary ? primary.id : null,
    mode, isModeManual: true, label: label || '', category: category || 'none',
    distanceMeters, movingTimeSec: durationSec,
    avgMovingSpeedKmh: avgSpeedKmh, maxSpeedKmh: avgSpeedKmh,
    congestionScore: 0, notes: notes || '', isManual: true,
  };
  await DB.put('trips', trip);
  return trip;
}
