/**
 * YooKassa Payouts API — массовые выплаты на банковские карты.
 *
 * Документация: https://yookassa.ru/developers/reference/payouts
 *
 * Flow:
 *   1. Создаём payout через POST /payouts
 *   2. YooKassa возвращает payout_id
 *   3. Ждём webhook от YooKassa о статусе выплаты
 *   4. Обновляем статус в Supabase
 *
 * Безопасность:
 *   - Basic Auth (shop_id:secret_key)
 *   - Idempotency-Key = payout_order.id (защита от двойных выплат)
 *   - Все суммы в копейках (×100)
 */

const YOOKASSA_API = 'https://api.yookassa.ru/v3';

function getAuth(): string {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) throw new Error('YOOKASSA credentials not configured');
  return 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64');
}

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface PayoutParams {
  /** Сумма выплаты в рублях */
  amount: number;
  /** Номер банковской карты (16 цифр) */
  cardNumber: string;
  /** Описание выплаты */
  description?: string;
  /** Идемпотентный ключ (payout_order.id) */
  idempotencyKey: string;
}

export interface PayoutResult {
  id: string;
  status: string;
  amount: number;
  payoutDestination?: string;
  createdAt?: string;
}

export interface PayoutWebhookEvent {
  event: 'payoutucceeded' | 'payoutcanceled';
  object: {
    id: string;
    status: string;
    amount: { value: string; currency: string };
    payout_destination: string;
    created_at: string;
    metadata?: Record<string, string>;
  };
}

// ═══════════════════════════════════════════════════════════
// CREATE PAYOUT
// ═══════════════════════════════════════════════════════════

/**
 * Создаёт выплату на банковскую карту через YooKassa Payouts API.
 *
 * @returns PayoutResult с ID и статусом выплаты
 */
export async function createPayout(params: PayoutParams): Promise<PayoutResult> {
  const { amount, cardNumber, description, idempotencyKey } = params;

  // Проверяем баланс YooKassa кошелька
  const balance = await getYooKassaBalance();
  if (balance < amount) {
    throw new Error(`Insufficient YooKassa balance: ${balance} RUB available, need ${amount} RUB`);
  }

  const res = await fetch(`${YOOKASSA_API}/payouts`, {
    method: 'POST',
    headers: {
      'Authorization': getAuth(),
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      amount: {
        value: amount.toFixed(2),
        currency: 'RUB',
      },
      payout_destination: {
        type: 'bank_card',
        card: {
          number: cardNumber,
        },
      },
      description: description || `RuStars: вывод ${amount}₽`,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`YooKassa Payout error ${res.status}: ${err.description || err.error_type || JSON.stringify(err)}`);
  }

  const data = await res.json();

  return {
    id: data.id,
    status: data.status,
    amount: parseFloat(data.amount?.value || '0'),
    payoutDestination: data.payout_destination?.card?.masked_pan || '',
    createdAt: data.created_at,
  };
}

// ═══════════════════════════════════════════════════════════
// GET PAYOUT STATUS
// ═══════════════════════════════════════════════════════════

/**
 * Получает статус выплаты по ID.
 */
export async function getPayoutStatus(payoutId: string): Promise<PayoutResult> {
  const res = await fetch(`${YOOKASSA_API}/payouts/${payoutId}`, {
    headers: {
      'Authorization': getAuth(),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`YooKassa get payout error ${res.status}: ${JSON.stringify(err)}`);
  }

  const data = await res.json();

  return {
    id: data.id,
    status: data.status,
    amount: parseFloat(data.amount?.value || '0'),
    payoutDestination: data.payout_destination?.card?.masked_pan || '',
    createdAt: data.created_at,
  };
}

// ═══════════════════════════════════════════════════════════
// CHECK BALANCE
// ═══════════════════════════════════════════════════════════

/**
 * Проверяет баланс YooKassa кошелька для выплат.
 */
export async function getYooKassaBalance(): Promise<number> {
  try {
    const res = await fetch(`${YOOKASSA_API}/balances`, {
      headers: {
        'Authorization': getAuth(),
      },
    });

    if (!res.ok) return 0;

    const data = await res.json();
    // Находим RUB баланс
    const rubBalance = data.find((b: any) => b.currency === 'RUB');
    return rubBalance ? parseFloat(rubBalance.available?.value || '0') : 0;
  } catch {
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════
// WEBHOOK VERIFICATION
// ═══════════════════════════════════════════════════════════

/**
 * Верифицирует webhook от YooKassa Payouts.
 *
 * YooKassa не шлёт HMAC в пубхуках.
 * Защита: IP whitelist + повторный запрос статуса через API.
 */
export function verifyPayoutWebhook(request: Request): boolean {
  // Проверяем IP (аналогично payment webhook)
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || '';

  if (ip) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      if (parts[0] === '185' && parts[1] === '70' &&
          (parts[2] === '76' || parts[2] === '77')) {
        return true;
      }
    }
    // IPv6: 2a06:6fc0:...
    if (ip.includes(':') && ip.startsWith('2a06:6fc0:')) {
      return true;
    }
  }

  // localhost для dev
  if (ip === '127.0.0.1' || ip === '::1') {
    return process.env.NODE_ENV !== 'production';
  }

  return false;
}
