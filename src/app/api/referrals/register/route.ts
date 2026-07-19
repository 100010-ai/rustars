import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { resolveTelegramUser } from '@/lib/telegram';
import { checkRateLimit, getKeyFromRequest } from '@/lib/rate-limit';

// POST /api/referrals/register  { referrerId, initData }
// Привязывает текущего пользователя к пригласившему (один раз).
export async function POST(request: Request) {
  try {
    const { referrerId, initData } = await request.json();

    const resolved = resolveTelegramUser(initData, null, true);
    if (!resolved) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limit: 3 attempts per minute
    const key = getKeyFromRequest(request, resolved.id);
    const limit = checkRateLimit(`ref-register:${key}`, { max: 3, windowMs: 60_000 });
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const refId = Number(referrerId);
    if (!Number.isFinite(refId) || refId <= 0 || refId === resolved.id) {
      return NextResponse.json({ ok: false });
    }

    const sb = getSupabase();

    // Уже привязан? (referred_id UNIQUE — привязка неизменна)
    const { data: existing } = await sb
      .from('tma_referrals')
      .select('id')
      .eq('referred_id', resolved.id)
      .maybeSingle();

    if (existing) return NextResponse.json({ ok: true, already: true });

    const { error } = await sb.from('tma_referrals').insert({
      referrer_id: refId,
      referred_id: resolved.id,
      referred_username: resolved.user?.username || null,
    });

    if (error && !error.message.includes('duplicate')) {
      console.error('[Referral register] error:', error);
      return NextResponse.json({ ok: false });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
