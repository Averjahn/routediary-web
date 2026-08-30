/**
 * Рекламный режим: та же анимация, что и в готовой гифке, но живая.
 *
 * ЗАЧЕМ ЖИВАЯ, А НЕ ГИФКА. Гифку нельзя перекрасить: цвет запечён в
 * пиксели. Здесь же цифра светится тем же цветом, что и проекция на
 * стекло, — а он, в свою очередь, следует за темой приложения. Поменяли
 * тему, открыли рекламный режим — он уже в нужном цвете.
 *
 * ВРЕМЯ КАДРА СЧИТАЕТСЯ, А НЕ ЗАДАЁТСЯ. Ровно та же модель, что в
 * tools/hud_ad_gif.py: столько-то знаков в секунду плюс время на то,
 * чтобы глаз нашёл текст. Держать две копии одних и тех же чисел опасно
 * — на это есть тест, сверяющий их с гифкой.
 *
 * ФОН ЧЁРНЫЙ по той же причине, что и у проекции: любой светлый участок
 * отражается в стекле мутным пятном.
 */
import { t } from './i18n.js';
import { HUD_COLORS, getHudStyle, setHudStyle, HUD_COLOR_AUTO } from './hud.js';
import { icon } from './icons.js';

// --- Модель времени (зеркало tools/hud_ad_gif.py) ---------------------------
//
// 14 знаков в секунду — медленнее субтитровой нормы в 17: субтитры читают,
// уже зная контекст, а рекламу человек видит впервые.
export const CPS = 14;
/** Пока идёт проявление, читать нечего — глазу надо найти, куда смотреть. */
export const LEAD_IN = 0.5;
/** Имя и цифру не читают по буквам, их узнают целиком. */
export const GLANCE = 0.5;
/** Навести камеру на код дольше, чем прочитать строку под ним. */
export const QR_MIN = 3.5;
const FADE = 0.25;

/** Сцены: крупное, подпись, читается ли крупное как текст. */
export function scenes() {
  return [
    { big: t('app.name'), cap: t('ad.caption_diary'), text: false, kind: 'brand' },
    { big: '87', cap: t('ad.caption_speed'), text: false, kind: 'speed' },
    { big: t('ad.line_service'), cap: t('ad.caption_service'), text: true, kind: 'line' },
    { big: 'autocoyc.com', cap: t('ad.caption_scan'), text: false, kind: 'qr' },
  ];
}

export function sceneSeconds({ big, cap, text }, isLast) {
  const chars = cap.length + (text ? big.length : 0);
  const need = LEAD_IN + chars / CPS + (text ? 0 : GLANCE);
  return isLast ? Math.max(need, QR_MIN) : need;
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

let overlay = null;
let timer = null;

export function isAdOpen() {
  return !!overlay;
}

export function closeAd() {
  document.body.classList.remove('hud-open');
  document.querySelectorAll('.admode').forEach(n => { if (n !== overlay) n.remove(); });
  if (!overlay) return;
  clearInterval(timer);
  timer = null;
  overlay.remove();
  overlay = null;
}

export async function openAd(qrSvg) {
  if (overlay) return;
  const style = await getHudStyle();
  const list = scenes();
  const marks = timeline(list);
  const total = marks[marks.length - 1].to;

  overlay = document.createElement('div');
  overlay.className = 'admode';
  overlay.style.setProperty('--ad-color', HUD_COLORS[style.color].hex);
  overlay.innerHTML = `
    <div class="ad-stage">
      ${list.map((s, i) => `
        <div class="ad-scene" data-i="${i}">
          ${s.kind === 'brand'
            ? `<div class="ad-row">${icon('car', { size: 96 })}<div class="ad-brand">${s.big}</div></div>`
            : s.kind === 'speed' ? `<div class="ad-speed" id="ad-speed">0</div>`
            : s.kind === 'qr' ? `<div class="ad-row"><div class="ad-qr">${qrSvg}</div>
                                  <div class="ad-site">${s.big}</div></div>`
            : `<div class="ad-line">${s.big}</div>`}
          <div class="ad-cap">${s.cap}</div>
        </div>`).join('')}
    </div>
    <div class="ad-controls" id="ad-controls">
      <div class="ad-swatches">
        <button class="ad-sw ad-auto${style.auto ? ' active' : ''}" data-color="${HUD_COLOR_AUTO}"
                title="${t('hud.color_auto')}">A</button>
        ${Object.values(HUD_COLORS).map(c => `
          <button class="ad-sw${!style.auto && style.color === c.id ? ' active' : ''}"
                  data-color="${c.id}" style="background:${c.hex}"></button>`).join('')}
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
  frame();
  timer = setInterval(frame, 80);

  overlay.querySelectorAll('.ad-sw').forEach(btn => {
    btn.addEventListener('click', async () => {
      const chosen = btn.dataset.color;
      await setHudStyle({ color: chosen });
      // Перечитываем, а не берём нажатое: при «как в теме» реальный цвет
      // решает тема, и подставлять сюда слово «auto» нельзя.
      const next = await getHudStyle();
      overlay.style.setProperty('--ad-color', HUD_COLORS[next.color].hex);
      overlay.querySelectorAll('.ad-sw').forEach(b => b.classList.toggle('active',
        b.dataset.color === (next.auto ? HUD_COLOR_AUTO : next.color)));
    });
  });
  overlay.querySelector('#ad-close').addEventListener('click', closeAd);
}
