import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Публичная оферта — RuStars',
  description: 'Публичная оферта на оказание услуг по пополнению Telegram Stars',
};

export default function OfferPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px', fontFamily: 'system-ui, sans-serif', color: '#1e293b', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 24 }}>Публичная оферта</h1>
      <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>Дата публикации: 18 июля 2026 г.</p>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>1. Общие положения</h2>
        <p style={{ fontSize: 15 }}>
          Настоящий документ является официальным предложением (публичной офертой) индивидуального предпринимателя,
          применяющего налоговую систему &laquo;Налог на профессиональный доход&raquo; (самозанятый):
        </p>
        <p style={{ fontSize: 15, fontWeight: 600, marginTop: 8 }}>
          МУРАВЬЁВ Константин Алексеевич<br />
          ИНН: 713304603876<br />
          Статус: Самозанятый (НПД)
        </p>
        <p style={{ fontSize: 15, marginTop: 8 }}>
          (далее &mdash; &laquo;Исполнитель&raquo;) любому физическому лицу (далее &mdash; &laquo;Заказчик&raquo;)
          на оказание информационных услуг по пополнению баланса Telegram Stars.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>2. Предмет оферты</h2>
        <p style={{ fontSize: 15 }}>
          Исполнитель оказывает Заказчику услуги по пополнению баланса Telegram Stars в аккаунте Telegram,
          указанном Заказчиком. Услуги оказываются дистанционно, через веб-приложение RuStars (Telegram Mini App).
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>3. Порядок оплаты</h2>
        <p style={{ fontSize: 15 }}>
          Оплата осуществляется онлайн через платёжную систему ЮKassa. Стоимость услуг указывается
          в российских рублях и включает все необходимые комиссии. Курс конвертации рассчитывается
          автоматически на основе актуальных рыночных котировок.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>4. Порядок оказания услуг</h2>
        <p style={{ fontSize: 15 }}>
          После успешной оплаты Исполнитель осуществляет пополнение баланса Telegram Stars в течение
          24 часов. В большинстве случаев пополнение происходит в течение нескольких минут.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>5. Возврат средств</h2>
        <p style={{ fontSize: 15 }}>
          В случае невозможности оказания услуги по техническим причинам Исполнитель осуществляет
          полный возврат средств в течение 3 рабочих дней. Возврат производится на способ оплаты,
          использованный при заказе.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>6. Ответственность</h2>
        <p style={{ fontSize: 15 }}>
          Исполнитель не несёт ответственности за действия третьих лиц (Telegram, Fragment, блокчейн TON),
          которые могут повлиять на сроки или возможность оказания услуги. Исполнитель обязуется
          предпринять все разумные меры для своевременного оказания услуги.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>7. Контактная информация</h2>
        <p style={{ fontSize: 15 }}>
          По вопросам оказания услуг обращайтесь:<br />
          Telegram: <a href="https://t.me/emptytemp" style={{ color: '#6366f1' }}>@emptytemp</a><br />
          Email: reyzin378@gmail.com
        </p>
      </section>
    </main>
  );
}
