/**
 * Price trigger detection for eNorBOT.
 * Detects keywords that trigger price quote requests.
 * Keywords are loaded from Supabase via systemPatternService (editable in dashboard).
 */

import { getKeywordsForPattern, getKeywordsForPatternSync } from '../services/systemPatternService.js'

/**
 * Default price trigger keywords — used as compile-time reference only.
 * At runtime, both async and sync callers read from the systemPatternService
 * cache (populated from the system_patterns DB table, editable via dashboard).
 * These defaults are only used before the first DB load completes.
 */
export const PRICE_TRIGGER_KEYWORDS = ['preço', 'cotação'] as const

/**
 * Check if a message contains a price trigger keyword (async).
 * Keywords are loaded from the database (editable via dashboard).
 * Used by the router for primary routing decisions.
 *
 * @param message - The message text to check
 * @returns true if message contains a trigger keyword
 */
export async function isPriceTrigger(message: string): Promise<boolean> {
  const normalized = message.toLowerCase()
  const keywords = await getKeywordsForPattern('price_request')
  if (keywords.length === 0) return false
  return matchesWordBoundary(normalized, keywords)
}

/**
 * Synchronous price trigger check using cached DB keywords.
 * Reads from the in-memory cache populated by previous async calls.
 * Falls back to PRICE_TRIGGER_KEYWORDS if cache is empty (before first DB load).
 * Used by the message classifier which cannot be async.
 */
export function isPriceTriggerSync(message: string): boolean {
  const normalized = message.toLowerCase()
  const keywords = getKeywordsForPatternSync('price_request')
  if (keywords.length === 0) return false
  return matchesWordBoundary(normalized, keywords)
}

/**
 * Build a Unicode-aware word boundary regex for the given keywords.
 * Uses lookbehind/lookahead for Latin letter boundaries (ç, ã, é, etc.)
 * that JS \b doesn't handle. Shared by triggers.ts and systemPatternService.ts.
 */
export function buildWordBoundaryRegex(keywords: string[]): RegExp {
  const escaped = keywords.map(k => k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(
    `(?<![a-zA-Z\\u00C0-\\u024F])(${escaped.join('|')})(?![a-zA-Z\\u00C0-\\u024F])`
  )
}

/**
 * Check if normalized text contains any keyword as a whole word.
 * Prevents false positives: keyword "ok" won't match in "books",
 * keyword "tx" won't match in "text".
 */
function matchesWordBoundary(normalizedText: string, keywords: string[]): boolean {
  return buildWordBoundaryRegex(keywords).test(normalizedText)
}

/**
 * Extract BRL volume from a trigger message.
 * Parses numbers with optional 'k' suffix for thousands.
 *
 * Examples:
 * - "compro 5000" → 5000
 * - "preço 10k" → 10000
 * - "cotação 15.5k" → 15500
 * - "preço de 20mil" → 20000
 * - "quero 7,5k" → 7500
 *
 * @param message - The trigger message text
 * @returns Extracted volume in BRL, or null if no volume found
 */
export function extractVolumeBrl(message: string): number | null {
  const normalized = message.toLowerCase()

  // Pattern to match numbers with optional decimal and 'k' or 'mil' suffix
  // Supports: 5000, 5.000, 5,000, 10k, 10.5k, 10,5k, 20mil, 20.5mil
  const patterns = [
    // Match "Xk" or "X.Yk" or "X,Yk" (thousands with k suffix)
    /(\d+(?:[.,]\d+)?)\s*k\b/i,
    // Match "Xmil" or "X.Ymil" or "X,Ymil" (thousands with mil suffix)
    /(\d+(?:[.,]\d+)?)\s*mil\b/i,
    // Match plain numbers (4+ digits to avoid matching prices)
    /\b(\d{4,})\b/,
    // Match numbers with thousand separators like 5.000 or 5,000
    /\b(\d{1,3}(?:[.,]\d{3})+)\b/,
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    if (match) {
      let numStr = match[1]

      // Check if this is a 'k' or 'mil' multiplier
      const isK = /k\b/i.test(match[0])
      const isMil = /mil\b/i.test(match[0])

      // Handle decimal separator (Brazilian uses comma, but support both)
      // For k/mil patterns, treat comma/period as decimal
      if (isK || isMil) {
        numStr = numStr.replace(',', '.')
        const value = parseFloat(numStr) * 1000
        if (!isNaN(value) && value > 0) {
          return value
        }
      } else {
        // For plain numbers, check if it's a thousand separator pattern
        if (numStr.includes('.') || numStr.includes(',')) {
          // If pattern is X.XXX or X,XXX, it's likely a thousand separator
          const cleaned = numStr.replace(/[.,]/g, '')
          const value = parseInt(cleaned, 10)
          if (!isNaN(value) && value > 0) {
            return value
          }
        } else {
          const value = parseInt(numStr, 10)
          if (!isNaN(value) && value > 0) {
            return value
          }
        }
      }
    }
  }

  return null
}

/**
 * Tronscan transaction URL pattern.
 * Matches URLs like: https://tronscan.org/#/transaction/e779beb52ec8448f...
 */
const TRONSCAN_PATTERN = /https?:\/\/tronscan\.(?:org|io)\/#\/transaction\/([a-f0-9]{64})/i

/**
 * Check if a message contains a Tronscan transaction link.
 *
 * @param message - The message text to check
 * @returns true if message contains a Tronscan link
 */
export function hasTronscanLink(message: string): boolean {
  return TRONSCAN_PATTERN.test(message)
}

/**
 * Extract Tronscan transaction hash from a message.
 *
 * @param message - The message text containing the link
 * @returns Transaction hash (64 hex chars) or null if not found
 */
export function extractTronscanTx(message: string): string | null {
  const match = message.match(TRONSCAN_PATTERN)
  return match ? match[1] : null
}
