-- Migration: Create sessions table (Story 1.2)
-- Purpose: Store Baileys auth state for session persistence across restarts

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY DEFAULT 'default',
  auth_state JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (optional for single-user bot)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Policy for authenticated access (adjust as needed)
CREATE POLICY "Allow all operations for authenticated users"
  ON sessions
  FOR ALL
  USING (true)
  WITH CHECK (true);
