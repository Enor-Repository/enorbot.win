/**
 * Transient Error Tracking Service - Story 3.3
 *
 * Tracks transient errors using a sliding window approach.
 * When 3+ transient errors occur within 60 seconds for a source,
 * the error is escalated to critical and auto-pause is triggered.
 *
 * ACs covered:
 * - AC1: Transient error counter reset on success
 * - AC2: Transient error escalation (3+ in 60s)
 */

import { logger } from '../utils/logger.js'
import { type ErrorSource, recordSuccess } from './errors.js'

// ============================================================================
// Task 1.2: Type Definitions
// ============================================================================

/**
 * Entry in the transient error sliding window.
 */
interface TransientErrorEntry {
  source: ErrorSource
  timestamp: Date
}

// ============================================================================
// Task 1.3, 1.4: Constants and State
// ============================================================================

/**
 * Window duration for transient error accumulation.
 * 60 seconds per AC2: "3+ in 60 seconds"
 */
export const TRANSIENT_WINDOW_MS = 60 * 1000

/**
 * Threshold for escalating transient → critical.
 * 3+ errors in the window per AC2.
 */
export const TRANSIENT_ESCALATION_THRESHOLD = 3

/**
 * Sliding window for transient errors.
 * Entries older than TRANSIENT_WINDOW_MS are filtered out.
 */
const transientErrorWindow: TransientErrorEntry[] = []

// ============================================================================
// Task 1.5, 1.6, 1.7, 1.9: Record Transient Error
// ============================================================================

/**
 * Record a transient error and check if escalation is needed.
 *
 * The function:
 * 1. Adds the error to the sliding window
 * 2. Filters out expired entries (>60s old)
 * 3. Counts recent errors for the given source
 * 4. Returns whether escalation threshold is reached
 *
 * @param source - The error source (binance, whatsapp, etc.)
 * @returns Object with shouldEscalate flag and current count
 */
export function recordTransientError(source: ErrorSource): {
  shouldEscalate: boolean
  count: number
} {
  const now = new Date()

  // Add new error to window
  transientErrorWindow.push({ source, timestamp: now })

  // Calculate cutoff for filtering
  const cutoff = now.getTime() - TRANSIENT_WINDOW_MS

  // Filter to recent errors for this source
  const recentForSource = transientErrorWindow.filter(
    e => e.source === source && e.timestamp.getTime() > cutoff
  )

  // Clean up old entries from window (keep window manageable)
  const validEntries = transientErrorWindow.filter(e => e.timestamp.getTime() > cutoff)
  transientErrorWindow.length = 0
  transientErrorWindow.push(...validEntries)

  const count = recentForSource.length
  const shouldEscalate = count >= TRANSIENT_ESCALATION_THRESHOLD

  // Task 1.9: Log transient_error_recorded event
  logger.warn('Transient error recorded', {
    event: 'transient_error_recorded',
    source,
    windowCount: count,
    windowMs: TRANSIENT_WINDOW_MS,
    threshold: TRANSIENT_ESCALATION_THRESHOLD,
    willEscalate: shouldEscalate,
    timestamp: now.toISOString(),
  })

  return { shouldEscalate, count }
}

// ============================================================================
// Task 1.8, 1.10: Clear Transient Errors
// ============================================================================

/**
 * Clear transient errors for a specific source.
 * Called when a successful operation occurs.
 *
 * @param source - The error source to clear
 */
export function clearTransientErrors(source: ErrorSource): void {
  // Count how many we're clearing for logging
  const previousCount = transientErrorWindow.filter(e => e.source === source).length

  // Filter out entries for this source
  const remaining = transientErrorWindow.filter(e => e.source !== source)
  transientErrorWindow.length = 0
  transientErrorWindow.push(...remaining)

  if (previousCount > 0) {
    // Task 1.10: Log transient_errors_cleared event
    logger.info('Transient errors cleared', {
      event: 'transient_errors_cleared',
      source,
      previousCount,
      timestamp: new Date().toISOString(),
    })
  }
}

// ============================================================================
// Task 2: Success Recovery Logging
// ============================================================================

/**
 * Record a successful operation for a source.
 * Clears transient errors and resets consecutive failure counter.
 * Logs recovery if there were previous transient errors.
 *
 * @param source - The error source that succeeded
 */
export function recordSuccessfulOperation(source: ErrorSource): void {
  // Check if there were previous transient errors
  const previousCount = transientErrorWindow.filter(e => e.source === source).length

  // Clear transient errors for this source
  clearTransientErrors(source)

  // Reset consecutive failure counter from errors.ts
  recordSuccess(source)

  // Task 2.3: Log recovery if there were previous errors
  if (previousCount > 0) {
    logger.info('Recovered from transient error', {
      event: 'recovered_from_transient',
      source,
      previousErrorCount: previousCount,
      timestamp: new Date().toISOString(),
    })
  }
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Get current count of transient errors for a source within window.
 * Useful for testing and monitoring.
 *
 * @param source - The error source to check
 * @returns Count of recent transient errors
 */
export function getTransientErrorCount(source: ErrorSource): number {
  const cutoff = Date.now() - TRANSIENT_WINDOW_MS
  return transientErrorWindow.filter(
    e => e.source === source && e.timestamp.getTime() > cutoff
  ).length
}

/**
 * Reset all transient error state.
 * Primarily for testing.
 */
export function resetTransientErrorState(): void {
  transientErrorWindow.length = 0
}
