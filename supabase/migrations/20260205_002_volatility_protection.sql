-- Volatility Protection Feature
-- Created: 2026-02-05
-- Enables per-group volatility threshold configuration and escalation tracking

-- Function for auto-updating updated_at (if not exists)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Group volatility configuration
-- NOTE: No FK to groups table - config can be created before group has any messages
-- This allows dashboard to pre-configure volatility for any group JID
-- threshold_bps minimum is 10 (0.10%) to prevent excessive repricing on every tick
CREATE TABLE IF NOT EXISTS group_volatility_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid TEXT NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT true,
  threshold_bps INTEGER NOT NULL DEFAULT 30 CHECK (threshold_bps >= 10 AND threshold_bps <= 1000),
  max_reprices INTEGER NOT NULL DEFAULT 3 CHECK (max_reprices >= 1 AND max_reprices <= 10),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_volatility_config_group_jid ON group_volatility_config(group_jid);
CREATE INDEX IF NOT EXISTS idx_volatility_config_enabled ON group_volatility_config(enabled) WHERE enabled = true;

-- Updated_at trigger
DROP TRIGGER IF EXISTS update_volatility_config_timestamp ON group_volatility_config;
CREATE TRIGGER update_volatility_config_timestamp
  BEFORE UPDATE ON group_volatility_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Escalation state tracking (for dashboard banner persistence)
-- Persists escalation events so dashboard can show alert banner even after page refresh
CREATE TABLE IF NOT EXISTS volatility_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid TEXT NOT NULL,
  escalated_at TIMESTAMPTZ DEFAULT now(),
  dismissed_at TIMESTAMPTZ,
  quote_price DECIMAL(10,4),
  market_price DECIMAL(10,4),
  reprice_count INTEGER
);

-- Index for finding active (undismissed) escalations
CREATE INDEX IF NOT EXISTS idx_escalations_active ON volatility_escalations(group_jid)
  WHERE dismissed_at IS NULL;
