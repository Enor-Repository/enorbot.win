/**
 * Conversation Tracker Module - Thread management for OTC message linking
 *
 * Story 8.2: Create Conversation Tracker Module
 * - Track conversation threads by group
 * - Link related messages (price request → response → confirmation)
 * - Auto-close threads on timeout or completion
 *
 * Thread lifecycle:
 * 1. price_request → creates new thread
 * 2. Subsequent messages link to active thread within 5 minutes
 * 3. Thread closes on: confirmation, receipt, tronscan, or timeout
 */

import { v4 as uuidv4 } from 'uuid'
import { logger } from '../utils/logger.js'
import type { OTCMessageType } from './messageClassifier.js'

/**
 * Thread timeout in milliseconds (5 minutes).
 * Threads with no activity beyond this are considered stale.
 */
export const THREAD_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Cleanup interval in milliseconds (1 minute).
 * How often to check for and remove stale threads.
 */
const CLEANUP_INTERVAL_MS = 60 * 1000

/**
 * Maximum number of active threads to prevent memory growth.
 * When limit is reached, oldest threads are evicted.
 */
export const MAX_ACTIVE_THREADS = 1000

/**
 * Active conversation thread.
 */
export interface ConversationThread {
  threadId: string
  groupId: string
  startedBy: string           // JID of who started (price_request)
  startTime: Date
  participants: Set<string>   // All JIDs involved
  lastActivity: Date
  messageCount: number
  closed: boolean
  closedReason?: 'confirmation' | 'receipt' | 'tronscan' | 'timeout' | 'manual'
}

/**
 * Serializable version of ConversationThread for testing/export.
 */
export interface SerializedThread {
  threadId: string
  groupId: string
  startedBy: string
  startTime: string
  participants: string[]
  lastActivity: string
  messageCount: number
  closed: boolean
  closedReason?: string
}

/**
 * Active threads by group.
 * Key: groupId, Value: ConversationThread
 * Only one active thread per group at a time.
 */
const activeThreads: Map<string, ConversationThread> = new Map()

/**
 * Cleanup interval handle.
 */
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null

/**
 * Start the cleanup interval for stale threads.
 * Called automatically on first thread creation.
 */
function ensureCleanupRunning(): void {
  if (cleanupIntervalId === null) {
    cleanupIntervalId = setInterval(cleanupStaleThreads, CLEANUP_INTERVAL_MS)
    // Don't block process exit
    if (cleanupIntervalId.unref) {
      cleanupIntervalId.unref()
    }
  }
}

/**
 * Stop the cleanup interval (for testing/shutdown).
 */
export function stopCleanupInterval(): void {
  if (cleanupIntervalId !== null) {
    clearInterval(cleanupIntervalId)
    cleanupIntervalId = null
  }
}

/**
 * Clean up stale threads (older than THREAD_TIMEOUT_MS).
 * Story 8.2 AC4: Stale threads (> 5 min inactive) are cleaned up
 */
export function cleanupStaleThreads(): number {
  const now = Date.now()
  let cleaned = 0

  for (const [groupId, thread] of activeThreads.entries()) {
    const inactiveMs = now - thread.lastActivity.getTime()
    if (inactiveMs > THREAD_TIMEOUT_MS) {
      thread.closed = true
      thread.closedReason = 'timeout'
      activeThreads.delete(groupId)
      cleaned++

      logger.debug('Thread closed due to timeout', {
        event: 'thread_timeout',
        threadId: thread.threadId,
        groupId,
        inactiveMs,
        messageCount: thread.messageCount,
      })
    }
  }

  return cleaned
}

/**
 * Get or create a conversation thread for a price request.
 * Returns existing thread if within timeout window (5 minutes).
 *
 * Story 8.2 AC1: New thread created on price_request
 * Story 8.2 AC5: Thread ID is UUID format
 */
