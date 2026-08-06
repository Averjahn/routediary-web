// Подложки карты. Четыре штуки, все бесплатные и без API-ключа.
//
// ПОЧЕМУ ТАК МАЛО. Раньше здесь было одиннадцать слоёв, включая три
// дизайнерских стиля Thunderforest с обязательной регистрацией ради ключа.
// В дневнике поездок карта — фон для трека, а не самоцель: длинный список
// заставляет выбирать там, где выбирать нечего, а форма ввода API-ключа
// на этом экране вообще выглядит как ошибка. Оставлены четыре варианта,
// каждый под свою реальную ситуацию, и ни один ничего не требует от пользователя.
export const MAP_LAYERS = {
  // По умолчанию: почти белая подложка, дороги бледные — цветной трек читается
  // поверх неё лучше, чем на любой другой.
  plain: {
    nameKey: 'map.layer_plain',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: 'abcd',
  },
  // Для тёмной темы и ночных поездок.
  dark: {
    nameKey: 'map.layer_dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: 'abcd',
  },
  // Когда нужно понять, где именно ты был: дома, дворы, парковки.
  satellite: {
    nameKey: 'map.layer_satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19,
  },
  // Максимум деталей: номера домов, съезды, названия организаций.
  detailed: {
    nameKey: 'map.layer_detailed',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
};

const STORE_KEY = 'routediary.mapProvider';

// Старые id из прошлой версии — чтобы у тех, кто уже выбирал слой,
// карта не сбросилась молча на дефолт.
const LEGACY = {
  osm: 'detailed',
  cartoLight: 'plain',
  cartoDark: 'dark',
  cartoVoyager: 'plain',
  topo: 'detailed',
  natgeo: 'detailed',
  streetsEsri: 'detailed',
  tfOutdoors: 'detailed',
  tfPioneer: 'plain',
  tfNeighbourhood: 'plain',
};

export function getMapProvider() {
  const id = localStorage.getItem(STORE_KEY);
  if (MAP_LAYERS[id]) return id;
  if (id && LEGACY[id]) return LEGACY[id];
  return 'plain';
}

export function setMapProvider(id) {
  if (MAP_LAYERS[id]) localStorage.setItem(STORE_KEY, id);
}

export function buildTileUrl(layer) {
  return layer.url;
}
