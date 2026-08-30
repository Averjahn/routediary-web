/**
 * Рекламный режим: живая анимация в стилистике печатных плакатов.
 *
 * ЗАЧЕМ ЖИВАЯ, А НЕ ГИФКА. Гифку нельзя перекрасить: цвет запечён в
 * пиксели. Здесь цвет выбирается на ходу.
 *
 * ЦВЕТ СВОЙ, А НЕ ОТ ПРОЕКЦИИ. Сначала он был общий с цифрой на стекле,
 * и получалось, что при светлой теме реклама открывалась ледяной. Но
 * плакат — это всегда фирменный бирюзовый, по нему марку и узнают.
 * Поэтому у режима отдельная настройка со своим значением по умолчанию;
 * «как в теме» осталось отдельным вариантом для тех, кому так нравится.
 *
 * ПОЧЕМУ БЕЗ QR. Он здесь был и оказался нечитаемым: на экране телефона
 * код выходил слишком мелким, чтобы навести на него вторую камеру. А
 * главное, он не нужен — код уже есть на плакате, который человек и
 * держит перед глазами. Экран показывает адрес словами, его переписать
 * проще, чем сканировать с чужого телефона.
 *
 * ЦВЕТ ФОНА, А НЕ ТЕКСТА. Плакат устроен так: цветное поле, белые буквы.
 * Поэтому выбранный цвет уходит в фон, а не в шрифт, и перед этим
 * затемняется до читаемого — см. readableBackground.
 *
 * ЗНАК — ТОТ ЖЕ ФАЙЛ, ЧТО НА ПЛАКАТЕ (icons/icon.svg, байт в байт), и на
 * белой плитке, как в печатных макетах. Рисовать его линиями из общего
 * набора значков нельзя: человек, увидевший плакат и открывший экран,
 * должен узнать одну и ту же марку, а не две похожие.
 *
 * ВРЕМЯ КАДРА СЧИТАЕТСЯ, А НЕ ЗАДАЁТСЯ. Ровно та же модель, что в
 * tools/hud_ad_gif.py: столько-то знаков в секунду плюс время на то,
 * чтобы глаз нашёл текст. Держать две копии одних и тех же чисел опасно
 * — на это есть тест, сверяющий их с гифкой.
 *
 */
import { t } from './i18n.js';
import { getSetting, setSetting } from './db.js';
import { HUD_COLORS, hudColorForTheme } from './hud.js';
import { AppState } from './state.js';

// --- Модель времени (зеркало tools/hud_ad_gif.py) ---------------------------
//
// 14 знаков в секунду — медленнее субтитровой нормы в 17: субтитры читают,
// уже зная контекст, а рекламу человек видит впервые.
export const CPS = 14;
/** Пока идёт проявление, читать нечего — глазу надо найти, куда смотреть. */
export const LEAD_IN = 0.5;
/** Имя и цифру не читают по буквам, их узнают целиком. */
export const GLANCE = 0.5;
/**
 * Последний кадр держится дольше расчётного: на нём адрес сайта, и это
 * единственное, что человек должен унести с собой. Мелькнувший адрес
 * бесполезен — его не успеть ни прочитать, ни набрать.
 */
export const CLOSING_MIN = 3.5;
const FADE = 0.25;

/** Сцены: крупное, подпись, читается ли крупное как текст. */
export function scenes() {
  return [
    { big: t('app.name'), cap: t('ad.caption_diary'), text: false, kind: 'brand' },
    { big: '87', cap: t('ad.caption_speed'), text: false, kind: 'speed' },
    { big: t('ad.line_service'), cap: t('ad.caption_service'), text: true, kind: 'line' },
    { big: 'autocoyc.com', cap: t('ad.caption_site'), text: false, kind: 'site' },
  ];
}

export function sceneSeconds({ big, cap, text }, isLast) {
  const chars = cap.length + (text ? big.length : 0);
  const need = LEAD_IN + chars / CPS + (text ? 0 : GLANCE);
  return isLast ? Math.max(need, CLOSING_MIN) : need;
}

