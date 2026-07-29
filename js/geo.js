// Алгоритмы трекинга — портированы дословно из SPEC.md.

export function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Фильтрация: отбросить horizontalAccuracy > 50м и "телепорты" (>60 м/с между соседними точками).
export function filterPoints(points) {
  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
  const out = [];
  for (const p of sorted) {
    if (p.horizontalAccuracy != null && p.horizontalAccuracy > 50) continue;
    if (out.length > 0) {
      const prev = out[out.length - 1];
      const dtSec = (p.timestamp - prev.timestamp) / 1000;
      if (dtSec > 0) {
        const dist = haversineMeters(prev, p);
        const speedMs = dist / dtSec;
        if (speedMs > 60) continue;
      }
    }
    out.push(p);
  }
  return out;
}

// Решение "писать ли точку": сдвиг >= 10м ИЛИ >= 30 сек с прошлой записанной точки.
export function shouldRecordPoint(lastPoint, candidate) {
  if (!lastPoint) return true;
  const dtSec = (candidate.timestamp - lastPoint.timestamp) / 1000;
  if (dtSec >= 30) return true;
  const dist = haversineMeters(lastPoint, candidate);
  return dist >= 10;
}

// Сегментация: разрыв >5мин ИЛИ стоим 3мин в радиусе 40м -> новый сегмент.
// Сегменты <150м или <2мин отбрасываются.
export function segmentDay(points) {
  const filtered = filterPoints(points);
  if (filtered.length === 0) return [];

  const segments = [];
  let current = [filtered[0]];

  function isStoppedWindow(pts) {
    // все точки за последние 3 минуты в радиусе 40м от последней точки?
    if (pts.length < 2) return false;
    const last = pts[pts.length - 1];
    const cutoff = last.timestamp - 3 * 60 * 1000;
    const window = pts.filter(p => p.timestamp >= cutoff);
    if (window.length < 2) return false;
    const windowSpanSec = (window[window.length - 1].timestamp - window[0].timestamp) / 1000;
    if (windowSpanSec < 3 * 60 - 5) return false; // требуем реально ~3 мин данных
    return window.every(p => haversineMeters(p, last) <= 40);
  }

  for (let i = 1; i < filtered.length; i++) {
    const prev = filtered[i - 1];
    const p = filtered[i];
    const gapMin = (p.timestamp - prev.timestamp) / 60000;
    current.push(p);
    if (gapMin > 5 || isStoppedWindow(current)) {
      segments.push(current);
      current = [p];
    }
  }
  if (current.length > 0) segments.push(current);

  const trips = [];
  for (const seg of segments) {
    if (seg.length < 2) continue;
    let dist = 0;
    for (let i = 1; i < seg.length; i++) dist += haversineMeters(seg[i - 1], seg[i]);
    const durationMin = (seg[seg.length - 1].timestamp - seg[0].timestamp) / 60000;
    if (dist < 150 || durationMin < 2) continue;
    trips.push(seg);
  }
  return trips;
}

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// Определение режима по медиане скорости движущихся точек (speed>0.7 м/с), speed в м/с.
export function detectMode(points) {
  const speedsMs = points.map(p => p.speed).filter(s => s != null && s > 0.7);
  if (speedsMs.length === 0) return 'walk';
  const speedsKmh = speedsMs.map(s => s * 3.6);
  const med = median(speedsKmh);
  const p85 = percentile(speedsKmh, 85);
  if (p85 > 40) return 'car';
  if (med < 7) return 'walk';
  if (med < 13) return 'run';
  if (med < 25) return 'bike';
  return 'car';
}

// Дистанция (сумма haversine) и время движения (интервалы со скоростью > 0.7 м/с).
export function computeMetrics(points) {
  let distance = 0;
  let movingTimeSec = 0;
  let maxSpeedMs = 0;
  const speedsMoving = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const d = haversineMeters(a, b);
    distance += d;
    const dtSec = (b.timestamp - a.timestamp) / 1000;
    let speed = b.speed;
    if (speed == null || speed < 0) speed = dtSec > 0 ? d / dtSec : 0;
    if (speed > maxSpeedMs) maxSpeedMs = speed;
    if (speed > 0.7) {
      movingTimeSec += dtSec;
      speedsMoving.push(speed);
    }
  }
  const avgMovingSpeedKmh = movingTimeSec > 0 ? (distance / movingTimeSec) * 3.6 : 0;
  return {
    distanceMeters: distance,
    movingTimeSec,
    avgMovingSpeedKmh,
    maxSpeedKmh: maxSpeedMs * 3.6,
  };
}

