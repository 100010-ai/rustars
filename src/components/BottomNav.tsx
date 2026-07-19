import styles from '@/app/page.module.css';
import { BOT_USERNAME } from '@/app/types';

type Tab = 'home' | 'referrals' | 'tasks' | 'market' | 'profile';

interface BottomNavProps {
  activeTab: Tab;
  isTG: boolean;
  haptic: (t?: 'light' | 'medium' | 'success' | 'error') => void;
  setActiveTab: (tab: Tab) => void;
}

const NAV_ITEMS: Array<{ k: Tab; l: string; icon: React.ReactNode }> = [
  { k: 'home', l: 'Пополнить', icon: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></> },
  { k: 'referrals', l: 'Рефералы', icon: <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></> },
  { k: 'tasks', l: 'Задания', icon: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></> },
  { k: 'market', l: 'Маркет', icon: <><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" /></> },
  { k: 'profile', l: 'Профиль', icon: <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></> },
];

export default function BottomNav({ activeTab, isTG, haptic, setActiveTab }: BottomNavProps) {
  return (
    <nav className={styles.nav}>
      {NAV_ITEMS.map((n) => (
        <button key={n.k} className={`${styles.navItem} ${activeTab === n.k ? styles.navOn : ''}`} onClick={() => {
          if (!isTG && (n.k === 'referrals' || n.k === 'tasks' || n.k === 'profile')) {
            window.location.href = `https://t.me/${BOT_USERNAME}?startapp`;
            return;
          }
          haptic('light'); setActiveTab(n.k);
        }}>
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{n.icon}</svg>
          <span className={styles.navLabel}>{n.l}</span>
        </button>
      ))}
    </nav>
  );
}
