/**
 * GET /api/user/avatar?telegram_id=... — Proxy Telegram avatar.
 *
 * SECURITY:
 *   - Never returns raw Telegram file URLs (they contain bot token)
 *   - Proxies image data server-side
 *   - Returns /api/user/avatar/[id]/photo.jpg for caching
 *   - Rate limited
 */

import { NextResponse } from 'next/server';
import { checkRateLimit, getKeyFromRequest } from '@/lib/rate-limit';

const BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
const CACHE_SECONDS = 86400;

export async function GET(request: Request) {
  try {
    // Rate limit: 10 requests per minute per IP
    const key = getKeyFromRequest(request);
    const limit = checkRateLimit(`avatar:${key}`, { max: 10, windowMs: 60_000 });
    if (!limit.allowed) {
      return NextResponse.json({ photo_url: null }, {
        headers: { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) },
      });
    }

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
    const key2 = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key2) return NextResponse.json({ photo_url: null });
    const sb = createClient(url, key2);

    // Check cache — stored as /api/user/avatar/[tgId]/photo.jpg
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

    // Fetch profile photo from Telegram API
    const photoRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getUserProfilePhotos?user_id=${tgId}&limit=1`,
    );
    const photoData = await photoRes.json();
    const photo = photoData.result?.photos?.[0];

    if (!photo) {
      return NextResponse.json({ photo_url: null }, {
        headers: { 'Cache-Control': 'public, max-age=3600' },
      });
    }

    const bestPhoto = photo[photo.length - 1];
    const fileId: string = bestPhoto.file_id;

    // Get file path from Telegram
    const fileRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`,
    );
    const fileData = await fileRes.json();

    if (!fileData.result?.file_path) {
      return NextResponse.json({ photo_url: null });
    }

    // SECURITY: Store proxy URL, NOT raw Telegram URL
    // The proxy endpoint will fetch and forward the image
    const proxyUrl = `/api/user/avatar/photo?path=${encodeURIComponent(fileData.result.file_path)}`;

    // Cache the proxy URL
    const expiresAt = new Date(Date.now() + CACHE_SECONDS * 1000).toISOString();
    await sb.from('tma_user_avatars').upsert(
      { telegram_id: tgId, photo_url: proxyUrl, expires_at: expiresAt },
      { onConflict: 'telegram_id' },
    );

    return NextResponse.json({ photo_url: proxyUrl }, {
      headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
    });
  } catch {
    return NextResponse.json({ photo_url: null });
  }
}
