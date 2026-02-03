/**
 * Response Suppression Service - Sprint 5, Task 5.2
 *
 * Determines whether the bot should suppress a response to avoid:
 * 1. Repeating answers (bot already responded to similar trigger recently)
 * 2. Stepping on operator (human already answered the question)
 * 3. Spamming group (cooldown period not elapsed)
 *
 * DESIGN PRINCIPLE: Conservative approach.
 * False suppression (staying silent when should respond) is WORSE than
 * responding twice. When in doubt, DON'T suppress.
 *
 * All functions return Result<T>, never throw.
 */

import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'
import {
  getRecentGroupMessages,
} from './messageHistory.js'

// ============================================================================
// Configuration
// ============================================================================

/**
 * Default cooldown in seconds between bot responses in the same group.
 * Prevents rapid-fire responses to multiple triggers.
 */
const DEFAULT_COOLDOWN_SECONDS = 10

/**
 * Maximum lookback window in minutes for "operator already answered" check.
 * Only checks recent messages to avoid stale context.
 */
const OPERATOR_LOOKBACK_MINUTES = 3

/**
 * Maximum lookback window in minutes for "bot already responded" check.
 */
const BOT_RESPONSE_LOOKBACK_MINUTES = 5

/**
 * Sender JID used for bot messages in message history.
 */
const BOT_SENDER_JID = 'bot'

// ============================================================================
// Types
// ============================================================================

/**
 * Reason why a response was suppressed.
 */
export type SuppressionReason =
  | 'bot_already_responded'
  | 'operator_answered'
  | 'cooldown_active'

/**
 * Result of checking whether to suppress a response.
 */
export interface SuppressionCheck {
  /** Whether the response should be suppressed */
  shouldSuppress: boolean
  /** Why the response was suppressed (null if not suppressed) */
  reason: SuppressionReason | null
  /** Human-readable explanation for logging */
  explanation: string
}

/**
 * Options for suppression check.
 */
export interface SuppressionOptions {
  /** Group JID to check */
  groupJid: string
  /** Sender JID (the person who sent the message) */
  senderJid: string
  /** The trigger message content */
  messageContent: string
  /** Message type of the trigger (e.g., 'price_response') */
  triggerType?: string
  /** Custom cooldown in seconds (overrides default) */
  cooldownSeconds?: number
  /** Skip operator check (e.g., for control group messages) */
  skipOperatorCheck?: boolean
}

// ============================================================================
// In-Memory Cooldown Tracking
// ============================================================================

/**
 * Tracks last bot response time per group.
 * In-memory only - resets on restart (safe default: no suppression after restart).
 * Eviction: entries older than MAX_COOLDOWN_AGE_MS are pruned on every write
 * to prevent unbounded growth.
 */
const lastResponseByGroup: Map<string, number> = new Map()

/** Max entries before forced eviction of stale entries */
const MAX_COOLDOWN_ENTRIES = 500

/** Stale threshold: entries older than 10 minutes are safe to evict */
const MAX_COOLDOWN_AGE_MS = 10 * 60 * 1000

/**
 * Evict stale cooldown entries to prevent unbounded Map growth.
 * Runs on each recordBotResponse call (O(n) but n is small).
 */
function evictStaleCooldowns(): void {
  if (lastResponseByGroup.size <= MAX_COOLDOWN_ENTRIES) return
  const now = Date.now()
  for (const [key, timestamp] of lastResponseByGroup) {
    if (now - timestamp > MAX_COOLDOWN_AGE_MS) {
      lastResponseByGroup.delete(key)
    }
  }
}

/**
 * Record that the bot responded in a group.
 * Called after successfully sending a response.
 */
export function recordBotResponse(groupJid: string): void {
  lastResponseByGroup.set(groupJid, Date.now())
  evictStaleCooldowns()
}

/**
 * Reset cooldown state (for testing).
 * @internal
 */
export function resetSuppressionState(): void {
  lastResponseByGroup.clear()
}

// ============================================================================
// Suppression Logic
// ============================================================================

/**
 * Check if the bot should suppress a response.
 *
 * Checks in order (cheapest first):
 * 1. Cooldown check (in-memory, instant)
 * 2. Bot already responded check (DB query)
 * 3. Operator already answered check (DB query)
 *
 * Any check failure (DB error) results in NOT suppressing.
 * Conservative: if we can't determine context, respond anyway.
 *
 * @param options - Suppression check parameters
 * @returns SuppressionCheck result
 */
export async function shouldSuppressResponse(
  options: SuppressionOptions
): Promise<SuppressionCheck> {
  const {
    groupJid,
    senderJid,
    cooldownSeconds = DEFAULT_COOLDOWN_SECONDS,
    skipOperatorCheck = false,
  } = options

  // Check 1: Cooldown (in-memory, instant, no DB)
  const cooldownResult = checkCooldown(groupJid, cooldownSeconds)
  if (cooldownResult.shouldSuppress) {
    logger.debug('Response suppressed: cooldown active', {
      event: 'suppression_cooldown',
      groupJid,
      senderJid,
    })
    return cooldownResult
  }

  // Check 2: Bot already responded recently
  const botCheckResult = await checkBotAlreadyResponded(groupJid)
  if (botCheckResult.shouldSuppress) {
    logger.debug('Response suppressed: bot already responded', {
      event: 'suppression_bot_responded',
      groupJid,
      senderJid,
    })
    return botCheckResult
  }

  // Check 3: Operator already answered (skip for control group)
  if (!skipOperatorCheck) {
    const operatorCheckResult = await checkOperatorAnswered(groupJid, senderJid)
    if (operatorCheckResult.shouldSuppress) {
      logger.debug('Response suppressed: operator already answered', {
        event: 'suppression_operator_answered',
        groupJid,
        senderJid,
      })
      return operatorCheckResult
    }
  }

  // No suppression needed
  return {
    shouldSuppress: false,
    reason: null,
    explanation: 'No suppression conditions met',
  }
}

