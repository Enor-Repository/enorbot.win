/**
 * Control Handler - Epic 4: CIO Control Interface
 *
 * Handles control group messages including:
 * - Story 4.1: Pause command (pause [group name])
 * - Story 4.2: Resume command (resume [group name])
 * - Story 4.3: Status command
 *
 * Control group is identified by CONTROL_GROUP_PATTERN in config.
 */

import { logger } from '../utils/logger.js'
import { ok, type Result } from '../utils/result.js'
import type { RouterContext } from '../bot/router.js'
import { sendWithAntiDetection } from '../utils/messaging.js'
import {
  pauseGroup,
  pauseAllGroups,
  isGroupPaused,
  getPausedGroups,
  isGlobalPauseActive,
  resumeGroup,
  resumeAllGroups,
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

// =============================================================================
// Known Groups Cache
// =============================================================================

/**
 * Cache of known groups: groupId -> groupName.
 * Populated when messages are seen from groups.
 * Used for fuzzy matching in pause/resume commands.
 */
const knownGroups: Map<string, string> = new Map()

/**
 * Register a known group for fuzzy matching.
 * Called when messages are received from groups.
 *
 * @param groupId - The JID of the group
 * @param groupName - The human-readable name of the group
 */
export function registerKnownGroup(groupId: string, groupName: string): void {
  knownGroups.set(groupId, groupName)
}

/**
 * Get all known groups.
 * Returns a copy to prevent external mutation.
 *
 * @returns Copy of the known groups map (groupId -> groupName)
 */
export function getKnownGroups(): Map<string, string> {
  return new Map(knownGroups)
}

/**
 * Clear known groups cache.
 * Primarily used for testing to reset state between tests.
 */
export function clearKnownGroups(): void {
  knownGroups.clear()
}

// =============================================================================
// Command Parsing
// =============================================================================

/**
 * Control command types.
 */
export type ControlCommandType = 'pause' | 'resume' | 'status' | 'unknown'

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

  return { type: 'unknown', args: [] }
}

// =============================================================================
// Fuzzy Group Matching
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
 * Case-insensitive contains match.
 *
 * @param searchTerm - The search term to match (must be non-empty)
 * @returns Match result with groupId and groupName if found
 */
export function findMatchingGroup(searchTerm: string): GroupMatchResult {
  // Guard against empty search term - would match all groups
  if (!searchTerm || !searchTerm.trim()) {
    return { found: false, groupId: null, groupName: null }
  }

  const lower = searchTerm.toLowerCase().trim()

  for (const [groupId, groupName] of knownGroups) {
    if (groupName.toLowerCase().includes(lower)) {
      return { found: true, groupId, groupName }
    }
  }

  return { found: false, groupId: null, groupName: null }
}

// =============================================================================
// Command Handlers
// =============================================================================

/**
 * Handle pause command.
 *
 * @param context - Router context
 * @param args - Command arguments (optional group name)
 */
async function handlePauseCommand(context: RouterContext, args: string[]): Promise<void> {
  const groupName = args[0]

  if (!groupName) {
    // Global pause
    pauseAllGroups()

    logger.info('All groups paused', {
      event: 'global_pause',
      triggeredBy: context.sender,
    })

    await sendWithAntiDetection(context.sock, context.groupId, '⏸️ All groups paused')
    return
  }

  // Specific group pause with fuzzy matching
  const match = findMatchingGroup(groupName)

  if (!match.found || !match.groupId) {
    logger.warn('Pause command - no matching group', {
      event: 'pause_no_match',
      searchTerm: groupName,
      triggeredBy: context.sender,
    })

    await sendWithAntiDetection(
      context.sock,
      context.groupId,
      `⚠️ No group matching "${groupName}" found`
    )
    return
  }

  pauseGroup(match.groupId)

  logger.info('Group paused', {
    event: 'group_paused',
    groupId: match.groupId,
    groupName: match.groupName,
    triggeredBy: context.sender,
  })

  await sendWithAntiDetection(
    context.sock,
    context.groupId,
    `⏸️ Paused for ${match.groupName}`
  )
}

/**
 * Handle resume command.
 *
 * @param context - Router context
 * @param args - Command arguments (optional group name)
 */
