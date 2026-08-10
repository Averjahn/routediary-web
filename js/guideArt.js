/**
 * Схемы к руководствам по замене.
 *
 * Намеренно схематичные, а не «как настоящие». Нарисовать похожий на фото
 * подкапотный отсек конкретной модели я не могу, а правдоподобная, но
 * неверная картинка хуже её отсутствия: человек будет искать деталь там,
 * где её нет, и в итоге открутит не то.
 *
 * Поэтому здесь показано устройство узла и принцип — что с чем соединено
 * и в каком порядке снимается, — а расположение на конкретной машине
 * руководство отправляет искать в справочнике по эксплуатации.
 *
 * Цвета берутся из темы приложения, чтобы схема читалась и на тёмном фоне.
 */

const S = {
  line: 'var(--text-primary)',
  soft: 'var(--text-secondary)',
  fill: 'var(--surface-alt)',
  accent: 'var(--accent)',
  warn: 'var(--danger)',
};

const label = (lang, ru, en) => (lang === 'en' ? en : ru);

const wrap = (body, title) => `
  <svg viewBox="0 0 320 200" role="img" aria-label="${title}" class="guide-svg">
    <style>
      .gl { stroke: ${S.line}; stroke-width: 2; fill: none; stroke-linejoin: round; stroke-linecap: round; }
      .gf { fill: ${S.fill}; stroke: ${S.line}; stroke-width: 2; }
      .ga { stroke: ${S.accent}; stroke-width: 2.5; fill: none; stroke-linecap: round; }
      .gw { stroke: ${S.warn}; stroke-width: 2.5; fill: none; stroke-linecap: round; }
      .gt { fill: ${S.soft}; font-size: 11px; font-family: inherit; }
      .gt-em { fill: ${S.accent}; font-size: 11px; font-weight: 600; font-family: inherit; }
    </style>
    ${body}
  </svg>`;

/** Слив масла: поддон, пробка и фильтр — что откуда течёт. */
const oil = (lang) => wrap(`
  <path class="gf" d="M40,40 h190 a10,10 0 0 1 10,10 v50 h-40 l-15,40 h-90 l-15,-40 h-40 v-50 a10,10 0 0 1 10,-10 z"/>
  <text class="gt" x="46" y="64">${label(lang, 'Двигатель', 'Engine')}</text>

  <path class="gl" d="M150,140 v14"/>
  <circle class="gf" cx="150" cy="160" r="7"/>
  <text class="gt-em" x="164" y="164">${label(lang, 'Сливная пробка', 'Drain plug')}</text>

  <ellipse class="gf" cx="255" cy="78" rx="16" ry="26"/>
  <path class="gl" d="M239,78 h32"/>
  <text class="gt-em" x="228" y="132">${label(lang, 'Фильтр', 'Filter')}</text>

  <path class="ga" d="M150,168 q0,16 -14,20"/>
  <path class="ga" d="M136,188 h-60"/>
  <path class="gl" d="M60,178 h20 v14 h-40 v-14 h8" />
  <text class="gt" x="20" y="172">${label(lang, 'Ёмкость', 'Pan')}</text>
`, label(lang, 'Схема слива масла', 'Engine oil drain diagram'));

/** Салонный фильтр: где искать и куда смотрит стрелка. */
const cabin = (lang) => wrap(`
  <path class="gf" d="M24,150 h272 v20 h-272 z"/>
  <text class="gt" x="30" y="164">${label(lang, 'Салон', 'Cabin')}</text>

  <path class="gl" d="M40,150 v-96 h240 v96"/>
  <text class="gt" x="48" y="46">${label(lang, 'Приборная панель', 'Dashboard')}</text>

  <path class="gf" d="M150,96 h96 v40 h-96 z"/>
  <text class="gt" x="158" y="126">${label(lang, 'Бардачок', 'Glovebox')}</text>

  <path class="gf" d="M96,96 h44 v40 h-44 z"/>
  <path class="gl" d="M102,100 v32 M110,100 v32 M118,100 v32 M126,100 v32 M134,100 v32"/>
  <text class="gt-em" x="70" y="88">${label(lang, 'Фильтр', 'Filter')}</text>

  <path class="ga" d="M74,116 h16"/>
  <path class="ga" d="M84,110 l7,6 l-7,6"/>
  <text class="gt-em" x="24" y="126">${label(lang, 'поток', 'airflow')}</text>
`, label(lang, 'Расположение салонного фильтра', 'Cabin filter location'));

