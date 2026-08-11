/**
 * Фазы светофоров по вашим собственным замерам.
 *
 * Готовых данных о фазах нет: в OSM это непринятое предложение, а городские
 * контроллеры наружу не отдают. Но замерить светофор можно самому — нажимая
 * кнопку в момент переключения. Тогда число на экране не выдумано, а измерено,
 * и приложение обязано честно сказать, насколько ему можно верить.
 *
 * Отсюда три правила, без которых эта затея вредна:
 *
 *   1. ПЛАВАЮЩИЙ ЦИКЛ. Если замеры расходятся, светофор адаптивный или
 *      работает по нескольким программам. Отсчёт не показывается вовсе:
 *      «примерно» на светофоре — это выезд на красный.
 *
 *   2. УСТАРЕВШАЯ ПРИВЯЗКА. Цикл идёт сам по себе, наши часы — сами по себе.
 *      Даже точный цикл через несколько часов даст сдвиг в секунды. Поэтому
 *      накопленная неопределённость считается явно, и как только она
 *      превышает пару секунд, отсчёт гаснет.
 *
 *   3. ВРЕМЯ СУТОК. У светофора обычно несколько программ — утро, день,
 *      вечер, ночь. Замер, сделанный днём, к вечернему часу пик не относится,
 *      и мешать их в кучу нельзя.
 */

/** Программы по времени суток. Границы взяты по типичным режимам работы. */
export const PROGRAMS = [
  { id: 'night', fromHour: 0, toHour: 7 },
  { id: 'morning', fromHour: 7, toHour: 10 },
  { id: 'day', fromHour: 10, toHour: 16 },
  { id: 'evening', fromHour: 16, toHour: 20 },
  { id: 'late', fromHour: 20, toHour: 24 },
];

export function programAt(timestamp) {
  const hour = new Date(timestamp).getHours();
  return (PROGRAMS.find(p => hour >= p.fromHour && hour < p.toHour) || PROGRAMS[0]).id;
}

// Сколько полных циклов нужно, чтобы вообще говорить о цикле.
const MIN_CYCLES = 2;
// Разброс замеров, выше которого светофор считается плавающим.
// Полторы секунды на цикле в минуту — это уже не фиксированная программа.
const MAX_SPREAD_SEC = 2.5;
// Скорость расхождения наших часов и контроллера. Оценка сознательно
// пессимистичная: лучше погасить отсчёт раньше, чем показать неверный.
const DRIFT_SEC_PER_HOUR = 1.5;
// Неопределённость, при которой отсчёт перестаёт иметь смысл.
const MAX_UNCERTAINTY_SEC = 2.5;

/**
 * Замер: последовательность нажатий с отметками времени.
 * @typedef {{at: number, phase: 'green'|'red'}} Tap
 */

/**
 * Длительности фаз из череды нажатий.
 *
 * Считаются интервалы между СОСЕДНИМИ переключениями: от «загорелся зелёный»
 * до «загорелся красный» — зелёная фаза, дальше до следующего зелёного —
 * красная. Нажатия не по очереди (два зелёных подряд) означают промах,
 * и такая пара отбрасывается, а не усредняется.
 */
export function phasesFromTaps(taps) {
  const sorted = [...(taps || [])]
    .filter(t => Number.isFinite(t?.at) && (t.phase === 'green' || t.phase === 'red'))
    .sort((a, b) => a.at - b.at);

  const green = [];
  const red = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev.phase === curr.phase) continue;          // промах, пропускаем
    const seconds = (curr.at - prev.at) / 1000;
    if (seconds <= 2 || seconds > 300) continue;      // случайное касание или пауза
    (prev.phase === 'green' ? green : red).push(seconds);
  }
  return { green, red };
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Размах: максимум минус минимум. Для трёх-пяти замеров честнее дисперсии. */
function spread(values) {
  return values.length < 2 ? 0 : Math.max(...values) - Math.min(...values);
}

/**
 * Оценка цикла по замерам одной программы.
 *
 * @returns {{ok: boolean, reason?: string, cycleSec, greenSec, redSec, spreadSec, samples}}
 */
