/**
 * Price Handler - Story 2.3 + 2.4, extended by Story 3.3
 *
 * Handles price trigger messages by:
 * 1. Fetching current USDT/BRL price from Binance or Commercial Dollar (BCB)
 * 2. Applying spread configuration from active time-based rules
 * 3. Formatting in Brazilian style (X,XXXX - number only, no currency symbol)
 * 4. Sending response with anti-detection behavior
 * 5. Retry logic on fetch failure (Story 2.4)
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
import { fetchCommercialDollar } from '../services/awesomeapi.js'
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
import { getActiveRule, type GroupRule } from '../services/ruleService.js'
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
// Volatility Protection: Track active quotes for threshold monitoring
import { createQuote, MIN_VOLUME_USDT } from '../services/activeQuotes.js'
import { parseBrazilianNumber } from '../services/dealComputation.js'

// Story 2.4: Retry Constants (Task 1)
/** Maximum number of retry attempts after initial failure */
export const MAX_PRICE_RETRIES = 2
/** Delay between retry attempts in milliseconds */
export const RETRY_DELAY_MS = 2000

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

  // Step 0: Resolve active rule (pricing source + spread) — single lookup
  const { pricingSource, activeRule } = await resolveActiveRulePricing(context.groupId)

  // Step 1: First attempt to fetch price
  const firstResult = await fetchBasePrice(pricingSource, context.groupId)

  // Happy path - first attempt succeeds
  if (firstResult.ok) {
    // Story 3.3: Record successful operation to reset transient error counter
    recordSuccessfulOperation(pricingSource === 'commercial_dollar' ? 'awesomeapi' : 'binance')
    return await sendPriceResponse(context, firstResult.data, pricingSource, activeRule, undefined, responseStartTime)
  }

  // Story 3.1: Track first failure (AC2 - consecutive failure escalation)
  const errorSource = pricingSource === 'commercial_dollar' ? 'awesomeapi' : 'binance'
  recordFailure(errorSource)

  // Story 3.3: Track transient error in sliding window
  const firstErrorClassification = classifyBinanceError(firstResult.error)
  if (firstErrorClassification === 'transient') {
    const { shouldEscalate, count } = recordTransientError(errorSource)
    if (shouldEscalate) {
      // Escalate transient to critical due to frequency
      logErrorEscalation(errorSource, count)
      triggerAutoPause(
        `${errorSource} API failures (${count} in 60s)`,
        { source: errorSource, isTransientEscalation: true, lastError: firstResult.error }
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
      pricingSource,
    })

    const retryResult = await fetchBasePrice(pricingSource, context.groupId)

    if (retryResult.ok) {
      // Story 3.3: Record successful operation to reset transient error counter
      recordSuccessfulOperation(errorSource)
      // Recovery success! Send price as follow-up
      return await sendPriceResponse(context, retryResult.data, pricingSource, activeRule, {
        recovered: true,
        retryCount: attempt,
      }, responseStartTime)
    }

    // Log retry failure and track for escalation (Story 3.1 AC2)
    recordFailure(errorSource)

    // Story 3.3: Track transient error in sliding window for retry failures
    const retryErrorClassification = classifyBinanceError(retryResult.error)
    if (retryErrorClassification === 'transient') {
      const { shouldEscalate, count } = recordTransientError(errorSource)
      if (shouldEscalate) {
        logErrorEscalation(errorSource, count)
        triggerAutoPause(
          `${errorSource} API failures (${count} in 60s)`,
          { source: errorSource, isTransientEscalation: true, lastError: retryResult.error }
        )
      }
    }

    logger.warn('Retry failed', {
      event: 'price_retry_failed',
      attempt,
      error: retryResult.error,
      groupId: context.groupId,
      failureCount: getFailureCount(errorSource),
      pricingSource,
    })
  }

  // Step 4: All retries exhausted - NO price message sent (AC4)
  const totalAttempts = 1 + MAX_PRICE_RETRIES

  // Story 3.1: Check if escalation threshold reached (failures already tracked above)
  const failureCount = getFailureCount(errorSource)
  const shouldEscalate = failureCount >= ESCALATION_THRESHOLD
  const classification = shouldEscalate ? 'critical' : classifyBinanceError('Price unavailable after retries')

  if (shouldEscalate) {
    logErrorEscalation(errorSource, getFailureCount(errorSource))
    // Story 3.2: Trigger auto-pause on critical escalation
    triggerAutoPause(
      `${errorSource} API failures (${failureCount} consecutive)`,
      { source: errorSource, lastError: 'Price unavailable after retries', groupId: context.groupId }
    )
  }

  logClassifiedError({
    type: 'price_fetch_exhausted',
    classification,
    source: errorSource,
    timestamp: new Date().toISOString(),
    context: { totalAttempts, groupId: context.groupId, pricingSource },
  })

  logger.error('Price unavailable after retries', {
    event: 'price_unavailable_after_retries',
    totalAttempts,
    groupId: context.groupId,
    classification,
    escalated: shouldEscalate,
    pricingSource,
  })

  return err('Price unavailable after retries')
}

