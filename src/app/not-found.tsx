'use client';

export default function NotFound() {
  return (
    <main style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      backgroundColor: '#F5F6FA',
      color: '#333',
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '48px', margin: 0, fontWeight: 700 }}>404</h1>
        <p style={{ fontSize: '16px', marginTop: '8px', color: '#666' }}>Страница не найдена</p>
      </div>
    </main>
  );
}
