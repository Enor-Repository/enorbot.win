/**
 * Dashboard API: Price endpoints
 * Proxies external price APIs to avoid CORS issues
 */
import { Router, type Request, type Response } from 'express'
import { logger } from '../../utils/logger.js'

export const pricesRouter = Router()

// Cache for commercial dollar (5 minute TTL)
let commercialDollarCache: {
  bid: number
  ask: number
  spread: number
  timestamp: string
  cachedAt: number
} | null = null
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

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
 */
pricesRouter.get('/commercial-dollar', async (_req: Request, res: Response) => {
  try {
    // Check cache first
    const now = Date.now()
    if (commercialDollarCache && (now - commercialDollarCache.cachedAt) < CACHE_TTL_MS) {
      return res.json({
        bid: commercialDollarCache.bid,
        ask: commercialDollarCache.ask,
        spread: commercialDollarCache.spread,
        timestamp: commercialDollarCache.timestamp,
        cached: true,
        cacheAge: Math.floor((now - commercialDollarCache.cachedAt) / 1000),
      })
    }

    // Fetch fresh data
    const response = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL', {
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

    res.status(500).json({
      error: 'Failed to fetch commercial dollar',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
