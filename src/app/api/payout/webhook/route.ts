/**
 * POST /api/payout/webhook — YooKassa Payouts webhook handler.
 *
 * Получает уведомления о статусе выплат:
 *   - payoutucceeded: выплата завершена успешно → success_payout
 *   - payoutcanceled: выплата отменена → failed
 *
 * Безопасность:
 *   1. IP whitelist (YooKassa IPs)
 *   2. Re-fetch payout status через YooKassa API (verify)
 *   3. Idempotency (двойная обработка одного event)
 */

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getPayoutStatus, verifyPayoutWebhook } from '@/lib/yookassa-payouts';

// ═══════════════════════════════════════════════════════════
// TELEGRAM NOTIFICATIONS
// ═══════════════════════════════════════════════════════════

async function notifyUser(tgId: number, text: string): Promise<void> {
  const token = process.env.ADMIN_BOT_TOKEN || process.env.TELEGRAM_MINIAPP_BOT_TOKEN;
  if (!token || !tgId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tgId, text }),
    });
  } catch {}
}

async function notifyAdmin(text: string): Promise<void> {
  const token = process.env.ADMIN_BOT_TOKEN;
  const chatId = process.env.ADMIN_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch {}
}

// ═══════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════

export async function POST(request: Request) {
  try {
    // ─── STEP 1: IP WHITELIST ───
    if (!verifyPayoutWebhook(request)) {
      console.warn('[Payout Webhook] REJECTED — IP not in whitelist');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ─── STEP 2: PARSE BODY ───
    const body = await request.json();

    const eventType = body.event;
    const payoutId = body.object?.id;
    const payoutStatus = body.object?.status;

    if (!payoutId || !eventType) {
      return NextResponse.json({ error: 'Invalid webhook' }, { status: 400 });
    }

    console.log(`[Payout Webhook] Event: ${eventType} | Payout: ${payoutId} | Status: ${payoutStatus}`);

    // ─── STEP 3: RE-FETCH & VERIFY ───
    let verifiedPayout;
    try {
      verifiedPayout = await getPayoutStatus(payoutId);
    } catch (err) {
      console.error(`[Payout Webhook] Failed to verify payout ${payoutId}:`, err);
      return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
    }

    if (!verifiedPayout) {
      return NextResponse.json({ error: 'Payout not found' }, { status: 404 });
    }

    // ─── STEP 4: FIND ORDER ───
    const sb = getSupabase();

    const { data: order, error: orderError } = await sb
      .from('payout_orders')
      .select('id, user_id, stars_amount, rub_to_pay, card_number_masked, status')
      .eq('payout_id', payoutId)
      .maybeSingle();

    if (orderError || !order) {
      console.error(`[Payout Webhook] Order not found for payout ${payoutId}`);
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // ─── STEP 5: IDEMPOTENCY ───
    if (order.status === 'success_payout' || order.status === 'failed') {
      console.log(`[Payout Webhook] Order ${order.id} already in status ${order.status} — skipping`);
      return NextResponse.json({ ok: true });
    }

    // ─── STEP 6: UPDATE STATUS ───
    if (eventType === 'payoutucceeded' && payoutStatus === 'succeeded') {
      // Успешная выплата
      await sb
        .from('payout_orders')
        .update({ status: 'success_payout' })
        .eq('id', order.id);

      // Audit log
      await sb.from('payout_audit_log').insert({
        payout_order_id: order.id,
        action: 'payout_succeeded',
        details: {
          payoutId,
          amount: verifiedPayout.amount,
          cardMasked: order.card_number_masked,
        },
      });

      // Уведомляем пользователя
      await notifyUser(
        order.user_id,
        `✅ Выплата ${order.rub_to_pay}₽ на карту ${order.card_number_masked} завершена!\n` +
        `Выведено: ${order.stars_amount} Stars`
      );

      // Уведомляем админа
      await notifyAdmin(
        `💰 <b>ВЫПЛАТА ЗАВЕРШЕНА</b>\n` +
        `Заказ: #${order.id.slice(0, 8)}\n` +
        `Пользователь: ${order.user_id}\n` +
        `Сумма: ${order.rub_to_pay}₽ → ${order.card_number_masked}\n` +
        `Stars: ${order.stars_amount}`
      );

    } else if (eventType === 'payoutcanceled' || payoutStatus === 'canceled') {
      // Выплата отменена
      const errorMessage = body.object?.cancellation_details?.reason || 'Payment canceled';

      await sb
        .from('payout_orders')
        .update({
          status: 'failed',
          error_message: errorMessage,
        })
        .eq('id', order.id);

      // Audit log
      await sb.from('payout_audit_log').insert({
        payout_order_id: order.id,
        action: 'payout_failed',
        details: {
          payoutId,
          reason: errorMessage,
        },
      });

      // Уведомляем пользователя
      await notifyUser(
        order.user_id,
        `❌ Выплата ${order.rub_to_pay}₽ не удалась.\n` +
        `Причина: ${errorMessage}\n` +
        `Обратитесь в поддержку.`
      );

      // Уведомляем админа
      await notifyAdmin(
        `🚨 <b>ВЫПЛАТА ПРОВАЛЕНА</b>\n` +
        `Заказ: #${order.id.slice(0, 8)}\n` +
        `Пользователь: ${order.user_id}\n` +
        `Причина: ${errorMessage}`
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Payout Webhook] UNHANDLED ERROR:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
