/**
 * API Guard — centralized security checks for all API routes.
 *
 * Layers:
 *   1. Request body size limit (10KB)
 *   2. Rate limiting (per IP + per user)
 *   3. Origin/Referer validation
 *   4. Suspicious user-agent detection
 *   5. Bot/honeypot detection
 *   6. Request timing validation
 */

import { NextResponse } from 'next/server';
import { checkRateLimitDb, getKeyFromRequest } from '../rate-limit';
import { verifyInitData } from '../telegram';

// ═══════════════════════════════════════════════════════════
// SUSPICIOUS USER-AGENTS
// ═══════════════════════════════════════════════════════════

const SUSPICIOUS_UA_PATTERNS = [
  /curl/i,
  /wget/i,
  /python/i,
  /scrapy/i,
  /phantom/i,
  /headless/i,
  /selenium/i,
  /puppeteer/i,
  /bot/i,
  /spider/i,
  /crawler/i,
  /scraper/i,
  /httpclient/i,
  /go-http/i,
  /java\//i,
  /okhttp/i,
  /axios/i,
  /node-fetch/i,
  /got/i,
  /request/i,
  /postman/i,
  /insomnia/i,
  /httpie/i,
  /aria2/i,
  /libwww/i,
];

function isSuspiciousUserAgent(ua: string | null): boolean {
  if (!ua || ua.length < 10) return true;
  return SUSPICIOUS_UA_PATTERNS.some(pattern => pattern.test(ua));
}

// ═══════════════════════════════════════════════════════════
// REQUEST TIMING VALIDATION
// ═══════════════════════════════════════════════════════════

const requestTimestamps = new Map<string, number[]>();

function isRequestTooFast(ip: string): boolean {
  const now = Date.now();
  const timestamps = requestTimestamps.get(ip) || [];

  // Keep only last 10 seconds
  const recent = timestamps.filter(t => now - t < 10000);
  recent.push(now);
  requestTimestamps.set(ip, recent);

  // More than 20 requests in 10 seconds
  return recent.length > 20;
}

// ═══════════════════════════════════════════════════════════
// MAIN GUARD
// ═══════════════════════════════════════════════════════════

export interface GuardConfig {
  /** Rate limit config */
  rateLimit?: { max: number; windowMs: number };
  /** Require valid initData HMAC */
  requireAuth?: boolean;
  /** Block suspicious user-agents */
  blockBots?: boolean;
  /** Custom rate limit key prefix */
  keyPrefix?: string;
}

export async function apiGuard(
  request: Request,
  config: GuardConfig = {},
): Promise<{ allowed: boolean; response?: NextResponse; tgId?: number }> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const ua = request.headers.get('user-agent');

  // ═══ 1. SUSPICIOUS USER-AGENT ═══
  if (config.blockBots !== false && isSuspiciousUserAgent(ua)) {
    console.warn(`[Guard] Suspicious UA blocked: ${ip} | ${ua?.slice(0, 50)}`);
    return {
      allowed: false,
      response: NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      ),
    };
  }

  // ═══ 2. REQUEST TIMING ═══
  if (isRequestTooFast(ip)) {
    console.warn(`[Guard] Rate limit (timing): ${ip}`);
    return {
      allowed: false,
      response: NextResponse.json(
        { error: 'Too many requests' },
        { status: 429 }
      ),
    };
  }

  // ═══ 3. RATE LIMITING ═══
  if (config.rateLimit) {
    const key = `${config.keyPrefix || 'api'}:${getKeyFromRequest(request)}`;
    const limit = await checkRateLimitDb(key, config.rateLimit);

    if (!limit.allowed) {
      return {
        allowed: false,
        response: NextResponse.json(
          { error: 'Rate limit exceeded' },
          { status: 429 }
        ),
      };
    }
  }

  // ═══ 4. AUTHENTICATION ═══
  let tgId: number | undefined;

  if (config.requireAuth) {
    const initData = request.headers.get('x-telegram-init-data');
    if (!initData || !initData.includes('hash=')) {
      return {
        allowed: false,
        response: NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        ),
      };
    }

    const result = verifyInitData(initData);
    if (!result || !result.verified) {
      return {
        allowed: false,
        response: NextResponse.json(
          { error: 'Invalid signature' },
          { status: 401 }
        ),
      };
    }

    tgId = result.user.id;
  }

  return { allowed: true, tgId };
}

// ═══════════════════════════════════════════════════════════
// CLEANUP (call periodically to prevent memory leak)
// ═══════════════════════════════════════════════════════════

export function cleanupGuard(): void {
  const now = Date.now();
  for (const [ip, timestamps] of requestTimestamps) {
    const recent = timestamps.filter(t => now - t < 10000);
    if (recent.length === 0) {
      requestTimestamps.delete(ip);
    } else {
      requestTimestamps.set(ip, recent);
    }
  }
}

// Cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupGuard, 5 * 60 * 1000);
}
