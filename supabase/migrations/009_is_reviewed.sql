-- ============================================================
-- RuStars — Add is_reviewed to orders + extend wallet kinds
-- ============================================================

-- Add is_reviewed to tma_stars_orders
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tma_stars_orders' AND column_name = 'is_reviewed'
  ) THEN
    ALTER TABLE tma_stars_orders ADD COLUMN is_reviewed BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Extend wallet txn kinds
DO $$
BEGIN
  ALTER TABLE tma_wallet_txns DROP CONSTRAINT IF EXISTS tma_wallet_txns_kind_check;
  ALTER TABLE tma_wallet_txns
    ADD CONSTRAINT tma_wallet_txns_kind_check
    CHECK (kind IN ('deposit', 'referral', 'withdraw', 'spend', 'task_reward', 'review_reward'));
END $$;
