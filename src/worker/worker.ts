/**
 * RuStars Worker — автовыдача звёзд через Fragment.
 *
 * Слушает Supabase Realtime на таблицу tma_stars_orders.
 * При получении заказа со статусом 'paid' выполняет:
 *   1. Покупку звёзд на Fragment (Puppeteer-Extra + Stealth)
 *   2. Отправку TON через Crypto Bot API
 *   3. Обновление статуса заказа
 *   4. Уведомление в админ-чат при ошибке
 *
 * Circuit Breaker: аварийная остановка при превышении
 * 25 TON за 15 минут.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buyStarsOnFragment, closeBrowser } from './fragment';
import { sendTonViaShuttle, getCryptoBotBalance } from '../lib/crypto-shuttle';

// ─── Конфиг ───

let supabase: SupabaseClient;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return supabase;
}

const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN!;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID!;

// ─── Circuit Breaker ───

const CIRCUIT_BREAKER = {
  /** Максимальная сумма TON за окно */
  maxTon: 25,
  /** Окно трекинга (15 минут) */
  windowMs: 15 * 60 * 1000,
};

interface TxRecord {
  amountTon: number;
  timestamp: number;
}

let isSystemActive = true;
const txHistory: TxRecord[] = [];

function trackTx(amountTon: number) {
  txHistory.push({ amountTon, timestamp: Date.now() });
}

function cleanupOldTxs() {
  const cutoff = Date.now() - CIRCUIT_BREAKER.windowMs;
  while (txHistory.length > 0 && txHistory[0].timestamp < cutoff) {
    txHistory.shift();
  }
}

function getTotalTonInWindow(): number {
  cleanupOldTxs();
  return txHistory.reduce((sum, tx) => sum + tx.amountTon, 0);
}

function checkCircuitBreaker(amountTon: number): boolean {
  if (!isSystemActive) return false;

  const currentTotal = getTotalTonInWindow();
  const newTotal = currentTotal + amountTon;

  if (newTotal > CIRCUIT_BREAKER.maxTon) {
    isSystemActive = false;

    notifyAdmin(
      `🛑 <b>CIRCUIT BREAKER — СИСТЕМА ОСТАНОВЛЕНА</b>\n\n` +
      `Причина: расход ${newTotal.toFixed(2)} TON за 15 минут\n` +
      `Лимит: ${CIRCUIT_BREAKER.maxTon} TON\n\n` +
      `Все новые заказы будут отложены.\n` +
      `Проверьте кошелёк и вручную обработайте зависшие заказы.\n\n` +
      `Для возобновления: перезапустите воркер.`,
    );

    return false;
  }

  return true;
}

// ─── Уведомления ───

async function notifyAdmin(message: string) {
  if (!ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID) return;

  try {
    await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      }),
    });
  } catch (err) {
    console.error('Failed to send admin notification:', err);
  }
}

// ─── Обработка одного заказа ───

interface Order {
  id: string;
  telegram_id: number;
  username: string | null;
  stars_count: number;
  amount_rub: number;
  status: string;
  created_at: string;
}

