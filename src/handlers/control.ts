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
import { sendWithAntiDetection, formatMention } from '../utils/messaging.js'
import { getActiveDeals, cancelDeal, archiveDeal } from '../services/dealFlowService.js'
import { cancelQuote } from '../services/activeQuotes.js'
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
  resolveOperatorJid,
  getGroupModeSync,
  type GroupConfig,
} from '../services/groupConfig.js'
import { getClassificationMetrics } from '../services/classificationEngine.js'

// =============================================================================
// Interactive Selection State
// =============================================================================

/**
 * Pending group selection for "training off" interactive flow.
 * Maps sender JID -> selection context.
 */
interface PendingGroupSelection {
  /** Groups available for selection (indexed 1-N) */
  groups: Array<{ groupJid: string; groupName: string }>
  /** Timestamp when selection was initiated */
  createdAt: number
  /** Control group ID where the selection was initiated */
  controlGroupId: string
}

/**
 * Active pending selections by sender.
 * Times out after 60 seconds.
 */
const pendingSelections: Map<string, PendingGroupSelection> = new Map()

/**
 * Selection timeout in milliseconds (60 seconds).
 */
const SELECTION_TIMEOUT_MS = 60 * 1000

/**
 * Check if a sender has a pending selection that hasn't expired.
 */
function getPendingSelection(senderJid: string): PendingGroupSelection | null {
  const selection = pendingSelections.get(senderJid)
  if (!selection) return null

  // Check if expired
  if (Date.now() - selection.createdAt > SELECTION_TIMEOUT_MS) {
    pendingSelections.delete(senderJid)
    return null
  }

  return selection
}

/**
 * Clear a pending selection for a sender.
 */
