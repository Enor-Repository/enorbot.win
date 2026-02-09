-- Migration: Add missing index on attempts column (Issue fix)
-- Purpose: Improve query performance when flushing observation queue
-- The flushObservationEntries() function queries WHERE status = 'pending' AND attempts < MAX_RETRY_ATTEMPTS

-- Add index for attempts column (used in WHERE clause)
CREATE INDEX IF NOT EXISTS idx_observation_queue_attempts ON observation_queue(attempts);

-- Also add composite index for the common query pattern (status + attempts)
CREATE INDEX IF NOT EXISTS idx_observation_queue_status_attempts ON observation_queue(status, attempts);

-- Same indexes for log_queue table if not already present
CREATE INDEX IF NOT EXISTS idx_log_queue_attempts ON log_queue(attempts);
CREATE INDEX IF NOT EXISTS idx_log_queue_status_attempts ON log_queue(status, attempts);
