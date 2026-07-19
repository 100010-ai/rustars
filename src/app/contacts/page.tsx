import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Контакты — RuStars',
  description: 'Контактная информация RuStars',
};

export default function ContactsPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px', fontFamily: 'system-ui, sans-serif', color: '#1e293b', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 32 }}>Контакты</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ background: '#f8fafc', borderRadius: 16, padding: 24, border: '1px solid #e2e8f0' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Индивидуальный предприниматель</h2>
          <p style={{ fontSize: 15, marginBottom: 4 }}>
            <strong>ФИО:</strong> МУРАВЬЁВ Константин Алексеевич
          </p>
          <p style={{ fontSize: 15, marginBottom: 4 }}>
            <strong>ИНН:</strong> 713304603876
          </p>
          <p style={{ fontSize: 15, marginBottom: 4 }}>
            <strong>Статус:</strong> Самозанятый (Налог на профессиональный доход)
          </p>
        </div>

        <div style={{ background: '#f8fafc', borderRadius: 16, padding: 24, border: '1px solid #e2e8f0' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Связаться с нами</h2>
          <p style={{ fontSize: 15, marginBottom: 8 }}>
            <strong>Telegram бот:</strong>{' '}
            <a href="https://t.me/emptytemp" style={{ color: '#6366f1' }}>@emptytemp</a>
          </p>
          <p style={{ fontSize: 15, marginBottom: 8 }}>
            <strong>Канал:</strong>{' '}
            <a href="https://t.me/RuStarsOfficial" style={{ color: '#6366f1' }}>@RuStarsOfficial</a>
          </p>
          <p style={{ fontSize: 15 }}>
            <strong>Email:</strong>{' '}
            <a href="mailto:reyzin378@gmail.com" style={{ color: '#6366f1' }}>reyzin378@gmail.com</a>
          </p>
        </div>

        <div style={{ background: '#f8fafc', borderRadius: 16, padding: 24, border: '1px solid #e2e8f0' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>О сервисе</h2>
          <p style={{ fontSize: 15, marginBottom: 8 }}>
            RuStars — сервис для пополнения Telegram Stars и покупки Telegram Premium.
            Работаем через СБП и банковские карты.
          </p>
          <p style={{ fontSize: 15 }}>
            Все расчёты производятся в российских рублях. Сервис предназначен для пользователей из России.
          </p>
        </div>

        <div style={{ background: '#f8fafc', borderRadius: 16, padding: 24, border: '1px solid #e2e8f0' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Правовая информация</h2>
          <p style={{ fontSize: 15, marginBottom: 8 }}>
            <a href="/offer" style={{ color: '#6366f1' }}>Публичная оферта</a>
          </p>
          <p style={{ fontSize: 15 }}>
            Сервис предоставляет информационные услуги по пополнению Telegram Stars.
          </p>
        </div>
      </div>
    </main>
  );
}
