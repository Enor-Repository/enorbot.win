import type { WASocket, proto } from '@whiskeysockets/baileys'
import { isPriceTrigger, hasTronscanLink } from '../utils/triggers.js'
import {
  type ReceiptType,
  RECEIPT_MIME_TYPES,
  SUPPORTED_IMAGE_MIME_TYPES,
} from '../types/handlers.js'
import { isTrainingMode } from './state.js'

/**
 * Route destinations for message handling.
 * Story 6.1: Added RECEIPT_HANDLER for document/image processing
 * Training Mode: Added OBSERVE_ONLY for training/data collection mode
 * Tronscan: Added TRONSCAN_HANDLER for transaction link processing
 */
export type RouteDestination = 'CONTROL_HANDLER' | 'PRICE_HANDLER' | 'RECEIPT_HANDLER' | 'TRONSCAN_HANDLER' | 'OBSERVE_ONLY' | 'IGNORE'

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
 * 1. Control group → Process normally (even in training mode)
 * 2. Training mode + non-control → OBSERVE_ONLY (log but don't respond)
 * 3. Price triggers → PRICE_HANDLER
 * 4. Receipt messages → RECEIPT_HANDLER
 * 5. Otherwise → IGNORE
 *
 * Training Mode: When enabled, non-control groups only log messages
 * without sending any responses. Control group works 100% normally.
 *
 * Story 6.1 - Added receipt detection and routing
 *
 * @param context - The router context with message metadata
 * @param baileysMessage - Optional raw Baileys message for receipt detection
 * @returns RouteResult with destination and context
 */
export function routeMessage(
  context: RouterContext,
  baileysMessage?: BaileysMessage
): RouteResult {
  // Check for price trigger - used for context enrichment
  const hasTrigger = isPriceTrigger(context.message)

  // Check for Tronscan transaction link
  const hasTronscan = hasTronscanLink(context.message)

  // Story 6.1 - Detect receipt type (only for non-control-group messages)
  const receiptType = context.isControlGroup ? null : detectReceiptType(baileysMessage)
  const isReceipt = receiptType !== null

  const enrichedContext: RouterContext = {
    ...context,
    hasTrigger,
    hasTronscan,
    isReceipt,
    receiptType,
  }

  // Priority 1: Control group works normally (even in training mode)
  if (context.isControlGroup) {
    // Price triggers in control group go to price handler
    if (hasTrigger) {
      return { destination: 'PRICE_HANDLER', context: enrichedContext }
    }
    // Non-trigger messages (pause, resume, status, training) go to control handler
    return { destination: 'CONTROL_HANDLER', context: enrichedContext }
  }

  // Priority 2: Training mode - observe only (log but don't respond)
  // Messages are logged in connection.ts before dispatch, so logging still works
  if (isTrainingMode()) {
    return { destination: 'OBSERVE_ONLY', context: enrichedContext }
  }

  // Priority 3: Price triggers go to price handler
  if (hasTrigger) {
    return { destination: 'PRICE_HANDLER', context: enrichedContext }
  }

  // Priority 4: Tronscan links go to tronscan handler (update Excel row)
  if (hasTronscan) {
    return { destination: 'TRONSCAN_HANDLER', context: enrichedContext }
  }

  // Priority 5: Receipt messages go to receipt handler
  if (isReceipt) {
    return { destination: 'RECEIPT_HANDLER', context: enrichedContext }
  }

  // No trigger - ignore message
  return { destination: 'IGNORE', context: enrichedContext }
}
