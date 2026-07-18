import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

const ORDER_TTL_MS = 10 * 60 * 1000;
const FRAGMENT_API = 'https://fragment.com/api/v1';
const CRYPTOBOT_API = 'https://api.crypt.bot/api/v1';

// ─── Уведомления ───

async function notifyAdmin(message: string) {
  const botToken = process.env.ADMIN_BOT_TOKEN;
  const chatId = process.env.ADMIN_CHAT_ID;
  if (!botToken || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
  } catch (err) {
    console.error('[Webhook] Admin notify failed:', err);
  }
}

// ─── Шаг 2: Запрос инвойса у Fragment ───

interface FragmentInvoice {
  ton_address: string;
  amount_ton: string;
  payload: string;
}

async function requestFragmentInvoice(
  username: string,
  starsCount: number,
): Promise<FragmentInvoice> {
  const fragmentToken = process.env.FRAGMENT_SESSION_TOKEN;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (fragmentToken) {
    headers['Authorization'] = `Bearer ${fragmentToken}`;
  }

  const res = await fetch(`${FRAGMENT_API}/stars/buy`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      username,
      stars_count: starsCount,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `Fragment API ${res.status}: ${err.message || err.error || JSON.stringify(err)}`,
    );
  }

  const data = await res.json();

  if (!data.ton_address || !data.amount_ton) {
    throw new Error('Fragment response missing ton_address or amount_ton');
  }

  return {
    ton_address: data.ton_address,
    amount_ton: String(data.amount_ton),
    payload: data.payload || '',
  };
}

// ─── Шаг 3: Отправка TON через @CryptoBot ───

