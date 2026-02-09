/**
 * Error Classification & Tracking Service - Story 3.1
 *
 * Classifies errors as transient (auto-recoverable) or critical (requires intervention).
 * Tracks consecutive failures per source for escalation detection.
 *
 * ACs covered:
 * - AC1: Binance transient errors (timeout, 5xx)
 * - AC2: Consecutive failure escalation (3+ → critical)
 * - AC3: WhatsApp connection drop (transient)
 * - AC4: WhatsApp critical errors (loggedOut, banned)
 * - AC5: Error logging format (NFR13)
 */

import { DisconnectReason } from '@whiskeysockets/baileys'
import { logger } from '../utils/logger.js'

// ============================================================================
// Task 1: Type Definitions (AC: #1, #2, #3, #4)
// ============================================================================

/**
 * Error classification determines system response:
 * - transient: Auto-recoverable, retry/reconnect will likely succeed
 * - critical: Requires manual intervention, auto-pause should trigger
 */
export type ErrorClassification = 'transient' | 'critical'

/**
 * Source of the error for independent tracking per integration.
 */
export type ErrorSource = 'binance' | 'whatsapp' | 'excel' | 'supabase' | 'awesomeapi' | 'tradingview'

/**
 * Fully classified error with all context required for logging (NFR13).
 */
export interface ClassifiedError {
  /** Error type identifier (e.g., 'binance_timeout', 'whatsapp_logged_out') */
  type: string
  /** Classification for response determination */
  classification: ErrorClassification
  /** Source integration that generated the error */
  source: ErrorSource
  /** ISO timestamp of when error occurred */
  timestamp: string
  /** Additional context for debugging and monitoring */
  context?: Record<string, unknown>
}

// ============================================================================
// Task 3: Error Tracker Constants and State (AC: #2)
// ============================================================================

/**
 * Number of consecutive failures before escalating transient → critical.
 * Based on Story 3.1 AC2: "3+ consecutive failures → escalate to critical"
 */
export const ESCALATION_THRESHOLD = 3

/**
 * In-memory failure tracking per source.
 * Reset on successful operations, increment on failures.
 */
const failureCounts: Record<ErrorSource, number> = {
  binance: 0,
  whatsapp: 0,
  excel: 0,
  supabase: 0,
  awesomeapi: 0,
  tradingview: 0,
}

// ============================================================================
// Task 2: Error Classifier Functions (AC: #1, #3, #4)
// ============================================================================

/**
 * Classify a Binance API error as transient or critical.
 *
 * Transient (auto-recoverable):
 * - Timeout/AbortError: Network issue, will likely resolve
 * - HTTP 5xx: Server issue, will recover
 * - Network errors: Temporary connectivity
 *
 * Critical (requires intervention):
 * - HTTP 4xx: Config bug, auth issue, rate limit
 * - Validation errors: API contract changed
 * - Parse errors (NaN): Unexpected response format
 *
 * @param error - Error message string from Binance service
 * @returns Classification for response determination
 */
export function classifyBinanceError(error: string): ErrorClassification {
  const lowerError = error.toLowerCase()

  // Transient: timeouts and AbortError (from AbortController)
  if (lowerError.includes('timeout') || lowerError.includes('aborted')) {
    return 'transient'
  }

  // Transient: 5xx server errors
  if (/5\d\d/.test(error)) {
    return 'transient'
  }

  // Critical: 4xx client errors (config/auth issues)
  if (/4\d\d/.test(error)) {
    return 'critical'
  }

  // Critical: rate limiting
  if (lowerError.includes('rate limit')) {
    return 'critical'
  }

  // Critical: validation and parse errors
  // Note: 'nan' check uses word boundary to avoid matching 'binance'
  if (lowerError.includes('invalid') || /\bnan\b/.test(lowerError)) {
    return 'critical'
  }

  // Transient: network/fetch errors
  if (lowerError.includes('network') || lowerError.includes('fetch')) {
    return 'transient'
  }

  // Transient: Node.js network error codes (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, etc.)
  if (
    lowerError.includes('econnrefused') ||
    lowerError.includes('enotfound') ||
    lowerError.includes('etimedout') ||
    lowerError.includes('econnreset') ||
    lowerError.includes('ehostunreach')
  ) {
    return 'transient'
  }

  // Default: unknown errors are transient (safer - allows retry)
  return 'transient'
}

