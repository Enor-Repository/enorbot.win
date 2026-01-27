/**
 * Notification Service - Story 4.4
 *
 * Sends notifications to the control group for status updates:
 * - AC1: Startup notification ("🟢 eNorBOT online")
 * - AC2: Disconnection notification after 30s threshold
 * - AC3: Reconnection notification
 * - AC4: Auto-recovery notifications (from Story 3.3)
 * - AC5: All notifications use anti-detection timing
 *
 * Upgraded from queue stub (Epic 3) to real sender (Epic 4).
 */

import type { WASocket } from '@whiskeysockets/baileys'
import { logger } from '../utils/logger.js'
import { sendWithAntiDetection } from '../utils/messaging.js'
// Story 7.4: Bot message logging to Supabase
import { logBotMessage } from '../services/messageHistory.js'

// =============================================================================
// Module State
// =============================================================================

/**
 * Socket reference for sending notifications.
 */
let socket: WASocket | null = null

/**
 * Control group JID for notifications.
 */
let controlGroupId: string | null = null

/**
 * Queue for notifications before socket is ready.
 * Limited to prevent unbounded growth if socket never initializes.
 */
const notificationQueue: string[] = []

/**
 * Maximum queue size to prevent unbounded memory growth.
 */
const MAX_QUEUE_SIZE = 50

/**
 * Flag to track if this is the first connection (for startup vs reconnect).
 */
let hasConnectedBefore = false

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize the notification service with socket and control group.
 * Called when WhatsApp connection is established.
 *
 * @param sock - WhatsApp socket
 * @param groupId - Control group JID
 */
export function initializeNotifications(sock: WASocket, groupId: string): void {
  socket = sock
  controlGroupId = groupId

  logger.info('Notifications initialized', {
    event: 'notifications_initialized',
    controlGroupId: groupId,
    queueLength: notificationQueue.length,
  })

  // Flush any queued notifications
  flushNotificationQueue()
}

/**
 * Flush queued notifications (send all pending).
 * Called after socket is initialized.
 */
async function flushNotificationQueue(): Promise<void> {
  if (!socket || !controlGroupId) {
    return
  }

  while (notificationQueue.length > 0) {
    const message = notificationQueue.shift()
    if (message) {
      await sendNotification(message)
    }
  }
}

// =============================================================================
// Core Notification Functions
// =============================================================================

/**
 * Queue a notification for the control group.
 * If socket is available, sends immediately.
 * If not, queues for later delivery.
 *
 * @param message - The notification message to send
 */
export async function queueControlNotification(message: string): Promise<void> {
  if (socket && controlGroupId) {
    await sendNotification(message)
  } else {
    // Socket not ready yet - queue for later (with size limit)
    if (notificationQueue.length >= MAX_QUEUE_SIZE) {
      // Drop oldest notification to make room
      const dropped = notificationQueue.shift()
      logger.warn('Notification queue full, dropping oldest', {
        event: 'notification_queue_overflow',
        dropped,
        queueLength: MAX_QUEUE_SIZE,
      })
    }
    notificationQueue.push(message)
    logger.info('Notification queued (socket not ready)', {
      event: 'notification_queued',
      message,
      queueLength: notificationQueue.length,
    })
  }
}

/**
 * Send a notification to the control group.
 * Uses anti-detection timing (AC5).
 *
 * @param message - The notification message to send
 */
async function sendNotification(message: string): Promise<void> {
  if (!socket || !controlGroupId) {
    logger.error('Cannot send notification - not initialized', {
      event: 'notification_send_error',
      message,
      hasSocket: !!socket,
      hasControlGroup: !!controlGroupId,
    })
    return
  }

  const result = await sendWithAntiDetection(socket, controlGroupId, message)

  if (result.ok) {
    // Story 7.4 AC3: Log notification to history
    logBotMessage({
      groupJid: controlGroupId,
      content: message,
      messageType: 'notification',
      isControlGroup: true,
    })

    logger.info('Control notification sent', {
      event: 'notification_sent',
      message,
    })
  } else {
    logger.error('Failed to send notification', {
      event: 'notification_send_failed',
      message,
      error: result.error,
    })
  }
}

// =============================================================================
// Connection Lifecycle Notifications
// =============================================================================

/**
 * Send startup notification ("🟢 eNorBOT online").
 * Only sent on first connection, not reconnect.
 *
 * @returns Promise that resolves when notification is sent or skipped
 */
export async function sendStartupNotification(): Promise<void> {
  if (hasConnectedBefore) {
    return // Not first connect - skip
  }

  hasConnectedBefore = true
  await queueControlNotification('🟢 eNorBOT online')

  logger.info('Startup notification sent', {
    event: 'startup_notification_sent',
  })
}

/**
 * Send reconnection notification ("🟢 Reconnected").
 * Only sent if we were previously connected (not first connection).
 *
 * @returns Promise that resolves when notification is sent or skipped
 */
export async function sendReconnectNotification(): Promise<void> {
  if (!hasConnectedBefore) {
    return // First connect - don't send reconnect
  }

  await queueControlNotification('🟢 Reconnected')

  logger.info('Reconnect notification sent', {
    event: 'reconnect_notification_sent',
  })
}

/**
 * Send disconnection notification.
 * Called when disconnection persists beyond threshold.
 *
 * @param durationSeconds - How long we've been disconnected
 */
export async function sendDisconnectNotification(durationSeconds: number): Promise<void> {
  await queueControlNotification(
    `🔴 Disconnected for ${durationSeconds}s. Attempting reconnect...`
  )

  logger.info('Disconnect notification sent', {
    event: 'disconnect_notification_sent',
    durationSeconds,
  })
}

// =============================================================================
// Testing Utilities
// =============================================================================

/**
 * Get all queued notifications (for testing/debugging).
 */
export function getQueuedNotifications(): string[] {
  return [...notificationQueue]
}

/**
 * Clear the notification queue (for testing/debugging).
 */
export function clearNotificationQueue(): void {
  notificationQueue.length = 0
}

/**
 * Reset notification state (for testing).
 */
export function resetNotificationState(): void {
  socket = null
  controlGroupId = null
  notificationQueue.length = 0
  hasConnectedBefore = false
}

/**
 * Check if notifications are initialized.
 */
export function isNotificationsInitialized(): boolean {
  return socket !== null && controlGroupId !== null
}

/**
 * Check if first connection has occurred.
 */
export function hasHadFirstConnection(): boolean {
  return hasConnectedBefore
}

/**
 * Set first connection flag (for testing).
 */
export function setHasConnectedBefore(value: boolean): void {
  hasConnectedBefore = value
}
