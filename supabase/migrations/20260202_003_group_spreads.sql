-- Migration: Group Spreads Configuration
-- Enables per-group pricing control for Daniel (CIO)
-- Each group can have its own spread, TTL, and display preferences

-- 1. Create group_spreads table
CREATE TABLE IF NOT EXISTS group_spreads (
  -- Primary key is the group JID (one config per group)
  group_jid TEXT PRIMARY KEY,

  -- Spread configuration
  -- spread_mode: 'bps' (basis points), 'abs_brl' (absolute BRL), 'flat' (no spread)
  spread_mode TEXT NOT NULL DEFAULT 'bps',

  -- Spread values (positive = add to rate, negative = subtract)
  -- sell_spread: when client BUYS USDT (eNor sells) - typically positive
  -- buy_spread: when client SELLS USDT (eNor buys) - typically negative
  sell_spread NUMERIC NOT NULL DEFAULT 0,
  buy_spread NUMERIC NOT NULL DEFAULT 0,

  -- Quote behavior
  quote_ttl_seconds INTEGER NOT NULL DEFAULT 180,

  -- Defaults for ambiguous messages
  -- default_side: 'client_buys_usdt' or 'client_sells_usdt'
  default_side TEXT NOT NULL DEFAULT 'client_buys_usdt',
  -- default_currency: 'BRL' or 'USDT' (when amount has no currency indicator)
  default_currency TEXT NOT NULL DEFAULT 'BRL',

  -- Display preferences
  -- language: 'pt-BR' or 'en'
  language TEXT NOT NULL DEFAULT 'pt-BR',

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT group_spreads_mode_check
    CHECK (spread_mode IN ('bps', 'abs_brl', 'flat')),
  CONSTRAINT group_spreads_side_check
    CHECK (default_side IN ('client_buys_usdt', 'client_sells_usdt')),
  CONSTRAINT group_spreads_currency_check
    CHECK (default_currency IN ('BRL', 'USDT')),
  CONSTRAINT group_spreads_language_check
    CHECK (language IN ('pt-BR', 'en')),
  CONSTRAINT group_spreads_ttl_check
    CHECK (quote_ttl_seconds > 0 AND quote_ttl_seconds <= 3600)
);

-- 2. Create index for fast lookup by group
CREATE INDEX IF NOT EXISTS idx_group_spreads_jid ON group_spreads(group_jid);

-- 3. Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_group_spreads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_group_spreads_updated_at ON group_spreads;
CREATE TRIGGER trigger_group_spreads_updated_at
  BEFORE UPDATE ON group_spreads
  FOR EACH ROW
  EXECUTE FUNCTION update_group_spreads_updated_at();

-- 4. Add comments for documentation
COMMENT ON TABLE group_spreads IS 'Per-group pricing configuration controlled by CIO (Daniel)';
COMMENT ON COLUMN group_spreads.spread_mode IS 'Spread calculation mode: bps (basis points), abs_brl (absolute BRL), flat (no spread)';
COMMENT ON COLUMN group_spreads.sell_spread IS 'Spread when client buys USDT (eNor sells). Positive adds to Binance rate.';
COMMENT ON COLUMN group_spreads.buy_spread IS 'Spread when client sells USDT (eNor buys). Negative subtracts from Binance rate.';
COMMENT ON COLUMN group_spreads.quote_ttl_seconds IS 'How long a quoted rate remains valid for locking (default 180s = 3 min)';
COMMENT ON COLUMN group_spreads.default_side IS 'Assumed trade direction when message is ambiguous';
COMMENT ON COLUMN group_spreads.default_currency IS 'Assumed currency when amount has no BRL/USDT indicator';
COMMENT ON COLUMN group_spreads.language IS 'Response language: pt-BR or en';

-- 5. Grant permissions (adjust role as needed)
-- GRANT SELECT, INSERT, UPDATE ON group_spreads TO authenticated;
