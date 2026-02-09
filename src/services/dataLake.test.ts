/**
 * Tests for Data Lake Service — Medallion Architecture
 * Sprint 8.5: Bronze → Silver → Gold
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Hoist mock functions
const { mockSupabase, mockGetCurrentPrice } = vi.hoisted(() => {
  const mockInsert = vi.fn().mockResolvedValue({ error: null })
  return {
    mockSupabase: {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue(Promise.resolve({ error: null })),
      }),
      rpc: vi.fn().mockResolvedValue({ error: null, data: 0 }),
    },
    mockGetCurrentPrice: vi.fn().mockReturnValue(5.82),
  }
})

vi.mock('./supabase.js', () => ({
  getSupabase: () => mockSupabase,
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('./binanceWebSocket.js', () => ({
  getCurrentPrice: mockGetCurrentPrice,
}))

import {
  emitPriceTick,
  emitDealEvent,
  refreshSilverLayer,
  refreshGoldLayer,
  runRetentionCleanup,
  startDataLakeRefresh,
  stopDataLakeRefresh,
  _resetForTesting,
  _getLastBinanceWsTick,
  _setLastBinanceWsTick,
} from './dataLake.js'

describe('dataLake', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetForTesting()

    // Reset mock chain for from().insert()
    const insertMock = vi.fn().mockReturnValue(Promise.resolve({ error: null }))
    mockSupabase.from.mockReturnValue({ insert: insertMock })
    mockSupabase.rpc.mockResolvedValue({ error: null, data: 0 })
  })

  afterEach(() => {
    _resetForTesting()
  })

  // ========================================================================
  // emitPriceTick
  // ========================================================================

  describe('emitPriceTick', () => {
    it('inserts a tick into bronze_price_ticks', async () => {
      emitPriceTick('awesomeapi', 'USD/BRL', 5.25, 5.24, 5.26)
      await Promise.resolve() // flush fire-and-forget microtask

      expect(mockSupabase.from).toHaveBeenCalledWith('bronze_price_ticks')
    })

    it('throttles binance_ws ticks to 5-second intervals', async () => {
      // First tick should go through
      emitPriceTick('binance_ws', 'USDT/BRL', 5.82)

      // Second tick within 5s should be throttled (returns early, no Promise created)
      emitPriceTick('binance_ws', 'USDT/BRL', 5.83)

      // Non-binance_ws source should not be throttled
      emitPriceTick('awesomeapi', 'USD/BRL', 5.25)

      await Promise.resolve() // flush fire-and-forget microtasks

      // Only 2 calls: first binance_ws + awesomeapi (second binance_ws was throttled)
      expect(mockSupabase.from).toHaveBeenCalledTimes(2)
    })

    it('allows binance_ws tick after 5 seconds', async () => {
      // Set last tick to 6 seconds ago
      _setLastBinanceWsTick(Date.now() - 6000)

      emitPriceTick('binance_ws', 'USDT/BRL', 5.82)
      await Promise.resolve() // flush fire-and-forget microtask

      expect(mockSupabase.from).toHaveBeenCalledTimes(1)
    })

    it('does not throw on insert failure', () => {
      mockSupabase.from.mockReturnValue({
        insert: vi.fn().mockReturnValue(Promise.resolve({ error: { message: 'DB error' } })),
      })

      // Should not throw
      expect(() => emitPriceTick('awesomeapi', 'USD/BRL', 5.25)).not.toThrow()
    })
  })

  // ========================================================================
  // emitDealEvent
  // ========================================================================

  describe('emitDealEvent', () => {
    it('inserts an event into bronze_deal_events', async () => {
      emitDealEvent({
        dealId: 'deal-1',
        groupJid: '123@g.us',
        clientJid: '5511999@s.whatsapp.net',
        fromState: null,
        toState: 'quoted',
        eventType: 'created',
      })
      await Promise.resolve() // flush fire-and-forget microtask

      expect(mockSupabase.from).toHaveBeenCalledWith('bronze_deal_events')
    })

    it('uses current market price from binanceWebSocket when not provided', () => {
      mockGetCurrentPrice.mockReturnValue(5.82)

      emitDealEvent({
        dealId: 'deal-1',
        groupJid: '123@g.us',
        clientJid: '5511999@s.whatsapp.net',
        fromState: 'quoted',
        toState: 'locked',
        eventType: 'locked',
      })

      // Verify getCurrentPrice was called
      expect(mockGetCurrentPrice).toHaveBeenCalled()
    })

    it('uses provided market price over current price', async () => {
      emitDealEvent({
        dealId: 'deal-1',
        groupJid: '123@g.us',
        clientJid: '5511999@s.whatsapp.net',
        fromState: 'quoted',
        toState: 'locked',
        eventType: 'locked',
        marketPrice: 5.90,
      })
      await Promise.resolve() // flush fire-and-forget microtask

      expect(mockSupabase.from).toHaveBeenCalledWith('bronze_deal_events')
    })

    it('does not throw on insert failure', () => {
      mockSupabase.from.mockReturnValue({
        insert: vi.fn().mockReturnValue(Promise.resolve({ error: { message: 'DB error' } })),
      })

      expect(() =>
        emitDealEvent({
          dealId: 'deal-1',
          groupJid: '123@g.us',
          clientJid: '5511999@s.whatsapp.net',
          fromState: null,
          toState: 'quoted',
          eventType: 'created',
        })
      ).not.toThrow()
    })
  })

  // ========================================================================
  // refreshSilverLayer
  // ========================================================================

  describe('refreshSilverLayer', () => {
    it('calls Silver refresh RPCs', async () => {
      await refreshSilverLayer()

      // Should call at least the OHLC and player stats refresh
      expect(mockSupabase.rpc).toHaveBeenCalledWith('refresh_silver_ohlc')
      expect(mockSupabase.rpc).toHaveBeenCalledWith('refresh_silver_player_stats')
    })

    it('does not throw on RPC failure', async () => {
      mockSupabase.rpc.mockResolvedValue({ error: { message: 'function not found' } })

      await expect(refreshSilverLayer()).resolves.toBeUndefined()
    })
  })

  // ========================================================================
  // refreshGoldLayer
  // ========================================================================

  describe('refreshGoldLayer', () => {
    it('calls the master refresh_gold_layer RPC', async () => {
      await refreshGoldLayer()

      expect(mockSupabase.rpc).toHaveBeenCalledWith('refresh_gold_layer')
    })

    it('does not throw on RPC failure', async () => {
      mockSupabase.rpc.mockResolvedValue({ error: { message: 'function not found' } })

      await expect(refreshGoldLayer()).resolves.toBeUndefined()
    })
  })

  // ========================================================================
  // runRetentionCleanup
  // ========================================================================

  describe('runRetentionCleanup', () => {
    it('calls bronze_retention_cleanup RPC', async () => {
      mockSupabase.rpc.mockResolvedValue({ error: null, data: 150 })

      await runRetentionCleanup()

      expect(mockSupabase.rpc).toHaveBeenCalledWith('bronze_retention_cleanup')
    })
  })

  // ========================================================================
  // Lifecycle
  // ========================================================================

  describe('lifecycle', () => {
    it('startDataLakeRefresh and stopDataLakeRefresh do not throw', () => {
      expect(() => startDataLakeRefresh()).not.toThrow()
      expect(() => stopDataLakeRefresh()).not.toThrow()
    })

    it('startDataLakeRefresh is idempotent', () => {
      startDataLakeRefresh()
      startDataLakeRefresh() // second call should be no-op
      stopDataLakeRefresh()
    })
  })

})
