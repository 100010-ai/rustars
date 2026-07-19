import { NextResponse } from 'next/server';
import { resolveTelegramUser } from '@/lib/telegram';

const CHANNEL_CHAT_ID = '@RuStarsOfficial';
const TASK_REWARD = 5;
const BOT_TOKEN = process.env.ADMIN_BOT_TOKEN || process.env.TELEGRAM_MINIAPP_BOT_TOKEN;

// POST /api/tasks/check-subscription { initData, task: 'subscribe_channel' }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { task, initData } = body;

    if (task !== 'subscribe_channel') {
      return NextResponse.json({ error: 'Unknown task' }, { status: 400 });
    }

    // Верификация: initData с HMAC (enforce=true)
    let tgId: number | null = null;
    if (initData) {
      const resolved = resolveTelegramUser(initData, null, true);
      if (resolved) tgId = resolved.id;
    }
    if (!tgId) {
      return NextResponse.json({ error: 'Cannot identify user' }, { status: 401 });
    }

    if (!BOT_TOKEN) {
      return NextResponse.json({ error: 'BOT_TOKEN not configured' }, { status: 500 });
    }

    // 1. Check channel membership
    const memberRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${CHANNEL_CHAT_ID}&user_id=${tgId}`,
    );
    const memberData = await memberRes.json();

    if (!memberData.ok) {
      console.error('[Task] getChatMember failed:', memberData.description, '| user:', tgId);
      return NextResponse.json({ error: memberData.description || 'Cannot verify subscription' }, { status: 500 });
    }

    const status: string = memberData.result?.status || 'left';
    const isSubscribed = ['member', 'administrator', 'creator'].includes(status);

    // 2. Lazy import Supabase (avoids cold-start issues)
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const sb = createClient(url, key);

    // 3. Check if already rewarded
    const { data: existing } = await sb
      .from('tma_wallet_txns')
      .select('id, amount_rub')
      .eq('telegram_id', tgId)
      .eq('kind', 'task_reward')
      .eq('status', 'done')
      .limit(1)
      .maybeSingle();

    if (isSubscribed && existing) {
      return NextResponse.json({ ok: true, already: true, subscribed: true, status });
    }

    if (isSubscribed && !existing) {
      const { error: txnErr } = await sb.from('tma_wallet_txns').insert({
        telegram_id: tgId,
        kind: 'task_reward',
        amount_rub: TASK_REWARD,
        status: 'done',
        meta: { task: 'subscribe_channel', channel: CHANNEL_CHAT_ID },
      });

      if (txnErr) {
        console.error('[Task] insert error:', txnErr.message);
        return NextResponse.json({ error: 'Database error' }, { status: 500 });
      }

      const { error: balErr } = await sb.rpc('tma_adjust_balance', { p_tg: tgId, p_delta: TASK_REWARD });
      if (balErr) console.error('[Task] balance error:', balErr.message);

      return NextResponse.json({ ok: true, subscribed: true, credited: TASK_REWARD, status });
    }

    return NextResponse.json({ ok: true, subscribed: false, status });
  } catch (err) {
    console.error('[Task] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