export function timeline(list) {
  const out = [];
  let at = 0;
  list.forEach((s, i) => {
    const d = sceneSeconds(s, i === list.length - 1);
    out.push({ from: at, to: at + d });
    at += d;
  });
  return out;
}

/** Яркость по формуле относительной светимости (WCAG). */
function luminance(r, g, b) {
  const f = v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/**
 * Затемняет цвет, пока белый текст на нём не станет читаемым.
 *
 * Порог 3:1 — норма для КРУПНОГО текста, а здесь всё крупное. Без этого
 * шага плакат разваливается на половине палитры: белым по янтарному
 * контраст 1,8, по ледяному 1,7 — буквы физически сливаются с фоном.
 * Фирменный бирюзовый проходит как есть (3,39), поэтому вид по умолчанию
 * ровно такой же, как у печатных плакатов.
 */
export function readableBackground(hex, need = 3.0) {
  let [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  // Шаг 7% и не больше сорока шагов: даже белый доходит до нормы за
  // двадцать с небольшим, а ограничение спасает от вечного цикла, если
  // на вход придёт что-то неожиданное.
  for (let k = 0; k < 40 && 1.05 / (luminance(r, g, b) + 0.05) < need; k++) {
    r = Math.round(r * 0.93); g = Math.round(g * 0.93); b = Math.round(b * 0.93);
  }
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/** Фирменный бирюзовый — тот же, что на печатных плакатах. */
export const BRAND = '#0E9C93';
export const AD_COLOR_KEY = 'adColor';
/** Значение, означающее «как в теме», а не конкретный цвет. */
export const AD_COLOR_THEME = 'theme';

/** Палитра режима: фирменный первым, дальше цвета проекции. */
export function adPalette() {
  return [{ id: 'brand', hex: BRAND }, ...Object.values(HUD_COLORS)];
}

/** Выбранный цвет и то, откуда он взялся. */
export async function getAdColor() {
  const stored = await getSetting(AD_COLOR_KEY, 'brand');
  if (stored === AD_COLOR_THEME) {
    return { id: AD_COLOR_THEME, hex: HUD_COLORS[hudColorForTheme(AppState.theme)].hex };
  }
  const found = adPalette().find(c => c.id === stored);
  return found || { id: 'brand', hex: BRAND };
}

let overlay = null;
let frameId = null;
let safetyId = null;
let hideControlsTimer = null;

/**
 * Через сколько прятать кнопки, если их не трогают.
 *
 * Три секунды, а не четыре как у проекции: там кнопки соседствуют с одной
 * цифрой, а здесь — с текстом, который человек читает. Ряд ярких кружков
 * под строкой перетягивает взгляд ровно тогда, когда он нужен строке.
 */
const HIDE_CONTROLS_MS = 3000;

export function isAdOpen() {
  return !!overlay;
}

export function closeAd() {
  document.body.classList.remove('hud-open');
  document.querySelectorAll('.admode').forEach(n => { if (n !== overlay) n.remove(); });
  if (!overlay) return;
  cancelAnimationFrame(frameId);
  clearInterval(safetyId);
  clearTimeout(hideControlsTimer);
  frameId = safetyId = hideControlsTimer = null;
  overlay.remove();
  overlay = null;
}

export async function openAd() {
  if (overlay) return;
  const chosen = await getAdColor();
  const list = scenes();
  const marks = timeline(list);
  const total = marks[marks.length - 1].to;

  overlay = document.createElement('div');
  overlay.className = 'admode';
  overlay.style.setProperty('--ad-bg', readableBackground(chosen.hex));
  overlay.innerHTML = `
    <div class="ad-stage">
      ${list.map((s, i) => `
        <div class="ad-scene" data-i="${i}">
          ${s.kind === 'brand'
            ? `<div class="ad-row">
                 <div class="ad-mark"><img src="icons/icon.svg" alt=""></div>
                 <div class="ad-brand">${s.big}</div></div>`
            : s.kind === 'speed' ? `<div class="ad-speed" id="ad-speed">0</div>`
            : s.kind === 'site' ? `<div class="ad-site">${s.big}</div>`
            : `<div class="ad-line">${s.big}</div>`}
          <div class="ad-cap">${s.cap}</div>
        </div>`).join('')}
    </div>
    <div class="ad-controls" id="ad-controls">
      <div class="ad-swatches">
        ${adPalette().map(c => `
          <button class="ad-sw${chosen.id === c.id ? ' active' : ''}"
                  data-color="${c.id}" style="background:${readableBackground(c.hex)}"></button>`).join('')}
        <button class="ad-sw ad-auto${chosen.id === AD_COLOR_THEME ? ' active' : ''}"
                data-color="${AD_COLOR_THEME}" title="${t('hud.color_auto')}">A</button>
      </div>
      <button class="ad-close" id="ad-close">${t('common.close')}</button>
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('hud-open');

  const nodes = [...overlay.querySelectorAll('.ad-scene')];
  const speed = overlay.querySelector('#ad-speed');
  const started = Date.now();

  function frame() {
    const at = ((Date.now() - started) / 1000) % total;
    nodes.forEach((node, i) => {
      const { from, to } = marks[i];
      let a = 0;
      if (at >= from && at < to) a = Math.min(1, (at - from) / FADE, (to - at) / FADE);
      node.style.opacity = Math.max(0, a);
    });
    // Разгон укладываем в первую половину сцены, чтобы вторую половину
    // число стояло ровно и его успели прочитать.
    const { from, to } = marks[1];
    const p = Math.max(0, Math.min(1, (at - from) / ((to - from) * 0.5)));
    if (speed) speed.textContent = String(Math.round(p * 87));
  }
  // Кадровый цикл ПЛЮС страховка таймером.
  //
  // Один requestAnimationFrame надёжен не везде: встречаются окружения,
  // которые считают себя скрытыми, будучи на виду (проверено — встроенная
  // панель браузера сообщает visibilityState: hidden и не отдаёт ни
  // одного кадра). Для режима, единственная работа которого — играть,
  // молча замереть недопустимо.
  //
  // Поэтому раз в 200 мс таймер проверяет, давно ли был кадр, и рисует
  // сам, если кадров нет. Там, где rAF работает, страховка не делает
  // ничего: перерисовка идёт чаще её порога.
  let lastFrameAt = 0;
  function frameNow() {
    lastFrameAt = Date.now();
    frame();
  }
  function loop() {
    frameNow();
    frameId = requestAnimationFrame(loop);
  }
  loop();
  safetyId = setInterval(() => {
    if (Date.now() - lastFrameAt > 400) frameNow();
  }, 200);

  overlay.querySelectorAll('.ad-sw').forEach(btn => {
    btn.addEventListener('click', async () => {
      await setSetting(AD_COLOR_KEY, btn.dataset.color);
      // Перечитываем, а не берём нажатое: у варианта «как в теме» слово
      // и цвет — разные вещи, и подставлять сюда слово нельзя.
      const next = await getAdColor();
      overlay.style.setProperty('--ad-bg', readableBackground(next.hex));
      overlay.querySelectorAll('.ad-sw').forEach(b =>
        b.classList.toggle('active', b.dataset.color === next.id));
    });
  });
  // Кнопки прячутся сами: они соседствуют с текстом, который читают, и
  // ряд ярких кружков под строкой перетягивает взгляд. Возвращаются по
  // касанию экрана — как в проекции на стекло, чтобы не заводить второй
  // способ обращения с тем же самым.
  const controls = overlay.querySelector('#ad-controls');
  function showControls() {
    // Выход, если панели уже нет: щелчок по «Закрыть» сперва закрывает
    // режим, а потом всплывает сюда — без проверки здесь заводился бы
    // таймер, который потом трогает уже удалённый узел.
    if (!overlay) return;
    controls.classList.remove('faded');
    clearTimeout(hideControlsTimer);
    hideControlsTimer = setTimeout(() => controls.classList.add('faded'), HIDE_CONTROLS_MS);
  }
  // Щелчок по кнопкам всплывает сюда же, и это ровно то, что нужно:
  // человек, подбирающий цвет, продлевает себе показ панели просто тем,
  // что нажимает.
  overlay.addEventListener('click', showControls);
  showControls();

  overlay.querySelector('#ad-close').addEventListener('click', closeAd);
}