export function estimateCycle(taps) {
  const { green, red } = phasesFromTaps(taps);
  const samples = Math.min(green.length, red.length);

  if (samples < MIN_CYCLES) {
    return { ok: false, reason: 'not_enough', samples };
  }

  const greenSec = Math.round(mean(green));
  const redSec = Math.round(mean(red));
  const spreadSec = Math.round(Math.max(spread(green), spread(red)) * 10) / 10;

  if (spreadSec > MAX_SPREAD_SEC) {
    // Адаптивный светофор или несколько программ внутри одного замера.
    return { ok: false, reason: 'unstable', spreadSec, samples, cycleSec: greenSec + redSec };
  }

  return { ok: true, cycleSec: greenSec + redSec, greenSec, redSec, spreadSec, samples };
}

/**
 * Насколько можно верить привязке спустя время.
 * Растёт линейно: цикл и часы расходятся тем сильнее, чем дольше мы
 * не наблюдали светофор своими глазами.
 */
export function uncertaintySec(anchorAt, now, spreadSec = 0) {
  const hours = Math.max(0, (now - anchorAt) / 3600e3);
  return spreadSec / 2 + hours * DRIFT_SEC_PER_HOUR;
}

/**
 * Что показывать сейчас.
 *
 * @param {object} signal замеренный светофор
 * @param {number} now
 * @returns {{state:'green'|'red', remainingSec, uncertaintySec}|{state:'unknown', reason}}
 */
export function predict(signal, now = Date.now()) {
  const program = signal?.programs?.[programAt(now)];
  if (!program?.ok) {
    return { state: 'unknown', reason: program?.reason || 'not_measured' };
  }

  const uncertainty = uncertaintySec(program.anchorAt, now, program.spreadSec);
  if (uncertainty > MAX_UNCERTAINTY_SEC) {
    // Привязка устарела. Показывать секунды с такой ошибкой — значит
    // предлагать выехать на красный.
    return { state: 'unknown', reason: 'stale', uncertaintySec: Math.round(uncertainty) };
  }

  const cycleMs = program.cycleSec * 1000;
  // Остаток от деления в JS может быть отрицательным, если привязка в будущем.
  const offset = (((now - program.anchorAt) % cycleMs) + cycleMs) % cycleMs;
  const seconds = offset / 1000;

  const inGreen = seconds < program.greenSec;
  return {
    state: inGreen ? 'green' : 'red',
    remainingSec: Math.max(0, Math.round(inGreen
      ? program.greenSec - seconds
      : program.cycleSec - seconds)),
    uncertaintySec: Math.round(uncertainty * 10) / 10,
  };
}

/**
 * Пора ли предупреждать о скором переключении.
 * Порог задаёт человек: «за семь секунд до конца» — это его решение,
 * а не наше.
 */
export function shouldWarn(prediction, warnBeforeSec) {
  if (!prediction || prediction.state === 'unknown') return false;
  return prediction.remainingSec <= warnBeforeSec;
}

/**
 * Запись замера в светофор: обновляет программу текущего времени суток.
 * Замеры разных программ не смешиваются — у вечернего часа пик свой цикл.
 */
export function applyMeasurement(signal, taps, now = Date.now()) {
  const estimate = estimateCycle(taps);
  const sorted = [...taps].sort((a, b) => a.at - b.at);

  // Привязка — последнее наблюдённое начало ЗЕЛЁНОГО: от него считается фаза.
  const lastGreen = [...sorted].reverse().find(t => t.phase === 'green');
  const program = programAt(lastGreen?.at || now);

  return {
    ...signal,
    programs: {
      ...(signal.programs || {}),
      [program]: {
        ...estimate,
        anchorAt: lastGreen?.at || null,
        measuredAt: now,
      },
    },
  };
}

export const TIMING_DEFAULTS = {
  MIN_CYCLES, MAX_SPREAD_SEC, DRIFT_SEC_PER_HOUR, MAX_UNCERTAINTY_SEC,
};
