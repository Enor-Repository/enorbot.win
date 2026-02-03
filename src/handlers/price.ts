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
import { logPriceQuote, recordLastRow, type LogEntry } from '../services/excel.js'
import { extractVolumeBrl } from '../utils/triggers.js'
import { isExcelLoggingConfigured } from '../types/config.js'
import { getConfig } from '../config.js'
// H2 fix: Integrate Sprint 1 group spread service
import { getSpreadConfig, calculateQuote, type SpreadConfig } from '../services/groupSpreadService.js'
// Sprint 2: Time-based rule override
import { getActiveRule } from '../services/ruleService.js'
// Story 7.4: Bot message logging to Supabase
import { logBotMessage } from '../services/messageHistory.js'
// Sprint 5: Record bot response for suppression cooldown
import { recordBotResponse } from '../services/responseSuppression.js'
// Story 8.7: Observation logging for bot responses
import { logObservation, createObservationEntry } from '../services/excelObservation.js'
import { addToThread } from '../services/conversationTracker.js'
import { queueObservationEntry } from '../services/logQueue.js'
import { isObservationLoggingConfigured } from '../types/config.js'
import type { OTCMessageType } from '../services/messageClassifier.js'

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
 * Story 8.7:
 * - Logs bot responses to observations with response time tracking
 *
 * @param context - Router context with message metadata and socket
 * @returns Result with price data on success, error message on failure
 */
export async function handlePriceMessage(
  context: RouterContext
): Promise<Result<PriceHandlerResult>> {
  // Story 8.7: Capture start time for response time tracking
  const responseStartTime = Date.now()

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
  } else {
    // Story 7.4 AC2: Log stall message to history
    logBotMessage({
      groupJid: context.groupId,
      content: INSTANT_ACK_MESSAGE,
      messageType: 'stall',
      isControlGroup: false,
    })
  }

  // Step 1: First attempt to fetch price from Binance
  const firstResult = await fetchPrice()

  // Happy path - first attempt succeeds
  if (firstResult.ok) {
    // Story 3.3: Record successful operation to reset transient error counter
    recordSuccessfulOperation('binance')
    return await sendPriceResponse(context, firstResult.data, undefined, responseStartTime)
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
      }, responseStartTime)
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
 * Story 8.7: Also logs bot response to observations with response time.
 * Sprint 1 (H2 fix): Applies group-specific spread before formatting.
 *
 * @param context - Router context
 * @param price - Raw price from Binance
 * @param recoveryMeta - Optional recovery metadata (for retry success)
 * @param responseStartTime - Start time for response time calculation
 */
