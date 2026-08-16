/**
 * Экспорт данных: CSV для Excel и печатный отчёт.
 *
 * Модуль чистый — ни DOM, ни базы. Скачивание и окно печати живут на
 * экране настроек; здесь только превращение записей в текст, поэтому все
 * тонкости формата прогоняются тестами в node.
 *
 * Почему CSV именно такой:
 *  - разделитель «;», а не запятая: русский Excel считает запятую
 *    десятичным знаком и склеивает столбцы при «,»;
 *  - десятичные — с запятой в русском варианте по той же причине;
 *  - CRLF и кавычки по RFC 4180: значение с разделителем, кавычкой или
 *    переводом строки берётся в кавычки, кавычки внутри удваиваются;
 *  - BOM добавляется в момент скачивания, не здесь: без BOM Excel читает
 *    UTF-8 как «кракозябры», но самому тексту он не принадлежит.
 *
 * «PDF» — это печатный отчёт: собранный здесь HTML открывается в окне
 * печати, и браузер сам сохраняет его в PDF. Свой генератор PDF тянул бы
 * встраивание шрифтов ради кириллицы — сотни килобайт кода ради того, что
 * браузер умеет из коробки.
 */

const HEADERS = {
  ru: {
    refuels: ['Дата', 'Литры', 'Цена за литр', 'Сумма', 'Полный бак', 'Одометр, км'],
    expenses: ['Дата', 'Категория', 'Сумма', 'Одометр, км', 'Заметка'],
    incomes: ['Дата', 'Категория', 'Сумма', 'Заметка'],
    trips: ['Дата', 'Начало', 'Конец', 'Км', 'В пути, мин', 'Режим'],
    maintenance: ['Узел', 'Последняя замена, км', 'Дата замены', 'Интервал, км'],
  },
  en: {
    refuels: ['Date', 'Liters', 'Price per liter', 'Total', 'Full tank', 'Odometer, km'],
    expenses: ['Date', 'Category', 'Amount', 'Odometer, km', 'Note'],
    incomes: ['Date', 'Category', 'Amount', 'Note'],
    trips: ['Date', 'Start', 'End', 'Km', 'Moving, min', 'Mode'],
    maintenance: ['Component', 'Last service, km', 'Service date', 'Interval, km'],
  },
};

const SEP = ';';

