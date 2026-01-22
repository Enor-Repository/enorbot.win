/**
 * Price trigger detection for eNorBOT.
 * Detects keywords that trigger price quote requests.
 */

/**
 * Keywords that trigger price quote requests.
 * IMPORTANT: Keywords must be lowercase for case-insensitive matching.
 * Add new keywords here to expand trigger detection.
 */
export const PRICE_TRIGGER_KEYWORDS = ['preço', 'cotação'] as const

/**
 * Check if a message contains a price trigger keyword.
 * Case-insensitive matching (message is normalized to lowercase).
 *
 * @param message - The message text to check
 * @returns true if message contains a trigger keyword
 */
export function isPriceTrigger(message: string): boolean {
  const normalized = message.toLowerCase()
  // Keywords are already lowercase, no need to normalize them
  return PRICE_TRIGGER_KEYWORDS.some(keyword => normalized.includes(keyword))
}
