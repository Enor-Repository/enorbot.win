/**
 * AI-Assisted Message Classification Service
 *
 * **IMPORTANT**: For external usage, import from `classificationEngine.ts` instead.
 * Use `classifyOTCMessage()` which orchestrates rules + AI correctly.
 *
 * This module provides intelligent classification fallback when rules-based
 * classification has low confidence. Uses OpenRouter Claude Haiku for
 * context-aware analysis.
 *
 * Architecture:
 * 1. Rules-based classification is ALWAYS attempted first (cost: $0)
 * 2. AI is invoked ONLY when confidence is low AND message is ambiguous
 * 3. Guardrails prevent abuse: rate limits, cost caps, content filtering
 * 4. Results are cached to avoid redundant API calls
 *
 * Guardrails:
 * - Max 10 AI calls per group per minute (sliding window)
 * - Max 100 AI calls per hour globally (sliding window)
 * - Circuit breaker: 3 consecutive failures → 5 min cooldown
 * - Never send messages > 500 chars to AI
 * - Never invoke AI for messages from known bots
 * - Content filtering for sensitive patterns (CPF, PIX, passwords, wallets)
 */

import { ok, err, type Result } from '../utils/result.js'
import { logger } from '../utils/logger.js'
import { getConfig } from '../config.js'
import { logAIUsage } from './aiUsage.js'
import type { OTCMessageType, ConfidenceLevel, ClassificationResult } from './messageClassifier.js'

// =============================================================================
// Configuration & Constants
// =============================================================================

/**
 * OpenRouter API endpoint.
 */
export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Claude Haiku model for text classification.
 * Cost-effective and fast for classification tasks.
 */
export const CLASSIFICATION_MODEL = 'anthropic/claude-3-5-haiku-20241022'

/**
 * Timeout for classification requests (5 seconds).
 */
export const CLASSIFICATION_TIMEOUT_MS = 5000

/**
 * Maximum message length to send to AI.
 * Longer messages are truncated.
 */
export const MAX_MESSAGE_LENGTH = 500

/**
 * Confidence threshold below which AI is invoked.
 */
export const AI_CONFIDENCE_THRESHOLD: ConfidenceLevel = 'low'

/**
 * Rate limit: max AI calls per group per minute.
 */
export const MAX_CALLS_PER_GROUP_PER_MINUTE = 10

/**
 * Rate limit: max AI calls globally per hour.
 */
export const MAX_CALLS_GLOBAL_PER_HOUR = 100

/**
 * Cache TTL for classification results (5 minutes).
 */
export const CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Max cache size to prevent memory growth.
 */
export const MAX_CACHE_SIZE = 500

/**
 * Circuit breaker: max consecutive failures before disabling AI.
 * Party-mode review: Murat identified missing circuit breaker.
 */
export const CIRCUIT_BREAKER_THRESHOLD = 3

/**
 * Circuit breaker: cooldown period after tripping (5 minutes).
 */
export const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000

// =============================================================================
// Types
// =============================================================================

/**
 * AI classification request context.
 */
export interface AIClassificationContext {
  /** The message content to classify */
  message: string
  /** Group ID for rate limiting */
  groupId: string
  /** Sender JID */
  senderJid: string
  /** Sender display name */
  senderName?: string
  /** Recent conversation history for context */
  conversationHistory?: ConversationMessage[]
  /** Group behavior profile */
  groupProfile?: GroupProfile
  /** Rules-based classification result (for AI to consider) */
  rulesResult?: ClassificationResult
}

/**
 * Message in conversation history.
 */
export interface ConversationMessage {
  sender: string
  content: string
  timestamp: Date
  type?: OTCMessageType
}

/**
 * Group behavior profile for AI context.
 */
export interface GroupProfile {
  name: string
  primaryLanguage: 'pt' | 'en' | 'mixed'
  commonPatterns: string[]
  activeOperators: string[]
  typicalVolumeRange?: { min: number; max: number }
}

/**
 * AI classification response.
 */
export interface AIClassificationResponse {
  messageType: OTCMessageType
  confidence: ConfidenceLevel
  reasoning: string
  suggestedAction?: 'respond' | 'observe' | 'escalate'
  extractedData?: {
    volumeBrl?: number
    volumeUsdt?: number
    rate?: number
    intent?: 'buy' | 'sell' | 'inquiry' | 'unknown'
  }
}

