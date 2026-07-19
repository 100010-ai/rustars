import { NextResponse } from 'next/server';
import { getWalletBalance } from '@/lib/ton-wallet';

// Сколько TON нужно за 1 звезду (с учётом газа)
const TON_PER_STAR = 0.0002;

// GET /api/stock/check — проверка доступного количества звёзд
export async function GET() {
  try {
    let tonBalance: number;
    try {
      const balance = await getWalletBalance();
      tonBalance = Number(balance) / 1e9;
    } catch {
      // Не можем проверить баланс — разрешаем покупку (автовыдача не сработает, уведомим админа)
      return NextResponse.json({ available: 999999, tonBalance: null, warning: false });
    }

    // Максимум звёзд которые можем выдать
    const availableStars = Math.floor(tonBalance / TON_PER_STAR);

    return NextResponse.json({
      available: availableStars,
      tonBalance: Math.round(tonBalance * 100) / 100,
      warning: availableStars < 5000,
    });
  } catch {
    return NextResponse.json({ available: 999999, tonBalance: null, warning: false });
  }
}
