/**
 * Receipt Handler
 *
 * Story 6.7 - Unified receipt handler for processing PDFs and images.
 * Orchestrates the full receipt processing pipeline:
 * - Download document/image from Baileys
 * - Extract data (PDF via unpdf or image via OpenRouter OCR)
 * - Parse and validate receipt data
 * - Store raw file in Supabase Storage
 * - Store receipt data in Supabase
 * - Notify control group on failures only (silent success)
 */

import { downloadMediaMessage } from '@whiskeysockets/baileys'
import type { Result } from '../utils/result.js'
import { ok, err } from '../utils/result.js'
import type { ReceiptHandlerResult } from '../types/handlers.js'
import type { RouterContext } from '../bot/router.js'
import type { ReceiptData, RawReceiptData } from '../types/receipt.js'
import { logger } from '../utils/logger.js'

// Services from previous stories
import { extractPdfText } from '../services/pdf.js'
import { extractImageReceipt } from '../services/openrouter.js'
import { parseReceiptText, validateReceiptData } from '../services/receiptParser.js'
import { storeReceipt, type ReceiptMeta } from '../services/receiptStorage.js'
import { storeRawFile } from '../services/fileStorage.js'
import { notifyReceiptFailure } from '../services/receiptNotifications.js'

/**
 * MIME type mapping for content types.
 */
const MIME_TYPES = {
  PDF: 'application/pdf',
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  WEBP: 'image/webp',
} as const

/**
 * Baileys download options type.
 * Defined locally to avoid strict type incompatibilities with Baileys library.
 * The library's types are overly strict for our use case where we have valid
 * IWebMessageInfo objects from message events.
 */
interface BaileysDownloadOptions {
  logger: unknown
  reuploadRequest: typeof downloadMediaMessage extends (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ) => Promise<unknown>
    ? Parameters<typeof downloadMediaMessage>[3] extends { reuploadRequest: infer R }
      ? R
      : unknown
    : unknown
}

/**
 * Download media from a Baileys message.
 *
 * @param context - Router context with rawMessage
 * @returns Buffer of the downloaded media or error
 */
async function downloadMedia(context: RouterContext): Promise<Result<Buffer>> {
  if (!context.rawMessage) {
    return err('No raw message available for download')
  }

  try {
    // Note: Type assertions needed due to Baileys library type strictness.
    // The IWebMessageInfo from message events is compatible at runtime,
    // but Baileys exports overly narrow types. This is a known limitation.
    const downloadOptions: BaileysDownloadOptions = {
      logger: undefined,
      reuploadRequest: context.sock.updateMediaMessage,
    }

    const buffer = await downloadMediaMessage(
      context.rawMessage as Parameters<typeof downloadMediaMessage>[0],
      'buffer',
      {},
      downloadOptions as Parameters<typeof downloadMediaMessage>[3]
    )

    if (!buffer || buffer.length === 0) {
      return err('Downloaded media is empty')
    }

    return ok(buffer as Buffer)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Failed to download media', {
      event: 'media_download_error',
      error: errorMessage,
      groupId: context.groupId,
    })
    return err(`Download failed: ${errorMessage}`)
  }
}

/**
 * Get MIME type from router context.
 */
function getMimeType(context: RouterContext): string {
  const message = context.rawMessage?.message

  if (message?.documentMessage?.mimetype) {
    return message.documentMessage.mimetype
  }

  if (message?.imageMessage?.mimetype) {
    return message.imageMessage.mimetype
  }

  // Fallback based on receiptType
  if (context.receiptType === 'pdf') {
    return MIME_TYPES.PDF
  }

  return MIME_TYPES.JPEG // Default for images
}

/**
 * Process a PDF receipt.
 * Extracts text with unpdf, parses, and validates.
 * Falls back to OpenRouter OCR if parsing fails.
 *
 * @param buffer - PDF buffer
 * @param context - Router context
 * @returns Validated receipt data or error
 */
