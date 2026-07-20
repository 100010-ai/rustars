/**
 * Cached Rates — курс GRAM/RUB кэшируется в Supabase.
 *
 * Логика:
 *   1. При GET-запросе → читаем из system_rates
 *   2. Если updated_at старше 3 минут → обновляем из внешнего API
 *   3. Все остальные запросы получают кэшированное значение
 *
 * Преимущества:
 *   - Нет холодных запросов к CoinGecko/currency-api при каждом запросе
 *   - Один запрос к внешнему API раз в 3 минуты
 *   - Все инстансы Vercel Serverless читают одинаковое значение
 */

import { getSupabase } from './supabase';
import { PURCHASE_RATE_RUB_PER_GRAM, GRAM_PER_STAR } from './constants';

const CACHE_TTL_MS = 3 * 60 * 1000; // 3 минуты

// ═══════════════════════════════════════════════════════════
// GET CACHED RATE
// ═══════════════════════════════════════════════════════════

export interface CachedRate {
  /** Текущий курс закупки GRAM → RUB */
  purchaseRate: number;
  /** Себестоимость 1 Stars в RUB */
  costPerStar: number;
  /** Когда обновлено */
  updatedAt: string;
  /** Было ли обновление из внешнего API */
  fresh: boolean;
}

/**
 * Получает курс GRAM/RUB из кэша в Supabase.
 * Если кэш старше 3 минут — обновляет из внешнего API.
 */
export async function getCachedRate(): Promise<CachedRate> {
  const sb = getSupabase();

  // 1. Читаем из БД
  const { data: cached } = await sb
    .from('system_rates')
    .select('stars_buy_rate_rub, updated_at')
    .eq('key', 'rates_cache')
    .maybeSingle();

  const now = Date.now();
  const cachedAge = cached?.updated_at
    ? now - new Date(cached.updated_at).getTime()
    : Infinity;

  // 2. Если кэш свежий (< 3 мин) — возвращаем
  if (cached && cachedAge < CACHE_TTL_MS && cached.stars_buy_rate_rub) {
    return {
      purchaseRate: PURCHASE_RATE_RUB_PER_GRAM,
      costPerStar: PURCHASE_RATE_RUB_PER_GRAM * GRAM_PER_STAR,
      updatedAt: cached.updated_at,
      fresh: false,
    };
  }

  // 3. Кэш устарел или отсутствует — обновляем из внешнего API
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd',
      { next: { revalidate: 180 } },
    );

    if (res.ok) {
      const data = await res.json();
      const tonUsd = data['the-open-network']?.usd;

      // Also get USD/RUB
      const rubRes = await fetch(
        'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
        { next: { revalidate: 180 } },
      );
      const rubData = await rubRes.json();
      const usdRub = rubData.usd?.rub;

      if (tonUsd && usdRub) {
        const tonRub = tonUsd * usdRub;

        // Обновляем кэш в БД
        await sb.from('system_rates').upsert({
          key: 'rates_cache',
          value: JSON.stringify({ tonUsd, usdRub, tonRub }),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });

        console.log(`[Rates] Cache updated: TON/USD=${tonUsd}, USD/RUB=${usdRub}`);
      }
    }
  } catch (err) {
    console.error('[Rates] Failed to fetch external rates:', err);
  }

  // 4. Возвращаем (обновлённый или старый) курс
  return {
    purchaseRate: PURCHASE_RATE_RUB_PER_GRAM,
    costPerStar: PURCHASE_RATE_RUB_PER_GRAM * GRAM_PER_STAR,
    updatedAt: cached?.updated_at || new Date().toISOString(),
    fresh: true,
  };
}

// ═══════════════════════════════════════════════════════════
// GET BUYBACK RATE (из system_rates)
// ═══════════════════════════════════════════════════════════

export async function getBuybackRate(): Promise<number> {
  const sb = getSupabase();
  const { data } = await sb
    .from('system_rates')
    .select('stars_buy_rate_rub')
    .eq('key', 'buyback')
    .maybeSingle();

  return data?.stars_buy_rate_rub || 0.80;
}
