/**
 * Trigger Service - Per-Group Trigger Pattern Management
 * Sprint 3: Group Triggers
 *
 * Manages trigger patterns per group:
 * - Each group can have multiple triggers with pattern matching
 * - Triggers define WHAT phrases activate responses
 * - They automatically respect the active time-based rule (Sprint 2)
 *
 * Pattern matching supports: exact (case-insensitive), contains (substring), regex
 */
import { getSupabase } from './supabase.js'
import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'

// ============================================================================
// Types
// ============================================================================

/** How to match the trigger phrase against incoming messages */
export type PatternType = 'exact' | 'contains' | 'regex'

/** Action to execute when a trigger matches */
export type TriggerActionType =
  | 'price_quote'
  | 'volume_quote'
  | 'text_response'
  | 'ai_prompt'
  | 'deal_lock'
  | 'deal_cancel'
  | 'deal_confirm'
  | 'deal_volume'
  | 'tronscan_process'
  | 'receipt_process'
  | 'control_command'

/** Trigger scope: 'group' (normal) or 'control_only' (only fires in control groups) */
export type TriggerScope = 'group' | 'control_only'

/** All valid scope values */
const VALID_SCOPES: TriggerScope[] = ['group', 'control_only']

/** All valid pattern types */
const VALID_PATTERN_TYPES: PatternType[] = ['exact', 'contains', 'regex']

/** All valid action types */
const VALID_ACTION_TYPES: TriggerActionType[] = [
  'price_quote', 'volume_quote', 'text_response', 'ai_prompt',
  'deal_lock', 'deal_cancel', 'deal_confirm', 'deal_volume',
  'tronscan_process', 'receipt_process', 'control_command',
]

/** Trigger configuration */
export interface GroupTrigger {
  id: string
  groupJid: string
  triggerPhrase: string
  patternType: PatternType
  actionType: TriggerActionType
  actionParams: Record<string, unknown>
  priority: number
  isActive: boolean
  isSystem: boolean
  scope: TriggerScope
  createdAt: Date
  updatedAt: Date
}

/** Database row type (snake_case) */
interface GroupTriggerRow {
  id: string
  group_jid: string
  trigger_phrase: string
  pattern_type: string
  action_type: string
  action_params: Record<string, unknown>
  priority: number
  is_active: boolean
  is_system: boolean
  scope: string
  created_at: string
  updated_at: string
}

/** Input for creating a trigger */
export interface TriggerInput {
  groupJid: string
  triggerPhrase: string
  patternType?: PatternType
  actionType: TriggerActionType
  actionParams?: Record<string, unknown>
  priority?: number
  isActive?: boolean
  scope?: TriggerScope
}

