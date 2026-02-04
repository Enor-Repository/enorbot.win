-- Migration: Add control_command action type + scope column
--
-- control_command: Routes to CONTROL_HANDLER for bot admin commands (status, pause, resume, etc.)
-- scope column: 'group' (default, works in owning group) or 'control_only' (only fires in control groups)

-- 1. Expand action_type CHECK with control_command
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
      'receipt_process',
      'control_command'
    ));

-- 2. Add scope column
ALTER TABLE group_triggers
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'group';

ALTER TABLE group_triggers
  ADD CONSTRAINT group_triggers_scope_check
    CHECK (scope IN ('group', 'control_only'));

-- 3. Index for scope filtering
CREATE INDEX IF NOT EXISTS idx_group_triggers_scope
  ON group_triggers(group_jid, scope, is_active);

COMMENT ON COLUMN group_triggers.action_type IS 'Action to execute: price_quote, volume_quote, text_response, ai_prompt, deal_lock, deal_cancel, deal_confirm, deal_volume, tronscan_process, receipt_process, control_command';
COMMENT ON COLUMN group_triggers.scope IS 'Trigger scope: group (normal) or control_only (only fires in control groups)';
