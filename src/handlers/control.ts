/**
 * Control Handler - Epic 4: CIO Control Interface + Group Modes
 *
 * Handles control group messages including:
 * - Story 4.1: Pause command (pause [group name])
 * - Story 4.2: Resume command (resume [group name])
 * - Story 4.3: Status command
 * - Group Modes: mode, modes, config commands
 *
 * Control group is identified by CONTROL_GROUP_PATTERN in config.
 */

import { logger } from '../utils/logger.js'
import { ok, type Result } from '../utils/result.js'
import type { RouterContext } from '../bot/router.js'
import { sendWithAntiDetection } from '../utils/messaging.js'
// Story 7.4: Bot message logging to Supabase
import { logBotMessage } from '../services/messageHistory.js'
import {
  getOperationalStatus,
  setRunning,
  getConnectionStatus,
  getPauseInfo,
  getActivityStats,
} from '../bot/state.js'
import {
  cancelAutoRecovery,
  isRecoveryPending,
  getRecoveryTimeRemaining,
  getPendingRecoveryReason,
} from '../services/autoRecovery.js'
import { getQueueLength } from '../services/logQueue.js'
import { formatDuration, formatRelativeTime } from '../utils/format.js'
import {
  type GroupMode,
  type PlayerRole,
  setGroupMode,
  getAllGroupConfigs,
  getGroupModeStats,
  findGroupByName,
  getGroupsByMode,
  addTriggerPattern,
  removeTriggerPattern,
  setPlayerRole,
  type GroupConfig,
} from '../services/groupConfig.js'
import { getClassificationMetrics } from '../services/classificationEngine.js'

// =============================================================================
// Known Groups Cache (deprecated - use groupConfig service)
// =============================================================================

/**
 * Cache of known groups: groupId -> groupName.
 * @deprecated Use groupConfig service instead.
 */
const knownGroups: Map<string, string> = new Map()

/**
 * Register a known group for fuzzy matching.
 * @deprecated Groups are now auto-registered in groupConfig service.
 */
export function registerKnownGroup(groupId: string, groupName: string): void {
  knownGroups.set(groupId, groupName)
}

/**
 * Get all known groups.
 * @deprecated Use getAllGroupConfigs() instead.
 */
export function getKnownGroups(): Map<string, string> {
  return new Map(knownGroups)
}

/**
 * Clear known groups cache.
 * Primarily used for testing.
 */
export function clearKnownGroups(): void {
  knownGroups.clear()
}

// =============================================================================
// Command Parsing
// =============================================================================

/**
 * Control command types.
 * Extended with new mode management commands.
 */
export type ControlCommandType =
  | 'pause'
  | 'resume'
  | 'status'
  | 'training'
  | 'mode'      // mode <group> learning|assisted|active|paused
  | 'modes'     // List all groups with modes
  | 'config'    // config <group> - show group config
  | 'trigger'   // trigger add|remove <group> <pattern>
  | 'role'      // role <group> <player> operator|client|cio
  | 'unknown'

/**
 * Parsed control command.
 */
export interface ControlCommand {
  type: ControlCommandType
  args: string[]
}

/**
 * Parse a control message into a command.
 *
 * @param message - The raw message text
 * @returns Parsed control command
 */
