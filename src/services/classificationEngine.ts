/**
 * Classification Engine - Unified OTC Message Classification
 *
 * This module orchestrates the complete message classification pipeline:
 * 1. Rules-based classification (fast, free, always runs first)
 * 2. AI-assisted classification (when rules are uncertain)
 * 3. Result aggregation and confidence adjustment
 *
 * The engine ensures:
 * - Minimum latency: AI is only invoked when necessary
 * - Cost control: Rate limits and caching prevent excessive API calls
 * - Accuracy: AI can override rules when confidence warrants it
 * - Observability: All decisions are logged for analysis
 *
 * Usage:
 * ```typescript
 * const result = await classifyOTCMessage({
 *   message: 'trava 5000',
 *   groupId: 'group@g.us',
 *   senderJid: 'user@s.whatsapp.net',
 *   isFromBot: false,
 *   hasReceipt: false,
 *   hasTronscan: false,
 *   hasPriceTrigger: false,
 *   inActiveThread: true,
 * })
 * ```
 */

import { logger } from '../utils/logger.js'
import {
  classifyMessage,
  type ClassificationResult,
  type ClassificationContext,
  type OTCMessageType,
  type ConfidenceLevel,
} from './messageClassifier.js'
import {
  classifyWithAI,
  shouldUseAI,
  containsSensitiveData,
  getAIMetrics,
  type AIClassificationResponse,
  type ConversationMessage,
  type GroupProfile,
} from './aiClassifier.js'
import { getConfig } from '../config.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Full classification request with all context.
 */
export interface ClassificationRequest {
  /** Message content */
  message: string
  /** Group ID (JID) */
  groupId: string
  /** Sender JID */
  senderJid: string
  /** Sender display name */
  senderName?: string
  /** Message timestamp */
  timestamp?: Date
  /** Is this message from our bot? */
  isFromBot: boolean
  /** Does message have receipt attachment? */
  hasReceipt: boolean
  /** Does message contain tronscan link? */
  hasTronscan: boolean
  /** Does message have price trigger keyword? */
  hasPriceTrigger: boolean
  /** Is there an active thread in this group? */
  inActiveThread?: boolean
  /** Recent conversation history for AI context */
  conversationHistory?: ConversationMessage[]
  /** Group behavior profile */
  groupProfile?: GroupProfile
  /** Force AI classification (bypass rules) */
  forceAI?: boolean
  /** Skip AI classification (rules only) */
  skipAI?: boolean
}

/**
 * Enhanced classification result with source tracking.
 */
export interface EnhancedClassificationResult {
  /** Final message type */
  messageType: OTCMessageType
  /** Confidence level */
  confidence: ConfidenceLevel
  /** Pattern that triggered classification */
  triggerPattern: string | null
  /** Extracted BRL volume */
  volumeBrl: number | null
  /** Extracted USDT volume */
  volumeUsdt: number | null
  /** Classification source */
  source: 'rules' | 'ai' | 'rules+ai'
  /** AI reasoning (if AI was used) */
  aiReasoning?: string
  /** AI suggested action */
  suggestedAction?: 'respond' | 'observe' | 'escalate'
  /** Additional extracted data from AI */
  aiExtractedData?: {
    rate?: number
    intent?: 'buy' | 'sell' | 'inquiry' | 'unknown'
  }
  /** Processing time in ms */
  processingTimeMs: number
  /** Was AI invoked? */
  aiUsed: boolean
  /** AI invocation reason (if applicable) */
  aiInvocationReason?: string
}

// =============================================================================
// Group Profiles
// =============================================================================

/**
 * Default group profiles based on behavioral analysis.
 * These can be overridden per-group via configuration.
 */