/**
 * Classify a WhatsApp disconnect reason as transient or critical.
 *
 * Transient (auto-reconnect will handle):
 * - connectionClosed: Network issue
 * - connectionLost: Network issue
 * - timedOut: Connection timeout
 * - restartRequired: Server requested restart
 *
 * Critical (requires manual intervention):
 * - loggedOut: Session invalid, re-auth required
 * - forbidden: Banned, manual intervention needed
 * - connectionReplaced: Another session took over
 *
 * @param reason - DisconnectReason enum from Baileys
 * @returns Classification for response determination
 */
export function classifyWhatsAppError(reason: DisconnectReason): ErrorClassification {
  switch (reason) {
    case DisconnectReason.loggedOut:
    case DisconnectReason.forbidden:
    case DisconnectReason.connectionReplaced:
      return 'critical'
    default:
      return 'transient'
  }
}

// ============================================================================
// Task 3: Error Tracker Functions (AC: #2)
// ============================================================================

/**
 * Record a failure for a source and check if escalation threshold reached.
 *
 * @param source - The error source (binance, whatsapp, etc.)
 * @returns true if escalation threshold reached (3+ failures), false otherwise
 */
export function recordFailure(source: ErrorSource): boolean {
  failureCounts[source]++
  return failureCounts[source] >= ESCALATION_THRESHOLD
}

/**
 * Record a successful operation, resetting the failure counter.
 * Call this after any successful operation to prevent false escalations.
 *
 * @param source - The error source to reset
 */
export function recordSuccess(source: ErrorSource): void {
  failureCounts[source] = 0
}

/**
 * Get current failure count for a source.
 * Useful for logging and monitoring.
 *
 * @param source - The error source to check
 * @returns Current consecutive failure count
 */
export function getFailureCount(source: ErrorSource): number {
  return failureCounts[source]
}

/**
 * Reset all failure counters.
 * Primarily for testing, but can be used for system reset.
 */
export function resetAllCounters(): void {
  failureCounts.binance = 0
  failureCounts.whatsapp = 0
  failureCounts.excel = 0
  failureCounts.supabase = 0
  failureCounts.awesomeapi = 0
  failureCounts.tradingview = 0
}

// ============================================================================
// Task 4: Classified Error Logging (AC: #5 - NFR13)
// ============================================================================

/**
 * Log a classified error with full context (NFR13 compliance).
 * Uses structured JSON logger with all required fields.
 *
 * Critical errors → logger.error
 * Transient errors → logger.warn
 *
 * @param error - Fully classified error with context
 */
export function logClassifiedError(error: ClassifiedError): void {
  const logData = {
    event: 'error_classified',
    type: error.type,
    classification: error.classification,
    source: error.source,
    timestamp: error.timestamp,
    ...(error.context && { context: error.context }),
  }

  if (error.classification === 'critical') {
    logger.error('Error classified as critical', logData)
  } else {
    logger.warn('Error classified as transient', logData)
  }
}

/**
 * Log an error escalation event (transient → critical).
 * Called when consecutive failures reach ESCALATION_THRESHOLD.
 *
 * @param source - The error source being escalated
 * @param consecutiveFailures - Number of consecutive failures
 */
export function logErrorEscalation(
  source: ErrorSource,
  consecutiveFailures: number
): void {
  logger.error('Error escalated to critical', {
    event: 'error_escalated',
    source,
    from: 'transient',
    to: 'critical',
    consecutiveFailures,
    timestamp: new Date().toISOString(),
  })
}
