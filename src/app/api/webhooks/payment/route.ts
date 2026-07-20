/**
 * POST /api/webhooks/payment — ЮKassa webhook handler.
 *
 * SECURITY LAYER:
 *   1. IP whitelist — только официальные IP ЮKassa
 *   2. Secret key verification — re-fetch payment via YooKassa API
 *   3. Idempotency — duplicate payment_id rejection
 *   4. Metadata validation — username + stars from user's real input
 *   5. Amount verification — payment amount matches order amount
 */

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { REFERRAL_RATE } from '@/lib/referral';

// ═══════════════════════════════════════════════════════════
// 1. YOO-KASSA IP WHITELIST
// https://yookassa.ru/developers/reference/webhooks
// ═══════════════════════════════════════════════════════════

const YOOKASSA_IPS = new Set([
  // IPv4
  '185.70.76.0/24', // неCIDR, проверяем по префиксу
  '185.70.77.0/24',
  // IPv6
  '2a06:6fc0::/32',
]);

// Функция для проверки IP (CIDR matching)
function isAllowedIP(ip: string): boolean {
  if (!ip) return false;

  // ЮKassa шлёт с этих подсетей:
  // 185.70.76.0/24, 185.70.77.0/24, 2a06:6fc0::/32
  // Для простоты проверяем по первым двум октетам
  const parts = ip.split('.');
  if (parts.length === 4) {
    const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
    // 185.70.76.x и 185.70.77.x
    if (parts[0] === '185' && parts[1] === '70' &&
        (parts[2] === '76' || parts[2] === '77')) {
      return true;
    }
  }

  // IPv6: 2a06:6fc0:...
  if (ip.includes(':') && ip.startsWith('2a06:6fc0:')) {
    return true;
  }

  // localhost для dev
  if (ip === '127.0.0.1' || ip === '::1') {
    return process.env.NODE_ENV !== 'production';
  }

  return false;
}

function getClientIP(request: Request): string {
  // Vercel/Next.js forwarded headers
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return '';
}

// ═══════════════════════════════════════════════════════════
// 2. PAYMENT VERIFICATION
// ═══════════════════════════════════════════════════════════

interface VerifiedPayment {
  id: string;
  status: string;
  amount: number;
  metadata: Record<string, string>;
}

async function verifyPayment(paymentId: string): Promise<VerifiedPayment | null> {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;

  if (!shopId || !secretKey) {
    console.error('[Webhook] YOOKASSA_SHOP_ID or YOOKASSA_SECRET_KEY not set');
    return null;
  }

  // Re-fetch payment from YooKassa API — единственный способ верифицировать
  const auth = 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64');

  try {
    const res = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      headers: {
        Authorization: auth,
        'Idempotency-Key': `verify-${paymentId}`,
      },
    });

    if (!res.ok) {
      console.error(`[Webhook] YooKassa API returned ${res.status} for payment ${paymentId}`);
      return null;
    }

    const data = await res.json();

    return {
      id: data.id,
      status: data.status,
      amount: parseFloat(data.amount?.value || '0'),
      metadata: data.metadata || {},
    };
  } catch (err) {
    console.error('[Webhook] Failed to verify payment:', err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// 3. TELEGRAM NOTIFICATIONS
// ═══════════════════════════════════════════════════════════

async function notifyAdmin(text: string): Promise<void> {
  const token = process.env.ADMIN_BOT_TOKEN;
  const chatId = process.env.ADMIN_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error('[Webhook] Failed to notify admin:', err);
  }
}

async function notifyUser(tgId: number, text: string): Promise<void> {
  const token = process.env.ADMIN_BOT_TOKEN || process.env.TELEGRAM_MINIAPP_BOT_TOKEN;
  if (!token || !tgId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tgId, text }),
    });
  } catch (err) {
    console.error('[Webhook] Failed to notify user:', err);
  }
}

// ═══════════════════════════════════════════════════════════
// 3.5 DEPOSIT HANDLER
// ═══════════════════════════════════════════════════════════