interface CryptoBotResponse {
  ok: boolean;
  result?: {
    bill_id: string;
    status: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

async function sendTonViaCryptoBot(
  targetAddress: string,
  amountTon: string,
  comment: string,
): Promise<{ success: boolean; billId?: string; error?: string; errorCode?: string }> {
  const apiKey = process.env.CRYPTO_SHUTTLE_API_KEY;

  if (!apiKey) {
    return { success: false, error: 'CRYPTO_SHUTTLE_API_KEY not configured', errorCode: 'CONFIG' };
  }

  const params = new URLSearchParams({
    asset: 'TON',
    amount: amountTon,
    address: targetAddress,
    comment,
  });

  const res = await fetch(`${CRYPTOBOT_API}/transfer?${params}`, {
    method: 'GET',
    headers: {
      'Crypto-Pay-API-Token': apiKey,
    },
  });

  const data: CryptoBotResponse = await res.json();

  if (!data.ok) {
    return {
      success: false,
      error: data.error?.message || 'Unknown Crypto Bot error',
      errorCode: data.error?.code || 'UNKNOWN',
    };
  }

  return {
    success: true,
    billId: data.result?.bill_id,
  };
}

// ─── POST /api/webhooks/payment ───

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Игнорируем всё кроме payment.succeeded
    if (body.event !== 'payment.succeeded') {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const yooPayment = body.object;
    if (!yooPayment?.id) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // ─── Верификация: повторный запрос к ЮKassa ───

    const yooAuth = 'Basic ' + Buffer.from(
      `${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`,
    ).toString('base64');

    const verifyRes = await fetch(
      `https://api.yookassa.ru/v3/payments/${yooPayment.id}`,
      { headers: { Authorization: yooAuth } },
    );

    if (!verifyRes.ok) {
      console.error('[Webhook] YooKassa verification failed:', verifyRes.status);
      return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
    }

    const verified = await verifyRes.json();
    if (verified.status !== 'succeeded') {
      return NextResponse.json({ ok: true, skipped: true });
    }

    // ─── Извлекаем данные из метаданных ───

    const orderId = verified.metadata?.orderId;
    const starsAmount = parseInt(verified.metadata?.stars_amount || '0', 10);
    const telegramUsername = verified.metadata?.telegram_username || '';

    if (!orderId) {
      console.error('[Webhook] No orderId in metadata');
      return NextResponse.json({ error: 'No orderId' }, { status: 400 });
    }

    if (!starsAmount || starsAmount < 1) {
      console.error('[Webhook] Invalid stars_amount:', starsAmount);
      return NextResponse.json({ error: 'Invalid stars_amount' }, { status: 400 });
    }

    if (!telegramUsername) {
      console.error('[Webhook] No telegram_username in metadata');
      return NextResponse.json({ error: 'No username' }, { status: 400 });
    }

    // ─── Находим заказ ───

    const { data: order, error: fetchError } = await getSupabase()
      .from('tma_stars_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fetchError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (order.status !== 'pending') {
      return NextResponse.json({ ok: true, skipped: true });
    }

    // ─── Проверка таймаута ───

    const createdAt = new Date(order.created_at).getTime();
    if (Date.now() - createdAt > ORDER_TTL_MS) {
      await getSupabase()
        .from('tma_stars_orders')
        .update({ status: 'expired', payment_id: yooPayment.id })
        .eq('id', orderId)
        .eq('status', 'pending');

      await notifyAdmin(
        `⏰ Заказ просрочен\nID: ${orderId}\n@${telegramUsername} · ${starsAmount} ⭐`,
      );

      return NextResponse.json({ error: 'Expired' }, { status: 410 });
    }

    // ─── Атомарный захват: pending → processing ───

    const { error: lockError } = await getSupabase()
      .from('tma_stars_orders')
      .update({ status: 'processing', payment_id: yooPayment.id })
      .eq('id', orderId)
      .eq('status', 'pending');

    if (lockError) {
      console.error('[Webhook] Lock failed:', lockError);
      return NextResponse.json({ error: 'Lock failed' }, { status: 500 });
    }

    // ─── Шаг 2: Запрос инвойса у Fragment ───

    let fragmentInvoice: FragmentInvoice;
    try {
      fragmentInvoice = await requestFragmentInvoice(telegramUsername, starsAmount);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Webhook] Fragment error: ${errorMsg}`);

      await getSupabase()
        .from('tma_stars_orders')
        .update({ status: 'error_fragment', error_message: errorMsg })
        .eq('id', orderId);

      await notifyAdmin(
        `🚨 Ошибка Fragment\nЗаказ: ${orderId}\n@${telegramUsername}\n${starsAmount} ⭐\nОшибка: ${errorMsg}`,
      );

      return NextResponse.json({ error: 'Fragment failed' }, { status: 500 });
    }

    // ─── Шаг 3: Отправка TON через @CryptoBot ───

    const txResult = await sendTonViaCryptoBot(
      fragmentInvoice.ton_address,
      fragmentInvoice.amount_ton,
      fragmentInvoice.payload,
    );

    if (!txResult.success) {
      const isBalanceError =
        txResult.errorCode === 'INSUFFICIENT_FUNDS' ||
        txResult.errorCode === 'NOT_ENOUGH_FUNDS' ||
        (txResult.error || '').toLowerCase().includes('insufficient') ||
        (txResult.error || '').toLowerCase().includes('not enough');

      const status = isBalanceError ? 'error_balance' : 'error_ton';

      await getSupabase()
        .from('tma_stars_orders')
        .update({ status, error_message: `${txResult.errorCode}: ${txResult.error}` })
        .eq('id', orderId);

      const emoji = isBalanceError ? '💸' : '🚨';
      const title = isBalanceError ? 'НЕХВАТКА TON НА @CryptoBot' : 'Ошибка TON-транзакции';

      await notifyAdmin(
        `${emoji} ${title}\n\n` +
        `Заказ: ${orderId}\n` +
        `@${telegramUsername}\n` +
        `${starsAmount} ⭐\n\n` +
        `Адрес Fragment: ${fragmentInvoice.ton_address}\n` +
        `Сумма: ${fragmentInvoice.amount_ton} TON\n\n` +
        `Код: ${txResult.errorCode}\n` +
        `Ошибка: ${txResult.error}\n\n` +
        (isBalanceError
          ? '⚠️ Пополните баланс @CryptoBot и обработайте вручную!'
          : '⚡ Проверьте статус транзакции.'),
      );

      return NextResponse.json({ error: 'Crypto Bot send failed' }, { status: 500 });
    }

    // ─── Шаг 4: Успешно — processing → completed ───

    const { error: completeError } = await getSupabase()
      .from('tma_stars_orders')
      .update({
        status: 'completed',
        tx_hash: txResult.billId || `cb-${Date.now()}`,
      })
      .eq('id', orderId)
      .eq('status', 'processing');

    if (completeError) {
      console.error('[Webhook] Complete failed:', completeError);
      await notifyAdmin(
        `🔴 КРИТИЧЕСКАЯ ОШИБКА\nTON отправлен, статус не обновлён!\nЗаказ: ${orderId}\nBill: ${txResult.billId}`,
      );
      return NextResponse.json({ error: 'Status update failed' }, { status: 500 });
    }

    await notifyAdmin(
      `✅ Звёзды выданы\n\n` +
      `Заказ: ${orderId}\n` +
      `@${telegramUsername}\n` +
      `${starsAmount} ⭐\n\n` +
      `Fragment: ${fragmentInvoice.ton_address}\n` +
      `Сумма: ${fragmentInvoice.amount_ton} TON\n` +
      `Crypto Bot bill: ${txResult.billId}`,
    );

    return NextResponse.json({ ok: true, billId: txResult.billId });
  } catch (err) {
    console.error('[Webhook] Fatal error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
