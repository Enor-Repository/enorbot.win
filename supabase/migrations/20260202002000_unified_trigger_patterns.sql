-- Migration: Unified Trigger Patterns System
-- Adds scope and is_system columns to rules table
-- Inserts system patterns for hardcoded triggers ('preço', 'cotação')

-- 1. Add scope column for global vs per-group patterns
ALTER TABLE rules
ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'group' NOT NULL;

-- Add check constraint for valid scopes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rules_scope_check'
  ) THEN
    ALTER TABLE rules
    ADD CONSTRAINT rules_scope_check
    CHECK (scope IN ('group', 'global', 'control_only'));
  END IF;
END $$;

-- 2. Add is_system flag for hardcoded patterns (cannot be deleted via dashboard)
ALTER TABLE rules
ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT false NOT NULL;

-- 3. Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_rules_scope ON rules(scope);
CREATE INDEX IF NOT EXISTS idx_rules_system ON rules(is_system) WHERE is_system = true;
CREATE INDEX IF NOT EXISTS idx_rules_global ON rules(group_jid) WHERE group_jid = '*';

-- 4. Create unique index for conflict detection (group_jid + trigger_phrase)
-- This prevents duplicate rules with the same trigger for the same group
CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_unique_trigger
ON rules(group_jid, lower(trigger_phrase));

-- 5. Insert system patterns (hardcoded triggers become database records)
-- These are the patterns from src/utils/triggers.ts: PRICE_TRIGGER_KEYWORDS = ['preço', 'cotação']
-- group_jid = '*' means global (applies to all groups)
-- priority = 1000 gives them high precedence
INSERT INTO rules (
  group_jid,
  trigger_phrase,
  response_template,
  action_type,
  is_active,
  priority,
  scope,
  is_system,
  metadata
)
VALUES
  (
    '*',
    'preço',
    '',
    'usdt_quote',
    true,
    1000,
    'global',
    true,
    '{"description": "System pattern: Price query trigger (Portuguese)", "source": "triggers.ts"}'::jsonb
  ),
  (
    '*',
    'cotação',
    '',
    'usdt_quote',
    true,
    1000,
    'global',
    true,
    '{"description": "System pattern: Quote query trigger (Portuguese)", "source": "triggers.ts"}'::jsonb
  )
ON CONFLICT (group_jid, lower(trigger_phrase)) DO NOTHING;

-- Add comments for documentation
COMMENT ON COLUMN rules.scope IS 'Pattern scope: group (per-group), global (all groups), control_only (control group only)';
COMMENT ON COLUMN rules.is_system IS 'System patterns cannot be deleted, only disabled. Migrated from hardcoded triggers.';
