/**
 * YooKassa — чистые fetch-запросы без SDK.
 *
 * Документация: https://yookassa.ru/developers/api
 * Авторизация: Basic Auth (shop_id:secret_key)
 */

const YOOKASSA_API = 'https://api.yookassa.ru/v3';

function getAuth(): string {
  const shopId = process.env.YOOKASSA_SHOP_ID!;
  const secretKey = process.env.YOOKASSA_SECRET_KEY!;
  return 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64');
}

export interface CreatePaymentParams {
  /** Сумма в рублях */
  amount: number;
  /** Описание заказа */
  description: string;
  /** Метаданные (orderId для связи с our DB) */
  metadata: Record<string, string>;
  /** URL для редиректа после оплаты */
  confirmationUrl: string;
  /** URL для вебхука от ЮKassa */
  webhookUrl: string;
  /** Способ оплаты: СБП или банковская карта */
  method?: 'sbp' | 'bank_card';
}

export interface YooKassaPayment {
  id: string;
  status: string;
  confirmation?: { confirmation_url: string };
  metadata?: Record<string, string>;
}

/**
 * Создаёт платёж в ЮKassa с типом СБП.
 */
export async function createYooKassaPayment(
  params: CreatePaymentParams,
): Promise<YooKassaPayment> {
  const res = await fetch(`${YOOKASSA_API}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: getAuth(),
      'Idempotence-Key': params.metadata.orderId,
    },
    body: JSON.stringify({
      amount: {
        value: params.amount.toFixed(2),
        currency: 'RUB',
      },
      confirmation: {
        type: 'redirect',
        return_url: params.confirmationUrl,
      },
      capture: true,
      description: params.description,
      payment_method_data: {
        type: params.method || 'sbp',
      },
      metadata: params.metadata,
      receipt: {
        items: [
          {
            description: params.description,
            quantity: '1',
            amount: {
              value: params.amount.toFixed(2),
              currency: 'RUB',
            },
            vat_code: 1,
            payment_mode: 'full_prepayment',
            payment_subject: 'service',
          },
        ],
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `YooKassa error ${res.status}: ${err.description || err.error_type || JSON.stringify(err)}`,
    );
  }

  return res.json();
}

/**
 * Получает платёж по ID из ЮKassa.
 */
export async function getYooKassaPayment(paymentId: string): Promise<YooKassaPayment> {
  const res = await fetch(`${YOOKASSA_API}/payments/${paymentId}`, {
    headers: { Authorization: getAuth() },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`YooKassa get payment error ${res.status}: ${JSON.stringify(err)}`);
  }

  return res.json();
}

/**
 * Верификация webhook-уведомления от ЮKassa.
 *
 * ВАЖНО: ЮKassa НЕ шлёт HMAC-подпись в вебхуках.
 * Основная защита — IP whitelist + повторный запрос статуса через YooKassa API.
 *
 * Эта функция опционально проверяет Authorization header если он есть.
 * Не является основным средством защиты — webhook handler использует:
 *   1. IP whitelist (YooKassa IP: 185.70.76.x, 185.70.77.x)
 *   2. Re-fetch payment status через YooKassa API (verifyPayment)
 *   3. Idempotency check (duplicate payment_id rejection)
 */
export function verifyYooKassaWebhook(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;

  if (!shopId || !secretKey) return false;

  const expectedAuth = 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64');

  // Если заголовок авторизации отсутствует — это нормально для YooKassa.
  // Основная защита — IP whitelist в webhook handler.
  if (!authHeader) return true;

  // Если заголовок есть — он должен совпадать
  return authHeader === expectedAuth;
}
