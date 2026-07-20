/**
 * Delivery Service — абстракция для выдачи звёзд/Premium.
 *
 * НОВАЯ АРХИТЕКТУРА (v2 — Serverless):
 *   1. Заказ оплачен → webhook handler вызывает deliverOrder()
 *   2. deliverOrder() — единая функция:
 *      a. Idempotency check
 *      b. Circuit breaker check
 *      c. Balance check
 *      d. Security guard
 *      e. Fragment invoice (HTTP, без Puppeteer)
 *      f. TON transaction (fire-and-forget)
 *      g. Audit log
 *      h. Status update + notification
 *   3. Всё работает на Vercel Serverless (без VPS/worker)
 *
 * СТАРАЯ АРХИТЕКТУРА (v1 — Worker + Puppeteer) — УДАЛЕНА:
 *   - tma_delivery_queue больше не используется
 *   - Worker process (tsx src/worker/worker.ts) больше не нужен
 *   - Puppeteer/Chromium удалены из зависимостей
 */

import { getSupabase } from './supabase';

// Re-export serverless delivery
export { deliverOrder, retryPendingDeliveries } from './serverless-delivery';
export type { DeliveryResult } from './serverless-delivery';

// ═══════════════════════════════════════════════════════════
// LEGACY COMPATIBILITY (для cron/refill-wallet и admin panel)
// ═══════════════════════════════════════════════════════════

/**
 * Получает инвойс Fragment для покупки звёзд.
 * Совместимость со старым API.
 */
export async function getFragmentInvoice(
  username: string,
  starsCount: number,
): Promise<{ address: string; amountTon: string; payload: string }> {
  const { getStarsInvoice } = await import('./fragment-api');
  return getStarsInvoice(username, starsCount);
}

/**
 * Получает инвойс Fragment для покупки Premium.
 * Совместимость со старым API.
 */
export async function getFragmentPremiumInvoice(
  username: string,
  duration: '3m' | '6m' | '12m',
): Promise<{ address: string; amountTon: string; payload: string }> {
  const { getPremiumInvoice } = await import('./fragment-api');
  return getPremiumInvoice(username, duration);
}
