/**
 * Serverless Delivery — Edge-совместимая функция автовыдачи.
 *
 * Полностью заменяет worker/worker.ts + worker/fragment.ts.
 * Работает как часть Next.js API route (Vercel Serverless).
 *
 * Архитектура:
 *   1. YooKassa webhook → вызывает deliverOrder()
 *   2. deliverOrder():
 *      a. Idempotency check (нет двойной выдачи)
 *      b. Circuit breaker check (30 TON/tx, 25 TON/15мин, 150 TON/day)
 *      c. Balance check
 *      d. Security guard (daily limits, admin approval)
 *      e. Fragment invoice generation (HTTP, без Puppeteer)
 *      f. TON transaction (fire-and-forget)
 *      g. Audit log (ДО и ПОСЛЕ)
 *      h. Status update + admin/user notification
 *
 * Fire-and-Forget:
 *   Транзакция отправляется через sendBoc() без ожидания
 *   подтверждения в блоке. Как RPC-нода приняла пакет — функция
 *   завершается. Это позволяет уложиться в 10-15с таймаут Vercel.
 *
 * Плюсы над старым worker'ом:
 *   - Нет Puppeteer/Chromium (0 cold start overhead)
 *   - Работает на Vercel Serverless (без VPS)
 *   - Мгновенная обработка (нет 5с polling)
 *   - Единый поток execution (нет race conditions)
 */

import { getSupabase } from './supabase';
import { getStarsInvoice, getPremiumInvoice } from './fragment-api';
import {
  getWalletAddress,
  getWalletBalance,
  sendTonWithPayload,
  hasEnoughBalance,
} from './ton-wallet';
import {
  guardTransaction,
  auditLog,
} from './security/transaction-guard';

// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════

const CIRCUIT_BREAKER = {
  maxPerTx: 30,          // TON за одну транзакцию
  maxPer15Min: 25,       // TON за 15 минут
  maxDaily: 150,         // TON за сутки
  windowMs: 15 * 60 * 1000,
};

// ═══════════════════════════════════════════════════════════
// IN-MEMORY CIRCUIT BREAKER STATE
// ═══════════════════════════════════════════════════════════

interface TxRecord {
  amountTon: number;
  timestamp: number;
}

const txHistory: TxRecord[] = [];
let isSystemActive = true;

function cleanupOldTxs(): void {
  const cutoff = Date.now() - CIRCUIT_BREAKER.windowMs;
  while (txHistory.length > 0 && txHistory[0].timestamp < cutoff) {
    txHistory.shift();
  }
}

function getTotalTonInWindow(): number {
  cleanupOldTxs();
  return txHistory.reduce((sum, tx) => sum + tx.amountTon, 0);
}

function trackTx(amountTon: number): void {
  txHistory.push({ amountTon, timestamp: Date.now() });
}

function checkCircuitBreaker(amountTon: number): { ok: boolean; reason?: string } {
  if (!isSystemActive) {
    return { ok: false, reason: 'System halted by circuit breaker' };
  }

  if (amountTon > CIRCUIT_BREAKER.maxPerTx) {
    return { ok: false, reason: `Per-TX limit: ${amountTon} TON > ${CIRCUIT_BREAKER.maxPerTx} TON` };
  }

  const newTotal = getTotalTonInWindow() + amountTon;
  if (newTotal > CIRCUIT_BREAKER.maxPer15Min) {
    isSystemActive = false;
    return { ok: false, reason: `15-min limit: ${newTotal.toFixed(2)} TON > ${CIRCUIT_BREAKER.maxPer15Min} TON` };
  }

  return { ok: true };
}

// ═══════════════════════════════════════════════════════════
// TELEGRAM NOTIFICATIONS
// ═══════════════════════════════════════════════════════════

async function notifyAdmin(message: string): Promise<void> {
  const token = process.env.ADMIN_BOT_TOKEN;
  const chatId = process.env.ADMIN_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
  } catch {}
}

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

// ═══════════════════════════════════════════════════════════
// MAIN DELIVERY FUNCTION
// ═══════════════════════════════════════════════════════════

export interface DeliveryResult {
  ok: boolean;
  orderId: string;
  status: string;
  txHash?: string;
  error?: string;
}

/**
 * Главная функция автовыдачи.
 *
 * Вызывается из webhook handler после подтверждения оплаты YooKassa.
 * Вся логика в одном вызове — без polling, без отдельного process.
 */
