/**
 * Auto-Recovery Service - Story 3.3
 *
 * Orchestrates automatic recovery from transient error escalations.
 * After 5 minutes of auto-pause due to transient errors, attempts
 * to recover by performing a health check.
 *
 * ACs covered:
 * - AC3: Auto-recovery attempt after 5 minutes
 * - AC4: Recovery failure handling
 */

import { logger } from '../utils/logger.js'
import { setRunning, getOperationalStatus } from '../bot/state.js'
import { queueControlNotification } from '../bot/notifications.js'
import { fetchPrice } from './binance.js'
import { recordSuccessfulOperation } from './transientErrors.js'

// ============================================================================
// Task 3.2: Constants
// ============================================================================

/**
 * Delay before auto-recovery attempt.
 * 5 minutes per AC3.
 */
export const AUTO_RECOVERY_DELAY_MS = 5 * 60 * 1000

// ============================================================================
// Task 3.3, 3.4: State Variables
// ============================================================================

/**
 * Timer for pending auto-recovery.
 */
let autoRecoveryTimer: NodeJS.Timeout | null = null

/**
 * Flag indicating if a recovery attempt is pending.
 */
let recoveryAttemptPending = false

/**
 * Reason for the pause that triggered recovery scheduling.
 */
let lastPauseReason: string | null = null

/**
 * Timestamp when recovery was scheduled (for accurate time remaining calculation).
 */
let scheduledAt: Date | null = null

// ============================================================================
// Task 3.5, 3.6, 3.7, 3.8: Schedule Auto-Recovery
// ============================================================================

/**
 * Schedule an auto-recovery attempt after the configured delay.
 * Called when auto-pause is triggered due to transient error escalation.
 *
 * @param pauseReason - The reason for the pause (for logging and notification)
 */
export function scheduleAutoRecovery(pauseReason: string): void {
  // Clear any existing timer (Task 3.6)
  if (autoRecoveryTimer) {
    clearTimeout(autoRecoveryTimer)
  }

  lastPauseReason = pauseReason
  recoveryAttemptPending = true
  scheduledAt = new Date()

  const recoverAt = new Date(scheduledAt.getTime() + AUTO_RECOVERY_DELAY_MS)

  // Task 3.8: Log auto_recovery_scheduled event
  logger.info('Auto-recovery scheduled', {
    event: 'auto_recovery_scheduled',
    reason: pauseReason,
    scheduledAt: scheduledAt.toISOString(),
    recoverAt: recoverAt.toISOString(),
    delayMs: AUTO_RECOVERY_DELAY_MS,
  })

  // Task 3.7: Schedule the recovery attempt
  autoRecoveryTimer = setTimeout(async () => {
    await attemptRecovery()
  }, AUTO_RECOVERY_DELAY_MS)
}

// ============================================================================
// Task 4: Recovery Attempt Logic
// ============================================================================

/**
 * Attempt to recover from paused state.
 * Performs health check (Binance API ping) and resumes if successful.
 *
 * @returns Promise<boolean> - true if recovery succeeded, false otherwise
 */
export async function attemptRecovery(): Promise<boolean> {
  // Check if still paused (Task 4.3 edge case)
  if (getOperationalStatus() !== 'paused') {
    logger.info('Auto-recovery skipped - already running', {
      event: 'auto_recovery_skipped',
      reason: 'not_paused',
      timestamp: new Date().toISOString(),
    })
    recoveryAttemptPending = false
    autoRecoveryTimer = null
    return true
  }

  // Task 4.4: Log auto_recovery_attempting event
  logger.info('Attempting auto-recovery', {
    event: 'auto_recovery_attempting',
    pauseReason: lastPauseReason,
    timestamp: new Date().toISOString(),
  })

  // Task 4.2: Perform health check (Binance ping)
  let recoverySuccessful = false

  try {
    const priceResult = await fetchPrice()
    if (priceResult.ok) {
      recoverySuccessful = true
    }
  } catch {
    // fetchPrice should never throw (returns Result), but handle just in case
    recoverySuccessful = false
  }

  // Task 4.10: Clear recovery state
  recoveryAttemptPending = false
  autoRecoveryTimer = null

  if (recoverySuccessful) {
    // Task 4.5: Call setRunning on success
    setRunning()

    // Code Review Fix #2: Clear transient error window to prevent immediate re-escalation
    recordSuccessfulOperation('binance')

    // Task 4.7: Queue success notification
    const message = `✅ Auto-recovered from ${lastPauseReason || 'previous error'}`
    queueControlNotification(message)

    // Task 4.6: Log auto_recovery_succeeded event
    logger.info('Auto-recovery succeeded', {
      event: 'auto_recovery_succeeded',
      previousReason: lastPauseReason,
      timestamp: new Date().toISOString(),
    })

    lastPauseReason = null
    scheduledAt = null
    return true
  } else {
    // Task 4.9: Queue failure notification
    const message = '⚠️ Auto-recovery failed. Manual intervention required.'
    queueControlNotification(message)

    // Task 4.8: Log auto_recovery_failed event
    logger.error('Auto-recovery failed', {
      event: 'auto_recovery_failed',
      reason: lastPauseReason,
      timestamp: new Date().toISOString(),
    })

    // Code Review Fix #4: Clear state to prevent stale data
    lastPauseReason = null
    scheduledAt = null

    return false
  }
}

// ============================================================================
// Task 5: Cancel Recovery on Manual Intervention
// ============================================================================

/**
 * Cancel any pending auto-recovery.
 * Called when manual intervention occurs (e.g., resume command in Epic 4).
 */
export function cancelAutoRecovery(): void {
  // Task 5.2: Clear timer if active
  if (autoRecoveryTimer) {
    clearTimeout(autoRecoveryTimer)
    autoRecoveryTimer = null
  }

  // Task 5.4: Log cancellation if there was a pending recovery
  if (recoveryAttemptPending) {
    logger.info('Auto-recovery cancelled', {
      event: 'auto_recovery_cancelled',
      reason: 'manual_intervention',
      timestamp: new Date().toISOString(),
    })
  }

  // Task 5.3: Clear pending flag
  recoveryAttemptPending = false
  lastPauseReason = null
  scheduledAt = null
}

/**
 * Check if a recovery attempt is pending.
 * Useful for status command (Epic 4 Story 4.3).
 *
 * @returns true if recovery is scheduled, false otherwise
 */
export function isRecoveryPending(): boolean {
  return recoveryAttemptPending
}

/**
 * Get the time remaining until recovery attempt (in milliseconds).
 * Returns null if no recovery is pending.
 * Useful for status command (Epic 4 Story 4.3).
 */
export function getRecoveryTimeRemaining(): number | null {
  if (!recoveryAttemptPending || !scheduledAt) {
    return null
  }
  // Code Review Fix #3: Compute actual remaining time instead of returning static value
  const elapsed = Date.now() - scheduledAt.getTime()
  const remaining = AUTO_RECOVERY_DELAY_MS - elapsed
  return Math.max(0, remaining)
}

/**
 * Get the reason for the pending recovery.
 * Useful for status command (Epic 4 Story 4.3).
 */
export function getPendingRecoveryReason(): string | null {
  return lastPauseReason
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Reset auto-recovery state.
 * Primarily for testing.
 */
export function resetAutoRecoveryState(): void {
  cancelAutoRecovery()
}

/**
 * Force trigger recovery attempt immediately (for testing).
 * WARNING: Only use in tests.
 */
export async function _testForceAttemptRecovery(): Promise<boolean> {
  return attemptRecovery()
}
