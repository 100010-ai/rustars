import { NextResponse } from 'next/server';
import { fetchRates } from '@/lib/rates';
import { getSupabase } from '@/lib/supabase';
import { checkRateLimit, getKeyFromRequest } from '@/lib/rate-limit';

// Реальные mainnet-коллекции Fragment в TON
const COLLECTIONS: Record<string, string> = {
  usernames: 'EQCA14o1-VWhS2efqoh_9M1b_A9DtKTuoqfmkn83AbJzwnPi', // Telegram Usernames
  numbers: 'EQAOQdwdw8kGftJCSFgOerM1mDjYRuvT2wAvWkiA_XeanCP',   // Anonymous Numbers (+888)
};

// ─── Каталог реальных коллекционных подарков Fragment (для вкладки НФТ) ───
// slug соответствует реальному пути на nft.fragment.com/gift/{slug}-{num}.*
const GIFTS: Array<{ slug: string; title: string; nums: number[] }> = [
  { slug: 'PlushPepe', title: 'Plush Pepe', nums: [1, 2, 3] },
  { slug: 'DurovsCap', title: "Durov's Cap", nums: [1, 5, 12] },
  { slug: 'PreciousPeach', title: 'Precious Peach', nums: [3, 7, 21] },
  { slug: 'EternalRose', title: 'Eternal Rose', nums: [2, 9, 33] },
  { slug: 'DiamondRing', title: 'Diamond Ring', nums: [4, 11, 27] },
  { slug: 'AstralShard', title: 'Astral Shard', nums: [1, 8, 19] },
  { slug: 'LootBag', title: 'Loot Bag', nums: [2, 6, 15] },
  { slug: 'SwissWatch', title: 'Swiss Watch', nums: [3, 10, 24] },
  { slug: 'SignetRing', title: 'Signet Ring', nums: [1, 7, 18] },
  { slug: 'VintageCigar', title: 'Vintage Cigar', nums: [2, 5, 14] },
  { slug: 'GenieLamp', title: 'Genie Lamp', nums: [1, 4, 13] },
  { slug: 'MagicPotion', title: 'Magic Potion', nums: [3, 9, 22] },
  { slug: 'JellyBunny', title: 'Jelly Bunny', nums: [2, 8, 17] },
  { slug: 'HangingStar', title: 'Hanging Star', nums: [1, 6, 20] },
];

interface TonApiItem {
  address: string;
  metadata?: { name?: string; image?: string };
  previews?: Array<{ resolution: string; url: string }>;
  sale?: { price?: { token_name?: string; value?: string } };
}

interface MarketItem {
  address: string;
  name: string;
  subtitle: string;
  image: string | null;
  type: string;
  priceRub: number | null;
  priceTon: number | null;
  // NFT-специфика (Fragment)
  nft?: { slug: string; num: number; lottie: string; still: string };
  // P2P-листинг
  listing?: { id: string; sellerUsername: string };
}

async function fetchCollection(
  type: 'usernames' | 'numbers',
  q: string,
  tonRub: number,
): Promise<MarketItem[]> {
  const collection = COLLECTIONS[type];
  const res = await fetch(
    `https://tonapi.io/v2/nfts/collections/${collection}/items?limit=200&offset=0`,
    { next: { revalidate: 120 } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  const raw: TonApiItem[] = data.nft_items || [];

  let items: MarketItem[] = raw
    .filter((it) => it.sale?.price?.value && (it.sale.price.token_name || 'TON') === 'TON')
    .map((it) => {
      const ton = Number(it.sale!.price!.value) / 1e9;
      const image =
        it.previews?.find((p) => p.resolution === '500x500')?.url || it.metadata?.image || null;
      return {
        address: it.address,
        name: it.metadata?.name || '—',
        subtitle: type === 'numbers' ? 'Анонимный номер' : 'Юзернейм',
        image,
        type,
        priceTon: Number(ton.toFixed(2)),
        priceRub: tonRub ? Math.round(ton * tonRub) : null,
      };
    });

  if (q) items = items.filter((i) => i.name.toLowerCase().includes(q));
  items.sort((a, b) => (a.priceRub ?? a.priceTon ?? 0) - (b.priceRub ?? b.priceTon ?? 0));
  return items;
}

// Коллекционные подарки Fragment с реальной анимацией (.lottie.json) и фоном (.jpg)
function buildNftItems(q: string): MarketItem[] {
  const out: MarketItem[] = [];
  for (const g of GIFTS) {
    for (const num of g.nums) {
      const base = `https://nft.fragment.com/gift/${g.slug.toLowerCase()}-${num}`;
      out.push({
        address: `${g.slug}-${num}`,
        name: `${g.title} #${num}`,
        subtitle: 'Коллекционный подарок',
        image: `${base}.medium.jpg`,
        type: 'nft',
        priceRub: null,
        priceTon: null,
        nft: {
          slug: g.slug,
          num,
          lottie: `${base}.lottie.json`,
          still: `${base}.medium.jpg`,
        },
      });
    }
  }
  return q ? out.filter((i) => i.name.toLowerCase().includes(q)) : out;
}

// GET /api/market?type=all|usernames|numbers|nft&q=&sort=
export async function GET(request: Request) {
  try {
    // Rate limit: 10 requests per minute per IP
    const key = getKeyFromRequest(request);
    const limit = checkRateLimit(key, { max: 10, windowMs: 60_000 });
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'all';
    const q = (searchParams.get('q') || '').trim().toLowerCase();

    let tonRub = 0;
    try {
      const { tonUsd, usdRub } = await fetchRates();
      tonRub = tonUsd * usdRub;
    } catch {
      /* без курса — цена в TON */
    }

    if (type === 'nft') {
      return NextResponse.json({ items: buildNftItems(q).slice(0, 60) });
    }

    if (type === 'usernames' || type === 'numbers') {
      const items = await fetchCollection(type, q, tonRub);
      return NextResponse.json({ items: items.slice(0, 60) });
    }

    // all → микс: P2P-листинги + юзернеймы + номера + подарки
    const db = getSupabase();
    const { data: p2pRows } = await db
      .from('tma_p2p_listings')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(40);

    const p2pItems: MarketItem[] = (p2pRows || []).map((r) => ({
      address: r.item_address,
      name: r.item_name,
      subtitle: r.seller_username ? `@${r.seller_username} · ${r.item_type === 'nft' ? 'NFT' : r.item_type === 'username' ? 'Юзернейм' : 'Номер'}` : r.item_type,
      image: r.item_image,
      type: r.item_type,
      priceRub: Number(r.price_rub),
      priceTon: null,
      nft: r.item_lottie ? { slug: r.item_slug || '', num: r.item_num || 0, lottie: r.item_lottie, still: r.item_still || '' } : undefined,
      listing: { id: r.id, sellerUsername: r.seller_username },
    }));

    const [u, n] = await Promise.all([
      fetchCollection('usernames', q, tonRub).catch(() => []),
      fetchCollection('numbers', q, tonRub).catch(() => []),
    ]);
    const nft = buildNftItems(q);
    const mixed = [...p2pItems, ...u.slice(0, 15), ...n.slice(0, 15), ...nft.slice(0, 15)];
    return NextResponse.json({ items: mixed.slice(0, 60) });
  } catch (err) {
    console.error('[Market] error:', err);
    return NextResponse.json({ items: [] });
  }
}
