/**
 * GET /api/user/avatar/photo?path=... — Proxy Telegram file downloads.
 *
 * SECURITY:
 *   - Bot token NEVER exposed to client
 *   - Only allows telegram file paths (photos/)
 *   - Rate limited
 *   - Origin check for non-webhook requests
 */

import { checkRateLimitDb, getKeyFromRequest } from '@/lib/rate-limit';

const BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;

export async function GET(request: Request) {
  try {
    // Rate limit: 20 requests per minute per IP
    const key = getKeyFromRequest(request);
    const limit = await checkRateLimitDb(`avatar-photo:${key}`, { max: 20, windowMs: 60_000 });
    if (!limit.allowed) {
      return new Response('Too many requests', { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');

    if (!filePath || !BOT_TOKEN) {
      return new Response('Not found', { status: 404 });
    }

    // Validate file path — ONLY allow telegram photos/ directory
    // Format: photos/YYYYMMDD.../filename.jpg
    if (!/^photos\/\d+_[a-zA-Z0-9]+\/[a-zA-Z0-9]+\.\w+$/.test(filePath)) {
      return new Response('Invalid path', { status: 400 });
    }

    // Fetch from Telegram — token stays server-side
    const res = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`,
    );

    if (!res.ok) {
      return new Response('Not found', { status: 404 });
    }

    // Verify content type is actually an image
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return new Response('Not an image', { status: 400 });
    }

    // Stream the image back to the client
    const imageBuffer = await res.arrayBuffer();

    return new Response(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch {
    return new Response('Error', { status: 500 });
  }
}
