-- ============================================================================
-- Gold Layer: Business-ready aggregates
-- Sprint 8.5C: Medallion Data Architecture
-- ============================================================================

-- Gold Daily Trade Volume
CREATE TABLE IF NOT EXISTS gold_daily_trade_volume (
  trade_date   DATE NOT NULL,
  group_jid    TEXT NOT NULL,
  deal_count   INTEGER NOT NULL DEFAULT 0,
  total_usdt   NUMERIC(16,2) DEFAULT 0,
  total_brl    NUMERIC(16,2) DEFAULT 0,
  avg_rate     NUMERIC(12,6),
  completed    INTEGER DEFAULT 0,
  expired      INTEGER DEFAULT 0,
  cancelled    INTEGER DEFAULT 0,
  rejected     INTEGER DEFAULT 0,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trade_date, group_jid)
);


-- Gold Spread Effectiveness
CREATE TABLE IF NOT EXISTS gold_spread_effectiveness (
  trade_date         DATE NOT NULL,
  group_jid          TEXT NOT NULL,
  avg_quoted_spread  NUMERIC(12,6),   -- avg difference between quoted_rate and base_rate
  avg_slippage       NUMERIC(12,6),   -- avg market movement during deal
  spread_capture_pct NUMERIC(6,2),    -- % of spread actually captured
  deal_count         INTEGER DEFAULT 0,
  refreshed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trade_date, group_jid)
);


-- Gold Operator Response Times
CREATE TABLE IF NOT EXISTS gold_operator_response_times (
  trade_date              DATE NOT NULL,
  group_jid               TEXT NOT NULL,
  avg_quote_to_lock_s     NUMERIC(10,2),
  avg_lock_to_complete_s  NUMERIC(10,2),
  avg_total_deal_s        NUMERIC(10,2),
  p50_total_deal_s        NUMERIC(10,2),
  p95_total_deal_s        NUMERIC(10,2),
  deal_count              INTEGER DEFAULT 0,
  refreshed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trade_date, group_jid)
);


-- Gold Group Summary: replaces expensive /api/groups aggregation
CREATE TABLE IF NOT EXISTS gold_group_summary (
  group_jid       TEXT PRIMARY KEY,
  group_name      TEXT,
  total_messages  INTEGER DEFAULT 0,
  total_triggers  INTEGER DEFAULT 0,
  unique_players  INTEGER DEFAULT 0,
  last_activity   TIMESTAMPTZ,
  active_deals    INTEGER DEFAULT 0,
  completed_deals INTEGER DEFAULT 0,
  refreshed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- Gold Cost Daily: replaces full ai_usage scans
CREATE TABLE IF NOT EXISTS gold_cost_daily (
  cost_date    DATE NOT NULL,
  group_jid    TEXT NOT NULL DEFAULT '__system__',
  model        TEXT NOT NULL,
  call_count   INTEGER DEFAULT 0,
  total_cost   NUMERIC(10,4) DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cost_date, group_jid, model)
);


