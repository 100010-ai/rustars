import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { validateEnvironment } from '@/lib/security/startup';
import './globals.css';

// Validate env vars on first import (server-side only)
if (typeof window === 'undefined') {
  try {
    validateEnvironment();
  } catch (err) {
    console.error('[Startup] Environment validation failed:', err);
  }
}

export const metadata: Metadata = {
  title: 'RuStars — Пополнение Telegram Stars',
  description: 'Быстрое и безопасное пополнение Telegram Stars через СБП и банковские карты. Работаем для пользователей из России.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#F5F6FA',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body>
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
