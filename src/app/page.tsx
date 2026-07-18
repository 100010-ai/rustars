'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './page.module.css';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        openLink: (url: string) => void;
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
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [price, setPrice] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'stars' | 'market'>('stars');
  const [history, setHistory] = useState<OrderHistory[]>([]);
  const [histLoad, setHistLoad] = useState(false);
  const abort = useRef<AbortController | null>(null);

  // Telegram init
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready(); tg.expand(); setIsTG(true);
      if (tg.user) { setTgId(tg.user.id); setUsername(tg.user.username || tg.user.first_name || ''); }
      else { try { const p = new URLSearchParams(tg.initData); const u = p.get('user'); if (u) { const d = JSON.parse(u); setTgId(d.id); setUsername(d.username || d.first_name || ''); } } catch {} }
    } else setIsTG(false);
  }, []);

  // Avatar
  useEffect(() => {
    if (!tgId) return;
    fetch(`/api/user/avatar?telegram_id=${tgId}`)
      .then(r => r.json())
      .then(d => { if (d.photo_url) setAvatar(d.photo_url); })
      .catch(() => {})
      .finally(() => setAvatarLoaded(true));
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

  // History (загружаем при первом входе на вкладку)
  useEffect(() => {
    if (tab !== 'stars' || !tgId) return;
    if (history.length > 0) return; // уже загружали
    setHistLoad(true);
    fetch(`/api/orders/history?telegram_id=${tgId}`)
      .then(r => r.json())
      .then(d => setHistory(d.orders || []))
      .catch(() => {})
      .finally(() => setHistLoad(false));
  }, [tab, tgId]);

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
      {/* Cosmic Background */}
      <div className={styles.cosmos}>
        <div className={styles.neonGlow} />
        <div className={styles.stars}>{Array.from({ length: 18 }, (_, i) => <div key={i} className={styles.starsLayer} />)}</div>
      </div>

      {/* Header */}
      <header className={styles.header}>
        {/* Аватар */}
        <div className={styles.headerAvatar}>
          {avatarLoaded ? (
            avatar ? (
              <img src={avatar} alt="" className={styles.headerAvatarImg} />
            ) : (
              <div className={styles.headerAvatarSkeleton} style={{ background: 'linear-gradient(135deg, #2481cc, #1a5fa0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, color: '#fff' }}>{initial}</div>
            )
          ) : (
            <div className={styles.headerAvatarSkeleton} />
          )}
        </div>

        {/* Табы */}
        <div className={styles.headerTabs}>
          <button className={`${styles.headerTab} ${tab === 'stars' ? styles.headerTabActive : ''}`} onClick={() => setTab('stars')}>Звёзды</button>
          <button className={`${styles.headerTab} ${tab === 'market' ? styles.headerTabActive : ''}`} onClick={() => setTab('market')}>Маркет</button>
        </div>

        {/* Подарок / Реферал */}
        <button className={styles.headerGift}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 12 20 22 4 22 4 12"/>
            <rect x="2" y="7" width="20" height="5"/>
            <line x1="12" y1="22" x2="12" y2="7"/>
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
          </svg>
        </button>
      </header>

      {/* Content */}
      <div className={styles.content}>

        {/* === ЗВЁЗДЫ === */}
        {tab === 'stars' && (
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

            {/* История под формой */}
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
        {tab === 'market' && (
          <div className={styles.marketPage}>
            <div className={styles.marketEmpty}>
              <div className={styles.marketEmptyIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
              </div>
              <p>Раздел в разработке</p>
              <span className={styles.marketBadge}>Скоро</span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Nav */}
      <nav className={styles.floatingNav}>
        <button className={`${styles.navItem} ${tab === 'stars' ? styles.navItemActive : ''}`} onClick={() => setTab('stars')}>
          <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          <span className={styles.navLabel}>Пополнение</span>
        </button>
        <button className={`${styles.navItem} ${tab === 'market' ? styles.navItemActive : ''}`} onClick={() => setTab('market')}>
          <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span className={styles.navLabel}>История</span>
        </button>
        <button className={`${styles.navItem}`} onClick={() => {}}>
          <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span className={styles.navLabel}>Помощь</span>
        </button>
      </nav>
    </main>
  );
}
