import { getStarRate } from '@/lib/referral';
import styles from '@/app/page.module.css';
import { QUICK, PREMIUM_PLANS, fmt, fmtDate, STATUS, MIN_STARS, MAX_STARS } from '@/app/types';
import type { Price, Order } from '@/app/types';

interface HomeTabProps {
  activeProduct: 'stars' | 'premium';
  setActiveProduct: (p: 'stars' | 'premium') => void;
  recipient: string;
  setRecipient: (v: string) => void;
  amountStars: string;
  setAmountStars: (v: string) => void;
  price: Price | null;
  selectedPremium: string | null;
  setSelectedPremium: (id: string | null) => void;
  paying: boolean;
  error: string;
  balance: number;
  stock: { available: number; tonBalance: number | null; warning: boolean } | null;
  history: Order[];
  haptic: (t?: 'light' | 'medium' | 'success' | 'error') => void;
  handlePay: () => void;
}

export default function HomeTab({
  activeProduct, setActiveProduct, recipient, setRecipient,
  amountStars, setAmountStars, price, selectedPremium, setSelectedPremium,
  paying, error, balance, stock, history, haptic, handlePay,
}: HomeTabProps) {
  return (
    <>
      <div className={styles.productTabs}>
        <button className={`${styles.productTab} ${activeProduct === 'stars' ? styles.productTabOn : ''}`} onClick={() => { haptic('light'); setActiveProduct('stars'); setSelectedPremium(null); }}>Звёзды</button>
        <button className={`${styles.productTab} ${activeProduct === 'premium' ? styles.productTabOn : ''}`} onClick={() => { haptic('light'); setActiveProduct('premium'); setAmountStars(''); }}>Telegram Premium</button>
      </div>

      <div className={styles.hero}>
        {activeProduct === 'stars' ? (<>
          <div className={styles.heroText}>
            <h1 className={styles.heroTitle}>Пополнение Stars</h1>
            <p className={styles.heroSub}>Быстрое и безопасное пополнение Telegram Stars</p>
          </div>
          <div className={styles.heroImage}><img src="/star.png" alt="" style={{ width: '100%', maxWidth: 160, height: 'auto', objectFit: 'contain' }} /></div>
        </>) : (<>
          <div className={styles.heroText}>
            <h1 className={styles.heroTitle}>Telegram Premium</h1>
            <p className={styles.heroSub}>Подарите Premium подписку другу или себе</p>
          </div>
          <div className={styles.heroImage}>
            <img src="/tg-premium.png" alt="" style={{ width: '100%', maxWidth: 160, height: 'auto', objectFit: 'contain' }} />
          </div>
        </>)}
      </div>

      {activeProduct === 'stars' && (<>
        <div className={styles.card}>
          <div className={styles.stepTitle}><span className={styles.stepNum}>1</span> Кому отправить звёзды</div>
          <label className={styles.fieldLabel}>Имя пользователя Telegram</label>
          <div className={styles.inputWrap}>
            <span className={styles.inputPrefix}>@</span>
            <input className={styles.input} placeholder="username" value={recipient} onChange={(e) => setRecipient(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} />
          </div>

          <div className={styles.stepTitle} style={{ marginTop: 20 }}><span className={styles.stepNum}>2</span> Количество звёзд</div>
          <div className={styles.inputWrap}>
            <span className={styles.inputPrefix}>★</span>
            <input className={styles.input} inputMode="numeric" placeholder="Введите количество" value={amountStars} onChange={(e) => setAmountStars(e.target.value.replace(/[^0-9]/g, ''))} />
            {amountStars && <button className={styles.clearBtn} onClick={() => { setAmountStars(''); }}>Очистить</button>}
          </div>
          <div className={styles.quickRow}>
            {QUICK.map((a) => (
              <button key={a} className={`${styles.quick} ${amountStars === String(a) ? styles.quickOn : ''}`} onClick={() => { haptic('light'); setAmountStars(String(a)); }}>{fmt(a)} ★</button>
            ))}
          </div>
        </div>
      </>)}

      {activeProduct === 'premium' && (<>
        <div className={styles.card}>
          <div className={styles.stepTitle}><span className={styles.stepNum}>1</span> Кому подарить Premium</div>
          <label className={styles.fieldLabel}>Имя пользователя Telegram</label>
          <div className={styles.inputWrap}>
            <span className={styles.inputPrefix}>@</span>
            <input className={styles.input} placeholder="username" value={recipient} onChange={(e) => setRecipient(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} />
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.premiumHeader}>
            <span className={styles.stepTitle} style={{ margin: 0 }}>Выберите срок</span>
          </div>
          <div className={styles.premiumStack}>
            {PREMIUM_PLANS.map((plan) => (
              <button key={plan.id} className={`${styles.premiumRow} ${selectedPremium === plan.id ? styles.premiumRowOn : ''}`} onClick={() => { haptic('light'); setSelectedPremium(plan.id); }}>
                <div className={`${styles.radio} ${selectedPremium === plan.id ? styles.radioOn : ''}`}>
                  {selectedPremium === plan.id && <div className={styles.radioDot} />}
                </div>
                <div className={styles.premiumInfo}>
                  <span className={styles.premiumDuration}>{plan.duration}</span>
                  <span className={styles.premiumDiscount}>{plan.discount}</span>
                </div>
                <div className={styles.premiumPriceBlock}>
                  <span className={styles.premiumTon}>{plan.ton} TON</span>
                  <span className={styles.premiumOldPrice}>{fmt(plan.oldPrice)} ₽</span>
                  <span className={styles.premiumPrice}>{fmt(plan.price)} ₽</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </>)}

      <div className={styles.card}>
        <div className={styles.receiveHead}>
          <span className={styles.receiveTitle}>Вы заплатите</span>
          {activeProduct === 'stars' && <div className={styles.courseWrapper}>1 звезда = <span className={styles.courseBadge}>{getStarRate(parseInt(amountStars, 10) || 0).toFixed(2)} ₽</span></div>}
        </div>
        <div className={styles.receiveRow}>
          {activeProduct === 'stars' ? (
            <>
              <span className={styles.receiveRub}>{price?.totalRub ? fmt(price.totalRub) : '0'} ₽</span>
              <span className={styles.receiveStars}><span className={styles.receiveStarIcon}>★</span>{price?.starsCount ? fmt(price.starsCount) : '0'} <span className={styles.receiveUnit}>Stars</span></span>
            </>
          ) : (() => {
            const plan = PREMIUM_PLANS.find((p) => p.id === selectedPremium);
            return (
              <>
                <span className={styles.receiveRub}>{plan ? `${fmt(plan.price)} ₽` : '—'}</span>
                <span className={styles.receiveStars}>{plan ? `Telegram Premium ${plan.duration}` : 'Telegram Premium'}</span>
              </>
            );
          })()}
        </div>
      </div>

      <button className={styles.payBtn} disabled={activeProduct === 'stars' ? !price?.starsCount : !selectedPremium} onClick={handlePay}>
        {paying ? <span className={styles.paySpinner} /> : activeProduct === 'premium' && selectedPremium ? `Подарить Premium за ${fmt(PREMIUM_PLANS.find((p) => p.id === selectedPremium)?.price || 0)} ₽` : 'Пополнить звёзды'}
      </button>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.secure}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
        Безопасно и конфиденциально
      </div>

      {history.length > 0 && (
        <div className={styles.block}>
          <h3 className={styles.blockTitle}>Последние заказы</h3>
          <div className={styles.list}>
            {history.slice(0, 4).map((o) => {
              const st = STATUS[o.status] || { l: o.status, c: '#9AA1AD' };
              return (
                <div key={o.id} className={styles.row}>
                  <div className={styles.rowLeft}><div className={styles.rowTitle}>{o.stars_count} ★</div><div className={styles.rowSub}>{fmtDate(o.created_at)}</div></div>
                  <div className={styles.rowRight}><div className={styles.rowStrong}>{fmt(o.amount_rub)} ₽</div><div className={styles.rowStatus} style={{ color: st.c }}>{st.l}</div></div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
