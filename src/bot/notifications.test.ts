/**
 * Tests for Notification Service - Story 4.4
 *
 * Test coverage:
 * - Task 1: Notification initialization and sending
 * - Task 2: Startup notification
 * - Task 3: Disconnection notification
 * - Task 4: Reconnection notification
 * - Task 5: Auto-recovery notification integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WASocket } from '@whiskeysockets/baileys'

// Mock dependencies using vi.hoisted
const mockSendWithAntiDetection = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('../utils/messaging.js', () => ({
  sendWithAntiDetection: mockSendWithAntiDetection,
}))

vi.mock('../utils/logger.js', () => ({
  logger: mockLogger,
}))

import {
  queueControlNotification,
  getQueuedNotifications,
  clearNotificationQueue,
  initializeNotifications,
  resetNotificationState,
  sendStartupNotification,
  sendReconnectNotification,
  sendDisconnectNotification,
  isNotificationsInitialized,
  hasHadFirstConnection,
  setHasConnectedBefore,
} from './notifications.js'

describe('Notification Service - Story 4.4', () => {
  const mockSock = {} as WASocket
  const controlGroupId = 'control-group@g.us'

  beforeEach(() => {
    vi.clearAllMocks()
    resetNotificationState()
    mockSendWithAntiDetection.mockResolvedValue({ ok: true, data: undefined })
  })

  // ==========================================================================
  // Task 1: Notification Initialization
  // ==========================================================================
  describe('Task 1: Initialization', () => {
    describe('initializeNotifications', () => {
      it('stores socket and control group ID', () => {
        initializeNotifications(mockSock, controlGroupId)
        expect(isNotificationsInitialized()).toBe(true)
      })

      it('logs initialization event', () => {
        initializeNotifications(mockSock, controlGroupId)

        expect(mockLogger.info).toHaveBeenCalledWith(
          'Notifications initialized',
          expect.objectContaining({
            event: 'notifications_initialized',
            controlGroupId,
          })
        )
      })

      it('flushes queued notifications on initialization', async () => {
        // Queue some notifications before init
        await queueControlNotification('Queued 1')
        await queueControlNotification('Queued 2')

        expect(getQueuedNotifications()).toHaveLength(2)

        // Initialize - should flush
        initializeNotifications(mockSock, controlGroupId)

        // Wait for async flush
        await new Promise(resolve => setTimeout(resolve, 10))

        expect(mockSendWithAntiDetection).toHaveBeenCalledTimes(2)
        expect(getQueuedNotifications()).toHaveLength(0)
      })
    })

    describe('queueControlNotification', () => {
      it('queues message when not initialized', async () => {
        await queueControlNotification('Test message')

        expect(getQueuedNotifications()).toContain('Test message')
        expect(mockSendWithAntiDetection).not.toHaveBeenCalled()
      })

      it('sends immediately when initialized', async () => {
        initializeNotifications(mockSock, controlGroupId)

        await queueControlNotification('Immediate message')

        expect(mockSendWithAntiDetection).toHaveBeenCalledWith(
          mockSock,
          controlGroupId,
          'Immediate message'
        )
      })

      it('uses anti-detection for sending (AC5)', async () => {
        initializeNotifications(mockSock, controlGroupId)

        await queueControlNotification('Test')

        expect(mockSendWithAntiDetection).toHaveBeenCalled()
      })

      it('logs notification_sent on success', async () => {
        initializeNotifications(mockSock, controlGroupId)

        await queueControlNotification('Test')

        expect(mockLogger.info).toHaveBeenCalledWith(
          'Control notification sent',
          expect.objectContaining({
            event: 'notification_sent',
            message: 'Test',
          })
        )
      })

      it('logs error on send failure', async () => {
        mockSendWithAntiDetection.mockResolvedValue({ ok: false, error: 'Network error' })
        initializeNotifications(mockSock, controlGroupId)

        await queueControlNotification('Test')

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Failed to send notification',
          expect.objectContaining({
            event: 'notification_send_failed',
            error: 'Network error',
          })
        )
      })
    })
  })

  // ==========================================================================
  // Task 2: Startup Notification
  // ==========================================================================
  describe('Task 2: Startup Notification (AC1)', () => {
    describe('sendStartupNotification', () => {
      it('sends "🟢 eNorBOT online" on first connection', async () => {
        initializeNotifications(mockSock, controlGroupId)

        await sendStartupNotification()

        expect(mockSendWithAntiDetection).toHaveBeenCalledWith(
          mockSock,
          controlGroupId,
          '🟢 eNorBOT online'
        )
      })

      it('only sends once (first connection only)', async () => {
        initializeNotifications(mockSock, controlGroupId)

        await sendStartupNotification()
        await sendStartupNotification()
        await sendStartupNotification()

        // Should only send once (one for startup, ignores subsequent)
        const startupCalls = mockSendWithAntiDetection.mock.calls.filter(
          call => call[2] === '🟢 eNorBOT online'
        )
        expect(startupCalls).toHaveLength(1)
      })

      it('sets hasConnectedBefore flag', async () => {
        expect(hasHadFirstConnection()).toBe(false)

        initializeNotifications(mockSock, controlGroupId)
        await sendStartupNotification()

        expect(hasHadFirstConnection()).toBe(true)
      })

      it('logs startup_notification_sent event', async () => {
        initializeNotifications(mockSock, controlGroupId)

        await sendStartupNotification()

        expect(mockLogger.info).toHaveBeenCalledWith(
          'Startup notification sent',
          expect.objectContaining({
            event: 'startup_notification_sent',
          })
        )
      })
    })
  })

  // ==========================================================================
  // Task 3: Disconnection Notification
  // ==========================================================================
  describe('Task 3: Disconnection Notification (AC2)', () => {
    describe('sendDisconnectNotification', () => {
      it('sends disconnect message with duration', async () => {
        initializeNotifications(mockSock, controlGroupId)

        await sendDisconnectNotification(35)

        expect(mockSendWithAntiDetection).toHaveBeenCalledWith(
          mockSock,
          controlGroupId,
          '🔴 Disconnected for 35s. Attempting reconnect...'
        )
      })

      it('logs disconnect_notification_sent event', async () => {
        initializeNotifications(mockSock, controlGroupId)

        await sendDisconnectNotification(45)

        expect(mockLogger.info).toHaveBeenCalledWith(
          'Disconnect notification sent',
          expect.objectContaining({
            event: 'disconnect_notification_sent',
            durationSeconds: 45,
          })
        )
      })
    })
  })

  // ==========================================================================
  // Task 4: Reconnection Notification
  // ==========================================================================
  describe('Task 4: Reconnection Notification (AC3)', () => {
    describe('sendReconnectNotification', () => {
      it('sends "🟢 Reconnected" when reconnecting', async () => {
        setHasConnectedBefore(true)
        initializeNotifications(mockSock, controlGroupId)

        await sendReconnectNotification()

        expect(mockSendWithAntiDetection).toHaveBeenCalledWith(
          mockSock,
          controlGroupId,
          '🟢 Reconnected'
        )
      })

      it('does NOT send on first connection', async () => {
        // hasConnectedBefore is false by default
        initializeNotifications(mockSock, controlGroupId)

        await sendReconnectNotification()

        // sendWithAntiDetection should not be called for reconnect message
        const reconnectCalls = mockSendWithAntiDetection.mock.calls.filter(
          call => call[2] === '🟢 Reconnected'
        )
        expect(reconnectCalls).toHaveLength(0)
      })

      it('logs reconnect_notification_sent event', async () => {
        setHasConnectedBefore(true)
        initializeNotifications(mockSock, controlGroupId)

        await sendReconnectNotification()

        expect(mockLogger.info).toHaveBeenCalledWith(
          'Reconnect notification sent',
          expect.objectContaining({
            event: 'reconnect_notification_sent',
          })
        )
      })
    })
  })

  // ==========================================================================
  // Task 5: Auto-Recovery Notification Integration
  // ==========================================================================
  describe('Task 5: Auto-Recovery Notifications (AC4)', () => {
    it('sends auto-recovery success notification', async () => {
      initializeNotifications(mockSock, controlGroupId)

      await queueControlNotification('✅ Auto-recovered from Binance API failures')

      expect(mockSendWithAntiDetection).toHaveBeenCalledWith(
        mockSock,
        controlGroupId,
        '✅ Auto-recovered from Binance API failures'
      )
    })

    it('sends auto-recovery failure notification', async () => {
      initializeNotifications(mockSock, controlGroupId)

      await queueControlNotification('⚠️ Auto-recovery failed. Manual intervention required.')

      expect(mockSendWithAntiDetection).toHaveBeenCalledWith(
        mockSock,
        controlGroupId,
        '⚠️ Auto-recovery failed. Manual intervention required.'
      )
    })
  })

  // ==========================================================================
  // Queue Operations (Backwards Compatibility)
  // ==========================================================================
  describe('Queue Operations', () => {
    describe('getQueuedNotifications', () => {
      it('returns empty array when queue is empty', () => {
        expect(getQueuedNotifications()).toEqual([])
      })

      it('returns copy of queue (not reference)', async () => {
        await queueControlNotification('Test')

        const queue1 = getQueuedNotifications()
        const queue2 = getQueuedNotifications()

        expect(queue1).not.toBe(queue2)
        expect(queue1).toEqual(queue2)
      })
    })

    describe('clearNotificationQueue', () => {
      it('clears all queued notifications', async () => {
        await queueControlNotification('Message 1')
        await queueControlNotification('Message 2')

        clearNotificationQueue()

        expect(getQueuedNotifications()).toEqual([])
      })
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe('Edge Cases', () => {
    it('handles special characters and emojis', async () => {
      initializeNotifications(mockSock, controlGroupId)

      const message = '🚨 CRITICAL: WhatsApp "logged_out" & <banned>. Bot paused.'
      await queueControlNotification(message)

      expect(mockSendWithAntiDetection).toHaveBeenCalledWith(
        mockSock,
        controlGroupId,
        message
      )
    })

    it('resetNotificationState clears everything', () => {
      initializeNotifications(mockSock, controlGroupId)
      setHasConnectedBefore(true)

      resetNotificationState()

      expect(isNotificationsInitialized()).toBe(false)
      expect(hasHadFirstConnection()).toBe(false)
      expect(getQueuedNotifications()).toEqual([])
    })
  })
})