/**
 * Rate limit tracking entry using sliding window (party-mode review: Winston).
 * Stores timestamps of recent calls instead of fixed counters.
 */
interface SlidingWindowEntry {
  timestamps: number[]
}

/**
 * Cache entry for classification results.
 */
interface CacheEntry {
  result: AIClassificationResponse
  expiresAt: number
}

// =============================================================================
// State
// =============================================================================

/** Rate limit using sliding window by group (party-mode review: Winston) */
const groupRateLimits: Map<string, SlidingWindowEntry> = new Map()

/** Global rate limit using sliding window (party-mode review: Winston) */
const globalCallTimestamps: number[] = []

/** Classification cache (key: hash of message+groupId) */
const classificationCache: Map<string, CacheEntry> = new Map()

/** Total AI calls counter for metrics */
let totalAICalls = 0
let totalAITokens = 0
let totalAICostUsd = 0

/** Circuit breaker state (party-mode review: Murat) */
let consecutiveFailures = 0
let circuitBreakerTrippedAt: number | null = null

// =============================================================================
// Guardrails
// =============================================================================

/**
 * Patterns that should NEVER be sent to AI.
 * These are filtered out before any AI call.
 *
 * Updated 2026-01-28: Added TRC20/ETH wallet detection per party-mode review.
 */
const SENSITIVE_PATTERNS = [
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/i,     // CPF
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/i, // CNPJ
  /\bpix[:\s]+[a-z0-9@._+-]+/i,              // PIX keys (email, phone)
  /\b(?:senha|password|pwd)[:\s]+\S+/i,      // Passwords
  /\bagencia[:\s]*\d+/i,                     // Bank agency
  /\bconta[:\s]*\d{4,}/i,                    // Bank account
  // Cryptocurrency wallet addresses (party-mode review: Murat)
  /\bT[A-HJ-NP-Za-km-z1-9]{33}\b/,           // TRC20 (Tron) addresses - start with T, 34 chars
  /\b0x[a-fA-F0-9]{40}\b/,                   // Ethereum addresses - start with 0x, 42 chars
  /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/,     // Bitcoin P2PKH/P2SH addresses
]

/**
 * Check if message contains sensitive data that should not be sent to AI.
 */
export function containsSensitiveData(message: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(message))
}

/**
 * Check if circuit breaker is tripped.
 * Party-mode review: Murat identified missing circuit breaker.
 */
export function isCircuitBreakerOpen(): boolean {
  if (circuitBreakerTrippedAt === null) {
    return false
  }

  const now = Date.now()
  if (now >= circuitBreakerTrippedAt + CIRCUIT_BREAKER_COOLDOWN_MS) {
    // Cooldown expired, reset circuit breaker
    circuitBreakerTrippedAt = null
    consecutiveFailures = 0
    logger.info('Circuit breaker reset after cooldown', {
      event: 'ai_circuit_breaker_reset',
    })
    return false
  }

  return true
}

/**
 * Record an AI call result for circuit breaker.
 */
function recordAICallResult(success: boolean): void {
  if (success) {
    consecutiveFailures = 0
  } else {
    consecutiveFailures++
    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      circuitBreakerTrippedAt = Date.now()
      logger.error('Circuit breaker tripped due to consecutive failures', {
        event: 'ai_circuit_breaker_tripped',
        consecutiveFailures,
        cooldownMs: CIRCUIT_BREAKER_COOLDOWN_MS,
      })
    }
  }
}

/**
 * Clean up old timestamps from sliding window.
 * Party-mode review: Winston recommended sliding window to prevent burst abuse.
 */
function cleanupSlidingWindow(timestamps: number[], windowMs: number): number[] {
  const cutoff = Date.now() - windowMs
  return timestamps.filter(ts => ts > cutoff)
}

/**
 * Check if we're within rate limits for AI calls.
 * Uses sliding window algorithm (party-mode review: Winston).
 */
