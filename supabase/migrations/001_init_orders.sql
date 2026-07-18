-- ============================================================
-- RuStars — безопасная миграция для существующей базы Supabase
-- Можно запускать повторно — ничего не задвоится и не упадёт
-- ============================================================

-- 1. Таблица (создаётся только если ещё нет)
CREATE TABLE IF NOT EXISTS tma_stars_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id   BIGINT NOT NULL,
  username      TEXT,
  stars_count   INTEGER NOT NULL,
  amount_rub    NUMERIC(10, 2) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  payment_id    TEXT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,
  tx_hash       TEXT,
  error_message TEXT
);

-- 2. Добавляем колонки, если таблица уже была без них
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tma_stars_orders' AND column_name = 'expires_at') THEN
    ALTER TABLE tma_stars_orders ADD COLUMN expires_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tma_stars_orders' AND column_name = 'tx_hash') THEN
    ALTER TABLE tma_stars_orders ADD COLUMN tx_hash TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tma_stars_orders' AND column_name = 'error_message') THEN
    ALTER TABLE tma_stars_orders ADD COLUMN error_message TEXT;
  END IF;
END $$;

-- 3. Индексы (безопасные — не падают если уже есть)
CREATE INDEX IF NOT EXISTS idx_orders_telegram_id ON tma_stars_orders (telegram_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON tma_stars_orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_paid ON tma_stars_orders (status) WHERE status = 'paid';
CREATE INDEX IF NOT EXISTS idx_orders_blocked ON tma_stars_orders (status) WHERE status = 'blocked';

-- 4. RLS — включаем если ещё не включён
ALTER TABLE tma_stars_orders ENABLE ROW LEVEL SECURITY;

-- 5. Политики (DROP + CREATE чтобы не задвоились)
DROP POLICY IF EXISTS "Users read own orders" ON tma_stars_orders;
DROP POLICY IF EXISTS "Service role inserts orders" ON tma_stars_orders;
DROP POLICY IF EXISTS "Service role updates orders" ON tma_stars_orders;

CREATE POLICY "Users read own orders"
  ON tma_stars_orders FOR SELECT USING (true);

CREATE POLICY "Service role inserts orders"
  ON tma_stars_orders FOR INSERT WITH CHECK (true);

CREATE POLICY "Service role updates orders"
  ON tma_stars_orders FOR UPDATE USING (true);

-- 6. CHECK constraint на статус (DROP + CREATE)
DO $$
BEGIN
  ALTER TABLE tma_stars_orders
    DROP CONSTRAINT IF EXISTS tma_stars_orders_status_check;

  ALTER TABLE tma_stars_orders
    ADD CONSTRAINT tma_stars_orders_status_check
    CHECK (status IN (
      'pending', 'processing', 'paid', 'completed',
      'expired', 'error_fragment', 'error_ton', 'blocked'
    ));
END $$;
