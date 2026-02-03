/**
 * Rule Service - Time-Based Pricing Rules
 * Sprint 2: Group Rules
 *
 * Manages time-based pricing rules per group:
 * - Each group can have multiple rules with schedules
 * - The active rule (highest priority match at current time) determines pricing
 * - Falls back to group_spreads default when no rule matches
 *
 * Schedule matching uses native Intl.DateTimeFormat for timezone handling.
 */
import { getSupabase } from './supabase.js'
import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'

// ============================================================================
// Types
// ============================================================================

/** Pricing source for rate fetching */
export type PricingSource = 'commercial_dollar' | 'usdt_binance'

/** Spread calculation modes (reuses Sprint 1 types) */
export type SpreadMode = 'bps' | 'abs_brl' | 'flat'

/** Day abbreviations for schedule */
export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

/** All valid days */
const VALID_DAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** Rule configuration */
export interface GroupRule {
  id: string
  groupJid: string
  name: string
  description: string | null
  scheduleStartTime: string  // "HH:MM" format
  scheduleEndTime: string    // "HH:MM" format
  scheduleDays: DayOfWeek[]
  scheduleTimezone: string   // IANA timezone string
  priority: number
  pricingSource: PricingSource
  spreadMode: SpreadMode
  sellSpread: number
  buySpread: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/** Database row type (snake_case) */
interface GroupRuleRow {
  id: string
  group_jid: string
  name: string
  description: string | null
  schedule_start_time: string
  schedule_end_time: string
  schedule_days: string[]
  schedule_timezone: string
  priority: number
  pricing_source: string
  spread_mode: string
  sell_spread: number
  buy_spread: number
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Input for creating/updating a rule */
export interface RuleInput {
  groupJid: string
  name: string
  description?: string | null
  scheduleStartTime: string
  scheduleEndTime: string
  scheduleDays: DayOfWeek[]
  scheduleTimezone?: string
  priority?: number
  pricingSource?: PricingSource
  spreadMode?: SpreadMode
  sellSpread?: number
  buySpread?: number
  isActive?: boolean
}

/** Input for updating a rule (all fields optional except id) */
export interface RuleUpdateInput {
  name?: string
  description?: string | null
  scheduleStartTime?: string
  scheduleEndTime?: string
  scheduleDays?: DayOfWeek[]
  scheduleTimezone?: string
  priority?: number
  pricingSource?: PricingSource
  spreadMode?: SpreadMode
  sellSpread?: number
  buySpread?: number
  isActive?: boolean
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Cache TTL in milliseconds (1 minute).
 * Note: After dashboard CRUD operations, the cache is invalidated immediately for
 * the affected group. However, other bot instances or price requests arriving within
 * this TTL window may still use stale data until the cache expires naturally.
 * This is acceptable for pricing rules since 1-minute staleness is negligible
 * compared to schedule granularity (minutes/hours).
 */
const CACHE_TTL_MS = 1 * 60 * 1000

/** Maximum rules per group */
const MAX_RULES_PER_GROUP = 20

/** Maximum priority value */
const MAX_PRIORITY = 100

// ============================================================================
// Cache
// ============================================================================

/** In-memory cache for rules per group */
const rulesCache: Map<string, GroupRule[]> = new Map()

/** Cache timestamps for TTL checking */
const cacheTimestamps: Map<string, number> = new Map()

/** Check if cached entry is still valid */
function isCacheValid(groupJid: string): boolean {
  const timestamp = cacheTimestamps.get(groupJid)
  if (!timestamp) return false
  return Date.now() - timestamp < CACHE_TTL_MS
}

/** Clear cache for a specific group or all groups */
export function clearRulesCache(groupJid?: string): void {
  if (groupJid) {
    rulesCache.delete(groupJid)
    cacheTimestamps.delete(groupJid)
  } else {
    rulesCache.clear()
    cacheTimestamps.clear()
  }
}

// ============================================================================
// Data Conversion
// ============================================================================

/** Convert database row to GroupRule object */
function rowToRule(row: GroupRuleRow): GroupRule {
  return {
    id: row.id,
    groupJid: row.group_jid,
    name: row.name,
    description: row.description,
    scheduleStartTime: formatTimeFromDb(row.schedule_start_time),
    scheduleEndTime: formatTimeFromDb(row.schedule_end_time),
    scheduleDays: row.schedule_days as DayOfWeek[],
    scheduleTimezone: row.schedule_timezone,
    priority: row.priority,
    pricingSource: row.pricing_source as PricingSource,
    spreadMode: row.spread_mode as SpreadMode,
    sellSpread: Number(row.sell_spread),
    buySpread: Number(row.buy_spread),
    isActive: row.is_active,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

/**
 * Format TIME from database (may be "HH:MM:SS" or "HH:MM") to "HH:MM"
 */
function formatTimeFromDb(time: string): string {
  // PostgreSQL TIME can return "09:00:00", we want "09:00"
  const parts = time.split(':')
  return `${parts[0]}:${parts[1]}`
}

/** Convert RuleInput to database row format for INSERT */
function inputToRow(input: RuleInput): Record<string, unknown> {
  return {
    group_jid: input.groupJid,
    name: input.name,
    description: input.description ?? null,
    schedule_start_time: input.scheduleStartTime,
    schedule_end_time: input.scheduleEndTime,
    schedule_days: input.scheduleDays,
    schedule_timezone: input.scheduleTimezone || 'America/Sao_Paulo',
    priority: input.priority ?? 0,
    pricing_source: input.pricingSource || 'usdt_binance',
    spread_mode: input.spreadMode || 'bps',
    sell_spread: input.sellSpread ?? 0,
    buy_spread: input.buySpread ?? 0,
    is_active: input.isActive ?? true,
  }
}

/** Convert RuleUpdateInput to database row format for UPDATE */
function updateToRow(input: RuleUpdateInput): Record<string, unknown> {
  const row: Record<string, unknown> = {}

  if (input.name !== undefined) row.name = input.name
  if (input.description !== undefined) row.description = input.description
  if (input.scheduleStartTime !== undefined) row.schedule_start_time = input.scheduleStartTime
  if (input.scheduleEndTime !== undefined) row.schedule_end_time = input.scheduleEndTime
  if (input.scheduleDays !== undefined) row.schedule_days = input.scheduleDays
  if (input.scheduleTimezone !== undefined) row.schedule_timezone = input.scheduleTimezone
  if (input.priority !== undefined) row.priority = input.priority
  if (input.pricingSource !== undefined) row.pricing_source = input.pricingSource
  if (input.spreadMode !== undefined) row.spread_mode = input.spreadMode
  if (input.sellSpread !== undefined) row.sell_spread = input.sellSpread
  if (input.buySpread !== undefined) row.buy_spread = input.buySpread
  if (input.isActive !== undefined) row.is_active = input.isActive

  return row
}

// ============================================================================
// Validation
// ============================================================================

/** Validate time format "HH:MM" */
export function isValidTimeFormat(time: string): boolean {
  const match = time.match(/^(\d{2}):(\d{2})$/)
  if (!match) return false
  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
}

/** Validate day abbreviation */
export function isValidDay(day: string): day is DayOfWeek {
  return VALID_DAYS.includes(day as DayOfWeek)
}

/** Validate pricing source */
export function isValidPricingSource(source: string): source is PricingSource {
  return source === 'commercial_dollar' || source === 'usdt_binance'
}

/** Validate spread mode */
export function isValidSpreadMode(mode: string): mode is SpreadMode {
  return mode === 'bps' || mode === 'abs_brl' || mode === 'flat'
}

/** Validate IANA timezone string */
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Validate a RuleInput */
export function validateRuleInput(input: RuleInput): string | null {
  if (!input.groupJid) return 'groupJid is required'
  if (!input.name || input.name.trim().length === 0) return 'name is required'
  if (input.name.trim().length > 100) return 'name must be 100 characters or less'
  if (!isValidTimeFormat(input.scheduleStartTime)) return `Invalid start time: ${input.scheduleStartTime} (expected HH:MM)`
  if (!isValidTimeFormat(input.scheduleEndTime)) return `Invalid end time: ${input.scheduleEndTime} (expected HH:MM)`

  if (!input.scheduleDays || input.scheduleDays.length === 0) return 'At least one schedule day is required'
  for (const day of input.scheduleDays) {
    if (!isValidDay(day)) return `Invalid day: ${day}. Must be one of: ${VALID_DAYS.join(', ')}`
  }

  if (input.scheduleTimezone && !isValidTimezone(input.scheduleTimezone)) {
    return `Invalid timezone: ${input.scheduleTimezone}`
  }

  if (input.priority !== undefined && (input.priority < 0 || input.priority > MAX_PRIORITY)) {
    return `Priority must be between 0 and ${MAX_PRIORITY}`
  }

  if (input.pricingSource && !isValidPricingSource(input.pricingSource)) {
    return `Invalid pricing source: ${input.pricingSource}. Must be 'commercial_dollar' or 'usdt_binance'`
  }

  if (input.spreadMode && !isValidSpreadMode(input.spreadMode)) {
    return `Invalid spread mode: ${input.spreadMode}. Must be 'bps', 'abs_brl', or 'flat'`
  }

  return null
}

// ============================================================================
// Schedule Matching
// ============================================================================

/**
 * Get the current time components in a specific timezone.
 * Uses native Intl.DateTimeFormat for timezone conversion.
 *
 * @param timezone - IANA timezone string (e.g., 'America/Sao_Paulo')
 * @param now - Optional Date for testing (defaults to current time)
 * @returns Object with dayOfWeek, hours, minutes in the specified timezone
 */
export function getTimeInTimezone(
  timezone: string,
  now: Date = new Date()
): { dayOfWeek: DayOfWeek; hours: number; minutes: number } {
  // Use Intl to get time parts in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  })

  const parts = formatter.formatToParts(now)

  let hours = 0
  let minutes = 0
  let weekday = ''

  for (const part of parts) {
    switch (part.type) {
      case 'hour':
        hours = parseInt(part.value, 10)
        // Intl with hour12:false can return 24 for midnight in some locales
        if (hours === 24) hours = 0
        break
      case 'minute':
        minutes = parseInt(part.value, 10)
        break
      case 'weekday':
        weekday = part.value.toLowerCase()
        break
    }
  }

  // Map short weekday name to our abbreviation
  const weekdayMap: Record<string, DayOfWeek> = {
    sun: 'sun', mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri', sat: 'sat',
  }

  const dayOfWeek = weekdayMap[weekday]
  if (!dayOfWeek) {
    throw new Error(`Unexpected weekday from Intl.DateTimeFormat: "${weekday}"`)
  }

  return { dayOfWeek, hours, minutes }
}

/**
 * Convert "HH:MM" string to minutes since midnight.
 */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/**
 * Check if a rule's schedule matches the given time.
 *
 * Handles:
 * - Normal ranges: 09:00-18:00 (start < end)
 * - Overnight ranges: 18:00-09:00 (start > end, wraps past midnight)
 * - Equal times: 00:00-00:00 = all day
 *
 * @param rule - The rule to check
 * @param dayOfWeek - Current day in the rule's timezone
 * @param hours - Current hour in the rule's timezone
 * @param minutes - Current minute in the rule's timezone
 * @returns true if the rule is active at this time
 */
export function isRuleActiveAtTime(
  rule: GroupRule,
  dayOfWeek: DayOfWeek,
  hours: number,
  minutes: number
): boolean {
  // Rule must be enabled
  if (!rule.isActive) return false

  const currentMinutes = hours * 60 + minutes
  const startMinutes = timeToMinutes(rule.scheduleStartTime)
  const endMinutes = timeToMinutes(rule.scheduleEndTime)

  if (startMinutes === endMinutes) {
    // Equal start/end = all day on scheduled days
    return rule.scheduleDays.includes(dayOfWeek)
  }

  if (startMinutes < endMinutes) {
    // Normal range (e.g., 09:00-18:00): day must match AND time in range
    return rule.scheduleDays.includes(dayOfWeek)
      && currentMinutes >= startMinutes
      && currentMinutes < endMinutes
  }

  // Overnight range (e.g., 18:00-09:00): wraps past midnight
  // Two windows:
  //   Window A: [startMinutes, 24:00) on scheduled days
  //   Window B: [00:00, endMinutes) on the NEXT day
  if (currentMinutes >= startMinutes) {
    // Window A: current day must be in schedule
    return rule.scheduleDays.includes(dayOfWeek)
  }

  if (currentMinutes < endMinutes) {
    // Window B: the PREVIOUS day must be in schedule
    // (because the rule started yesterday and carries into today)
    const prevDayIndex = (VALID_DAYS.indexOf(dayOfWeek) - 1 + 7) % 7
    const prevDay = VALID_DAYS[prevDayIndex]
    return rule.scheduleDays.includes(prevDay)
  }

  return false
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get all rules for a group.
 * Returns from cache if valid, otherwise fetches from database.
 */
export async function getRulesForGroup(groupJid: string): Promise<Result<GroupRule[]>> {
  // Check cache first
  if (isCacheValid(groupJid)) {
    const cached = rulesCache.get(groupJid)
    if (cached) {
      logger.debug('Rules from cache', {
        event: 'rules_cache_hit',
        groupJid,
        count: cached.length,
      })
      return ok(cached)
    }
  }

  const supabase = getSupabase()
  if (!supabase) {
    return ok([]) // No DB = no rules
  }

  try {
    const { data, error } = await supabase
      .from('group_rules')
      .select('*')
      .eq('group_jid', groupJid)
      .order('priority', { ascending: false })

    if (error) {
      logger.error('Failed to load rules', {
        event: 'rules_load_error',
        groupJid,
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Failed to load rules: ${error.message}`)
    }

    const rules = (data || []).map((row) => rowToRule(row as GroupRuleRow))

    // Cache the result
    rulesCache.set(groupJid, rules)
    cacheTimestamps.set(groupJid, Date.now())

    logger.debug('Rules loaded', {
      event: 'rules_loaded',
      groupJid,
      count: rules.length,
    })

    return ok(rules)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Unexpected error loading rules', {
      event: 'rules_load_exception',
      groupJid,
      error: errorMessage,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Get a specific rule by ID.
 */
export async function getRuleById(ruleId: string): Promise<Result<GroupRule>> {
  const supabase = getSupabase()
  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    const { data, error } = await supabase
      .from('group_rules')
      .select('*')
      .eq('id', ruleId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return err('Rule not found')
      return err(`Failed to load rule: ${error.message}`)
    }

    return ok(rowToRule(data as GroupRuleRow))
  } catch (e) {
    return err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Get the currently active rule for a group.
 * Returns the highest-priority rule whose schedule matches the current time.
 *
 * @param groupJid - Group JID
 * @param now - Optional Date for testing
 * @returns The active rule, or null if no rule matches
 */
export async function getActiveRule(
  groupJid: string,
  now?: Date
): Promise<Result<GroupRule | null>> {
  const rulesResult = await getRulesForGroup(groupJid)
  if (!rulesResult.ok) return rulesResult as Result<GroupRule | null>

  const rules = rulesResult.data
  if (rules.length === 0) return ok(null)

  // Find the first matching rule (already sorted by priority DESC)
  for (const rule of rules) {
    if (!rule.isActive) continue

    const { dayOfWeek, hours, minutes } = getTimeInTimezone(rule.scheduleTimezone, now)

    if (isRuleActiveAtTime(rule, dayOfWeek, hours, minutes)) {
      logger.debug('Active rule found', {
        event: 'active_rule_matched',
        groupJid,
        ruleName: rule.name,
        ruleId: rule.id,
        priority: rule.priority,
        pricingSource: rule.pricingSource,
      })
      return ok(rule)
    }
  }

  logger.debug('No active rule at current time', {
    event: 'no_active_rule',
    groupJid,
  })
  return ok(null)
}

/**
 * Create a new rule.
 */
export async function createRule(input: RuleInput): Promise<Result<GroupRule>> {
  const validationError = validateRuleInput(input)
  if (validationError) return err(validationError)

  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  try {
    // Check rule count limit
    const countResult = await getRulesForGroup(input.groupJid)
    if (countResult.ok && countResult.data.length >= MAX_RULES_PER_GROUP) {
      return err(`Maximum ${MAX_RULES_PER_GROUP} rules per group`)
    }

    const row = inputToRow(input)

    // Clear cache before insert
    clearRulesCache(input.groupJid)

    const { data, error } = await supabase
      .from('group_rules')
      .insert(row)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return err(`A rule named "${input.name}" already exists in this group`)
      }
      logger.error('Failed to create rule', {
        event: 'rule_create_error',
        groupJid: input.groupJid,
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Failed to create rule: ${error.message}`)
    }

    const rule = rowToRule(data as GroupRuleRow)

    logger.info('Rule created', {
      event: 'rule_created',
      groupJid: input.groupJid,
      ruleId: rule.id,
      name: rule.name,
      schedule: `${rule.scheduleStartTime}-${rule.scheduleEndTime} on ${rule.scheduleDays.join(',')}`,
      pricingSource: rule.pricingSource,
    })

    return ok(rule)
  } catch (e) {
    return err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Update an existing rule.
 */
export async function updateRule(
  ruleId: string,
  groupJid: string,
  input: RuleUpdateInput
): Promise<Result<GroupRule>> {
  // Validate fields if provided
  if (input.scheduleStartTime !== undefined && !isValidTimeFormat(input.scheduleStartTime)) {
    return err(`Invalid start time: ${input.scheduleStartTime}`)
  }
  if (input.scheduleEndTime !== undefined && !isValidTimeFormat(input.scheduleEndTime)) {
    return err(`Invalid end time: ${input.scheduleEndTime}`)
  }
  if (input.scheduleDays !== undefined) {
    if (input.scheduleDays.length === 0) return err('At least one schedule day is required')
    for (const day of input.scheduleDays) {
      if (!isValidDay(day)) return err(`Invalid day: ${day}`)
    }
  }
  if (input.scheduleTimezone !== undefined && !isValidTimezone(input.scheduleTimezone)) {
    return err(`Invalid timezone: ${input.scheduleTimezone}`)
  }
  if (input.priority !== undefined && (input.priority < 0 || input.priority > MAX_PRIORITY)) {
    return err(`Priority must be between 0 and ${MAX_PRIORITY}`)
  }
  if (input.pricingSource !== undefined && !isValidPricingSource(input.pricingSource)) {
    return err(`Invalid pricing source: ${input.pricingSource}`)
  }
  if (input.spreadMode !== undefined && !isValidSpreadMode(input.spreadMode)) {
    return err(`Invalid spread mode: ${input.spreadMode}`)
  }

  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  try {
    const row = updateToRow(input)
    if (Object.keys(row).length === 0) return err('No fields to update')

    // Clear cache before update
    clearRulesCache(groupJid)

    const { data, error } = await supabase
      .from('group_rules')
      .update(row)
      .eq('id', ruleId)
      .eq('group_jid', groupJid)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') return err('Rule not found')
      if (error.code === '23505') return err(`A rule with that name already exists in this group`)
      logger.error('Failed to update rule', {
        event: 'rule_update_error',
        ruleId,
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Failed to update rule: ${error.message}`)
    }

    const rule = rowToRule(data as GroupRuleRow)

    logger.info('Rule updated', {
      event: 'rule_updated',
      groupJid,
      ruleId: rule.id,
      name: rule.name,
    })

    return ok(rule)
  } catch (e) {
    return err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Delete a rule.
 */
export async function deleteRule(ruleId: string, groupJid: string): Promise<Result<void>> {
  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  try {
    // Clear cache before delete
    clearRulesCache(groupJid)

    const { data, error } = await supabase
      .from('group_rules')
      .delete()
      .eq('id', ruleId)
      .eq('group_jid', groupJid)
      .select('id')

    if (error) {
      logger.error('Failed to delete rule', {
        event: 'rule_delete_error',
        ruleId,
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Failed to delete rule: ${error.message}`)
    }

    if (!data || data.length === 0) {
      return err('Rule not found')
    }

    logger.info('Rule deleted', {
      event: 'rule_deleted',
      groupJid,
      ruleId,
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
export function getRulesCacheStats(): { size: number; entries: string[] } {
  return {
    size: rulesCache.size,
    entries: Array.from(rulesCache.keys()),
  }
}
