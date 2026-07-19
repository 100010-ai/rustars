import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

// GET /api/migrate — check P2P tables (ADMIN ONLY)
export async function GET(request: Request) {
  // Защита: только ADMIN_SECRET
  const authHeader = request.headers.get('authorization');
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const db = getSupabase();
    const results: Record<string, boolean> = {};

    const { error: e1 } = await db.from('tma_wallets').select('id').limit(1);
    results.tma_wallets = !e1;

    const { error: e2 } = await db.from('tma_p2p_listings').select('id').limit(1);
    results.tma_p2p_listings = !e2;

    return NextResponse.json(results);
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
