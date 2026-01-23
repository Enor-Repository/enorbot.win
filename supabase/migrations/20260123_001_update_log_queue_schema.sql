-- Migration: Update log_queue table schema
-- Purpose: Add new columns for volume tracking and remove old quote_formatted column

-- Add new columns
ALTER TABLE log_queue
  ADD COLUMN IF NOT EXISTS volume_brl NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS acquired_usdt NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS onchain_tx TEXT;

-- Rename quote_value to quote for consistency
ALTER TABLE log_queue
  RENAME COLUMN quote_value TO quote;

-- Drop the quote_formatted column (no longer needed)
ALTER TABLE log_queue
  DROP COLUMN IF EXISTS quote_formatted;

-- Add index for efficient onchain_tx lookups
CREATE INDEX IF NOT EXISTS idx_log_queue_onchain_tx ON log_queue(onchain_tx) WHERE onchain_tx IS NOT NULL;
