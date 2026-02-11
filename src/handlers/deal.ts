/**
 * Deal Handler - Sprint 4, Task 4.4
 *
 * State-aware message handling for deal flow:
 *   quote → lock → compute → confirm
 *
 * Integrates:
 * - dealFlowService (state machine)
 * - dealComputation (Brazilian math)
 * - WhatsApp messaging (anti-detection)
 * - Notification service (expiration alerts)
 *
 * Message handling:
 * - volume_inquiry → creates QUOTED deal if none exists
 * - price_lock → locks deal at quoted rate
 * - confirmation → completes deal computation
 * - Expiration sweep → notifies group of expired deals
 *
 * All functions return Result<T>, never throw.
 */

import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'
import type { RouterContext } from '../bot/router.js'
import { sendWithAntiDetection, formatMention } from '../utils/messaging.js'
import { logBotMessage } from '../services/messageHistory.js'
import { recordMessageSent } from '../bot/state.js'
import {
  findClientDeal,
  createDeal,
  lockDeal,
  startComputation,
  completeDeal,
  cancelDeal,
  rejectDeal,
  startAwaitingAmount,
  sweepExpiredDeals,
  archiveDeal,
  getDealsNeedingReprompt,
  markReprompted,
  expireDeal,
  type ActiveDeal,
  type CreateDealInput,
  type ExpiredDealInfo,
} from '../services/dealFlowService.js'
import { getSocket } from '../bot/connection.js'
import type { BotMessageType } from '../services/messageHistory.js'
import {
  extractBrlAmount,
  extractUsdtAmount,
  parseBrazilianNumber,
  computeBrlToUsdt,
  computeUsdtToBrl,
  formatBrl,
  formatUsdt,
  formatRate,
} from '../services/dealComputation.js'
import { fetchPrice } from '../services/binance.js'
import { getSpreadConfig, calculateQuote, type SpreadConfig } from '../services/groupSpreadService.js'
import { getActiveRule, type GroupRule } from '../services/ruleService.js'
// Sprint 9.1: Active quote bridge + operator resolution + Excel logging
import { getActiveQuote, forceAccept, createQuote, clearPreStatedVolume, MIN_VOLUME_USDT } from '../services/activeQuotes.js'
import { resolveOperatorJid } from '../services/groupConfig.js'
import { logPriceQuote, type LogEntry } from '../services/excel.js'
// Phase 3: AI classification for active quote unrecognized input
import { classifyOTCMessage, type EnhancedClassificationResult } from '../services/classificationEngine.js'

// ============================================================================
// Types
// ============================================================================

/** Result returned by deal handler operations */
export interface DealHandlerResult {
  action: 'deal_quoted' | 'deal_locked' | 'deal_computed' | 'deal_cancelled' | 'deal_rejected' | 'no_action'
  dealId?: string
  groupId: string
  clientJid: string
  message?: string
}

/** Context for sweep notifications */
export interface SweepNotification {
  groupJid: string
  clientJid: string
  dealId: string
  state: string
}

// ============================================================================
// Message Templates (pt-BR)
// ============================================================================

function buildQuoteMessage(deal: ActiveDeal, amountBrl: number | null, amountUsdt: number | null, simpleMode = false): string {
  const lines: string[] = []
  lines.push('📊 *Cotação*')
  lines.push('')
  lines.push(`Taxa: ${formatRate(deal.quotedRate)}`)

  if (amountBrl !== null && amountUsdt !== null) {
    lines.push(`${formatBrl(amountBrl)} → ${formatUsdt(amountUsdt)}`)
  }

  lines.push('')
  if (simpleMode) {
    lines.push('Responda *trava* ou envie o valor em USDT.')
  } else {
    lines.push('Responda *trava* para travar essa taxa.')
  }

  return lines.join('\n')
}

function buildLockMessage(deal: ActiveDeal): string {
  const rate = deal.lockedRate ?? deal.quotedRate
  const lines: string[] = []
  lines.push('🔒 *Taxa Travada*')
  lines.push('')
  lines.push(`Taxa: ${formatRate(rate)}`)

  if (deal.amountBrl !== null) {
    lines.push(`Valor: ${formatBrl(deal.amountBrl)}`)
  }
  if (deal.amountUsdt !== null) {
    lines.push(`USDT: ${formatUsdt(deal.amountUsdt)}`)
  }

  lines.push('')
  lines.push('Responda *fechado* para confirmar a operação.')

  return lines.join('\n')
}

function buildCompletionMessage(deal: ActiveDeal): string {
  const rate = deal.lockedRate ?? deal.quotedRate
  const lines: string[] = []
  lines.push('✅ *Operação Confirmada*')
  lines.push('')
  lines.push(`Taxa: ${formatRate(rate)}`)

  if (deal.amountBrl !== null) {
    lines.push(`BRL: ${formatBrl(deal.amountBrl)}`)
  }
  if (deal.amountUsdt !== null) {
    lines.push(`USDT: ${formatUsdt(deal.amountUsdt)}`)
  }

  lines.push('')
  lines.push('Operação registrada com sucesso.')

  return lines.join('\n')
}

function buildExpirationMessage(): string {
  return '⏰ Sua cotação expirou. Envie uma nova mensagem para receber uma cotação atualizada.'
}

