import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { resolveTelegramUser } from '@/lib/telegram';
import { REFERRAL_RATE } from '@/lib/referral';

// GET /api/referrals/stats?telegram_id=...
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const initData = request.headers.get('x-telegram-init-data');
    const resolved = resolveTelegramUser(initData, searchParams.get('telegram_id'), true);

    if (!resolved) {
      return NextResponse.json({ invited: 0, active: 0, earned: 0, available: 0 });
    }

    const sb = getSupabase();

    // Список приглашённых
    const { data: refs } = await sb
      .from('tma_referrals')
      .select('referred_username, total_earned_rub, first_order_at, created_at')
      .eq('referrer_id', resolved.id)
      .order('created_at', { ascending: false });

    const list = refs || [];
    const invited = list.length;
    const active = list.filter((r) => r.first_order_at).length;
    const earned = list.reduce((s, r) => s + Number(r.total_earned_rub || 0), 0);

    // Уже выведено из реферального пула
    const { data: wds } = await sb
      .from('tma_wallet_txns')
      .select('amount_rub, meta')
      .eq('telegram_id', resolved.id)
      .eq('kind', 'withdraw')
      .eq('status', 'done');

    const withdrawn = (wds || [])
      .filter((w) => (w.meta as { from?: string })?.from === 'referral')
      .reduce((s, w) => s + Math.abs(Number(w.amount_rub || 0)), 0);

    const available = Math.max(0, Number((earned - withdrawn).toFixed(2)));

    const recent = list.slice(0, 10).map((r) => ({
      username: r.referred_username || 'user',
      reward: Number(r.total_earned_rub || 0),
      date: r.created_at,
    }));

    return NextResponse.json({
      invited,
      active,
      earned: Number(earned.toFixed(2)),
      available,
      rate: REFERRAL_RATE,
      recent,
    });
  } catch {
    return NextResponse.json({ invited: 0, active: 0, earned: 0, available: 0 });
  }
}
