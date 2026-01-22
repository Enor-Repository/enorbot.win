import { z } from 'zod'
import { ok, err, type Result } from '../utils/result.js'
import { logger } from '../utils/logger.js'
import { recordSuccess } from './errors.js'

/**
 * Binance API endpoint for USDT/BRL spot price.
 * Public API - no authentication required.
 */
export const BINANCE_API_URL = 'https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL'

/**
 * Timeout for Binance API requests in milliseconds.
 * NFR10: Binance <2s or fallback.
 */
export const BINANCE_TIMEOUT_MS = 2000

/**
 * Zod schema for validating Binance ticker response.
 * Response format: { "symbol": "USDTBRL", "price": "5.82340000" }
 */
const BinanceTickerSchema = z.object({
  symbol: z.string(),
  price: z.string(),
})

/**
 * Type inferred from Zod schema.
 */
export type BinanceTickerResponse = z.infer<typeof BinanceTickerSchema>

/**
 * Fetch current USDT/BRL spot price from Binance.
 * Returns Result type - never throws.
 *
 * @returns Promise<Result<number>> - ok(price) on success, err(message) on failure
 */
export async function fetchPrice(): Promise<Result<number>> {
  const startTime = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), BINANCE_TIMEOUT_MS)

  try {
    const response = await fetch(BINANCE_API_URL, {
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    const latencyMs = Date.now() - startTime

    if (!response.ok) {
      logger.error('Binance API error', {
        event: 'binance_api_error',
        status: response.status,
        latencyMs,
      })
      return err(`Binance API error: ${response.status}`)
    }

    const data = await response.json()
    const parsed = BinanceTickerSchema.safeParse(data)

    if (!parsed.success) {
      logger.error('Binance response validation failed', {
        event: 'binance_validation_error',
        error: parsed.error.message,
        latencyMs,
      })
      return err('Invalid Binance response format')
    }

    const price = parseFloat(parsed.data.price)

    if (isNaN(price)) {
      logger.error('Binance price parsing failed', {
        event: 'binance_parse_error',
        rawPrice: parsed.data.price,
        latencyMs,
      })
      return err('Invalid price format from Binance')
    }

    logger.info('Binance price fetched', {
      event: 'binance_price_fetched',
      price,
      latencyMs,
    })

    // Reset Binance failure counter on success (Story 3.1 Task 5.5)
    recordSuccess('binance')

    return ok(price)
  } catch (error) {
    clearTimeout(timeoutId)
    const latencyMs = Date.now() - startTime

    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn('Binance timeout', {
        event: 'binance_timeout',
        latencyMs,
        timeoutMs: BINANCE_TIMEOUT_MS,
      })
      return err('Binance timeout')
    }

    logger.error('Binance fetch failed', {
      event: 'binance_fetch_error',
      error: error instanceof Error ? error.message : String(error),
      latencyMs,
    })
    return err(error instanceof Error ? error.message : 'Unknown error')
  }
}
