/**
 * CSRF-защита через проверку initData и Referer.
 *
 * В Telegram Mini App initData содержит HMAC-подпись,
 * которая гарантирует, что запрос пришёл из Telegram.
 * Для обычных браузеров проверяем Referer.
 */

import { verifyInitData } from './telegram';

/** Проверка что запрос пришёл из Telegram Mini App */
export function isFromTelegram(request: Request): boolean {
  const initData = request.headers.get('x-telegram-init-data');
  const referer = request.headers.get('referer') || '';

  // Из Telegram Mini App — проверяем HMAC
  if (initData && initData.includes('hash=')) {
    const result = verifyInitData(initData);
    return !!result;
  }

  // Из нашего сайта (fallback для non-TG браузера)
  if (referer.includes('rustars.vercel.app') || referer.includes('localhost')) return true;

  return false;
}

/** Проверка Origin заголовка */
export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin') || '';
  const referer = request.headers.get('referer') || '';

  const allowed = ['rustars.vercel.app', 'localhost', '127.0.0.1'];

  return allowed.some(
    (domain) => origin.includes(domain) || referer.includes(domain),
  );
}

/** Проверка initData — возвращает true если подпись валидна или токен не сконфигурирован */
export function verifyRequestAuth(request: Request): boolean {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData) return false;

  const result = verifyInitData(initData);
  return !!result;
}
