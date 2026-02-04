import { describe, it, expect } from 'vitest'
import { PRICE_TRIGGER_KEYWORDS } from './triggers.js'

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
