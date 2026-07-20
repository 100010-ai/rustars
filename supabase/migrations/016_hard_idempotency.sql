-- ═══════════════════════════════════════════════════════════
-- 016: Hard Idempotency — UNIQUE constraints + duplicate handling
-- ═══════════════════════════════════════════════════════════
--
-- Защита от race condition при параллельных webhook'ах:
--   - yookassa_payment_id UNIQUE в tma_stars_orders
--   - payout_id UNIQUE в payout_orders
--   - При попытке вставить дубликат → PostgreSQL вернёт 23505
--   - Webhook handler ловит ошибку и возвращает 200 (чтобы погасить вебхук)
-- ═══════════════════════════════════════════════════════════

-- ─── 1. UNIQUE на yookassa_payment_id ───

-- Удаляем дубликаты через CTE (UUID не поддерживает MIN())
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY payment_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM tma_stars_orders
  WHERE payment_id IS NOT NULL
)
DELETE FROM tma_stars_orders
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- Добавляем UNIQUE constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uniq_stars_orders_payment_id'
  ) THEN
    ALTER TABLE tma_stars_orders
      ADD CONSTRAINT uniq_stars_orders_payment_id
      UNIQUE (payment_id);
  END IF;
END $$;

-- Индекс для быстрого поиска по payment_id
CREATE INDEX IF NOT EXISTS idx_stars_orders_payment_id
  ON tma_stars_orders(payment_id)
  WHERE payment_id IS NOT NULL;


-- ─── 2. UNIQUE на payout_id в payout_orders ───

WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY payout_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM payout_orders
  WHERE payout_id IS NOT NULL
)
DELETE FROM payout_orders
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uniq_payout_orders_payout_id'
  ) THEN
    ALTER TABLE payout_orders
      ADD CONSTRAINT uniq_payout_orders_payout_id
      UNIQUE (payout_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payout_orders_payout_id
  ON payout_orders(payout_id)
  WHERE payout_id IS NOT NULL;


-- ─── 3. RPC: идемпотентная вставка заказа ───

CREATE OR REPLACE FUNCTION insert_order_idempotent(
  p_id UUID,
  p_telegram_id BIGINT,
  p_username TEXT,
  p_stars_count INT,
  p_amount_rub DECIMAL,
  p_payment_id TEXT,
  p_product_type TEXT DEFAULT 'stars',
  p_premium_duration TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  result_id TEXT;
BEGIN
  INSERT INTO tma_stars_orders (
    id, telegram_id, username, stars_count, amount_rub,
    payment_id, status, product_type, premium_duration,
    created_at, expires_at
  ) VALUES (
    p_id, p_telegram_id, p_username, p_stars_count, p_amount_rub,
    p_payment_id, 'pending', p_product_type, p_premium_duration,
    NOW(), NOW() + INTERVAL '10 minutes'
  )
  ON CONFLICT (payment_id) DO NOTHING
  RETURNING id::TEXT INTO result_id;

  IF result_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'duplicate', true);
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', result_id);
END;
$$ LANGUAGE plpgsql;


-- ─── 4. RPC: идемпотентная вставка payout ───

CREATE OR REPLACE FUNCTION insert_payout_idempotent(
  p_id UUID,
  p_user_id BIGINT,
  p_stars_amount INT,
  p_rub_to_pay DECIMAL,
  p_card_number_masked TEXT,
  p_payout_id TEXT
)
RETURNS JSONB AS $$
DECLARE
  result_id TEXT;
BEGIN
  INSERT INTO payout_orders (
    id, user_id, stars_amount, rub_to_pay,
    card_number_masked, payout_id, status
  ) VALUES (
    p_id, p_user_id, p_stars_amount, p_rub_to_pay,
    p_card_number_masked, p_payout_id, 'created'
  )
  ON CONFLICT (payout_id) DO NOTHING
  RETURNING id::TEXT INTO result_id;

  IF result_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'duplicate', true);
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', result_id);
END;
$$ LANGUAGE plpgsql;
