/**
 * PDF Text Extraction Service
 *
 * Story 6.2 - Extracts text from PDF files using unpdf library.
 * Returns Result type - never throws.
 */

import { extractText } from 'unpdf'
import { ok, err, type Result } from '../utils/result.js'
import { logger } from '../utils/logger.js'

/**
 * Timeout for PDF extraction in milliseconds.
 * NFR18: PDF text extraction completes within 5 seconds or times out.
 */
export const PDF_EXTRACTION_TIMEOUT_MS = 5000

/**
 * Extract text content from a PDF buffer.
 * Returns Result type - never throws.
 *
 * @param buffer - PDF file as Buffer
 * @returns Promise<Result<string>> - ok(text) on success, err(message) on failure
 */
export async function extractPdfText(buffer: Buffer): Promise<Result<string>> {
  const startTime = Date.now()

  try {
    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('PDF extraction timeout')), PDF_EXTRACTION_TIMEOUT_MS)
    })

    // Race extraction against timeout
    const result = await Promise.race([extractText(buffer), timeoutPromise])

    const durationMs = Date.now() - startTime
    const text = result.text ?? ''

    logger.info('PDF text extracted', {
      event: 'pdf_text_extracted',
      durationMs,
      textLength: text.length,
    })

    return ok(text)
  } catch (error) {
    const durationMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Check if it was a timeout
    if (errorMessage === 'PDF extraction timeout') {
      logger.warn('PDF extraction timeout', {
        event: 'pdf_extraction_timeout',
        durationMs,
        timeoutMs: PDF_EXTRACTION_TIMEOUT_MS,
      })
      return err('PDF extraction timeout')
    }

    // Log other errors (malformed PDFs, etc.)
    logger.error('PDF extraction failed', {
      event: 'pdf_extraction_error',
      error: errorMessage,
      durationMs,
    })

    return err(`PDF extraction failed: ${errorMessage}`)
  }
}
