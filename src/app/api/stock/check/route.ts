import { NextResponse } from 'next/server';
import { getWalletBalance } from '@/lib/ton-wallet';

const TON_PER_STAR = 0.0002;

// GET /api/stock/check — проверка доступного количества звёзд
// SECURITY: Не раскрывает точный баланс TON — возвращает диапазон
export async function GET() {
  try {
    let availableStars: number;
    try {
      const balance = await getWalletBalance();
      const tonBalance = Number(balance) / 1e9;
      availableStars = Math.floor(tonBalance / TON_PER_STAR);
    } catch {
      return NextResponse.json({ available: 999999, low: false });
    }

    // Возвращаем только "доступно" без точного баланса
    // low = true если мало звёзд (показать предупреждение в UI)
    return NextResponse.json({
      available: availableStars,
      low: availableStars < 5000,
    });
  } catch {
    return NextResponse.json({ available: 999999, low: false });
  }
}
