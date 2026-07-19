-- ============================================================
-- RuStars — Feedback & Reviews System
-- ============================================================

CREATE TABLE IF NOT EXISTS tma_waiting_feedback (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id  BIGINT NOT NULL UNIQUE,
  order_id     UUID,
  waiting      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waiting_feedback_tg ON tma_waiting_feedback (telegram_id);

ALTER TABLE tma_waiting_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "svc waiting_feedback" ON tma_waiting_feedback;
CREATE POLICY "svc waiting_feedback" ON tma_waiting_feedback FOR ALL USING (true) WITH CHECK (true);
