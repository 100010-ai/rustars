/**
 * Реферальная ставка — плоские 10% от суммы покупки приглашённого.
 */
export const REFERRAL_RATE = 0.1;

/**
 * Прогрессивный курс звезды (единая логика для фронта и бэка).
 * Чем больше звёзд — тем дешевле за штуку.
 */
export function getStarRate(stars: number): number {
  if (stars <= 100) return 1.48;
  if (stars <= 500) return 1.42;
  if (stars <= 1000) return 1.38;
  return 1.35;
}