/** Значение → ячейка CSV. Кавычим только когда без этого нельзя. */
export function csvCell(value) {
  const s = value == null ? '' : String(value);
  if (/[";\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Число → строка с десятичной запятой для русского Excel. */
export function num(value, lang = 'ru') {
  if (value == null || !Number.isFinite(value)) return '';
  const rounded = Math.round(value * 100) / 100;
  const s = String(rounded);
  return lang === 'ru' ? s.replace('.', ',') : s;
}

export function toCsv(header, rows) {
  const lines = [header, ...rows].map(row => row.map(csvCell).join(SEP));
  return lines.join('\r\n') + '\r\n';
}

function fmtDate(ms, withTime = false) {
  const d = new Date(ms);
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  if (!withTime) return date;
  return `${date} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Записи не старше отметки. Пустая отметка — всё. */
export function filterByPeriod(records, fromMs, dateOf = (r) => r.date) {
  if (!fromMs) return records;
  return records.filter(r => dateOf(r) >= fromMs);
}

/**
 * Пачка CSV-файлов по данным машины.
 * Пустые разделы не попадают в результат: файл из одного заголовка — мусор.
 */
export function buildCsvBundle({ refuels = [], expenses = [], incomes = [], trips = [], maintenance = [] },
  { lang = 'ru', fromMs = 0, categoryName = (c) => c, modeName = (m) => m } = {}) {
  const h = HEADERS[lang] || HEADERS.ru;
  const files = [];

  const rf = filterByPeriod(refuels, fromMs);
  if (rf.length) {
    files.push({
      name: 'refuels.csv',
      csv: toCsv(h.refuels, rf.map(r => [
        fmtDate(r.date), num(r.liters, lang), num(r.pricePerLiter, lang), num(r.totalCost, lang),
        r.isFullTank ? '+' : '', num(r.odometerKm, lang),
      ])),
    });
  }

  const ex = filterByPeriod(expenses, fromMs);
  if (ex.length) {
    files.push({
      name: 'expenses.csv',
      csv: toCsv(h.expenses, ex.map(e => [
        fmtDate(e.date), categoryName(e.category), num(e.amount, lang), num(e.odometerKm, lang), e.note || '',
      ])),
    });
  }

  const inc = filterByPeriod(incomes, fromMs);
  if (inc.length) {
    files.push({
      name: 'incomes.csv',
      csv: toCsv(h.incomes, inc.map(i => [
        fmtDate(i.date), categoryName(i.category), num(i.amount, lang), i.note || '',
      ])),
    });
  }

  const tr = filterByPeriod(trips, fromMs, (t) => t.startTime);
  if (tr.length) {
    files.push({
      name: 'trips.csv',
      csv: toCsv(h.trips, tr.map(t => [
        fmtDate(t.startTime), fmtDate(t.startTime, true).slice(11), fmtDate(t.endTime, true).slice(11),
        num(t.distanceMeters / 1000, lang), num(Math.round((t.movingTimeSec || 0) / 60), lang), modeName(t.mode),
      ])),
    });
  }

  // Обслуживание — текущее состояние, а не журнал: период к нему не применим.
  if (maintenance.length) {
    files.push({
      name: 'maintenance.csv',
      csv: toCsv(h.maintenance, maintenance.map(m => [
        m.title, num(m.lastServiceKm, lang),
        m.lastServiceDate ? fmtDate(new Date(m.lastServiceDate).getTime()) : '',
        num(m.intervalKm, lang),
      ])),
    });
  }

  return files;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Печатный отчёт одним HTML-документом.
 *
 * Все пользовательские строки экранируются: заметка к расходу с «<script>»
 * внутри — это данные, а не разметка, и попадать в отчёт кодом она не должна.
 */
export function reportHtml({ vehicleName, refuels = [], expenses = [], incomes = [], fromMs = 0, lang = 'ru',
  categoryName = (c) => c, currency = '₽' } = {}) {
  const L = lang === 'en'
    ? { title: 'Vehicle report', refuels: 'Refuels', expenses: 'Expenses', incomes: 'Income',
        total: 'Total', spent: 'Spent', earned: 'Earned', net: 'Net', date: 'Date', sum: 'Amount', what: 'Category' }
    : { title: 'Отчёт по автомобилю', refuels: 'Заправки', expenses: 'Расходы', incomes: 'Доходы',
        total: 'Итого', spent: 'Потрачено', earned: 'Заработано', net: 'Чистыми', date: 'Дата', sum: 'Сумма', what: 'Категория' };

  const rf = filterByPeriod(refuels, fromMs);
  const ex = filterByPeriod(expenses, fromMs);
  const inc = filterByPeriod(incomes, fromMs);

  const fuelSum = rf.reduce((s, r) => s + (r.totalCost || 0), 0);
  const spentSum = fuelSum + ex.reduce((s, e) => s + (e.amount || 0), 0);
  const earnedSum = inc.reduce((s, i) => s + (i.amount || 0), 0);

  const money = (v) => `${num(v, lang)} ${currency}`;
  const table = (title, header, rows) => rows.length ? `
    <h2>${escapeHtml(title)}</h2>
    <table><thead><tr>${header.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<title>${escapeHtml(L.title)} — ${escapeHtml(vehicleName || '')}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 20px; } h2 { font-size: 15px; margin: 18px 0 6px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
  th { background: #f2f2f2; }
  .totals { margin-top: 18px; font-size: 14px; }
  .totals b { display: inline-block; min-width: 120px; }
  @media print { body { margin: 8mm; } }
</style></head><body>
<h1>${escapeHtml(L.title)} — ${escapeHtml(vehicleName || '')}</h1>
${table(L.refuels, [L.date, 'Л', L.sum], rf.map(r => [fmtDate(r.date), num(r.liters, lang), money(r.totalCost)]))}
${table(L.expenses, [L.date, L.what, L.sum], ex.map(e => [fmtDate(e.date), categoryName(e.category), money(e.amount)]))}
${table(L.incomes, [L.date, L.what, L.sum], inc.map(i => [fmtDate(i.date), categoryName(i.category), money(i.amount)]))}
<div class="totals">
  <div><b>${escapeHtml(L.spent)}:</b> ${money(spentSum)}</div>
  ${earnedSum > 0 ? `<div><b>${escapeHtml(L.earned)}:</b> ${money(earnedSum)}</div>
  <div><b>${escapeHtml(L.net)}:</b> ${money(earnedSum - spentSum)}</div>` : ''}
</div>
</body></html>`;
}
