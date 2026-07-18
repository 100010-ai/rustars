// ─── Кэш курсов ───

interface RateCache {
  usdRub: number;
  updatedAt: number;
}

const CACHE_TTL = 5 * 60 * 1000;
let cache: RateCache | null = null;

// Фиксированный курс Fragment: 1 TON ≈ $1.49 (0.5038 TON = $0.75)
// Fragment использует свой внутренний курс, не рыночный
const FRAGMENT_TON_USD = 1.49;

export async function fetchRates(): Promise<{ tonUsd: number; usdRub: number }> {
  const now = Date.now();

  if (cache && now - cache.updatedAt < CACHE_TTL) {
    return { tonUsd: FRAGMENT_TON_USD, usdRub: cache.usdRub };
  }

  const res = await fetch(
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    { next: { revalidate: 300 } },
  );

  if (!res.ok) throw new Error('Failed to fetch USD/RUB rate');

  const data = await res.json();
  const usdRub: number = data.usd.rub;

  cache = { usdRub, updatedAt: now };

  return { tonUsd: FRAGMENT_TON_USD, usdRub };
}

// ─── Прогрессивная маржа ───

export function getMarkupPercent(starsCount: number): number {
  if (starsCount <= 100) return 10;   // Малые пакеты: +10%
  if (starsCount <= 1000) return 7;   // Средние: +7%
  return 4;                            // Крупный опт 1001+: +4%
}

// ─── Расчёт итоговой цены ───

export function calcTotalRub(starsCount: number, _tonUsd: number, usdRub: number): number {
  // Себестоимость по цене Fragment: 1 звезда = $0.015
  const starsCostUsd = starsCount * 0.015;

  // Газ TON: ~0.01 TON на транзакцию (реальная комиссия сети)
  const gasUsd = 0.01 * FRAGMENT_TON_USD;

  // Итого в долларах
  const totalUsd = starsCostUsd + gasUsd;

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