export function getOrCreateThread(groupId: string, starterJid: string): string {
  ensureCleanupRunning()

  const existing = activeThreads.get(groupId)
  const now = new Date()

  // Return existing if still active (within timeout)
  if (existing && !existing.closed) {
    const inactiveMs = now.getTime() - existing.lastActivity.getTime()
    if (inactiveMs < THREAD_TIMEOUT_MS) {
      // Update activity and add participant
      existing.lastActivity = now
      existing.participants.add(starterJid)
      existing.messageCount++
      return existing.threadId
    }
    // Thread timed out, close it
    existing.closed = true
    existing.closedReason = 'timeout'
  }

  // Evict oldest thread if at capacity (Issue fix: prevent unbounded memory growth)
  if (activeThreads.size >= MAX_ACTIVE_THREADS) {
    // Find oldest thread by lastActivity
    let oldestGroupId: string | null = null
    let oldestActivity = Infinity

    for (const [gId, t] of activeThreads.entries()) {
      const activityTime = t.lastActivity.getTime()
      if (activityTime < oldestActivity) {
        oldestActivity = activityTime
        oldestGroupId = gId
      }
    }

    if (oldestGroupId) {
      activeThreads.delete(oldestGroupId)
      logger.debug('Thread evicted due to capacity limit', {
        event: 'thread_evicted_capacity',
        evictedGroupId: oldestGroupId,
        maxThreads: MAX_ACTIVE_THREADS,
      })
    }
  }

  // Create new thread
  const thread: ConversationThread = {
    threadId: uuidv4(),
    groupId,
    startedBy: starterJid,
    startTime: now,
    participants: new Set([starterJid]),
    lastActivity: now,
    messageCount: 1,
    closed: false,
  }

  activeThreads.set(groupId, thread)

  logger.debug('New conversation thread created', {
    event: 'thread_created',
    threadId: thread.threadId,
    groupId,
    startedBy: starterJid,
  })

  return thread.threadId
}

/**
 * Add a message to an existing thread.
 * Returns thread ID if active thread exists, null otherwise.
 *
 * Story 8.2 AC2: Subsequent messages link to active thread within 5 minutes
 * Story 8.2 AC6: Participants tracked correctly in thread
 */
export function addToThread(groupId: string, participantJid: string): string | null {
  const thread = activeThreads.get(groupId)
  if (!thread || thread.closed) {
    return null
  }

  const now = new Date()
  const inactiveMs = now.getTime() - thread.lastActivity.getTime()

  // Check if thread is still active
  if (inactiveMs >= THREAD_TIMEOUT_MS) {
    thread.closed = true
    thread.closedReason = 'timeout'
    activeThreads.delete(groupId)
    return null
  }

  // Update thread
  thread.lastActivity = now
  thread.participants.add(participantJid)
  thread.messageCount++

  return thread.threadId
}

/**
 * Close a thread explicitly.
 * Story 8.2 AC3: Thread closes on confirmation/receipt/tronscan
 */
export function closeThread(
  groupId: string,
  reason: 'confirmation' | 'receipt' | 'tronscan' | 'manual' = 'manual'
): void {
  const thread = activeThreads.get(groupId)
  if (!thread) {
    return
  }

  thread.closed = true
  thread.closedReason = reason
  activeThreads.delete(groupId)

  logger.debug('Conversation thread closed', {
    event: 'thread_closed',
    threadId: thread.threadId,
    groupId,
    reason,
    messageCount: thread.messageCount,
    participants: thread.participants.size,
  })
}

/**
 * Get thread ID for a message based on context and timing.
 * Handles thread creation and linking based on message type.
 *
 * Thread Rules (Updated 2026-01-29):
 * - price_request → creates new thread (or returns existing if < 5 min old)
 * - price_lock → creates new thread (critical transaction initiation)
 * - price_response → links to most recent thread in group
 * - quote_calculation → links to active thread (operator calculation)
 * - volume_inquiry → may create new thread if no active one
 * - negotiation → links to active thread only
 * - bot_command → links to active thread (client command to other bot)
 * - bot_confirmation → links to active thread (other bot response)
 * - confirmation → links to active thread, then closes it
 * - receipt/tronscan → links to active thread, then closes it
 * - balance_report → no thread linking (standalone info)
 * - general → no thread linking
 */
