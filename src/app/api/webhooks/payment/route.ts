import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { REFERRAL_RATE } from '@/lib/referral';

// ─── Telegram уведомления ───

async function notifyAdmin(text: string) {
  const token = process.env.ADMIN_BOT_TOKEN;
  const chatId = process.env.ADMIN_CHAT_ID;
  if (!token || !chatId) return;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => {});
}

async function notifyUser(tgId: number, text: string) {
  const token = process.env.ADMIN_BOT_TOKEN || process.env.TELEGRAM_MINIAPP_BOT_TOKEN;
  if (!token || !tgId) return;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: tgId, text }),
  }).catch(() => {});
}

// ─── Верификация платежа через ЮKassa ───

interface VerifiedPayment {
  status: string;
  metadata: Record<string, string>;
  amountRub: number;
}

async function verifyYooKassaPayment(paymentId: string): Promise<VerifiedPayment | null> {
  const auth =
    'Basic ' +
    Buffer.from(`${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`).toString(
      'base64',
    );

  const res = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
    headers: { Authorization: auth },
  });
  if (!res.ok) return null;

  const data = await res.json();
  return {
    status: data.status,
    metadata: data.metadata || {},
    amountRub: parseFloat(data.amount?.value || '0'),
  };
}

// ─── Начисление реферального вознаграждения ───

async function creditReferrer(buyerTgId: number, orderId: string, amountRub: number) {
  const sb = getSupabase();

  const { data: link } = await sb
    .from('tma_referrals')
    .select('id, referrer_id, first_order_at, total_earned_rub')
    .eq('referred_id', buyerTgId)
    .maybeSingle();

  if (!link) return;

  const reward = Number((amountRub * REFERRAL_RATE).toFixed(2));

  await sb
    .from('tma_referrals')
    .update({
      first_order_at: link.first_order_at || new Date().toISOString(),
      total_earned_rub: Number(link.total_earned_rub || 0) + reward,
    })
    .eq('id', link.id);

  if (reward > 0) {
    await sb.from('tma_wallet_txns').insert({
      telegram_id: link.referrer_id,
      kind: 'referral',
      amount_rub: reward,
      status: 'done',
      meta: { order: orderId, referred_id: buyerTgId, rate: REFERRAL_RATE },
    });
  }
}

// ─── POST /api/webhooks/payment ───