async function processPdfReceipt(
  buffer: Buffer,
  context: RouterContext
): Promise<Result<ReceiptData>> {
  const startTime = Date.now()

  // Step 1: Extract text from PDF using unpdf
  const textResult = await extractPdfText(buffer)

  if (!textResult.ok) {
    logger.warn('PDF text extraction failed, trying OCR fallback', {
      event: 'pdf_extraction_failed_fallback',
      error: textResult.error,
      groupId: context.groupId,
    })
    // Fallback to OCR
    return await processImageReceipt(buffer, MIME_TYPES.PDF, context)
  }

  const text = textResult.data

  // Check if text is empty or too short
  if (!text || text.trim().length < 50) {
    logger.warn('PDF text too short, trying OCR fallback', {
      event: 'pdf_text_too_short_fallback',
      textLength: text?.length ?? 0,
      groupId: context.groupId,
    })
    // Fallback to OCR
    return await processImageReceipt(buffer, MIME_TYPES.PDF, context)
  }

  // Step 2: Parse extracted text
  const parseResult = parseReceiptText(text)

  if (!parseResult.ok) {
    logger.warn('PDF text parsing failed, trying OCR fallback', {
      event: 'pdf_parsing_failed_fallback',
      error: parseResult.error,
      groupId: context.groupId,
    })
    // Fallback to OCR
    return await processImageReceipt(buffer, MIME_TYPES.PDF, context)
  }

  // Step 3: Validate parsed data
  const validateResult = validateReceiptData(parseResult.data)

  if (!validateResult.ok) {
    logger.warn('PDF data validation failed, trying OCR fallback', {
      event: 'pdf_validation_failed_fallback',
      error: validateResult.error,
      groupId: context.groupId,
    })
    // Fallback to OCR
    return await processImageReceipt(buffer, MIME_TYPES.PDF, context)
  }

  logger.info('PDF receipt processed successfully', {
    event: 'pdf_receipt_processed',
    durationMs: Date.now() - startTime,
    groupId: context.groupId,
  })

  return ok(validateResult.data)
}

/**
 * Process an image receipt via OpenRouter OCR.
 *
 * @param buffer - Image buffer
 * @param mimeType - Image MIME type
 * @param context - Router context
 * @returns Validated receipt data or error
 */
async function processImageReceipt(
  buffer: Buffer,
  mimeType: string,
  context: RouterContext
): Promise<Result<ReceiptData>> {
  const startTime = Date.now()

  // Step 1: Send to OpenRouter OCR
  const ocrResult = await extractImageReceipt(buffer, mimeType)

  if (!ocrResult.ok) {
    return err(`OCR failed: ${ocrResult.error}`)
  }

  const rawData: RawReceiptData = ocrResult.data

  // Step 2: Validate OCR response
  const validateResult = validateReceiptData(rawData)

  if (!validateResult.ok) {
    return err(`OCR validation failed: ${validateResult.error}`)
  }

  logger.info('Image receipt processed successfully', {
    event: 'image_receipt_processed',
    durationMs: Date.now() - startTime,
    groupId: context.groupId,
  })

  return ok(validateResult.data)
}

/**
 * Handle receipt messages (PDF/image).
 * Full processing pipeline:
 * 1. Download media from Baileys
 * 2. Extract data (PDF text or image OCR)
 * 3. Validate receipt data
 * 4. Store raw file (graceful degradation)
 * 5. Store receipt data
 *
 * Success: Returns Result with receipt info, NO control group notification
 * Failure: Returns error Result (notification handled by Story 6.8)
 *
 * @param context - Router context with receipt metadata
 * @returns Result with receipt processing outcome
 */
