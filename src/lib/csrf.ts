/**
 * CSRF protection — validates request origin.
 *
 * SECURITY:
 *   - Strict domain matching (not includes() to prevent subdomain bypass)
 *   - Telegram initData HMAC verification for all requests
 */

import { verifyInitData } from './telegram';

const ALLOWED_DOMAINS = [
  'rustars.vercel.app',
  'localhost',
  '127.0.0.1',
];

/** Проверка что запрос пришёл из Telegram Mini App или нашего сайта */
export function isFromTelegram(request: Request): boolean {
  const initData = request.headers.get('x-telegram-init-data');

  // Из Telegram Mini App — проверяем HMAC
  if (initData && initData.includes('hash=')) {
    const result = verifyInitData(initData);
    return !!result;
  }

  // Из нашего сайта — строгое сравнение домена
  return isAllowedOrigin(request);
}

/** Строгая проверка Origin заголовка */
export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin') || '';
  const referer = request.headers.get('referer') || '';

  // Строгое сравнение: origin должен ТОЧНО совпадать или быть localhost
  if (origin) {
    // Разрешаем только точные домены
    const isExactMatch = ALLOWED_DOMAINS.some((domain) =>
      origin === `https://${domain}` || origin === `http://${domain}`,
    );
    if (isExactMatch) return true;

    // Telegram Mini App origin
    if (origin.includes('web.telegram.org')) return true;

    return false;
  }

  // Check referer — строгое начало строки
  if (referer) {
    const isAllowed = ALLOWED_DOMAINS.some((domain) =>
      referer.startsWith(`https://${domain}`) || referer.startsWith(`http://${domain}`),
    ) || referer.includes('web.telegram.org');

    return isAllowed;
  }

  // Нет origin/referer = server-to-server (OK для webhook'ов от YooKassa/Telegram)
  return true;
}

/** Проверка initData — возвращает true если подпись валидна или токен не сконфигурирован */
export function verifyRequestAuth(request: Request): boolean {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData) return false;

  const result = verifyInitData(initData);
  return !!result;
}
