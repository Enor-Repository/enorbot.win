import type { WASocket, proto } from '@whiskeysockets/baileys'
import { isPriceTrigger, isPriceTriggerSync, hasTronscanLink } from '../utils/triggers.js'
import {
  type ReceiptType,
  RECEIPT_MIME_TYPES,
  SUPPORTED_IMAGE_MIME_TYPES,
} from '../types/handlers.js'
import { getGroupModeSync } from '../services/groupConfig.js'
import { matchTrigger, type GroupTrigger } from '../services/triggerService.js'
import { isPriceLockMessage, isConfirmationMessage, isDealCancellation, hasVolumeInfo } from '../handlers/deal.js'
import { logger } from '../utils/logger.js'

/**
 * Route destinations for message handling.
 * Story 6.1: Added RECEIPT_HANDLER for document/image processing
 * Training Mode: Added OBSERVE_ONLY for training/data collection mode
 * Tronscan: Added TRONSCAN_HANDLER for transaction link processing
 */
export type RouteDestination = 'CONTROL_HANDLER' | 'PRICE_HANDLER' | 'DEAL_HANDLER' | 'RECEIPT_HANDLER' | 'TRONSCAN_HANDLER' | 'OBSERVE_ONLY' | 'IGNORE'

/**
 * Raw Baileys message structure for document/image detection.
 * Story 6.1 - Used for receipt type detection
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
  /** WhatsApp socket for sending responses (Story 2.3) */
  sock: WASocket
  /** Story 6.1 - Whether this message contains a receipt (PDF/image) */
  isReceipt?: boolean
  /** Story 6.1 - Type of receipt detected */
  receiptType?: ReceiptType
  /** Story 6.1 - Raw Baileys message for media download */
  rawMessage?: proto.IWebMessageInfo
  /** Whether this message contains a Tronscan transaction link */
  hasTronscan?: boolean
  /** Matched trigger from triggerService (populated when a group trigger matches) */
  matchedTrigger?: GroupTrigger
  /** Sprint 4: Deal flow action type for DEAL_HANDLER routing */
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
 *
 * @param groupName - The name of the group to check
 * @param pattern - The pattern to match against (from CONTROL_GROUP_PATTERN)
 * @returns true if the group name contains the pattern
 */
export function isControlGroupMessage(groupName: string, pattern: string): boolean {
  return groupName.toLowerCase().includes(pattern.toLowerCase())
}

/**
 * Detect receipt type from a Baileys message.
 * Story 6.1 - AC1, AC2: Detect PDF and image receipts
 *
 * @param baileysMessage - The raw Baileys message content
 * @returns ReceiptType ('pdf', 'image', or null)
 */
export function detectReceiptType(baileysMessage: BaileysMessage | undefined): ReceiptType {
  if (!baileysMessage) {
    return null
  }

  // AC1: Check for PDF document
  const docMime = baileysMessage.documentMessage?.mimetype
  if (docMime === RECEIPT_MIME_TYPES.PDF) {
    return 'pdf'
  }

  // AC2: Check for supported image types
  const imageMime = baileysMessage.imageMessage?.mimetype
  if (imageMime && SUPPORTED_IMAGE_MIME_TYPES.has(imageMime as typeof RECEIPT_MIME_TYPES.JPEG)) {
    return 'image'
  }

  return null
}

/**
 * Route a message to the appropriate handler.
 * Pure function - no side effects, easy to test.
 *
 * Routing priority:
 * 1. Control group → Process normally (always, regardless of mode)
 * 2. Per-group mode check:
 *    - paused → IGNORE (no logging, no response)
 *    - learning → OBSERVE_ONLY (log but don't respond)
 *    - assisted → OBSERVE_ONLY (future: suggestion system)
 *    - active → Normal routing with group-specific triggers
 * 3. Price triggers (global keywords or group triggers) → PRICE_HANDLER
 * 4. Deal flow messages (cancel, lock, confirm, volume) → DEAL_HANDLER
 * 5. Tronscan links → TRONSCAN_HANDLER
 * 6. Receipt messages → RECEIPT_HANDLER
 * 7. Otherwise → IGNORE
 *
 * @param context - The router context with message metadata
 * @param baileysMessage - Optional raw Baileys message for receipt detection
 * @returns RouteResult with destination and context
 */
