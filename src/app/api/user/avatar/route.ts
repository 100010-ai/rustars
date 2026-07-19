import { NextResponse } from 'next/server';

const BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
const CACHE_SECONDS = 86400; // 24 часа

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const telegramId = searchParams.get('telegram_id');

    if (!telegramId) {
      return NextResponse.json({ photo_url: null });
    }

    const tgId = Number(telegramId);
    if (!tgId || !Number.isFinite(tgId) || tgId <= 0) {
      return NextResponse.json({ photo_url: null });
    }

    // Lazy import Supabase
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return NextResponse.json({ photo_url: null });
    const sb = createClient(url, key);

    // Кэш в Supabase (проверяем перед запросом к Telegram)
    const { data: cached } = await sb
      .from('tma_user_avatars')
      .select('photo_url')
      .eq('telegram_id', tgId)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (cached?.photo_url) {
      return NextResponse.json({ photo_url: cached.photo_url }, {
        headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
      });
    }

    if (!BOT_TOKEN) return NextResponse.json({ photo_url: null });

    // Один запрос к Telegram: getUserProfilePhotos + getFile
    const photoRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getUserProfilePhotos?user_id=${tgId}&limit=1`,
    );
    const photoData = await photoRes.json();
    const photo = photoData.result?.photos?.[0];

    if (!photo) return NextResponse.json({ photo_url: null }, {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });

    const bestPhoto = photo[photo.length - 1];
    const fileId: string = bestPhoto.file_id;

    const fileRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`,
    );
    const fileData = await fileRes.json();

    if (!fileData.result?.file_path) {
      return NextResponse.json({ photo_url: null });
    }

    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`;

    // Кэш на 24 часа
    const expiresAt = new Date(Date.now() + CACHE_SECONDS * 1000).toISOString();
    await sb.from('tma_user_avatars').upsert(
      { telegram_id: tgId, photo_url: fileUrl, expires_at: expiresAt },
      { onConflict: 'telegram_id' },
    );

    return NextResponse.json({ photo_url: fileUrl }, {
      headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
    });
  } catch {
    return NextResponse.json({ photo_url: null });
  }
}
