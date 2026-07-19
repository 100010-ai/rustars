/**
 * Telegram Mini App — валидация и разбор initData.
 *
 * Документация: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * initData приходит от клиента как urlencoded-строка. Мы проверяем HMAC-подпись
 * секретным ключом бота, чтобы гарантировать, что telegram_id действительно
 * принадлежит текущему пользователю (нельзя подделать чужой id).
 */

import crypto from 'crypto';

export interface TgUser {
  id: number;
  username: string | null;
  first_name: string;
  last_name?: string;
  photo_url?: string | null;
  is_premium?: boolean;
}

/** Токен для вычисления HMAC. Приоритет — выделенный токен мини-аппа. */
function getBotToken(): string | null {
  return (
    process.env.TELEGRAM_MINIAPP_BOT_TOKEN ||
    process.env.ADMIN_BOT_TOKEN ||
    null
  );
}

/**
 * Строгий режим: HMAC enforcement active when ANY bot token is configured.
 * If token is set, we verify initData signature. Reject if invalid.
 * This prevents identity spoofing even when TELEGRAM_MINIAPP_BOT_TOKEN
 * is not explicitly set (falls back to ADMIN_BOT_TOKEN).
 */
function isStrict(): boolean {
  return !!getBotToken();
}

/** Разбирает user-объект из initData без проверки подписи. */
export function parseInitData(initData: string): TgUser | null {
  try {
    const params = new URLSearchParams(initData);
    const userRaw = params.get('user');
    if (!userRaw) return null;
    const u = JSON.parse(userRaw);
    if (typeof u.id !== 'number') return null;
    return {
      id: u.id,
      username: u.username || null,
      first_name: u.first_name || '',
      last_name: u.last_name,
      photo_url: u.photo_url || null,
      is_premium: !!u.is_premium,
    };
  } catch {
    return null;
  }
}

/**
 * Проверяет подпись initData и возвращает пользователя, если она валидна.
 *
 * Если токен бота не сконфигурирован — деградируем мягко и возвращаем
 * разобранного пользователя без крипто-проверки (чтобы не блокировать
 * работающее приложение). В продакшене токен должен быть задан.
 */
export function verifyInitData(
  initData: string,
): { user: TgUser; verified: boolean } | null {
  if (!initData) return null;

  const token = getBotToken();
  const parsed = parseInitData(initData);
  if (!parsed) return null;

  if (!token) {
    return { user: parsed, verified: false };
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { user: parsed, verified: false };

    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(token)
      .digest();
    const computed = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    const verified = crypto.timingSafeEqual(
      Buffer.from(computed, 'hex'),
      Buffer.from(hash, 'hex'),
    );

    return { user: parsed, verified };
  } catch {
    return { user: parsed, verified: false };
  }
}

/**
 * Достаёт валидированный telegram_id из тела/квери запроса.
 * Приоритет: подписанный initData. Фолбэк: явный telegram_id (для GET-чтения).
 *
 * enforce=true — требуем валидную подпись (для денежных операций,
 * если токен бота сконфигурирован).
 */
export function resolveTelegramUser(
  initData: string | null | undefined,
  fallbackId?: number | string | null,
  enforce = false,
): { id: number; user: TgUser | null } | null {
  if (initData) {
    const res = verifyInitData(initData);
    if (res) {
      if (enforce && isStrict() && !res.verified) {
        console.warn('[telegram] initData signature INVALID — rejecting for tg', res.user.id);
        return null; // Блокируем запрос при невалидной подписи
      }
      return { id: res.user.id, user: res.user };
    }
  }

  // Fallback только если enforce=false
  if (!enforce && fallbackId != null && fallbackId !== '') {
    const id = Number(fallbackId);
    if (Number.isFinite(id) && id > 0) return { id, user: null };
  }

  return null;
}
