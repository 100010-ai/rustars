'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './page.module.css';
import ReferralModal from '@/components/ReferralModal';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        openLink: (url: string) => void;
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
        onEvent: (event: string, callback: () => void) => void;
        safeAreaInset?: { top: number; bottom: number; left: number; right: number };
        initData: string;
        user?: { id: number; username?: string; first_name: string };
      };
    };
  }
}

interface PriceData { starsCount: number; totalRub: number; perStarRub: number; markupPercent: number; }
interface OrderHistory { id: string; stars_count: number; amount_rub: number; status: string; created_at: string; tx_hash: string | null; }

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || 'RuStarsBot';
const SUPPORT = 'RuStarAppbot';

const STATUS: Record<string, { l: string; c: string }> = {
  pending: { l: 'Ожидает', c: '#8E9BAE' }, processing: { l: 'В работе', c: '#F0AD4E' },
  paid: { l: 'Оплачен', c: '#2481cc' }, completed: { l: 'Выдан', c: '#34C759' },
  expired: { l: 'Истёк', c: '#8E9BAE' }, error_fragment: { l: 'Ошибка', c: '#FF3B5C' },
  error_ton: { l: 'Ошибка', c: '#FF3B5C' }, error_stars: { l: 'Ошибка', c: '#FF3B5C' },
  error_balance: { l: 'Ошибка', c: '#FF3B5C' }, blocked: { l: 'Заблокирован', c: '#FF3B5C' },
};

const PACKAGES = [
  { stars: 50, price: 99 },
  { stars: 100, price: 179 },
  { stars: 250, price: 399 },
  { stars: 500, price: 749 },
  { stars: 1000, price: 1449 },
  { stars: 2500, price: 3499 },
];

function SIcon({ s }: { s: string }) {
  if (s === 'completed') return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>;
  if (s.startsWith('error_') || s === 'blocked') return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FF3B5C" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>;
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F0AD4E" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
}

function StarSvg() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="#F0AD4E"><path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 7.1-1.01L12 2z"/></svg>;
}

function BigStar() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="30" fill="#FFF3CD" />
      <path d="M32 12l5.8 11.77L51 25.54l-9 8.78L44.36 48 32 41.54 19.64 48 22 34.32l-9-8.78 13.2-1.77L32 12z" fill="#F0AD4E" stroke="#E5A100" strokeWidth="0.5"/>
    </svg>
  );
}

function GiftSvg() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      <rect x="12" y="28" width="40" height="28" rx="4" fill="#2481cc"/>
      <rect x="28" y="28" width="8" height="28" fill="#FFD700"/>
      <rect x="8" y="20" width="48" height="10" rx="3" fill="#3B82F6"/>
      <rect x="28" y="20" width="8" height="10" fill="#FFD700"/>
      <circle cx="24" cy="18" r="6" fill="#FFD700"/>
      <circle cx="40" cy="18" r="6" fill="#FFD700"/>
      <circle cx="32" cy="16" r="4" fill="#EAB308"/>
    </svg>
  );
}

