/**
 * Action Executor - Executes trigger actions with rule context
 * Sprint 3: Group Triggers
 *
 * Executes the action defined by a trigger, using the active rule's
 * pricing configuration when applicable.
 *
 * Action types:
 * - price_quote: Rule-aware price quote (pricing source + spread from rule)
 * - volume_quote: Rule-aware volume calculation (extracts amount, applies rule pricing)
 * - text_response: Static text response (rule-agnostic)
 * - ai_prompt: AI-generated response with optional rule context
 */
import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'
import { fetchPrice } from './binance.js'
import { fetchCommercialDollar } from './awesomeapi.js'
import { formatBrazilianPrice } from '../utils/format.js'
import { extractVolumeBrl } from '../utils/triggers.js'
import {
  calculateQuote,
  calculateBothQuotes,
  getSpreadConfig,
  type SpreadConfig,
  type SpreadMode,
} from './groupSpreadService.js'
import type { GroupTrigger, TriggerActionType } from './triggerService.js'
import type { GroupRule } from './ruleService.js'

// ============================================================================
// Types
// ============================================================================

/** Result of executing a trigger action */
export interface ActionResult {
  /** The response message to send */
  message: string
  /** The action type that was executed */
  actionType: TriggerActionType
  /** Whether the action used rule context */
  ruleApplied: boolean
  /** Name of the rule that was applied, if any */
  ruleName?: string
  /** Additional metadata about the execution */
  metadata: Record<string, unknown>
}

/** Context for action execution */
export interface ActionContext {
  /** The incoming message text */
  message: string
  /** The group JID */
  groupJid: string
  /** The sender's name (for personalized responses) */
  senderName?: string
}

// ============================================================================
// Shared: Fetch base rate from pricing source
// ============================================================================

/**
 * Fetch the base exchange rate from the configured pricing source.
 * Falls back to Binance if commercial dollar API is unavailable.
 */
async function fetchBaseRate(
  pricingSource: string,
  groupJid: string
): Promise<Result<number>> {
  if (pricingSource === 'commercial_dollar') {
    const commercialResult = await fetchCommercialDollar()
    if (!commercialResult.ok) {
      logger.warn('Commercial dollar unavailable, falling back to Binance', {
        event: 'commercial_dollar_fallback',
        groupJid,
        error: commercialResult.error,
      })
      const binanceResult = await fetchPrice()
      if (!binanceResult.ok) {
        return err(`Price unavailable: ${binanceResult.error}`)
      }
      return ok(binanceResult.data)
    }
    return ok(commercialResult.data.ask)
  }

  const priceResult = await fetchPrice()
  if (!priceResult.ok) {
    return err(`Price unavailable: ${priceResult.error}`)
  }
  return ok(priceResult.data)
}

// ============================================================================
// Price Quote Action
// ============================================================================

/**
 * Execute a price_quote action.
 * Fetches the current rate and applies the active rule's pricing config.
 *
 * If a rule is active:
 * - Uses the rule's pricing source (commercial_dollar or usdt_binance)
 * - Applies the rule's spread configuration
 *
 * If no rule is active:
 * - Falls back to group_spreads default, or system default (usdt_binance, no spread)
 */
async function executePriceQuote(
  trigger: GroupTrigger,
  activeRule: GroupRule | null,
  context: ActionContext
): Promise<Result<ActionResult>> {
  // Build spread config from rule or fallback
  let spreadConfig: SpreadConfig | null = null
  let ruleApplied = false
  let ruleName: string | undefined

  if (activeRule) {
    // Use active rule's pricing configuration
    spreadConfig = {
      groupJid: context.groupJid,
      spreadMode: activeRule.spreadMode as SpreadMode,
      sellSpread: activeRule.sellSpread,
      buySpread: activeRule.buySpread,
      quoteTtlSeconds: 60,
      defaultSide: 'client_buys_usdt',
      defaultCurrency: 'BRL',
      language: 'pt-BR',
      createdAt: activeRule.createdAt,
      updatedAt: activeRule.updatedAt,
    }
    ruleApplied = true
    ruleName = activeRule.name
  } else {
    // Fallback to group_spreads default
    const spreadResult = await getSpreadConfig(context.groupJid)
    if (spreadResult.ok) {
      spreadConfig = spreadResult.data
    }
  }

  // Fetch price based on pricing source
  const pricingSource = activeRule?.pricingSource || 'usdt_binance'
  const rateResult = await fetchBaseRate(pricingSource, context.groupJid)
  if (!rateResult.ok) return rateResult as Result<ActionResult>
  const baseRate = rateResult.data

  // Apply spread if we have config
  let message: string
  const metadata: Record<string, unknown> = {
    baseRate,
    pricingSource,
  }

  if (spreadConfig && (spreadConfig.sellSpread !== 0 || spreadConfig.buySpread !== 0)) {
    const { buyRate, sellRate } = calculateBothQuotes(baseRate, spreadConfig)
    message = `Compra: ${formatBrazilianPrice(buyRate)} | Venda: ${formatBrazilianPrice(sellRate)}`
    metadata.buyRate = buyRate
    metadata.sellRate = sellRate
    metadata.spreadMode = spreadConfig.spreadMode
    metadata.sellSpread = spreadConfig.sellSpread
    metadata.buySpread = spreadConfig.buySpread
  } else {
    message = `USDT/BRL: ${formatBrazilianPrice(baseRate)}`
    metadata.rate = baseRate
  }

  // Add optional prefix from action params
  const prefix = trigger.actionParams?.prefix
  if (typeof prefix === 'string' && prefix.length > 0) {
    message = `${prefix} ${message}`
  }

  logger.info('Price quote action executed', {
    event: 'action_price_quote',
    groupJid: context.groupJid,
    ruleApplied,
    ruleName,
    baseRate,
  })

  return ok({
    message,
    actionType: 'price_quote',
    ruleApplied,
    ruleName,
    metadata,
  })
}

