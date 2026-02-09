-- Migration: Group Rules (Time-Based Pricing)
-- Sprint 2: Enables Daniel (CIO) to create time-based pricing rules per group.
-- Rules define WHEN and HOW pricing behaves (pricing source, spreads).
-- Triggers (Sprint 3) will respect the active rule's configuration.

-- 1. Create group_rules table
CREATE TABLE IF NOT EXISTS group_rules (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Group association
  group_jid TEXT NOT NULL,

  -- Rule identity
  name TEXT NOT NULL,                     -- e.g., "Business Hours", "After Hours", "Weekend Premium"
  description TEXT,                       -- Optional notes for Daniel

  -- Schedule configuration
  -- Time range within each active day (in the specified timezone)
  schedule_start_time TIME NOT NULL,      -- e.g., 09:00
  schedule_end_time TIME NOT NULL,        -- e.g., 18:00
  -- Active days: array of lowercase day abbreviations
  -- Valid values: 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'
  schedule_days TEXT[] NOT NULL,
  -- Timezone for interpreting start/end times
  schedule_timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',

  -- Priority: higher value wins when multiple rules match the same time
  priority INTEGER NOT NULL DEFAULT 0,

  -- Pricing configuration (used by rule-aware actions like price_quote)
  -- pricing_source: where to fetch the exchange rate
  pricing_source TEXT NOT NULL DEFAULT 'usdt_binance',
  -- spread_mode: how spread is calculated
  spread_mode TEXT NOT NULL DEFAULT 'bps',
  -- Spread values (same semantics as group_spreads table)
  sell_spread NUMERIC NOT NULL DEFAULT 0,  -- When client BUYS USDT (eNor sells)
  buy_spread NUMERIC NOT NULL DEFAULT 0,   -- When client SELLS USDT (eNor buys)

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  UNIQUE(group_jid, name),

  CONSTRAINT group_rules_pricing_source_check
    CHECK (pricing_source IN ('commercial_dollar', 'usdt_binance')),
  CONSTRAINT group_rules_spread_mode_check
    CHECK (spread_mode IN ('bps', 'abs_brl', 'flat')),
  CONSTRAINT group_rules_priority_check
    CHECK (priority >= 0 AND priority <= 100)
);

-- 2. Indexes for fast lookups
-- Primary lookup: active rules for a group, ordered by priority
CREATE INDEX IF NOT EXISTS idx_group_rules_active
  ON group_rules(group_jid, is_active, priority DESC);

-- Lookup by group for listing all rules
CREATE INDEX IF NOT EXISTS idx_group_rules_group
  ON group_rules(group_jid);

-- 3. Create trigger for updated_at auto-maintenance
CREATE OR REPLACE FUNCTION update_group_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_group_rules_updated_at ON group_rules;
CREATE TRIGGER trigger_group_rules_updated_at
  BEFORE UPDATE ON group_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_group_rules_updated_at();

-- 4. Add comments for documentation
COMMENT ON TABLE group_rules IS 'Time-based pricing rules per group. The active rule with highest priority determines pricing behavior.';
COMMENT ON COLUMN group_rules.name IS 'Human-readable rule name, unique within a group (e.g., Business Hours)';
COMMENT ON COLUMN group_rules.description IS 'Optional description for Daniel to understand rule purpose';
COMMENT ON COLUMN group_rules.schedule_start_time IS 'Start time of the rule window in schedule_timezone (e.g., 09:00)';
COMMENT ON COLUMN group_rules.schedule_end_time IS 'End time of the rule window in schedule_timezone (e.g., 18:00). Can be < start_time for overnight rules.';
COMMENT ON COLUMN group_rules.schedule_days IS 'Array of active days: mon, tue, wed, thu, fri, sat, sun';
COMMENT ON COLUMN group_rules.schedule_timezone IS 'IANA timezone for interpreting schedule times (default: America/Sao_Paulo)';
COMMENT ON COLUMN group_rules.priority IS 'Higher priority wins when multiple rules overlap (0-100)';
COMMENT ON COLUMN group_rules.pricing_source IS 'Rate source: commercial_dollar (BCB) or usdt_binance (Binance spot)';
COMMENT ON COLUMN group_rules.spread_mode IS 'Spread calculation: bps (basis points), abs_brl (fixed BRL amount), flat (no spread)';
COMMENT ON COLUMN group_rules.sell_spread IS 'Spread when client buys USDT. Positive = eNor margin added to rate.';
COMMENT ON COLUMN group_rules.buy_spread IS 'Spread when client sells USDT. Negative = eNor discount subtracted from rate.';
COMMENT ON COLUMN group_rules.is_active IS 'Disabled rules are ignored during rule matching';
