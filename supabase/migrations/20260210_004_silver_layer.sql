-- ============================================================================
-- Silver Layer: Enriched, queryable aggregates
-- Sprint 8.5B: Medallion Data Architecture
-- ============================================================================

-- Silver Price OHLC 1m: 1-minute candles from bronze ticks
CREATE TABLE IF NOT EXISTS silver_price_ohlc_1m (
  symbol       TEXT NOT NULL,
  bucket       TIMESTAMPTZ NOT NULL,  -- truncated to minute
  source       TEXT NOT NULL,
  open_price   NUMERIC(12,6) NOT NULL,
  high_price   NUMERIC(12,6) NOT NULL,
  low_price    NUMERIC(12,6) NOT NULL,
  close_price  NUMERIC(12,6) NOT NULL,
  tick_count   INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (symbol, bucket, source)
);

CREATE INDEX IF NOT EXISTS idx_silver_ohlc_symbol_bucket
  ON silver_price_ohlc_1m (symbol, bucket DESC);


-- Silver Deal Lifecycle: enriched view over deal_history + bronze_deal_events
CREATE OR REPLACE VIEW silver_deal_lifecycle AS
SELECT
  dh.id AS deal_id,
  dh.group_jid,
  dh.client_jid,
  dh.final_state,
  dh.side,
  dh.completion_reason,
  dh.quoted_rate,
  dh.base_rate,
  dh.locked_rate,
  dh.amount_brl,
  dh.amount_usdt,
  dh.quoted_at,
  dh.locked_at,
  dh.completed_at,
  dh.pricing_source,
  dh.spread_mode,
  dh.rule_name,
  dh.sell_spread,
  dh.buy_spread,
  -- Enriched timing fields
  EXTRACT(EPOCH FROM (dh.locked_at - dh.quoted_at)) AS quote_to_lock_seconds,
  EXTRACT(EPOCH FROM (dh.completed_at - dh.locked_at)) AS lock_to_complete_seconds,
  EXTRACT(EPOCH FROM (dh.completed_at - dh.quoted_at)) AS total_deal_seconds,
  -- Slippage: market price at lock vs base rate (true market movement)
  (SELECT de.market_price FROM bronze_deal_events de
   WHERE de.deal_id = dh.id AND de.to_state = 'locked' ORDER BY de.created_at ASC LIMIT 1) AS market_price_at_lock,
  dh.base_rate - COALESCE(
    (SELECT de.market_price FROM bronze_deal_events de
     WHERE de.deal_id = dh.id AND de.to_state = 'locked' ORDER BY de.created_at ASC LIMIT 1),
    dh.base_rate
  ) AS slippage,
  dh.archived_at
FROM deal_history dh;


-- Silver Player Stats: pre-aggregated per-group player metrics
CREATE TABLE IF NOT EXISTS silver_player_stats (
  group_jid     TEXT NOT NULL,
  sender_jid    TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  last_active   TIMESTAMPTZ,
  first_seen    TIMESTAMPTZ,
  refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_jid, sender_jid)
);


-- Drop old overload with since param (full-replace doesn't need it)
DROP FUNCTION IF EXISTS refresh_silver_player_stats(TIMESTAMPTZ);

-- Refresh function: full replace from messages table (avoids double-counting on overlapping runs)
CREATE OR REPLACE FUNCTION refresh_silver_player_stats()
RETURNS void AS $$
BEGIN
  -- Full replace: delete all then re-aggregate from messages
  DELETE FROM silver_player_stats WHERE true;

  INSERT INTO silver_player_stats (group_jid, sender_jid, message_count, trigger_count, last_active, first_seen, refreshed_at)
  SELECT
    group_jid, sender_jid,
    COUNT(*)::INTEGER,
    SUM(CASE WHEN is_trigger THEN 1 ELSE 0 END)::INTEGER,
    MAX(created_at),
    MIN(created_at),
    NOW()
  FROM messages
  WHERE is_from_bot = false
  GROUP BY group_jid, sender_jid;
END;
$$ LANGUAGE plpgsql;


-- Silver Group Activity: heatmap-ready hour × day_of_week aggregates
CREATE TABLE IF NOT EXISTS silver_group_activity (
  group_jid       TEXT NOT NULL,
  hour_of_day     SMALLINT NOT NULL CHECK (hour_of_day BETWEEN 0 AND 23),
  day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  message_count   INTEGER NOT NULL DEFAULT 0,
  trigger_count   INTEGER NOT NULL DEFAULT 0,
  top_trigger     TEXT,
  refreshed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_jid, hour_of_day, day_of_week)
);