const DEFAULT_GROUP_PROFILES: Record<string, Partial<GroupProfile>> = {
  // Pattern matching for Liqd groups - full transaction flow
  'liqd': {
    primaryLanguage: 'pt',
    commonPatterns: ['trava', '/compra', '/saldo', 'Compra Registrada'],
  },
  // Pattern matching for Lumina - English speakers
  'lumina': {
    primaryLanguage: 'en',
    commonPatterns: ['price?', 'tx pls', 'rate'],
  },
  // Pattern matching for B2T - complex calculations
  'b2t': {
    primaryLanguage: 'pt',
    commonPatterns: ['multi-line calculations', 'large volumes'],
  },
  // Pattern matching for Speeddway - EUR operations
  'speeddway': {
    primaryLanguage: 'pt',
    commonPatterns: ['EUR', 'euro', 'invoice'],
  },
}

/**
 * Get group profile based on group name.
 */
function getGroupProfile(groupId: string, groupName?: string): GroupProfile | undefined {
  if (!groupName) return undefined

  const normalizedName = groupName.toLowerCase()

  for (const [pattern, profile] of Object.entries(DEFAULT_GROUP_PROFILES)) {
    if (normalizedName.includes(pattern)) {
      return {
        name: groupName,
        primaryLanguage: profile.primaryLanguage ?? 'pt',
        commonPatterns: profile.commonPatterns ?? [],
        activeOperators: [],
      }
    }
  }

  return undefined
}

// =============================================================================
// Main Classification Function
// =============================================================================

/**
 * Classify an OTC message using the full pipeline.
 *
 * Pipeline:
 * 1. Run rules-based classification (always)
 * 2. Check if AI should be invoked
 * 3. If AI needed, call OpenRouter Haiku
 * 4. Merge results and determine final classification
 *
 * @param request - Full classification request
 * @returns Enhanced classification result
 */
export async function classifyOTCMessage(
  request: ClassificationRequest
): Promise<EnhancedClassificationResult> {
  const startTime = Date.now()

  // Build rules context
  const rulesContext: ClassificationContext = {
    isFromBot: request.isFromBot,
    hasReceipt: request.hasReceipt,
    hasTronscan: request.hasTronscan,
    hasPriceTrigger: request.hasPriceTrigger,
    inActiveThread: request.inActiveThread,
  }

  // Step 1: Rules-based classification (always runs)
  const rulesResult = classifyMessage(request.message, rulesContext)

  // If skipAI is set, return rules result immediately
  if (request.skipAI) {
    const result: EnhancedClassificationResult = {
      ...rulesResult,
      source: 'rules',
      processingTimeMs: Date.now() - startTime,
      aiUsed: false,
    }
    recordMetrics(result)
    return result
  }

  // Step 2: Determine if AI should be invoked
  const config = getConfig()
  const aiConfigured = !!config.OPENROUTER_API_KEY

  let useAI = false
  let aiInvocationReason: string | undefined

  if (request.forceAI && aiConfigured) {
    useAI = true
    aiInvocationReason = 'forced'
  } else if (aiConfigured && shouldUseAI(rulesResult, request.message, request.isFromBot)) {
    // Don't use AI for sensitive data
    if (!containsSensitiveData(request.message)) {
      useAI = true
      aiInvocationReason = rulesResult.messageType === 'general'
        ? 'low_confidence_general'
        : 'low_confidence'
    } else {
      aiInvocationReason = 'skipped_sensitive_data'
    }
  }

  // Step 3: If not using AI, return rules result
  if (!useAI) {
    const processingTimeMs = Date.now() - startTime

    logger.debug('Classification completed (rules only)', {
      event: 'classification_rules_only',
      groupId: request.groupId,
      messageType: rulesResult.messageType,
      confidence: rulesResult.confidence,
      processingTimeMs,
    })

    const result: EnhancedClassificationResult = {
      ...rulesResult,
      source: 'rules',
      processingTimeMs,
      aiUsed: false,
      aiInvocationReason,
    }
    recordMetrics(result)
    return result
  }

  // Step 4: Invoke AI classification
  logger.debug('Invoking AI classification', {
    event: 'classification_ai_invoke',
    groupId: request.groupId,
    reason: aiInvocationReason,
    rulesType: rulesResult.messageType,
    rulesConfidence: rulesResult.confidence,
  })

  const groupProfile = request.groupProfile ?? getGroupProfile(request.groupId)

  const aiResult = await classifyWithAI({
    message: request.message,
    groupId: request.groupId,
    senderJid: request.senderJid,
    senderName: request.senderName,
    conversationHistory: request.conversationHistory,
    groupProfile,
    rulesResult,
  })

  const processingTimeMs = Date.now() - startTime

  // Step 5: Handle AI failure - fall back to rules
  if (!aiResult.ok) {
    logger.warn('AI classification failed, using rules result', {
      event: 'classification_ai_fallback',
      groupId: request.groupId,
      error: aiResult.error,
      rulesType: rulesResult.messageType,
      processingTimeMs,
    })

    const result: EnhancedClassificationResult = {
      ...rulesResult,
      source: 'rules',
      processingTimeMs,
      aiUsed: true,
      aiInvocationReason: `${aiInvocationReason}_failed`,
    }
    recordMetrics(result)
    return result
  }

  // Step 6: Merge AI result with rules result
  const aiResponse = aiResult.data
  const finalResult = mergeClassificationResults(rulesResult, aiResponse)

  logger.info('Classification completed (rules+AI)', {
    event: 'classification_ai_complete',
    groupId: request.groupId,
    rulesType: rulesResult.messageType,
    rulesConfidence: rulesResult.confidence,
    aiType: aiResponse.messageType,
    aiConfidence: aiResponse.confidence,
    finalType: finalResult.messageType,
    finalConfidence: finalResult.confidence,
    processingTimeMs,
  })

  const result: EnhancedClassificationResult = {
    ...finalResult,
    processingTimeMs,
    aiUsed: true,
    aiInvocationReason,
  }
  recordMetrics(result)
  return result
}

