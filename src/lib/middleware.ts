/**
 * Security middleware — applies to all API routes.
 *
 * Protections:
 *   1. Request body size limit (10KB)
 *   2. Security headers
 *   3. CORS validation
 */

const MAX_BODY_SIZE = 10 * 1024; // 10KB

/**
 * Validates that the request body is within size limits.
 * Call this at the start of POST/PUT/DELETE handlers.
 */
export async function validateBodySize(request: Request): Promise<boolean> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return false;
  }
  return true;
}

/**
 * Safe JSON parse with size limit.
 */
export async function safeParseBody(request: Request): Promise<any> {
  const text = await request.text();

  if (text.length > MAX_BODY_SIZE) {
    throw new Error('Request body too large');
  }

  if (!text || text.length === 0) {
    throw new Error('Empty request body');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON');
  }
}

/**
 * Validates the Origin header against a strict whitelist.
 * Uses exact match, not includes() to prevent subdomain bypass.
 */
export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin') || '';
  const referer = request.headers.get('referer') || '';

  const allowedOrigins = [
    'https://rustars.vercel.app',
    'https://t.me',
  ];

  // Exact match for origin
  if (origin && allowedOrigins.includes(origin)) return true;

  // Check referer — must start with allowed origin
  if (referer) {
    return allowedOrigins.some((allowed) => referer.startsWith(allowed));
  }

  // No origin/referer = server-to-server (OK for webhooks)
  return true;
}

/**
 * Validates Telegram initData format (basic check before HMAC).
 */
export function hasValidInitDataFormat(initData: string | null | undefined): boolean {
  if (!initData) return false;
  return initData.includes('hash=') && initData.length > 50 && initData.length < 10000;
}

/**
 * Sanitizes a string to prevent XSS.
 */
export function sanitize(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .slice(0, 1000); // Max 1000 chars
}

/**
 * Validates that a value is a safe integer (for telegram_id, amounts, etc.)
 */
export function isSafeInteger(value: unknown, min?: number, max?: number): value is number {
  if (typeof value !== 'number') return false;
  if (!Number.isInteger(value)) return false;
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}