/** Result of resolving the active rule for pricing */
interface ResolvedPricing {
  pricingSource: string
  activeRule: GroupRule | null
}

/**
 * Resolve the active rule to get pricing source and spread config.
 * Called once per request — result is passed to both fetchBasePrice and sendPriceResponse.
 */
async function resolveActiveRulePricing(groupJid: string): Promise<ResolvedPricing> {
  try {
    const activeRuleResult = await getActiveRule(groupJid)
    if (activeRuleResult.ok && activeRuleResult.data) {
      const rule = activeRuleResult.data
      return {
        pricingSource: rule.pricingSource || 'usdt_binance',
        activeRule: rule,
      }
    }
  } catch (error) {
    logger.warn('Failed to resolve active rule, defaulting to Binance', {
      event: 'pricing_source_fallback',
      groupJid,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return { pricingSource: 'usdt_binance', activeRule: null }
}

/**
 * Fetch base price from the configured source.
 * Commercial dollar uses TradingView scraper rate only.
 */
async function fetchBasePrice(
  pricingSource: string,
  groupJid: string
): Promise<Result<number>> {
  if (pricingSource === 'commercial_dollar') {
    const commercialResult = await fetchCommercialDollar()
    if (commercialResult.ok) {
      logger.debug('Commercial dollar rate fetched', {
        event: 'commercial_dollar_fetched',
        groupJid,
        rate: commercialResult.data.ask,
      })
      return ok(commercialResult.data.ask)
    }
    logger.warn('Commercial dollar unavailable from TradingView scraper', {
      event: 'commercial_dollar_unavailable',
      groupJid,
      error: commercialResult.error,
    })
    return err(commercialResult.error)
  }

  const binanceResult = await fetchPrice()
  if (!binanceResult.ok) {
    return err(binanceResult.error)
  }
  return ok(binanceResult.data)
}

/**
 * Helper to send formatted price response and return result.
 * Shared between happy path and recovery path.
 *
 * Story 8.7: Also logs bot response to observations with response time.
 * Sprint 1 (H2 fix): Applies group-specific spread before formatting.
 *
 * @param context - Router context
 * @param price - Raw base price from the configured pricing source
 * @param pricingSource - The pricing source used ('commercial_dollar' or 'usdt_binance')
 * @param activeRule - The resolved active rule (already looked up in handlePriceMessage)
 * @param recoveryMeta - Optional recovery metadata (for retry success)
 * @param responseStartTime - Start time for response time calculation
 */
async function sendPriceResponse(
  context: RouterContext,
  price: number,
  pricingSource: string,
  activeRule: ResolvedPricing['activeRule'],
  recoveryMeta?: { recovered: true; retryCount: number },
  responseStartTime?: number
): Promise<Result<PriceHandlerResult>> {
  // Apply group-specific spread configuration
  // Active time-based rule overrides default spread
  let finalPrice = price
  let spreadConfig: SpreadConfig | null = null
  let activeRuleName: string | null = null

  try {
    const configResult = await getSpreadConfig(context.groupId)
    if (configResult.ok) {
      spreadConfig = configResult.data
    }
  } catch (error) {
    logger.warn('Failed to get spread config, using raw base rate', {
      event: 'spread_config_fallback',
      groupId: context.groupId,
      pricingSource,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Apply active rule's spread override (rule already resolved)
  if (activeRule) {
    activeRuleName = activeRule.name

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
      dealFlowMode: 'classic' as const,
      operatorJid: null,
      amountTimeoutSeconds: 60,
      groupLanguage: 'pt' as const,
      createdAt: now,
      updatedAt: now,
    }

    spreadConfig = {
      ...baseConfig,
      spreadMode: activeRule.spreadMode,
      sellSpread: activeRule.sellSpread,
      buySpread: activeRule.buySpread,
    }

    logger.info('Active time rule overriding spread config', {
      event: 'time_rule_override',
      groupId: context.groupId,
      ruleName: activeRule.name,
      ruleId: activeRule.id,
      pricingSource,
      spreadMode: activeRule.spreadMode,
      sellSpread: activeRule.sellSpread,
      buySpread: activeRule.buySpread,
      priority: activeRule.priority,
    })
  }

  // Apply spread (from default config or rule override)
  if (spreadConfig) {
    finalPrice = calculateQuote(price, spreadConfig, spreadConfig.defaultSide)

    logger.debug('Applied spread to price', {
      event: 'price_spread_applied',
      groupId: context.groupId,
      baseRate: price,
      finalRate: finalPrice,
      pricingSource,
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

  // Log price response to history
  logBotMessage({
    groupJid: context.groupId,
    content: formattedPrice,
    messageType: 'price_response',
    isControlGroup: false,
    metadata: {
      baseRate: price,
      finalRate: finalPrice,
      pricingSource,
      spreadApplied: spreadConfig ? (spreadConfig.defaultSide === 'client_buys_usdt'
        ? spreadConfig.sellSpread
        : spreadConfig.buySpread) : 0,
      spreadMode: spreadConfig?.spreadMode || 'none',
      recovered: !!recoveryMeta,
      ...(activeRuleName && { activeRuleName }),
    },
  })

  // Record bot response for suppression cooldown tracking
  recordBotResponse(context.groupId)

  // Extract pre-stated volume from price request (e.g., "cotação pra 30000")
  // MIN_VOLUME_USDT threshold avoids capturing rate fragments (e.g., "5,25")
  let preStatedVolume: number | undefined
  const priceWords = context.message.trim().split(/\s+/)
  for (const word of priceWords) {
    const parsed = parseBrazilianNumber(word)
    if (parsed !== null && parsed >= MIN_VOLUME_USDT) {
      preStatedVolume = parsed
      break
    }
  }

  if (preStatedVolume) {
    logger.info('Pre-stated volume extracted from price request', {
      event: 'price_pre_stated_volume',
      groupId: context.groupId,
      preStatedVolume,
    })
  }

  // Volatility Protection: Create active quote for threshold monitoring
  // Pass price source and base price so volatility monitor checks the correct API
  createQuote(context.groupId, finalPrice, {
    priceSource: pricingSource === 'commercial_dollar' ? 'commercial_dollar' : 'usdt_brl',
    basePrice: price, // Raw price before spread
    preStatedVolume,
    requesterJid: context.sender,
  })

  // Log bot response to observations (fire-and-forget)
  logBotResponseObservation({
    context,
    responseContent: formattedPrice,
    responseStartTime,
    messageType: 'price_response',
    aiUsed: false,
  })

  if (recoveryMeta) {
    recordMessageSent(context.groupId)
    logToExcel(context, finalPrice)

    logger.info('Recovered after retry', {
      event: 'price_recovered_after_retry',
      baseRate: price,
      finalRate: finalPrice,
      pricingSource,
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
      price: finalPrice,
      groupId: context.groupId,
      timestamp,
      recovered: true,
      retryCount: recoveryMeta.retryCount,
      ...(activeRuleName && { activeRuleName }),
    })
  }

  recordMessageSent(context.groupId)
  logToExcel(context, finalPrice)

  logger.info('Price response sent', {
    event: 'price_response_sent',
    baseRate: price,
    finalRate: finalPrice,
    pricingSource,
    spreadApplied: spreadConfig ? (spreadConfig.defaultSide === 'client_buys_usdt'
      ? spreadConfig.sellSpread
      : spreadConfig.buySpread) : 0,
    spreadMode: spreadConfig?.spreadMode || 'none',
    formattedPrice,
    groupId: context.groupId,
    timestamp,
  })

  return ok({
    price: finalPrice,
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
