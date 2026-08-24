/**
 * Экран покупки.
 *
 * Принципы, по которым он собран:
 *   1. Открывается ТОЛЬКО в момент, когда человек упёрся в ограничение,
 *      и сразу объясняет, что он пытался сделать. Экран покупки «просто так»
 *      при запуске — самый быстрый способ получить удаление приложения.
 *   2. Сначала польза, потом цена. Заголовок говорит о задаче пользователя,
 *      а не о названии тарифа.
 *   3. Разовая покупка стоит первой и выделена: она снимает главное
 *      возражение к подписке на офлайн-утилиту.
 *   4. Закрыть можно всегда и одним движением. Никаких спрятанных крестиков.
 */

import { t } from './i18n.js';
import { AppState } from './state.js';
import { openModal, closeModal, toast } from './ui.js';
import { FEATURES, PLANS, TIER, TEST_MODE, currentTier, simulatePurchase, resetPurchase } from './subscription.js';
import { paymentOptions, openTonPayment, openStarsPayment, formatTon } from './tonPay.js';
import { openCardPayment } from './cardPay.js';
import { approxInCurrency } from './exchangeRates.js';

/**
 * @param {object} opts
 * @param {string} opts.reason  ключ строки: ради чего открыт экран
 * @param {function} opts.onDone вызывается после «покупки»
 */
