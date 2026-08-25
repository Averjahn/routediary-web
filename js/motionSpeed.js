/**
 * Скорость между отсчётами спутников — по акселерометру.
 *
 * Зачем. Приёмник отдаёт скорость примерно раз в секунду. Само число
 * точное (доплеровский сдвиг), но между отсчётами оно заморожено: при
 * торможении 5 м/с² к моменту, когда водитель поднял глаза на стекло,
 * на нём может стоять цифра на 18 км/ч больше настоящей. Сгладить это
 * нельзя — между отсчётами просто нет новых сведений. Их даёт датчик
 * ускорения: шестьдесят измерений в секунду вместо одного.
 *
 * Почему это вообще решаемо. В режиме проекции телефон закреплён на
 * панели, то есть неподвижен ОТНОСИТЕЛЬНО МАШИНЫ всю поездку. Значит
 * поворот между осями телефона и осями машины постоянный: его надо найти
 * один раз, а не отслеживать. Для телефона в кармане эта задача была бы
 * другой и куда хуже.
 *
 * Как ищем «вперёд». Гравитация даёт «вниз» — горизонтальную плоскость.
 * Внутри неё направление движения находится сопоставлением: у нас есть
 * горизонтальное ускорение от датчика и есть изменение скорости по GPS
 * за тот же промежуток. Направление, вдоль которого одно объясняет
 * другое, и есть «вперёд». Это обычный метод наименьших квадратов на
 * двумерном векторе — устойчивее, чем искать полный поворот в трёх
 * измерениях.
 *
 * Чего мы НЕ делаем и почему. Не считаем скорость датчиком самостоятельно:
 * интеграл ускорения уходит от правды тем быстрее, чем дольше его копить.
 * Датчик работает только как мост между отсчётами GPS, каждый отсчёт
 * возвращает нас к правде, и мост этот короткий (MAX_BRIDGE_MS). Если
 * сопоставление не сошлось — молчим и отдаём чистый GPS.
 *
 * Главное правило. На стекле неверное число хуже устаревшего: по нему
 * принимают решения на дороге. Поэтому каждый предохранитель здесь
 * сделан так, чтобы в сомнительном случае возвращаться к GPS, а не
 * показывать красивую догадку.
 */

/** Дольше этого мост не строим: интеграл ускорения успевает уйти. */
const MAX_BRIDGE_MS = 1500;

/** Сколько пар «ускорение — изменение скорости» нужно, чтобы поверить оси. */
const MIN_PAIRS = 8;

/**
 * Насколько хорошо ось должна объяснять изменения скорости (доля 0..1).
 * Ниже — считаем, что не разобрались: телефон вынули из держателя,
 * дорога слишком ровная для калибровки, датчик врёт.
 */
const MIN_QUALITY = 0.5;

/** Больше этого от последнего отсчёта GPS не отходим ни при каких условиях. */
const MAX_BRIDGE_DELTA_MS = 8;   // м/с, примерно 29 км/ч

/** Пары старше этого забываем: держатель могли поправить. */
const PAIR_TTL_MS = 180_000;

/** Слишком долгий промежуток между отсчётами — пара негодная. */
const MAX_PAIR_GAP_MS = 3000;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v) => Math.hypot(v[0], v[1], v[2]);

/** Единичный вектор или null, если длина нулевая. */
function unit(v) {
  const n = norm(v);
  if (!(n > 1e-6)) return null;
  return [v[0] / n, v[1] / n, v[2] / n];
}

/**
 * Два перпендикулярных направления в плоскости, перпендикулярной g.
 * Опорный вектор берём заведомо не параллельный g, иначе базис вырождается.
 */
function planeBasis(g) {
  const up = unit(g);
  if (!up) return null;
  const ref = Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit([
    ref[0] - up[0] * dot(ref, up),
    ref[1] - up[1] * dot(ref, up),
    ref[2] - up[2] * dot(ref, up),
  ]);
  if (!e1) return null;
  const e2 = [
    up[1] * e1[2] - up[2] * e1[1],
    up[2] * e1[0] - up[0] * e1[2],
    up[0] * e1[1] - up[1] * e1[0],
  ];
  return { e1, e2 };
}

/**
 * Мост по акселерометру между отсчётами спутников.
 *
 * @param {object} [opts]
 * @param {number} [opts.maxBridgeMs]  предел экстраполяции
 * @param {number} [opts.minPairs]     сколько пар нужно для калибровки
 * @param {number} [opts.minQuality]   порог качества сопоставления
 */
