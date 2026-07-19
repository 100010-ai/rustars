-- ============================================================
-- RuStars — кошелёк (рублёвый баланс) + реферальная программа
-- Идемпотентно: можно запускать повторно
-- ============================================================

-- ─── 1. Рублёвый баланс пользователя ───
CREATE TABLE IF NOT EXISTS tma_balances (
  telegram_id  BIGINT PRIMARY KEY,
  balance_rub  NUMERIC(12, 2) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 2. Леджер транзакций кошелька ───
CREATE TABLE IF NOT EXISTS tma_wallet_txns (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id  BIGINT NOT NULL,
  kind         TEXT NOT NULL,             -- deposit | referral | withdraw | spend
  amount_rub   NUMERIC(12, 2) NOT NULL,   -- + пополнение, - списание
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | done | failed
  payment_id   TEXT,
  meta         JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_txns_tg   ON tma_wallet_txns (telegram_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_txns_pay  ON tma_wallet_txns (payment_id);

DO $$
BEGIN
  ALTER TABLE tma_wallet_txns DROP CONSTRAINT IF EXISTS tma_wallet_txns_kind_check;
  ALTER TABLE tma_wallet_txns
    ADD CONSTRAINT tma_wallet_txns_kind_check
    CHECK (kind IN ('deposit', 'referral', 'withdraw', 'spend'));
END $$;

-- ─── 3. Рефералы ───
CREATE TABLE IF NOT EXISTS tma_referrals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id       BIGINT NOT NULL,           -- кто пригласил
  referred_id       BIGINT NOT NULL UNIQUE,    -- кого пригласили (1 приглашающий на юзера)
  referred_username TEXT,
  total_earned_rub  NUMERIC(12, 2) NOT NULL DEFAULT 0,
  first_order_at    TIMESTAMPTZ,               -- «активный» = сделал первый оплаченный заказ
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON tma_referrals (referrer_id);

-- ─── 4. Атрибуция реферала на заказ ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tma_stars_orders' AND column_name = 'referred_by'
  ) THEN
    ALTER TABLE tma_stars_orders ADD COLUMN referred_by BIGINT;
  END IF;
END $$;

-- ─── 5. RLS (доступ только через service_role в API) ───
ALTER TABLE tma_balances     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tma_wallet_txns  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tma_referrals    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "svc balances"  ON tma_balances;
DROP POLICY IF EXISTS "svc txns"      ON tma_wallet_txns;
DROP POLICY IF EXISTS "svc referrals" ON tma_referrals;

CREATE POLICY "svc balances"  ON tma_balances     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "svc txns"      ON tma_wallet_txns  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "svc referrals" ON tma_referrals    FOR ALL USING (true) WITH CHECK (true);

-- ─── 6. Атомарное изменение баланса (не даёт уйти в минус) ───
CREATE OR REPLACE FUNCTION tma_adjust_balance(p_tg BIGINT, p_delta NUMERIC)
RETURNS NUMERIC AS $$
DECLARE
  new_balance NUMERIC;
BEGIN
  INSERT INTO tma_balances (telegram_id, balance_rub, updated_at)
    VALUES (p_tg, GREATEST(p_delta, 0), now())
  ON CONFLICT (telegram_id) DO UPDATE
    SET balance_rub = tma_balances.balance_rub + p_delta,
        updated_at  = now()
  RETURNING balance_rub INTO new_balance;

  IF new_balance < 0 THEN
    RAISE EXCEPTION 'insufficient_funds';
  END IF;

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;
