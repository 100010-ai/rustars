-- ============================================================
-- RuStars — Extend wallet txn kinds
-- ============================================================

DO $$
BEGIN
  ALTER TABLE tma_wallet_txns DROP CONSTRAINT IF EXISTS tma_wallet_txns_kind_check;
  ALTER TABLE tma_wallet_txns
    ADD CONSTRAINT tma_wallet_txns_kind_check
    CHECK (kind IN ('deposit', 'referral', 'withdraw', 'spend', 'task_reward', 'review_reward'));
END $$;
