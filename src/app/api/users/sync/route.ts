/**
 * POST /api/users/sync — синхронизация данных пользователя из Telegram в Supabase.
 *
 * При первом входе создаёт запись в tma_balances.
 * При последующих — обновляет username (на случай смены ника).
 * Критично для реферальной системы, Конвертера и лидербордов.
 */

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const { telegram_id, first_name, last_name, username } = await request.json();

    // Валидация
    if (!telegram_id || typeof telegram_id !== 'number' || telegram_id <= 0) {
      return NextResponse.json({ error: 'Invalid telegram_id' }, { status: 400 });
    }

    const sb = getSupabase();

    // Upsert в tma_balances (создаём запись если нет, обновляем username если есть)
    const { error } = await sb
      .from('tma_balances')
      .upsert({
        telegram_id,
        username: username || null,
        first_name: first_name || null,
        last_name: last_name || null,
        balance_rub: 0, // дефолтный баланс
      }, {
        onConflict: 'telegram_id',
        ignoreDuplicates: false, // обновляем при конфликте
      });

    if (error) {
      console.error('[Users Sync] DB error:', error);
      return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Users Sync] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
