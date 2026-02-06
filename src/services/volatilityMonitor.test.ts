import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock all dependencies with vi.hoisted
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

const mockOnPriceUpdate = vi.hoisted(() => vi.fn())
const mockGetCurrentPrice = vi.hoisted(() => vi.fn())
const mockFetchPrice = vi.hoisted(() => vi.fn())
const mockGetActiveQuote = vi.hoisted(() => vi.fn())
const mockTryLockForReprice = vi.hoisted(() => vi.fn())
const mockUnlockAfterReprice = vi.hoisted(() => vi.fn())
const mockIncrementRepriceCount = vi.hoisted(() => vi.fn())
const mockGetAllActiveQuotes = vi.hoisted(() => vi.fn())
const mockSendWithAntiDetection = vi.hoisted(() => vi.fn())
const mockQueueControlNotification = vi.hoisted(() => vi.fn())
const mockGetSupabase = vi.hoisted(() => vi.fn())
const mockGetActiveRule = vi.hoisted(() => vi.fn())

vi.mock('../utils/logger.js', () => ({ logger: mockLogger }))
vi.mock('./binanceWebSocket.js', () => ({
  onPriceUpdate: mockOnPriceUpdate,
  getCurrentPrice: mockGetCurrentPrice,
}))
vi.mock('./binance.js', () => ({ fetchPrice: mockFetchPrice }))
vi.mock('./activeQuotes.js', () => ({
  getActiveQuote: mockGetActiveQuote,
  tryLockForReprice: mockTryLockForReprice,
  unlockAfterReprice: mockUnlockAfterReprice,
  incrementRepriceCount: mockIncrementRepriceCount,
  getAllActiveQuotes: mockGetAllActiveQuotes,
}))
vi.mock('../utils/messaging.js', () => ({ sendWithAntiDetection: mockSendWithAntiDetection }))
vi.mock('../bot/notifications.js', () => ({ queueControlNotification: mockQueueControlNotification }))
vi.mock('./supabase.js', () => ({ getSupabase: mockGetSupabase }))
vi.mock('./ruleService.js', () => ({ getActiveRule: mockGetActiveRule }))

import {
  checkThresholdBreach,
  checkThresholdBreachBps,
  startMonitoring,
  stopMonitoring,
  initializeVolatilityMonitor,
  isGroupPaused,
  unpauseGroup,
  invalidateConfigCache,
  clearConfigCache,
  _resetForTesting,
} from './volatilityMonitor.js'