/** Воздушный фильтр: короб, крышка, направление к двигателю. */
const air = (lang) => wrap(`
  <path class="gf" d="M30,60 h150 v90 h-150 z"/>
  <path class="gl" d="M30,84 h150"/>
  <text class="gt" x="38" y="78">${label(lang, 'Крышка', 'Lid')}</text>

  <path class="gf" d="M46,98 h118 v38 h-118 z"/>
  <path class="gl" d="M56,98 v38 M70,98 v38 M84,98 v38 M98,98 v38 M112,98 v38 M126,98 v38 M140,98 v38 M154,98 v38"/>
  <text class="gt-em" x="46" y="152">${label(lang, 'Фильтрующий элемент', 'Filter element')}</text>

  <circle class="gl" cx="40" cy="70" r="4"/>
  <circle class="gl" cx="170" cy="70" r="4"/>
  <text class="gt" x="186" y="74">${label(lang, 'защёлки', 'clips')}</text>

  <path class="gl" d="M180,110 q30,0 30,-20 v-10"/>
  <path class="gl" d="M186,122 q36,0 36,-32 v-10"/>
  <path class="gf" d="M198,50 h44 v30 h-44 z"/>
  <text class="gt" x="248" y="68">${label(lang, 'К двигателю', 'To engine')}</text>
`, label(lang, 'Устройство корпуса воздушного фильтра', 'Air filter housing'));

/** Свеча: что где, и где меряется зазор. */
const plug = (lang) => wrap(`
  <path class="gf" d="M120,24 h34 v52 h-34 z"/>
  <text class="gt" x="172" y="52">${label(lang, 'Изолятор', 'Insulator')}</text>

  <path class="gf" d="M112,76 h50 v26 h-50 z"/>
  <path class="gl" d="M112,82 h50 M112,90 h50 M112,98 h50"/>
  <text class="gt" x="172" y="94">${label(lang, 'Шестигранник', 'Hex')}</text>

  <path class="gf" d="M120,102 h34 v34 h-34 z"/>
  <path class="gl" d="M120,108 h34 M120,116 h34 M120,124 h34 M120,132 h34"/>
  <text class="gt" x="172" y="124">${label(lang, 'Резьба', 'Thread')}</text>

  <path class="gl" d="M132,136 v26"/>
  <path class="gl" d="M154,136 v14 h-14"/>
  <text class="gt-em" x="56" y="164">${label(lang, 'зазор', 'gap')}</text>
  <path class="ga" d="M104,156 h24"/>
  <path class="gw" d="M132,162 v-6 M140,150 v-6"/>
`, label(lang, 'Устройство свечи зажигания', 'Spark plug anatomy'));

/** Аккумулятор: порядок снятия клемм — это и есть главное. */
const battery = (lang) => wrap(`
  <path class="gf" d="M60,60 h200 v100 h-200 z"/>
  <path class="gl" d="M60,84 h200"/>

  <path class="gf" d="M92,44 h26 v16 h-26 z"/>
  <text class="gt-em" x="96" y="38">+</text>
  <path class="gf" d="M204,44 h26 v16 h-26 z"/>
  <text class="gt-em" x="210" y="38">−</text>

  <text class="gt" x="72" y="120">${label(lang, 'Аккумулятор 12 В', '12 V battery')}</text>

  <circle class="ga" cx="217" cy="30" r="11"/>
  <text class="gt-em" x="213" y="34">1</text>
  <circle class="ga" cx="105" cy="30" r="11"/>
  <text class="gt-em" x="101" y="34">2</text>

  <text class="gt-em" x="60" y="184">${label(lang, 'Снимаем: − потом +', 'Remove: − then +')}</text>
  <text class="gt-em" x="60" y="197">${label(lang, 'Ставим наоборот', 'Refit in reverse')}</text>
`, label(lang, 'Порядок снятия клемм аккумулятора', 'Battery terminal order'));

/** Тормозной механизм: что снимается и чего нельзя нагружать. */
const brake = (lang) => wrap(`
  <circle class="gf" cx="120" cy="100" r="62"/>
  <circle class="gl" cx="120" cy="100" r="26"/>
  <text class="gt" x="102" y="110">${label(lang, 'Диск', 'Disc')}</text>

  <path class="gf" d="M168,64 h44 a12,12 0 0 1 12,12 v48 a12,12 0 0 1 -12,12 h-44 z"/>
  <text class="gt" x="230" y="100">${label(lang, 'Суппорт', 'Caliper')}</text>

  <path class="gf" d="M160,72 h8 v56 h-8 z"/>
  <path class="gf" d="M176,72 h8 v56 h-8 z"/>
  <text class="gt-em" x="150" y="152">${label(lang, 'Колодки', 'Pads')}</text>

  <circle class="gl" cx="216" cy="76" r="5"/>
  <circle class="gl" cx="216" cy="124" r="5"/>
  <text class="gt" x="222" y="140">${label(lang, 'направляющие', 'slide pins')}</text>

  <path class="gw" d="M224,100 q26,0 26,-30 v-24"/>
  <text class="gt-em" x="222" y="34">${label(lang, 'Шланг: не нагружать', 'Hose: never load')}</text>
`, label(lang, 'Устройство тормозного механизма', 'Brake assembly'));

const DIAGRAMS = { oil, cabin, air, plug, battery, brake };

/** Схема по имени. Пустая строка, если схемы нет — это не ошибка. */
export function diagram(name, lang = 'ru') {
  const draw = DIAGRAMS[name];
  return draw ? draw(lang) : '';
}

export function hasDiagram(name) {
  return !!DIAGRAMS[name];
}

export const DIAGRAM_NAMES = Object.keys(DIAGRAMS);