// =============================================================================
// Result Merging
// =============================================================================

/**
 * Merge rules-based and AI classification results.
 *
 * Merge strategy:
 * 1. If AI has high confidence, prefer AI result
 * 2. If AI and rules agree, boost confidence
 * 3. If they disagree with low confidence, prefer rules
 * 4. Extract volumes from both, prefer non-null
 */
function mergeClassificationResults(
  rulesResult: ClassificationResult,
  aiResponse: AIClassificationResponse
): EnhancedClassificationResult {
  // Determine which classification to use
  let finalType: OTCMessageType
  let finalConfidence: ConfidenceLevel
  let source: 'rules' | 'ai' | 'rules+ai'

  if (rulesResult.messageType === aiResponse.messageType) {
    // Agreement - boost confidence
    finalType = aiResponse.messageType
    finalConfidence = boostConfidence(aiResponse.confidence)
    source = 'rules+ai'
  } else if (aiResponse.confidence === 'high') {
    // AI is confident, use AI
    finalType = aiResponse.messageType
    finalConfidence = aiResponse.confidence
    source = 'ai'
  } else if (rulesResult.confidence === 'high') {
    // Rules is confident, use rules
    finalType = rulesResult.messageType
    finalConfidence = rulesResult.confidence
    source = 'rules'
  } else {
    // Both uncertain - prefer AI for general, rules for specific
    if (rulesResult.messageType === 'general' && aiResponse.messageType !== 'general') {
      finalType = aiResponse.messageType
      finalConfidence = aiResponse.confidence
      source = 'ai'
    } else {
      finalType = rulesResult.messageType
      finalConfidence = rulesResult.confidence
      source = 'rules+ai'
    }
  }

  // Merge volumes - prefer non-null, then AI
  const volumeBrl = rulesResult.volumeBrl
    ?? aiResponse.extractedData?.volumeBrl
    ?? null
  const volumeUsdt = rulesResult.volumeUsdt
    ?? aiResponse.extractedData?.volumeUsdt
    ?? null

  return {
    messageType: finalType,
    confidence: finalConfidence,
    triggerPattern: rulesResult.triggerPattern,
    volumeBrl,
    volumeUsdt,
    source,
    aiReasoning: aiResponse.reasoning,
    suggestedAction: aiResponse.suggestedAction,
    aiExtractedData: aiResponse.extractedData ? {
      rate: aiResponse.extractedData.rate ?? undefined,
      intent: aiResponse.extractedData.intent ?? undefined,
    } : undefined,
    processingTimeMs: 0, // Set by caller
    aiUsed: true,
  }
}

