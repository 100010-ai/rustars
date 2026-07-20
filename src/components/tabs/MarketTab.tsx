import styles from '@/app/page.module.css';

interface MarketTabProps {
  haptic: (t?: 'light' | 'medium' | 'success' | 'error') => void;
}

export default function MarketTab({ haptic }: MarketTabProps) {
  return (
    <>
      <h1 className={styles.pageTitle}>Маркет</h1>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        textAlign: 'center',
      }}>
        <div style={{
          width: 80,
          height: 80,
          borderRadius: 20,
          background: 'var(--accent-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
          </svg>
        </div>

        <div style={{
          fontSize: 18,
          fontWeight: 800,
          color: 'var(--text-primary)',
          marginBottom: 8,
        }}>
          Маркет в разработке
        </div>

        <p style={{
          fontSize: 14,
          color: 'var(--text-secondary)',
          maxWidth: 280,
          lineHeight: 1.5,
          marginBottom: 24,
        }}>
          Скоро здесь появится P2P-маркет для покупки и продажи NFT-подарков, анонимных номеров +888 и юзернеймов за рубли
        </p>

        <div style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}>
          {['NFT-подарки', 'Номера +888', 'Юзернеймы'].map((tag) => (
            <span key={tag} style={{
              padding: '6px 14px',
              borderRadius: 20,
              background: 'var(--bg-soft)',
              color: 'var(--text-muted)',
              fontSize: 12,
              fontWeight: 600,
            }}>
              {tag}
            </span>
          ))}
        </div>

        <div style={{
          marginTop: 32,
          padding: '12px 20px',
          borderRadius: 12,
          background: 'var(--accent-soft)',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--accent)',
        }}>
          Следите за обновлениями
        </div>
      </div>
    </>
  );
}
