/**
 * Shared system-trigger template builder.
 *
 * Provides canonical trigger rows used by:
 * - seedDefaultTriggers (manual dashboard seeding)
 * - system trigger reconciliation (automatic drift healing)
 */

import { getKeywordsForPattern, type PatternKey } from './systemPatternService.js'

export type SystemTriggerPatternType = 'exact' | 'contains' | 'regex'
export type SystemTriggerScope = 'group' | 'control_only'

export interface SystemTriggerRow {
  group_jid: string
  trigger_phrase: string
  pattern_type: SystemTriggerPatternType
  action_type: string
  action_params: Record<string, unknown>
  priority: number
  is_active: boolean
  is_system: boolean
  scope: SystemTriggerScope
  display_name?: string
}

interface TriggerTemplate {
  triggerPhrase: string
  patternType: SystemTriggerPatternType
  actionType: string
  priority: number
  scope?: SystemTriggerScope
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
const FIXED_REGEX_TEMPLATES: TriggerTemplate[] = [
  {
    triggerPhrase: '(?:^|[^a-z0-9])(?:https?://)?(?:www\\.)?tronscan\\.(?:org|io)/#/transaction/[a-f0-9]{64}',
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
 */
const CONTROL_COMMAND_TEMPLATES: TriggerTemplate[] = [
  { triggerPhrase: 'status', patternType: 'exact', actionType: 'control_command', priority: 100, scope: 'control_only' },
  { triggerPhrase: 'pause', patternType: 'exact', actionType: 'control_command', priority: 100, scope: 'control_only' },
  { triggerPhrase: 'resume', patternType: 'exact', actionType: 'control_command', priority: 100, scope: 'control_only' },
  { triggerPhrase: 'modes', patternType: 'exact', actionType: 'control_command', priority: 100, scope: 'control_only' },
  { triggerPhrase: 'training on', patternType: 'exact', actionType: 'control_command', priority: 100, scope: 'control_only' },
  { triggerPhrase: 'training off', patternType: 'exact', actionType: 'control_command', priority: 100, scope: 'control_only' },
  { triggerPhrase: 'off', patternType: 'exact', actionType: 'control_command', priority: 100, scope: 'control_only', displayName: 'Off Command' },
]

/**
 * Build canonical system-trigger rows for a group.
 *
 * - Dynamic keyword groups are expanded from `system_patterns`
 * - Regex/system command templates are always included
 */
export async function buildSystemTriggerRows(
  groupJid: string,
  isControlGroup: boolean
): Promise<SystemTriggerRow[]> {
  const rows: SystemTriggerRow[] = []

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

  for (const template of FIXED_REGEX_TEMPLATES) {
    const row: SystemTriggerRow = {
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

  if (isControlGroup) {
    for (const template of CONTROL_COMMAND_TEMPLATES) {
      const row: SystemTriggerRow = {
        group_jid: groupJid,
        trigger_phrase: template.triggerPhrase,
        pattern_type: template.patternType,
        action_type: template.actionType,
        action_params: {},
        priority: template.priority,
        is_active: true,
        is_system: true,
        scope: template.scope || 'control_only',
      }
      if (template.displayName) row.display_name = template.displayName
      rows.push(row)
    }
  }

  return rows
}
