/**
 * Европейский класс автомобиля → разумные начальные значения формы.
 *
 * ЧТО ЗДЕСЬ ДАННЫЕ, А ЧТО ОЦЕНКА — это важно различать.
 *
 * Класс модели (A, B, C, D, E, F, S, M, J) берётся из справочника: это
 * данные источника, не наша выдумка. А вот сами числа ниже — объём бака,
 * расход, масса — это типичные величины для класса, то есть ОЦЕНКА. У двух
 * машин одного класса они различаются, и точных характеристик конкретной
 * модификации у нас нет.
 *
 * Почему это всё равно лучше нынешнего: сейчас форма предлагает 1.6 л,
 * 110 л.с., бак 50 л и 8 л/100 км вообще всем — и «Оке», и Land Cruiser.
 * Класс сужает промах с «в разы» до «на десяток процентов», а человек
 * поправляет поля, глядя в документы.
 *
 * И главное: расход всё равно перестаёт быть оценкой, как только наберутся
 * две заправки до полного бака — приложение считает настоящий по пробегу
 * между ними (см. computeMeasuredConsumption). Эти числа нужны лишь чтобы
 * первые дни приложение показывало правдоподобное, а не заведомо чужое.
 */

/** Значения по умолчанию, когда класс неизвестен, — как было раньше. */
export const FALLBACK = {
  engineVolumeL: 1.6, powerHp: 110, tankLiters: 50,
  consumptionL100: 8, curbWeightKg: 1300,
};

const BY_CLASS = {
  // A — особо малый: Ока, Matiz, Picanto, Smart.
  A: { engineVolumeL: 1.0, powerHp: 68, tankLiters: 35, consumptionL100: 5.5, curbWeightKg: 900 },
  // B — малый: Rio, Polo, Granta, Solaris. Самый массовый класс в России.
  B: { engineVolumeL: 1.6, powerHp: 110, tankLiters: 50, consumptionL100: 7, curbWeightKg: 1150 },
  // C — «гольф-класс»: Focus, Octavia, Corolla, Ceed.
  C: { engineVolumeL: 1.6, powerHp: 125, tankLiters: 55, consumptionL100: 7.5, curbWeightKg: 1300 },
  // D — средний: Camry, Passat, Mazda 6.
  D: { engineVolumeL: 2.0, powerHp: 150, tankLiters: 60, consumptionL100: 8.5, curbWeightKg: 1500 },
  // E — бизнес: E-класс, 5 series, A6.
  E: { engineVolumeL: 2.5, powerHp: 200, tankLiters: 66, consumptionL100: 9.5, curbWeightKg: 1700 },
  // F — представительский: S-класс, 7 series.
  F: { engineVolumeL: 3.0, powerHp: 280, tankLiters: 80, consumptionL100: 11, curbWeightKg: 2000 },
  // S — купе и спорт.
  S: { engineVolumeL: 2.5, powerHp: 250, tankLiters: 60, consumptionL100: 10, curbWeightKg: 1500 },
  // M — минивэны и компактвэны.
  M: { engineVolumeL: 2.0, powerHp: 140, tankLiters: 60, consumptionL100: 9, curbWeightKg: 1600 },
  // J — внедорожники и кроссоверы: самый широкий класс, от Duster до Патруля.
  J: { engineVolumeL: 2.0, powerHp: 150, tankLiters: 60, consumptionL100: 9.5, curbWeightKg: 1650 },
};

/** Начальные значения для класса. Неизвестный класс — прежние умолчания. */
export function defaultsForClass(cls) {
  return { ...(BY_CLASS[String(cls || '').toUpperCase()] || FALLBACK) };
}

/** Есть ли для класса своя прикидка (иначе показывать пометку незачем). */
export function hasClassDefaults(cls) {
  return Boolean(BY_CLASS[String(cls || '').toUpperCase()]);
}
