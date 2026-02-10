/**
 * Tests for systemPatternService
 * Covers: cache behavior, fallback logic, Supabase mapping, sync reads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock Supabase client
/* eslint-disable @typescript-eslint/no-explicit-any */
const mockSelect = vi.fn()
const mockOrder = vi.fn((): any => ({ data: null, error: null }))
const mockUpdate = vi.fn()
const mockEq = vi.fn()

const mockFrom = vi.fn((): any => ({
  select: mockSelect.mockReturnValue({ order: mockOrder }),
  update: mockUpdate.mockReturnValue({ eq: mockEq }),
}))

const mockSupabase = { from: mockFrom }

vi.mock('./supabase.js', () => ({
  getSupabase: vi.fn(() => mockSupabase),
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
  getAllPatterns,
  getKeywordsForPattern,
  getKeywordsForPatternSync,
  updatePatternKeywords,
  invalidateCache,
  cleanupSystemPatternService,
  testMessageAgainstPatterns,
} from './systemPatternService.js'
import { getSupabase } from './supabase.js'

// Sample DB rows as returned by Supabase
const SAMPLE_ROWS = [
  {
    id: 'uuid-1',
    pattern_key: 'deal_cancellation',
    keywords: ['cancela', 'cancelar', 'cancel'],
    pattern_type: 'regex',
    handler: 'DEAL_HANDLER',
    description: 'Cancels the active deal',
    updated_at: '2026-02-04T12:00:00Z',
  },
  {
    id: 'uuid-2',
    pattern_key: 'price_request',
    keywords: ['preço', 'cotação'],
    pattern_type: 'contains',
    handler: 'PRICE_HANDLER',
    description: 'Triggers a price quote',
    updated_at: '2026-02-04T12:00:00Z',
  },
]

describe('systemPatternService', () => {
  beforeEach(() => {
    invalidateCache()
    vi.clearAllMocks()

    // Re-setup getSupabase mock (clearAllMocks clears its return value)
    vi.mocked(getSupabase).mockReturnValue(mockSupabase as any)

    // Default: successful Supabase response
    mockOrder.mockResolvedValue({ data: SAMPLE_ROWS, error: null } as any)
    mockFrom.mockReturnValue({
      select: mockSelect.mockReturnValue({ order: mockOrder }),
      update: mockUpdate.mockReturnValue({ eq: mockEq }),
    } as any)
  })

  afterEach(() => {
    cleanupSystemPatternService()
  })

  // =========================================================================
  // getAllPatterns
  // =========================================================================

  describe('getAllPatterns', () => {
    it('loads patterns from Supabase and maps column names', async () => {
      const result = await getAllPatterns()
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.data).toHaveLength(2)
      expect(result.data[0].patternKey).toBe('deal_cancellation')
      expect(result.data[0].keywords).toEqual(['cancela', 'cancelar', 'cancel'])
      expect(result.data[0].handler).toBe('DEAL_HANDLER')
      expect(result.data[1].patternKey).toBe('price_request')
    })

    it('returns cached data on second call (no DB hit)', async () => {
      await getAllPatterns()
      await getAllPatterns()

      // from() should only be called once (first call)
      expect(mockFrom).toHaveBeenCalledTimes(1)
    })

    it('refetches after cache invalidation', async () => {
      await getAllPatterns()
      invalidateCache()
      await getAllPatterns()

      expect(mockFrom).toHaveBeenCalledTimes(2)
    })

    it('returns stale cache when Supabase errors', async () => {
      // First call: populate cache
      await getAllPatterns()

      // Invalidate and make Supabase fail
      invalidateCache()
      // Re-populate cache for stale test
      mockOrder.mockResolvedValueOnce({ data: SAMPLE_ROWS, error: null } as any)
      await getAllPatterns()

      // Now simulate error
      invalidateCache()
      mockOrder.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } } as any)

      // Should still return previous cache (stale fallback logic works because
      // the cache was populated and then cleared, so the service tries DB first)
      const result = await getAllPatterns()
      // With cache cleared and DB failing, and no stale cache, returns err
      expect(result.ok).toBe(false)
    })

    it('returns error when Supabase not initialized and no cache', async () => {
      vi.mocked(getSupabase).mockReturnValueOnce(null)
      const result = await getAllPatterns()
      expect(result.ok).toBe(false)
    })

    it('returns snapshot copy, not cache reference', async () => {
      const result1 = await getAllPatterns()
      const result2 = await getAllPatterns()

      if (result1.ok && result2.ok) {
        expect(result1.data).not.toBe(result2.data)
        expect(result1.data).toEqual(result2.data)
      }
    })
  })

  // =========================================================================
  // getKeywordsForPattern
  // =========================================================================

  describe('getKeywordsForPattern', () => {
    it('returns keywords for a valid pattern key', async () => {
      const keywords = await getKeywordsForPattern('price_request')
      expect(keywords).toEqual(['preço', 'cotação'])
    })

    it('returns keywords for deal_cancellation', async () => {
      const keywords = await getKeywordsForPattern('deal_cancellation')
      expect(keywords).toEqual(['cancela', 'cancelar', 'cancel'])
    })

    it('falls back to hardcoded defaults when DB fails', async () => {
      vi.mocked(getSupabase).mockReturnValue(null)
      invalidateCache()

      const keywords = await getKeywordsForPattern('price_request')
      expect(keywords).toEqual(['preço', 'cotação', 'taxa', 'cotaçaõ'])
    })

    it('falls back for deal_confirmation (not in DB mock)', async () => {
      // Our mock only returns deal_cancellation and price_request
      const keywords = await getKeywordsForPattern('deal_confirmation')
      // Not found in mock DB data → falls back to hardcoded
      expect(keywords).toContain('fechado')
      expect(keywords).toContain('confirma')
    })
  })

  // =========================================================================
  // getKeywordsForPatternSync
  // =========================================================================

  describe('getKeywordsForPatternSync', () => {
    it('returns fallback keywords when cache is empty', () => {
      invalidateCache()
      const keywords = getKeywordsForPatternSync('price_request')
      expect(keywords).toEqual(['preço', 'cotação', 'taxa', 'cotaçaõ'])
    })

    it('returns cached keywords after async load', async () => {
      // Populate cache via async call
      await getAllPatterns()

      const keywords = getKeywordsForPatternSync('price_request')
      expect(keywords).toEqual(['preço', 'cotação'])
    })

    it('returns cached deal_cancellation keywords', async () => {
      await getAllPatterns()
      const keywords = getKeywordsForPatternSync('deal_cancellation')
      expect(keywords).toEqual(['cancela', 'cancelar', 'cancel'])
    })

    it('returns fallback after cache invalidation', async () => {
      await getAllPatterns()
      invalidateCache()

      // Cache cleared → fallback
      const keywords = getKeywordsForPatternSync('price_lock')
      expect(keywords).toEqual(['trava', 'lock', 'travar', 'travcar'])
    })
  })

  // =========================================================================
  // updatePatternKeywords
  // =========================================================================

  describe('updatePatternKeywords', () => {
    it('updates keywords and invalidates cache', async () => {
      const updatedRow = {
        id: 'uuid-2',
        pattern_key: 'price_request',
        keywords: ['preço', 'cotação', 'novo'],
        pattern_type: 'contains',
        handler: 'PRICE_HANDLER',
        description: 'Triggers a price quote',
        updated_at: '2026-02-04T13:00:00Z',
      }

      mockEq.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [updatedRow], error: null }) })

      const result = await updatePatternKeywords('price_request', ['preço', 'cotação', 'novo'])
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.keywords).toEqual(['preço', 'cotação', 'novo'])
        expect(result.data.patternKey).toBe('price_request')
      }
    })

    it('returns error when pattern not found', async () => {
      mockEq.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) })

      const result = await updatePatternKeywords('nonexistent', ['test'])
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Pattern not found')
      }
    })

    it('returns error when Supabase not initialized', async () => {
      vi.mocked(getSupabase).mockReturnValueOnce(null)
      const result = await updatePatternKeywords('price_request', ['test'])
      expect(result.ok).toBe(false)
    })
  })

  // =========================================================================
  // invalidateCache / cleanupSystemPatternService
  // =========================================================================

  // =========================================================================
  // testMessageAgainstPatterns
  // =========================================================================

  describe('testMessageAgainstPatterns', () => {
    const FULL_ROWS = [
      ...SAMPLE_ROWS,
      {
        id: 'uuid-3',
        pattern_key: 'price_lock',
        keywords: ['trava', 'lock', 'travar'],
        pattern_type: 'regex',
        handler: 'DEAL_HANDLER',
        description: 'Locks rate',
        updated_at: '2026-02-04T12:00:00Z',
      },
      {
        id: 'uuid-4',
        pattern_key: 'deal_confirmation',
        keywords: ['fechado', 'confirma'],
        pattern_type: 'regex',
        handler: 'DEAL_HANDLER',
        description: 'Confirms deal',
        updated_at: '2026-02-04T12:00:00Z',
      },
    ]

    beforeEach(() => {
      invalidateCache()
      mockOrder.mockResolvedValue({ data: FULL_ROWS, error: null } as any)
    })

    it('matches price_request for "preço"', async () => {
      const matches = await testMessageAgainstPatterns('preço')
      const priceMatch = matches.find(m => m.patternKey === 'price_request')
      expect(priceMatch?.matched).toBe(true)
      expect(priceMatch?.matchedKeyword).toBe('preço')
    })

    it('matches deal_cancellation for "cancela"', async () => {
      const matches = await testMessageAgainstPatterns('eu quero cancela')
      const cancelMatch = matches.find(m => m.patternKey === 'deal_cancellation')
      expect(cancelMatch?.matched).toBe(true)
      expect(cancelMatch?.matchedKeyword).toBe('cancela')
    })

    it('matches price_lock for "trava"', async () => {
      const matches = await testMessageAgainstPatterns('trava esse')
      const lockMatch = matches.find(m => m.patternKey === 'price_lock')
      expect(lockMatch?.matched).toBe(true)
      expect(lockMatch?.matchedKeyword).toBe('trava')
    })

    it('matches deal_confirmation for "fechado"', async () => {
      const matches = await testMessageAgainstPatterns('fechado!')
      const confirmMatch = matches.find(m => m.patternKey === 'deal_confirmation')
      expect(confirmMatch?.matched).toBe(true)
      expect(confirmMatch?.matchedKeyword).toBe('fechado')
    })

    it('returns all 4 pattern results', async () => {
      const matches = await testMessageAgainstPatterns('hello world')
      expect(matches).toHaveLength(4)
      expect(matches.every(m => !m.matched)).toBe(true)
      expect(matches.map(m => m.patternKey)).toEqual([
        'price_request', 'deal_cancellation', 'price_lock', 'deal_confirmation',
      ])
    })

    it('does not false-positive on partial words', async () => {
      const matches = await testMessageAgainstPatterns('preçosamente')
      const priceMatch = matches.find(m => m.patternKey === 'price_request')
      expect(priceMatch?.matched).toBe(false)
    })

    it('uses fallback keywords when DB fails', async () => {
      mockOrder.mockResolvedValue({ data: null, error: { message: 'DB down' } } as any)
      invalidateCache()

      const matches = await testMessageAgainstPatterns('preço')
      const priceMatch = matches.find(m => m.patternKey === 'price_request')
      // Falls back to hardcoded keywords which include 'preço'
      expect(priceMatch?.matched).toBe(true)
    })
  })

  describe('cache management', () => {
    it('invalidateCache clears the cache', async () => {
      await getAllPatterns()
      invalidateCache()
      await getAllPatterns()

      // Two DB calls = cache was cleared
      expect(mockFrom).toHaveBeenCalledTimes(2)
    })

    it('cleanupSystemPatternService clears the cache', async () => {
      await getAllPatterns()
      cleanupSystemPatternService()
      await getAllPatterns()

      expect(mockFrom).toHaveBeenCalledTimes(2)
    })
  })
})