/** Input for updating a trigger (all fields optional) */
export interface TriggerUpdateInput {
  triggerPhrase?: string
  patternType?: PatternType
  actionType?: TriggerActionType
  actionParams?: Record<string, unknown>
  priority?: number
  isActive?: boolean
  scope?: TriggerScope
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Cache TTL in milliseconds (1 minute).
 * After dashboard CRUD operations, the cache is invalidated immediately for
 * the affected group. Price requests arriving within this TTL window may still
 * use stale data until the cache expires naturally. This is acceptable since
 * trigger changes are infrequent and 1-minute staleness is negligible.
 */
const CACHE_TTL_MS = 1 * 60 * 1000

/** Maximum triggers per group */
const MAX_TRIGGERS_PER_GROUP = 50

/** Maximum priority value */
const MAX_PRIORITY = 100

/** Maximum trigger phrase length */
const MAX_PHRASE_LENGTH = 200

// ============================================================================
// Cache
// ============================================================================

/** In-memory cache for triggers per group */
const triggersCache: Map<string, GroupTrigger[]> = new Map()

/** Cache timestamps for TTL checking */
const cacheTimestamps: Map<string, number> = new Map()

/** Check if cached entry is still valid */
function isCacheValid(groupJid: string): boolean {
  const timestamp = cacheTimestamps.get(groupJid)
  if (!timestamp) return false
  return Date.now() - timestamp < CACHE_TTL_MS
}

/** Clear cache for a specific group or all groups */
export function clearTriggersCache(groupJid?: string): void {
  if (groupJid) {
    triggersCache.delete(groupJid)
    cacheTimestamps.delete(groupJid)
  } else {
    triggersCache.clear()
    cacheTimestamps.clear()
  }
}

// ============================================================================
// Data Conversion
// ============================================================================

/** Convert database row to GroupTrigger object */
function rowToTrigger(row: GroupTriggerRow): GroupTrigger {
  return {
    id: row.id,
    groupJid: row.group_jid,
    triggerPhrase: row.trigger_phrase,
    patternType: row.pattern_type as PatternType,
    actionType: row.action_type as TriggerActionType,
    actionParams: row.action_params || {},
    priority: row.priority,
    isActive: row.is_active,
    isSystem: row.is_system ?? false,
    scope: (row.scope as TriggerScope) || 'group',
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

/** Convert TriggerInput to database row format for INSERT */
function inputToRow(input: TriggerInput): Record<string, unknown> {
  return {
    group_jid: input.groupJid,
    trigger_phrase: input.triggerPhrase.trim(),
    pattern_type: input.patternType || 'contains',
    action_type: input.actionType,
    action_params: input.actionParams || {},
    priority: input.priority ?? 0,
    is_active: input.isActive ?? true,
    scope: input.scope || 'group',
  }
}

/** Convert TriggerUpdateInput to database row format for UPDATE */
function updateToRow(input: TriggerUpdateInput): Record<string, unknown> {
  const row: Record<string, unknown> = {}

  if (input.triggerPhrase !== undefined) row.trigger_phrase = input.triggerPhrase.trim()
  if (input.patternType !== undefined) row.pattern_type = input.patternType
  if (input.actionType !== undefined) row.action_type = input.actionType
  if (input.actionParams !== undefined) row.action_params = input.actionParams
  if (input.priority !== undefined) row.priority = input.priority
  if (input.isActive !== undefined) row.is_active = input.isActive
  if (input.scope !== undefined) row.scope = input.scope

  return row
}

// ============================================================================
// Validation
// ============================================================================

/** Validate pattern type */
export function isValidPatternType(type: string): type is PatternType {
  return VALID_PATTERN_TYPES.includes(type as PatternType)
}

/** Validate action type */
export function isValidActionType(type: string): type is TriggerActionType {
  return VALID_ACTION_TYPES.includes(type as TriggerActionType)
}

/** Validate scope */
export function isValidScope(scope: string): scope is TriggerScope {
  return VALID_SCOPES.includes(scope as TriggerScope)
}

/** Maximum allowed regex pattern length to mitigate ReDoS */
const MAX_REGEX_LENGTH = 100

/** Validate a regex pattern string (includes ReDoS protection) */
export function isValidRegex(pattern: string): boolean {
  if (pattern.length > MAX_REGEX_LENGTH) return false

  try {
    new RegExp(pattern, 'i')
    return true
  } catch {
    return false
  }
}

/** Validate a TriggerInput */
export function validateTriggerInput(input: TriggerInput): string | null {
  if (!input.groupJid) return 'groupJid is required'

  if (!input.triggerPhrase || input.triggerPhrase.trim().length === 0) {
    return 'triggerPhrase is required'
  }

  if (input.triggerPhrase.trim().length > MAX_PHRASE_LENGTH) {
    return `triggerPhrase must be ${MAX_PHRASE_LENGTH} characters or less`
  }

  if (!input.actionType) return 'actionType is required'

  if (!isValidActionType(input.actionType)) {
    return `Invalid actionType: ${input.actionType}. Must be one of: ${VALID_ACTION_TYPES.join(', ')}`
  }

  if (input.patternType !== undefined && !isValidPatternType(input.patternType)) {
    return `Invalid patternType: ${input.patternType}. Must be one of: ${VALID_PATTERN_TYPES.join(', ')}`
  }

  // Validate regex patterns
  if (input.patternType === 'regex' && !isValidRegex(input.triggerPhrase)) {
    return `Invalid regex pattern: ${input.triggerPhrase}`
  }

  if (input.priority !== undefined && (input.priority < 0 || input.priority > MAX_PRIORITY)) {
    return `Priority must be between 0 and ${MAX_PRIORITY}`
  }

  if (input.scope !== undefined && !isValidScope(input.scope)) {
    return `Invalid scope: ${input.scope}. Must be one of: ${VALID_SCOPES.join(', ')}`
  }

  // Validate action params based on action type
  if (input.actionType === 'text_response') {
    const text = input.actionParams?.text
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return 'text_response requires a non-empty "text" in actionParams'
    }
  }

  if (input.actionType === 'ai_prompt') {
    const prompt = input.actionParams?.prompt
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return 'ai_prompt requires a non-empty "prompt" in actionParams'
    }
  }

  return null
}

// ============================================================================
// Pattern Matching
// ============================================================================

/**
 * Test if a message matches a trigger's pattern.
 *
 * @param message - The incoming message text
 * @param trigger - The trigger to test against
 * @returns true if the message matches the trigger's pattern
 */
export function matchesPattern(message: string, trigger: GroupTrigger): boolean {
  if (!trigger.isActive) return false

  const messageLower = message.toLowerCase()
  const phraseLower = trigger.triggerPhrase.toLowerCase()

  switch (trigger.patternType) {
    case 'exact':
      return messageLower === phraseLower

    case 'contains':
      return messageLower.includes(phraseLower)

    case 'regex':
      try {
        const regex = new RegExp(trigger.triggerPhrase, 'i')
        return regex.test(message)
      } catch {
        logger.warn('Invalid regex in trigger, skipping', {
          event: 'trigger_invalid_regex',
          triggerId: trigger.id,
          pattern: trigger.triggerPhrase,
        })
        return false
      }

    default:
      return false
  }
}

/**
 * Find the first matching trigger for a message in a group.
 * Triggers are sorted by priority DESC; first match wins.
 *
 * Scope filtering:
 * - In control groups (isControlGroup=true): all triggers match (both 'group' and 'control_only')
 * - In regular groups (isControlGroup=false): only 'group' scope triggers match
 *
 * @param message - The incoming message text
 * @param groupJid - The group to check triggers for
 * @param isControlGroup - Whether the message is from a control group
 * @returns The matching trigger or null
 */
export async function matchTrigger(
  message: string,
  groupJid: string,
  isControlGroup = false
): Promise<Result<GroupTrigger | null>> {
  const triggersResult = await getTriggersForGroup(groupJid)
  if (!triggersResult.ok) return triggersResult as Result<GroupTrigger | null>

  const triggers = triggersResult.data
  if (triggers.length === 0) return ok(null)

  for (const trigger of triggers) {
    // Scope filtering: control_only triggers only fire in control groups
    if (!isControlGroup && trigger.scope === 'control_only') continue

    if (matchesPattern(message, trigger)) {
      logger.debug('Trigger matched', {
        event: 'trigger_matched',
        groupJid,
        triggerId: trigger.id,
        phrase: trigger.triggerPhrase,
        patternType: trigger.patternType,
        actionType: trigger.actionType,
        priority: trigger.priority,
        scope: trigger.scope,
      })
      return ok(trigger)
    }
  }

  return ok(null)
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get all triggers for a group.
 * Returns from cache if valid, otherwise fetches from database.
 */
export async function getTriggersForGroup(groupJid: string): Promise<Result<GroupTrigger[]>> {
  // Check cache first
  if (isCacheValid(groupJid)) {
    const cached = triggersCache.get(groupJid)
    if (cached) {
      logger.debug('Triggers from cache', {
        event: 'triggers_cache_hit',
        groupJid,
        count: cached.length,
      })
      return ok(cached)
    }
  }

  const supabase = getSupabase()
  if (!supabase) {
    return ok([]) // No DB = no triggers
  }

  try {
    const { data, error } = await supabase
      .from('group_triggers')
      .select('*')
      .eq('group_jid', groupJid)
      .order('priority', { ascending: false })

    if (error) {
      logger.error('Failed to load triggers', {
        event: 'triggers_load_error',
        groupJid,
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Failed to load triggers: ${error.message}`)
    }

    const triggers = (data || []).map((row) => rowToTrigger(row as GroupTriggerRow))

    // Cache the result
    triggersCache.set(groupJid, triggers)
    cacheTimestamps.set(groupJid, Date.now())

    logger.debug('Triggers loaded', {
      event: 'triggers_loaded',
      groupJid,
      count: triggers.length,
    })

    return ok(triggers)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Unexpected error loading triggers', {
      event: 'triggers_load_exception',
      groupJid,
      error: errorMessage,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Get a specific trigger by ID.
 */
export async function getTriggerById(triggerId: string): Promise<Result<GroupTrigger>> {
  const supabase = getSupabase()
  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    const { data, error } = await supabase
      .from('group_triggers')
      .select('*')
      .eq('id', triggerId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return err('Trigger not found')
      return err(`Failed to load trigger: ${error.message}`)
    }

    return ok(rowToTrigger(data as GroupTriggerRow))
  } catch (e) {
    return err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Create a new trigger.
 */
export async function createTrigger(input: TriggerInput): Promise<Result<GroupTrigger>> {
  const validationError = validateTriggerInput(input)
  if (validationError) return err(validationError)

  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  try {
    // Check trigger count limit
    const countResult = await getTriggersForGroup(input.groupJid)
    if (countResult.ok && countResult.data.length >= MAX_TRIGGERS_PER_GROUP) {
      return err(`Maximum ${MAX_TRIGGERS_PER_GROUP} triggers per group`)
    }

    const row = inputToRow(input)

    // Clear cache before insert
    clearTriggersCache(input.groupJid)

    const { data, error } = await supabase
      .from('group_triggers')
      .insert(row)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return err(`A trigger with phrase "${input.triggerPhrase}" already exists in this group`)
      }
      logger.error('Failed to create trigger', {
        event: 'trigger_create_error',
        groupJid: input.groupJid,
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Failed to create trigger: ${error.message}`)
    }

    const trigger = rowToTrigger(data as GroupTriggerRow)

    logger.info('Trigger created', {
      event: 'trigger_created',
      groupJid: input.groupJid,
      triggerId: trigger.id,
      phrase: trigger.triggerPhrase,
      patternType: trigger.patternType,
      actionType: trigger.actionType,
    })

    return ok(trigger)
  } catch (e) {
    return err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Update an existing trigger.
 */
export async function updateTrigger(
  triggerId: string,
  groupJid: string,
  input: TriggerUpdateInput
): Promise<Result<GroupTrigger>> {
  // Validate fields if provided
  if (input.triggerPhrase !== undefined) {
    if (input.triggerPhrase.trim().length === 0) return err('triggerPhrase cannot be empty')
    if (input.triggerPhrase.trim().length > MAX_PHRASE_LENGTH) {
      return err(`triggerPhrase must be ${MAX_PHRASE_LENGTH} characters or less`)
    }
  }
  if (input.patternType !== undefined && !isValidPatternType(input.patternType)) {
    return err(`Invalid patternType: ${input.patternType}. Must be one of: ${VALID_PATTERN_TYPES.join(', ')}`)
  }
  if (input.actionType !== undefined && !isValidActionType(input.actionType)) {
    return err(`Invalid actionType: ${input.actionType}. Must be one of: ${VALID_ACTION_TYPES.join(', ')}`)
  }
  if (input.priority !== undefined && (input.priority < 0 || input.priority > MAX_PRIORITY)) {
    return err(`Priority must be between 0 and ${MAX_PRIORITY}`)
  }

  // Validate regex if pattern type is being set to regex
  if (input.patternType === 'regex') {
    const phrase = input.triggerPhrase
    if (phrase !== undefined && !isValidRegex(phrase)) {
      return err(`Invalid regex pattern: ${phrase}`)
    }
  }

  // Validate action params for specific action types
  if (input.actionType === 'text_response' && input.actionParams !== undefined) {
    const text = input.actionParams?.text
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return err('text_response requires a non-empty "text" in actionParams')
    }
  }
  if (input.actionType === 'ai_prompt' && input.actionParams !== undefined) {
    const prompt = input.actionParams?.prompt
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return err('ai_prompt requires a non-empty "prompt" in actionParams')
    }
  }

  const row = updateToRow(input)
  if (Object.keys(row).length === 0) return err('No fields to update')

  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  try {

    // Clear cache before update
    clearTriggersCache(groupJid)

    const { data, error } = await supabase
      .from('group_triggers')
      .update(row)
      .eq('id', triggerId)
      .eq('group_jid', groupJid)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') return err('Trigger not found')
      if (error.code === '23505') return err('A trigger with that phrase already exists in this group')
      logger.error('Failed to update trigger', {
        event: 'trigger_update_error',
        triggerId,
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Failed to update trigger: ${error.message}`)
    }

    const trigger = rowToTrigger(data as GroupTriggerRow)

    logger.info('Trigger updated', {
      event: 'trigger_updated',
      groupJid,
      triggerId: trigger.id,
      phrase: trigger.triggerPhrase,
    })

    return ok(trigger)
  } catch (e) {
    return err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Delete a trigger.
 * Uses .select() after .delete() and checks data.length (Sprint 2 retro lesson).
 */
export async function deleteTrigger(triggerId: string, groupJid: string): Promise<Result<void>> {
  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  try {
    // Clear cache before delete
    clearTriggersCache(groupJid)

    const { data, error } = await supabase
      .from('group_triggers')
      .delete()
      .eq('id', triggerId)
      .eq('group_jid', groupJid)
      .select('id')

    if (error) {
      logger.error('Failed to delete trigger', {
        event: 'trigger_delete_error',
        triggerId,
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Failed to delete trigger: ${error.message}`)
    }

    if (!data || data.length === 0) {
      return err('Trigger not found')
    }

    logger.info('Trigger deleted', {
      event: 'trigger_deleted',
      groupJid,
      triggerId,
    })

    return ok(undefined)
  } catch (e) {
    return err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// ============================================================================
// Cache Stats (for monitoring)
// ============================================================================

/** Get cache statistics */
export function getTriggersCacheStats(): { size: number; entries: string[] } {
  return {
    size: triggersCache.size,
    entries: Array.from(triggersCache.keys()),
  }
}
