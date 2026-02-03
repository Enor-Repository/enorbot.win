-- Migration: Copy existing rules → group_triggers
-- Sprint 3, Task 3.7: Migration from old rules system
--
-- Strategy:
-- 1. Group-specific rules (group_jid != '*') are copied directly
-- 2. Global rules (group_jid = '*') are copied into every group that has a group_config entry
-- 3. Action types are mapped: usdt_quote/commercial_dollar_quote → price_quote
-- 4. Pattern type defaults to 'contains' (old system used substring matching)
-- 5. Old rules table is NOT dropped — kept for shadow mode validation

-- ============================================================================
-- Step 1: Migrate group-specific rules (non-global)
-- ============================================================================
INSERT INTO group_triggers (
  id,
  group_jid,
  trigger_phrase,
  pattern_type,
  action_type,
  action_params,
  priority,
  is_active,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  r.group_jid,
  LOWER(TRIM(r.trigger_phrase)),
  'contains',                           -- Old system used substring matching
  CASE r.action_type
    WHEN 'usdt_quote' THEN 'price_quote'
    WHEN 'commercial_dollar_quote' THEN 'price_quote'
    WHEN 'text_response' THEN 'text_response'
    WHEN 'ai_prompt' THEN 'ai_prompt'
    ELSE 'text_response'                -- Fallback for 'custom' or unknown
  END,
  CASE
    WHEN r.action_type IN ('text_response') AND r.response_template != '' THEN
      jsonb_build_object('text', r.response_template)
    WHEN r.action_type IN ('ai_prompt') AND r.action_params ? 'prompt' THEN
      r.action_params
    ELSE
      COALESCE(r.action_params, '{}'::jsonb)
  END,
  r.priority,
  r.is_active,
  r.created_at,
  NOW()
FROM rules r
WHERE r.group_jid != '*'
  AND r.action_type != 'custom'         -- Skip 'custom' type (no equivalent)
ON CONFLICT (group_jid, trigger_phrase) DO NOTHING;

-- ============================================================================
-- Pre-flight: Warn if group_config is empty (global rules won't be migrated)
-- ============================================================================
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM group_config) = 0 THEN
    RAISE WARNING 'No groups in group_config. Global rules (group_jid=*) will NOT be migrated to group_triggers.';
  END IF;
END $$;

-- ============================================================================
-- Step 2: Migrate global rules (group_jid = '*') into each active group
-- ============================================================================
-- For each global rule, create a copy in every group that has a group_config entry
INSERT INTO group_triggers (
  id,
  group_jid,
  trigger_phrase,
  pattern_type,
  action_type,
  action_params,
  priority,
  is_active,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  gc.jid,                               -- Target group JID from group_config
  LOWER(TRIM(r.trigger_phrase)),
  'contains',
  CASE r.action_type
    WHEN 'usdt_quote' THEN 'price_quote'
    WHEN 'commercial_dollar_quote' THEN 'price_quote'
    WHEN 'text_response' THEN 'text_response'
    WHEN 'ai_prompt' THEN 'ai_prompt'
    ELSE 'text_response'
  END,
  CASE
    WHEN r.action_type IN ('text_response') AND r.response_template != '' THEN
      jsonb_build_object('text', r.response_template)
    WHEN r.action_type IN ('ai_prompt') AND r.action_params ? 'prompt' THEN
      r.action_params
    ELSE
      COALESCE(r.action_params, '{}'::jsonb)
  END,
  r.priority,
  r.is_active,
  r.created_at,
  NOW()
FROM rules r
CROSS JOIN group_config gc
WHERE r.group_jid = '*'
  AND r.action_type != 'custom'
ON CONFLICT (group_jid, trigger_phrase) DO NOTHING;

-- ============================================================================
-- Step 3: Add deprecation marker to old rules table
-- ============================================================================
COMMENT ON TABLE rules IS 'DEPRECATED: Sprint 3 migrated rules to group_triggers table. Kept for shadow mode validation. Will be dropped after successful cutover validation.';
