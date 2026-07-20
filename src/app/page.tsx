'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './page.module.css';
import { useTonConnect } from '@/components/tonconnect/useTonConnect';
import HomeTab from '@/components/tabs/HomeTab';
import ReferralsTab from '@/components/tabs/ReferralsTab';
import TasksTab from '@/components/tabs/TasksTab';
import MarketTab from '@/components/tabs/MarketTab';
import ProfileTab from '@/components/tabs/ProfileTab';
import BottomNav from '@/components/BottomNav';
import { getStarRate } from '@/lib/referral';
import { MIN_STARS, MAX_STARS, PREMIUM_PLANS } from './types';
import type { Price, Order, RefStats, MItem, Txn } from './types';

declare global {
  interface Window {
    Telegram?: { WebApp?: {
      ready: () => void; expand: () => void; openLink: (u: string) => void; close: () => void;
      setHeaderColor: (c: string) => void; setBackgroundColor: (c: string) => void;
      onEvent: (e: string, cb: () => void) => void;
      HapticFeedback?: { impactOccurred?: (s: string) => void; notificationOccurred?: (s: string) => void };
      safeAreaInset?: { top: number; bottom: number; left: number; right: number };
      initData: string;
      initDataUnsafe?: { user?: { id: number; username?: string; first_name: string; last_name?: string; photo_url?: string; is_premium?: boolean }; start_param?: string };
    }; };
  }
}

type Tab = 'home' | 'referrals' | 'tasks' | 'market' | 'profile';

