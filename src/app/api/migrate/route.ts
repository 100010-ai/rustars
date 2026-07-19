import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

// GET /api/migrate — check P2P tables
export async function GET() {
  try {
    const db = getSupabase();
    const results: Record<string, boolean> = {};

    // Check tma_wallets
    const { error: e1 } = await db.from('tma_wallets').select('id').limit(1);
    results.tma_wallets = !e1;

    // Check tma_p2p_listings
    const { error: e2 } = await db.from('tma_p2p_listings').select('id').limit(1);
    results.tma_p2p_listings = !e2;

    return NextResponse.json(results);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
