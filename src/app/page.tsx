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

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || 'RuStarsBot';

export default function Home() {
  const [isTelegram, setIsTelegram] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [telegramId, setTelegramId] = useState<number | null>(null);
  const [starsInput, setStarsInput] = useState('');
  const [price, setPrice] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // Определяем окружение: Telegram или браузер
  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    if (tg) {
      tg.ready();
      tg.expand();
      setIsTelegram(true);

      // user может быть пустым если открыли по прямой ссылке
      if (tg.user) {
        setTelegramId(tg.user.id);
        setUsername(tg.user.username || tg.user.first_name || '');
      } else {
        // Fallback: пробуем достать из initData
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

  // Запрос цены при изменении ввода
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

        if (!res.ok) throw new Error('Ошибка расчёта');

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
    return () => {
      active = false;
      controller.abort();
    };
  }, [starsInput]);

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

      if (!res.ok) throw new Error('Ошибка создания заказа');

      const { paymentUrl } = await res.json();
      window.Telegram?.WebApp?.openLink(paymentUrl);
    } catch {
      setError('Не удалось создать заказ. Попробуйте ещё раз.');
    } finally {
      setPaying(false);
    }
  };

  // ─── Загрузка ───

  if (isTelegram === null) {
    return (
      <main className={styles.page}>
        <div className={styles.loader}>
          <span className={styles.spinnerLarge} />
        </div>
      </main>
    );
  }

  // ─── Лендинг для браузера (не Telegram) ───

  if (!isTelegram) {
    return (
      <main className={styles.page}>
        <div className={styles.landing}>
          {/* Логотип */}
          <div className={styles.landingLogo}>
            <div className={styles.logoIcon}>★</div>
            <h1 className={styles.landingTitle}>RuStars</h1>
          </div>

          <p className={styles.landingSubtitle}>
            Мгновенное пополнение Telegram Stars
            <br />
            через СБП за секунду
          </p>

          {/* Как это работает */}
          <div className={styles.landingSteps}>
            <div className={styles.step}>
              <span className={styles.stepNum}>1</span>
              <span className={styles.stepText}>Откройте бота в Telegram</span>
            </div>
            <div className={styles.step}>
              <span className={styles.stepNum}>2</span>
              <span className={styles.stepText}>Введите количество звёзд</span>
            </div>
            <div className={styles.step}>
              <span className={styles.stepNum}>3</span>
              <span className={styles.stepText}>Оплатите через СБП</span>
            </div>
          </div>

          {/* Кнопка → Telegram */}
          <a
            href={`https://t.me/${BOT_USERNAME}?startapp`}
            className={styles.landingButton}
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg className={styles.tgIcon} viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm5.95 7.47l-1.97 9.28c-.15.67-.54.83-1.09.52l-3.02-2.22-1.46 1.4c-.16.16-.3.3-.61.3l.22-3.05 5.56-5.02c.24-.22-.05-.33-.37-.14l-6.87 4.33-2.96-.92c-.64-.2-.66-.64.13-.95l11.55-4.46c.54-.19 1.01.13.83.95z"/>
            </svg>
            Открыть в Telegram
          </a>

          <p className={styles.landingNote}>
            Приложение доступно только внутри Telegram
          </p>
        </div>
      </main>
    );
  }

  // ─── Mini App (внутри Telegram) ───

  const stars = parseInt(starsInput, 10);
  const isValid = stars >= 1 && stars <= 100000 && price;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>RuStars</h1>
        <p className={styles.subtitle}>Telegram Stars за секунду</p>
      </header>

      <div className={styles.section}>
        <div className={styles.field}>
          <label className={styles.label}>Получатель</label>
          <div className={styles.inputWrap}>
            <input
              className={styles.input}
              type="text"
              value={username ? `@${username}` : 'Загрузка...'}
              disabled
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Количество звёзд</label>
          <div className={styles.inputWrap}>
            <input
              className={styles.input}
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={starsInput}
              onChange={handleStarsChange}
              autoFocus
            />
            <span className={styles.unit}>звёзд</span>
          </div>
        </div>

        {price ? (
          <div className={styles.balance}>
            <div className={`${styles.total} ${loading ? styles.totalLoading : ''}`}>
              {price.totalRub}
              <span className={styles.currency}>₽</span>
            </div>
            <p className={styles.perStar}>
              <span className={styles.accent}>{price.perStarRub} ₽</span> за звезду
              {price.markupPercent < 35 && (
                <> · скидка {35 - price.markupPercent}%</>
              )}
            </p>
          </div>
        ) : (
          !error && starsInput && (
            <div className={styles.empty}>Введите количество звёзд</div>
          )
        )}

        {error && <p className={styles.error}>{error}</p>}
      </div>

      <div className={styles.buttonWrap}>
        <button
          className={styles.button}
          disabled={!isValid || paying}
          onClick={handlePay}
        >
          {paying ? (
            <>
              <span className={styles.spinner} />
              Переход к оплате...
            </>
          ) : (
            'Пополнить через СБП'
          )}
        </button>
      </div>
    </main>
  );
}
