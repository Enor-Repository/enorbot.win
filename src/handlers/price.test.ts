import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { WASocket } from '@whiskeysockets/baileys'
import {
  handlePriceMessage,
  MAX_PRICE_RETRIES,
  RETRY_DELAY_MS,
  STALL_MESSAGE,
  sleep,
} from './price.js'
import type { RouterContext } from '../bot/router.js'

// Mock dependencies
vi.mock('../services/binance.js', () => ({
  fetchPrice: vi.fn(),
}))

vi.mock('../utils/messaging.js', () => ({
  sendWithAntiDetection: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

// Story 3.1/3.3: Mock error tracking services to isolate price handler tests
vi.mock('../services/errors.js', () => ({
  classifyBinanceError: vi.fn().mockReturnValue('transient'),
  recordFailure: vi.fn(),
  logClassifiedError: vi.fn(),
  logErrorEscalation: vi.fn(),
  getFailureCount: vi.fn().mockReturnValue(0),
  ESCALATION_THRESHOLD: 3,
}))

vi.mock('../services/transientErrors.js', () => ({
  recordTransientError: vi.fn().mockReturnValue({ shouldEscalate: false, count: 1 }),
  recordSuccessfulOperation: vi.fn(),
}))

vi.mock('../services/autoPause.js', () => ({
  triggerAutoPause: vi.fn(),
}))

vi.mock('../bot/state.js', () => ({
  recordMessageSent: vi.fn(),
}))

import { fetchPrice } from '../services/binance.js'
import { sendWithAntiDetection } from '../utils/messaging.js'
import { logger } from '../utils/logger.js'

const mockFetchPrice = fetchPrice as ReturnType<typeof vi.fn>
const mockSend = sendWithAntiDetection as ReturnType<typeof vi.fn>

describe('handlePriceMessage', () => {
  // Mock socket
  const mockSock = {} as WASocket

  // Base context for tests
  const baseContext: RouterContext = {
    groupId: '123456789@g.us',
    groupName: 'Test Group',
    message: 'preço',
    sender: 'user@s.whatsapp.net',
    isControlGroup: false,
    hasTrigger: true,
    sock: mockSock,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset Date.now for consistent timestamps in tests
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-16T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // AC3: Full Price Handler Flow
  describe('AC3: Full Price Handler Flow', () => {
    it('fetches price, formats, and sends message (happy path)', async () => {
      // Arrange
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.8234 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      // Act
      const result = await handlePriceMessage(baseContext)

      // Assert - fetchPrice called
      expect(mockFetchPrice).toHaveBeenCalledTimes(1)

      // Assert - sendWithAntiDetection called with correct args (AC3)
      expect(mockSend).toHaveBeenCalledWith(
        mockSock,
        '123456789@g.us',
        'R$5,82' // Truncated and formatted
      )

      // Assert - success result
      expect(result.ok).toBe(true)
    })

    it('sends formatted price via sendWithAntiDetection', async () => {
      // Arrange
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.82 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      // Act
      await handlePriceMessage(baseContext)

      // Assert - verify formatted price (AC1, AC2)
      expect(mockSend).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'R$5,82'
      )
    })

    it('truncates price to 2 decimal places (not rounds)', async () => {
      // Arrange - 5.829 would round to 5.83, but should truncate to 5.82
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.829 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      // Act
      await handlePriceMessage(baseContext)

      // Assert - truncation not rounding
      expect(mockSend).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'R$5,82' // Truncated, not R$5,83
      )
    })
  })

  // AC4: Handler Return Type
  describe('AC4: Handler Return Type', () => {
    it('returns {ok: true, data: {price, groupId, timestamp}} on success', async () => {
      // Arrange
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.8234 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      // Act
      const result = await handlePriceMessage(baseContext)

      // Assert - AC4 return type
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.price).toBeCloseTo(5.8234)
        expect(result.data.groupId).toBe('123456789@g.us')
        expect(result.data.timestamp).toBe('2026-01-16T12:00:00.000Z')
      }
    })

    it('includes correct groupId from context', async () => {
      // Arrange
      const customContext = { ...baseContext, groupId: '987654321@g.us' }
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.00 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      // Act
      const result = await handlePriceMessage(customContext)

      // Assert
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.groupId).toBe('987654321@g.us')
      }
    })

    it('includes ISO timestamp', async () => {
      // Arrange
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.00 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      // Act
      const result = await handlePriceMessage(baseContext)

      // Assert - timestamp is ISO format
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/)
      }
    })

    it('captures timestamp AFTER send completes (not before)', async () => {
      // Arrange - start at known time
      const startTime = new Date('2026-01-16T12:00:00.000Z')
      vi.setSystemTime(startTime)

      // Mock send to advance time when called (simulating network delay)
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.00 })
      mockSend.mockImplementation(async () => {
        // Simulate send taking 500ms
        vi.advanceTimersByTime(500)
        return { ok: true, data: undefined }
      })

      // Act
      const result = await handlePriceMessage(baseContext)

      // Assert - timestamp should be AFTER the send (500ms later)
      expect(result.ok).toBe(true)
      if (result.ok) {
        const expectedTime = new Date('2026-01-16T12:00:00.500Z').toISOString()
        expect(result.data.timestamp).toBe(expectedTime)
      }
    })
  })

  // AC5: Error Propagation (Updated for Story 2.4 - now uses retry)
  describe('AC5: Error Propagation', () => {
    it('returns error when all fetch attempts fail', async () => {
      // Arrange - all attempts fail (Story 2.4 adds retry logic)
      mockFetchPrice.mockResolvedValue({ ok: false, error: 'Binance timeout' })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      // Act - must run timers because of retry delays
      const promise = handlePriceMessage(baseContext)
      await vi.runAllTimersAsync()
      const result = await promise

      // Assert - only stall message sent (no price)
      expect(mockSend).toHaveBeenCalledTimes(1) // Only stall

      // Assert - error returned after retries exhausted
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Price unavailable after retries')
      }
    })

    it('logs error after exhausted retries', async () => {
      // Arrange
      mockFetchPrice.mockResolvedValue({ ok: false, error: 'Binance API error: 500' })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      // Act - must run timers because of retry delays
      const promise = handlePriceMessage(baseContext)
      await vi.runAllTimersAsync()
      await promise

      // Assert - final error logged (Story 2.4 logs after all retries)
      expect(logger.error).toHaveBeenCalledWith(
        'Price unavailable after retries',
        expect.objectContaining({
          event: 'price_unavailable_after_retries',
          totalAttempts: 3,
          groupId: '123456789@g.us',
        })
      )
    })

    it('returns error when message send fails', async () => {
      // Arrange
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.82 })
      mockSend.mockResolvedValue({ ok: false, error: 'Network error' })

      // Act
      const result = await handlePriceMessage(baseContext)

      // Assert - error returned
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Network error')
      }
    })

    it('logs error when message send fails', async () => {
      // Arrange
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.82 })
      mockSend.mockResolvedValue({ ok: false, error: 'Socket disconnected' })

      // Act
      await handlePriceMessage(baseContext)

      // Assert - error logged with context
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to send price response',
        expect.objectContaining({
          event: 'price_send_failed',
          error: 'Socket disconnected',
          groupId: '123456789@g.us',
          price: 5.82,
          formattedPrice: 'R$5,82',
        })
      )
    })
  })

  // Logging tests
  describe('Logging', () => {
    it('logs trigger detection on entry', async () => {
      // Arrange
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.82 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      // Act
      await handlePriceMessage(baseContext)

      // Assert
      expect(logger.info).toHaveBeenCalledWith(
        'Price trigger detected',
        expect.objectContaining({
          event: 'price_trigger_detected',
          groupId: '123456789@g.us',
          groupName: 'Test Group',
          sender: 'user@s.whatsapp.net',
          hasTrigger: true,
        })
      )
    })

    it('logs success when price response sent', async () => {
      // Arrange
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.8234 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      // Act
      await handlePriceMessage(baseContext)

      // Assert
      expect(logger.info).toHaveBeenCalledWith(
        'Price response sent',
        expect.objectContaining({
          event: 'price_response_sent',
          price: 5.8234,
          formattedPrice: 'R$5,82',
          groupId: '123456789@g.us',
        })
      )
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('handles zero price', async () => {
      // Arrange
      mockFetchPrice.mockResolvedValue({ ok: true, data: 0 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      // Act
      const result = await handlePriceMessage(baseContext)

      // Assert
      expect(mockSend).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'R$0,00'
      )
      expect(result.ok).toBe(true)
    })

    it('handles very large price', async () => {
      // Arrange
      mockFetchPrice.mockResolvedValue({ ok: true, data: 99999.99 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      // Act
      await handlePriceMessage(baseContext)

      // Assert
      expect(mockSend).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'R$99999,99'
      )
    })

    it('passes socket from context to sendWithAntiDetection', async () => {
      // Arrange
      const customSock = { customProperty: true } as unknown as WASocket
      const customContext = { ...baseContext, sock: customSock }
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.82 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      // Act
      await handlePriceMessage(customContext)

      // Assert - correct socket passed
      expect(mockSend).toHaveBeenCalledWith(
        customSock,
        expect.anything(),
        expect.anything()
      )
    })
  })

  // Story 2.4: Graceful Degradation Tests
  describe('Story 2.4: Graceful Degradation', () => {
    describe('Constants Export', () => {
      it('exports MAX_PRICE_RETRIES as 2', () => {
        expect(MAX_PRICE_RETRIES).toBe(2)
      })

      it('exports RETRY_DELAY_MS as 2000', () => {
        expect(RETRY_DELAY_MS).toBe(2000)
      })

      it('exports STALL_MESSAGE in Portuguese', () => {
        expect(STALL_MESSAGE).toBe('Um momento, verificando...')
      })
    })

    describe('sleep utility', () => {
      it('delays for specified milliseconds', async () => {
        let resolved = false
        const promise = sleep(1000).then(() => {
          resolved = true
        })

        // Promise should be pending after 500ms
        vi.advanceTimersByTime(500)
        await Promise.resolve() // flush microtasks
        expect(resolved).toBe(false)

        // Should resolve after remaining 500ms
        vi.advanceTimersByTime(500)
        await promise
        expect(resolved).toBe(true)
      })

      it('handles zero milliseconds', async () => {
        let resolved = false
        const promise = sleep(0).then(() => {
          resolved = true
        })

        // Should resolve immediately on next tick
        vi.advanceTimersByTime(0)
        await promise
        expect(resolved).toBe(true)
      })

      it('treats negative values as zero', async () => {
        let resolved = false
        const promise = sleep(-100).then(() => {
          resolved = true
        })

        // Should resolve immediately (Math.max(0, -100) = 0)
        vi.advanceTimersByTime(0)
        await promise
        expect(resolved).toBe(true)
      })
    })

    describe('AC1: Stall Message on First Failure', () => {
      it('sends stall message when first fetch fails', async () => {
        // Arrange - first fails, second succeeds
        mockFetchPrice
          .mockResolvedValueOnce({ ok: false, error: 'Timeout' })
          .mockResolvedValueOnce({ ok: true, data: 5.82 })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert - stall message was sent first
        expect(mockSend).toHaveBeenNthCalledWith(
          1,
          mockSock,
          '123456789@g.us',
          'Um momento, verificando...'
        )
      })

      it('logs price_stall_sent event', async () => {
        // Arrange
        mockFetchPrice
          .mockResolvedValueOnce({ ok: false, error: 'Binance timeout' })
          .mockResolvedValueOnce({ ok: true, data: 5.82 })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert
        expect(logger.info).toHaveBeenCalledWith(
          'Stall message sent',
          expect.objectContaining({
            event: 'price_stall_sent',
            groupId: '123456789@g.us',
            reason: 'Binance timeout',
          })
        )
      })

      it('continues with retry even if stall send fails', async () => {
        // Arrange - stall fails but retry succeeds
        mockFetchPrice
          .mockResolvedValueOnce({ ok: false, error: 'Timeout' })
          .mockResolvedValueOnce({ ok: true, data: 5.82 })
        mockSend
          .mockResolvedValueOnce({ ok: false, error: 'Stall send failed' }) // Stall fails
          .mockResolvedValueOnce({ ok: true, data: undefined }) // Price send succeeds

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        const result = await promise

        // Assert - logs warning but continues
        expect(logger.warn).toHaveBeenCalledWith(
          'Failed to send stall message',
          expect.objectContaining({
            event: 'price_stall_send_failed',
          })
        )

        // Assert - still succeeds with price
        expect(result.ok).toBe(true)
      })
    })

    describe('AC2: Retry with 2s Spacing', () => {
      it('waits RETRY_DELAY_MS between retry attempts', async () => {
        // Arrange - all fail to test full retry sequence
        mockFetchPrice.mockResolvedValue({ ok: false, error: 'Timeout' })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Track timing
        let firstRetryTime = 0
        let secondRetryTime = 0
        let fetchCallCount = 0

        mockFetchPrice.mockImplementation(async () => {
          fetchCallCount++
          if (fetchCallCount === 2) firstRetryTime = Date.now()
          if (fetchCallCount === 3) secondRetryTime = Date.now()
          return { ok: false, error: 'Timeout' }
        })

        // Act
        const startTime = Date.now()
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert - verify timing (2 seconds between retries)
        expect(firstRetryTime - startTime).toBeGreaterThanOrEqual(RETRY_DELAY_MS)
        expect(secondRetryTime - firstRetryTime).toBeGreaterThanOrEqual(RETRY_DELAY_MS)
      })

      it('logs retry attempt with attempt number', async () => {
        // Arrange
        mockFetchPrice
          .mockResolvedValueOnce({ ok: false, error: 'Timeout' })
          .mockResolvedValueOnce({ ok: true, data: 5.82 })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert
        expect(logger.warn).toHaveBeenCalledWith(
          'Price retry attempt',
          expect.objectContaining({
            event: 'price_retry_attempt',
            attempt: 1,
            maxRetries: MAX_PRICE_RETRIES,
            groupId: '123456789@g.us',
          })
        )
      })
    })

    describe('AC3: Recovery Success', () => {
      it('sends price as follow-up when retry succeeds on 2nd attempt', async () => {
        // Arrange - first fails, first retry succeeds
        mockFetchPrice
          .mockResolvedValueOnce({ ok: false, error: 'Timeout' }) // Initial
          .mockResolvedValueOnce({ ok: true, data: 5.82 }) // Retry 1
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert - price sent as follow-up (2nd send call)
        expect(mockSend).toHaveBeenNthCalledWith(
          2,
          mockSock,
          '123456789@g.us',
          'R$5,82'
        )
      })

      it('sends price as follow-up when retry succeeds on 3rd attempt', async () => {
        // Arrange - initial + retry 1 fail, retry 2 succeeds
        mockFetchPrice
          .mockResolvedValueOnce({ ok: false, error: 'Timeout' }) // Initial
          .mockResolvedValueOnce({ ok: false, error: 'Timeout' }) // Retry 1
          .mockResolvedValueOnce({ ok: true, data: 5.82 }) // Retry 2
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert - price sent as follow-up (2nd send call)
        expect(mockSend).toHaveBeenNthCalledWith(
          2,
          mockSock,
          '123456789@g.us',
          'R$5,82'
        )
      })

      it('returns recovered: true and retryCount on recovery', async () => {
        // Arrange - succeeds on retry 2
        mockFetchPrice
          .mockResolvedValueOnce({ ok: false, error: 'Timeout' })
          .mockResolvedValueOnce({ ok: false, error: 'Timeout' })
          .mockResolvedValueOnce({ ok: true, data: 5.82 })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        const result = await promise

        // Assert - AC3 return type
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.data.recovered).toBe(true)
          expect(result.data.retryCount).toBe(2)
          expect(result.data.price).toBeCloseTo(5.82)
          expect(result.data.groupId).toBe('123456789@g.us')
        }
      })

      it('logs price_recovered_after_retry event', async () => {
        // Arrange
        mockFetchPrice
          .mockResolvedValueOnce({ ok: false, error: 'Timeout' })
          .mockResolvedValueOnce({ ok: true, data: 5.82 })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert
        expect(logger.info).toHaveBeenCalledWith(
          'Recovered after retry',
          expect.objectContaining({
            event: 'price_recovered_after_retry',
            price: 5.82,
            formattedPrice: 'R$5,82',
            retryCount: 1,
            groupId: '123456789@g.us',
          })
        )
      })
    })

    describe('AC4: Exhausted Retries', () => {
      it('does NOT send price when all retries fail', async () => {
        // Arrange - all fail
        mockFetchPrice.mockResolvedValue({ ok: false, error: 'Timeout' })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert - only stall message sent, no price
        expect(mockSend).toHaveBeenCalledTimes(1) // Only stall
        expect(mockSend).toHaveBeenCalledWith(
          mockSock,
          '123456789@g.us',
          'Um momento, verificando...'
        )
      })

      it('returns error after exhausted retries', async () => {
        // Arrange
        mockFetchPrice.mockResolvedValue({ ok: false, error: 'Timeout' })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        const result = await promise

        // Assert
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error).toBe('Price unavailable after retries')
        }
      })

      it('logs price_unavailable_after_retries with total attempts', async () => {
        // Arrange
        mockFetchPrice.mockResolvedValue({ ok: false, error: 'Timeout' })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert - logs total attempts (initial + retries)
        expect(logger.error).toHaveBeenCalledWith(
          'Price unavailable after retries',
          expect.objectContaining({
            event: 'price_unavailable_after_retries',
            totalAttempts: 3, // 1 initial + 2 retries
            groupId: '123456789@g.us',
          })
        )
      })

      it('makes exactly MAX_PRICE_RETRIES + 1 fetch attempts', async () => {
        // Arrange
        mockFetchPrice.mockResolvedValue({ ok: false, error: 'Timeout' })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert - 1 initial + 2 retries = 3 total
        expect(mockFetchPrice).toHaveBeenCalledTimes(1 + MAX_PRICE_RETRIES)
      })
    })

    describe('AC5: Stall Message Format', () => {
      it('stall message is in Brazilian Portuguese', async () => {
        // Arrange
        mockFetchPrice
          .mockResolvedValueOnce({ ok: false, error: 'Timeout' })
          .mockResolvedValueOnce({ ok: true, data: 5.82 })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert - exact Portuguese text
        expect(mockSend).toHaveBeenNthCalledWith(
          1,
          expect.anything(),
          expect.anything(),
          'Um momento, verificando...'
        )
      })

      it('stall uses sendWithAntiDetection (same as price)', async () => {
        // Arrange
        mockFetchPrice
          .mockResolvedValueOnce({ ok: false, error: 'Timeout' })
          .mockResolvedValueOnce({ ok: true, data: 5.82 })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert - both stall and price use same send function
        expect(mockSend).toHaveBeenCalledTimes(2)
      })
    })

    describe('Retry Failure Logging', () => {
      it('logs each retry failure', async () => {
        // Arrange - all fail
        mockFetchPrice.mockResolvedValue({ ok: false, error: 'API Error' })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert - both retry failures logged
        expect(logger.warn).toHaveBeenCalledWith(
          'Retry failed',
          expect.objectContaining({
            event: 'price_retry_failed',
            attempt: 1,
            error: 'API Error',
          })
        )
        expect(logger.warn).toHaveBeenCalledWith(
          'Retry failed',
          expect.objectContaining({
            event: 'price_retry_failed',
            attempt: 2,
            error: 'API Error',
          })
        )
      })
    })

    describe('Recovery Send Failure', () => {
      it('returns error when price send fails during recovery', async () => {
        // Arrange - fetch fails, retry succeeds, price send fails
        mockFetchPrice
          .mockResolvedValueOnce({ ok: false, error: 'Timeout' })
          .mockResolvedValueOnce({ ok: true, data: 5.82 })
        mockSend
          .mockResolvedValueOnce({ ok: true, data: undefined }) // Stall succeeds
          .mockResolvedValueOnce({ ok: false, error: 'Network error' }) // Price fails

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        const result = await promise

        // Assert - error returned
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error).toBe('Network error')
        }
      })

      it('logs price_recovered_send_failed event', async () => {
        // Arrange - fetch fails, retry succeeds, price send fails
        mockFetchPrice
          .mockResolvedValueOnce({ ok: false, error: 'Timeout' })
          .mockResolvedValueOnce({ ok: true, data: 5.82 })
        mockSend
          .mockResolvedValueOnce({ ok: true, data: undefined }) // Stall succeeds
          .mockResolvedValueOnce({ ok: false, error: 'Network error' }) // Price fails

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert - recovery send failure logged
        expect(logger.error).toHaveBeenCalledWith(
          'Failed to send price response',
          expect.objectContaining({
            event: 'price_recovered_send_failed',
            error: 'Network error',
            groupId: '123456789@g.us',
            price: 5.82,
            retryCount: 1,
          })
        )
      })
    })

    describe('Happy Path - No Retry Needed', () => {
      it('does not send stall or retry when first attempt succeeds', async () => {
        // Arrange - immediate success
        mockFetchPrice.mockResolvedValue({ ok: true, data: 5.82 })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        await handlePriceMessage(baseContext)

        // Assert - only one fetch, one send (the price)
        expect(mockFetchPrice).toHaveBeenCalledTimes(1)
        expect(mockSend).toHaveBeenCalledTimes(1)
        expect(mockSend).toHaveBeenCalledWith(
          mockSock,
          '123456789@g.us',
          'R$5,82'
        )
      })

      it('does not include recovered/retryCount on normal success', async () => {
        // Arrange
        mockFetchPrice.mockResolvedValue({ ok: true, data: 5.82 })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const result = await handlePriceMessage(baseContext)

        // Assert - no recovery metadata
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.data.recovered).toBeUndefined()
          expect(result.data.retryCount).toBeUndefined()
        }
      })
    })
  })
})
