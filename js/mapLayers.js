// Провайдеры тайлов карты — все бесплатные, без API-ключа.
// "satellite" и "topo" — реальные спутниковые/рельефные снимки от Esri/OpenTopoMap,
// не перекраска той же OSM-подложки.
export const MAP_LAYERS = {
  osm: {
    nameKey: 'map.layer_osm',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  cartoLight: {
    nameKey: 'map.layer_carto_light',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: 'abcd',
  },
  cartoDark: {
    nameKey: 'map.layer_carto_dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: 'abcd',
  },
  cartoVoyager: {
    nameKey: 'map.layer_carto_voyager',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: 'abcd',
  },
  satellite: {
    nameKey: 'map.layer_satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19,
  },
  topo: {
    nameKey: 'map.layer_topo',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17,
    subdomains: 'abc',
  },
  // Дизайнерские стили Thunderforest — требуют бесплатный личный API-ключ
  // (регистрация без карты, ~150k тайлов/мес на free-плане).
  tfOutdoors: {
    nameKey: 'map.layer_tf_outdoors',
    url: 'https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey={apiKey}',
    attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://www.thunderforest.com/">Thunderforest</a>',
    maxZoom: 22,
    requiresKey: 'thunderforest',
  },
  tfPioneer: {
    nameKey: 'map.layer_tf_pioneer',
    url: 'https://tile.thunderforest.com/pioneer/{z}/{x}/{y}.png?apikey={apiKey}',
    attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://www.thunderforest.com/">Thunderforest</a>',
    maxZoom: 22,
    requiresKey: 'thunderforest',
  },
  tfNeighbourhood: {
    nameKey: 'map.layer_tf_neighbourhood',
    url: 'https://tile.thunderforest.com/neighbourhood/{z}/{x}/{y}.png?apikey={apiKey}',
    attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://www.thunderforest.com/">Thunderforest</a>',
    maxZoom: 22,
    requiresKey: 'thunderforest',
  },
};

// Провайдеры, требующие персональный ключ пользователя.
export const KEY_PROVIDERS = {
  thunderforest: {
    signupUrl: 'https://www.thunderforest.com/docs/apikeys/',
    storeKey: 'routediary.apiKey.thunderforest',
  },
};

const STORE_KEY = 'routediary.mapProvider';

export function getMapProvider() {
  const id = localStorage.getItem(STORE_KEY);
  return MAP_LAYERS[id] ? id : 'osm';
}

export function setMapProvider(id) {
  if (MAP_LAYERS[id]) localStorage.setItem(STORE_KEY, id);
}

export function getApiKey(providerId) {
  const p = KEY_PROVIDERS[providerId];
  return (p && localStorage.getItem(p.storeKey)) || '';
}

export function setApiKey(providerId, value) {
  const p = KEY_PROVIDERS[providerId];
  if (p) localStorage.setItem(p.storeKey, value.trim());
}

export function isLayerUnlocked(layer) {
  return !layer.requiresKey || !!getApiKey(layer.requiresKey);
}

export function buildTileUrl(layer) {
  if (!layer.requiresKey) return layer.url;
  return layer.url.replace('{apiKey}', encodeURIComponent(getApiKey(layer.requiresKey)));
}
