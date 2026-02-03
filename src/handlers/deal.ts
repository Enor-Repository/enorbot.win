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
import { sendWithAntiDetection } from '../utils/messaging.js'
import { logBotMessage } from '../services/messageHistory.js'
import { recordMessageSent } from '../bot/state.js'
import {
  findClientDeal,
  createDeal,
  lockDeal,
  startComputation,
  completeDeal,
  cancelDeal,
  sweepExpiredDeals,
  archiveDeal,
  type ActiveDeal,
  type CreateDealInput,
} from '../services/dealFlowService.js'
import type { BotMessageType } from '../services/messageHistory.js'
import {
  extractBrlAmount,
  extractUsdtAmount,
  computeBrlToUsdt,
  computeUsdtToBrl,
  formatBrl,
  formatUsdt,
  formatRate,
} from '../services/dealComputation.js'
import { fetchPrice } from '../services/binance.js'
import { getSpreadConfig, calculateQuote, type SpreadConfig } from '../services/groupSpreadService.js'
import { getActiveRule, type GroupRule } from '../services/ruleService.js'

// ============================================================================
// Types
// ============================================================================

/** Result returned by deal handler operations */
export interface DealHandlerResult {
  action: 'deal_quoted' | 'deal_locked' | 'deal_computed' | 'deal_cancelled' | 'no_action'
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

function buildQuoteMessage(deal: ActiveDeal, amountBrl: number | null, amountUsdt: number | null): string {
  const lines: string[] = []
  lines.push('📊 *Cotação*')
  lines.push('')
  lines.push(`Taxa: ${formatRate(deal.quotedRate)}`)

  if (amountBrl !== null && amountUsdt !== null) {
    lines.push(`${formatBrl(amountBrl)} → ${formatUsdt(amountUsdt)}`)
  }

  lines.push('')
  lines.push('Responda *trava* para travar essa taxa.')

  const ttlMinutes = Math.ceil((deal.ttlExpiresAt.getTime() - Date.now()) / 60000)
  if (ttlMinutes > 0) {
    lines.push(`⏱️ Válido por ${ttlMinutes} min.`)
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

  const ttlMinutes = Math.ceil((deal.ttlExpiresAt.getTime() - Date.now()) / 60000)
  if (ttlMinutes > 0) {
    lines.push(`⏱️ Válido por ${ttlMinutes} min.`)
  }

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
  messageType: BotMessageType
): Promise<Result<void>> {
  const result = await sendWithAntiDetection(context.sock, context.groupId, message)

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

  // Send quote message
  const quoteMsg = buildQuoteMessage(deal, computedBrl, computedUsdt)
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

  const deal = existingResult.data
  if (deal === null) {
    // No active deal — suggest creating one
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

  // Lock the deal
  const lockResult = await lockDeal(deal.id, groupId, {
    lockedRate: deal.quotedRate,
    amountBrl: amountBrl ?? undefined,
    amountUsdt: amountUsdt ?? undefined,
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

    const completedDeal = completeResult.data

    // Send completion message
    const completeMsg = buildCompletionMessage(completedDeal)
    await sendDealMessage(context, completeMsg, 'deal_completed')

    // Archive the deal (fire-and-forget)
    archiveDeal(deal.id, groupId).catch((e) => {
      logger.warn('Failed to archive deal', {
        event: 'deal_archive_failed',
        dealId: deal.id,
        error: e instanceof Error ? e.message : String(e),
      })
    })

    logger.info('Deal completed', {
      event: 'deal_completed',
      dealId: deal.id,
      groupId,
      sender,
      rate,
      amountBrl: finalBrl,
      amountUsdt: finalUsdt,
    })

    return ok({
      action: 'deal_computed',
      dealId: deal.id,
      groupId,
      clientJid: sender,
      message: completeMsg,
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
export async function runDealSweep(): Promise<Result<number>> {
  return sweepExpiredDeals()
}

/**
 * Start the periodic deal sweep timer.
 * M4 Fix: Ensures deals expire automatically without manual dashboard action.
 * Call this once during bot initialization.
 */
export function startDealSweepTimer(): void {
  if (sweepTimer) return // Already running

  sweepTimer = setInterval(async () => {
    try {
      const result = await sweepExpiredDeals()
      if (result.ok && result.data > 0) {
        logger.info('Periodic deal sweep expired deals', {
          event: 'deal_sweep_periodic',
          expired: result.data,
        })
      }
    } catch (e) {
      logger.error('Periodic deal sweep failed', {
        event: 'deal_sweep_periodic_error',
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

// ============================================================================
// Message Classification Bridge
// ============================================================================

/**
 * Check if a message is a deal cancellation request.
 */
export function isDealCancellation(message: string): boolean {
  const lower = message.toLowerCase().trim()
  return /\b(cancela|cancelar|cancel)\b/.test(lower)
}

/**
 * Check if a message is a price lock request.
 * Uses the same patterns as the message classifier's price_lock detection.
 */
export function isPriceLockMessage(message: string): boolean {
  const lower = message.toLowerCase().trim()
  return /\b(trava|lock|travar)\b/.test(lower)
}

/**
 * Check if a message is a deal confirmation.
 * Uses patterns matching the message classifier's confirmation detection.
 */
export function isConfirmationMessage(message: string): boolean {
  const lower = message.toLowerCase().trim()
  // H3 Fix: Removed "ok" and "vamos" — too broad, causes false positives in group chat.
  // "fechado" (deal closed) and "confirma" variants are specific to deal confirmation context.
  return /\b(fechado|fecha|fechar|confirma|confirmado|confirmed)\b/.test(lower)
}

/**
 * Check if a message contains volume/amount information
 * that could initiate a deal.
 */
export function hasVolumeInfo(message: string): boolean {
  const brl = extractBrlAmount(message)
  const usdt = extractUsdtAmount(message)
  return brl !== null || usdt !== null
}
