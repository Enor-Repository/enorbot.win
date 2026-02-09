-- Migration: Create log_queue table (Story 5.3)
-- Purpose: Store failed Excel log entries for later retry

CREATE TABLE IF NOT EXISTS log_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL,
  group_name TEXT NOT NULL,
  group_id TEXT NOT NULL,
  client_identifier TEXT NOT NULL,
  quote_value NUMERIC(10, 2) NOT NULL,
  quote_formatted TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  attempts INT DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'syncing', 'failed'))
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_log_queue_status ON log_queue(status);
CREATE INDEX IF NOT EXISTS idx_log_queue_created ON log_queue(created_at);

-- Enable Row Level Security
ALTER TABLE log_queue ENABLE ROW LEVEL SECURITY;

-- Policy for authenticated access
CREATE POLICY "Allow all operations for authenticated users"
  ON log_queue
  FOR ALL
  USING (true)
  WITH CHECK (true);
