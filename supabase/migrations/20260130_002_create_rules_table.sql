-- Create rules table for bot response automation
CREATE TABLE IF NOT EXISTS rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid TEXT NOT NULL,
  trigger_phrase TEXT NOT NULL,
  response_template TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  conditions JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT DEFAULT 'dashboard',
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_rules_group_jid ON rules(group_jid);
CREATE INDEX IF NOT EXISTS idx_rules_active ON rules(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_rules_trigger ON rules USING gin (to_tsvector('portuguese', trigger_phrase));
CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority DESC);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rules_updated_at_trigger
  BEFORE UPDATE ON rules
  FOR EACH ROW
  EXECUTE FUNCTION update_rules_updated_at();

-- Add comment
COMMENT ON TABLE rules IS 'Bot response rules with trigger phrases and response templates';