async function processOrder(order: Order) {
  // ─── Circuit Breaker: проверяем перед стартом ───
  if (!isSystemActive) {
    console.log(`[Worker] System halted by circuit breaker. Skipping order ${order.id}`);

    await getSupabase()
      .from('tma_stars_orders')
      .update({ status: 'blocked', error_message: 'Circuit breaker active' })
      .eq('id', order.id);

    await notifyAdmin(
      `⏸ <b>Заказ отложен (circuit breaker)</b>\n` +
      `ID: ${order.id}\n` +
      `@${order.username}\n` +
      `${order.stars_count} ⭐`,
    );
    return;
  }

  console.log(`[Worker] Processing order ${order.id}: ${order.stars_count} stars for @${order.username}`);

  // 1. Покупка звёзд на Fragment
  let invoice;
  try {
    invoice = await buyStarsOnFragment(order.username!, order.stars_count);
    console.log(`[Worker] Fragment invoice: ${invoice.address} / ${invoice.amountTon} TON`);
  } catch (err) {
    const errorMsg = `Fragment error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[Worker] ${errorMsg}`);

    await getSupabase()
      .from('tma_stars_orders')
      .update({ status: 'error_fragment', error_message: errorMsg })
      .eq('id', order.id);

    await notifyAdmin(
      `🚨 <b>Ошибка Fragment</b>\n` +
      `Заказ: ${order.id}\n` +
      `@${order.username}\n` +
      `${order.stars_count} ⭐\n` +
      `Ошибка: ${errorMsg}`,
    );
    return;
  }

  // 2. Circuit Breaker: проверяем перед отправкой TON
  const amountTon = parseFloat(invoice.amountTon);
  if (!checkCircuitBreaker(amountTon)) {
    await getSupabase()
      .from('tma_stars_orders')
      .update({ status: 'blocked', error_message: 'Circuit breaker: TON limit exceeded' })
      .eq('id', order.id);

    console.log(`[Worker] Circuit breaker triggered. Order ${order.id} blocked.`);
    return;
  }

  // 3. Отправка TON через Crypto Bot API
  const txResult = await sendTonViaShuttle({
    toAddress: invoice.address,
    amountTon: invoice.amountTon,
    comment: `@${order.username || 'unknown'}`,
    idempotencyKey: `rustars-${order.id}`,
  });

  if (!txResult.success) {
    const errorMsg = `Crypto Bot error: ${txResult.errorCode} - ${txResult.error}`;
    console.error(`[Worker] ${errorMsg}`);

    const isBalanceError =
      txResult.errorCode === 'INSUFFICIENT_FUNDS' ||
      txResult.errorCode === 'NOT_ENOUGH_FUNDS' ||
      (txResult.error || '').toLowerCase().includes('insufficient');

    await getSupabase()
      .from('tma_stars_orders')
      .update({
        status: isBalanceError ? 'error_balance' : 'error_ton',
        error_message: errorMsg,
      })
      .eq('id', order.id);

    await notifyAdmin(
      `${isBalanceError ? '💸' : '🚨'} <b>${isBalanceError ? 'НЕХВАТКА СРЕДСТВ' : 'Ошибка TON'}</b>\n` +
      `Заказ: ${order.id}\n` +
      `@${order.username}\n` +
      `${order.stars_count} ⭐\n` +
      `Адрес: ${invoice.address}\n` +
      `Сумма: ${invoice.amountTon} TON\n` +
      `Ошибка: ${txResult.error}\n\n` +
      (isBalanceError
        ? '⚠️ Пополните баланс @CryptoBot!'
        : '⚡ Требуется ручная отправка!'),
    );
    return;
  }

  // 4. Успешно — трекаем и обновляем статус
  trackTx(amountTon);

  await getSupabase()
    .from('tma_stars_orders')
    .update({ status: 'completed', tx_hash: txResult.txHash })
    .eq('id', order.id);

  const remaining = CIRCUIT_BREAKER.maxTon - getTotalTonInWindow();
  const balance = await getCryptoBotBalance();

  await notifyAdmin(
    `✅ <b>Звёзды выданы</b>\n` +
    `Заказ: ${order.id}\n` +
    `@${order.username}\n` +
    `${order.stars_count} ⭐\n` +
    `TX: ${txResult.txHash}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `💰 Расход за 15мин: ${getTotalTonInWindow().toFixed(2)}/${CIRCUIT_BREAKER.maxTon} TON\n` +
    `Остаток лимита: ${remaining.toFixed(2)} TON\n` +
    (balance
      ? `🏦 Баланс Crypto Bot: ${balance.ton.toFixed(2)} TON / ${balance.usd.toFixed(2)} USDT`
      : ''),
  );

  console.log(`[Worker] Order ${order.id} completed. TX: ${txResult.txHash}`);
}

// ─── Supabase Realtime ───

function subscribeToPaidOrders() {
  console.log('[Worker] Subscribing to tma_stars_orders (status=paid)...');

  const channel = getSupabase()
    .channel('worker-paid-orders')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'tma_stars_orders',
        filter: 'status=eq.paid',
      },
      async (payload) => {
        const order = payload.new as Order;
        console.log(`[Worker] Got paid order: ${order.id}`);
        await processOrder(order);
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'tma_stars_orders',
        filter: 'status=eq.paid',
      },
      async (payload) => {
        const order = payload.new as Order;
        console.log(`[Worker] Got new paid order: ${order.id}`);
        await processOrder(order);
      },
    )
    .subscribe((status) => {
      console.log(`[Worker] Subscription status: ${status}`);
    });

  return channel;
}

// ─── Очистка при завершении ───

process.on('SIGINT', async () => {
  console.log('[Worker] Shutting down...');
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Worker] Shutting down...');
  await closeBrowser();
  process.exit(0);
});

// ─── Запуск ───

console.log('[Worker] RuStars worker starting...');
console.log(`[Worker] Circuit breaker: ${CIRCUIT_BREAKER.maxTon} TON per ${CIRCUIT_BREAKER.windowMs / 60000} min`);
subscribeToPaidOrders();
console.log('[Worker] Listening for paid orders...');
