import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { resolveTelegramUser } from '@/lib/telegram';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const initData = request.headers.get('x-telegram-init-data');
    const resolved = resolveTelegramUser(initData, searchParams.get('telegram_id'), true);

    if (!resolved) {
      return NextResponse.json({ balance_rub: 0, txns: [] });
    }

    const sb = getSupabase();

    const { data: bal } = await sb
      .from('tma_balances')
      .select('balance_rub')
      .eq('telegram_id', resolved.id)
      .maybeSingle();

    const { data: txns } = await sb
      .from('tma_wallet_txns')
      .select('id, kind, amount_rub, status, created_at')
      .eq('telegram_id', resolved.id)
      .order('created_at', { ascending: false })
      .limit(20);

    return NextResponse.json({
      balance_rub: Number(bal?.balance_rub || 0),
      txns: txns || [],
    });
  } catch {
    return NextResponse.json({ balance_rub: 0, txns: [] });
  }
}
