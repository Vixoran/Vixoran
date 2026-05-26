CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS touchpoints (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vid                   VARCHAR(64),
  user_hash             VARCHAR(64),
  session_id            VARCHAR(100),
  channel               VARCHAR(50),
  source                VARCHAR(100),
  medium                VARCHAR(100),
  campaign              VARCHAR(200),
  campaign_id           VARCHAR(100),
  ad_id                 VARCHAR(100),
  gclid                 VARCHAR(200),
  fbclid                VARCHAR(200),
  fbp                   VARCHAR(100),
  fbc                   VARCHAR(100),
  is_brand_search       BOOLEAN DEFAULT false,
  scroll_depth_max      INT DEFAULT 0,
  time_active_seconds   INT DEFAULT 0,
  video_completion_pct  INT DEFAULT 0,
  cta_clicked           BOOLEAN DEFAULT false,
  landing_page          TEXT,
  referrer              TEXT,
  user_agent            TEXT,
  touched_at            TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS user_hash VARCHAR(64);
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS vid VARCHAR(64);
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS session_id VARCHAR(100);
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS channel VARCHAR(50);
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS source VARCHAR(100);
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS medium VARCHAR(100);
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS campaign VARCHAR(200);
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS campaign_id VARCHAR(100);
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS ad_id VARCHAR(100);
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS gclid VARCHAR(200);
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS fbclid VARCHAR(200);
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS fbp VARCHAR(100);
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS fbc VARCHAR(100);
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS is_brand_search BOOLEAN DEFAULT false;
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS scroll_depth_max INT DEFAULT 0;
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS time_active_seconds INT DEFAULT 0;
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS video_completion_pct INT DEFAULT 0;
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS cta_clicked BOOLEAN DEFAULT false;
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS landing_page TEXT;
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS referrer TEXT;
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS user_agent TEXT;

CREATE TABLE IF NOT EXISTS events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      VARCHAR(100) UNIQUE,
  event_name    VARCHAR(100),
  event_time    TIMESTAMPTZ,
  vid           VARCHAR(64),
  user_hash     VARCHAR(64),
  session_id    VARCHAR(100),
  source        VARCHAR(50),
  custom_data   JSONB,
  raw_payload   JSONB,
  meta_sent       BOOLEAN DEFAULT false,
  meta_response   JSONB,
  meta_sent_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS engagement_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vid                   VARCHAR(64),
  session_id            VARCHAR(100),
  page                  TEXT,
  total_time_ms         INT,
  scroll_depth_max      INT DEFAULT 0,
  time_active_seconds   INT DEFAULT 0,
  video_completion_pct  INT DEFAULT 0,
  cta_clicked           BOOLEAN DEFAULT false,
  engagements           JSONB,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchases (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotmart_transaction   VARCHAR(100) UNIQUE,
  product_id            VARCHAR(100),
  product_name          TEXT,
  buyer_email_hash      TEXT,
  buyer_name            TEXT,
  revenue               DECIMAL(10,2),
  currency              VARCHAR(10) DEFAULT 'BRL',
  utm_source            VARCHAR(100),
  utm_medium            VARCHAR(100),
  utm_campaign          VARCHAR(200),
  utm_content           VARCHAR(200),
  utm_term              VARCHAR(200),
  fbclid                TEXT,
  fbp                   TEXT,
  gclid                 TEXT,
  channel               VARCHAR(50),
  is_brand_search       BOOLEAN DEFAULT false,
  meta_capi_sent        BOOLEAN DEFAULT false,
  meta_capi_response    JSONB,
  attribution           JSONB,
  raw_payload           JSONB,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      VARCHAR(100) UNIQUE,
  user_hash     VARCHAR(64),
  vid           VARCHAR(64),
  revenue       DECIMAL(10,2),
  currency      VARCHAR(10) DEFAULT 'BRL',
  attribution   JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_touchpoints_vid        ON touchpoints(vid);
CREATE INDEX IF NOT EXISTS idx_touchpoints_user_hash  ON touchpoints(user_hash);
CREATE INDEX IF NOT EXISTS idx_touchpoints_touched_at ON touchpoints(touched_at);
CREATE INDEX IF NOT EXISTS idx_events_user_hash       ON events(user_hash);
CREATE INDEX IF NOT EXISTS idx_purchases_email        ON purchases(buyer_email_hash);
CREATE INDEX IF NOT EXISTS idx_purchases_campaign     ON purchases(utm_campaign);
CREATE INDEX IF NOT EXISTS idx_purchases_created      ON purchases(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_user_hash       ON orders(user_hash);