export function resolveThreadId(params: {
  groupId: string
  senderJid: string
  messageType: OTCMessageType
  timestamp: Date
}): string | null {
  const { groupId, senderJid, messageType } = params

  switch (messageType) {
    case 'price_request':
      // Creates new thread or returns existing
      return getOrCreateThread(groupId, senderJid)

    case 'price_lock': {
      // Creates new thread (critical transaction initiation) or links to existing
      const existing = addToThread(groupId, senderJid)
      if (existing) return existing
      return getOrCreateThread(groupId, senderJid)
    }

    case 'price_response':
      // Links to active thread (bot responding)
      return addToThread(groupId, senderJid)

    case 'quote_calculation':
      // Links to active thread (operator response with calculation)
      return addToThread(groupId, senderJid)

    case 'volume_inquiry': {
      // May create new thread if no active one
      const existing = addToThread(groupId, senderJid)
      if (existing) return existing
      return getOrCreateThread(groupId, senderJid)
    }

    case 'negotiation':
      // Only links to active thread
      return addToThread(groupId, senderJid)

    case 'bot_command':
      // Links to active thread (client command to other bot like /compra)
      return addToThread(groupId, senderJid)

    case 'bot_confirmation':
      // Links to active thread (other bot's response like "Compra Registrada")
      return addToThread(groupId, senderJid)

    case 'confirmation': {
      // Links to active thread, then closes it
      const threadId = addToThread(groupId, senderJid)
      if (threadId) {
        closeThread(groupId, 'confirmation')
      }
      return threadId
    }

    case 'receipt': {
      // Links to active thread, then closes it
      const threadId = addToThread(groupId, senderJid)
      if (threadId) {
        closeThread(groupId, 'receipt')
      }
      return threadId
    }

    case 'tronscan': {
      // Links to active thread, then closes it
      const threadId = addToThread(groupId, senderJid)
      if (threadId) {
        closeThread(groupId, 'tronscan')
      }
      return threadId
    }

    case 'balance_report':
      // No thread linking (standalone balance info)
      return null

    case 'general':
    default:
      // No thread linking
      return null
  }
}

/**
 * Check if there's an active thread for a group.
 */
export function hasActiveThread(groupId: string): boolean {
  const thread = activeThreads.get(groupId)
  if (!thread || thread.closed) {
    return false
  }

  const now = Date.now()
  const inactiveMs = now - thread.lastActivity.getTime()
  return inactiveMs < THREAD_TIMEOUT_MS
}

/**
 * Get the active thread for a group (if any).
 */
export function getActiveThread(groupId: string): ConversationThread | null {
  const thread = activeThreads.get(groupId)
  if (!thread || thread.closed) {
    return null
  }

  const now = Date.now()
  const inactiveMs = now - thread.lastActivity.getTime()
  if (inactiveMs >= THREAD_TIMEOUT_MS) {
    return null
  }

  return thread
}

/**
 * Get all active threads (for debugging/status).
 */
export function getAllActiveThreads(): Map<string, ConversationThread> {
  return new Map(activeThreads)
}

/**
 * Serialize a thread for JSON export.
 */
export function serializeThread(thread: ConversationThread): SerializedThread {
  return {
    threadId: thread.threadId,
    groupId: thread.groupId,
    startedBy: thread.startedBy,
    startTime: thread.startTime.toISOString(),
    participants: Array.from(thread.participants),
    lastActivity: thread.lastActivity.toISOString(),
    messageCount: thread.messageCount,
    closed: thread.closed,
    closedReason: thread.closedReason,
  }
}

/**
 * Clear all threads (for testing).
 * @internal
 */
export function clearAllThreads(): void {
  activeThreads.clear()
}