function clearPendingSelection(senderJid: string): void {
  pendingSelections.delete(senderJid)
}

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
  | 'off'       // off [group] - cancel active deals and send off to group
  | 'mode'      // mode <group> learning|assisted|active|paused
  | 'modes'     // List all groups with modes
  | 'config'    // config <group> - show group config
  | 'trigger'   // trigger add|remove <group> <pattern>
  | 'role'      // role <group> <player> operator|client|cio
  | 'turnoff'   // turnoff - emergency kill: pause all groups + cancel all deals
  | 'select'    // Number selection for interactive group selection
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
  // Strip leading bot @mention (e.g., "@5511999999999 off OTC")
  const stripped = message.replace(/^@[\d]+\s*/g, '').trim()
  const lower = stripped.toLowerCase().trim()

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

  // Turnoff command: emergency kill switch — pause all groups + cancel all deals
  if (lower === 'turnoff') {
    return { type: 'turnoff', args: [] }
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

  // Off command: "off", "off <group>", "off off"
  // Must come AFTER "training off" check (exact match) to avoid conflict
  if (lower === 'off' || lower.startsWith('off ')) {
    const rest = stripped.replace(/^off\s*/i, '').trim()
    return { type: 'off', args: rest ? [rest] : [] }
  }

  // Number selection (1-99) for interactive group selection
  const numberMatch = lower.match(/^(\d{1,2})$/)
  if (numberMatch) {
    return { type: 'select', args: [numberMatch[1]] }
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
 * Uses direct sock.sendMessage (no anti-detection delay) because
 * control group is CIO-only — no spam risk, instant feedback needed.
 */
async function sendControlResponse(
  context: RouterContext,
  message: string
): Promise<void> {
  try {
    await context.sock.sendMessage(context.groupId, { text: message })
    logBotMessage({
      groupJid: context.groupId,
      content: message,
      messageType: 'status',
      isControlGroup: true,
    })
  } catch (e) {
    logger.error('Failed to send control response', {
      event: 'control_response_error',
      groupId: context.groupId,
      error: e instanceof Error ? e.message : String(e),
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
      '⚠️ Usage: role <group> <player_phone> <operator|client|cio>\nThe operator role controls who gets @tagged by the bot in deal messages.\nExample: role OTC 5511999999999 operator'
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
 * Handle turnoff command — emergency kill switch.
 * Pauses ALL groups and cancels ALL active deals in one shot.
 */
async function handleTurnoffCommand(context: RouterContext): Promise<void> {
  logger.info('TURNOFF command received — emergency kill', {
    event: 'turnoff_command',
    triggeredBy: context.sender,
  })

  // 1. Pause all groups
  const configs = await getAllGroupConfigs()
  let pausedCount = 0
  for (const config of configs.values()) {
    if (config.mode !== 'paused') {
      await setGroupMode(config.groupJid, 'paused', context.sender)
      pausedCount++
    }
  }

  // 2. Cancel all active deals across all groups
  let cancelledCount = 0
  for (const config of configs.values()) {
    const dealsResult = await getActiveDeals(config.groupJid)
    if (!dealsResult.ok) continue
    for (const deal of dealsResult.data) {
      await cancelDeal(deal.id, config.groupJid, 'cancelled_by_operator').catch(() => {})
      archiveDeal(deal.id, config.groupJid).catch(() => {})
      cancelledCount++
    }
    // Cancel active quotes too
    cancelQuote(config.groupJid)
  }

  const msg = `TURNOFF: ${pausedCount} groups paused, ${cancelledCount} deals cancelled.`
  await sendControlResponse(context, msg)

  logger.info('TURNOFF complete', {
    event: 'turnoff_complete',
    pausedCount,
    cancelledCount,
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
 * Build the numbered group list message for interactive selection.
 */
function buildGroupSelectionMessage(groups: Array<{ groupJid: string; groupName: string }>): string {
  const lines: string[] = [
    '🎓 Which group would you like to activate?',
    '',
  ]

  groups.forEach((group, index) => {
    lines.push(`${index + 1}. ${group.groupName}`)
  })

  lines.push('')
  lines.push('Reply with the number to activate that group.')

  return lines.join('\n')
}

/**
 * Build the updated group list message after selection.
 */
async function buildUpdatedGroupListMessage(activatedGroupName: string): Promise<string> {
  const learningGroups = getGroupsByMode('learning')
  const activeGroups = getGroupsByMode('active')

  const lines: string[] = [
    `🟢 ${activatedGroupName} is now ACTIVE!`,
    '',
  ]

  if (learningGroups.length > 0) {
    lines.push('📚 Groups still in learning mode:')
    learningGroups.forEach((g, i) => {
      lines.push(`${i + 1}. ${g.groupName}`)
    })
    lines.push('')
    lines.push('Send "training off" to activate another group.')
  } else {
    lines.push('✅ All groups are now active!')
  }

  if (activeGroups.length > 0) {
    lines.push('')
    lines.push('🟢 Active groups:')
    activeGroups.forEach(g => {
      lines.push(`• ${g.groupName}`)
    })
  }

  return lines.join('\n')
}

/**
 * Handle training command.
 * "training on" - sets all groups to learning mode
 * "training off" - shows interactive numbered list for group activation
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

  logger.info('Training command received', {
    event: 'training_command',
    action,
    triggeredBy: context.sender,
  })

  if (action === 'on') {
    // Set all groups to learning mode
    const configs = await getAllGroupConfigs()
    let count = 0

    for (const config of configs.values()) {
      if (config.mode !== 'learning' && config.mode !== 'paused') {
        await setGroupMode(config.groupJid, 'learning', context.sender)
        count++
      }
    }

    logger.info('Training mode enabled', {
      event: 'training_mode_on',
      groupCount: count,
      triggeredBy: context.sender,
    })

    await sendControlResponse(context, `🎓 Training Mode ON - ${count} groups set to learning (observe-only)`)
    return
  }

  // action === 'off' - show interactive group selection
  const learningGroups = getGroupsByMode('learning')

  if (learningGroups.length === 0) {
    // No groups in learning mode
    const activeGroups = getGroupsByMode('active')
    if (activeGroups.length === 0) {
      await sendControlResponse(context, '⚠️ No groups registered yet. Groups will appear when the bot receives messages from them.')
    } else {
      await sendControlResponse(context, `✅ All ${activeGroups.length} groups are already active!`)
    }
    return
  }

  // Build the selection list
  const selectableGroups = learningGroups.map(g => ({
    groupJid: g.groupJid,
    groupName: g.groupName,
  }))

  // Store pending selection
  pendingSelections.set(context.sender, {
    groups: selectableGroups,
    createdAt: Date.now(),
    controlGroupId: context.groupId,
  })

  logger.info('Group selection initiated', {
    event: 'group_selection_initiated',
    groupCount: selectableGroups.length,
    triggeredBy: context.sender,
  })

  await sendControlResponse(context, buildGroupSelectionMessage(selectableGroups))
}

/**
 * Handle select command (number input for group selection).
 *
 * @param context - Router context
 * @param args - Command arguments (the number)
 */
async function handleSelectCommand(context: RouterContext, args: string[]): Promise<void> {
  const selection = getPendingSelection(context.sender)

  if (!selection) {
    // No pending selection - ignore the number
    logger.debug('Number received but no pending selection', {
      event: 'select_no_pending',
      number: args[0],
      sender: context.sender,
    })
    return
  }

  const selectedNumber = parseInt(args[0], 10)

  // Validate selection
  if (selectedNumber < 1 || selectedNumber > selection.groups.length) {
    await sendControlResponse(
      context,
      `⚠️ Invalid selection. Please enter a number between 1 and ${selection.groups.length}.`
    )
    return
  }

  // Get the selected group
  const selectedGroup = selection.groups[selectedNumber - 1]

  // Activate the group
  const result = await setGroupMode(selectedGroup.groupJid, 'active', context.sender)

  if (!result.ok) {
    await sendControlResponse(context, `❌ Failed to activate group: ${result.error}`)
    return
  }

  // Clear the pending selection
  clearPendingSelection(context.sender)

  logger.info('Group activated via selection', {
    event: 'group_activated_via_selection',
    groupJid: selectedGroup.groupJid,
    groupName: selectedGroup.groupName,
    selectedNumber,
    triggeredBy: context.sender,
  })

  // Send updated list
  const updatedMessage = await buildUpdatedGroupListMessage(selectedGroup.groupName)
  await sendControlResponse(context, updatedMessage)
}

/**
 * Send "off @operator" to a target group.
 * Resolves operator JID, builds mention, sends via anti-detection.
 */
async function sendOffToGroup(
  sock: RouterContext['sock'],
  groupJid: string,
  groupName: string
): Promise<void> {
  // Safety: never send to learning mode groups
  const mode = getGroupModeSync(groupJid)
  if (mode === 'learning') {
    logger.warn('Blocked off message to learning mode group', {
      event: 'off_blocked_learning',
      groupJid,
      groupName,
    })
    return
  }

  const operatorJid = resolveOperatorJid(groupJid)

  if (operatorJid) {
    const mention = formatMention(operatorJid)
    const message = `off ${mention.textSegment}`
    const result = await sendWithAntiDetection(sock, groupJid, message, [mention.jid])

    if (result.ok) {
      logBotMessage({
        groupJid,
        content: message,
        messageType: 'control_off',
      })
    }
  } else {
    // No operator assigned — send plain "off"
    const result = await sendWithAntiDetection(sock, groupJid, 'off')

    if (result.ok) {
      logBotMessage({
        groupJid,
        content: 'off',
        messageType: 'control_off',
      })
    }
  }

  logger.info('Off message sent to group', {
    event: 'off_sent_to_group',
    groupJid,
    groupName,
    hasOperator: !!operatorJid,
  })
}

/**
 * Handle off command.
 * "off" (bare) → usage hint
 * "off <group>" → cancel deals + instant reply + send off to group
 * "off off" → cancel deals + instant reply + broadcast off to ALL non-paused groups
 *
 * Reply-first pattern: CONTROLE gets instant feedback, trading group
 * messages follow sequentially with anti-detection delays.
 *
 * @param context - Router context
 * @param args - Command arguments
 */
async function handleOffCommand(context: RouterContext, args: string[]): Promise<void> {
  // No args → usage hint
  if (args.length === 0) {
    await sendControlResponse(
      context,
      'Envie *off [nome do grupo]* para encerrar deals ativos, ou *off off* para encerrar todos.'
    )
    return
  }

  // "off off" → cancel deals/quotes + send off ONLY to groups that had something active
  if (args[0].toLowerCase() === 'off') {
    const configs = await getAllGroupConfigs()
    const targetGroups: Array<{ groupJid: string; groupName: string }> = []
    let totalCancelled = 0
    let quotesCleared = 0

    for (const config of configs.values()) {
      if (config.mode !== 'active') continue

      // Check for active deals (Supabase)
      const dealsResult = await getActiveDeals(config.groupJid)
      const hasDeals = dealsResult.ok && dealsResult.data.length > 0

      // Cancel active quote (in-memory) — returns true if one existed
      const hadQuote = cancelQuote(config.groupJid)

      // Only target groups that had something to cancel
      if (!hasDeals && !hadQuote) continue

      targetGroups.push({ groupJid: config.groupJid, groupName: config.groupName })

      if (hadQuote) quotesCleared++

      // Cancel active deals
      if (hasDeals) {
        for (const deal of dealsResult.data) {
          const cancelResult = await cancelDeal(deal.id, config.groupJid, 'cancelled_by_operator')
          if (cancelResult.ok) {
            totalCancelled++
            archiveDeal(deal.id, config.groupJid).catch(() => {})
          }
        }
      }
    }

    if (targetGroups.length === 0) {
      await sendControlResponse(context, 'Nenhum deal ou cotação ativa em nenhum grupo.')
      return
    }

    // Reply to CONTROLE first (instant feedback)
    const groupNames = targetGroups.map(g => g.groupName).join(', ')
    const details: string[] = []
    if (totalCancelled > 0) details.push(`${totalCancelled} deal(s) cancelados`)
    if (quotesCleared > 0) details.push(`${quotesCleared} cotação(ões) cancelada(s)`)
    const detailStr = details.length > 0 ? ' ' + details.join(', ') + '.' : ''

    await sendControlResponse(
      context,
      `off enviado para ${targetGroups.length} grupo(s): ${groupNames}.${detailStr}`
    )

    // Then send "off @operator" to each target group (with anti-detection)
    for (const group of targetGroups) {
      await sendOffToGroup(context.sock, group.groupJid, group.groupName)
    }

    logger.info('Off all command processed', {
      event: 'off_all_processed',
      groupCount: targetGroups.length,
      totalCancelled,
      quotesCleared,
      triggeredBy: context.sender,
    })
    return
  }

  // "off <group>" → off specific group
  const groupSearch = args.join(' ')
  const match = findMatchingGroup(groupSearch)

  if (!match.found || !match.groupId) {
    await sendControlResponse(
      context,
      `Grupo não encontrado. Envie *off [nome do grupo]* ou *off off* para encerrar todos os deals ativos.`
    )
    return
  }

  // Cancel active deals if any
  const dealsResult = await getActiveDeals(match.groupId)
  let cancelledCount = 0

  if (dealsResult.ok) {
    for (const deal of dealsResult.data) {
      const cancelResult = await cancelDeal(deal.id, match.groupId, 'cancelled_by_operator')
      if (cancelResult.ok) {
        cancelledCount++
        archiveDeal(deal.id, match.groupId).catch(() => {})
      }
    }
  }

  // Cancel active quote if any (in-memory)
  const quoteCancelled = cancelQuote(match.groupId)

  // Reply to CONTROLE first (instant feedback)
  const details: string[] = []
  if (cancelledCount > 0) details.push(`${cancelledCount} deal(s) cancelados`)
  if (quoteCancelled) details.push('cotação cancelada')
  if (details.length === 0) details.push('Nenhum deal ativo')
  const dealMsg = details.join(', ') + '.'
  await sendControlResponse(context, `off enviado para ${match.groupName}. ${dealMsg}`)

  // Then send "off @operator" to the target group (with anti-detection)
  await sendOffToGroup(context.sock, match.groupId, match.groupName!)

  logger.info('Off command processed', {
    event: 'off_command_processed',
    groupId: match.groupId,
    groupName: match.groupName,
    cancelledCount,
    triggeredBy: context.sender,
  })
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

    case 'turnoff':
      await handleTurnoffCommand(context)
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

    case 'off':
      await handleOffCommand(context, command.args)
      break

    case 'select':
      await handleSelectCommand(context, command.args)
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