/**
 * Boost confidence level when rules and AI agree.
 */
function boostConfidence(confidence: ConfidenceLevel): ConfidenceLevel {
  switch (confidence) {
    case 'low':
      return 'medium'
    case 'medium':
      return 'high'
    case 'high':
      return 'high'
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Quick classification without AI (for high-volume scenarios).
 * Use this when you need fast classification and AI isn't necessary.
 */
export function classifyQuick(
  message: string,
  context: ClassificationContext
): ClassificationResult {
  return classifyMessage(message, context)
}

/**
 * Check if OpenRouter is configured and AI classification is available.
 */
export function isAIClassificationAvailable(): boolean {
  try {
    const config = getConfig()
    return !!config.OPENROUTER_API_KEY
  } catch {
    return false
  }
}

// =============================================================================
// Production Metrics (party-mode review: Winston)
// =============================================================================

/** Track classification distribution for monitoring */
const classificationCounts: Record<string, number> = {}
const sourceDistribution: Record<string, number> = { rules: 0, ai: 0, 'rules+ai': 0 }
let totalClassifications = 0
let totalProcessingTimeMs = 0
const latencyBuckets: number[] = [] // Store last 100 latencies for percentile calculation

/**
 * Record classification metrics.
 * @internal
 */
function recordMetrics(result: EnhancedClassificationResult): void {
  // Classification type distribution
  classificationCounts[result.messageType] = (classificationCounts[result.messageType] || 0) + 1

  // Source distribution
  sourceDistribution[result.source]++

  // Totals
  totalClassifications++
  totalProcessingTimeMs += result.processingTimeMs

  // Latency tracking (keep last 100 for percentile calculation)
  latencyBuckets.push(result.processingTimeMs)
  if (latencyBuckets.length > 100) {
    latencyBuckets.shift()
  }
}

/**
 * Calculate percentile from sorted array.
 */
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const index = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, index)]
}

/**
 * Get production metrics for monitoring.
 * Party-mode review: Winston identified need for production instrumentation.
 *
 * @returns Comprehensive metrics object for monitoring dashboards
 */
export function getClassificationMetrics(): {
  totalClassifications: number
  classificationDistribution: Record<string, number>
  sourceDistribution: Record<string, number>
  averageProcessingTimeMs: number
  latencyPercentiles: {
    p50: number
    p90: number
    p95: number
    p99: number
  }
  aiMetrics: ReturnType<typeof getAIMetrics>
} {
  const aiMetrics = getAIMetrics()

  return {
    totalClassifications,
    classificationDistribution: { ...classificationCounts },
    sourceDistribution: { ...sourceDistribution },
    averageProcessingTimeMs: totalClassifications > 0
      ? totalProcessingTimeMs / totalClassifications
      : 0,
    latencyPercentiles: {
      p50: percentile(latencyBuckets, 50),
      p90: percentile(latencyBuckets, 90),
      p95: percentile(latencyBuckets, 95),
      p99: percentile(latencyBuckets, 99),
    },
    aiMetrics,
  }
}

/**
 * Reset classification metrics (for testing).
 * @internal
 */
export function resetClassificationMetrics(): void {
  Object.keys(classificationCounts).forEach(key => delete classificationCounts[key])
  sourceDistribution.rules = 0
  sourceDistribution.ai = 0
  sourceDistribution['rules+ai'] = 0
  totalClassifications = 0
  totalProcessingTimeMs = 0
  latencyBuckets.length = 0
}
