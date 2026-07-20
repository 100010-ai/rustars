/**
 * GET /api/payout/rate — текущий курс скупки Stars.
 *
 * Возвращает:
 *   - buyRate: текущий курс (рубли за 1 Star)
 *   - minStars: минимальное количество для вывода
 *   - maxPerTx: максимальная сумма за раз (3000₽)
 *   - maxPerDay: максимальная сумма в сутки (10000₽)
 */

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { checkRateLimitDb, getKeyFromRequest } from '@/lib/rate-limit';

export async function GET(request: Request) {
  try {
    // Rate limit: 30 requests per minute per IP
    const key = getKeyFromRequest(request);
    const limit = await checkRateLimitDb(key, { max: 30, windowMs: 60_000 });
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const sb = getSupabase();

    // Читаем курс скупки из system_rates
    const { data: rateData } = await sb
      .from('system_rates')
      .select('stars_buy_rate_rub')
      .eq('key', 'buyback')
      .maybeSingle();

    const buyRate = rateData?.stars_buy_rate_rub || 0.80;

    return NextResponse.json({
      buyRate,
      minStars: 50,
      maxPerTx: 3000,
      maxPerDay: 10000,
      currency: 'RUB',
    });
  } catch (err) {
    console.error('[Payout Rate] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
