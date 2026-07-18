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
        user?: {
          id: number;
          username?: string;
          first_name: string;
        };
      };
    };
  }
}

interface PriceData {
  starsCount: number;
  totalRub: number;
  perStarRub: number;
  markupPercent: number;
}

interface OrderHistory {
  id: string;
  stars_count: number;
  amount_rub: number;
  status: string;
  created_at: string;
  tx_hash: string | null;
}

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || 'RuStarsBot';
const SUPPORT_USERNAME = 'RuStarAppbot';

const PRESETS = [50, 100, 500];

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending:    { label: 'Ожидает',   color: '#8E9BAE' },
  processing: { label: 'В работе',  color: '#F0AD4E' },
  paid:       { label: 'Оплачен',   color: '#2481cc' },
  completed:  { label: 'Выдан',     color: '#34C759' },
  expired:    { label: 'Истёк',     color: '#8E9BAE' },
  error_fragment: { label: 'Ошибка', color: '#FF3B5C' },
  error_ton:  { label: 'Ошибка',    color: '#FF3B5C' },
  error_stars:{ label: 'Ошибка',    color: '#FF3B5C' },
  error_balance: { label: 'Ошибка', color: '#FF3B5C' },
  blocked:    { label: 'Заблокирован', color: '#FF3B5C' },
};

// ─── SVG Иконки ───

function StarIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 7.1-1.01L12 2z" fill="#2481cc"/>
    </svg>
  );
}

function StarSmall() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2.4 5.2L20 8l-4 3.9.9 5.6L12 14.8 7.1 17.5 8 11.9 4 8l5.6-.8L12 2z"/>
    </svg>
  );
}

function StarsInputIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.4 5.2L20 8l-4 3.9.9 5.6L12 14.8 7.1 17.5 8 11.9 4 8l5.6-.8L12 2z"/>
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  );
}

function NavHomeIcon() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}

function NavHistoryIcon() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

