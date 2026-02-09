-- Migration: Expand Deal States for Sprint 9
-- Adds 'awaiting_amount' and 'rejected' states to deal state machine
-- Adds 'reprompted_at' column for re-prompt tracking
--
-- New state machine:
--   QUOTED → LOCKED → AWAITING_AMOUNT → COMPUTING → COMPLETED
--                                                  → EXPIRED
--                                                  → CANCELLED
--   QUOTED → REJECTED (client sends "off")

-- 1. Update active_deals state CHECK constraint to include new states
ALTER TABLE active_deals DROP CONSTRAINT IF EXISTS active_deals_state_check;
ALTER TABLE active_deals ADD CONSTRAINT active_deals_state_check
  CHECK (state IN ('quoted', 'locked', 'awaiting_amount', 'computing', 'completed', 'expired', 'cancelled', 'rejected'));

-- 2. Add reprompted_at column for re-prompt tracking
ALTER TABLE active_deals
  ADD COLUMN IF NOT EXISTS reprompted_at TIMESTAMPTZ;

-- 3. Update deal_history final_state CHECK to include new terminal state
ALTER TABLE deal_history DROP CONSTRAINT IF EXISTS deal_history_final_state_check;
ALTER TABLE deal_history ADD CONSTRAINT deal_history_final_state_check
  CHECK (final_state IN ('completed', 'expired', 'cancelled', 'rejected'));

-- 4. Add index for sweep of awaiting_amount deals
CREATE INDEX IF NOT EXISTS idx_active_deals_awaiting_amount
  ON active_deals(state, locked_at)
  WHERE state = 'awaiting_amount';

-- 5. Comments
COMMENT ON COLUMN active_deals.reprompted_at IS 'Sprint 9: When the awaiting_amount re-prompt was sent. NULL = not yet prompted. Used to prevent double-prompts.';
COMMENT ON COLUMN active_deals.state IS 'Deal state: quoted, locked, awaiting_amount (waiting for USDT amount), computing, completed, expired, cancelled, rejected (client said "off")';
