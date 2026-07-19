import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

const BOT_TOKEN = process.env.ADMIN_BOT_TOKEN || process.env.TELEGRAM_MINIAPP_BOT_TOKEN;

// POST /api/orders/complete { orderId }
// Admin marks order as completed, bot asks buyer for review
export async function POST(request: Request) {
  try {
    // Admin-only: проверяем секретный токен
    const authHeader = request.headers.get('authorization');
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { orderId } = await request.json();
    if (!orderId) {
      return NextResponse.json({ error: 'Missing orderId' }, { status: 400 });
    }

    const sb = getSupabase();

    // Fetch order
    const { data: order, error: fetchErr } = await sb
      .from('tma_stars_orders')
      .select('id, telegram_id, username, stars_count, amount_rub, status')
      .eq('id', orderId)
      .single();

    if (fetchErr || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (order.status !== 'paid') {
      return NextResponse.json({ error: 'Order is not in paid status' }, { status: 400 });
    }

    // Mark as completed
    const { error: updErr } = await sb
      .from('tma_stars_orders')
      .update({ status: 'completed' })
      .eq('id', orderId)
      .eq('status', 'paid');

    if (updErr) {
      console.error('[Complete] update error:', updErr);
      return NextResponse.json({ error: 'DB error' }, { status: 500 });
    }

    // Set waiting for feedback
    await sb.from('tma_waiting_feedback').upsert(
      { telegram_id: order.telegram_id, order_id: orderId, waiting: true },
      { onConflict: 'telegram_id' },
    );

    // Send review request message to buyer
    if (BOT_TOKEN && order.telegram_id) {
      const shortId = orderId.slice(0, 8);
      const text =
        `Ваш заказ #${shortId} успешно выполнен!\n\n` +
        `Пожалуйста, оставьте короткий отзыв в ответном сообщении — это очень поможет развитию проекта.\n\n` +
        `За каждый оставленный отзыв мы дарим +3 рубля на ваш внутренний рублёвый баланс в приложении!`;

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: order.telegram_id,
          text,
          parse_mode: 'HTML',
        }),
      }).catch((e) => console.error('[Complete] sendMessage error:', e));
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Complete] error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
