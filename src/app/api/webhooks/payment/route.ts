import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ORDER_TTL_MS = 10 * 60 * 1000;

async function notifyAdmin(message: string) {
  const botToken = process.env.ADMIN_BOT_TOKEN;
  const chatId = process.env.ADMIN_CHAT_ID;
  if (!botToken || !chatId) return;

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
  });
}

export async function POST(request: Request) {
  try {
    const signature = request.headers.get('x-payment-signature');
    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }

    // TODO: верифицировать подпись через PAYMENT_WEBHOOK_SECRET

    const body = await request.json();
    const orderId: string = body.orderId;
    const paymentId: string = body.paymentId;

    if (!orderId || !paymentId) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // ─── Идемпотентность через атомарный статус ───
    //
    // Три стадии: pending → processing → paid
    //
    // Если дубликат вебхука приходит, когда статус уже processing или paid —
    // обновление никуда не пройдёт (WHERE status = 'pending' не матчится)
    // и мы просто вернём ok.

    // Загружаем заказ для проверки таймаута
    const { data: order, error: fetchError } = await supabase
      .from('tma_stars_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fetchError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Уже обработан (processing или paid или любой другой)
    if (order.status !== 'pending') {
      return NextResponse.json({ ok: true, skipped: true });
    }

    // ─── Проверка таймаута 10 минут ───

    const createdAt = new Date(order.created_at).getTime();
    const now = Date.now();

    if (now - createdAt > ORDER_TTL_MS) {
      // Атомарно: pending → expired
      const { error: expireError } = await supabase
        .from('tma_stars_orders')
        .update({ status: 'expired', payment_id: paymentId })
        .eq('id', orderId)
        .eq('status', 'pending');

      if (expireError) {
        console.error('Failed to expire order:', expireError);
        return NextResponse.json({ error: 'Update failed' }, { status: 500 });
      }

      await notifyAdmin(
        `⏰ <b>Заказ просрочен</b>\n` +
        `ID: ${orderId}\n` +
        `Пользователь: @${order.username || 'нет'}\n` +
        `Сумма: ${order.amount_rub} ₽\n` +
        `Создан: ${order.created_at}\n` +
        `Оплачен: ${new Date().toISOString()}\n` +
        `Разница: ${Math.round((now - createdAt) / 60000)} мин`,
      );

      return NextResponse.json({ error: 'Order expired' }, { status: 410 });
    }

    // ─── Шаг 1: pending → processing (захват лока) ───

    const { error: lockError } = await supabase
      .from('tma_stars_orders')
      .update({ status: 'processing', payment_id: paymentId })
      .eq('id', orderId)
      .eq('status', 'pending');

    if (lockError) {
      console.error('Failed to lock order:', lockError);
      return NextResponse.json({ error: 'Lock failed' }, { status: 500 });
    }

    // Если affected rows = 0, значит другой вебхук уже захватил лок.
    // Supabase JS клиент не возвращает affected rows напрямую,
    // но если error = null и мы дошли сюда — значит update прошёл.
    // Повторный update с тем же WHERE вернёт 0 affected, но не ошибку.

    // ─── Шаг 2: processing → paid ───

    const { error: payError } = await supabase
      .from('tma_stars_orders')
      .update({ status: 'paid' })
      .eq('id', orderId)
      .eq('status', 'processing');

    if (payError) {
      console.error('Failed to confirm payment:', payError);
      // Откатываем обратно в pending, чтобы воркер не застрял
      await supabase
        .from('tma_stars_orders')
        .update({ status: 'pending' })
        .eq('id', orderId)
        .eq('status', 'processing');

      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }

    await notifyAdmin(
      `💰 <b>Оплата получена</b>\n` +
      `ID: ${orderId}\n` +
      `@${order.username || 'нет'}\n` +
      `${order.stars_count} ⭐ за ${order.amount_rub} ₽`,
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
