/**
 * GET /api/payout/status?id=xxx — проверка статуса заявки на скупку.
 */

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { resolveTelegramUser } from '@/lib/telegram';

export async function GET(request: Request) {
  try {
    // Auth
    const initData = request.headers.get('x-telegram-init-data');
    const resolved = resolveTelegramUser(initData, null, true);
    if (!resolved) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('id');

    if (!orderId) {
      return NextResponse.json({ error: 'Missing order id' }, { status: 400 });
    }

    const sb = getSupabase();

    const { data: order, error } = await sb
      .from('payout_orders')
      .select('id, stars_amount, rub_to_pay, card_number_masked, status, created_at, updated_at, error_message')
      .eq('id', orderId)
      .eq('user_id', resolved.id)
      .maybeSingle();

    if (error || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: order.id,
      starsAmount: order.stars_amount,
      rubToPay: order.rub_to_pay,
      cardMasked: order.card_number_masked,
      status: order.status,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      error: order.error_message,
    });
  } catch (err) {
    console.error('[Payout Status] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
