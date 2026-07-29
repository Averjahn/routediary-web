// Парсер компактного формата справочника — портирован из VehicleCatalog.swift (метод parse).
import { VEHICLE_CATALOG_RAW } from './vehicleData.js';

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
      make = { id: parts[0], nameEn: parts[1], nameRu: parts[2], aliases: parts[3] ? splitAliases(parts[3]) : [], models: [] };
    } else if (marker === '>') {
      flushModel();
      if (parts.length < 2) continue;
      model = { id: parts[0], makeId: make.id, name: parts[1], aliases: parts[2] ? splitAliases(parts[2]) : [], trims: [] };
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
  makes.sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  return makes;
}

export const VEHICLE_MAKES = parseCatalog(VEHICLE_CATALOG_RAW);

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

export function makeDisplayName(make, lang) {
  return lang === 'ru' ? make.nameRu : make.nameEn;
}
