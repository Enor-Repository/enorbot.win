/**
 * Binance WebSocket Service for real-time USDT/BRL streaming.
 * Provides continuous price updates for volatility monitoring.
 */
import WebSocket from 'ws'
import { z } from 'zod'
import { logger } from '../utils/logger.js'
import { fetchPrice } from './binance.js'
import { emitPriceTick } from './dataLake.js'

/**
 * Binance WebSocket URL for USDT/BRL trades.
 * Can be overridden via environment variable for testing.
 */
const BINANCE_WS_URL =
  process.env.BINANCE_WS_URL || 'wss://stream.binance.com:9443/ws/usdtbrl@trade'

/**
 * Reconnection settings with exponential backoff.
 */
const INITIAL_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 10000
const RECONNECT_MULTIPLIER = 2

/**
 * REST fallback polling interval during WebSocket reconnection.
 */
const REST_FALLBACK_INTERVAL_MS = 2000

/**
 * Overlap period - keep REST running briefly after reconnect to avoid gaps.
 */
const OVERLAP_PERIOD_MS = 2000

/**
 * Zod schema for Binance trade stream message.
 * Format: { "e": "trade", "s": "USDTBRL", "p": "5.82340000", ... }
 */
const BinanceTradeSchema = z.object({
  e: z.literal('trade'),
  s: z.string(),
  p: z.string(),
})

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'
type PriceCallback = (price: number) => void

// Module state
let ws: WebSocket | null = null
let currentPrice: number | null = null
let connectionStatus: ConnectionStatus = 'disconnected'
let reconnectDelay = INITIAL_RECONNECT_DELAY_MS
let reconnectTimer: NodeJS.Timeout | null = null
let fallbackInterval: NodeJS.Timeout | null = null
const priceCallbacks: Set<PriceCallback> = new Set()

/**
 * Notify all registered callbacks of a price update.
 */
function notifyPriceUpdate(price: number): void {
  currentPrice = price

  // Bronze layer: emit price tick (5s throttle applied inside dataLake)
  emitPriceTick('binance_ws', 'USDT/BRL', price)

  for (const callback of priceCallbacks) {
    try {
      callback(price)
    } catch (error) {
      logger.error('Price callback error', {
        event: 'price_callback_error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * Start REST polling fallback during WebSocket disconnect.
 */
function startRestFallback(): void {
  if (fallbackInterval) return // Already running

  logger.info('Starting REST fallback polling', {
    event: 'rest_fallback_started',
    intervalMs: REST_FALLBACK_INTERVAL_MS,
  })

  fallbackInterval = setInterval(async () => {
    const result = await fetchPrice()
    if (result.ok) {
      notifyPriceUpdate(result.data)
    }
  }, REST_FALLBACK_INTERVAL_MS)
}

/**
 * Stop REST polling fallback after WebSocket reconnects.
 * Uses overlap period to prevent gaps during rapid reconnect cycles.
 */
function stopRestFallbackWithOverlap(): void {
  setTimeout(() => {
    if (fallbackInterval && connectionStatus === 'connected') {
      clearInterval(fallbackInterval)
      fallbackInterval = null
      logger.info('REST fallback stopped after overlap period', {
        event: 'rest_fallback_stopped',
      })
    }
  }, OVERLAP_PERIOD_MS)
}

/**
 * Connect to Binance WebSocket.
 */
function connect(): void {
  if (ws && connectionStatus !== 'disconnected') return

  connectionStatus = 'connecting'
  logger.info('Connecting to Binance WebSocket', {
    event: 'binance_ws_connecting',
    url: BINANCE_WS_URL,
  })

  ws = new WebSocket(BINANCE_WS_URL)

  ws.on('open', () => {
    connectionStatus = 'connected'
    reconnectDelay = INITIAL_RECONNECT_DELAY_MS
    logger.info('Binance WebSocket connected', {
      event: 'binance_ws_connected',
    })
    stopRestFallbackWithOverlap()
  })

  ws.on('message', (data: Buffer) => {
    try {
      const json = JSON.parse(data.toString())
      const parsed = BinanceTradeSchema.safeParse(json)

      if (!parsed.success) {
        // Skip non-trade messages (e.g., subscription confirmations)
        return
      }

      const price = parseFloat(parsed.data.p)
      if (!Number.isFinite(price) || price <= 0) {
        logger.warn('Invalid price received from WebSocket', {
          event: 'binance_ws_invalid_price',
          rawPrice: parsed.data.p,
        })
        return
      }

      notifyPriceUpdate(price)
    } catch (error) {
      logger.warn('Failed to parse WebSocket message', {
        event: 'binance_ws_parse_error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  ws.on('error', (error) => {
    logger.error('Binance WebSocket error', {
      event: 'binance_ws_error',
      error: error.message,
    })
  })

  ws.on('close', (code, reason) => {
    connectionStatus = 'disconnected'
    ws = null

    logger.warn('Binance WebSocket closed', {
      event: 'binance_ws_closed',
      code,
      reason: reason.toString(),
    })

    startRestFallback()
    scheduleReconnect()
  })
}

/**
 * Schedule reconnection with exponential backoff.
 */
function scheduleReconnect(): void {
  if (reconnectTimer) return

  logger.info('Scheduling WebSocket reconnection', {
    event: 'binance_ws_reconnect_scheduled',
    delayMs: reconnectDelay,
  })

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, reconnectDelay)

  reconnectDelay = Math.min(reconnectDelay * RECONNECT_MULTIPLIER, MAX_RECONNECT_DELAY_MS)
}

/**
 * Start the Binance WebSocket connection.
 * Should be called on bot startup.
 */
export function startWebSocket(): void {
  logger.info('Starting Binance WebSocket service', {
    event: 'binance_ws_service_start',
  })
  connect()
}

/**
 * Stop the Binance WebSocket connection.
 * Should be called on graceful shutdown.
 */
export function stopWebSocket(): void {
  logger.info('Stopping Binance WebSocket service', {
    event: 'binance_ws_service_stop',
  })

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  if (fallbackInterval) {
    clearInterval(fallbackInterval)
    fallbackInterval = null
  }

  if (ws) {
    ws.close()
    ws = null
  }

  connectionStatus = 'disconnected'
  currentPrice = null
  priceCallbacks.clear()
}

/**
 * Get the current price from WebSocket stream.
 * Returns null if no price has been received yet.
 */
export function getCurrentPrice(): number | null {
  return currentPrice
}

/**
 * Register a callback to be called on every price update.
 * Returns an unsubscribe function.
 */
export function onPriceUpdate(callback: PriceCallback): () => void {
  priceCallbacks.add(callback)
  return () => {
    priceCallbacks.delete(callback)
  }
}

/**
 * Get the current connection status.
 */
export function getConnectionStatus(): ConnectionStatus {
  return connectionStatus
}

// For testing - reset module state
export function _resetForTesting(): void {
  stopWebSocket()
  currentPrice = null
  connectionStatus = 'disconnected'
  reconnectDelay = INITIAL_RECONNECT_DELAY_MS
}
