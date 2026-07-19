import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { createYooKassaPayment } from '@/lib/yookassa';
import { checkRateLimit, getKeyFromRequest } from '@/lib/rate-limit';
import { resolveTelegramUser } from '@/lib/telegram';

const DEPOSIT_LIMIT = { max: 3, windowMs: 60_000 };
const MIN_RUB = 10;
const MAX_RUB = 100_000;

// POST /api/wallet/deposit  { amount, initData }
export async function POST(request: Request) {
  try {
    const { amount, initData } = await request.json();

    const resolved = resolveTelegramUser(initData, null, true);
    if (!resolved) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rub = Math.round(Number(amount));
    if (!Number.isInteger(rub) || rub < MIN_RUB || rub > MAX_RUB) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    const limit = checkRateLimit(getKeyFromRequest(request, resolved.id), DEPOSIT_LIMIT);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) } },
      );
    }

    const sb = getSupabase();

    // Создаём pending-транзакцию
    const { data: txn, error: txnErr } = await sb
      .from('tma_wallet_txns')
      .insert({
        telegram_id: resolved.id,
        kind: 'deposit',
        amount_rub: rub,
        status: 'pending',
      })
      .select('id')
      .single();

    if (txnErr || !txn) {
      console.error('[Deposit] insert error:', txnErr);
      return NextResponse.json({ error: 'Failed to create deposit' }, { status: 500 });
    }

    const returnUrl = `https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME}?startapp`;
    const webhookUrl = `${process.env.APP_URL}/api/webhooks/payment`;

    const payment = await createYooKassaPayment({
      amount: rub,
      description: `RuStars: пополнение баланса на ${rub} ₽`,
      metadata: {
        orderId: txn.id, // используется как Idempotence-Key
        kind: 'deposit',
        telegram_id: String(resolved.id),
      },
      confirmationUrl: returnUrl,
      webhookUrl,
    });

    await sb.from('tma_wallet_txns').update({ payment_id: payment.id }).eq('id', txn.id);

    const paymentUrl = payment.confirmation?.confirmation_url;
    if (!paymentUrl) {
      return NextResponse.json({ error: 'Payment creation failed' }, { status: 500 });
    }

    return NextResponse.json({ txnId: txn.id, amount: rub, paymentUrl });
  } catch (err) {
    console.error('[Deposit] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
