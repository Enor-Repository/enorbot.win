import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchCommercialDollar, fetchFromAwesomeApiRest, AWESOMEAPI_TIMEOUT_MS } from './awesomeapi.js'

// Mock logger to verify logging behavior
vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock TradingView scraper — returns null by default (unavailable)
vi.mock('./tradingViewScraper.js', () => ({
  getCommercialDollarPrice: vi.fn().mockResolvedValue(null),
}))

// Mock data lake to prevent bronze tick side effects during tests
vi.mock('./dataLake.js', () => ({
  emitPriceTick: vi.fn(),
}))

// Import mocked modules for assertions
import { logger } from '../utils/logger.js'
import { getCommercialDollarPrice } from './tradingViewScraper.js'

const mockGetCommercialDollarPrice = vi.mocked(getCommercialDollarPrice)

describe('fetchCommercialDollar', () => {
  const originalEnv = process.env.AWESOMEAPI_TOKEN

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    // Default: scraper returns null → unavailable
    mockGetCommercialDollarPrice.mockResolvedValue(null)
    // Set a valid token for most tests
    process.env.AWESOMEAPI_TOKEN = 'test-token-123'
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    process.env.AWESOMEAPI_TOKEN = originalEnv
  })

  describe('constants', () => {
    it('exports AWESOMEAPI_TIMEOUT_MS as 2000ms', () => {
      expect(AWESOMEAPI_TIMEOUT_MS).toBe(2000)
    })
  })

  describe('TradingView primary path', () => {
    it('returns TradingView price when scraper is available', async () => {
      mockGetCommercialDollarPrice.mockResolvedValue(5.2169)

      const resultPromise = fetchCommercialDollar()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.bid).toBeCloseTo(5.2169)
        expect(result.data.ask).toBeCloseTo(5.2169)
        expect(result.data.spread).toBe(0)
        expect(result.data.timestamp).toBeDefined()
      }
    })

    it('uses bid = ask = scraped price (single reference rate)', async () => {
      mockGetCommercialDollarPrice.mockResolvedValue(5.3)

      const resultPromise = fetchCommercialDollar()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.bid).toBe(result.data.ask)
      }
    })

    it('does not call AwesomeAPI when scraper succeeds', async () => {
      mockGetCommercialDollarPrice.mockResolvedValue(5.22)
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      const resultPromise = fetchCommercialDollar()
      await vi.runAllTimersAsync()
      await resultPromise

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('logs TradingView source when scraper succeeds', async () => {
      mockGetCommercialDollarPrice.mockResolvedValue(5.2169)

      const resultPromise = fetchCommercialDollar()
      await vi.runAllTimersAsync()
      await resultPromise

      expect(logger.debug).toHaveBeenCalledWith(
        'Commercial dollar from TradingView',
        expect.objectContaining({
          event: 'tradingview_price_used',
          price: 5.2169,
        })
      )
    })

    it('returns unavailable when scraper returns null', async () => {
      mockGetCommercialDollarPrice.mockResolvedValue(null)
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      const resultPromise = fetchCommercialDollar()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('TradingView commercial dollar unavailable')
      }
      expect(mockFetch).not.toHaveBeenCalled()

      expect(logger.warn).toHaveBeenCalledWith(
        'TradingView commercial dollar unavailable',
        expect.objectContaining({
          event: 'tradingview_price_unavailable',
        })
      )
    })
  })

  describe('AwesomeAPI fallback: Successful Price Fetch', () => {
    it('returns bid and ask prices on successful fetch', async () => {
      const mockResponse = {
        USDBRL: {
          code: 'USD',
          codein: 'BRL',
          bid: '5.2584',
          ask: '5.2614',
          high: '5.3000',
          low: '5.2000',
          create_date: '2025-01-30 14:30:00',
        },
      }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
      )

      const resultPromise = fetchFromAwesomeApiRest()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.bid).toBeCloseTo(5.2584)
        expect(result.data.ask).toBeCloseTo(5.2614)
        expect(result.data.spread).toBeCloseTo(0.003)
        expect(result.data.timestamp).toBe('2025-01-30 14:30:00')
      }
    })

    it('returns prices as numbers, not strings', async () => {
      const mockResponse = {
        USDBRL: {
          code: 'USD',
          codein: 'BRL',
          bid: '6.12345678',
          ask: '6.13000000',
        },
      }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
      )

      const resultPromise = fetchFromAwesomeApiRest()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(typeof result.data.bid).toBe('number')
        expect(typeof result.data.ask).toBe('number')
        expect(typeof result.data.spread).toBe('number')
      }
    })
  })

  describe('AwesomeAPI fallback: Token Validation', () => {
    it('returns error when AWESOMEAPI_TOKEN is not set', async () => {
      process.env.AWESOMEAPI_TOKEN = ''

      const resultPromise = fetchFromAwesomeApiRest()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('AwesomeAPI token not configured')
      }
    })
  })

  describe('AwesomeAPI fallback: Timeout Handling', () => {
    it('returns timeout error after 2 seconds', async () => {
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

      const resultPromise = fetchFromAwesomeApiRest()
      await vi.advanceTimersByTimeAsync(2001)
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('AwesomeAPI timeout')
      }
    })

    it('does NOT timeout before 2 seconds', async () => {
      const mockResponse = {
        USDBRL: {
          code: 'USD',
          codein: 'BRL',
          bid: '5.00',
          ask: '5.01',
        },
      }
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

      const resultPromise = fetchFromAwesomeApiRest()
      await vi.advanceTimersByTimeAsync(1999)
      resolvePromise!()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(true)
    })
  })

  describe('AwesomeAPI fallback: API Error Handling', () => {
    it('returns error on 500 status', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        })
      )

      const resultPromise = fetchFromAwesomeApiRest()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('500')
      }
    })

    it('returns error on 401 status (invalid token)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
        })
      )

      const resultPromise = fetchFromAwesomeApiRest()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('401')
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

      const resultPromise = fetchFromAwesomeApiRest()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Invalid')
      }
    })

    it('returns error on missing USDBRL field', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ EURBRL: { bid: '5.00', ask: '5.01' } }),
        })
      )

      const resultPromise = fetchFromAwesomeApiRest()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Invalid')
      }
    })

    it('returns error on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

      const resultPromise = fetchFromAwesomeApiRest()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Network error')
      }
    })

    it('returns error when bid is not a valid number', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              USDBRL: {
                code: 'USD',
                codein: 'BRL',
                bid: 'not-a-number',
                ask: '5.01',
              },
            }),
        })
      )

      const resultPromise = fetchFromAwesomeApiRest()
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Invalid price')
      }

      expect(logger.error).toHaveBeenCalledWith(
        'AwesomeAPI price parsing failed',
        expect.objectContaining({
          event: 'awesomeapi_parse_error',
          rawBid: 'not-a-number',
          latencyMs: expect.any(Number),
        })
      )
    })
  })

  describe('AwesomeAPI fallback: Latency Monitoring', () => {
    it('logs success with latencyMs', async () => {
      const mockResponse = {
        USDBRL: {
          code: 'USD',
          codein: 'BRL',
          bid: '5.2584',
          ask: '5.2614',
        },
      }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
      )

      const resultPromise = fetchFromAwesomeApiRest()
      await vi.runAllTimersAsync()
      await resultPromise

      expect(logger.info).toHaveBeenCalledWith(
        'AwesomeAPI commercial dollar fetched (fallback)',
        expect.objectContaining({
          event: 'awesomeapi_price_fetched',
          bid: expect.any(Number),
          ask: expect.any(Number),
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

      const resultPromise = fetchFromAwesomeApiRest()
      await vi.advanceTimersByTimeAsync(2001)
      await resultPromise

      expect(logger.warn).toHaveBeenCalledWith(
        'AwesomeAPI timeout',
        expect.objectContaining({
          event: 'awesomeapi_timeout',
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

      const resultPromise = fetchFromAwesomeApiRest()
      await vi.runAllTimersAsync()
      await resultPromise

      expect(logger.error).toHaveBeenCalledWith(
        'AwesomeAPI error',
        expect.objectContaining({
          event: 'awesomeapi_error',
          status: 500,
          latencyMs: expect.any(Number),
        })
      )
    })
  })

  describe('Result pattern compliance', () => {
    it('never throws, always returns Result', async () => {
      const errorScenarios = [
        vi.fn().mockRejectedValue(new Error('Network error')),
        vi.fn().mockRejectedValue(new TypeError('Invalid URL')),
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('JSON parse error')) }),
      ]

      for (const mockFetch of errorScenarios) {
        vi.stubGlobal('fetch', mockFetch)

        const resultPromise = fetchFromAwesomeApiRest()
        await vi.runAllTimersAsync()
        const result = await resultPromise

        expect(result).toHaveProperty('ok')
        if (!result.ok) {
          expect(result).toHaveProperty('error')
          expect(typeof result.error).toBe('string')
        }
      }
    })
  })
})
