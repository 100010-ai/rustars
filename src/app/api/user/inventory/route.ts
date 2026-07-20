import { NextResponse } from 'next/server';
import { checkRateLimit, getKeyFromRequest } from '@/lib/rate-limit';

// ─── Интерфейсы ───

interface TonNft {
  address: string;
  name: string;
  description: string;
  image: string;
  metadata: Record<string, unknown>;
  collection?: { address: string; name: string };
}

interface InventoryItem {
  type: 'gift' | 'number' | 'username';
  name: string;
  image: string;
  address: string;
  extras?: Record<string, unknown>;
}

// ─── Категории Fragment NFT ───

// Адреса коллекций Fragment в TON (основные)
const FRAGMENT_COLLECTIONS = {
  gifts: [
    'EQD5mJcR0dEHfWxZsD0sBNxQ-vTQ3Pيq5h4e0sJZ9x8vR7Qd', // Telegram Gifts
    'EQAbZ7R2pKf3uB8vN1xK4mT6wY9cE2sJ5gH0dF3kL7qP',     // Gifts v2
  ],
  numbers: [
    'EQCk4gxnzvfGBzKJGOeaYyGw_JfEKoB2bAZPa_2M2Vd2mA8r', // Anonymous Numbers
  ],
  usernames: [
    'EQBx-5R1KpE9cTDb9w7sD2vN4mK8fL3jH6gY0xQ5wE1rT',     // Usernames
  ],
};

// Упрощённое определение типа по метаданным и коллекции
function categorizeNft(nft: TonNft): InventoryItem | null {
  const meta = nft.metadata || {};
  const collectionName = (nft.collection?.name || '').toLowerCase();

  // Telegram Gift
  if (
    collectionName.includes('gift') ||
    meta['type'] === 'gift' ||
    meta['animation_url'] ||
    meta['bg_color']
  ) {
    return {
      type: 'gift',
      name: nft.name || 'Gift',
      image: nft.image || '',
      address: nft.address,
      extras: {
        bg_color: meta['bg_color'] || '#1a3a6e',
        animation_url: meta['animation_url'] || null,
        number: meta['number'] || null,
      },
    };
  }

  // Anonymous Number (+888)
  if (
    collectionName.includes('number') ||
    collectionName.includes('anonymous') ||
    (typeof meta['number'] === 'string' && meta['number'].includes('888')) ||
    (typeof meta['name'] === 'string' && meta['name'].includes('+888'))
  ) {
    return {
      type: 'number',
      name: nft.name || String(meta['number'] || '+888 XXX'),
      image: nft.image || '',
      address: nft.address,
      extras: {
        number: meta['number'] || nft.name,
      },
    };
  }

  // Username
  if (
    collectionName.includes('username') ||
    meta['type'] === 'username' ||
    (typeof meta['name'] === 'string' && meta['name'].startsWith('@'))
  ) {
    return {
      type: 'username',
      name: nft.name || String(meta['name'] || '@username'),
      image: nft.image || '',
      address: nft.address,
    };
  }

  // Неизвестный NFT — пропускаем
  return null;
}

// ─── GET /api/user/inventory?ton_address=... ───

export async function GET(request: Request) {
  try {
    // Rate limit: 20 requests per minute per IP
    const key = getKeyFromRequest(request);
    const limit = checkRateLimit(key, { max: 20, windowMs: 60_000 });
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const tonAddress = searchParams.get('ton_address');

    if (!tonAddress) {
      return NextResponse.json({ items: [] });
    }

    // Запрос NFT через TON API индексатор
    const res = await fetch(
      `https://tonapi.io/v2/accounts/${tonAddress}/nfts?limit=100`,
      { next: { revalidate: 60 } }, // кэш 1 минута
    );

    if (!res.ok) {
      console.error('[Inventory] tonapi.io error:', res.status);
      return NextResponse.json({ items: [] });
    }

    const data = await res.json();
    const nfts: TonNft[] = data.nft_items || [];

    // Фильтруем и категоризируем
    const items: InventoryItem[] = [];
    for (const nft of nfts) {
      const item = categorizeNft(nft);
      if (item) items.push(item);
    }

    // Сортируем: подарки first, потом номера, потом юзернеймы
    const order = { gift: 0, number: 1, username: 2 };
    items.sort((a, b) => order[a.type] - order[b.type]);

    return NextResponse.json({ items });
  } catch (err) {
    console.error('[Inventory] Error:', err);
    return NextResponse.json({ items: [] });
  }
}
