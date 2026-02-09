-- Migration: Add new action types to group_triggers
-- Sprint 7B.1: Extend action_type CHECK constraint for deal flow, tronscan, receipt processing
--
-- New action types:
--   deal_lock      — Locks the quoted rate for a deal
--   deal_cancel    — Cancels an active deal
--   deal_confirm   — Confirms and completes a locked deal
--   deal_volume    — Initiates a deal quote from a volume message
--   tronscan_process — Processes a Tronscan transaction link
--   receipt_process  — Processes a receipt (PDF/image)

-- Drop the old CHECK constraint and add the expanded one
ALTER TABLE group_triggers
  DROP CONSTRAINT IF EXISTS group_triggers_action_type_check;

ALTER TABLE group_triggers
  ADD CONSTRAINT group_triggers_action_type_check
    CHECK (action_type IN (
      'price_quote',
      'volume_quote',
      'text_response',
      'ai_prompt',
      'deal_lock',
      'deal_cancel',
      'deal_confirm',
      'deal_volume',
      'tronscan_process',
      'receipt_process'
    ));

-- Update column comment
COMMENT ON COLUMN group_triggers.action_type IS 'Action to execute: price_quote, volume_quote, text_response, ai_prompt, deal_lock, deal_cancel, deal_confirm, deal_volume, tronscan_process, receipt_process';
