/**
 * Rules Service - Manages trigger rules from the dashboard
 *
 * Provides in-memory caching of rules from the `rules` table.
 * Rules only activate when a group is in "active" mode.
 *
 * This bridges the dashboard UI (rules table) with the bot (router.ts).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'
import type { EnvConfig } from '../types/config.js'

// Rule action types (must match database constraint)
export type RuleActionType =
  | 'text_response'
  | 'usdt_quote'
  | 'commercial_dollar_quote'
  | 'ai_prompt'
  | 'custom'

// Rule scope types (group-specific, global, or control-only)
export type RuleScope = 'group' | 'global' | 'control_only'

// Rule interface (camelCase for TypeScript)
export interface Rule {
  id: string
  groupJid: string
  triggerPhrase: string
  responseTemplate: string
  actionType: RuleActionType
  actionParams: Record<string, unknown>
  isActive: boolean
  priority: number
  conditions: Record<string, unknown>
  scope: RuleScope
  isSystem: boolean
  createdAt: Date
  updatedAt: Date
}

// Database row type (snake_case)
// Note: scope and is_system columns may not exist yet (pending migration)
interface RuleRow {
  id: string
  group_jid: string
  trigger_phrase: string
  response_template: string
  action_type: RuleActionType
  action_params: Record<string, unknown>
  is_active: boolean
  priority: number
  conditions: Record<string, unknown>
  metadata?: Record<string, unknown>
  scope?: RuleScope
  is_system?: boolean
  created_at: string
  updated_at: string
}

// In-memory cache: groupJid -> Rule[] (sorted by priority desc)
const rulesCache: Map<string, Rule[]> = new Map()

// Module-level state
let supabase: SupabaseClient | null = null
let initialized = false

/**
 * Convert database row to Rule object
 * Note: Infers scope and isSystem from group_jid and metadata if columns don't exist
 */
