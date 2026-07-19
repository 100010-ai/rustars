-- ============================================================
-- Очередь доставки звёзд/Premium
-- Гарантирует idempotent delivery без двойной выдачи
-- ============================================================

CREATE TABLE IF NOT EXISTS tma_delivery_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES tma_stars_orders(id),
  username          TEXT NOT NULL,
  product_type      TEXT NOT NULL DEFAULT 'stars',
  stars_count       INTEGER NOT NULL DEFAULT 0,
  premium_duration  TEXT,
  attempt           INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  status            TEXT NOT NULL DEFAULT 'pending',
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Индексы для быстрого поиска pending задач
CREATE INDEX IF NOT EXISTS idx_delivery_pending
  ON tma_delivery_queue (status, attempt, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_delivery_order
  ON tma_delivery_queue (order_id);

-- CHECK constraint
DO $$
BEGIN
  ALTER TABLE tma_delivery_queue
    DROP CONSTRAINT IF EXISTS tma_delivery_queue_status_check;

  ALTER TABLE tma_delivery_queue
    ADD CONSTRAINT tma_delivery_queue_status_check
    CHECK (status IN ('pending', 'processing', 'done', 'failed'));
END $$;

-- RLS
ALTER TABLE tma_delivery_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages delivery queue" ON tma_delivery_queue;
CREATE POLICY "Service role manages delivery queue"
  ON tma_delivery_queue FOR ALL USING (true);
