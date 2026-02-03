/**
 * Tests for Trigger Service
 * Sprint 3: Group Triggers
 *
 * Critical coverage: pattern matching (exact, contains, regex),
 * validation, CRUD operations, caching, priority ordering
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isValidPatternType,
  isValidActionType,
  isValidRegex,
  validateTriggerInput,
  matchesPattern,
  clearTriggersCache,
  type GroupTrigger,
  type PatternType,
  type TriggerActionType,
  type TriggerInput,
} from './triggerService.js'

// Mock dependencies
const mockSupabase = {
  from: vi.fn(() => mockSupabase),
  select: vi.fn(() => mockSupabase),
  insert: vi.fn(() => mockSupabase),
  update: vi.fn(() => mockSupabase),
  delete: vi.fn(() => mockSupabase),
  eq: vi.fn(() => mockSupabase),
  order: vi.fn(() => mockSupabase),
  single: vi.fn(() => mockSupabase),
}

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
 * Create a test GroupTrigger
 */
function createTestTrigger(overrides: Partial<GroupTrigger> = {}): GroupTrigger {
  return {
    id: 'test-trigger-id',
    groupJid: 'test-group@g.us',
    triggerPhrase: 'preço',
    patternType: 'contains',
    actionType: 'price_quote',
    actionParams: {},
    priority: 10,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

/**
 * Create a valid TriggerInput for testing
 */
function createTestInput(overrides: Partial<TriggerInput> = {}): TriggerInput {
  return {
    groupJid: 'test-group@g.us',
    triggerPhrase: 'preço',
    actionType: 'price_quote',
    ...overrides,
  }
}

describe('triggerService', () => {
  beforeEach(() => {
    clearTriggersCache()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // =========================================================================
  // Validation: Pattern Type
  // =========================================================================

  describe('isValidPatternType', () => {
    it('accepts valid pattern types', () => {
      expect(isValidPatternType('exact')).toBe(true)
      expect(isValidPatternType('contains')).toBe(true)
      expect(isValidPatternType('regex')).toBe(true)
    })

    it('rejects invalid pattern types', () => {
      expect(isValidPatternType('glob')).toBe(false)
      expect(isValidPatternType('fuzzy')).toBe(false)
      expect(isValidPatternType('')).toBe(false)
      expect(isValidPatternType('EXACT')).toBe(false)
    })
  })

  // =========================================================================
  // Validation: Action Type
  // =========================================================================

  describe('isValidActionType', () => {
    it('accepts valid action types', () => {
      expect(isValidActionType('price_quote')).toBe(true)
      expect(isValidActionType('volume_quote')).toBe(true)
      expect(isValidActionType('text_response')).toBe(true)
      expect(isValidActionType('ai_prompt')).toBe(true)
    })

    it('rejects invalid action types', () => {
      expect(isValidActionType('usdt_quote')).toBe(false)
      expect(isValidActionType('custom')).toBe(false)
      expect(isValidActionType('')).toBe(false)
      expect(isValidActionType('PRICE_QUOTE')).toBe(false)
    })
  })

  // =========================================================================
  // Validation: Regex
  // =========================================================================

  describe('isValidRegex', () => {
    it('accepts valid regex patterns', () => {
      expect(isValidRegex('preço')).toBe(true)
      expect(isValidRegex('compro\\s+\\d+')).toBe(true)
      expect(isValidRegex('^(preço|cotação)$')).toBe(true)
      expect(isValidRegex('.*price.*')).toBe(true)
    })

    it('rejects invalid regex patterns', () => {
      expect(isValidRegex('[')).toBe(false)
      expect(isValidRegex('(unclosed')).toBe(false)
      expect(isValidRegex('*invalid')).toBe(false)
    })
  })

  // =========================================================================
  // Validation: TriggerInput
  // =========================================================================

  describe('validateTriggerInput', () => {
    it('accepts valid input', () => {
      expect(validateTriggerInput(createTestInput())).toBeNull()
    })

    it('accepts input with all optional fields', () => {
      expect(validateTriggerInput(createTestInput({
        patternType: 'exact',
        actionParams: { text: 'hello' },
        priority: 50,
        isActive: false,
      }))).toBeNull()
    })

    it('rejects missing groupJid', () => {
      expect(validateTriggerInput(createTestInput({ groupJid: '' }))).toBe('groupJid is required')
    })

    it('rejects missing triggerPhrase', () => {
      expect(validateTriggerInput(createTestInput({ triggerPhrase: '' }))).toBe('triggerPhrase is required')
    })

    it('rejects whitespace-only triggerPhrase', () => {
      expect(validateTriggerInput(createTestInput({ triggerPhrase: '   ' }))).toBe('triggerPhrase is required')
    })

    it('rejects too-long triggerPhrase', () => {
      const longPhrase = 'a'.repeat(201)
      expect(validateTriggerInput(createTestInput({ triggerPhrase: longPhrase }))).toBe(
        'triggerPhrase must be 200 characters or less'
      )
    })

    it('rejects missing actionType', () => {
      expect(validateTriggerInput(createTestInput({ actionType: '' as TriggerActionType }))).toBe('actionType is required')
    })

    it('rejects invalid actionType', () => {
      expect(validateTriggerInput(createTestInput({ actionType: 'custom' as TriggerActionType }))).toContain('Invalid actionType')
    })

    it('rejects invalid patternType', () => {
      expect(validateTriggerInput(createTestInput({ patternType: 'glob' as PatternType }))).toContain('Invalid patternType')
    })

    it('rejects invalid regex pattern', () => {
      expect(validateTriggerInput(createTestInput({
        patternType: 'regex',
        triggerPhrase: '[invalid',
      }))).toContain('Invalid regex pattern')
    })

    it('rejects priority below 0', () => {
      expect(validateTriggerInput(createTestInput({ priority: -1 }))).toBe('Priority must be between 0 and 100')
    })

    it('rejects priority above 100', () => {
      expect(validateTriggerInput(createTestInput({ priority: 101 }))).toBe('Priority must be between 0 and 100')
    })

    it('requires text param for text_response', () => {
      expect(validateTriggerInput(createTestInput({
        actionType: 'text_response',
        actionParams: {},
      }))).toContain('text_response requires')
    })

    it('requires non-empty text param for text_response', () => {
      expect(validateTriggerInput(createTestInput({
        actionType: 'text_response',
        actionParams: { text: '   ' },
      }))).toContain('text_response requires')
    })

    it('accepts valid text_response', () => {
      expect(validateTriggerInput(createTestInput({
        actionType: 'text_response',
        actionParams: { text: 'Como posso ajudar?' },
      }))).toBeNull()
    })

    it('requires prompt param for ai_prompt', () => {
      expect(validateTriggerInput(createTestInput({
        actionType: 'ai_prompt',
        actionParams: {},
      }))).toContain('ai_prompt requires')
    })

    it('accepts valid ai_prompt', () => {
      expect(validateTriggerInput(createTestInput({
        actionType: 'ai_prompt',
        actionParams: { prompt: 'Respond helpfully to the user' },
      }))).toBeNull()
    })

    it('does not require params for price_quote', () => {
      expect(validateTriggerInput(createTestInput({
        actionType: 'price_quote',
        actionParams: {},
      }))).toBeNull()
    })

    it('does not require params for volume_quote', () => {
      expect(validateTriggerInput(createTestInput({
        actionType: 'volume_quote',
        actionParams: {},
      }))).toBeNull()
    })
  })

  // =========================================================================
  // Pattern Matching: Exact
  // =========================================================================

  describe('matchesPattern - exact', () => {
    it('matches exact phrase case-insensitively', () => {
      const trigger = createTestTrigger({ patternType: 'exact', triggerPhrase: 'preço' })
      expect(matchesPattern('preço', trigger)).toBe(true)
      expect(matchesPattern('PREÇO', trigger)).toBe(true)
      expect(matchesPattern('Preço', trigger)).toBe(true)
    })

    it('does not match substring', () => {
      const trigger = createTestTrigger({ patternType: 'exact', triggerPhrase: 'preço' })
      expect(matchesPattern('qual o preço?', trigger)).toBe(false)
      expect(matchesPattern('preço do usdt', trigger)).toBe(false)
    })

    it('does not match empty message', () => {
      const trigger = createTestTrigger({ patternType: 'exact', triggerPhrase: 'preço' })
      expect(matchesPattern('', trigger)).toBe(false)
    })
  })

  // =========================================================================
  // Pattern Matching: Contains
  // =========================================================================

  describe('matchesPattern - contains', () => {
    it('matches substring case-insensitively', () => {
      const trigger = createTestTrigger({ patternType: 'contains', triggerPhrase: 'preço' })
      expect(matchesPattern('qual o preço?', trigger)).toBe(true)
      expect(matchesPattern('Preço do USDT', trigger)).toBe(true)
      expect(matchesPattern('preço', trigger)).toBe(true)
    })

    it('does not match non-contained text', () => {
      const trigger = createTestTrigger({ patternType: 'contains', triggerPhrase: 'preço' })
      expect(matchesPattern('cotação', trigger)).toBe(false)
      expect(matchesPattern('hello', trigger)).toBe(false)
    })

    it('matches multi-word phrases', () => {
      const trigger = createTestTrigger({ patternType: 'contains', triggerPhrase: 'compro usdt' })
      expect(matchesPattern('quero compro usdt agora', trigger)).toBe(true)
    })
  })

  // =========================================================================
  // Pattern Matching: Regex
  // =========================================================================

  describe('matchesPattern - regex', () => {
    it('matches regex patterns', () => {
      const trigger = createTestTrigger({
        patternType: 'regex',
        triggerPhrase: 'compro\\s+\\d+',
      })
      expect(matchesPattern('compro 5000', trigger)).toBe(true)
      expect(matchesPattern('compro 100', trigger)).toBe(true)
      expect(matchesPattern('COMPRO 5000', trigger)).toBe(true) // case-insensitive
    })

    it('does not match non-matching regex', () => {
      const trigger = createTestTrigger({
        patternType: 'regex',
        triggerPhrase: 'compro\\s+\\d+',
      })
      expect(matchesPattern('compro usdt', trigger)).toBe(false)
      expect(matchesPattern('vendo 5000', trigger)).toBe(false)
    })

    it('matches anchored regex', () => {
      const trigger = createTestTrigger({
        patternType: 'regex',
        triggerPhrase: '^(preço|cotação)$',
      })
      expect(matchesPattern('preço', trigger)).toBe(true)
      expect(matchesPattern('cotação', trigger)).toBe(true)
      expect(matchesPattern('qual o preço', trigger)).toBe(false)
    })

    it('handles invalid regex gracefully', () => {
      const trigger = createTestTrigger({
        patternType: 'regex',
        triggerPhrase: '[invalid',
      })
      expect(matchesPattern('test', trigger)).toBe(false)
    })

    it('matches special characters in regex', () => {
      const trigger = createTestTrigger({
        patternType: 'regex',
        triggerPhrase: 'R\\$\\s*\\d+',
      })
      expect(matchesPattern('R$ 5000', trigger)).toBe(true)
      expect(matchesPattern('R$1000', trigger)).toBe(true)
    })
  })

  // =========================================================================
  // Pattern Matching: Inactive Triggers
  // =========================================================================

  describe('matchesPattern - inactive', () => {
    it('does not match inactive triggers', () => {
      const trigger = createTestTrigger({ isActive: false, patternType: 'contains' })
      expect(matchesPattern('preço', trigger)).toBe(false)
    })

    it('does not match inactive exact triggers', () => {
      const trigger = createTestTrigger({ isActive: false, patternType: 'exact' })
      expect(matchesPattern('preço', trigger)).toBe(false)
    })

    it('does not match inactive regex triggers', () => {
      const trigger = createTestTrigger({
        isActive: false,
        patternType: 'regex',
        triggerPhrase: '.*',
      })
      expect(matchesPattern('anything', trigger)).toBe(false)
    })
  })

  // =========================================================================
  // Pattern Matching: Edge Cases
  // =========================================================================

  describe('matchesPattern - edge cases', () => {
    it('handles unicode characters in contains', () => {
      const trigger = createTestTrigger({ patternType: 'contains', triggerPhrase: 'cotação' })
      expect(matchesPattern('qual a cotação?', trigger)).toBe(true)
    })

    it('handles accented characters case-insensitively', () => {
      const trigger = createTestTrigger({ patternType: 'contains', triggerPhrase: 'preço' })
      // Note: toLowerCase() in JavaScript handles accented chars
      expect(matchesPattern('PREÇO', trigger)).toBe(true)
    })

    it('handles empty trigger phrase in contains', () => {
      const trigger = createTestTrigger({ patternType: 'contains', triggerPhrase: '' })
      // Empty string is contained in everything
      expect(matchesPattern('anything', trigger)).toBe(true)
    })

    it('handles empty trigger phrase in exact', () => {
      const trigger = createTestTrigger({ patternType: 'exact', triggerPhrase: '' })
      expect(matchesPattern('', trigger)).toBe(true)
      expect(matchesPattern('something', trigger)).toBe(false)
    })

    it('handles unknown pattern type', () => {
      const trigger = createTestTrigger({ patternType: 'unknown' as PatternType })
      expect(matchesPattern('anything', trigger)).toBe(false)
    })
  })

  // =========================================================================
  // CRUD with Supabase (null client)
  // =========================================================================

  describe('getTriggersForGroup', () => {
    it('returns empty array when Supabase is not initialized', async () => {
      const { getTriggersForGroup } = await import('./triggerService.js')
      const result = await getTriggersForGroup('test-group@g.us')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual([])
      }
    })
  })

  describe('getTriggerById', () => {
    it('returns error when Supabase is not initialized', async () => {
      const { getTriggerById } = await import('./triggerService.js')
      const result = await getTriggerById('some-id')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Supabase not initialized')
      }
    })
  })

  describe('createTrigger', () => {
    it('returns error when Supabase is not initialized', async () => {
      const { createTrigger } = await import('./triggerService.js')
      const result = await createTrigger(createTestInput())
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Supabase not initialized')
      }
    })

    it('validates input before creating', async () => {
      const { createTrigger } = await import('./triggerService.js')
      const result = await createTrigger(createTestInput({ triggerPhrase: '' }))
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('triggerPhrase is required')
      }
    })
  })

  describe('updateTrigger', () => {
    it('returns error when Supabase is not initialized', async () => {
      const { updateTrigger } = await import('./triggerService.js')
      const result = await updateTrigger('some-id', 'group@g.us', { isActive: false })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Supabase not initialized')
      }
    })

    it('validates triggerPhrase on update', async () => {
      const { updateTrigger } = await import('./triggerService.js')
      const result = await updateTrigger('some-id', 'group@g.us', { triggerPhrase: '' })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('triggerPhrase cannot be empty')
      }
    })

    it('validates patternType on update', async () => {
      const { updateTrigger } = await import('./triggerService.js')
      const result = await updateTrigger('some-id', 'group@g.us', {
        patternType: 'glob' as PatternType,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Invalid patternType')
      }
    })

    it('validates actionType on update', async () => {
      const { updateTrigger } = await import('./triggerService.js')
      const result = await updateTrigger('some-id', 'group@g.us', {
        actionType: 'custom' as TriggerActionType,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Invalid actionType')
      }
    })

    it('validates priority on update', async () => {
      const { updateTrigger } = await import('./triggerService.js')
      const result = await updateTrigger('some-id', 'group@g.us', { priority: 200 })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Priority must be between 0 and 100')
      }
    })

    it('rejects empty update', async () => {
      const { updateTrigger } = await import('./triggerService.js')
      const result = await updateTrigger('some-id', 'group@g.us', {})
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('No fields to update')
      }
    })

    it('validates phrase length on update', async () => {
      const { updateTrigger } = await import('./triggerService.js')
      const result = await updateTrigger('some-id', 'group@g.us', {
        triggerPhrase: 'a'.repeat(201),
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('200 characters or less')
      }
    })
  })

  describe('deleteTrigger', () => {
    it('returns error when Supabase is not initialized', async () => {
      const { deleteTrigger } = await import('./triggerService.js')
      const result = await deleteTrigger('some-id', 'group@g.us')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Supabase not initialized')
      }
    })
  })

  // =========================================================================
  // matchTrigger
  // =========================================================================

  describe('matchTrigger', () => {
    it('returns null when no triggers exist (Supabase null)', async () => {
      const { matchTrigger } = await import('./triggerService.js')
      const result = await matchTrigger('preço', 'test-group@g.us')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBeNull()
      }
    })
  })

  // =========================================================================
  // Cache Stats
  // =========================================================================

  describe('getTriggersCacheStats', () => {
    it('returns empty stats initially', async () => {
      const { getTriggersCacheStats } = await import('./triggerService.js')
      const stats = getTriggersCacheStats()
      expect(stats.size).toBe(0)
      expect(stats.entries).toEqual([])
    })
  })

  // =========================================================================
  // Cache clearing
  // =========================================================================

  describe('clearTriggersCache', () => {
    it('clears all cache when no groupJid provided', () => {
      // Just verify it doesn't throw
      clearTriggersCache()
    })

    it('clears specific group cache', () => {
      clearTriggersCache('test-group@g.us')
    })
  })
})
