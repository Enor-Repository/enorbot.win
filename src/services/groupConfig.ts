/**
 * Group configuration service for per-group learning system.
 * Manages group modes (learning/assisted/active/paused) and per-group settings.
 * All functions return Result<T>, never throw.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'
import type { EnvConfig } from '../types/config.js'

// Types
export type GroupMode = 'learning' | 'assisted' | 'active' | 'paused'
export type PlayerRole = 'operator' | 'client' | 'cio' | 'ignore'

export interface GroupConfig {
  groupJid: string
  groupName: string
  mode: GroupMode
  triggerPatterns: string[]
  responseTemplates: Record<string, string>
  playerRoles: Record<string, PlayerRole>
  aiThreshold: number
  learningStartedAt: Date
  activatedAt: Date | null
  updatedAt: Date
  updatedBy: string | null
}

// Database row type (snake_case)
interface GroupConfigRow {
  group_jid: string
  group_name: string
  mode: GroupMode
  trigger_patterns: string[]
  response_templates: Record<string, string>
  player_roles: Record<string, PlayerRole>
  ai_threshold: number
  learning_started_at: string
  activated_at: string | null
  updated_at: string
  updated_by: string | null
}

// In-memory cache (sync'd from Supabase on startup)
const configCache: Map<string, GroupConfig> = new Map()

// Module-level state
let supabase: SupabaseClient | null = null
let defaultGroupMode: GroupMode = 'learning'

/**
 * Initialize the group config service.
 * Must be called after Supabase is initialized and before any config operations.
 */
const VALID_MODES: GroupMode[] = ['learning', 'assisted', 'active', 'paused']

