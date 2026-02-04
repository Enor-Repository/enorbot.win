import type { WASocket, proto } from '@whiskeysockets/baileys'
import {
  type ReceiptType,
  RECEIPT_MIME_TYPES,
  SUPPORTED_IMAGE_MIME_TYPES,
} from '../types/handlers.js'
import { getGroupModeSync } from '../services/groupConfig.js'
import { matchTrigger, type GroupTrigger } from '../services/triggerService.js'
import { logger } from '../utils/logger.js'

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
  dealAction?: 'volume_inquiry' | 'price_lock' | 'confirmation' | 'cancellation'
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

/**
 * Resolve a matched trigger to a route destination and enriched context.
 */
function resolveTriggeredRoute(
  trigger: GroupTrigger,
  enrichedContext: RouterContext
): RouteResult {
  enrichedContext.matchedTrigger = trigger
  enrichedContext.hasTrigger = true

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
 * Sprint 7B routing (unified trigger layer):
 * 1. Control group → always process (trigger match or control handler)
 * 2. Per-group mode → paused=IGNORE, learning/assisted=OBSERVE_ONLY
 * 3. Receipt detection (MIME-based) → RECEIPT_HANDLER
 * 4. Database triggers (system + user, priority-ordered) → mapped handler
 * 5. No match → IGNORE
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

  // Priority 3: Receipt messages (MIME-based, checked before keyword triggers)
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
