import type { WASocket, proto } from '@whiskeysockets/baileys'
import {
  type ReceiptType,
  RECEIPT_MIME_TYPES,
  SUPPORTED_IMAGE_MIME_TYPES,
} from '../types/handlers.js'
import { getGroupModeSync } from '../services/groupConfig.js'
import { matchTrigger, type GroupTrigger } from '../services/triggerService.js'
import { logger } from '../utils/logger.js'
// Volatility Protection: Close active quotes on deal acceptance
import { getActiveQuote, forceAccept } from '../services/activeQuotes.js'
// Sprint 9: Simple mode deal-state intercept
import { getActiveDealForSender } from '../services/dealFlowService.js'
import { getSpreadConfig } from '../services/groupSpreadService.js'
import { getKeywordsForPatternSync } from '../services/systemPatternService.js'
import { parseBrazilianNumber } from '../services/dealComputation.js'

/**
 * Route destinations for message handling.
 */
export type RouteDestination = 'CONTROL_HANDLER' | 'PRICE_HANDLER' | 'DEAL_HANDLER' | 'RECEIPT_HANDLER' | 'TRONSCAN_HANDLER' | 'OBSERVE_ONLY' | 'IGNORE'

/**
 * Raw Baileys message structure for document/image detection.
 */
export interface BaileysMessage {
  documentMessage?: {
    mimetype?: string
    fileName?: string
  }
  imageMessage?: {
    mimetype?: string
  }
}

/**
 * Context for routing decisions.
 * Contains all metadata needed to route a message.
 */
export interface RouterContext {
  groupId: string
  groupName: string
  message: string
  /** Sender's JID (phone number format) */
  sender: string
  /** Sender's WhatsApp display name (pushName), may be undefined */
  senderName?: string
  isControlGroup: boolean
  hasTrigger?: boolean
  /** WhatsApp socket for sending responses */
  sock: WASocket
  /** Whether this message contains a receipt (PDF/image) */
  isReceipt?: boolean
  /** Type of receipt detected */
  receiptType?: ReceiptType
  /** Raw Baileys message for media download */
  rawMessage?: proto.IWebMessageInfo
  /** Whether this message contains a Tronscan transaction link */
  hasTronscan?: boolean
  /** Matched trigger from triggerService (populated when a group trigger matches) */
  matchedTrigger?: GroupTrigger
  /** Deal flow action type for DEAL_HANDLER routing */
  dealAction?: 'volume_inquiry' | 'price_lock' | 'confirmation' | 'cancellation' | 'rejection' | 'volume_input' | 'direct_amount'
}

/**
 * Result of routing a message.
 */
export interface RouteResult {
  destination: RouteDestination
  context: RouterContext
}

/**
 * Check if a group name matches the control group pattern.
 * Case-insensitive matching.
 */
export function isControlGroupMessage(groupName: string, pattern: string): boolean {
  return groupName.toLowerCase().includes(pattern.toLowerCase())
}

/**
 * Detect receipt type from a Baileys message.
 * MIME-based detection stays in the router (not keyword-based).
 */
export function detectReceiptType(baileysMessage: BaileysMessage | undefined): ReceiptType {
  if (!baileysMessage) {
    return null
  }

  const docMime = baileysMessage.documentMessage?.mimetype
  if (docMime === RECEIPT_MIME_TYPES.PDF) {
    return 'pdf'
  }

  const imageMime = baileysMessage.imageMessage?.mimetype
  if (imageMime && SUPPORTED_IMAGE_MIME_TYPES.has(imageMime as typeof RECEIPT_MIME_TYPES.JPEG)) {
    return 'image'
  }

  return null
}

// ============================================================================
// Trigger → Route Destination mapping
// ============================================================================

/** Map action type to deal action for context enrichment */
const ACTION_TO_DEAL_ACTION: Record<string, RouterContext['dealAction']> = {
  deal_lock: 'price_lock',
  deal_cancel: 'cancellation',
  deal_confirm: 'confirmation',
  deal_volume: 'volume_inquiry',
}

