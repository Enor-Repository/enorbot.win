/**
 * Active Quotes Service with State Machine
 * Tracks quotes from price send until acceptance/cancellation/expiry.
 * Speed-critical: in-memory store with formal state machine for race condition safety.
 */
import { logger } from '../utils/logger.js'

/**
 * Quote status states - formal state machine.
 * Transitions:
 *   pending -> repricing, accepted, expired
 *   repricing -> pending, accepted
 *   accepted -> (terminal)
 *   expired -> (terminal)
 */
export type QuoteStatus = 'pending' | 'repricing' | 'accepted' | 'expired'

/**
 * Price source for the quote - determines which API to monitor for volatility.
 */
export type PriceSource = 'usdt_brl' | 'commercial_dollar'

/**
 * Active quote structure.
 */
export interface ActiveQuote {
  id: string
  groupJid: string
  quotedPrice: number
  quotedAt: Date
  repriceCount: number
  status: QuoteStatus
  /** The price source used (usdt_brl or commercial_dollar) */
  priceSource: PriceSource
  /** The raw base price before spread was applied */
  basePrice: number
}

/**
 * State machine transition result.
 */
export type TransitionResult =
  | { ok: true; newStatus: QuoteStatus }
  | { ok: false; reason: 'not_found' | 'invalid_transition' | 'already_terminal' | 'locked' }

/**
 * Valid state transitions map.
 */
const VALID_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  pending: ['repricing', 'accepted', 'expired'],
  repricing: ['pending', 'accepted'], // accepted always wins
  accepted: [], // terminal
  expired: [], // terminal
}

/**
 * Default TTL for active quotes (5 minutes).
 */
const DEFAULT_QUOTE_TTL_MS = 5 * 60 * 1000

// In-memory store: one quote per group
const quotes = new Map<string, ActiveQuote>()

// Session-unique counter (combined with timestamp for crash-safe IDs)
let sessionCounter = 0

/**
 * Generate a crash-safe quote ID using timestamp + session counter.
 * Format: quote_<timestamp>_<counter> ensures uniqueness across restarts.
 */
function generateQuoteId(): string {
  return `quote_${Date.now()}_${++sessionCounter}`
}

/**
 * Options for creating a quote with price source tracking.
 */
export interface CreateQuoteOptions {
  /** The price source used (defaults to 'usdt_brl') */
  priceSource?: PriceSource
  /** The raw base price before spread was applied (defaults to quotedPrice) */
  basePrice?: number
}

/**
 * Create a new active quote for a group.
 * Replaces any existing quote for that group.
 *
 * @param groupJid - The group JID
 * @param price - The final quoted price (after spread)
 * @param options - Optional price source and base price for volatility monitoring
 */
export function createQuote(groupJid: string, price: number, options?: CreateQuoteOptions): ActiveQuote {
  const priceSource = options?.priceSource ?? 'usdt_brl'
  const basePrice = options?.basePrice ?? price

  const quote: ActiveQuote = {
    id: generateQuoteId(),
    groupJid,
    quotedPrice: price,
    quotedAt: new Date(),
    repriceCount: 0,
    status: 'pending',
    priceSource,
    basePrice,
  }

  quotes.set(groupJid, quote)

  logger.info('Active quote created', {
    event: 'quote_created',
    quoteId: quote.id,
    groupJid,
    price,
    priceSource,
    basePrice,
  })

  return quote
}

/**
 * Get the active quote for a group.
 * Returns null if no active quote exists.
 */
export function getActiveQuote(groupJid: string): ActiveQuote | null {
  return quotes.get(groupJid) ?? null
}

/**
 * Attempt a state transition using the state machine.
 * Returns failure if transition is invalid.
 */
export function transitionTo(groupJid: string, targetStatus: QuoteStatus): TransitionResult {
  const quote = quotes.get(groupJid)
  if (!quote) {
    return { ok: false, reason: 'not_found' }
  }

  // Check if current status is terminal
  if (quote.status === 'accepted' || quote.status === 'expired') {
    return { ok: false, reason: 'already_terminal' }
  }

  // Check if transition is valid
  if (!VALID_TRANSITIONS[quote.status].includes(targetStatus)) {
    return { ok: false, reason: 'invalid_transition' }
  }

  const previousStatus = quote.status
  quote.status = targetStatus

  logger.info('Quote status transitioned', {
    event: 'quote_transition',
    quoteId: quote.id,
    groupJid,
    from: previousStatus,
    to: targetStatus,
  })

  return { ok: true, newStatus: targetStatus }
}

