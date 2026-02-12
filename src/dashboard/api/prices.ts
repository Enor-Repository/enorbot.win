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

// No hardcoded fallback — a fake price displayed as "fresh" is worse than
// showing an error. When both sources fail, we return HTTP 503.

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

    res.status(500).json({ error: 'Failed to fetch USDT/BRL price' })
  }
})

/**
 * GET /api/prices/commercial-dollar
 * Reads commercial dollar from TradingView page title (instant, no network call).
 * No secondary source fallback.
 * No caching — title reads are free.
 */
pricesRouter.get('/commercial-dollar', async (_req: Request, res: Response) => {
  try {
    const { fetchCommercialDollar } = await import('../../services/awesomeapi.js')
    const result = await fetchCommercialDollar()

    if (!result.ok) {
      throw new Error(result.error)
    }

    res.json({
      price: result.data.bid,
      timestamp: result.data.timestamp || new Date().toISOString(),
    })
  } catch (error) {
    logger.error('Failed to fetch commercial dollar', {
      event: 'price_fetch_error',
      error: error instanceof Error ? error.message : String(error),
    })

    res.status(503).json({
      error: 'Commercial dollar temporarily unavailable',
      timestamp: new Date().toISOString(),
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

  // Cleanup handler for connection termination (guarded against double-fire)
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
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

/**
 * GET /api/prices/ohlc
 * Returns OHLC candle data from the Silver layer for price charting.
 * Query params:
 *   symbol: 'USDT/BRL' (default) or 'USD/BRL'
 *   source: filter by source (optional)
 *   hours: lookback in hours (default 24, max 168)
 */
pricesRouter.get('/ohlc', async (req: Request, res: Response) => {
  try {
    const { getSupabase } = await import('../../services/supabase.js')
    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    const symbol = (req.query.symbol as string) || 'USDT/BRL'
    const source = req.query.source as string | undefined
    const hours = Math.min(parseInt(req.query.hours as string) || 24, 168)

    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

    let query = supabase
      .from('silver_price_ohlc_1m')
      .select('symbol, bucket, source, open_price, high_price, low_price, close_price, tick_count')
      .eq('symbol', symbol)
      .gte('bucket', since)
      .order('bucket', { ascending: true })
      .limit(2000)

    if (source) {
      query = query.eq('source', source)
    }

    const { data, error } = await query

    if (error) {
      if (error.code === 'PGRST205' || error.code === '42P01') {
        return res.json({ candles: [], notice: 'Silver OHLC table not yet initialized' })
      }
      throw error
    }

    const candles = (data || []).map((row: any) => ({
      time: row.bucket,
      source: row.source,
      open: Number(row.open_price),
      high: Number(row.high_price),
      low: Number(row.low_price),
      close: Number(row.close_price),
      tickCount: row.tick_count,
    }))

    res.json({ symbol, hours, candles })
  } catch (error) {
    logger.error('Failed to fetch OHLC data', {
      event: 'ohlc_fetch_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({ error: 'Failed to fetch OHLC data' })
  }
})

/**
 * GET /api/prices/trade-desk
 * Returns trade desk metrics from Gold layer: volume, spread effectiveness, response times.
 * Query params:
 *   days: lookback in days (default 7, max 90)
 *   groupJid: filter by group (optional)
 */
pricesRouter.get('/trade-desk', async (req: Request, res: Response) => {
  try {
    const { getSupabase } = await import('../../services/supabase.js')
    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    const days = Math.min(parseInt(req.query.days as string) || 7, 90)
    const groupJid = req.query.groupJid as string | undefined
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    // Fetch all three Gold tables in parallel
    let volumeQuery = supabase
      .from('gold_daily_trade_volume')
      .select('trade_date, group_jid, deal_count, total_usdt, total_brl, avg_rate, completed, expired, cancelled, rejected')
      .gte('trade_date', sinceDate)
      .order('trade_date', { ascending: false })
      .limit(500)

    let spreadQuery = supabase
      .from('gold_spread_effectiveness')
      .select('trade_date, group_jid, avg_quoted_spread, avg_slippage, spread_capture_pct, deal_count')
      .gte('trade_date', sinceDate)
      .order('trade_date', { ascending: false })
      .limit(500)

    let responseQuery = supabase
      .from('gold_operator_response_times')
      .select('trade_date, group_jid, avg_quote_to_lock_s, avg_lock_to_complete_s, avg_total_deal_s, p50_total_deal_s, p95_total_deal_s, deal_count')
      .gte('trade_date', sinceDate)
      .order('trade_date', { ascending: false })
      .limit(500)

    if (groupJid) {
      volumeQuery = volumeQuery.eq('group_jid', groupJid)
      spreadQuery = spreadQuery.eq('group_jid', groupJid)
      responseQuery = responseQuery.eq('group_jid', groupJid)
    }

    const [volumeResult, spreadResult, responseResult] = await Promise.all([
      volumeQuery,
      spreadQuery,
      responseQuery,
    ])

    // Handle table-not-found gracefully (PGRST205 = PostgREST, 42P01 = Postgres)
    const isNotFound = (code?: string) => code === 'PGRST205' || code === '42P01'
    const volume = isNotFound(volumeResult.error?.code) ? [] : (volumeResult.data || [])
    const spreads = isNotFound(spreadResult.error?.code) ? [] : (spreadResult.data || [])
    const responses = isNotFound(responseResult.error?.code) ? [] : (responseResult.data || [])

    // Check for real errors
    if (volumeResult.error && !isNotFound(volumeResult.error.code)) throw volumeResult.error
    if (spreadResult.error && !isNotFound(spreadResult.error.code)) throw spreadResult.error
    if (responseResult.error && !isNotFound(responseResult.error.code)) throw responseResult.error

    res.json({
      days,
      volume,
      spreads,
      responses,
    })
  } catch (error) {
    logger.error('Failed to fetch trade desk data', {
      event: 'trade_desk_fetch_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({ error: 'Failed to fetch trade desk data' })
  }
})
