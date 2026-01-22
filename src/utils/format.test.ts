import { describe, it, expect } from 'vitest'
import { formatBrazilianPrice, formatDuration, formatRelativeTime } from './format.js'

describe('formatBrazilianPrice', () => {
  // AC1: Brazilian Currency Formatting
  describe('AC1: Brazilian Currency Formatting', () => {
    it('formats 5.82 as "R$5,8200" (comma as decimal separator)', () => {
      expect(formatBrazilianPrice(5.82)).toBe('R$5,8200')
    })

    it('prepends R$ currency symbol without space', () => {
      const result = formatBrazilianPrice(10.5)
      expect(result).toMatch(/^R\$/)
      expect(result).toBe('R$10,5000')
    })

    it('uses comma as decimal separator', () => {
      const result = formatBrazilianPrice(123.45)
      expect(result).toContain(',')
      expect(result).not.toMatch(/\d\.\d/) // No period as decimal separator
    })
  })

  // AC2: Decimal Truncation
  describe('AC2: Decimal Truncation', () => {
    it('truncates 5.823456 to "R$5,8234" (not rounded)', () => {
      expect(formatBrazilianPrice(5.823456)).toBe('R$5,8234')
    })

    it('truncates 5.82349 to "R$5,8234" (verify truncation behavior)', () => {
      // 5.82349 would round to 5.8235 if rounding, but should truncate to 5.8234
      expect(formatBrazilianPrice(5.82349)).toBe('R$5,8234')
    })

    it('truncates 5.82999 to "R$5,8299" (financial accuracy)', () => {
      // 5.82999 would round to 5.8300 if rounding, but should truncate to 5.8299
      expect(formatBrazilianPrice(5.82999)).toBe('R$5,8299')
    })

    it('truncates 1234.56789 to "R$1234,5678"', () => {
      expect(formatBrazilianPrice(1234.56789)).toBe('R$1234,5678')
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('formats 0 as "R$0,0000"', () => {
      expect(formatBrazilianPrice(0)).toBe('R$0,0000')
    })

    it('formats 100 as "R$100,0000" (whole number)', () => {
      expect(formatBrazilianPrice(100)).toBe('R$100,0000')
    })

    it('formats 0.01 as "R$0,0100" (very small number)', () => {
      expect(formatBrazilianPrice(0.01)).toBe('R$0,0100')
    })

    it('formats very large number without thousands separator', () => {
      expect(formatBrazilianPrice(99999.99)).toBe('R$99999,9900')
    })

    it('handles negative numbers by truncating towards zero', () => {
      // -5.82999 truncates towards zero to -5.8299
      expect(formatBrazilianPrice(-5.82999)).toBe('R$-5,8299')
    })

    it('handles single decimal place by padding with zeros', () => {
      expect(formatBrazilianPrice(5.8)).toBe('R$5,8000')
    })

    it('handles integer input', () => {
      expect(formatBrazilianPrice(42)).toBe('R$42,0000')
    })
  })

  // Input validation
  describe('Input Validation', () => {
    it('throws error for NaN', () => {
      expect(() => formatBrazilianPrice(NaN)).toThrow('Invalid price value: NaN')
    })

    it('throws error for Infinity', () => {
      expect(() => formatBrazilianPrice(Infinity)).toThrow('Invalid price value: Infinity')
    })

    it('throws error for negative Infinity', () => {
      expect(() => formatBrazilianPrice(-Infinity)).toThrow('Invalid price value: -Infinity')
    })
  })
})

// =============================================================================
// Story 4.3: Time Formatting Utilities
// =============================================================================
describe('formatDuration', () => {
  describe('seconds (under 1 minute)', () => {
    it('formats 0 ms as "0s"', () => {
      expect(formatDuration(0)).toBe('0s')
    })

    it('formats 30000 ms (30 seconds) as "30s"', () => {
      expect(formatDuration(30 * 1000)).toBe('30s')
    })

    it('formats 59000 ms (59 seconds) as "59s"', () => {
      expect(formatDuration(59 * 1000)).toBe('59s')
    })
  })

  describe('minutes', () => {
    it('formats 60000 ms (1 minute) as "1m"', () => {
      expect(formatDuration(60 * 1000)).toBe('1m')
    })

    it('formats 300000 ms (5 minutes) as "5m"', () => {
      expect(formatDuration(5 * 60 * 1000)).toBe('5m')
    })

    it('formats 90000 ms (1 minute 30 seconds) as "1m" (rounds down)', () => {
      expect(formatDuration(90 * 1000)).toBe('1m')
    })
  })

  describe('hours and minutes', () => {
    it('formats 3600000 ms (1 hour) as "1h 0m"', () => {
      expect(formatDuration(60 * 60 * 1000)).toBe('1h 0m')
    })

    it('formats 5400000 ms (1.5 hours) as "1h 30m"', () => {
      expect(formatDuration(90 * 60 * 1000)).toBe('1h 30m')
    })

    it('formats 9000000 ms (2h 30m) as "2h 30m"', () => {
      expect(formatDuration(150 * 60 * 1000)).toBe('2h 30m')
    })

    it('formats large uptime (4h 32m)', () => {
      expect(formatDuration((4 * 60 + 32) * 60 * 1000)).toBe('4h 32m')
    })
  })

  describe('edge cases', () => {
    it('handles negative values as 0s', () => {
      expect(formatDuration(-1000)).toBe('0s')
    })
  })
})

describe('formatRelativeTime', () => {
  describe('null input', () => {
    it('returns "Never" for null date', () => {
      expect(formatRelativeTime(null)).toBe('Never')
    })
  })

  describe('time ranges', () => {
    it('returns "Just now" for less than 1 minute ago', () => {
      const now = new Date()
      expect(formatRelativeTime(now)).toBe('Just now')
    })

    it('returns "1min ago" for exactly 1 minute ago', () => {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000)
      expect(formatRelativeTime(oneMinuteAgo)).toBe('1min ago')
    })

    it('returns "2min ago" for 2 minutes ago', () => {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000)
      expect(formatRelativeTime(twoMinutesAgo)).toBe('2min ago')
    })

    it('returns "59min ago" for 59 minutes ago', () => {
      const fiftyNineMinutesAgo = new Date(Date.now() - 59 * 60 * 1000)
      expect(formatRelativeTime(fiftyNineMinutesAgo)).toBe('59min ago')
    })

    it('returns "1h ago" for 60 minutes ago', () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      expect(formatRelativeTime(oneHourAgo)).toBe('1h ago')
    })

    it('returns "2h ago" for 2 hours ago', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
      expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago')
    })

    it('returns "24h ago" for 24 hours ago', () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      expect(formatRelativeTime(oneDayAgo)).toBe('24h ago')
    })
  })
})
