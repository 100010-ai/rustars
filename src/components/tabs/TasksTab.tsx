import { useState } from 'react';
import styles from '@/app/page.module.css';
import { fmt } from '@/app/types';

interface TasksTabProps {
  initData: string;
  tgId: number | null;
  haptic: (t?: 'light' | 'medium' | 'success' | 'error') => void;
  showToast: (m: string) => void;
  loadBalance: () => void;
}

export default function TasksTab({ initData, tgId, haptic, showToast, loadBalance }: TasksTabProps) {
  const [taskChannelDone, setTaskChannelDone] = useState(false);
  const [taskChannelLoading, setTaskChannelLoading] = useState(false);
  const [taskChannelOpened, setTaskChannelOpened] = useState(false);

  return (
    <>
      <h1 className={styles.pageTitle}>Задания</h1>
      <p className={styles.marketSubtitle}>Выполняйте простые квесты и получайте реальные рубли на баланс</p>

      {!taskChannelDone && (
        <div className={styles.taskCard}>
          <div className={styles.taskIcon}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
          </div>
          <div className={styles.taskInfo}>
            <div className={styles.taskTitle}>Подписка на официальный канал</div>
            <div className={styles.taskReward}>+ 5.00 ₽</div>
          </div>
          <button className={styles.taskBtn} disabled={taskChannelLoading} onClick={async () => {
            if (!taskChannelOpened) {
              haptic('light');
              window.Telegram?.WebApp?.openLink('https://t.me/RuStarsOfficial');
              setTaskChannelOpened(true);
              return;
            }
            haptic('medium');
            setTaskChannelLoading(true);
            try {
              const r = await fetch('/api/tasks/check-subscription', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ initData, task: 'subscribe_channel' }),
              });
              const d = await r.json();
              if (!r.ok) {
                haptic('error');
                showToast(d.error || 'Ошибка проверки');
                return;
              }
              if (d.subscribed) {
                setTaskChannelDone(true);
                haptic('success');
                showToast(d.already ? 'Уже выполнено' : `+${fmt(d.credited || 5)} ₽ начислено`);
                loadBalance();
              } else {
                haptic('error');
                showToast('Подпишитесь на канал и попробуйте снова');
              }
            } catch {
              showToast('Не удалось проверить подписку');
            } finally { setTaskChannelLoading(false); }
          }}>
            {taskChannelLoading ? <span className={styles.paySpinner} /> : taskChannelOpened ? 'Проверить' : 'Выполнить'}
          </button>
        </div>
      )}

      {taskChannelDone && (
        <div className={styles.card} style={{ textAlign: 'center', padding: '32px 18px' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>Все задания выполнены!</div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 6 }}>Новые задания появятся позже</div>
        </div>
      )}
    </>
  );
}
