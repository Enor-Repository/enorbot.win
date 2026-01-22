import type { WASocket, proto } from '@whiskeysockets/baileys'
import { isPriceTrigger } from '../utils/triggers.js'
import {
  type ReceiptType,
  RECEIPT_MIME_TYPES,
  SUPPORTED_IMAGE_MIME_TYPES,
} from '../types/handlers.js'

/**
 * Route destinations for message handling.
 * Story 6.1: Added RECEIPT_HANDLER for document/image processing
 */
export type RouteDestination = 'CONTROL_HANDLER' | 'PRICE_HANDLER' | 'RECEIPT_HANDLER' | 'IGNORE'

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
  sender: string
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
  if (imageMime && SUPPORTED_IMAGE_MIME_TYPES.has(imageMime)) {
    return 'image'
  }

  return null
}

/**
 * Route a message to the appropriate handler.
 * Pure function - no side effects, easy to test.
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
  // Check for price trigger (used for logging even in control group)
  const hasTrigger = isPriceTrigger(context.message)

  // Story 6.1 - Detect receipt type (only for non-control-group messages)
  const receiptType = context.isControlGroup ? null : detectReceiptType(baileysMessage)
  const isReceipt = receiptType !== null

  const enrichedContext: RouterContext = {
    ...context,
    hasTrigger,
    isReceipt,
    receiptType,
  }

  // Control group messages always go to control handler (AC5)
  // Story 6.1 AC4: Control group excluded from receipt detection
  // Note: hasTrigger is still set for consistent logging
  if (context.isControlGroup) {
    return { destination: 'CONTROL_HANDLER', context: enrichedContext }
  }

  // Story 6.1 AC3: Receipt messages go to receipt handler
  if (isReceipt) {
    return { destination: 'RECEIPT_HANDLER', context: enrichedContext }
  }

  // Price trigger messages go to price handler (AC1, AC2)
  if (hasTrigger) {
    return { destination: 'PRICE_HANDLER', context: enrichedContext }
  }

  // No trigger - ignore message (AC4)
  return { destination: 'IGNORE', context: enrichedContext }
}