/**
 * Try to lock a quote for repricing.
 * Returns false if already repricing (prevents concurrent reprices).
 * CRITICAL: This is the locking mechanism for race condition safety.
 */
export function tryLockForReprice(groupJid: string): boolean {
  const quote = quotes.get(groupJid)
  if (!quote) return false

  // Can only lock if pending
  if (quote.status !== 'pending') {
    logger.debug('Cannot lock quote for reprice', {
      event: 'reprice_lock_failed',
      groupJid,
      currentStatus: quote.status,
    })
    return false
  }

  const result = transitionTo(groupJid, 'repricing')
  return result.ok
}

/**
 * Unlock after reprice completes - update price and return to pending.
 */
export function unlockAfterReprice(groupJid: string, newPrice: number): void {
  const quote = quotes.get(groupJid)
  if (!quote || quote.status !== 'repricing') return

  quote.quotedPrice = newPrice
  quote.quotedAt = new Date()
  quote.status = 'pending'

  logger.info('Quote updated after reprice', {
    event: 'quote_repriced',
    quoteId: quote.id,
    groupJid,
    newPrice,
    repriceCount: quote.repriceCount,
  })
}

/**
 * Force accept a quote - ALWAYS succeeds, even during repricing.
 * CRITICAL: Customer acceptance takes priority over everything.
 */
export function forceAccept(groupJid: string): void {
  const quote = quotes.get(groupJid)
  if (!quote) return

  // Terminal states can't be changed
  if (quote.status === 'accepted' || quote.status === 'expired') {
    logger.debug('Quote already in terminal state', {
      event: 'force_accept_ignored',
      groupJid,
      currentStatus: quote.status,
    })
    return
  }

  const previousStatus = quote.status
  quote.status = 'accepted'

  logger.info('Quote force accepted', {
    event: 'quote_accepted',
    quoteId: quote.id,
    groupJid,
    previousStatus,
    repriceCount: quote.repriceCount,
  })

  // Remove from active quotes - deal is done
  quotes.delete(groupJid)
}

/**
 * Increment reprice count and return new count.
 */
export function incrementRepriceCount(groupJid: string): number {
  const quote = quotes.get(groupJid)
  if (!quote) return 0

  quote.repriceCount++

  logger.info('Quote reprice count incremented', {
    event: 'reprice_count_incremented',
    quoteId: quote.id,
    groupJid,
    repriceCount: quote.repriceCount,
  })

  return quote.repriceCount
}

/**
 * Expire old quotes based on TTL.
 * Called periodically from boot sequence.
 */
export function expireOldQuotes(ttlMs: number = DEFAULT_QUOTE_TTL_MS): void {
  const now = Date.now()
  let expiredCount = 0

  for (const [groupJid, quote] of quotes) {
    // Skip terminal states or repricing
    if (quote.status === 'accepted' || quote.status === 'expired' || quote.status === 'repricing') {
      continue
    }

    const age = now - quote.quotedAt.getTime()
    if (age >= ttlMs) {
      quote.status = 'expired'
      expiredCount++

      logger.info('Quote expired', {
        event: 'quote_expired',
        quoteId: quote.id,
        groupJid,
        ageMs: age,
      })

      // Remove expired quote
      quotes.delete(groupJid)
    }
  }

  if (expiredCount > 0) {
    logger.info('Expired old quotes', {
      event: 'quotes_cleanup',
      expiredCount,
      remainingCount: quotes.size,
    })
  }
}

/**
 * Get count of active quotes (for dashboard).
 */
export function getActiveQuoteCount(): number {
  return quotes.size
}

/**
 * Get all active quotes (for dashboard).
 */
export function getAllActiveQuotes(): ActiveQuote[] {
  return Array.from(quotes.values())
}

// For testing - reset module state
export function _resetForTesting(): void {
  quotes.clear()
  sessionCounter = 0
}
