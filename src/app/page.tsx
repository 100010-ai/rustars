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
        requestFullscreen?: () => void;
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

function SIcon({ s }: { s: string }) {
  if (s === 'completed') return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>;
  if (s.startsWith('error_') || s === 'blocked') return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FF3B5C" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>;
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F0AD4E" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
}

function StarOrange() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="#F0AD4E"><path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 7.1-1.01L12 2z"/></svg>;
}

export default function Home() {
  const [isTG, setIsTG] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [tgId, setTgId] = useState<number | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [price, setPrice] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'stars' | 'market'>('stars');
  const [history, setHistory] = useState<OrderHistory[]>([]);
  const [histLoad, setHistLoad] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<'inventory' | 'history'>('inventory');
  const [inventoryTab, setInventoryTab] = useState<'gifts' | 'numbers' | 'usernames'>('gifts');
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [inventory, setInventory] = useState<Array<{ type: string; name: string; image: string; address: string; extras?: Record<string, unknown> }>>([]);
  const [invLoad, setInvLoad] = useState(false);
  const abort = useRef<AbortController | null>(null);

  // Telegram init
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) { setIsTG(false); return; }

    tg.ready();
    tg.setHeaderColor('bg_color');
    tg.setBackgroundColor('bg_color');
    tg.expand();

    const applySafeArea = () => {
      const sa = tg.safeAreaInset;
      if (sa) {
        document.documentElement.style.setProperty('--tg-safe-top', `${sa.top}px`);
        document.documentElement.style.setProperty('--tg-safe-bottom', `${sa.bottom}px`);
      }
    };
    applySafeArea();
    tg.onEvent('safeAreaChanged', applySafeArea);

    setIsTG(true);

    if (tg.user) {
      setTgId(tg.user.id);
      setUsername(tg.user.username || tg.user.first_name || '');
    } else {
      try {
        const p = new URLSearchParams(tg.initData);
        const u = p.get('user');
        if (u) { const d = JSON.parse(u); setTgId(d.id); setUsername(d.username || d.first_name || ''); }
      } catch {}
    }
  }, []);

  // Avatar
  useEffect(() => {
    if (!tgId) return;
    fetch(`/api/user/avatar?telegram_id=${tgId}`)
      .then(r => r.json())
      .then(d => { if (d.photo_url) setAvatar(d.photo_url); })
      .catch(() => {});
  }, [tgId]);

  // Price
  useEffect(() => {
    const n = parseInt(input, 10);
    if (!n || n < 1 || n > 100000) { setPrice(null); setError(''); return; }
    abort.current?.abort();
    const c = new AbortController();
    abort.current = c;
    let ok = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const r = await fetch('/api/prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ starsCount: n }), signal: c.signal });
        if (!r.ok) throw 0;
        const d: PriceData = await r.json();
        if (ok) setPrice(d);
      } catch { if (ok) setError('Не удалось рассчитать'); }
      finally { if (ok) setLoading(false); }
    })();
    return () => { ok = false; c.abort(); };
  }, [input]);

  // History
  useEffect(() => {
    if (!tgId) return;
    setHistLoad(true);
    fetch(`/api/orders/history?telegram_id=${tgId}`)
      .then(r => r.json()).then(d => setHistory(d.orders || []))
      .catch(() => {}).finally(() => setHistLoad(false));
  }, [tgId]);

  // Inventory — загружаем когда кошелёк подключен
  useEffect(() => {
    if (!walletConnected || !walletAddress) return;
    setInvLoad(true);
    fetch(`/api/user/inventory?ton_address=${walletAddress}`)
      .then(r => r.json())
      .then(d => setInventory(d.items || []))
      .catch(() => {})
      .finally(() => setInvLoad(false));
  }, [walletConnected, walletAddress]);

  // Имитация подключения кошелька (TON Connect placeholder)
  const handleConnectWallet = () => {
    // TODO: заменить на реальный TonConnect
    setWalletConnected(true);
    setWalletAddress('UQAz8kWV3b4fJx2mN5tL7qR9cD1gH6sY4pK8wE3vB');
  };

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/[^0-9]/g, '');
    if (v === '' || (parseInt(v) >= 1 && parseInt(v) <= 100000)) setInput(v);
  };

  const onPay = async () => {
    if (!tgId || !price || !username) return;
    setPaying(true); setError('');
    try {
      const r = await fetch('/api/orders/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starsCount: price.starsCount, tgUser: { id: tgId, username } }),
      });
      if (!r.ok) throw 0;
      const { paymentUrl } = await r.json();
      window.Telegram?.WebApp?.openLink(paymentUrl);
    } catch { setError('Не удалось создать заказ'); }
    finally { setPaying(false); }
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const n = parseInt(input, 10);
  const valid = n >= 1 && n <= 100000 && price && username.length > 0;
  const initial = username ? username.charAt(0).toUpperCase() : '?';

  // ─── Loading ───
  if (isTG === null) return (
    <main className={styles.page}>
      <div className={styles.loader}><span className={styles.spinnerLarge} /></div>
    </main>
  );

  // ─── Landing ───
  if (!isTG) return (
    <main className={styles.page}>
      <div className={styles.cosmos}>
        <div className={styles.neonGlow} />
        <div className={styles.stars}>{Array.from({ length: 18 }, (_, i) => <div key={i} className={styles.starsLayer} />)}</div>
      </div>
      <div className={styles.landing}>
        <div className={styles.landingLogo}>
          <div className={styles.landingLogoIcon}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 7.1-1.01L12 2z" fill="#fff"/></svg>
          </div>
          <h1 className={styles.landingTitle}>RuStars</h1>
        </div>
        <p className={styles.landingSubtitle}>Мгновенное пополнение Telegram Stars через СБП</p>
        <div className={styles.landingSteps}>
          <div className={styles.step}><span className={styles.stepNum}>1</span><span className={styles.stepText}>Откройте бота в Telegram</span></div>
          <div className={styles.step}><span className={styles.stepNum}>2</span><span className={styles.stepText}>Введите количество звёзд</span></div>
          <div className={styles.step}><span className={styles.stepNum}>3</span><span className={styles.stepText}>Оплатите через СБП</span></div>
        </div>
        <a href={`https://t.me/${BOT_USERNAME}?startapp`} className={styles.landingButton} target="_blank" rel="noopener noreferrer">Открыть в Telegram</a>
        <p className={styles.landingNote}>Доступно только внутри Telegram</p>
      </div>
    </main>
  );

  // ─── Mini App ───
  return (
    <main className={styles.page}>
      <div className={styles.cosmos}>
        <div className={styles.neonGlow} />
        <div className={styles.stars}>{Array.from({ length: 18 }, (_, i) => <div key={i} className={styles.starsLayer} />)}</div>
      </div>

      {/* Header */}
      <header className={styles.header}>
        {isProfileOpen ? (
          <>
            <button className={styles.headerBack} onClick={() => setIsProfileOpen(false)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div className={styles.headerTabs}>
              <span className={styles.headerTabActive}>Профиль</span>
            </div>
            <div style={{ width: 36 }} />
          </>
        ) : (
          <>
            <div className={styles.headerAvatar} onClick={() => setIsProfileOpen(true)} style={{ cursor: 'pointer' }}>
              {avatar ? <img src={avatar} alt="" className={styles.headerAvatarImg} /> : <div className={styles.headerAvatarFallback}>{initial}</div>}
            </div>
            <div className={styles.headerTabs}>
              <button className={`${styles.headerTab} ${tab === 'stars' ? styles.headerTabActive : ''}`} onClick={() => setTab('stars')}>Звёзды</button>
              <button className={`${styles.headerTab} ${tab === 'market' ? styles.headerTabActive : ''}`} onClick={() => setTab('market')}>Маркет</button>
            </div>
            <button className={styles.headerGift} onClick={() => setReferralOpen(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>
            </button>
          </>
        )}
      </header>

      {/* Content */}
      <div className={styles.content}>

        {/* === ПРОФИЛЬ === */}
        {isProfileOpen && (
          <div className={styles.profilePage}>
            {/* Юзер */}
            <div className={styles.profileUser}>
              <div className={styles.profileAvatar}>
                {avatar ? <img src={avatar} alt="" className={styles.profileAvatarImg} /> : <div className={styles.profileAvatarFallback}>{initial}</div>}
              </div>
              <div className={styles.profileUserInfo}>
                <div className={styles.profileName}>{username || 'Пользователь'}</div>
                <div className={styles.profileUsername}>@{username || 'unknown'}</div>
              </div>
            </div>

            {/* Баланс / TON */}
            <div className={styles.profileWallet}>
              <div className={styles.walletRow}>
                <div>
                  <div className={styles.walletLabel}>Баланс</div>
                  <div className={styles.walletBalance}>0.00 <span className={styles.walletCurrency}>TON</span></div>
                </div>
                <div className={styles.walletRight}>
                  <div className={styles.walletAddress}>Не подключен</div>
                </div>
              </div>
              <button className={styles.walletBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
                Подключить Tonkeeper
              </button>
            </div>

            {/* Вкладки */}
            <div className={styles.profileTabs}>
              <button className={`${styles.profileTab} ${profileTab === 'inventory' ? styles.profileTabActive : ''}`} onClick={() => setProfileTab('inventory')}>Инвентарь</button>
              <button className={`${styles.profileTab} ${profileTab === 'history' ? styles.profileTabActive : ''}`} onClick={() => setProfileTab('history')}>История</button>
            </div>

            {/* Инвентарь */}
            {profileTab === 'inventory' && (
              <div>
                {/* TON Connect */}
                {!walletConnected ? (
                  <div className={styles.tonConnectWrap}>
                    <button className={styles.walletBtn} onClick={handleConnectWallet}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
                      Подключить Tonkeeper
                    </button>
                  </div>
                ) : (
                  <>
                    <div className={styles.profileWallet} style={{ marginBottom: 12 }}>
                      <div className={styles.walletRow}>
                        <div>
                          <div className={styles.walletLabel}>Кошелёк</div>
                          <div className={styles.walletAddress} style={{ fontSize: 12 }}>{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</div>
                        </div>
                      </div>
                    </div>

                    {/* Подвкладки инвентаря */}
                    <div className={styles.invTabs}>
                      <button className={`${styles.invTab} ${inventoryTab === 'gifts' ? styles.invTabActive : ''}`} onClick={() => setInventoryTab('gifts')}>Подарки</button>
                      <button className={`${styles.invTab} ${inventoryTab === 'numbers' ? styles.invTabActive : ''}`} onClick={() => setInventoryTab('numbers')}>Номера</button>
                      <button className={`${styles.invTab} ${inventoryTab === 'usernames' ? styles.invTabActive : ''}`} onClick={() => setInventoryTab('usernames')}>Юзернеймы</button>
                    </div>

                    {/* Загрузка */}
                    {invLoad && <div className={styles.historyLoader}><span className={styles.spinnerLarge} /></div>}

                    {/* Пусто */}
                    {!invLoad && inventory.filter(i => i.type === inventoryTab).length === 0 && (
                      <div className={styles.profileEmpty}>
                        <p>Пусто</p>
                      </div>
                    )}

                    {/* === ПОДАРКИ (сетка 2 колонки) === */}
                    {!invLoad && inventoryTab === 'gifts' && (
                      <div className={styles.profileGrid}>
                        {inventory.filter(i => i.type === 'gift').map((item) => (
                          <div key={item.address} className={styles.nftCard}>
                            <div className={styles.nftPreview}>
                              {item.extras?.animation_url ? (
                                <video className={styles.nftPreviewImg} autoPlay loop muted playsInline src={item.extras.animation_url as string} />
                              ) : item.image ? (
                                <img src={item.image} alt="" className={styles.nftPreviewImg} />
                              ) : (
                                <div className={styles.nftGiftBg} style={{ background: (item.extras?.bg_color as string) || '#1a3a6e' }}>🎁</div>
                              )}
                            </div>
                              <div className={styles.nftInfo}>
                                <div className={styles.nftName}>{item.name}</div>
                                {typeof item.extras?.number === 'string' && <div className={`${styles.nftType} ${styles.nftTypeGift}`}>#{item.extras.number}</div>}
                              </div>
                            <button className={styles.nftSellBtn}>Продать за рубли</button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* === НОМЕРА (список плашек) === */}
                    {!invLoad && inventoryTab === 'numbers' && (
                      <div className={styles.invList}>
                        {inventory.filter(i => i.type === 'number').map((item) => (
                          <div key={item.address} className={styles.invRow}>
                            <div className={styles.invRowIcon}>
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2481cc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
                            </div>
                            <div className={styles.invRowText}>{item.name}</div>
                            <button className={styles.invRowBtn} title="Продать">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* === ЮЗЕРНЕЙМЫ (список плашек) === */}
                    {!invLoad && inventoryTab === 'usernames' && (
                      <div className={styles.invList}>
                        {inventory.filter(i => i.type === 'username').map((item) => (
                          <div key={item.address} className={`${styles.invRow} ${styles.invRowPurple}`}>
                            <div className={styles.invRowText}>{item.name}</div>
                            <button className={styles.invRowBtn} title="Продать">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* История */}
            {profileTab === 'history' && (
              <div className={styles.profileHistory}>
                {histLoad && <div className={styles.historyLoader}><span className={styles.spinnerLarge} /></div>}
                {!histLoad && history.length === 0 && (
                  <div className={styles.profileEmpty}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3a4255" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <p>Нет операций</p>
                  </div>
                )}
                {!histLoad && history.length > 0 && (
                  <div className={styles.historyList}>
                    {history.map(o => {
                      const st = STATUS[o.status] || { l: o.status, c: '#8E9BAE' };
                      return (
                        <div key={o.id} className={styles.historyItem}>
                          <div className={styles.historyLeft}>
                            <div className={styles.historyStars}>{o.stars_count} ★</div>
                            <div className={styles.historyDate}>{fmtDate(o.created_at)}</div>
                          </div>
                          <div className={styles.historyRight}>
                            <div className={styles.historyAmount}>{o.amount_rub} ₽</div>
                            <div className={styles.historyStatus} style={{ color: st.c }}><SIcon s={o.status} />{st.l}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* === ЗВЁЗДЫ === */}
        {!isProfileOpen && tab === 'stars' && (
          <>
            <div className={styles.widget}>
              <div className={styles.brand}>
                <div className={styles.brandTitle}>Звезды Telegram</div>
                <div className={styles.brandPrice}>
                  1 ★ = <span className={styles.brandPriceAccent}>{price ? `${price.perStarRub} ₽` : '...'}</span>
                </div>
              </div>
              <div className={styles.field}>
                <input className={styles.fieldInput} type="text" placeholder="Имя пользователя" value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} />
              </div>
              <div className={styles.starsField}>
                <input className={styles.starsInput} type="text" inputMode="numeric" placeholder="Кол-во" value={input} onChange={onInput} />
                <div className={styles.starsIcon}><StarOrange /></div>
              </div>
              <button className={styles.payBtn} disabled={!valid || paying} onClick={onPay}>
                {paying ? <><span className={styles.paySpinner} /></> : `Оплатить ${price ? price.totalRub : ''} ₽`}
              </button>
            </div>
            {error && <div className={styles.error}>{error}</div>}
            {history.length > 0 && (
              <div className={styles.historySection}>
                <div className={styles.historyTitle}>Последние заказы</div>
                {histLoad ? (
                  <div className={styles.historyLoader}><span className={styles.spinnerLarge} /></div>
                ) : (
                  <div className={styles.historyList}>
                    {history.slice(0, 5).map(o => {
                      const st = STATUS[o.status] || { l: o.status, c: '#8E9BAE' };
                      return (
                        <div key={o.id} className={styles.historyItem}>
                          <div className={styles.historyLeft}>
                            <div className={styles.historyStars}>{o.stars_count} ★</div>
                            <div className={styles.historyDate}>{fmtDate(o.created_at)}</div>
                          </div>
                          <div className={styles.historyRight}>
                            <div className={styles.historyAmount}>{o.amount_rub} ₽</div>
                            <div className={styles.historyStatus} style={{ color: st.c }}><SIcon s={o.status} />{st.l}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* === МАРКЕТ === */}
        {!isProfileOpen && tab === 'market' && (
          <div className={styles.marketScreen}>
            <div className={styles.marketRocket}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#2481cc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/>
                <path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/>
                <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
                <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
              </svg>
            </div>
            <h2 className={styles.marketTitle}>P2P Маркет в разработке 🚀</h2>
            <p className={styles.marketDesc}>
              Совсем скоро здесь откроется полноценный маркетплейс.<br />
              Вы сможете безопасно продавать и покупать<br />
              Telegram Gifts, анонимные номера и юзернеймы<br />
              напрямую за рубли по СБП.
            </p>
            <div className={styles.marketComingBadge}>Скоро</div>
          </div>
        )}
      </div>

      <ReferralModal open={referralOpen} onClose={() => setReferralOpen(false)} username={username} />
    </main>
  );
}