async function sendPriceResponse(
  context: RouterContext,
  price: number,
  recoveryMeta?: { recovered: true; retryCount: number },
  responseStartTime?: number
): Promise<Result<PriceHandlerResult>> {
  // H2 fix: Apply group-specific spread configuration
  // Sprint 2: Active time-based rule overrides default spread
  let finalPrice = price
  let spreadConfig: SpreadConfig | null = null
  let activeRuleName: string | null = null

  try {
    const configResult = await getSpreadConfig(context.groupId)
    if (configResult.ok) {
      spreadConfig = configResult.data
    }
  } catch (error) {
    logger.warn('Failed to get spread config, using raw Binance rate', {
      event: 'spread_config_fallback',
      groupId: context.groupId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Sprint 2: Check for active time-based rule override
  // Note: getActiveRule uses in-memory cache (1-min TTL) so this is fast for repeated calls
  try {
    const activeRuleResult = await getActiveRule(context.groupId)
    if (activeRuleResult.ok && activeRuleResult.data) {
      const rule = activeRuleResult.data
      activeRuleName = rule.name

      // Build effective config: start from default spread config (for side, currency, language, TTL),
      // then override spread/pricing fields from the active rule
      const now = new Date()
      const baseConfig = spreadConfig ?? {
        groupJid: context.groupId,
        spreadMode: 'bps' as const,
        sellSpread: 0,
        buySpread: 0,
        quoteTtlSeconds: 180,
        defaultSide: 'client_buys_usdt' as const,
        defaultCurrency: 'BRL' as const,
        language: 'pt-BR' as const,
        createdAt: now,
        updatedAt: now,
      }

      spreadConfig = {
        ...baseConfig,
        spreadMode: rule.spreadMode,
        sellSpread: rule.sellSpread,
        buySpread: rule.buySpread,
      }

      logger.info('Active time rule overriding spread config', {
        event: 'time_rule_override',
        groupId: context.groupId,
        ruleName: rule.name,
        ruleId: rule.id,
        pricingSource: rule.pricingSource,
        spreadMode: rule.spreadMode,
        sellSpread: rule.sellSpread,
        buySpread: rule.buySpread,
        priority: rule.priority,
      })
    }
  } catch (error) {
    // Non-fatal: if rule lookup fails, continue with default spread config
    logger.warn('Failed to check active rule, using default spread', {
      event: 'time_rule_lookup_fallback',
      groupId: context.groupId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Apply spread (from default config or rule override)
  if (spreadConfig) {
    finalPrice = calculateQuote(price, spreadConfig, spreadConfig.defaultSide)

    logger.debug('Applied spread to price', {
      event: 'price_spread_applied',
      groupId: context.groupId,
      binanceRate: price,
      finalRate: finalPrice,
      spreadMode: spreadConfig.spreadMode,
      defaultSide: spreadConfig.defaultSide,
      spreadApplied: spreadConfig.defaultSide === 'client_buys_usdt'
        ? spreadConfig.sellSpread
        : spreadConfig.buySpread,
      activeRule: activeRuleName,
    })
  }

  const formattedPrice = formatBrazilianPrice(finalPrice)

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

  // Story 7.4 AC1: Log price response to history
  // H2 fix: Include spread info in metadata
  logBotMessage({
    groupJid: context.groupId,
    content: formattedPrice,
    messageType: 'price_response',
    isControlGroup: false,
    metadata: {
      binanceRate: price,
      finalRate: finalPrice,
      spreadApplied: spreadConfig ? (spreadConfig.defaultSide === 'client_buys_usdt'
        ? spreadConfig.sellSpread
        : spreadConfig.buySpread) : 0,
      spreadMode: spreadConfig?.spreadMode || 'none',
      recovered: !!recoveryMeta,
      ...(activeRuleName && { activeRuleName }),
    },
  })

  // Sprint 5: Record bot response for suppression cooldown tracking
  recordBotResponse(context.groupId)

  // Story 8.7: Log bot response to observations (fire-and-forget)
  logBotResponseObservation({
    context,
    responseContent: formattedPrice,
    responseStartTime,
    messageType: 'price_response',
    aiUsed: false, // Price responses don't use AI
  })

  if (recoveryMeta) {
    // Story 4.3: Record activity for status command
    recordMessageSent(context.groupId)

    // Story 5.2: Log to Excel (fire-and-forget)
    // H2 fix: Log the final price with spread applied
    logToExcel(context, finalPrice)

    // Recovery success logging (AC3)
    // H2 fix: Include spread info in logs
    logger.info('Recovered after retry', {
      event: 'price_recovered_after_retry',
      binanceRate: price,
      finalRate: finalPrice,
      spreadApplied: spreadConfig ? (spreadConfig.defaultSide === 'client_buys_usdt'
        ? spreadConfig.sellSpread
        : spreadConfig.buySpread) : 0,
      spreadMode: spreadConfig?.spreadMode || 'none',
      formattedPrice,
      retryCount: recoveryMeta.retryCount,
      groupId: context.groupId,
      timestamp,
    })

    return ok({
      price: finalPrice, // Return the final price with spread
      groupId: context.groupId,
      timestamp,
      recovered: true,
      retryCount: recoveryMeta.retryCount,
      ...(activeRuleName && { activeRuleName }),
    })
  }

  // Story 4.3: Record activity for status command
  recordMessageSent(context.groupId)

  // Story 5.2: Log to Excel (fire-and-forget)
  // H2 fix: Log the final price with spread applied
  logToExcel(context, finalPrice)

  // Normal success logging (Story 2.3)
  // H2 fix: Include spread info in logs
  logger.info('Price response sent', {
    event: 'price_response_sent',
    binanceRate: price,
    finalRate: finalPrice,
    spreadApplied: spreadConfig ? (spreadConfig.defaultSide === 'client_buys_usdt'
      ? spreadConfig.sellSpread
      : spreadConfig.buySpread) : 0,
    spreadMode: spreadConfig?.spreadMode || 'none',
    formattedPrice,
    groupId: context.groupId,
    timestamp,
  })

  return ok({
    price: finalPrice, // Return the final price with spread
    groupId: context.groupId,
    timestamp,
    ...(activeRuleName && { activeRuleName }),
  })
}

/**
 * Get client identifier from context.
 * Prefers display name (pushName), falls back to phone number.
 *
 * @param context - Router context
 * @returns Client identifier string
 */
function getClientIdentifier(context: RouterContext): string {
  // Prefer senderName (WhatsApp display name) if available
  if (context.senderName && context.senderName.trim()) {
    return context.senderName.trim()
  }
  // Fallback to sender JID, extracting phone number
  // Format: 5511999999999@s.whatsapp.net → 5511999999999
  return context.sender.replace(/@.*$/, '')
}

/**
 * Log price quote to Excel Online (fire-and-forget).
 * Story 5.2 Task 5: Integration with price handler.
 *
 * New schema: Timestamp, Group_name, Client_identifier, Volume_brl, Quote, Acquired_usdt, Onchain_tx
 *
 * @param context - Router context with message metadata
 * @param price - Raw price from Binance (Quote)
 */
function logToExcel(context: RouterContext, price: number): void {
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

  // Extract volume from trigger message
  const volumeBrl = extractVolumeBrl(context.message)

  // Calculate acquired USDT if volume is available
  const acquiredUsdt = volumeBrl !== null ? volumeBrl / price : null

  const entry: LogEntry = {
    timestamp: new Date(),
    groupName: context.groupName,
    groupId: context.groupId,
    clientIdentifier: getClientIdentifier(context),
    volumeBrl,
    quote: price,
    acquiredUsdt,
    onchainTx: null, // Filled later when tronscan link is posted
  }

  // Fire-and-forget - don't await, don't block price response
  logPriceQuote(entry)
    .then((result) => {
      if (result.ok) {
        // Record row number for potential onchain_tx update later
        recordLastRow(context.groupId, result.data.rowNumber)
      }
    })
    .catch((error) => {
      logger.warn('Excel logging failed, will retry', {
        event: 'excel_log_fire_forget_error',
        error: error instanceof Error ? error.message : String(error),
        groupName: context.groupName,
      })
    })
}

/**
 * Story 8.7: Log bot response to observations (fire-and-forget).
 * Links to the same conversation thread as the triggering message.
 *
 * AC1: Bot responses logged with response time
 * AC2: Response content preview captured (100 chars)
 * AC3: Linked to same thread as triggering message
 * AC4: ai_used accurately reflects OpenRouter usage
 * AC5: Fire-and-forget pattern maintained
 */
function logBotResponseObservation(params: {
  context: RouterContext
  responseContent: string
  responseStartTime?: number
  messageType: OTCMessageType
  aiUsed: boolean
}): void {
  // Skip if observation logging is not configured
  try {
    const config = getConfig()
    if (!isObservationLoggingConfigured(config)) {
      return
    }
  } catch {
    return
  }

  const { context, responseContent, responseStartTime, messageType, aiUsed } = params

  // Calculate response time (AC1)
  const responseTimeMs = responseStartTime ? Date.now() - responseStartTime : null

  // Link to existing conversation thread (AC3)
  // Issue fix: Use actual bot JID from config for accurate participant tracking
  let botJid = 'bot@s.whatsapp.net'
  try {
    const config = getConfig()
    botJid = `${config.PHONE_NUMBER}@s.whatsapp.net`
  } catch {
    // Config not available, use fallback
  }
  const threadId = addToThread(context.groupId, botJid)

  // Create observation entry
  const observation = createObservationEntry({
    groupId: context.groupId,
    groupName: context.groupName,
    playerJid: botJid,
    playerName: 'Bot',
    playerRole: 'operator', // Bot acts as operator
    messageType,
    triggerPattern: null, // Bot responses don't have triggers
    conversationThread: threadId,
    volumeBrl: null, // Bot responses don't include volume
    volumeUsdt: null,
    content: responseContent, // Will be truncated to 100 chars (AC2)
    responseRequired: false, // Bot message, no response needed from others
    responseGiven: responseContent, // This IS the response
    responseTimeMs,
    aiUsed, // AC4
  })

  // Fire-and-forget: don't await, don't block (AC5)
  logObservation(observation)
    .then(result => {
      if (!result.ok) {
        queueObservationEntry(observation)
      }
    })
    .catch(() => {
      queueObservationEntry(observation)
    })

  logger.debug('Bot response observation logged', {
    event: 'bot_response_observation_logged',
    groupId: context.groupId,
    messageType,
    responseTimeMs,
    aiUsed,
  })
}
