import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { validateEnvironment } from '@/lib/security/startup';
import { SecurityProvider } from '@/components/SecurityProvider';
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
  title: 'RuStars',
  description: 'Пополнение Telegram Stars через СБП и банковские карты.',
  other: {
    'format-detection': 'telephone=no',
    'msapplication-TileColor': '#F5F6FA',
    'theme-color': '#F5F6FA',
  },
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
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
        <meta httpEquiv="X-Frame-Options" content="DENY" />
        <meta name="referrer" content="no-referrer" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Cache-Control" content="no-store, no-cache, must-revalidate" />
      </head>
      <body>
        <SecurityProvider>
          <ErrorBoundary>{children}</ErrorBoundary>
        </SecurityProvider>
      </body>
    </html>
  );
}
