/**
 * Tests for Deal Computation
 * Sprint 4, Task 4.3
 */
import { describe, it, expect } from 'vitest'
import {
  parseBrazilianNumber,
  extractBrlAmount,
  extractUsdtAmount,
  formatBrazilianAmount,
  formatBrl,
  formatUsdt,
  formatRate,
  computeBrlToUsdt,
  computeUsdtToBrl,
  computeDeal,
} from './dealComputation.js'

// ============================================================
// parseBrazilianNumber
// ============================================================

describe('parseBrazilianNumber', () => {
  describe('basic numbers', () => {
    it('parses plain integers', () => {
      expect(parseBrazilianNumber('1000')).toBe(1000)
      expect(parseBrazilianNumber('5000')).toBe(5000)
      expect(parseBrazilianNumber('100')).toBe(100)
    })

    it('parses decimal with period (English style)', () => {
      expect(parseBrazilianNumber('5.25')).toBe(5.25)
    })
  })

  describe('Brazilian format', () => {
    it('parses comma as decimal separator', () => {
      expect(parseBrazilianNumber('5,25')).toBe(5.25)
      expect(parseBrazilianNumber('5,2')).toBe(5.2)
    })

    it('parses periods as thousands separators', () => {
      expect(parseBrazilianNumber('4.479.100')).toBe(4479100)
      expect(parseBrazilianNumber('1.000.000')).toBe(1000000)
    })

    it('parses mixed thousands + decimal: 4.479.100,50', () => {
      expect(parseBrazilianNumber('4.479.100,50')).toBe(4479100.50)
    })

    it('parses 853.161,90', () => {
      expect(parseBrazilianNumber('853.161,90')).toBe(853161.90)
    })

    it('parses single period thousands: 5.000', () => {
      expect(parseBrazilianNumber('5.000')).toBe(5000)
    })

    it('parses comma thousands separator: 1,000', () => {
      expect(parseBrazilianNumber('1,000')).toBe(1000)
    })
  })

  describe('multiplier patterns', () => {
    it('parses k suffix', () => {
      expect(parseBrazilianNumber('5k')).toBe(5000)
      expect(parseBrazilianNumber('10k')).toBe(10000)
      expect(parseBrazilianNumber('1.5k')).toBe(1500)
      expect(parseBrazilianNumber('10,5k')).toBe(10500)
    })

    it('parses mil suffix', () => {
      expect(parseBrazilianNumber('5mil')).toBe(5000)
      expect(parseBrazilianNumber('20mil')).toBe(20000)
      expect(parseBrazilianNumber('2,5mil')).toBe(2500)
    })
  })

  describe('currency prefix stripping', () => {
    it('strips R$ prefix', () => {
      expect(parseBrazilianNumber('R$ 4.479.100')).toBe(4479100)
      expect(parseBrazilianNumber('R$5,25')).toBe(5.25)
    })

    it('strips US$ prefix', () => {
      expect(parseBrazilianNumber('US$ 500')).toBe(500)
    })

    it('strips USD/BRL prefix', () => {
      expect(parseBrazilianNumber('USD 1000')).toBe(1000)
      expect(parseBrazilianNumber('BRL 5000')).toBe(5000)
    })
  })

  describe('edge cases', () => {
    it('returns null for empty/invalid input', () => {
      expect(parseBrazilianNumber('')).toBeNull()
      expect(parseBrazilianNumber('   ')).toBeNull()
      expect(parseBrazilianNumber('abc')).toBeNull()
      expect(parseBrazilianNumber(null as unknown as string)).toBeNull()
    })

    it('returns null for zero or negative', () => {
      expect(parseBrazilianNumber('0')).toBeNull()
      expect(parseBrazilianNumber('-100')).toBeNull()
    })

    it('handles whitespace', () => {
      expect(parseBrazilianNumber('  5000  ')).toBe(5000)
      expect(parseBrazilianNumber('  R$ 5.000  ')).toBe(5000)
    })
  })
})

// ============================================================
// extractBrlAmount
// ============================================================

describe('extractBrlAmount', () => {
  it('extracts R$ prefixed amounts', () => {
    expect(extractBrlAmount('compro R$ 4.479.100')).toBe(4479100)
    expect(extractBrlAmount('tenho R$ 10.000 disponível')).toBe(10000)
  })

  it('extracts "reais" suffixed amounts', () => {
    expect(extractBrlAmount('quero 5000 reais de USDT')).toBe(5000)
  })

  it('extracts k/mil multiplied amounts', () => {
    expect(extractBrlAmount('compro 10k')).toBe(10000)
    expect(extractBrlAmount('tenho 5mil pra vender')).toBe(5000)
  })

  it('extracts large numbers with Brazilian formatting', () => {
    expect(extractBrlAmount('operação de 4.479.100,50 hoje')).toBe(4479100.50)
  })

  it('returns null for no amount', () => {
    expect(extractBrlAmount('preço por favor')).toBeNull()
    expect(extractBrlAmount('')).toBeNull()
  })
})

// ============================================================
// extractUsdtAmount
// ============================================================

describe('extractUsdtAmount', () => {
  it('extracts USDT suffixed amounts', () => {
    expect(extractUsdtAmount('quero 500 usdt')).toBe(500)
    expect(extractUsdtAmount('vendo 1000 USDT')).toBe(1000)
  })

  it('extracts USD suffixed amounts', () => {
    expect(extractUsdtAmount('compro 500 usd')).toBe(500)
  })

  it('extracts US$ prefixed amounts', () => {
    expect(extractUsdtAmount('tenho US$ 500')).toBe(500)
  })

  it('returns null for no USDT amount', () => {
    expect(extractUsdtAmount('preço por favor')).toBeNull()
    expect(extractUsdtAmount('')).toBeNull()
  })
})

