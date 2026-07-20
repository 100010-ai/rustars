/**
 * PremiumBadge — SVG-иконка Telegram Premium (12-конечная звезда + галочка).
 *
 * Используется рядом с никнеймом пользователя когда is_pro === true.
 * Чистый SVG без зависимостей, CSS-анимация пульсации.
 */

import styles from '@/app/page.module.css';

interface PremiumBadgeProps {
  size?: number;
}

export default function PremiumBadge({ size = 20 }: PremiumBadgeProps) {
  return (
    <span className={styles.premiumBadge}>
      <svg
        className={styles.premiumBadgeSvg}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Фирменный градиент Telegram Premium: фиолетовый → розовый */}
          <linearGradient id="premiumGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8A3AF5" />
            <stop offset="50%" stopColor="#BD3AF5" />
            <stop offset="100%" stopColor="#E63AF5" />
          </linearGradient>
        </defs>

        {/* 12-конечная ломаная звезда Telegram Premium */}
        <path
          d="M12 1.5L14.09 7.26L16.5 3.5L15.5 8.5L20.5 6.5L16.91 10.91L22 12L16.91 13.09L20.5 17.5L15.5 15.5L16.5 20.5L14.09 16.74L12 22.5L9.91 16.74L7.5 20.5L8.5 15.5L3.5 17.5L7.09 13.09L2 12L7.09 10.91L3.5 6.5L8.5 8.5L7.5 3.5L9.91 7.26L12 1.5Z"
          fill="url(#premiumGrad)"
        />

        {/* Белая галочка (check mark) по центру */}
        <path
          d="M10.5 15.5L7.5 12.5L6.5 13.5L10.5 17.5L18 10L17 9L10.5 15.5Z"
          fill="white"
          stroke="white"
          strokeWidth="0.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
