/**
 * Когда приёмнику можно отдохнуть: едем мы или стоим.
 *
 * ЗАЧЕМ. Запись поездки держала спутниковый приёмник на полной мощности
 * всё время, пока была включена, — в том числе когда машина восемь часов
 * стояла у офиса. Приёмник исправно сообщал одну и ту же точку раз в
 * секунду, и батарея уходила именно на это.
 *
 * КАК. Два режима.
 *
 *   moving — едем: полная точность, как было.
 *   still  — стоим: спутники выключены, положение раз в минуту по вышкам
 *            и Wi-Fi. Этого хватает, чтобы заметить, что машина тронулась.
 *
 * На стоянку переходим, только если STILL_AFTER_MS подряд все уверенные
 * отсчёты лежали в круге STILL_RADIUS_M. Три минуты — не случайно:
 * светофор и затор короче, а в пробке шагом машина проходит 50 метров
 * меньше чем за минуту, и в экономный режим не уходит вовсе.
 *
 * Будим сразу, как только отсчёт показал сдвиг дальше WAKE_DISTANCE_M или
 * уверенную скорость больше WAKE_SPEED_MS.
 *
 * ЧЕМ ПЛАТИМ. Начало поездки после стоянки пишется с опозданием: пока
 * экономный отсчёт не покажет сдвиг, первые сто-двести метров трека
 * достраиваются по прямой. Для дневника поездок это приемлемо — поездка,
 * её длина и время остаются верными с точностью до этих метров.
 *
 * Те же числа и та же логика — в iOS (LocationTracker.swift) и Android
 * (GpsPowerGovernor.kt). Тест gpsPower.test.js сверяет их с этим файлом.
 */

/** Круг, в котором дрожат отсчёты стоящей машины. Дрожание приёмника — до ~30 м. */
export const STILL_RADIUS_M = 50;
/** Сколько подряд надо простоять в круге, чтобы считаться стоянкой. */
export const STILL_AFTER_MS = 180000;
/** Сдвиг, после которого стоянка закончилась. */
export const WAKE_DISTANCE_M = 100;
/** Уверенная скорость, после которой стоянка закончилась, м/с (~11 км/ч). */
export const WAKE_SPEED_MS = 3;
/** Как часто спрашивать положение на стоянке. Только в вебе: iOS и Android будят сами. */
export const STILL_POLL_MS = 60000;

/** Отсчёт, которому можно верить в скорости и в том, что машина стоит. */
const GOOD_FIX_M = 50;
/**
 * Экономные отсчёты по вышкам бывают с погрешностью в километр. Порог
 * пробуждения растёт вместе с погрешностью, иначе такое дрожание будило бы
 * приёмник каждую минуту, — но не дальше этого потолка, иначе при плохой
 * связи стоянка не кончалась бы никогда.
 */
const WAKE_ACCURACY_CAP_M = 200;

export function distanceM(a, b) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Решатель режима. Чистый: без таймеров и геолокации, только отсчёты на
 * входе и режим на выходе — поэтому проверяется в node целиком.
 *
 * fix: { lat, lon, t (мс), speed (м/с, отрицательная — неизвестна), accuracy (м) }
 */
export function createGpsGovernor() {
  let mode = 'moving';
  let anchor = null;

  return {
    get mode() { return mode; },

    reset() {
      mode = 'moving';
      anchor = null;
    },

    update(fix) {
      if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lon) || !Number.isFinite(fix.t)) {
        return mode;
      }
      const acc = Number.isFinite(fix.accuracy) && fix.accuracy >= 0 ? fix.accuracy : Infinity;
      // Скорости верим только у точного отсчёта: у экономного по вышкам она
      // бывает какой угодно, и стоящая машина «разгонялась» бы до 8 м/с.
      const fast = Number.isFinite(fix.speed) && fix.speed > WAKE_SPEED_MS && acc <= GOOD_FIX_M;

      if (mode === 'moving') {
        // Плохой отсчёт ничего не решает: ни сдвинуть точку отсчёта стоянки,
        // ни засчитать её. Иначе один скачок на 400 метров посреди стоянки
        // заново запускал бы трёхминутный отсчёт.
        if (acc > STILL_RADIUS_M) return mode;
        if (!anchor || fast || distanceM(anchor, fix) > STILL_RADIUS_M) {
          anchor = { lat: fix.lat, lon: fix.lon, t: fix.t };
          return mode;
        }
        if (fix.t - anchor.t >= STILL_AFTER_MS) mode = 'still';
        return mode;
      }

      const wake = Math.max(WAKE_DISTANCE_M, 2 * Math.min(acc, WAKE_ACCURACY_CAP_M));
      if (fast || distanceM(anchor, fix) > wake) {
        mode = 'moving';
        anchor = { lat: fix.lat, lon: fix.lon, t: fix.t };
      }
      return mode;
    },
  };
}
