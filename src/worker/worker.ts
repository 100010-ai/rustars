/**
 * DEPRECATED — replaced by serverless delivery.
 *
 * This file is kept for backwards compatibility only.
 * The actual delivery logic now lives in:
 *   - src/lib/serverless-delivery.ts (main delivery function)
 *   - src/lib/fragment-api.ts (Fragment HTTP client)
 *   - src/lib/ton-wallet.ts (TON wallet operations)
 *
 * The worker process (tsx src/worker/worker.ts) is NO LONGER NEEDED.
 * Delivery is triggered directly from the YooKassa webhook handler.
 */

console.log('[Worker] DEPRECATED: Use serverless delivery via /api/webhooks/payment instead.');
console.log('[Worker] This file is kept for backwards compatibility only.');
