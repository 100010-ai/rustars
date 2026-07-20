import { NextResponse } from 'next/server';
import { fetchRates, calcTotalRub, getMarkupPercent } from '@/lib/rates';
import { checkRateLimitDb, getKeyFromRequest } from '@/lib/rate-limit';

// 5 запросов цен в секунду на пользователя
const PRICE_LIMIT = { max: 5, windowMs: 1000 };

const MAX_STARS = 100000;

// Обратный расчёт: по сумме в рублях подбираем максимум звёзд (бинарный поиск).
function starsForRub(amountRub: number, tonUsd: number, usdRub: number): number {
  if (calcTotalRub(1, tonUsd, usdRub) > amountRub) return 0;
  let lo = 1;
  let hi = MAX_STARS;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (mid > MAX_STARS) break;
    if (calcTotalRub(mid, tonUsd, usdRub) <= amountRub) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export async function POST(request: Request) {
  try {
    const { starsCount, amountRub, telegramId } = await request.json();

    const hasStars = typeof starsCount === 'number' && Number.isInteger(starsCount) && starsCount >= 1;
    const hasRub = typeof amountRub === 'number' && amountRub > 0;

    if (!hasStars && !hasRub) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    // Rate limit
    const key = getKeyFromRequest(request, telegramId);
    const limit = await checkRateLimitDb(key, PRICE_LIMIT);

    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)),
            'X-RateLimit-Remaining': '0',
          },
        },
      );
    }

    const { tonUsd, usdRub } = await fetchRates();

    // Режим «по рублям» → сколько звёзд
    const stars = hasStars ? starsCount : starsForRub(amountRub, tonUsd, usdRub);
    if (stars < 1) {
      return NextResponse.json({ starsCount: 0, totalRub: 0, perStarRub: 0, markupPercent: 0, rates: { tonUsd, usdRub } });
    }

    const totalRub = calcTotalRub(stars, tonUsd, usdRub);
    const perStarRub = Number((totalRub / stars).toFixed(2));

    return NextResponse.json({
      starsCount: stars,
      totalRub,
      perStarRub,
      markupPercent: getMarkupPercent(stars),
      rates: { tonUsd, usdRub },
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
