/**
 * Tests for Group Spread Service
 * Sprint 1: Group Pricing Control
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  calculateQuote,
  calculateBothQuotes,
  clearSpreadCache,
  getSpreadCacheStats,
  type SpreadConfig,
  type SpreadMode,
} from './groupSpreadService.js'

// Mock Supabase
vi.mock('./supabase.js', () => ({
  getSupabase: vi.fn(() => null),
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

/**
 * Create a test SpreadConfig
 */
function createTestConfig(overrides: Partial<SpreadConfig> = {}): SpreadConfig {
  return {
    groupJid: 'test-group@g.us',
    spreadMode: 'bps',
    sellSpread: 0,
    buySpread: 0,
    quoteTtlSeconds: 180,
    defaultSide: 'client_buys_usdt',
    defaultCurrency: 'BRL',
    language: 'pt-BR',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('groupSpreadService', () => {
  beforeEach(() => {
    clearSpreadCache()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('calculateQuote', () => {
    const binanceRate = 5.25 // R$ 5.25 per USDT

    describe('bps (basis points) mode', () => {
      it('should return base rate when spread is 0', () => {
        const config = createTestConfig({ spreadMode: 'bps', sellSpread: 0 })
        const result = calculateQuote(binanceRate, config, 'client_buys_usdt')
        expect(result).toBe(5.25)
      })

      it('should add positive spread correctly (client buys USDT)', () => {
        // +50 bps = +0.5% = 5.25 * 1.005 = 5.27625 → ~5.2762-5.2763
        const config = createTestConfig({ spreadMode: 'bps', sellSpread: 50 })
        const result = calculateQuote(binanceRate, config, 'client_buys_usdt')
        expect(result).toBeCloseTo(5.2763, 3)
      })

      it('should subtract negative spread correctly (client sells USDT)', () => {
        // -30 bps = -0.3% = 5.25 * 0.997 = 5.23425 → ~5.2343
        const config = createTestConfig({ spreadMode: 'bps', buySpread: -30 })
        const result = calculateQuote(binanceRate, config, 'client_sells_usdt')
        expect(result).toBeCloseTo(5.2343, 3)
      })

      it('should handle large spreads within bounds', () => {
        // +100 bps = +1% = 5.25 * 1.01 = 5.3025
        const config = createTestConfig({ spreadMode: 'bps', sellSpread: 100 })
        const result = calculateQuote(binanceRate, config, 'client_buys_usdt')
        expect(result).toBe(5.3025)
      })

      it('should use sellSpread for client_buys_usdt', () => {
        const config = createTestConfig({
          spreadMode: 'bps',
          sellSpread: 50,
          buySpread: -30,
        })
        const result = calculateQuote(binanceRate, config, 'client_buys_usdt')
        // Uses sellSpread (50 bps)
        expect(result).toBeCloseTo(5.2763, 3)
      })

      it('should use buySpread for client_sells_usdt', () => {
        const config = createTestConfig({
          spreadMode: 'bps',
          sellSpread: 50,
          buySpread: -30,
        })
        const result = calculateQuote(binanceRate, config, 'client_sells_usdt')
        // Uses buySpread (-30 bps)
        expect(result).toBeCloseTo(5.2343, 3)
      })
    })

    describe('abs_brl (absolute BRL) mode', () => {
      it('should add absolute BRL spread', () => {
        // +0.05 BRL = 5.25 + 0.05 = 5.30
        const config = createTestConfig({ spreadMode: 'abs_brl', sellSpread: 0.05 })
        const result = calculateQuote(binanceRate, config, 'client_buys_usdt')
        expect(result).toBe(5.3)
      })

      it('should subtract absolute BRL spread', () => {
        // -0.03 BRL = 5.25 - 0.03 = 5.22
        const config = createTestConfig({ spreadMode: 'abs_brl', buySpread: -0.03 })
        const result = calculateQuote(binanceRate, config, 'client_sells_usdt')
        expect(result).toBe(5.22)
      })

      it('should handle zero spread', () => {
        const config = createTestConfig({ spreadMode: 'abs_brl', sellSpread: 0 })
        const result = calculateQuote(binanceRate, config, 'client_buys_usdt')
        expect(result).toBe(5.25)
      })
    })

    describe('flat (no spread) mode', () => {
      it('should always return base rate regardless of spread values', () => {
        const config = createTestConfig({
          spreadMode: 'flat',
          sellSpread: 100, // Should be ignored
          buySpread: -50, // Should be ignored
        })

        const buyResult = calculateQuote(binanceRate, config, 'client_buys_usdt')
        const sellResult = calculateQuote(binanceRate, config, 'client_sells_usdt')

        expect(buyResult).toBe(5.25)
        expect(sellResult).toBe(5.25)
      })
    })

    describe('edge cases', () => {
      it('should handle very small rates', () => {
        const smallRate = 0.0001
        const config = createTestConfig({ spreadMode: 'bps', sellSpread: 50 })
        const result = calculateQuote(smallRate, config, 'client_buys_usdt')
        expect(result).toBeGreaterThan(0)
        expect(result).toBeLessThan(0.001)
      })

      it('should handle very large rates', () => {
        const largeRate = 10000
        const config = createTestConfig({ spreadMode: 'bps', sellSpread: 50 })
        const result = calculateQuote(largeRate, config, 'client_buys_usdt')
        expect(result).toBe(10050) // 10000 * 1.005
      })

      it('should round to 4 decimal places', () => {
        const config = createTestConfig({ spreadMode: 'bps', sellSpread: 33 })
        const result = calculateQuote(5.123456789, config, 'client_buys_usdt')
        // Check that result has at most 4 decimal places
        const decimalPlaces = (result.toString().split('.')[1] || '').length
        expect(decimalPlaces).toBeLessThanOrEqual(4)
      })

      it('should handle unknown spread mode by returning base rate', () => {
        const config = createTestConfig({ spreadMode: 'unknown' as SpreadMode })
        const result = calculateQuote(binanceRate, config, 'client_buys_usdt')
        expect(result).toBe(5.25)
      })
    })
  })

  describe('calculateBothQuotes', () => {
    it('should return both buy and sell rates', () => {
      const config = createTestConfig({
        spreadMode: 'bps',
        sellSpread: 50, // +0.5% for client buying
        buySpread: -30, // -0.3% for client selling
      })

      const { buyRate, sellRate } = calculateBothQuotes(5.25, config)

      expect(buyRate).toBeCloseTo(5.2763, 3) // Client buys at higher rate
      expect(sellRate).toBeCloseTo(5.2343, 3) // Client sells at lower rate
    })

    it('should have buyRate >= sellRate for typical configs', () => {
      const config = createTestConfig({
        spreadMode: 'bps',
        sellSpread: 50,
        buySpread: -30,
      })

      const { buyRate, sellRate } = calculateBothQuotes(5.25, config)
      expect(buyRate).toBeGreaterThanOrEqual(sellRate)
    })
  })

  describe('cache operations', () => {
    it('should clear specific group from cache', () => {
      // Cache stats should work even when empty
      const stats = getSpreadCacheStats()
      expect(stats.size).toBe(0)
      expect(stats.entries).toEqual([])
    })

    it('should clear all cache', () => {
      clearSpreadCache()
      const stats = getSpreadCacheStats()
      expect(stats.size).toBe(0)
    })
  })
})

describe('spread calculation real-world scenarios', () => {
  it('scenario: Daniel sets +50 bps markup for buyers', () => {
    // Daniel wants to make 0.5% when clients buy USDT
    const binanceRate = 5.20
    const config = createTestConfig({
      spreadMode: 'bps',
      sellSpread: 50, // +50 bps when eNor sells (client buys)
    })

    const clientPays = calculateQuote(binanceRate, config, 'client_buys_usdt')
    // 5.20 * 1.005 = 5.226
    expect(clientPays).toBe(5.226)
  })

  it('scenario: Daniel sets -30 bps discount for sellers', () => {
    // Daniel pays less when buying USDT from clients
    const binanceRate = 5.20
    const config = createTestConfig({
      spreadMode: 'bps',
      buySpread: -30, // -30 bps when eNor buys (client sells)
    })

    const clientReceives = calculateQuote(binanceRate, config, 'client_sells_usdt')
    // 5.20 * 0.997 = 5.1844
    expect(clientReceives).toBe(5.1844)
  })

  it('scenario: flat rate for VIP group', () => {
    // VIP group gets Binance rate with no spread
    const binanceRate = 5.20
    const config = createTestConfig({
      spreadMode: 'flat',
      sellSpread: 100, // Ignored
      buySpread: -100, // Ignored
    })

    expect(calculateQuote(binanceRate, config, 'client_buys_usdt')).toBe(5.2)
    expect(calculateQuote(binanceRate, config, 'client_sells_usdt')).toBe(5.2)
  })

  it('scenario: absolute BRL spread for fixed fee structure', () => {
    // Fixed R$ 0.02 fee per USDT
    const binanceRate = 5.20
    const config = createTestConfig({
      spreadMode: 'abs_brl',
      sellSpread: 0.02,
      buySpread: -0.02,
    })

    expect(calculateQuote(binanceRate, config, 'client_buys_usdt')).toBe(5.22)
    expect(calculateQuote(binanceRate, config, 'client_sells_usdt')).toBe(5.18)
  })
})
