/**
 * Delivery Service — абстракция для выдачи звёзд/Premium.
 *
 * Архитектура:
 *   1. Заказ оплачен → запись в очередь (tma_delivery_queue)
 *   2. Worker берёт задачу из очереди
 *   3. Получает инвойс Fragment (Puppeteer или API)
 *   4. Отправляет TON через кошелёк
 *   5. Обновляет статус заказа
 *
 * Очередь гарантирует что:
 *   - Нет двойной выдачи (race condition webhook + worker)
 *   - Неоплаченные заказы не теряются
 *   - Есть retry при ошибках
 */

import { getSupabase } from './supabase';

export interface DeliveryJob {
  orderId: string;
  username: string;
  productType: 'stars' | 'premium';
  starsCount: number;
  premiumDuration?: '3m' | '6m' | '12m';
  attempt: number;
  maxAttempts: number;
  status: 'pending' | 'processing' | 'done' | 'failed';
  lastError?: string;
}

/**
 * Ставит задачу в очередь доставки.
 * Вызывается из webhook handler после подтверждения оплаты.
 */
export async function enqueueDelivery(params: {
  orderId: string;
  username: string;
  productType: 'stars' | 'premium';
  starsCount: number;
  premiumDuration?: '3m' | '6m' | '12m';
}): Promise<void> {
  const sb = getSupabase();

  // Проверяем нет ли уже задачи для этого заказа (идемпотентность)
  const { data: existing } = await sb
    .from('tma_delivery_queue')
    .select('id, status')
    .eq('order_id', params.orderId)
    .in('status', ['pending', 'processing'])
    .maybeSingle();

  if (existing) {
    console.log(`[Delivery] Job already exists for order ${params.orderId}, skipping`);
    return;
  }

  const { error } = await sb.from('tma_delivery_queue').insert({
    order_id: params.orderId,
    username: params.username,
    product_type: params.productType,
    stars_count: params.starsCount,
    premium_duration: params.premiumDuration || null,
    attempt: 0,
    max_attempts: 3,
    status: 'pending',
  });

  if (error) {
    console.error('[Delivery] Failed to enqueue:', error);
    throw error;
  }

  console.log(`[Delivery] Enqueued: order=${params.orderId} user=@${params.username} type=${params.productType}`);
}

/**
 * Берёт следующую задачу из очереди (для worker'а).
 */
export async function claimNextJob(): Promise<DeliveryJob | null> {
  const sb = getSupabase();

  // Берём pending задачу с наименьшим количеством попыток
  const { data, error } = await sb
    .from('tma_delivery_queue')
    .select('*')
    .eq('status', 'pending')
    .order('attempt', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  // Помечаем как processing
  const { error: updErr } = await sb
    .from('tma_delivery_queue')
    .update({ status: 'processing', attempt: data.attempt + 1 })
    .eq('id', data.id)
    .eq('status', 'pending');

  if (updErr) return null;

  return {
    orderId: data.order_id,
    username: data.username,
    productType: data.product_type,
    starsCount: data.stars_count,
    premiumDuration: data.premium_duration,
    attempt: data.attempt + 1,
    maxAttempts: data.max_attempts,
    status: 'processing',
  };
}

/**
 * Помечает задачу как выполненную.
 */
export async function markJobDone(orderId: string): Promise<void> {
  const sb = getSupabase();
  await sb
    .from('tma_delivery_queue')
    .update({ status: 'done' })
    .eq('order_id', orderId);
}

/**
 * Помечает задачу как провалившуюся (или ставит retry).
 */
export async function markJobFailed(orderId: string, error: string): Promise<void> {
  const sb = getSupabase();

  const { data: job } = await sb
    .from('tma_delivery_queue')
    .select('attempt, max_attempts')
    .eq('order_id', orderId)
    .maybeSingle();

  if (!job) return;

  if (job.attempt >= job.max_attempts) {
    // Исчерпали попытки — помечаем как failed
    await sb
      .from('tma_delivery_queue')
      .update({ status: 'failed', last_error: error })
      .eq('order_id', orderId);
  } else {
    // Есть попытки — ставим обратно в pending
    await sb
      .from('tma_delivery_queue')
      .update({ status: 'pending', last_error: error })
      .eq('order_id', orderId);
  }
}

/**
 * Получает инвойс Fragment для покупки звёзд.
 *
 * Пока использует Puppeteer. В будущем — прямой API Fragment.
 *
 * TODO: Заменить на Fragment API когда станет доступен.
 * Формат ответа: { address, amountTon, payload }
 */
export async function getFragmentInvoice(
  username: string,
  starsCount: number,
): Promise<{ address: string; amountTon: string; payload: string }> {
  const { buyStarsOnFragment } = await import('@/worker/fragment');
  return buyStarsOnFragment(username, starsCount);
}

/**
 * Получает инвойс Fragment для покупки Premium.
 */
export async function getFragmentPremiumInvoice(
  username: string,
  duration: '3m' | '6m' | '12m',
): Promise<{ address: string; amountTon: string; payload: string }> {
  const { buyPremiumOnFragment } = await import('@/worker/fragment-premium');
  return buyPremiumOnFragment(username, duration);
}
