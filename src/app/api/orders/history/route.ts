import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const telegramId = searchParams.get('telegram_id');

    if (!telegramId) {
      return NextResponse.json({ error: 'Missing telegram_id' }, { status: 400 });
    }

    const { data, error } = await getSupabase()
      .from('tma_stars_orders')
      .select('id, stars_count, amount_rub, status, created_at, tx_hash')
      .eq('telegram_id', Number(telegramId))
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[History] Supabase error:', error);
      return NextResponse.json({ error: 'DB error' }, { status: 500 });
    }

    return NextResponse.json({ orders: data || [] });
  } catch (err) {
    console.error('[History] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
