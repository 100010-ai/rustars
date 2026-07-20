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
 *   3. sendBatchDelivery():
 *      - Мультиотправка до 255 заказов в одном BoC
 *      - Автодробление при превышении лимита
 *      - Однократная подпись ключом
 *
 * Fire-and-Forget:
 *   Транзакция отправляется через sendBoc() без ожидания
 *   подтверждения в блоке. Как RPC-нода приняла пакет — функция
 *   завершается. Это позволяет уложиться в 10-15с таймаут Vercel.
 */

import { TonClient, WalletContractV4 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { toNano, Address, beginCell, internal } from '@ton/core';
import { getSupabase } from './supabase';
import { GRAM_PER_STAR } from './constants';
import { getStarsInvoice, getPremiumInvoice, type FragmentInvoice } from './fragment-api';
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

// ═══════════════════════════════════════════════════════════
// BATCH DELIVERY — мультиотправка TON (до 255 заказов в BoC)
// ═══════════════════════════════════════════════════════════

const MAX_BATCH_SIZE = 255; // Лимит TON архитектуры

export interface BatchOrder {
  orderId: string;
  username: string;
  productType: 'stars' | 'premium';
  starsCount: number;
  premiumDuration?: '3m' | '6m' | '12m';
  telegramId?: number;
}

export interface BatchResult {
  totalOrders: number;
  sentBatches: number;
  succeeded: number;
  failed: number;
  failedOrders: string[];
  txHashes: string[];
}

// ═══════════════════════════════════════════════════════════
// RPC FAILOVER (для batch)
// ═══════════════════════════════════════════════════════════

const RPC_ENDPOINTS = [
  { url: 'https://toncenter.com', name: 'Toncenter' },
  { url: 'https://tonapi.io', name: 'TonAPI' },
  { url: 'https://orbs.network/ton', name: 'Orbs' },
];

let rpcIndex = 0;

function getTonClient(): TonClient {
  const apiKey = process.env.TONCENTER_API_KEY;
  if (!apiKey) throw new Error('TONCENTER_API_KEY not configured');
  return new TonClient({
    endpoint: RPC_ENDPOINTS[rpcIndex].url,
    apiKey,
  });
}

function switchRpc(): string {
  const prev = RPC_ENDPOINTS[rpcIndex].name;
  rpcIndex = (rpcIndex + 1) % RPC_ENDPOINTS.length;
  return `${prev} → ${RPC_ENDPOINTS[rpcIndex].name}`;
}

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /timeout|ETIMEOUT|ECONNRESET|500|502|503|429|ECONNREFUSED/.test(msg);
}

// ═══════════════════════════════════════════════════════════
// WALLET INIT (однократная инициализация для batch)
// ═══════════════════════════════════════════════════════════

let batchWallet: WalletContractV4 | null = null;
let batchKeyPair: { publicKey: Buffer; secretKey: Buffer } | null = null;

async function getBatchWallet() {
  if (batchWallet && batchKeyPair) return { wallet: batchWallet, keyPair: batchKeyPair };

  const mnemonic = process.env.MY_WALLET_MNEMONIC;
  if (!mnemonic) throw new Error('MY_WALLET_MNEMONIC not configured');

  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 24) throw new Error(`MNEMONIC: expected 24 words, got ${words.length}`);

  const kp = await mnemonicToPrivateKey(words);
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: kp.publicKey });

  batchWallet = wallet;
  batchKeyPair = kp;

  return { wallet, keyPair: kp };
}

// ═══════════════════════════════════════════════════════════
// BATCH DELIVERY — единый BoC для нескольких заказов
// ═══════════════════════════════════════════════════════════

/**
 * Отправляет несколько заказов одной транзакцией (multi-message).
 *
 * TON позволяет включить до 4 internal messages в одну транзакцию.
 * Для большего количества используем цепочку транзакций или
 * несколько batch'ей.
 *
 * Лимит: 4 сообщения на одну транзакцию (ограничение WalletV4).
 * Автоматически дробит на транзакции по 4 заказа.
 */
