import { t } from './i18n.js';
import { el, icon } from './ui.js';

const DISMISS_KEY = 'routediary.installBannerDismissed';
let bannerEl = null;

function isIos() {
  const ua = window.navigator.userAgent;
  const isIosDevice = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  // iPadOS 13+ identifies as "MacIntel" but keeps a touch screen — unlike an actual Mac.
  const isIpadAsMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isIosDevice || isIpadAsMac;
}

function isSafari() {
  const ua = window.navigator.userAgent;
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Mercury/.test(ua);
}

export function isStandalone() {
  return window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
}

export function initInstallBanner() {
  if (bannerEl) { bannerEl.remove(); bannerEl = null; }
  if (!isIos() || !isSafari() || isStandalone()) return;
  if (localStorage.getItem(DISMISS_KEY)) return;

  bannerEl = el(`
    <div class="install-banner">
      <div class="install-banner-icon">${icon('install', { size: 22 })}</div>
      <div class="install-banner-body">
        <div class="install-banner-title">${t('install.title')}</div>
        <div class="install-banner-text">${t('install.text')}</div>
      </div>
      <button class="install-banner-close" aria-label="${t('install.close')}">✕</button>
    </div>
  `);
  bannerEl.querySelector('.install-banner-close').addEventListener('click', () => {
    localStorage.setItem(DISMISS_KEY, '1');
    bannerEl.remove();
    bannerEl = null;
  });
  document.body.appendChild(bannerEl);
}
