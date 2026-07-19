import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { resolveTelegramUser } from '@/lib/telegram';
import { checkRateLimit, getKeyFromRequest } from '@/lib/rate-limit';

// POST /api/market/list { item, priceRub, initData }
interface ListItem {
  address: string;
  name: string;
  subtitle: string;
  image: string | null;
  type: string;
  nft?: { slug: string; num: number; lottie: string; still: string };
}

export async function POST(request: Request) {
  try {
    const { item, priceRub, initData } = await request.json() as { item: ListItem; priceRub: number; initData: string };
    if (!item || !priceRub || !initData) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    if (priceRub < 10) {
      return NextResponse.json({ error: 'Минимальная цена — 10 ₽' }, { status: 400 });
    }

    // Верификация initData через HMAC (защита от подделки telegram_id)
    const resolved = resolveTelegramUser(initData, null, true);
    if (!resolved) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limit: 5 listings per minute
    const key = getKeyFromRequest(request, resolved.id);
    const limit = checkRateLimit(`market-list:${key}`, { max: 5, windowMs: 60_000 });
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const telegramId = resolved.id;
    const user = resolved.user;

    // Verify wallet exists
    const db = getSupabase();
    const { data: wallet } = await db
      .from('tma_wallets')
      .select('address')
      .eq('telegram_id', telegramId)
      .single();

    if (!wallet) {
      return NextResponse.json({ error: 'Сначала подключите кошелёк' }, { status: 400 });
    }

    // Check for duplicate active listing of same item
    const { data: existing } = await db
      .from('tma_p2p_listings')
      .select('id')
      .eq('item_address', item.address)
      .eq('status', 'active')
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'Этот предмет уже выставлен на продажу' }, { status: 409 });
    }

    const { data, error } = await db.from('tma_p2p_listings').insert({
      seller_tg_id: telegramId,
      seller_username: user?.username || user?.first_name || '',
      seller_avatar: user?.photo_url || null,
      item_type: item.type,
      item_address: item.address,
      item_name: item.name,
      item_image: item.image || null,
      item_lottie: item.nft?.lottie || null,
      item_still: item.nft?.still || null,
      item_slug: item.nft?.slug || null,
      item_num: item.nft?.num || null,
      price_rub: priceRub,
      status: 'active',
    }).select('id').single();

    if (error) throw error;

    return NextResponse.json({ ok: true, listingId: data.id });
  } catch (err) {
    console.error('[P2P List] error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
