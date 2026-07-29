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

let modalStack = [];

export function openModal(contentHtml, { onMount } = {}) {
  const root = document.getElementById('modal-root');
  const overlay = el(`<div class="modal-overlay"><div class="modal-sheet">${contentHtml}</div></div>`);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  root.appendChild(overlay);
  modalStack.push(overlay);
  applyI18nTree(overlay);
  if (onMount) onMount(overlay);
  return overlay;
}

export function closeModal() {
  const overlay = modalStack.pop();
  if (overlay) overlay.remove();
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

export const MODE_ICON = { walk: icon('walk'), run: icon('run'), bike: icon('bike'), car: icon('car') };
export const CATEGORY_ICON = { none: icon('categoryNone'), work: icon('work'), home: icon('home'), shop: icon('shop'), medical: icon('medical'), leisure: icon('leisure'), other: icon('other') };
export const EXPENSE_ICON = { fuel: icon('fuel'), wash: icon('wash'), service: icon('service'), repairs: icon('repairs'), tires: icon('tires'), insurance: icon('insurance'), tax: icon('tax'), parking: icon('parking'), fine: icon('fine'), other: icon('other') };
