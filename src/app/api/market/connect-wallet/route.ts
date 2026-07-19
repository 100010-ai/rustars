import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { resolveTelegramUser } from '@/lib/telegram';

// POST /api/market/connect-wallet { address, initData }
export async function POST(request: Request) {
  try {
    const { address, initData } = await request.json();
    if (!address || !initData) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    // Верификация через HMAC
    const resolved = resolveTelegramUser(initData, null, true);
    if (!resolved) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Валидация TON-адреса
    if (!/^[EUQ0][A-Za-z0-9_-]{46}$/.test(address)) {
      return NextResponse.json({ error: 'Invalid TON address' }, { status: 400 });
    }

    // Проверка существования адреса
    const res = await fetch(`https://tonapi.io/v2/accounts/${address}`);
    if (!res.ok) {
      return NextResponse.json({ error: 'Address not found on TON' }, { status: 400 });
    }
    const account = await res.json();
    if (account.status !== 'active') {
      return NextResponse.json({ error: 'Wallet is not active' }, { status: 400 });
    }

    const sb = getSupabase();
    await sb.from('tma_wallets').upsert(
      { telegram_id: resolved.id, address, verified: true },
      { onConflict: 'telegram_id' },
    );

    return NextResponse.json({ ok: true, address });
  } catch (err) {
    console.error('[ConnectWallet] error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
