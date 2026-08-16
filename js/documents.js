/**
 * Сроки документов автомобиля: ОСАГО и техосмотр.
 *
 * Модуль чистый — ни DOM, ни базы: вся логика прогоняется тестами в node.
 *
 * Дата хранится строкой «ГГГГ-ММ-ДД» прямо на объекте машины (машины и так
 * синхронизируются целиком), а не отметкой времени: полис действует «до
 * конца дня» по календарю, и часовой пояс телефона не должен сдвигать срок
 * на сутки туда-обратно.
 *
 * Про техосмотр важно: частным легковым он с 2021 года в общем случае не
 * обязателен. Поэтому пустая дата — это не «забыли», а нормальное состояние,
 * и приложение при пустой дате молчит, а не ноет.
 */

// За сколько дней начинать говорить «скоро». Месяц — время спокойно
// сравнить цены; неделя — уже пора, дальше ездить без полиса штрафно.
export const SOON_DAYS = 30;
export const URGENT_DAYS = 7;

export const DOC_TYPES = ['osago', 'inspection'];

function parseDate(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

/**
 * Статус одного документа.
 *
 * @param {string|null} untilStr «ГГГГ-ММ-ДД» или пусто
 * @returns {{state: 'none'|'ok'|'soon'|'urgent'|'expired', daysLeft: number|null}}
 */
export function documentStatus(untilStr, now = Date.now()) {
  const parsed = parseDate(untilStr || '');
  if (!parsed) return { state: 'none', daysLeft: null };

  // Дни считаются разницей календарных дат, а не делением интервала на 24
  // часа: полис «до завтра» — это один день и в 9 утра, и в 23:50. Round,
  // а не floor — переход на летнее время делает сутки 23-часовыми, и floor
  // на них терял бы день.
  const nowDate = new Date(now);
  const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
  const startOfUntil = new Date(parsed.y, parsed.m - 1, parsed.d).getTime();
  const daysLeft = Math.round((startOfUntil - startOfToday) / 864e5);

  if (daysLeft < 0) return { state: 'expired', daysLeft };
  if (daysLeft <= URGENT_DAYS) return { state: 'urgent', daysLeft };
  if (daysLeft <= SOON_DAYS) return { state: 'soon', daysLeft };
  return { state: 'ok', daysLeft };
}

/**
 * Все предупреждения по машине, требующие внимания.
 * «ok» и «none» сюда не попадают: список — это то, о чём стоит напомнить.
 */
export function documentWarnings(vehicle, now = Date.now()) {
  const docs = vehicle?.documents || {};
  const out = [];
  for (const type of DOC_TYPES) {
    const status = documentStatus(docs[type], now);
    if (status.state === 'soon' || status.state === 'urgent' || status.state === 'expired') {
      out.push({ type, ...status });
    }
  }
  return out;
}
