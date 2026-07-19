-- ============================================================
-- Таблица для rate limiting на serverless (Vercel)
-- Используется как persistent sliding window
-- ============================================================

CREATE TABLE IF NOT EXISTS tma_rate_limits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Индекс для быстрого поиска по key + created_at
CREATE INDEX IF NOT EXISTS idx_rate_limits_key_time
  ON tma_rate_limits (key, created_at);

-- Автоочистка старых записей (pg_cron или ручной вызов)
-- Оставляем RLS выключенным — это служебная таблица
