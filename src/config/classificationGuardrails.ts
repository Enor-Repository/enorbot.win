/**
 * Classification Guardrails Configuration
 *
 * This file defines the guardrails for the AI-assisted classification system.
 * Modify these values to adjust the behavior of the classification pipeline.
 *
 * IMPORTANT: These guardrails protect against:
 * 1. Excessive API costs (rate limits, caching)
 * 2. Data leakage (sensitive pattern filtering)
 * 3. Unnecessary AI calls (confidence thresholds)
 * 4. Abuse (per-group and global limits)
 */

import type { ConfidenceLevel } from '../services/messageClassifier.js'

// =============================================================================
// Rate Limiting
// =============================================================================

/**
 * Maximum AI classification calls per group per minute.
 * Prevents a single group from consuming all API quota.
 * Default: 10
 */
export const MAX_AI_CALLS_PER_GROUP_PER_MINUTE = 10

/**
 * Maximum AI classification calls globally per hour.
 * Hard cap to prevent runaway costs.
 * Default: 100
 */
export const MAX_AI_CALLS_GLOBAL_PER_HOUR = 100

/**
 * Maximum AI classification calls per day (approximate).
 * Soft budget cap - logged but not enforced.
 * Default: 500
 */
export const DAILY_AI_CALL_BUDGET = 500

/**
 * Estimated cost per AI call (USD).
 * Used for logging and budget tracking.
 * Haiku: ~$0.0002-0.001 per call
 */
export const ESTIMATED_COST_PER_CALL_USD = 0.0005

// =============================================================================
// Confidence Thresholds
// =============================================================================

/**
 * Minimum confidence level from rules that triggers AI fallback.
 * - 'low': AI invoked for low confidence only
 * - 'medium': AI invoked for medium and low confidence
 * - 'high': Never invoke AI (rules only)
 * Default: 'low'
 */
export const AI_INVOCATION_THRESHOLD: ConfidenceLevel = 'low'

/**
 * Message types that should NEVER trigger AI (always use rules).
 * These are either:
 * - Context-based (receipts, tronscan from attachments)
 * - Bot-specific (responses from our bot)
 */
export const NEVER_USE_AI_FOR_TYPES = [
  'price_response',  // Our bot's response
  'receipt',         // Detected by attachment
  'tronscan',        // Detected by URL pattern
  'bot_command',     // Clear /command pattern
  'bot_confirmation', // Clear bot response pattern
] as const

// =============================================================================
// Content Filtering
// =============================================================================

/**
 * Maximum message length to send to AI.
 * Longer messages are truncated.
 * Default: 500 characters
 */
export const MAX_MESSAGE_LENGTH_FOR_AI = 500

/**
 * Minimum message length to consider for AI.
 * Very short messages don't need AI analysis.
 * Default: 3 characters
 */
export const MIN_MESSAGE_LENGTH_FOR_AI = 3

/**
 * Patterns that indicate a message is just emojis/reactions.
 * These should not be sent to AI.
 */
export const EMOJI_ONLY_PATTERN = /^[\p{Emoji}\s]+$/u

/**
 * Sensitive data patterns that should NEVER be sent to AI.
 * Messages matching these are classified using rules only.
 *
 * Updated 2026-01-28: Added cryptocurrency wallet addresses per party-mode review.
 */
export const SENSITIVE_DATA_PATTERNS = [
  // Brazilian personal IDs
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/i,         // CPF
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/i, // CNPJ

  // PIX keys
  /\bpix[:\s]+[a-z0-9@._+-]+/i,
  /\bchave[:\s]+[a-z0-9@._+-]+/i,

  // Credentials
  /\b(?:senha|password|pwd)[:\s]+\S+/i,
  /\b(?:token|api[_-]?key)[:\s]+\S+/i,

  // Bank details
  /\bagencia[:\s]*\d+/i,
  /\bconta[:\s]*\d{4,}/i,
  /\b(?:banco|bank)[:\s]*\d+/i,

  // Wallet private keys (partial detection)
  /\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b/, // Bitcoin WIF

  // Cryptocurrency wallet addresses (party-mode review: Murat)
  /\bT[A-HJ-NP-Za-km-z1-9]{33}\b/,           // TRC20 (Tron) addresses
  /\b0x[a-fA-F0-9]{40}\b/,                   // Ethereum addresses
  /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/,     // Bitcoin P2PKH/P2SH addresses
] as const

