-- Migration: Add typo keyword variants for deal flow coverage expansion
-- Phase 1: Deterministic fixes for common typos ("cotaçaõ", "travcar", "cancelaa")

-- 1. Append typo keywords to system_patterns arrays
UPDATE system_patterns
SET keywords = array_cat(keywords, ARRAY['cotaçaõ']),
    updated_at = NOW()
WHERE pattern_key = 'price_request'
  AND NOT 'cotaçaõ' = ANY(keywords);

UPDATE system_patterns
SET keywords = array_cat(keywords, ARRAY['cancelaa']),
    updated_at = NOW()
WHERE pattern_key = 'deal_cancellation'
  AND NOT 'cancelaa' = ANY(keywords);

UPDATE system_patterns
SET keywords = array_cat(keywords, ARRAY['travcar']),
    updated_at = NOW()
WHERE pattern_key = 'price_lock'
  AND NOT 'travcar' = ANY(keywords);

-- 2. Add typo triggers to all groups that already have seeded triggers
-- is_system = true ensures they match existing system triggers (undeletable from dashboard)
INSERT INTO group_triggers (group_jid, trigger_phrase, pattern_type, action_type, priority, is_active, is_system)
SELECT DISTINCT gt.group_jid, typo.phrase, 'contains', typo.action_type, typo.priority, true, true
FROM group_triggers gt
CROSS JOIN (VALUES
  ('cotaçaõ', 'price_quote', 100),
  ('travcar', 'deal_lock', 90),
  ('cancelaa', 'deal_cancel', 90)
) AS typo(phrase, action_type, priority)
WHERE gt.is_active = true
ON CONFLICT (group_jid, trigger_phrase) DO NOTHING;
