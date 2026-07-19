import styles from '@/app/page.module.css';
import { BOT_USERNAME, fmt, fmtDate } from '@/app/types';
import type { RefStats } from '@/app/types';

interface ReferralsTabProps {
  tgId: number | null;
  initData: string;
  refStats: RefStats;
  copied: boolean;
  haptic: (t?: 'light' | 'medium' | 'success' | 'error') => void;
  showToast: (m: string) => void;
  loadRefStats: () => void;
  loadBalance: () => void;
}

export default function ReferralsTab({ tgId, initData, refStats, copied, haptic, showToast, loadRefStats, loadBalance }: ReferralsTabProps) {
  const refLink = `https://t.me/${BOT_USERNAME}?startapp=ref_${tgId || ''}`;

  const handleCopy = async () => {
    if (!tgId) { showToast('Ссылка доступна внутри Telegram'); return; }
    try { await navigator.clipboard.writeText(refLink); haptic('success'); showToast('Ссылка скопирована'); }
    catch { showToast('Не удалось скопировать'); }
  };

  return (
    <>
      <h1 className={styles.pageTitle}>Реферальная программа</h1>
      <div className={styles.refBanner}>
        <div className={styles.refBannerText}>
          <div className={styles.refBannerTitle}>Приглашай друзей и зарабатывай вместе с RuStars</div>
          <div className={styles.refBannerSub}>Получай 10% от каждой покупки приглашённого пользователя</div>
        </div>
        <div className={styles.refBannerGift}><img src="/gift.png" alt="" style={{ width: 130, height: 130, objectFit: 'contain' }} /></div>
      </div>

      <div className={styles.card}>
        <div className={styles.fieldLabel}>Ваша реферальная ссылка</div>
        <div className={styles.refLinkRow}>
          <span className={styles.refLinkUrl}>{refLink}</span>
          <button className={`${styles.copyBtn} ${copied ? styles.copyOn : ''}`} onClick={handleCopy}>
            {copied
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>}
          </button>
        </div>
      </div>

      <div className={styles.statsCard}>
        <div className={styles.statCell}><span className={styles.statLbl}>Приглашено</span><span className={styles.statVal}>{fmt(refStats.invited)}</span></div>
        <div className={styles.statDiv} />
        <div className={styles.statCell}><span className={styles.statLbl}>Активных</span><span className={styles.statVal}>{fmt(refStats.active)}</span></div>
        <div className={styles.statDiv} />
        <div className={styles.statCell}><span className={styles.statLbl}>Заработано</span><span className={styles.statVal}>{fmt(refStats.earned)} ₽</span></div>
      </div>

      {refStats.available > 0 && (
        <div className={styles.card} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Доступно для вывода</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--success)' }}>{fmt(refStats.available)} ₽</div>
          </div>
          <button className={styles.topUpBtn} onClick={async () => {
            haptic('medium');
            try {
              const r = await fetch('/api/referrals/withdraw', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ initData }),
              });
              if (!r.ok) { showToast('Не удалось вывести'); return; }
              const d = await r.json();
              showToast(`Выведено ${fmt(d.withdrawn)} ₽ на баланс`);
              loadRefStats();
              loadBalance();
            } catch { showToast('Ошибка вывода'); }
          }}>Вывести</button>
        </div>
      )}

      <div className={styles.card}>
        <h3 className={styles.blockTitle}>Как это работает?</h3>
        <div className={styles.howSteps}>
          <div className={styles.howStep}><span className={styles.howNum}>1</span><span>Приглашайте друзей по своей ссылке</span></div>
          <div className={styles.howStep}><span className={styles.howNum}>2</span><span>Друг пополняет звёзды</span></div>
          <div className={styles.howStep}><span className={styles.howNum}>3</span><span>Вы получаете 10% от его покупки</span></div>
        </div>
      </div>

      {refStats.recent && refStats.recent.length > 0 && (
        <div className={styles.card}>
          <h3 className={styles.blockTitle}>Недавние приглашения</h3>
          <div className={styles.plainList}>
            {refStats.recent.map((r, i) => (
              <div key={i} className={styles.row}>
                <div className={styles.rowLeft}><div className={styles.rowTitle}>@{r.username}</div><div className={styles.rowSub}>{fmtDate(r.date)}</div></div>
                <span className={styles.rowReward}>+{fmt(r.reward)} ₽</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
