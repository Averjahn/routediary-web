/**
 * Работа внутри Telegram Mini App.
 *
 * Приложение остаётся одним и тем же: внутри Telegram оно просто ведёт себя
 * как встроенное окно, а не как сайт. Скрипт Telegram подключается ТОЛЬКО
 * когда мы действительно внутри мессенджера — вне его это был бы запрос
 * к чужому серверу на каждом открытии, чего приложение не делает нигде.
 *
 * Telegram узнаётся по параметрам, которые он сам дописывает в адрес окна,
 * ещё до загрузки своего скрипта.
 */

const SDK_URL = 'https://telegram.org/js/telegram-web-app.js';

let sdkPromise = null;

/** Мы внутри Telegram? Проверяется без обращения к сети. */
export function inTelegram() {
  if (typeof window === 'undefined') return false;
  if (window.Telegram?.WebApp?.initData) return true;
  if (window.TelegramWebviewProxy) return true;
  return /[?#&]tgWebApp(Data|Platform|Version)=/.test(location.href);
}

function loadSdk() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve) => {
    if (window.Telegram?.WebApp) return resolve(window.Telegram.WebApp);
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.onload = () => resolve(window.Telegram?.WebApp || null);
    script.onerror = () => resolve(null);   // не загрузился — работаем как обычный сайт
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/** Подпись, которой Telegram удостоверяет пользователя. Проверяется на сервере. */
export function initData() {
  return window.Telegram?.WebApp?.initData || '';
}

export function tg() {
  return window.Telegram?.WebApp || null;
}

/**
 * Подготовка окна.
 * Возвращает false, если мы не в Telegram — тогда ничего не происходит.
 */
export async function setupTelegram() {
  if (!inTelegram()) return false;

  const app = await loadSdk();
  if (!app) return false;

  app.ready();
  app.expand();

  // Карта занимает весь экран, и «потянуть вниз» на ней означает подвинуть
  // карту, а не закрыть приложение. Без этого Telegram закрывался бы
  // при каждой попытке сдвинуть карту пальцем вниз.
  app.disableVerticalSwipes?.();

  document.body.classList.add('in-telegram');
  applyTelegramChrome(app);
  app.onEvent?.('themeChanged', () => applyTelegramChrome(app));

  // Предложение «установить приложение» внутри Telegram бессмысленно:
  // оно уже установлено вместе с мессенджером.
  document.body.classList.add('no-install-banner');

  return true;
}

/**
 * Цвет шапки и фона окна Telegram под текущую тему приложения.
 * Иначе вокруг приложения остаётся полоса чужого цвета — особенно заметно
 * на тёмной теме, где сверху светится белая шапка.
 */
function applyTelegramChrome(app) {
  const style = getComputedStyle(document.documentElement);
  const background = style.getPropertyValue('--bg')?.trim()
    || style.getPropertyValue('--background')?.trim();
  if (!background) return;

  try {
    app.setBackgroundColor?.(background);
    app.setHeaderColor?.(background);
  } catch {
    // Telegram принимает только #rrggbb; при другом формате просто оставляем своё.
  }
}

/**
 * Системная кнопка «назад» вместо крестика в модальных окнах.
 * Внутри Telegram человек ждёт именно её.
 */
export function useBackButton(onBack) {
  const app = tg();
  if (!app?.BackButton) return () => {};

  app.BackButton.show();
  app.BackButton.onClick(onBack);
  return () => {
    app.BackButton.offClick(onBack);
    app.BackButton.hide();
  };
}

/** Открыть ссылку так, как это принято в Telegram (кошелёк, внешний браузер). */
export function openLink(url) {
  const app = tg();
  if (app?.openLink && /^https?:/.test(url)) {
    app.openLink(url, { try_instant_view: false });
    return true;
  }
  // ton:// и прочие схемы Telegram открывает своим способом.
  if (app?.openTelegramLink && url.startsWith('https://t.me/')) {
    app.openTelegramLink(url);
    return true;
  }
  window.open(url, '_blank', 'noopener');
  return true;
}

/** Короткая вибрация — в Telegram это ожидаемый отклик на действие. */
export function haptic(kind = 'light') {
  try { tg()?.HapticFeedback?.impactOccurred?.(kind); } catch { /* не везде есть */ }
}
