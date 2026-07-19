/**
 * GET /api/user/avatar/photo?path=... — Proxy Telegram file downloads.
 *
 * SECURITY: The bot token is NEVER exposed to the client.
 * This endpoint fetches the file from Telegram server-side
 * and streams it back as a response.
 */

const BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');

    if (!filePath || !BOT_TOKEN) {
      return new Response('Not found', { status: 404 });
    }

    // Validate file path — only allow telegram file paths (photos/)
    if (!/^photos\/\d+/.test(filePath)) {
      return new Response('Invalid path', { status: 400 });
    }

    // Fetch from Telegram — token stays server-side
    const res = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`,
    );

    if (!res.ok) {
      return new Response('Not found', { status: 404 });
    }

    // Stream the image back to the client
    const imageBuffer = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'image/jpeg';

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
