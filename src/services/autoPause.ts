/**
 * Auto-Pause Service - Story 3.2, extended by Story 3.3
 *
 * Triggers auto-pause on critical errors and queues rate-limited
 * notifications to the control group.
 *
 * Note: Actual notification sending is implemented in Epic 4 (Story 4.4).
 * This service queues notifications using the notification system.
 *
 * ACs covered (Story 3.2):
 * - AC1: Set paused state and queue notification for control group
 * - AC4: Rate limit notifications (5-minute window)
 *
 * Story 3.3 extension:
 * - Schedules auto-recovery when triggered by transient error escalation
 */

import { logger } from '../utils/logger.js'
import { setPaused } from '../bot/state.js'
import { queueControlNotification } from '../bot/notifications.js'
import { scheduleAutoRecovery } from './autoRecovery.js'

/**
 * Rate limit window for control group notifications.
 * 5 minutes = 300000ms (per AC4)
 */
export const NOTIFICATION_RATE_LIMIT_MS = 5 * 60 * 1000

/**
 * Tracks when last notification was queued for rate limiting.
 */
let lastNotificationSentAt: Date | null = null

/**
 * Options for triggerAutoPause.
 * Story 3.3: Added isTransientEscalation for auto-recovery scheduling.
 */
export interface AutoPauseOptions {
  /** If true, schedules auto-recovery after 5 minutes (Story 3.3) */
  isTransientEscalation?: boolean
  /** Additional context for logging */
  [key: string]: unknown
}

/**
 * Trigger auto-pause on critical error.
 * Sets bot to paused state and queues notification for control group (rate-limited).
 *
 * Story 3.3: If isTransientEscalation is true, schedules auto-recovery attempt.
 *
 * @param reason - Human-readable reason for the pause
 * @param options - Optional configuration including isTransientEscalation flag
 */
export function triggerAutoPause(
  reason: string,
  options?: AutoPauseOptions
): void {
  const { isTransientEscalation, ...context } = options || {}

  // Step 1: Set pause state (always happens, even if notification fails)
  setPaused(reason)

  logger.error('Auto-pause triggered', {
    event: 'auto_pause_triggered',
    reason,
    isTransientEscalation: isTransientEscalation || false,
    timestamp: new Date().toISOString(),
    ...(Object.keys(context).length > 0 && { context }),
  })

  // Step 2: Queue notification (rate-limited)
  queuePauseNotification(reason)

  // Step 3 (Story 3.3): Schedule auto-recovery if transient escalation
  if (isTransientEscalation) {
    scheduleAutoRecovery(reason)

    logger.info('Auto-pause with recovery scheduled', {
      event: 'auto_pause_with_recovery',
      reason,
      timestamp: new Date().toISOString(),
    })
  }
}

/**
 * Queue notification to control group with rate limiting.
 * Uses the notification queue system (actual sending in Epic 4 Story 4.4).
 *
 * @param reason - Reason for the pause to include in notification
 */
function queuePauseNotification(reason: string): void {
  const now = new Date()

  // Check rate limit (AC4)
  if (lastNotificationSentAt) {
    const elapsed = now.getTime() - lastNotificationSentAt.getTime()
    if (elapsed < NOTIFICATION_RATE_LIMIT_MS) {
      logger.warn('Notification rate limited', {
        event: 'notification_rate_limited',
        lastSentAt: lastNotificationSentAt.toISOString(),
        windowMs: NOTIFICATION_RATE_LIMIT_MS,
        elapsedMs: elapsed,
      })
      return
    }
  }

  // Format notification message (AC1)
  const message = `🚨 CRITICAL: ${reason}. Bot paused.`

  // Queue notification (actual sending happens in Epic 4 Story 4.4)
  queueControlNotification(message)
  lastNotificationSentAt = now

  logger.info('Auto-pause notification queued', {
    event: 'auto_pause_notification_queued',
    reason,
    timestamp: now.toISOString(),
  })
}

/**
 * Reset notification state (for testing).
 */
export function resetNotificationState(): void {
  lastNotificationSentAt = null
}

/**
 * Get last notification timestamp (for testing).
 */
export function getLastNotificationTime(): Date | null {
  return lastNotificationSentAt
}
