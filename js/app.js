import { loadSettings, AppState } from './state.js';
import { applyI18nTree, keepScroll, closeAllModals } from './ui.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { applyTheme } from './theme.js';
import { initInstallBanner } from './installBanner.js';
import { captureIncomingReferral } from './referral.js';
import { captureTrafficSource } from './trafficSource.js';
import { startAutoSync } from './syncClient.js';
import { initAnalytics } from './analytics.js';
import { setupTelegram } from './telegram.js';
import * as MapScreen from './screens/map.js';

/**
 * Экраны, кроме карты, загружаются при первом открытии вкладки, а не при
 * старте. До этого статические импорты тянули на запуск ВСЁ разом — включая
 * 230-килобайтный справочник машин, который нужен только на вкладке «Авто».
 * Карта — статически: она первый экран, откладывать её нечем.
 *
 * Динамический import() возвращает один и тот же экземпляр модуля, что и
 * статический, поэтому все внутренние связи экранов работают как раньше.
 */
const SCREENS = {
  map: { load: null, module: MapScreen, el: null, rendered: false },
  trips: { load: () => import('./screens/trips.js'), module: null, el: null, rendered: false },
  car: { load: () => import('./screens/car.js'), module: null, el: null, rendered: false },
  settings: { load: () => import('./screens/settings.js'), module: null, el: null, rendered: false },
  stats: { load: () => import('./screens/stats.js'), module: null, el: null, rendered: false },
};

/** Модуль экрана: уже загруженный или загружаемый сейчас. */
async function screenModule(key) {
  const screen = SCREENS[key];
  if (!screen.module) screen.module = await screen.load();
  return screen.module;
}

let currentTab = null;

