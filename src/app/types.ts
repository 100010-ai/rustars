export interface TgUser { id: number; username?: string; first_name: string; last_name?: string; photo_url?: string; is_premium?: boolean; }

export interface Price { starsCount: number; totalRub: number; }
export interface Order { id: string; stars_count: number; amount_rub: number; status: string; created_at: string; }
export interface RefStats { invited: number; active: number; earned: number; available: number; rate?: number; recent?: Array<{ username: string; reward: number; date: string }>; }
export interface MItem { address: string; name: string; subtitle: string; image: string | null; type: string; priceRub: number | null; priceTon: number | null; nft?: { slug: string; num: number; lottie: string; still: string }; listing?: { id: string; sellerTgId: number; sellerUsername: string; sellerAvatar?: string } }
export interface Txn { id: string; kind: string; amount_rub: number; status: string; created_at: string; }

export const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || 'RuStarAppbot';
export const QUICK = [50, 100, 250, 500, 1000, 2500];
export const MIN_STARS = 50;
export const MAX_STARS = 100000;
export const DEPOSIT_PRESETS = [500, 1000, 2000, 5000];
export const PREMIUM_PLANS = [
  { id: 'premium_3mo', duration: '3 мес.', durationEn: '3 months', durationCode: '3m' as const, price: 1590, oldPrice: 1990, discount: '-20%', ton: 8.10 },
  { id: 'premium_6mo', duration: '6 мес.', durationEn: '6 months', durationCode: '6m' as const, price: 2190, oldPrice: 3290, discount: '-47%', ton: 10.80 },
  { id: 'premium_1yr', duration: '1 год', durationEn: '1 year', durationCode: '12m' as const, price: 3790, oldPrice: 7990, discount: '-52%', ton: 19.58 },
];
export const fmt = (n: number) => n.toLocaleString('ru-RU');

export const STATUS: Record<string, { l: string; c: string }> = {
  pending: { l: 'Ожидает', c: '#9AA1AD' }, processing: { l: 'В работе', c: '#F59E0B' },
  paid: { l: 'Оплачен', c: '#6C5CE7' }, completed: { l: 'Выдан', c: '#22C55E' },
  expired: { l: 'Истёк', c: '#9AA1AD' }, error_fragment: { l: 'Ошибка', c: '#EF4444' },
  error_ton: { l: 'Ошибка', c: '#EF4444' }, error_stars: { l: 'Ошибка', c: '#EF4444' },
  error_balance: { l: 'Ошибка', c: '#EF4444' }, blocked: { l: 'Заблокирован', c: '#EF4444' },
};

export const MARKET_TABS: Array<{ k: 'nft' | 'usernames' | 'numbers'; l: string }> = [
  { k: 'nft', l: 'NFT' }, { k: 'usernames', l: 'Юзернеймы' }, { k: 'numbers', l: '+888 Номера' },
];

export const TXN_LABEL: Record<string, string> = { deposit: 'Пополнение', referral: 'Реферальный доход', withdraw: 'Вывод', spend: 'Списание', task_reward: 'Задание', review_reward: 'Отзыв' };
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
