/**
 * Tests for Transient Error Tracking Service - Story 3.3
 *
 * Test coverage:
 * - AC1: Transient error counter reset on success
 * - AC2: Transient error escalation (3+ in 60s)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  recordTransientError,
  clearTransientErrors,
  recordSuccessfulOperation,
  getTransientErrorCount,
  resetTransientErrorState,
  TRANSIENT_WINDOW_MS,
  TRANSIENT_ESCALATION_THRESHOLD,
} from './transientErrors.js'
import * as errors from './errors.js'

// Mock logger
const mockLoggerWarn = vi.fn()
const mockLoggerInfo = vi.fn()

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// Mock errors.ts recordSuccess
vi.mock('./errors.js', async () => {
  const actual = await vi.importActual('./errors.js')
  return {
    ...actual,
    recordSuccess: vi.fn(),
  }
})

describe('Transient Error Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetTransientErrorState()
  })

  // ==========================================================================
  // AC2: Transient Error Recording and Escalation
  // ==========================================================================
  describe('recordTransientError', () => {
    it('returns shouldEscalate: false for first error', () => {
      const result = recordTransientError('binance')

      expect(result.shouldEscalate).toBe(false)
      expect(result.count).toBe(1)
    })

    it('returns shouldEscalate: false for second error', () => {
      recordTransientError('binance')
      const result = recordTransientError('binance')

      expect(result.shouldEscalate).toBe(false)
      expect(result.count).toBe(2)
    })

    it('returns shouldEscalate: true at threshold (3 errors)', () => {
      recordTransientError('binance')
      recordTransientError('binance')
      const result = recordTransientError('binance')

      expect(result.shouldEscalate).toBe(true)
      expect(result.count).toBe(3)
    })

    it('returns shouldEscalate: true above threshold (4+ errors)', () => {
      recordTransientError('binance')
      recordTransientError('binance')
      recordTransientError('binance')
      const result = recordTransientError('binance')

      expect(result.shouldEscalate).toBe(true)
      expect(result.count).toBe(4)
    })

    it('filters out expired entries (>60s old)', () => {
      vi.useFakeTimers()

      recordTransientError('binance')
      recordTransientError('binance')

      // Move past the window
      vi.advanceTimersByTime(TRANSIENT_WINDOW_MS + 1000)

      const result = recordTransientError('binance')

      expect(result.count).toBe(1) // Old ones filtered out
      expect(result.shouldEscalate).toBe(false)

      vi.useRealTimers()
    })

    it('keeps entries within window', () => {
      vi.useFakeTimers()

      recordTransientError('binance')
      recordTransientError('binance')

      // Move within the window (30 seconds)
      vi.advanceTimersByTime(30000)

      const result = recordTransientError('binance')

      expect(result.count).toBe(3)
      expect(result.shouldEscalate).toBe(true)

      vi.useRealTimers()
    })

    it('tracks sources independently', () => {
      recordTransientError('binance')
      recordTransientError('binance')
      recordTransientError('whatsapp')

      // Binance should have 2, whatsapp should have 1
      const binanceResult = recordTransientError('binance')
      expect(binanceResult.count).toBe(3)
      expect(binanceResult.shouldEscalate).toBe(true)

      const whatsappResult = recordTransientError('whatsapp')
      expect(whatsappResult.count).toBe(2)
      expect(whatsappResult.shouldEscalate).toBe(false)
    })

    it('logs transient_error_recorded event', () => {
      recordTransientError('binance')

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'Transient error recorded',
        expect.objectContaining({
          event: 'transient_error_recorded',
          source: 'binance',
          windowCount: 1,
          windowMs: TRANSIENT_WINDOW_MS,
          threshold: TRANSIENT_ESCALATION_THRESHOLD,
          willEscalate: false,
        })
      )
    })

    it('logs willEscalate: true when threshold reached', () => {
      recordTransientError('binance')
      recordTransientError('binance')
      recordTransientError('binance')

      expect(mockLoggerWarn).toHaveBeenLastCalledWith(
        'Transient error recorded',
        expect.objectContaining({
          windowCount: 3,
          willEscalate: true,
        })
      )
    })
  })

  // ==========================================================================
  // AC1: Clear Transient Errors
  // ==========================================================================
  describe('clearTransientErrors', () => {
    it('removes all entries for the specified source', () => {
      recordTransientError('binance')
      recordTransientError('binance')
      recordTransientError('whatsapp')

      clearTransientErrors('binance')

      expect(getTransientErrorCount('binance')).toBe(0)
      expect(getTransientErrorCount('whatsapp')).toBe(1)
    })

    it('logs transient_errors_cleared when there were errors', () => {
      recordTransientError('binance')
      recordTransientError('binance')
      vi.clearAllMocks()

      clearTransientErrors('binance')

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Transient errors cleared',
        expect.objectContaining({
          event: 'transient_errors_cleared',
          source: 'binance',
          previousCount: 2,
        })
      )
    })

    it('does not log when there were no errors', () => {
      clearTransientErrors('binance')

      expect(mockLoggerInfo).not.toHaveBeenCalledWith(
        'Transient errors cleared',
        expect.anything()
      )
    })

    it('is idempotent - can be called multiple times', () => {
      recordTransientError('binance')

      clearTransientErrors('binance')
      clearTransientErrors('binance')

      expect(getTransientErrorCount('binance')).toBe(0)
    })
  })

  // ==========================================================================
  // AC1: Success Recovery Logging
  // ==========================================================================
  describe('recordSuccessfulOperation', () => {
    it('clears transient errors for the source', () => {
      recordTransientError('binance')
      recordTransientError('binance')

      recordSuccessfulOperation('binance')

      expect(getTransientErrorCount('binance')).toBe(0)
    })

    it('calls recordSuccess from errors.ts', () => {
      recordSuccessfulOperation('binance')

      expect(errors.recordSuccess).toHaveBeenCalledWith('binance')
    })

    it('logs recovered_from_transient when there were previous errors', () => {
      recordTransientError('binance')
      recordTransientError('binance')
      vi.clearAllMocks()

      recordSuccessfulOperation('binance')

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Recovered from transient error',
        expect.objectContaining({
          event: 'recovered_from_transient',
          source: 'binance',
          previousErrorCount: 2,
        })
      )
    })

    it('does not log recovery when there were no previous errors', () => {
      recordSuccessfulOperation('binance')

      expect(mockLoggerInfo).not.toHaveBeenCalledWith(
        'Recovered from transient error',
        expect.anything()
      )
    })

    it('handles multiple sources independently', () => {
      recordTransientError('binance')
      recordTransientError('whatsapp')
      vi.clearAllMocks()

      recordSuccessfulOperation('binance')

      expect(getTransientErrorCount('binance')).toBe(0)
      expect(getTransientErrorCount('whatsapp')).toBe(1)
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe('edge cases', () => {
    it('handles rapid consecutive errors correctly', () => {
      for (let i = 0; i < 5; i++) {
        const result = recordTransientError('binance')
        if (i < 2) {
          expect(result.shouldEscalate).toBe(false)
        } else {
          expect(result.shouldEscalate).toBe(true)
        }
      }
    })

    it('handles window boundary correctly', () => {
      vi.useFakeTimers()

      // Add 2 errors
      recordTransientError('binance')
      recordTransientError('binance')

      // Move to exactly the window boundary
      vi.advanceTimersByTime(TRANSIENT_WINDOW_MS)

      // This should count as 3 (boundary is exclusive)
      const result = recordTransientError('binance')
      // Depending on implementation, this could be 1 or 3
      // Our implementation uses > cutoff, so entries at exactly cutoff are filtered
      expect(result.count).toBe(1)

      vi.useRealTimers()
    })

    it('cleans up old entries on each record', () => {
      vi.useFakeTimers()

      // Fill up window with old entries
      recordTransientError('binance')
      recordTransientError('binance')
      recordTransientError('whatsapp')

      // Move past window
      vi.advanceTimersByTime(TRANSIENT_WINDOW_MS + 1000)

      // New error should clean up old ones
      recordTransientError('excel')

      // Only the new excel error should exist
      expect(getTransientErrorCount('binance')).toBe(0)
      expect(getTransientErrorCount('whatsapp')).toBe(0)
      expect(getTransientErrorCount('excel')).toBe(1)

      vi.useRealTimers()
    })
  })

  // ==========================================================================
  // Constants Verification
  // ==========================================================================
  describe('constants', () => {
    it('TRANSIENT_WINDOW_MS is 60 seconds', () => {
      expect(TRANSIENT_WINDOW_MS).toBe(60 * 1000)
    })

    it('TRANSIENT_ESCALATION_THRESHOLD is 3', () => {
      expect(TRANSIENT_ESCALATION_THRESHOLD).toBe(3)
    })
  })
})