describe('volatilityMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetForTesting()

    // Default mock implementations
    mockOnPriceUpdate.mockReturnValue(() => {})
    mockGetAllActiveQuotes.mockReturnValue([])
    mockGetSupabase.mockReturnValue(null)
    mockGetActiveRule.mockResolvedValue({ ok: true, data: null }) // No active rule by default
  })

  afterEach(() => {
    stopMonitoring()
  })

  describe('checkThresholdBreach', () => {
    describe('bps mode', () => {
      // In bps mode, we only care about UPWARD movement (market rising above quote)

      it('returns true when upward deviation >= threshold', () => {
        // Quote at 5.265, market rises to 5.2808 (30+ bps above)
        // 30 bps = 0.30% of 5.265 = 0.0158
        expect(checkThresholdBreach(5.265, 5.2808, { mode: 'bps', value: 30 })).toBe(true)
      })

      it('returns false when upward deviation < threshold', () => {
        // Quote at 5.265, market at 5.2807 (just under 30 bps)
        expect(checkThresholdBreach(5.265, 5.2807, { mode: 'bps', value: 30 })).toBe(false)
      })

      it('returns false for downward movement (we have more margin)', () => {
        // Quote at 5.265, market dropped to 5.249 - we have MORE margin!
        // Even though deviation is > 30 bps, it's downward so no breach
        expect(checkThresholdBreach(5.265, 5.249, { mode: 'bps', value: 30 })).toBe(false)
      })

      it('returns false when market is below quote', () => {
        // Any downward movement = no breach
        expect(checkThresholdBreach(5.265, 5.200, { mode: 'bps', value: 30 })).toBe(false)
      })

      it('returns true at exactly threshold (edge case)', () => {
        // Quote at 100, threshold 100 bps = 1%, market at 101
        const quotedPrice = 100
        const thresholdBps = 100
        const thresholdPrice = 101
        expect(checkThresholdBreach(quotedPrice, thresholdPrice, { mode: 'bps', value: thresholdBps })).toBe(true)
      })
    })

    describe('abs_brl mode', () => {
      // In abs_brl mode, we only care about UPWARD movement (market rising to quote)
      // The spread is our margin; trigger when market >= quotedPrice

      it('returns true when market rises to quoted price', () => {
        // Market has risen to equal our quote - no margin left
        expect(checkThresholdBreach(5.285, 5.285, { mode: 'abs_brl', value: 0.02 })).toBe(true)
      })

      it('returns true when market rises ABOVE quoted price', () => {
        // Market exceeded our quote - we're losing money
        expect(checkThresholdBreach(5.285, 5.295, { mode: 'abs_brl', value: 0.02 })).toBe(true)
      })

      it('returns false when market is below quoted price', () => {
        // Quote is 5.285, market is 5.265 - we have margin (good!)
        expect(checkThresholdBreach(5.285, 5.265, { mode: 'abs_brl', value: 0.02 })).toBe(false)
      })

      it('returns false for downward movement (we have more margin)', () => {
        // Quote is 5.285, market went down to 5.235 - even more margin!
        expect(checkThresholdBreach(5.285, 5.235, { mode: 'abs_brl', value: 0.02 })).toBe(false)
      })

      it('handles market just below quote (edge case)', () => {
        // Quote is 5.285, market is 5.284 - still have tiny margin
        expect(checkThresholdBreach(5.285, 5.284, { mode: 'abs_brl', value: 0.02 })).toBe(false)
      })
    })

    describe('flat mode', () => {
      it('always returns false', () => {
        expect(checkThresholdBreach(5.265, 100.0, { mode: 'flat', value: 0 })).toBe(false)
      })
    })
  })

  describe('checkThresholdBreachBps (legacy)', () => {
    it('wraps checkThresholdBreach with bps mode', () => {
      // Upward breach
      expect(checkThresholdBreachBps(5.265, 5.2808, 30)).toBe(true)
      // Just under threshold (upward)
      expect(checkThresholdBreachBps(5.265, 5.2807, 30)).toBe(false)
      // Downward movement - no breach (we have margin)
      expect(checkThresholdBreachBps(5.265, 5.200, 30)).toBe(false)
    })
  })

  describe('startMonitoring', () => {
    it('subscribes to price updates', () => {
      startMonitoring()

      expect(mockOnPriceUpdate).toHaveBeenCalled()
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Volatility monitoring started',
        expect.objectContaining({ event: 'volatility_monitoring_started' })
      )
    })

    it('does not double-subscribe if already monitoring', () => {
      startMonitoring()
      startMonitoring()

      expect(mockOnPriceUpdate).toHaveBeenCalledTimes(1)
    })
  })

  describe('stopMonitoring', () => {
    it('unsubscribes from price updates', () => {
      const unsubscribe = vi.fn()
      mockOnPriceUpdate.mockReturnValue(unsubscribe)

      startMonitoring()
      stopMonitoring()

      expect(unsubscribe).toHaveBeenCalled()
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Volatility monitoring stopped',
        expect.objectContaining({ event: 'volatility_monitoring_stopped' })
      )
    })
  })

  describe('initializeVolatilityMonitor', () => {
    it('sets socket for message sending', () => {
      const mockSocket = {} as never

      initializeVolatilityMonitor(mockSocket)

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Volatility monitor socket initialized',
        expect.objectContaining({ event: 'volatility_monitor_socket_init' })
      )
    })
  })

  describe('group pausing', () => {
    it('tracks paused groups', () => {
      expect(isGroupPaused('group1@g.us')).toBe(false)
    })

    it('unpauses groups correctly', () => {
      // Would need internal access to pause first
      // Testing the API contract
      unpauseGroup('group1@g.us')
      expect(isGroupPaused('group1@g.us')).toBe(false)
    })
  })

  describe('config cache', () => {
    it('invalidateConfigCache removes cached config', () => {
      // This tests the cache clearing mechanism
      invalidateConfigCache('group1@g.us')
      // No assertion needed - just verify it doesn't throw
    })

    it('clearConfigCache removes all cached configs', () => {
      clearConfigCache()
      // No assertion needed - just verify it doesn't throw
    })
  })

  describe('price update handling', () => {
    it('checks all active quotes on price update', async () => {
      let priceHandler: (price: number) => void

      mockOnPriceUpdate.mockImplementation((cb: (price: number) => void) => {
        priceHandler = cb
        return () => {}
      })

      mockGetAllActiveQuotes.mockReturnValue([
        {
          groupJid: 'group1@g.us',
          quotedPrice: 5.265,
          basePrice: 5.265,
          priceSource: 'usdt_brl',
          status: 'pending',
          repriceCount: 0,
        },
      ])

      startMonitoring()

      // Simulate price update below threshold
      await priceHandler!(5.266)

      // Should not trigger reprice (below threshold)
      expect(mockTryLockForReprice).not.toHaveBeenCalled()
    })

    it('triggers reprice when threshold breached (default bps)', async () => {
      const mockSocket = {
        sendPresenceUpdate: vi.fn(),
        sendMessage: vi.fn(),
      }

      let priceHandler: (price: number) => void

      mockOnPriceUpdate.mockImplementation((cb: (price: number) => void) => {
        priceHandler = cb
        return () => {}
      })

      mockGetAllActiveQuotes.mockReturnValue([
        {
          groupJid: 'group1@g.us',
          quotedPrice: 5.265,
          basePrice: 5.265,
          priceSource: 'usdt_brl',
          status: 'pending',
          repriceCount: 0,
        },
      ])

      mockTryLockForReprice.mockReturnValue(true)
      mockGetActiveQuote.mockReturnValue({
        groupJid: 'group1@g.us',
        quotedPrice: 5.265,
        basePrice: 5.265,
        priceSource: 'usdt_brl',
        status: 'repricing',
        repriceCount: 0,
      })
      mockSendWithAntiDetection.mockResolvedValue({ ok: true })
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.285 })
      mockIncrementRepriceCount.mockReturnValue(1)

      initializeVolatilityMonitor(mockSocket as never)
      startMonitoring()

      // Simulate price update above threshold (30 bps breach)
      await priceHandler!(5.285)

      // Should trigger reprice
      expect(mockTryLockForReprice).toHaveBeenCalledWith('group1@g.us')
      expect(mockSendWithAntiDetection).toHaveBeenCalledWith(
        mockSocket,
        'group1@g.us',
        'off' // EXACT STRING
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Threshold breach detected',
        expect.objectContaining({ event: 'threshold_breach' })
      )
    })

    it('uses active rule spread for threshold (bps mode)', async () => {
      const mockSocket = {
        sendPresenceUpdate: vi.fn(),
        sendMessage: vi.fn(),
      }

      let priceHandler: (price: number) => void

      mockOnPriceUpdate.mockImplementation((cb: (price: number) => void) => {
        priceHandler = cb
        return () => {}
      })

      // Active rule with 50 bps threshold
      mockGetActiveRule.mockResolvedValue({
        ok: true,
        data: {
          id: 'rule1',
          name: 'Business Hours',
          pricingSource: 'usdt_binance',
          spreadMode: 'bps',
          sellSpread: 50, // 50 bps threshold
          buySpread: 50,
        },
      })

      mockGetAllActiveQuotes.mockReturnValue([
        {
          groupJid: 'group1@g.us',
          quotedPrice: 5.265,
          basePrice: 5.265,
          priceSource: 'usdt_brl',
          status: 'pending',
          repriceCount: 0,
        },
      ])

      mockTryLockForReprice.mockReturnValue(true)
      mockGetActiveQuote.mockReturnValue({
        groupJid: 'group1@g.us',
        quotedPrice: 5.265,
        basePrice: 5.265,
        priceSource: 'usdt_brl',
        status: 'repricing',
        repriceCount: 0,
      })
      mockSendWithAntiDetection.mockResolvedValue({ ok: true })
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.295 })
      mockIncrementRepriceCount.mockReturnValue(1)

      initializeVolatilityMonitor(mockSocket as never)
      startMonitoring()

      // Price at 30 bps should NOT trigger (below 50 bps threshold)
      await priceHandler!(5.281)
      expect(mockTryLockForReprice).not.toHaveBeenCalled()

      // Price at 50+ bps SHOULD trigger
      clearConfigCache()
      await priceHandler!(5.295)
      expect(mockTryLockForReprice).toHaveBeenCalled()
    })

    it('uses active rule spread for threshold (abs_brl mode)', async () => {
      const mockSocket = {
        sendPresenceUpdate: vi.fn(),
        sendMessage: vi.fn(),
      }

      let priceHandler: (price: number) => void

      mockOnPriceUpdate.mockImplementation((cb: (price: number) => void) => {
        priceHandler = cb
        return () => {}
      })

      // Active rule with 2 centavos spread
      mockGetActiveRule.mockResolvedValue({
        ok: true,
        data: {
          id: 'rule1',
          name: 'After Hours',
          pricingSource: 'usdt_binance',
          spreadMode: 'abs_brl',
          sellSpread: 0.02, // 2 centavos
          buySpread: 0.02,
        },
      })

      // Quote at 5.285 (base 5.265 + 0.02 spread)
      mockGetAllActiveQuotes.mockReturnValue([
        {
          groupJid: 'group1@g.us',
          quotedPrice: 5.285, // This is base + spread
          basePrice: 5.265,
          priceSource: 'usdt_brl',
          status: 'pending',
          repriceCount: 0,
        },
      ])

      mockTryLockForReprice.mockReturnValue(true)
      mockGetActiveQuote.mockReturnValue({
        groupJid: 'group1@g.us',
        quotedPrice: 5.285,
        basePrice: 5.265,
        priceSource: 'usdt_brl',
        status: 'repricing',
        repriceCount: 0,
      })
      mockSendWithAntiDetection.mockResolvedValue({ ok: true })
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.290 })
      mockIncrementRepriceCount.mockReturnValue(1)

      initializeVolatilityMonitor(mockSocket as never)
      startMonitoring()

      // Market at 5.270 (below quote 5.285) - should NOT trigger (we have margin)
      await priceHandler!(5.270)
      expect(mockTryLockForReprice).not.toHaveBeenCalled()

      // Market at 5.285 (equal to quote) - SHOULD trigger (no margin left)
      clearConfigCache()
      await priceHandler!(5.285)
      expect(mockTryLockForReprice).toHaveBeenCalled()
    })

    it('skips quotes not in pending status', async () => {
      let priceHandler: (price: number) => void

      mockOnPriceUpdate.mockImplementation((cb: (price: number) => void) => {
        priceHandler = cb
        return () => {}
      })

      mockGetAllActiveQuotes.mockReturnValue([
        {
          groupJid: 'group1@g.us',
          quotedPrice: 5.265,
          basePrice: 5.265,
          priceSource: 'usdt_brl',
          status: 'repricing', // Not pending
          repriceCount: 0,
        },
      ])

      startMonitoring()
      await priceHandler!(5.285)

      expect(mockTryLockForReprice).not.toHaveBeenCalled()
    })
  })

  describe('full reprice flow integration', () => {
    it('executes complete reprice cycle: breach → off → fetch → new price → unlock', async () => {
      const mockSocket = {
        sendPresenceUpdate: vi.fn(),
        sendMessage: vi.fn(),
      }

      let priceHandler: (price: number) => void

      mockOnPriceUpdate.mockImplementation((cb: (price: number) => void) => {
        priceHandler = cb
        return () => {}
      })

      mockGetAllActiveQuotes.mockReturnValue([
        {
          groupJid: 'group1@g.us',
          quotedPrice: 5.2650,
          basePrice: 5.2650,
          priceSource: 'usdt_brl',
          status: 'pending',
          repriceCount: 0,
        },
      ])

      mockTryLockForReprice.mockReturnValue(true)
      mockGetActiveQuote.mockReturnValue({
        groupJid: 'group1@g.us',
        quotedPrice: 5.2650,
        basePrice: 5.2650,
        priceSource: 'usdt_brl',
        status: 'repricing',
        repriceCount: 0,
      })

      // Mock the complete flow
      const sendCalls: string[] = []
      mockSendWithAntiDetection.mockImplementation((_sock, _jid, message) => {
        sendCalls.push(message)
        return Promise.resolve({ ok: true })
      })

      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.2850 })
      mockIncrementRepriceCount.mockReturnValue(1)

      initializeVolatilityMonitor(mockSocket as never)
      startMonitoring()

      // Trigger price update that breaches threshold
      await priceHandler!(5.2850)

      // Verify the exact message sequence
      expect(sendCalls).toHaveLength(2)
      expect(sendCalls[0]).toBe('off') // First: cancellation
      expect(sendCalls[1]).toMatch(/5,28/) // Second: new price in Brazilian format

      // Verify state machine operations
      expect(mockTryLockForReprice).toHaveBeenCalledWith('group1@g.us')
      expect(mockFetchPrice).toHaveBeenCalled()
      expect(mockIncrementRepriceCount).toHaveBeenCalledWith('group1@g.us')
      expect(mockUnlockAfterReprice).toHaveBeenCalledWith('group1@g.us', 5.2850)

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Reprice completed',
        expect.objectContaining({
          event: 'reprice_complete',
          groupJid: 'group1@g.us',
        })
      )
    })

    it('triggers escalation after max reprices and pauses group', async () => {
      const mockSocket = {
        sendPresenceUpdate: vi.fn(),
        sendMessage: vi.fn(),
      }

      let priceHandler: (price: number) => void

      mockOnPriceUpdate.mockImplementation((cb: (price: number) => void) => {
        priceHandler = cb
        return () => {}
      })

      mockGetAllActiveQuotes.mockReturnValue([
        {
          groupJid: 'group1@g.us',
          quotedPrice: 5.2650,
          basePrice: 5.2650,
          priceSource: 'usdt_brl',
          status: 'pending',
          repriceCount: 2, // Already at 2
        },
      ])

      mockTryLockForReprice.mockReturnValue(true)
      mockGetActiveQuote.mockReturnValue({
        groupJid: 'group1@g.us',
        quotedPrice: 5.2650,
        basePrice: 5.2650,
        priceSource: 'usdt_brl',
        status: 'repricing',
        repriceCount: 2,
      })

      mockSendWithAntiDetection.mockResolvedValue({ ok: true })
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.2900 })
      mockIncrementRepriceCount.mockReturnValue(3) // Now at max (default 3)

      // Mock Supabase for escalation persistence
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockResolvedValue({ error: null }),
        }),
      }
      mockGetSupabase.mockReturnValue(mockSupabase)

      initializeVolatilityMonitor(mockSocket as never)
      startMonitoring()

      // Trigger the 3rd reprice (hits max)
      await priceHandler!(5.2900)

      // Verify escalation was triggered
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Volatility escalation triggered',
        expect.objectContaining({
          event: 'volatility_escalation',
          groupJid: 'group1@g.us',
          repriceCount: 3,
        })
      )

      // Verify control notification was sent
      expect(mockQueueControlNotification).toHaveBeenCalledWith(
        expect.stringContaining('VOLATILITY ALERT')
      )

      // Verify DB persistence was attempted
      expect(mockSupabase.from).toHaveBeenCalledWith('volatility_escalations')

      // Verify group is paused
      expect(isGroupPaused('group1@g.us')).toBe(true)
    })

    it('does NOT pause group if DB persistence fails (race condition fix)', async () => {
      const mockSocket = {
        sendPresenceUpdate: vi.fn(),
        sendMessage: vi.fn(),
      }

      let priceHandler: (price: number) => void

      mockOnPriceUpdate.mockImplementation((cb: (price: number) => void) => {
        priceHandler = cb
        return () => {}
      })

      mockGetAllActiveQuotes.mockReturnValue([
        {
          groupJid: 'group2@g.us',
          quotedPrice: 5.2650,
          basePrice: 5.2650,
          priceSource: 'usdt_brl',
          status: 'pending',
          repriceCount: 2,
        },
      ])

      mockTryLockForReprice.mockReturnValue(true)
      mockGetActiveQuote.mockReturnValue({
        groupJid: 'group2@g.us',
        quotedPrice: 5.2650,
        basePrice: 5.2650,
        priceSource: 'usdt_brl',
        status: 'repricing',
        repriceCount: 2,
      })

      mockSendWithAntiDetection.mockResolvedValue({ ok: true })
      mockFetchPrice.mockResolvedValue({ ok: true, data: 5.2900 })
      mockIncrementRepriceCount.mockReturnValue(3)

      // Mock Supabase to FAIL
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockResolvedValue({ error: { message: 'DB connection failed' } }),
        }),
      }
      mockGetSupabase.mockReturnValue(mockSupabase)

      initializeVolatilityMonitor(mockSocket as never)
      startMonitoring()

      await priceHandler!(5.2900)

      // Verify error was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to persist escalation - NOT pausing group',
        expect.objectContaining({
          event: 'escalation_persist_error',
          groupJid: 'group2@g.us',
        })
      )

      // CRITICAL: Group should NOT be paused when DB fails
      expect(isGroupPaused('group2@g.us')).toBe(false)

      // But notification should still be sent (with error message)
      expect(mockQueueControlNotification).toHaveBeenCalledWith(
        expect.stringContaining('DB ERROR')
      )
    })
  })
})
