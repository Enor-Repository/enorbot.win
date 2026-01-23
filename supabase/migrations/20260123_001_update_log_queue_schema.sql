-- Migration: Update log_queue table schema
-- Purpose: Add new columns for volume tracking
-- Note: Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS)

-- Add new columns (safe - only adds if not exists)
ALTER TABLE log_queue
  ADD COLUMN IF NOT EXISTS volume_brl NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS acquired_usdt NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS onchain_tx TEXT,
  ADD COLUMN IF NOT EXISTS quote NUMERIC(12, 4);

-- Drop old columns if they exist (from old schema)
ALTER TABLE log_queue
  DROP COLUMN IF EXISTS quote_value,
  DROP COLUMN IF EXISTS quote_formatted;

-- Add index for efficient onchain_tx lookups
CREATE INDEX IF NOT EXISTS idx_log_queue_onchain_tx ON log_queue(onchain_tx) WHERE onchain_tx IS NOT NULL;
