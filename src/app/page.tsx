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
const PRESETS = [50, 100, 200, 500];

const STATUS: Record<string, { l: string; c: string }> = {
  pending: { l: 'Ожидает', c: '#8E9BAE' }, processing: { l: 'В работе', c: '#F0AD4E' },
  paid: { l: 'Оплачен', c: '#2481cc' }, completed: { l: 'Выдан', c: '#34C759' },
  expired: { l: 'Истёк', c: '#8E9BAE' }, error_fragment: { l: 'Ошибка', c: '#FF3B5C' },
  error_ton: { l: 'Ошибка', c: '#FF3B5C' }, error_stars: { l: 'Ошибка', c: '#FF3B5C' },
  error_balance: { l: 'Ошибка', c: '#FF3B5C' }, blocked: { l: 'Заблокирован', c: '#FF3B5C' },
};

function SIcon({ s }: { s: string }) {
  if (s === 'completed') return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>;
  if (s.startsWith('error_') || s === 'blocked') return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FF3B5C" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>;
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F0AD4E" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
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
  const [tab, setTab] = useState<'topup' | 'history' | 'help'>('topup');
  const [history, setHistory] = useState<OrderHistory[]>([]);
  const [histLoad, setHistLoad] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready(); tg.expand(); setIsTG(true);
      if (tg.user) { setTgId(tg.user.id); setUsername(tg.user.username || tg.user.first_name || ''); }
      else { try { const p = new URLSearchParams(tg.initData); const u = p.get('user'); if (u) { const d = JSON.parse(u); setTgId(d.id); setUsername(d.username || d.first_name || ''); } } catch {} }
    } else setIsTG(false);
  }, []);

  useEffect(() => {
    if (!tgId) return;
    fetch(`/api/user/avatar?telegram_id=${tgId}`).then(r => r.json()).then(d => { if (d.photo_url) setAvatar(d.photo_url); }).catch(() => {});
  }, [tgId]);

  useEffect(() => {
    const n = parseInt(input, 10);
    if (!n || n < 1 || n > 100000) { setPrice(null); setError(''); return; }
    abort.current?.abort(); const c = new AbortController(); abort.current = c;
    let ok = true;
    (async () => { setLoading(true); setError('');
      try { const r = await fetch('/api/prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ starsCount: n }), signal: c.signal });
        if (!r.ok) throw 0; const d: PriceData = await r.json(); if (ok) setPrice(d);
      } catch { if (ok) setError('Не удалось рассчитать'); } finally { if (ok) setLoading(false); }
    })();
    return () => { ok = false; c.abort(); };
  }, [input]);

  useEffect(() => {
    if (tab !== 'history' || !tgId) return;
    setHistLoad(true);
    fetch(`/api/orders/history?telegram_id=${tgId}`).then(r => r.json()).then(d => setHistory(d.orders || [])).catch(() => {}).finally(() => setHistLoad(false));
  }, [tab, tgId]);

  const onPreset = (n: number) => setInput(String(n));
  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => { const v = e.target.value.replace(/[^0-9]/g, ''); if (v === '' || (parseInt(v) >= 1 && parseInt(v) <= 100000)) setInput(v); };

  const onPay = async () => {
    if (!tgId || !price) return; setPaying(true); setError('');
    try { const r = await fetch('/api/orders/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ starsCount: price.starsCount, tgUser: { id: tgId, username } }) });
      if (!r.ok) throw 0; const { paymentUrl } = await r.json(); window.Telegram?.WebApp?.openLink(paymentUrl);
    } catch { setError('Не удалось создать заказ'); } finally { setPaying(false); }
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const initial = username ? username.charAt(0).toUpperCase() : '?';
  const n = parseInt(input, 10);
  const valid = n >= 1 && n <= 100000 && price && username.length > 0;

  if (isTG === null) return <main className={styles.page}><div className={styles.loader}><span className={styles.spinnerLarge} /></div></main>;

  if (!isTG) return (
    <main className={styles.page}><div className={styles.landing}>
      <div className={styles.landingLogo}><div className={styles.landingLogoIcon}><svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 7.1-1.01L12 2z" fill="#fff"/></svg></div><h1 className={styles.landingTitle}>RuStars</h1></div>
      <p className={styles.landingSubtitle}>Мгновенное пополнение Telegram Stars<br />через СБП за секунду</p>
      <div className={styles.landingSteps}>
        <div className={styles.step}><span className={styles.stepNum}>1</span><span className={styles.stepText}>Откройте бота в Telegram</span></div>
        <div className={styles.step}><span className={styles.stepNum}>2</span><span className={styles.stepText}>Введите количество звёзд</span></div>
        <div className={styles.step}><span className={styles.stepNum}>3</span><span className={styles.stepText}>Оплатите через СБП</span></div>
      </div>
      <a href={`https://t.me/${BOT_USERNAME}?startapp`} className={styles.landingButton} target="_blank" rel="noopener noreferrer">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm5.95 7.47l-1.97 9.28c-.15.67-.54.83-1.09.52l-3.02-2.22-1.46 1.4c-.16.16-.3.3-.61.3l.22-3.05 5.56-5.02c.24-.22-.05-.33-.37-.14l-6.87 4.33-2.96-.92c-.64-.2-.66-.64.13-.95l11.55-4.46c.54-.19 1.01.13.83.95z"/></svg>
        Открыть в Telegram
      </a>
      <p className={styles.landingNote}>Доступно только внутри Telegram</p>
    </div></main>
  );

  return (
    <main className={styles.page}>
      {/* ── Header ── */}
      <header className={styles.floatingHeader}>
        <div className={styles.headerRow}>
          <div className={styles.headerLeft}>
            <div className={styles.headerAvatar}>
              {avatar ? <img src={avatar} alt="" className={styles.headerAvatarImg} /> : <div className={styles.headerAvatarFallback}>{initial}</div>}
            </div>
            <span className={styles.headerTitle}>RuStars</span>
          </div>
          <div className={styles.headerRight}>
            <button className={styles.headerBtn}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
            </button>
          </div>
        </div>
        <div className={styles.tabsRow}>
          <div className={styles.tabsPill}>
            <button className={`${styles.tabBtn} ${tab === 'topup' ? styles.tabBtnActive : ''}`} onClick={() => setTab('topup')}>Пополнение</button>
            <button className={`${styles.tabBtn} ${tab === 'history' ? styles.tabBtnActive : ''}`} onClick={() => setTab('history')}>История</button>
            <button className={`${styles.tabBtn} ${tab === 'help' ? styles.tabBtnActive : ''}`} onClick={() => setTab('help')}>Помощь</button>
          </div>
        </div>
      </header>

      {/* ── Content ── */}
      <div className={styles.content}>

        {tab === 'topup' && <>
          <div className={styles.balanceBlock}>
            <div className={styles.balanceLabel}>К оплате</div>
            <div className={`${styles.balanceValue} ${loading ? styles.balanceLoading : ''}`}>
              {price ? price.totalRub : '0'}<span className={styles.balanceCurrency}> ₽</span>
            </div>
            {price && <div className={styles.balanceInfo}><span className={styles.balanceAccent}>{price.perStarRub} ₽</span> за звезду{price.markupPercent < 15 && <span className={styles.discountBadge}>-{15 - price.markupPercent}%</span>}</div>}
            {error && <div className={styles.error}>{error}</div>}
          </div>

          <div className={styles.quickGrid}>
            {PRESETS.map(n => (
              <button key={n} className={`${styles.quickBtn} ${input === String(n) ? styles.quickBtnActive : ''}`} onClick={() => onPreset(n)}>
                <span className={styles.quickBtnNum}>{n}</span>
              </button>
            ))}
          </div>

          <div className={styles.card}>
            <div className={styles.cardRow}>
              <div className={styles.cardIcon}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2l2.4 5.2L20 8l-4 3.9.9 5.6L12 14.8 7.1 17.5 8 11.9 4 8l5.6-.8L12 2z"/></svg></div>
              <div className={styles.cardContent}>
                <div className={styles.cardLabel}>Количество</div>
                <input className={styles.cardInput} type="text" inputMode="numeric" placeholder="Сколько звёзд" value={input} onChange={onInput} />
              </div>
              {input && <span className={styles.cardUnit}>звёзд</span>}
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardRow}>
              <div className={styles.cardIcon}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
              <div className={styles.cardContent}>
                <div className={styles.cardLabel}>Получатель</div>
                <input className={styles.cardInput} type="text" placeholder="@username" value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} />
              </div>
            </div>
          </div>

          <button className={styles.payButton} disabled={!valid || paying} onClick={onPay}>
            {paying ? <><span className={styles.paySpinner} /> Оформление...</> : 'Пополнить через СБП'}
          </button>
        </>}

        {tab === 'history' && <div className={styles.historyPage}>
          <div className={styles.pageTitle}>История</div>
          {histLoad && <div className={styles.historyLoader}><span className={styles.spinnerLarge} /></div>}
          {!histLoad && history.length === 0 && <div className={styles.historyEmpty}><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#3a4255" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><p>Заказов пока нет</p></div>}
          {!histLoad && history.length > 0 && <div className={styles.historyList}>
            {history.map(o => { const st = STATUS[o.status] || { l: o.status, c: '#8E9BAE' }; return (
              <div key={o.id} className={styles.historyItem}>
                <div className={styles.historyLeft}><div className={styles.historyStars}>{o.stars_count} ★</div><div className={styles.historyDate}>{fmtDate(o.created_at)}</div></div>
                <div className={styles.historyRight}><div className={styles.historyAmount}>{o.amount_rub} ₽</div><div className={styles.historyStatus} style={{ color: st.c }}><SIcon s={o.status} />{st.l}</div></div>
              </div>
            ); })}
          </div>}
        </div>}

        {tab === 'help' && <div className={styles.helpPage}>
          <div className={styles.pageTitle}>Помощь</div>
          <div className={styles.helpCard}><div className={styles.helpCardTitle}>Как это работает?</div><p className={styles.helpCardText}>Введите количество звёзд. Система рассчитает стоимость по актуальному курсу TON.</p></div>
          <div className={styles.helpCard}><div className={styles.helpCardTitle}>Оплата</div><p className={styles.helpCardText}>Нажмите «Пополнить через СБП» и выберите банк на странице ЮKassa.</p></div>
          <div className={styles.helpCard}><div className={styles.helpCardTitle}>Пополнение</div><p className={styles.helpCardText}>Звёзды поступают автоматически после оплаты. Обычно 1–5 минут.</p></div>
          <div className={styles.helpCard}><div className={styles.helpCardTitle}>Безопасность</div><p className={styles.helpCardText}>Данные карт не хранятся. Платежи через защищённый шлюз ЮKassa.</p></div>
          <a href={`https://t.me/${SUPPORT}`} className={styles.helpSupport} target="_blank" rel="noopener noreferrer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Связаться с поддержкой
          </a>
        </div>}
      </div>

      {/* ── Bottom Nav ── */}
      <nav className={styles.floatingNav}>
        <button className={`${styles.navItem} ${tab === 'topup' ? styles.navItemActive : ''}`} onClick={() => setTab('topup')}>
          <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          <span className={styles.navLabel}>Пополнение</span>
        </button>
        <button className={`${styles.navItem} ${tab === 'history' ? styles.navItemActive : ''}`} onClick={() => setTab('history')}>
          <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span className={styles.navLabel}>История</span>
        </button>
        <button className={`${styles.navItem} ${tab === 'help' ? styles.navItemActive : ''}`} onClick={() => setTab('help')}>
          <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span className={styles.navLabel}>Помощь</span>
        </button>
      </nav>
    </main>
  );
}
