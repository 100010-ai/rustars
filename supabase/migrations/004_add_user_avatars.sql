CREATE TABLE IF NOT EXISTS tma_user_avatars (
  telegram_id   BIGINT PRIMARY KEY,
  photo_url     TEXT,
  expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_avatars_expires ON tma_user_avatars (expires_at);
