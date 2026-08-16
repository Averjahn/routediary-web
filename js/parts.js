/**
 * Склад запчастей и шин.
 *
 * Модуль чистый — ни DOM, ни базы: деталь ставится на машину на одном
 * пробеге и снимается на другом (или не снята вовсе), а весь расчёт износа —
 * чистая функция от этих двух чисел. Прогоняется тестами в node.
 *
 * Ресурс детали (км до износа) — это то, что знает сам человек про свою
 * деталь, а не наш справочник: у резины он разный даже у одной модели шины
 * в зависимости от стиля езды. Поэтому ресурс необязателен, и без него
 * модуль честно не считает процент износа, а не подставляет чужое число.
 */

export const CATEGORY = { PART: 'part', TIRE: 'tire' };

/** Деталь поставлена на машину на текущем пробеге. */
export function installPart({ name, category = CATEGORY.PART, resourceKm = null, note = '' }, atKm, now = Date.now()) {
  return {
    name, category, resourceKm: resourceKm > 0 ? resourceKm : null, note,
    installedAtKm: atKm, installedAt: now,
    removedAtKm: null, removedAt: null,
  };
}

/** Деталь снята. Пробег на момент снятия замораживает её износ навсегда. */
export function removePart(part, atKm, now = Date.now()) {
  return { ...part, removedAtKm: atKm, removedAt: now };
}

/**
 * Износ детали.
 *
 * @param {object} part
 * @param {number} currentOdometerKm пробег машины сейчас (для ещё стоящих)
 * @returns {{active, usedKm, remainingKm: number|null, wornPct: number|null}}
 */
export function partWear(part, currentOdometerKm) {
  const active = part.removedAtKm == null;
  const atKm = active ? currentOdometerKm : part.removedAtKm;

  // Пробег мог быть скорректирован владельцем и уйти ниже, чем был при
  // установке (счётчик поправили на настоящий пробег машины). Отрицательный
  // износ не бывает — это значит «почти новая», а не «минус километры».
  const usedKm = Math.max(0, atKm - part.installedAtKm);

  if (!part.resourceKm) {
    return { active, usedKm, remainingKm: null, wornPct: null };
  }

  const remainingKm = Math.max(0, part.resourceKm - usedKm);
  const wornPct = Math.min(100, Math.round((usedKm / part.resourceKm) * 100));
  return { active, usedKm, remainingKm, wornPct };
}

/** Только то, что сейчас стоит на машине — для главного списка склада. */
export function activeParts(parts) {
  return parts.filter(p => p.removedAtKm == null);
}

/** Снятое — история склада, отдельным списком. */
export function removedParts(parts) {
  return parts.filter(p => p.removedAtKm != null);
}
