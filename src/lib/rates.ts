// ─── Кэш курсов (общий для всех API-роутов) ───

interface RateCache {
  tonUsd: number;
  usdRub: number;
  updatedAt: number;
}

const CACHE_TTL = 5 * 60 * 1000;
let cache: RateCache | null = null;

export async function fetchRates(): Promise<{ tonUsd: number; usdRub: number }> {
  if (cache && Date.now() - cache.updatedAt < CACHE_TTL) {
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

  cache = { tonUsd, usdRub, updatedAt: Date.now() };

  return { tonUsd, usdRub };
}

// ─── Наценка ───

export function getMarkupPercent(starsCount: number): number {
  if (starsCount <= 100) return 15;
  if (starsCount <= 500) return 12;
  if (starsCount <= 2000) return 10;
  return 8;
}

// ─── Расчёт итоговой цены ───

export function calcTotalRub(starsCount: number, tonUsd: number, usdRub: number): number {
  // Себестоимость: 1 звезда = $0.013 (чуть дешевле Telegram $0.015, разница — наш запас)
  const starsCostUsd = starsCount * 0.013;
  // Газ TON: делим фиксированную стоимость газа на количество звёзд в заказе
  // Чем больше заказ — тем меньше доля газа на звезду
  const gasPerStarUsd = Math.min(0.05 * tonUsd / Math.max(starsCount, 1), 0.003);
  const costUsd = starsCostUsd + gasPerStarUsd * starsCount;
  const costRub = costUsd * usdRub;

  // Наценка: от 15% до 8%
  const markupPercent = getMarkupPercent(starsCount);
  const withMarkup = costRub * (1 + markupPercent / 100);
  // 6% эквайринга СБП
  const withAcquiring = withMarkup * 1.06;

  return Math.ceil(withAcquiring);
}