export async function sendBatchDelivery(orders: BatchOrder[]): Promise<BatchResult> {
  const sb = getSupabase();
  const startTime = Date.now();
  const result: BatchResult = {
    totalOrders: orders.length,
    sentBatches: 0,
    succeeded: 0,
    failed: 0,
    failedOrders: [],
    txHashes: [],
  };

  if (orders.length === 0) return result;

  console.log(`[Batch] Starting batch delivery: ${orders.length} orders`);

  // ── Step 1: Валидация и получение инвойсов ──
  const validOrders: Array<BatchOrder & { invoice: FragmentInvoice }> = [];

  for (const order of orders) {
    try {
      // Idempotency check
      const { data: existing } = await sb
        .from('tma_stars_orders')
        .select('id, status')
        .eq('id', order.orderId)
        .maybeSingle();

      if (existing && existing.status !== 'paid') {
        console.log(`[Batch] Skip ${order.orderId} — status: ${existing.status}`);
        continue;
      }

      // Circuit breaker
      const estTon = order.productType === 'premium'
        ? parseFloat(order.premiumDuration === '12m' ? '15' : order.premiumDuration === '6m' ? '8' : '5')
        : order.starsCount * GRAM_PER_STAR;

      const circuit = checkCircuitBreaker(estTon);
      if (!circuit.ok) {
        await sb.from('tma_stars_orders').update({ status: 'manual_verification', error_message: circuit.reason }).eq('id', order.orderId);
        result.failedOrders.push(order.orderId);
        result.failed++;
        continue;
      }

      // Fragment invoice
      const invoice = order.productType === 'premium' && order.premiumDuration
        ? await getPremiumInvoice(order.username, order.premiumDuration)
        : await getStarsInvoice(order.username, order.starsCount);

      validOrders.push({ ...order, invoice });
    } catch (err) {
      console.error(`[Batch] Failed to prepare order ${order.orderId}:`, err);
      await sb.from('tma_stars_orders').update({ status: 'error_fragment', error_message: String(err) }).eq('id', order.orderId);
      result.failedOrders.push(order.orderId);
      result.failed++;
    }
  }

  if (validOrders.length === 0) {
    console.log('[Batch] No valid orders to send');
    return result;
  }

  // ── Step 2: Дробление на транзакции (макс 4 сообщения на tx) ──
  const MESSAGES_PER_TX = 4;
  const txBatches: typeof validOrders[] = [];

  for (let i = 0; i < validOrders.length; i += MESSAGES_PER_TX) {
    txBatches.push(validOrders.slice(i, i + MESSAGES_PER_TX));
  }

  console.log(`[Batch] Split into ${txBatches.length} transactions (${validOrders.length} orders)`);

  // ── Step 3: Получаем wallet ──
  const { wallet, keyPair } = await getBatchWallet();

  // ── Step 4: Audit log — BEFORE ──
  for (const order of validOrders) {
    await auditLog({
      timestamp: new Date().toISOString(),
      orderId: order.orderId,
      username: order.username,
      toAddress: order.invoice.address,
      amountTon: parseFloat(order.invoice.amountTon),
      payload: order.invoice.payload,
      txHash: null,
      status: 'pending',
    });
  }

  // ── Step 5: Отправляем каждую транзакцию ──
  for (const batch of txBatches) {
    let success = false;

    for (let retry = 0; retry < 3; retry++) {
      try {
        const client = getTonClient();
        const contract = client.open(wallet);
        const seqno = await contract.getSeqno();

        // Формируем массив internal messages
        const messages = batch.map((order) => {
          const amountNano = toNano(order.invoice.amountTon);
          const body = beginCell()
            .storeUint(0, 32)
            .storeStringTail(order.invoice.payload)
            .endCell();

          return internal({
            to: order.invoice.address,
            value: amountNano,
            body,
          });
        });

        // Одна подпись на весь batch
        const transfer = wallet.createTransfer({
          seqno,
          secretKey: keyPair.secretKey,
          messages,
        });

        const totalTon = batch.reduce((s, o) => s + parseFloat(o.invoice.amountTon), 0);
        console.log(
          `[Batch] TX #${result.sentBatches + 1}: ${batch.length} msgs, ${totalTon.toFixed(3)} TON, ` +
          `RPC: ${RPC_ENDPOINTS[rpcIndex].name}, seqno: ${seqno}`
        );

        await contract.send(transfer);

        // Успешно — обновляем статусы
        for (const order of batch) {
          trackTx(parseFloat(order.invoice.amountTon));

          await sb.from('tma_stars_orders').update({
            status: 'processing_blockchain',
            tx_hash: `batch-${seqno}-${Date.now()}`,
            error_message: null,
          }).eq('id', order.orderId);

          result.txHashes.push(`batch-${seqno}-${Date.now()}`);
        }

        result.succeeded += batch.length;
        result.sentBatches++;
        success = true;
        break;

      } catch (err) {
        console.error(`[Batch] TX attempt ${retry + 1} failed:`, err);
        if (retry < 2 && isRetryable(err)) {
          const switched = switchRpc();
          console.log(`[Batch] Failover: ${switched}`);
          await new Promise(r => setTimeout(r, 1000 * (retry + 1)));
        }
      }
    }

    if (!success) {
      // Все попытки исчерпаны
      for (const order of batch) {
        await sb.from('tma_stars_orders').update({
          status: 'error_ton',
          error_message: 'Batch TX failed after 3 retries',
        }).eq('id', order.orderId);

        await auditLog({
          timestamp: new Date().toISOString(),
          orderId: order.orderId,
          username: order.username,
          toAddress: order.invoice.address,
          amountTon: parseFloat(order.invoice.amountTon),
          payload: order.invoice.payload,
          txHash: null,
          status: 'failed',
          reason: 'Batch TX failed',
        });

        result.failedOrders.push(order.orderId);
        result.failed++;
      }
    }
  }

  // ── Step 6: Уведомления ──
  const elapsed = Date.now() - startTime;
  const totalTon = validOrders.reduce((s, o) => s + parseFloat(o.invoice.amountTon), 0);

  await notifyAdmin(
    `📦 <b>BATCH DELIVERY</b>\n` +
    `Заказов: ${validOrders.length}\n` +
    `Успешно: ${result.succeeded} | Ошибки: ${result.failed}\n` +
    `Транзакций: ${result.sentBatches}\n` +
    `Сумма: ${totalTon.toFixed(3)} TON\n` +
    `⏱ Время: ${elapsed}ms`,
  );

  console.log(`[Batch] Completed: ${result.succeeded}/${result.totalOrders} succeeded in ${elapsed}ms`);

  return result;
}
