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
 * Тестовый режим выключен: оплата картой подключена, и доступ к платным
 * возможностям определяется реальной покупкой (pro_until на аккаунте)
 * либо наградой за приглашённых. Включать обратно — только на время
 * отладки платных функций.
 */
export const TEST_MODE = false;

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
  { id: 'export', tier: TIER.PRO, titleKey: 'pay.f.export', descKey: 'pay.f.export_d' },
  { id: 'themes', tier: TIER.PRO, titleKey: 'pay.f.themes', descKey: 'pay.f.themes_d' },
  { id: 'hud_style', tier: TIER.PRO, titleKey: 'pay.f.hud', descKey: 'pay.f.hud_d' },
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

/**
 * До какого момента действует Про.
 *
 * Срок один на все причины: покупка и награда за приглашённых друзей кладут
 * его в одно и то же место. Имя осталось от времён, когда причина была одна.
 */
export async function rewardedProUntil() {
  return getSetting('syncProUntil');
}

/**
 * Действует ли Про прямо сейчас.
 *
 * Сравнение идёт не с часами телефона, а с наибольшим временем, которое мы
 * когда-либо видели от сервера (см. serverClock.js). Прежде здесь стояло
 * `new Date()`, и перевод часов на год назад оживлял истёкшую подписку —
 * это было проверено и работало.
 */
export async function rewardActive() {
  const until = await rewardedProUntil();
  if (!until) return false;
  const { effectiveNow } = await import('./serverClock.js');
  return new Date(until) > (await effectiveNow());
}

/**
 * Текущий уровень доступа.
 *
 * Про даёт либо покупка, либо действующая награда за приглашённых друзей —
 * что из двух, для доступа неважно.
 */
export async function currentTier() {
  if (await rewardActive()) return TIER.PRO;
  // Локальная отметка «куплено» — только для тестового режима: это память
  // об имитации покупки, а не о настоящей. Настоящая живёт на сервере
  // (pro_until) и приезжает через syncProUntil, который выше.
  if (TEST_MODE) return (await getSetting(KEY, TIER.FREE)) || TIER.FREE;
  return TIER.FREE;
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

/**
 * Вернуть бесплатный вид, если Про больше не действует.
 *
 * Само решение — в entitlements.js: оно денежное, и его проверяют тестами.
 * Здесь только чтение состояния и запись изменений.
 *
 * Молчаливо и безопасно в офлайне: срок лежит на устройстве и переживает
 * отсутствие сети, поэтому действующая подписка ничего не теряет, даже если
 * сервер сейчас недоступен.
 *
 * @returns {Promise<boolean>} менялось ли что-нибудь
 */
export async function enforceEntitlements() {
  const { downgradePlan } = await import('./entitlements.js');
  const { AppState, setThemeId } = await import('./state.js');
  const { getHudStyle, setHudStyle } = await import('./hud.js');

  const style = await getHudStyle();
  const plan = downgradePlan({
    isPro: (await currentTier()) === TIER.PRO,
    theme: AppState.theme,
    hudColor: style.color,
    hudFont: style.font,
  });

  if (plan.theme) {
    await setThemeId(plan.theme);
    // Без объявления экран останется в старых цветах до следующей перерисовки.
    document.dispatchEvent(new CustomEvent('theme-changed'));
  }
  if (plan.hudColor || plan.hudFont) {
    await setHudStyle({ color: plan.hudColor, font: plan.hudFont });
  }
  return Object.keys(plan).length > 0;
}
