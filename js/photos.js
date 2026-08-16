/**
 * Фото чека при заправке или расходе.
 *
 * Это вложение, а не распознавание: снимок сохраняется, чтобы можно было
 * потом свериться глазами, но сумму и дату по нему никто не читает — цифр
 * из фотографии мы не выдумываем, поле остаётся ровно тем, что ввёл
 * человек. Если когда-то появится настоящее распознавание — это отдельная
 * функция, и врать про неё раньше времени незачем.
 *
 * Фото хранится только на этом устройстве и НЕ синхронизируется:
 *  - за несколько лет заправок это сотни снимков — вбивать их в 200 МБ
 *    квоты синхронизации нечестно по отношению к остальным данным;
 *  - шифровать двоичный blob той же схемой, что и текстовые записи,
 *    отдельная задача, которую лучше не делать между делом.
 * Второе устройство просто не увидит фото — запись при этом остаётся
 * целой, теряется только картинка.
 *
 * Сжатие в canvas — DOM-код, тестами в node не прогоняется; проверяется
 * в браузере. Здесь только то, что можно проверить без DOM: границы файла.
 */

export const MAX_SOURCE_BYTES = 15 * 1024 * 1024; // соразмерно фото с телефона
export const MAX_SIDE_PX = 1600;                  // чек читаем глазами, не печатаем
export const JPEG_QUALITY = 0.75;

/**
 * Годится ли файл для вложения. Отдельно от чтения файла — чтобы решение
 * «показать ошибку» принималось мгновенно, до того как файл начнёт читаться.
 */
export function acceptablePhoto(file) {
  if (!file) return { ok: false, reason: 'empty' };
  if (!file.type || !file.type.startsWith('image/')) return { ok: false, reason: 'not_image' };
  if (file.size > MAX_SOURCE_BYTES) return { ok: false, reason: 'too_big' };
  return { ok: true };
}

/**
 * Сжатое изображение в canvas, уменьшенное так, чтобы бо́льшая сторона не
 * превышала MAX_SIDE_PX. Меньшие фото не растягиваются — не выигрываем
 * ничего, а качество им портим.
 */
export function drawScaled(img, canvas) {
  const scale = Math.min(1, MAX_SIDE_PX / Math.max(img.naturalWidth, img.naturalHeight));
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}
