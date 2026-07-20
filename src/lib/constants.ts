/**
 * Shared constants — единый источник правды для всех модулей.
 *
 * Все константы, связанные с ценообразованией и Fragment,
 * определены здесь. Никаких дублирований.
 */

// ═══════════════════════════════════════════════════════════
// FRAGMENT PRICING (реальные данные из блокчейна)
// ═══════════════════════════════════════════════════════════

/**
 * Себестоимость 100 Stars на Fragment = 1.0381 GRAM (TON).
 * Фиксированная стоимость в смарт-контракте Fragment.
 */
export const GRAM_PER_100_STARS = 1.0381;

/**
 * Себестоимость 1 Stars в GRAM (TON).
 * 1 Star = 0.010381 GRAM.
 */
export const GRAM_PER_STAR = GRAM_PER_100_STARS / 100;

/**
 * Курс закупки GRAM на обменнике.
 * Обновляется вручную при изменении курса.
 */
export const PURCHASE_RATE_RUB_PER_GRAM = 137;

/**
 * Комиссия эквайринга ЮKassa — строго 3.5%.
 */
export const YOOKASSA_ACQUIRING = 0.035;

/**
 * Реферальная ставка — 10% от суммы покупки.
 */
export const REFERRAL_RATE = 0.1;

// ═══════════════════════════════════════════════════════════
// PREMIUM PRICING (фиксированные тарифы)
// ═══════════════════════════════════════════════════════════

export const PREMIUM_PRICES: Record<string, { ton: string; rub: number }> = {
  premium_3mo: { ton: '5.0', rub: 1590 },
  premium_6mo: { ton: '8.0', rub: 2190 },
  premium_1yr: { ton: '15.0', rub: 3790 },
};

// ═══════════════════════════════════════════════════════════
// FRAGMENT CONTRACTS
// ═══════════════════════════════════════════════════════════

export const FRAGMENT_CONTRACT_ADDRESS = 'EQBYzPOb14Khst81sE8uJY1wJwGjOkmQkTHyGU7Edq2eCQ1P';

// ═══════════════════════════════════════════════════════════
// TON WALLET LIMITS
// ═══════════════════════════════════════════════════════════

export const TON_LIMITS = {
  MAX_PER_TX: 30,
  MAX_PER_15MIN: 25,
  MAX_DAILY: 150,
  CIRCUIT_BREAKER_WINDOW_MS: 15 * 60 * 1000,
};