-- Refresh function: full replace for target group (or all groups)
CREATE OR REPLACE FUNCTION refresh_silver_group_activity(target_group TEXT DEFAULT NULL, since_days INTEGER DEFAULT 30)
RETURNS void AS $$
BEGIN
  -- Guard against NULL since_days which would wipe the table with no re-insert
  IF since_days IS NULL THEN
    since_days := 30;
  END IF;

  IF target_group IS NOT NULL THEN
    DELETE FROM silver_group_activity WHERE group_jid = target_group;
  ELSE
    DELETE FROM silver_group_activity WHERE true;
  END IF;

  INSERT INTO silver_group_activity (group_jid, hour_of_day, day_of_week, message_count, trigger_count, top_trigger, refreshed_at)
  SELECT
    group_jid,
    EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo')::SMALLINT,
    EXTRACT(DOW FROM created_at AT TIME ZONE 'America/Sao_Paulo')::SMALLINT,
    COUNT(*)::INTEGER,
    SUM(CASE WHEN is_trigger THEN 1 ELSE 0 END)::INTEGER,
    MODE() WITHIN GROUP (ORDER BY CASE WHEN is_trigger THEN content END),
    NOW()
  FROM messages
  WHERE created_at >= NOW() - MAKE_INTERVAL(days => since_days)
    AND (target_group IS NULL OR group_jid = target_group)
  GROUP BY group_jid, EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo'), EXTRACT(DOW FROM created_at AT TIME ZONE 'America/Sao_Paulo');
END;
$$ LANGUAGE plpgsql;


-- Refresh OHLC function: delete-then-insert for affected buckets to avoid partial-window issues
CREATE OR REPLACE FUNCTION refresh_silver_ohlc(since TIMESTAMPTZ DEFAULT NOW() - INTERVAL '5 minutes')
RETURNS void AS $$
BEGIN
  -- Delete candles for buckets that have new ticks (avoids partial-update issues with tick_count and close_price)
  DELETE FROM silver_price_ohlc_1m
  WHERE (symbol, bucket, source) IN (
    SELECT DISTINCT symbol, date_trunc('minute', captured_at), source
    FROM bronze_price_ticks
    WHERE captured_at >= since
  );

  -- Re-insert full candles for affected buckets from ALL ticks in those buckets (not just since window)
  INSERT INTO silver_price_ohlc_1m (symbol, bucket, source, open_price, high_price, low_price, close_price, tick_count)
  SELECT
    symbol,
    date_trunc('minute', captured_at) AS bucket,
    source,
    (ARRAY_AGG(price ORDER BY captured_at ASC))[1] AS open_price,
    MAX(price) AS high_price,
    MIN(price) AS low_price,
    (ARRAY_AGG(price ORDER BY captured_at DESC))[1] AS close_price,
    COUNT(*)::INTEGER AS tick_count
  FROM bronze_price_ticks
  WHERE (symbol, date_trunc('minute', captured_at), source) IN (
    SELECT DISTINCT symbol, date_trunc('minute', captured_at), source
    FROM bronze_price_ticks
    WHERE captured_at >= since
  )
  GROUP BY symbol, date_trunc('minute', captured_at), source;
END;
$$ LANGUAGE plpgsql;
