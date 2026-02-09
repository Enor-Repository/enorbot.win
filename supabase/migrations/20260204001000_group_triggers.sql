-- Migration: Group Triggers (Per-Group Trigger Patterns)
-- Sprint 3: Enables Daniel (CIO) to configure trigger phrases per group.
-- Triggers define WHAT phrases activate responses.
-- They automatically respect the active rule's pricing configuration (from Sprint 2).

-- 1. Create group_triggers table
CREATE TABLE IF NOT EXISTS group_triggers (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Group association
  group_jid TEXT NOT NULL,

  -- Trigger configuration
  trigger_phrase TEXT NOT NULL,                -- e.g., "preço", "cotação", "compro *"
  pattern_type TEXT NOT NULL DEFAULT 'contains',  -- How to match the phrase

  -- Action configuration
  action_type TEXT NOT NULL,                   -- What to do when matched
  action_params JSONB NOT NULL DEFAULT '{}',   -- Action-specific parameters

  -- Metadata
  priority INTEGER NOT NULL DEFAULT 0,         -- Higher priority triggers match first
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  UNIQUE(group_jid, trigger_phrase),

  CONSTRAINT group_triggers_pattern_type_check
    CHECK (pattern_type IN ('exact', 'contains', 'regex')),
  CONSTRAINT group_triggers_action_type_check
    CHECK (action_type IN ('price_quote', 'volume_quote', 'text_response', 'ai_prompt')),
  CONSTRAINT group_triggers_priority_check
    CHECK (priority >= 0 AND priority <= 100)
);

-- 2. Indexes for fast lookups
-- Primary lookup: active triggers for a group, ordered by priority
CREATE INDEX IF NOT EXISTS idx_group_triggers_active
  ON group_triggers(group_jid, is_active, priority DESC);

-- Lookup by group for listing all triggers
CREATE INDEX IF NOT EXISTS idx_group_triggers_group
  ON group_triggers(group_jid);

-- 3. Create trigger for updated_at auto-maintenance
CREATE OR REPLACE FUNCTION update_group_triggers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_group_triggers_updated_at ON group_triggers;
CREATE TRIGGER trigger_group_triggers_updated_at
  BEFORE UPDATE ON group_triggers
  FOR EACH ROW
  EXECUTE FUNCTION update_group_triggers_updated_at();

-- 4. Add comments for documentation
COMMENT ON TABLE group_triggers IS 'Per-group trigger patterns. Triggers define WHAT phrases activate responses and automatically respect the active time-based rule.';
COMMENT ON COLUMN group_triggers.trigger_phrase IS 'The phrase to match against incoming messages (e.g., preço, cotação, compro)';
COMMENT ON COLUMN group_triggers.pattern_type IS 'Matching strategy: exact (case-insensitive equality), contains (substring match), regex (regular expression)';
COMMENT ON COLUMN group_triggers.action_type IS 'Action to execute: price_quote (rule-aware price), volume_quote (rule-aware amount calc), text_response (static text), ai_prompt (AI with context)';
COMMENT ON COLUMN group_triggers.action_params IS 'Action-specific parameters as JSON. text_response: {text: "..."}, ai_prompt: {prompt: "...", context: "..."}, price_quote/volume_quote: {}';
COMMENT ON COLUMN group_triggers.priority IS 'Higher priority triggers match first when multiple could match (0-100)';
COMMENT ON COLUMN group_triggers.is_active IS 'Disabled triggers are ignored during pattern matching';