export async function POST(request: Request) {
  try {
    // Верификация источника: YooKassa может шлёт заголовок Authorization
    // с Basic-авторизацией. Проверяем что хотя бы есть заголовок.
    // Если заголовок присутствует — он должен совпадать с нашими credentials.
    const authHeader = request.headers.get('authorization');
    const shopId = process.env.YOOKASSA_SHOP_ID;
    const secretKey = process.env.YOOKASSA_SECRET_KEY;

    if (shopId && secretKey) {
      const expectedAuth = 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64');
      if (authHeader && authHeader !== expectedAuth) {
        console.warn('[Webhook] Invalid YooKassa Authorization header');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const body = await request.json();

    if (body.event !== 'payment.succeeded') {
      return NextResponse.json({ ok: true });
    }

    const paymentId: string = body.object?.id;
    if (!paymentId) {
      return NextResponse.json({ error: 'No payment id' }, { status: 400 });
    }

    const payment = await verifyYooKassaPayment(paymentId);
    if (!payment || payment.status !== 'succeeded') {
      return NextResponse.json({ ok: true });
    }

    const sb = getSupabase();
    const meta = payment.metadata;

    // ═══ Пополнение баланса ═══
    if (meta.kind === 'deposit') {
      const txnId = meta.orderId;
      const tgId = Number(meta.telegram_id);
      if (!txnId || !tgId) return NextResponse.json({ error: 'Bad metadata' }, { status: 400 });

      const { data: txn } = await sb
        .from('tma_wallet_txns')
        .select('id, status, amount_rub')
        .eq('id', txnId)
        .single();

      if (!txn || txn.status !== 'pending') return NextResponse.json({ ok: true });

      const { error: updErr } = await sb
        .from('tma_wallet_txns')
        .update({ status: 'done' })
        .eq('id', txnId)
        .eq('status', 'pending');
      if (updErr) return NextResponse.json({ error: 'DB error' }, { status: 500 });

      await sb.rpc('tma_adjust_balance', { p_tg: tgId, p_delta: Number(txn.amount_rub) });

      await notifyAdmin(
        `ПОПОЛНЕНИЕ БАЛАНСА\n` +
          `TG ID: ${tgId}\n` +
          `Сумма: ${payment.amountRub} ₽`,
      );

      return NextResponse.json({ ok: true });
    }

    // ═══ Заказ Stars ═══
    const orderId = meta.orderId;
    const starsAmount = parseInt(meta.stars_amount || '0', 10);
    const telegramUsername = meta.telegram_username || '';

    if (!orderId) return NextResponse.json({ error: 'Bad metadata' }, { status: 400 });

    // Проверяем звёзды в допустимых пределах
    if (starsAmount < 50 || starsAmount > 100000) {
      console.error('[Webhook] Invalid starsAmount:', starsAmount, 'for order:', orderId);
      return NextResponse.json({ error: 'Invalid stars amount' }, { status: 400 });
    }

    const { data: order } = await sb
      .from('tma_stars_orders')
      .select('id, status, telegram_id, amount_rub')
      .eq('id', orderId)
      .single();

    if (!order || order.status !== 'pending') {
      return NextResponse.json({ ok: true });
    }

    // ═══ ПРОВЕРКА СУММЫ: ЮKassa не должен прислать больше, чем заказ ═══
    if (payment.amountRub > order.amount_rub + 1) { // +1₽ допуск на округление
      console.error('[Webhook] Amount mismatch:', payment.amountRub, 'vs order:', order.amount_rub, 'order:', orderId);
      // Несмотря на расхождение, помечаем как оплаченный — ЮKassa уже списал
    }

    // Помечаем как оплаченный
    const { error } = await sb
      .from('tma_stars_orders')
      .update({ status: 'paid', payment_id: paymentId })
      .eq('id', orderId)
      .eq('status', 'pending');

    if (error) {
      console.error('[Webhook] Update error:', error);
      return NextResponse.json({ error: 'DB error' }, { status: 500 });
    }

    // ═══ Списываем использованный внутренний баланс ═══
    // amountRub из ЮKassa — это сколько заплатил пользователь (после вычета баланса)
    // totalRub из метаданных заказа — полная сумма
    // Разница = использованный баланс
    const orderData = await sb
      .from('tma_stars_orders')
      .select('amount_rub')
      .eq('id', orderId)
      .single();

    const fullAmount = Number(orderData?.data?.amount_rub || 0);
    const paidAmount = payment.amountRub;
    const balanceUsed = Math.max(0, fullAmount - paidAmount);

    if (balanceUsed > 0 && order.telegram_id) {
      await sb.rpc('tma_adjust_balance', { p_tg: order.telegram_id, p_delta: -balanceUsed });
      await sb.from('tma_wallet_txns').insert({
        telegram_id: order.telegram_id,
        kind: 'spend',
        amount_rub: -balanceUsed,
        status: 'done',
        meta: { order: orderId, description: 'Оплата заказа (внутренний баланс)' },
      });
    }

    // ═══ Уведомляем покупателя ═══
    const shortId = orderId.slice(0, 8);
    if (order.telegram_id) {
      await notifyUser(
        order.telegram_id,
        `Ваш заказ #${shortId} оплачен! Звёзды доставляются...`,
      );
    }

    // ═══ Реферальное вознаграждение ═══
    if (order.telegram_id) {
      await creditReferrer(order.telegram_id, orderId, payment.amountRub).catch((e) =>
        console.error('[Webhook] referrer credit error:', e),
      );
    }

    // ═══ Ставим в очередь доставки ═══
    const productType = meta.product_type || '';
    const premiumDuration = meta.premium_duration || '';

    const { enqueueDelivery } = await import('@/lib/delivery');

    if (productType.startsWith('premium_') && premiumDuration && telegramUsername) {
      await enqueueDelivery({
        orderId,
        username: telegramUsername,
        productType: 'premium',
        starsCount: 0,
        premiumDuration: premiumDuration as '3m' | '6m' | '12m',
      });
    } else if (telegramUsername && starsAmount > 0) {
      await enqueueDelivery({
        orderId,
        username: telegramUsername,
        productType: 'stars',
        starsCount: starsAmount,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Webhook] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
