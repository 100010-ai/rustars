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
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#F0AD4E">
      <path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 7.1-1.01L12 2z"/>
    </svg>
  );
}

export default function Home() {
  const [isTG, setIsTG] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [tgId, setTgId] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [price, setPrice] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'topup' | 'history' | 'help'>('topup');
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
    if (tab !== 'history' || !tgId) return;
    setHistLoad(true);
    fetch(`/api/orders/history?telegram_id=${tgId}`).then(r => r.json()).then(d => setHistory(d.orders || [])).catch(() => {}).finally(() => setHistLoad(false));
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

  // ─── Loading ───
  if (isTG === null) return (
    <main className={styles.page}>
      <div className={styles.loader}><span className={styles.spinnerLarge} /></div>
    </main>
  );

  // ─── Landing ───
  if (!isTG) return (
    <main className={styles.page}>
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
        <a href={`https://t.me/${BOT_USERNAME}?startapp`} className={styles.landingButton} target="_blank" rel="noopener noreferrer">
          Открыть в Telegram
        </a>
        <p className={styles.landingNote}>Доступно только внутри Telegram</p>
      </div>
    </main>
  );

  // ─── Mini App ───
  return (
    <main className={styles.page}>
      {/* ── Cosmic Background ── */}
      <div className={styles.cosmos}>
        <div className={styles.neonGlow} />
        <div className={styles.stars}>
          {Array.from({ length: 18 }, (_, i) => (
            <div key={i} className={styles.starsLayer} />
          ))}
        </div>
      </div>

      {/* === ПОПОЛНЕНИЕ === */}
      {tab === 'topup' && (
        <div className={styles.content}>
          <div className={styles.widget}>
            {/* Брендинг */}
            <div className={styles.brand}>
              <div className={styles.brandTitle}>Звезды Telegram</div>
              <div className={styles.brandPrice}>
                1 ★ = <span className={styles.brandPriceAccent}>{price ? `${price.perStarRub} ₽` : '...'}</span>
              </div>
            </div>

            {/* Никнейм */}
            <div className={styles.field}>
              <input
                className={styles.fieldInput}
                type="text"
                placeholder="Имя пользователя"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
              />
            </div>

            {/* Количество */}
            <div className={styles.starsField}>
              <input
                className={styles.starsInput}
                type="text"
                inputMode="numeric"
                placeholder="Кол-во"
                value={input}
                onChange={onInput}
              />
              <div className={styles.starsIcon}><StarOrange /></div>
            </div>

            {/* Кнопка */}
            <button className={styles.payBtn} disabled={!valid || paying} onClick={onPay}>
              {paying ? <><span className={styles.paySpinner} /></> : `Оплатить ${price ? price.totalRub : ''} ₽`}
            </button>
          </div>

          {error && <div className={styles.error}>{error}</div>}
        </div>
      )}

      {/* === ИСТОРИЯ === */}
      {tab === 'history' && (
        <div className={styles.content}>
          <div className={styles.historyPage}>
            <div className={styles.pageTitle}>История</div>
            {histLoad && <div className={styles.historyLoader}><span className={styles.spinnerLarge} /></div>}
            {!histLoad && history.length === 0 && (
              <div className={styles.historyEmpty}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#3a4255" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <p>Заказов пока нет</p>
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
        </div>
      )}

      {/* === ПОМОЩЬ === */}
      {tab === 'help' && (
        <div className={styles.content}>
          <div className={styles.helpPage}>
            <div className={styles.pageTitle}>Помощь</div>
            <div className={styles.helpCard}><div className={styles.helpCardTitle}>Как это работает?</div><p className={styles.helpCardText}>Введите количество звёзд. Система рассчитает стоимость по актуальному курсу.</p></div>
            <div className={styles.helpCard}><div className={styles.helpCardTitle}>Оплата</div><p className={styles.helpCardText}>Нажмите «Оплатить» и выберите банк на странице ЮKassa.</p></div>
            <div className={styles.helpCard}><div className={styles.helpCardTitle}>Пополнение</div><p className={styles.helpCardText}>Звёзды поступают автоматически. Обычно 1–5 минут.</p></div>
            <div className={styles.helpCard}><div className={styles.helpCardTitle}>Безопасность</div><p className={styles.helpCardText}>Данные карт не хранятся. Платежи через ЮKassa.</p></div>
            <a href={`https://t.me/${SUPPORT}`} className={styles.helpSupport} target="_blank" rel="noopener noreferrer">Связаться с поддержкой</a>
          </div>
        </div>
      )}

      {/* === Bottom Nav === */}
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