/** Map action type to route destination */
const ACTION_TO_DESTINATION: Record<string, RouteDestination> = {
  deal_lock: 'DEAL_HANDLER',
  deal_cancel: 'DEAL_HANDLER',
  deal_confirm: 'DEAL_HANDLER',
  deal_volume: 'DEAL_HANDLER',
  tronscan_process: 'TRONSCAN_HANDLER',
  receipt_process: 'RECEIPT_HANDLER',
  control_command: 'CONTROL_HANDLER',
}

// ============================================================================
// Sprint 9: Simple Mode Deal-State Intercept
// ============================================================================

/** Additional lock keywords always included beyond system_patterns.price_lock */
const EXTRA_LOCK_KEYWORDS = ['ok', 'fecha']

/** Off keywords that trigger rejection */
const OFF_KEYWORDS = ['off']

/** Cancel keywords for awaiting_amount state */
const CANCEL_KEYWORDS_SYNC = () => getKeywordsForPatternSync('deal_cancellation')

/**
 * Check if a message matches any keyword in a list (case-insensitive, whole-word).
 * Uses word-boundary matching to avoid false positives.
 */
function matchesKeyword(message: string, keywords: string[]): boolean {
  const normalized = message.toLowerCase().trim()
  return keywords.some((kw) => {
    const kwLower = kw.toLowerCase()
    // Exact match or word-boundary match
    if (normalized === kwLower) return true
    // Check if keyword appears as a word boundary (not substring of another word)
    const regex = new RegExp(`\\b${kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    return regex.test(normalized)
  })
}

/**
 * Sprint 9: Attempt to intercept a message based on sender's active deal state.
 * ONLY runs for simple-mode groups. Classic mode completely skips this.
 *
 * Returns a RouteResult if intercepted, or null to fall through to normal routing.
 */
async function trySimpleModeIntercept(
  enrichedContext: RouterContext
): Promise<RouteResult | null> {
  // 1. Check if group is in simple mode
  const configResult = await getSpreadConfig(enrichedContext.groupId)
  if (!configResult.ok || configResult.data.dealFlowMode !== 'simple') {
    return null // Not simple mode → skip intercept entirely
  }

  // 2. Check if sender has an active deal
  const dealResult = await getActiveDealForSender(enrichedContext.groupId, enrichedContext.sender)
  if (!dealResult.ok || !dealResult.data) {
    // No active deal — check if there's an active quote and message is a bare USDT amount
    // Sprint 9.1: This bridges the price response → deal handler flow
    const activeQuote = getActiveQuote(enrichedContext.groupId)
    if (activeQuote && activeQuote.status === 'pending') {
      const parsed = parseBrazilianNumber(enrichedContext.message.trim())
      if (parsed !== null && parsed >= 100) {
        logger.info('Simple mode intercept: direct_amount (active quote, no deal)', {
          event: 'simple_mode_intercept',
          action: 'direct_amount',
          groupId: enrichedContext.groupId,
          sender: enrichedContext.sender,
          parsedAmount: parsed,
          quoteId: activeQuote.id,
        })
        return {
          destination: 'DEAL_HANDLER',
          context: { ...enrichedContext, dealAction: 'direct_amount' },
        }
      }
    }
    return null // No active deal and no matching quote → fall through to normal routing
  }

  const deal = dealResult.data
  const message = enrichedContext.message

  // 3. Route based on deal state
  if (deal.state === 'quoted') {
    // QUOTED + "off" → rejection
    if (matchesKeyword(message, OFF_KEYWORDS)) {
      logger.info('Simple mode intercept: rejection (off)', {
        event: 'simple_mode_intercept',
        action: 'rejection',
        groupId: enrichedContext.groupId,
        sender: enrichedContext.sender,
        dealId: deal.id,
      })
      return {
        destination: 'DEAL_HANDLER',
        context: { ...enrichedContext, dealAction: 'rejection' },
      }
    }

    // QUOTED + lock keyword → price_lock
    const lockKeywords = [...getKeywordsForPatternSync('price_lock'), ...EXTRA_LOCK_KEYWORDS]
    if (matchesKeyword(message, lockKeywords)) {
      logger.info('Simple mode intercept: price_lock', {
        event: 'simple_mode_intercept',
        action: 'price_lock',
        groupId: enrichedContext.groupId,
        sender: enrichedContext.sender,
        dealId: deal.id,
      })
      return {
        destination: 'DEAL_HANDLER',
        context: { ...enrichedContext, dealAction: 'price_lock' },
      }
    }
  }

  if (deal.state === 'awaiting_amount') {
    // AWAITING_AMOUNT + cancel keyword → cancellation
    if (matchesKeyword(message, CANCEL_KEYWORDS_SYNC())) {
      logger.info('Simple mode intercept: cancellation (awaiting_amount)', {
        event: 'simple_mode_intercept',
        action: 'cancellation',
        groupId: enrichedContext.groupId,
        sender: enrichedContext.sender,
        dealId: deal.id,
      })
      return {
        destination: 'DEAL_HANDLER',
        context: { ...enrichedContext, dealAction: 'cancellation' },
      }
    }

    // AWAITING_AMOUNT + number → volume_input
    const parsed = parseBrazilianNumber(message.trim())
    if (parsed !== null && parsed > 0) {
      logger.info('Simple mode intercept: volume_input', {
        event: 'simple_mode_intercept',
        action: 'volume_input',
        groupId: enrichedContext.groupId,
        sender: enrichedContext.sender,
        dealId: deal.id,
        parsedAmount: parsed,
      })
      return {
        destination: 'DEAL_HANDLER',
        context: { ...enrichedContext, dealAction: 'volume_input' },
      }
    }
  }

  // No intercept matched → fall through to normal routing
  return null
}

/**
 * Resolve a matched trigger to a route destination and enriched context.
 */
function resolveTriggeredRoute(
  trigger: GroupTrigger,
  enrichedContext: RouterContext
): RouteResult {
  enrichedContext.matchedTrigger = trigger
  enrichedContext.hasTrigger = true

  // Volatility Protection: Check for deal acceptance (confirmation trigger)
  // If there's an active simple quote (not full deal flow), close it
  // CRITICAL: Accept even during 'repricing' status - customer acceptance ALWAYS wins
  if (trigger.actionType === 'deal_confirm') {
    const activeQuote = getActiveQuote(enrichedContext.groupId)
    if (activeQuote && (activeQuote.status === 'pending' || activeQuote.status === 'repricing')) {
      forceAccept(enrichedContext.groupId)
      logger.info('Active quote accepted via confirmation trigger', {
        event: 'quote_accepted_via_trigger',
        groupId: enrichedContext.groupId,
        quoteId: activeQuote.id,
        quotedPrice: activeQuote.quotedPrice,
        wasRepricing: activeQuote.status === 'repricing',
      })
    }
  }

  // Delegation actions: route to the appropriate handler
  const destination = ACTION_TO_DESTINATION[trigger.actionType]
  if (destination) {
    const dealAction = ACTION_TO_DEAL_ACTION[trigger.actionType]
    if (dealAction) {
      enrichedContext.dealAction = dealAction
    }
    return { destination, context: enrichedContext }
  }

  // All other action types (price_quote, volume_quote, text_response, ai_prompt)
  // go to PRICE_HANDLER which executes via actionExecutor
  return { destination: 'PRICE_HANDLER', context: enrichedContext }
}

/**
 * Route a message to the appropriate handler.
 *
 * Sprint 9 routing (with simple mode intercept):
 * 1. Control group → always process (trigger match or control handler)
 * 2. Per-group mode → paused=IGNORE, learning/assisted=OBSERVE_ONLY
 * 3. Simple mode deal-state intercept (Sprint 9) → DEAL_HANDLER if sender has active deal
 * 4. Receipt detection (MIME-based) → RECEIPT_HANDLER
 * 5. Database triggers (system + user, priority-ordered) → mapped handler
 * 6. No match → IGNORE
 */
export async function routeMessage(
  context: RouterContext,
  baileysMessage?: BaileysMessage
): Promise<RouteResult> {
  // MIME-based receipt detection (stays in router, not keyword-driven)
  const receiptType = context.isControlGroup ? null : detectReceiptType(baileysMessage)
  const isReceipt = receiptType !== null

  const enrichedContext: RouterContext = {
    ...context,
    hasTrigger: false,
    // hasTronscan not set here — tronscan detection is handled by database triggers
    // and the message classifier's own hasTronscanLink() call for observation logging
    isReceipt,
    receiptType,
  }

  // Priority 1: Control group ALWAYS works (regardless of any mode)
  if (context.isControlGroup) {
    let triggerMatch: GroupTrigger | null = null
    try {
      const result = await matchTrigger(context.message, context.groupId, true)
      if (result.ok) {
        triggerMatch = result.data
      }
    } catch (e) {
      logger.error('matchTrigger failed in control group, falling back', {
        event: 'trigger_match_error',
        groupId: context.groupId,
        error: e instanceof Error ? e.message : String(e),
      })
    }

    if (triggerMatch) {
      return resolveTriggeredRoute(triggerMatch, enrichedContext)
    }

    // Non-trigger messages (pause, resume, mode <group>, config, etc.) → control handler
    return { destination: 'CONTROL_HANDLER', context: enrichedContext }
  }

  // Priority 2: Check per-group mode
  const groupMode = getGroupModeSync(context.groupId)

  if (groupMode === 'paused') {
    return { destination: 'IGNORE', context: enrichedContext }
  }

  if (groupMode === 'learning' || groupMode === 'assisted') {
    return { destination: 'OBSERVE_ONLY', context: enrichedContext }
  }

  // ACTIVE mode: full routing through database triggers

  // Priority 3 (Sprint 9): Simple mode deal-state intercept
  // Runs BEFORE trigger matching so deal-state context takes priority
  // Classic mode: completely skipped (returns null instantly)
  try {
    const interceptResult = await trySimpleModeIntercept(enrichedContext)
    if (interceptResult) {
      return interceptResult
    }
  } catch (e) {
    logger.error('Simple mode intercept failed, falling through to normal routing', {
      event: 'simple_mode_intercept_error',
      groupId: context.groupId,
      sender: context.sender,
      error: e instanceof Error ? e.message : String(e),
    })
    // Fall through to normal routing on error — safe degradation
  }

  // Priority 4: Receipt messages (MIME-based, checked before keyword triggers)
  if (isReceipt) {
    return { destination: 'RECEIPT_HANDLER', context: enrichedContext }
  }

  // Priority 4: Database triggers — single source of truth
  // System triggers (deal flow, tronscan, price) are sorted by priority alongside user triggers
  let triggerMatch: GroupTrigger | null = null
  try {
    const result = await matchTrigger(context.message, context.groupId, false)
    if (result.ok) {
      triggerMatch = result.data
    }
  } catch (e) {
    logger.error('matchTrigger failed in active mode — routing to OBSERVE_ONLY for message preservation', {
      event: 'trigger_match_error',
      groupId: context.groupId,
      error: e instanceof Error ? e.message : String(e),
    })
    // OBSERVE_ONLY instead of IGNORE so the message is still logged for later replay
    return { destination: 'OBSERVE_ONLY', context: enrichedContext }
  }

  if (triggerMatch) {
    return resolveTriggeredRoute(triggerMatch, enrichedContext)
  }

  // No trigger matched
  return { destination: 'IGNORE', context: enrichedContext }
}
