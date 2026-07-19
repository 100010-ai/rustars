import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

const SUPPORT_BOT_TOKEN = process.env.SUPPORT_BOT_TOKEN || '';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '-7851246214';

// Supabase-backed message mapping (persistent across cold starts)
async function setMessageMapping(adminMsgId: number, userId: number, username: string) {
  const sb = getSupabase();
  await sb.from('tma_support_messages').upsert(
    { admin_msg_id: adminMsgId, user_id: userId, username },
    { onConflict: 'admin_msg_id' },
  );
}

async function getMessageMapping(adminMsgId: number): Promise<{ user_id: number; username: string } | null> {
  const sb = getSupabase();
  const { data } = await sb
    .from('tma_support_messages')
    .select('user_id, username')
    .eq('admin_msg_id', adminMsgId)
    .maybeSingle();
  return data;
}

async function sendToAdmin(text: string, userId: number, username: string) {
  const label = username ? `@${username}` : `ID: ${userId}`;

  const sent = await fetch(`https://api.telegram.org/bot${SUPPORT_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: ADMIN_CHAT_ID,
      text: `Новое сообщение от ${label} (ID: ${userId}):\n\n${text}`,
      reply_markup: {
        inline_keyboard: [[{ text: 'Ответить', callback_data: `reply_${userId}` }]],
      },
    }),
  });

  const data = await sent.json();
  if (data.result?.message_id) {
    await setMessageMapping(data.result.message_id, userId, username);
  }
}

async function sendToUser(userId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${SUPPORT_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: userId,
      text: `Ответ поддержки:\n\n${text}`,
    }),
  });
}

async function answerCallbackQuery(callbackQueryId: number) {
  await fetch(`https://api.telegram.org/bot${SUPPORT_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}

async function sendReplyPrompt(adminChatId: number, userId: number) {
  // Ищем username из БД
  const sb = getSupabase();
  const { data } = await sb
    .from('tma_support_messages')
    .select('username')
    .eq('user_id', userId)
    .order('admin_msg_id', { ascending: false })
    .limit(1)
    .maybeSingle();

  const username = data?.username || `ID: ${userId}`;
  await fetch(`https://api.telegram.org/bot${SUPPORT_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: adminChatId,
      text: `Напишите ответ для @${username} (ID: ${userId}):`,
    }),
  });
}

// GET — установка вебхука
export async function GET() {
  const url = `${process.env.APP_URL}/api/webhooks/support`;
  const res = await fetch(`https://api.telegram.org/bot${SUPPORT_BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      allowed_updates: ['message', 'callback_query'],
    }),
  });
  const data = await res.json();
  return NextResponse.json({ ok: data.ok, description: data.description });
}

// POST — обработка входящих обновлений
export async function POST(request: Request) {
  try {
    const update = await request.json();

    // === Callback query (нажатие "Ответить") ===
    if (update.callback_query) {
      const cq = update.callback_query;
      const data: string = cq.data || '';
      const userId = Number(data.replace('reply_', ''));

      if (data.startsWith('reply_') && userId) {
        await answerCallbackQuery(cq.id);
        await sendReplyPrompt(cq.message?.chat?.id || ADMIN_CHAT_ID, userId);
        // Запоминаем mapping
        if (cq.message?.message_id) {
          await setMessageMapping(cq.message.message_id, userId, '');
        }
      }
      return NextResponse.json({ ok: true });
    }

    // === Обычные сообщения ===
    const msg = update.message;
    if (!msg || !msg.text) return NextResponse.json({ ok: true });

    const chatId = msg.chat?.id;
    const userId = msg.from?.id;
    const text = msg.text;

    if (!chatId || !userId) return NextResponse.json({ ok: true });

    // Сообщение от пользователя (не из админ-чата)
    const isAdmin = String(chatId) === String(ADMIN_CHAT_ID);

    if (!isAdmin) {
      // Пользователь пишет боту → пересылаем админу
      const username = msg.from?.username || msg.from?.first_name || 'user';
      await sendToAdmin(text, userId, username);
      await fetch(`https://api.telegram.org/bot${SUPPORT_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: 'Ваше сообщение отправлено в поддержку. Ожидайте ответа.',
        }),
      });
      return NextResponse.json({ ok: true });
    }

    // Сообщение от админа → проверяем, ответ ли это пользователю
    const replyTo = msg.reply_to_message;
    if (replyTo && replyTo.from?.id === Number(SUPPORT_BOT_TOKEN.split(':')[0])) {
      const mapping = await getMessageMapping(replyTo.message_id);
      if (mapping) {
        await sendToUser(mapping.user_id, text);
        return NextResponse.json({ ok: true });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Support webhook] error:', err);
    return NextResponse.json({ ok: true });
  }
}
