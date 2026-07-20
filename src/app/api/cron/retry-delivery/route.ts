/**
 * GET /api/cron/retry-delivery - Retry pending deliveries.
 *
 * Vercel Cron Job: каждые 2 минуты проверяет заказы в статусе
 * pending_liquidity и повторно пытается доставить, если баланс
 * кошелька восстановлен.
 */

import { NextResponse } from 'next/server';
import { retryPendingDeliveries } from '@/lib/serverless-delivery';

export async function GET(request: Request) {
  // Verify cron secret (Vercel Cron Jobs send this header)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const processed = await retryPendingDeliveries();
    console.log(`[Cron] Retry delivery: ${processed} orders processed`);
    return NextResponse.json({ ok: true, processed });
  } catch (err) {
    console.error('[Cron] Retry delivery error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
