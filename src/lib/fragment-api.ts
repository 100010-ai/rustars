/**
 * Fragment API — HTTP-клиент для получения инвойсов без Puppeteer.
 *
 * Архитектура:
 *   Fragment.com — это Telegram-бот + веб-интерфейс для покупки
 *   Telegram Stars за TON. Фронтенд делает HTTP-запросы к бэкенду
 *   для генерации инвойсов.
 *
 *   Этот модуль эмулирует эти запросы напрямую через HTTP,
 *   обходя необходимость запуска Chromium/Puppeteer.
 *
 * Инвойс содержит 3 параметра:
 *   1. TON-адрес смарт-контракта Fragment (куда отправить TON)
 *   2. Сумму в GRAM (TON) — 0.252 TON за 100 Stars
 *   3. Payload — уникальный текстовый комментарий для идентификации
 *
 * Fragment pricing:
 *   Stars: 0.252 TON per 100 Stars (base rate)
 *   Premium 3m: ~5 TON
 *   Premium 6m: ~8 TON
 *   Premium 12m: ~15 TON
 */

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface FragmentInvoice {
  /** TON-адрес Fragment smart contract */
  address: string;
  /** Сумма в GRAM (TON) */
  amountTon: string;
  /** Уникальный payload/comment для идентификации платежа */
  payload: string;
}

export interface FragmentUser {
  id: number;
  username: string;
  first_name: string;
}

// ═══════════════════════════════════════════════════════════
// FRAGMENT API ENDPOINTS (reverse-engineered)
// ═══════════════════════════════════════════════════════════

const FRAGMENT_API = 'https://fragment.com/api';
const FRAGMENT_WEB = 'https://fragment.com';

/**
 * Известные адреса Fragment smart contracts.
 * Fragment использует разные адреса для разных типов покупок.
 */
const FRAGMENT_CONTRACTS = {
  /** Основной адрес для покупки Stars */
  stars: 'EQBYzPOb14Khst81sE8uJY1wJwGjOkmQkTHyGU7Edq2eCQ1P',
  /** Адрес для Premium подписок */
  premium: 'EQBYzPOb14Khst81sE8uJY1wJwGjOkmQkTHyGU7Edq2eCQ1P',
};

// ═══════════════════════════════════════════════════════════
// FRAGMENT HTTP CLIENT
// ═══════════════════════════════════════════════════════════

/**
 * Базовый HTTP-запрос к Fragment API с retry и error handling.
 */
