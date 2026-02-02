import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Supabase before importing rulesService
const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockOrder = vi.fn()
const mockSingle = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import {
  initRulesService,
  findMatchingRule,
  getActiveRulesForGroup,
  refreshRulesCache,
  isRulesServiceInitialized,
  getRulesCacheStats,
  resetRulesCache,
} from './rulesService.js'
import type { EnvConfig } from '../types/config.js'

describe('rulesService', () => {
  // Only SUPABASE_URL and SUPABASE_KEY are used by rulesService
  const mockConfig = {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_KEY: 'test-key',
  } as EnvConfig

  // Sample rule rows from database
  const sampleRules = [
    {
      id: 'rule-1',
      group_jid: '123456789@g.us',
      trigger_phrase: 'compro usdt',
      response_template: 'Cotação: {price}',
      action_type: 'usdt_quote',
      action_params: {},
      is_active: true,
      priority: 100,
      conditions: {},
      metadata: {},
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'rule-2',
      group_jid: '*',
      trigger_phrase: 'preço',
      response_template: '',
      action_type: 'usdt_quote',
      action_params: {},
      is_active: true,
      priority: 1000,
      conditions: {},
      metadata: { source: 'triggers.ts' },
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'rule-3',
      group_jid: '*',
      trigger_phrase: 'cotação',
      response_template: '',
      action_type: 'usdt_quote',
      action_params: {},
      is_active: true,
      priority: 1000,
      conditions: {},
      metadata: { source: 'triggers.ts' },
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    resetRulesCache()

    // Setup mock chain
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ order: mockOrder })
    mockOrder.mockReturnValue({ order: mockOrder, data: sampleRules, error: null })
  })

  describe('initRulesService', () => {
    it('initializes successfully with valid config', async () => {
      const result = await initRulesService(mockConfig)

      expect(result.ok).toBe(true)
      expect(isRulesServiceInitialized()).toBe(true)
    })

    it('loads rules into cache grouped by groupJid', async () => {
      await initRulesService(mockConfig)

      const stats = getRulesCacheStats()
      expect(stats.totalRules).toBe(3)
      expect(stats.groupCount).toBe(2) // '123456789@g.us' and '*'
    })

    it('returns error when Supabase query fails', async () => {
      mockOrder.mockReturnValue({
        order: mockOrder,
        data: null,
        error: { code: 'PGRST001', message: 'Database error' },
      })

      const result = await initRulesService(mockConfig)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Database error')
      }
    })
  })

  describe('findMatchingRule', () => {
    beforeEach(async () => {
      await initRulesService(mockConfig)
    })

    it('returns null when service not initialized', () => {
      resetRulesCache()
      const result = findMatchingRule('123@g.us', 'test message')
      expect(result).toBeNull()
    })

    it('matches group-specific rule first', () => {
      const result = findMatchingRule('123456789@g.us', 'quero compro usdt agora')

      expect(result).not.toBeNull()
      expect(result?.id).toBe('rule-1')
      expect(result?.triggerPhrase).toBe('compro usdt')
    })

    it('falls back to global rules when no group-specific match', () => {
      const result = findMatchingRule('other-group@g.us', 'qual o preço?')

      expect(result).not.toBeNull()
      expect(result?.id).toBe('rule-2')
      expect(result?.triggerPhrase).toBe('preço')
      expect(result?.isSystem).toBe(true)
    })

    it('matches case-insensitively', () => {
      const result = findMatchingRule('123456789@g.us', 'COMPRO USDT')

      expect(result).not.toBeNull()
      expect(result?.triggerPhrase).toBe('compro usdt')
    })

    it('returns null when no rules match', () => {
      const result = findMatchingRule('123456789@g.us', 'hello world')

      expect(result).toBeNull()
    })

    it('correctly infers isSystem from metadata.source', () => {
      const result = findMatchingRule('other@g.us', 'preço')

      expect(result?.isSystem).toBe(true)
      expect(result?.scope).toBe('global')
    })

    it('correctly infers scope as "group" for non-global rules', () => {
      const result = findMatchingRule('123456789@g.us', 'compro usdt')

      expect(result?.scope).toBe('group')
      expect(result?.isSystem).toBe(false)
    })
  })

  describe('getActiveRulesForGroup', () => {
    beforeEach(async () => {
      await initRulesService(mockConfig)
    })

    it('returns empty array when service not initialized', () => {
      resetRulesCache()
      const rules = getActiveRulesForGroup('123@g.us')
      expect(rules).toEqual([])
    })

    it('returns rules for specific group', () => {
      const rules = getActiveRulesForGroup('123456789@g.us')

      expect(rules).toHaveLength(1)
      expect(rules[0].triggerPhrase).toBe('compro usdt')
    })

    it('returns global rules for wildcard group', () => {
      const rules = getActiveRulesForGroup('*')

      expect(rules).toHaveLength(2)
      expect(rules.map((r) => r.triggerPhrase)).toContain('preço')
      expect(rules.map((r) => r.triggerPhrase)).toContain('cotação')
    })

    it('returns empty array for group with no rules', () => {
      const rules = getActiveRulesForGroup('unknown@g.us')
      expect(rules).toEqual([])
    })
  })

  describe('refreshRulesCache', () => {
    beforeEach(async () => {
      await initRulesService(mockConfig)
    })

    // Note: Can't easily test "service not initialized" for refreshRulesCache
    // because the supabase client is module-level and set during init.
    // The error case is tested indirectly through init failure tests.

    it('refreshes all rules when no groupJid provided', async () => {
      // Setup for refresh call
      mockOrder.mockReturnValue({
        order: mockOrder,
        data: sampleRules,
        error: null,
      })

      const result = await refreshRulesCache()

      expect(result.ok).toBe(true)
      expect(mockFrom).toHaveBeenCalledWith('rules')
    })

    it('refreshes specific group when groupJid provided', async () => {
      mockOrder.mockReturnValue({
        order: mockOrder,
        eq: mockEq,
        data: [sampleRules[0]],
        error: null,
      })
      mockEq.mockReturnValue({
        order: mockOrder,
        data: [sampleRules[0]],
        error: null,
      })

      const result = await refreshRulesCache('123456789@g.us')

      expect(result.ok).toBe(true)
    })
  })

  describe('getRulesCacheStats', () => {
    it('returns zero stats when cache is empty', () => {
      const stats = getRulesCacheStats()

      expect(stats.groupCount).toBe(0)
      expect(stats.totalRules).toBe(0)
    })

    it('returns correct stats after initialization', async () => {
      await initRulesService(mockConfig)

      const stats = getRulesCacheStats()

      expect(stats.groupCount).toBe(2)
      expect(stats.totalRules).toBe(3)
    })
  })
})