export default function Home() {
  const tonConnect = useTonConnect();
  const [isTG, setIsTG] = useState<boolean | null>(null);
  const [tgId, setTgId] = useState<number | null>(null);
  const [initData, setInitData] = useState('');
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  const [isPro, setIsPro] = useState(false);

  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [activeProduct, setActiveProduct] = useState<'stars' | 'premium'>('stars');
  const [selectedPremium, setSelectedPremium] = useState<string | null>(null);

  const [recipient, setRecipient] = useState('');
  const [amountStars, setAmountStars] = useState('');
  const [price, setPrice] = useState<Price | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<Order[]>([]);
  const [stock, setStock] = useState<{ available: number; tonBalance: number | null; warning: boolean } | null>(null);

  const [refStats, setRefStats] = useState<RefStats>({ invited: 0, active: 0, earned: 0, available: 0, rate: 0.1 });
  const [copied, setCopied] = useState(false);

  const [balance, setBalance] = useState(0);
  const [balanceTxns, setBalanceTxns] = useState<Txn[]>([]);

  const [walletItems, setWalletItems] = useState<MItem[]>([]);
  const [walletLoading, setWalletLoading] = useState(false);
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);
  const [tonBalance, setTonBalance] = useState<number | null>(null);
  const [tonPrice, setTonPrice] = useState<number>(0);

  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2500);
  }, []);
  const haptic = (t: 'light' | 'medium' | 'success' | 'error' = 'light') => {
    const h = window.Telegram?.WebApp?.HapticFeedback;
    if (!h) return;
    if (t === 'success' || t === 'error') h.notificationOccurred?.(t); else h.impactOccurred?.(t);
  };

  const refLink = `https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME || 'RuStarAppbot'}?startapp=ref_${tgId || ''}`;

  // ─── Init Telegram ───
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isTelegramDomain = window.location.hostname === 'web.telegram.org' ||
      window.location.hostname.endsWith('.telegram.org');

    const hasTgScript = !!document.querySelector('script[src*="telegram-web-app.js"]');

    if (!hasTgScript && !isTelegramDomain) {
      setIsTG(false);
      return;
    }

    // We're in Telegram — show UI IMMEDIATELY
    setIsTG(true);

    // Load SDK and user data in background (with retry)
    const loadUser = (): boolean => {
      const tg = window.Telegram?.WebApp;
      if (!tg) return false;

      const u = tg.initDataUnsafe?.user;
      if (!u || !u.id) return false;

      // ─── User data found — populate all fields ───
      tg.ready();
      tg.setHeaderColor('#F5F6FA');
      tg.setBackgroundColor('#F5F6FA');
      tg.expand();

      const applySA = () => {
        const sa = tg.safeAreaInset;
        if (sa) {
          document.documentElement.style.setProperty('--tg-safe-top', `${sa.top}px`);
          document.documentElement.style.setProperty('--tg-safe-bottom', `${sa.bottom}px`);
        }
      };
      applySA();
      tg.onEvent('safeAreaChanged', applySA);

      setInitData(tg.initData || '');
      setTgId(u.id);
      setUsername(u.username || '');
      setRecipient(u.username || '');
      setFirstName(u.first_name || '');
      setLastName(u.last_name || '');
      setIsPremium(!!u.is_premium);

      if (u.photo_url) {
        setAvatar(u.photo_url);
        const img = new Image();
        img.onload = () => { try { localStorage.setItem(`avatar_${u.id}`, u.photo_url!); } catch {} };
        img.src = u.photo_url;
      }

      const sp = tg.initDataUnsafe?.start_param;
      if (sp && sp.startsWith('ref_')) {
        fetch('/api/referrals/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referrerId: sp.slice(4), initData: tg.initData }),
        }).catch(() => {});
      }

      // Sync to Supabase
      fetch('/api/users/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: u.id,
          first_name: u.first_name || '',
          last_name: u.last_name || '',
          username: u.username || '',
        }),
      }).catch(() => {});

      return true;
    };

    // Retry until user data is available
    let retries = 0;
    const tryLoad = () => {
      if (loadUser()) return;
      if (retries < 50) {
        retries++;
        setTimeout(tryLoad, 200);
      }
    };
    tryLoad();
  }, []);

  // ─── Avatar: preload + retry + localStorage cache ───
  useEffect(() => {
    if (!tgId) return;

    // 1. Try localStorage first (instant)
    const cached = typeof window !== 'undefined' ? localStorage.getItem(`avatar_${tgId}`) : null;
    if (cached) {
      setAvatar(cached);
      // Preload in background to verify it's still valid
      const img = new Image();
      img.onload = () => {}; // still valid
      img.onerror = () => {
        // Cached URL is stale — refetch
        setAvatar(null);
        try { localStorage.removeItem(`avatar_${tgId}`); } catch {}
      };
      img.src = cached;
      return;
    }

    // 2. Fetch from API with retry
    const fetchAvatar = (attempt: number) => {
      fetch(`/api/user/avatar?telegram_id=${tgId}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.photo_url) {
            // Preload image to verify it loads
            const img = new Image();
            img.onload = () => {
              setAvatar(d.photo_url);
              try { localStorage.setItem(`avatar_${tgId}`, d.photo_url); } catch {}
            };
            img.onerror = () => {
              // Image URL broken — retry once
              if (attempt < 2) setTimeout(() => fetchAvatar(attempt + 1), 1000);
            };
            img.src = d.photo_url;
          }
        })
        .catch(() => {
          if (attempt < 2) setTimeout(() => fetchAvatar(attempt + 1), 1000);
        });
    };

    if (!avatar) fetchAvatar(0);
  }, [tgId]);

  // ─── PRO status ───
  useEffect(() => {
    if (!tgId) return;
    fetch(`/api/user/balance?telegram_id=${tgId}`, { headers: { 'x-telegram-init-data': initData } })
      .then((r) => r.json())
      .then((d) => { if (d.is_pro) setIsPro(true); })
      .catch(() => {});
  }, [tgId, initData]);

  // ─── Price: Stars → RUB ───
  useEffect(() => {
    const stars = parseInt(amountStars, 10);
    if (!stars || stars < MIN_STARS) { setPrice(null); setError(''); return; }
    if (stars > MAX_STARS) { setPrice(null); setError(`Максимум ${MAX_STARS.toLocaleString('ru-RU')} звёзд`); return; }
    const rate = getStarRate(stars);
    const totalRub = Math.ceil(stars * rate);
    setPrice({ starsCount: stars, totalRub });
  }, [amountStars]);

  const loadHistory = useCallback(() => {
    if (!tgId) return;
    fetch(`/api/orders/history?telegram_id=${tgId}`).then((r) => r.json())
      .then((d) => setHistory(d.orders || [])).catch(() => {});
  }, [tgId]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const loadStock = useCallback(() => {
    fetch('/api/stock/check').then((r) => r.json())
      .then((d) => setStock(d)).catch(() => {});
  }, []);
  useEffect(() => { if (activeTab === 'home') loadStock(); }, [activeTab, loadStock]);

  const loadRefStats = useCallback(() => {
    if (!tgId) return;
    fetch(`/api/referrals/stats?telegram_id=${tgId}`, { headers: { 'x-telegram-init-data': initData } })
      .then((r) => r.json()).then((d) => setRefStats(d)).catch(() => {});
  }, [tgId, initData]);
  useEffect(() => { if (activeTab === 'referrals') loadRefStats(); }, [activeTab, loadRefStats]);

  const loadBalance = useCallback(() => {
    if (!tgId) return;
    fetch(`/api/user/balance?telegram_id=${tgId}`, { headers: { 'x-telegram-init-data': initData } })
      .then((r) => r.json()).then((d) => { setBalance(Number(d.balance_rub || 0)); setBalanceTxns(d.txns || []); })
      .catch(() => {});
  }, [tgId, initData]);
  useEffect(() => { if (activeTab === 'profile' || activeTab === 'home') loadBalance(); }, [activeTab, loadBalance]);

  // ─── Wallet ───
  const loadWallet = useCallback(() => {
    if (!tgId) return;
    fetch(`/api/market/wallet-items?telegram_id=${tgId}`)
      .then((r) => r.json())
      .then((d) => {
        setConnectedWallet(d.wallet || null);
        setWalletItems(d.items || []);
        if (d.wallet) {
          fetch(`https://tonapi.io/v2/accounts/${d.wallet}`)
            .then((r) => r.json())
            .then((acc) => { setTonBalance((acc.balance?.coins || 0) / 1e9); })
            .catch(() => setTonBalance(null));
        } else { setTonBalance(null); }
      })
      .catch(() => {});
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd')
      .then((r) => r.json())
      .then((d) => setTonPrice(d['the-open-network']?.usd || 0))
      .catch(() => {});
  }, [tgId]);
  useEffect(() => { if (activeTab === 'profile' && tgId) loadWallet(); }, [activeTab, tgId, loadWallet]);

  const handleConnectWallet = async () => {
    if (!tonConnect.address || !tgId) return;
    haptic('medium');
    try {
      const r = await fetch('/api/market/connect-wallet', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: tonConnect.address, initData }),
      });
      if (!r.ok) { const d = await r.json(); showToast(d.error || 'Ошибка'); return; }
      showToast('Кошелёк подключён');
      loadWallet();
    } catch { showToast('Не удалось подключить'); }
  };

  // ─── Payment ───
  const handlePay = async () => {
    if (activeProduct === 'premium') { handlePayPremium(); return; }
    const stars = price?.starsCount || 0;
    if (!stars) return;

    if (stock && stars > stock.available) {
      setError('Данный объём временно закончился на складе. Попробуйте выбрать пакет поменьше или зайдите через 10 минут!');
      haptic('error');
      return;
    }

    haptic('medium'); setPaying(true); setError('');
    try {
      const r = await fetch('/api/orders/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starsCount: stars, tgUser: { id: tgId || 0, username: recipient || username || '' }, method: 'sbp' }),
      });
      if (!r.ok) throw 0;
      const d = await r.json();
      if (isTG) { window.Telegram?.WebApp?.openLink(d.paymentUrl); }
      else { window.location.href = d.paymentUrl; }
    } catch { setError('Не удалось создать заказ'); haptic('error'); }
    finally { setPaying(false); }
  };

  const handlePayPremium = async () => {
    const plan = PREMIUM_PLANS.find((p) => p.id === selectedPremium);
    if (!plan) return;

    haptic('medium'); setPaying(true); setError('');
    try {
      const r = await fetch('/api/orders/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starsCount: 0, tgUser: { id: tgId || 0, username: recipient || username || '' }, product_type: plan.id, premium_duration: plan.durationCode, amountStars: plan.price }),
      });
      if (!r.ok) throw 0;
      const { paymentUrl } = await r.json();
      if (isTG) { window.Telegram?.WebApp?.openLink(paymentUrl); }
      else { window.location.href = paymentUrl; }
    } catch { setError('Не удалось создать заказ'); haptic('error'); }
    finally { setPaying(false); }
  };

  const openSupport = () => window.Telegram?.WebApp?.openLink(`https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME || 'RuStarAppbot'}`);

  if (isTG === null) return <main className={styles.page}><div className={styles.loader}><span className={styles.spinner} /></div></main>;

  // Non-TG browser view
  if (!isTG) return (
    <main className={styles.page}>
      <div className={styles.content}>
        <div className={styles.topbar}>
          <div className={styles.brand}><span className={styles.brandStar}>★</span><span className={styles.brandName}>RuStars</span></div>
        </div>
        <HomeTab
          activeProduct={activeProduct} setActiveProduct={setActiveProduct}
          recipient={recipient} setRecipient={setRecipient}
          amountStars={amountStars} setAmountStars={setAmountStars}
          price={price} selectedPremium={selectedPremium} setSelectedPremium={setSelectedPremium}
          paying={paying} error={error} balance={balance} stock={stock} history={history}
          haptic={haptic} handlePay={handlePay}
        />
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 24, fontSize: 13, color: 'var(--text-muted)' }}>
          <a href="/offer" style={{ color: 'inherit' }}>Оферта</a>
          <a href="/contacts" style={{ color: 'inherit' }}>Контакты</a>
          <a href={`https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME || 'RuStarAppbot'}`} style={{ color: 'inherit' }}>Поддержка</a>
        </div>
      </div>
    </main>
  );

  // TG Mini App view
  return (
    <main className={styles.page}>
      <div className={styles.content}>
        {activeTab === 'home' && (
          <>
            <div className={styles.topbar}>
              <div className={styles.brand}><span className={styles.brandStar}>★</span><span className={styles.brandName}>RuStars</span></div>
            </div>
            <HomeTab
              activeProduct={activeProduct} setActiveProduct={setActiveProduct}
              recipient={recipient} setRecipient={setRecipient}
              amountStars={amountStars} setAmountStars={setAmountStars}
              price={price} selectedPremium={selectedPremium} setSelectedPremium={setSelectedPremium}
              paying={paying} error={error} balance={balance} stock={stock} history={history}
              haptic={haptic} handlePay={handlePay}
            />
          </>
        )}
        {activeTab === 'referrals' && (
          <ReferralsTab
            tgId={tgId} initData={initData} refStats={refStats} copied={copied}
            haptic={haptic} showToast={showToast} loadRefStats={loadRefStats} loadBalance={loadBalance}
          />
        )}
        {activeTab === 'tasks' && (
          <TasksTab initData={initData} tgId={tgId} haptic={haptic} showToast={showToast} loadBalance={loadBalance} />
        )}
        {activeTab === 'market' && (
          <MarketTab haptic={haptic} />
        )}
        {activeTab === 'profile' && (
          <ProfileTab
            tgId={tgId} initData={initData} username={username} firstName={firstName} lastName={lastName}
            avatar={avatar} isPremium={isPremium} isPro={isPro} balance={balance} balanceTxns={balanceTxns}
            history={history} haptic={haptic} showToast={showToast} loadBalance={loadBalance}
            connectedWallet={connectedWallet} walletItems={walletItems} walletLoading={walletLoading}
            tonBalance={tonBalance} tonPrice={tonPrice} tonConnect={tonConnect}
            handleConnectWallet={handleConnectWallet} loadWallet={loadWallet}
          />
        )}
      </div>

      <BottomNav activeTab={activeTab} isTG={isTG} haptic={haptic} setActiveTab={setActiveTab} />

      {toast && <div className={styles.toast}>{toast}</div>}

      {/* Honeypot — invisible link for bot detection */}
      <a href="/api/honeypot" style={{ position: 'absolute', left: '-9999px', top: '-9999px', opacity: 0, pointerEvents: 'none' }} aria-hidden="true" tabIndex={-1}>
       itemap
      </a>
    </main>
  );
}