export function checkRateLimits(groupId: string): Result<void> {
  const now = Date.now()

  // Check circuit breaker first (party-mode review: Murat)
  if (isCircuitBreakerOpen()) {
    const remainingCooldown = (circuitBreakerTrippedAt! + CIRCUIT_BREAKER_COOLDOWN_MS) - now
    logger.warn('AI circuit breaker is open', {
      event: 'ai_circuit_breaker_open',
      remainingCooldownMs: remainingCooldown,
    })
    return err('Circuit breaker is open - AI temporarily disabled')
  }

  // Check global limit using sliding window (1 hour)
  const globalWindow = cleanupSlidingWindow(globalCallTimestamps, 60 * 60 * 1000)
  globalCallTimestamps.length = 0
  globalCallTimestamps.push(...globalWindow)

  if (globalCallTimestamps.length >= MAX_CALLS_GLOBAL_PER_HOUR) {
    logger.warn('Global AI rate limit exceeded (sliding window)', {
      event: 'ai_rate_limit_global',
      count: globalCallTimestamps.length,
      limit: MAX_CALLS_GLOBAL_PER_HOUR,
    })
    return err('Global rate limit exceeded')
  }

  // Check per-group limit using sliding window (1 minute)
  let groupEntry = groupRateLimits.get(groupId)
  if (groupEntry) {
    groupEntry.timestamps = cleanupSlidingWindow(groupEntry.timestamps, 60 * 1000)
  } else {
    groupEntry = { timestamps: [] }
    groupRateLimits.set(groupId, groupEntry)
  }

  if (groupEntry.timestamps.length >= MAX_CALLS_PER_GROUP_PER_MINUTE) {
    logger.warn('Group AI rate limit exceeded (sliding window)', {
      event: 'ai_rate_limit_group',
      groupId,
      count: groupEntry.timestamps.length,
      limit: MAX_CALLS_PER_GROUP_PER_MINUTE,
    })
    return err('Group rate limit exceeded')
  }

  return ok(undefined)
}

/**
 * Increment rate limit counters after an AI call.
 * Uses sliding window timestamps (party-mode review: Winston).
 */
function incrementRateLimits(groupId: string): void {
  const now = Date.now()

  // Add to global sliding window
  globalCallTimestamps.push(now)

  // Add to group sliding window
  const groupEntry = groupRateLimits.get(groupId)
  if (groupEntry) {
    groupEntry.timestamps.push(now)
  } else {
    groupRateLimits.set(groupId, { timestamps: [now] })
  }
}

// =============================================================================
// Caching
// =============================================================================

/**
 * Generate cache key for a classification request.
 */
function getCacheKey(message: string, groupId: string): string {
  // Simple hash: normalize message and combine with groupId
  const normalized = message.toLowerCase().trim().substring(0, 100)
  return `${groupId}:${normalized}`
}

/**
 * Get cached classification result if available.
 */
export function getCachedClassification(
  message: string,
  groupId: string
): AIClassificationResponse | null {
  const key = getCacheKey(message, groupId)
  const entry = classificationCache.get(key)

  if (!entry) return null

  if (Date.now() >= entry.expiresAt) {
    classificationCache.delete(key)
    return null
  }

  logger.debug('AI classification cache hit', {
    event: 'ai_cache_hit',
    groupId,
  })

  return entry.result
}

/**
 * Cache a classification result.
 */
