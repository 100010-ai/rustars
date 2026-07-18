// ─── Кэш курсов ───

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

// ─── Прогрессивная маржа ───

export function getMarkupPercent(starsCount: number): number {
  if (starsCount <= 100) return 10;   // Малые пакеты: +10%
  if (starsCount <= 1000) return 7;   // Средние: +7%
  return 4;                            // Крупный опт 1001+: +4%
}

// ─── Расчёт итоговой цены ───

export function calcTotalRub(starsCount: number, tonUsd: number, usdRub: number): number {
  // Себестоимость: 1 звезда = $0.012 (чуть дешевле Telegram $0.015)
  const starsCostUsd = starsCount * 0.012;

  // Газ TON: 0.05 TON на весь заказ, делим на количество звёзд
  // Максимум 0.003$ на звезду, чтобы маленькие заказы не были убыточными
  const gasPerStarUsd = Math.min((0.05 * tonUsd) / Math.max(starsCount, 1), 0.003);
  const gasTotalUsd = gasPerStarUsd * starsCount;

  // Итого в долларах
  const totalUsd = starsCostUsd + gasTotalUsd;

  // Конвертируем в рубли
  const totalRub = totalUsd * usdRub;

  // Прогрессивная маржа
  const markupPercent = getMarkupPercent(starsCount);
  const withMarkup = totalRub * (1 + markupPercent / 100);

  // 6% комиссия ЮKassa (эквайринг СБП)
  const withAcquiring = withMarkup * 1.06;

  // 4% налог самозанятого
  const withTax = withAcquiring * 1.04;

  // Округляем вверх до целого
  return Math.ceil(withTax);
}
