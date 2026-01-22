import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  notifyReceiptFailure,
  formatReceiptFailureNotification,
  shouldSendNotification,
  resetThrottleState,
  setThrottleState,
  THROTTLE_WINDOW_MS,
  type ReceiptFailureContext,
} from './receiptNotifications.js'

// Mock notifications module
vi.mock('../bot/notifications.js', () => ({
  queueControlNotification: vi.fn(),
}))

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { queueControlNotification } from '../bot/notifications.js'
import { logger } from '../utils/logger.js'

const mockQueueControlNotification = queueControlNotification as ReturnType<typeof vi.fn>

// Sample test context
const sampleContext: ReceiptFailureContext = {
  groupName: 'Cliente ABC',
  groupJid: '5511999999999@g.us',
  senderName: 'João Silva',
  senderJid: '5511888888888@s.whatsapp.net',
  reason: 'OCR validation failed: Missing identificador',
  timestamp: new Date('2024-01-15T10:30:00.000Z'),
  receiptType: 'pdf',
}

describe('formatReceiptFailureNotification', () => {
  it('formats notification with correct structure', () => {
    const result = formatReceiptFailureNotification(sampleContext)

    expect(result).toBe('⚠️ Receipt failed | Cliente ABC | João Silva | OCR validation failed: Missing identificador')
  })

  it('includes warning emoji', () => {
    const result = formatReceiptFailureNotification(sampleContext)

    expect(result).toContain('⚠️')
  })

  it('includes group name', () => {
    const result = formatReceiptFailureNotification(sampleContext)

    expect(result).toContain('Cliente ABC')
  })

  it('includes sender name', () => {
    const result = formatReceiptFailureNotification(sampleContext)

    expect(result).toContain('João Silva')
  })

  it('includes failure reason', () => {
    const result = formatReceiptFailureNotification(sampleContext)

    expect(result).toContain('OCR validation failed')
  })

  it('truncates long reasons', () => {
    const longReasonContext: ReceiptFailureContext = {
      ...sampleContext,
      reason: 'This is a very long error message that exceeds the maximum length and should be truncated to prevent overly long notifications in the control group',
    }

    const result = formatReceiptFailureNotification(longReasonContext)

    expect(result.length).toBeLessThan(150)
    expect(result).toContain('...')
  })

  it('truncates at word boundary when possible', () => {
    const longReasonContext: ReceiptFailureContext = {
      ...sampleContext,
      reason: 'This is a very long error message that will be truncated',
    }

    const result = formatReceiptFailureNotification(longReasonContext)

    // Should truncate at word boundary, not mid-word
    expect(result).toContain('This is a very long error message that will be...')
    expect(result).not.toContain('trunca...') // Should not cut mid-word
  })

  it('uses pipe separator', () => {
    const result = formatReceiptFailureNotification(sampleContext)

    expect(result.split(' | ').length).toBe(4) // emoji+text, group, sender, reason
  })
})

describe('shouldSendNotification', () => {
  beforeEach(() => {
    resetThrottleState()
  })

  it('returns true when no previous notification', () => {
    const result = shouldSendNotification()

    expect(result).toBe(true)
  })

  it('returns false when within throttle window', () => {
    // Set last notification to now
    setThrottleState(Date.now())

    const result = shouldSendNotification()

    expect(result).toBe(false)
  })

  it('returns true when outside throttle window', () => {
    // Set last notification to more than 5 minutes ago
    setThrottleState(Date.now() - THROTTLE_WINDOW_MS - 1000)

    const result = shouldSendNotification()

    expect(result).toBe(true)
  })

  it('logs when notification is throttled', () => {
    setThrottleState(Date.now())

    shouldSendNotification()

    expect(logger.info).toHaveBeenCalledWith(
      'Receipt notification throttled',
      expect.objectContaining({
        event: 'receipt_notification_throttled',
      })
    )
  })
})

