import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { resolveTelegramUser } from '@/lib/telegram';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const initData = request.headers.get('x-telegram-init-data');
    const resolved = resolveTelegramUser(initData, searchParams.get('telegram_id'), true);

    if (!resolved) {
      return NextResponse.json({ orders: [] });
    }

    const { data, error } = await getSupabase()
      .from('tma_stars_orders')
      .select('id, stars_count, amount_rub, status, created_at, tx_hash')
      .eq('telegram_id', resolved.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: 'DB error' }, { status: 500 });
    }

    return NextResponse.json({ orders: data || [] });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
