import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

const BOT_TOKEN = process.env.ADMIN_BOT_TOKEN || process.env.TELEGRAM_MINIAPP_BOT_TOKEN;
const REVIEWS_CHANNEL_ID = process.env.TELEGRAM_REVIEWS_CHANNEL_ID;
const REVIEW_REWARD = 3;
const MIN_REVIEW_LENGTH = 15;

// Запрещённые слова / паттерны (мат, спам, ссылки)
const BANNED_PATTERNS = [
  // Ссылки
  /https?:\/\//i,
  /t\.me\//i,
  /telegram\.me\//i,
  /bit\.ly/i,
  /goo\.gl/i,
  // Бот-слова
  /\bbot\b/i,
  /\bapi\b/i,
  // Мат (базовый набор, расширяемый)
  /хуй|пизд|бляд|еба|ёба|сука|говн|дерьмо|жопа|сук[аи]|муда?к|лох|урод/i,
  // Спам-маркеры
  /заработай|бесплатн|казин|ставк|bet|casino|crypto.*profit/i,
];

async function sendMessage(chatId: number, text: string) {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => {});
}

// GET /api/webhooks/telegram — set webhook (только с секретным ключом)
export async function GET(request: Request) {
  // Защита: только ADMIN_SECRET
  const authHeader = request.headers.get('authorization');
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!BOT_TOKEN) {
    return NextResponse.json({ error: 'BOT_TOKEN not set' }, { status: 500 });
  }

  const url = `${process.env.APP_URL}/api/webhooks/telegram`;
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      allowed_updates: ['message'],
      secret_token: secretToken || undefined,
    }),
  });
  const data = await res.json();

  return NextResponse.json({ ok: data.ok, description: data.description });
}

// POST /api/webhooks/telegram — handle incoming updates
export async function POST(request: Request) {
  try {
    // Верификация: Telegram шлёт secret_token в header X-Telegram-Bot-Api-Secret-Token
    const secretToken = request.headers.get('x-telegram-bot-api-secret-token');
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (expectedSecret && secretToken !== expectedSecret) {
      return NextResponse.json({ error: 'Invalid secret' }, { status: 403 });
    }

    const update = await request.json();

    // Only handle text messages
    const msg = update.message;
    if (!msg || !msg.text) {
      return NextResponse.json({ ok: true });
    }

    const userId = msg.from?.id;
    const username = msg.from?.username || msg.from?.first_name || 'user';
    const text = msg.text;

    if (!userId) {
      return NextResponse.json({ ok: true });
    }

    const sb = getSupabase();

    // Check if user is waiting for feedback
    const { data: waiting } = await sb
      .from('tma_waiting_feedback')
      .select('order_id, waiting')
      .eq('telegram_id', userId)
      .eq('waiting', true)
      .maybeSingle();

    if (!waiting) {
      return NextResponse.json({ ok: true });
    }

    // ─── ANTI-FROD 1: Find unreviewed completed order ───
    const { data: order } = await sb
      .from('tma_stars_orders')
      .select('id')
      .eq('telegram_id', userId)
      .eq('status', 'completed')
      .eq('is_reviewed', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!order) {
      // Clear stale waiting status
      await sb
        .from('tma_waiting_feedback')
        .update({ waiting: false })
        .eq('telegram_id', userId);

      await sendMessage(
        userId,
        'Вы можете оставить отзыв только после совершения и успешного выполнения реальной покупки на нашем сайте!',
      );
      return NextResponse.json({ ok: true });
    }

    // ─── ANTI-FROD 2: Text length check ───
    if (text.length < MIN_REVIEW_LENGTH) {
      await sendMessage(
        userId,
        `Ваш отзыв слишком короткий! Пожалуйста, напишите чуть подробнее, как прошло пополнение (минимум ${MIN_REVIEW_LENGTH} символов), чтобы получить бонус.`,
      );
      return NextResponse.json({ ok: true });
    }

    // ─── ANTI-FROD 3: Banned words / spam check ───
    const hasBanned = BANNED_PATTERNS.some((p) => p.test(text));
    if (hasBanned) {
      await sendMessage(
        userId,
        'В отзыве обнаружены недопустимые слова или ссылки. Пожалуйста, напишите честный отзыв без спама.',
      );
      return NextResponse.json({ ok: true });
    }

    // ─── ALL CHECKS PASSED ───

    const shortId = (order.id || '').slice(0, 8);

    // Format the review post
    const reviewPost =
      `Новый отзыв от @${username} (Заказ #${shortId})\n\n` +
      `"${text}"\n\n` +
      `Пополнить баланс дешевле всех: @RuStarAppbot`;

    // Send to reviews channel
    if (REVIEWS_CHANNEL_ID) {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: REVIEWS_CHANNEL_ID,
          text: reviewPost,
          parse_mode: 'HTML',
        }),
      }).catch((e) => console.error('[Webhook] send to channel error:', e));
    }

    // ─── ATOMIC: Mark reviewed + credit reward ───
    // 1. Mark order as reviewed
    await sb
      .from('tma_stars_orders')
      .update({ is_reviewed: true })
      .eq('id', order.id);

    // 2. Clear waiting status
    await sb
      .from('tma_waiting_feedback')
      .update({ waiting: false })
      .eq('telegram_id', userId);

    // 3. Credit 3 rubles atomically
    const { error: txnErr } = await sb.from('tma_wallet_txns').insert({
      telegram_id: userId,
      kind: 'review_reward',
      amount_rub: REVIEW_REWARD,
      status: 'done',
      meta: { order_id: order.id, review_text: text.slice(0, 500) },
    });

    if (txnErr) {
      console.error('[Webhook] review reward insert error:', txnErr);
    } else {
      await sb.rpc('tma_adjust_balance', { p_tg: userId, p_delta: REVIEW_REWARD });
    }

    // 4. Thank the user
    await sendMessage(
      userId,
      `Отзыв успешно опубликован в канале! На ваш баланс зачислено ${REVIEW_REWARD.toFixed(2)} ₽`,
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Telegram webhook] error:', err);
    return NextResponse.json({ ok: true });
  }
}