// ============================================================================
// Volume Quote Action
// ============================================================================

/**
 * Execute a volume_quote action.
 * Extracts the amount from the message, fetches the rate, and calculates the total.
 */
async function executeVolumeQuote(
  trigger: GroupTrigger,
  activeRule: GroupRule | null,
  context: ActionContext
): Promise<Result<ActionResult>> {
  // Extract volume from message
  const volumeBrl = extractVolumeBrl(context.message)

  if (!volumeBrl) {
    // No volume found - fall back to a simple price quote
    return executePriceQuote(trigger, activeRule, context)
  }

  // Build spread config from rule or fallback
  let spreadConfig: SpreadConfig | null = null
  let ruleApplied = false
  let ruleName: string | undefined

  if (activeRule) {
    spreadConfig = {
      groupJid: context.groupJid,
      spreadMode: activeRule.spreadMode as SpreadMode,
      sellSpread: activeRule.sellSpread,
      buySpread: activeRule.buySpread,
      quoteTtlSeconds: 60,
      defaultSide: 'client_buys_usdt',
      defaultCurrency: 'BRL',
      language: 'pt-BR',
      createdAt: activeRule.createdAt,
      updatedAt: activeRule.updatedAt,
    }
    ruleApplied = true
    ruleName = activeRule.name
  } else {
    const spreadResult = await getSpreadConfig(context.groupJid)
    if (spreadResult.ok) {
      spreadConfig = spreadResult.data
    }
  }

  // Fetch price based on pricing source
  const pricingSource = activeRule?.pricingSource || 'usdt_binance'
  const rateResult = await fetchBaseRate(pricingSource, context.groupJid)
  if (!rateResult.ok) return rateResult as Result<ActionResult>
  const baseRate = rateResult.data

  // Calculate with spread
  let effectiveRate = baseRate
  if (spreadConfig) {
    // For volume quotes, assume client is buying USDT (most common)
    effectiveRate = calculateQuote(baseRate, spreadConfig, 'client_buys_usdt')
  }

  // Guard against division by zero or negative rates
  if (effectiveRate <= 0) {
    return err(`Invalid effective rate: ${effectiveRate}. Check spread configuration.`)
  }

  // Calculate USDT amount
  const usdtAmount = volumeBrl / effectiveRate

  // Format response
  const formattedBrl = volumeBrl.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const formattedUsdt = usdtAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const formattedRate = formatBrazilianPrice(effectiveRate)

  const message = `R$ ${formattedBrl} ÷ ${formattedRate} = ${formattedUsdt} USDT`

  const metadata: Record<string, unknown> = {
    volumeBrl,
    usdtAmount,
    effectiveRate,
    baseRate,
    pricingSource,
  }

  if (spreadConfig) {
    metadata.spreadMode = spreadConfig.spreadMode
    metadata.sellSpread = spreadConfig.sellSpread
    metadata.buySpread = spreadConfig.buySpread
  }

  logger.info('Volume quote action executed', {
    event: 'action_volume_quote',
    groupJid: context.groupJid,
    volumeBrl,
    usdtAmount,
    effectiveRate,
    ruleApplied,
    ruleName,
  })

  return ok({
    message,
    actionType: 'volume_quote',
    ruleApplied,
    ruleName,
    metadata,
  })
}

// ============================================================================
// Text Response Action
// ============================================================================

/**
 * Execute a text_response action.
 * Returns the static text from actionParams. Rule-agnostic.
 */
function executeTextResponse(
  trigger: GroupTrigger,
  _activeRule: GroupRule | null,
  _context: ActionContext
): Result<ActionResult> {
  const text = trigger.actionParams?.text

  if (!text || typeof text !== 'string') {
    return err('text_response trigger has no "text" in actionParams')
  }

  logger.info('Text response action executed', {
    event: 'action_text_response',
    triggerId: trigger.id,
    groupJid: trigger.groupJid,
  })

  return ok({
    message: text,
    actionType: 'text_response',
    ruleApplied: false,
    metadata: {},
  })
}

// ============================================================================
// AI Prompt Action
// ============================================================================

/**
 * Execute an ai_prompt action.
 * Returns the prompt configuration for the AI to process.
 * Actual AI calling is handled by the caller (router/handler).
 */
