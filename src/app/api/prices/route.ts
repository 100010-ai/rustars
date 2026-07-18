import { NextResponse } from 'next/server';
import { fetchRates, calcTotalRub, getMarkupPercent } from '@/lib/rates';
import { checkRateLimit, getKeyFromRequest } from '@/lib/rate-limit';

// 5 запросов цен в секунду на пользователя
const PRICE_LIMIT = { max: 5, windowMs: 1000 };

export async function POST(request: Request) {
  try {
    const { starsCount, telegramId } = await request.json();

    if (typeof starsCount !== 'number' || !Number.isInteger(starsCount) || starsCount < 1) {
      return NextResponse.json({ error: 'Invalid starsCount' }, { status: 400 });
    }

    // Rate limit
    const key = getKeyFromRequest(request, telegramId);
    const limit = checkRateLimit(key, PRICE_LIMIT);

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
    const totalRub = calcTotalRub(starsCount, tonUsd, usdRub);
    const perStarRub = Number((totalRub / starsCount).toFixed(2));

    return NextResponse.json({
      starsCount,
      totalRub,
      perStarRub,
      markupPercent: getMarkupPercent(starsCount),
      rates: { tonUsd, usdRub },
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