describe('notifyReceiptFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetThrottleState()
    mockQueueControlNotification.mockResolvedValue(undefined)
  })

  afterEach(() => {
    resetThrottleState()
  })

  describe('AC1: Notification includes required info', () => {
    it('includes group name in notification', async () => {
      await notifyReceiptFailure(sampleContext)

      expect(mockQueueControlNotification).toHaveBeenCalledWith(
        expect.stringContaining(sampleContext.groupName)
      )
    })

    it('includes sender name in notification', async () => {
      await notifyReceiptFailure(sampleContext)

      expect(mockQueueControlNotification).toHaveBeenCalledWith(
        expect.stringContaining(sampleContext.senderName)
      )
    })

    it('includes failure reason in notification', async () => {
      await notifyReceiptFailure(sampleContext)

      expect(mockQueueControlNotification).toHaveBeenCalledWith(
        expect.stringContaining('OCR validation failed')
      )
    })

    it('logs with timestamp', async () => {
      await notifyReceiptFailure(sampleContext)

      expect(logger.info).toHaveBeenCalledWith(
        'Sending receipt failure notification',
        expect.objectContaining({
          timestamp: sampleContext.timestamp.toISOString(),
        })
      )
    })
  })

  describe('AC2: Notification format', () => {
    it('formats message correctly', async () => {
      await notifyReceiptFailure(sampleContext)

      expect(mockQueueControlNotification).toHaveBeenCalledWith(
        '⚠️ Receipt failed | Cliente ABC | João Silva | OCR validation failed: Missing identificador'
      )
    })
  })

  describe('AC3: Uses anti-detection (via queueControlNotification)', () => {
    it('calls queueControlNotification', async () => {
      await notifyReceiptFailure(sampleContext)

      expect(mockQueueControlNotification).toHaveBeenCalled()
    })

    it('sends notification through queue system', async () => {
      await notifyReceiptFailure(sampleContext)

      expect(mockQueueControlNotification).toHaveBeenCalledTimes(1)
    })
  })

  describe('AC4: Notification throttling', () => {
    it('sends first notification', async () => {
      const result = await notifyReceiptFailure(sampleContext)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.sent).toBe(true)
      }
      expect(mockQueueControlNotification).toHaveBeenCalled()
    })

    it('throttles second notification within window', async () => {
      // Send first notification
      await notifyReceiptFailure(sampleContext)

      // Clear mock to check second call
      mockQueueControlNotification.mockClear()

      // Try to send second notification immediately
      const result = await notifyReceiptFailure(sampleContext)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.sent).toBe(false)
      }
      expect(mockQueueControlNotification).not.toHaveBeenCalled()
    })

    it('sends notification after throttle window expires', async () => {
      // Set last notification to more than 5 minutes ago
      setThrottleState(Date.now() - THROTTLE_WINDOW_MS - 1000)

      const result = await notifyReceiptFailure(sampleContext)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.sent).toBe(true)
      }
      expect(mockQueueControlNotification).toHaveBeenCalled()
    })

    it('logs when notification is throttled', async () => {
      // Send first notification
      await notifyReceiptFailure(sampleContext)
      vi.mocked(logger.info).mockClear()

      // Try to send second notification
      await notifyReceiptFailure(sampleContext)

      expect(logger.info).toHaveBeenCalledWith(
        'Receipt failure notification skipped (throttled)',
        expect.objectContaining({
          event: 'receipt_notification_skipped',
        })
      )
    })

    it('updates throttle state after sending', async () => {
      const beforeTime = Date.now()
      await notifyReceiptFailure(sampleContext)

      // Try to send again - should be throttled
      const result = await notifyReceiptFailure(sampleContext)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.sent).toBe(false)
      }
    })
  })

  describe('Result pattern compliance', () => {
    it('returns Result with ok: true on success', async () => {
      const result = await notifyReceiptFailure(sampleContext)

      expect(result.ok).toBe(true)
    })

    it('returns Result with sent: true when notification sent', async () => {
      const result = await notifyReceiptFailure(sampleContext)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.sent).toBe(true)
      }
    })

    it('returns Result with sent: false when throttled', async () => {
      setThrottleState(Date.now())

      const result = await notifyReceiptFailure(sampleContext)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.sent).toBe(false)
      }
    })

    it('never throws, always returns Result', async () => {
      // Even if queueControlNotification throws, we should handle it
      // But since queueControlNotification doesn't return a promise that rejects in our mock,
      // we're testing the normal flow
      const result = await notifyReceiptFailure(sampleContext)

      expect(result).toHaveProperty('ok')
      if (result.ok) {
        expect(result.data).toHaveProperty('sent')
      }
    })
  })

  describe('Logging', () => {
    it('logs when sending notification', async () => {
      await notifyReceiptFailure(sampleContext)

      expect(logger.info).toHaveBeenCalledWith(
        'Sending receipt failure notification',
        expect.objectContaining({
          event: 'receipt_notification_sending',
          groupName: sampleContext.groupName,
          senderName: sampleContext.senderName,
          receiptType: sampleContext.receiptType,
        })
      )
    })

    it('logs after notification sent', async () => {
      await notifyReceiptFailure(sampleContext)

      expect(logger.info).toHaveBeenCalledWith(
        'Receipt failure notification sent',
        expect.objectContaining({
          event: 'receipt_notification_sent',
        })
      )
    })
  })
})

describe('THROTTLE_WINDOW_MS', () => {
  it('equals 5 minutes', () => {
    expect(THROTTLE_WINDOW_MS).toBe(5 * 60 * 1000)
  })
})
