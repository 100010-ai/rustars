import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { resolveTelegramUser } from '@/lib/telegram';

// GET /api/market/wallet-items?telegram_id=...
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const initData = request.headers.get('x-telegram-init-data');
    const resolved = resolveTelegramUser(initData, searchParams.get('telegram_id'), true);

    if (!resolved) {
      return NextResponse.json({ items: [], wallet: null });
    }

    const sb = getSupabase();
    const { data: wallet } = await sb
      .from('tma_wallets')
      .select('address')
      .eq('telegram_id', resolved.id)
      .maybeSingle();

    if (!wallet?.address) {
      return NextResponse.json({ items: [], wallet: null });
    }

    const address = wallet.address;

    // Fetch NFTs from TON API
    const res = await fetch(
      `https://tonapi.io/v2/accounts/${address}/nfts?limit=200&offset=0`,
      { next: { revalidate: 60 } },
    );

    if (!res.ok) {
      return NextResponse.json({ items: [], wallet: address });
    }

    const data = await res.json();
    const nfts = data.nft_items || [];

    const COLLECTIONS: Record<string, string> = {
      usernames: 'EQCA14o1-VWhS2efqoh_9M1b_A9DtKTuoqfmkn83AbJzwnPi',
      numbers: 'EQAOQdwdw8kGftJCSFgOerM1mDjYRuvT2wAvWkiA_XeanCP',
    };

    const items = nfts.map((nft: any) => {
      const isUsername = nft.collection?.address === COLLECTIONS.usernames;
      const isNumber = nft.collection?.address === COLLECTIONS.numbers;
      const image = nft.previews?.find((p: any) => p.resolution === '500x500')?.url || nft.metadata?.image || null;
      const name = nft.metadata?.name || '—';

      const contentUri = nft.content?.uri || '';
      let nftData: { slug: string; num: number; lottie: string; still: string } | undefined;
      const giftMatch = contentUri.match(/gift\/([a-zA-Z]+)-(\d+)/);
      if (giftMatch) {
        const slug = giftMatch[1];
        const num = parseInt(giftMatch[2]);
        const base = `https://nft.fragment.com/gift/${slug.toLowerCase()}-${num}`;
        nftData = { slug, num, lottie: `${base}.lottie.json`, still: `${base}.medium.jpg` };
      }

      return {
        address: nft.address,
        name,
        subtitle: isNumber ? 'Анонимный номер' : isUsername ? 'Юзернейм' : nftData ? 'Коллекционный подарок' : 'NFT',
        image: nftData?.still || image,
        type: isUsername ? 'username' : isNumber ? 'number' : 'nft',
        nft: nftData,
      };
    });

    return NextResponse.json({ items, wallet: address });
  } catch {
    return NextResponse.json({ items: [], wallet: null });
  }
}
