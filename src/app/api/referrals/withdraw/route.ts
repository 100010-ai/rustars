import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { resolveTelegramUser } from '@/lib/telegram';
import { checkRateLimit, getKeyFromRequest } from '@/lib/rate-limit';

// POST /api/referrals/withdraw  { initData }
// Переводит доступный реферальный доход на основной рублёвый баланс.
export async function POST(request: Request) {
  try {
    const { initData } = await request.json();

    const resolved = resolveTelegramUser(initData, null, true);
    if (!resolved) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limit: 1 withdrawal per 5 minutes
    const key = getKeyFromRequest(request, resolved.id);
    const limit = checkRateLimit(`withdraw:${key}`, { max: 1, windowMs: 300_000 });
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const sb = getSupabase();
    const tg = resolved.id;

    // Заработано всего
    const { data: refs } = await sb
      .from('tma_referrals')
      .select('total_earned_rub')
      .eq('referrer_id', tg);
    const earned = (refs || []).reduce((s, r) => s + Number(r.total_earned_rub || 0), 0);

    // Уже выведено
    const { data: wds } = await sb
      .from('tma_wallet_txns')
      .select('amount_rub, meta')
      .eq('telegram_id', tg)
      .eq('kind', 'withdraw')
      .eq('status', 'done');
    const withdrawn = (wds || [])
      .filter((w) => (w.meta as { from?: string })?.from === 'referral')
      .reduce((s, w) => s + Math.abs(Number(w.amount_rub || 0)), 0);

    const available = Number((earned - withdrawn).toFixed(2));
    if (available <= 0) {
      return NextResponse.json({ error: 'Nothing to withdraw' }, { status: 400 });
    }

    // Запись о выводе из реферального пула
    const { error: txnErr } = await sb.from('tma_wallet_txns').insert({
      telegram_id: tg,
      kind: 'withdraw',
      amount_rub: -available,
      status: 'done',
      meta: { from: 'referral' },
    });
    if (txnErr) {
      console.error('[Withdraw] txn error:', txnErr);
      return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }

    // Зачисление на основной баланс
    const { data: newBalance, error: balErr } = await sb.rpc('tma_adjust_balance', {
      p_tg: tg,
      p_delta: available,
    });
    if (balErr) {
      console.error('[Withdraw] balance error:', balErr);
    }

    return NextResponse.json({
      ok: true,
      withdrawn: available,
      balance_rub: Number(newBalance || 0),
    });
  } catch (err) {
    console.error('[Withdraw] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
