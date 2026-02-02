/**
 * OpenRouter Image OCR Service
 *
 * Story 6.3 - Extracts receipt data from images using Claude Haiku Vision.
 * Returns Result type - never throws.
 */

import { ok, err, type Result } from '../utils/result.js'
import { logger } from '../utils/logger.js'
import { getConfig } from '../config.js'
import { logAIUsage } from './aiUsage.js'
import type { RawReceiptData } from '../types/receipt.js'

/**
 * OpenRouter API endpoint.
 */
export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Claude Haiku model for vision tasks.
 * Cost-effective for receipt OCR.
 */
export const OPENROUTER_MODEL = 'anthropic/claude-3-5-haiku-20241022'

/**
 * Timeout for OCR requests in milliseconds.
 * NFR21: Image OCR processing completes within 10 seconds or times out.
 */
export const OCR_TIMEOUT_MS = 10000

/**
 * Structured prompt for PIX receipt extraction.
 */
const EXTRACTION_PROMPT = `You are analyzing a Brazilian PIX transfer receipt image. Extract the following data and respond ONLY with valid JSON, no other text:

{
  "valor": <number in centavos, e.g., R$ 300.000,00 = 30000000>,
  "dataHora": "<ISO 8601 date string>",
  "tipo": "<transfer type or null>",
  "identificador": "<EndToEnd ID / Identificador da Transação>",
  "recebedor": { "nome": "<receiver name>", "cpfCnpj": "<CPF/CNPJ numbers only>" },
  "pagador": { "nome": "<payer name>", "cpfCnpj": "<CPF/CNPJ numbers only>" }
}

Important:
- valor must be an integer in centavos (multiply reais by 100)
- cpfCnpj must contain only digits, no punctuation
- identificador is the EndToEnd ID, a UUID-like string
- If you cannot extract the data, respond with: {"error": "reason"}`

/**
 * OpenRouter API response shape.
 */
interface OpenRouterResponse {
  id?: string
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  error?: {
    message?: string
    code?: string
  }
}

/**
 * Calculate estimated cost from token usage.
 * Claude Haiku pricing (approximate as of January 2024):
 * - Input: $0.0008 per 1K tokens
 * - Output: $0.004 per 1K tokens
 *
 * NOTE: These are estimated values for logging purposes. OpenRouter pricing
 * may change over time. For accurate billing, refer to OpenRouter dashboard.
 */
function calculateCost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1000) * 0.0008
  const outputCost = (outputTokens / 1000) * 0.004
  return inputCost + outputCost
}

/**
 * Extract receipt data from an image using OpenRouter Claude Haiku Vision.
 * Returns Result type - never throws.
 *
 * @param buffer - Image file as Buffer
 * @param mimeType - MIME type of the image (e.g., 'image/jpeg', 'image/png')
 * @returns Promise<Result<RawReceiptData>> - ok(data) on success, err(message) on failure
 */
export async function extractImageReceipt(
  buffer: Buffer,
  mimeType: string
): Promise<Result<RawReceiptData>> {
  const startTime = Date.now()
  const config = getConfig()

  if (!config.OPENROUTER_API_KEY) {
    logger.error('OpenRouter API key not configured', {
      event: 'openrouter_not_configured',
    })
    return err('OpenRouter API key not configured')
  }

  // Convert buffer to base64
  const base64Image = buffer.toString('base64')

  try {
    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('OCR timeout')), OCR_TIMEOUT_MS)
    })

    // Create fetch promise
    const fetchPromise = fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: EXTRACTION_PROMPT },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Image}` },
              },
            ],
          },
        ],
      }),
    })

    // Race fetch against timeout
    const response = await Promise.race([fetchPromise, timeoutPromise])
    const durationMs = Date.now() - startTime

    if (!response.ok) {
      logger.error('OpenRouter API error', {
        event: 'openrouter_api_error',
        status: response.status,
        durationMs,
      })
      return err(`OpenRouter API error: ${response.status}`)
    }

    const data: OpenRouterResponse = await response.json()

    // Log token usage (NFR22)
    if (data.usage) {
      const inputTokens = data.usage.prompt_tokens ?? 0
      const outputTokens = data.usage.completion_tokens ?? 0
      const costUsd = calculateCost(inputTokens, outputTokens)

      logger.info('OpenRouter OCR completed', {
        event: 'openrouter_ocr_completed',
        model: OPENROUTER_MODEL,
        inputTokens,
        outputTokens,
        totalTokens: data.usage.total_tokens ?? 0,
        costUsd: costUsd.toFixed(6),
        durationMs,
      })

      // Story D.9: Log to Supabase for cost monitoring
      logAIUsage({
        service: 'ocr',
        model: OPENROUTER_MODEL,
        inputTokens,
        outputTokens,
        costUsd,
        durationMs,
        success: true,
      }).catch(() => {}) // Fire-and-forget
    }

    // Check for API error response
    if (data.error) {
      logger.error('OpenRouter returned error', {
        event: 'openrouter_response_error',
        error: data.error.message,
        code: data.error.code,
        durationMs,
      })
      return err(`OpenRouter error: ${data.error.message}`)
    }

    // Extract content from response
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      logger.error('OpenRouter returned empty content', {
        event: 'openrouter_empty_content',
        durationMs,
      })
      return err('OpenRouter returned empty content')
    }

    // Parse JSON response
    let parsed: RawReceiptData
    try {
      parsed = JSON.parse(content) as RawReceiptData
    } catch {
      logger.error('Failed to parse OpenRouter response as JSON', {
        event: 'openrouter_json_parse_error',
        content: content.substring(0, 200),
        durationMs,
      })
      return err('Could not extract receipt data')
    }

    // Check if Claude returned an error
    if (parsed.error) {
      logger.warn('Claude could not extract receipt data', {
        event: 'openrouter_extraction_failed',
        reason: parsed.error,
        durationMs,
      })
      return err(`Could not extract receipt data: ${parsed.error}`)
    }

    return ok(parsed)
  } catch (error) {
    const durationMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Check if it was a timeout
    if (errorMessage === 'OCR timeout') {
      logger.warn('OpenRouter OCR timeout', {
        event: 'openrouter_ocr_timeout',
        durationMs,
        timeoutMs: OCR_TIMEOUT_MS,
      })
      // Story D.9: Log timeout to Supabase
      logAIUsage({
        service: 'ocr',
        model: OPENROUTER_MODEL,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs,
        success: false,
        errorMessage: 'timeout',
      }).catch(() => {})
      return err('OCR timeout')
    }

    // Log other errors
    logger.error('OpenRouter OCR failed', {
      event: 'openrouter_ocr_error',
      error: errorMessage,
      durationMs,
    })

    // Story D.9: Log error to Supabase
    logAIUsage({
      service: 'ocr',
      model: OPENROUTER_MODEL,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs,
      success: false,
      errorMessage,
    }).catch(() => {})

    return err(`OCR failed: ${errorMessage}`)
  }
}
