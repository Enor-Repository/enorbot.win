import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// Mocks
// ============================================================================

const mockGetSupabase = vi.hoisted(() => vi.fn())
const mockBuildSystemTriggerRows = vi.hoisted(() => vi.fn())
const mockClearTriggersCache = vi.hoisted(() => vi.fn())

vi.mock('./supabase.js', () => ({
  getSupabase: () => mockGetSupabase(),
}))

vi.mock('./systemTriggerTemplates.js', () => ({
  buildSystemTriggerRows: (...args: unknown[]) => mockBuildSystemTriggerRows(...args),
}))

vi.mock('./triggerService.js', () => ({
  clearTriggersCache: (...args: unknown[]) => mockClearTriggersCache(...args),
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
  reconcileSystemTriggers,
  resetSystemTriggerReconciliationStateForTests,
} from './systemTriggerReconciler.js'

// ============================================================================
// Helpers
// ============================================================================

interface MockError {
  code?: string
  message: string
}

interface ExistingTriggerRow {
  id: string
  group_jid: string
  trigger_phrase: string
  pattern_type: string
  action_type: string
  priority: number
  is_active: boolean
  is_system: boolean
  scope: string
  display_name: string | null
}

interface RequiredTriggerRow {
  group_jid: string
  trigger_phrase: string
  pattern_type: 'exact' | 'contains' | 'regex'
  action_type: string
  action_params: Record<string, unknown>
  priority: number
  is_active: boolean
  is_system: boolean
  scope: 'group' | 'control_only'
  display_name?: string
}

function createRequiredRow(
  phrase: string,
  action: string,
  overrides: Partial<RequiredTriggerRow> = {}
): RequiredTriggerRow {
  return {
    group_jid: 'group@g.us',
    trigger_phrase: phrase,
    pattern_type: 'contains',
    action_type: action,
    action_params: {},
    priority: 90,
    is_active: true,
    is_system: true,
    scope: 'group',
    ...overrides,
  }
}

function createExistingRow(
  phrase: string,
  action: string,
  overrides: Partial<ExistingTriggerRow> = {}
): ExistingTriggerRow {
  return {
    id: `${phrase}-id`,
    group_jid: 'group@g.us',
    trigger_phrase: phrase,
    pattern_type: 'contains',
    action_type: action,
    priority: 90,
    is_active: true,
    is_system: true,
    scope: 'group',
    display_name: null,
    ...overrides,
  }
}

function createMockSupabase(
  selectRows: ExistingTriggerRow[],
  options?: {
    insertErrorsByPhrase?: Record<string, MockError | null>
    updateErrorsById?: Record<string, MockError | null>
  }
) {
  const insertCalls: RequiredTriggerRow[] = []
  const updateCalls: Array<{ patch: Record<string, unknown>; id: string; groupJid: string }> = []

  const selectEq = vi.fn(async () => ({ data: selectRows, error: null }))
  const select = vi.fn(() => ({ eq: selectEq }))

  const insert = vi.fn(async (row: RequiredTriggerRow) => {
    insertCalls.push(row)
    const insertError = options?.insertErrorsByPhrase?.[row.trigger_phrase] ?? null
    return { error: insertError }
  })

  const update = vi.fn((patch: Record<string, unknown>) => ({
    eq: vi.fn((fieldA: string, valueA: string) => ({
      eq: vi.fn(async (fieldB: string, valueB: string) => {
        const id = fieldA === 'id' ? valueA : valueB
        const groupJid = fieldA === 'group_jid' ? valueA : valueB
        updateCalls.push({ patch, id, groupJid })
        const updateError = options?.updateErrorsById?.[id] ?? null
        return { error: updateError }
      }),
    })),
  }))

  const tableApi = { select, insert, update }
  const supabase = {
    from: vi.fn(() => tableApi),
  }

  return {
    supabase,
    select,
    insert,
    update,
    insertCalls,
    updateCalls,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('reconcileSystemTriggers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSystemTriggerReconciliationStateForTests()
  })

  it('returns error when Supabase is not initialized', async () => {
    mockGetSupabase.mockReturnValue(null)

    const result = await reconcileSystemTriggers('group@g.us')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Supabase not initialized')
    }
  })

  it('inserts missing required triggers and clears cache', async () => {
    const requiredRows = [
      createRequiredRow('cancela', 'deal_cancel'),
      createRequiredRow('trava', 'deal_lock'),
    ]
    mockBuildSystemTriggerRows.mockResolvedValue(requiredRows)

    const mockDb = createMockSupabase([])
    mockGetSupabase.mockReturnValue(mockDb.supabase)

    const result = await reconcileSystemTriggers('group@g.us')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.insertedCount).toBe(2)
      expect(result.data.updatedCount).toBe(0)
      expect(result.data.conflicts).toHaveLength(0)
    }
    expect(mockDb.insertCalls).toHaveLength(2)
    expect(mockClearTriggersCache).toHaveBeenCalledWith('group@g.us')
  })

  it('updates drifted system-owned triggers to canonical shape', async () => {
    const requiredRows = [
      createRequiredRow('trava', 'deal_lock', {
        pattern_type: 'contains',
        priority: 90,
      }),
    ]
    mockBuildSystemTriggerRows.mockResolvedValue(requiredRows)

    const existingRows = [
      createExistingRow('trava', 'deal_confirm', {
        id: 'trava-id',
        pattern_type: 'exact',
        priority: 10,
        is_active: false,
        is_system: true,
      }),
    ]

    const mockDb = createMockSupabase(existingRows)
    mockGetSupabase.mockReturnValue(mockDb.supabase)

    const result = await reconcileSystemTriggers('group@g.us')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.insertedCount).toBe(0)
      expect(result.data.updatedCount).toBe(1)
      expect(result.data.conflicts).toHaveLength(0)
    }
    expect(mockDb.updateCalls).toHaveLength(1)
    expect(mockDb.updateCalls[0]?.id).toBe('trava-id')
    expect(mockDb.updateCalls[0]?.patch).toEqual(expect.objectContaining({
      pattern_type: 'contains',
      action_type: 'deal_lock',
      priority: 90,
      is_active: true,
      is_system: true,
      scope: 'group',
    }))
    expect(mockClearTriggersCache).toHaveBeenCalledWith('group@g.us')
  })

  it('does not override conflicting user-owned trigger phrases', async () => {
    const requiredRows = [createRequiredRow('cancela', 'deal_cancel')]
    mockBuildSystemTriggerRows.mockResolvedValue(requiredRows)

    const existingRows = [
      createExistingRow('cancela', 'text_response', {
        id: 'user-conflict-id',
        is_system: false,
      }),
    ]
    const mockDb = createMockSupabase(existingRows)
    mockGetSupabase.mockReturnValue(mockDb.supabase)

    const result = await reconcileSystemTriggers('group@g.us')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.insertedCount).toBe(0)
      expect(result.data.updatedCount).toBe(0)
      expect(result.data.conflicts).toHaveLength(1)
      expect(result.data.conflicts[0]).toEqual(expect.objectContaining({
        triggerPhrase: 'cancela',
        existingActionType: 'text_response',
        requiredActionType: 'deal_cancel',
        reason: 'user_owned_conflict',
      }))
    }

    expect(mockDb.insertCalls).toHaveLength(0)
    expect(mockDb.updateCalls).toHaveLength(0)
    expect(mockClearTriggersCache).not.toHaveBeenCalled()
  })

  it('prefers user-owned rows when normalized phrases collide', async () => {
    const requiredRows = [createRequiredRow('cancela', 'deal_cancel')]
    mockBuildSystemTriggerRows.mockResolvedValue(requiredRows)

    const existingRows = [
      createExistingRow('CANCELA', 'deal_cancel', {
        id: 'system-caps-id',
        is_system: true,
      }),
      createExistingRow('cancela', 'text_response', {
        id: 'user-lower-id',
        is_system: false,
      }),
    ]
    const mockDb = createMockSupabase(existingRows)
    mockGetSupabase.mockReturnValue(mockDb.supabase)

    const result = await reconcileSystemTriggers('group@g.us')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.insertedCount).toBe(0)
      expect(result.data.updatedCount).toBe(0)
      expect(result.data.conflicts).toHaveLength(1)
      expect(result.data.conflicts[0]).toEqual(expect.objectContaining({
        triggerPhrase: 'cancela',
        existingActionType: 'text_response',
        requiredActionType: 'deal_cancel',
        reason: 'user_owned_conflict',
      }))
    }

    expect(mockDb.insertCalls).toHaveLength(0)
    expect(mockDb.updateCalls).toHaveLength(0)
    expect(mockClearTriggersCache).not.toHaveBeenCalled()
  })

  it('is a no-op when required triggers are already canonical', async () => {
    const requiredRows = [
      createRequiredRow('tronscan\\.(?:org|io)/#/transaction/[a-f0-9]{64}', 'tronscan_process', {
        pattern_type: 'regex',
        priority: 95,
        display_name: 'Tronscan Link',
      }),
    ]
    mockBuildSystemTriggerRows.mockResolvedValue(requiredRows)

    const existingRows = [
      createExistingRow('tronscan\\.(?:org|io)/#/transaction/[a-f0-9]{64}', 'tronscan_process', {
        id: 'tronscan-id',
        pattern_type: 'regex',
        priority: 95,
        display_name: 'Tronscan Link',
      }),
    ]
    const mockDb = createMockSupabase(existingRows)
    mockGetSupabase.mockReturnValue(mockDb.supabase)

    const result = await reconcileSystemTriggers('group@g.us')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.insertedCount).toBe(0)
      expect(result.data.updatedCount).toBe(0)
      expect(result.data.conflicts).toHaveLength(0)
    }
    expect(mockDb.insertCalls).toHaveLength(0)
    expect(mockDb.updateCalls).toHaveLength(0)
    expect(mockClearTriggersCache).not.toHaveBeenCalled()
  })
})
