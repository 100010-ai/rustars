/**
 * RuStars Worker — автовыдача звёзд/Premium через очередь доставки.
 *
 * Берёт задачи из tma_delivery_queue и выполняет:
 *   1. Получает инвойс Fragment
 *   2. Отправляет TON
 *   3. Обновляет статус заказа
 *   4. Уведомляет админа
 *
 * Circuit Breaker: аварийная остановка при превышении
 * 25 TON за 15 минут.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  claimNextJob,
  markJobDone,
  markJobFailed,
  getFragmentInvoice,
  getFragmentPremiumInvoice,
  type DeliveryJob,
} from '../lib/delivery';
import { sendTonWithPayload, hasEnoughBalance } from '../lib/ton-wallet';

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
  maxTon: 25,
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
      `Проверьте кошелёк и вручную обработайте зависшие заказы.`,
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

async function notifyUser(tgId: number, text: string) {
  const token = process.env.ADMIN_BOT_TOKEN || process.env.TELEGRAM_MINIAPP_BOT_TOKEN;
  if (!token || !tgId) return;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: tgId, text }),
  }).catch(() => {});
}

// ─── Обработка задачи ───

async function processJob(job: DeliveryJob) {
  if (!isSystemActive) {
    console.log(`[Worker] System halted. Skipping job for order ${job.orderId}`);
    return;
  }

  console.log(`[Worker] Processing: order=${job.orderId} user=@${job.username} type=${job.productType} attempt=${job.attempt}`);

  const sb = getSupabase();

  // Помечаем заказ как processing
  await sb
    .from('tma_stars_orders')
    .update({ status: 'processing' })
    .eq('id', job.orderId);

  // 1. Получаем инвойс Fragment
  let invoice;
  try {
    if (job.productType === 'premium' && job.premiumDuration) {
      invoice = await getFragmentPremiumInvoice(job.username, job.premiumDuration);
    } else {
      invoice = await getFragmentInvoice(job.username, job.starsCount);
    }
    console.log(`[Worker] Invoice: ${invoice.address} / ${invoice.amountTon} TON`);
  } catch (err) {
    const errorMsg = `Fragment error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[Worker] ${errorMsg}`);

    await markJobFailed(job.orderId, errorMsg);
    await sb
      .from('tma_stars_orders')
      .update({ status: 'error_fragment', error_message: errorMsg })
      .eq('id', job.orderId);

    await notifyAdmin(
      `🚨 <b>Ошибка Fragment</b>\n` +
      `Заказ: ${job.orderId}\n` +
      `@${job.username}\n` +
      `Ошибка: ${errorMsg}` +
      (job.attempt < job.maxAttempts ? `\nПопытка ${job.attempt}/${job.maxAttempts}` : '\nИсчерпаны все попытки'),
    );
    return;
  }

  // 2. Circuit Breaker
  const amountTon = parseFloat(invoice.amountTon);
  if (!checkCircuitBreaker(amountTon)) {
    await markJobFailed(job.orderId, 'Circuit breaker: TON limit exceeded');
    await sb
      .from('tma_stars_orders')
      .update({ status: 'blocked', error_message: 'Circuit breaker active' })
      .eq('id', job.orderId);
    return;
  }

  // 3. Проверяем баланс
  const hasBalance = await hasEnoughBalance(invoice.amountTon);
  if (!hasBalance) {
    await markJobFailed(job.orderId, `Insufficient TON: need ${invoice.amountTon}`);
    await sb
      .from('tma_stars_orders')
      .update({ status: 'error_balance', error_message: `Insufficient TON: need ${invoice.amountTon}` })
      .eq('id', job.orderId);

    await notifyAdmin(
      `💸 <b>НЕХВАТКА СРЕДСТВ</b>\n` +
      `Заказ: ${job.orderId}\n` +
      `@${job.username}\n` +
      `Нужно: ${invoice.amountTon} TON\n\n` +
      `⚠️ Пополните кошелёк!`,
    );
    return;
  }

  // 4. Отправляем TON
  let txHash: string;
  try {
    txHash = await sendTonWithPayload(invoice.address, invoice.amountTon, invoice.payload);
  } catch (txErr) {
    const errorMsg = `TON send error: ${txErr instanceof Error ? txErr.message : String(txErr)}`;
    console.error(`[Worker] ${errorMsg}`);

    await markJobFailed(job.orderId, errorMsg);
    await sb
      .from('tma_stars_orders')
      .update({ status: 'error_ton', error_message: errorMsg })
      .eq('id', job.orderId);

    await notifyAdmin(
      `🚨 <b>Ошибка отправки TON</b>\n` +
      `Заказ: ${job.orderId}\n` +
      `@${job.username}\n` +
      `Адрес: ${invoice.address}\n` +
      `Сумма: ${invoice.amountTon} TON\n` +
      `Ошибка: ${errorMsg}`,
    );
    return;
  }

  // 5. Успешно
  trackTx(amountTon);
  await markJobDone(job.orderId);

  await sb
    .from('tma_stars_orders')
    .update({ status: 'completed', tx_hash: txHash })
    .eq('id', job.orderId);

  const remaining = CIRCUIT_BREAKER.maxTon - getTotalTonInWindow();
  const label = job.productType === 'premium' ? `Premium ${job.premiumDuration}` : `${job.starsCount} ⭐`;

  await notifyAdmin(
    `✅ <b>Выполнено</b>\n` +
    `Заказ: ${job.orderId}\n` +
    `@${job.username} — ${label}\n` +
    `TX: ${txHash}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `💰 ${getTotalTonInWindow().toFixed(2)}/${CIRCUIT_BREAKER.maxTon} TON за 15мин`,
  );

  // Уведомляем пользователя
  const { data: orderData } = await sb
    .from('tma_stars_orders')
    .select('telegram_id')
    .eq('id', job.orderId)
    .single();

  if (orderData?.telegram_id) {
    await notifyUser(orderData.telegram_id, `Ваш заказ #${job.orderId.slice(0, 8)} выполнен! ${label} доставлен.`);
  }

  console.log(`[Worker] Completed: ${job.orderId} TX: ${txHash}`);
}

// ─── Polling loop ───

const POLL_INTERVAL_MS = 5000; // 5 секунд

async function pollLoop() {
  console.log('[Worker] Polling for delivery jobs...');

  while (true) {
    try {
      const job = await claimNextJob();
      if (job) {
        await processJob(job);
      }
    } catch (err) {
      console.error('[Worker] Poll error:', err);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

// ─── Graceful shutdown ───

process.on('SIGINT', async () => {
  console.log('[Worker] Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Worker] Shutting down...');
  process.exit(0);
});

// ─── Запуск ───

console.log('[Worker] RuStars delivery worker starting...');
console.log(`[Worker] Circuit breaker: ${CIRCUIT_BREAKER.maxTon} TON per ${CIRCUIT_BREAKER.windowMs / 60000} min`);
console.log(`[Worker] Poll interval: ${POLL_INTERVAL_MS}ms`);
pollLoop();
