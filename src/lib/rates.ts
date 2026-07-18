// ─── Кэш курсов ───

interface RateCache {
  tonUsd: number;
  usdRub: number;
  updatedAt: number;
}

const CACHE_TTL = 5 * 60 * 1000;
let cache: RateCache | null = null;

// Цена Fragment: 1 звезда = $0.015 (фиксированная)
const FRAGMENT_STAR_USD = 0.015;

export async function fetchRates(): Promise<{ tonUsd: number; usdRub: number }> {
  const now = Date.now();

  if (cache && now - cache.updatedAt < CACHE_TTL) {
    return { tonUsd: cache.tonUsd, usdRub: cache.usdRub };
  }

  // Запрашиваем оба курса параллельно
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

// ─── Прогрессивная маржа ───

export function getMarkupPercent(starsCount: number): number {
  if (starsCount <= 100) return 10;
  if (starsCount <= 1000) return 7;
  return 4;
}

// ─── Расчёт итоговой цены ───

export function calcTotalRub(starsCount: number, tonUsd: number, usdRub: number): number {
  // Себестоимость: 1 звезда = $0.015 (цена Fragment)
  const starsCostUsd = starsCount * FRAGMENT_STAR_USD;

  // Газ TON: 0.01 TON × реальный курс TON/USD
  const gasUsd = 0.01 * tonUsd;

  // Итого в долларах
  const totalUsd = starsCostUsd + gasUsd;

  // Конвертируем в рубли по актуальному курсу
  const totalRub = totalUsd * usdRub;

  // Прогрессивная маржа
  const markupPercent = getMarkupPercent(starsCount);
  const withMarkup = totalRub * (1 + markupPercent / 100);

  // 6% комиссия ЮKassa
  const withAcquiring = withMarkup * 1.06;

  // 4% налог самозанятого
  const withTax = withAcquiring * 1.04;

  return Math.ceil(withTax);
}
