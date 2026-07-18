import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

// ─── Telegram уведомление ───

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

// ─── Верификация: повторный запрос к ЮKassa ───

async function verifyYooKassaPayment(paymentId: string): Promise<{
  verified: boolean;
  status: string;
  orderId: string;
  starsAmount: number;
  telegramUsername: string;
  amountRub: number;
} | null> {
  const auth = 'Basic ' + Buffer.from(
    `${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`,
  ).toString('base64');

  const res = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
    headers: { Authorization: auth },
  });

  if (!res.ok) return null;

  const data = await res.json();

  return {
    verified: true,
    status: data.status,
    orderId: data.metadata?.orderId || '',
    starsAmount: parseInt(data.metadata?.stars_amount || '0', 10),
    telegramUsername: data.metadata?.telegram_username || '',
    amountRub: parseFloat(data.amount?.value || '0'),
  };
}

// ─── POST /api/webhooks/payment ───

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Игнорируем всё кроме payment.succeeded
    if (body.event !== 'payment.succeeded') {
      return NextResponse.json({ ok: true });
    }

    const paymentId: string = body.object?.id;
    if (!paymentId) {
      return NextResponse.json({ error: 'No payment id' }, { status: 400 });
    }

    // ─── Верификация ───

    const payment = await verifyYooKassaPayment(paymentId);
    if (!payment || payment.status !== 'succeeded') {
      return NextResponse.json({ ok: true });
    }

    const { orderId, starsAmount, telegramUsername, amountRub } = payment;

    if (!orderId || !starsAmount || !telegramUsername) {
      return NextResponse.json({ error: 'Bad metadata' }, { status: 400 });
    }

    // ─── Находим заказ ───

    const { data: order } = await getSupabase()
      .from('tma_stars_orders')
      .select('id, status')
      .eq('id', orderId)
      .single();

    if (!order || order.status !== 'pending') {
      return NextResponse.json({ ok: true });
    }

    // ─── pending → paid ───

    const { error } = await getSupabase()
      .from('tma_stars_orders')
      .update({ status: 'paid', payment_id: paymentId })
      .eq('id', orderId)
      .eq('status', 'pending');

    if (error) {
      console.error('[Webhook] Update error:', error);
      return NextResponse.json({ error: 'DB error' }, { status: 500 });
    }

    // ─── Уведомление в Telegram ───

    const fragmentLink = `https://fragment.com/${telegramUsername}`;

    await notifyAdmin(
      `🔥 ПОСТУПИЛА ОПЛАТА В ЮKASSA!\n` +
      `\n` +
      `📦 Заказ: #${orderId.slice(0, 8)}\n` +
      `👤 Клиент: @${telegramUsername}\n` +
      `⭐ Количество: ${starsAmount} звёзд\n` +
      `💰 Сумма: ${amountRub} руб.\n` +
      `\n` +
      `👉 Ссылка на быструю покупку (оплати через Tonkeeper):\n` +
      fragmentLink,
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Webhook] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
