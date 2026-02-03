/**
 * Dashboard API: Price endpoints
 * Proxies external price APIs to avoid CORS issues
 */
import { config as loadEnv } from 'dotenv'
import { Router, type Request, type Response } from 'express'
import { logger } from '../../utils/logger.js'

// Ensure .env is loaded for AWESOMEAPI_TOKEN
loadEnv()

export const pricesRouter = Router()

// Fallback values when API is rate-limited (updated 2026-02-02)
const FALLBACK_USD_BRL_BID = 5.26
const FALLBACK_USD_BRL_ASK = 5.27
const FALLBACK_USD_BRL_SPREAD = 0.01

// Cache for commercial dollar (15 minute TTL - AwesomeAPI rate limits)
let commercialDollarCache: {
  bid: number
  ask: number
  spread: number
  timestamp: string
  cachedAt: number
} | null = null
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes - AwesomeAPI has strict rate limits

/**
 * GET /api/prices/usdt-brl
 * Proxies Binance USDT/BRL price to avoid CORS
 */
pricesRouter.get('/usdt-brl', async (_req: Request, res: Response) => {
  try {
    const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL', {
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`)
    }

    const data = await response.json()

    res.json({
      price: parseFloat(data.price),
      symbol: data.symbol,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    logger.error('Failed to fetch USDT/BRL price', {
      event: 'price_fetch_error',
      error: error instanceof Error ? error.message : String(error),
    })

    res.status(500).json({
      error: 'Failed to fetch USDT/BRL price',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * GET /api/prices/commercial-dollar
 * Proxies AwesomeAPI commercial dollar rate with server-side caching
 * Query params:
 *   - force=true: bypass cache and fetch fresh data
 */
pricesRouter.get('/commercial-dollar', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.force === 'true'

    // Check cache first (unless force refresh)
    const now = Date.now()
    if (!forceRefresh && commercialDollarCache && (now - commercialDollarCache.cachedAt) < CACHE_TTL_MS) {
      logger.debug('Commercial dollar from cache', {
        event: 'commercial_dollar_cache_hit',
        cacheAge: Math.floor((now - commercialDollarCache.cachedAt) / 1000),
      })
      return res.json({
        bid: commercialDollarCache.bid,
        ask: commercialDollarCache.ask,
        spread: commercialDollarCache.spread,
        timestamp: commercialDollarCache.timestamp,
        cached: true,
        cacheAge: Math.floor((now - commercialDollarCache.cachedAt) / 1000),
      })
    }

    logger.info('Fetching commercial dollar from AwesomeAPI', {
      event: 'commercial_dollar_fetch',
      reason: forceRefresh ? 'force_refresh' : 'cache_miss_or_expired',
    })

    // Fetch fresh data - use token if available for higher rate limits
    const token = process.env.AWESOMEAPI_TOKEN || ''
    const apiUrl = token
      ? `https://economia.awesomeapi.com.br/json/last/USD-BRL?token=${token}`
      : 'https://economia.awesomeapi.com.br/json/last/USD-BRL'

    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`AwesomeAPI error: ${response.status}`)
    }

    const data = await response.json()
    const usdBrl = data.USDBRL

    if (!usdBrl || !usdBrl.bid || !usdBrl.ask) {
      throw new Error('Invalid response from AwesomeAPI')
    }

    const bid = parseFloat(usdBrl.bid)
    const ask = parseFloat(usdBrl.ask)
    const spread = ask - bid

    // Update cache
    commercialDollarCache = {
      bid,
      ask,
      spread,
      timestamp: usdBrl.create_date || new Date().toISOString(),
      cachedAt: now,
    }

    logger.info('Commercial dollar fetched successfully', {
      event: 'commercial_dollar_success',
      bid,
      ask,
      spread,
    })

    res.json({
      bid,
      ask,
      spread,
      timestamp: commercialDollarCache.timestamp,
      cached: false,
      cacheAge: 0,
    })
  } catch (error) {
    logger.error('Failed to fetch commercial dollar', {
      event: 'price_fetch_error',
      error: error instanceof Error ? error.message : String(error),
    })

    // If we have stale cache, return it with warning
    if (commercialDollarCache) {
      return res.json({
        bid: commercialDollarCache.bid,
        ask: commercialDollarCache.ask,
        spread: commercialDollarCache.spread,
        timestamp: commercialDollarCache.timestamp,
        cached: true,
        cacheAge: Math.floor((Date.now() - commercialDollarCache.cachedAt) / 1000),
        stale: true,
      })
    }

    // Return a reasonable fallback value when rate-limited and no cache
    // This prevents the UI from showing blank
    res.json({
      bid: FALLBACK_USD_BRL_BID,
      ask: FALLBACK_USD_BRL_ASK,
      spread: FALLBACK_USD_BRL_SPREAD,
      timestamp: new Date().toISOString(),
      cached: false,
      cacheAge: 0,
      fallback: true,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
