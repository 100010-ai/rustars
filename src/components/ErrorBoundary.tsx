'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    // In production, don't log error details to console (prevents info leakage)
    if (process.env.NODE_ENV === 'development') {
      console.error('[ErrorBoundary]', error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: 20,
            textAlign: 'center',
            fontFamily: 'system-ui, sans-serif',
          }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h2 style={{ marginTop: 16, fontSize: 18, fontWeight: 700 }}>Что-то пошло не так</h2>
            <p style={{ marginTop: 8, fontSize: 14, color: '#6B7280' }}>
              Попробуйте обновить страницу или обратитесь в поддержку
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 16,
                padding: '10px 24px',
                borderRadius: 10,
                background: '#6C5CE7',
                color: '#fff',
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Обновить страницу
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