function executeAiPrompt(
  trigger: GroupTrigger,
  activeRule: GroupRule | null,
  context: ActionContext
): Result<ActionResult> {
  const prompt = trigger.actionParams?.prompt

  if (!prompt || typeof prompt !== 'string') {
    return err('ai_prompt trigger has no "prompt" in actionParams')
  }

  const aiContext = typeof trigger.actionParams?.context === 'string' ? trigger.actionParams.context : undefined

  // Build rule context for AI if rule is active
  let ruleContext = ''
  if (activeRule) {
    ruleContext = `Active pricing rule: "${activeRule.name}". ` +
      `Source: ${activeRule.pricingSource}, ` +
      `Spread: ${activeRule.spreadMode} (sell: ${activeRule.sellSpread}, buy: ${activeRule.buySpread}).`
  }

  const fullPrompt = [prompt, aiContext, ruleContext].filter(Boolean).join('\n\n')

  logger.info('AI prompt action prepared', {
    event: 'action_ai_prompt',
    triggerId: trigger.id,
    groupJid: trigger.groupJid,
    hasRuleContext: !!activeRule,
    ruleName: activeRule?.name,
  })

  return ok({
    message: fullPrompt,
    actionType: 'ai_prompt',
    ruleApplied: !!activeRule,
    ruleName: activeRule?.name,
    metadata: {
      prompt,
      context: aiContext,
      ruleContext: ruleContext || undefined,
      senderName: context.senderName,
      isAiPrompt: true,
    },
  })
}

// ============================================================================
// Deal Flow / Handler Delegation Actions (Sprint 7B)
// ============================================================================

/**
 * Handler-delegation actions return a signal message prefixed with __DELEGATE__
 * so the router knows to forward to the appropriate handler instead of
 * sending the message directly to WhatsApp.
 *
 * These actions don't generate user-facing responses — the actual handlers
 * (deal handler, tronscan handler, receipt handler) do that.
 */

type DelegationAction = 'deal_lock' | 'deal_cancel' | 'deal_confirm' | 'deal_volume' | 'tronscan_process' | 'receipt_process' | 'control_command'

/** Map action type to the RouteDestination the router should delegate to */
const DELEGATION_MAP: Record<DelegationAction, string> = {
  deal_lock: 'DEAL_HANDLER',
  deal_cancel: 'DEAL_HANDLER',
  deal_confirm: 'DEAL_HANDLER',
  deal_volume: 'DEAL_HANDLER',
  tronscan_process: 'TRONSCAN_HANDLER',
  receipt_process: 'RECEIPT_HANDLER',
  control_command: 'CONTROL_HANDLER',
}

function executeDelegation(
  trigger: GroupTrigger,
  _activeRule: GroupRule | null,
  context: ActionContext
): Result<ActionResult> {
  const actionType = trigger.actionType as DelegationAction
  const handler = DELEGATION_MAP[actionType]

  if (!handler) {
    return err(`No delegation handler for action type: ${actionType}`)
  }

  logger.info('Delegation action prepared', {
    event: `action_${actionType}`,
    triggerId: trigger.id,
    groupJid: context.groupJid,
    delegateTo: handler,
  })

  return ok({
    message: `__DELEGATE__:${handler}`,
    actionType: trigger.actionType,
    ruleApplied: false,
    metadata: {
      isDelegation: true,
      delegateTo: handler,
      actionType,
    },
  })
}

// ============================================================================
// Main Executor
// ============================================================================

/**
 * Execute a trigger's action with the active rule's context.
 *
 * @param trigger - The matched trigger
 * @param activeRule - The currently active time-based rule (from Sprint 2), or null
 * @param context - The message context (message text, group JID, etc.)
 * @returns The action result with the response message
 */
export async function executeAction(
  trigger: GroupTrigger,
  activeRule: GroupRule | null,
  context: ActionContext
): Promise<Result<ActionResult>> {
  logger.debug('Executing action', {
    event: 'action_execute_start',
    triggerId: trigger.id,
    actionType: trigger.actionType,
    groupJid: context.groupJid,
    hasActiveRule: !!activeRule,
    ruleName: activeRule?.name,
  })

  try {
    switch (trigger.actionType) {
      case 'price_quote':
        return await executePriceQuote(trigger, activeRule, context)

      case 'volume_quote':
        return await executeVolumeQuote(trigger, activeRule, context)

      case 'text_response':
        return executeTextResponse(trigger, activeRule, context)

      case 'ai_prompt':
        return executeAiPrompt(trigger, activeRule, context)

      case 'deal_lock':
      case 'deal_cancel':
      case 'deal_confirm':
      case 'deal_volume':
      case 'tronscan_process':
      case 'receipt_process':
      case 'control_command':
        return executeDelegation(trigger, activeRule, context)

      default:
        return err(`Unknown action type: ${trigger.actionType}`)
    }
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Action execution failed', {
      event: 'action_execute_error',
      triggerId: trigger.id,
      actionType: trigger.actionType,
      groupJid: context.groupJid,
      error: errorMessage,
    })
    return err(`Action execution failed: ${errorMessage}`)
  }
}
