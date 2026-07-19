import { NextResponse } from 'next/server';
import { TonClient, WalletContractV4 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { getSupabase } from '@/lib/supabase';

const TON_CENTER_ENDPOINT = 'https://toncenter.com';
const SAFE_TON_BALANCE = 3.0;
const ONEMOMENT_API = 'https://onemoment.cc/api/v1';

// ─── Настройки распределения прибыли ───
// Какую долю выручки конвертировать в TON (остальное — прибыль)
const REFILL_PERCENT = 0.70; // 70% идёт на закуп TON
// Минимальная сумма для обмена (чтобы не гонять мелочь)
const MIN_EXCHANGE_RUB = 500;
// Максимальная сумма за раз
const MAX_EXCHANGE_RUB = 10000;

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

// ─── Получение баланса TON-кошелька ───

async function getTonBalance(): Promise<number> {
  const mnemonic = process.env.MY_WALLET_MNEMONIC;
  if (!mnemonic) throw new Error('MY_WALLET_MNEMONIC not set');

  const words = mnemonic.trim().split(/\s+/);
  const keyPair = await mnemonicToPrivateKey(words);
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });

  const client = new TonClient({
    endpoint: TON_CENTER_ENDPOINT,
    apiKey: process.env.TONCENTER_API_KEY,
  });

  const balance = await client.getBalance(wallet.address);
  return Number(balance) / 1e9;
}

// ─── Проверка баланса ЮKassa ───

async function getYooKassaBalance(): Promise<number | null> {
  const auth = 'Basic ' +
    Buffer.from(`${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`).toString('base64');

  const res = await fetch('https://api.yookassa.ru/v3/shopAccounts', {
    headers: { Authorization: auth },
  });

  if (!res.ok) return null;
  const data = await res.json();
  const account = data.items?.[0];
  return account?.balance?.amount ? parseFloat(account.balance.amount) : null;
}

// ─── Создание заявки на обмен через OneMoment ───

async function createExchangeOrder(amountRub: number): Promise<{ id: string; status: string } | null> {
  const apiKey = process.env.ONEMOMENT_PARTNER_KEY;
  const walletAddress = process.env.MY_WALLET_ADDRESS;

  if (!apiKey || !walletAddress) {
    console.error('[Refill] Missing ONEMOMENT_PARTNER_KEY or MY_WALLET_ADDRESS');
    return null;
  }

  try {
    const res = await fetch(`${ONEMOMENT_API}/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: 'RUB',
        to: 'TON',
        amount_from: amountRub,
        address: walletAddress,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[Refill] OneMoment API error:', res.status, err);
      return null;
    }

    const data = await res.json();
    return { id: data.id || data.order_id, status: data.status || 'pending' };
  } catch (err) {
    console.error('[Refill] OneMoment fetch error:', err);
    return null;
  }
}

// ─── Логирование в Supabase ───

async function logRefill(orderId: string, amountRub: number, status: string) {
  try {
    const sb = getSupabase();
    await sb.from('tma_wallet_txns').insert({
      telegram_id: 0, // system
      kind: 'deposit',
      amount_rub: -amountRub,
      status: 'done',
      meta: {
        source: 'auto_refill',
        exchange_order_id: orderId,
        exchange_status: status,
        purpose: 'ton_wallet_refill',
      },
    });
  } catch (err) {
    console.error('[Refill] Log error:', err);
  }
}

// ─── GET /api/cron/refill-wallet ───

export async function GET(request: Request) {
  try {
    // Защита — только cron или ручной вызов с секретом
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Проверяем баланс TON
    let tonBalance: number;
    try {
      tonBalance = await getTonBalance();
    } catch (err) {
      console.error('[Refill] Cannot get TON balance:', err);
      return NextResponse.json({ error: 'Cannot check TON balance' }, { status: 500 });
    }

    console.log(`[Refill] TON balance: ${tonBalance.toFixed(4)}`);

    if (tonBalance >= SAFE_TON_BALANCE) {
      return NextResponse.json({ ok: true, tonBalance, action: 'none', reason: 'balance_ok' });
    }

    // 2. Баланс низкий — проверяем ЮKassa
    const yooKassaBalance = await getYooKassaBalance();
    console.log(`[Refill] YooKassa balance: ${yooKassaBalance}`);

    if (yooKassaBalance === null || yooKassaBalance < MIN_EXCHANGE_RUB) {
      await notifyAdmin(
        `ВНИМАНИЕ: Баланс TON-кошелька низкий (${tonBalance.toFixed(2)} TON)\n\n` +
        `ЮKassa баланс: ${yooKassaBalance !== null ? yooKassaBalance + ' ₽' : 'неизвестен'}\n` +
        `Недостаточно средств для автопополнения (минимум ${MIN_EXCHANGE_RUB} ₽)`,
      );
      return NextResponse.json({
        ok: true,
        tonBalance,
        yooKassaBalance,
        action: 'alert',
        reason: 'insufficient_yookassa_funds',
      });
    }

    // 3. Рассчитываем сумму для обмена (70% баланса, но не больше MAX)
    const refillAmount = Math.min(
      Math.floor(yooKassaBalance * REFILL_PERCENT),
      MAX_EXCHANGE_RUB,
    );

    if (refillAmount < MIN_EXCHANGE_RUB) {
      return NextResponse.json({ ok: true, tonBalance, action: 'none', reason: 'refill_too_small' });
    }

    const profitAmount = Math.floor(yooKassaBalance - refillAmount);

    // 4. Создаём заявку на обмен
    const exchangeOrder = await createExchangeOrder(refillAmount);

    if (!exchangeOrder) {
      await notifyAdmin(
        `ОШИБКА: Баланс TON низкий (${tonBalance.toFixed(2)} TON), ЮKassa OK (${yooKassaBalance} ₽)\n\n` +
        `Не удалось создать заявку на обмен через OneMoment!`,
      );
      return NextResponse.json({ ok: false, error: 'Exchange order failed' }, { status: 500 });
    }

    // 5. Логируем и уведомляем
    await logRefill(exchangeOrder.id, refillAmount, exchangeOrder.status);

    await notifyAdmin(
      `Баланс кошелька упал ниже ${SAFE_TON_BALANCE} TON (${tonBalance.toFixed(2)} TON).\n\n` +
      `Запущено автопополнение!\n` +
      `ЮKassa баланс: ${yooKassaBalance} ₽\n` +
      `На обмен: ${refillAmount} ₽ (70%)\n` +
      `Прибыль: ${profitAmount} ₽ (остаётся на счёте)\n\n` +
      `Заявка на обмен: #${exchangeOrder.id}\n` +
      `Ожидается зачисление TON на кошелёк`,
    );

    return NextResponse.json({
      ok: true,
      tonBalance,
      yooKassaBalance,
      action: 'refill_started',
      exchangeOrderId: exchangeOrder.id,
      amountRub: refillAmount,
      profitRub: profitAmount,
    });
  } catch (err) {
    console.error('[Refill] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