export function parseControlCommand(message: string): ControlCommand {
  const lower = message.toLowerCase().trim()

  // Mode command: "mode <group> <mode>"
  if (lower.startsWith('mode ')) {
    const rest = message.replace(/^mode\s+/i, '').trim()
    const parts = parseQuotedArgs(rest)
    return { type: 'mode', args: parts }
  }

  // Modes command: list all groups with modes
  if (lower === 'modes') {
    return { type: 'modes', args: [] }
  }

  // Config command: "config <group>"
  if (lower.startsWith('config ')) {
    const groupSearch = message.replace(/^config\s+/i, '').trim()
    return { type: 'config', args: [groupSearch] }
  }

  // Trigger command: "trigger add|remove <group> <pattern>"
  if (lower.startsWith('trigger ')) {
    const rest = message.replace(/^trigger\s+/i, '').trim()
    const parts = parseQuotedArgs(rest)
    return { type: 'trigger', args: parts }
  }

  // Role command: "role <group> <player> operator|client|cio"
  if (lower.startsWith('role ')) {
    const rest = message.replace(/^role\s+/i, '').trim()
    const parts = parseQuotedArgs(rest)
    return { type: 'role', args: parts }
  }

  // Pause command: "pause" or "pause [group name]"
  if (lower === 'pause' || lower.startsWith('pause ')) {
    const args = lower.replace(/^pause\s*/, '').trim()
    return { type: 'pause', args: args ? [args] : [] }
  }

  // Resume command: "resume" or "resume [group name]"
  if (lower === 'resume' || lower.startsWith('resume ')) {
    const args = lower.replace(/^resume\s*/, '').trim()
    return { type: 'resume', args: args ? [args] : [] }
  }

  // Status command
  if (lower === 'status') {
    return { type: 'status', args: [] }
  }

  // Training command: "training on" or "training off"
  if (lower === 'training on') {
    return { type: 'training', args: ['on'] }
  }
  if (lower === 'training off') {
    return { type: 'training', args: ['off'] }
  }

  return { type: 'unknown', args: [] }
}

/**
 * Parse arguments that may contain quoted strings.
 * Example: 'OTC Brasil active' -> ['OTC Brasil', 'active']
 * Example: '"OTC Brasil" active' -> ['OTC Brasil', 'active']
 */
function parseQuotedArgs(input: string): string[] {
  const args: string[] = []
  let current = ''
  let inQuote = false
  let quoteChar = ''

  for (const char of input) {
    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true
      quoteChar = char
    } else if (char === quoteChar && inQuote) {
      inQuote = false
      quoteChar = ''
      if (current) {
        args.push(current)
        current = ''
      }
    } else if (char === ' ' && !inQuote) {
      if (current) {
        args.push(current)
        current = ''
      }
    } else {
      current += char
    }
  }

  if (current) {
    args.push(current)
  }

  return args
}

// =============================================================================
// Fuzzy Group Matching (uses groupConfig service)
// =============================================================================

/**
 * Result of fuzzy group matching.
 */
export interface GroupMatchResult {
  found: boolean
  groupId: string | null
  groupName: string | null
}

/**
 * Find a group by fuzzy matching on its name.
 * Now uses the groupConfig service.
 *
 * @param searchTerm - The search term to match (must be non-empty)
 * @returns Match result with groupId and groupName if found
 */
