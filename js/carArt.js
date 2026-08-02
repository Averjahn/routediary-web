// Силуэты автомобилей по типу кузова.
//
// ПОЧЕМУ СИЛУЭТЫ, А НЕ ФОТО. Бесплатной базы фотографий машин по маркам
// и моделям с прозрачным фоном и правом на коммерческое использование
// не существует: сервисы вроде imagin.studio отдают рендеры только по
// платной лицензии, а фото из Wikimedia имеют разнородные лицензии с
// требованием атрибуции и не сведены к единому стилю и ракурсу.
// Векторный силуэт: бесплатен, весит байты, работает офлайн, красится
// в выбранный пользователем цвет и одинаково выглядит для всех 300+
// моделей справочника — включая те, фото которых нигде не достать.

export const BODY_TYPES = ['sedan', 'hatchback', 'wagon', 'suv', 'offroad', 'pickup', 'van', 'coupe'];

// Тип кузова по id модели. Ключ — точный modelId, иначе работает эвристика ниже.
const EXPLICIT = {
  // Lada
  granta: 'sedan', vesta: 'sedan', vesta_sw_cross: 'wagon', largus: 'wagon',
  xray: 'hatchback', kalina: 'hatchback', priora: 'sedan', iskra: 'sedan',
  niva_legend: 'offroad', niva_travel: 'suv', lada21213: 'offroad', lada2131: 'offroad',
  lada2101: 'sedan', lada2103: 'sedan', lada2105: 'sedan', lada2106: 'sedan', lada2107: 'sedan',
  lada2102: 'wagon', lada2104: 'wagon', lada2111: 'wagon',
  lada2108: 'hatchback', lada2109: 'hatchback', lada2112: 'hatchback', lada2113: 'hatchback',
  lada2114: 'hatchback', lada21099: 'sedan', lada2110: 'sedan', lada2115: 'sedan',
  // UAZ
  patriot: 'offroad', hunter: 'offroad', uaz469: 'offroad', profi: 'pickup',
  pickup: 'pickup', uaz3909: 'van', uaz452: 'van',
  // Moskvich
  moskvich3: 'suv', moskvich3e: 'suv', moskvich6: 'sedan', moskvich8: 'suv',
  moskvich408: 'sedan', moskvich412: 'sedan', moskvich2140: 'sedan',
  moskvich2141: 'hatchback', svyatogor: 'hatchback', knyaz_vladimir: 'sedan',
  // GAZ
  gazelle_next: 'van', gazelle_business: 'van', sobol: 'van', gazon_next: 'van',
  volga_21: 'sedan', volga_24: 'sedan', volga_3102: 'sedan', volga_31029: 'sedan',
  volga_3110: 'sedan', volga_31105: 'sedan', volga_siber: 'sedan',
  // ZAZ / Izh / Oka
  zaz965: 'coupe', zaz966: 'coupe', zaz968: 'coupe',
  tavria: 'hatchback', slavuta: 'hatchback', sens: 'sedan', lanos: 'sedan', chance: 'sedan',
  izh412: 'sedan', izh2125: 'hatchback', izh2126: 'hatchback',
  izh2715: 'van', izh2717: 'van',
  oka1111: 'hatchback', oka11113: 'hatchback',
};

const KEYWORDS = [
  [/pickup|pick_up|hilux|amarok|ranger|navara|tundra|tacoma|frontier/i, 'pickup'],
  [/van|transit|sprinter|caddy|transporter|vito|ducato|boxer|combo/i, 'van'],
  [/wagon|estate|_sw|universal|touring|avant|variant|kombi/i, 'wagon'],
  [/coupe|roadster|cabrio|convertible/i, 'coupe'],
  [/prado|land_?cruiser|patrol|defender|wrangler|gelandewagen|g_?class|jimny|bronco/i, 'offroad'],
  [/suv|cross|rav4|tucson|sportage|tiguan|kuga|captur|duster|creta|x_?trail|jolion|coolray/i, 'suv'],
  [/hatch|golf|polo_?h|yaris|fiesta|swift|rio_?x|i20|ceed/i, 'hatchback'],
];

/** Тип кузова модели: явная таблица → ключевые слова → седан по умолчанию. */
export function bodyTypeFor(modelId = '', modelName = '') {
  if (EXPLICIT[modelId]) return EXPLICIT[modelId];
  const probe = `${modelId} ${modelName}`;
  for (const [re, type] of KEYWORDS) {
    if (re.test(probe)) return type;
  }
  return 'sedan';
}