async function init() {
  await loadSettings();
  // До первой отрисовки: код приглашения убирается из адресной строки,
  // чтобы не осесть в истории и закладках.
  await captureIncomingReferral().catch(() => {});
  // До первой отрисовки: метка вывески/QR убирается из адресной строки
  // так же, как код приглашения — по тем же причинам.
  await captureTrafficSource().catch(() => {});
  // Внутри Telegram окно ведёт себя как встроенное приложение. Вне его
  // ничего не происходит и никаких запросов наружу не уходит.
  await setupTelegram().catch(() => {});
  // Подписка могла закончиться, пока приложение было закрыто: платное
  // оформление снимается до первой отрисовки, чтобы человек не увидел его
  // на секунду и не решил, что оно осталось.
  await import('./subscription.js')
    .then(({ enforceEntitlements }) => enforceEntitlements())
    .catch(() => {});
  applyI18nTree(document.body);

  for (const key of Object.keys(SCREENS)) {
    SCREENS[key].el = document.getElementById('screen-' + key);
  }

  applyBrand();

  document.querySelectorAll('.tab-icon[data-icon]').forEach(span => {
    span.innerHTML = icon(span.dataset.icon, { size: 22 });
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.addEventListener('lang-changed', () => {
    // Экран собирается заново, поэтому положение прокрутки удерживаем сами:
    // смена языка не должна выбрасывать человека в начало страницы.
    keepScroll(SCREENS[currentTab]?.el, () => {
      applyI18nTree(document.body);
      applyBrand();
      for (const key of Object.keys(SCREENS)) SCREENS[key].rendered = false;
      switchTab(currentTab, true);   // незагруженные вкладки перерисуются при первом открытии
    });
    initInstallBanner();
  });
  document.addEventListener('theme-changed', () => {
    // темы влияют на цвета карты/графиков — просто перерисуем текущий и соседние экраны
    if (SCREENS.map.rendered) MapScreen.refresh?.();
  });

  switchTab('map');
  initInstallBanner();
  // Обмен идёт молча и только если человек вошёл: офлайн — штатное
  // состояние приложения, и отсутствие сети не должно ничего ломать.
  startAutoSync();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }

  // Отметка «сегодня пользовались» — раз в сутки, без ожидания: счётчик
  // установок не повод задерживать открытие приложения.
  import('./usage.js').then(({ ping }) => ping()).catch(() => {});

  // Возврат со страницы оплаты ЮKassa: приложение само досмотрит, чем
  // закончилась оплата, а не забудет об этом до следующего похода в настройки.
  import('./cardPay.js').then(({ resumeCardPayment }) =>
    resumeCardPayment(() => switchTab(currentTab, true))).catch(() => {});

  // Аккаунт устройства заводится сам, в фоне: к моменту покупки он уже
  // должен существовать. Ошибки и офлайн — молча, попытка повторится.
  import('./quickAccount.js').then(({ ensureAccount }) => ensureAccount()).catch(() => {});
}

/** Название приложения в боковом меню (широкий экран) — через атрибут: см. CSS. */
function applyBrand() {
  document.getElementById('tabbar')?.setAttribute('data-brand', t('app.name'));
}

// Порядок вкладок в ленте — из него берётся направление анимации.
const TAB_ORDER = ['map', 'trips', 'car', 'settings', 'stats'];

async function switchTab(tab, force) {
  if (tab === currentTab && !force) return;
  // Открытое окно живёт вне экранов и смены вкладки не замечает: оно
  // осталось бы висеть поверх новой, закрыв собой и таббар — уйти было бы
  // уже нечем, а со стороны это выглядит как «экран не прокручивается».
  // Только при настоящей смене вкладки: force — это перерисовка текущей,
  // и закрывать на ней только что открытое окно было бы неожиданно.
  if (tab !== currentTab) closeAllModals();
  // Направление: вкладка правее — экран въезжает справа. Так движение
  // подсказывает, куда переместился человек, а не просто украшает.
  const from = TAB_ORDER.indexOf(currentTab);
  const to = TAB_ORDER.indexOf(tab);
  const enterClass = from === -1 || from === to ? null
    : (to > from ? 'enter-right' : 'enter-left');

  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  for (const key of Object.keys(SCREENS)) {
    const el = SCREENS[key].el;
    el.classList.toggle('active', key === tab);
    // Классы анимации снимаем со всех: иначе при быстром переключении
    // на экране остаётся вчерашняя анимация и она не проигрывается заново.
    el.classList.remove('enter-right', 'enter-left');
  }
  if (enterClass) {
    const el = SCREENS[tab].el;
    // Перезапуск анимации: без чтения offsetWidth браузер склеит снятие и
    // добавление класса в один кадр, и анимация не начнётся.
    void el.offsetWidth;
    el.classList.add(enterClass);
  }
  const screen = SCREENS[tab];
  const module = await screenModule(tab);
  // Пока модуль грузился, человек мог успеть переключиться дальше —
  // тогда рисовать нечего, его вкладка уже другая.
  if (currentTab !== tab) return;
  if (!screen.rendered) {
    module.render(screen.el);
    screen.rendered = true;
  } else if (module.refresh) {
    module.refresh();
  }
}

/**
 * Q+W+E открывает внутреннюю панель владельца.
 *
 * Слушатель крохотный и живёт здесь, а сама панель подтягивается
 * динамическим import() только в момент нажатия: обычный посетитель её
 * не скачивает и о ней не знает — в интерфейсе на неё ничего не указывает.
 *
 * Читаем event.code, а не event.key: code — это физическая клавиша, и
 * сочетание срабатывает на любой раскладке. Через key пришлось бы
 * перечислять буквы каждого языка («йцу» для русской), и первая же
 * раскладка, о которой не подумали, молча перестала бы работать.
 */
const ADMIN_KEYS = ['KeyQ', 'KeyW', 'KeyE'];

function installAdminHotkey() {
  let down = new Set();

  const typing = () => {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  };

  document.addEventListener('keydown', (e) => {
    if (typing()) return;
    if (!ADMIN_KEYS.includes(e.code)) return;
    down.add(e.code);
    if (ADMIN_KEYS.every(k => down.has(k))) {
      down = new Set();
      import('./admin.js').then(m => m.openAdminLogin());
    }
  });
  document.addEventListener('keyup', (e) => { down.delete(e.code); });
  // Без сброса на потерю фокуса клавиши «залипают»: ушёл на другое окно с
  // зажатой Q, вернулся, нажал W и E — и панель открылась сама собой.
  window.addEventListener('blur', () => { down = new Set(); });
}

// Счётчик поднимается после разметки источника перехода: та читает метку
// из адреса, и порядок здесь не косметический — если счётчик успеет
// переписать адрес, метка плаката потеряется.
initAnalytics();

installAdminHotkey();

init().catch(err => console.error('Avtopuls init failed:', err));
