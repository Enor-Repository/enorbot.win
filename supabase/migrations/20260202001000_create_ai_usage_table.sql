-- Story D.9: AI Usage Tracking
-- Creates table to track AI API calls for cost monitoring

CREATE TABLE IF NOT EXISTS ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- When the AI call was made
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- What service made the call
  service VARCHAR(50) NOT NULL, -- 'classification', 'ocr'

  -- Model used
  model VARCHAR(100) NOT NULL, -- e.g., 'anthropic/claude-3-5-haiku-20241022'

  -- Token counts
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,

  -- Cost in USD (calculated at logging time)
  cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,

  -- Context
  group_jid VARCHAR(50), -- Which group triggered the call (nullable for system calls)

  -- Duration in milliseconds
  duration_ms INTEGER,

  -- Success or error
  is_success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,

  -- Additional metadata (e.g., message type, confidence)
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at ON ai_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_group_jid ON ai_usage(group_jid);
CREATE INDEX IF NOT EXISTS idx_ai_usage_service ON ai_usage(service);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at_date ON ai_usage(DATE(created_at));

-- Enable RLS
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

-- Policy for service role (bot uses service role)
CREATE POLICY "Service role can manage ai_usage" ON ai_usage
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE ai_usage IS 'Tracks AI API calls for cost monitoring (Story D.9)';
COMMENT ON COLUMN ai_usage.service IS 'Service that made the call: classification, ocr';
COMMENT ON COLUMN ai_usage.cost_usd IS 'Estimated cost in USD based on model pricing';
