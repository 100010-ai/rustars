import { useState } from 'react';
import dynamic from 'next/dynamic';
import styles from '@/app/page.module.css';
import { DEPOSIT_PRESETS, fmt, fmtDate, STATUS, TXN_LABEL } from '@/app/types';
import type { Order, Txn, MItem } from '@/app/types';
import PremiumBadge from '@/components/PremiumBadge';

const LottiePlayer = dynamic(() => import('@/components/LottiePlayer'), { ssr: false });

interface ProfileTabProps {
  tgId: number | null;
  initData: string;
  username: string;
  firstName: string;
  lastName?: string;
  avatar: string | null;
  isPremium: boolean;
  isPro?: boolean;
  balance: number;
  balanceTxns: Txn[];
  history: Order[];
  haptic: (t?: 'light' | 'medium' | 'success' | 'error') => void;
  showToast: (m: string) => void;
  loadBalance: () => void;
  // Wallet
  connectedWallet: string | null;
  walletItems: MItem[];
  walletLoading: boolean;
  tonBalance: number | null;
  tonPrice: number;
  tonConnect: { address: string | null; connect: () => Promise<void>; disconnect: () => void };
  handleConnectWallet: () => Promise<void>;
  loadWallet: () => void;
}

export default function ProfileTab({
  tgId, initData, username, firstName, lastName, avatar, isPremium, isPro,
  balance, balanceTxns, history, haptic, showToast, loadBalance,
  connectedWallet, walletItems, walletLoading, tonBalance, tonPrice,
  tonConnect, handleConnectWallet, loadWallet,
}: ProfileTabProps) {
  const [profileSub, setProfileSub] = useState<'ops' | 'purchases' | 'deposit' | 'wallet' | 'sell' | 'inventory' | null>(null);
  const [balanceTab, setBalanceTab] = useState<'rub' | 'crypto'>('rub');
  const [depositAmount, setDepositAmount] = useState(1000);
  const [depositing, setDepositing] = useState(false);
  const [inventoryTab, setInventoryTab] = useState<'nft' | 'numbers' | 'usernames'>('nft');
  const [sellItem, setSellItem] = useState<MItem | null>(null);
  const [sellPrice, setSellPrice] = useState('');
  const [listing, setListing] = useState(false);
  const [error, setError] = useState('');

  const displayName = (firstName || '') + (lastName ? ` ${lastName}` : '') || 'Пользователь';
  const initial = (firstName || username || 'П').charAt(0).toUpperCase();

  const handleDeposit = async () => {
    if (!tgId) { showToast('Откройте приложение в Telegram'); return; }
    if (depositAmount < 10 || depositing) return;
    haptic('medium'); setDepositing(true);
    try {
      const r = await fetch('/api/wallet/deposit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: depositAmount, initData }),
      });
      if (!r.ok) throw 0;
      const { paymentUrl } = await r.json();
      window.Telegram?.WebApp?.openLink(paymentUrl);
      setProfileSub(null);
    } catch { showToast('Не удалось создать пополнение'); haptic('error'); }
    finally { setDepositing(false); }
  };

  const handleListOnMarket = async () => {
    if (!sellItem || !sellPrice || !tgId) return;
    const price = parseInt(sellPrice, 10);
    if (price < 10) { showToast('Минимальная цена — 10 ₽'); return; }
    haptic('medium'); setListing(true);
    try {
      const r = await fetch('/api/market/list', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: sellItem, priceRub: price, initData }),
      });
      if (!r.ok) { const d = await r.json(); showToast(d.error || 'Ошибка'); return; }
      showToast('Предмет выставлен на продажу');
      setSellItem(null); setSellPrice(''); setProfileSub(null);
    } catch { showToast('Не удалось выставить'); }
    finally { setListing(false); }
  };

  // Sub-page view
  if (profileSub) {
    return (
      <>
        <div className={styles.topbar}>
          <button className={styles.iconBtn} onClick={() => setProfileSub(null)} aria-label="back"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="15 18 9 12 15 6" /></svg></button>
          <h1 className={styles.pageTitle} style={{ margin: 0 }}>{profileSub === 'ops' ? 'История операций' : profileSub === 'deposit' ? 'Пополнение' : profileSub === 'wallet' ? 'Мой кошелёк' : profileSub === 'sell' ? 'Выставить на продажу' : profileSub === 'inventory' ? 'Инвентарь' : 'Мои покупки'}</h1>
          <span style={{ width: 38 }} />
        </div>

        {profileSub === 'deposit' && (
          <div className={styles.depositPage}>
            <div className={styles.depositHero}>
              <div className={styles.depositStar}><img src="/star.png" alt="" width={160} height={160} style={{ objectFit: 'contain' }} /></div>
              <h2 className={styles.depositTitle}>Пополнение баланса</h2>
              <p className={styles.depositSub}>Выберите сумму для пополнения</p>
            </div>
            <div className={styles.card}>
              <div className={styles.depPresets}>
                {DEPOSIT_PRESETS.map((a) => (
                  <button key={a} className={`${styles.depPreset} ${depositAmount === a ? styles.depPresetOn : ''}`} onClick={() => { haptic('light'); setDepositAmount(a); }}>{fmt(a)} ₽</button>
                ))}
              </div>
              <div className={styles.inputWrap}>
                <span className={styles.inputPrefix}>₽</span>
                <input className={styles.input} inputMode="numeric" placeholder="Сумма пополнения" value={depositAmount || ''} onChange={(e) => setDepositAmount(parseInt(e.target.value.replace(/[^0-9]/g, '') || '0', 10))} />
              </div>
            </div>
            <button className={styles.payBtn} disabled={depositAmount < 10 || depositing} onClick={handleDeposit}>
              {depositing ? <span className={styles.paySpinner} /> : `Пополнить на ${fmt(depositAmount || 0)} ₽`}
            </button>
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.secure}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
              Безопасно и конфиденциально
            </div>
          </div>
        )}

        {profileSub === 'ops' && (
          balanceTxns.length === 0 ? <div className={styles.empty}>Операций пока нет</div> : (
            <div className={styles.plainList}>
              {balanceTxns.map((t) => { const a = Number(t.amount_rub); return (
                <div key={t.id} className={styles.row}>
                  <div className={styles.rowLeft}><div className={styles.rowTitle}>{TXN_LABEL[t.kind] || t.kind}</div><div className={styles.rowSub}>{fmtDate(t.created_at)}</div></div>
                  <span className={styles.rowStrong} style={{ color: a < 0 ? 'var(--text-secondary)' : 'var(--success)' }}>{a > 0 ? '+' : ''}{fmt(a)} ₽</span>
                </div>
              ); })}
            </div>
          )
        )}

        {profileSub === 'purchases' && (
          history.length === 0 ? <div className={styles.empty}>Покупок пока нет</div> : (
            <div className={styles.plainList}>
              {history.map((o) => { const st = STATUS[o.status] || { l: o.status, c: '#9AA1AD' }; return (
                <div key={o.id} className={styles.row}>
                  <div className={styles.rowLeft}><div className={styles.rowTitle}>{o.stars_count} ★ Stars</div><div className={styles.rowSub}>{fmtDate(o.created_at)}</div></div>
                  <div className={styles.rowRight}><div className={styles.rowStrong}>{fmt(o.amount_rub)} ₽</div><div className={styles.rowStatus} style={{ color: st.c }}>{st.l}</div></div>
                </div>
              ); })}
            </div>
          )
        )}

        {profileSub === 'wallet' && (
          <div className={styles.depositPage}>
            <div className={styles.card}>
              {connectedWallet ? (
                <>
                  <div className={styles.fieldLabel}>Подключённый кошелёк</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', wordBreak: 'break-all', marginBottom: 12 }}>{connectedWallet}</div>
                  <button style={{ fontSize: 12, color: 'var(--error)', fontWeight: 600, marginBottom: 16 }} onClick={() => {
                    tonConnect.disconnect();
                    showToast('Кошелёк отключён');
                  }}>Отключить кошелёк</button>
                  <div className={styles.fieldLabel}>Ваши предметы ({walletItems.length})</div>
                  {walletLoading ? (
                    <div className={styles.empty}><span className={styles.spinner} /></div>
                  ) : walletItems.length === 0 ? (
                    <div className={styles.empty}>Кошелёк пуст</div>
                  ) : (
                    <div className={styles.p2pList}>
                      {walletItems.map((it) => (
                        <button key={it.address} className={styles.p2pCard} onClick={() => { setSellItem(it); setProfileSub('sell'); }}>
                          <div className={styles.p2pAvatar} style={{ backgroundImage: it.nft?.still ? `url(${it.nft.still})` : it.image ? `url(${it.image})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}>
                            {!it.nft?.still && !it.image && <span className={styles.p2pAvatarLetter}>{it.name.charAt(0).toUpperCase()}</span>}
                          </div>
                          <div className={styles.p2pInfo}>
                            <div className={styles.p2pName}>{it.name}</div>
                            <div className={styles.p2pBadges}><span className={styles.p2pBadgeType}>{it.subtitle}</span></div>
                          </div>
                          <div className={styles.p2pRight}>
                            <span className={styles.p2pPrice} style={{ color: 'var(--accent)', fontSize: 13 }}>Выставить →</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Подключите TON-кошелёк</div>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>Чтобы продавать предметы на P2P-маркете и видеть инвентарь</p>
                    <button className={styles.payBtn} onClick={async () => {
                      await tonConnect.connect();
                      setTimeout(async () => {
                        if (tonConnect.address) { await handleConnectWallet(); }
                      }, 1500);
                    }}>Подключить через TON Keeper</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {profileSub === 'sell' && sellItem && (
          <div className={styles.depositPage}>
            <div className={styles.card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div className={styles.p2pAvatar} style={{ backgroundImage: sellItem.nft?.still ? `url(${sellItem.nft.still})` : sellItem.image ? `url(${sellItem.image})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center', width: 56, height: 56 }}>
                  {!sellItem.nft?.still && !sellItem.image && <span className={styles.p2pAvatarLetter}>{sellItem.name.charAt(0).toUpperCase()}</span>}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{sellItem.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sellItem.subtitle}</div>
                </div>
              </div>
              <div className={styles.fieldLabel}>Цена продажи (₽)</div>
              <div className={styles.inputWrap}>
                <span className={styles.inputPrefix}>₽</span>
                <input className={styles.input} inputMode="numeric" placeholder="Введите цену" value={sellPrice} onChange={(e) => setSellPrice(e.target.value.replace(/[^0-9]/g, ''))} />
              </div>
              {sellPrice && parseInt(sellPrice, 10) >= 10 && (
                <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--success-soft)', borderRadius: 12, fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>
                  Вы получите: {fmt(Math.round(parseInt(sellPrice, 10) * 0.9))} ₽ (комиссия 10%)
                </div>
              )}
            </div>
            <button className={styles.payBtn} disabled={!sellPrice || parseInt(sellPrice, 10) < 10 || listing} onClick={handleListOnMarket}>
              {listing ? <span className={styles.paySpinner} /> : 'Выставить на продажу'}
            </button>
          </div>
        )}

        {profileSub === 'inventory' && (
          <div className={styles.depositPage}>
            {!connectedWallet ? (
              <div className={styles.card} style={{ textAlign: 'center', padding: '32px 18px' }}>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>Подключите TON-кошелёк для просмотра инвентаря</div>
                <button className={styles.payBtn} onClick={() => setProfileSub('wallet')}>Подключить кошелёк</button>
              </div>
            ) : (
              <>
                <div className={styles.pills} style={{ marginBottom: 12 }}>
                  {(['nft', 'numbers', 'usernames'] as const).map((t) => (
                    <button key={t} className={`${styles.pill} ${inventoryTab === t ? styles.pillOn : ''}`} onClick={() => setInventoryTab(t)}>
                      {t === 'nft' ? 'НФТ' : t === 'numbers' ? 'Номера' : 'Юзернеймы'}
                    </button>
                  ))}
                </div>
                {walletLoading ? (
                  <div className={styles.empty}><span className={styles.spinner} /></div>
                ) : (() => {
                  const filtered = walletItems.filter((it) => {
                    if (inventoryTab === 'nft') return it.type === 'nft';
                    if (inventoryTab === 'numbers') return it.type === 'number';
                    return it.type === 'username';
                  });
                  if (filtered.length === 0) {
                    return <div className={styles.empty}>{inventoryTab === 'nft' ? 'Нет NFT' : inventoryTab === 'numbers' ? 'Нет номеров' : 'Нет юзернеймов'}</div>;
                  }
                  return (
                    <div className={styles.p2pList}>
                      {filtered.map((it) => (
                        <div key={it.address} className={styles.p2pCard}>
                          <div className={styles.p2pAvatar} style={{ backgroundImage: it.nft?.still ? `url(${it.nft.still})` : it.image ? `url(${it.image})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}>
                            {!it.nft?.still && !it.image && <span className={styles.p2pAvatarLetter}>{it.name.charAt(0).toUpperCase()}</span>}
                            {it.nft && <div className={styles.p2pLottieWrap}><LottiePlayer src={it.nft.lottie} still={it.nft.still} className={styles.p2pLottie} hoverOnly /></div>}
                          </div>
                          <div className={styles.p2pInfo}>
                            <div className={styles.p2pName}>{it.name}</div>
                            <div className={styles.p2pBadges}><span className={styles.p2pBadgeType}>{it.subtitle}</span></div>
                          </div>
                          <div className={styles.p2pRight}>
                            <button className={styles.sellBtn} onClick={() => { setSellItem(it); setProfileSub('sell'); }}>Продать</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}
      </>
    );
  }

  // Main profile view
  return (
    <>
      <div className={styles.topbar}>
        <h1 className={styles.pageTitle} style={{ margin: 0 }}>Профиль</h1>
      </div>

      <div className={styles.profileCard}>
        <div className={styles.profileAvatar}>{avatar ? <img src={avatar} alt="" className={styles.profileAvatarImg} /> : <span>{initial}</span>}</div>
        <div className={styles.profileMeta}>
          <div className={styles.premiumNameRow}>
            <span className={styles.profileName}>{displayName}</span>
            {isPro && <PremiumBadge size={20} />}
          </div>
          <div className={styles.profileUser}>@{username || firstName || 'user'}</div>
          {isPremium && <span className={styles.verified}><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5z" /></svg>Проверенный</span>}
        </div>
        <svg className={styles.profileChev} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
      </div>

      <div className={styles.balanceTabs}>
        <button className={`${styles.balanceTab} ${balanceTab === 'rub' ? styles.balanceTabOn : ''}`} onClick={() => setBalanceTab('rub')}>Кошелёк</button>
        <button className={`${styles.balanceTab} ${balanceTab === 'crypto' ? styles.balanceTabOn : ''}`} onClick={() => setBalanceTab('crypto')}>Крипто кошелёк</button>
      </div>
      {balanceTab === 'rub' ? (
        <div className={styles.balanceCard}>
          <div><div className={styles.balanceLabel}>Баланс</div><div className={styles.balanceValue}>{fmt(balance)} ₽</div></div>
          <button className={styles.topUpBtn} onClick={() => { haptic('light'); setProfileSub('deposit'); }}>+ Пополнить</button>
        </div>
      ) : (
        <div className={styles.balanceCard}>
          <div>
            <div className={styles.balanceLabel}>TON баланс</div>
            {connectedWallet ? (
              <div className={styles.balanceValue}>{tonBalance !== null ? `${tonBalance.toFixed(4)} TON` : '...'}</div>
            ) : (
              <div className={styles.balanceValue}>—</div>
            )}
            {tonBalance !== null && tonPrice > 0 && (
              <div className={styles.balanceSub}>≈ {fmt(Math.round(tonBalance * tonPrice))} ₽</div>
            )}
          </div>
          {connectedWallet ? (
            <button className={styles.topUpBtn} onClick={() => { haptic('light'); setProfileSub('wallet'); }}>Открыть</button>
          ) : (
            <button className={styles.topUpBtn} onClick={() => { haptic('light'); setProfileSub('wallet'); }}>Привязать</button>
          )}
        </div>
      )}

      <div className={styles.menu}>
        {[
          { t: 'Мой кошелёк', a: () => setProfileSub('wallet'), i: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 10H2" /></> },
          { t: 'Инвентарь', a: () => setProfileSub('inventory'), i: <><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></> },
          { t: 'История операций', a: () => setProfileSub('ops'), i: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></> },
          { t: 'Мои покупки', a: () => setProfileSub('purchases'), i: <><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" /></> },
          { t: 'Избранное', a: () => showToast('Раздел скоро появится'), i: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /> },
        ].map((m, i) => (
          <button key={i} className={styles.menuItem} onClick={m.a}>
            <span className={styles.menuIcon}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{m.i}</svg></span>
            <span className={styles.menuText}>{m.t}</span>
            <svg className={styles.chev} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        ))}
      </div>
    </>
  );
}