export function findMatchingGroup(searchTerm: string): GroupMatchResult {
  if (!searchTerm || !searchTerm.trim()) {
    return { found: false, groupId: null, groupName: null }
  }

  const config = findGroupByName(searchTerm)
  if (config) {
    return { found: true, groupId: config.groupJid, groupName: config.groupName }
  }

  return { found: false, groupId: null, groupName: null }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Send a control response message and log it to history.
 */
async function sendControlResponse(
  context: RouterContext,
  message: string
): Promise<void> {
  const result = await sendWithAntiDetection(context.sock, context.groupId, message)

  if (result.ok) {
    logBotMessage({
      groupJid: context.groupId,
      content: message,
      messageType: 'status',
      isControlGroup: true,
    })
  }
}

/**
 * Get emoji for group mode.
 */
function getModeEmoji(mode: GroupMode): string {
  switch (mode) {
    case 'learning':
      return '🔵'
    case 'assisted':
      return '🟡'
    case 'active':
      return '🟢'
    case 'paused':
      return '⏸️'
  }
}

/**
 * Calculate learning duration in days.
 */
function getLearningDays(config: GroupConfig): number {
  const now = Date.now()
  const started = config.learningStartedAt.getTime()
  return Math.floor((now - started) / (1000 * 60 * 60 * 24))
}

// =============================================================================
// Command Handlers
// =============================================================================

/**
 * Handle mode command.
 * Sets mode for a specific group.
 *
 * @param context - Router context
 * @param args - [group search term, mode]
 */
async function handleModeCommand(context: RouterContext, args: string[]): Promise<void> {
  if (args.length < 2) {
    await sendControlResponse(
      context,
      '⚠️ Usage: mode <group> <learning|assisted|active|paused>'
    )
    return
  }

  // Last arg is the mode, everything else is the group search
  const modeArg = args[args.length - 1].toLowerCase()
  const groupSearch = args.slice(0, -1).join(' ')

  // Validate mode
  const validModes: GroupMode[] = ['learning', 'assisted', 'active', 'paused']
  if (!validModes.includes(modeArg as GroupMode)) {
    await sendControlResponse(
      context,
      `⚠️ Invalid mode "${modeArg}". Valid modes: learning, assisted, active, paused`
    )
    return
  }

  // Find group
  const match = findMatchingGroup(groupSearch)
  if (!match.found || !match.groupId) {
    await sendControlResponse(context, `⚠️ No group matching "${groupSearch}" found`)
    return
  }

  // Set the mode
  const result = await setGroupMode(match.groupId, modeArg as GroupMode, context.sender)

  if (!result.ok) {
    await sendControlResponse(context, `❌ Failed to set mode: ${result.error}`)
    return
  }

  const emoji = getModeEmoji(modeArg as GroupMode)
  await sendControlResponse(
    context,
    `${emoji} ${match.groupName} set to ${modeArg.toUpperCase()} mode`
  )

  logger.info('Group mode changed via command', {
    event: 'group_mode_command',
    groupId: match.groupId,
    groupName: match.groupName,
    mode: modeArg,
    triggeredBy: context.sender,
  })
}

/**
 * Handle modes command.
 * Lists all groups with their current modes.
 */
async function handleModesCommand(context: RouterContext): Promise<void> {
  const configs = await getAllGroupConfigs()
  const stats = getGroupModeStats()

  if (configs.size === 0) {
    await sendControlResponse(context, '📋 No groups registered yet')
    return
  }

  const lines: string[] = [
    '📋 Group Modes',
    '',
    `Total: ${configs.size} groups`,
    `• 🔵 Learning: ${stats.learning}`,
    `• 🟡 Assisted: ${stats.assisted}`,
    `• 🟢 Active: ${stats.active}`,
    `• ⏸️ Paused: ${stats.paused}`,
    '',
  ]

  // List groups by mode
  for (const mode of ['learning', 'assisted', 'active', 'paused'] as GroupMode[]) {
    const groups = getGroupsByMode(mode)
    if (groups.length > 0) {
      const emoji = getModeEmoji(mode)
      lines.push(`${emoji} ${mode.toUpperCase()}:`)
      for (const config of groups) {
        const days = getLearningDays(config)
        const daysStr = mode === 'learning' ? ` (${days}d)` : ''
        lines.push(`  • ${config.groupName}${daysStr}`)
      }
      lines.push('')
    }
  }

  await sendControlResponse(context, lines.join('\n').trim())

  logger.info('Modes command processed', {
    event: 'modes_command_processed',
    groupCount: configs.size,
    triggeredBy: context.sender,
  })
}

/**
 * Handle config command.
 * Shows detailed configuration for a specific group.
 */
async function handleConfigCommand(context: RouterContext, args: string[]): Promise<void> {
  if (args.length === 0) {
    await sendControlResponse(context, '⚠️ Usage: config <group>')
    return
  }

  const groupSearch = args.join(' ')
  const config = findGroupByName(groupSearch)

  if (!config) {
    await sendControlResponse(context, `⚠️ No group matching "${groupSearch}" found`)
    return
  }

  const emoji = getModeEmoji(config.mode)
  const days = getLearningDays(config)
  const triggers = config.triggerPatterns.length > 0
    ? config.triggerPatterns.map(t => `"${t}"`).join(', ')
    : 'None'
  const roles = Object.entries(config.playerRoles)
    .map(([jid, role]) => `${jid.split('@')[0]}: ${role}`)
    .join('\n    ')

  const lines = [
    `📊 Config: ${config.groupName}`,
    '',
    `Mode: ${emoji} ${config.mode.toUpperCase()}`,
    `Learning: ${days} days`,
    `AI Threshold: ${config.aiThreshold}%`,
    '',
    `Triggers: ${triggers}`,
  ]

  if (Object.keys(config.playerRoles).length > 0) {
    lines.push('')
    lines.push('Player Roles:')
    lines.push(`    ${roles}`)
  }

  if (config.updatedBy) {
    lines.push('')
    lines.push(`Last updated by: ${config.updatedBy.split('@')[0]}`)
    lines.push(`Updated: ${formatRelativeTime(config.updatedAt)}`)
  }

  await sendControlResponse(context, lines.join('\n'))

  logger.info('Config command processed', {
    event: 'config_command_processed',
    groupJid: config.groupJid,
    groupName: config.groupName,
    triggeredBy: context.sender,
  })
}

/**
 * Handle trigger command.
 * Adds or removes custom trigger patterns for a group.
 *
 * @param context - Router context
 * @param args - [add|remove, group, pattern]
 */
async function handleTriggerCommand(context: RouterContext, args: string[]): Promise<void> {
  if (args.length < 3) {
    await sendControlResponse(
      context,
      '⚠️ Usage: trigger add|remove <group> <pattern>\nExample: trigger add OTC "compro usdt"'
    )
    return
  }

  const action = args[0].toLowerCase()
  if (action !== 'add' && action !== 'remove') {
    await sendControlResponse(
      context,
      '⚠️ Invalid action. Use "trigger add" or "trigger remove"'
    )
    return
  }

  // Pattern is the last argument, group search is everything in between
  const pattern = args[args.length - 1]
  const groupSearch = args.slice(1, -1).join(' ')

  // Find group
  const match = findMatchingGroup(groupSearch)
  if (!match.found || !match.groupId) {
    await sendControlResponse(context, `⚠️ No group matching "${groupSearch}" found`)
    return
  }

  if (action === 'add') {
    const result = await addTriggerPattern(match.groupId, pattern, context.sender)

    if (!result.ok) {
      await sendControlResponse(context, `❌ Failed to add trigger: ${result.error}`)
      return
    }

    await sendControlResponse(
      context,
      `✅ Added trigger "${pattern}" to ${match.groupName}`
    )

    logger.info('Trigger pattern added via command', {
      event: 'trigger_added_command',
      groupId: match.groupId,
      groupName: match.groupName,
      pattern,
      triggeredBy: context.sender,
    })
  } else {
    const result = await removeTriggerPattern(match.groupId, pattern, context.sender)

    if (!result.ok) {
      await sendControlResponse(context, `❌ Failed to remove trigger: ${result.error}`)
      return
    }

    await sendControlResponse(
      context,
      `✅ Removed trigger "${pattern}" from ${match.groupName}`
    )

    logger.info('Trigger pattern removed via command', {
      event: 'trigger_removed_command',
      groupId: match.groupId,
      groupName: match.groupName,
      pattern,
      triggeredBy: context.sender,
    })
  }
}

/**
 * Handle role command.
 * Assigns player roles within a group.
 *
 * @param context - Router context
 * @param args - [group, player, role]
 */
async function handleRoleCommand(context: RouterContext, args: string[]): Promise<void> {
  if (args.length < 3) {
    await sendControlResponse(
      context,
      '⚠️ Usage: role <group> <player_phone> <operator|client|cio>\nExample: role OTC 5511999999999 operator'
    )
    return
  }

  // Role is the last argument, player is second to last
  const role = args[args.length - 1].toLowerCase()
  const playerPhone = args[args.length - 2]
  const groupSearch = args.slice(0, -2).join(' ')

  // Validate role
  const validRoles: PlayerRole[] = ['operator', 'client', 'cio']
  if (!validRoles.includes(role as PlayerRole)) {
    await sendControlResponse(
      context,
      `⚠️ Invalid role "${role}". Valid roles: operator, client, cio`
    )
    return
  }

  // Find group
  const match = findMatchingGroup(groupSearch)
  if (!match.found || !match.groupId) {
    await sendControlResponse(context, `⚠️ No group matching "${groupSearch}" found`)
    return
  }

  // Normalize player JID
  const playerJid = playerPhone.includes('@')
    ? playerPhone
    : `${playerPhone.replace(/\D/g, '')}@s.whatsapp.net`

  const result = await setPlayerRole(match.groupId, playerJid, role as PlayerRole, context.sender)

  if (!result.ok) {
    await sendControlResponse(context, `❌ Failed to set role: ${result.error}`)
    return
  }

  const displayPhone = playerJid.split('@')[0]
  await sendControlResponse(
    context,
    `✅ Set ${displayPhone} as ${role.toUpperCase()} in ${match.groupName}`
  )

  logger.info('Player role set via command', {
    event: 'role_set_command',
    groupId: match.groupId,
    groupName: match.groupName,
    playerJid,
    role,
    triggeredBy: context.sender,
  })
}

/**
 * Handle pause command.
 * Maps to mode <group> paused for backward compatibility.
 *
 * @param context - Router context
 * @param args - Command arguments (optional group name)
 */
async function handlePauseCommand(context: RouterContext, args: string[]): Promise<void> {
  const groupName = args[0]

  // Log deprecation notice
  logger.info('Legacy pause command used', {
    event: 'legacy_pause_command',
    triggeredBy: context.sender,
  })

  if (!groupName) {
    // Global pause - set all groups to paused
    const configs = await getAllGroupConfigs()
    let count = 0

    for (const config of configs.values()) {
      if (config.mode !== 'paused') {
        await setGroupMode(config.groupJid, 'paused', context.sender)
        count++
      }
    }

    logger.info('All groups paused', {
      event: 'global_pause',
      groupCount: count,
      triggeredBy: context.sender,
    })

    await sendControlResponse(context, `⏸️ All groups paused (${count} groups)`)
    return
  }

  // Specific group pause
  const match = findMatchingGroup(groupName)

  if (!match.found || !match.groupId) {
    await sendControlResponse(context, `⚠️ No group matching "${groupName}" found`)
    return
  }

  const result = await setGroupMode(match.groupId, 'paused', context.sender)

  if (!result.ok) {
    await sendControlResponse(context, `❌ Failed to pause: ${result.error}`)
    return
  }

  logger.info('Group paused', {
    event: 'group_paused',
    groupId: match.groupId,
    groupName: match.groupName,
    triggeredBy: context.sender,
  })

  await sendControlResponse(context, `⏸️ Paused: ${match.groupName}`)
}

/**
 * Handle resume command.
 * Maps to mode <group> active for backward compatibility.
 *
 * @param context - Router context
 * @param args - Command arguments (optional group name)
 */
async function handleResumeCommand(context: RouterContext, args: string[]): Promise<void> {
  const groupName = args[0]

  // CRITICAL: Cancel any pending auto-recovery on resume
  cancelAutoRecovery()

  // Log deprecation notice
  logger.info('Legacy resume command used', {
    event: 'legacy_resume_command',
    triggeredBy: context.sender,
  })

  // Check if error state was active
  const hadErrorState = getOperationalStatus() === 'paused'
  if (hadErrorState) {
    setRunning()
  }

  if (!groupName) {
    // Global resume - set all groups to active
    const configs = await getAllGroupConfigs()
    let count = 0

    for (const config of configs.values()) {
      if (config.mode === 'paused') {
        await setGroupMode(config.groupJid, 'active', context.sender)
        count++
      }
    }

    logger.info('All groups resumed', {
      event: 'global_resume',
      groupCount: count,
      errorStateCleared: hadErrorState,
      triggeredBy: context.sender,
    })

    const msg = hadErrorState
      ? `▶️ Resumed (${count} groups). Error state cleared.`
      : `▶️ All groups resumed (${count} groups)`

    await sendControlResponse(context, msg)
    return
  }

  // Specific group resume
  const match = findMatchingGroup(groupName)

  if (!match.found || !match.groupId) {
    await sendControlResponse(context, `⚠️ No group matching "${groupName}" found`)
    return
  }

  const result = await setGroupMode(match.groupId, 'active', context.sender)

  if (!result.ok) {
    await sendControlResponse(context, `❌ Failed to resume: ${result.error}`)
    return
  }

  logger.info('Group resumed', {
    event: 'group_resumed',
    groupId: match.groupId,
    groupName: match.groupName,
    triggeredBy: context.sender,
  })

  await sendControlResponse(context, `▶️ Resumed: ${match.groupName}`)
}

/**
 * Handle training command.
 * Maps to setting all groups to learning/active for backward compatibility.
 *
 * @param context - Router context
 * @param args - Command arguments ('on' or 'off')
 */
async function handleTrainingCommand(context: RouterContext, args: string[]): Promise<void> {
  const action = args[0]

  if (action !== 'on' && action !== 'off') {
    await sendControlResponse(context, '⚠️ Invalid training command. Use "training on" or "training off"')
    return
  }

  // Log deprecation notice
  logger.info('Legacy training command used', {
    event: 'legacy_training_command',
    action,
    triggeredBy: context.sender,
  })

  const configs = await getAllGroupConfigs()
  const targetMode: GroupMode = action === 'on' ? 'learning' : 'active'
  let count = 0

  for (const config of configs.values()) {
    if (config.mode !== targetMode && config.mode !== 'paused') {
      await setGroupMode(config.groupJid, targetMode, context.sender)
      count++
    }
  }

  const message = action === 'on'
    ? `🎓 Training Mode ON - ${count} groups set to learning (observe-only)`
    : `🎓 Training Mode OFF - ${count} groups set to active`

  logger.info(`Training mode ${action === 'on' ? 'enabled' : 'disabled'}`, {
    event: action === 'on' ? 'training_mode_on' : 'training_mode_off',
    groupCount: count,
    triggeredBy: context.sender,
  })

  await sendControlResponse(context, message)
}

/**
 * Build status message for the CIO.
 * Updated to show per-group mode information.
 */
export async function buildStatusMessage(): Promise<string> {
  const connectionStatus = getConnectionStatus()
  const operationalStatus = getOperationalStatus()
  const pauseInfo = getPauseInfo()
  const activityStats = getActivityStats()
  const recoveryPending = isRecoveryPending()
  const recoveryTimeRemaining = getRecoveryTimeRemaining()
  const recoveryReason = getPendingRecoveryReason()
  const modeStats = getGroupModeStats()
  const configs = await getAllGroupConfigs()

  // Get queue length for pending logs
  const queueLengthResult = await getQueueLength()
  const pendingLogs = queueLengthResult.ok ? queueLengthResult.data : 0

  // Connection status emoji
  const connectionEmoji = connectionStatus === 'connected' ? '🟢' : '🔴'
  const connectionLabel = connectionStatus === 'connected' ? 'Connected' : 'Disconnected'

  // Operational status
  let statusLine: string
  if (operationalStatus === 'paused') {
    statusLine = `⏸️ PAUSED: ${pauseInfo.reason || 'Unknown reason'}`
  } else {
    statusLine = '✅ All systems normal'
  }

  // Build message parts
  const lines: string[] = [
    '📊 eNorBOT Status',
    '',
    `Connection: ${connectionEmoji} ${connectionLabel}`,
    `Uptime: ${formatDuration(activityStats.uptimeMs)}`,
    `Status: ${statusLine}`,
  ]

  // Add recovery info if pending
  if (recoveryPending && recoveryTimeRemaining !== null) {
    lines.push('')
    lines.push(`⏱️ Auto-recovery in ${formatDuration(recoveryTimeRemaining)}`)
    if (recoveryReason) {
      lines.push(`   Reason: ${recoveryReason}`)
    }
  }

  // Learning system section
  lines.push('')
  lines.push('📚 Learning System')
  lines.push(`• ${modeStats.learning} groups learning (observing)`)
  lines.push(`• ${modeStats.active} groups active (responding)`)
  lines.push(`• ${modeStats.assisted} groups assisted`)
  lines.push(`• ${modeStats.paused} groups paused`)

  // Activity section
  lines.push('')
  lines.push("📈 Today's Activity")
  lines.push(`• ${activityStats.messagesSentToday} quotes sent`)
  lines.push(`• ${configs.size} groups monitored`)
  lines.push(`• Last activity: ${formatRelativeTime(activityStats.lastActivityAt)}`)

  // Add pending logs if any
  if (pendingLogs > 0) {
    lines.push(`• ${pendingLogs} logs pending sync`)
  }

  // Groups by mode section (if any groups)
  if (configs.size > 0) {
    lines.push('')
    lines.push('📂 Groups by Mode')

    // Show first 5 groups per mode
    for (const mode of ['learning', 'active', 'paused'] as GroupMode[]) {
      const groups = getGroupsByMode(mode)
      if (groups.length > 0) {
        const emoji = getModeEmoji(mode)
        const shown = groups.slice(0, 3)
        const extra = groups.length > 3 ? ` (+${groups.length - 3} more)` : ''
        const groupNames = shown.map(g => g.groupName).join(', ')
        lines.push(`• ${emoji} ${mode}: ${groupNames}${extra}`)
      }
    }
  }

  // Classification metrics section
  const classMetrics = getClassificationMetrics()
  lines.push('')
  lines.push('🔬 Classification')

  if (classMetrics.totalClassifications === 0) {
    lines.push('• No messages classified yet (since restart)')
  } else {
    lines.push(`• ${classMetrics.totalClassifications} messages classified`)

    // Show top 3 message types
    const topTypes = Object.entries(classMetrics.classificationDistribution)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ')
    if (topTypes) {
      lines.push(`• Top types: ${topTypes}`)
    }

    // AI usage summary
    const aiMetrics = classMetrics.aiMetrics
    if (aiMetrics.totalCalls > 0) {
      lines.push(`• AI: ${aiMetrics.totalCalls} calls, $${aiMetrics.totalCostUsd.toFixed(3)} cost`)
    }

    // Circuit breaker status (only show if tripped)
    if (aiMetrics.circuitBreaker.isOpen) {
      lines.push(`• ⚠️ AI circuit breaker OPEN`)
    }

    // Latency (only show if meaningful)
    if (classMetrics.latencyPercentiles.p50 > 0) {
      lines.push(`• Latency p50: ${classMetrics.latencyPercentiles.p50.toFixed(0)}ms`)
    }
  }

  return lines.join('\n')
}

/**
 * Handle status command.
 *
 * @param context - Router context
 */
async function handleStatusCommand(context: RouterContext): Promise<void> {
  const statusMessage = await buildStatusMessage()

  logger.info('Status command processed', {
    event: 'status_command_processed',
    triggeredBy: context.sender,
  })

  await sendControlResponse(context, statusMessage)
}

// =============================================================================
// Main Handler
// =============================================================================

/**
 * Handle control group messages.
 * Parses commands and dispatches to appropriate handlers.
 *
 * @param context - Router context with message metadata
 * @returns Result indicating success
 */
export async function handleControlMessage(context: RouterContext): Promise<Result<void>> {
  const command = parseControlCommand(context.message)

  logger.info('Control command received', {
    event: 'control_command_received',
    commandType: command.type,
    args: command.args,
    groupId: context.groupId,
    sender: context.sender,
  })

  switch (command.type) {
    case 'mode':
      await handleModeCommand(context, command.args)
      break

    case 'modes':
      await handleModesCommand(context)
      break

    case 'config':
      await handleConfigCommand(context, command.args)
      break

    case 'trigger':
      await handleTriggerCommand(context, command.args)
      break

    case 'role':
      await handleRoleCommand(context, command.args)
      break

    case 'pause':
      await handlePauseCommand(context, command.args)
      break

    case 'resume':
      await handleResumeCommand(context, command.args)
      break

    case 'status':
      await handleStatusCommand(context)
      break

    case 'training':
      await handleTrainingCommand(context, command.args)
      break

    case 'unknown':
      // Unknown command - log but don't respond
      logger.debug('Unknown control command', {
        event: 'control_unknown_command',
        message: context.message,
      })
      break
  }

  return ok(undefined)
}