// =============================================================================
// OTC-Specific Rules
// =============================================================================

/**
 * Keywords that indicate OTC trading context.
 * Messages with these keywords in 'general' classification
 * are candidates for AI analysis.
 */
export const OTC_CONTEXT_KEYWORDS = [
  'usdt', 'usd', 'brl', 'reais',
  'pix', 'ted',
  'compra', 'compro', 'vend',
  'trava', 'lock',
  'cota', 'preço', 'price', 'rate', 'taxa',
  'transferência', 'transfer',
  'bitcoin', 'btc', 'crypto', 'cripto',
] as const

/**
 * Volume thresholds for different alert levels.
 * Used for suggested action determination.
 */
export const VOLUME_THRESHOLDS = {
  /** Low volume - routine operation */
  LOW: 10000,      // BRL
  /** Medium volume - standard operation */
  MEDIUM: 50000,   // BRL
  /** High volume - may need escalation */
  HIGH: 100000,    // BRL
  /** Very high - definitely escalate */
  VERY_HIGH: 500000, // BRL
} as const

// =============================================================================
// Caching
// =============================================================================

/**
 * Cache TTL for AI classification results.
 * Identical messages will reuse cached results within this window.
 * Default: 5 minutes
 */
export const CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Maximum cache size (number of entries).
 * Oldest entries are evicted when limit is reached.
 * Default: 500
 */
export const MAX_CACHE_SIZE = 500

// =============================================================================
// Timeouts
// =============================================================================

/**
 * Timeout for AI classification API calls.
 * If exceeded, falls back to rules-based classification.
 * Default: 5 seconds
 */
export const AI_TIMEOUT_MS = 5000

// =============================================================================
// Group-Specific Configuration
// =============================================================================

/**
 * Group-specific behavior overrides.
 * Key: partial group name match (lowercase)
 * Value: configuration overrides
 */
export const GROUP_SPECIFIC_CONFIG: Record<string, {
  /** Primary language for this group */
  language?: 'pt' | 'en' | 'mixed'
  /** Disable AI for this group */
  disableAI?: boolean
  /** Custom rate limit override */
  maxAICallsPerMinute?: number
  /** Skip certain message types */
  skipTypes?: string[]
}> = {
  // Example configurations based on behavioral analysis
  'liqd': {
    language: 'pt',
    // Liqd groups have high volume, allow more AI calls
    maxAICallsPerMinute: 15,
  },
  'lumina': {
    language: 'en',
    // English-speaking group
  },
  'speeddway': {
    language: 'pt',
    // EUR operations - might want different handling
  },
  'controle': {
    // Control group - disable AI
    disableAI: true,
  },
}

/**
 * Get group-specific configuration.
 */
export function getGroupConfig(groupName: string): typeof GROUP_SPECIFIC_CONFIG[string] | undefined {
  const normalizedName = groupName.toLowerCase()
  for (const [pattern, config] of Object.entries(GROUP_SPECIFIC_CONFIG)) {
    if (normalizedName.includes(pattern)) {
      return config
    }
  }
  return undefined
}

// =============================================================================
// Monitoring & Alerting
// =============================================================================

/**
 * Alert threshold: warn if daily AI cost exceeds this amount (USD).
 */
export const DAILY_COST_ALERT_THRESHOLD_USD = 1.0

/**
 * Alert threshold: warn if error rate exceeds this percentage.
 */
export const ERROR_RATE_ALERT_THRESHOLD_PERCENT = 10

/**
 * Minimum calls before calculating error rate.
 */
export const MIN_CALLS_FOR_ERROR_RATE = 20
