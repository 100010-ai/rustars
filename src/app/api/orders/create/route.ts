import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { fetchRates, calcTotalRub } from '@/lib/rates';
import { checkRateLimit, getKeyFromRequest } from '@/lib/rate-limit';
import { createYooKassaPayment } from '@/lib/yookassa';

const ORDER_TTL_MS = 10 * 60 * 1000;
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

    // ─── Расчёт цены ───

    const { tonUsd, usdRub } = await fetchRates();
    const totalRub = calcTotalRub(starsCount, tonUsd, usdRub);

    // ─── Создаём заказ в Supabase ───

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ORDER_TTL_MS);

    const { data: order, error: insertError } = await getSupabase()
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

    if (insertError) {
      console.error('Supabase insert error:', insertError);
      return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
    }

    // ─── Создаём платёж в ЮKassa (СБП) ───

    const appUrl = `https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME}?startapp`;
    const webhookUrl = `${process.env.APP_URL}/api/webhooks/payment`;

    const payment = await createYooKassaPayment({
      amount: totalRub,
      description: `RuStars: ${starsCount} Telegram Stars`,
      metadata: {
        orderId: order.id,
        stars_amount: String(starsCount),
        telegram_username: tgUser.username || '',
      },
      confirmationUrl: appUrl,
      webhookUrl,
    });

    // Сохраняем ID платежа ЮKassa для связи с заказом
    await getSupabase()
      .from('tma_stars_orders')
      .update({ payment_id: payment.id })
      .eq('id', order.id);

    const paymentUrl = payment.confirmation?.confirmation_url;

    if (!paymentUrl) {
      console.error('YooKassa: no confirmation_url in response');
      return NextResponse.json({ error: 'Payment creation failed' }, { status: 500 });
    }

    return NextResponse.json({
      orderId: order.id,
      totalRub,
      paymentUrl,
    });
  } catch (err) {
    console.error('Order create error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