// Калории по MET-таблице.
export function calcCalories(mode, avgMovingSpeedKmh, movingTimeSec, weightKg) {
  let met = 2.8;
  if (mode === 'walk') {
    if (avgMovingSpeedKmh < 4) met = 2.8;
    else if (avgMovingSpeedKmh < 5.5) met = 3.5;
    else if (avgMovingSpeedKmh < 6.5) met = 4.3;
    else met = 5.0;
  } else if (mode === 'run') {
    const pts = [[8, 8.3], [9.7, 9.8], [11, 11.0], [12.9, 11.8]];
    if (avgMovingSpeedKmh <= pts[0][0]) met = pts[0][1];
    else if (avgMovingSpeedKmh >= pts[pts.length - 1][0]) met = pts[pts.length - 1][1];
    else {
      for (let i = 1; i < pts.length; i++) {
        if (avgMovingSpeedKmh <= pts[i][0]) {
          const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
          met = y0 + (y1 - y0) * (avgMovingSpeedKmh - x0) / (x1 - x0);
          break;
        }
      }
    }
  } else if (mode === 'bike') {
    if (avgMovingSpeedKmh < 16) met = 4.0;
    else if (avgMovingSpeedKmh < 19) met = 6.8;
    else if (avgMovingSpeedKmh < 22) met = 8.0;
    else met = 10.0;
  } else {
    return 0;
  }
  const hours = movingTimeSec / 3600;
  return met * weightKg * hours;
}

// Бензин.
export function calcFuel(distanceMeters, fuelPer100Km, fuelPriceRub) {
  const distanceKm = distanceMeters / 1000;
  const liters = distanceKm * fuelPer100Km / 100;
  const cost = liters * fuelPriceRub;
  return { liters, cost };
}

// Оценка загруженности дороги (только car).
export function congestionScore(avgMovingSpeedKmh, userP90Speed) {
  let freeFlow = 45;
  if (userP90Speed != null && userP90Speed >= 30) freeFlow = userP90Speed;
  const ratio = freeFlow > 0 ? avgMovingSpeedKmh / freeFlow : 0;
  if (ratio >= 0.8) return 1;
  if (ratio >= 0.6) return 2;
  if (ratio >= 0.45) return 3;
  if (ratio >= 0.3) return 4;
  return 5;
}

export function userFreeFlowSpeed(carTrips) {
  if (carTrips.length < 5) return null;
  const speeds = carTrips.map(t => t.avgMovingSpeedKmh).filter(s => s > 0);
  return percentile(speeds, 90);
}

// Рекомендации по часам: среднее avgMovingSpeed по часу суток, раздельно будни/выходные.
export function hourlyRecommendations(carTrips) {
  const buckets = { weekday: {}, weekend: {} };
  for (const trip of carTrips) {
    const d = new Date(trip.startTime);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const bucketKey = isWeekend ? 'weekend' : 'weekday';
    const hour = d.getHours();
    if (!buckets[bucketKey][hour]) buckets[bucketKey][hour] = [];
    buckets[bucketKey][hour].push(trip.avgMovingSpeedKmh);
  }
  function summarize(bucket) {
    const hours = Object.keys(bucket).map(h => {
      const speeds = bucket[h];
      const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      return { hour: parseInt(h, 10), avgSpeed: avg };
    });
    hours.sort((a, b) => b.avgSpeed - a.avgSpeed);
    return {
      best: hours.slice(0, 3),
      worst: hours.slice(-3).reverse(),
      byHour: bucket,
    };
  }
  return { weekday: summarize(buckets.weekday), weekend: summarize(buckets.weekend) };
}
