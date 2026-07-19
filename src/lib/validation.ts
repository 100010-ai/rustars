/**
 * Валидация входных данных — общие проверки для API-роутов.
 */

/** Валидация Telegram ID */
export function isValidTelegramId(id: unknown): id is number {
  return typeof id === 'number' && Number.isFinite(id) && id > 0 && id < 10000000000;
}

/** Валидация TON-адреса */
export function isValidTonAddress(address: string): boolean {
  return /^[EUQ0][A-Za-z0-9_-]{46}$/.test(address);
}

/** Валидация username (только латиница, цифры, _) */
export function sanitizeUsername(username: string): string {
  return username.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 64);
}

/** Валидация initData (есть ли hash=) */
export function hasValidInitData(initData: string | null | undefined): boolean {
  return !!initData && initData.includes('hash=') && initData.length > 50;
}

/** Валидация email */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Ограничение длины строки */
export function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

/** Очистка от HTML-тегов */
export function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '');
}

/** Проверка на SQL-инъекцию (базовая) */
export function hasSQLInjection(str: string): boolean {
  const patterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|FETCH|DECLARE|TRUNCATE)\b)/i,
    /(--|;|\/\*|\*\/|xp_|sp_)/i,
    /(0x[0-9a-f]+)/i,
  ];
  return patterns.some((p) => p.test(str));
}

/** Безопасный парсинг JSON с лимитом размера */
export async function safeParseJson(request: Request, maxSize = 1024 * 10): Promise<any> {
  const text = await request.text();
  if (text.length > maxSize) {
    throw new Error('Request body too large');
  }
  return JSON.parse(text);
}
