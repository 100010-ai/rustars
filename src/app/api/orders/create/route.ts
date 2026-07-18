import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchRates, calcTotalRub } from '@/lib/rates';
import { checkRateLimit, getKeyFromRequest } from '@/lib/rate-limit';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ORDER_TTL_MS = 10 * 60 * 1000;
// 3 заказа в минуту на пользователя
const ORDER_LIMIT = { max: 3, windowMs: 60_000 };

export async function POST(request: Request) {
  try {
    const { starsCount, tgUser } = await request.json();

    if (typeof starsCount !== 'number' || !Number.isInteger(starsCount) || starsCount < 1) {
      return NextResponse.json({ error: 'Invalid starsCount' }, { status: 400 });
    }
    if (!tgUser?.id) {
      return NextResponse.json({ error: 'Invalid tgUser' }, { status: 400 });
    }

    // Rate limit
    const key = getKeyFromRequest(request, tgUser.id);
    const limit = checkRateLimit(key, ORDER_LIMIT);

    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many orders' },
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

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ORDER_TTL_MS);

    const { data, error } = await supabase
      .from('tma_stars_orders')
      .insert({
        telegram_id: tgUser.id,
        username: tgUser.username || null,
        stars_count: starsCount,
        amount_rub: totalRub,
        status: 'pending',
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
    }

    const paymentUrl = `${process.env.PAYMENT_GATEWAY_URL}/pay?order=${data.id}&amount=${totalRub}`;

    return NextResponse.json({
      orderId: data.id,
      totalRub,
      paymentUrl,
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
