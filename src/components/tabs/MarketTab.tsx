import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import styles from '@/app/page.module.css';
import { MARKET_TABS, fmt } from '@/app/types';
import type { MItem } from '@/app/types';

const LottiePlayer = dynamic(() => import('@/components/LottiePlayer'), { ssr: false });

interface MarketTabProps {
  haptic: (t?: 'light' | 'medium' | 'success' | 'error') => void;
}

export default function MarketTab({ haptic }: MarketTabProps) {
  const [marketTab, setMarketTab] = useState<'nft' | 'usernames' | 'numbers'>('nft');
  const [marketItems, setMarketItems] = useState<MItem[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketQuery, setMarketQuery] = useState('');

  useEffect(() => {
    setMarketLoading(true);
    const p = new URLSearchParams({ type: marketTab });
    if (marketQuery.trim()) p.set('q', marketQuery.trim());
    const t = setTimeout(() => {
      fetch(`/api/market?${p.toString()}`).then((r) => r.json())
        .then((d) => { setMarketItems(d.items || []); })
        .catch(() => setMarketItems([]))
        .finally(() => setMarketLoading(false));
    }, marketQuery ? 350 : 0);
    return () => clearTimeout(t);
  }, [marketTab, marketQuery]);

  return (
    <>
      <h1 className={styles.pageTitle}>Маркет</h1>
      <p className={styles.marketSubtitle}>Покупайте и продавайте цифровые активы за рубли</p>
      <div className={styles.searchRow}>
        <div className={styles.searchBar}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input className={styles.searchInput} placeholder="Поиск по маркету..." value={marketQuery} onChange={(e) => setMarketQuery(e.target.value)} />
        </div>
        <button className={styles.filterBtn} aria-label="filters">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="6" x2="20" y2="6" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="10" y1="18" x2="14" y2="18" /></svg>
        </button>
      </div>

      <div className={styles.pills}>
        {MARKET_TABS.map((t) => (
          <button key={t.k} className={`${styles.pill} ${marketTab === t.k ? styles.pillOn : ''}`} onClick={() => { haptic('light'); setMarketTab(t.k); }}>{t.l}</button>
        ))}
      </div>

      {marketLoading ? (
        <div className={styles.empty}><span className={styles.spinner} /></div>
      ) : marketItems.length === 0 ? (
        <div className={styles.empty}>Нет предложений</div>
      ) : marketTab === 'nft' ? (
        <div className={styles.nftGrid}>
          {marketItems.map((it) => (
            <button key={it.address} className={styles.nftTile} onClick={() => {}}>
              <div className={styles.nftAnim} style={{ backgroundImage: it.nft ? `url(${it.nft.still})` : it.image ? `url(${it.image})` : undefined }}>
                {it.nft && <LottiePlayer src={it.nft.lottie} still={it.nft.still} className={styles.nftLottie} hoverOnly />}
              </div>
              <div className={styles.nftBottom}>
                <div>
                  <div className={styles.nftName}>{it.name}</div>
                  <div className={styles.nftSub}>{it.subtitle}</div>
                </div>
                {it.listing && (
                  <div className={styles.nftSeller}>
                    {it.listing.sellerAvatar ? (
                      <img src={it.listing.sellerAvatar} alt="" className={styles.nftSellerAvatar} />
                    ) : (
                      <span className={styles.nftSellerLetter}>{it.listing.sellerUsername?.charAt(0)?.toUpperCase()}</span>
                    )}
                    <span className={styles.nftSellerName}>@{it.listing.sellerUsername}</span>
                  </div>
                )}
                {it.priceRub != null && <div className={styles.nftPrice}>{fmt(it.priceRub)} ₽</div>}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.p2pList}>
          {marketItems.map((it) => (
            <button key={it.address} className={styles.p2pCard} onClick={() => {}}>
              <div className={styles.p2pAvatar} style={{ backgroundImage: it.image ? `url(${it.image})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}>
                {!it.image && <span className={styles.p2pAvatarLetter}>{it.name.charAt(0).toUpperCase()}</span>}
              </div>
              <div className={styles.p2pInfo}>
                <div className={styles.p2pName}>{it.name}</div>
                <div className={styles.p2pBadges}>
                  <span className={styles.p2pBadgeType}>{it.subtitle}</span>
                </div>
              </div>
              <div className={styles.p2pRight}>
                {it.priceRub != null ? <span className={styles.p2pPrice}>{fmt(it.priceRub)} ₽</span> : it.priceTon != null ? <span className={styles.p2pPrice}>{it.priceTon} TON</span> : null}
                <svg className={styles.chev} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