function rowToRule(row: RuleRow): Rule {
  // Infer scope and isSystem if columns don't exist yet
  const isGlobal = row.group_jid === '*'
  const inferredScope: RuleScope = row.scope || (isGlobal ? 'global' : 'group')
  const inferredIsSystem = row.is_system ?? (isGlobal && row.metadata?.source === 'triggers.ts')

  return {
    id: row.id,
    groupJid: row.group_jid,
    triggerPhrase: row.trigger_phrase,
    responseTemplate: row.response_template,
    actionType: row.action_type,
    actionParams: row.action_params || {},
    isActive: row.is_active,
    priority: row.priority,
    conditions: row.conditions || {},
    scope: inferredScope,
    isSystem: inferredIsSystem || false,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

/**
 * Initialize the rules service.
 * Loads all active rules from Supabase into memory cache.
 */
export async function initRulesService(config: EnvConfig): Promise<Result<void>> {
  supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY)

  try {
    // Load all active rules
    const { data, error } = await supabase
      .from('rules')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      logger.error('Failed to load rules from Supabase', {
        event: 'rules_init_error',
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Failed to load rules: ${error.message}`)
    }

    // Group rules by groupJid
    rulesCache.clear()
    const rows = (data || []) as RuleRow[]

    for (const row of rows) {
      const rule = rowToRule(row)
      const existing = rulesCache.get(rule.groupJid) || []
      existing.push(rule)
      rulesCache.set(rule.groupJid, existing)
    }

    // Count rules per group for logging
    const groupCounts: Record<string, number> = {}
    for (const [groupJid, rules] of rulesCache) {
      groupCounts[groupJid] = rules.length
    }

    initialized = true

    logger.info('Rules service initialized', {
      event: 'rules_init',
      totalRules: rows.length,
      groupsWithRules: rulesCache.size,
      groupCounts,
    })

    return ok(undefined)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Unexpected error initializing rules service', {
      event: 'rules_init_exception',
      error: errorMessage,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Get all active rules for a group (from cache).
 * Returns empty array if no rules exist.
 * Rules are already sorted by priority desc.
 */
export function getActiveRulesForGroup(groupJid: string): Rule[] {
  if (!initialized) {
    logger.warn('Rules service not initialized, returning empty rules', {
      event: 'rules_not_initialized',
      groupJid,
    })
    return []
  }
  return rulesCache.get(groupJid) || []
}

/**
 * Find the first matching rule for a message.
 * Checks group-specific rules first, then falls back to global rules.
 * Returns the highest priority rule whose trigger phrase is contained in the message.
 *
 * @param groupJid - The group to check rules for
 * @param message - The message text to match against
 * @returns The matching rule or null
 */
export function findMatchingRule(groupJid: string, message: string): Rule | null {
  if (!initialized) {
    logger.warn('Rules service not initialized, skipping rule matching', {
      event: 'rules_not_initialized',
      groupJid,
    })
    return null
  }

  const messageLower = message.toLowerCase()

  // Step 1: Check group-specific rules first (higher priority)
  const groupRules = rulesCache.get(groupJid) || []
  for (const rule of groupRules) {
    if (messageLower.includes(rule.triggerPhrase.toLowerCase())) {
      logger.debug('Group rule matched', {
        event: 'rule_matched',
        groupJid,
        ruleId: rule.id,
        trigger: rule.triggerPhrase,
        actionType: rule.actionType,
        priority: rule.priority,
        scope: rule.scope,
      })
      return rule
    }
  }

  // Step 2: Check global rules (system patterns like 'preço', 'cotação')
  // Global rules are stored with groupJid = '*'
  const globalRules = rulesCache.get('*') || []
  for (const rule of globalRules) {
    if (messageLower.includes(rule.triggerPhrase.toLowerCase())) {
      logger.debug('Global rule matched', {
        event: 'rule_matched',
        groupJid,
        ruleId: rule.id,
        trigger: rule.triggerPhrase,
        actionType: rule.actionType,
        priority: rule.priority,
        scope: rule.scope,
        isSystem: rule.isSystem,
      })
      return rule
    }
  }

  return null
}

/**
 * Refresh the rules cache.
 * Called after CRUD operations in the dashboard API.
 *
 * @param groupJid - Optional group to refresh. If not provided, refreshes all.
 */
export async function refreshRulesCache(groupJid?: string): Promise<Result<void>> {
  if (!supabase) {
    return err('Rules service not initialized')
  }

  try {
    let query = supabase
      .from('rules')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })

    // If specific group, only fetch that group's rules
    if (groupJid) {
      query = query.eq('group_jid', groupJid)
    }

    const { data, error } = await query

    if (error) {
      logger.error('Failed to refresh rules cache', {
        event: 'rules_refresh_error',
        groupJid,
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Failed to refresh rules: ${error.message}`)
    }

    const rows = (data || []) as RuleRow[]

    if (groupJid) {
      // Refresh single group
      const rules = rows.map(rowToRule)
      if (rules.length > 0) {
        rulesCache.set(groupJid, rules)
      } else {
        rulesCache.delete(groupJid)
      }

      logger.info('Rules cache refreshed for group', {
        event: 'rules_refresh',
        groupJid,
        ruleCount: rules.length,
      })
    } else {
      // Full refresh
      rulesCache.clear()
      for (const row of rows) {
        const rule = rowToRule(row)
        const existing = rulesCache.get(rule.groupJid) || []
        existing.push(rule)
        rulesCache.set(rule.groupJid, existing)
      }

      logger.info('Rules cache fully refreshed', {
        event: 'rules_refresh_full',
        totalRules: rows.length,
        groupsWithRules: rulesCache.size,
      })
    }

    return ok(undefined)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Unexpected error refreshing rules cache', {
      event: 'rules_refresh_exception',
      groupJid,
      error: errorMessage,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Check if rules service is initialized.
 */
export function isRulesServiceInitialized(): boolean {
  return initialized
}

/**
 * Get cache stats (for debugging/monitoring).
 */
export function getRulesCacheStats(): { groupCount: number; totalRules: number } {
  let totalRules = 0
  for (const rules of rulesCache.values()) {
    totalRules += rules.length
  }
  return {
    groupCount: rulesCache.size,
    totalRules,
  }
}

/**
 * Reset the rules cache (for testing).
 */
export function resetRulesCache(): void {
  rulesCache.clear()
  initialized = false
}
