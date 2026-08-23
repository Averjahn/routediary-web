// Парсер компактного формата справочника — портирован из VehicleCatalog.swift (метод parse).
import { VEHICLE_CATALOG_RAW } from './vehicleData.js';
import { makeRank, detectRegion } from './vehicleRegion.js';

export const FUEL_CODES = { p: 'petrol', d: 'diesel', h: 'hybrid', e: 'electric', g: 'gas' };

function splitAliases(value) {
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

function parseCatalog(raw) {
  const makes = [];
  let make = null, model = null;

  function flushModel() {
    if (model) { make.models.push(model); model = null; }
  }
  function flushMake() {
    flushModel();
    if (make) { makes.push(make); make = null; }
  }

  const lines = raw.split('\n').filter(l => l.length > 0);
  for (const line of lines) {
    const marker = line[0];
    const payload = line.slice(1);
    const parts = payload.split('|');
    if (marker === '#') {
      flushMake();
      if (parts.length < 3) continue;
      make = {
        id: parts[0], nameEn: parts[1], nameRu: parts[2],
        aliases: parts[3] ? splitAliases(parts[3]) : [],
        // Пометка источника: марки, которые реально ездят по России.
        popular: parts[4] === '1',
        models: [],
      };
    } else if (marker === '>') {
      flushModel();
      if (parts.length < 2) continue;
      model = {
        id: parts[0], makeId: make.id, name: parts[1],
        aliases: parts[2] ? splitAliases(parts[2]) : [],
        // Годы выпуска и европейский класс — из справочника, не выдуманы.
        // Годы нужны движку регламента (карбюратор или инжектор решается
        // по году), класс — чтобы не предлагать «Оке» бак на 50 литров.
        years: parts[3] || '',
        cls: parts[4] || '',
        trims: [],
      };
    } else if (marker === '-') {
      if (parts.length < 8 || !model) continue;
      const trimIndex = model.trims.length;
      model.trims.push({
        id: model.id + '_' + trimIndex,
        makeId: make.id, modelId: model.id,
        name: parts[0],
        engineVolumeL: parseFloat(parts[1]) || 0,
        fuelType: FUEL_CODES[parts[2]] || 'petrol',
        powerHp: parseInt(parts[3], 10) || 0,
        tankLiters: parseFloat(parts[4]) || 0,
        consumptionCombinedL100: parseFloat(parts[5]) || 0,
        curbWeightKg: parseFloat(parts[6]) || 0,
        years: parts[7] || '',
      });
    }
  }
  flushMake();
  return makes;
}

/**
 * Порядок марок в списке — под страну человека.
 *
 * Раньше наверх поднимались марки с пометкой popular из справочника, а она
 * означает «популярно в России». Немцу это не помогало: до Volkswagen всё
 * равно надо было листать мимо «212», «Abarth» и трёхсот других.
 *
 * Флаг popular из справочника здесь НЕ используется: он означает
 * «популярно в России», и для немца поднимал наверх Lada, GAZ и Daewoo
 * сразу за немецкими марками. Когда страна известна, всё, чего нет в её
 * списке, идёт по алфавиту — предсказуемый хвост лучше произвольного.
 * Российская популярность живёт теперь в самом RU_MARKET, где ей и место.
 */
export function sortMakesForRegion(makes, region) {
  return [...makes].sort((a, b) => {
    const ra = makeRank(a.nameEn, region);
    const rb = makeRank(b.nameEn, region);
    if (ra !== rb) return ra - rb;
    return a.nameEn.localeCompare(b.nameEn);
  });
}

const ALL_MAKES = parseCatalog(VEHICLE_CATALOG_RAW);

/**
 * Список для показа. Пересобирается при смене страны в настройках —
 * сортировать четыреста записей на каждый показ экрана незачем.
 */
export let VEHICLE_MAKES = sortMakesForRegion(ALL_MAKES, detectRegion());

export function applyRegion(region) {
  VEHICLE_MAKES = sortMakesForRegion(ALL_MAKES, region);
  return VEHICLE_MAKES;
}

export function makeCount() { return VEHICLE_MAKES.length; }
export function modelCount() { return VEHICLE_MAKES.reduce((s, m) => s + m.models.length, 0); }
export function trimCount() { return VEHICLE_MAKES.reduce((s, m) => s + m.models.reduce((s2, mo) => s2 + mo.trims.length, 0), 0); }

export function getMake(id) { return VEHICLE_MAKES.find(m => m.id === id) || null; }
export function getModel(makeId, modelId) {
  const make = getMake(makeId);
  return make ? make.models.find(m => m.id === modelId) || null : null;
}
export function getTrim(makeId, modelId, trimId) {
  const model = getModel(makeId, modelId);
  return model ? model.trims.find(t => t.id === trimId) || null : null;
}

function normalize(value) {
  return (value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // diacritics
    .trim();
}

function matches(needle, haystack) {
  if (!needle) return true;
  return normalize(haystack).includes(needle);
}

export function searchMakes(query) {
  const needle = normalize(query);
  if (!needle) return VEHICLE_MAKES;
  return VEHICLE_MAKES.filter(make => {
    if (matches(needle, make.nameEn) || matches(needle, make.nameRu)) return true;
    if (make.aliases.some(a => matches(needle, a))) return true;
    for (const model of make.models) {
      if (matches(needle, model.name)) return true;
      if (model.aliases.some(a => matches(needle, a))) return true;
    }
    return false;
  });
}

export function searchModels(make, query) {
  const needle = normalize(query);
  if (!needle) return make.models;
  return make.models.filter(model => {
    if (matches(needle, model.name)) return true;
    if (model.aliases.some(a => matches(needle, a))) return true;
    return false;
  });
}

/**
 * Название марки для показа — всегда как пишет сам производитель.
 *
 * Русские написания в справочнике есть («Абарт», «Акура», «Альфа Ромео»),
 * но это транслитерация, а не перевод: на машине, в документах и в магазине
 * запчастей марка написана латиницей, и показывать «Акура» там, где человек
 * ищет Acura, — только сбивать. Русские написания остаются для ПОИСКА:
 * набравший «тойота» должен найти Toyota.
 */
export function makeDisplayName(make) {
  return make.nameEn || make.nameRu || '';
}
