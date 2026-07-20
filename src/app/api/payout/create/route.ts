/**
 * POST /api/payout/create — создание заявки на скупку Stars.
 *
 * Принимает:
 *   - stars_amount: количество Stars для продажи
 *   - card_number: номер банковской карты (16 цифр)
 *   - initData: Telegram initData для HMAC-проверки
 *
 * Process:
 *   1. Валидация initData (HMAC-SHA256)
 *   2. Проверка лимитов (3000₽/раз, 10000₽/сутки)
 *   3. Расчёт суммы к выплате
 *   4. Маскирование номера карты
 *   5. Создание записи в payout_orders
 *   6. Возврат Telegram Stars Invoice для оплаты
 */

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { resolveTelegramUser } from '@/lib/telegram';
import { checkRateLimitDb, getKeyFromRequest } from '@/lib/rate-limit';
import { GRAM_PER_STAR, PURCHASE_RATE_RUB_PER_GRAM } from '@/lib/constants';

// ═══════════════════════════════════════════════════════════
// LIMITS
// ═══════════════════════════════════════════════════════════

const MAX_PER_TX = 3000;    // 3000 рублей за раз
const MAX_PER_DAY = 10000;  // 10000 рублей в сутки
const MIN_STARS = 50;       // Минимум 50 Stars

// ═══════════════════════════════════════════════════════════
// CARD MASKING
// ═══════════════════════════════════════════════════════════

function maskCard(card: string): string {
  const clean = card.replace(/\D/g, '');
  if (clean.length < 8) return '****' + clean.slice(-4);
  return '*'.repeat(clean.length - 4) + clean.slice(-4);
}

function validateCardNumber(card: string): boolean {
  const clean = card.replace(/\D/g, '');
  return clean.length >= 15 && clean.length <= 19;
}

// ═══════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════

export async function POST(request: Request) {
  try {
    // ─── STEP 1: AUTH ───
    const initData = request.headers.get('x-telegram-init-data');
    const resolved = resolveTelegramUser(initData, null, true);
    if (!resolved) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = resolved.id;

    // ─── STEP 2: RATE LIMIT ───
    const rateKey = getKeyFromRequest(request, userId);
    const rateLimit = await checkRateLimitDb(`payout-create:${rateKey}`, { max: 3, windowMs: 60_000 });
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // ─── STEP 3: PARSE BODY ───
    const body = await request.json();
    const { stars_amount, card_number } = body;

    // Валидация stars_amount
    if (typeof stars_amount !== 'number' || !Number.isInteger(stars_amount)) {
      return NextResponse.json({ error: 'Invalid stars_amount' }, { status: 400 });
    }
    if (stars_amount < MIN_STARS) {
      return NextResponse.json({ error: `Minimum ${MIN_STARS} Stars` }, { status: 400 });
    }
    if (stars_amount > 100000) {
      return NextResponse.json({ error: 'Maximum 100,000 Stars' }, { status: 400 });
    }

    // Валидация card_number
    if (!card_number || !validateCardNumber(card_number)) {
      return NextResponse.json({ error: 'Invalid card number' }, { status: 400 });
    }

    // ─── STEP 4: READ BUYBACK RATE ───
    const sb = getSupabase();
    const { data: rateData } = await sb
      .from('system_rates')
      .select('stars_buy_rate_rub')
      .eq('key', 'buyback')
      .maybeSingle();

    const buyRate = rateData?.stars_buy_rate_rub || 0.80;

    // ─── STEP 5: CALCULATE RUB AMOUNT ───
    const rubToPay = Math.floor(stars_amount * buyRate);

    if (rubToPay <= 0) {
      return NextResponse.json({ error: 'Amount too small' }, { status: 400 });
    }

    // ─── STEP 6: CHECK LIMITS ───
    // Per-transaction limit
    if (rubToPay > MAX_PER_TX) {
      return NextResponse.json({
        error: `Maximum ${MAX_PER_TX}₽ per transaction`,
        maxPerTx: MAX_PER_TX,
      }, { status: 400 });
    }

    // Daily limit check
    const today = new Date().toISOString().split('T')[0];
    const dayStart = `${today}T00:00:00Z`;

    const { data: todayOrders } = await sb
      .from('payout_orders')
      .select('rub_to_pay')
      .eq('user_id', userId)
      .gte('created_at', dayStart)
      .in('status', ['created', 'pending_stars', 'stars_received', 'processing_payout', 'success_payout']);

    const todayTotal = (todayOrders || []).reduce((sum, o) => sum + Number(o.rub_to_pay), 0);

    if (todayTotal + rubToPay > MAX_PER_DAY) {
      return NextResponse.json({
        error: `Daily limit exceeded: ${todayTotal}₽ + ${rubToPay}₽ > ${MAX_PER_DAY}₽`,
        todayTotal,
        maxPerDay: MAX_PER_DAY,
      }, { status: 400 });
    }

    // ─── STEP 7: CHECK ACTIVE ORDERS ───
    const { data: activeOrders } = await sb
      .from('payout_orders')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['created', 'pending_stars', 'stars_received', 'processing_payout'])
      .limit(1);

    if (activeOrders && activeOrders.length > 0) {
      return NextResponse.json({
        error: 'You already have an active payout order',
        activeOrderId: activeOrders[0].id,
      }, { status: 409 });
    }

    // ─── STEP 8: CREATE PAYOUT ORDER ───
    const maskedCard = maskCard(card_number);
    const cleanCard = card_number.replace(/\D/g, '');

    const { data: order, error: insertError } = await sb
      .from('payout_orders')
      .insert({
        user_id: userId,
        stars_amount: stars_amount,
        rub_to_pay: rubToPay,
        card_number_masked: maskedCard,
        status: 'created',
        metadata: {
          buyRate,
          cardLast4: cleanCard.slice(-4),
          ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
        },
      })
      .select('id')
      .single();

    if (insertError || !order) {
      console.error('[Payout Create] DB error:', insertError);
      return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
    }

    // ─── STEP 9: AUDIT LOG ───
    await sb.from('payout_audit_log').insert({
      payout_order_id: order.id,
      action: 'created',
      details: {
        userId,
        starsAmount: stars_amount,
        rubToPay,
        cardMasked: maskedCard,
        buyRate,
      },
    });

    // ─── STEP 10: GENERATE TELEGRAM STARS INVOICE ───
    // Пользователь должен отправить Stars на наш системный аккаунт
    // Fragment автоматически конвертирует Stars в GRAM (TON)
    const starsInvoice = {
      // Telegram Stars Invoice URL
      // Пользователь оплачивает через Telegram Stars
      invoiceLink: `https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME || 'RuStarAppbot'}?start=payout_${order.id.slice(0, 8)}`,
      // Альтернатива: Deep link для оплаты Stars
      starsInvoiceUrl: `https://fragment.com/stars?invoice=${order.id.slice(0, 8)}`,
    };

    console.log(`[Payout Create] Order created: ${order.id} | ${stars_amount}★ → ${rubToPay}₽ | @${userId} | ${maskedCard}`);

    return NextResponse.json({
      ok: true,
      orderId: order.id,
      starsAmount: stars_amount,
      rubToPay,
      buyRate,
      cardMasked: maskedCard,
      starsInvoice,
    });
  } catch (err) {
    console.error('[Payout Create] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