function buildCancellationMessage(): string {
  return '❌ Operação cancelada.'
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the current base rate and build spread/rule context for deal creation.
 */
async function getQuoteContext(groupJid: string): Promise<Result<{
  baseRate: number
  quotedRate: number
  spreadConfig: SpreadConfig | null
  rule: GroupRule | null
  ttlSeconds: number
  side: 'client_buys_usdt' | 'client_sells_usdt'
}>> {
  // Fetch base rate from Binance
  const priceResult = await fetchPrice()
  if (!priceResult.ok) {
    return err(`Could not fetch current rate: ${priceResult.error}`)
  }
  const baseRate = priceResult.data

  // Get spread config
  let spreadConfig: SpreadConfig | null = null
  try {
    const configResult = await getSpreadConfig(groupJid)
    if (configResult.ok) {
      spreadConfig = configResult.data
    }
  } catch {
    // Non-fatal
  }

  // Check for active rule override
  let rule: GroupRule | null = null
  try {
    const ruleResult = await getActiveRule(groupJid)
    if (ruleResult.ok && ruleResult.data) {
      rule = ruleResult.data
    }
  } catch {
    // Non-fatal
  }

  // Build effective config for spread calculation
  const side = spreadConfig?.defaultSide ?? 'client_buys_usdt'
  const ttlSeconds = spreadConfig?.quoteTtlSeconds ?? 180

  let quotedRate = baseRate
  if (rule) {
    // Apply rule spread
    const now = new Date()
    const effectiveConfig: SpreadConfig = {
      groupJid,
      spreadMode: rule.spreadMode,
      sellSpread: rule.sellSpread,
      buySpread: rule.buySpread,
      quoteTtlSeconds: ttlSeconds,
      defaultSide: side,
      defaultCurrency: spreadConfig?.defaultCurrency ?? 'BRL',
      language: spreadConfig?.language ?? 'pt-BR',
      dealFlowMode: spreadConfig?.dealFlowMode ?? 'classic',
      operatorJid: spreadConfig?.operatorJid ?? null,
      amountTimeoutSeconds: spreadConfig?.amountTimeoutSeconds ?? 60,
      groupLanguage: spreadConfig?.groupLanguage ?? 'pt',
      createdAt: now,
      updatedAt: now,
    }
    quotedRate = calculateQuote(baseRate, effectiveConfig, side)
  } else if (spreadConfig) {
    quotedRate = calculateQuote(baseRate, spreadConfig, side)
  }

  return ok({
    baseRate,
    quotedRate,
    spreadConfig,
    rule,
    ttlSeconds,
    side,
  })
}

/**
 * Send a deal-related message and log it.
 */
async function sendDealMessage(
  context: RouterContext,
  message: string,
  messageType: BotMessageType,
  mentions?: string[]
): Promise<Result<void>> {
  const result = await sendWithAntiDetection(context.sock, context.groupId, message, mentions)

  if (result.ok) {
    logBotMessage({
      groupJid: context.groupId,
      content: message,
      messageType,
      isControlGroup: false,
    })
    recordMessageSent(context.groupId)
  } else {
    logger.error('Failed to send deal message', {
      event: 'deal_message_send_failed',
      error: result.error,
      groupId: context.groupId,
      messageType,
    })
  }

  return result
}

// ============================================================================
// Shared: Complete a locked deal immediately (locked = handshake)
// ============================================================================

/**
 * Complete a locked deal in one shot: LOCKED → COMPUTING → COMPLETED,
 * send 🔒 message with @operator, archive, clear quote, log to Excel.
 *
 * Used by ALL paths that create a locked deal with a known amount:
 * - handleVolumeInquiry bare-amount shortcut
 * - handlePriceLock active-quote + inline amount
 * - handlePriceLock active-quote + pre-stated volume
 * - handlePriceLock cold-lock (no quote)
 * - handleDirectAmount
 *
 * State transitions are best-effort — if DB fails, we still send the message
 * so the user sees their calculation and the operator is tagged.
 */
async function completeLockAndNotify(params: {
  dealId: string | undefined
  groupId: string
  sender: string
  rate: number
  amountUsdt: number
  amountBrl: number
  context: RouterContext
  logEvent: string
}): Promise<Result<DealHandlerResult>> {
  const { dealId, groupId, sender, rate, amountUsdt, amountBrl, context, logEvent } = params

  // 1. Transition: LOCKED → COMPUTING → COMPLETED (best-effort)
  if (dealId) {
    const computeResult = await startComputation(dealId, groupId)
    if (computeResult.ok) {
      await completeDeal(dealId, groupId, { amountBrl, amountUsdt })
    }
  }

  // 2. Send 🔒 message with @operator mention
  const operatorJid = resolveOperatorJid(groupId)
  const mentions = operatorJid ? [operatorJid] : []
  const calcLine = `${formatUsdt(amountUsdt)} × ${formatRate(rate)} = ${formatBrl(amountBrl)}`
  const mentionSuffix = operatorJid ? ` @${operatorJid.replace(/@.*/, '')}` : ''
  const calcMsg = `🔒 ${calcLine}${mentionSuffix}`

  const sendResult = await sendWithAntiDetection(context.sock, groupId, calcMsg, mentions)
  if (sendResult.ok) {
    logBotMessage({ groupJid: groupId, content: calcMsg, messageType: 'deal_volume_computed', isControlGroup: false })
    recordMessageSent(groupId)
  }

  // 3. Archive (fire-and-forget)
  if (dealId) {
    archiveDeal(dealId, groupId).catch(() => { /* logged internally */ })
  }

  // 4. Clear active quote — deal reached terminal state
  forceAccept(groupId)

  // 5. Log to Excel (fire-and-forget)
  logDealToExcel({
    groupId,
    groupName: context.groupName,
    clientIdentifier: context.senderName ?? sender,
    volumeBrl: amountBrl,
    quote: rate,
    acquiredUsdt: amountUsdt,
  })

  // 6. Log
  logger.info('Lock completed immediately (handshake)', {
    event: logEvent,
    dealId,
    groupId,
    sender,
    rate,
    amountUsdt,
    amountBrl,
  })

  return ok({
    action: 'deal_computed',
    dealId,
    groupId,
    clientJid: sender,
    message: calcMsg,
  })
}

// ============================================================================
// Sprint 9.1: Dispatcher for connection.ts DEAL_HANDLER routing
// ============================================================================

/**
 * Dispatch a DEAL_HANDLER-routed message to the appropriate sub-handler
 * based on the dealAction set by the router.
 */
export async function handleDealRouted(context: RouterContext): Promise<void> {
  switch (context.dealAction) {
    case 'volume_inquiry': await handleVolumeInquiry(context); break
    case 'price_lock':     await handlePriceLock(context); break
    case 'confirmation':   await handleConfirmation(context); break
    case 'cancellation':   await handleDealCancellation(context); break
    case 'rejection':      await handleRejection(context); break
    case 'volume_input':   await handleVolumeInput(context); break
    case 'direct_amount':  await handleDirectAmount(context); break
    case 'unrecognized_input': await handleUnrecognizedInput(context); break
    default:
      logger.warn('Unknown dealAction in DEAL_HANDLER route', {
        event: 'deal_handler_unknown_action',
        dealAction: context.dealAction,
        groupId: context.groupId,
        sender: context.sender,
      })
  }
}

// ============================================================================
// Core Deal Handlers
// ============================================================================

/**
 * Handle a volume inquiry message — creates a new QUOTED deal.
 *
 * When a client sends a message with a volume (e.g., "compro 10k", "tenho R$ 5.000"),
 * the bot creates a new deal in QUOTED state and responds with a rate quote.
 */
export async function handleVolumeInquiry(
  context: RouterContext
): Promise<Result<DealHandlerResult>> {
  const { groupId, sender, message } = context

  logger.info('Volume inquiry detected for deal flow', {
    event: 'deal_volume_inquiry',
    groupId,
    sender,
    messageLength: message.length,
  })

  // Bare-number shortcut: when no explicit currency marker (R$/reais/usdt/US$),
  // treat the number as USDT and respond with price + math only.
  // Covers "Trava 20400", "Faz 14000", "Compro 5000", bare "20000", etc.
  const bareAmount = extractBrlAmount(message)
  const explicitUsdt = extractUsdtAmount(message)
  const hasExplicitBrlMarker = /(?:R\$|reais|\bbrl\b)/i.test(message)

  if (bareAmount !== null && explicitUsdt === null && !hasExplicitBrlMarker) {
    // Use active quote rate if available (persists from price response),
    // otherwise fetch fresh rate from Binance
    let quotedRate: number
    let baseRate: number
    const activeQuote = getActiveQuote(groupId)
    if (activeQuote && (activeQuote.status === 'pending' || activeQuote.status === 'repricing')) {
      quotedRate = activeQuote.quotedPrice
      baseRate = activeQuote.basePrice
    } else {
      const quoteCtx = await getQuoteContext(groupId)
      if (!quoteCtx.ok) {
        return err(quoteCtx.error)
      }
      quotedRate = quoteCtx.data.quotedRate
      baseRate = quoteCtx.data.baseRate
    }
    const comp = computeUsdtToBrl(bareAmount, quotedRate)
    if (!comp.ok) {
      return err(`Computation failed: ${comp.error}`)
    }

    // Cancel any existing deal (client is superseding with a new amount)
    const priorResult = await findClientDeal(groupId, sender)
    if (priorResult.ok && priorResult.data !== null) {
      await cancelDeal(priorResult.data.id, groupId, 'cancelled_by_client').catch(() => {})
      archiveDeal(priorResult.data.id, groupId).catch(() => {})
    }

    // Create a LOCKED deal so "off" and "fechado" work on this rate
    const cfgResult = await getSpreadConfig(groupId)
    const side = cfgResult.ok ? cfgResult.data.defaultSide ?? 'client_buys_usdt' : 'client_buys_usdt'
    const ttlSeconds = cfgResult.ok ? cfgResult.data.quoteTtlSeconds ?? 180 : 180

    const dealResult = await createDeal({
      groupJid: groupId,
      clientJid: sender,
      side,
      quotedRate,
      baseRate,
      ttlSeconds,
      spreadConfig: cfgResult.ok ? cfgResult.data : undefined,
      amountUsdt: bareAmount,
      amountBrl: comp.data.amountBrl,
      metadata: {
        senderName: context.senderName ?? null,
        originalMessage: message.substring(0, 200),
        flow: 'calculator_lock',
      },
    })

    let dealId: string | undefined
    if (dealResult.ok) {
      dealId = dealResult.data.id
      await lockDeal(dealId, groupId, {
        lockedRate: quotedRate,
        amountUsdt: bareAmount,
        amountBrl: comp.data.amountBrl,
      })
    }

    return completeLockAndNotify({
      dealId,
      groupId,
      sender,
      rate: quotedRate,
      amountUsdt: bareAmount,
      amountBrl: comp.data.amountBrl,
      context,
      logEvent: 'deal_calculator_lock',
    })
  }

  // Check for existing active deal
  const existingResult = await findClientDeal(groupId, sender)
  if (!existingResult.ok) {
    return err(`Failed to check existing deals: ${existingResult.error}`)
  }

  if (existingResult.data !== null) {
    const existing = existingResult.data
    // Client already has an active deal — remind them
    const stateMessages: Record<string, string> = {
      quoted: '📊 Você já tem uma cotação aberta. Responda *trava* para travar a taxa.',
      locked: '🔒 Sua taxa já está travada. Responda *fechado* para confirmar.',
      awaiting_amount: '💰 Aguardando o valor em USDT. Envie o valor desejado.',
      computing: '⏳ Sua operação está sendo processada.',
    }
    const reminder = stateMessages[existing.state] ?? 'Você já tem uma operação ativa.'
    await sendDealMessage(context, reminder, 'deal_reminder')

    return ok({
      action: 'no_action',
      dealId: existing.id,
      groupId,
      clientJid: sender,
      message: `Client has existing deal in ${existing.state} state`,
    })
  }

  // Extract amounts from message
  const amountBrl = extractBrlAmount(message)
  const amountUsdt = extractUsdtAmount(message)

  // Get quote context (rate, spread, rule)
  const quoteCtx = await getQuoteContext(groupId)
  if (!quoteCtx.ok) {
    logger.warn('Failed to get quote context for deal', {
      event: 'deal_quote_context_failed',
      groupId,
      error: quoteCtx.error,
    })
    return err(quoteCtx.error)
  }

  const { baseRate, quotedRate, spreadConfig, rule, ttlSeconds, side } = quoteCtx.data

  // Compute amounts if BRL or USDT provided
  let computedBrl = amountBrl
  let computedUsdt = amountUsdt

  if (amountBrl !== null && amountUsdt === null) {
    const comp = computeBrlToUsdt(amountBrl, quotedRate)
    if (comp.ok) {
      computedUsdt = comp.data.amountUsdt
    }
  } else if (amountUsdt !== null && amountBrl === null) {
    const comp = computeUsdtToBrl(amountUsdt, quotedRate)
    if (comp.ok) {
      computedBrl = comp.data.amountBrl
    }
  }

  // Create deal in QUOTED state
  const createInput: CreateDealInput = {
    groupJid: groupId,
    clientJid: sender,
    side,
    quotedRate,
    baseRate,
    ttlSeconds,
    rule,
    spreadConfig: spreadConfig ?? undefined,
    metadata: {
      senderName: context.senderName ?? null,
      originalMessage: message.substring(0, 200),
    },
  }

  if (computedBrl !== null) createInput.amountBrl = computedBrl
  if (computedUsdt !== null) createInput.amountUsdt = computedUsdt

  const dealResult = await createDeal(createInput)
  if (!dealResult.ok) {
    logger.error('Failed to create deal', {
      event: 'deal_create_failed',
      groupId,
      sender,
      error: dealResult.error,
    })
    return err(dealResult.error)
  }

  const deal = dealResult.data

  // Send quote message (simple mode shows streamlined guidance)
  const isSimpleModeForQuote = spreadConfig?.dealFlowMode === 'simple'
  const quoteMsg = buildQuoteMessage(deal, computedBrl, computedUsdt, isSimpleModeForQuote)
  await sendDealMessage(context, quoteMsg, 'deal_quote')

  logger.info('Deal quoted', {
    event: 'deal_quoted',
    dealId: deal.id,
    groupId,
    sender,
    quotedRate,
    baseRate,
    amountBrl: computedBrl,
    amountUsdt: computedUsdt,
    ruleName: rule?.name ?? null,
  })

  return ok({
    action: 'deal_quoted',
    dealId: deal.id,
    groupId,
    clientJid: sender,
    message: quoteMsg,
  })
}

/**
 * Handle a price lock message — locks the deal at the quoted rate.
 *
 * When a client sends "trava" or similar lock message, the bot locks their
 * active deal at the quoted rate.
 */
export async function handlePriceLock(
  context: RouterContext
): Promise<Result<DealHandlerResult>> {
  const { groupId, sender, message } = context

  logger.info('Price lock detected for deal flow', {
    event: 'deal_price_lock',
    groupId,
    sender,
  })

  // Find existing deal
  const existingResult = await findClientDeal(groupId, sender)
  if (!existingResult.ok) {
    return err(`Failed to find deal: ${existingResult.error}`)
  }

  let deal = existingResult.data
  if (deal === null) {
    // No deal — check for active quote bridge (price response → trava flow)
    const activeQuote = getActiveQuote(groupId)
    if (activeQuote && (activeQuote.status === 'pending' || activeQuote.status === 'repricing')) {
      // Check for inline amount (e.g., "trava 3000", "2500 trava pfv")
      // If found, just compute and respond — don't create a deal or consume the quote
      let inlineAmount: number | null = null
      const lockWords = message.trim().split(/\s+/)
      for (const word of lockWords) {
        const parsed = parseBrazilianNumber(word)
        if (parsed !== null && parsed >= MIN_VOLUME_USDT) {
          inlineAmount = parsed
          break
        }
      }

      if (inlineAmount !== null) {
        const rate = activeQuote.quotedPrice
        const comp = computeUsdtToBrl(inlineAmount, rate)
        if (!comp.ok) return err(`Computation failed: ${comp.error}`)

        // Cancel any existing deal (superseded by new calculation)
        const priorResult = await findClientDeal(groupId, sender)
        if (priorResult.ok && priorResult.data !== null) {
          await cancelDeal(priorResult.data.id, groupId, 'cancelled_by_client').catch(() => {})
          archiveDeal(priorResult.data.id, groupId).catch(() => {})
        }

        // Create a LOCKED deal so "off"/"fechado" work on this rate
        const bridgeCfg = await getSpreadConfig(groupId)
        const bridgeSide = bridgeCfg.ok ? bridgeCfg.data.defaultSide ?? 'client_buys_usdt' : 'client_buys_usdt'
        const bridgeTtl = bridgeCfg.ok ? bridgeCfg.data.quoteTtlSeconds ?? 180 : 180

        const bridgeDealResult = await createDeal({
          groupJid: groupId,
          clientJid: sender,
          side: bridgeSide,
          quotedRate: rate,
          baseRate: activeQuote.basePrice,
          ttlSeconds: bridgeTtl,
          spreadConfig: bridgeCfg.ok ? bridgeCfg.data : undefined,
          amountUsdt: inlineAmount,
          amountBrl: comp.data.amountBrl,
          metadata: {
            senderName: context.senderName ?? null,
            originalMessage: message.substring(0, 200),
            flow: 'calculator_lock',
          },
        })

        let bridgeDealId: string | undefined
        if (bridgeDealResult.ok) {
          bridgeDealId = bridgeDealResult.data.id
          await lockDeal(bridgeDealId, groupId, {
            lockedRate: rate,
            amountUsdt: inlineAmount,
            amountBrl: comp.data.amountBrl,
          })
        }

        return completeLockAndNotify({
          dealId: bridgeDealId,
          groupId,
          sender,
          rate,
          amountUsdt: inlineAmount,
          amountBrl: comp.data.amountBrl,
          context,
          logEvent: 'deal_lock_calc',
        })
      }

      // No inline amount — check for pre-stated volume from price request
      if (activeQuote.preStatedVolume) {
        const preVol = activeQuote.preStatedVolume
        clearPreStatedVolume(groupId)

        const rate = activeQuote.quotedPrice
        const comp = computeUsdtToBrl(preVol, rate)
        if (!comp.ok) return err(`Computation failed: ${comp.error}`)

        // No need to cancel prior deal — we're inside `deal === null` branch
        const bridgeCfg = await getSpreadConfig(groupId)
        const bridgeSide = bridgeCfg.ok ? bridgeCfg.data.defaultSide ?? 'client_buys_usdt' : 'client_buys_usdt'
        const bridgeTtl = bridgeCfg.ok ? bridgeCfg.data.quoteTtlSeconds ?? 180 : 180

        const bridgeDealResult = await createDeal({
          groupJid: groupId,
          clientJid: sender,
          side: bridgeSide,
          quotedRate: rate,
          baseRate: activeQuote.basePrice,
          ttlSeconds: bridgeTtl,
          spreadConfig: bridgeCfg.ok ? bridgeCfg.data : undefined,
          amountUsdt: preVol,
          amountBrl: comp.data.amountBrl,
          metadata: {
            senderName: context.senderName ?? null,
            originalMessage: message.substring(0, 200),
            flow: 'calculator_lock',
          },
        })

        let bridgeDealId: string | undefined
        if (bridgeDealResult.ok) {
          bridgeDealId = bridgeDealResult.data.id
          await lockDeal(bridgeDealId, groupId, {
            lockedRate: rate,
            amountUsdt: preVol,
            amountBrl: comp.data.amountBrl,
          })
        }

        return completeLockAndNotify({
          dealId: bridgeDealId,
          groupId,
          sender,
          rate,
          amountUsdt: preVol,
          amountBrl: comp.data.amountBrl,
          context,
          logEvent: 'deal_lock_pre_stated',
        })
      }

      // No inline amount, no pre-stated volume — create deal from quote for lock flow
      // Note: active quote is preserved (not consumed) so dashboard shows
      // threshold line and volatility monitoring continues during the deal

      const bridgeConfig = await getSpreadConfig(groupId)
      const side = bridgeConfig.ok ? bridgeConfig.data.defaultSide ?? 'client_buys_usdt' : 'client_buys_usdt'
      const ttlSeconds = bridgeConfig.ok ? bridgeConfig.data.quoteTtlSeconds ?? 180 : 180

      const dealResult = await createDeal({
        groupJid: groupId,
        clientJid: sender,
        side,
        quotedRate: activeQuote.quotedPrice,
        baseRate: activeQuote.basePrice,
        ttlSeconds,
        spreadConfig: bridgeConfig.ok ? bridgeConfig.data : undefined,
        metadata: {
          senderName: context.senderName ?? null,
          originalMessage: message.substring(0, 200),
          flow: 'quote_lock',
        },
      })

      if (!dealResult.ok) {
        logger.error('Failed to create deal from active quote', {
          event: 'deal_quote_bridge_failed',
          groupId,
          sender,
          error: dealResult.error,
        })
        return err(dealResult.error)
      }

      deal = dealResult.data

      logger.info('Deal created from active quote for lock', {
        event: 'deal_created_from_quote',
        dealId: deal.id,
        groupId,
        sender,
        quotedRate: activeQuote.quotedPrice,
      })
    } else {
      // No active deal or quote — check for inline amount (e.g., "travar 19226")
      let noQuoteAmount: number | null = null
      const words = message.trim().split(/\s+/)
      for (const word of words) {
        const parsed = parseBrazilianNumber(word)
        if (parsed !== null && parsed >= MIN_VOLUME_USDT) {
          noQuoteAmount = parsed
          break
        }
      }

      if (noQuoteAmount !== null) {
        // Fetch fresh rate (mirrors handleVolumeInquiry bare-amount path)
        const quoteCtx = await getQuoteContext(groupId)
        if (!quoteCtx.ok) {
          return err(quoteCtx.error)
        }

        const { quotedRate, baseRate } = quoteCtx.data
        const comp = computeUsdtToBrl(noQuoteAmount, quotedRate)
        if (!comp.ok) return err(`Computation failed: ${comp.error}`)

        // Create active quote for dashboard + volatility monitor
        createQuote(groupId, quotedRate, {
          priceSource: 'usdt_brl',
          basePrice: baseRate,
          requesterJid: context.sender,
        })

        // No need to cancel prior deal — we're inside `deal === null` branch
        // Create LOCKED deal
        const cfgResult = await getSpreadConfig(groupId)
        const side = cfgResult.ok ? cfgResult.data.defaultSide ?? 'client_buys_usdt' : 'client_buys_usdt'
        const ttlSeconds = cfgResult.ok ? cfgResult.data.quoteTtlSeconds ?? 180 : 180

        const dealResult = await createDeal({
          groupJid: groupId,
          clientJid: sender,
          side,
          quotedRate,
          baseRate,
          ttlSeconds,
          spreadConfig: cfgResult.ok ? cfgResult.data : undefined,
          amountUsdt: noQuoteAmount,
          amountBrl: comp.data.amountBrl,
          metadata: {
            senderName: context.senderName ?? null,
            originalMessage: message.substring(0, 200),
            flow: 'calculator_lock',
          },
        })

        let dealId: string | undefined
        if (dealResult.ok) {
          dealId = dealResult.data.id
          await lockDeal(dealId, groupId, {
            lockedRate: quotedRate,
            amountUsdt: noQuoteAmount,
            amountBrl: comp.data.amountBrl,
          })
        }

        return completeLockAndNotify({
          dealId,
          groupId,
          sender,
          rate: quotedRate,
          amountUsdt: noQuoteAmount,
          amountBrl: comp.data.amountBrl,
          context,
          logEvent: 'deal_cold_lock_complete',
        })
      }

      // No amount at all — suggest creating a quote
      await sendDealMessage(
        context,
        'Você não tem cotação ativa. Envie o valor desejado para receber uma cotação.',
        'deal_no_active'
      )
      return ok({
        action: 'no_action',
        groupId,
        clientJid: sender,
        message: 'No active deal to lock',
      })
    }
  }

  if (deal.state !== 'quoted') {
    const stateMessages: Record<string, string> = {
      locked: '🔒 Sua taxa já está travada. Responda *fechado* para confirmar.',
      computing: '⏳ Sua operação está sendo processada.',
    }
    const msg = stateMessages[deal.state] ?? 'Operação já em andamento.'
    await sendDealMessage(context, msg, 'deal_state_reminder')

    return ok({
      action: 'no_action',
      dealId: deal.id,
      groupId,
      clientJid: sender,
      message: `Deal already in ${deal.state} state`,
    })
  }

  // Extract any amounts from the lock message (client might include amount)
  const amountBrl = extractBrlAmount(message)
  const amountUsdt = extractUsdtAmount(message)

  // Check for simple mode — inline amount uses parseBrazilianNumber as fallback
  const configResult = await getSpreadConfig(groupId)
  const isSimpleMode = configResult.ok && configResult.data.dealFlowMode === 'simple'

  // In simple mode, also try parseBrazilianNumber for bare numbers in the message
  let simpleAmount = amountUsdt
  if (isSimpleMode && simpleAmount === null) {
    // Try to extract a bare number from the message (e.g., "trava 5000", "ok 10k")
    const words = message.trim().split(/\s+/)
    for (const word of words) {
      const parsed = parseBrazilianNumber(word)
      if (parsed !== null && parsed > 0) {
        simpleAmount = parsed
        break
      }
    }
  }

  // Lock the deal
  const lockResult = await lockDeal(deal.id, groupId, {
    lockedRate: deal.quotedRate,
    amountBrl: amountBrl ?? undefined,
    amountUsdt: (isSimpleMode ? simpleAmount : amountUsdt) ?? undefined,
  })

  if (!lockResult.ok) {
    if (lockResult.error === 'Deal has expired') {
      await sendDealMessage(context, buildExpirationMessage(), 'deal_expired')
      return ok({
        action: 'no_action',
        dealId: deal.id,
        groupId,
        clientJid: sender,
        message: 'Deal expired during lock attempt',
      })
    }
    return err(lockResult.error)
  }

  const lockedDeal = lockResult.data

  // ---- Simple Mode: branch based on whether amount was included ----
  if (isSimpleMode) {
    if (simpleAmount !== null && simpleAmount > 0) {
      // Amount included: compute and complete immediately
      const rate = lockedDeal.lockedRate ?? lockedDeal.quotedRate
      const comp = computeUsdtToBrl(simpleAmount, rate)

      if (!comp.ok) {
        return err(`Computation failed: ${comp.error}`)
      }

      // Transition: LOCKED → COMPUTING → COMPLETED
      const computeResult = await startComputation(deal.id, groupId)
      if (!computeResult.ok) return err(computeResult.error)

      const completeResult = await completeDeal(deal.id, groupId, {
        amountBrl: comp.data.amountBrl,
        amountUsdt: simpleAmount,
      })
      if (!completeResult.ok) return err(completeResult.error)

      // Send formatted calculation + @mention
      const operatorJid = resolveOperatorJid(groupId)
      const mentions = operatorJid ? [operatorJid] : []
      const calcLine = `${formatUsdt(simpleAmount)} × ${formatRate(rate)} = ${formatBrl(comp.data.amountBrl)}`
      const mentionSuffix = operatorJid ? ` @${operatorJid.replace(/@.*/, '')}` : ''
      const calcMsg = `🔒 ${calcLine}${mentionSuffix}`

      const sendResult = await sendWithAntiDetection(context.sock, groupId, calcMsg, mentions)
      if (sendResult.ok) {
        logBotMessage({ groupJid: groupId, content: calcMsg, messageType: 'deal_volume_computed', isControlGroup: false })
        recordMessageSent(groupId)
      }

      // Archive (fire-and-forget)
      archiveDeal(deal.id, groupId).catch(() => { /* logged internally */ })

      // Clear active quote now that deal reached terminal state
      forceAccept(groupId)

      // Sprint 9.1: Log to Excel (fire-and-forget)
      logDealToExcel({
        groupId,
        groupName: context.groupName,
        clientIdentifier: context.senderName ?? sender,
        volumeBrl: comp.data.amountBrl,
        quote: rate,
        acquiredUsdt: simpleAmount,
      })

      logger.info('Simple mode lock+compute completed', {
        event: 'deal_simple_lock_complete',
        dealId: deal.id,
        groupId,
        sender,
        rate,
        amountUsdt: simpleAmount,
        amountBrl: comp.data.amountBrl,
      })

      return ok({
        action: 'deal_computed',
        dealId: deal.id,
        groupId,
        clientJid: sender,
        message: calcMsg,
      })
    }

    // No amount: transition to AWAITING_AMOUNT
    const awaitResult = await startAwaitingAmount(deal.id, groupId)
    if (!awaitResult.ok) return err(awaitResult.error)

    const rate = lockedDeal.lockedRate ?? lockedDeal.quotedRate
    const language = configResult.ok ? configResult.data.groupLanguage : 'pt'
    const promptMsg = language === 'en'
      ? `Rate locked at ${formatRate(rate)}. How much USDT will be purchased?`
      : `Taxa travada em ${formatRate(rate)}. Quantos USDTs serão comprados?`

    await sendDealMessage(context, promptMsg, 'deal_awaiting_amount')

    logger.info('Simple mode lock → awaiting amount', {
      event: 'deal_simple_awaiting_amount',
      dealId: deal.id,
      groupId,
      sender,
      rate,
      language,
    })

    return ok({
      action: 'deal_locked',
      dealId: deal.id,
      groupId,
      clientJid: sender,
      message: promptMsg,
    })
  }

  // ---- Classic Mode: existing behavior ----

  // Send lock confirmation
  const lockMsg = buildLockMessage(lockedDeal)
  await sendDealMessage(context, lockMsg, 'deal_lock_confirmation')

  logger.info('Deal locked', {
    event: 'deal_locked',
    dealId: deal.id,
    groupId,
    sender,
    lockedRate: lockedDeal.lockedRate,
  })

  return ok({
    action: 'deal_locked',
    dealId: deal.id,
    groupId,
    clientJid: sender,
    message: lockMsg,
  })
}

/**
 * Handle a confirmation message — computes and completes the deal.
 *
 * When a client sends "fechado", "ok", etc., the bot advances through
 * COMPUTING → COMPLETED and sends the final computation.
 */
export async function handleConfirmation(
  context: RouterContext
): Promise<Result<DealHandlerResult>> {
  const { groupId, sender } = context

  logger.info('Confirmation detected for deal flow', {
    event: 'deal_confirmation',
    groupId,
    sender,
  })

  // Find existing deal
  const existingResult = await findClientDeal(groupId, sender)
  if (!existingResult.ok) {
    return err(`Failed to find deal: ${existingResult.error}`)
  }

  const deal = existingResult.data
  if (deal === null) {
    // No active deal — this confirmation is not for us
    return ok({
      action: 'no_action',
      groupId,
      clientJid: sender,
      message: 'No active deal to confirm',
    })
  }

  if (deal.state === 'quoted') {
    // Confirmation on a quote = auto-lock first, then compute
    await sendDealMessage(
      context,
      '📊 Primeiro trave a taxa respondendo *trava*, depois confirme.',
      'deal_state_hint'
    )
    return ok({
      action: 'no_action',
      dealId: deal.id,
      groupId,
      clientJid: sender,
      message: 'Deal in quoted state, needs lock first',
    })
  }

  if (deal.state !== 'locked') {
    const stateMessages: Record<string, string> = {
      computing: '⏳ Sua operação está sendo processada.',
      completed: '✅ Sua operação já foi concluída.',
    }
    const msg = stateMessages[deal.state] ?? 'Operação já em andamento.'
    await sendDealMessage(context, msg, 'deal_state_reminder')

    return ok({
      action: 'no_action',
      dealId: deal.id,
      groupId,
      clientJid: sender,
      message: `Deal in ${deal.state} state, cannot confirm`,
    })
  }

  // Transition: LOCKED → COMPUTING
  const computeResult = await startComputation(deal.id, groupId)
  if (!computeResult.ok) {
    if (computeResult.error === 'Deal has expired') {
      await sendDealMessage(context, buildExpirationMessage(), 'deal_expired')
      return ok({
        action: 'no_action',
        dealId: deal.id,
        groupId,
        clientJid: sender,
        message: 'Deal expired during confirmation',
      })
    }
    return err(computeResult.error)
  }

  // Compute amounts if not already set
  const rate = deal.lockedRate ?? deal.quotedRate
  let finalBrl = deal.amountBrl
  let finalUsdt = deal.amountUsdt

  if (finalBrl !== null && finalUsdt === null) {
    const comp = computeBrlToUsdt(finalBrl, rate)
    if (comp.ok) finalUsdt = comp.data.amountUsdt
  } else if (finalUsdt !== null && finalBrl === null) {
    const comp = computeUsdtToBrl(finalUsdt, rate)
    if (comp.ok) finalBrl = comp.data.amountBrl
  }

  // Transition: COMPUTING → COMPLETED
  if (finalBrl !== null && finalUsdt !== null) {
    const completeResult = await completeDeal(deal.id, groupId, {
      amountBrl: finalBrl,
      amountUsdt: finalUsdt,
    })

    if (!completeResult.ok) {
      return err(completeResult.error)
    }

    // Send confirmation with operator @tag
    const operatorJid = resolveOperatorJid(groupId)
    const mentions = operatorJid ? [operatorJid] : []
    const mentionSuffix = operatorJid ? ` @${operatorJid.replace(/@.*/, '')}` : ''
    const confirmMsg = `✅ US$ 1,00 = R$ ${formatRate(rate)}\n\n${formatUsdt(finalUsdt)} → ${formatBrl(finalBrl)}${mentionSuffix}`

    const sendResult = await sendWithAntiDetection(context.sock, groupId, confirmMsg, mentions)
    if (sendResult.ok) {
      logBotMessage({ groupJid: groupId, content: confirmMsg, messageType: 'deal_completed', isControlGroup: false })
      recordMessageSent(groupId)
    }

    // Archive the deal (fire-and-forget)
    archiveDeal(deal.id, groupId).catch((e) => {
      logger.warn('Failed to archive deal', {
        event: 'deal_archive_failed',
        dealId: deal.id,
        error: e instanceof Error ? e.message : String(e),
      })
    })

    // Clear active quote now that deal reached terminal state
    forceAccept(groupId)

    // Log to Excel (fire-and-forget)
    logDealToExcel({
      groupId,
      groupName: context.groupName,
      clientIdentifier: context.senderName ?? sender,
      volumeBrl: finalBrl,
      quote: rate,
      acquiredUsdt: finalUsdt,
    })

    logger.info('Deal completed with operator tag', {
      event: 'deal_completed',
      dealId: deal.id,
      groupId,
      sender,
      rate,
      amountBrl: finalBrl,
      amountUsdt: finalUsdt,
      operatorMentioned: !!operatorJid,
    })

    return ok({
      action: 'deal_computed',
      dealId: deal.id,
      groupId,
      clientJid: sender,
      message: confirmMsg,
    })
  }

  // Amounts not available — ask client
  await sendDealMessage(
    context,
    '💰 Informe o valor da operação (ex: "10k", "R$ 5.000", "500 usdt").',
    'deal_amount_needed'
  )

  return ok({
    action: 'no_action',
    dealId: deal.id,
    groupId,
    clientJid: sender,
    message: 'Amounts not set, asking client',
  })
}

/**
 * Handle deal cancellation.
 * Called when client sends "cancela", "cancelar", etc.
 */
export async function handleDealCancellation(
  context: RouterContext
): Promise<Result<DealHandlerResult>> {
  const { groupId, sender } = context

  const existingResult = await findClientDeal(groupId, sender)
  if (!existingResult.ok) {
    return err(`Failed to find deal: ${existingResult.error}`)
  }

  const deal = existingResult.data
  if (deal === null) {
    return ok({
      action: 'no_action',
      groupId,
      clientJid: sender,
      message: 'No active deal to cancel',
    })
  }

  const cancelResult = await cancelDeal(deal.id, groupId, 'cancelled_by_client')
  if (!cancelResult.ok) {
    return err(cancelResult.error)
  }

  await sendDealMessage(context, buildCancellationMessage(), 'deal_cancelled')

  // Archive (fire-and-forget)
  archiveDeal(deal.id, groupId).catch(() => { /* logged internally */ })

  // Clear active quote now that deal reached terminal state
  forceAccept(groupId)

  logger.info('Deal cancelled by client', {
    event: 'deal_cancelled_by_client',
    dealId: deal.id,
    groupId,
    sender,
  })

  return ok({
    action: 'deal_cancelled',
    dealId: deal.id,
    groupId,
    clientJid: sender,
  })
}

/**
 * Sprint 9: Handle deal rejection ("off" path).
 * When a client says "off" while in QUOTED state, the deal is rejected.
 * Sends "off" to the group, @mentions the operator, and archives the deal.
 */
export async function handleRejection(
  context: RouterContext
): Promise<Result<DealHandlerResult>> {
  const { groupId, sender } = context

  logger.info('Rejection detected for deal flow', {
    event: 'deal_rejection',
    groupId,
    sender,
  })

  // Find existing deal
  const existingResult = await findClientDeal(groupId, sender)
  if (!existingResult.ok) {
    return err(`Failed to find deal: ${existingResult.error}`)
  }

  const deal = existingResult.data
  if (deal === null) {
    return ok({
      action: 'no_action',
      groupId,
      clientJid: sender,
      message: 'No active deal to reject',
    })
  }

  if (deal.state !== 'quoted' && deal.state !== 'locked') {
    logger.warn('Rejection attempted on non-rejectable deal', {
      event: 'deal_rejection_wrong_state',
      dealId: deal.id,
      groupId,
      currentState: deal.state,
    })
    return ok({
      action: 'no_action',
      dealId: deal.id,
      groupId,
      clientJid: sender,
      message: `Deal in ${deal.state} state, cannot reject`,
    })
  }

  // Transition: QUOTED/LOCKED → REJECTED
  // For LOCKED deals, cancel first then reject
  const rejectFn = deal.state === 'locked'
    ? cancelDeal(deal.id, groupId, 'cancelled_by_client')
    : rejectDeal(deal.id, groupId)
  const rejectResult = await rejectFn
  if (!rejectResult.ok) {
    return err(rejectResult.error)
  }

  // Send "off" to group with @mention of operator
  const operatorJid = resolveOperatorJid(groupId)
  const mentions = operatorJid ? [operatorJid] : []
  const offMessage = operatorJid ? `off @${operatorJid.replace(/@.*/, '')}` : 'off'

  const sendResult = await sendWithAntiDetection(context.sock, groupId, offMessage, mentions)
  if (sendResult.ok) {
    logBotMessage({
      groupJid: groupId,
      content: offMessage,
      messageType: 'deal_rejected',
      isControlGroup: false,
    })
    recordMessageSent(groupId)
  } else {
    logger.error('Failed to send rejection message', {
      event: 'deal_rejection_send_failed',
      error: sendResult.error,
      groupId,
    })
  }

  // Archive deal (fire-and-forget)
  archiveDeal(deal.id, groupId).catch(() => { /* logged internally */ })

  // Clear active quote now that deal reached terminal state
  forceAccept(groupId)

  logger.info('Deal rejected by client', {
    event: 'deal_rejected_by_client',
    dealId: deal.id,
    groupId,
    sender,
    operatorMentioned: !!operatorJid,
  })

  return ok({
    action: 'deal_rejected',
    dealId: deal.id,
    groupId,
    clientJid: sender,
    message: offMessage,
  })
}

/**
 * Sprint 9: Handle volume input (AWAITING_AMOUNT state).
 * Client sends a USDT amount (e.g., "5000", "10k") after rate was locked.
 * Computes USDT × rate = BRL, sends formatted message, @mentions operator, completes deal.
 */
export async function handleVolumeInput(
  context: RouterContext
): Promise<Result<DealHandlerResult>> {
  const { groupId, sender, message } = context

  logger.info('Volume input detected for deal flow', {
    event: 'deal_volume_input',
    groupId,
    sender,
    messageLength: message.length,
  })

  // Find existing deal
  const existingResult = await findClientDeal(groupId, sender)
  if (!existingResult.ok) {
    return err(`Failed to find deal: ${existingResult.error}`)
  }

  const deal = existingResult.data
  if (deal === null || deal.state !== 'awaiting_amount') {
    return ok({
      action: 'no_action',
      groupId,
      clientJid: sender,
      message: 'No deal in awaiting_amount state',
    })
  }

  // Parse the USDT amount
  const amount = extractUsdtAmount(message) ?? parseBrazilianNumber(message.trim())

  if (amount === null || amount <= 0) {
    // Gentle error message — bilingual
    const configResult = await getSpreadConfig(groupId)
    const language = configResult.ok ? configResult.data.groupLanguage : 'pt'
    const errorMsg = language === 'en'
      ? "Couldn't understand the amount. Send USDT value (e.g., 500, 10k)."
      : 'Não entendi o valor. Envie o valor em USDT (ex: 500, 10k).'

    await sendDealMessage(context, errorMsg, 'deal_awaiting_amount')

    return ok({
      action: 'no_action',
      dealId: deal.id,
      groupId,
      clientJid: sender,
      message: 'Amount parse failed',
    })
  }

  // Compute USDT × rate = BRL
  const rate = deal.lockedRate ?? deal.quotedRate
  const comp = computeUsdtToBrl(amount, rate)

  if (!comp.ok) {
    return err(`Computation failed: ${comp.error}`)
  }

  // Transition: AWAITING_AMOUNT → COMPUTING → COMPLETED
  const computeResult = await startComputation(deal.id, groupId)
  if (!computeResult.ok) return err(computeResult.error)

  const completeResult = await completeDeal(deal.id, groupId, {
    amountBrl: comp.data.amountBrl,
    amountUsdt: amount,
  })
  if (!completeResult.ok) return err(completeResult.error)

  // Send formatted calculation + @mention
  const operatorJid = resolveOperatorJid(groupId)
  const mentions = operatorJid ? [operatorJid] : []
  const calcLine = `${formatUsdt(amount)} × ${formatRate(rate)} = ${formatBrl(comp.data.amountBrl)}`
  const mentionSuffix = operatorJid ? ` @${operatorJid.replace(/@.*/, '')}` : ''
  const calcMsg = `✅ ${calcLine}${mentionSuffix}`

  const sendResult = await sendWithAntiDetection(context.sock, groupId, calcMsg, mentions)
  if (sendResult.ok) {
    logBotMessage({ groupJid: groupId, content: calcMsg, messageType: 'deal_volume_computed', isControlGroup: false })
    recordMessageSent(groupId)
  }

  // Archive (fire-and-forget)
  archiveDeal(deal.id, groupId).catch(() => { /* logged internally */ })

  // Clear active quote now that deal reached terminal state
  forceAccept(groupId)

  // Sprint 9.1: Log to Excel (fire-and-forget)
  logDealToExcel({
    groupId,
    groupName: context.groupName,
    clientIdentifier: context.senderName ?? sender,
    volumeBrl: comp.data.amountBrl,
    quote: rate,
    acquiredUsdt: amount,
  })

  logger.info('Volume input completed deal', {
    event: 'deal_volume_input_completed',
    dealId: deal.id,
    groupId,
    sender,
    rate,
    amountUsdt: amount,
    amountBrl: comp.data.amountBrl,
  })

  return ok({
    action: 'deal_computed',
    dealId: deal.id,
    groupId,
    clientJid: sender,
    message: calcMsg,
  })
}

// ============================================================================
// Sprint 9.1: CIO's Ideal Deal Flow — Direct Amount Handler
// ============================================================================

/**
 * Handle direct USDT amount when an active quote exists but no deal.
 * Calculator mode: uses the active quote rate, responds with standard format,
 * and preserves the active quote so subsequent calculations use the same rate.
 */
export async function handleDirectAmount(
  context: RouterContext
): Promise<Result<DealHandlerResult>> {
  const { groupId, sender, message } = context

  logger.info('Direct amount detected', {
    event: 'deal_direct_amount',
    groupId,
    sender,
    messageLength: message.length,
  })

  // Get active quote (has rate from price response)
  const activeQuote = getActiveQuote(groupId)
  if (!activeQuote || (activeQuote.status !== 'pending' && activeQuote.status !== 'repricing')) {
    logger.warn('Direct amount: no active quote found', {
      event: 'deal_direct_amount_no_quote',
      groupId,
      sender,
    })
    return ok({
      action: 'no_action',
      groupId,
      clientJid: sender,
      message: 'No active quote for direct amount',
    })
  }

  // Parse USDT amount
  const amount = parseBrazilianNumber(message.trim())
  if (amount === null || amount < 100) {
    return ok({
      action: 'no_action',
      groupId,
      clientJid: sender,
      message: 'Amount parse failed or below minimum',
    })
  }

  // Compute USDT × quotedPrice = BRL
  const rate = activeQuote.quotedPrice
  const comp = computeUsdtToBrl(amount, rate)
  if (!comp.ok) {
    return err(`Computation failed: ${comp.error}`)
  }

  // Cancel any existing deal (superseded by new calculation)
  const priorResult = await findClientDeal(groupId, sender)
  if (priorResult.ok && priorResult.data !== null) {
    await cancelDeal(priorResult.data.id, groupId, 'cancelled_by_client').catch(() => {})
    archiveDeal(priorResult.data.id, groupId).catch(() => {})
  }

  // Create a LOCKED deal so "off"/"fechado" work on this rate
  const configResult = await getSpreadConfig(groupId)
  const side = configResult.ok ? configResult.data.defaultSide ?? 'client_buys_usdt' : 'client_buys_usdt'
  const ttlSeconds = configResult.ok ? configResult.data.quoteTtlSeconds ?? 180 : 180

  const dealResult = await createDeal({
    groupJid: groupId,
    clientJid: sender,
    side,
    quotedRate: rate,
    baseRate: activeQuote.basePrice,
    ttlSeconds,
    spreadConfig: configResult.ok ? configResult.data : undefined,
    amountUsdt: amount,
    amountBrl: comp.data.amountBrl,
    metadata: {
      senderName: context.senderName ?? null,
      originalMessage: message.substring(0, 200),
      flow: 'calculator_lock',
    },
  })

  let dealId: string | undefined
  if (dealResult.ok) {
    dealId = dealResult.data.id
    await lockDeal(dealId, groupId, {
      lockedRate: rate,
      amountUsdt: amount,
      amountBrl: comp.data.amountBrl,
    })
  }

  return completeLockAndNotify({
    dealId,
    groupId,
    sender,
    rate,
    amountUsdt: amount,
    amountBrl: comp.data.amountBrl,
    context,
    logEvent: 'deal_direct_amount_calc',
  })
}

// ============================================================================
// Unrecognized Input Feedback (Issue 5)
// ============================================================================

/**
 * Handle unrecognized input during deal flow.
 *
 * Two paths:
 * 1. No Supabase deal + active quote (Phase 3): classify message for observability,
 *    tag operator so client isn't left hanging. Covers "melhorar?", "consegue melhor?", etc.
 * 2. Active deal in simple mode: send contextual feedback based on deal state
 *    (awaiting_amount prompt, quoted/locked operator tag).
 */
async function handleUnrecognizedInput(
  context: RouterContext
): Promise<Result<DealHandlerResult>> {
  const { groupId, sender } = context

  const existingResult = await findClientDeal(groupId, sender)
  if (!existingResult.ok || !existingResult.data) {
    // No Supabase deal (or DB failure) — check for active quote (Phase 3)
    // On DB failure we still try to tag operator; safer than silence.
    const activeQuote = getActiveQuote(groupId)
    if (activeQuote && (activeQuote.status === 'pending' || activeQuote.status === 'repricing')) {
      // Classify message for observability (rules first, then AI if ambiguous)
      let classification: EnhancedClassificationResult | null = null
      try {
        classification = await classifyOTCMessage({
          message: context.message,
          groupId,
          senderJid: sender,
          isFromBot: false,
          hasReceipt: false,
          hasTronscan: false,
          hasPriceTrigger: false,
          inActiveThread: true,
        })
      } catch (e) {
        logger.warn('Classification failed during active quote unrecognized input', {
          event: 'active_quote_classification_error',
          groupId,
          sender,
          error: e instanceof Error ? e.message : String(e),
        })
      }

      logger.info('Unrecognized input during active quote — tagging operator', {
        event: 'active_quote_unrecognized_operator_tag',
        groupId,
        sender,
        quoteId: activeQuote.id,
        messageType: classification?.messageType ?? 'unknown',
        confidence: classification?.confidence ?? 'unknown',
        aiUsed: classification?.aiUsed ?? false,
        source: classification?.source ?? 'none',
      })

      // Tag operator so client isn't left hanging
      const operatorJid = resolveOperatorJid(groupId)
      const operatorTagged = !!operatorJid
      if (operatorJid) {
        const mention = formatMention(operatorJid)
        await sendDealMessage(context, mention.textSegment, 'deal_state_hint', [mention.jid])
      }

      return ok({
        action: 'no_action',
        groupId,
        clientJid: sender,
        message: `Unrecognized input during active quote, operator ${operatorTagged ? 'tagged' : 'not configured'} (classified: ${classification?.messageType ?? 'unknown'})`,
      })
    }

    return ok({ action: 'no_action', groupId, clientJid: sender, message: 'No active deal' })
  }

  const deal = existingResult.data

  if (deal.state === 'awaiting_amount') {
    const configResult = await getSpreadConfig(groupId)
    const language = configResult.ok ? configResult.data.groupLanguage : 'pt'
    const rate = deal.lockedRate ?? deal.quotedRate
    const msg = language === 'en'
      ? `Send the USDT amount (e.g., 500, 10k) or "cancel". Rate: ${formatRate(rate)}.`
      : `Envie o valor em USDT (ex: 500, 10k) ou "cancela". Taxa: ${formatRate(rate)}.`
    await sendDealMessage(context, msg, 'deal_awaiting_amount')

    return ok({
      action: 'no_action',
      dealId: deal.id,
      groupId,
      clientJid: sender,
      message: 'Sent awaiting_amount feedback for unrecognized input',
    })
  }

  // For quoted/locked states: tag the operator so the client isn't left hanging
  // This covers negotiation attempts ("consegue melhor?"), questions, etc.
  if (deal.state === 'quoted' || deal.state === 'locked') {
    const operatorJid = resolveOperatorJid(groupId)
    if (operatorJid) {
      const mention = formatMention(operatorJid)
      await sendDealMessage(context, mention.textSegment, 'deal_state_hint', [mention.jid])
    }

    logger.info('Unrecognized input during active deal, operator tagged', {
      event: 'deal_unrecognized_operator_tag',
      dealState: deal.state,
      dealId: deal.id,
      groupId,
      sender,
    })

    return ok({
      action: 'no_action',
      dealId: deal.id,
      groupId,
      clientJid: sender,
      message: 'Unrecognized input, operator tagged',
    })
  }

  // For other states, no feedback needed — fall through silently
  return ok({ action: 'no_action', groupId, clientJid: sender, message: 'Unrecognized input, no feedback needed' })
}

// ============================================================================
// Sprint 9.1: Excel Logging Helper
// ============================================================================

/**
 * Log a completed deal to the Excel spreadsheet (fire-and-forget).
 */
function logDealToExcel(params: {
  groupId: string
  groupName: string
  clientIdentifier: string
  volumeBrl: number
  quote: number
  acquiredUsdt: number
}): void {
  const entry: LogEntry = {
    timestamp: new Date(),
    groupName: params.groupName,
    groupId: params.groupId,
    clientIdentifier: params.clientIdentifier,
    volumeBrl: params.volumeBrl,
    quote: params.quote,
    acquiredUsdt: params.acquiredUsdt,
    onchainTx: null,
  }

  logPriceQuote(entry).catch((e) => {
    logger.warn('Failed to log deal to Excel', {
      event: 'deal_excel_log_failed',
      groupId: params.groupId,
      error: e instanceof Error ? e.message : String(e),
    })
  })
}

// ============================================================================
// TTL Sweep & Notifications
// ============================================================================

/** Sweep interval: 30 seconds */
const SWEEP_INTERVAL_MS = 30_000

/** Timer reference for cleanup */
let sweepTimer: ReturnType<typeof setInterval> | null = null

/**
 * Run the deal expiration sweep.
 * Returns the number of deals expired.
 */
export async function runDealSweep(): Promise<Result<ExpiredDealInfo[]>> {
  return sweepExpiredDeals()
}

/**
 * Sprint 9: Run the awaiting_amount re-prompt sweep.
 * Sends reminders for deals waiting too long, and expires deals past 2× timeout.
 */
async function runRepromptSweep(): Promise<void> {
  const repromptResult = await getDealsNeedingReprompt()
  if (!repromptResult.ok) return

  const { needsReprompt, needsExpiry } = repromptResult.data
  const sock = getSocket()

  // Process re-prompts
  for (const deal of needsReprompt) {
    const configResult = await getSpreadConfig(deal.groupJid)
    const timeout = configResult.ok ? configResult.data.amountTimeoutSeconds : 60
    const language = configResult.ok ? configResult.data.groupLanguage : 'pt'

    const lockedAt = deal.lockedAt ?? new Date()
    const ageSeconds = (Date.now() - lockedAt.getTime()) / 1000

    if (ageSeconds < timeout) continue // Not old enough yet

    // Send re-prompt message
    const rate = deal.lockedRate ?? deal.quotedRate
    const promptMsg = language === 'en'
      ? `Waiting for USDT amount... Rate locked at ${formatRate(rate)}.`
      : `Aguardando valor em USDT... Taxa travada em ${formatRate(rate)}.`

    if (sock) {
      await sendWithAntiDetection(sock, deal.groupJid, promptMsg)
      logBotMessage({ groupJid: deal.groupJid, content: promptMsg, messageType: 'deal_awaiting_amount', isControlGroup: false })
      recordMessageSent(deal.groupJid)
    }

    await markReprompted(deal.id)

    logger.info('Awaiting amount re-prompt sent', {
      event: 'deal_reprompt_sent',
      dealId: deal.id,
      groupJid: deal.groupJid,
      ageSeconds: Math.round(ageSeconds),
    })
  }

  // Process expiries (already reprompted, now past 2× timeout)
  for (const deal of needsExpiry) {
    const configResult = await getSpreadConfig(deal.groupJid)
    const timeout = configResult.ok ? configResult.data.amountTimeoutSeconds : 60

    const lockedAt = deal.lockedAt ?? new Date()
    const ageSeconds = (Date.now() - lockedAt.getTime()) / 1000

    if (ageSeconds < timeout * 2) continue // Not old enough for expiry yet

    const expireResult = await expireDeal(deal.id, deal.groupJid)
    if (expireResult.ok && sock) {
      await sendWithAntiDetection(sock, deal.groupJid, buildExpirationMessage())
      logBotMessage({ groupJid: deal.groupJid, content: buildExpirationMessage(), messageType: 'deal_expired', isControlGroup: false })
      recordMessageSent(deal.groupJid)
    }

    logger.info('Awaiting amount deal expired after 2× timeout', {
      event: 'deal_awaiting_expired',
      dealId: deal.id,
      groupJid: deal.groupJid,
      ageSeconds: Math.round(ageSeconds),
    })
  }
}

/**
 * Start the periodic deal sweep timer.
 * M4 Fix: Ensures deals expire automatically without manual dashboard action.
 * Sprint 9: Also runs awaiting_amount re-prompt sweep.
 * Call this once during bot initialization.
 */
export function startDealSweepTimer(): void {
  if (sweepTimer) return // Already running

  sweepTimer = setInterval(async () => {
    try {
      const result = await sweepExpiredDeals()
      if (result.ok && result.data.length > 0) {
        logger.info('Periodic deal sweep expired deals', {
          event: 'deal_sweep_periodic',
          expired: result.data.length,
        })

        // Send "off" notification for quoted deals that expired
        const sock = getSocket()
        if (sock) {
          for (const expired of result.data) {
            if (expired.state === 'quoted') {
              const operatorJid = resolveOperatorJid(expired.groupJid)
              const mentions = operatorJid ? [operatorJid] : []
              const offMsg = operatorJid ? `off @${operatorJid.replace(/@.*/, '')}` : 'off'
              await sendWithAntiDetection(sock, expired.groupJid, offMsg, mentions)
              logBotMessage({ groupJid: expired.groupJid, content: offMsg, messageType: 'deal_expired', isControlGroup: false })
              recordMessageSent(expired.groupJid)
              // Clear active quote for this group
              forceAccept(expired.groupJid)

              logger.info('Sent expiry "off" notification', {
                event: 'deal_expiry_off_sent',
                dealId: expired.id,
                groupJid: expired.groupJid,
                state: expired.state,
                operatorMentioned: !!operatorJid,
              })
            }
          }
        }
      }
    } catch (e) {
      logger.error('Periodic deal sweep failed', {
        event: 'deal_sweep_periodic_error',
        error: e instanceof Error ? e.message : String(e),
      })
    }

    // Sprint 9: Run re-prompt sweep
    try {
      await runRepromptSweep()
    } catch (e) {
      logger.error('Re-prompt sweep failed', {
        event: 'deal_reprompt_sweep_error',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }, SWEEP_INTERVAL_MS)

  logger.info('Deal sweep timer started', {
    event: 'deal_sweep_timer_started',
    intervalMs: SWEEP_INTERVAL_MS,
  })
}

/**
 * Stop the periodic deal sweep timer.
 * Call this during graceful shutdown.
 */
export function stopDealSweepTimer(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
    logger.info('Deal sweep timer stopped', { event: 'deal_sweep_timer_stopped' })
  }
}