// Силуэты: viewBox 0 0 240 104, машина «смотрит» вправо.
// {body} — кузов, {glass} — остекление, колёса рисуются отдельно.
const SHAPES = {
  sedan: {
    body: 'M14,78 L14,60 Q14,51 25,48 L74,42 Q86,23 114,21 L152,21 Q180,23 192,44 L217,50 Q228,53 228,64 L228,78 Z',
    glass: 'M88,42 L98,29 Q102,27 112,27 L150,27 Q164,29 176,43 Z',
    pillar: 'M126,27 L126,42',
  },
  hatchback: {
    body: 'M18,78 L18,58 Q18,48 30,44 L58,38 Q70,22 100,20 L146,20 Q178,23 192,45 L217,51 Q228,54 228,64 L228,78 Z',
    glass: 'M66,40 Q76,26 100,25 L144,25 Q162,27 175,43 Z',
    pillar: 'M118,25 L118,42',
  },
  wagon: {
    body: 'M14,78 L14,56 Q14,46 26,43 L38,21 Q44,19 58,19 L150,19 Q180,22 192,44 L217,50 Q228,53 228,64 L228,78 Z',
    glass: 'M42,41 L48,25 L150,25 Q166,27 176,42 Z',
    pillar: 'M96,25 L96,41 M136,25 L136,41',
  },
  suv: {
    body: 'M14,76 L14,52 Q14,42 27,39 L44,20 Q52,17 68,17 L156,17 Q182,20 194,41 L216,47 Q228,50 228,60 L228,76 Z',
    glass: 'M48,38 L56,23 L152,23 Q168,26 178,39 Z',
    pillar: 'M100,23 L100,38 M138,23 L138,38',
  },
  offroad: {
    body: 'M16,74 L16,46 Q16,36 28,34 L34,16 Q40,14 54,14 L164,14 Q186,17 196,36 L214,42 Q226,45 226,56 L226,74 Z',
    glass: 'M40,33 L44,20 L160,20 Q174,23 182,33 Z',
    pillar: 'M96,20 L96,33 M134,20 L134,33',
  },
  pickup: {
    body: 'M14,76 L14,50 L104,50 L104,40 Q112,20 136,18 L160,18 Q184,21 196,42 L216,48 Q228,51 228,61 L228,76 Z',
    glass: 'M116,39 L124,24 L158,24 Q172,27 180,39 Z',
    pillar: '',
  },
  van: {
    body: 'M14,76 L14,28 Q14,14 31,12 L170,12 Q194,16 204,38 L219,45 Q228,48 228,59 L228,76 Z',
    glass: 'M31,36 L31,19 L166,19 Q182,23 192,36 Z',
    pillar: 'M88,19 L88,36 M132,19 L132,36',
  },
  coupe: {
    body: 'M16,78 L16,60 Q16,50 28,47 L74,42 Q90,22 122,21 L146,22 Q176,26 190,45 L216,51 Q228,54 228,64 L228,78 Z',
    glass: 'M88,41 L100,28 Q106,26 124,27 L144,28 Q162,31 174,42 Z',
    pillar: '',
  },
};

// Позиции колёс по типу кузова: [заднее X, переднее X, Y, радиус].
const WHEELS = {
  sedan: [60, 186, 78, 17],
  hatchback: [62, 186, 78, 17],
  wagon: [60, 186, 78, 17],
  suv: [62, 186, 76, 19],
  offroad: [60, 186, 74, 21],
  pickup: [60, 186, 76, 18],
  van: [56, 190, 76, 18],
  coupe: [62, 186, 78, 17],
};

/** Затемнить hex-цвет на долю k (0..1) — для теней и колёсных арок. */
function darken(hex, k) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - k));
  const g = Math.round(((n >> 8) & 255) * (1 - k));
  const b = Math.round((n & 255) * (1 - k));
  return `rgb(${r},${g},${b})`;
}

/**
 * SVG-силуэт автомобиля выбранного цвета.
 * @param {string} type — тип кузова из BODY_TYPES
 * @param {string} color — hex цвет кузова, например '#C62828'
 */
export function carSilhouette(type, color = '#0A66D6', { width = 240 } = {}) {
  const shape = SHAPES[type] || SHAPES.sedan;
  const [rearX, frontX, wheelY, r] = WHEELS[type] || WHEELS.sedan;
  const stroke = darken(color, 0.45);
  const glass = 'rgba(255,255,255,0.34)';
  const wheel = '#1B1D21';
  const rim = 'rgba(255,255,255,0.5)';

  const wheelSvg = (cx) => `
    <circle cx="${cx}" cy="${wheelY}" r="${r}" fill="${wheel}"/>
    <circle cx="${cx}" cy="${wheelY}" r="${r * 0.45}" fill="${rim}"/>`;

  return `<svg class="car-art" viewBox="0 0 240 104" width="${width}" xmlns="http://www.w3.org/2000/svg" role="img">
    <ellipse cx="120" cy="96" rx="104" ry="6" fill="rgba(0,0,0,0.13)"/>
    <path d="${shape.body}" fill="${color}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>
    <path d="${shape.glass}" fill="${glass}"/>
    ${shape.pillar ? `<path d="${shape.pillar}" stroke="${stroke}" stroke-width="2" fill="none"/>` : ''}
    ${wheelSvg(rearX)}${wheelSvg(frontX)}
  </svg>`;
}

/** Палитра цветов кузова для выбора пользователем. */
export const CAR_COLORS = [
  { id: 'white',  hex: '#E8EAED', nameKey: 'color.white' },
  { id: 'silver', hex: '#A8AEB6', nameKey: 'color.silver' },
  { id: 'grey',   hex: '#5B6068', nameKey: 'color.grey' },
  { id: 'black',  hex: '#24262B', nameKey: 'color.black' },
  { id: 'red',    hex: '#C62828', nameKey: 'color.red' },
  { id: 'orange', hex: '#E06A1B', nameKey: 'color.orange' },
  { id: 'yellow', hex: '#E0B01B', nameKey: 'color.yellow' },
  { id: 'green',  hex: '#2E7D46', nameKey: 'color.green' },
  { id: 'blue',   hex: '#1E5FBF', nameKey: 'color.blue' },
  { id: 'navy',   hex: '#26365E', nameKey: 'color.navy' },
  { id: 'cyan',   hex: '#1E8FA8', nameKey: 'color.cyan' },
  { id: 'brown',  hex: '#6B4B32', nameKey: 'color.brown' },
];
