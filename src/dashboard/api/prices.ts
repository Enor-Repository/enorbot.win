/**
 * Dashboard API: Price endpoints
 * Proxies external price APIs to avoid CORS issues
 * + SSE endpoint for real-time price streaming
 */
import { config as loadEnv } from 'dotenv'
import { Router, type Request, type Response } from 'express'
import { logger } from '../../utils/logger.js'
import { onPriceUpdate, getCurrentPrice, getConnectionStatus } from '../../services/binanceWebSocket.js'

// Ensure .env is loaded for AWESOMEAPI_TOKEN
loadEnv()

// SSE connection management
const MAX_SSE_CONNECTIONS = 10
let activeConnections = 0
const BROADCAST_INTERVAL_MS = 200 // Throttle to ~5 updates/second

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

/**
 * GET /api/prices/stream
 * Server-Sent Events endpoint for real-time USDT/BRL prices
 * Throttled to ~5 updates/second to reduce bandwidth
 */
pricesRouter.get('/stream', (req: Request, res: Response) => {
  // Rate limiting - prevent too many concurrent connections
  if (activeConnections >= MAX_SSE_CONNECTIONS) {
    logger.warn('SSE connection rejected - max connections reached', {
      event: 'sse_connection_rejected',
      activeConnections,
      maxConnections: MAX_SSE_CONNECTIONS,
    })
    res.status(503).json({ error: 'Too many connections' })
    return
  }

  activeConnections++
  logger.info('SSE connection opened', {
    event: 'sse_connection_opened',
    activeConnections,
  })

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // Disable nginx buffering
  res.flushHeaders()

  // Send initial connection status
  const initialPrice = getCurrentPrice()
  const connectionStatus = getConnectionStatus()
  res.write(`data: ${JSON.stringify({
    price: initialPrice,
    timestamp: Date.now(),
    connectionStatus,
    type: 'initial',
  })}\n\n`)

  // Throttle tracking
  let lastBroadcast = 0

  // Subscribe to price updates
  const unsubscribe = onPriceUpdate((price) => {
    const now = Date.now()
    if (now - lastBroadcast >= BROADCAST_INTERVAL_MS) {
      lastBroadcast = now
      try {
        res.write(`data: ${JSON.stringify({
          price,
          timestamp: now,
          connectionStatus: getConnectionStatus(),
          type: 'update',
        })}\n\n`)
      } catch (e) {
        // Connection may have closed
        logger.debug('SSE write failed', {
          event: 'sse_write_error',
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  })

  // Heartbeat every 30 seconds to keep connection alive
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`)
    } catch {
      // Connection closed
    }
  }, 30000)

  // Cleanup handler for connection termination
  const cleanup = () => {
    activeConnections--
    unsubscribe()
    clearInterval(heartbeatInterval)
    logger.info('SSE connection closed', {
      event: 'sse_connection_closed',
      activeConnections,
    })
  }

  // Handle both close and error events to prevent connection leaks
  req.on('close', cleanup)
  req.on('error', (error) => {
    logger.warn('SSE connection error', {
      event: 'sse_connection_error',
      error: error.message,
    })
    cleanup()
  })
})

/**
 * GET /api/prices/stream/status
 * Returns current SSE status without opening a stream
 */
pricesRouter.get('/stream/status', (_req: Request, res: Response) => {
  res.json({
    activeConnections,
    maxConnections: MAX_SSE_CONNECTIONS,
    currentPrice: getCurrentPrice(),
    connectionStatus: getConnectionStatus(),
    available: activeConnections < MAX_SSE_CONNECTIONS,
  })
})