export async function openPaywall({ reason = 'pay.reason_default', onDone } = {}) {
  const tier = await currentTier();
  // Способы оплаты показываются только те, что сервер включил: иначе кнопка
  // вела бы в тупик. Звёзды вдобавок существуют лишь внутри Telegram.
  const pay = await paymentOptions().catch(() => null);

  const planCardFor = (method, plan) => `
    <button class="pay-plan ${method}" data-${method}="${plan.id}">
      <span class="pay-plan-title">${t('ton.plan.' + plan.id)}</span>
      <span class="pay-plan-price">${method === 'stars'
        ? `${plan.stars} ★` : `${formatTon(plan.amountNano)} TON`}</span>
      <span class="pay-plan-note">${t('ton.for_days', { days: plan.days })}</span>
    </button>`;

  const methodBlock = (method, titleKey) => `
    <div class="pay-ton">
      <div class="pay-ton-head">${t(titleKey)}</div>
      <div class="pay-plans">${pay.plans.map(p => planCardFor(method, p)).join('')}</div>
    </div>`;

  // Заряд всегда идёт в рублях — курс здесь ничего не решает, только
  // подписывает рядом, сколько это примерно в деньгах человека. Для самих
  // рублей и когда курса ещё не было ни разу approx возвращает null,
  // и вторая строка просто не рисуется.
  const approxPrice = (rub) => approxInCurrency(rub, AppState.currency, pay?.rubRates);

  const cardPlanCard = (plan) => `
    <button class="pay-plan card" data-card="${plan.id}">
      <span class="pay-plan-title">${t('ton.plan.' + plan.id)}</span>
      <span class="pay-plan-price">${plan.rub.toLocaleString('ru-RU')} ₽</span>
      ${approxPrice(plan.rub) ? `<span class="pay-plan-approx">${approxPrice(plan.rub)}</span>` : ''}
      <span class="pay-plan-note">${plan.days >= 36500 ? t('card.one_time') : t('ton.for_days', { days: plan.days })}</span>
    </button>`;

  // ЮKassa принимает карты только российских банков. Человеку из другой
  // страны об этом надо сказать ДО того, как он введёт номер карты и
  // получит отказ, — иначе это выглядит как поломка приложения.
  const RU_MARKET_REGIONS = new Set(['RU', 'BY', 'KZ', 'UA', 'AM', 'GE', 'KG', 'UZ']);
  const cardIsLocal = !AppState.region || RU_MARKET_REGIONS.has(AppState.region);

  const cardBlock = () => `
    <div class="pay-ton">
      <div class="pay-ton-head">${t('card.section')}</div>
      <div class="pay-plans">${pay.cardPlans.map(cardPlanCard).join('')}</div>
      ${cardIsLocal ? '' : `<div class="muted" style="font-size:12px;padding-top:8px;">${t('card.russian_only')}</div>`}
    </div>`;

  const featureRow = (f) => `
    <div class="pay-feature">
      <span class="pay-check">✓</span>
      <div>
        <b>${t(f.titleKey)}</b>
        <span>${t(f.descKey)}</span>
      </div>
    </div>`;

  const planCard = (p) => `
    <button class="pay-plan${p.highlight ? ' primary' : ''}" data-plan="${p.id}">
      <span class="pay-plan-title">${t(p.titleKey)}</span>
      <span class="pay-plan-price">${t(p.priceKey)}</span>
      <span class="pay-plan-note">${t(p.noteKey)}</span>
    </button>`;

  const overlay = openModal(`
    <div class="pay">
      <button class="modal-close pay-close" aria-label="${t('common.close')}">✕</button>

      <div class="pay-head">
        <div class="pay-icon">◉</div>
        <h2>${t(reason)}</h2>
        <p class="pay-sub">${t('pay.subtitle')}</p>
      </div>

      <div class="pay-features">
        ${FEATURES.map(featureRow).join('')}
      </div>

      ${TEST_MODE ? `<div class="pay-plans">${PLANS.map(planCard).join('')}</div>` : ''}

      ${pay?.card ? cardBlock() : ''}
      ${pay?.stars ? methodBlock('stars', 'stars.section') : ''}
      ${pay?.ton ? methodBlock('ton', 'ton.section') : ''}

      <p class="pay-legal">${t('pay.legal')}</p>

      ${TEST_MODE ? `
        <div class="pay-test">
          <b>${t('pay.test_mode')}</b>
          <span>${t('pay.test_mode_hint')}</span>
          <button class="btn block" data-skip>${t('pay.test_continue')}</button>
          <div class="pay-test-row">
            <span class="pay-test-current">${t('pay.test_current')}: <b>${tierLabel(tier)}</b></span>
            <button class="btn sm" data-reset>${t('pay.test_reset')}</button>
          </div>
        </div>` : ''}
    </div>
  `, {
    onMount: (root) => {
      root.querySelector('.pay-close').addEventListener('click', closeModal);

      root.querySelectorAll('[data-plan]').forEach(btn => {
        btn.addEventListener('click', async () => {
          // В релизе здесь вызывается покупка магазина. Сейчас — имитация,
          // чтобы можно было увидеть приложение в состоянии «куплено».
          await simulatePurchase(btn.dataset.plan);
          closeModal();
          toast(t('pay.thanks', { plan: tierLabel(btn.dataset.plan) }));
          if (onDone) onDone();
        });
      });

      root.querySelectorAll('[data-card]').forEach(btn => {
        btn.addEventListener('click', () => {
          // Оплата уходит на страницу ЮKassa — модалку саму закрывать не
          // нужно, страница сейчас сменится целиком.
          openCardPayment(btn.dataset.card, onDone);
        });
      });

      root.querySelectorAll('[data-ton]').forEach(btn => {
        btn.addEventListener('click', () => {
          closeModal();
          openTonPayment(btn.dataset.ton, onDone);
        });
      });

      root.querySelectorAll('[data-stars]').forEach(btn => {
        btn.addEventListener('click', () => {
          closeModal();
          openStarsPayment(btn.dataset.stars, onDone);
        });
      });

      // Тестовый режим: пройти дальше, не «покупая». Нужен, чтобы платную
      // функцию можно было проверять, пока биллинга ещё нет.
      root.querySelector('[data-skip]')?.addEventListener('click', () => {
        closeModal();
        if (onDone) onDone();
      });

      root.querySelector('[data-reset]')?.addEventListener('click', async () => {
        await resetPurchase();
        closeModal();
        toast(t('pay.test_reset_done'));
        if (onDone) onDone();
      });
    }
  });
  return overlay;
}

function tierLabel(tier) {
  if (tier === TIER.PRO) return t('pay.plan.pro');
  return t('pay.plan.free');
}
