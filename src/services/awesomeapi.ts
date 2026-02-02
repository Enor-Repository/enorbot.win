import { z } from 'zod'
import { ok, err, type Result } from '../utils/result.js'
import { logger } from '../utils/logger.js'
import { recordSuccess } from './errors.js'

/**
 * AwesomeAPI base endpoint for commercial USD/BRL exchange rate.
 */
export const AWESOMEAPI_BASE_URL = 'https://economia.awesomeapi.com.br/json/last/USD-BRL'

/**
 * Get the full API URL with token (read at runtime for testability).
 */
export function getAwesomeApiUrl(): string {
  const token = process.env.AWESOMEAPI_TOKEN || ''
  return `${AWESOMEAPI_BASE_URL}?token=${token}`
}

/**
 * Timeout for AwesomeAPI requests in milliseconds.
 * Using same timeout as Binance for consistency.
 */
export const AWESOMEAPI_TIMEOUT_MS = 2000

/**
 * Zod schema for validating AwesomeAPI response.
 * Response format: { "USDBRL": { "code": "USD", "codein": "BRL", "bid": "5.2584", "ask": "5.2614", ... } }
 */
const AwesomeAPIResponseSchema = z.object({
  USDBRL: z.object({
    code: z.string(),
    codein: z.string(),
    bid: z.string(),
    ask: z.string(),
    high: z.string().optional(),
    low: z.string().optional(),
    varBid: z.string().optional(),
    pctChange: z.string().optional(),
    timestamp: z.string().optional(),
    create_date: z.string().optional(),
  }),
})

/**
 * Type inferred from Zod schema.
 */
export type AwesomeAPIResponse = z.infer<typeof AwesomeAPIResponseSchema>

/**
 * Commercial dollar quote result with bid and ask prices.
 */
export interface CommercialDollarQuote {
  bid: number
  ask: number
  spread: number
  timestamp?: string
}

/**
 * Fetch current commercial USD/BRL exchange rate from AwesomeAPI.
 * Returns Result type - never throws.
 *
 * @returns Promise<Result<CommercialDollarQuote>> - ok(quote) on success, err(message) on failure
 */
export async function fetchCommercialDollar(): Promise<Result<CommercialDollarQuote>> {
  const startTime = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), AWESOMEAPI_TIMEOUT_MS)

  const token = process.env.AWESOMEAPI_TOKEN || ''
  if (!token) {
    logger.error('AwesomeAPI token not configured', {
      event: 'awesomeapi_no_token',
    })
    return err('AwesomeAPI token not configured')
  }

  try {
    const response = await fetch(getAwesomeApiUrl(), {
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    const latencyMs = Date.now() - startTime

    if (!response.ok) {
      logger.error('AwesomeAPI error', {
        event: 'awesomeapi_error',
        status: response.status,
        latencyMs,
      })
      return err(`AwesomeAPI error: ${response.status}`)
    }

    const data = await response.json()
    const parsed = AwesomeAPIResponseSchema.safeParse(data)

    if (!parsed.success) {
      logger.error('AwesomeAPI response validation failed', {
        event: 'awesomeapi_validation_error',
        error: parsed.error.message,
        latencyMs,
      })
      return err('Invalid AwesomeAPI response format')
    }

    const bid = parseFloat(parsed.data.USDBRL.bid)
    const ask = parseFloat(parsed.data.USDBRL.ask)

    if (isNaN(bid) || isNaN(ask)) {
      logger.error('AwesomeAPI price parsing failed', {
        event: 'awesomeapi_parse_error',
        rawBid: parsed.data.USDBRL.bid,
        rawAsk: parsed.data.USDBRL.ask,
        latencyMs,
      })
      return err('Invalid price format from AwesomeAPI')
    }

    const quote: CommercialDollarQuote = {
      bid,
      ask,
      spread: ask - bid,
      timestamp: parsed.data.USDBRL.create_date,
    }

    logger.info('AwesomeAPI commercial dollar fetched', {
      event: 'awesomeapi_price_fetched',
      bid,
      ask,
      spread: quote.spread,
      latencyMs,
    })

    // Reset AwesomeAPI failure counter on success
    recordSuccess('awesomeapi')

    return ok(quote)
  } catch (error) {
    clearTimeout(timeoutId)
    const latencyMs = Date.now() - startTime

    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn('AwesomeAPI timeout', {
        event: 'awesomeapi_timeout',
        latencyMs,
        timeoutMs: AWESOMEAPI_TIMEOUT_MS,
      })
      return err('AwesomeAPI timeout')
    }

    logger.error('AwesomeAPI fetch failed', {
      event: 'awesomeapi_fetch_error',
      error: error instanceof Error ? error.message : String(error),
      latencyMs,
    })
    return err(error instanceof Error ? error.message : 'Unknown error')
  }
}
