import { t } from './i18n.js';
import { openModal, closeModal, toast } from './ui.js';
import { qrSvg } from './qr.js';
import { getSetting } from './db.js';
import { inTelegram, openLink, haptic, tg } from './telegram.js';

/**
 * Оплата Про в TON.
 *
 * Кошелёк открывается ссылкой ton://, а не встроенной библиотекой: сторонний
 * скрипт с чужого сервера противоречил бы тому, как устроено всё остальное
 * приложение, и весил бы больше самого приложения. Ссылку понимают все
 * распространённые кошельки, а на настольном экране рядом показывается
 * QR-код — тот же самый генератор, что и для приглашений.
 *
 * Засчитывает оплату только сервер и только по найденному в цепочке переводу.
 * Здесь мы можем лишь попросить его проверить — и делаем это по кругу, пока
 * окно открыто.
 */

const POLL_MS = 5000;

/** Нанотоны в человеческий вид: 1500000000 → «1.5». */
export function formatTon(nano) {
  const value = BigInt(nano);
  const whole = value / 1_000_000_000n;
  const fraction = (value % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

async function api(method, path, body) {
  const token = await getSetting('syncToken');
  const { syncOrigin } = await import('./syncClient.js');
  const res = await fetch(syncOrigin() + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try { parsed = await res.json(); } catch { /* пустой ответ */ }
  return { ok: res.ok, status: res.status, body: parsed };
}

/** Что доступно для оплаты: тарифы и включённые способы. */
export async function paymentOptions() {
  const res = await api('GET', '/api/pay/plans');
  if (!res.ok) return null;
  const { ton, stars, card, plans, cardPlans } = res.body;
  // Звёзды существуют только внутри Telegram: вне его окно оплаты открыть нечем.
  return {
    plans, ton: !!ton?.enabled, stars: !!stars?.enabled && inTelegram(),
    card: !!card?.enabled, cardPlans: cardPlans || [],
  };
}

/**
 * Оплата звёздами Telegram.
 *
 * Ответ окна оплаты («оплачено») приходит от устройства и ничего не
 * доказывает. Поэтому после него мы спрашиваем сервер: Про откроется только
 * когда до него дойдёт подтверждение от самого Telegram.
 */
export async function openStarsPayment(planId, onPaid) {
  if (!(await getSetting('syncToken'))) {
    toast(t('ton.need_account'));
    return;
  }

  const created = await api('POST', '/api/pay/stars/invoice', { plan: planId });
  if (!created.ok) {
    toast(t(created.body?.error === 'payments_disabled' ? 'stars.disabled' : 'ton.failed'));
    return;
  }

  const invoice = created.body;
  const app = tg();
  if (!app?.openInvoice) {
    toast(t('stars.disabled'));
    return;
  }

  app.openInvoice(invoice.link, async (status) => {
    if (status !== 'paid') {
      if (status === 'failed') toast(t('stars.failed'));
      return;
    }
    haptic('medium');
    toast(t('stars.confirming'));

    // Подтверждение от Telegram доходит до сервера отдельным запросом и
    // не мгновенно, поэтому спрашиваем несколько раз, а не один.
    for (let attempt = 0; attempt < 10; attempt++) {
      const state = await api('GET', `/api/pay/invoice/${invoice.id}`);
      if (state.ok && state.body.status === 'paid') {
        toast(t('ton.paid'));
        const { Sync } = await import('./syncClient.js');
        await Sync.refreshAccount().catch(() => {});
        onPaid?.();
        return;
      }
      await new Promise(r => setTimeout(r, 1500));
    }
    // Деньги списаны, но подтверждение до нас не дошло — не молчим об этом.
    toast(t('stars.pending_long'));
  });
}

/**
 * Экран оплаты.
 * @param {string} planId  'quarter' | 'year'
 * @param {function} onPaid вызывается после подтверждённой оплаты
 */
export async function openTonPayment(planId, onPaid) {
  // Счёт выписывается на аккаунт: Про — свойство аккаунта, а не устройства.
  if (!(await getSetting('syncToken'))) {
    toast(t('ton.need_account'));
    return;
  }

  const created = await api('POST', '/api/pay/ton/invoice', { plan: planId });
  if (!created.ok) {
    toast(t(created.body?.error === 'payments_disabled' ? 'ton.disabled' : 'ton.failed'));
    return;
  }

  const invoice = created.body;
  const amount = formatTon(invoice.amountNano);
  let polling = null;
  let done = false;

  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="ton.title"></h2><button class="modal-close">✕</button></div>

    <div class="ton-amount">${amount} TON</div>
    <div class="muted" style="text-align:center;font-size:13px;">
      ${t('ton.for_days', { days: invoice.days })}
    </div>

    <div class="share-qr" style="margin-top:14px;">${qrSvg(invoice.link, { size: 200, dark: '#000', light: '#fff' })}</div>
    <div class="muted" style="text-align:center;font-size:12px;" data-i18n="ton.scan_hint"></div>

    <button class="btn primary block" id="ton-open" style="margin-top:14px;" data-i18n="ton.open_wallet"></button>

    <div class="ton-details">
      <div class="ton-row"><span data-i18n="ton.address"></span>
        <code id="ton-address">${invoice.address}</code></div>
      <div class="ton-row"><span data-i18n="ton.comment"></span>
        <code>${invoice.comment}</code></div>
      <div class="muted" style="font-size:12px;margin-top:8px;" data-i18n="ton.comment_warning"></div>
    </div>

    <div class="ton-status" id="ton-status" data-i18n="ton.waiting"></div>
    <button class="btn block" id="ton-check" data-i18n="ton.check_now"></button>
  `, {
    onMount: (root) => {
      const status = root.querySelector('#ton-status');

      const stop = () => { clearInterval(polling); polling = null; };
      root.querySelector('.modal-close').addEventListener('click', () => { stop(); closeModal(); });

      root.querySelector('#ton-open').addEventListener('click', () => {
        haptic();
        // Внутри Telegram ссылку открывает мессенджер — так подхватывается
        // встроенный кошелёк; в обычном браузере это делает система.
        if (inTelegram()) openLink(invoice.link);
        else location.href = invoice.link;
      });

      async function check(manual) {
        if (done) return;
        const res = await api('POST', '/api/pay/ton/check', { invoiceId: invoice.id });

        if (!res.ok) {
          if (manual) status.textContent = t('ton.check_failed');
          return;
        }
        if (res.body.status === 'paid') {
          done = true;
          stop();
          haptic('medium');
          closeModal();
          toast(t('ton.paid'));
          const { Sync } = await import('./syncClient.js');
          await Sync.refreshAccount().catch(() => {});
          onPaid?.();
          return;
        }
        if (res.body.status === 'expired') {
          done = true;
          stop();
          status.textContent = t('ton.expired');
          return;
        }
        status.textContent = manual ? t('ton.not_yet') : t('ton.waiting');
      }

      root.querySelector('#ton-check').addEventListener('click', () => check(true));
      // Перевод подтверждается в цепочке не мгновенно, поэтому спрашиваем
      // сами, пока окно открыто: заставлять человека жать кнопку невежливо.
      polling = setInterval(check, POLL_MS);
    }
  });

  return overlay;
}
