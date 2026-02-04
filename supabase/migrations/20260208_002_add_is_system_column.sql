-- Migration: Add is_system column to group_triggers
-- Sprint 7B.2: Distinguish system triggers from user-created triggers
--
-- System triggers (is_system = true):
--   - Cannot be deleted via the dashboard API (403)
--   - Keywords and priority can be edited
--   - Created automatically when a group first activates
--
-- User triggers (is_system = false, default):
--   - Full CRUD via dashboard

ALTER TABLE group_triggers
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

-- Index for filtering system vs user triggers
CREATE INDEX IF NOT EXISTS idx_group_triggers_system
  ON group_triggers(group_jid, is_system);

COMMENT ON COLUMN group_triggers.is_system IS 'True for bot-engine triggers (deal flow, tronscan). Cannot be deleted but keywords/priority are editable.';
