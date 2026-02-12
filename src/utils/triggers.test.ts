import { describe, it, expect } from 'vitest'
import { PRICE_TRIGGER_KEYWORDS, extractTronscanTx, hasTronscanLink } from './triggers.js'

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

describe('Tronscan helpers', () => {
  const txHash = 'e779beb52ec8448ff31db3384f4af9857078f718911dd6f9f88f7f0f03f2f1d2'

  it('detects tronscan links with scheme', () => {
    expect(hasTronscanLink(`https://tronscan.org/#/transaction/${txHash}`)).toBe(true)
  })

  it('detects tronscan links without scheme', () => {
    expect(hasTronscanLink(`tronscan.org/#/transaction/${txHash}`)).toBe(true)
  })

  it('extracts tx hash from scheme-less tronscan links', () => {
    expect(extractTronscanTx(`finalizou: tronscan.org/#/transaction/${txHash}`)).toBe(txHash)
  })

  it('returns null when hash is invalid', () => {
    expect(extractTronscanTx('tronscan.org/#/transaction/abc123')).toBeNull()
  })

  it('does not match larger hostnames containing tronscan', () => {
    expect(hasTronscanLink(`https://nottronscan.org/#/transaction/${txHash}`)).toBe(false)
    expect(extractTronscanTx(`https://nottronscan.org/#/transaction/${txHash}`)).toBeNull()
  })
})
