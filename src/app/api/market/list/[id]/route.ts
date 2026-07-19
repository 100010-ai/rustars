import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { resolveTelegramUser } from '@/lib/telegram';

// DELETE /api/market/list/[id] { initData }
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { initData } = await request.json();

    // Верификация initData через HMAC
    const resolved = resolveTelegramUser(initData, null, true);
    if (!resolved) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getSupabase();
    const { error } = await db
      .from('tma_p2p_listings')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('seller_tg_id', resolved.id)
      .eq('status', 'active');

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[P2P Cancel] error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
