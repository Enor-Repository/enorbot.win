import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchPrice, BINANCE_API_URL, BINANCE_TIMEOUT_MS } from './binance.js'

// Mock logger to verify logging behavior
vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Import mocked logger for assertions
import { logger } from '../utils/logger.js'

describe('fetchPrice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('constants', () => {
    it('exports correct BINANCE_API_URL', () => {
      expect(BINANCE_API_URL).toBe('https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL')
    })

    it('exports BINANCE_TIMEOUT_MS as 2000ms (NFR10)', () => {
      expect(BINANCE_TIMEOUT_MS).toBe(2000)
    })
  })

  describe('AC1: Successful Price Fetch', () => {
    it('returns price on successful fetch', async () => {
      const mockResponse = { symbol: 'USDTBRL', price: '5.82340000' }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
      )

      const resultPromise = fetchPrice()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBeCloseTo(5.8234)
      }
    })

    it('returns price as number, not string', async () => {
      const mockResponse = { symbol: 'USDTBRL', price: '6.12345678' }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
      )

      const resultPromise = fetchPrice()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(typeof result.data).toBe('number')
        expect(result.data).toBeCloseTo(6.12345678)
      }
    })
  })

  describe('AC2: Fast Response (NFR10 Compliance)', () => {
    it('returns immediately when API responds quickly', async () => {
      const mockResponse = { symbol: 'USDTBRL', price: '5.50000000' }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
      )

      const resultPromise = fetchPrice()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(true)
      // Verify fetch was called with correct URL and AbortSignal
      expect(fetch).toHaveBeenCalledWith(BINANCE_API_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    })
  })

  describe('AC3: Timeout Handling', () => {
    it('returns timeout error after 2 seconds', async () => {
      // Create a fetch that never resolves until aborted
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(
          (_url: string, options: { signal?: AbortSignal }) =>
            new Promise((_, reject) => {
              if (options?.signal) {
                options.signal.addEventListener('abort', () => {
                  reject(new DOMException('Aborted', 'AbortError'))
                })
              }
            })
        )
      )

      const resultPromise = fetchPrice()
      // Advance timer past timeout
      await vi.advanceTimersByTimeAsync(2001)
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Binance timeout')
      }
    })

    it('does NOT timeout before 2 seconds', async () => {
      const mockResponse = { symbol: 'USDTBRL', price: '5.00000000' }
      let resolvePromise: () => void

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              resolvePromise = () =>
                resolve({
                  ok: true,
                  json: () => Promise.resolve(mockResponse),
                })
            })
        )
      )

      const resultPromise = fetchPrice()

      // Advance timer to just before timeout
      await vi.advanceTimersByTimeAsync(1999)

      // Resolve the fetch
      resolvePromise!()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Should succeed, not timeout
      expect(result.ok).toBe(true)
    })
  })

  describe('AC4: API Error Handling', () => {
    it('returns error on 500 status', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        })
      )

      const resultPromise = fetchPrice()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('500')
      }
    })

    it('returns error on 404 status', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
        })
      )

      const resultPromise = fetchPrice()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('404')
      }
    })

    it('returns error on invalid response format', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ invalid: 'data' }),
        })
      )

      const resultPromise = fetchPrice()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Invalid')
      }
    })

    it('returns error on missing price field', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ symbol: 'USDTBRL' }),
        })
      )

      const resultPromise = fetchPrice()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Invalid')
      }
    })

    it('returns error on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

      const resultPromise = fetchPrice()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Network error')
      }
    })

    it('returns error when price is not a valid number', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ symbol: 'USDTBRL', price: 'not-a-number' }),
        })
      )

      const resultPromise = fetchPrice()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Invalid price')
      }

      // AC5: Verify parse error is logged with latency
      expect(logger.error).toHaveBeenCalledWith(
        'Binance price parsing failed',
        expect.objectContaining({
          event: 'binance_parse_error',
          rawPrice: 'not-a-number',
          latencyMs: expect.any(Number),
        })
      )
    })

    it('returns error when symbol field has wrong type', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ symbol: 12345, price: '5.00' }),
        })
      )

      const resultPromise = fetchPrice()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Invalid')
      }
    })
  })

  describe('AC5: Latency Monitoring', () => {
    it('logs success with latencyMs', async () => {
      const mockResponse = { symbol: 'USDTBRL', price: '5.82340000' }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
      )

      const resultPromise = fetchPrice()
      await vi.runAllTimersAsync()
      await resultPromise

      expect(logger.info).toHaveBeenCalledWith(
        'Binance price fetched',
        expect.objectContaining({
          event: 'binance_price_fetched',
          price: expect.any(Number),
          latencyMs: expect.any(Number),
        })
      )
    })

    it('logs timeout with latencyMs', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(
          (_url: string, options: { signal?: AbortSignal }) =>
            new Promise((_, reject) => {
              if (options?.signal) {
                options.signal.addEventListener('abort', () => {
                  reject(new DOMException('Aborted', 'AbortError'))
                })
              }
            })
        )
      )

      const resultPromise = fetchPrice()
      await vi.advanceTimersByTimeAsync(2001)
      await resultPromise

      expect(logger.warn).toHaveBeenCalledWith(
        'Binance timeout',
        expect.objectContaining({
          event: 'binance_timeout',
          latencyMs: expect.any(Number),
          timeoutMs: 2000,
        })
      )
    })

    it('logs API error with latencyMs', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        })
      )

      const resultPromise = fetchPrice()
      await vi.runAllTimersAsync()
      await resultPromise

      expect(logger.error).toHaveBeenCalledWith(
        'Binance API error',
        expect.objectContaining({
          event: 'binance_api_error',
          status: 500,
          latencyMs: expect.any(Number),
        })
      )
    })

    it('logs validation error with latencyMs and Zod error message', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ invalid: 'data' }),
        })
      )

      const resultPromise = fetchPrice()
      await vi.runAllTimersAsync()
      await resultPromise

      expect(logger.error).toHaveBeenCalledWith(
        'Binance response validation failed',
        expect.objectContaining({
          event: 'binance_validation_error',
          error: expect.any(String), // Zod error message is included
          latencyMs: expect.any(Number),
        })
      )
    })

    it('logs fetch error with latencyMs', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')))

      const resultPromise = fetchPrice()
      await vi.runAllTimersAsync()
      await resultPromise

      expect(logger.error).toHaveBeenCalledWith(
        'Binance fetch failed',
        expect.objectContaining({
          event: 'binance_fetch_error',
          error: 'Connection refused',
          latencyMs: expect.any(Number),
        })
      )
    })
  })

  describe('Result pattern compliance', () => {
    it('never throws, always returns Result', async () => {
      // Test with various error scenarios
      const errorScenarios = [
        vi.fn().mockRejectedValue(new Error('Network error')),
        vi.fn().mockRejectedValue(new TypeError('Invalid URL')),
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('JSON parse error')) }),
      ]

      for (const mockFetch of errorScenarios) {
        vi.stubGlobal('fetch', mockFetch)

        // Should not throw
        const resultPromise = fetchPrice()
        await vi.runAllTimersAsync()
        const result = await resultPromise

        // Should always return a Result object
        expect(result).toHaveProperty('ok')
        if (!result.ok) {
          expect(result).toHaveProperty('error')
          expect(typeof result.error).toBe('string')
        }
      }
    })
  })
})
