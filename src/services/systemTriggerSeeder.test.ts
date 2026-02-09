/**
 * Tests for Default Trigger Seeder
 * Verifies seedDefaultTriggers creates human-readable triggers
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// Mocks
// ============================================================================

const mockGetSupabase = vi.fn()
const mockClearTriggersCache = vi.fn()
const mockGetKeywordsForPattern = vi.fn()

vi.mock('./supabase.js', () => ({
  getSupabase: () => mockGetSupabase(),
}))

vi.mock('./triggerService.js', () => ({
  clearTriggersCache: (...args: unknown[]) => mockClearTriggersCache(...args),
}))

vi.mock('./systemPatternService.js', () => ({
  getKeywordsForPattern: (...args: unknown[]) => mockGetKeywordsForPattern(...args),
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import { seedDefaultTriggers } from './systemTriggerSeeder.js'

// ============================================================================
// Mock Supabase chain builder
// ============================================================================

function createMockChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {}
  const methods = ['from', 'select', 'eq', 'limit', 'upsert']
  for (const m of methods) {
    chain[m] = vi.fn(() => chain)
  }
  // Default: no existing triggers
  chain.limit = vi.fn(() => ({ data: [], error: null }))
  // Default: upsert succeeds
  chain.upsert = vi.fn(() => ({ error: null }))
  Object.assign(chain, overrides)
  return chain
}

// ============================================================================
// Tests
// ============================================================================

describe('seedDefaultTriggers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default keyword mocks
    mockGetKeywordsForPattern.mockImplementation((key: string) => {
      const map: Record<string, string[]> = {
        price_request: ['preço', 'cotação'],
        deal_cancellation: ['cancela', 'cancelar', 'cancel'],
        price_lock: ['trava', 'lock', 'travar'],
        deal_confirmation: ['fechado', 'fecha', 'fechar', 'confirma', 'confirmado', 'confirmed'],
      }
      return Promise.resolve(map[key] || [])
    })
  })

  it('does nothing when Supabase is not initialized', async () => {
    mockGetSupabase.mockReturnValue(null)
    await seedDefaultTriggers('group@g.us')
    expect(mockClearTriggersCache).not.toHaveBeenCalled()
  })

  it('skips seeding if group already has any triggers', async () => {
    const chain = createMockChain()
    chain.limit = vi.fn(() => ({ data: [{ id: 'existing' }], error: null }))
    mockGetSupabase.mockReturnValue(chain)

    await seedDefaultTriggers('group@g.us')

    expect(chain.upsert).not.toHaveBeenCalled()
  })

  it('seeds default triggers for a regular group (no control commands)', async () => {
    const chain = createMockChain()
    mockGetSupabase.mockReturnValue(chain)

    await seedDefaultTriggers('new-group@g.us')

    const upsertCall = (chain.upsert as ReturnType<typeof vi.fn>).mock.calls[0]
    const rows = upsertCall[0] as Array<Record<string, unknown>>

    expect(upsertCall[1]).toEqual(expect.objectContaining({ onConflict: 'group_jid,trigger_phrase' }))

    // Verify expected action types are present (NO control_command for regular groups)
    const actionTypes = rows.map(r => r.action_type)
    expect(actionTypes).toContain('price_quote')
    expect(actionTypes).toContain('deal_cancel')
    expect(actionTypes).toContain('deal_lock')
    expect(actionTypes).toContain('deal_confirm')
    expect(actionTypes).toContain('deal_volume')
    expect(actionTypes).toContain('tronscan_process')
    expect(actionTypes).not.toContain('control_command')

    // All rows belong to right group, marked as system, group scope only
    for (const row of rows) {
      expect(row.group_jid).toBe('new-group@g.us')
      expect(row.is_system).toBe(true)
      expect(row.is_active).toBe(true)
      expect(row.scope).toBe('group')
    }

    // Keyword triggers should be 'contains' type with human-readable phrases
    const priceTriggers = rows.filter(r => r.action_type === 'price_quote')
    expect(priceTriggers.length).toBe(2) // preço, cotação
    for (const t of priceTriggers) {
      expect(t.pattern_type).toBe('contains')
      expect(['preço', 'cotação']).toContain(t.trigger_phrase)
    }

    const cancelTriggers = rows.filter(r => r.action_type === 'deal_cancel')
    expect(cancelTriggers.length).toBe(3) // cancela, cancelar, cancel
    for (const t of cancelTriggers) {
      expect(t.pattern_type).toBe('contains')
    }

    // Fixed regex triggers stay as regex
    const tronscan = rows.find(r => r.action_type === 'tronscan_process')
    expect(tronscan?.pattern_type).toBe('regex')

    const volume = rows.find(r => r.action_type === 'deal_volume')
    expect(volume?.pattern_type).toBe('regex')

    expect(mockClearTriggersCache).toHaveBeenCalledWith('new-group@g.us')
  })

  it('seeds control command triggers only for control groups', async () => {
    const chain = createMockChain()
    mockGetSupabase.mockReturnValue(chain)

    await seedDefaultTriggers('control@g.us', true)

    const upsertCall = (chain.upsert as ReturnType<typeof vi.fn>).mock.calls[0]
    const rows = upsertCall[0] as Array<Record<string, unknown>>

    // Control group gets ALL triggers including control commands
    const actionTypes = rows.map(r => r.action_type)
    expect(actionTypes).toContain('control_command')

    const controlTriggers = rows.filter(r => r.action_type === 'control_command')
    expect(controlTriggers.length).toBe(7)
    for (const t of controlTriggers) {
      expect(t.pattern_type).toBe('exact')
      expect(t.scope).toBe('control_only')
    }
    const controlPhrases = controlTriggers.map(r => r.trigger_phrase)
    expect(controlPhrases).toContain('status')
    expect(controlPhrases).toContain('pause')
    expect(controlPhrases).toContain('resume')
    expect(controlPhrases).toContain('modes')
    expect(controlPhrases).toContain('training on')
    expect(controlPhrases).toContain('training off')
    expect(controlPhrases).toContain('off')

    // Non-control triggers should have 'group' scope
    const groupTriggers = rows.filter(r => r.action_type !== 'control_command')
    for (const t of groupTriggers) {
      expect(t.scope).toBe('group')
    }
  })

  it('handles DB check error gracefully', async () => {
    const chain = createMockChain()
    chain.limit = vi.fn(() => ({ data: null, error: { message: 'Connection failed' } }))
    mockGetSupabase.mockReturnValue(chain)

    await seedDefaultTriggers('group@g.us')
    expect(chain.upsert).not.toHaveBeenCalled()
  })

  it('handles upsert error gracefully', async () => {
    const chain = createMockChain()
    chain.upsert = vi.fn(() => ({ error: { message: 'Upsert failed' } }))
    mockGetSupabase.mockReturnValue(chain)

    await seedDefaultTriggers('group@g.us')
    expect(mockClearTriggersCache).not.toHaveBeenCalled()
  })

  it('creates correct total count of triggers', async () => {
    const chain = createMockChain()
    mockGetSupabase.mockReturnValue(chain)

    await seedDefaultTriggers('group@g.us')

    const upsertCall = (chain.upsert as ReturnType<typeof vi.fn>).mock.calls[0]
    const rows = upsertCall[0] as Array<Record<string, unknown>>

    // 2 (price) + 3 (cancel) + 3 (lock) + 6 (confirm) + 1 (tronscan regex) + 1 (volume regex) = 16
    // (no control commands for regular groups)
    expect(rows.length).toBe(16)
  })
})
