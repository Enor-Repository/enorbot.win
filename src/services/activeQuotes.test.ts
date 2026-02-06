import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({ logger: mockLogger }))

import {
  createQuote,
  getActiveQuote,
  transitionTo,
  tryLockForReprice,
  unlockAfterReprice,
  forceAccept,
  incrementRepriceCount,
  expireOldQuotes,
  getActiveQuoteCount,
  getAllActiveQuotes,
  _resetForTesting,
} from './activeQuotes.js'

describe('activeQuotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetForTesting()
  })

  describe('createQuote', () => {
    it('creates a new quote with pending status', () => {
      const quote = createQuote('group1@g.us', 5.2650)

      expect(quote.groupJid).toBe('group1@g.us')
      expect(quote.quotedPrice).toBe(5.2650)
      expect(quote.status).toBe('pending')
      expect(quote.repriceCount).toBe(0)
    })

    it('defaults to usdt_brl price source and uses quotedPrice as basePrice', () => {
      const quote = createQuote('group1@g.us', 5.2650)

      expect(quote.priceSource).toBe('usdt_brl')
      expect(quote.basePrice).toBe(5.2650)
    })

    it('accepts custom price source and base price', () => {
      const quote = createQuote('group1@g.us', 5.2900, {
        priceSource: 'commercial_dollar',
        basePrice: 5.2800,
      })

      expect(quote.priceSource).toBe('commercial_dollar')
      expect(quote.basePrice).toBe(5.2800)
      expect(quote.quotedPrice).toBe(5.2900) // Final price after spread
    })

    it('replaces existing quote for same group', () => {
      createQuote('group1@g.us', 5.2650)
      const quote2 = createQuote('group1@g.us', 5.2700)

      expect(getActiveQuoteCount()).toBe(1)
      expect(getActiveQuote('group1@g.us')?.quotedPrice).toBe(5.2700)
    })

    it('logs quote creation with price source', () => {
      createQuote('group1@g.us', 5.2650, { priceSource: 'commercial_dollar', basePrice: 5.26 })

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Active quote created',
        expect.objectContaining({
          event: 'quote_created',
          groupJid: 'group1@g.us',
          price: 5.2650,
          priceSource: 'commercial_dollar',
          basePrice: 5.26,
        })
      )
    })
  })

  describe('getActiveQuote', () => {
    it('returns quote if exists', () => {
      createQuote('group1@g.us', 5.2650)
      const quote = getActiveQuote('group1@g.us')

      expect(quote).not.toBeNull()
      expect(quote?.quotedPrice).toBe(5.2650)
    })

    it('returns null if no quote exists', () => {
      expect(getActiveQuote('nonexistent@g.us')).toBeNull()
    })
  })

  describe('state machine transitions', () => {
    it('allows pending -> repricing', () => {
      createQuote('group1@g.us', 5.2650)
      const result = transitionTo('group1@g.us', 'repricing')

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.newStatus).toBe('repricing')
    })

    it('allows pending -> accepted', () => {
      createQuote('group1@g.us', 5.2650)
      const result = transitionTo('group1@g.us', 'accepted')

      expect(result.ok).toBe(true)
    })

    it('allows pending -> expired', () => {
      createQuote('group1@g.us', 5.2650)
      const result = transitionTo('group1@g.us', 'expired')

      expect(result.ok).toBe(true)
    })

    it('allows repricing -> pending', () => {
      createQuote('group1@g.us', 5.2650)
      transitionTo('group1@g.us', 'repricing')
      const result = transitionTo('group1@g.us', 'pending')

      expect(result.ok).toBe(true)
    })

    it('allows repricing -> accepted (critical: acceptance wins)', () => {
      createQuote('group1@g.us', 5.2650)
      transitionTo('group1@g.us', 'repricing')
      const result = transitionTo('group1@g.us', 'accepted')

      expect(result.ok).toBe(true)
    })

    it('rejects transition from terminal state (accepted)', () => {
      createQuote('group1@g.us', 5.2650)
      transitionTo('group1@g.us', 'accepted')
      const result = transitionTo('group1@g.us', 'pending')

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe('already_terminal')
    })

    it('rejects invalid transition (repricing -> expired)', () => {
      createQuote('group1@g.us', 5.2650)
      transitionTo('group1@g.us', 'repricing')
      const result = transitionTo('group1@g.us', 'expired')

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe('invalid_transition')
    })

    it('returns not_found for nonexistent quote', () => {
      const result = transitionTo('nonexistent@g.us', 'accepted')

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe('not_found')
    })
  })

  describe('tryLockForReprice', () => {
    it('returns true and locks quote if pending', () => {
      createQuote('group1@g.us', 5.2650)
      const locked = tryLockForReprice('group1@g.us')

      expect(locked).toBe(true)
      expect(getActiveQuote('group1@g.us')?.status).toBe('repricing')
    })

    it('returns false if already repricing (prevents concurrent reprices)', () => {
      createQuote('group1@g.us', 5.2650)
      expect(tryLockForReprice('group1@g.us')).toBe(true) // First lock
      expect(tryLockForReprice('group1@g.us')).toBe(false) // Second fails
    })

    it('returns false for nonexistent quote', () => {
      expect(tryLockForReprice('nonexistent@g.us')).toBe(false)
    })

    it('returns false if quote is accepted', () => {
      createQuote('group1@g.us', 5.2650)
      transitionTo('group1@g.us', 'accepted')
      expect(tryLockForReprice('group1@g.us')).toBe(false)
    })
  })

  describe('unlockAfterReprice', () => {
    it('updates price and returns to pending', () => {
      createQuote('group1@g.us', 5.2650)
      tryLockForReprice('group1@g.us')
      unlockAfterReprice('group1@g.us', 5.2700)

      const quote = getActiveQuote('group1@g.us')
      expect(quote?.status).toBe('pending')
      expect(quote?.quotedPrice).toBe(5.2700)
    })

    it('does nothing if not in repricing state', () => {
      createQuote('group1@g.us', 5.2650)
      unlockAfterReprice('group1@g.us', 5.2700)

      expect(getActiveQuote('group1@g.us')?.quotedPrice).toBe(5.2650)
    })
  })

  describe('forceAccept', () => {
    it('accepts quote from pending state', () => {
      createQuote('group1@g.us', 5.2650)
      forceAccept('group1@g.us')

      // Quote should be removed after acceptance
      expect(getActiveQuote('group1@g.us')).toBeNull()
    })

    it('CRITICAL: accepts quote even during repricing', () => {
      createQuote('group1@g.us', 5.2650)
      tryLockForReprice('group1@g.us') // status = repricing
      forceAccept('group1@g.us') // MUST succeed

      expect(getActiveQuote('group1@g.us')).toBeNull()
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Quote force accepted',
        expect.objectContaining({
          event: 'quote_accepted',
          previousStatus: 'repricing',
        })
      )
    })

    it('does nothing for nonexistent quote', () => {
      forceAccept('nonexistent@g.us')
      // Should not throw
    })

    it('removes quote from store after acceptance', () => {
      createQuote('group1@g.us', 5.2650)
      expect(getActiveQuoteCount()).toBe(1)
      forceAccept('group1@g.us')
      expect(getActiveQuoteCount()).toBe(0)
    })
  })

  describe('incrementRepriceCount', () => {
    it('increments and returns new count', () => {
      createQuote('group1@g.us', 5.2650)

      expect(incrementRepriceCount('group1@g.us')).toBe(1)
      expect(incrementRepriceCount('group1@g.us')).toBe(2)
      expect(incrementRepriceCount('group1@g.us')).toBe(3)
    })

    it('returns 0 for nonexistent quote', () => {
      expect(incrementRepriceCount('nonexistent@g.us')).toBe(0)
    })
  })

  describe('expireOldQuotes', () => {
    it('expires quotes older than TTL', () => {
      createQuote('group1@g.us', 5.2650)
      const quote = getActiveQuote('group1@g.us')!

      // Set quotedAt to past
      quote.quotedAt = new Date(Date.now() - 6 * 60 * 1000) // 6 minutes ago

      expireOldQuotes(5 * 60 * 1000) // 5 minute TTL

      expect(getActiveQuote('group1@g.us')).toBeNull()
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Quote expired',
        expect.objectContaining({ event: 'quote_expired' })
      )
    })

    it('does not expire quotes within TTL', () => {
      createQuote('group1@g.us', 5.2650)

      expireOldQuotes(5 * 60 * 1000)

      expect(getActiveQuote('group1@g.us')).not.toBeNull()
    })

    it('does not expire quotes in repricing state', () => {
      createQuote('group1@g.us', 5.2650)
      const quote = getActiveQuote('group1@g.us')!
      quote.quotedAt = new Date(Date.now() - 6 * 60 * 1000)
      tryLockForReprice('group1@g.us')

      expireOldQuotes(5 * 60 * 1000)

      expect(getActiveQuote('group1@g.us')).not.toBeNull()
    })
  })

  describe('getActiveQuoteCount and getAllActiveQuotes', () => {
    it('returns correct count', () => {
      expect(getActiveQuoteCount()).toBe(0)
      createQuote('group1@g.us', 5.2650)
      expect(getActiveQuoteCount()).toBe(1)
      createQuote('group2@g.us', 5.2700)
      expect(getActiveQuoteCount()).toBe(2)
    })

    it('returns all active quotes', () => {
      createQuote('group1@g.us', 5.2650)
      createQuote('group2@g.us', 5.2700)

      const quotes = getAllActiveQuotes()
      expect(quotes).toHaveLength(2)
      expect(quotes.map((q) => q.groupJid)).toContain('group1@g.us')
      expect(quotes.map((q) => q.groupJid)).toContain('group2@g.us')
    })
  })
})
