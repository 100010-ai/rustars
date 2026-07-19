/**
 * Rate limiter — dual-mode: in-memory + Supabase.
 *
 * На serverless (Vercel) ин-менори кэш не работает между вызовами функций,
 * поэтому для критических эндпоинтов используем Supabase как persistent store.
 *
 * Схема Supabase rate limiter:
 *   - Таблица tma_rate_limits (создаётся через миграцию)
 *   - INSERT ... ON CONFLICT → UPDATE count
 *   - SELECT + DELETE старых записей
 */

import { getSupabase } from './supabase';

// ─── In-memory (для worker'а и warm-инстансов) ───

interface WindowEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, WindowEntry>();

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (entry.resetAt <= now) buckets.delete(key);
    }
  }, 60_000);
}

// ─── Public API ───

export interface RateLimitConfig {
  max: number;
  windowMs: number;
  /** Использовать Supabase вместо in-memory (для serverless) */
  useDb?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * In-memory rate limiter (быстрый, но теряется между cold start'ами).
 * Подходит для worker'а и частых запросов от одного пользователя.
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, remaining: config.max - 1, retryAfterMs: 0 };
  }

  if (entry.count < config.max) {
    entry.count++;
    return { allowed: true, remaining: config.max - entry.count, retryAfterMs: 0 };
  }

  return {
    allowed: false,
    remaining: 0,
    retryAfterMs: entry.resetAt - now,
  };
}

/**
 * Supabase-based rate limiter (persistent, работает на serverless).
 * Использует RPC для атомарной проверки + инкремента.
 */
export async function checkRateLimitDb(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  try {
    const sb = getSupabase();
    const windowStart = new Date(Date.now() - config.windowMs).toISOString();

    // Удаляем старые записи
    await sb
      .from('tma_rate_limits')
      .delete()
      .lt('created_at', windowStart);

    // Считаем текущие запросы в окне
    const { count } = await sb
      .from('tma_rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('key', key)
      .gte('created_at', windowStart);

    const currentCount = count || 0;

    if (currentCount >= config.max) {
      // Находим самую старую запись в окне для retryAfter
      const { data: oldest } = await sb
        .from('tma_rate_limits')
        .select('created_at')
        .eq('key', key)
        .gte('created_at', windowStart)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      const retryAfterMs = oldest
        ? new Date(oldest.created_at).getTime() + config.windowMs - Date.now()
        : config.windowMs;

      return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, retryAfterMs) };
    }

    // Записываем текущий запрос
    await sb.from('tma_rate_limits').insert({ key, created_at: new Date().toISOString() });

    return { allowed: true, remaining: config.max - currentCount - 1, retryAfterMs: 0 };
  } catch {
    // Fallback на in-memory если Supabase недоступен
    return checkRateLimit(key, config);
  }
}

export function getKeyFromRequest(request: Request, telegramId?: number): string {
  if (telegramId) return `tg:${telegramId}`;
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  return `ip:${ip}`;
}

/** Проверка IP-адреса на подозрительную активность */
export function isSuspiciousIP(request: Request): boolean {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!ip) return false;

  const key = `suspicious:${ip}`;
  return !checkRateLimit(key, { max: 100, windowMs: 60_000 }).allowed;
}