export async function initGroupConfigs(config: EnvConfig): Promise<Result<void>> {
  supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY)

  // Validate DEFAULT_GROUP_MODE at runtime
  const requestedMode = config.DEFAULT_GROUP_MODE
  if (!VALID_MODES.includes(requestedMode as GroupMode)) {
    logger.warn('Invalid DEFAULT_GROUP_MODE, using learning', {
      event: 'invalid_default_mode',
      requestedMode,
      usingMode: 'learning',
    })
    defaultGroupMode = 'learning'
  } else {
    defaultGroupMode = requestedMode as GroupMode
  }

  // Load all existing group configs from Supabase
  try {
    const { data, error } = await supabase
      .from('group_config')
      .select('*')

    if (error) {
      logger.error('Failed to load group configs from Supabase', {
        event: 'group_config_init_error',
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Failed to load group configs: ${error.message}`)
    }

    // Populate cache
    configCache.clear()
    const rows = data as GroupConfigRow[]
    for (const row of rows) {
      const config = rowToConfig(row)
      configCache.set(config.groupJid, config)
    }

    logger.info('Group configs initialized', {
      event: 'group_config_init',
      groupCount: configCache.size,
      modes: Object.fromEntries(
        ['learning', 'assisted', 'active', 'paused'].map(mode => [
          mode,
          [...configCache.values()].filter(c => c.mode === mode).length,
        ])
      ),
    })

    return ok(undefined)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Unexpected error initializing group configs', {
      event: 'group_config_init_exception',
      error: errorMessage,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Convert database row (snake_case) to GroupConfig (camelCase).
 */
function rowToConfig(row: GroupConfigRow): GroupConfig {
  return {
    groupJid: row.group_jid,
    groupName: row.group_name,
    mode: row.mode,
    triggerPatterns: row.trigger_patterns || [],
    responseTemplates: row.response_templates || {},
    playerRoles: row.player_roles || {},
    aiThreshold: row.ai_threshold,
    learningStartedAt: new Date(row.learning_started_at),
    activatedAt: row.activated_at ? new Date(row.activated_at) : null,
    updatedAt: new Date(row.updated_at),
    updatedBy: row.updated_by,
  }
}

/**
 * Create a default config for a new group.
 */
function createDefaultConfig(groupJid: string, groupName: string): GroupConfig {
  const now = new Date()
  return {
    groupJid,
    groupName,
    mode: defaultGroupMode,
    triggerPatterns: [],
    responseTemplates: {},
    playerRoles: {},
    aiThreshold: 50,
    learningStartedAt: now,
    activatedAt: null,
    updatedAt: now,
    updatedBy: null,
  }
}

/**
 * Get group config from cache.
 * Returns default config for unknown groups.
 * Note: This is sync since it only reads from memory cache.
 */
export function getGroupConfig(groupJid: string): GroupConfig {
  const cached = configCache.get(groupJid)
  if (cached) {
    return cloneConfig(cached) // Return copy to prevent external mutation
  }

  // Unknown group - return default config (will be registered on first message)
  return createDefaultConfig(groupJid, 'Unknown Group')
}

/**
 * Get group config from cache (sync version for hot path).
 * Returns null if group is not in cache.
 */
export function getGroupConfigSync(groupJid: string): GroupConfig | null {
  return configCache.get(groupJid) || null
}

/**
 * Get group mode from cache (sync version for router hot path).
 * Returns default mode for unknown groups.
 */
export function getGroupModeSync(groupJid: string): GroupMode {
  const cached = configCache.get(groupJid)
  return cached?.mode ?? defaultGroupMode
}

/**
 * Deep clone a GroupConfig to prevent external mutation.
 */
function cloneConfig(config: GroupConfig): GroupConfig {
  return {
    ...config,
    triggerPatterns: [...config.triggerPatterns],
    responseTemplates: { ...config.responseTemplates },
    playerRoles: { ...config.playerRoles },
    learningStartedAt: new Date(config.learningStartedAt.getTime()),
    activatedAt: config.activatedAt ? new Date(config.activatedAt.getTime()) : null,
    updatedAt: new Date(config.updatedAt.getTime()),
  }
}

/**
 * Resolve the operator JID for a group — the sole source of truth for operator tagging.
 * Checks player_roles in the in-memory config cache for a player with 'operator' role.
 * Set via the `role <group> <phone> operator` command.
 * Returns null if no operator is assigned (no @mention will be sent).
 */
export function resolveOperatorJid(groupJid: string): string | null {
  const config = configCache.get(groupJid)
  if (config?.playerRoles) {
    const entry = Object.entries(config.playerRoles)
      .find(([, role]) => role === 'operator')
    if (entry) return entry[0]
  }
  return null
}

/**
 * Check if a player is marked as ignored in a group.
 * Used to silently skip messages from other bots or specific JIDs.
 */
export function isIgnoredPlayer(groupJid: string, playerJid: string): boolean {
  const config = configCache.get(groupJid)
  return config?.playerRoles?.[playerJid] === 'ignore'
}

/**
 * Get all group configs from cache.
 * Returns deep copies to prevent external mutation.
 */
export async function getAllGroupConfigs(): Promise<Map<string, GroupConfig>> {
  const result = new Map<string, GroupConfig>()
  for (const [key, config] of configCache) {
    result.set(key, cloneConfig(config))
  }
  return result
}

/**
 * Set group mode with audit trail.
 * Persists to Supabase and updates cache.
 */
export async function setGroupMode(
  groupJid: string,
  mode: GroupMode,
  updatedBy: string
): Promise<Result<void>> {
  if (!supabase) {
    return err('Group config service not initialized')
  }

  // Validate mode at runtime
  if (!VALID_MODES.includes(mode)) {
    return err(`Invalid mode: ${mode}. Valid modes: ${VALID_MODES.join(', ')}`)
  }

  // Check if group exists in cache first to avoid orphan database updates
  const existing = configCache.get(groupJid)
  if (!existing) {
    logger.warn('Attempting to set mode for unregistered group', {
      event: 'group_mode_set_unregistered',
      groupJid,
      mode,
    })
    return err(`Group not found in cache: ${groupJid}. Register the group first.`)
  }

  try {
    const now = new Date().toISOString()
    const activatedAt = mode === 'active' ? now : null

    const { error } = await supabase
      .from('group_config')
      .update({
        mode,
        activated_at: activatedAt,
        updated_by: updatedBy,
      })
      .eq('group_jid', groupJid)

    if (error) {
      logger.error('Failed to set group mode', {
        event: 'group_mode_set_error',
        groupJid,
        mode,
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Failed to set mode: ${error.message}`)
    }

    // Update cache (we already verified it exists)
    existing.mode = mode
    existing.activatedAt = mode === 'active' ? new Date(now) : existing.activatedAt
    existing.updatedAt = new Date(now)
    existing.updatedBy = updatedBy

    logger.info('Group mode updated', {
      event: 'group_mode_set',
      groupJid,
      mode,
      updatedBy,
    })

    return ok(undefined)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Unexpected error setting group mode', {
      event: 'group_mode_set_exception',
      groupJid,
      mode,
      error: errorMessage,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Ensure a group is registered in the config table.
 * Called when messages are received from groups.
 * Creates new groups with default learning mode.
 *
 * @param groupJid - The group's WhatsApp JID
 * @param groupName - The group's display name
 * @param updatedBy - Optional sender JID for audit trail
 */
export async function ensureGroupRegistered(
  groupJid: string,
  groupName: string,
  updatedBy?: string
): Promise<Result<void>> {
  // Skip if already in cache
  if (configCache.has(groupJid)) {
    // Update group name if changed
    const existing = configCache.get(groupJid)!
    if (existing.groupName !== groupName) {
      existing.groupName = groupName
      // Fire-and-forget update to Supabase (error is logged inside updateGroupName)
      updateGroupName(groupJid, groupName).catch((e) => {
        logger.warn('Group name update promise rejected', {
          event: 'group_name_update_rejected',
          groupJid,
          groupName,
          error: e instanceof Error ? e.message : String(e),
        })
      })
    }
    return ok(undefined)
  }

  if (!supabase) {
    return err('Group config service not initialized')
  }

  try {
    const now = new Date().toISOString()
    const newConfig = {
      group_jid: groupJid,
      group_name: groupName,
      mode: defaultGroupMode,
      trigger_patterns: [],
      response_templates: {},
      player_roles: {},
      ai_threshold: 50,
      learning_started_at: now,
      activated_at: null,
      updated_at: now,
      updated_by: updatedBy ?? null,
    }

    const { error } = await supabase
      .from('group_config')
      .upsert(newConfig, { onConflict: 'group_jid' })

    if (error) {
      logger.error('Failed to register group', {
        event: 'group_register_error',
        groupJid,
        groupName,
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Failed to register group: ${error.message}`)
    }

    // Add to cache
    const cachedConfig = createDefaultConfig(groupJid, groupName)
    cachedConfig.updatedBy = updatedBy ?? null
    configCache.set(groupJid, cachedConfig)

    logger.info('Group registered', {
      event: 'group_registered',
      groupJid,
      groupName,
      mode: defaultGroupMode,
    })

    return ok(undefined)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Unexpected error registering group', {
      event: 'group_register_exception',
      groupJid,
      groupName,
      error: errorMessage,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Update group name in Supabase (fire-and-forget).
 */
async function updateGroupName(groupJid: string, groupName: string): Promise<void> {
  if (!supabase) return

  const { error } = await supabase
    .from('group_config')
    .update({ group_name: groupName })
    .eq('group_jid', groupJid)

  if (error) {
    logger.warn('Failed to update group name', {
      event: 'group_name_update_failed',
      groupJid,
      groupName,
      error: error.message,
    })
  }
}

// Trigger pattern validation constants
const MAX_TRIGGER_PATTERN_LENGTH = 100
const MAX_TRIGGER_PATTERNS_PER_GROUP = 50

/**
 * Validate and sanitize a trigger pattern.
 */
function sanitizeTriggerPattern(pattern: string): Result<string> {
  const trimmed = pattern.trim()

  if (!trimmed) {
    return err('Trigger pattern cannot be empty')
  }

  if (trimmed.length > MAX_TRIGGER_PATTERN_LENGTH) {
    return err(`Trigger pattern too long (max ${MAX_TRIGGER_PATTERN_LENGTH} chars)`)
  }

  // Remove potentially dangerous characters for JSONB storage
  // Allow alphanumeric, spaces, common punctuation, accented chars
  const sanitized = trimmed.replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters

  if (sanitized !== trimmed) {
    return err('Trigger pattern contains invalid characters')
  }

  return ok(sanitized)
}

/**
 * Add a custom trigger pattern to a group.
 */
export async function addTriggerPattern(
  groupJid: string,
  pattern: string,
  updatedBy: string
): Promise<Result<void>> {
  if (!supabase) {
    return err('Group config service not initialized')
  }

  const existing = configCache.get(groupJid)
  if (!existing) {
    return err(`Group not found: ${groupJid}`)
  }

  // Validate and sanitize pattern
  const sanitizeResult = sanitizeTriggerPattern(pattern)
  if (!sanitizeResult.ok) {
    return sanitizeResult
  }
  const sanitizedPattern = sanitizeResult.data

  // Check max patterns limit
  if (existing.triggerPatterns.length >= MAX_TRIGGER_PATTERNS_PER_GROUP) {
    return err(`Maximum trigger patterns reached (${MAX_TRIGGER_PATTERNS_PER_GROUP})`)
  }

  // Check for duplicate
  const normalizedPattern = sanitizedPattern.toLowerCase()
  if (existing.triggerPatterns.some(p => p.toLowerCase() === normalizedPattern)) {
    return err(`Trigger pattern already exists: ${sanitizedPattern}`)
  }

  const newPatterns = [...existing.triggerPatterns, sanitizedPattern]

  try {
    const { error } = await supabase
      .from('group_config')
      .update({
        trigger_patterns: newPatterns,
        updated_by: updatedBy,
      })
      .eq('group_jid', groupJid)

    if (error) {
      return err(`Failed to add trigger: ${error.message}`)
    }

    // Update cache
    existing.triggerPatterns = newPatterns
    existing.updatedBy = updatedBy
    existing.updatedAt = new Date()

    logger.info('Trigger pattern added', {
      event: 'trigger_pattern_added',
      groupJid,
      pattern,
      updatedBy,
    })

    return ok(undefined)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Remove a custom trigger pattern from a group.
 */
export async function removeTriggerPattern(
  groupJid: string,
  pattern: string,
  updatedBy: string
): Promise<Result<void>> {
  if (!supabase) {
    return err('Group config service not initialized')
  }

  const existing = configCache.get(groupJid)
  if (!existing) {
    return err(`Group not found: ${groupJid}`)
  }

  const normalizedPattern = pattern.toLowerCase().trim()
  const newPatterns = existing.triggerPatterns.filter(
    p => p.toLowerCase() !== normalizedPattern
  )

  if (newPatterns.length === existing.triggerPatterns.length) {
    return err(`Trigger pattern not found: ${pattern}`)
  }

  try {
    const { error } = await supabase
      .from('group_config')
      .update({
        trigger_patterns: newPatterns,
        updated_by: updatedBy,
      })
      .eq('group_jid', groupJid)

    if (error) {
      return err(`Failed to remove trigger: ${error.message}`)
    }

    // Update cache
    existing.triggerPatterns = newPatterns
    existing.updatedBy = updatedBy
    existing.updatedAt = new Date()

    logger.info('Trigger pattern removed', {
      event: 'trigger_pattern_removed',
      groupJid,
      pattern,
      updatedBy,
    })

    return ok(undefined)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Set a player's role in a group.
 */
export async function setPlayerRole(
  groupJid: string,
  playerJid: string,
  role: PlayerRole,
  updatedBy: string
): Promise<Result<void>> {
  if (!supabase) {
    return err('Group config service not initialized')
  }

  const existing = configCache.get(groupJid)
  if (!existing) {
    return err(`Group not found: ${groupJid}`)
  }

  const newRoles = { ...existing.playerRoles, [playerJid]: role }

  try {
    const { error } = await supabase
      .from('group_config')
      .update({
        player_roles: newRoles,
        updated_by: updatedBy,
      })
      .eq('group_jid', groupJid)

    if (error) {
      return err(`Failed to set player role: ${error.message}`)
    }

    // Update cache
    existing.playerRoles = newRoles
    existing.updatedBy = updatedBy
    existing.updatedAt = new Date()

    logger.info('Player role set', {
      event: 'player_role_set',
      groupJid,
      playerJid,
      role,
      updatedBy,
    })

    return ok(undefined)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Remove a player's role from a group.
 */
export async function removePlayerRole(
  groupJid: string,
  playerJid: string,
  updatedBy: string
): Promise<Result<void>> {
  if (!supabase) {
    return err('Group config service not initialized')
  }

  const existing = configCache.get(groupJid)
  if (!existing) {
    return err(`Group not found: ${groupJid}`)
  }

  const newRoles = { ...existing.playerRoles }
  delete newRoles[playerJid]

  try {
    const { error } = await supabase
      .from('group_config')
      .update({
        player_roles: newRoles,
        updated_by: updatedBy,
      })
      .eq('group_jid', groupJid)

    if (error) {
      return err(`Failed to remove player role: ${error.message}`)
    }

    existing.playerRoles = newRoles
    existing.updatedBy = updatedBy
    existing.updatedAt = new Date()

    logger.info('Player role removed', {
      event: 'player_role_removed',
      groupJid,
      playerJid,
      updatedBy,
    })

    return ok(undefined)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Set AI threshold for a group.
 */
export async function setAiThreshold(
  groupJid: string,
  threshold: number,
  updatedBy: string
): Promise<Result<void>> {
  if (!supabase) {
    return err('Group config service not initialized')
  }

  if (threshold < 0 || threshold > 100) {
    return err('AI threshold must be between 0 and 100')
  }

  const existing = configCache.get(groupJid)
  if (!existing) {
    return err(`Group not found: ${groupJid}`)
  }

  try {
    const { error } = await supabase
      .from('group_config')
      .update({
        ai_threshold: threshold,
        updated_by: updatedBy,
      })
      .eq('group_jid', groupJid)

    if (error) {
      return err(`Failed to set AI threshold: ${error.message}`)
    }

    // Update cache
    existing.aiThreshold = threshold
    existing.updatedBy = updatedBy
    existing.updatedAt = new Date()

    logger.info('AI threshold set', {
      event: 'ai_threshold_set',
      groupJid,
      threshold,
      updatedBy,
    })

    return ok(undefined)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Set a response template for a trigger.
 */
export async function setResponseTemplate(
  groupJid: string,
  trigger: string,
  template: string,
  updatedBy: string
): Promise<Result<void>> {
  if (!supabase) {
    return err('Group config service not initialized')
  }

  const existing = configCache.get(groupJid)
  if (!existing) {
    return err(`Group not found: ${groupJid}`)
  }

  const newTemplates = { ...existing.responseTemplates, [trigger]: template }

  try {
    const { error } = await supabase
      .from('group_config')
      .update({
        response_templates: newTemplates,
        updated_by: updatedBy,
      })
      .eq('group_jid', groupJid)

    if (error) {
      return err(`Failed to set response template: ${error.message}`)
    }

    // Update cache
    existing.responseTemplates = newTemplates
    existing.updatedBy = updatedBy
    existing.updatedAt = new Date()

    logger.info('Response template set', {
      event: 'response_template_set',
      groupJid,
      trigger,
      updatedBy,
    })

    return ok(undefined)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Get count of groups by mode (for status display).
 */
export function getGroupModeStats(): Record<GroupMode, number> {
  const stats: Record<GroupMode, number> = {
    learning: 0,
    assisted: 0,
    active: 0,
    paused: 0,
  }

  for (const config of configCache.values()) {
    stats[config.mode]++
  }

  return stats
}

/**
 * Find a group by partial name match (for fuzzy command matching).
 * Returns the best match or null if no match.
 */
export function findGroupByName(searchTerm: string): GroupConfig | null {
  const normalizedSearch = searchTerm.toLowerCase().trim()

  // Exact match first
  for (const config of configCache.values()) {
    if (config.groupName.toLowerCase() === normalizedSearch) {
      return config
    }
  }

  // Partial match
  for (const config of configCache.values()) {
    if (config.groupName.toLowerCase().includes(normalizedSearch)) {
      return config
    }
  }

  return null
}

/**
 * Get all groups with a specific mode.
 */
export function getGroupsByMode(mode: GroupMode): GroupConfig[] {
  return [...configCache.values()].filter(c => c.mode === mode)
}

/**
 * Reset the config cache (for testing).
 */
export function resetGroupConfigCache(): void {
  configCache.clear()
}

/**
 * Set a config directly in cache (for testing).
 */
export function setGroupConfigForTesting(config: GroupConfig): void {
  configCache.set(config.groupJid, config)
}
