import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock dependencies with vi.hoisted
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

const mockFetchPrice = vi.hoisted(() => vi.fn())

vi.mock('../utils/logger.js', () => ({ logger: mockLogger }))
vi.mock('./binance.js', () => ({ fetchPrice: mockFetchPrice }))

// Mock data lake to prevent bronze tick side effects during tests
vi.mock('./dataLake.js', () => ({
  emitPriceTick: vi.fn(),
}))

// Mock WebSocket - must be a class-like constructor
const mockWsInstance = {
  on: vi.fn(),
  close: vi.fn(),
  send: vi.fn(),
}

// Track constructor calls for assertions
const mockWsConstructorCalls: string[] = []

vi.mock('ws', () => {
  // Return an actual class for the default export
  return {
    default: class MockWebSocket {
      constructor(url: string) {
        mockWsConstructorCalls.push(url)
        // Copy mock methods to this instance
        Object.assign(this, mockWsInstance)
      }
    },
  }
})

import {
  startWebSocket,
  stopWebSocket,
  getCurrentPrice,
  onPriceUpdate,
  getConnectionStatus,
  _resetForTesting,
} from './binanceWebSocket.js'

describe('binanceWebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    _resetForTesting()

    // Reset constructor call tracking
    mockWsConstructorCalls.length = 0

    // Reset mock implementations
    mockWsInstance.on.mockReset()
    mockWsInstance.close.mockReset()
    mockWsInstance.send.mockReset()
    mockWsInstance.on.mockImplementation(() => mockWsInstance)
    mockFetchPrice.mockResolvedValue({ ok: true, data: 5.82 })
  })

  afterEach(() => {
    vi.useRealTimers()
    stopWebSocket()
  })

  describe('startWebSocket', () => {
    it('creates WebSocket connection to Binance', () => {
      startWebSocket()

      expect(mockWsConstructorCalls.length).toBe(1)
      expect(mockWsConstructorCalls[0]).toContain('binance.com')
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Connecting to Binance WebSocket',
        expect.objectContaining({ event: 'binance_ws_connecting' })
      )
    })

    it('sets status to connecting while connecting', () => {
      startWebSocket()
      expect(getConnectionStatus()).toBe('connecting')
    })

    it('sets status to connected on open event', () => {
      startWebSocket()

      // Simulate WebSocket 'open' event
      const onCall = mockWsInstance.on.mock.calls.find(([event]) => event === 'open')
      expect(onCall).toBeDefined()
      const openHandler = onCall![1]
      openHandler()

      expect(getConnectionStatus()).toBe('connected')
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Binance WebSocket connected',
        expect.objectContaining({ event: 'binance_ws_connected' })
      )
    })
  })

  describe('price updates', () => {
    it('updates current price on valid trade message', () => {
      startWebSocket()

      // Simulate 'open' event
      const openHandler = mockWsInstance.on.mock.calls.find(([e]) => e === 'open')![1]
      openHandler()

      // Simulate 'message' event with valid trade data
      const messageHandler = mockWsInstance.on.mock.calls.find(([e]) => e === 'message')![1]
      const tradeMessage = JSON.stringify({
        e: 'trade',
        s: 'USDTBRL',
        p: '5.8234',
      })
      messageHandler(Buffer.from(tradeMessage))

      expect(getCurrentPrice()).toBe(5.8234)
    })

    it('notifies callbacks on price update', () => {
      const callback = vi.fn()
      startWebSocket()
      onPriceUpdate(callback)

      // Simulate message
      const openHandler = mockWsInstance.on.mock.calls.find(([e]) => e === 'open')![1]
      openHandler()

      const messageHandler = mockWsInstance.on.mock.calls.find(([e]) => e === 'message')![1]
      messageHandler(Buffer.from(JSON.stringify({ e: 'trade', s: 'USDTBRL', p: '5.85' })))

      expect(callback).toHaveBeenCalledWith(5.85)
    })

    it('unsubscribe function removes callback', () => {
      const callback = vi.fn()
      startWebSocket()
      const unsubscribe = onPriceUpdate(callback)

      // Simulate connection
      const openHandler = mockWsInstance.on.mock.calls.find(([e]) => e === 'open')![1]
      openHandler()
      const messageHandler = mockWsInstance.on.mock.calls.find(([e]) => e === 'message')![1]

      // First message - callback called
      messageHandler(Buffer.from(JSON.stringify({ e: 'trade', s: 'USDTBRL', p: '5.85' })))
      expect(callback).toHaveBeenCalledTimes(1)

      // Unsubscribe
      unsubscribe()

      // Second message - callback NOT called
      messageHandler(Buffer.from(JSON.stringify({ e: 'trade', s: 'USDTBRL', p: '5.86' })))
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('ignores non-trade messages', () => {
      startWebSocket()

      const openHandler = mockWsInstance.on.mock.calls.find(([e]) => e === 'open')![1]
      openHandler()

      const messageHandler = mockWsInstance.on.mock.calls.find(([e]) => e === 'message')![1]
      messageHandler(Buffer.from(JSON.stringify({ e: 'ping' })))

      expect(getCurrentPrice()).toBeNull()
    })

    it('ignores invalid price values', () => {
      startWebSocket()

      const openHandler = mockWsInstance.on.mock.calls.find(([e]) => e === 'open')![1]
      openHandler()

      const messageHandler = mockWsInstance.on.mock.calls.find(([e]) => e === 'message')![1]
      messageHandler(Buffer.from(JSON.stringify({ e: 'trade', s: 'USDTBRL', p: 'invalid' })))

      expect(getCurrentPrice()).toBeNull()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid price received from WebSocket',
        expect.objectContaining({ event: 'binance_ws_invalid_price' })
      )
    })
  })

  describe('reconnection', () => {
    it('schedules reconnection on close', async () => {
      startWebSocket()

      // Simulate close event
      const closeHandler = mockWsInstance.on.mock.calls.find(([e]) => e === 'close')![1]
      closeHandler(1000, Buffer.from('Normal closure'))

      expect(getConnectionStatus()).toBe('disconnected')
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Binance WebSocket closed',
        expect.objectContaining({ event: 'binance_ws_closed' })
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Scheduling WebSocket reconnection',
        expect.objectContaining({ event: 'binance_ws_reconnect_scheduled' })
      )
    })

    it('starts REST fallback polling on disconnect', async () => {
      startWebSocket()

      const closeHandler = mockWsInstance.on.mock.calls.find(([e]) => e === 'close')![1]
      closeHandler(1000, Buffer.from('Normal closure'))

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Starting REST fallback polling',
        expect.objectContaining({ event: 'rest_fallback_started' })
      )

      // Advance timer to trigger REST poll
      await vi.advanceTimersByTimeAsync(2000)

      expect(mockFetchPrice).toHaveBeenCalled()
    })
  })

  describe('stopWebSocket', () => {
    it('cleans up all resources', () => {
      startWebSocket()
      stopWebSocket()

      expect(mockWsInstance.close).toHaveBeenCalled()
      expect(getConnectionStatus()).toBe('disconnected')
      expect(getCurrentPrice()).toBeNull()
    })

    it('logs service stop event', () => {
      startWebSocket()
      stopWebSocket()

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Stopping Binance WebSocket service',
        expect.objectContaining({ event: 'binance_ws_service_stop' })
      )
    })
  })
})
