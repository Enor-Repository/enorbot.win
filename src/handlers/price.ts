/**
 * Price Handler - Story 2.3 + 2.4, extended by Story 3.3
 *
 * Handles price trigger messages by:
 * 1. Fetching current USDT/BRL price from Binance
 * 2. Formatting in Brazilian Real style (R$X,XX)
 * 3. Sending response with anti-detection behavior
 * 4. Graceful degradation with stall message and retry (Story 2.4)
 *
 * Story 3.3 extension:
 * - Integrates transient error tracking with sliding window
 * - Records successful operations to reset error counters
 * - Triggers auto-pause with recovery scheduling on transient escalation
 */

import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'
import type { RouterContext } from '../bot/router.js'
import { fetchPrice } from '../services/binance.js'
import { sendWithAntiDetection } from '../utils/messaging.js'
import { formatBrazilianPrice } from '../utils/format.js'
import type { PriceHandlerResult } from '../types/handlers.js'
import {
  classifyBinanceError,
  recordFailure,
  logClassifiedError,
  logErrorEscalation,
  getFailureCount,
  ESCALATION_THRESHOLD,
} from '../services/errors.js'
import { recordMessageSent } from '../bot/state.js'
import { triggerAutoPause } from '../services/autoPause.js'
import { recordTransientError, recordSuccessfulOperation } from '../services/transientErrors.js'
import { logPriceQuote, type LogEntry } from '../services/excel.js'
import { isExcelLoggingConfigured } from '../types/config.js'
import { getConfig } from '../config.js'

// Story 2.4: Retry Constants (Task 1)
/** Maximum number of retry attempts after initial failure */
export const MAX_PRICE_RETRIES = 2
/** Delay between retry attempts in milliseconds */
export const RETRY_DELAY_MS = 2000
/** Instant acknowledgement sent immediately on trigger */
export const INSTANT_ACK_MESSAGE = 'Puxando o valor pra você, um momento...'
/** Backwards-compatible alias for tests/logs */
export const STALL_MESSAGE = INSTANT_ACK_MESSAGE

/**
 * Sleep utility for retry spacing (Task 2).
 * @param ms - Milliseconds to sleep (must be >= 0)
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

/**
 * Handle price trigger messages.
 * Fetches price from Binance, formats it, and sends response.
 * On failure, sends stall message and retries with graceful degradation.
 *
 * Story 2.3:
 * - AC3: Full handler flow (fetch → format → send)
 * - AC4: Returns {ok: true, data: {price, groupId, timestamp}}
 * - AC5: Returns {ok: false, error} without sending on error
 *
 * Story 2.4:
 * - AC1: Sends stall message on first failure
 * - AC2: Retries with 2s spacing
 * - AC3: Returns {recovered: true, retryCount} on recovery
 * - AC4: Never sends wrong data - returns error after exhausted retries
 *
 * @param context - Router context with message metadata and socket
 * @returns Result with price data on success, error message on failure
 */
export async function handlePriceMessage(
  context: RouterContext
): Promise<Result<PriceHandlerResult>> {
  // Log trigger detection
  logger.info('Price trigger detected', {
    event: 'price_trigger_detected',
    groupId: context.groupId,
    groupName: context.groupName,
    sender: context.sender,
    hasTrigger: context.hasTrigger,
    messageLength: context.message.length,
  })

  // Instant acknowledgement to keep the bot feeling responsive
  const ackResult = await sendWithAntiDetection(
    context.sock,
    context.groupId,
    INSTANT_ACK_MESSAGE
  )

  if (!ackResult.ok) {
    logger.warn('Failed to send instant ack message', {
      event: 'price_ack_send_failed',
      error: ackResult.error,
      groupId: context.groupId,
    })
  }

  // Step 1: First attempt to fetch price from Binance
  const firstResult = await fetchPrice()

  // Happy path - first attempt succeeds
  if (firstResult.ok) {
    // Story 3.3: Record successful operation to reset transient error counter
    recordSuccessfulOperation('binance')
    return await sendPriceResponse(context, firstResult.data)
  }

  // Story 3.1: Track first failure (AC2 - consecutive failure escalation)
  recordFailure('binance')

  // Story 3.3: Track transient error in sliding window
  const firstErrorClassification = classifyBinanceError(firstResult.error)
  if (firstErrorClassification === 'transient') {
    const { shouldEscalate, count } = recordTransientError('binance')
    if (shouldEscalate) {
      // Escalate transient to critical due to frequency
      logErrorEscalation('binance', count)
      triggerAutoPause(
        `Binance API failures (${count} in 60s)`,
        { source: 'binance', isTransientEscalation: true, lastError: firstResult.error }
      )
      // Continue with retry anyway, but auto-pause + recovery scheduled
    }
  }

  // Step 2: Retry loop (AC2, AC3, AC4)
  for (let attempt = 1; attempt <= MAX_PRICE_RETRIES; attempt++) {
    await sleep(RETRY_DELAY_MS)

    logger.warn('Price retry attempt', {
      event: 'price_retry_attempt',
      attempt,
      maxRetries: MAX_PRICE_RETRIES,
      groupId: context.groupId,
    })

    const retryResult = await fetchPrice()

    if (retryResult.ok) {
      // Story 3.3: Record successful operation to reset transient error counter
      recordSuccessfulOperation('binance')
      // Recovery success! Send price as follow-up
      return await sendPriceResponse(context, retryResult.data, {
        recovered: true,
        retryCount: attempt,
      })
    }

    // Log retry failure and track for escalation (Story 3.1 AC2)
    recordFailure('binance')

    // Story 3.3: Track transient error in sliding window for retry failures
    const retryErrorClassification = classifyBinanceError(retryResult.error)
    if (retryErrorClassification === 'transient') {
      const { shouldEscalate, count } = recordTransientError('binance')
      if (shouldEscalate) {
        logErrorEscalation('binance', count)
        triggerAutoPause(
          `Binance API failures (${count} in 60s)`,
          { source: 'binance', isTransientEscalation: true, lastError: retryResult.error }
        )
      }
    }

    logger.warn('Retry failed', {
      event: 'price_retry_failed',
      attempt,
      error: retryResult.error,
      groupId: context.groupId,
      failureCount: getFailureCount('binance'),
    })
  }

  // Step 4: All retries exhausted - NO price message sent (AC4)
  const totalAttempts = 1 + MAX_PRICE_RETRIES

  // Story 3.1: Check if escalation threshold reached (failures already tracked above)
  const failureCount = getFailureCount('binance')
  const shouldEscalate = failureCount >= ESCALATION_THRESHOLD
  const classification = shouldEscalate ? 'critical' : classifyBinanceError('Price unavailable after retries')

  if (shouldEscalate) {
    logErrorEscalation('binance', getFailureCount('binance'))
    // Story 3.2: Trigger auto-pause on critical escalation
    triggerAutoPause(
      `Binance API failures (${failureCount} consecutive)`,
      { source: 'binance', lastError: 'Price unavailable after retries', groupId: context.groupId }
    )
  }

  logClassifiedError({
    type: 'price_fetch_exhausted',
    classification,
    source: 'binance',
    timestamp: new Date().toISOString(),
    context: { totalAttempts, groupId: context.groupId },
  })

  logger.error('Price unavailable after retries', {
    event: 'price_unavailable_after_retries',
    totalAttempts,
    groupId: context.groupId,
    classification,
    escalated: shouldEscalate,
  })

  return err('Price unavailable after retries')
}

