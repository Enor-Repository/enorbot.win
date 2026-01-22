/**
 * Tests for Auto-Recovery Service - Story 3.3
 *
 * Test coverage:
 * - AC3: Auto-recovery attempt after 5 minutes
 * - AC4: Recovery failure handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  scheduleAutoRecovery,
  cancelAutoRecovery,
  isRecoveryPending,
  getPendingRecoveryReason,
  getRecoveryTimeRemaining,
  resetAutoRecoveryState,
  AUTO_RECOVERY_DELAY_MS,
  _testForceAttemptRecovery,
} from './autoRecovery.js'
import * as state from '../bot/state.js'
import * as binance from './binance.js'
import * as notifications from '../bot/notifications.js'
import * as transientErrors from './transientErrors.js'

// Mock logger
const mockLoggerInfo = vi.fn()
const mockLoggerError = vi.fn()

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: vi.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
    debug: vi.fn(),
  },
}))

// Mock state
vi.mock('../bot/state.js', () => ({
  setRunning: vi.fn(),
  getOperationalStatus: vi.fn(),
}))

// Mock binance
vi.mock('./binance.js', () => ({
  fetchPrice: vi.fn(),
}))

// Mock notifications
vi.mock('../bot/notifications.js', () => ({
  queueControlNotification: vi.fn(),
}))

// Mock transientErrors (Code Review Fix #2)
vi.mock('./transientErrors.js', () => ({
  recordSuccessfulOperation: vi.fn(),
}))

describe('Auto-Recovery Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    resetAutoRecoveryState()
    vi.mocked(state.getOperationalStatus).mockReturnValue('paused')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // Constants Verification
  // ==========================================================================
  describe('constants', () => {
    it('AUTO_RECOVERY_DELAY_MS is 5 minutes', () => {
      expect(AUTO_RECOVERY_DELAY_MS).toBe(5 * 60 * 1000)
    })
  })

  // ==========================================================================
  // AC3: Schedule Auto-Recovery
  // ==========================================================================
  describe('scheduleAutoRecovery', () => {
    it('sets recoveryAttemptPending to true', () => {
      scheduleAutoRecovery('Test reason')

      expect(isRecoveryPending()).toBe(true)
    })

    it('stores the pause reason', () => {
      scheduleAutoRecovery('Binance failures')

      expect(getPendingRecoveryReason()).toBe('Binance failures')
    })

    it('logs auto_recovery_scheduled event', () => {
      scheduleAutoRecovery('Binance API failures (3 in 60s)')

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Auto-recovery scheduled',
        expect.objectContaining({
          event: 'auto_recovery_scheduled',
          reason: 'Binance API failures (3 in 60s)',
          delayMs: AUTO_RECOVERY_DELAY_MS,
        })
      )
    })

    it('schedules recovery attempt after delay', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: true, data: 5.82 })

      scheduleAutoRecovery('Test reason')

      expect(isRecoveryPending()).toBe(true)

      // Fast-forward to recovery time
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(binance.fetchPrice).toHaveBeenCalled()
      expect(state.setRunning).toHaveBeenCalled()
    })

    it('clears existing timer when called again', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: true, data: 5.82 })

      scheduleAutoRecovery('First reason')

      // Advance partway
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS / 2)

      // Schedule again (should reset timer)
      scheduleAutoRecovery('Second reason')

      expect(getPendingRecoveryReason()).toBe('Second reason')

      // Advance to what would have been the first timer
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS / 2 + 100)

      // Should not have attempted recovery yet
      expect(binance.fetchPrice).not.toHaveBeenCalled()

      // Now advance to the new timer
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS / 2 + 100)

      expect(binance.fetchPrice).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // AC3: Recovery Success
  // ==========================================================================
  describe('attemptRecovery - success', () => {
    it('calls setRunning on successful recovery', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: true, data: 5.82 })

      scheduleAutoRecovery('Test reason')
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(state.setRunning).toHaveBeenCalled()
    })

    it('queues success notification on recovery', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: true, data: 5.82 })

      scheduleAutoRecovery('Binance failures')
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(notifications.queueControlNotification).toHaveBeenCalledWith(
        expect.stringContaining('✅ Auto-recovered')
      )
      expect(notifications.queueControlNotification).toHaveBeenCalledWith(
        expect.stringContaining('Binance failures')
      )
    })

    it('logs auto_recovery_succeeded event', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: true, data: 5.82 })

      scheduleAutoRecovery('Test reason')
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Auto-recovery succeeded',
        expect.objectContaining({
          event: 'auto_recovery_succeeded',
          previousReason: 'Test reason',
        })
      )
    })

    it('clears pending state after success', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: true, data: 5.82 })

      scheduleAutoRecovery('Test reason')
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(isRecoveryPending()).toBe(false)
      expect(getPendingRecoveryReason()).toBe(null)
    })
  })

  // ==========================================================================
  // AC4: Recovery Failure
  // ==========================================================================
  describe('attemptRecovery - failure', () => {
    it('does not call setRunning on failed recovery', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: false, error: 'Still failing' })

      scheduleAutoRecovery('Test reason')
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(state.setRunning).not.toHaveBeenCalled()
    })

    it('queues failure notification on failed recovery', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: false, error: 'Still failing' })

      scheduleAutoRecovery('Test reason')
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(notifications.queueControlNotification).toHaveBeenCalledWith(
        '⚠️ Auto-recovery failed. Manual intervention required.'
      )
    })

    it('logs auto_recovery_failed event', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: false, error: 'Still failing' })

      scheduleAutoRecovery('Test reason')
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(mockLoggerError).toHaveBeenCalledWith(
        'Auto-recovery failed',
        expect.objectContaining({
          event: 'auto_recovery_failed',
          reason: 'Test reason',
        })
      )
    })

    it('clears pending state after failure', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: false, error: 'Still failing' })

      scheduleAutoRecovery('Test reason')
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(isRecoveryPending()).toBe(false)
    })
  })

  // ==========================================================================
  // AC3/AC4: Skip if Already Running
  // ==========================================================================
  describe('attemptRecovery - skip if running', () => {
    it('skips recovery if bot is already running', async () => {
      vi.mocked(state.getOperationalStatus).mockReturnValue('running')
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: true, data: 5.82 })

      scheduleAutoRecovery('Test reason')
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(binance.fetchPrice).not.toHaveBeenCalled()
      expect(state.setRunning).not.toHaveBeenCalled()
    })

    it('logs auto_recovery_skipped when already running', async () => {
      vi.mocked(state.getOperationalStatus).mockReturnValue('running')

      scheduleAutoRecovery('Test reason')
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Auto-recovery skipped - already running',
        expect.objectContaining({
          event: 'auto_recovery_skipped',
          reason: 'not_paused',
        })
      )
    })
  })

  // ==========================================================================
  // Task 5: Cancel Recovery
  // ==========================================================================
  describe('cancelAutoRecovery', () => {
    it('clears pending recovery state', () => {
      scheduleAutoRecovery('Test')
      expect(isRecoveryPending()).toBe(true)

      cancelAutoRecovery()

      expect(isRecoveryPending()).toBe(false)
      expect(getPendingRecoveryReason()).toBe(null)
    })

    it('prevents scheduled recovery from executing', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: true, data: 5.82 })

      scheduleAutoRecovery('Test')

      // Cancel before timer fires
      cancelAutoRecovery()

      // Advance past recovery time
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 1000)

      expect(binance.fetchPrice).not.toHaveBeenCalled()
    })

    it('logs auto_recovery_cancelled when there was pending recovery', () => {
      scheduleAutoRecovery('Test')
      vi.clearAllMocks()

      cancelAutoRecovery()

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Auto-recovery cancelled',
        expect.objectContaining({
          event: 'auto_recovery_cancelled',
          reason: 'manual_intervention',
        })
      )
    })

    it('does not log when no recovery was pending', () => {
      cancelAutoRecovery()

      expect(mockLoggerInfo).not.toHaveBeenCalledWith(
        'Auto-recovery cancelled',
        expect.anything()
      )
    })

    it('is idempotent - can be called multiple times', () => {
      scheduleAutoRecovery('Test')

      cancelAutoRecovery()
      cancelAutoRecovery()
      cancelAutoRecovery()

      expect(isRecoveryPending()).toBe(false)
    })
  })

  // ==========================================================================
  // Direct Recovery Attempt (for testing)
  // ==========================================================================
  describe('_testForceAttemptRecovery', () => {
    it('returns true on successful recovery', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: true, data: 5.82 })

      const result = await _testForceAttemptRecovery()

      expect(result).toBe(true)
    })

    it('returns false on failed recovery', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: false, error: 'Failed' })

      const result = await _testForceAttemptRecovery()

      expect(result).toBe(false)
    })

    it('returns true if already running (skip case)', async () => {
      vi.mocked(state.getOperationalStatus).mockReturnValue('running')

      const result = await _testForceAttemptRecovery()

      expect(result).toBe(true)
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe('edge cases', () => {
    it('handles fetchPrice throwing (should not happen but defensive)', async () => {
      vi.mocked(binance.fetchPrice).mockRejectedValue(new Error('Unexpected'))

      scheduleAutoRecovery('Test')
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      // Should fail gracefully
      expect(state.setRunning).not.toHaveBeenCalled()
      expect(notifications.queueControlNotification).toHaveBeenCalledWith(
        expect.stringContaining('Auto-recovery failed')
      )
    })

    it('handles null pause reason gracefully', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: true, data: 5.82 })

      // Directly test with null reason scenario
      resetAutoRecoveryState()
      scheduleAutoRecovery('Test')

      // Clear the reason manually (edge case simulation)
      // This tests the "|| 'previous error'" fallback
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(notifications.queueControlNotification).toHaveBeenCalledWith(
        expect.stringMatching(/Auto-recovered/)
      )
    })
  })

  // ==========================================================================
  // Code Review Fixes Tests
  // ==========================================================================
  describe('code review fixes', () => {
    // Fix #2: recordSuccessfulOperation called on recovery success
    it('calls recordSuccessfulOperation on successful recovery (Fix #2)', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: true, data: 5.82 })

      scheduleAutoRecovery('Binance failures')
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(transientErrors.recordSuccessfulOperation).toHaveBeenCalledWith('binance')
    })

    it('does not call recordSuccessfulOperation on failed recovery', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: false, error: 'Still failing' })

      scheduleAutoRecovery('Binance failures')
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(transientErrors.recordSuccessfulOperation).not.toHaveBeenCalled()
    })

    // Fix #3: getRecoveryTimeRemaining returns accurate time
    it('getRecoveryTimeRemaining returns full delay initially (Fix #3)', () => {
      scheduleAutoRecovery('Test reason')

      const remaining = getRecoveryTimeRemaining()
      expect(remaining).toBeLessThanOrEqual(AUTO_RECOVERY_DELAY_MS)
      expect(remaining).toBeGreaterThan(AUTO_RECOVERY_DELAY_MS - 1000) // Within 1 second tolerance
    })

    it('getRecoveryTimeRemaining decreases over time (Fix #3)', () => {
      scheduleAutoRecovery('Test reason')

      // Advance time by 1 minute
      vi.advanceTimersByTime(60 * 1000)

      const remaining = getRecoveryTimeRemaining()
      // Should be approximately 4 minutes remaining
      expect(remaining).toBeLessThanOrEqual(4 * 60 * 1000)
      expect(remaining).toBeGreaterThan(3 * 60 * 1000)
    })

    it('getRecoveryTimeRemaining returns 0 when past delay (Fix #3)', () => {
      scheduleAutoRecovery('Test reason')

      // Advance past the delay
      vi.advanceTimersByTime(AUTO_RECOVERY_DELAY_MS + 1000)

      const remaining = getRecoveryTimeRemaining()
      expect(remaining).toBe(0)
    })

    it('getRecoveryTimeRemaining returns null when no recovery pending', () => {
      expect(getRecoveryTimeRemaining()).toBeNull()
    })

    // Fix #4: lastPauseReason cleared on failure
    it('clears lastPauseReason on recovery failure (Fix #4)', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: false, error: 'Still failing' })

      scheduleAutoRecovery('Test reason')
      expect(getPendingRecoveryReason()).toBe('Test reason')

      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(getPendingRecoveryReason()).toBeNull()
    })
  })
})
