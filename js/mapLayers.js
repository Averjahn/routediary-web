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
};

const STORE_KEY = 'routediary.mapProvider';

export function getMapProvider() {
  const id = localStorage.getItem(STORE_KEY);
  return MAP_LAYERS[id] ? id : 'osm';
}

export function setMapProvider(id) {
  if (MAP_LAYERS[id]) localStorage.setItem(STORE_KEY, id);
}