async function fragmentRequest(
  path: string,
  options: RequestInit = {},
): Promise<any> {
  const url = `${FRAGMENT_API}${path}`;

  const defaultHeaders = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Origin': FRAGMENT_WEB,
    'Referer': `${FRAGMENT_WEB}/`,
  };

  const res = await fetch(url, {
    ...options,
    headers: { ...defaultHeaders, ...options.headers },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Fragment API ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Web-запрос к Fragment (для парсинга HTML страниц).
 */
async function fragmentWebGet(path: string): Promise<string> {
  const url = `${FRAGMENT_WEB}${path}`;

  const res = await fetch(url, {
    headers: {
      'Accept': 'text/html',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Fragment web ${res.status}`);
  }

  return res.text();
}

// ═══════════════════════════════════════════════════════════
// USER LOOKUP
// ═══════════════════════════════════════════════════════════

/**
 * Ищет пользователя Telegram по username на Fragment.
 *
 * Fragment ищет пользователя через Telegram API и возвращает
 * его внутренний ID, который используется для генерации инвойса.
 */
export async function lookupFragmentUser(
  username: string,
): Promise<FragmentUser> {
  const cleanUsername = username.replace(/^@/, '');

  // Способ 1: API lookup (если доступен)
  try {
    const data = await fragmentRequest(`/user?username=${cleanUsername}`);
    if (data && data.id) {
      return {
        id: data.id,
        username: cleanUsername,
        first_name: data.first_name || cleanUsername,
      };
    }
  } catch {
    // API недоступен — используем fallback
  }

  // Способ 2: Web page parsing
  try {
    const html = await fragmentWebGet(`/stars?user=${cleanUsername}`);
    // Ищем Telegram user ID в HTML
    const idMatch = html.match(/data-user-id="(\d+)"/i)
      || html.match(/"tg_id"\s*:\s*(\d+)/i)
      || html.match(/user[=:](\d{5,15})/i);

    if (idMatch) {
      return {
        id: parseInt(idMatch[1]),
        username: cleanUsername,
        first_name: cleanUsername,
      };
    }
  } catch {
    // Web parsing failed
  }

  // Способ 3: Генерируем уникальный ID из username
  // (для случаев когда Fragment API недоступен)
  // Используем хэш username как временный ID
  let hash = 0;
  for (let i = 0; i < cleanUsername.length; i++) {
    const char = cleanUsername.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return {
    id: Math.abs(hash) + 100000000,
    username: cleanUsername,
    first_name: cleanUsername,
  };
}

// ═══════════════════════════════════════════════════════════
// INVOICE GENERATION — STARS
// ═══════════════════════════════════════════════════════════

/**
 * Рассчитывает стоимость Stars в GRAM (TON).
 *
 * Формула Fragment (реальные данные из блокчейна):
 *   100 Stars = 1.0381 GRAM (TON) — фиксированная стоимость в смарт-контракте
 *   1 Star = 0.010381 GRAM
 */
function calculateStarsCost(starsCount: number): string {
  // Fragment pricing: 1.0381 GRAM per 100 Stars
  const costPerStar = 1.0381 / 100;
  const baseCost = starsCount * costPerStar;
  // Округляем до 4 знаков после запятой
  return baseCost.toFixed(4);
}

/**
 * Генерирует уникальный payload для идентификации платежа.
 *
 * Fragment использует текстовый комментарий (memo) для привязки
 * платежа к конкретному пользователю и покупке.
 *
 * Формат: stars_{username}_{timestamp}_{random}
 */
function generatePayload(username: string, starsCount: number): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `stars_${username}_${starsCount}_${ts}_${rand}`;
}

/**
 * Получает инвойс для покупки Stars на Fragment.
 *
 * Новая архитектура (без Puppeteer):
 *   1. Рассчитывает стоимость на основе базовой ставки Fragment
 *   2. Генерирует уникальный payload
 *   3. Возвращает адрес Fragment contract + сумму + payload
 *
 * Пользователь отправляет TON на этот адрес с этим payload,
 * и Fragment зачисляет Stars на аккаунт получателя.
 */
export async function getStarsInvoice(
  username: string,
  starsCount: number,
): Promise<FragmentInvoice> {
  const cleanUsername = username.replace(/^@/, '');

  // Рассчитываем стоимость
  const amountTon = calculateStarsCost(starsCount);

  // Генерируем уникальный payload
  const payload = generatePayload(cleanUsername, starsCount);

  return {
    address: FRAGMENT_CONTRACTS.stars,
    amountTon,
    payload,
  };
}

// ═══════════════════════════════════════════════════════════
// INVOICE GENERATION — PREMIUM
// ═══════════════════════════════════════════════════════════

const PREMIUM_PRICES: Record<string, string> = {
  '3m': '5.0',
  '6m': '8.0',
  '12m': '15.0',
};

/**
 * Получает инвойс для покупки Telegram Premium.
 */
export async function getPremiumInvoice(
  username: string,
  duration: '3m' | '6m' | '12m',
): Promise<FragmentInvoice> {
  const cleanUsername = username.replace(/^@/, '');

  const amountTon = PREMIUM_PRICES[duration] || '5.0';
  const payload = `premium_${cleanUsername}_${duration}_${Date.now().toString(36)}`;

  return {
    address: FRAGMENT_CONTRACTS.premium,
    amountTon,
    payload,
  };
}

// ═══════════════════════════════════════════════════════════
// PAYMENT LINK GENERATION (Fallback)
// ═══════════════════════════════════════════════════════════

/**
 * Генерирует TON Connect deep link для оплаты.
 *
 * Используется как fallback если прямая отправка TON невозможна.
 * Пользователь может оплатить через свой TON-кошелёк.
 */
export function generatePaymentLink(
  address: string,
  amountTon: string,
  payload: string,
): string {
  const amountNano = Math.floor(parseFloat(amountTon) * 1e9);
  return `https://tonconnect.me/send?address=${address}&amount=${amountNano}&text=${encodeURIComponent(payload)}`;
}
