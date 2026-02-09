-- ============================================================================
-- Bronze Layer: Raw event capture
-- Sprint 8.5A: Medallion Data Architecture
-- ============================================================================

-- Bronze Price Ticks: raw price snapshots from all sources
-- Sampling strategy: 5s throttle for Binance WS, every tick for REST/scraper
CREATE TABLE IF NOT EXISTS bronze_price_ticks (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT NOT NULL CHECK (source IN ('binance_ws', 'binance_rest', 'tradingview', 'awesomeapi')),
  symbol      TEXT NOT NULL,        -- 'USDT/BRL' or 'USD/BRL'
  price       NUMERIC(12,6) NOT NULL,
  bid         NUMERIC(12,6),        -- for awesomeapi
  ask         NUMERIC(12,6),        -- for awesomeapi
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bronze_ticks_symbol_time
  ON bronze_price_ticks (symbol, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_bronze_ticks_source_time
  ON bronze_price_ticks (source, captured_at DESC);

-- Standalone index on captured_at for retention cleanup queries
CREATE INDEX IF NOT EXISTS idx_bronze_ticks_captured_at
  ON bronze_price_ticks (captured_at);

-- Partition hint: if volume exceeds 10M rows, consider range partitioning on captured_at


-- Bronze Deal Events: immutable event log for every deal state transition
CREATE TABLE IF NOT EXISTS bronze_deal_events (
  id            BIGSERIAL PRIMARY KEY,
  deal_id       UUID NOT NULL,
  group_jid     TEXT NOT NULL,
  client_jid    TEXT NOT NULL,
  from_state    TEXT,                -- null for 'created'
  to_state      TEXT NOT NULL,
  event_type    TEXT NOT NULL,       -- 'created', 'locked', 'awaiting_amount', 'computing', 'completed', 'expired', 'cancelled', 'rejected', 'archived'
  market_price  NUMERIC(12,6),      -- snapshot of current market price at event time
  deal_snapshot JSONB,              -- full deal record at transition time
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bronze_events_deal
  ON bronze_deal_events (deal_id, created_at);

CREATE INDEX IF NOT EXISTS idx_bronze_events_group
  ON bronze_deal_events (group_jid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bronze_events_type
  ON bronze_deal_events (event_type, created_at DESC);


-- Retention cleanup function for Bronze layer
-- bronze_price_ticks: keep 90 days, batched to avoid long locks
-- bronze_deal_events: keep indefinitely (low volume, high value)
CREATE OR REPLACE FUNCTION bronze_retention_cleanup()
RETURNS INTEGER AS $$
DECLARE
  total_deleted INTEGER := 0;
  batch_deleted INTEGER;
BEGIN
  LOOP
    DELETE FROM bronze_price_ticks
    WHERE id IN (
      SELECT id FROM bronze_price_ticks
      WHERE captured_at < NOW() - INTERVAL '90 days'
      LIMIT 10000
    );
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    total_deleted := total_deleted + batch_deleted;
    EXIT WHEN batch_deleted = 0;
    -- Yield to other transactions between batches
    PERFORM pg_sleep(0.1);
  END LOOP;
  RETURN total_deleted;
END;
$$ LANGUAGE plpgsql;
