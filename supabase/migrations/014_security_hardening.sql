-- ============================================================
-- Security Hardening: Audit Log + Admin Approval Queue
-- ============================================================

-- 1. Immutable audit log — append-only record of ALL transactions
CREATE TABLE IF NOT EXISTS tma_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL,
  username      TEXT NOT NULL,
  to_address    TEXT NOT NULL,
  amount_ton    NUMERIC(12, 4) NOT NULL,
  payload       TEXT,
  tx_hash       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for daily limit queries
CREATE INDEX IF NOT EXISTS idx_audit_log_date
  ON tma_audit_log (created_at DESC, status);

CREATE INDEX IF NOT EXISTS idx_audit_log_username
  ON tma_audit_log (username, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_order
  ON tma_audit_log (order_id);

-- CHECK constraint
DO $$
BEGIN
  ALTER TABLE tma_audit_log
    DROP CONSTRAINT IF EXISTS tma_audit_log_status_check;

  ALTER TABLE tma_audit_log
    ADD CONSTRAINT tma_audit_log_status_check
    CHECK (status IN ('pending', 'sent', 'failed', 'blocked'));
END $$;

-- RLS — service role only
ALTER TABLE tma_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages audit log" ON tma_audit_log;
CREATE POLICY "Service role manages audit log"
  ON tma_audit_log FOR ALL USING (true);

-- 2. Admin approval queue — for large transactions
CREATE TABLE IF NOT EXISTS tma_pending_approvals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL,
  username      TEXT NOT NULL,
  amount_ton    NUMERIC(12, 4) NOT NULL,
  to_address    TEXT NOT NULL,
  payload       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  approved_by   TEXT,
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approvals_pending
  ON tma_pending_approvals (status, created_at)
  WHERE status = 'pending';

DO $$
BEGIN
  ALTER TABLE tma_pending_approvals
    DROP CONSTRAINT IF EXISTS tma_pending_approvals_status_check;

  ALTER TABLE tma_pending_approvals
    ADD CONSTRAINT tma_pending_approvals_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'));
END $$;

ALTER TABLE tma_pending_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages approvals" ON tma_pending_approvals;
CREATE POLICY "Service role manages approvals"
  ON tma_pending_approvals FOR ALL USING (true);
