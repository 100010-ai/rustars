/**
 * POST /api/payout/process — ручная обработка payout заказа (admin only).
 *
 * Используется когда:
 *   - Заказ в статусе manual_verification
 *   - Нужно принудительно запустить выплату
 *   - Нужно повторить неудачную выплату
 *
 * Принимает:
 *   - order_id: ID заказа в payout_orders
 *   - Bearer token: ADMIN_SECRET
 */

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { createPayout } from '@/lib/yookassa-payouts';

export async function POST(request: Request) {
  try {
    // ─── AUTH: Admin only ───
    const authHeader = request.headers.get('authorization');
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { order_id } = body;

    if (!order_id) {
      return NextResponse.json({ error: 'Missing order_id' }, { status: 400 });
    }

    const sb = getSupabase();

    // ─── FIND ORDER ───
    const { data: order, error } = await sb
      .from('payout_orders')
      .select('*')
      .eq('id', order_id)
      .maybeSingle();

    if (error || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // ─── CHECK STATUS ───
    if (!['manual_verification', 'failed', 'stars_received'].includes(order.status)) {
      return NextResponse.json({
        error: `Cannot process order in status: ${order.status}`,
      }, { status: 400 });
    }

    // ─── EXTRACT CARD NUMBER (from metadata) ───
    const cardLast4 = order.metadata?.cardLast4;
    if (!cardLast4) {
      return NextResponse.json({ error: 'Card number not found in metadata' }, { status: 400 });
    }

    // NOTE: In production, the full card number should be stored encrypted
    // For now, we need the full card from the original request
    // This endpoint is for manual admin processing only

    // ─── CREATE PAYOUT ───
    try {
      const payoutResult = await createPayout({
        amount: Number(order.rub_to_pay),
        cardNumber: order.metadata?.cardFull || '****' + cardLast4,
        description: `RuStars payout: ${order.stars_amount} Stars`,
        idempotencyKey: order.id,
      });

      // Update order
      await sb
        .from('payout_orders')
        .update({
          status: 'processing_payout',
          payout_id: payoutResult.id,
        })
        .eq('id', order.id);

      // Audit log
      await sb.from('payout_audit_log').insert({
        payout_order_id: order.id,
        action: 'admin_manual_process',
        details: {
          payoutId: payoutResult.id,
          adminNote: 'Manual admin processing',
        },
      });

      return NextResponse.json({
        ok: true,
        payoutId: payoutResult.id,
        status: payoutResult.status,
      });
    } catch (payoutErr) {
      const errorMsg = payoutErr instanceof Error ? payoutErr.message : String(payoutErr);

      await sb
        .from('payout_orders')
        .update({
          status: 'failed',
          error_message: errorMsg,
        })
        .eq('id', order.id);

      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }
  } catch (err) {
    console.error('[Payout Process] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