/**
 * Helper to send formatted price response and return result.
 * Shared between happy path and recovery path.
 *
 * @param context - Router context
 * @param price - Raw price from Binance
 * @param recoveryMeta - Optional recovery metadata (for retry success)
 */
async function sendPriceResponse(
  context: RouterContext,
  price: number,
  recoveryMeta?: { recovered: true; retryCount: number }
): Promise<Result<PriceHandlerResult>> {
  const formattedPrice = formatBrazilianPrice(price)

  const sendResult = await sendWithAntiDetection(
    context.sock,
    context.groupId,
    formattedPrice
  )

  if (!sendResult.ok) {
    const event = recoveryMeta
      ? 'price_recovered_send_failed'
      : 'price_send_failed'

    logger.error('Failed to send price response', {
      event,
      error: sendResult.error,
      groupId: context.groupId,
      price,
      formattedPrice,
      ...(recoveryMeta && { retryCount: recoveryMeta.retryCount }),
    })
    return err(sendResult.error)
  }

  const timestamp = new Date().toISOString()

  if (recoveryMeta) {
    // Story 4.3: Record activity for status command
    recordMessageSent(context.groupId)

    // Story 5.2: Log to Excel (fire-and-forget)
    logToExcel(context, price, formattedPrice)

    // Recovery success logging (AC3)
    logger.info('Recovered after retry', {
      event: 'price_recovered_after_retry',
      price,
      formattedPrice,
      retryCount: recoveryMeta.retryCount,
      groupId: context.groupId,
      timestamp,
    })

    return ok({
      price,
      groupId: context.groupId,
      timestamp,
      recovered: true,
      retryCount: recoveryMeta.retryCount,
    })
  }

  // Story 4.3: Record activity for status command
  recordMessageSent(context.groupId)

  // Story 5.2: Log to Excel (fire-and-forget)
  logToExcel(context, price, formattedPrice)

  // Normal success logging (Story 2.3)
  logger.info('Price response sent', {
    event: 'price_response_sent',
    price,
    formattedPrice,
    groupId: context.groupId,
    timestamp,
  })

  return ok({
    price,
    groupId: context.groupId,
    timestamp,
  })
}

/**
 * Log price quote to Excel Online (fire-and-forget).
 * Story 5.2 Task 5: Integration with price handler.
 *
 * @param context - Router context with message metadata
 * @param price - Raw price from Binance
 * @param formattedPrice - Formatted price string
 */
function logToExcel(context: RouterContext, price: number, formattedPrice: string): void {
  // Skip if Excel logging is not configured
  try {
    const config = getConfig()
    if (!isExcelLoggingConfigured(config)) {
      return
    }
  } catch {
    // Config not available, skip logging
    return
  }

  const entry: LogEntry = {
    timestamp: new Date(),
    groupName: context.groupName,
    groupId: context.groupId,
    clientIdentifier: context.sender,
    quoteValue: price,
    quoteFormatted: formattedPrice,
  }

  // Fire-and-forget - don't await, don't block price response
  logPriceQuote(entry).catch((error) => {
    logger.warn('Excel logging failed, will retry', {
      event: 'excel_log_fire_forget_error',
      error: error instanceof Error ? error.message : String(error),
      groupName: context.groupName,
    })
  })
}
