// Кастомный набор иконок взамен эмодзи. 24×24, обводка currentColor —
// красится темой автоматически (тот же принцип, что и весь остальной UI),
// без растровых паков под каждую тему.

const S = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  // Вкладки
  map: `<path ${S} d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path ${S} d="M9 4v14M15 6v14"/>`,
  trips: `<path ${S} d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z"/><circle ${S} cx="12" cy="9" r="2.3"/>`,
  planner: `<rect ${S} x="3.5" y="5" width="17" height="16" rx="2.5"/><path ${S} d="M3.5 9.5h17M8 3v3.5M16 3v3.5"/>`,
  stats: `<path ${S} d="M5 20V11M12 20V4M19 20v-7"/>`,
  // Способы передвижения
  walk: `<circle ${S} cx="13.5" cy="4.5" r="1.6"/><path ${S} d="M11 8l2 3-1 3 3.5 2L17 20M11 8 8 9.5m3-1.5L8 20"/>`,
  run: `<circle ${S} cx="15" cy="4.5" r="1.6"/><path ${S} d="M8 20l3-4-1.5-4L13 9l2 3 4 1M8 12l3.5-3M6 8l3-1.5"/>`,
  bike: `<circle ${S} cx="6" cy="17" r="3.3"/><circle ${S} cx="18" cy="17" r="3.3"/><path ${S} d="M6 17l4-8h5l3 8M10 9H8m4 0 3 4"/>`,
  car: `<path ${S} d="M4 16.5V13l2-5h12l2 5v3.5"/><path ${S} d="M4 16.5h16M7 16.5v2.2M17 16.5v2.2"/><circle ${S} cx="7.5" cy="16.5" r="1.4"/><circle ${S} cx="16.5" cy="16.5" r="1.4"/>`,
  // Категории поездок
  categoryNone: `<circle ${S} cx="12" cy="12" r="8"/>`,
  work: `<rect ${S} x="3.5" y="7.5" width="17" height="12" rx="2"/><path ${S} d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5M3.5 12.5h17"/>`,
  home: `<path ${S} d="M4 11.5 12 4l8 7.5"/><path ${S} d="M6 10v9.5h12V10"/><path ${S} d="M10 19.5v-5h4v5"/>`,
  shop: `<path ${S} d="M4 8h16l-1.5 11H5.5L4 8Z"/><path ${S} d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2"/>`,
  medical: `<circle ${S} cx="12" cy="12" r="8.5"/><path ${S} d="M12 8v8M8 12h8"/>`,
  leisure: `<path ${S} d="m12 4 2.4 5.1 5.6.7-4.1 3.9 1 5.6L12 16.6 6.9 19.3l1-5.6-4.1-3.9 5.6-.7L12 4Z"/>`,
  // Расходы
  fuel: `<rect ${S} x="5" y="4" width="9" height="16" rx="1.5"/><rect ${S} x="7" y="7" width="5" height="4" rx="0.5"/><path ${S} d="M14 9h2.2l2.3 2.3v6.2a1.5 1.5 0 0 1-3 0v-1a1 1 0 0 0-1-1H14"/>`,
  wash: `<path ${S} d="M12 3s4.5 5.2 4.5 9a4.5 4.5 0 1 1-9 0C7.5 8.2 12 3 12 3Z"/>`,
  service: `<circle ${S} cx="12" cy="12" r="3.2"/><path ${S} d="M12 4.5v2.2M12 17.3v2.2M4.5 12h2.2M17.3 12h2.2M6.8 6.8l1.5 1.5M15.7 15.7l1.5 1.5M6.8 17.2l1.5-1.5M15.7 8.3l1.5-1.5"/>`,
  repairs: `<rect ${S} x="14" y="3" width="4" height="7" rx="1" transform="rotate(45 16 6.5)"/><path ${S} d="M13 9.5 4.5 18l1.5 1.5L14.5 11"/>`,
  tires: `<circle ${S} cx="12" cy="12" r="8"/><circle ${S} cx="12" cy="12" r="3"/><path ${S} d="M12 4v2.3M12 17.7V20M4 12h2.3M17.7 12H20"/>`,
  insurance: `<path ${S} d="M12 3.5 19 6.5v5.5c0 5-3 8-7 9-4-1-7-4-7-9V6.5L12 3.5Z"/><path ${S} d="m9 12 2 2 4-4"/>`,
  tax: `<path ${S} d="M6.5 3.5h8l3 3v14h-11z"/><path ${S} d="M14.5 3.5v3h3M9 12h6M9 15.5h6M9 8.5h2"/>`,
  parking: `<rect ${S} x="4" y="3.5" width="16" height="17" rx="2.5"/><path ${S} d="M9.5 16.5v-9h3.3a3 3 0 0 1 0 6H9.5"/>`,
  fine: `<path ${S} d="M12 3.5 21 19.5H3L12 3.5Z"/><path ${S} d="M12 9.5v4.2"/><circle cx="12" cy="16.7" r="1" fill="currentColor" stroke="none"/>`,
  other: `<circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none"/>`,
  bolt: `<path ${S} d="M13 3 5 13.5h5.5L11 21l8-10.5h-5.5L13 3Z"/>`,
  plus: `<path ${S} d="M12 4.5v15M4.5 12h15"/>`,
  layers: `<path ${S} d="m12 3.5 8 4.3-8 4.3-8-4.3 8-4.3Z"/><path ${S} d="m4 12.2 8 4.3 8-4.3M4 16.4l8 4.3 8-4.3"/>`,
  play: `<path fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M7 4.5v15l13-7.5-13-7.5Z"/>`,
  stop: `<rect fill="currentColor" x="6" y="6" width="12" height="12" rx="1.5"/>`,
  install: `<rect ${S} x="6" y="2.5" width="12" height="19" rx="2.5"/><path ${S} d="M12 7v6.5M9 11l3 3 3-3"/><path ${S} d="M9 20h6"/>`,
  flame: `<path ${S} d="M12 3s-5 4.8-5 9.2A5 5 0 0 0 12 21a5 5 0 0 0 5-8.8C15.5 13.5 14 14 13.5 12.5c-.5-1.5.5-3 0-4.5C13 6.5 12 3 12 3Z"/>`,
  lock: `<rect ${S} x="5" y="10.5" width="14" height="9.5" rx="2"/><path ${S} d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>`,
};

export function icon(name, { size = 20 } = {}) {
  const body = PATHS[name] || PATHS.categoryNone;
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}
