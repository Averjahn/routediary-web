/**
 * Картинка с итогами периода — то, что человек отправляет в чат.
 *
 * Рисуется на устройстве, в canvas. На сервер не уходит ничего: это те же
 * данные о поездках, которые у нас и так никуда не отправляются.
 *
 * ЧЕГО НА КАРТИНКЕ НЕТ И НЕ БУДЕТ: карты, адресов, точек старта и финиша.
 * Человек делится числами — «1 240 км за май», — а не своими маршрутами.
 * Картинка уходит в чужие руки, и по ней не должно быть видно, где он живёт.
 */

const W = 1080;
const H = 1350;
const BG = '#111113';
const ACCENT = '#0a84ff';
const TEXT = '#f5f5f7';
const MUTED = '#96969e';

/** Одна строка-показатель: значение крупно, подпись мелко. */
function drawStat(ctx, x, y, value, label) {
  ctx.fillStyle = TEXT;
  ctx.font = '600 64px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(value, x, y);
  ctx.fillStyle = MUTED;
  ctx.font = '32px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(label, x, y + 44);
}

/**
 * Рисует карточку. brand и labels — уже переведённые подписи: модуль не
 * знает про словари, поэтому и название приложения приходит снаружи (на
 * английском это «AVTOPULS», а не кириллица).
 *
 * Возвращает canvas; в файл его превращает toBlob ниже.
 */
export function drawSummaryCard(summary, { brand, title, subtitle, labels, format }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, 16, H);

  ctx.fillStyle = ACCENT;
  ctx.font = '600 34px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(brand, 80, 110);

  ctx.fillStyle = TEXT;
  ctx.font = '700 76px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(title, 80, 230);

  ctx.fillStyle = MUTED;
  ctx.font = '36px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(subtitle, 80, 290);

  // Главное число — пробег. Если его нет, главным становится то, что есть.
  const hero = summary.carKm !== null
    ? { value: format.km(summary.carKm), label: labels.carKm }
    : summary.spent !== null
      ? { value: format.money(summary.spent), label: labels.spent }
      : { value: String(summary.tripsCount), label: labels.trips };

  ctx.fillStyle = TEXT;
  ctx.font = '700 150px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(hero.value, 80, 470);
  ctx.fillStyle = MUTED;
  ctx.font = '38px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(hero.label, 80, 525);

  // Остальные показатели — только те, по которым есть данные. Пустые
  // строки с нулями здесь были бы не «аккуратной сеткой», а неправдой.
  const stats = [];
  if (summary.carKm !== null && hero.label !== labels.carKm) stats.push([format.km(summary.carKm), labels.carKm]);
  if (summary.tripsCount > 0 && hero.label !== labels.trips) stats.push([String(summary.tripsCount), labels.trips]);
  if (summary.daysDriven !== null) stats.push([String(summary.daysDriven), labels.days]);
  if (summary.movingHours !== null) stats.push([format.hours(summary.movingHours), labels.hours]);
  if (summary.fuelLiters !== null) stats.push([format.liters(summary.fuelLiters), labels.fuel]);
  if (summary.spent !== null && hero.label !== labels.spent) stats.push([format.money(summary.spent), labels.spent]);
  // Рубль за километр показываем с десятой долей: округление до целого
  // превращает 8,4 в 8 и съедает как раз ту точность, ради которой считают.
  if (summary.costPerKm !== null) {
    stats.push([(format.perKm || format.money)(summary.costPerKm), labels.perKm]);
  }
  if (summary.maxSpeedKmh !== null) stats.push([format.speed(summary.maxSpeedKmh), labels.maxSpeed]);

  let y = 700;
  for (let i = 0; i < Math.min(stats.length, 8); i++) {
    const column = i % 2;
    if (i > 0 && column === 0) y += 170;
    drawStat(ctx, 80 + column * 500, y, stats[i][0], stats[i][1]);
  }

  ctx.fillStyle = MUTED;
  ctx.font = '34px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('autocoyc.com', 80, H - 80);

  return canvas;
}

/** Canvas → файл PNG. */
export function canvasToBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Отдать картинку человеку: системным «поделиться», если оно есть, иначе
 * скачиванием. Второе важно для настольных браузеров, где share нет.
 */
export async function shareCard(blob, fileName, text) {
  const file = new File([blob], fileName, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (err) {
      // Человек закрыл окно «поделиться» — это не ошибка, молчим.
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}