export async function routeMessage(
  context: RouterContext,
  baileysMessage?: BaileysMessage
): Promise<RouteResult> {
  // CPU-only checks run eagerly (no DB hit)
  const hasTronscan = hasTronscanLink(context.message)
  const receiptType = context.isControlGroup ? null : detectReceiptType(baileysMessage)
  const isReceipt = receiptType !== null

  const enrichedContext: RouterContext = {
    ...context,
    hasTrigger: false,
    hasTronscan,
    isReceipt,
    receiptType,
  }

  // Priority 1: Control group ALWAYS works (regardless of any mode)
  if (context.isControlGroup) {
    // DB calls only for control group messages
    const hasTrigger = await isPriceTrigger(context.message)
    enrichedContext.hasTrigger = hasTrigger

    // Match against group triggers (database-driven)
    let triggerMatch: GroupTrigger | null = null
    try {
      const result = await matchTrigger(context.message, context.groupId)
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
      enrichedContext.matchedTrigger = triggerMatch
    }

    // Price triggers in control group go to price handler (trigger-based OR global keyword fallback)
    if (triggerMatch || hasTrigger) {
      return { destination: 'PRICE_HANDLER', context: enrichedContext }
    }
    // Tronscan links in control group update Excel row
    if (hasTronscan) {
      return { destination: 'TRONSCAN_HANDLER', context: enrichedContext }
    }
    // Non-trigger messages (pause, resume, status, mode, etc.) go to control handler
    return { destination: 'CONTROL_HANDLER', context: enrichedContext }
  }

  // Priority 2: Check per-group mode (no DB call needed for non-active modes)
  const groupMode = getGroupModeSync(context.groupId)

  // PAUSED: Completely ignore (no logging, no response)
  if (groupMode === 'paused') {
    return { destination: 'IGNORE', context: enrichedContext }
  }

  // LEARNING/ASSISTED: Enrich context with trigger info for logging, but don't route
  if (groupMode === 'learning' || groupMode === 'assisted') {
    // Use sync cache check for context enrichment (no DB round-trip)
    enrichedContext.hasTrigger = isPriceTriggerSync(context.message)
    return { destination: 'OBSERVE_ONLY', context: enrichedContext }
  }

  // ACTIVE mode: DB calls for full routing
  const hasTrigger = await isPriceTrigger(context.message)
  enrichedContext.hasTrigger = hasTrigger

  let triggerMatch: GroupTrigger | null = null
  try {
    const result = await matchTrigger(context.message, context.groupId)
    if (result.ok) {
      triggerMatch = result.data
    }
  } catch (e) {
    logger.error('matchTrigger failed in active mode, falling back', {
      event: 'trigger_match_error',
      groupId: context.groupId,
      error: e instanceof Error ? e.message : String(e),
    })
    // Fallback: use only hasTrigger (global keyword patterns)
    if (hasTrigger) {
      return { destination: 'PRICE_HANDLER', context: enrichedContext }
    }
    if (hasTronscan) {
      return { destination: 'TRONSCAN_HANDLER', context: enrichedContext }
    }
    if (isReceipt) {
      return { destination: 'RECEIPT_HANDLER', context: enrichedContext }
    }
    return { destination: 'IGNORE', context: enrichedContext }
  }

  if (triggerMatch) {
    enrichedContext.matchedTrigger = triggerMatch
  }

  // Priority 3: Price triggers (global keyword or group-specific trigger) go to price handler
  if (hasTrigger || triggerMatch) {
    return { destination: 'PRICE_HANDLER', context: enrichedContext }
  }

  // Priority 4: Deal flow messages (Sprint 4)
  // Check for deal-related messages: cancellation, lock, confirmation, volume
  // These are now async — keywords loaded from DB via systemPatternService
  if (await isDealCancellation(context.message)) {
    enrichedContext.dealAction = 'cancellation'
    return { destination: 'DEAL_HANDLER', context: enrichedContext }
  }
  if (await isPriceLockMessage(context.message)) {
    enrichedContext.dealAction = 'price_lock'
    return { destination: 'DEAL_HANDLER', context: enrichedContext }
  }
  if (await isConfirmationMessage(context.message)) {
    enrichedContext.dealAction = 'confirmation'
    return { destination: 'DEAL_HANDLER', context: enrichedContext }
  }
  if (hasVolumeInfo(context.message)) {
    enrichedContext.dealAction = 'volume_inquiry'
    return { destination: 'DEAL_HANDLER', context: enrichedContext }
  }

  // Priority 5: Tronscan links go to tronscan handler (update Excel row)
  if (hasTronscan) {
    return { destination: 'TRONSCAN_HANDLER', context: enrichedContext }
  }

  // Priority 6: Receipt messages go to receipt handler
  if (isReceipt) {
    return { destination: 'RECEIPT_HANDLER', context: enrichedContext }
  }

  // No trigger - ignore message
  return { destination: 'IGNORE', context: enrichedContext }
}
