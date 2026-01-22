/**
 * Tests for Auto-Pause Service - Story 3.2, extended by Story 3.3
 *
 * Test coverage:
 * - AC1: Auto-pause sets state and queues notification
 * - AC4: Rate limiting notifications (5-minute window)
 * - Story 3.3: Auto-recovery scheduling on transient escalation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  triggerAutoPause,
  NOTIFICATION_RATE_LIMIT_MS,
  resetNotificationState,
  getLastNotificationTime,
} from './autoPause.js'

// Mock dependencies
const mockSetPaused = vi.fn()
const mockQueueControlNotification = vi.fn()
const mockScheduleAutoRecovery = vi.fn()
const mockLoggerError = vi.fn()
const mockLoggerInfo = vi.fn()
const mockLoggerWarn = vi.fn()

vi.mock('../bot/state.js', () => ({
  setPaused: (...args: unknown[]) => mockSetPaused(...args),
}))

vi.mock('../bot/notifications.js', () => ({
  queueControlNotification: (...args: unknown[]) => mockQueueControlNotification(...args),
}))

vi.mock('./autoRecovery.js', () => ({
  scheduleAutoRecovery: (...args: unknown[]) => mockScheduleAutoRecovery(...args),
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    debug: vi.fn(),
  },
}))

describe('Auto-Pause Service - Story 3.2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetNotificationState()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // Task 2 Tests: triggerAutoPause (AC1)
  // ==========================================================================
  describe('triggerAutoPause (AC1)', () => {
    // 6.2: Test triggerAutoPause sets state to paused
    it('sets bot state to paused with reason', () => {
      triggerAutoPause('Test reason')
      expect(mockSetPaused).toHaveBeenCalledWith('Test reason')
    })

    // 6.3: Test triggerAutoPause logs auto_pause_triggered event
    it('logs auto_pause_triggered event', () => {
      triggerAutoPause('Binance failures')

      expect(mockLoggerError).toHaveBeenCalledWith(
        'Auto-pause triggered',
        expect.objectContaining({
          event: 'auto_pause_triggered',
          reason: 'Binance failures',
        })
      )
    })

    it('includes context in log when provided', () => {
      triggerAutoPause('Test reason', { source: 'binance', groupId: '123@g.us' })

      expect(mockLoggerError).toHaveBeenCalledWith(
        'Auto-pause triggered',
        expect.objectContaining({
          event: 'auto_pause_triggered',
          reason: 'Test reason',
          context: { source: 'binance', groupId: '123@g.us' },
        })
      )
    })

    it('queues notification to control group', () => {
      triggerAutoPause('Binance failures')

      expect(mockQueueControlNotification).toHaveBeenCalledWith(
        '🚨 CRITICAL: Binance failures. Bot paused.'
      )
    })

    it('logs notification queued event', () => {
      triggerAutoPause('WhatsApp logged_out')

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Auto-pause notification queued',
        expect.objectContaining({
          event: 'auto_pause_notification_queued',
          reason: 'WhatsApp logged_out',
        })
      )
    })
  })

  // ==========================================================================
  // Task 2 Tests: Rate Limiting (AC4)
  // ==========================================================================
  describe('notification rate limiting (AC4)', () => {
    // 6.4: Test notification rate limiting (first sends, second within 5min blocked)
    it('sends first notification', () => {
      triggerAutoPause('First error')
      expect(mockQueueControlNotification).toHaveBeenCalledTimes(1)
    })

    it('blocks second notification within rate limit window', () => {
      triggerAutoPause('First error')
      triggerAutoPause('Second error')

      expect(mockQueueControlNotification).toHaveBeenCalledTimes(1)
    })

    it('logs rate limited event when blocked', () => {
      triggerAutoPause('First error')
      vi.clearAllMocks()
      triggerAutoPause('Second error')

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'Notification rate limited',
        expect.objectContaining({
          event: 'notification_rate_limited',
          windowMs: NOTIFICATION_RATE_LIMIT_MS,
        })
      )
    })

    it('still sets pause state when notification is rate limited', () => {
      triggerAutoPause('First error')
      vi.clearAllMocks()
      triggerAutoPause('Second error')

      // Pause state should still be set even if notification blocked
      expect(mockSetPaused).toHaveBeenCalledWith('Second error')
    })

    // 6.5: Test notification sends after rate limit window expires
    it('sends notification after rate limit window expires', () => {
      vi.useFakeTimers()

      triggerAutoPause('First error')
      expect(mockQueueControlNotification).toHaveBeenCalledTimes(1)

      // Advance time past rate limit window
      vi.advanceTimersByTime(NOTIFICATION_RATE_LIMIT_MS + 1000)

      triggerAutoPause('Second error')
      expect(mockQueueControlNotification).toHaveBeenCalledTimes(2)
    })

    it('updates lastNotificationTime on successful queue', () => {
      expect(getLastNotificationTime()).toBeNull()

      triggerAutoPause('Test reason')

      expect(getLastNotificationTime()).not.toBeNull()
      expect(getLastNotificationTime()).toBeInstanceOf(Date)
    })
  })

  // ==========================================================================
  // Test Utilities
  // ==========================================================================
  describe('utility functions', () => {
    it('resetNotificationState clears last notification time', () => {
      triggerAutoPause('Test')
      expect(getLastNotificationTime()).not.toBeNull()

      resetNotificationState()
      expect(getLastNotificationTime()).toBeNull()
    })
  })

  // ==========================================================================
  // Constants
  // ==========================================================================
  describe('constants', () => {
    it('NOTIFICATION_RATE_LIMIT_MS is 5 minutes', () => {
      expect(NOTIFICATION_RATE_LIMIT_MS).toBe(5 * 60 * 1000) // 300000ms
    })
  })

  // ==========================================================================
  // Edge Cases: Consecutive Auto-Pause Triggers (Code Review Issue #5)
  // ==========================================================================
  describe('consecutive auto-pause triggers', () => {
    it('overwrites pause reason when triggered while already paused', () => {
      triggerAutoPause('First critical error')
      expect(mockSetPaused).toHaveBeenCalledWith('First critical error')

      vi.clearAllMocks()
      triggerAutoPause('Second critical error')
      expect(mockSetPaused).toHaveBeenCalledWith('Second critical error')
    })

    it('always sets pause state regardless of current state', () => {
      // First trigger
      triggerAutoPause('Error 1')
      // Second trigger (while already paused)
      triggerAutoPause('Error 2')
      // Third trigger (still paused)
      triggerAutoPause('Error 3')

      // All three should have called setPaused
      expect(mockSetPaused).toHaveBeenCalledTimes(3)
      expect(mockSetPaused).toHaveBeenNthCalledWith(1, 'Error 1')
      expect(mockSetPaused).toHaveBeenNthCalledWith(2, 'Error 2')
      expect(mockSetPaused).toHaveBeenNthCalledWith(3, 'Error 3')
    })

    it('logs all triggers even when paused', () => {
      triggerAutoPause('Error 1')
      triggerAutoPause('Error 2')

      // Both should log auto_pause_triggered
      expect(mockLoggerError).toHaveBeenCalledTimes(2)
    })

    it('rate limits notifications across consecutive triggers', () => {
      // Trigger multiple times rapidly
      triggerAutoPause('Error 1')
      triggerAutoPause('Error 2')
      triggerAutoPause('Error 3')

      // Only first notification should be queued
      expect(mockQueueControlNotification).toHaveBeenCalledTimes(1)
      expect(mockQueueControlNotification).toHaveBeenCalledWith(
        '🚨 CRITICAL: Error 1. Bot paused.'
      )
    })

    it('handles different error sources in sequence', () => {
      triggerAutoPause('Binance API failures', { source: 'binance' })
      triggerAutoPause('WhatsApp logged_out', { source: 'whatsapp' })

      expect(mockSetPaused).toHaveBeenNthCalledWith(1, 'Binance API failures')
      expect(mockSetPaused).toHaveBeenNthCalledWith(2, 'WhatsApp logged_out')

      // Context should be logged for both
      expect(mockLoggerError).toHaveBeenNthCalledWith(
        1,
        'Auto-pause triggered',
        expect.objectContaining({ context: { source: 'binance' } })
      )
      expect(mockLoggerError).toHaveBeenNthCalledWith(
        2,
        'Auto-pause triggered',
        expect.objectContaining({ context: { source: 'whatsapp' } })
      )
    })
  })

  // ==========================================================================
  // Story 3.3: Auto-Recovery Integration
  // ==========================================================================
  describe('auto-recovery integration (Story 3.3)', () => {
    it('schedules auto-recovery when isTransientEscalation is true', () => {
      triggerAutoPause('Binance API failures (3 in 60s)', { isTransientEscalation: true })

      expect(mockScheduleAutoRecovery).toHaveBeenCalledWith('Binance API failures (3 in 60s)')
    })

    it('does not schedule auto-recovery when isTransientEscalation is false', () => {
      triggerAutoPause('WhatsApp logged_out', { isTransientEscalation: false })

      expect(mockScheduleAutoRecovery).not.toHaveBeenCalled()
    })

    it('does not schedule auto-recovery when isTransientEscalation is not provided', () => {
      triggerAutoPause('WhatsApp logged_out')

      expect(mockScheduleAutoRecovery).not.toHaveBeenCalled()
    })

    it('does not schedule auto-recovery when options is undefined', () => {
      triggerAutoPause('WhatsApp logged_out', undefined)

      expect(mockScheduleAutoRecovery).not.toHaveBeenCalled()
    })

    it('logs auto_pause_with_recovery event when recovery scheduled', () => {
      triggerAutoPause('Binance failures', { isTransientEscalation: true })

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Auto-pause with recovery scheduled',
        expect.objectContaining({
          event: 'auto_pause_with_recovery',
          reason: 'Binance failures',
        })
      )
    })

    it('includes isTransientEscalation in auto_pause_triggered log', () => {
      triggerAutoPause('Test reason', { isTransientEscalation: true })

      expect(mockLoggerError).toHaveBeenCalledWith(
        'Auto-pause triggered',
        expect.objectContaining({
          event: 'auto_pause_triggered',
          isTransientEscalation: true,
        })
      )
    })

    it('logs isTransientEscalation: false when not set', () => {
      triggerAutoPause('Test reason')

      expect(mockLoggerError).toHaveBeenCalledWith(
        'Auto-pause triggered',
        expect.objectContaining({
          event: 'auto_pause_triggered',
          isTransientEscalation: false,
        })
      )
    })

    it('still sets pause state and queues notification when scheduling recovery', () => {
      triggerAutoPause('Binance failures', { isTransientEscalation: true })

      expect(mockSetPaused).toHaveBeenCalledWith('Binance failures')
      expect(mockQueueControlNotification).toHaveBeenCalledWith(
        '🚨 CRITICAL: Binance failures. Bot paused.'
      )
    })

    it('preserves other context when isTransientEscalation is used', () => {
      triggerAutoPause('Binance failures', {
        isTransientEscalation: true,
        source: 'binance',
        count: 3,
      })

      expect(mockLoggerError).toHaveBeenCalledWith(
        'Auto-pause triggered',
        expect.objectContaining({
          context: { source: 'binance', count: 3 },
        })
      )
    })
  })
})
