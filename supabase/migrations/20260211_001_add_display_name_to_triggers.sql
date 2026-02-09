-- Add display_name column to group_triggers
-- Shows human-friendly names in dashboard instead of raw regex patterns

ALTER TABLE group_triggers ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Backfill existing system regex triggers
UPDATE group_triggers SET display_name = 'Tronscan Link'
  WHERE is_system = true AND action_type = 'tronscan_process' AND pattern_type = 'regex';
UPDATE group_triggers SET display_name = 'Volume Pattern'
  WHERE is_system = true AND action_type = 'deal_volume' AND pattern_type = 'regex';