-- Master refresh function for the entire Gold layer
CREATE OR REPLACE FUNCTION refresh_gold_layer()
RETURNS void AS $$
BEGIN
  -- ========================================
  -- Gold Daily Trade Volume (from deal_history)
  -- ========================================
  DELETE FROM gold_daily_trade_volume WHERE trade_date >= CURRENT_DATE - 7;

  INSERT INTO gold_daily_trade_volume (
    trade_date, group_jid, deal_count, total_usdt, total_brl, avg_rate,
    completed, expired, cancelled, rejected, refreshed_at
  )
  SELECT
    DATE(archived_at) AS trade_date,
    group_jid,
    COUNT(*) AS deal_count,
    COALESCE(SUM(amount_usdt), 0) AS total_usdt,
    COALESCE(SUM(amount_brl), 0) AS total_brl,
    AVG(COALESCE(locked_rate, quoted_rate)) AS avg_rate,
    SUM(CASE WHEN final_state = 'completed' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN final_state = 'expired' THEN 1 ELSE 0 END) AS expired,
    SUM(CASE WHEN final_state = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
    SUM(CASE WHEN final_state = 'rejected' THEN 1 ELSE 0 END) AS rejected,
    NOW()
  FROM deal_history
  WHERE archived_at >= CURRENT_DATE - 7
  GROUP BY DATE(archived_at), group_jid;

  -- ========================================
  -- Gold Spread Effectiveness (from silver_deal_lifecycle)
  -- ========================================
  DELETE FROM gold_spread_effectiveness WHERE trade_date >= CURRENT_DATE - 7;

  INSERT INTO gold_spread_effectiveness (
    trade_date, group_jid, avg_quoted_spread, avg_slippage,
    spread_capture_pct, deal_count, refreshed_at
  )
  SELECT
    DATE(archived_at) AS trade_date,
    group_jid,
    AVG(quoted_rate - base_rate) AS avg_quoted_spread,
    AVG(slippage) AS avg_slippage,
    CASE
      WHEN AVG(ABS(quoted_rate - base_rate)) > 0
      THEN ROUND(
        (AVG(ABS(quoted_rate - base_rate)) - COALESCE(AVG(ABS(slippage)), 0))
        / AVG(ABS(quoted_rate - base_rate)) * 100, 2
      )
      ELSE NULL
    END AS spread_capture_pct,
    COUNT(*) AS deal_count,
    NOW()
  FROM silver_deal_lifecycle
  WHERE archived_at >= CURRENT_DATE - 7
    AND final_state = 'completed'
  GROUP BY DATE(archived_at), group_jid;

  -- ========================================
  -- Gold Operator Response Times (from silver_deal_lifecycle)
  -- ========================================
  DELETE FROM gold_operator_response_times WHERE trade_date >= CURRENT_DATE - 7;

  INSERT INTO gold_operator_response_times (
    trade_date, group_jid,
    avg_quote_to_lock_s, avg_lock_to_complete_s, avg_total_deal_s,
    p50_total_deal_s, p95_total_deal_s, deal_count, refreshed_at
  )
  SELECT
    DATE(archived_at) AS trade_date,
    group_jid,
    AVG(quote_to_lock_seconds)::NUMERIC(10,2),
    AVG(lock_to_complete_seconds)::NUMERIC(10,2),
    AVG(total_deal_seconds)::NUMERIC(10,2),
    (PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_deal_seconds))::NUMERIC(10,2),
    (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_deal_seconds))::NUMERIC(10,2),
    COUNT(*),
    NOW()
  FROM silver_deal_lifecycle
  WHERE archived_at >= CURRENT_DATE - 7
    AND final_state = 'completed'
    AND total_deal_seconds IS NOT NULL
  GROUP BY DATE(archived_at), group_jid;

  -- ========================================
  -- Gold Group Summary
  -- ========================================
  DELETE FROM gold_group_summary WHERE true;

  INSERT INTO gold_group_summary (
    group_jid, group_name, total_messages, total_triggers,
    unique_players, last_activity, active_deals, completed_deals, refreshed_at
  )
  SELECT
    g.jid AS group_jid,
    g.name AS group_name,
    COALESCE(g.message_count, 0) AS total_messages,
    COALESCE(
      (SELECT SUM(trigger_count) FROM silver_player_stats sp WHERE sp.group_jid = g.jid),
      0
    )::INTEGER AS total_triggers,
    COALESCE(
      (SELECT COUNT(*) FROM silver_player_stats sp WHERE sp.group_jid = g.jid),
      0
    )::INTEGER AS unique_players,
    g.last_activity_at AS last_activity,
    COALESCE(
      (SELECT COUNT(*) FROM active_deals ad
       WHERE ad.group_jid = g.jid
         AND ad.state NOT IN ('completed', 'expired', 'cancelled', 'rejected')),
      0
    )::INTEGER AS active_deals,
    COALESCE(
      (SELECT COUNT(*) FROM deal_history dh WHERE dh.group_jid = g.jid AND dh.final_state = 'completed'),
      0
    )::INTEGER AS completed_deals,
    NOW()
  FROM groups g;

  -- ========================================
  -- Gold Cost Daily (from ai_usage)
  -- ========================================
  DELETE FROM gold_cost_daily WHERE cost_date >= CURRENT_DATE - 7;

  INSERT INTO gold_cost_daily (
    cost_date, group_jid, model, call_count, total_cost, total_tokens, refreshed_at
  )
  SELECT
    DATE(created_at) AS cost_date,
    COALESCE(group_jid, '__system__') AS group_jid,
    model,
    COUNT(*) AS call_count,
    COALESCE(SUM(cost_usd), 0) AS total_cost,
    COALESCE(SUM(total_tokens), 0) AS total_tokens,
    NOW()
  FROM ai_usage
  WHERE created_at >= CURRENT_DATE - 7
  GROUP BY DATE(created_at), COALESCE(group_jid, '__system__'), model;

END;
$$ LANGUAGE plpgsql;
