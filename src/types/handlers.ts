/**
 * Handler Result Types
 *
 * Defines return types for message handlers.
 * All handlers return Result<T> for consistent error handling.
 */

/**
 * Result data returned by price handler on success.
 *
 * Story 2.3 - AC4: Handler returns {ok: true, data: {price, groupId, timestamp}}
 * Story 2.4 - AC3: Optionally includes {recovered, retryCount} on recovery
 */
export interface PriceHandlerResult {
  /** Raw price from Binance (before formatting) */
  price: number
  /** Group JID where price was sent */
  groupId: string
  /** ISO timestamp of when the response was sent */
  timestamp: string
  /** True if price was recovered after initial failure (Story 2.4) */
  recovered?: boolean
  /** Number of retries before success, only present if recovered (Story 2.4) */
  retryCount?: number
  /** Name of active time-based rule that overrode default spread (Sprint 2) */
  activeRuleName?: string
}

/**
 * Receipt type detected from message content.
 * Story 6.1 - AC1, AC2: Detect PDF and image receipts
 */
export type ReceiptType = 'pdf' | 'image' | null

/**
 * Result data returned by receipt handler on success.
 * Story 6.1 - Receipt processing result
 */
export interface ReceiptHandlerResult {
  /** ID of the stored receipt */
  receiptId: string
  /** EndToEnd ID from the PIX transfer */
  endToEndId: string
  /** Type of receipt processed */
  receiptType: 'pdf' | 'image'
  /** Group JID where receipt was received */
  groupId: string
  /** ISO timestamp of processing */
  timestamp: string
}

/**
 * MIME type constants for receipt detection.
 * Story 6.1 - AC1, AC2: Supported MIME types
 */
export const RECEIPT_MIME_TYPES = {
  PDF: 'application/pdf',
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  WEBP: 'image/webp',
} as const

/**
 * Set of supported image MIME types for receipts.
 */
export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  RECEIPT_MIME_TYPES.JPEG,
  RECEIPT_MIME_TYPES.PNG,
  RECEIPT_MIME_TYPES.WEBP,
])