export function createMotionBridge({
  maxBridgeMs = MAX_BRIDGE_MS,
  minPairs = MIN_PAIRS,
  minQuality = MIN_QUALITY,
  maxDeltaMs = MAX_BRIDGE_DELTA_MS,
} = {}) {
  // Накопитель ускорения с момента последнего отсчёта GPS.
  let sinceFix = { vx: 0, vy: 0, vz: 0, ms: 0 };
  let lastMotionAt = null;

  let lastFix = null;                 // {t, speedMs}
  let pairs = [];                     // {t, h1, h2, accel} — для калибровки
  let axis = null;                    // {f1, f2, quality}
  let gravity = null;                 // сглаженное направление «вниз»

  /**
   * Очередное измерение датчика.
   * @param {number} t     метка времени, мс
   * @param {number[]} acc линейное ускорение (без гравитации), м/с²
   * @param {number[]} grav вектор гравитации, м/с²
   */
  function addMotion(t, acc, grav) {
    if (!Number.isFinite(t) || !acc || !grav) return;
    if (![...acc, ...grav].every(Number.isFinite)) return;

    // Направление «вниз» усредняем: мгновенное значение дрожит на кочках,
    // а нам нужна постоянная ориентация закреплённого телефона.
    gravity = gravity == null
      ? [...grav]
      : gravity.map((g, i) => g + 0.02 * (grav[i] - g));

    if (lastMotionAt != null) {
      const dt = t - lastMotionAt;
      // Пропуск кадров (свернули вкладку) не превращаем в один длинный
      // интервал: такой «шаг» внёс бы огромную ошибку в интеграл.
      if (dt > 0 && dt < 200) {
        sinceFix.vx += acc[0] * dt / 1000;
        sinceFix.vy += acc[1] * dt / 1000;
        sinceFix.vz += acc[2] * dt / 1000;
        sinceFix.ms += dt;
      }
    }
    lastMotionAt = t;
  }

  /** Пересчёт оси «вперёд» по накопленным парам. */
  function recalibrate() {
    const fresh = pairs;
    if (fresh.length < minPairs) { axis = null; return; }

    // Наименьшие квадраты: ищем f = (f1, f2), чтобы h·f объясняло ускорение
    // по GPS. Матрица 2x2 решается напрямую, без общей линейной алгебры.
    let s11 = 0, s12 = 0, s22 = 0, b1 = 0, b2 = 0, sbb = 0, n = 0;
    for (const p of fresh) {
      s11 += p.h1 * p.h1; s12 += p.h1 * p.h2; s22 += p.h2 * p.h2;
      b1 += p.h1 * p.accel; b2 += p.h2 * p.accel;
      sbb += p.accel * p.accel; n++;
    }
    // Небольшая добавка к диагонали спасает от вырождения, когда машина
    // долго едет ровно и разбросу неоткуда взяться.
    const ridge = 1e-3 * n;
    const d = (s11 + ridge) * (s22 + ridge) - s12 * s12;
    if (!(Math.abs(d) > 1e-9)) { axis = null; return; }

    const f1 = ((s22 + ridge) * b1 - s12 * b2) / d;
    const f2 = ((s11 + ridge) * b2 - s12 * b1) / d;

    // Качество — доля объяснённого разброса. Ниже порога это не ось, а
    // совпадение: телефон мог быть не закреплён или дорога слишком ровная.
    let residual = 0;
    for (const p of fresh) {
      const predicted = p.h1 * f1 + p.h2 * f2;
      residual += (p.accel - predicted) ** 2;
    }
    const quality = sbb > 1e-9 ? Math.max(0, 1 - residual / sbb) : 0;
    axis = quality >= minQuality ? { f1, f2, quality } : null;
  }

  /**
   * Отсчёт скорости от приёмника — правда, к которой возвращаемся.
   * @param {number} t
   * @param {number} speedMs
   */
  function addFix(t, speedMs) {
    if (!Number.isFinite(t) || !Number.isFinite(speedMs)) return;

    const prev = lastFix;
    const bridged = { ...sinceFix };
    sinceFix = { vx: 0, vy: 0, vz: 0, ms: 0 };
    lastFix = { t, speedMs };

    if (!prev || !gravity) return;
    const gap = t - prev.t;
    if (!(gap > 0) || gap > MAX_PAIR_GAP_MS || bridged.ms < gap * 0.5) return;

    const basis = planeBasis(gravity);
    if (!basis) return;

    // Среднее ускорение за промежуток в горизонтальной плоскости и
    // настоящее изменение скорости за тот же промежуток.
    const v = [bridged.vx, bridged.vy, bridged.vz];
    const secs = gap / 1000;
    const h1 = dot(v, basis.e1) / secs;
    const h2 = dot(v, basis.e2) / secs;
    const accel = (speedMs - prev.speedMs) / secs;

    pairs.push({ t, h1, h2, accel });
    pairs = pairs.filter(p => t - p.t <= PAIR_TTL_MS);
    recalibrate();
  }

  /**
   * Скорость сейчас.
   * @returns {{speedMs: number, bridged: boolean}|null}
   *   bridged — достроено датчиком; false — чистый отсчёт приёмника.
   *   null — сказать нечего, показывать нельзя.
   */
  function read(now) {
    if (!lastFix) return null;
    const since = now - lastFix.t;
    if (since < 0) return null;

    const plain = { speedMs: lastFix.speedMs, bridged: false };
    if (!axis || !gravity || since > maxBridgeMs) return plain;

    const basis = planeBasis(gravity);
    if (!basis) return plain;

    const v = [sinceFix.vx, sinceFix.vy, sinceFix.vz];
    const delta = dot(v, basis.e1) * axis.f1 + dot(v, basis.e2) * axis.f2;
    if (!Number.isFinite(delta)) return plain;

    // Предохранитель: сколь угодно уверенное сопоставление не даёт права
    // уехать от последнего отсчёта приёмника далеко. Скорость на стекле
    // должна оставаться скоростью, а не следствием накопленной ошибки.
    const capped = Math.max(-maxDeltaMs, Math.min(maxDeltaMs, delta));
    const speedMs = Math.max(0, lastFix.speedMs + capped);
    return { speedMs, bridged: true };
  }

  /** Что показать в диагностике. Для экрана настроек, не для водителя. */
  function diagnostics() {
    return {
      pairs: pairs.length,
      quality: axis ? axis.quality : null,
      calibrated: !!axis,
      hasGravity: !!gravity,
    };
  }

  function reset() {
    sinceFix = { vx: 0, vy: 0, vz: 0, ms: 0 };
    lastMotionAt = null;
    lastFix = null;
    pairs = [];
    axis = null;
    gravity = null;
  }

  return { addMotion, addFix, read, diagnostics, reset };
}

export { MAX_BRIDGE_MS, MIN_PAIRS, MIN_QUALITY, MAX_BRIDGE_DELTA_MS };
