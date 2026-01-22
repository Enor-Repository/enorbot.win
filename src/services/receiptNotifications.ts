/**
 * Receipt Notifications Service
 *
 * Story 6.8 - Sends failure notifications to control group.
 * Features:
 * - Notifies CIO when receipt extraction fails
 * - Throttles notifications (5-minute window)
 * - Uses existing anti-detection messaging
 * - Silent success (no notification on success)
 */

import { logger } from '../utils/logger.js'
import { queueControlNotification } from '../bot/notifications.js'
import { ok, type Result } from '../utils/result.js'

/**
 * Receipt failure context for notifications.
 */
export interface ReceiptFailureContext {
  /** Human-readable group name */
  groupName: string
  /** WhatsApp group JID */
  groupJid: string
  /** Human-readable sender name (or phone number) */
  senderName: string
  /** WhatsApp sender JID */
  senderJid: string
  /** Failure reason (error message) */
  reason: string
  /** Timestamp when failure occurred */
  timestamp: Date
  /** Type of receipt that failed */
  receiptType: 'pdf' | 'image'
}

/**
 * Throttle window in milliseconds (5 minutes).
 */
export const THROTTLE_WINDOW_MS = 5 * 60 * 1000

/**
 * Throttle state for receipt notifications.
 *
 * NOTE: This is module-level state suitable for single-instance deployment.
 * For horizontal scaling with multiple instances, this would need to be
 * replaced with shared state (e.g., Redis) to prevent notification spam.
 */
const throttleState = {
  lastNotificationTime: 0,
}

/**
 * Check if a notification should be sent based on throttle window.
 *
 * @returns true if notification should be sent, false if throttled
 */
export function shouldSendNotification(): boolean {
  const now = Date.now()
  const timeSinceLast = now - throttleState.lastNotificationTime

  if (timeSinceLast < THROTTLE_WINDOW_MS) {
    logger.info('Receipt notification throttled', {
      event: 'receipt_notification_throttled',
      timeSinceLastMs: timeSinceLast,
      throttleWindowMs: THROTTLE_WINDOW_MS,
    })
    return false
  }

  return true
}

/**
 * Format a receipt failure notification message.
 *
 * @param context - Failure context with group, sender, and reason
 * @returns Formatted notification message
 */
export function formatReceiptFailureNotification(context: ReceiptFailureContext): string {
  // Truncate reason if too long, respecting word boundaries
  const maxReasonLength = 50
  let reason = context.reason

  if (reason.length > maxReasonLength) {
    // Find last space before the limit for cleaner truncation
    const truncated = reason.substring(0, maxReasonLength)
    const lastSpace = truncated.lastIndexOf(' ')
    reason = lastSpace > 20 ? truncated.substring(0, lastSpace) + '...' : truncated + '...'
  }

  return `⚠️ Receipt failed | ${context.groupName} | ${context.senderName} | ${reason}`
}

/**
 * Notify control group of a receipt processing failure.
 * Respects throttle window to prevent spam.
 *
 * @param context - Failure context with group, sender, and reason
 * @returns Result indicating notification was sent or throttled
 */
export async function notifyReceiptFailure(
  context: ReceiptFailureContext
): Promise<Result<{ sent: boolean }>> {
  // Check throttle
  if (!shouldSendNotification()) {
    logger.info('Receipt failure notification skipped (throttled)', {
      event: 'receipt_notification_skipped',
      groupName: context.groupName,
      senderName: context.senderName,
      reason: context.reason,
      receiptType: context.receiptType,
    })
    return ok({ sent: false })
  }

  // Update throttle state
  throttleState.lastNotificationTime = Date.now()

  // Format and send notification
  const message = formatReceiptFailureNotification(context)

  logger.info('Sending receipt failure notification', {
    event: 'receipt_notification_sending',
    groupName: context.groupName,
    groupJid: context.groupJid,
    senderName: context.senderName,
    senderJid: context.senderJid,
    reason: context.reason,
    receiptType: context.receiptType,
    timestamp: context.timestamp.toISOString(),
  })

  // Use existing notification queue (includes anti-detection)
  await queueControlNotification(message)

  logger.info('Receipt failure notification sent', {
    event: 'receipt_notification_sent',
    groupName: context.groupName,
    senderName: context.senderName,
    receiptType: context.receiptType,
  })

  return ok({ sent: true })
}

/**
 * Reset throttle state (for testing).
 */
export function resetThrottleState(): void {
  throttleState.lastNotificationTime = 0
}

/**
 * Get current throttle state (for testing).
 */
export function getThrottleState(): { lastNotificationTime: number } {
  return { ...throttleState }
}

/**
 * Set throttle state (for testing).
 */
export function setThrottleState(lastNotificationTime: number): void {
  throttleState.lastNotificationTime = lastNotificationTime
}
