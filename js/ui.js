import { t, getLang } from './i18n.js';
import { icon } from './icons.js';
export { icon };

export function el(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

export function applyI18nTree(root) {
  root.querySelectorAll('[data-i18n]').forEach(node => {
    node.textContent = t(node.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-ph]').forEach(node => {
    node.setAttribute('placeholder', t(node.getAttribute('data-i18n-ph')));
  });
}

/**
 * Модальные окна.
 *
 * Стопка окон — это сами узлы внутри #modal-root, а не массив рядом с ними.
 * Отдельный массив уже расходился с деревом: окно уходило со страницы мимо
 * closeModal() (или, наоборот, оставалось на ней), и следующее закрытие
 * снимало не то окно. Наружу это выглядело не как «сломались окна», а как
 * «экран почему-то не прокручивается»: сверху висел слой во весь экран.
 * Одно место правды убирает весь этот класс ошибок разом.
 */

function modalRoot() {
  return document.getElementById('modal-root');
}

export function openModal(contentHtml, { onMount, onClose } = {}) {
  const root = modalRoot();
  const overlay = el(`<div class="modal-overlay"><div class="modal-sheet">${contentHtml}</div></div>`);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  root.appendChild(overlay);
  // Обработчик закрытия живёт на самом окне: closeModal() снимает верхнее
  // окно стопки и не знает, чьё оно. Без этого тот, кто ждёт ответа от окна
  // (например, «создать аккаунт и продолжить покупку»), не узнаёт о закрытии
  // мимо кнопки — щелчок по фону — и ждёт вечно.
  if (onClose) overlay._onClose = onClose;
  applyI18nTree(overlay);
  if (onMount) onMount(overlay);
  return overlay;
}

/** Закрывает верхнее окно — то, которое человек и видит сверху. */
export function closeModal() {
  const overlay = modalRoot()?.lastElementChild;
  if (!overlay) return;
  overlay.remove();
  try { overlay._onClose?.(); } catch { /* закрытие не должно ломать вызвавшего */ }
}

/**
 * Закрывает все окна разом — при уходе с экрана.
 *
 * Окно лежит в #modal-root, снаружи экранов, и смены вкладки само не
 * замечает: без этого оно остаётся висеть поверх новой вкладки и
 * перекрывает её вместе с таббаром, так что уйти оттуда уже нечем.
 */
export function closeAllModals() {
  const root = modalRoot();
  if (!root) return;
  // Ограничение на случай, если чей-то onClose откроет окно заново:
  // выйти из цикла важнее, чем закрыть непременно всё.
  for (let guard = 0; guard < 50 && root.lastElementChild; guard++) closeModal();
}

// Escape закрывает верхнее окно: на настольном браузере это первое, что
// пробует человек, и без этого окно выглядит зависшим. Пока открыта
// проекция на стекло (она выше окон), клавиша принадлежит ей.
//
// Проверка среды нужна не для красоты: модуль импортируется и в тестах на
// node, где document нет вовсе, и подписка на уровне модуля роняла бы там
// весь файл целиком — вместе с теми, кто тянет отсюда совсем другое.
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.body.classList.contains('hud-open')) closeModal();
  });
}

export function toast(message, { actionLabel, onAction, duration = 5000 } = {}) {
  const root = document.getElementById('toast-root');
  const node = el(`<div class="toast"><span>${message}</span>${actionLabel ? `<button>${actionLabel}</button>` : ''}</div>`);
  if (actionLabel) {
    node.querySelector('button').addEventListener('click', () => { onAction && onAction(); node.remove(); });
  }
  root.appendChild(node);
  setTimeout(() => node.remove(), duration);
  return node;
}

/**
 * Сохраняет положение прокрутки экрана на время его перерисовки.
 *
 * Экраны наполняются асинхронно (читают данные из БД). В момент, когда
 * содержимое уже заменено, а новое ещё не готово, высота экрана меньше
 * прежней — и браузер обрезает позицию прокрутки до нуля. Обратно она
 * сама не возвращается: человек оказывается наверху, хотя ничего для
 * этого не делал.
 *
 * Просто выставить scrollTop сразу нельзя — прокручивать ещё некуда.
 * Поэтому ждём, пока содержимое дорастёт до нужной высоты, и только
 * тогда возвращаем позицию. Ограничение по времени нужно на случай,
 * если экран стал короче: тогда возвращаем сколько получится.
 *
 * @param {HTMLElement} el       контейнер с прокруткой
 * @param {Function} rerender    действие, перерисовывающее содержимое
 */
export function keepScroll(el, rerender) {
  const top = el ? el.scrollTop : 0;
  rerender();
  restoreScroll(el, top);
}

/**
 * Возвращает прокрутку на сохранённую позицию, когда содержимое дорастёт.
 * Вынесено отдельно: экраны, которые перерисовывают себя сами (настройки),
 * сохраняют позицию до вызова, а восстанавливают после.
 */
export function restoreScroll(el, top) {
  if (!el || top <= 0) return;

  const deadline = performance.now() + 2000;
  const tryRestore = () => {
    if (el.scrollHeight - el.clientHeight >= top) {
      el.scrollTop = top;
      return;
    }
    if (performance.now() < deadline) {
      requestAnimationFrame(tryRestore);
      return;
    }
    // Содержимое так и не выросло — экран стал короче. Прокручиваем
    // максимально близко к прежнему месту, а не бросаем человека наверху.
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
  };
  requestAnimationFrame(tryRestore);
}

export const MODE_ICON = { walk: icon('walk'), run: icon('run'), bike: icon('bike'), car: icon('car') };
export const CATEGORY_ICON = { none: icon('categoryNone'), work: icon('work'), home: icon('home'), shop: icon('shop'), medical: icon('medical'), leisure: icon('leisure'), other: icon('other') };
export const EXPENSE_ICON = { fuel: icon('fuel'), wash: icon('wash'), service: icon('service'), repairs: icon('repairs'), tires: icon('tires'), insurance: icon('insurance'), tax: icon('tax'), parking: icon('parking'), fine: icon('fine'), other: icon('other') };

/**
 * Экранирование пользовательского текста перед вставкой в разметку.
 * Названия машин и подписи поездок человек вводит сам, а с появлением
 * синхронизации они ещё и приезжают с другого устройства.
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
