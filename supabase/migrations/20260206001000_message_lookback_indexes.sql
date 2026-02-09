-- Migration: Add composite indexes for message lookback queries
-- Sprint 5, Task 5.1: Message Lookback
-- Date: 2026-02-06
--
-- Pre-flight check: Verify messages table exists before adding indexes.
-- These indexes support efficient lookback queries:
-- 1. Fetch last N messages from a sender in a specific group
-- 2. Fetch recent messages in a group (all senders) for response suppression

-- Pre-flight: Ensure messages table exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'messages' AND table_schema = 'public'
  ) THEN
    RAISE EXCEPTION 'messages table does not exist - run 20260130_001 first';
  END IF;
END $$;

-- Composite index for sender lookback within a group
-- Supports: getRecentSenderMessages(groupJid, senderJid, limit)
-- The DESC ordering on created_at allows efficient "last N messages" queries
CREATE INDEX IF NOT EXISTS idx_messages_group_sender_created
  ON messages(group_jid, sender_jid, created_at DESC);

-- Composite index for bot response lookback in a group
-- Supports: checking if bot already responded recently (response suppression)
-- Partial index on is_from_bot = TRUE reduces index size
CREATE INDEX IF NOT EXISTS idx_messages_group_bot_created
  ON messages(group_jid, created_at DESC)
  WHERE is_from_bot = TRUE;

-- Comments
COMMENT ON INDEX idx_messages_group_sender_created IS 'Sprint 5: Sender message lookback within a group';
COMMENT ON INDEX idx_messages_group_bot_created IS 'Sprint 5: Bot response lookback for suppression logic';
