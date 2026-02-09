/**
 * Default Trigger Seeder
 *
 * Seeds a group with default triggers when manually requested via the dashboard.
 * Creates human-readable "contains" triggers for keyword patterns and
 * regex triggers only where truly needed (tronscan URLs, volume patterns).
 *
 * NOT called automatically — only via the "Seed Default Triggers" button
 * or POST /api/groups/:groupJid/seed endpoint.
 */

import { getSupabase } from './supabase.js'
import { getKeywordsForPattern, type PatternKey } from './systemPatternService.js'
import { clearTriggersCache } from './triggerService.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// Default Trigger Templates
// ============================================================================

interface DefaultTriggerTemplate {
  /** Human-readable trigger phrase */
  triggerPhrase: string
  patternType: 'exact' | 'contains' | 'regex'
  actionType: string
  priority: number
  scope?: 'group' | 'control_only'
  displayName?: string
}

interface DynamicKeywordGroup {
  patternKey: PatternKey
  actionType: string
  priority: number
}

/**
 * Keyword groups loaded from systemPatternService.
 * Each keyword becomes a separate "contains" trigger.
 */
const DYNAMIC_KEYWORD_GROUPS: DynamicKeywordGroup[] = [
  { patternKey: 'price_request', actionType: 'price_quote', priority: 100 },
  { patternKey: 'deal_cancellation', actionType: 'deal_cancel', priority: 90 },
  { patternKey: 'price_lock', actionType: 'deal_lock', priority: 90 },
  { patternKey: 'deal_confirmation', actionType: 'deal_confirm', priority: 90 },
]

/**
 * Fixed triggers that require regex (patterns, not keywords).
 */
const FIXED_REGEX_TEMPLATES: DefaultTriggerTemplate[] = [
  {
    triggerPhrase: 'tronscan\\.(?:org|io)/#/transaction/[a-f0-9]{64}',
    patternType: 'regex',
    actionType: 'tronscan_process',
    priority: 95,
    displayName: 'Tronscan Link',
  },
  {
    triggerPhrase: '\\d+(?:[.,]\\d+)?\\s*(?:k|mil)\\b|\\d{1,3}(?:[.,]\\d{3})+',
    patternType: 'regex',
    actionType: 'deal_volume',
    priority: 80,
    displayName: 'Volume Pattern',
  },
]

/**
 * Control command triggers (exact match, control_only scope).
 * These simple commands become triggers so they're visible in the dashboard.
 * Commands with arguments (mode <group>, config <group>, etc.) stay
 * hardcoded in parseControlCommand() and are routed via the fallback.
 */
const CONTROL_COMMAND_TEMPLATES: DefaultTriggerTemplate[] = [
  { triggerPhrase: 'status', patternType: 'exact', actionType: 'control_command', priority: 100, scope: 'control_only' },
  { triggerPhrase: 'pause', patternType: 'exact', actionType: 'control_command', priority: 100, scope: 'control_only' },
  { triggerPhrase: 'resume', patternType: 'exact', actionType: 'control_command', priority: 100, scope: 'control_only' },
  { triggerPhrase: 'modes', patternType: 'exact', actionType: 'control_command', priority: 100, scope: 'control_only' },
  { triggerPhrase: 'training on', patternType: 'exact', actionType: 'control_command', priority: 100, scope: 'control_only' },
  { triggerPhrase: 'training off', patternType: 'exact', actionType: 'control_command', priority: 100, scope: 'control_only' },
  { triggerPhrase: 'off', patternType: 'exact', actionType: 'control_command', priority: 100, scope: 'control_only', displayName: 'Off Command' },
]

// ============================================================================
// Seeding
// ============================================================================

/**
 * Seed default triggers for a group.
 * Skips if the group already has ANY triggers (system or user).
 * Creates human-readable "contains" triggers from keyword patterns,
 * and regex triggers only for URL/numeric patterns.
 *
 * All seeded triggers are marked is_system=true for UI badge display
 * but are fully editable and deletable.
 *
 * @param groupJid - The group to seed default triggers for
 * @param isControlGroup - Whether this is a control group (seeds control commands)
 */
export async function seedDefaultTriggers(groupJid: string, isControlGroup = false): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return

  try {
    // Check if group already has ANY triggers — don't overwrite existing config
    const { data: existing, error: checkError } = await supabase
      .from('group_triggers')
      .select('id')
      .eq('group_jid', groupJid)
      .limit(1)

    if (checkError) {
      logger.error('Failed to check existing triggers', {
        event: 'seed_check_error',
        groupJid,
        error: checkError.message,
      })
      return
    }

    if (existing && existing.length > 0) {
      logger.info('Group already has triggers, skipping seed', {
        event: 'seed_skip_has_triggers',
        groupJid,
      })
      return
    }

    // Build trigger rows
    const rows = await buildDefaultTriggerRows(groupJid, isControlGroup)

    if (rows.length === 0) {
      logger.warn('No default triggers to seed', {
        event: 'seed_empty_rows',
        groupJid,
      })
      return
    }

    // Insert all default triggers
    const { error: insertError } = await supabase
      .from('group_triggers')
      .upsert(rows, { onConflict: 'group_jid,trigger_phrase' })

    if (insertError) {
      logger.error('Failed to seed default triggers', {
        event: 'seed_insert_error',
        groupJid,
        error: insertError.message,
      })
      return
    }

    // Clear trigger cache so next matchTrigger reads fresh data
    clearTriggersCache(groupJid)

    logger.info('Default triggers seeded for group', {
      event: 'default_triggers_seeded',
      groupJid,
      count: rows.length,
    })
  } catch (e) {
    logger.error('Exception seeding default triggers', {
      event: 'seed_exception',
      groupJid,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

/**
 * Build database rows for all default triggers.
 * Loads keywords from systemPatternService and creates one "contains" trigger per keyword.
 */
async function buildDefaultTriggerRows(groupJid: string, isControlGroup: boolean): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []

  // Dynamic keyword groups → one "contains" trigger per keyword
  for (const group of DYNAMIC_KEYWORD_GROUPS) {
    const keywords = await getKeywordsForPattern(group.patternKey)
    for (const keyword of keywords) {
      rows.push({
        group_jid: groupJid,
        trigger_phrase: keyword,
        pattern_type: 'contains',
        action_type: group.actionType,
        action_params: {},
        priority: group.priority,
        is_active: true,
        is_system: true,
        scope: 'group',
      })
    }
  }

  // Fixed regex triggers (tronscan, volume)
  for (const template of FIXED_REGEX_TEMPLATES) {
    const row: Record<string, unknown> = {
      group_jid: groupJid,
      trigger_phrase: template.triggerPhrase,
      pattern_type: template.patternType,
      action_type: template.actionType,
      action_params: {},
      priority: template.priority,
      is_active: true,
      is_system: true,
      scope: template.scope || 'group',
    }
    if (template.displayName) row.display_name = template.displayName
    rows.push(row)
  }

  // Control command triggers — only seeded for control groups
  if (!isControlGroup) return rows

  for (const template of CONTROL_COMMAND_TEMPLATES) {
    rows.push({
      group_jid: groupJid,
      trigger_phrase: template.triggerPhrase,
      pattern_type: template.patternType,
      action_type: template.actionType,
      action_params: {},
      priority: template.priority,
      is_active: true,
      is_system: true,
      scope: template.scope || 'control_only',
    })
  }

  return rows
}