function NavHelpIcon() {
  return (
    <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F0AD4E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF3B5C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="15" y1="9" x2="9" y2="15"/>
      <line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckIcon />;
  if (status.startsWith('error_') || status === 'blocked') return <ErrorIcon />;
  return <ClockIcon />;
}

// ─── Page ───

export default function Home() {
  const [isTelegram, setIsTelegram] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [telegramId, setTelegramId] = useState<number | null>(null);
  const [starsInput, setStarsInput] = useState('');
  const [price, setPrice] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'topup' | 'history' | 'help'>('topup');
  const [history, setHistory] = useState<OrderHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Telegram init
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      setIsTelegram(true);
      if (tg.user) {
        setTelegramId(tg.user.id);
        setUsername(tg.user.username || tg.user.first_name || '');
      } else {
        try {
          const params = new URLSearchParams(tg.initData);
          const userStr = params.get('user');
          if (userStr) {
            const user = JSON.parse(userStr);
            setTelegramId(user.id);
            setUsername(user.username || user.first_name || '');
          }
        } catch {}
      }
    } else {
      setIsTelegram(false);
    }
  }, []);

  // Price fetch
  useEffect(() => {
    const stars = parseInt(starsInput, 10);
    if (!stars || stars < 1 || stars > 100000) {
      setPrice(null);
      setError('');
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let active = true;
    const fetchPrice = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/prices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ starsCount: stars }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('err');
        const data: PriceData = await res.json();
        if (active) setPrice(data);
      } catch (err) {
        if (active && err instanceof Error && err.name !== 'AbortError') {
          setError('Не удалось рассчитать стоимость');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchPrice();
    return () => { active = false; controller.abort(); };
  }, [starsInput]);

  // History fetch
  useEffect(() => {
    if (activeTab !== 'history' || !telegramId) return;
    setHistoryLoading(true);
    fetch(`/api/orders/history?telegram_id=${telegramId}`)
      .then((r) => r.json())
      .then((data) => setHistory(data.orders || []))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, [activeTab, telegramId]);

  const handlePreset = (n: number) => setStarsInput(String(n));

  const handleStarsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9]/g, '');
    if (val === '' || (parseInt(val, 10) >= 1 && parseInt(val, 10) <= 100000)) {
      setStarsInput(val);
    }
  };

  const handlePay = async () => {
    if (!telegramId || !price) return;
    setPaying(true);
    setError('');
    try {
      const res = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          starsCount: price.starsCount,
          tgUser: { id: telegramId, username },
        }),
      });
      if (!res.ok) throw new Error('err');
      const { paymentUrl } = await res.json();
      window.Telegram?.WebApp?.openLink(paymentUrl);
    } catch {
      setError('Не удалось создать заказ');
    } finally {
      setPaying(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  // ─── Loading ───
  if (isTelegram === null) {
    return (
      <main className={styles.page}>
        <div className={styles.loader}><span className={styles.spinnerLarge} /></div>
      </main>
    );
  }

  // ─── Landing ───
  if (!isTelegram) {
    return (
      <main className={styles.page}>
        <div className={styles.landing}>
          <div className={styles.landingLogo}>
            <div className={styles.landingLogoIcon}><StarIcon size={30} /></div>
            <h1 className={styles.landingTitle}>RuStars</h1>
          </div>
          <p className={styles.landingSubtitle}>
            Мгновенное пополнение Telegram Stars<br />через СБП за секунду
          </p>
          <div className={styles.landingSteps}>
            <div className={styles.step}><span className={styles.stepNum}>1</span><span className={styles.stepText}>Откройте бота в Telegram</span></div>
            <div className={styles.step}><span className={styles.stepNum}>2</span><span className={styles.stepText}>Введите количество звёзд</span></div>
            <div className={styles.step}><span className={styles.stepNum}>3</span><span className={styles.stepText}>Оплатите через СБП</span></div>
          </div>
          <a href={`https://t.me/${BOT_USERNAME}?startapp`} className={styles.landingButton} target="_blank" rel="noopener noreferrer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm5.95 7.47l-1.97 9.28c-.15.67-.54.83-1.09.52l-3.02-2.22-1.46 1.4c-.16.16-.3.3-.61.3l.22-3.05 5.56-5.02c.24-.22-.05-.33-.37-.14l-6.87 4.33-2.96-.92c-.64-.2-.66-.64.13-.95l11.55-4.46c.54-.19 1.01.13.83.95z"/></svg>
            Открыть в Telegram
          </a>
          <p className={styles.landingNote}>Приложение доступно только внутри Telegram</p>
        </div>
      </main>
    );
  }

  // ─── Mini App ───
  const stars = parseInt(starsInput, 10);
  const isValid = stars >= 1 && stars <= 100000 && price;
  const initial = username ? username.charAt(0).toUpperCase() : '?';

  return (
    <main className={styles.page}>
      {/* ── Floating Header ── */}
      <header className={styles.floatingHeader}>
        <div className={styles.headerLogo}>
          <div className={styles.logoStar}><StarIcon size={24} /></div>
          <span className={styles.logoText}>RuStars</span>
        </div>
        <button className={styles.headerProfile}>
          <div className={styles.avatar}>{initial}</div>
          {username || '...'}
        </button>
      </header>

      {/* ── Content ── */}
      <div className={styles.content}>

        {/* === ПОПОЛНЕНИЕ === */}
        {activeTab === 'topup' && (
          <>
            <div className={styles.amountBlock}>
              <div className={styles.amountLabel}>К оплате</div>
              <div className={`${styles.amountValue} ${loading ? styles.amountValueLoading : ''}`}>
                {price ? price.totalRub : '0'}
                <span className={styles.amountCurrency}>₽</span>
              </div>
              {price && (
                <div className={styles.amountPerStar}>
                  <span className={styles.amountPerStarAccent}>{price.perStarRub} ₽</span> за звезду
                  {price.markupPercent < 35 && <> · скидка {35 - price.markupPercent}%</>}
                </div>
              )}
              {error && <div className={styles.error}>{error}</div>}
            </div>

            <div className={styles.presets}>
              {PRESETS.map((n) => (
                <button
                  key={n}
                  className={`${styles.preset} ${starsInput === String(n) ? styles.presetActive : ''}`}
                  onClick={() => handlePreset(n)}
                >
                  {n}
                  <StarSmall />
                </button>
              ))}
            </div>

            <div className={styles.inputCard}>
              <div className={styles.inputRow}>
                <div className={styles.inputIcon}><StarsInputIcon /></div>
                <input className={styles.inputField} type="text" inputMode="numeric" placeholder="Своё количество" value={starsInput} onChange={handleStarsChange} />
                <span className={styles.inputUnit}>звёзд</span>
              </div>
            </div>

            <div className={styles.inputCard}>
              <div className={styles.inputRow}>
                <div className={styles.inputIcon}><UserIcon /></div>
                <input className={styles.inputField} type="text" value={username ? `@${username}` : 'Определяем...'} disabled />
              </div>
            </div>

            <button className={styles.payButton} disabled={!isValid || paying} onClick={handlePay}>
              {paying ? (
                <><span className={styles.paySpinner} /> Переход к оплате...</>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
                  </svg>
                  Пополнить через СБП
                </>
              )}
            </button>
          </>
        )}

        {/* === ИСТОРИЯ === */}
        {activeTab === 'history' && (
          <div className={styles.historyPage}>
            <div className={styles.pageTitle}>История заказов</div>

            {historyLoading && (
              <div className={styles.historyLoader}>
                <span className={styles.spinnerLarge} />
              </div>
            )}

            {!historyLoading && history.length === 0 && (
              <div className={styles.historyEmpty}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#525E72" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
                <p>Заказов пока нет</p>
              </div>
            )}

            {!historyLoading && history.length > 0 && (
              <div className={styles.historyList}>
                {history.map((order) => {
                  const st = STATUS_MAP[order.status] || { label: order.status, color: '#8E9BAE' };
                  return (
                    <div key={order.id} className={styles.historyItem}>
                      <div className={styles.historyLeft}>
                        <div className={styles.historyStars}>
                          {order.stars_count} <StarSmall />
                        </div>
                        <div className={styles.historyDate}>{formatDate(order.created_at)}</div>
                      </div>
                      <div className={styles.historyRight}>
                        <div className={styles.historyAmount}>{order.amount_rub} ₽</div>
                        <div className={styles.historyStatus} style={{ color: st.color }}>
                          <StatusIcon status={order.status} />
                          {st.label}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* === ПОМОЩЬ === */}
        {activeTab === 'help' && (
          <div className={styles.helpPage}>
            <div className={styles.pageTitle}>Помощь</div>

            <div className={styles.helpCard}>
              <div className={styles.helpCardTitle}>Как это работает?</div>
              <p className={styles.helpCardText}>
                Введите количество звёзд, которые хотите купить. Система автоматически рассчитает стоимость с учётом актуального курса TON и наценки.
              </p>
            </div>

            <div className={styles.helpCard}>
              <div className={styles.helpCardTitle}>Оплата</div>
              <p className={styles.helpCardText}>
                После нажатия «Пополнить через СБП» вы перейдёте на страницу оплаты ЮKassa. Выберите удобный банк и подтвердите перевод.
              </p>
            </div>

            <div className={styles.helpCard}>
              <div className={styles.helpCardTitle}>Пополнение</div>
              <p className={styles.helpCardText}>
                После оплаты звёзды поступают на ваш Telegram аккаунт автоматически. Обычно это занимает от 1 до 5 минут.
              </p>
            </div>

            <div className={styles.helpCard}>
              <div className={styles.helpCardTitle}>Безопасность</div>
              <p className={styles.helpCardText}>
                Мы не храним данные банковских карт. Все платежи обрабатываются через защищённый шлюз ЮKassa.
              </p>
            </div>

            <a
              href={`https://t.me/${SUPPORT_USERNAME}`}
              className={styles.helpSupport}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              Написать в поддержку
            </a>
          </div>
        )}
      </div>

      {/* ── Floating Nav ── */}
      <nav className={styles.floatingNav}>
        <button className={`${styles.navItem} ${activeTab === 'topup' ? styles.navItemActive : ''}`} onClick={() => setActiveTab('topup')}>
          <NavHomeIcon />
          <span className={styles.navLabel}>Пополнение</span>
        </button>
        <button className={`${styles.navItem} ${activeTab === 'history' ? styles.navItemActive : ''}`} onClick={() => setActiveTab('history')}>
          <NavHistoryIcon />
          <span className={styles.navLabel}>История</span>
        </button>
        <button className={`${styles.navItem} ${activeTab === 'help' ? styles.navItemActive : ''}`} onClick={() => setActiveTab('help')}>
          <NavHelpIcon />
          <span className={styles.navLabel}>Помощь</span>
        </button>
      </nav>
    </main>
  );
}
