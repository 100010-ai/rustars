import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getStarRate } from '@/lib/referral';
import { checkRateLimit, getKeyFromRequest } from '@/lib/rate-limit';
import { createYooKassaPayment } from '@/lib/yookassa';
import { resolveTelegramUser } from '@/lib/telegram';

const ORDER_TTL_MS = 10 * 60 * 1000; // 10 минут на оплату
const ORDER_LIMIT = { max: 3, windowMs: 60_000 }; // 3 заказа в минуту
const MIN_STARS = 50;
const MAX_STARS = 100000;

// Кэш курса TON (обновляется раз в 5 минут)
let rateCache: { stars: number; rate: number; at: number } | null = null;

function getSecureRate(stars: number): number {
  const now = Date.now();
  if (rateCache && now - rateCache.at < 300_000 && rateCache.stars === stars) {
    return rateCache.rate;
  }
  const rate = getStarRate(stars);
  rateCache = { stars, rate, at: now };
  return rate;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { starsCount, tgUser, method } = body;

    // ═══ АУТЕНТИФИКАЦИЯ: проверяем initData через HMAC ═══
    const initData = request.headers.get('x-telegram-init-data');
    const resolved = resolveTelegramUser(initData, tgUser?.id, true);
    if (!resolved) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Используем проверенный telegram_id, а не доверяем клиенту
    const verifiedTgId = resolved.id;
    const verifiedUsername = resolved.user?.username || tgUser?.username || '';

    // ═══ ВАЛИДАЦИЯ ВХОДНЫХ ДАННЫХ ═══

    // 1. Проверка типа и диапазона звёзд (0 допускается для Premium)
    const isPremium = !!body.product_type && body.product_type.startsWith('premium_');
    if (!isPremium) {
      if (typeof starsCount !== 'number' || !Number.isInteger(starsCount)) {
        return NextResponse.json({ error: 'Неверный формат количества звёзд' }, { status: 400 });
      }
      if (starsCount < MIN_STARS || starsCount > MAX_STARS) {
        return NextResponse.json({ error: `Допустимый диапазон: ${MIN_STARS}–${MAX_STARS} звёзд` }, { status: 400 });
      }
    } else {
      // Premium: проверяем наличие product_type и premium_duration
      if (!body.premium_duration || !['3m', '6m', '12m'].includes(body.premium_duration)) {
        return NextResponse.json({ error: 'Неверный срок Premium' }, { status: 400 });
      }
    }

    // 2. Проверка tgUser (используем verified данные)
    const tgUserSafe = { id: verifiedTgId, username: verifiedUsername.slice(0, 64) };

    // 3. Проверка метода оплаты
    const payMethod: 'sbp' | 'bank_card' = method === 'bank_card' ? 'bank_card' : 'sbp';

    // 4. Rate limit
    const key = getKeyFromRequest(request, verifiedTgId);
    const limit = checkRateLimit(key, ORDER_LIMIT);
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Слишком много запросов. Подождите.' }, { status: 429 });
    }

    // 5. Проверка остатков на складе (только для Stars, не для Premium)
    if (!isPremium) {
      try {
        const { getWalletBalance } = await import('@/lib/ton-wallet');
        const tonBalance = await getWalletBalance();
        const tonNum = Number(tonBalance) / 1e9;
        const maxStars = Math.floor(tonNum / 0.0002);
        if (starsCount > maxStars) {
          return NextResponse.json({
            error: 'Данный объём временно закончился на складе. Попробуйте выбрать пакет поменьше или зайдите через 10 минут!',
          }, { status: 409 });
        }
      } catch {
        // Не можем проверить — пропускаем
      }
    }

    // ═══ РАСЧЁТ ЦЕНЫ НА СЕРВЕРЕ ═══
    let totalRub: number;
    if (isPremium) {
      // Premium: цена из фиксированных тарифов
      const premiumPrices: Record<string, number> = { premium_3mo: 1590, premium_6mo: 2190, premium_1yr: 3790 };
      totalRub = premiumPrices[body.product_type] || 0;
      if (totalRub <= 0) {
        return NextResponse.json({ error: 'Неизвестный продукт' }, { status: 400 });
      }
    } else {
      // Stars: прогрессивный курс
      const rate = getSecureRate(starsCount);
      totalRub = Math.ceil(starsCount * rate);
    }

    // ═══ ПРОВЕРКА БАЛАНСА ═══
    const sb = getSupabase();
    const { data: balRow } = await sb
      .from('tma_balances')
      .select('balance_rub')
      .eq('telegram_id', verifiedTgId)
      .maybeSingle();

    const internalBalance = Math.max(0, Number(balRow?.balance_rub || 0));
    const balanceDiscount = Math.min(internalBalance, totalRub);
    const payAmount = Math.max(1, totalRub - balanceDiscount);

    // ═══ ПРОВЕРКА НА ДУБЛИРОВАНИЕ ═══
    // Проверяем нет ли уже pending-заказа на эту сумму от этого пользователя
    const { data: recentOrder } = await sb
      .from('tma_stars_orders')
      .select('id, created_at')
      .eq('telegram_id', verifiedTgId)
      .eq('stars_count', starsCount)
      .eq('status', 'pending')
      .gt('created_at', new Date(Date.now() - 60_000).toISOString()) // За последнюю минуту
      .maybeSingle();

    if (recentOrder) {
      return NextResponse.json({ error: 'Заказ уже создан. Подождите минуту.' }, { status: 429 });
    }

    // ═══ СОЗДАНИЕ ЗАКАЗА ═══
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ORDER_TTL_MS);

    const { data: order, error: insertError } = await sb
      .from('tma_stars_orders')
      .insert({
        telegram_id: verifiedTgId,
        username: verifiedUsername || null,
        stars_count: starsCount,
        amount_rub: totalRub,
        status: 'pending',
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      })
      .select('id')
      .single();

    if (insertError) {
      return NextResponse.json({ error: 'Не удалось создать заказ' }, { status: 500 });
    }

    // ═══ СОЗДАНИЕ ПЛАТЕЖА В ЮKassa ═══
    const appUrl = `https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME}?startapp`;
    const webhookUrl = `${process.env.APP_URL}/api/webhooks/payment`;

    const payment = await createYooKassaPayment({
      amount: payAmount,
      description: `RuStars: ${starsCount} Telegram Stars`,
      metadata: {
        orderId: order.id,
        stars_amount: String(starsCount),
        telegram_username: verifiedUsername || '',
      },
      confirmationUrl: appUrl,
      webhookUrl,
      method: payMethod,
    });

    // Сохраняем ID платежа
    await sb
      .from('tma_stars_orders')
      .update({ payment_id: payment.id })
      .eq('id', order.id);

    const paymentUrl = payment.confirmation?.confirmation_url;
    if (!paymentUrl) {
      return NextResponse.json({ error: 'Не удалось создать платёж' }, { status: 500 });
    }

    // ═══ ЛОГИРОВАНИЕ ═══
    console.log(`[Order] Created: ${order.id} | ${starsCount}★ | ${totalRub}₽ | user:${verifiedTgId} | balance:${balanceDiscount}₽ | pay:${payAmount}₽`);

    return NextResponse.json({
      orderId: order.id,
      totalRub,
      starsCount,
      balanceDiscount,
      payAmount,
      paymentUrl,
    });
  } catch (err) {
    console.error('[Order] Error:', err);
    return NextResponse.json({ error: 'Внутренняя ошибка' }, { status: 500 });
  }
}
