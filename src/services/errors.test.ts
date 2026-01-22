/**
 * Tests for Error Classification & Tracking Service - Story 3.1
 *
 * Test coverage:
 * - AC1: Binance transient errors (timeout, 5xx)
 * - AC2: Consecutive failure escalation (3+ → critical)
 * - AC3: WhatsApp connection drop (transient)
 * - AC4: WhatsApp critical errors (loggedOut, banned)
 * - AC5: Error logging format (NFR13)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DisconnectReason } from '@whiskeysockets/baileys'
import {
  classifyBinanceError,
  classifyWhatsAppError,
  recordFailure,
  recordSuccess,
  getFailureCount,
  resetAllCounters,
  logClassifiedError,
  logErrorEscalation,
  ESCALATION_THRESHOLD,
  type ErrorClassification,
  type ErrorSource,
  type ClassifiedError,
} from './errors.js'

// Mock logger to capture log calls
const mockLoggerWarn = vi.fn()
const mockLoggerError = vi.fn()

vi.mock('../utils/logger.js', () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

describe('Error Classification Service - Story 3.1', () => {
  beforeEach(() => {
    resetAllCounters()
    vi.clearAllMocks()
  })

  // ==========================================================================
  // Task 1 Tests: Type Exports (AC: #1, #2, #3, #4)
  // ==========================================================================
  describe('Task 1: Type Exports', () => {
    it('exports ESCALATION_THRESHOLD constant', () => {
      expect(ESCALATION_THRESHOLD).toBe(3)
    })

    it('ErrorClassification type allows transient and critical', () => {
      const transient: ErrorClassification = 'transient'
      const critical: ErrorClassification = 'critical'
      expect(transient).toBe('transient')
      expect(critical).toBe('critical')
    })

    it('ErrorSource type allows all source values', () => {
      const sources: ErrorSource[] = ['binance', 'whatsapp', 'excel', 'supabase']
      expect(sources).toHaveLength(4)
    })
  })

  // ==========================================================================
  // Task 2 Tests: Binance Error Classification (AC: #1)
  // ==========================================================================
  describe('Task 2: classifyBinanceError (AC1)', () => {
    // 6.2: Test Binance timeout → transient
    it('classifies "Binance timeout" as transient', () => {
      expect(classifyBinanceError('Binance timeout')).toBe('transient')
    })

    it('classifies AbortError/aborted as transient', () => {
      expect(classifyBinanceError('Request aborted')).toBe('transient')
      expect(classifyBinanceError('AbortError: signal is aborted')).toBe('transient')
    })

    // 6.3: Test Binance 5xx errors → transient
    it('classifies 500 server error as transient', () => {
      expect(classifyBinanceError('Binance API error: 500')).toBe('transient')
    })

    it('classifies 502 bad gateway as transient', () => {
      expect(classifyBinanceError('Error 502 Bad Gateway')).toBe('transient')
    })

    it('classifies 503 service unavailable as transient', () => {
      expect(classifyBinanceError('503 Service Unavailable')).toBe('transient')
    })

    it('classifies 504 gateway timeout as transient', () => {
      expect(classifyBinanceError('504 Gateway Timeout')).toBe('transient')
    })

    // 6.4: Test Binance 4xx errors → critical
    it('classifies 400 bad request as critical', () => {
      expect(classifyBinanceError('Binance API error: 400')).toBe('critical')
    })

    it('classifies 401 unauthorized as critical', () => {
      expect(classifyBinanceError('401 Unauthorized')).toBe('critical')
    })

    it('classifies 403 forbidden as critical', () => {
      expect(classifyBinanceError('403 Forbidden')).toBe('critical')
    })

    it('classifies 404 not found as critical', () => {
      expect(classifyBinanceError('Binance API error: 404')).toBe('critical')
    })

    it('classifies 429 rate limit as critical', () => {
      expect(classifyBinanceError('429 Too Many Requests')).toBe('critical')
      expect(classifyBinanceError('rate limit exceeded')).toBe('critical')
    })

    it('classifies validation errors as critical', () => {
      expect(classifyBinanceError('Invalid Binance response format')).toBe('critical')
    })

    it('classifies NaN parse errors as critical', () => {
      expect(classifyBinanceError('Price is NaN')).toBe('critical')
      expect(classifyBinanceError('nan value detected')).toBe('critical')
    })

    it('classifies network errors as transient', () => {
      expect(classifyBinanceError('Network error')).toBe('transient')
      expect(classifyBinanceError('fetch failed')).toBe('transient')
    })

    it('classifies Node.js network error codes as transient', () => {
      expect(classifyBinanceError('ECONNREFUSED')).toBe('transient')
      expect(classifyBinanceError('getaddrinfo ENOTFOUND api.binance.com')).toBe('transient')
      expect(classifyBinanceError('connect ETIMEDOUT')).toBe('transient')
      expect(classifyBinanceError('ECONNRESET')).toBe('transient')
      expect(classifyBinanceError('EHOSTUNREACH')).toBe('transient')
    })

    it('classifies unknown errors as transient (default safe)', () => {
      expect(classifyBinanceError('Something weird happened')).toBe('transient')
      expect(classifyBinanceError('')).toBe('transient')
    })

    it('is case-insensitive for timeout detection', () => {
      expect(classifyBinanceError('TIMEOUT')).toBe('transient')
      expect(classifyBinanceError('TimeOut occurred')).toBe('transient')
    })
  })

  // ==========================================================================
  // Task 2 Tests: WhatsApp Error Classification (AC: #3, #4)
  // ==========================================================================
  describe('Task 2: classifyWhatsAppError (AC3, AC4)', () => {
    // 6.5: Test WhatsApp loggedOut → critical
    it('classifies loggedOut as critical', () => {
      expect(classifyWhatsAppError(DisconnectReason.loggedOut)).toBe('critical')
    })

    // 6.6: Test WhatsApp banned → critical
    it('classifies forbidden (banned) as critical', () => {
      expect(classifyWhatsAppError(DisconnectReason.forbidden)).toBe('critical')
    })

    it('classifies connectionReplaced as critical', () => {
      expect(classifyWhatsAppError(DisconnectReason.connectionReplaced)).toBe('critical')
    })

    // 6.7: Test WhatsApp connection drop → transient
    it('classifies connectionClosed as transient', () => {
      expect(classifyWhatsAppError(DisconnectReason.connectionClosed)).toBe('transient')
    })

    it('classifies connectionLost as transient', () => {
      expect(classifyWhatsAppError(DisconnectReason.connectionLost)).toBe('transient')
    })

    it('classifies timedOut as transient', () => {
      expect(classifyWhatsAppError(DisconnectReason.timedOut)).toBe('transient')
    })

    it('classifies restartRequired as transient', () => {
      expect(classifyWhatsAppError(DisconnectReason.restartRequired)).toBe('transient')
    })

    it('classifies badSession as transient (default)', () => {
      expect(classifyWhatsAppError(DisconnectReason.badSession)).toBe('transient')
    })

    it('classifies unknown reasons as transient (default safe)', () => {
      // Using a numeric value that might not be in the enum
      expect(classifyWhatsAppError(999 as DisconnectReason)).toBe('transient')
    })

    it('classifies undefined as transient (edge case from connection.ts)', () => {
      // When lastDisconnect?.error is undefined, statusCode is undefined
      // The connection.ts handler now checks for this, but classifier should be safe
      expect(classifyWhatsAppError(undefined as unknown as DisconnectReason)).toBe('transient')
    })
  })

  // ==========================================================================
  // Task 3 Tests: Error Tracker (AC: #2)
  // ==========================================================================
  describe('Task 3: Error Tracker (AC2)', () => {
    // 6.8: Test consecutive failure escalation (3+ → critical)
    it('does not escalate on first failure', () => {
      expect(recordFailure('binance')).toBe(false)
      expect(getFailureCount('binance')).toBe(1)
    })

    it('does not escalate on second failure', () => {
      recordFailure('binance')
      expect(recordFailure('binance')).toBe(false)
      expect(getFailureCount('binance')).toBe(2)
    })

    it('escalates on third consecutive failure', () => {
      recordFailure('binance')
      recordFailure('binance')
      expect(recordFailure('binance')).toBe(true) // 3rd failure → escalate!
      expect(getFailureCount('binance')).toBe(3)
    })

    it('continues to return true after escalation', () => {
      recordFailure('binance')
      recordFailure('binance')
      recordFailure('binance')
      expect(recordFailure('binance')).toBe(true) // 4th
      expect(recordFailure('binance')).toBe(true) // 5th
    })

    // 6.9: Test success resets failure counter
    it('resets counter on success', () => {
      recordFailure('binance')
      recordFailure('binance')
      expect(getFailureCount('binance')).toBe(2)
      recordSuccess('binance')
      expect(getFailureCount('binance')).toBe(0)
    })

    it('does not escalate after success reset', () => {
      recordFailure('binance')
      recordFailure('binance')
      recordSuccess('binance') // Reset
      expect(recordFailure('binance')).toBe(false) // Back to 1
      expect(recordFailure('binance')).toBe(false) // 2
      expect(recordFailure('binance')).toBe(true)  // 3 → escalate again
    })

    it('tracks failures per source independently', () => {
      recordFailure('binance')
      recordFailure('binance')
      recordFailure('whatsapp')

      expect(getFailureCount('binance')).toBe(2)
      expect(getFailureCount('whatsapp')).toBe(1)
      expect(getFailureCount('excel')).toBe(0)
      expect(getFailureCount('supabase')).toBe(0)
    })

    it('resets only the specified source on success', () => {
      recordFailure('binance')
      recordFailure('binance')
      recordFailure('whatsapp')

      recordSuccess('binance')

      expect(getFailureCount('binance')).toBe(0)
      expect(getFailureCount('whatsapp')).toBe(1) // Not affected
    })

    it('resetAllCounters resets all sources', () => {
      recordFailure('binance')
      recordFailure('whatsapp')
      recordFailure('excel')
      recordFailure('supabase')

      resetAllCounters()

      expect(getFailureCount('binance')).toBe(0)
      expect(getFailureCount('whatsapp')).toBe(0)
      expect(getFailureCount('excel')).toBe(0)
      expect(getFailureCount('supabase')).toBe(0)
    })
  })

  // ==========================================================================
  // Task 4 Tests: Classified Error Logging (AC: #5)
  // ==========================================================================
  describe('Task 4: logClassifiedError (AC5)', () => {
    // 6.10: Test error logging format includes all required fields
    it('logs transient errors with warn level', () => {
      const error: ClassifiedError = {
        type: 'binance_timeout',
        classification: 'transient',
        source: 'binance',
        timestamp: '2026-01-16T12:00:00.000Z',
      }

      logClassifiedError(error)

      expect(mockLoggerWarn).toHaveBeenCalledTimes(1)
      expect(mockLoggerError).not.toHaveBeenCalled()
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'Error classified as transient',
        expect.objectContaining({
          event: 'error_classified',
          type: 'binance_timeout',
          classification: 'transient',
          source: 'binance',
          timestamp: '2026-01-16T12:00:00.000Z',
        })
      )
    })

    it('logs critical errors with error level', () => {
      const error: ClassifiedError = {
        type: 'whatsapp_logged_out',
        classification: 'critical',
        source: 'whatsapp',
        timestamp: '2026-01-16T12:00:00.000Z',
      }

      logClassifiedError(error)

      expect(mockLoggerError).toHaveBeenCalledTimes(1)
      expect(mockLoggerWarn).not.toHaveBeenCalled()
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error classified as critical',
        expect.objectContaining({
          event: 'error_classified',
          type: 'whatsapp_logged_out',
          classification: 'critical',
          source: 'whatsapp',
          timestamp: '2026-01-16T12:00:00.000Z',
        })
      )
    })

    it('includes context when provided', () => {
      const error: ClassifiedError = {
        type: 'binance_timeout',
        classification: 'transient',
        source: 'binance',
        timestamp: '2026-01-16T12:00:00.000Z',
        context: { groupId: 'group123', latencyMs: 2500 },
      }

      logClassifiedError(error)

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'Error classified as transient',
        expect.objectContaining({
          event: 'error_classified',
          context: { groupId: 'group123', latencyMs: 2500 },
        })
      )
    })

    it('does not include context key when not provided', () => {
      const error: ClassifiedError = {
        type: 'binance_timeout',
        classification: 'transient',
        source: 'binance',
        timestamp: '2026-01-16T12:00:00.000Z',
      }

      logClassifiedError(error)

      const logCall = mockLoggerWarn.mock.calls[0]
      expect(logCall[1]).not.toHaveProperty('context')
    })
  })

  // ==========================================================================
  // Task 4 Tests: Escalation Logging (AC: #2)
  // ==========================================================================
  describe('Task 4: logErrorEscalation (AC2)', () => {
    // 6.11: Test escalation logging (from transient to critical)
    it('logs escalation with correct event fields', () => {
      logErrorEscalation('binance', 3)

      expect(mockLoggerError).toHaveBeenCalledTimes(1)
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error escalated to critical',
        expect.objectContaining({
          event: 'error_escalated',
          source: 'binance',
          from: 'transient',
          to: 'critical',
          consecutiveFailures: 3,
        })
      )
    })

    it('includes timestamp in escalation log', () => {
      logErrorEscalation('whatsapp', 5)

      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error escalated to critical',
        expect.objectContaining({
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
        })
      )
    })

    it('logs correct source in escalation', () => {
      logErrorEscalation('excel', 3)

      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error escalated to critical',
        expect.objectContaining({
          source: 'excel',
        })
      )
    })
  })

  // ==========================================================================
  // Integration Tests: Full Classification Flow
  // ==========================================================================
  describe('Integration: Classification + Tracking + Logging', () => {
    it('full flow: classify transient error, track failure, log without escalation', () => {
      const error = 'Binance timeout'
      const classification = classifyBinanceError(error)
      const shouldEscalate = recordFailure('binance')

      logClassifiedError({
        type: 'binance_timeout',
        classification,
        source: 'binance',
        timestamp: new Date().toISOString(),
      })

      expect(classification).toBe('transient')
      expect(shouldEscalate).toBe(false)
      expect(mockLoggerWarn).toHaveBeenCalled()
      expect(mockLoggerError).not.toHaveBeenCalled()
    })

    it('full flow: 3 failures → escalation logged', () => {
      // Simulate 3 consecutive failures
      for (let i = 0; i < 3; i++) {
        const shouldEscalate = recordFailure('binance')
        if (shouldEscalate) {
          logErrorEscalation('binance', getFailureCount('binance'))
        }
      }

      // Should have logged escalation on 3rd failure
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error escalated to critical',
        expect.objectContaining({
          event: 'error_escalated',
          consecutiveFailures: 3,
        })
      )
    })

    it('full flow: success resets escalation path', () => {
      // 2 failures
      recordFailure('binance')
      recordFailure('binance')

      // Success resets
      recordSuccess('binance')

      // 2 more failures - should NOT escalate yet
      expect(recordFailure('binance')).toBe(false)
      expect(recordFailure('binance')).toBe(false)

      // 3rd after reset - NOW escalates
      expect(recordFailure('binance')).toBe(true)
    })
  })
})
