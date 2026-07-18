/**
 * Fragment — покупка звёзд через Crypto Bot transfer.
 *
 * Fragment не имеет API. Схема:
 *   1. Fragment показывает TON-адрес и сумму для оплаты
 *   2. Мы отправляем TON на этот адрес через Crypto Bot transfer
 *   3. Fragment начисляет звёзды пользователю
 *
 * Проблема: Fragment генерирует уникальный адрес + сумму при каждом
 * заказе, и получить их без браузера невозможно.
 *
 * Решение: Используем Fragment через headless-автоматизацию (Puppeteer),
 * которая работает в отдельном воркере, а не в API-роуте (timeout 10s).
 *
 * Fallback: Если Puppeteer недоступен, шлём в админ-чат ручной алерт.
 */

export interface FragmentInvoice {
  /** TON-адрес инвойса */
  address: string;
  /** Сумма в TON */
  amountTon: string;
}

/**
 * Заглушка: реальная реализация через Puppeteer в worker.ts.
 * В API-роуте вызывать нельзя — слишком долгая операция.
 *
 * Схема (реализована в src/worker/fragment.ts):
 *   1. Открываем fragment.com/stars
 *   2. Вводим @username и количество звёзд
 *   3. Нажимаем Buy
 *   4. Парсим TON-адрес и сумму со страницы подтверждения
 *   5. Возвращаем invoice
 */
export async function getFragmentInvoice(
  _username: string,
  _starsCount: number,
): Promise<FragmentInvoice> {
  // Этот код НЕ используется в текущей архитектуре.
  // Реальная логика — в worker.ts (Puppeteer automation).
  // Если вызван из webhook — значит что-то пошло не так.
  throw new Error(
    'Fragment invoice must be obtained via worker (Puppeteer). ' +
    'This endpoint should not be called directly.',
  );
}

/**
 * Извлекает инвойс из кэша worker'а.
 * Worker пишет результат Puppeteer-сессии в Supabase,
 * а webhook читает оттуда.
 */
export async function getFragmentInvoiceFromDB(
  orderId: string,
): Promise<FragmentInvoice | null> {
  // Worker сохраняет invoice в поле error_message или отдельную таблицу
  // Пока — заглушка, пока worker не реализован
  return null;
}
