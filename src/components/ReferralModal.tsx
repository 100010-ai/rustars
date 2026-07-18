'use client';

import { useEffect, useState, useMemo } from 'react';
import styles from './ReferralModal.module.css';

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || 'RuStarsBot';

interface Props {
  open: boolean;
  onClose: () => void;
  username: string;
}

function GiftBox() {
  return (
    <svg className={styles.giftIcon} viewBox="0 0 120 120" fill="none">
      <ellipse cx="60" cy="108" rx="35" ry="6" fill="rgba(0,0,0,0.1)" />
      <rect x="20" y="52" width="80" height="52" rx="6" fill="#2481cc" />
      <rect x="52" y="52" width="16" height="52" fill="#FFD700" />
      <rect x="16" y="40" width="88" height="18" rx="4" fill="#3B82F6" />
      <rect x="52" y="40" width="16" height="18" fill="#FFD700" />
      <ellipse cx="48" cy="36" rx="14" ry="10" fill="#FFD700" transform="rotate(-15 48 36)" />
      <ellipse cx="72" cy="36" rx="14" ry="10" fill="#FFD700" transform="rotate(15 72 36)" />
      <circle cx="60" cy="38" r="6" fill="#EAB308" />
    </svg>
  );
}

export default function ReferralModal({ open, onClose, username }: Props) {
  const [copied, setCopied] = useState(false);

  const referralLink = `https://t.me/${BOT_USERNAME}?start=ref_${username || 'user'}`;

  useEffect(() => {
    if (open) setCopied(false);
  }, [open]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleShare = () => {
    window.Telegram?.WebApp?.openLink(
      `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Купи Telegram Stars дешевле!')}`,
    );
  };

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()}>
        <div className={styles.banner}>
          <button className={styles.closeBtn} onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <div className={styles.giftBox}><GiftBox /></div>
          <h2 className={styles.bannerTitle}>Пригласите друзей<br />и получайте бонусы</h2>
          <p className={styles.bannerSubtitle}>
            Вы получите бонус 5% от всех пополнений<br />друзей звёздами
          </p>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.buttons}>
            <button className={styles.shareBtn} onClick={handleShare}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              Поделиться ссылкой
            </button>
            <button className={`${styles.copyBtn} ${copied ? styles.copyBtnCopied : ''}`} onClick={handleCopy}>
              {copied ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              )}
            </button>
          </div>

          <div className={styles.howSection}>
            <h3 className={styles.howTitle}>Как это работает</h3>
            <div className={styles.howSteps}>
              <div className={styles.howStep}>
                <span className={styles.howStepNum}>1</span>
                <div className={styles.howStepContent}>
                  <div className={styles.howStepTitle}>Друг покупает звёзды</div>
                  <div className={styles.howStepDesc}>По вашей реферальной ссылке</div>
                </div>
              </div>
              <div className={styles.howStep}>
                <span className={styles.howStepNum}>2</span>
                <div className={styles.howStepContent}>
                  <div className={styles.howStepTitle}>Вы получаете 5% от суммы</div>
                  <div className={styles.howStepDesc}>Бонус на баланс в звёздах</div>
                </div>
              </div>
              <div className={styles.howStep}>
                <span className={styles.howStepNum}>3</span>
                <div className={styles.howStepContent}>
                  <div className={styles.howStepTitle}>Используйте бонусы</div>
                  <div className={styles.howStepDesc}>Оплачивайте звёзды бонусами</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}