function cacheClassification(
  message: string,
  groupId: string,
  result: AIClassificationResponse
): void {
  // Evict oldest entries if at capacity
  if (classificationCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = classificationCache.keys().next().value
    if (oldestKey) {
      classificationCache.delete(oldestKey)
    }
  }

  const key = getCacheKey(message, groupId)
  classificationCache.set(key, {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
}

// =============================================================================
// Prompt Construction
// =============================================================================

/**
 * Build the system prompt for AI classification.
 */
function buildSystemPrompt(groupProfile?: GroupProfile): string {
  const basePrompt = `You are an expert OTC (Over-The-Counter) cryptocurrency trading message classifier for Brazilian WhatsApp groups.

Your task is to classify messages in OTC trading conversations. These groups facilitate USDT/BRL trades between clients and operators.

MESSAGE TYPES you can classify:
- price_request: Asking for current rate ("cotação", "preço?", "price?", "quanto tá?", "tx pls")
- price_lock: Requesting to lock a specific amount at current rate ("trava 5000", "Trava 7831")
- price_response: Bot or operator providing a rate quote
- quote_calculation: Operator showing amount × rate = total ("5000 * 5.23 = 26150")
- volume_inquiry: Expressing buy/sell intent with amount ("compro 10k", "vendo 5000 usdt")
- negotiation: Counter-offers or price discussion ("pode ser 5.70?", "faz por menos?")
- confirmation: Deal acceptance ("fechado", "ok", "Fecha", "fechar agora")
- bot_command: Commands to other bots ("/compra", "/saldo")
- bot_confirmation: Bot responses ("Compra Registrada", "Venda Registrada")
- balance_report: Balance information ("Saldo Atual 60917 BRL")
- receipt: Payment confirmation mention
- tronscan: Blockchain transaction link
- general: Greetings, chit-chat, unrelated messages

IMPORTANT CONTEXT:
- "trava" is Portuguese for "lock" - it's a critical signal to lock an amount at current rate
- Numbers like "5000", "10k", "7831" often represent USDT amounts
- Operators respond with calculations: "5000 * 5.230 = 26,150.00 BRL"
- "/compra" is a command to another bot (Assistente Liqd) to register a purchase

CONFIDENCE LEVELS:
- high: Clear pattern match, unambiguous
- medium: Likely correct but some ambiguity
- low: Uncertain, could be multiple types`

  if (groupProfile) {
    return `${basePrompt}

GROUP-SPECIFIC CONTEXT:
- Group: ${groupProfile.name}
- Primary language: ${groupProfile.primaryLanguage}
- Common patterns: ${groupProfile.commonPatterns.join(', ')}
- Active operators: ${groupProfile.activeOperators.join(', ')}`
  }

  return basePrompt
}

/**
 * Build the user prompt with message and conversation context.
 */
function buildUserPrompt(context: AIClassificationContext): string {
  let prompt = `Classify this message:\n\n"${context.message}"`

  // Add sender context
  if (context.senderName) {
    prompt += `\n\nSender: ${context.senderName}`
  }

  // Add rules-based result for AI to consider
  if (context.rulesResult) {
    prompt += `\n\nRules-based classification suggested: ${context.rulesResult.messageType} (confidence: ${context.rulesResult.confidence})`
    if (context.rulesResult.volumeBrl) {
      prompt += `\nExtracted BRL volume: ${context.rulesResult.volumeBrl}`
    }
    if (context.rulesResult.volumeUsdt) {
      prompt += `\nExtracted USDT volume: ${context.rulesResult.volumeUsdt}`
    }
  }

  // Add conversation history
  if (context.conversationHistory && context.conversationHistory.length > 0) {
    prompt += '\n\nRecent conversation:'
    const recentMessages = context.conversationHistory.slice(-5)
    for (const msg of recentMessages) {
      const typeLabel = msg.type ? ` [${msg.type}]` : ''
      prompt += `\n- ${msg.sender}${typeLabel}: "${msg.content.substring(0, 100)}"`
    }
  }

  prompt += `

Respond ONLY with valid JSON in this exact format:
{
  "messageType": "<type from the list above>",
  "confidence": "high" | "medium" | "low",
  "reasoning": "<brief explanation of classification>",
  "suggestedAction": "respond" | "observe" | "escalate",
  "extractedData": {
    "volumeBrl": <number or null>,
    "volumeUsdt": <number or null>,
    "rate": <number or null>,
    "intent": "buy" | "sell" | "inquiry" | "unknown" | null
  }
}`

  return prompt
}

// =============================================================================
// OpenRouter API
// =============================================================================

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
 * Call OpenRouter API for classification.
 */
async function callOpenRouter(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  groupId?: string
): Promise<Result<AIClassificationResponse>> {
  const startTime = Date.now()

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Classification timeout')), CLASSIFICATION_TIMEOUT_MS)
    })

    const fetchPromise = fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CLASSIFICATION_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1, // Low temperature for consistent classification
        max_tokens: 500,
      }),
    })

    const response = await Promise.race([fetchPromise, timeoutPromise])
    const durationMs = Date.now() - startTime

    if (!response.ok) {
      logger.error('OpenRouter classification API error', {
        event: 'ai_classification_api_error',
        status: response.status,
        durationMs,
      })
      return err(`API error: ${response.status}`)
    }

    const data: OpenRouterResponse = await response.json()

    // Log usage metrics
    if (data.usage) {
      const inputTokens = data.usage.prompt_tokens ?? 0
      const outputTokens = data.usage.completion_tokens ?? 0
      // Haiku pricing: $0.0008/1K input, $0.004/1K output
      const costUsd = (inputTokens / 1000) * 0.0008 + (outputTokens / 1000) * 0.004

      totalAICalls++
      totalAITokens += inputTokens + outputTokens
      totalAICostUsd += costUsd

      logger.info('AI classification completed', {
        event: 'ai_classification_completed',
        model: CLASSIFICATION_MODEL,
        inputTokens,
        outputTokens,
        costUsd: costUsd.toFixed(6),
        durationMs,
        totalCalls: totalAICalls,
        totalCostUsd: totalAICostUsd.toFixed(4),
      })

      // Story D.9: Log to Supabase for cost monitoring (H5 Fix: include groupJid)
      logAIUsage({
        service: 'classification',
        model: CLASSIFICATION_MODEL,
        inputTokens,
        outputTokens,
        costUsd,
        groupJid: groupId,
        durationMs,
        success: true,
      }).catch(() => {}) // Fire-and-forget
    }

    if (data.error) {
      logger.error('OpenRouter returned error', {
        event: 'ai_classification_response_error',
        error: data.error.message,
        durationMs,
      })
      return err(`API error: ${data.error.message}`)
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
      return err('Empty response from AI')
    }

    // Parse JSON response
    let parsed: AIClassificationResponse
    try {
      parsed = JSON.parse(content) as AIClassificationResponse
    } catch {
      logger.error('Failed to parse AI classification response', {
        event: 'ai_classification_parse_error',
        content: content.substring(0, 200),
        durationMs,
      })
      return err('Invalid JSON response')
    }

    // Validate response structure
    if (!parsed.messageType || !parsed.confidence) {
      return err('Invalid response structure')
    }

    return ok(parsed)
  } catch (error) {
    const durationMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)

    if (errorMessage === 'Classification timeout') {
      logger.warn('AI classification timeout', {
        event: 'ai_classification_timeout',
        durationMs,
        timeoutMs: CLASSIFICATION_TIMEOUT_MS,
      })
      // Story D.9: Log timeout to Supabase (H5 Fix: include groupJid)
      logAIUsage({
        service: 'classification',
        model: CLASSIFICATION_MODEL,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        groupJid: groupId,
        durationMs,
        success: false,
        errorMessage: 'timeout',
      }).catch(() => {})
      return err('Classification timeout')
    }

    logger.error('AI classification failed', {
      event: 'ai_classification_error',
      error: errorMessage,
      durationMs,
    })

    // Story D.9: Log error to Supabase (H5 Fix: include groupJid)
    logAIUsage({
      service: 'classification',
      model: CLASSIFICATION_MODEL,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      groupJid: groupId,
      durationMs,
      success: false,
      errorMessage,
    }).catch(() => {})

    return err(`Classification failed: ${errorMessage}`)
  }
}