export async function handleReceipt(
  context: RouterContext
): Promise<Result<ReceiptHandlerResult>> {
  const { groupId, groupName, sender, receiptType } = context
  const startTime = Date.now()

  logger.info('Receipt processing started', {
    event: 'receipt_processing_started',
    groupId,
    groupName,
    sender,
    receiptType,
  })

  // Step 1: Download media from Baileys
  const downloadResult = await downloadMedia(context)

  if (!downloadResult.ok) {
    logger.error('Receipt download failed', {
      event: 'receipt_download_failed',
      error: downloadResult.error,
      groupId,
      sender,
    })

    // Notify control group of failure (Story 6.8)
    await notifyReceiptFailure({
      groupName: groupName ?? groupId,
      groupJid: groupId,
      senderName: sender,
      senderJid: sender,
      reason: downloadResult.error,
      timestamp: new Date(),
      receiptType: receiptType === 'pdf' ? 'pdf' : 'image',
    })

    return err(`Download failed: ${downloadResult.error}`)
  }

  const buffer = downloadResult.data
  const mimeType = getMimeType(context)

  // Step 2: Extract and validate receipt data based on type
  let receiptDataResult: Result<ReceiptData>

  if (receiptType === 'pdf') {
    receiptDataResult = await processPdfReceipt(buffer, context)
  } else {
    receiptDataResult = await processImageReceipt(buffer, mimeType, context)
  }

  if (!receiptDataResult.ok) {
    // Issue fix: Standardize error message format with prefix
    const errorMessage = receiptDataResult.error.startsWith('OCR')
      ? receiptDataResult.error
      : `Extraction failed: ${receiptDataResult.error}`

    logger.error('Receipt extraction failed', {
      event: 'receipt_extraction_failed',
      error: errorMessage,
      groupId,
      sender,
      receiptType,
    })

    // Notify control group of failure (Story 6.8)
    await notifyReceiptFailure({
      groupName: groupName ?? groupId,
      groupJid: groupId,
      senderName: sender,
      senderJid: sender,
      reason: errorMessage,
      timestamp: new Date(),
      receiptType: receiptType === 'pdf' ? 'pdf' : 'image',
    })

    return err(errorMessage)
  }

  const receiptData = receiptDataResult.data

  // Step 3: Store raw file in Supabase Storage (graceful degradation)
  const fileResult = await storeRawFile(buffer, receiptData.identificador, mimeType)

  let rawFileUrl: string | null = null

  if (fileResult.ok) {
    rawFileUrl = fileResult.data
    logger.info('Raw file stored', {
      event: 'raw_file_stored',
      endToEndId: receiptData.identificador,
      url: rawFileUrl,
    })
  } else {
    // Graceful degradation: Log warning but continue
    logger.warn('Raw file storage failed, continuing without file', {
      event: 'raw_file_storage_failed',
      error: fileResult.error,
      endToEndId: receiptData.identificador,
    })
  }

  // Step 4: Store receipt data in Supabase
  const meta: ReceiptMeta = {
    rawFileUrl,
    sourceType: receiptType === 'pdf' ? 'pdf' : 'image',
    groupJid: groupId,
  }

  const storeResult = await storeReceipt(receiptData, meta)

  if (!storeResult.ok) {
    // Check if it's a duplicate
    if (storeResult.error === 'Duplicate receipt') {
      logger.info('Duplicate receipt detected', {
        event: 'receipt_duplicate',
        endToEndId: receiptData.identificador,
        groupId,
        sender,
      })
      // Duplicates are "successful" from user perspective - no notification
      return err('Duplicate receipt')
    }

    logger.error('Receipt storage failed', {
      event: 'receipt_storage_failed',
      error: storeResult.error,
      groupId,
      sender,
      endToEndId: receiptData.identificador,
    })

    // Notify control group of failure (Story 6.8)
    await notifyReceiptFailure({
      groupName: groupName ?? groupId,
      groupJid: groupId,
      senderName: sender,
      senderJid: sender,
      reason: storeResult.error,
      timestamp: new Date(),
      receiptType: receiptType === 'pdf' ? 'pdf' : 'image',
    })

    return err(`Storage failed: ${storeResult.error}`)
  }

  const durationMs = Date.now() - startTime

  // Success! Return result (NO notification to control group)
  logger.info('Receipt processed successfully', {
    event: 'receipt_processed_success',
    receiptId: storeResult.data.id,
    endToEndId: storeResult.data.endToEndId,
    receiptType,
    groupId,
    groupName,
    sender,
    hasRawFile: rawFileUrl !== null,
    durationMs,
  })

  return ok({
    receiptId: storeResult.data.id,
    endToEndId: storeResult.data.endToEndId,
    receiptType: receiptType === 'pdf' ? 'pdf' : 'image',
    groupId,
    timestamp: new Date().toISOString(),
  })
}
