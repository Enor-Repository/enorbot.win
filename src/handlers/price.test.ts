import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { WASocket } from '@whiskeysockets/baileys'
import {
  handlePriceMessage,
  MAX_PRICE_RETRIES,
  RETRY_DELAY_MS,
  sleep,
} from './price.js'
import type { RouterContext } from '../bot/router.js'

// Mock dependencies
vi.mock('../services/binance.js', () => ({
  fetchPrice: vi.fn(),
}))

vi.mock('../services/awesomeapi.js', () => ({
  fetchCommercialDollar: vi.fn().mockResolvedValue({ ok: false, error: 'not configured' }),
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

// H2 fix: Mock group spread service (default: no spread applied)
vi.mock('../services/groupSpreadService.js', () => ({
  getSpreadConfig: vi.fn().mockResolvedValue({
    ok: true,
    data: {
      groupJid: '123456789@g.us',
      spreadMode: 'bps',
      sellSpread: 0,
      buySpread: 0,
      quoteTtlSeconds: 180,
      defaultSide: 'client_buys_usdt',
      defaultCurrency: 'BRL',
      language: 'pt-BR',
      dealFlowMode: 'classic',
      operatorJid: null,
      amountTimeoutSeconds: 60,
      groupLanguage: 'pt',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  }),
  calculateQuote: vi.fn().mockImplementation((binanceRate: number) => binanceRate),
}))

// Sprint 2: Mock rule service (default: no active rule)
vi.mock('../services/ruleService.js', () => ({
  getActiveRule: vi.fn().mockResolvedValue({ ok: true, data: null }),
}))

vi.mock('../bot/state.js', () => ({
  recordMessageSent: vi.fn(),
}))

// Sprint 5: Mock response suppression
vi.mock('../services/responseSuppression.js', () => ({
  recordBotResponse: vi.fn(),
}))

// Phase 1: Mock activeQuotes for preStatedVolume testing
const mockCreateQuote = vi.fn().mockReturnValue({
  groupJid: '123456789@g.us',
  quotedPrice: 5.8234,
  basePrice: 5.8234,
  status: 'pending',
  quotedAt: new Date(),
  repriceCount: 0,
  priceSource: 'usdt_brl',
})
vi.mock('../services/activeQuotes.js', () => ({
  createQuote: (...args: unknown[]) => mockCreateQuote(...args),
  MIN_VOLUME_USDT: 100,
}))

// Phase 1: Mock parseBrazilianNumber from dealComputation
const mockParseBrazilianNumber = vi.fn().mockReturnValue(null)
vi.mock('../services/dealComputation.js', () => ({
  parseBrazilianNumber: (...args: unknown[]) => mockParseBrazilianNumber(...args),
}))

import { fetchPrice } from '../services/binance.js'
import { fetchCommercialDollar } from '../services/awesomeapi.js'
import { sendWithAntiDetection } from '../utils/messaging.js'
import { logger } from '../utils/logger.js'
import { calculateQuote } from '../services/groupSpreadService.js'
import { getActiveRule } from '../services/ruleService.js'
import { recordBotResponse } from '../services/responseSuppression.js'

const mockFetchPrice = fetchPrice as ReturnType<typeof vi.fn>
const mockFetchCommercialDollar = fetchCommercialDollar as ReturnType<typeof vi.fn>
const mockSend = sendWithAntiDetection as ReturnType<typeof vi.fn>
const mockCalculateQuote = calculateQuote as ReturnType<typeof vi.fn>
const mockGetActiveRule = getActiveRule as ReturnType<typeof vi.fn>
const mockRecordBotResponse = recordBotResponse as ReturnType<typeof vi.fn>

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
      // Single call with formatted price (no stall message)
      expect(mockSend).toHaveBeenCalledWith(
        mockSock,
        '123456789@g.us',
        '5,8234' // Truncated to 4 decimal places, no R$ prefix
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

      // Assert - verify formatted price (AC1, AC2) - single call, no R$ prefix
      expect(mockSend).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        '5,8200'
      )
    })

    it('truncates price to 4 decimal places (not rounds)', async () => {
      // Arrange - 5.82999 would round to 5.83, but should truncate to 5.8299
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.82999 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      // Act
      await handlePriceMessage(baseContext)

      // Assert - truncation not rounding, single call, no R$ prefix
      expect(mockSend).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        '5,8299' // Truncated, not 5,8300
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

      // Assert - timestamp should be AFTER the send (500ms later, single send now)
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

      // Assert - no messages sent (no stall, no price)
      expect(mockSend).not.toHaveBeenCalled()

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
          formattedPrice: '5,8200',
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

      // Assert - formatted price has 4 decimal places (truncated, not rounded)
      // H2 fix: Changed from `price` to `baseRate`/`finalRate` fields
      expect(logger.info).toHaveBeenCalledWith(
        'Price response sent',
        expect.objectContaining({
          event: 'price_response_sent',
          baseRate: 5.8234,
          finalRate: 5.8234,
          formattedPrice: '5,8234',
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

      // Assert - single call with formatted price, no R$ prefix
      expect(mockSend).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        '0,0000'
      )
      expect(result.ok).toBe(true)
    })

    it('handles very large price', async () => {
      // Arrange
      mockFetchPrice.mockResolvedValue({ ok: true, data: 99999.99 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      // Act
      await handlePriceMessage(baseContext)

      // Assert - single call with formatted price, no R$ prefix
      expect(mockSend).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        '99999,9900'
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

    describe('AC1: Retry on First Failure', () => {
      it('retries when first fetch fails and sends price on success', async () => {
        // Arrange - first fails, second succeeds
        mockFetchPrice
          .mockResolvedValueOnce({ ok: false, error: 'Timeout' })
          .mockResolvedValueOnce({ ok: true, data: 5.82 })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert - only one send call (the price), no stall message
        expect(mockSend).toHaveBeenCalledTimes(1)
        expect(mockSend).toHaveBeenCalledWith(
          mockSock,
          '123456789@g.us',
          '5,8200'
        )
      })

      it('logs price_trigger_detected event on handler entry', async () => {
        // Arrange
        mockFetchPrice
          .mockResolvedValueOnce({ ok: false, error: 'Binance timeout' })
          .mockResolvedValueOnce({ ok: true, data: 5.82 })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert - logging happens at entry
        expect(logger.info).toHaveBeenCalledWith(
          'Price trigger detected',
          expect.objectContaining({
            event: 'price_trigger_detected',
            groupId: '123456789@g.us',
          })
        )
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
      it('sends price when retry succeeds on 2nd attempt', async () => {
        // Arrange - first fails, first retry succeeds
        mockFetchPrice
          .mockResolvedValueOnce({ ok: false, error: 'Timeout' }) // Initial
          .mockResolvedValueOnce({ ok: true, data: 5.82 }) // Retry 1
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert - single send call with price (no stall message)
        expect(mockSend).toHaveBeenCalledTimes(1)
        expect(mockSend).toHaveBeenCalledWith(
          mockSock,
          '123456789@g.us',
          '5,8200'
        )
      })

      it('sends price when retry succeeds on 3rd attempt', async () => {
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

        // Assert - single send call with price (no stall message)
        expect(mockSend).toHaveBeenCalledTimes(1)
        expect(mockSend).toHaveBeenCalledWith(
          mockSock,
          '123456789@g.us',
          '5,8200'
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

        // Assert - verify the recovery log was called (among other logs)
        // H2 fix: Changed from `price` to `baseRate`/`finalRate` fields
        expect(logger.info).toHaveBeenCalledWith(
          'Recovered after retry',
          expect.objectContaining({
            event: 'price_recovered_after_retry',
            baseRate: 5.82,
            finalRate: 5.82,
            formattedPrice: '5,8200',
            retryCount: 1,
            groupId: '123456789@g.us',
          })
        )
      })
    })

    describe('AC4: Exhausted Retries', () => {
      it('does NOT send anything when all retries fail', async () => {
        // Arrange - all fail
        mockFetchPrice.mockResolvedValue({ ok: false, error: 'Timeout' })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert - no messages sent at all (no stall message, no price)
        expect(mockSend).not.toHaveBeenCalled()
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

    describe('AC5: Price Format', () => {
      it('price is formatted without R$ prefix', async () => {
        // Arrange
        mockFetchPrice
          .mockResolvedValueOnce({ ok: false, error: 'Timeout' })
          .mockResolvedValueOnce({ ok: true, data: 5.82 })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert - single send call with just the number
        expect(mockSend).toHaveBeenCalledTimes(1)
        expect(mockSend).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          '5,8200'
        )
      })

      it('price uses sendWithAntiDetection', async () => {
        // Arrange
        mockFetchPrice
          .mockResolvedValueOnce({ ok: false, error: 'Timeout' })
          .mockResolvedValueOnce({ ok: true, data: 5.82 })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        const promise = handlePriceMessage(baseContext)
        await vi.runAllTimersAsync()
        await promise

        // Assert - single send call (just the price)
        expect(mockSend).toHaveBeenCalledTimes(1)
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
        mockSend.mockResolvedValue({ ok: false, error: 'Network error' })

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
        mockSend.mockResolvedValue({ ok: false, error: 'Network error' })

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
      it('sends only price when first attempt succeeds', async () => {
        // Arrange - immediate success
        mockFetchPrice.mockResolvedValue({ ok: true, data: 5.82 })
        mockSend.mockResolvedValue({ ok: true, data: undefined })

        // Act
        await handlePriceMessage(baseContext)

        // Assert - one fetch, one send (just the price, no stall message)
        expect(mockFetchPrice).toHaveBeenCalledTimes(1)
        expect(mockSend).toHaveBeenCalledTimes(1)
        expect(mockSend).toHaveBeenCalledWith(
          mockSock,
          '123456789@g.us',
          '5,8200'
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

  // Sprint 2: Time-Based Rule Override
  describe('Sprint 2: Active Rule Override', () => {
    it('uses active rule spread when rule exists', async () => {
      // Arrange
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.82 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      // Active rule with 50 bps sell spread
      mockGetActiveRule.mockResolvedValueOnce({
        ok: true,
        data: {
          id: 'rule-1',
          groupJid: '123456789@g.us',
          name: 'Business Hours',
          spreadMode: 'bps',
          sellSpread: 50,
          buySpread: -30,
          pricingSource: 'usdt_binance',
          priority: 10,
        },
      })

      // calculateQuote should be called with the rule's spread values
      mockCalculateQuote.mockImplementationOnce((rate: number) => {
        // Simulate 50 bps spread: rate * (1 + 50/10000)
        return Math.round(rate * (1 + 50 / 10000) * 10000) / 10000
      })

      // Act
      const result = await handlePriceMessage(baseContext)

      // Assert
      expect(result.ok).toBe(true)

      // calculateQuote was called with a config that has sellSpread=50
      expect(mockCalculateQuote).toHaveBeenCalledWith(
        5.82,
        expect.objectContaining({
          spreadMode: 'bps',
          sellSpread: 50,
          buySpread: -30,
        }),
        'client_buys_usdt'
      )

      // Rule override was logged
      expect(logger.info).toHaveBeenCalledWith(
        'Active time rule overriding spread config',
        expect.objectContaining({
          event: 'time_rule_override',
          ruleName: 'Business Hours',
          ruleId: 'rule-1',
          spreadMode: 'bps',
          sellSpread: 50,
          buySpread: -30,
        })
      )
    })

    it('uses default spread when no active rule', async () => {
      // Arrange
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.82 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })
      mockGetActiveRule.mockResolvedValueOnce({ ok: true, data: null })

      // Act
      await handlePriceMessage(baseContext)

      // Assert - calculateQuote called with default spread (0 bps)
      expect(mockCalculateQuote).toHaveBeenCalledWith(
        5.82,
        expect.objectContaining({
          spreadMode: 'bps',
          sellSpread: 0,
          buySpread: 0,
        }),
        'client_buys_usdt'
      )
    })

    it('falls back to default spread when rule lookup fails', async () => {
      // Arrange
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.82 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })
      mockGetActiveRule.mockRejectedValueOnce(new Error('DB connection failed'))

      // Act
      const result = await handlePriceMessage(baseContext)

      // Assert - still succeeds with default spread
      expect(result.ok).toBe(true)
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to resolve active rule, defaulting to Binance',
        expect.objectContaining({
          event: 'pricing_source_fallback',
        })
      )
    })

    it('rule overrides even when default spread config also has spreads', async () => {
      // Arrange
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.82 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      // Active rule with abs_brl spread (overrides default bps)
      mockGetActiveRule.mockResolvedValueOnce({
        ok: true,
        data: {
          id: 'rule-2',
          groupJid: '123456789@g.us',
          name: 'After Hours',
          spreadMode: 'abs_brl',
          sellSpread: 0.05,
          buySpread: -0.03,
          pricingSource: 'usdt_binance',
          priority: 5,
        },
      })

      // Act
      await handlePriceMessage(baseContext)

      // Assert - calculateQuote called with rule's abs_brl config, not default bps
      expect(mockCalculateQuote).toHaveBeenCalledWith(
        5.82,
        expect.objectContaining({
          spreadMode: 'abs_brl',
          sellSpread: 0.05,
          buySpread: -0.03,
        }),
        'client_buys_usdt'
      )
    })

    it('does not fall back to Binance when commercial_dollar source is unavailable', async () => {
      mockGetActiveRule.mockResolvedValueOnce({
        ok: true,
        data: {
          id: 'rule-commercial-1',
          groupJid: '123456789@g.us',
          name: 'Commercial Source Rule',
          spreadMode: 'bps',
          sellSpread: 20,
          buySpread: -10,
          pricingSource: 'commercial_dollar',
          priority: 10,
        },
      })
      mockFetchCommercialDollar.mockResolvedValueOnce({
        ok: false,
        error: 'TradingView commercial dollar unavailable',
      })
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.82 })

      const promise = handlePriceMessage(baseContext)
      await vi.advanceTimersByTimeAsync((MAX_PRICE_RETRIES * RETRY_DELAY_MS) + 250)
      const result = await promise

      expect(result.ok).toBe(false)
      expect(mockFetchPrice).not.toHaveBeenCalled()
      expect(mockSend).not.toHaveBeenCalled()
    })
  })

  // ========================================================================
  // Sprint 5: Response suppression integration
  // ========================================================================
  describe('Sprint 5: recordBotResponse integration', () => {
    it('calls recordBotResponse after successful price response', async () => {
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.25 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      await handlePriceMessage(baseContext)

      expect(mockRecordBotResponse).toHaveBeenCalledWith('123456789@g.us')
      expect(mockRecordBotResponse).toHaveBeenCalledTimes(1)
    })

    it('calls recordBotResponse after recovered price response', async () => {
      // First attempt fails, retry succeeds
      mockFetchPrice
        .mockResolvedValueOnce({ ok: false, error: 'timeout' })
        .mockResolvedValueOnce({ ok: true, data: 5.30 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      const promise = handlePriceMessage(baseContext)
      // Advance past retry delay
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS + 100)
      await promise

      expect(mockRecordBotResponse).toHaveBeenCalledWith('123456789@g.us')
      expect(mockRecordBotResponse).toHaveBeenCalledTimes(1)
    })

    it('does NOT call recordBotResponse when price send fails', async () => {
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.25 })
      // Price send fails (no stall message anymore)
      mockSend.mockResolvedValue({ ok: false, error: 'send failed' })

      await handlePriceMessage(baseContext)

      expect(mockRecordBotResponse).not.toHaveBeenCalled()
    })

    it('does NOT call recordBotResponse when all retries fail', async () => {
      mockFetchPrice.mockResolvedValue({ ok: false, error: 'timeout' })
      mockSend.mockResolvedValue({ ok: true, data: undefined })

      const promise = handlePriceMessage(baseContext)
      // Advance past all retry delays
      for (let i = 0; i < MAX_PRICE_RETRIES; i++) {
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS + 100)
      }
      await promise

      expect(mockRecordBotResponse).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Phase 1: Pre-stated Volume Extraction
  // ==========================================================================

  describe('preStatedVolume extraction', () => {
    it('passes preStatedVolume to createQuote when message contains amount >= 100', async () => {
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.2500 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })
      mockParseBrazilianNumber.mockImplementation((word: string) => {
        if (word === '30000') return 30000
        return null
      })

      const context = { ...baseContext, message: 'cotação pra 30000' }
      await handlePriceMessage(context)

      expect(mockCreateQuote).toHaveBeenCalledWith(
        '123456789@g.us',
        expect.any(Number),
        expect.objectContaining({ preStatedVolume: 30000 })
      )
    })

    it('does not set preStatedVolume when no amount in message', async () => {
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.2500 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })
      mockParseBrazilianNumber.mockReturnValue(null)

      const context = { ...baseContext, message: 'preço' }
      await handlePriceMessage(context)

      expect(mockCreateQuote).toHaveBeenCalledWith(
        '123456789@g.us',
        expect.any(Number),
        expect.objectContaining({ preStatedVolume: undefined })
      )
    })

    it('ignores amounts below MIN_VOLUME_USDT (100)', async () => {
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.2500 })
      mockSend.mockResolvedValue({ ok: true, data: undefined })
      mockParseBrazilianNumber.mockImplementation((word: string) => {
        // "5,25" parsed as 5.25 — below threshold
        if (word === '5,25') return 5.25
        return null
      })

      const context = { ...baseContext, message: 'cotação 5,25' }
      await handlePriceMessage(context)

      expect(mockCreateQuote).toHaveBeenCalledWith(
        '123456789@g.us',
        expect.any(Number),
        expect.objectContaining({ preStatedVolume: undefined })
      )
    })
  })
})
