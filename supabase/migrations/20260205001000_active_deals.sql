-- Migration: Active Deals & Deal History
-- Sprint 4: Deal Flow Engine
--
-- Implements stateful deal tracking: quote → lock → compute → confirm
-- Each deal captures a snapshot of the pricing rule at creation time,
-- ensuring rates don't change mid-deal even when time-based rules switch.
--
-- States: QUOTED → LOCKED → COMPUTING → COMPLETED | EXPIRED | CANCELLED

-- ============================================================================
-- Pre-flight: Verify dependencies exist
-- ============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'group_triggers') THEN
    RAISE WARNING 'group_triggers table not found. Sprint 3 migration may not have run.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'group_rules') THEN
    RAISE WARNING 'group_rules table not found. Sprint 2 migration may not have run.';
  END IF;
END $$;

-- ============================================================================
-- 1. Create active_deals table
-- ============================================================================
CREATE TABLE IF NOT EXISTS active_deals (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Group and client association
  group_jid TEXT NOT NULL,
  client_jid TEXT NOT NULL,

  -- State machine
  state TEXT NOT NULL DEFAULT 'quoted',

  -- Trade direction
  side TEXT NOT NULL DEFAULT 'client_buys_usdt',

  -- Quote stage
  quoted_rate NUMERIC NOT NULL,                   -- Rate shown to client (after spread)
  base_rate NUMERIC NOT NULL,                     -- Raw rate from source (before spread)
  quoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Lock stage
  locked_rate NUMERIC,                            -- Rate locked for the deal
  locked_at TIMESTAMPTZ,

  -- Amount fields (set during quote or lock)
  amount_brl NUMERIC,                             -- BRL amount (e.g., 4479100)
  amount_usdt NUMERIC,                            -- USDT amount (e.g., 853161.90)

  -- TTL expiration
  ttl_expires_at TIMESTAMPTZ NOT NULL,            -- When the quote/lock expires

  -- Rule snapshot (locked at deal creation — don't switch rules mid-deal)
  rule_id_used UUID,                              -- FK to group_rules (nullable: may use default spread)
  rule_name TEXT,                                  -- Snapshot of rule name at deal time
  pricing_source TEXT NOT NULL DEFAULT 'usdt_binance',  -- Snapshot: 'commercial_dollar' | 'usdt_binance'
  spread_mode TEXT NOT NULL DEFAULT 'bps',         -- Snapshot: 'bps' | 'abs_brl' | 'flat'
  sell_spread NUMERIC NOT NULL DEFAULT 0,          -- Snapshot of spread at deal time
  buy_spread NUMERIC NOT NULL DEFAULT 0,           -- Snapshot of spread at deal time

  -- Metadata (extensible)
  metadata JSONB NOT NULL DEFAULT '{}',

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT active_deals_state_check
    CHECK (state IN ('quoted', 'locked', 'computing', 'completed', 'expired', 'cancelled')),
  CONSTRAINT active_deals_side_check
    CHECK (side IN ('client_buys_usdt', 'client_sells_usdt')),
  CONSTRAINT active_deals_pricing_source_check
    CHECK (pricing_source IN ('commercial_dollar', 'usdt_binance')),
  CONSTRAINT active_deals_spread_mode_check
    CHECK (spread_mode IN ('bps', 'abs_brl', 'flat')),
  CONSTRAINT active_deals_quoted_rate_positive
    CHECK (quoted_rate > 0),
  CONSTRAINT active_deals_base_rate_positive
    CHECK (base_rate > 0),
  CONSTRAINT active_deals_locked_rate_positive
    CHECK (locked_rate IS NULL OR locked_rate > 0),
  CONSTRAINT active_deals_amount_brl_positive
    CHECK (amount_brl IS NULL OR amount_brl > 0),
  CONSTRAINT active_deals_amount_usdt_positive
    CHECK (amount_usdt IS NULL OR amount_usdt > 0)
);

-- ============================================================================
-- 2. Create deal_history table (completed/expired/cancelled deals)
-- ============================================================================
-- Mirrors active_deals structure plus completion metadata.
-- Deals move here when they reach a terminal state.
CREATE TABLE IF NOT EXISTS deal_history (
  -- Primary key (same ID as the original active_deal)
  id UUID PRIMARY KEY,

  -- Group and client association
  group_jid TEXT NOT NULL,
  client_jid TEXT NOT NULL,

  -- Final state
  final_state TEXT NOT NULL,
  side TEXT NOT NULL,

  -- Rate information
  quoted_rate NUMERIC NOT NULL,
  base_rate NUMERIC NOT NULL,
  locked_rate NUMERIC,

  -- Amounts
  amount_brl NUMERIC,
  amount_usdt NUMERIC,

  -- Timestamps from the deal lifecycle
  quoted_at TIMESTAMPTZ NOT NULL,
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,                       -- When deal reached terminal state
  ttl_expires_at TIMESTAMPTZ NOT NULL,

  -- Rule snapshot
  rule_id_used UUID,
  rule_name TEXT,
  pricing_source TEXT NOT NULL,
  spread_mode TEXT NOT NULL,
  sell_spread NUMERIC NOT NULL,
  buy_spread NUMERIC NOT NULL,

  -- Metadata
  metadata JSONB NOT NULL DEFAULT '{}',

  -- Completion details
  completion_reason TEXT,                          -- 'confirmed', 'expired', 'cancelled_by_client', 'cancelled_by_operator'

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL,                -- Original creation time
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- When moved to history

  -- Constraints
  CONSTRAINT deal_history_final_state_check
    CHECK (final_state IN ('completed', 'expired', 'cancelled')),
  CONSTRAINT deal_history_side_check
    CHECK (side IN ('client_buys_usdt', 'client_sells_usdt'))
);

-- ============================================================================
-- 3. Indexes for fast lookups
-- ============================================================================

-- Active deals: Find open deals for a group (most common query)
CREATE INDEX IF NOT EXISTS idx_active_deals_group_state
  ON active_deals(group_jid, state)
  WHERE state NOT IN ('completed', 'expired', 'cancelled');

-- Active deals: Find open deals for a specific client in a group
CREATE INDEX IF NOT EXISTS idx_active_deals_client
  ON active_deals(group_jid, client_jid, state)
  WHERE state NOT IN ('completed', 'expired', 'cancelled');

-- Active deals: Find expired deals for TTL sweeper
CREATE INDEX IF NOT EXISTS idx_active_deals_ttl
  ON active_deals(ttl_expires_at)
  WHERE state IN ('quoted', 'locked');

-- Active deals: Recent deals for dashboard
CREATE INDEX IF NOT EXISTS idx_active_deals_created
  ON active_deals(group_jid, created_at DESC);

-- Deal history: Group history for audit/dashboard
CREATE INDEX IF NOT EXISTS idx_deal_history_group
  ON deal_history(group_jid, archived_at DESC);

-- Deal history: Client deal history
CREATE INDEX IF NOT EXISTS idx_deal_history_client
  ON deal_history(group_jid, client_jid, archived_at DESC);

-- ============================================================================
-- 4. Updated_at trigger for active_deals
-- ============================================================================
CREATE OR REPLACE FUNCTION update_active_deals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_active_deals_updated_at ON active_deals;
CREATE TRIGGER trigger_active_deals_updated_at
  BEFORE UPDATE ON active_deals
  FOR EACH ROW
  EXECUTE FUNCTION update_active_deals_updated_at();

-- ============================================================================
-- 5. Comments
-- ============================================================================
COMMENT ON TABLE active_deals IS 'Sprint 4: Active deal state machine. Tracks deals from quote through lock, compute, to completion. Rule snapshot frozen at deal creation.';
COMMENT ON TABLE deal_history IS 'Sprint 4: Completed/expired/cancelled deals archived from active_deals for audit trail.';
COMMENT ON COLUMN active_deals.state IS 'Deal state: quoted (price shown), locked (client confirmed rate), computing (calculating amounts), completed/expired/cancelled (terminal)';
COMMENT ON COLUMN active_deals.quoted_rate IS 'Rate shown to client after applying spread from the active rule at deal creation time';
COMMENT ON COLUMN active_deals.base_rate IS 'Raw market rate before spread application (from Binance or commercial dollar)';
COMMENT ON COLUMN active_deals.locked_rate IS 'Rate locked when client confirms — may equal quoted_rate or be re-quoted';
COMMENT ON COLUMN active_deals.rule_id_used IS 'Snapshot of the active group_rule at deal creation. NULL if using default group_spreads config.';
COMMENT ON COLUMN active_deals.ttl_expires_at IS 'When this deal expires if not advanced to next state. Based on quote_ttl_seconds from group_spreads.';
COMMENT ON COLUMN active_deals.side IS 'Trade direction: client_buys_usdt (eNor sells USDT) or client_sells_usdt (eNor buys USDT)';
COMMENT ON COLUMN deal_history.completion_reason IS 'Why deal reached terminal state: confirmed, expired, cancelled_by_client, cancelled_by_operator';
