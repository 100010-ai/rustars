-- ═══════════════════════════════════════════════════════════
-- 015: Stars Buyback System (Скупка Telegram Stars)
-- ═══════════════════════════════════════════════════════════
--
-- Система позволяет пользователям продавать Telegram Stars
-- за рубли на банковские карты через YooKassa Payouts API.
--
-- Архитектура:
--   1. Пользователь создаёт заявку на скупку
--   2. Система генерирует инвойс Telegram Stars
--   3. Пользователь оплачивает Stars
--   4. Система верифицирует приход GRAM в блокчейне
--   5. YooKassa переводит рубли на карту пользователя
--
-- Безопасность:
--   - RLS: анонимы не могут читать/писать payout_orders
--   - Статусы меняются только через service role
--   - Card number маскируется при сохранении
--   - Audit log для каждой транзакции
-- ═══════════════════════════════════════════════════════════

-- ─── 1. ADD stars_buy_rate_rub TO system_rates ───

-- Проверяем существует ли таблица system_rates
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'system_rates') THEN
    CREATE TABLE system_rates (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  END IF;
END $$;

-- Добавляем поле stars_buy_rate_rub если его нет
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'system_rates' AND column_name = 'stars_buy_rate_rub'
  ) THEN
    ALTER TABLE system_rates ADD COLUMN stars_buy_rate_rub DECIMAL(10,4) DEFAULT 0.80;
  END IF;
END $$;

-- Устанавливаем базовый курс скупки: 0.80 рубля за 1 Star
INSERT INTO system_rates (key, stars_buy_rate_rub, updated_at)
VALUES ('buyback', 0.80, NOW())
ON CONFLICT (key) DO UPDATE SET
  stars_buy_rate_rub = COALESCE(EXCLUDED.stars_buy_rate_rub, system_rates.stars_buy_rate_rub),
  updated_at = NOW();


-- ─── 2. CREATE payout_orders TABLE ───

CREATE TABLE IF NOT EXISTS payout_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL,
  stars_amount INT NOT NULL CHECK (stars_amount > 0),
  rub_to_pay DECIMAL(10,2) NOT NULL CHECK (rub_to_pay > 0),

  -- Маскированный номер карты (последние 4 цифры видны)
  card_number_masked VARCHAR(19) NOT NULL,

  -- Fragment transaction hash (BoC) для верификации прихода GRAM
  fragment_tx_hash VARCHAR(128),

  -- YooKassa payout transaction ID
  payout_id VARCHAR(128),

  -- Статус ордера
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN (
      'created',           -- Ордер создан, ожидает оплаты Stars
      'pending_stars',     -- Инвойс отправлен, ожидаем Stars
      'stars_received',    -- Stars получены, GRAM верифицирован
      'processing_payout', -- YooKassa обрабатывает выплату
      'success_payout',    -- Выплата завершена успешно
      'failed',            -- Выплата провалилась
      'manual_verification'-- Требует ручной проверки
    )),

  -- Дополнительная информация
  error_message TEXT,
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ограничения
  CONSTRAINT valid_stars_amount CHECK (stars_amount >= 50),
  CONSTRAINT valid_card_format CHECK (card_number_masked ~ '^\*{4,}\d{4}$')
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_payout_orders_user_id ON payout_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_payout_orders_status ON payout_orders(status);
CREATE INDEX IF NOT EXISTS idx_payout_orders_created_at ON payout_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payout_orders_fragment_tx ON payout_orders(fragment_tx_hash) WHERE fragment_tx_hash IS NOT NULL;


-- ─── 3. CREATE payout_limits TABLE (для anti-fraud) ───

CREATE TABLE IF NOT EXISTS payout_daily_limits (
  user_id BIGINT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_rub DECIMAL(10,2) DEFAULT 0,
  total_orders INT DEFAULT 0,
  PRIMARY KEY (user_id, date)
);


-- ─── 4. RLS POLICIES ───

-- Включаем RLS
ALTER TABLE payout_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_daily_limits ENABLE ROW LEVEL SECURITY;

-- Удаляем старые политики если есть
DROP POLICY IF EXISTS "payout_orders_service_only" ON payout_orders;
DROP POLICY IF EXISTS "payout_daily_limits_service_only" ON payout_daily_limits;

-- payout_orders: только service role может читать/писать
CREATE POLICY "payout_orders_service_only" ON payout_orders
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- anon и authenticated: НЕ могут ничего делать с payout_orders
CREATE POLICY "payout_orders_anon_deny" ON payout_orders
  FOR SELECT
  USING (false);

CREATE POLICY "payout_orders_anon_no_insert" ON payout_orders
  FOR INSERT
  WITH CHECK (false);

CREATE POLICY "payout_orders_anon_no_update" ON payout_orders
  FOR UPDATE
  USING (false);

-- payout_daily_limits: только service role
CREATE POLICY "payout_daily_limits_service_only" ON payout_daily_limits
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- ─── 5. UPDATED_AT TRIGGER ───

CREATE OR REPLACE FUNCTION update_payout_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_payout_orders_updated_at ON payout_orders;
CREATE TRIGGER trigger_payout_orders_updated_at
  BEFORE UPDATE ON payout_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_payout_orders_updated_at();


-- ─── 6. AUDIT LOG TABLE (для защиты от чарджбеков) ───

CREATE TABLE IF NOT EXISTS payout_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_order_id UUID REFERENCES payout_orders(id),
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payout_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payout_audit_service_only" ON payout_audit_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_payout_audit_order ON payout_audit_log(payout_order_id);
CREATE INDEX IF NOT EXISTS idx_payout_audit_created ON payout_audit_log(created_at DESC);


-- ─── 7. HELPER: маскирование номера карты ───

CREATE OR REPLACE FUNCTION mask_card_number(card TEXT)
RETURNS TEXT AS $$
BEGIN
  -- Сохраняем только последние 4 цифры, заменяем остальное на *
  IF LENGTH(card) < 8 THEN
    RETURN '****' || RIGHT(card, 4);
  END IF;
  RETURN REPEAT('*', LENGTH(card) - 4) || RIGHT(card, 4);
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ─── 8. HELPER: проверка дневного лимита ───

CREATE OR REPLACE FUNCTION check_payout_daily_limit(
  p_user_id BIGINT,
  p_amount DECIMAL
)
RETURNS BOOLEAN AS $$
DECLARE
  current_total DECIMAL;
  max_daily DECIMAL := 10000; -- 10,000 рублей в сутки
BEGIN
  SELECT COALESCE(total_rub, 0) INTO current_total
  FROM payout_daily_limits
  WHERE user_id = p_user_id AND date = CURRENT_DATE;

  IF current_total + p_amount > max_daily THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;


-- ─── 9. HELPER: обновление дневного лимита ───

CREATE OR REPLACE FUNCTION update_payout_daily_limit(
  p_user_id BIGINT,
  p_amount DECIMAL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO payout_daily_limits (user_id, date, total_rub, total_orders)
  VALUES (p_user_id, CURRENT_DATE, p_amount, 1)
  ON CONFLICT (user_id, date) DO UPDATE SET
    total_rub = payout_daily_limits.total_rub + p_amount,
    total_orders = payout_daily_limits.total_orders + 1;
END;
$$ LANGUAGE plpgsql;
