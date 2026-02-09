-- Migration: Deal Flow Mode Configuration
-- Sprint 9, Task 9.2
--
-- Adds per-group configuration for Daniel's simplified trade flow:
-- - deal_flow_mode: 'classic' (existing 3-step) or 'simple' (Daniel's 2-step)
-- - operator_jid: WhatsApp JID to @mention on deal completion/rejection
-- - amount_timeout_seconds: How long to wait for USDT amount after lock (default 60s)
-- - group_language: 'pt' or 'en' for bilingual prompts

ALTER TABLE group_spreads
  ADD COLUMN IF NOT EXISTS deal_flow_mode TEXT NOT NULL DEFAULT 'classic',
  ADD COLUMN IF NOT EXISTS operator_jid TEXT,
  ADD COLUMN IF NOT EXISTS amount_timeout_seconds INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS group_language TEXT NOT NULL DEFAULT 'pt';

-- Add constraints (separate statements for IF NOT EXISTS compatibility)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'group_spreads_deal_flow_mode_check'
  ) THEN
    ALTER TABLE group_spreads
      ADD CONSTRAINT group_spreads_deal_flow_mode_check
        CHECK (deal_flow_mode IN ('classic', 'simple'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'group_spreads_amount_timeout_check'
  ) THEN
    ALTER TABLE group_spreads
      ADD CONSTRAINT group_spreads_amount_timeout_check
        CHECK (amount_timeout_seconds BETWEEN 30 AND 300);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'group_spreads_group_language_check'
  ) THEN
    ALTER TABLE group_spreads
      ADD CONSTRAINT group_spreads_group_language_check
        CHECK (group_language IN ('pt', 'en'));
  END IF;
END $$;

-- Add comments
COMMENT ON COLUMN group_spreads.deal_flow_mode IS 'Deal flow mode: classic (quote→lock→confirm) or simple (Daniel''s 2-step: quote→lock+amount→done)';
COMMENT ON COLUMN group_spreads.operator_jid IS 'WhatsApp JID of the operator to @mention on deal completion/rejection (e.g., 5511999999999@s.whatsapp.net)';
COMMENT ON COLUMN group_spreads.amount_timeout_seconds IS 'How long to wait for USDT amount after lock in simple mode (30-300s, default 60s)';
COMMENT ON COLUMN group_spreads.group_language IS 'Language for bilingual prompts: pt (Portuguese) or en (English)';