// =============================================================================
// Main Classification Function
// =============================================================================

/**
 * Classify a message using AI when rules-based classification has low confidence.
 *
 * **WARNING: Do not call this function directly!**
 * Use `classifyOTCMessage()` from `classificationEngine.ts` instead.
 * The engine handles the rules→AI decision logic correctly.
 *
 * Party-mode review: Murat identified that direct access bypasses guardrails.
 *
 * This function applies all guardrails:
 * 1. Checks rate limits
 * 2. Filters sensitive data
 * 3. Truncates long messages
 * 4. Uses cache when available
 *
 * @param context - Classification context with message and conversation history
 * @returns AI classification result or error
 * @internal Prefer using classifyOTCMessage() from classificationEngine.ts
 */
export async function classifyWithAI(
  context: AIClassificationContext
): Promise<Result<AIClassificationResponse>> {
  const config = getConfig()

  // Check if OpenRouter is configured
  if (!config.OPENROUTER_API_KEY) {
    return err('OpenRouter API key not configured')
  }

  // Check rate limits
  const rateLimitCheck = checkRateLimits(context.groupId)
  if (!rateLimitCheck.ok) {
    return err(rateLimitCheck.error)
  }

  // Check for sensitive data
  if (containsSensitiveData(context.message)) {
    logger.warn('Skipping AI classification due to sensitive data', {
      event: 'ai_classification_sensitive_data',
      groupId: context.groupId,
    })
    return err('Message contains sensitive data')
  }

  // Check cache
  const cached = getCachedClassification(context.message, context.groupId)
  if (cached) {
    return ok(cached)
  }

  // Truncate message if too long
  const truncatedMessage = context.message.length > MAX_MESSAGE_LENGTH
    ? context.message.substring(0, MAX_MESSAGE_LENGTH) + '...'
    : context.message

  // Build prompts
  const systemPrompt = buildSystemPrompt(context.groupProfile)
  const userPrompt = buildUserPrompt({
    ...context,
    message: truncatedMessage,
  })

  // Call API (H5 Fix: pass groupId for cost tracking)
  const result = await callOpenRouter(systemPrompt, userPrompt, config.OPENROUTER_API_KEY, context.groupId)

  // Record result for circuit breaker (party-mode review: Murat)
  recordAICallResult(result.ok)

  // Update rate limits on success
  if (result.ok) {
    incrementRateLimits(context.groupId)
    cacheClassification(context.message, context.groupId, result.data)
  }

  return result
}

