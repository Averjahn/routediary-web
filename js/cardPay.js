import { t } from './i18n.js';
import { openModal, closeModal, toast } from './ui.js';
import { getSetting, setSetting } from './db.js';

/**
 * Оплата Про картой через ЮKassa.
 *
 * Номер карты через нас не проходит вообще: сервер только создаёт платёж
 * и отдаёт ссылку на защищённую страницу оплаты ЮKassa, человек платит там.
 * Мы лишь спрашиваем сервер, прошла ли оплата, — и делаем это, а не верим
 * тому, что страница оплаты закрылась «успешно»: закрыть вкладку можно
 * и без оплаты, и с оплатой, разница не в этом.
 */

const POLL_MS = 4000;
const RETURN_URL_KEY = 'cardPayReturnInvoice';

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

function fmtRub(rub) {
  return rub.toLocaleString('ru-RU') + ' ₽';
}

/**
 * Открыть оплату: создать счёт, увести на страницу ЮKassa.
 * Номер счёта запоминается локально — после возврата с оплаты приложение
 * само досмотрит, чем всё закончилось, а не забудет об этом.
 */
export async function openCardPayment(planId, onPaid) {
  // Аккаунт нужен не ради формальности: без него покупку не к чему привязать,
  // и на другом устройстве она пропадёт. Но требовать ради этого почту и
  // пароль — заставлять человека работать за нас, поэтому предлагаем завести
  // аккаунт здесь же, одной кнопкой.
  if (!(await getSetting('syncToken'))) {
    const created = await offerQuickAccount();
    if (!created) return;
  }

  const returnUrl = `${location.origin}${location.pathname}`;
  const created = await api('POST', '/api/pay/card/invoice', { plan: planId, returnUrl });
  if (!created.ok) {
    toast(t(created.body?.error === 'payments_disabled' ? 'card.disabled' : 'card.failed'));
    return;
  }

  const invoice = created.body;
  await setSetting(RETURN_URL_KEY, invoice.id);
  location.href = invoice.link;
}

/**
 * Досмотреть оплату после возврата со страницы ЮKassa.
 *
 * Вызывается при каждом старте приложения. Если недавно уходили на оплату —
 * спрашивает сервер, чем она закончилась, и один раз убирает отметку —
 * незакрытый счёт не должен спрашиваться о себе вечно.
 */
export async function resumeCardPayment(onPaid) {
  const invoiceId = await getSetting(RETURN_URL_KEY);
  if (!invoiceId) return;
  await setSetting(RETURN_URL_KEY, null);

  const result = await api('POST', '/api/pay/card/check', { invoiceId });
  if (!result.ok) return;

  if (result.body.status === 'paid') {
    toast(t('ton.paid'));
    const { Sync } = await import('./syncClient.js');
    await Sync.refreshAccount().catch(() => {});
    onPaid?.();
  } else if (result.body.status === 'pending') {
    // Мог не успеть подтвердиться к моменту возврата — не молчим об этом.
    openCardPendingScreen(invoiceId, onPaid);
  }
}

/**
 * Предложить завести аккаунт перед покупкой.
 * @returns {Promise<boolean>} создан ли аккаунт (иначе покупку не продолжаем)
 */
function offerQuickAccount() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => { if (!settled) { settled = true; resolve(ok); } };

    openModal(`
      <div class="modal-header"><h2 data-i18n="quick.need_account"></h2><button class="modal-close">✕</button></div>
      <div class="muted" style="font-size:13px;margin-bottom:14px;" data-i18n="quick.need_account_hint"></div>
      <button class="btn primary block" id="qa-go" data-i18n="quick.create_and_pay"></button>
    `, {
      onMount: (root) => {
        root.querySelector('.modal-close').addEventListener('click', () => { closeModal(); finish(false); });
        root.querySelector('#qa-go').addEventListener('click', async (e) => {
          const button = e.currentTarget;
          button.disabled = true;
          button.textContent = t('sync.working');
          try {
            const { generateSecret, normalizeSecret, loginFor, rememberSecret } = await import('./quickAccount.js');
            const { Sync, deviceLabel } = await import('./syncClient.js');
            const { getLocalCode, getInvitedBy } = await import('./referral.js');

            const code = generateSecret();
            await Sync.register(await loginFor(code), normalizeSecret(code), deviceLabel(),
              { referralCode: await getLocalCode(), invitedBy: await getInvitedBy() });
            await rememberSecret(code);
            closeModal();
            finish(true);
          } catch {
            toast(t('card.failed'));
            button.disabled = false;
            button.textContent = t('quick.create_and_pay');
          }
        });
      },
      // Закрытие мимо кнопки — тоже отказ, покупка не должна продолжиться молча.
      onClose: () => finish(false),
    });
  });
}

function openCardPendingScreen(invoiceId, onPaid) {
  let polling = null;
  let done = false;

  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="card.title"></h2><button class="modal-close">✕</button></div>
    <div class="ton-status" id="card-status" data-i18n="card.waiting"></div>
    <button class="btn block" id="card-check" data-i18n="ton.check_now"></button>
  `, {
    onMount: (root) => {
      const status = root.querySelector('#card-status');
      const stop = () => { clearInterval(polling); polling = null; };
      root.querySelector('.modal-close').addEventListener('click', () => { stop(); closeModal(); });

      async function check(manual) {
        if (done) return;
        const res = await api('POST', '/api/pay/card/check', { invoiceId });
        if (!res.ok) { if (manual) status.textContent = t('ton.check_failed'); return; }
        if (res.body.status === 'paid') {
          done = true; stop(); closeModal();
          toast(t('ton.paid'));
          const { Sync } = await import('./syncClient.js');
          await Sync.refreshAccount().catch(() => {});
          onPaid?.();
          return;
        }
        if (res.body.status === 'expired') {
          done = true; stop();
          status.textContent = t('ton.expired');
          return;
        }
        status.textContent = manual ? t('ton.not_yet') : t('card.waiting');
      }

      root.querySelector('#card-check').addEventListener('click', () => check(true));
      polling = setInterval(check, POLL_MS);
    }
  });
  return overlay;
}
