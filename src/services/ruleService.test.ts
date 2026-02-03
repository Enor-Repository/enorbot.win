/**
 * Tests for Rule Service
 * Sprint 2: Time-Based Pricing Rules
 *
 * Critical coverage: schedule matching, timezone handling, overnight rules
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getTimeInTimezone,
  isRuleActiveAtTime,
  isValidTimeFormat,
  isValidDay,
  isValidPricingSource,
  isValidSpreadMode,
  isValidTimezone,
  validateRuleInput,
  clearRulesCache,
  type GroupRule,
  type DayOfWeek,
  type RuleInput,
} from './ruleService.js'

// Mock dependencies
vi.mock('./supabase.js', () => ({
  getSupabase: vi.fn(() => null),
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

/**
 * Create a test GroupRule
 */
function createTestRule(overrides: Partial<GroupRule> = {}): GroupRule {
  return {
    id: 'test-rule-id',
    groupJid: 'test-group@g.us',
    name: 'Test Rule',
    description: null,
    scheduleStartTime: '09:00',
    scheduleEndTime: '18:00',
    scheduleDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    scheduleTimezone: 'America/Sao_Paulo',
    priority: 10,
    pricingSource: 'usdt_binance',
    spreadMode: 'bps',
    sellSpread: 50,
    buySpread: -30,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('ruleService', () => {
  beforeEach(() => {
    clearRulesCache()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // =========================================================================
  // Validation
  // =========================================================================

  describe('isValidTimeFormat', () => {
    it('accepts valid HH:MM formats', () => {
      expect(isValidTimeFormat('00:00')).toBe(true)
      expect(isValidTimeFormat('09:00')).toBe(true)
      expect(isValidTimeFormat('18:30')).toBe(true)
      expect(isValidTimeFormat('23:59')).toBe(true)
    })

    it('rejects invalid formats', () => {
      expect(isValidTimeFormat('9:00')).toBe(false)
      expect(isValidTimeFormat('24:00')).toBe(false)
      expect(isValidTimeFormat('12:60')).toBe(false)
      expect(isValidTimeFormat('abc')).toBe(false)
      expect(isValidTimeFormat('')).toBe(false)
      expect(isValidTimeFormat('09:00:00')).toBe(false)
    })
  })

  describe('isValidDay', () => {
    it('accepts valid day abbreviations', () => {
      expect(isValidDay('mon')).toBe(true)
      expect(isValidDay('tue')).toBe(true)
      expect(isValidDay('wed')).toBe(true)
      expect(isValidDay('thu')).toBe(true)
      expect(isValidDay('fri')).toBe(true)
      expect(isValidDay('sat')).toBe(true)
      expect(isValidDay('sun')).toBe(true)
    })

    it('rejects invalid days', () => {
      expect(isValidDay('Mon')).toBe(false)
      expect(isValidDay('monday')).toBe(false)
      expect(isValidDay('')).toBe(false)
      expect(isValidDay('xyz')).toBe(false)
    })
  })

  describe('isValidPricingSource', () => {
    it('accepts valid sources', () => {
      expect(isValidPricingSource('commercial_dollar')).toBe(true)
      expect(isValidPricingSource('usdt_binance')).toBe(true)
    })

    it('rejects invalid sources', () => {
      expect(isValidPricingSource('bitcoin')).toBe(false)
      expect(isValidPricingSource('')).toBe(false)
    })
  })

  describe('isValidSpreadMode', () => {
    it('accepts valid modes', () => {
      expect(isValidSpreadMode('bps')).toBe(true)
      expect(isValidSpreadMode('abs_brl')).toBe(true)
      expect(isValidSpreadMode('flat')).toBe(true)
    })

    it('rejects invalid modes', () => {
      expect(isValidSpreadMode('percent')).toBe(false)
      expect(isValidSpreadMode('')).toBe(false)
    })
  })

  describe('isValidTimezone', () => {
    it('accepts valid IANA timezones', () => {
      expect(isValidTimezone('America/Sao_Paulo')).toBe(true)
      expect(isValidTimezone('UTC')).toBe(true)
      expect(isValidTimezone('America/New_York')).toBe(true)
      expect(isValidTimezone('Europe/London')).toBe(true)
    })

    it('rejects invalid timezones', () => {
      expect(isValidTimezone('NotATimezone')).toBe(false)
      expect(isValidTimezone('')).toBe(false)
      expect(isValidTimezone('Brazil')).toBe(false)
    })
  })

  describe('validateRuleInput', () => {
    const validInput: RuleInput = {
      groupJid: 'group@g.us',
      name: 'Business Hours',
      scheduleStartTime: '09:00',
      scheduleEndTime: '18:00',
      scheduleDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    }

    it('accepts valid input', () => {
      expect(validateRuleInput(validInput)).toBeNull()
    })

    it('rejects missing groupJid', () => {
      expect(validateRuleInput({ ...validInput, groupJid: '' })).toContain('groupJid')
    })

    it('rejects missing name', () => {
      expect(validateRuleInput({ ...validInput, name: '' })).toContain('name')
    })

    it('rejects invalid start time', () => {
      expect(validateRuleInput({ ...validInput, scheduleStartTime: '25:00' })).toContain('start time')
    })

    it('rejects invalid end time', () => {
      expect(validateRuleInput({ ...validInput, scheduleEndTime: 'abc' })).toContain('end time')
    })

    it('rejects empty days array', () => {
      expect(validateRuleInput({ ...validInput, scheduleDays: [] })).toContain('day')
    })

    it('rejects invalid day abbreviation', () => {
      expect(validateRuleInput({ ...validInput, scheduleDays: ['monday' as DayOfWeek] })).toContain('Invalid day')
    })

    it('rejects invalid timezone', () => {
      expect(validateRuleInput({ ...validInput, scheduleTimezone: 'NotATimezone' })).toContain('timezone')
    })

    it('rejects priority out of range', () => {
      expect(validateRuleInput({ ...validInput, priority: 101 })).toContain('Priority')
      expect(validateRuleInput({ ...validInput, priority: -1 })).toContain('Priority')
    })

    it('rejects invalid pricing source', () => {
      expect(validateRuleInput({ ...validInput, pricingSource: 'bitcoin' as any })).toContain('pricing source')
    })

    it('rejects invalid spread mode', () => {
      expect(validateRuleInput({ ...validInput, spreadMode: 'percent' as any })).toContain('spread mode')
    })
  })

  // =========================================================================
  // Timezone Handling
  // =========================================================================

  describe('getTimeInTimezone', () => {
    it('returns day, hours, and minutes in the specified timezone', () => {
      // Use a known UTC time and convert to Sao Paulo (UTC-3)
      // 2026-02-03 15:30:00 UTC = 2026-02-03 12:30:00 BRT (Tuesday)
      const utcDate = new Date('2026-02-03T15:30:00.000Z')
      const result = getTimeInTimezone('America/Sao_Paulo', utcDate)

      expect(result.dayOfWeek).toBe('tue')
      expect(result.hours).toBe(12)
      expect(result.minutes).toBe(30)
    })

    it('handles timezone offset correctly for New York', () => {
      // 2026-02-03 15:30:00 UTC = 2026-02-03 10:30:00 EST (UTC-5)
      const utcDate = new Date('2026-02-03T15:30:00.000Z')
      const result = getTimeInTimezone('America/New_York', utcDate)

      expect(result.dayOfWeek).toBe('tue')
      expect(result.hours).toBe(10)
      expect(result.minutes).toBe(30)
    })

    it('handles date boundary crossing (UTC to earlier timezone)', () => {
      // 2026-02-03 02:00:00 UTC = 2026-02-02 23:00:00 BRT (Monday)
      const utcDate = new Date('2026-02-03T02:00:00.000Z')
      const result = getTimeInTimezone('America/Sao_Paulo', utcDate)

      expect(result.dayOfWeek).toBe('mon')
      expect(result.hours).toBe(23)
      expect(result.minutes).toBe(0)
    })

    it('handles UTC timezone', () => {
      const utcDate = new Date('2026-02-03T14:45:00.000Z')
      const result = getTimeInTimezone('UTC', utcDate)

      expect(result.dayOfWeek).toBe('tue')
      expect(result.hours).toBe(14)
      expect(result.minutes).toBe(45)
    })
  })

  // =========================================================================
  // Schedule Matching
  // =========================================================================

  describe('isRuleActiveAtTime', () => {
    describe('normal time range (start < end)', () => {
      const rule = createTestRule({
        scheduleStartTime: '09:00',
        scheduleEndTime: '18:00',
        scheduleDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      })

      it('matches within the time range on a valid day', () => {
        expect(isRuleActiveAtTime(rule, 'mon', 9, 0)).toBe(true)
        expect(isRuleActiveAtTime(rule, 'wed', 12, 30)).toBe(true)
        expect(isRuleActiveAtTime(rule, 'fri', 17, 59)).toBe(true)
      })

      it('does not match outside the time range', () => {
        expect(isRuleActiveAtTime(rule, 'mon', 8, 59)).toBe(false)
        expect(isRuleActiveAtTime(rule, 'mon', 18, 0)).toBe(false) // end is exclusive
        expect(isRuleActiveAtTime(rule, 'mon', 23, 0)).toBe(false)
      })

      it('does not match on excluded days', () => {
        expect(isRuleActiveAtTime(rule, 'sat', 12, 0)).toBe(false)
        expect(isRuleActiveAtTime(rule, 'sun', 12, 0)).toBe(false)
      })
    })

    describe('overnight time range (start > end)', () => {
      const rule = createTestRule({
        scheduleStartTime: '18:00',
        scheduleEndTime: '09:00',
        scheduleDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      })

      it('matches after start time on a valid day (Window A)', () => {
        expect(isRuleActiveAtTime(rule, 'mon', 18, 0)).toBe(true)
        expect(isRuleActiveAtTime(rule, 'thu', 23, 59)).toBe(true)
        expect(isRuleActiveAtTime(rule, 'fri', 20, 0)).toBe(true)
      })

      it('matches before end time on the next day (Window B)', () => {
        // Monday night rule carries into Tuesday morning
        expect(isRuleActiveAtTime(rule, 'tue', 3, 0)).toBe(true)
        // Thursday night carries into Friday morning
        expect(isRuleActiveAtTime(rule, 'fri', 8, 59)).toBe(true)
      })

      it('does not match Window B if previous day is not in schedule', () => {
        // Friday night rule does NOT carry into Saturday morning
        // because 'sat' is not in the scheduled days for Window A,
        // but actually we check if the PREVIOUS day (fri) is in schedule
        // Friday IS in schedule, so Saturday early morning should match
        expect(isRuleActiveAtTime(rule, 'sat', 3, 0)).toBe(true)

        // Sunday morning should NOT match (previous day = sat, not in schedule)
        expect(isRuleActiveAtTime(rule, 'sun', 3, 0)).toBe(false)
      })

      it('does not match in the gap between end and start', () => {
        expect(isRuleActiveAtTime(rule, 'mon', 9, 0)).toBe(false) // gap
        expect(isRuleActiveAtTime(rule, 'mon', 12, 0)).toBe(false) // gap
        expect(isRuleActiveAtTime(rule, 'mon', 17, 59)).toBe(false) // gap
      })
    })

    describe('all-day rule (start == end)', () => {
      const rule = createTestRule({
        scheduleStartTime: '00:00',
        scheduleEndTime: '00:00',
        scheduleDays: ['sat', 'sun'],
      })

      it('matches all times on scheduled days', () => {
        expect(isRuleActiveAtTime(rule, 'sat', 0, 0)).toBe(true)
        expect(isRuleActiveAtTime(rule, 'sat', 12, 0)).toBe(true)
        expect(isRuleActiveAtTime(rule, 'sun', 23, 59)).toBe(true)
      })

      it('does not match on non-scheduled days', () => {
        expect(isRuleActiveAtTime(rule, 'mon', 12, 0)).toBe(false)
        expect(isRuleActiveAtTime(rule, 'fri', 0, 0)).toBe(false)
      })
    })

    describe('inactive rules', () => {
      it('never matches when isActive is false', () => {
        const rule = createTestRule({
          scheduleStartTime: '00:00',
          scheduleEndTime: '00:00',
          scheduleDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
          isActive: false,
        })

        expect(isRuleActiveAtTime(rule, 'mon', 12, 0)).toBe(false)
        expect(isRuleActiveAtTime(rule, 'sat', 12, 0)).toBe(false)
      })
    })

    describe('edge cases', () => {
      it('handles midnight exactly (00:00)', () => {
        const rule = createTestRule({
          scheduleStartTime: '00:00',
          scheduleEndTime: '06:00',
          scheduleDays: ['mon'],
        })
        expect(isRuleActiveAtTime(rule, 'mon', 0, 0)).toBe(true)
      })

      it('handles end of day (23:59)', () => {
        const rule = createTestRule({
          scheduleStartTime: '22:00',
          scheduleEndTime: '23:59',
          scheduleDays: ['fri'],
        })
        expect(isRuleActiveAtTime(rule, 'fri', 23, 58)).toBe(true)
        expect(isRuleActiveAtTime(rule, 'fri', 23, 59)).toBe(false) // end is exclusive
      })

      it('handles single-day schedule', () => {
        const rule = createTestRule({
          scheduleStartTime: '10:00',
          scheduleEndTime: '14:00',
          scheduleDays: ['wed'],
        })
        expect(isRuleActiveAtTime(rule, 'wed', 12, 0)).toBe(true)
        expect(isRuleActiveAtTime(rule, 'thu', 12, 0)).toBe(false)
      })
    })
  })

  // =========================================================================
  // Real-World Scenarios
  // =========================================================================

  describe('real-world scenarios', () => {
    it('scenario: Daniel sets Business Hours (commercial dollar, no spread)', () => {
      const rule = createTestRule({
        name: 'Business Hours',
        scheduleStartTime: '09:00',
        scheduleEndTime: '18:00',
        scheduleDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
        scheduleTimezone: 'America/Sao_Paulo',
        priority: 10,
        pricingSource: 'commercial_dollar',
        spreadMode: 'flat',
        sellSpread: 0,
        buySpread: 0,
      })

      // Wednesday 10:30 BRT - should be active
      expect(isRuleActiveAtTime(rule, 'wed', 10, 30)).toBe(true)
      expect(rule.pricingSource).toBe('commercial_dollar')
      expect(rule.spreadMode).toBe('flat')

      // Saturday 10:30 BRT - should NOT be active
      expect(isRuleActiveAtTime(rule, 'sat', 10, 30)).toBe(false)
    })

    it('scenario: Daniel sets After Hours (USDT/BRL with spread)', () => {
      const rule = createTestRule({
        name: 'After Hours',
        scheduleStartTime: '18:00',
        scheduleEndTime: '09:00',
        scheduleDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
        scheduleTimezone: 'America/Sao_Paulo',
        priority: 5,
        pricingSource: 'usdt_binance',
        spreadMode: 'bps',
        sellSpread: 50,
        buySpread: -30,
      })

      // Monday 20:00 BRT - should be active (Window A)
      expect(isRuleActiveAtTime(rule, 'mon', 20, 0)).toBe(true)
      // Tuesday 07:00 BRT - should be active (Window B, previous day Mon in schedule)
      expect(isRuleActiveAtTime(rule, 'tue', 7, 0)).toBe(true)
      // Monday 12:00 BRT - should NOT be active (gap)
      expect(isRuleActiveAtTime(rule, 'mon', 12, 0)).toBe(false)
    })

    it('scenario: Weekend Premium (higher spread, highest priority)', () => {
      const rule = createTestRule({
        name: 'Weekend Premium',
        scheduleStartTime: '00:00',
        scheduleEndTime: '00:00',
        scheduleDays: ['sat', 'sun'],
        scheduleTimezone: 'America/Sao_Paulo',
        priority: 15,
        pricingSource: 'usdt_binance',
        spreadMode: 'bps',
        sellSpread: 80,
        buySpread: -50,
      })

      // Saturday all day
      expect(isRuleActiveAtTime(rule, 'sat', 0, 0)).toBe(true)
      expect(isRuleActiveAtTime(rule, 'sat', 23, 59)).toBe(true)
      expect(isRuleActiveAtTime(rule, 'sun', 12, 0)).toBe(true)

      // Weekday - not active
      expect(isRuleActiveAtTime(rule, 'mon', 12, 0)).toBe(false)

      // Highest priority wins
      expect(rule.priority).toBe(15)
    })

    it('scenario: priority resolution with overlapping rules', () => {
      const afterHours = createTestRule({
        name: 'After Hours',
        scheduleStartTime: '18:00',
        scheduleEndTime: '09:00',
        scheduleDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
        priority: 5,
      })

      const weekendPremium = createTestRule({
        name: 'Weekend Premium',
        scheduleStartTime: '00:00',
        scheduleEndTime: '00:00',
        scheduleDays: ['sat', 'sun'],
        priority: 15,
      })

      // Saturday 20:00 - both match, Weekend Premium should win (higher priority)
      const satMatch1 = isRuleActiveAtTime(afterHours, 'sat', 20, 0)
      const satMatch2 = isRuleActiveAtTime(weekendPremium, 'sat', 20, 0)

      expect(satMatch1).toBe(true)
      expect(satMatch2).toBe(true)
      // In getActiveRule, Weekend Premium (priority 15) would be returned first
      expect(weekendPremium.priority).toBeGreaterThan(afterHours.priority)
    })
  })

  // =========================================================================
  // Cache operations
  // =========================================================================

  describe('cache operations', () => {
    it('should clear specific group from cache', () => {
      clearRulesCache('group1@g.us')
      // No error thrown
    })

    it('should clear all cache', () => {
      clearRulesCache()
      // No error thrown
    })
  })
})