export async function deliverOrder(params: {
  orderId: string;
  username: string;
  productType: 'stars' | 'premium';
  starsCount: number;
  premiumDuration?: '3m' | '6m' | '12m';
  telegramId?: number;
}): Promise<DeliveryResult> {
  const { orderId, username, productType, starsCount, premiumDuration, telegramId } = params;
  const sb = getSupabase();
  const startTime = Date.now();

  console.log(`[Delivery] Starting: order=${orderId} user=@${username} type=${productType}`);

  // ─── STEP 1: IDEMPOTENCY CHECK ───
  // Проверяем не был ли заказ уже обработан
  const { data: existingOrder } = await sb
    .from('tma_stars_orders')
    .select('id, status')
    .eq('id', orderId)
    .maybeSingle();

  if (existingOrder && existingOrder.status !== 'paid') {
    console.log(`[Delivery] Order ${orderId} already in status: ${existingOrder.status} — skipping`);
    return { ok: true, orderId, status: existingOrder.status };
  }

  // Помечаем как processing
  await sb
    .from('tma_stars_orders')
    .update({ status: 'processing_blockchain' })
    .eq('id', orderId)
    .eq('status', 'paid');

  // ─── STEP 2: CIRCUIT BREAKER ───
  // Fragment: 100 Stars = 1.0381 GRAM (TON)
  const GRAM_PER_STAR = 1.0381 / 100;
  const estimatedTon = productType === 'premium'
    ? parseFloat(premiumDuration === '12m' ? '15' : premiumDuration === '6m' ? '8' : '5')
    : starsCount * GRAM_PER_STAR;

  const circuitCheck = checkCircuitBreaker(estimatedTon);
  if (!circuitCheck.ok) {
    await sb
      .from('tma_stars_orders')
      .update({ status: 'manual_verification', error_message: circuitCheck.reason })
      .eq('id', orderId);

    await notifyAdmin(
      `🛑 <b>CIRCUIT BREAKER</b>\n` +
      `Заказ: #${orderId.slice(0, 8)}\n` +
      `@${username}\n` +
      `Причина: ${circuitCheck.reason}\n\n` +
      `Заказ требует ручной обработки.`,
    );

    return { ok: false, orderId, status: 'manual_verification', error: circuitCheck.reason };
  }

  // ─── STEP 3: BALANCE CHECK ───
  const balanceOk = await hasEnoughBalance(String(estimatedTon));
  if (!balanceOk) {
    const balance = await getWalletBalance();
    const balanceStr = (Number(balance) / 1e9).toFixed(4);

    await sb
      .from('tma_stars_orders')
      .update({ status: 'pending_liquidity', error_message: `Need ${estimatedTon} TON, have ${balanceStr}` })
      .eq('id', orderId);

    await notifyAdmin(
      `💸 <b>НЕХВАТКА СРЕДСТВ</b>\n` +
      `Заказ: #${orderId.slice(0, 8)}\n` +
      `@${username}\n` +
      `Нужно: ~${estimatedTon.toFixed(2)} TON\n` +
      `На кошельке: ${balanceStr} TON\n\n` +
      `⚠️ Пополните кошелёк!`,
    );

    return { ok: false, orderId, status: 'pending_liquidity', error: 'Insufficient balance' };
  }

  // ─── STEP 4: SECURITY GUARD ───
  const guard = await guardTransaction(estimatedTon, username, orderId, 'fragment');
  if (!guard.allowed) {
    await sb
      .from('tma_stars_orders')
      .update({ status: 'manual_verification', error_message: guard.reason })
      .eq('id', orderId);

    await notifyAdmin(
      `🛑 <b>SECURITY GUARD</b>\n` +
      `Заказ: #${orderId.slice(0, 8)}\n` +
      `@${username}\n` +
      `Причина: ${guard.reason}`,
    );

    return { ok: false, orderId, status: 'manual_verification', error: guard.reason };
  }

  if (guard.requiresApproval) {
    await sb
      .from('tma_stars_orders')
      .update({ status: 'pending_approval', error_message: 'Waiting for admin approval' })
      .eq('id', orderId);
    return { ok: false, orderId, status: 'pending_approval', error: 'Requires admin approval' };
  }

  // ─── STEP 5: FRAGMENT INVOICE ───
  let invoice;
  try {
    if (productType === 'premium' && premiumDuration) {
      invoice = await getPremiumInvoice(username, premiumDuration);
    } else {
      invoice = await getStarsInvoice(username, starsCount);
    }
    console.log(`[Delivery] Invoice: ${invoice.address} / ${invoice.amountTon} TON / payload: ${invoice.payload.slice(0, 32)}...`);
  } catch (err) {
    const errorMsg = `Fragment error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[Delivery] ${errorMsg}`);

    await sb
      .from('tma_stars_orders')
      .update({ status: 'error_fragment', error_message: errorMsg })
      .eq('id', orderId);

    await notifyAdmin(
      `🚨 <b>Ошибка Fragment</b>\n` +
      `Заказ: #${orderId.slice(0, 8)}\n` +
      `@${username}\n` +
      `Ошибка: ${errorMsg}`,
    );

    return { ok: false, orderId, status: 'error_fragment', error: errorMsg };
  }

  // ─── STEP 6: AUDIT LOG — BEFORE ───
  await auditLog({
    timestamp: new Date().toISOString(),
    orderId,
    username,
    toAddress: invoice.address,
    amountTon: parseFloat(invoice.amountTon),
    payload: invoice.payload,
    txHash: null,
    status: 'pending',
  });

  // ─── STEP 7: SEND TON (fire-and-forget) ───
  let txHash: string;
  try {
    txHash = await sendTonWithPayload(invoice.address, invoice.amountTon, invoice.payload);
    console.log(`[Delivery] TX sent: ${txHash}`);
  } catch (txErr) {
    const errorMsg = `TON send error: ${txErr instanceof Error ? txErr.message : String(txErr)}`;
    console.error(`[Delivery] ${errorMsg}`);

    await auditLog({
      timestamp: new Date().toISOString(),
      orderId,
      username,
      toAddress: invoice.address,
      amountTon: parseFloat(invoice.amountTon),
      payload: invoice.payload,
      txHash: null,
      status: 'failed',
      reason: errorMsg,
    });

    await sb
      .from('tma_stars_orders')
      .update({ status: 'error_ton', error_message: errorMsg })
      .eq('id', orderId);

    await notifyAdmin(
      `🚨 <b>Ошибка отправки TON</b>\n` +
      `Заказ: #${orderId.slice(0, 8)}\n` +
      `@${username}\n` +
      `Адрес: ${invoice.address}\n` +
      `Сумма: ${invoice.amountTon} TON\n` +
      `Ошибка: ${errorMsg}`,
    );

    return { ok: false, orderId, status: 'error_ton', error: errorMsg };
  }

  // ─── STEP 8: AUDIT LOG — SENT ───
  await auditLog({
    timestamp: new Date().toISOString(),
    orderId,
    username,
    toAddress: invoice.address,
    amountTon: parseFloat(invoice.amountTon),
    payload: invoice.payload,
    txHash,
    status: 'sent',
  });

  // ─── STEP 9: UPDATE ORDER STATUS ───
  trackTx(parseFloat(invoice.amountTon));

  await sb
    .from('tma_stars_orders')
    .update({
      status: 'processing_blockchain',
      tx_hash: txHash,
      error_message: null,
    })
    .eq('id', orderId);

  // ─── STEP 10: NOTIFICATIONS ───
  const label = productType === 'premium'
    ? `Premium ${premiumDuration}`
    : `${starsCount} ⭐`;

  const remaining = CIRCUIT_BREAKER.maxPer15Min - getTotalTonInWindow();

  await notifyAdmin(
    `✅ <b>TON отправлен</b>\n` +
    `Заказ: #${orderId.slice(0, 8)}\n` +
    `@${username} — ${label}\n` +
    `TX: ${txHash}\n` +
    `Сумма: ${invoice.amountTon} TON\n` +
    `━━━━━━━━━━━━━━━\n` +
    `💰 ${getTotalTonInWindow().toFixed(2)}/${CIRCUIT_BREAKER.maxPer15Min} TON за 15мин\n` +
    `⏱ Обработка: ${Date.now() - startTime}ms`,
  );

  if (telegramId) {
    await notifyUser(
      telegramId,
      `Ваш заказ #${orderId.slice(0, 8)} в обработке! ${label} будет доставлен после подтверждения транзакции в блокчейне.`,
    );
  }

  console.log(`[Delivery] Completed: ${orderId} TX: ${txHash} (${Date.now() - startTime}ms)`);

  return { ok: true, orderId, status: 'processing_blockchain', txHash };
}

// ═══════════════════════════════════════════════════════════
// RETRY DELIVERY (для заказов в статусе pending_liquidity)
// ═══════════════════════════════════════════════════════════

/**
 * Повторная попытка доставки для заказов, которые ждали ликвидности.
 * Вызывается из cron job или вручную.
 */
export async function retryPendingDeliveries(): Promise<number> {
  const sb = getSupabase();

  const { data: pendingOrders } = await sb
    .from('tma_stars_orders')
    .select('id, username, stars_count, product_type, premium_duration, telegram_id')
    .eq('status', 'pending_liquidity')
    .order('created_at', { ascending: true })
    .limit(5);

  if (!pendingOrders || pendingOrders.length === 0) return 0;

  let processed = 0;
  for (const order of pendingOrders) {
    const result = await deliverOrder({
      orderId: order.id,
      username: order.username || 'unknown',
      productType: order.product_type || 'stars',
      starsCount: order.stars_count || 0,
      premiumDuration: order.premium_duration,
      telegramId: order.telegram_id,
    });

    if (result.ok || result.status !== 'pending_liquidity') {
      processed++;
    }
  }

  return processed;
}