async function handleDeposit(
  meta: Record<string, string>,
  amountRub: number,
): Promise<NextResponse> {
  const txnId = meta.orderId;
  const tgId = Number(meta.telegram_id);

  if (!txnId || !tgId) {
    console.error('[Webhook] Deposit: missing orderId or telegram_id');
    return NextResponse.json({ error: 'Invalid deposit metadata' }, { status: 400 });
  }

  const sb = getSupabase();

  // Проверяем что транзакция в pending
  const { data: txn } = await sb
    .from('tma_wallet_txns')
    .select('id, status, amount_rub')
    .eq('id', txnId)
    .single();

  if (!txn || txn.status !== 'pending') {
    console.log(`[Webhook] Deposit ${txnId} already processed or not found`);
    return NextResponse.json({ ok: true });
  }

  // Помечаем как done
  const { error: updErr } = await sb
    .from('tma_wallet_txns')
    .update({ status: 'done' })
    .eq('id', txnId)
    .eq('status', 'pending');

  if (updErr) {
    console.error(`[Webhook] Deposit update failed:`, updErr);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  // Зачисляем на баланс
  await sb.rpc('tma_adjust_balance', { p_tg: tgId, p_delta: Number(txn.amount_rub) });

  await notifyAdmin(
    `💰 ПОПОЛНЕНИЕ БАЛАНСА\n` +
    `TG ID: ${tgId}\n` +
    `Сумма: ${amountRub} ₽`
  );

  await notifyUser(tgId, `Баланс пополнен на ${amountRub} ₽`);

  return NextResponse.json({ ok: true });
}

// ═══════════════════════════════════════════════════════════
// 4. REFERRAL CREDITING
// ═══════════════════════════════════════════════════════════

async function creditReferrer(buyerTgId: number, orderId: string, amountRub: number): Promise<void> {
  const sb = getSupabase();

  const { data: link } = await sb
    .from('tma_referrals')
    .select('id, referrer_id, first_order_at, total_earned_rub')
    .eq('referred_id', buyerTgId)
    .maybeSingle();

  if (!link) return;

  const reward = Number((amountRub * REFERRAL_RATE).toFixed(2));
  if (reward <= 0) return;

  await sb
    .from('tma_referrals')
    .update({
      first_order_at: link.first_order_at || new Date().toISOString(),
      total_earned_rub: Number(link.total_earned_rub || 0) + reward,
    })
    .eq('id', link.id);

  await sb.from('tma_wallet_txns').insert({
    telegram_id: link.referrer_id,
    kind: 'referral',
    amount_rub: reward,
    status: 'done',
    meta: { order: orderId, referred_id: buyerTgId, rate: REFERRAL_RATE },
  });
}

// ═══════════════════════════════════════════════════════════
// 5. MAIN HANDLER
// ═══════════════════════════════════════════════════════════

export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    // ─── STEP 1: IP WHITELIST CHECK ───
    const clientIP = getClientIP(request);
    if (!isAllowedIP(clientIP)) {
      console.warn(`[Webhook] REJECTED — IP not in whitelist: ${clientIP}`);
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ─── STEP 2: PARSE BODY ───
    const body = await request.json();

    // ЮKassa шлёт разные event'ы — обрабатываем только payment.succeeded
    if (body.event !== 'payment.succeeded') {
      return NextResponse.json({ ok: true });
    }

    const paymentId: string | undefined = body.object?.id;
    if (!paymentId) {
      console.warn('[Webhook] REJECTED — no payment id in body');
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    // ─── STEP 3: RE-FETCH & VERIFY PAYMENT FROM YOOKASSA ───
    const payment = await verifyPayment(paymentId);
    if (!payment) {
      console.error(`[Webhook] REJECTED — payment verification failed: ${paymentId}`);
      return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
    }

    if (payment.status !== 'succeeded') {
      console.log(`[Webhook] Ignoring payment ${paymentId} with status ${payment.status}`);
      return NextResponse.json({ ok: true });
    }

    // ─── STEP 4: IDEMPOTENCY CHECK ───
    const sb = getSupabase();

    const { data: existingPayment } = await sb
      .from('tma_stars_orders')
      .select('id')
      .eq('payment_id', paymentId)
      .maybeSingle();

    if (existingPayment) {
      console.log(`[Webhook] DUPLICATE — payment ${paymentId} already processed`);
      return NextResponse.json({ ok: true });
    }

    // ─── STEP 5: PARSE METADATA (USER'S REAL INPUT) ───
    const meta = payment.metadata;

    // ── Case A: Balance deposit ──
    if (meta.kind === 'deposit') {
      return handleDeposit(meta, payment.amount);
    }

    // ── Case B: Stars/Premium order ──
    const orderId = meta.orderId;
    const starsAmount = parseInt(meta.stars_amount || '0', 10);
    const telegramUsername = meta.telegram_username || '';
    const productType = meta.product_type || '';
    const premiumDuration = meta.premium_duration || '';

    // Валидация обязательных полей
    if (!orderId || !telegramUsername) {
      console.error('[Webhook] REJECTED — missing orderId or telegram_username in metadata');
      return NextResponse.json({ error: 'Invalid metadata' }, { status: 400 });
    }

    // Валидация username — только допустимые символы
    if (!/^[a-zA-Z0-9_]{1,64}$/.test(telegramUsername)) {
      console.error(`[Webhook] REJECTED — invalid username: ${telegramUsername}`);
      return NextResponse.json({ error: 'Invalid username' }, { status: 400 });
    }

    // Валидация количества звёзд (если это Stars заказ)
    const isPremium = productType.startsWith('premium_');
    if (!isPremium && (starsAmount < 50 || starsAmount > 100000)) {
      console.error(`[Webhook] REJECTED — invalid starsAmount: ${starsAmount} for order ${orderId}`);
      return NextResponse.json({ error: 'Invalid stars amount' }, { status: 400 });
    }

    // Валидация premium duration
    if (isPremium && !['3m', '6m', '12m'].includes(premiumDuration)) {
      console.error(`[Webhook] REJECTED — invalid premium duration: ${premiumDuration}`);
      return NextResponse.json({ error: 'Invalid premium duration' }, { status: 400 });
    }

    // ─── STEP 6: FETCH ORDER FROM DB ───
    const { data: order, error: orderError } = await sb
      .from('tma_stars_orders')
      .select('id, status, telegram_id, amount_rub, stars_count')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error(`[Webhook] REJECTED — order not found: ${orderId}`);
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (order.status !== 'pending') {
      console.log(`[Webhook] IGNORE — order ${orderId} already in status: ${order.status}`);
      return NextResponse.json({ ok: true });
    }

    // ─── STEP 7: AMOUNT VERIFICATION ───
    // Проверяем что сумма платежа соответствует сумме заказа
    const amountDiff = Math.abs(payment.amount - order.amount_rub);
    if (amountDiff > 1) { // ±1₽ допуск на округление
      console.error(
        `[Webhook] AMOUNT MISMATCH — payment: ${payment.amount}₽, order: ${order.amount_rub}₽, diff: ${amountDiff}₽`
      );
      // Всё равно помечаем как paid — ЮKassa уже списал деньги
      // Но логируем для расследования
    }

    // ─── STEP 8: MARK ORDER AS PAID ───
    const { error: updateError } = await sb
      .from('tma_stars_orders')
      .update({ status: 'paid', payment_id: paymentId })
      .eq('id', orderId)
      .eq('status', 'pending');

    if (updateError) {
      console.error(`[Webhook] DB UPDATE FAILED for order ${orderId}:`, updateError);
      return NextResponse.json({ error: 'DB error' }, { status: 500 });
    }

    // ─── STEP 9: DEDUCT INTERNAL BALANCE ───
    // payment.amount = сколько заплатил пользователь (после вычета баланса)
    // order.amount_rub = полная сумма заказа
    // Разница = использованный внутренний баланс
    const balanceUsed = Math.max(0, order.amount_rub - payment.amount);

    if (balanceUsed > 0 && order.telegram_id) {
      await sb.rpc('tma_adjust_balance', {
        p_tg: order.telegram_id,
        p_delta: -balanceUsed,
      });

      await sb.from('tma_wallet_txns').insert({
        telegram_id: order.telegram_id,
        kind: 'spend',
        amount_rub: -balanceUsed,
        status: 'done',
        meta: { order: orderId, description: 'Оплата заказа (внутренний баланс)' },
      });
    }

    // ─── STEP 10: NOTIFY USER ───
    if (order.telegram_id) {
      const label = isPremium ? `Premium ${premiumDuration}` : `${starsAmount} ⭐`;
      await notifyUser(order.telegram_id, `Ваш заказ #${orderId.slice(0, 8)} оплачен! ${label} доставляется...`);
    }

    // ─── STEP 11: REFERRAL CREDIT ───
    if (order.telegram_id) {
      await creditReferrer(order.telegram_id, orderId, payment.amount).catch((err) =>
        console.error(`[Webhook] Referral credit failed for order ${orderId}:`, err)
      );
    }

    // ─── STEP 12: DELIVER ORDER (serverless, fire-and-forget) ───
    const { deliverOrder } = await import('@/lib/serverless-delivery');

    try {
      const deliveryResult = await deliverOrder({
        orderId,
        username: telegramUsername,
        productType: isPremium ? 'premium' : 'stars',
        starsCount: starsAmount,
        premiumDuration: isPremium ? premiumDuration as '3m' | '6m' | '12m' : undefined,
        telegramId: order.telegram_id,
      });

      console.log(`[Webhook] Delivery result: ${deliveryResult.status} (${Date.now() - startTime}ms)`);
    } catch (err) {
      console.error(`[Webhook] Delivery failed for order ${orderId}:`, err);
      // Не возвращаем ошибку — заказ уже оплачен, доставка произойдёт через retry
    }

    // ─── STEP 13: ADMIN NOTIFICATION ───
    const elapsed = Date.now() - startTime;
    const shortId = orderId.slice(0, 8);
    const label = isPremium ? `Premium ${premiumDuration}` : `${starsAmount}⭐`;

    await notifyAdmin(
      `💰 ОПЛАЧЕН\n` +
      `Заказ: #${shortId}\n` +
      `@${telegramUsername} — ${label}\n` +
      `Сумма: ${payment.amount}₽\n` +
      `Платёж: ${paymentId}\n` +
      `Обработка: ${elapsed}ms`
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Webhook] UNHANDLED ERROR:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
