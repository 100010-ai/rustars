import { NextResponse } from 'next/server';
import { getWalletBalance } from '@/lib/ton-wallet';
import { checkRateLimitDb, getKeyFromRequest } from '@/lib/rate-limit';

const TON_PER_STAR = 0.0002;

// GET /api/stock/check — проверка доступного количества звёзд
// SECURITY: Не раскрывает точный баланс TON — возвращает округлённый диапазон
export async function GET(request: Request) {
  try {
    // Rate limit: 30 requests per minute per IP (check done on every page load)
    const key = getKeyFromRequest(request);
    const limit = await checkRateLimitDb(key, { max: 30, windowMs: 60_000 });
    if (!limit.allowed) {
      return NextResponse.json({ available: 50000, low: false });
    }

    let availableStars: number;
    try {
      const balance = await getWalletBalance();
      const tonBalance = Number(balance) / 1e9;
      // Округляем до ближайших 100 — не показываем точное количество
      availableStars = Math.floor(tonBalance / TON_PER_STAR / 100) * 100;
    } catch {
      // Fallback: показываем что есть запас
      return NextResponse.json({ available: 50000, low: false });
    }

    // Возвращаем только "доступно" без точного баланса
    // low = true если мало звёзд (показать предупреждение в UI)
    return NextResponse.json({
      available: availableStars,
      low: availableStars < 5000,
    });
  } catch {
    return NextResponse.json({ available: 50000, low: false });
  }
}
