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

/** Уровни доступа. */
export const TIER = {
  FREE: 'free',
  PLUS: 'plus',   // разовая покупка
  PRO: 'pro',     // подписка
};

/**
 * Тестовый режим. Пока true — платные функции работают у всех.
 * Перед публикацией меняется на false, и дальше доступ определяется
 * реальной покупкой в магазине.
 */
export const TEST_MODE = true;

/** Что во что входит. Порядок = порядок показа на экране покупки. */
export const FEATURES = [
  { id: 'multi_vehicle', tier: TIER.PLUS, titleKey: 'pay.f.multi_vehicle', descKey: 'pay.f.multi_vehicle_d' },
  { id: 'full_history', tier: TIER.PLUS, titleKey: 'pay.f.full_history', descKey: 'pay.f.full_history_d' },
  { id: 'export', tier: TIER.PLUS, titleKey: 'pay.f.export', descKey: 'pay.f.export_d' },
  { id: 'custom_schedule', tier: TIER.PLUS, titleKey: 'pay.f.custom_schedule', descKey: 'pay.f.custom_schedule_d' },
  { id: 'themes', tier: TIER.PLUS, titleKey: 'pay.f.themes', descKey: 'pay.f.themes_d' },
  { id: 'sale_report', tier: TIER.PLUS, titleKey: 'pay.f.sale_report', descKey: 'pay.f.sale_report_d' },
  { id: 'sync', tier: TIER.PRO, titleKey: 'pay.f.sync', descKey: 'pay.f.sync_d' },
  { id: 'backup', tier: TIER.PRO, titleKey: 'pay.f.backup', descKey: 'pay.f.backup_d' },
  { id: 'share_vehicle', tier: TIER.PRO, titleKey: 'pay.f.share_vehicle', descKey: 'pay.f.share_vehicle_d' },
];

/** Тарифы. Цены — ориентир для российского рынка. */
export const PLANS = [
  {
    id: TIER.PLUS,
    titleKey: 'pay.plan.plus',
    priceKey: 'pay.plan.plus_price',
    noteKey: 'pay.plan.plus_note',
    highlight: true,
  },
  {
    id: TIER.PRO,
    titleKey: 'pay.plan.pro',
    priceKey: 'pay.plan.pro_price',
    noteKey: 'pay.plan.pro_note',
    highlight: false,
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
  if (!feature) return true;
  const tier = await currentTier();
  if (tier === TIER.PRO) return true;
  return tier === TIER.PLUS && feature.tier === TIER.PLUS;
}

/** Имитация покупки — чтобы посмотреть, как выглядит приложение после неё. */
export async function simulatePurchase(tier) {
  await setSetting(KEY, tier);
}

export async function resetPurchase() {
  await setSetting(KEY, TIER.FREE);
}