// ============================================================
// Formatting
// ============================================================

describe('formatBrazilianAmount', () => {
  it('formats with thousands separators and comma decimal', () => {
    expect(formatBrazilianAmount(4479100)).toBe('4.479.100,00')
    expect(formatBrazilianAmount(853161.90)).toBe('853.161,90')
    expect(formatBrazilianAmount(1000)).toBe('1.000,00')
    expect(formatBrazilianAmount(0)).toBe('0,00')
  })

  it('formats with custom decimal places', () => {
    expect(formatBrazilianAmount(5.25, 4)).toBe('5,2500')
    expect(formatBrazilianAmount(1000, 0)).toBe('1.000')
  })

  it('handles non-finite values', () => {
    expect(formatBrazilianAmount(NaN)).toBe('0,00')
    expect(formatBrazilianAmount(Infinity)).toBe('0,00')
  })
})

describe('formatBrl', () => {
  it('formats with R$ prefix', () => {
    expect(formatBrl(4479100.50)).toBe('R$ 4.479.100,50')
    expect(formatBrl(10000)).toBe('R$ 10.000,00')
  })
})

describe('formatUsdt', () => {
  it('formats with USDT suffix', () => {
    expect(formatUsdt(853161.90)).toBe('853.161,90 USDT')
    expect(formatUsdt(500)).toBe('500,00 USDT')
  })
})

describe('formatRate', () => {
  it('formats rate with 4 decimal places', () => {
    expect(formatRate(5.25)).toBe('5,2500')
    expect(formatRate(5.2345)).toBe('5,2345')
  })
})

// ============================================================
// Deal Computation
// ============================================================

describe('computeBrlToUsdt', () => {
  it('computes Daniel-style: R$ 4.479.100 / 5,25 = 853.161,90 USDT', () => {
    const result = computeBrlToUsdt(4479100, 5.25)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.amountBrl).toBe(4479100)
      // 4479100 / 5.25 = 853161.90476... → truncated to 853161.90
      expect(result.data.amountUsdt).toBe(853161.90)
      expect(result.data.rate).toBe(5.25)
      expect(result.data.display).toContain('R$ 4.479.100,00')
      expect(result.data.display).toContain('5,2500')
      expect(result.data.display).toContain('853.161,90 USDT')
    }
  })

  it('computes smaller amounts', () => {
    const result = computeBrlToUsdt(10000, 5.25)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // 10000 / 5.25 = 1904.7619... → truncated to 1904.76
      expect(result.data.amountUsdt).toBe(1904.76)
    }
  })

  it('truncates USDT (does not round)', () => {
    const result = computeBrlToUsdt(10000, 3)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // 10000 / 3 = 3333.3333... → truncated to 3333.33
      expect(result.data.amountUsdt).toBe(3333.33)
    }
  })

  it('rejects non-positive BRL amount', () => {
    expect(computeBrlToUsdt(0, 5.25).ok).toBe(false)
    expect(computeBrlToUsdt(-100, 5.25).ok).toBe(false)
  })

  it('rejects non-positive rate', () => {
    expect(computeBrlToUsdt(10000, 0).ok).toBe(false)
    expect(computeBrlToUsdt(10000, -1).ok).toBe(false)
  })

  it('rejects NaN values', () => {
    expect(computeBrlToUsdt(NaN, 5.25).ok).toBe(false)
    expect(computeBrlToUsdt(10000, NaN).ok).toBe(false)
  })
})

describe('computeUsdtToBrl', () => {
  it('computes reverse: 853.161,90 USDT × 5,25 = R$ 4.479.099,97', () => {
    const result = computeUsdtToBrl(853161.90, 5.25)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // 853161.90 × 5.25 = 4479099.975 → truncated to 4479099.97
      expect(result.data.amountBrl).toBe(4479099.97)
      expect(result.data.amountUsdt).toBe(853161.90)
    }
  })

  it('computes smaller amounts', () => {
    const result = computeUsdtToBrl(500, 5.25)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.amountBrl).toBe(2625)
    }
  })

  it('rejects invalid inputs', () => {
    expect(computeUsdtToBrl(0, 5.25).ok).toBe(false)
    expect(computeUsdtToBrl(500, 0).ok).toBe(false)
  })
})

describe('computeDeal', () => {
  it('auto-selects BRL→USDT when amountBrl provided', () => {
    const result = computeDeal({ amountBrl: 10000, rate: 5.25 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.amountUsdt).toBe(1904.76)
    }
  })

  it('auto-selects USDT→BRL when amountUsdt provided', () => {
    const result = computeDeal({ amountUsdt: 500, rate: 5.25 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.amountBrl).toBe(2625)
    }
  })

  it('prefers BRL when both provided', () => {
    const result = computeDeal({ amountBrl: 10000, amountUsdt: 500, rate: 5.25 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.amountUsdt).toBe(1904.76)
    }
  })

  it('rejects when no amount provided', () => {
    const result = computeDeal({ rate: 5.25 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Either amountBrl or amountUsdt')
    }
  })

  it('rejects invalid rate', () => {
    expect(computeDeal({ amountBrl: 10000, rate: 0 }).ok).toBe(false)
  })
})
