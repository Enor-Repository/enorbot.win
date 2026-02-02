/**
 * Commercial Dollar Handler
 *
 * Handles commercial dollar quote requests by:
 * 1. Fetching current USD/BRL exchange rate from AwesomeAPI
 * 2. Formatting in Brazilian Real style (R$X,XXXX)
 * 3. Sending response with anti-detection behavior
 * 4. Graceful degradation with stall message and retry
 */

import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'
import type { RouterContext } from '../bot/router.js'
import { fetchCommercialDollar, type CommercialDollarQuote } from '../services/awesomeapi.js'
import { sendWithAntiDetection } from '../utils/messaging.js'
import { formatCommercialDollar } from '../utils/format.js'
import { recordMessageSent } from '../bot/state.js'
import { logBotMessage } from '../services/messageHistory.js'

/** Maximum number of retry attempts after initial failure */
export const MAX_DOLLAR_RETRIES = 2
/** Delay between retry attempts in milliseconds */
export const RETRY_DELAY_MS = 2000
/** Instant acknowledgement sent immediately on trigger */
export const INSTANT_ACK_MESSAGE = 'Puxando a cotação do dólar comercial...'

/**
 * Sleep utility for retry spacing.
 * @param ms - Milliseconds to sleep (must be >= 0)
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

/**
 * Handler result with quote data.
 */
export interface CommercialDollarHandlerResult {
  bid: number
  ask: number
  spread: number
  groupId: string
  timestamp: string
  recovered?: boolean
  retryCount?: number
}

/**
 * Handle commercial dollar quote requests.
 * Fetches exchange rate from AwesomeAPI, formats it, and sends response.
 *
 * @param context - Router context with message metadata and socket
 * @returns Result with quote data on success, error message on failure
 */
export async function handleCommercialDollarMessage(
  context: RouterContext
): Promise<Result<CommercialDollarHandlerResult>> {
  // Log trigger detection
  logger.info('Commercial dollar trigger detected', {
    event: 'commercial_dollar_trigger_detected',
    groupId: context.groupId,
    groupName: context.groupName,
    sender: context.sender,
  })

  // Instant acknowledgement to keep the bot feeling responsive
  const ackResult = await sendWithAntiDetection(
    context.sock,
    context.groupId,
    INSTANT_ACK_MESSAGE
  )

  if (!ackResult.ok) {
    logger.warn('Failed to send instant ack message', {
      event: 'commercial_dollar_ack_send_failed',
      error: ackResult.error,
      groupId: context.groupId,
    })
  } else {
    logBotMessage({
      groupJid: context.groupId,
      content: INSTANT_ACK_MESSAGE,
      messageType: 'stall',
      isControlGroup: false,
    })
  }

  // Step 1: First attempt to fetch quote from AwesomeAPI
  const firstResult = await fetchCommercialDollar()

  // Happy path - first attempt succeeds
  if (firstResult.ok) {
    return await sendDollarResponse(context, firstResult.data)
  }

  // Step 2: Retry loop
  for (let attempt = 1; attempt <= MAX_DOLLAR_RETRIES; attempt++) {
    await sleep(RETRY_DELAY_MS)

    logger.warn('Commercial dollar retry attempt', {
      event: 'commercial_dollar_retry_attempt',
      attempt,
      maxRetries: MAX_DOLLAR_RETRIES,
      groupId: context.groupId,
    })

    const retryResult = await fetchCommercialDollar()

    if (retryResult.ok) {
      // Recovery success! Send quote as follow-up
      return await sendDollarResponse(context, retryResult.data, {
        recovered: true,
        retryCount: attempt,
      })
    }

    logger.warn('Retry failed', {
      event: 'commercial_dollar_retry_failed',
      attempt,
      error: retryResult.error,
      groupId: context.groupId,
    })
  }

  // Step 3: All retries exhausted
  const totalAttempts = 1 + MAX_DOLLAR_RETRIES

  logger.error('Commercial dollar unavailable after retries', {
    event: 'commercial_dollar_unavailable_after_retries',
    totalAttempts,
    groupId: context.groupId,
  })

  return err('Commercial dollar unavailable after retries')
}

/**
 * Helper to send formatted commercial dollar response and return result.
 */
async function sendDollarResponse(
  context: RouterContext,
  quote: CommercialDollarQuote,
  recoveryMeta?: { recovered: true; retryCount: number }
): Promise<Result<CommercialDollarHandlerResult>> {
  const formattedQuote = formatCommercialDollar(quote.bid, quote.ask)

  const sendResult = await sendWithAntiDetection(
    context.sock,
    context.groupId,
    formattedQuote
  )

  if (!sendResult.ok) {
    const event = recoveryMeta
      ? 'commercial_dollar_recovered_send_failed'
      : 'commercial_dollar_send_failed'

    logger.error('Failed to send commercial dollar response', {
      event,
      error: sendResult.error,
      groupId: context.groupId,
      bid: quote.bid,
      ask: quote.ask,
      ...(recoveryMeta && { retryCount: recoveryMeta.retryCount }),
    })
    return err(sendResult.error)
  }

  const timestamp = new Date().toISOString()

  // Log bot message
  logBotMessage({
    groupJid: context.groupId,
    content: formattedQuote,
    messageType: 'price_response',
    isControlGroup: false,
    metadata: { bid: quote.bid, ask: quote.ask, recovered: !!recoveryMeta },
  })

  // Record activity for status command
  recordMessageSent(context.groupId)

  if (recoveryMeta) {
    logger.info('Recovered after retry', {
      event: 'commercial_dollar_recovered_after_retry',
      bid: quote.bid,
      ask: quote.ask,
      spread: quote.spread,
      retryCount: recoveryMeta.retryCount,
      groupId: context.groupId,
      timestamp,
    })

    return ok({
      bid: quote.bid,
      ask: quote.ask,
      spread: quote.spread,
      groupId: context.groupId,
      timestamp,
      recovered: true,
      retryCount: recoveryMeta.retryCount,
    })
  }

  logger.info('Commercial dollar response sent', {
    event: 'commercial_dollar_response_sent',
    bid: quote.bid,
    ask: quote.ask,
    spread: quote.spread,
    groupId: context.groupId,
    timestamp,
  })

  return ok({
    bid: quote.bid,
    ask: quote.ask,
    spread: quote.spread,
    groupId: context.groupId,
    timestamp,
  })
}
