/**
 * Платные возможности.
 *
 * ВАЖНО: это витрина и заглушка, а не биллинг. Реальные покупки живут
 * в магазинах приложений (StoreKit / Play Billing / RuStore Billing),
 * и появятся они там, а не здесь. Здесь только два вопроса:
 * «что закрыто» и «как об этом сказать».
 *
 * Сейчас включён ТЕСТОВЫЙ РЕЖИМ: все платные возможности открыты,
 * чтобы их можно было проверять. Экран покупки при этом показывается —
 * ради него всё и сделано, — но не блокирует.
 */

import { getSetting, setSetting } from './db.js';

/**
 * Уровни доступа. Тариф ровно один: либо бесплатно, либо Про.
 *
 * Разовая покупка отдельным уровнем не выделяется намеренно: два платных
 * тарифа заставляют человека выбирать, а выбор на экране оплаты — это
 * лишняя причина уйти подумать и не вернуться.
 */
export const TIER = {
  FREE: 'free',
  PRO: 'pro',
};

/**
 * Тестовый режим. Пока true — платные функции работают у всех.
 * Перед публикацией меняется на false, и дальше доступ определяется
 * реальной покупкой в магазине.
 */
export const TEST_MODE = true;

/**
 * Что входит в Про. Порядок = порядок показа на экране покупки:
 * первым идёт то, ради чего подписку купят.
 *
 * Две из трёх возможностей требуют сервера, которого у приложения пока нет
 * (синхронизация и резервная копия). До его появления реально продаётся
 * только гараж на несколько машин.
 */
export const FEATURES = [
  { id: 'multi_vehicle', tier: TIER.PRO, titleKey: 'pay.f.multi_vehicle', descKey: 'pay.f.multi_vehicle_d' },
  { id: 'sync', tier: TIER.PRO, titleKey: 'pay.f.sync', descKey: 'pay.f.sync_d' },
  { id: 'backup', tier: TIER.PRO, titleKey: 'pay.f.backup', descKey: 'pay.f.backup_d' },
];

/** Единственный тариф. Цены — ориентир для российского рынка. */
export const PLANS = [
  {
    id: TIER.PRO,
    titleKey: 'pay.plan.pro',
    priceKey: 'pay.plan.pro_price',
    noteKey: 'pay.plan.pro_note',
    highlight: true,
  },
];

const KEY = 'tier';

/** Текущий уровень доступа. */
export async function currentTier() {
  return (await getSetting(KEY, TIER.FREE)) || TIER.FREE;
}

/**
 * Доступна ли возможность.
 *
 * В тестовом режиме — всегда да. Функция всё равно вызывается по коду,
 * чтобы к моменту публикации оставалось поменять один флаг, а не искать
 * места проверок по всему приложению.
 */
export async function hasFeature(featureId) {
  if (TEST_MODE) return true;
  const feature = FEATURES.find(f => f.id === featureId);
  if (!feature) return true;   // всё, чего нет в списке, бесплатно
  return (await currentTier()) === TIER.PRO;
}

/** Имитация покупки — чтобы посмотреть, как выглядит приложение после неё. */
export async function simulatePurchase(tier) {
  await setSetting(KEY, tier);
}

export async function resetPurchase() {
  await setSetting(KEY, TIER.FREE);
}
