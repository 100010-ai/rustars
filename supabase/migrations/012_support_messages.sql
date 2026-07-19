-- ============================================================
-- Таблица для маппинга сообщений поддержки (заменяет in-memory)
-- admin_msg_id → user_id для ответов админа
-- ============================================================

CREATE TABLE IF NOT EXISTS tma_support_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_msg_id  BIGINT UNIQUE NOT NULL,
  user_id       BIGINT NOT NULL,
  username      TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_user
  ON tma_support_messages (user_id, created_at DESC);

-- RLS — служебная таблица, доступ только через service role
ALTER TABLE tma_support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages support messages" ON tma_support_messages;
CREATE POLICY "Service role manages support messages"
  ON tma_support_messages FOR ALL USING (true);
