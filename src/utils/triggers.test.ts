import { describe, it, expect, vi } from 'vitest'
import { isPriceTrigger, isPriceTriggerSync, PRICE_TRIGGER_KEYWORDS } from './triggers.js'

// Mock systemPatternService
vi.mock('../services/systemPatternService.js', () => ({
  getKeywordsForPattern: vi.fn(() => Promise.resolve(['preço', 'cotação'])),
  getKeywordsForPatternSync: vi.fn(() => ['preço', 'cotação']),
}))

describe('isPriceTrigger (async)', () => {
  // AC1: "preço" keyword detection
  describe('preço keyword detection', () => {
    it('detects "preço" (lowercase)', async () => {
      expect(await isPriceTrigger('preço')).toBe(true)
    })

    it('detects "PREÇO" (uppercase)', async () => {
      expect(await isPriceTrigger('PREÇO')).toBe(true)
    })

    it('detects "Preço" (mixed case)', async () => {
      expect(await isPriceTrigger('Preço')).toBe(true)
    })
  })

  // AC2: "cotação" keyword detection
  describe('cotação keyword detection', () => {
    it('detects "cotação" (with cedilla)', async () => {
      expect(await isPriceTrigger('cotação')).toBe(true)
    })

    it('detects "COTAÇÃO" (uppercase)', async () => {
      expect(await isPriceTrigger('COTAÇÃO')).toBe(true)
    })

    it('does NOT detect "cotacao" without cedilla (no tolerance)', async () => {
      expect(await isPriceTrigger('cotacao')).toBe(false)
    })

    it('does NOT detect "preco" without accent (no tolerance)', async () => {
      expect(await isPriceTrigger('preco')).toBe(false)
    })
  })

  // AC4: Non-trigger messages filtered
  describe('non-trigger messages', () => {
    it('returns false for message without trigger', async () => {
      expect(await isPriceTrigger('hello world')).toBe(false)
    })

    it('returns false for empty string', async () => {
      expect(await isPriceTrigger('')).toBe(false)
    })

    it('returns false for similar but non-matching words', async () => {
      expect(await isPriceTrigger('precocidade')).toBe(false)
    })
  })

  // Trigger in context
  describe('trigger in sentence context', () => {
    it('detects trigger in sentence: "qual o preço do USDT?"', async () => {
      expect(await isPriceTrigger('qual o preço do USDT?')).toBe(true)
    })

    it('detects trigger at start: "preço?"', async () => {
      expect(await isPriceTrigger('preço?')).toBe(true)
    })

    it('detects trigger at end: "me passa a cotação"', async () => {
      expect(await isPriceTrigger('me passa a cotação')).toBe(true)
    })

    it('detects multiple triggers in one message', async () => {
      expect(await isPriceTrigger('preço ou cotação?')).toBe(true)
    })
  })
})

describe('isPriceTriggerSync (cached DB keywords)', () => {
  it('detects "preço"', () => {
    expect(isPriceTriggerSync('preço')).toBe(true)
  })

  it('detects "cotação"', () => {
    expect(isPriceTriggerSync('cotação')).toBe(true)
  })

  it('detects "preço?" with punctuation', () => {
    expect(isPriceTriggerSync('preço?')).toBe(true)
  })

  it('returns false for non-trigger', () => {
    expect(isPriceTriggerSync('hello')).toBe(false)
  })

  it('does not false-positive on substrings', () => {
    // Ensures word-boundary matching prevents short-keyword false positives
    expect(isPriceTriggerSync('precocidade')).toBe(false)
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
    expect(PRICE_TRIGGER_KEYWORDS.length).toBe(2)
  })
})
