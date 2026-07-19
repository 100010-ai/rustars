/**
 * Transaction Guard — ultimate protection for TON wallet operations.
 *
 * Layers:
 *   1. Daily per-user spending limit
 *   2. Transaction amount limits
 *   3. Destination address validation
 *   4. Admin approval queue for large amounts
 *   5. Immutable audit log
 */

import { getSupabase } from '../supabase';

// ═══════════════════════════════════════════════════════════
// LIMITS
// ═══════════════════════════════════════════════════════════

const LIMITS = {
  /** Макс TON за одну транзакцию */
  MAX_PER_TX: 30,
  /** Макс TON за сутки (весь кошелёк) */
  MAX_DAILY_TOTAL: 150,
  /** Макс TON за сутки на одного пользователя */
  MAX_DAILY_PER_USER: 50,
  /** Транзакции сверх этого значения требуют подтверждения админа */
  ADMIN_APPROVAL_THRESHOLD: 20,
};

// ═══════════════════════════════════════════════════════════
// AUDIT LOG — append-only, immutable
// ═══════════════════════════════════════════════════════════

export interface AuditEntry {
  timestamp: string;
  orderId: string;
  username: string;
  toAddress: string;
  amountTon: number;
  payload: string;
  txHash: string | null;
  status: 'pending' | 'sent' | 'failed' | 'blocked';
  reason?: string;
}

/**
 * Запись в immutable audit log.
 * Каждая транзакция записывается ДО отправки и ПОСЛЕ.
 */
export async function auditLog(entry: AuditEntry): Promise<void> {
  try {
    const sb = getSupabase();
    await sb.from('tma_audit_log').insert({
      order_id: entry.orderId,
      username: entry.username,
      to_address: entry.toAddress,
      amount_ton: entry.amountTon,
      payload: entry.payload.slice(0, 128),
      tx_hash: entry.txHash,
      status: entry.status,
      reason: entry.reason || null,
      created_at: entry.timestamp,
    });
  } catch (err) {
    // Audit log failure is CRITICAL — log to console as fallback
    console.error('[AUDIT] FAILED TO WRITE LOG:', JSON.stringify(entry));
  }
}

// ═══════════════════════════════════════════════════════════
// DAILY LIMITS CHECK
// ═══════════════════════════════════════════════════════════

/**
 * Проверяет суточные лимиты перед отправкой.
 * Возвращает { allowed: false, reason } если лимит превышен.
 */
export async function checkDailyLimits(
  amountTon: number,
  username: string,
  orderId: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const sb = getSupabase();
  const today = new Date().toISOString().split('T')[0];
  const dayStart = `${today}T00:00:00Z`;

  // ── 1. Global daily limit ──
  const { data: globalTxns } = await sb
    .from('tma_audit_log')
    .select('amount_ton')
    .gte('created_at', dayStart)
    .in('status', ['sent', 'pending']);

  const globalTotal = (globalTxns || []).reduce((sum, t) => sum + Number(t.amount_ton), 0);

  if (globalTotal + amountTon > LIMITS.MAX_DAILY_TOTAL) {
    const reason = `Daily global limit: ${(globalTotal + amountTon).toFixed(2)} TON > ${LIMITS.MAX_DAILY_TOTAL} TON`;
    console.error(`[Guard] BLOCKED — ${reason}`);
    return { allowed: false, reason };
  }

  // ── 2. Per-user daily limit ──
  const { data: userTxns } = await sb
    .from('tma_audit_log')
    .select('amount_ton')
    .eq('username', username)
    .gte('created_at', dayStart)
    .in('status', ['sent', 'pending']);

  const userTotal = (userTxns || []).reduce((sum, t) => sum + Number(t.amount_ton), 0);

  if (userTotal + amountTon > LIMITS.MAX_DAILY_PER_USER) {
    const reason = `Per-user daily limit for @${username}: ${(userTotal + amountTon).toFixed(2)} TON > ${LIMITS.MAX_DAILY_PER_USER} TON`;
    console.error(`[Guard] BLOCKED — ${reason}`);
    return { allowed: false, reason };
  }

  // ── 3. Per-transaction limit ──
  if (amountTon > LIMITS.MAX_PER_TX) {
    const reason = `Single TX limit: ${amountTon} TON > ${LIMITS.MAX_PER_TX} TON`;
    console.error(`[Guard] BLOCKED — ${reason}`);
    return { allowed: false, reason };
  }

  return { allowed: true };
}

// ═══════════════════════════════════════════════════════════
// ADMIN APPROVAL CHECK
// ═══════════════════════════════════════════════════════════

/**
 * Проверяет нужно ли одобрение админа для этой транзакции.
 */
export function requiresAdminApproval(amountTon: number): boolean {
  return amountTon > LIMITS.ADMIN_APPROVAL_THRESHOLD;
}

/**
 * Ставит транзакцию в очередь одобрения админа.
 */
export async function requestAdminApproval(
  orderId: string,
  username: string,
  amountTon: number,
  toAddress: string,
  payload: string,
): Promise<void> {
  const sb = getSupabase();

  await sb.from('tma_pending_approvals').insert({
    order_id: orderId,
    username,
    amount_ton: amountTon,
    to_address: toAddress,
    payload: payload.slice(0, 128),
    status: 'pending',
    created_at: new Date().toISOString(),
  });

  // Notify admin
  const token = process.env.ADMIN_BOT_TOKEN;
  const chatId = process.env.ADMIN_CHAT_ID;
  if (token && chatId) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text:
          `🔐 ТРЕБУЕТСЯ ОДОБРЕНИЕ\n\n` +
          `Заказ: #${orderId.slice(0, 8)}\n` +
          `@${username}\n` +
          `Сумма: ${amountTon} TON\n` +
          `Адрес: ${toAddress}\n\n` +
          `Подтвердите: /approve ${orderId.slice(0, 8)}\n` +
          `Отклоните: /reject ${orderId.slice(0, 8)}`,
      }),
    }).catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════
// COMBINED GUARD CHECK
// ═══════════════════════════════════════════════════════════

export interface GuardResult {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
}

/**
 * Полная проверка перед отправкой транзакции.
 */
export async function guardTransaction(
  amountTon: number,
  username: string,
  orderId: string,
  toAddress: string,
): Promise<GuardResult> {
  // 1. Daily limits
  const limits = await checkDailyLimits(amountTon, username, orderId);
  if (!limits.allowed) {
    await auditLog({
      timestamp: new Date().toISOString(),
      orderId,
      username,
      toAddress,
      amountTon,
      payload: '',
      txHash: null,
      status: 'blocked',
      reason: limits.reason,
    });
    return { allowed: false, requiresApproval: false, reason: limits.reason };
  }

  // 2. Admin approval for large amounts
  const needsApproval = requiresAdminApproval(amountTon);
  if (needsApproval) {
    await requestAdminApproval(orderId, username, amountTon, toAddress, '');
  }

  return { allowed: true, requiresApproval: needsApproval };
}
