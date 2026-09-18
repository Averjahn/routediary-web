/**
 * Итоги периода: сколько проехал, сколько сжёг, сколько потратил.
 *
 * ЗАЧЕМ. Раз в месяц приложению есть что сказать человеку одной картинкой:
 * «1 240 км, 96 литров, 7 100 ₽». Такое показывают знакомым — и это
 * единственный способ роста, который не покупается за деньги.
 *
 * ЧЕСТНОСТЬ. Считаем только то, что человек внёс сам: топливо берётся из
 * заправок, а не из паспортного расхода. Если заправок нет — строки про
 * топливо не будет вовсе, а не «0 литров» и не оценка, выданная за факт.
 *
 * Чистый модуль: ни DOM, ни базы — только числа на входе и на выходе.
 * Рисование картинки живёт в summaryCard.js.
 */

/** Ключ дня «ГГГГ-ММ-ДД» → миллисекунды начала дня. */
function dayKeyToMs(dayKey) {
  const [y, m, d] = String(dayKey).split('-').map(Number);
  if (!y || !m || !d) return NaN;
  return new Date(y, m - 1, d).getTime();
}

function inRange(ms, from, to) {
  return Number.isFinite(ms) && ms >= from && ms <= to;
}

/**
 * Границы периода.
 * kind: 'month' — с первого числа текущего месяца, 'year' — с 1 января.
 */
export function periodBounds(kind, now = new Date()) {
  const end = now.getTime();
  const start = kind === 'year'
    ? new Date(now.getFullYear(), 0, 1)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: start.getTime(), to: end, kind };
}

/**
 * Итоги за период.
 *
 * Возвращает null там, где данных нет: null означает «не показывать строку»,
 * а ноль — «данные есть, и там ноль». Разница принципиальная: «0 л топлива»
 * у человека, который просто не вносил заправки, — это ложь.
 */
export function buildSummary({ trips = [], refuels = [], expenses = [], from, to }) {
  const periodTrips = trips.filter(t => inRange(dayKeyToMs(t.dayKey), from, to));
  const periodRefuels = refuels.filter(r => inRange(Number(r.date), from, to));
  const periodExpenses = expenses.filter(e => inRange(Number(e.date), from, to));

  let carMeters = 0;
  let footMeters = 0;
  let movingSec = 0;
  let maxSpeed = 0;
  const days = new Set();

  for (const trip of periodTrips) {
    const meters = Number(trip.distanceMeters) || 0;
    if (trip.mode === 'car') carMeters += meters;
    else footMeters += meters;
    movingSec += Number(trip.movingTimeSec) || 0;
    const speed = Number(trip.maxSpeedKmh) || 0;
    if (speed > maxSpeed && speed < 300) maxSpeed = speed;
    if (trip.dayKey) days.add(trip.dayKey);
  }

  const liters = periodRefuels.reduce((sum, r) => sum + (Number(r.liters) || 0), 0);
  const fuelCost = periodRefuels.reduce((sum, r) => sum + (Number(r.totalCost) || 0), 0);
  const otherCost = periodExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  // Самая дорогая категория трат — если тратили не только на топливо.
  const byCategory = new Map();
  for (const expense of periodExpenses) {
    const key = expense.category || 'other';
    byCategory.set(key, (byCategory.get(key) || 0) + (Number(expense.amount) || 0));
  }
  const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];

  const carKm = carMeters / 1000;
  const spent = fuelCost + otherCost;

  return {
    from,
    to,
    tripsCount: periodTrips.length,
    carKm: carKm > 0 ? carKm : null,
    walkKm: footMeters > 0 ? footMeters / 1000 : null,
    movingHours: movingSec > 0 ? movingSec / 3600 : null,
    maxSpeedKmh: maxSpeed > 0 ? maxSpeed : null,
    daysDriven: days.size > 0 ? days.size : null,
    // Топливо — только из внесённых заправок. Оценки по паспорту здесь нет.
    fuelLiters: periodRefuels.length ? liters : null,
    fuelCost: periodRefuels.length ? fuelCost : null,
    otherCost: periodExpenses.length ? otherCost : null,
    spent: spent > 0 ? spent : null,
    // Рубль за километр честен, только если есть и траты, и пробег.
    costPerKm: spent > 0 && carKm > 0 ? spent / carKm : null,
    topCategory: top ? { key: top[0], amount: top[1] } : null,
    isEmpty: periodTrips.length === 0 && periodRefuels.length === 0 && periodExpenses.length === 0,
  };
}