async function handleResumeCommand(context: RouterContext, args: string[]): Promise<void> {
  const groupName = args[0]

  // CRITICAL: Cancel any pending auto-recovery on resume
  cancelAutoRecovery()

  // Check if error state was active (for response message)
  const hadErrorState = getOperationalStatus() === 'paused'

  if (!groupName) {
    // Global resume
    resumeAllGroups()

    // Also clear error state on global resume
    if (hadErrorState) {
      setRunning()

      logger.info('All groups resumed with error state cleared', {
        event: 'global_resume_error_cleared',
        triggeredBy: context.sender,
      })

      await sendWithAntiDetection(
        context.sock,
        context.groupId,
        '▶️ Resumed. Error state cleared.'
      )
      return
    }

    logger.info('All groups resumed', {
      event: 'global_resume',
      triggeredBy: context.sender,
    })

    await sendWithAntiDetection(context.sock, context.groupId, '▶️ All groups resumed')
    return
  }

  // Specific group resume with fuzzy matching
  const match = findMatchingGroup(groupName)

  if (!match.found || !match.groupId) {
    logger.warn('Resume command - no matching group', {
      event: 'resume_no_match',
      searchTerm: groupName,
      triggeredBy: context.sender,
    })

    await sendWithAntiDetection(
      context.sock,
      context.groupId,
      `⚠️ No group matching "${groupName}" found`
    )
    return
  }

  const wasResumed = resumeGroup(match.groupId)

  if (!wasResumed) {
    logger.info('Resume command - group was not paused', {
      event: 'resume_not_paused',
      groupId: match.groupId,
      groupName: match.groupName,
      triggeredBy: context.sender,
    })

    await sendWithAntiDetection(
      context.sock,
      context.groupId,
      `ℹ️ "${match.groupName}" was not paused`
    )
    return
  }

  logger.info('Group resumed', {
    event: 'group_resumed',
    groupId: match.groupId,
    groupName: match.groupName,
    triggeredBy: context.sender,
  })

  await sendWithAntiDetection(
    context.sock,
    context.groupId,
    `▶️ Resumed for ${match.groupName}`
  )
}

/**
 * Get group names for paused groups.
 * Maps group IDs to their names using the known groups cache.
 */
function getPausedGroupNames(): string[] {
  const pausedIds = getPausedGroups()
  const names: string[] = []

  for (const groupId of pausedIds) {
    const name = knownGroups.get(groupId)
    if (name) {
      names.push(name)
    } else {
      // Fallback to ID if name not in cache
      names.push(groupId)
    }
  }

  return names
}

/**
 * Build status message for the CIO.
 * Gathers all state information and formats it for display.
 */
export async function buildStatusMessage(): Promise<string> {
  const connectionStatus = getConnectionStatus()
  const operationalStatus = getOperationalStatus()
  const pauseInfo = getPauseInfo()
  const activityStats = getActivityStats()
  const recoveryPending = isRecoveryPending()
  const recoveryTimeRemaining = getRecoveryTimeRemaining()
  const recoveryReason = getPendingRecoveryReason()
  const pausedGroupNames = getPausedGroupNames()
  const globalPause = isGlobalPauseActive()

  // Get queue length for pending logs
  const queueLengthResult = await getQueueLength()
  const pendingLogs = queueLengthResult.ok ? queueLengthResult.data : 0

  // Connection status emoji
  const connectionEmoji = connectionStatus === 'connected' ? '🟢' : '🔴'
  const connectionLabel = connectionStatus === 'connected' ? 'Connected' : 'Disconnected'

  // Status determination
  let statusLine: string
  if (operationalStatus === 'paused') {
    statusLine = `⏸️ PAUSED: ${pauseInfo.reason || 'Unknown reason'}`
  } else if (globalPause) {
    statusLine = '⏸️ All groups paused (manual)'
  } else if (pausedGroupNames.length > 0) {
    statusLine = `⚠️ ${pausedGroupNames.length} group(s) paused`
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

  // Activity section
  lines.push('')
  lines.push("📈 Today's Activity")
  lines.push(`• ${activityStats.messagesSentToday} quotes sent`)
  lines.push(`• ${knownGroups.size} groups monitored`)
  lines.push(`• Last activity: ${formatRelativeTime(activityStats.lastActivityAt)}`)

  // Add pending logs if any (Epic 5 action item)
  if (pendingLogs > 0) {
    lines.push(`• ${pendingLogs} logs pending sync`)
  }

  // Groups section (if any paused)
  if (pausedGroupNames.length > 0 || globalPause) {
    lines.push('')
    lines.push('📂 Groups')
    if (globalPause) {
      lines.push('• All groups - ⏸️ Paused (global)')
    } else {
      for (const name of pausedGroupNames) {
        lines.push(`• ${name} - ⏸️ Paused`)
      }
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

  await sendWithAntiDetection(context.sock, context.groupId, statusMessage)
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
    case 'pause':
      await handlePauseCommand(context, command.args)
      break

    case 'resume':
      await handleResumeCommand(context, command.args)
      break

    case 'status':
      await handleStatusCommand(context)
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