/**
 * Check if cooldown period has elapsed since last bot response in this group.
 * Pure in-memory check, no DB query.
 */
function checkCooldown(groupJid: string, cooldownSeconds: number): SuppressionCheck {
  const lastResponse = lastResponseByGroup.get(groupJid)

  if (lastResponse === undefined) {
    return { shouldSuppress: false, reason: null, explanation: 'No previous response recorded' }
  }

  const elapsedMs = Date.now() - lastResponse
  const cooldownMs = cooldownSeconds * 1000

  if (elapsedMs < cooldownMs) {
    const remainingSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000)
    return {
      shouldSuppress: true,
      reason: 'cooldown_active',
      explanation: `Cooldown active: ${remainingSeconds}s remaining`,
    }
  }

  return { shouldSuppress: false, reason: null, explanation: 'Cooldown elapsed' }
}

/**
 * Check if bot already responded to a trigger in this group recently.
 * Uses message history to look for recent bot messages with price_response type.
 *
 * Conservative: DB errors → don't suppress (respond anyway).
 */
async function checkBotAlreadyResponded(groupJid: string): Promise<SuppressionCheck> {
  const since = new Date(Date.now() - BOT_RESPONSE_LOOKBACK_MINUTES * 60 * 1000)

  const result = await getRecentGroupMessages(groupJid, 5, { botOnly: true, since })

  if (!result.ok) {
    // DB error → conservative: don't suppress
    logger.warn('Bot response check failed, not suppressing', {
      event: 'suppression_check_error',
      groupJid,
      error: result.error,
    })
    return { shouldSuppress: false, reason: null, explanation: 'DB check failed, not suppressing' }
  }

  const recentBotMessages = result.data

  // Check if bot sent a price_response type message recently
  const hasPriceResponse = recentBotMessages.some(
    (m) => m.message_type === 'price_response'
  )

  if (hasPriceResponse) {
    return {
      shouldSuppress: true,
      reason: 'bot_already_responded',
      explanation: `Bot already sent price_response in last ${BOT_RESPONSE_LOOKBACK_MINUTES} minutes`,
    }
  }

  return { shouldSuppress: false, reason: null, explanation: 'No recent bot price response' }
}

/**
 * Check if an operator (non-bot, non-sender) responded in the group recently.
 * This avoids the bot stepping on a human operator who already answered.
 *
 * Conservative: DB errors → don't suppress (respond anyway).
 * Conservative: Only suppresses if operator message appears AFTER the sender's trigger.
 */
async function checkOperatorAnswered(
  groupJid: string,
  senderJid: string
): Promise<SuppressionCheck> {
  const since = new Date(Date.now() - OPERATOR_LOOKBACK_MINUTES * 60 * 1000)

  const result = await getRecentGroupMessages(groupJid, 20, { since })

  if (!result.ok) {
    // DB error → conservative: don't suppress
    logger.warn('Operator check failed, not suppressing', {
      event: 'suppression_operator_check_error',
      groupJid,
      error: result.error,
    })
    return { shouldSuppress: false, reason: null, explanation: 'DB check failed, not suppressing' }
  }

  const recentMessages = result.data

  // Find the most recent trigger from this sender.
  // Note: recentMessages is sorted newest-first, so Array.find() returns the
  // latest trigger. If multiple trigger→response cycles occur within the
  // 3-minute window, only the most recent trigger is evaluated. This is
  // acceptable: the narrow window makes multi-cycle scenarios extremely
  // unlikely in real OTC conversations.
  const senderTrigger = recentMessages.find(
    (m) => m.sender_jid === senderJid && m.is_trigger
  )

  if (!senderTrigger) {
    // No trigger from sender found - can't determine context
    return { shouldSuppress: false, reason: null, explanation: 'No sender trigger found in window' }
  }

  const triggerTime = new Date(senderTrigger.created_at)

  // Check if any non-bot, non-sender message came AFTER the trigger
  // This indicates an operator responded to the client's question
  const operatorResponse = recentMessages.find((m) => {
    if (m.sender_jid === senderJid) return false  // Skip sender's own messages
    if (m.sender_jid === BOT_SENDER_JID) return false  // Skip bot messages
    if (m.is_from_bot) return false  // Double-check: skip any bot messages

    const messageTime = new Date(m.created_at)
    return messageTime > triggerTime  // Must be AFTER the trigger
  })

  if (operatorResponse) {
    return {
      shouldSuppress: true,
      reason: 'operator_answered',
      explanation: `Operator ${operatorResponse.sender_jid} responded after sender's trigger`,
    }
  }

  return { shouldSuppress: false, reason: null, explanation: 'No operator response after trigger' }
}
