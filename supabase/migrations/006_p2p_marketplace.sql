-- ============================================================
-- RuStars — P2P Marketplace
-- ============================================================

-- ─── Привязанные кошельки ───
CREATE TABLE IF NOT EXISTS tma_wallets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id  BIGINT NOT NULL UNIQUE,
  address      TEXT NOT NULL,                  -- TON wallet address (base64)
  verified     BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallets_tg ON tma_wallets (telegram_id);

-- ─── P2P-листинги ───
CREATE TABLE IF NOT EXISTS tma_p2p_listings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_tg_id     BIGINT NOT NULL,
  seller_username  TEXT,
  seller_avatar    TEXT,
  item_type        TEXT NOT NULL,                -- nft | username | number
  item_address     TEXT NOT NULL,                -- TON NFT address / username
  item_name        TEXT NOT NULL,                -- display name
  item_image       TEXT,                         -- preview image URL
  item_lottie      TEXT,                         -- lottie animation URL (Fragment)
  item_still       TEXT,                         -- still frame URL (Fragment)
  item_slug        TEXT,                         -- Fragment slug (for NFTs)
  item_num         INTEGER,                      -- Fragment number
  price_rub        NUMERIC(12, 2) NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active', -- active | sold | cancelled
  buyer_tg_id      BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sold_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_p2p_status    ON tma_p2p_listings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_p2p_seller    ON tma_p2p_listings (seller_tg_id);
CREATE INDEX IF NOT EXISTS idx_p2p_item_addr ON tma_p2p_listings (item_address);

-- ─── RLS ───
ALTER TABLE tma_wallets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tma_p2p_listings   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "svc wallets"     ON tma_wallets;
DROP POLICY IF EXISTS "svc p2p"         ON tma_p2p_listings;

CREATE POLICY "svc wallets"   ON tma_wallets       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "svc p2p"       ON tma_p2p_listings   FOR ALL USING (true) WITH CHECK (true);
