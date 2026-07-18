/**
 * Crypto Bot API — отправка TON через @CryptoBot.
 *
 * Документация: https://help.crypt.bot/crypto-pay-api
 *
 * Метод transfer — GET-запрос с query params.
 * Баланс аккаунта @CryptoBot используется как источник TON.
 */

const CRYPTO_BOT_API = 'https://api.crypt.pay/api/v1';

function getHeaders() {
  return {
    'Crypto-Pay-API-Token': process.env.CRYPTO_SHUTTLE_API_KEY!,
  };
}

export interface SendCryptoRequest {
  /** TON-адрес получателя (кошелёк Fragment) */
  toAddress: string;
  /** Сумма в TON */
  amountTon: string;
  /** Комментарий к транзакции */
  comment: string;
  /** Уникальный ID для идемпотентности */
  idempotencyKey: string;
}

export interface SendCryptoResponse {
  success: boolean;
  txHash?: string;
  billId?: string;
  error?: string;
  errorCode?: string;
}

/**
 * Отправляет TON через Crypto Bot API (метод transfer).
 *
 * Crypto Bot transfer — это GET-запрос:
 *   /transfer?asset=TON&amount=X&address=Y&comment=Z&payload=W
 *
 * Возвращает { ok: true, result: { bill_id, ... } }
 */
export async function sendTonViaShuttle(
  request: SendCryptoRequest,
): Promise<SendCryptoResponse> {
  if (!process.env.CRYPTO_SHUTTLE_API_KEY) {
    return {
      success: false,
      error: 'CRYPTO_SHUTTLE_API_KEY not configured',
      errorCode: 'CONFIG_MISSING',
    };
  }

  try {
    const params = new URLSearchParams({
      asset: 'TON',
      amount: request.amountTon,
      address: request.toAddress,
      comment: request.comment,
      payload: request.idempotencyKey,
    });

    // Crypto Bot transfer — GET с query params
    const res = await fetch(`${CRYPTO_BOT_API}/transfer?${params}`, {
      method: 'GET',
      headers: getHeaders(),
    });

    const data = await res.json();

    if (!data.ok) {
      const errCode = data.error?.code || 'UNKNOWN';
      const errMsg = data.error?.message || JSON.stringify(data.error || data);

      return {
        success: false,
        error: errMsg,
        errorCode: String(errCode),
      };
    }

    // result: { bill_id, status, ... }
    const result = data.result || {};

    return {
      success: true,
      billId: String(result.bill_id || ''),
      txHash: String(result.bill_id || `cb-${Date.now()}`),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      errorCode: 'NETWORK_ERROR',
    };
  }
}

/**
 * Проверяет баланс TON на аккаунте Crypto Bot.
 */
export async function getCryptoBotBalance(): Promise<{ ton: number; usd: number } | null> {
  if (!process.env.CRYPTO_SHUTTLE_API_KEY) return null;

  try {
    const res = await fetch(`${CRYPTO_BOT_API}/getBalances`, {
      method: 'GET',
      headers: getHeaders(),
    });

    const data = await res.json();
    if (!data.ok) return null;

    const balances: Array<{ asset_code: string; available: string; on_hold: string }> =
      data.result || [];

    const ton = balances.find((b) => b.asset_code === 'TON');
    const usd = balances.find((b) => b.asset_code === 'USDT');

    return {
      ton: parseFloat(ton?.available || '0'),
      usd: parseFloat(usd?.available || '0'),
    };
  } catch {
    return null;
  }
}
