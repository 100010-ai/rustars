/**
 * In-memory rate limiter без внешних зависимостей.
 *
 * Алгоритм: sliding window counter.
 * Ключ — string (telegram_id или IP).
 * Лимиты задаются вызывающим кодом.
 */

interface WindowEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, WindowEntry>();

// Очистка каждые 60 сек, чтобы не утекала память
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}, 60_000);

export interface RateLimitConfig {
  /** Максимальное количество запросов за окно */
  max: number;
  /** Длина окна в миллисекундах */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Проверяет, не превышен ли лимит для данного ключа.
 * Если нет — инкрементирует счётчик и разрешает.
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const entry = buckets.get(key);

  // Новое окно или окно истекло
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, remaining: config.max - 1, retryAfterMs: 0 };
  }

  // Окно ещё активно
  if (entry.count < config.max) {
    entry.count++;
    return { allowed: true, remaining: config.max - entry.count, retryAfterMs: 0 };
  }

  // Лимит превышен
  return {
    allowed: false,
    remaining: 0,
    retryAfterMs: entry.resetAt - now,
  };
}

/**
 * Возвращает ключ по telegram_id или по IP из заголовков запроса.
 */
export function getKeyFromRequest(request: Request, telegramId?: number): string {
  if (telegramId) return `tg:${telegramId}`;

  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  return `ip:${ip}`;
}
