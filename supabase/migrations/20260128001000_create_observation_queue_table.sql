-- Migration: Create observation_queue table (Story 8.4)
-- Purpose: Store failed observation log entries for later retry

CREATE TABLE IF NOT EXISTS observation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  timestamp TIMESTAMPTZ NOT NULL,
  group_id TEXT NOT NULL,
  group_name TEXT NOT NULL,
  player_jid TEXT NOT NULL,
  player_name TEXT NOT NULL,
  player_role TEXT NOT NULL DEFAULT 'unknown',

  -- Classification
  message_type TEXT NOT NULL,
  trigger_pattern TEXT,
  conversation_thread UUID,

  -- Extracted data
  volume_brl NUMERIC,
  volume_usdt NUMERIC,
  content_preview TEXT NOT NULL,

  -- Response tracking
  response_required BOOLEAN DEFAULT false,
  response_given TEXT,
  response_time_ms INTEGER,

  -- Activity patterns
  hour_of_day SMALLINT NOT NULL CHECK (hour_of_day >= 0 AND hour_of_day <= 23),
  day_of_week SMALLINT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),

  -- Cost tracking
  ai_used BOOLEAN DEFAULT false,

  -- Queue metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  attempts INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'syncing', 'failed'))
);

-- Indexes for pattern queries (AC4)
CREATE INDEX IF NOT EXISTS idx_observation_queue_group ON observation_queue(group_id);
CREATE INDEX IF NOT EXISTS idx_observation_queue_thread ON observation_queue(conversation_thread);
CREATE INDEX IF NOT EXISTS idx_observation_queue_status ON observation_queue(status);
CREATE INDEX IF NOT EXISTS idx_observation_queue_created ON observation_queue(created_at);

-- Enable Row Level Security
ALTER TABLE observation_queue ENABLE ROW LEVEL SECURITY;

-- Policy for authenticated access
CREATE POLICY "Allow all operations for authenticated users"
  ON observation_queue
  FOR ALL
  USING (true)
  WITH CHECK (true);