// =============================================================================
// Decision Function: Should We Use AI?
// =============================================================================

/**
 * Determine if AI should be invoked for classification.
 *
 * AI is invoked when:
 * 1. Rules-based confidence is 'low'
 * 2. Message is potentially important (has volume, mentions prices, etc.)
 * 3. We're within rate limits
 *
 * AI is NOT invoked when:
 * 1. Rules-based confidence is 'high' or 'medium'
 * 2. Message is from a known bot
 * 3. Message is too short (< 3 chars) or just emojis
 * 4. Rate limits are exceeded
 */
export function shouldUseAI(
  rulesResult: ClassificationResult,
  message: string,
  isFromBot: boolean
): boolean {
  // Never use AI for bot messages
  if (isFromBot) {
    return false
  }

  // Skip very short messages
  if (message.trim().length < 3) {
    return false
  }

  // Skip emoji-only messages
  if (/^[\p{Emoji}\s]+$/u.test(message)) {
    return false
  }

  // Use AI only for low confidence
  if (rulesResult.confidence !== 'low') {
    return false
  }

  // Use AI for ambiguous 'general' classification that has volume
  if (rulesResult.messageType === 'general') {
    // If we extracted volume but couldn't classify, AI might help
    if (rulesResult.volumeBrl || rulesResult.volumeUsdt) {
      return true
    }
    // Check for OTC-related keywords
    const hasOTCKeywords = /usdt|brl|pix|compra|vend|trava|cota|pre[çc]o/i.test(message)
    if (hasOTCKeywords) {
      return true
    }
  }

  // Default: don't use AI
  return false
}

// =============================================================================
// Metrics & Debugging
// =============================================================================

/**
 * Get current AI classification metrics.
 */
export function getAIMetrics(): {
  totalCalls: number
  totalTokens: number
  totalCostUsd: number
  cacheSize: number
  globalRateLimit: { callsInLastHour: number; limit: number }
  circuitBreaker: { isOpen: boolean; consecutiveFailures: number; trippedAt: Date | null }
} {
  // Clean up global timestamps for accurate count
  const cleanedGlobal = cleanupSlidingWindow(globalCallTimestamps, 60 * 60 * 1000)

  return {
    totalCalls: totalAICalls,
    totalTokens: totalAITokens,
    totalCostUsd: totalAICostUsd,
    cacheSize: classificationCache.size,
    globalRateLimit: {
      callsInLastHour: cleanedGlobal.length,
      limit: MAX_CALLS_GLOBAL_PER_HOUR,
    },
    circuitBreaker: {
      isOpen: isCircuitBreakerOpen(),
      consecutiveFailures,
      trippedAt: circuitBreakerTrippedAt ? new Date(circuitBreakerTrippedAt) : null,
    },
  }
}

/**
 * Reset metrics (for testing).
 * @internal
 */
export function resetAIMetrics(): void {
  totalAICalls = 0
  totalAITokens = 0
  totalAICostUsd = 0
  // Reset sliding window rate limits (party-mode review: Winston)
  globalCallTimestamps.length = 0
  groupRateLimits.clear()
  classificationCache.clear()
  // Reset circuit breaker (party-mode review: Murat)
  consecutiveFailures = 0
  circuitBreakerTrippedAt = null
}
