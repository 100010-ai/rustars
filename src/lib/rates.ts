// ─── Кэш курсов ───

interface RateCache {
  tonUsd: number;
  usdRub: number;
  updatedAt: number;
}

const CACHE_TTL = 5 * 60 * 1000;
let cache: RateCache | null = null;

// ═══════════════════════════════════════════════════════════
// FRAGMENT PRICING (реальные данные из блокчейна)
// ═══════════════════════════════════════════════════════════

/**
 * Себестоимость 100 Stars на Fragment = 1.0381 GRAM (TON).
 * Фиксированная стоимость в смарт-контракте Fragment.
 * 1 Звезда = 0.010381 GRAM.
 */
const GRAM_PER_100_STARS = 1.0381;
const GRAM_PER_STAR = GRAM_PER_100_STARS / 100; // 0.010381

/**
 * Текущий курс закупки GRAM на обменнике.
 * Обновляется вручную или через API обменника.
 */
const PURCHASE_RATE_RUB_PER_GRAM = 137;

/**
 * Комиссия эквайринга ЮKassa — строго 3.5%.
 */
const YOOKASSA_ACQUIRING = 0.035;

// ═══════════════════════════════════════════════════════════
// PROGRESSIVE MARGIN MULTIPLIERS
// ═══════════════════════════════════════════════════════════

/**
 * Прогрессивная шкала наценки (коэффициенты).
 *
 * Формула: розничная цена = себестоимость_GRAM × курс_закупки × marginMultiplier
 *
 * Маржа ~20-25% от себестоимости Fragment:
 *   100 Stars:  margin 1.25 → ~25% маржа → 185₽
 *   500 Stars:  margin 1.24 → ~24% маржа → 914₽
 *   1000 Stars: margin 1.22 → ~22% маржа → 1799₽
 *   5000+ Stars: margin 1.20 → ~20% маржа → 8843₽
 */
function getMarginMultiplier(starsCount: number): number {
  if (starsCount <= 100) return 1.25;
  if (starsCount <= 500) return 1.24;
  if (starsCount <= 1000) return 1.22;
  return 1.20;
}

// ═══════════════════════════════════════════════════════════
// EXCHANGE RATES
// ═══════════════════════════════════════════════════════════

export async function fetchRates(): Promise<{ tonUsd: number; usdRub: number }> {
  const now = Date.now();

  if (cache && now - cache.updatedAt < CACHE_TTL) {
    return { tonUsd: cache.tonUsd, usdRub: cache.usdRub };
  }

  const [tonRes, rubRes] = await Promise.all([
    fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd',
      { next: { revalidate: 300 } },
    ),
    fetch(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
      { next: { revalidate: 300 } },
    ),
  ]);

  if (!tonRes.ok || !rubRes.ok) {
    throw new Error('Failed to fetch exchange rates');
  }

  const tonData = await tonRes.json();
  const rubData = await rubRes.json();

  const tonUsd: number = tonData['the-open-network'].usd;
  const usdRub: number = rubData.usd.rub;

  cache = { tonUsd, usdRub, updatedAt: now };

  return { tonUsd, usdRub };
}

// ═══════════════════════════════════════════════════════════
// MARKUP PERCENT (для отображения на фронте)
// ═══════════════════════════════════════════════════════════

export function getMarkupPercent(starsCount: number): number {
  // Маржа рассчитывается как разница между розничной ценой и себестоимостью
  // Для отображения: (розничная - себестоимость) / себестоимость × 100
  const costPerStar = GRAM_PER_STAR * PURCHASE_RATE_RUB_PER_GRAM;
  const retailRate = getStarRateFromCount(starsCount);
  const margin = ((retailRate - costPerStar) / costPerStar) * 100;
  return Math.round(margin);
}

// ═══════════════════════════════════════════════════════════
// PRICE CALCULATION
// ═══════════════════════════════════════════════════════════

/**
 * Возвращает розничный курс за 1 звезду по количеству.
 * Должен совпадать с getStarRate() в referral.ts.
 */
function getStarRateFromCount(starsCount: number): number {
  if (starsCount <= 100) return 1.85;
  if (starsCount <= 500) return 1.83;
  if (starsCount <= 1000) return 1.80;
  return 1.77;
}

/**
 * Расчёт итоговой цены в рублях.
 *
 * Формула:
 *   1. Себестоимость = количество_звёзд × GRAM_PER_STAR × курс_закупки
 *   2. Розничная = себестоимость × marginMultiplier
 *   3. С учётом эквайринга 3.5%: клиент платит X, мы получаем X × 0.965
 *      Значит X = розничная / 0.965 (чтобы после вычета 3.5% остались наши деньги)
 *   4. Округляем вверх до целых рублей
 *
 * Проверка для 100 Stars:
 *   Себестоимость: 100 × 0.010381 × 137 = 142.22 ₽
 *   Розничная (×1.46): 142.22 × 1.46 = 207.64 ₽
 *   С эквайрингом: 207.64 / 0.965 = 215.17 ₽ → 216 ₽
 *   Клиент видит: 216 ₽ → мы получаем 216 × 0.965 = 208.44 ₽
 *   Прибыль: 208.44 - 142.22 = 66.22 ₽ ← слишком много
 *
 * Пересчитаем: desired retail = 180 ₽ → с эквайрингом 180 / 0.965 = 186.53 → 187 ₽
 *   Мы получаем: 187 × 0.965 = 180.46 ₽
 *   Прибыль: 180.46 - 142.22 = 38.24 ₽ ← ~27% маржа ✓
 */
export function calcTotalRub(starsCount: number, tonUsd: number, usdRub: number): number {
  // Себестоимость в рублях (через фиксированный курс закупки GRAM)
  const costRub = starsCount * GRAM_PER_STAR * PURCHASE_RATE_RUB_PER_GRAM;

  // Прогрессивный коэффициент наценки
  const multiplier = getMarginMultiplier(starsCount);

  // Розничная цена до эквайринга
  const retailBeforeAcquiring = costRub * multiplier;

  // С учётом эквайринга 3.5%: клиент платит X, мы получаем X × (1 - 0.035)
  // Значит X = retailBeforeAcquiring / (1 - 0.035)
  const priceWithAcquiring = retailBeforeAcquiring / (1 - YOOKASSA_ACQUIRING);

  // Округляем вверх до целых рублей
  return Math.ceil(priceWithAcquiring);
}
