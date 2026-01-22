import { describe, it, expect } from 'vitest'
import { isPriceTrigger, PRICE_TRIGGER_KEYWORDS } from './triggers.js'

describe('isPriceTrigger', () => {
  // AC1: "preço" keyword detection
  describe('preço keyword detection', () => {
    it('detects "preço" (lowercase)', () => {
      expect(isPriceTrigger('preço')).toBe(true)
    })

    it('detects "PREÇO" (uppercase)', () => {
      expect(isPriceTrigger('PREÇO')).toBe(true)
    })

    it('detects "Preço" (mixed case)', () => {
      expect(isPriceTrigger('Preço')).toBe(true)
    })
  })

  // AC2: "cotação" keyword detection
  describe('cotação keyword detection', () => {
    it('detects "cotação" (with cedilla)', () => {
      expect(isPriceTrigger('cotação')).toBe(true)
    })

    it('detects "COTAÇÃO" (uppercase)', () => {
      expect(isPriceTrigger('COTAÇÃO')).toBe(true)
    })

    // Task 5.6: Test without cedilla - currently NOT supported (optional tolerance)
    it('does NOT detect "cotacao" without cedilla (no tolerance)', () => {
      expect(isPriceTrigger('cotacao')).toBe(false)
    })

    it('does NOT detect "preco" without accent (no tolerance)', () => {
      expect(isPriceTrigger('preco')).toBe(false)
    })
  })

  // AC4: Non-trigger messages filtered
  describe('non-trigger messages', () => {
    it('returns false for message without trigger', () => {
      expect(isPriceTrigger('hello world')).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(isPriceTrigger('')).toBe(false)
    })

    it('returns false for similar but non-matching words', () => {
      expect(isPriceTrigger('precocidade')).toBe(false)
    })
  })

  // Trigger in context
  describe('trigger in sentence context', () => {
    it('detects trigger in sentence: "qual o preço do USDT?"', () => {
      expect(isPriceTrigger('qual o preço do USDT?')).toBe(true)
    })

    it('detects trigger at start: "preço?"', () => {
      expect(isPriceTrigger('preço?')).toBe(true)
    })

    it('detects trigger at end: "me passa a cotação"', () => {
      expect(isPriceTrigger('me passa a cotação')).toBe(true)
    })

    it('detects multiple triggers in one message', () => {
      expect(isPriceTrigger('preço ou cotação?')).toBe(true)
    })
  })
})

// AC3: Configurable keywords
describe('PRICE_TRIGGER_KEYWORDS', () => {
  it('exports keywords array', () => {
    expect(Array.isArray(PRICE_TRIGGER_KEYWORDS)).toBe(true)
  })

  it('contains "preço" keyword', () => {
    expect(PRICE_TRIGGER_KEYWORDS).toContain('preço')
  })

  it('contains "cotação" keyword', () => {
    expect(PRICE_TRIGGER_KEYWORDS).toContain('cotação')
  })

  it('is a readonly tuple', () => {
    // Type safety - this is a readonly array
    expect(PRICE_TRIGGER_KEYWORDS.length).toBe(2)
  })
})
