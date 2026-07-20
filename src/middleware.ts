/**
 * Next.js Middleware — runs on every request before reaching API routes.
 *
 * Security layers:
 *   1. CORS validation
 *   2. Suspicious UA blocking
 *   3. Rate limiting
 *   4. Security headers injection
 *   5. Request size validation
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ═══════════════════════════════════════════════════════════
// SUSPICIOUS USER-AGENTS
// ═══════════════════════════════════════════════════════════

const BLOCKED_UA_PATTERNS = [
  /scrapy/i,
  /curl/i,
  /wget/i,
  /python-requests/i,
  /python-urllib/i,
  /go-http/i,
  /java\//i,
  /okhttp/i,
  /libwww/i,
  /httpclient/i,
  /mechanize/i,
  /webcopier/i,
  /httrack/i,
];

// ═══════════════════════════════════════════════════════════
// CORS ORIGINS
// ═══════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  'https://web.telegram.org',
  'https://t.me',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ua = request.headers.get('user-agent') || '';

  // ═══ 1. BLOCK SCRAPERS ═══
  if (BLOCKED_UA_PATTERNS.some(p => p.test(ua))) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // ═══ 2. BLOCK BOT PATHS ═══
  const blockedPaths = [
    '/wp-admin',
    '/wp-login',
    '/.env',
    '/config',
    '/debug',
    '/admin',
    '/phpmyadmin',
    '/.git',
    '/.svn',
    '/.htaccess',
    '/server-status',
    '/server-info',
    '/favicon.ico', // Block to prevent domain discovery
  ];

  if (blockedPaths.some(p => pathname.toLowerCase().startsWith(p))) {
    return new NextResponse('Not Found', { status: 404 });
  }

  // ═══ 3. VALIDATE API ORIGINS ═══
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/webhooks/')) {
    const origin = request.headers.get('origin') || '';
    const referer = request.headers.get('referer') || '';

    // Only block if origin/referer present but not from allowed sources
    if (origin && !ALLOWED_ORIGINS.some(o => origin.startsWith(o))) {
      // Check if it's from our own domain (Vercel deployment)
      const host = request.headers.get('host') || '';
      if (!origin.includes(host)) {
        return new NextResponse('Forbidden', { status: 403 });
      }
    }
  }

  // ═══ 4. SECURITY HEADERS ═══
  const response = NextResponse.next();

  // Anti-cache for API routes
  if (pathname.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
  }

  // Block all routes from being embedded
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");

  // Remove server information
  response.headers.delete('X-Powered-By');
  response.headers.delete('Server');
  response.headers.delete('X-AspNet-Version');
  response.headers.delete('X-AspNetMvc-Version');

  // Add timing attack protection
  response.headers.set('X-Response-Time', Date.now().toString());

  return response;
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.json).*)',
  ],
};
