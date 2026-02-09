-- System Patterns table
-- Stores editable keyword lists for global bot pattern matching.
-- These patterns apply to ALL groups (not per-group like group_triggers).
-- Sprint 7: Editable system patterns

CREATE TABLE IF NOT EXISTS system_patterns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pattern_key TEXT UNIQUE NOT NULL,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  pattern_type TEXT NOT NULL DEFAULT 'contains',
  handler TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed with current hardcoded patterns (4 editable categories)
INSERT INTO system_patterns (pattern_key, keywords, pattern_type, handler, description)
VALUES
  ('price_request', ARRAY['preço', 'cotação'], 'contains', 'PRICE_HANDLER', 'Triggers a price quote using the active rule''s pricing source'),
  ('deal_cancellation', ARRAY['cancela', 'cancelar', 'cancel'], 'regex', 'DEAL_HANDLER', 'Cancels the active deal for this client'),
  ('price_lock', ARRAY['trava', 'lock', 'travar'], 'regex', 'DEAL_HANDLER', 'Locks the quoted rate for the client''s deal'),
  ('deal_confirmation', ARRAY['fechado', 'fecha', 'fechar', 'confirma', 'confirmado', 'confirmed'], 'regex', 'DEAL_HANDLER', 'Confirms and completes the locked deal')
ON CONFLICT (pattern_key) DO NOTHING;

-- Index for fast lookups by pattern_key
CREATE INDEX IF NOT EXISTS idx_system_patterns_key ON system_patterns (pattern_key);

-- Enable RLS — restrict to authenticated users only (service_role bypasses RLS automatically)
ALTER TABLE system_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read" ON system_patterns
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to update" ON system_patterns
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