export default function Home() {
  const [isTG, setIsTG] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [tgId, setTgId] = useState<number | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<number | null>(null);
  const [customInput, setCustomInput] = useState('');
  const [price, setPrice] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'home' | 'referrals' | 'market' | 'profile'>('home');
  const [history, setHistory] = useState<OrderHistory[]>([]);
  const [histLoad, setHistLoad] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [referralStats, setReferralStats] = useState({ invited: 0, earned: 0, paid: 0 });
  const [recentReferrals, setRecentReferrals] = useState<Array<{ username: string; reward: number; date: string }>>([]);
  const [copied, setCopied] = useState(false);
  const [marketTab, setMarketTab] = useState<'usernames' | 'numbers' | 'other'>('usernames');
  const [marketItems, setMarketItems] = useState<Array<{ name: string; type: string; price: number; avatar?: string }>>([]);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) { setIsTG(false); return; }
    tg.ready(); tg.setHeaderColor('#F2F3F5'); tg.setBackgroundColor('#F2F3F5'); tg.expand();
    const applySA = () => { const sa = tg.safeAreaInset; if (sa) { document.documentElement.style.setProperty('--tg-safe-top', `${sa.top}px`); document.documentElement.style.setProperty('--tg-safe-bottom', `${sa.bottom}px`); } };
    applySA(); tg.onEvent('safeAreaChanged', applySA);
    setIsTG(true);
    if (tg.user) { setTgId(tg.user.id); setUsername(tg.user.username || tg.user.first_name || ''); }
    else { try { const p = new URLSearchParams(tg.initData); const u = p.get('user'); if (u) { const d = JSON.parse(u); setTgId(d.id); setUsername(d.username || d.first_name || ''); } } catch {} }
  }, []);

  useEffect(() => { if (!tgId) return; fetch(`/api/user/avatar?telegram_id=${tgId}`).then(r => r.json()).then(d => { if (d.photo_url) setAvatar(d.photo_url); }).catch(() => {}); }, [tgId]);

  // Загрузка цены при выборе пакета
  useEffect(() => {
    const starsCount = selectedPackage || parseInt(customInput, 10);
    if (!starsCount || starsCount < 1 || starsCount > 100000) { setPrice(null); setError(''); return; }
    abort.current?.abort(); const c = new AbortController(); abort.current = c; let ok = true;
    (async () => { setLoading(true); setError(''); try { const r = await fetch('/api/prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ starsCount }), signal: c.signal }); if (!r.ok) throw 0; const d: PriceData = await r.json(); if (ok) setPrice(d); } catch { if (ok) setError('Не удалось рассчитать'); } finally { if (ok) setLoading(false); } })();
    return () => { ok = false; c.abort(); };
  }, [selectedPackage, customInput]);

  useEffect(() => { if (!tgId) return; setHistLoad(true); fetch(`/api/orders/history?telegram_id=${tgId}`).then(r => r.json()).then(d => setHistory(d.orders || [])).catch(() => {}).finally(() => setHistLoad(false)); }, [tgId]);

  const onCustomInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/[^0-9]/g, '');
    if (v === '' || (parseInt(v) >= 1 && parseInt(v) <= 100000)) {
      setCustomInput(v);
      setSelectedPackage(null);
    }
  };

  const selectPackage = (stars: number) => {
    setSelectedPackage(stars);
    setCustomInput('');
  };

  const handlePay = async () => {
    const starsCount = selectedPackage || parseInt(customInput, 10);
    if (!tgId || !starsCount || !username) return;
    setPaying(true); setError('');
    try {
      const r = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starsCount, tgUser: { id: tgId, username } })
      });
      if (!r.ok) throw 0;
      const { paymentUrl } = await r.json();
      window.Telegram?.WebApp?.openLink(paymentUrl);
    } catch { setError('Не удалось создать заказ'); } finally { setPaying(false); }
  };

  const handleCopyLink = async () => {
    const link = `https://t.me/${BOT_USERNAME}?start=ref_${username || 'user'}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const starsCount = selectedPackage || parseInt(customInput, 10);
  const valid = starsCount >= 1 && starsCount <= 100000 && price && username.length > 0;
  const initial = username ? username.charAt(0).toUpperCase() : '?';

  if (isTG === null) return <main className={styles.page}><div className={styles.loader}><span className={styles.spinnerLarge} /></div></main>;

  if (!isTG) return (
    <main className={styles.page}>
      <div className={styles.landing}>
        <div className={styles.landingLogo}>
          <div className={styles.landingLogoIcon}><svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 7.1-1.01L12 2z" fill="#fff"/></svg></div>
          <h1 className={styles.landingTitle}>RuStars</h1>
        </div>
        <p className={styles.landingSubtitle}>Мгновенное пополнение Telegram Stars через СБП</p>
        <div className={styles.landingSteps}>
          <div className={styles.step}><span className={styles.stepNum}>1</span><span className={styles.stepText}>Откройте бота в Telegram</span></div>
          <div className={styles.step}><span className={styles.stepNum}>2</span><span className={styles.stepText}>Выберите количество звёзд</span></div>
          <div className={styles.step}><span className={styles.stepNum}>3</span><span className={styles.stepText}>Оплатите через СБП</span></div>
        </div>
        <a href={`https://t.me/${BOT_USERNAME}?startapp`} className={styles.landingButton} target="_blank" rel="noopener noreferrer">Открыть в Telegram</a>
        <p className={styles.landingNote}>Доступно только внутри Telegram</p>
      </div>
    </main>
  );

  return (
    <main className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          {activeTab !== 'home' ? (
            <button className={styles.headerMenuBtn} onClick={() => setActiveTab('home')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          ) : (
            <div className={styles.headerAvatar} onClick={() => setActiveTab('profile')} style={{ cursor: 'pointer' }}>
              {avatar ? <img src={avatar} alt="" className={styles.headerAvatarImg} /> : <div className={styles.headerAvatarFallback}>{initial}</div>}
            </div>
          )}
        </div>
        <div className={styles.headerTitle}>
          <span className={styles.headerName}>RuStars</span>
          <span className={styles.headerSubtitle}>mini app</span>
        </div>
        <div className={styles.headerRight}>
          <button className={styles.headerMenuBtn}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </button>
        </div>
      </header>

      <div className={styles.content}>
        {/* === ГЛАВНАЯ === */}
        {activeTab === 'home' && (
          <>
            <div className={styles.homeHero}>
              <div className={styles.homeHeroText}>
                <h1 className={styles.homeTitle}>Пополнение Stars</h1>
                <p className={styles.homeSubtitle}>Быстрое и безопасное пополнение Telegram Stars</p>
              </div>
              <div className={styles.homeStarIcon}><BigStar /></div>
            </div>

            <h2 className={styles.sectionTitle}>Выберите количество</h2>
            <div className={styles.packagesGrid}>
              {PACKAGES.map(pkg => (
                <button
                  key={pkg.stars}
                  className={`${styles.packageCard} ${selectedPackage === pkg.stars ? styles.packageCardSelected : ''}`}
                  onClick={() => selectPackage(pkg.stars)}
                >
                  <span className={styles.packageStars}>{pkg.stars} Stars</span>
                  <span className={styles.packagePrice}>{pkg.price} ₽</span>
                </button>
              ))}
            </div>

            <div className={styles.summaryCard}>
              <div className={styles.summaryLeft}>
                <span className={styles.summaryLabel}>Вы получите</span>
                <span className={styles.summaryValue}>
                  <span className={styles.summaryStar}>★</span>
                  {starsCount ? `${starsCount} Stars` : '—'}
                </span>
              </div>
              <div className={styles.summaryRight}>
                <span className={styles.summaryPayLabel}>К оплате</span>
                <span className={styles.summaryPayValue}>{price ? `${price.totalRub} ₽` : '—'}</span>
              </div>
            </div>

            <button className={styles.payBtn} disabled={!valid || paying} onClick={handlePay}>
              {paying ? <span className={styles.paySpinner} /> : `Оплатить ${price ? price.totalRub : ''} ₽`}
            </button>

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.secureNote}>
              <svg className={styles.secureIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Безопасная оплата через СБП
            </div>

            {history.length > 0 && (
              <div className={styles.historySection}>
                <h3 className={styles.historyTitle}>Последние заказы</h3>
                {histLoad ? <div className={styles.historyLoader}><span className={styles.spinnerLarge} /></div> : (
                  <div className={styles.historyList}>
                    {history.slice(0, 5).map(o => { const st = STATUS[o.status] || { l: o.status, c: '#8E9BAE' }; return (
                      <div key={o.id} className={styles.historyItem}>
                        <div className={styles.historyLeft}><div className={styles.historyStars}>{o.stars_count} ★</div><div className={styles.historyDate}>{fmtDate(o.created_at)}</div></div>
                        <div className={styles.historyRight}><div className={styles.historyAmount}>{o.amount_rub} ₽</div><div className={styles.historyStatus} style={{ color: st.c }}><SIcon s={o.status} />{st.l}</div></div>
                      </div>
                    ); })}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* === РЕФЕРАЛЫ === */}
        {activeTab === 'referrals' && (
          <>
            <div className={styles.refHero}>
              <div className={styles.refHeroText}>
                <h1 className={styles.refTitle}>Реферальная программа</h1>
                <p className={styles.refSubtitle}>Приглашайте друзей и получайте вознаграждение</p>
              </div>
              <div className={styles.refGiftIcon}><GiftSvg /></div>
            </div>

            <div className={styles.refLinkCard}>
              <div style={{ flex: 1 }}>
                <div className={styles.refLinkLabel}>Ваша реферальная ссылка</div>
                <div className={styles.refLinkUrl}>https://t.me/{BOT_USERNAME}?start=ref_{username || 'user'}</div>
              </div>
              <button className={`${styles.refCopyBtn} ${copied ? styles.refCopyBtnCopied : ''}`} onClick={handleCopyLink}>
                {copied ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                )}
              </button>
            </div>

            <div className={styles.refStats}>
              <div className={styles.refStatCard}>
                <span className={styles.refStatLabel}>Приглашено</span>
                <span className={styles.refStatValue}>{referralStats.invited}</span>
              </div>
              <div className={styles.refStatCard}>
                <span className={styles.refStatLabel}>Заработано</span>
                <span className={styles.refStatValue}>{referralStats.earned} <span className={styles.refStatStar}>★</span></span>
              </div>
              <div className={styles.refStatCard}>
                <span className={styles.refStatLabel}>Выплачено</span>
                <span className={styles.refStatValue}>{referralStats.paid} <span className={styles.refStatStar}>★</span></span>
              </div>
            </div>

            <div className={styles.refHowSection}>
              <h3 className={styles.refHowTitle}>Как это работает?</h3>
              <div className={styles.refHowSteps}>
                <div className={styles.refHowStep}>
                  <span className={styles.refHowStepNum}>1</span>
                  <span className={styles.refHowStepText}>Приглашайте друзей по своей ссылке</span>
                </div>
                <div className={styles.refHowStep}>
                  <span className={styles.refHowStepNum}>2</span>
                  <span className={styles.refHowStepText}>Друг пополняет Stars</span>
                </div>
                <div className={styles.refHowStep}>
                  <span className={styles.refHowStepNum}>3</span>
                  <span className={styles.refHowStepText}>Получайте 10% от каждой покупки</span>
                </div>
              </div>
            </div>

            {recentReferrals.length > 0 && (
              <>
                <h3 className={styles.refRecentTitle}>Недавние рефералы</h3>
                <div className={styles.refRecentList}>
                  {recentReferrals.map((r, i) => (
                    <div key={i} className={styles.refRecentItem}>
                      <div className={styles.refRecentLeft}>
                        <span className={styles.refRecentName}>@{r.username}</span>
                        <span className={styles.refRecentDate}>{r.date}</span>
                      </div>
                      <span className={styles.refRecentReward}>+{r.reward} <span className={styles.refRecentStar}>★</span></span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* === МАРКЕТ === */}
        {activeTab === 'market' && (
          <>
            <div className={styles.marketHero}>
              <h1 className={styles.marketTitle}>Маркет</h1>
              <p className={styles.marketSubtitle}>Покупайте и продавайте цифровые активы</p>
            </div>

            <div className={styles.marketTabs}>
              <button className={`${styles.marketTab} ${marketTab === 'usernames' ? styles.marketTabActive : ''}`} onClick={() => setMarketTab('usernames')}>Юзернеймы</button>
              <button className={`${styles.marketTab} ${marketTab === 'numbers' ? styles.marketTabActive : ''}`} onClick={() => setMarketTab('numbers')}>+888 Номера</button>
              <button className={`${styles.marketTab} ${marketTab === 'other' ? styles.marketTabActive : ''}`} onClick={() => setMarketTab('other')}>Другое</button>
            </div>

            <div className={styles.marketList}>
              {marketItems.filter(i => i.type === marketTab).map((item, i) => (
                <div key={i} className={styles.marketItem}>
                  <div className={styles.marketItemAvatar}>
                    {item.avatar ? (
                      <img src={item.avatar} alt="" className={styles.marketItemAvatarImg} />
                    ) : (
                      <span className={styles.marketItemAvatarFallback}>{item.name.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <div className={styles.marketItemInfo}>
                    <div className={styles.marketItemName}>{item.name}</div>
                    <span className={styles.marketItemBadge}>NFT</span>
                  </div>
                  <span className={styles.marketItemPrice}>{item.price.toLocaleString('ru-RU')} ₽</span>
                  <svg className={styles.marketItemArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
              ))}
              {marketItems.filter(i => i.type === marketTab).length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '14px' }}>
                  Пусто
                </div>
              )}
            </div>
          </>
        )}

        {/* === ПРОФИЛЬ === */}
        {activeTab === 'profile' && (
          <>
            <div className={styles.profileHeader}>
              <div className={styles.profileAvatar}>
                {avatar ? <img src={avatar} alt="" className={styles.profileAvatarImg} /> : <div className={styles.profileAvatarFallback}>{initial}</div>}
              </div>
              <div className={styles.profileUserInfo}>
                <div className={styles.profileName}>{username || 'Пользователь'}</div>
                <div className={styles.profileUsername}>@{username || 'unknown'}</div>
              </div>
              <svg className={styles.profileArrow} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </div>

            <div className={styles.balanceCard}>
              <div className={styles.balanceLeft}>
                <span className={styles.balanceLabel}>Ваш баланс</span>
                <span className={styles.balanceValue}>
                  <span className={styles.balanceStar}>★</span>
                  320 <span className={styles.balanceCurrency}>Stars</span>
                </span>
              </div>
              <button className={styles.topUpBtn} onClick={() => setActiveTab('home')}>
                + Пополнить
              </button>
            </div>

            <div className={styles.menuList}>
              <button className={styles.menuItem} onClick={() => {}}>
                <div className={styles.menuItemIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </div>
                <span className={styles.menuItemText}>История транзакций</span>
                <svg className={styles.menuItemArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
              <button className={styles.menuItem} onClick={() => {}}>
                <div className={styles.menuItemIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
                </div>
                <span className={styles.menuItemText}>Мои покупки</span>
                <svg className={styles.menuItemArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
              <button className={styles.menuItem} onClick={() => setActiveTab('referrals')}>
                <div className={styles.menuItemIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                </div>
                <span className={styles.menuItemText}>Реферальная программа</span>
                <svg className={styles.menuItemArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
              <button className={styles.menuItem} onClick={() => {}}>
                <div className={styles.menuItemIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                </div>
                <span className={styles.menuItemText}>Настройки</span>
                <svg className={styles.menuItemArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
              <button className={styles.menuItem} onClick={() => {}}>
                <div className={styles.menuItemIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                </div>
                <span className={styles.menuItemText}>Поддержка</span>
                <svg className={styles.menuItemArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
              <button className={styles.menuItem} onClick={() => {}}>
                <div className={styles.menuItemIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                </div>
                <span className={styles.menuItemText}>О RuStars</span>
                <svg className={styles.menuItemArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>

            <button className={styles.logoutBtn}>Выйти</button>
          </>
        )}
      </div>

      {/* Bottom Navigation */}
      <nav className={styles.bottomNav}>
        <button className={`${styles.navItem} ${activeTab === 'home' ? styles.navItemActive : ''}`} onClick={() => setActiveTab('home')}>
          <span className={styles.navIcon}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill={activeTab === 'home' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </span>
          <span className={styles.navLabel}>Главная</span>
        </button>
        <button className={`${styles.navItem} ${activeTab === 'referrals' ? styles.navItemActive : ''}`} onClick={() => setActiveTab('referrals')}>
          <span className={styles.navIcon}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill={activeTab === 'referrals' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
          </span>
          <span className={styles.navLabel}>Рефералы</span>
        </button>
        <button className={`${styles.navItem} ${activeTab === 'market' ? styles.navItemActive : ''}`} onClick={() => setActiveTab('market')}>
          <span className={styles.navIcon}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill={activeTab === 'market' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>
          </span>
          <span className={styles.navLabel}>Маркет</span>
        </button>
        <button className={`${styles.navItem} ${activeTab === 'profile' ? styles.navItemActive : ''}`} onClick={() => setActiveTab('profile')}>
          <span className={styles.navIcon}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill={activeTab === 'profile' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </span>
          <span className={styles.navLabel}>Профиль</span>
        </button>
      </nav>

      <ReferralModal open={referralOpen} onClose={() => setReferralOpen(false)} username={username} />
    </main>
  );
}