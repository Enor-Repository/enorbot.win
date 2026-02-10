/**
 * Tests for Deal Flow Service
 * Sprint 4, Task 4.2
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Hoist mock functions
const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: {
    from: vi.fn(),
  },
}))

vi.mock('./supabase.js', () => ({
  getSupabase: () => mockSupabase,
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock data lake to prevent bronze deal event side effects during tests
vi.mock('./dataLake.js', () => ({
  emitDealEvent: vi.fn(),
}))

import {
  createDeal,
  getActiveDeals,
  getActiveDealForSender,
  getAllDeals,
  getDealById,
  findClientDeal,
  lockDeal,
  startComputation,
  completeDeal,
  cancelDeal,
  rejectDeal,
  startAwaitingAmount,
  expireDeal,
  extendDealTtl,
  sweepExpiredDeals,
  getDealsNeedingReprompt,
  markReprompted,
  archiveDeal,
  getDealHistory,
  isValidTransition,
  validateCreateDealInput,
  clearDealsCache,
  type CreateDealInput,
  type ActiveDeal,
} from './dealFlowService.js'

describe('dealFlowService', () => {
  const groupJid = '123456@g.us'
  const clientJid = '5511999999999@s.whatsapp.net'

  const validCreateInput: CreateDealInput = {
    groupJid,
    clientJid,
    side: 'client_buys_usdt',
    quotedRate: 5.25,
    baseRate: 5.20,
    ttlSeconds: 180,
    amountBrl: 10000,
  }

  // Use future dates to avoid TTL expiration issues
  const futureDate = new Date(Date.now() + 3600_000).toISOString() // 1 hour from now

  const mockDealRow = {
    id: 'deal-1',
    group_jid: groupJid,
    client_jid: clientJid,
    state: 'quoted',
    side: 'client_buys_usdt',
    quoted_rate: 5.25,
    base_rate: 5.20,
    quoted_at: new Date().toISOString(),
    locked_rate: null,
    locked_at: null,
    amount_brl: 10000,
    amount_usdt: null,
    ttl_expires_at: futureDate,
    rule_id_used: null,
    rule_name: null,
    pricing_source: 'usdt_binance',
    spread_mode: 'bps',
    sell_spread: 0,
    buy_spread: 0,
    reprompted_at: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const mockLockedRow = {
    ...mockDealRow,
    state: 'locked',
    locked_rate: 5.25,
    locked_at: '2026-02-05T10:01:00Z',
  }

  const mockComputingRow = {
    ...mockLockedRow,
    state: 'computing',
  }

  /**
   * Create a thenable chain mock for Supabase.
   * Each method returns the chain, and the chain itself is thenable
   * (resolves to { data, error }) so it works regardless of which
   * method is the last in the chain.
   */
  function createChainMock(result: { data: unknown; error: unknown }) {
    const chain: Record<string, unknown> = {}

    // The chain is thenable — resolves when awaited at any point
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)

    // Every method returns the chain (allowing continued chaining)
    const methods = ['select', 'insert', 'update', 'delete', 'eq', 'not', 'in', 'lt', 'order', 'limit']
    for (const method of methods) {
      chain[method] = vi.fn().mockReturnValue(chain)
    }
    // .single() resolves directly
    chain.single = vi.fn().mockResolvedValue(result)

    return chain
  }

  // Helper to set up a single chain for all .from() calls
  function setupChain(finalResult: { data: unknown; error: unknown }) {
    const chain = createChainMock(finalResult)
    mockSupabase.from.mockReturnValue(chain)
    return chain
  }

  // Helper for sequential calls that need different results per .from() call
  function setupSequentialChains(results: Array<{ data: unknown; error: unknown }>) {
    const chains = results.map((result) => createChainMock(result))

    let callIndex = 0
    mockSupabase.from.mockImplementation(() => {
      const chain = chains[Math.min(callIndex, chains.length - 1)]
      callIndex++
      return chain
    })
    return chains
  }

  beforeEach(() => {
    vi.clearAllMocks()
    clearDealsCache()
  })

  // ============================================================
  // Validation
  // ============================================================

  describe('validateCreateDealInput', () => {
    it('returns null for valid input', () => {
      expect(validateCreateDealInput(validCreateInput)).toBeNull()
    })

    it('rejects missing groupJid', () => {
      expect(validateCreateDealInput({ ...validCreateInput, groupJid: '' })).toBe('groupJid is required')
    })

    it('rejects missing clientJid', () => {
      expect(validateCreateDealInput({ ...validCreateInput, clientJid: '' })).toBe('clientJid is required')
    })

    it('rejects invalid side', () => {
      expect(validateCreateDealInput({ ...validCreateInput, side: 'invalid' as 'client_buys_usdt' })).toBe('Invalid side')
    })

    it('rejects non-positive quotedRate', () => {
      expect(validateCreateDealInput({ ...validCreateInput, quotedRate: 0 })).toBe('quotedRate must be positive')
      expect(validateCreateDealInput({ ...validCreateInput, quotedRate: -1 })).toBe('quotedRate must be positive')
    })

    it('rejects non-positive baseRate', () => {
      expect(validateCreateDealInput({ ...validCreateInput, baseRate: 0 })).toBe('baseRate must be positive')
    })

    it('rejects non-positive ttlSeconds', () => {
      expect(validateCreateDealInput({ ...validCreateInput, ttlSeconds: 0 })).toBe('ttlSeconds must be positive')
    })

    it('rejects invalid amountBrl', () => {
      expect(validateCreateDealInput({ ...validCreateInput, amountBrl: -100 })).toBe('amountBrl must be positive')
    })

    it('rejects invalid amountUsdt', () => {
      expect(validateCreateDealInput({ ...validCreateInput, amountUsdt: -100 })).toBe('amountUsdt must be positive')
    })

    it('allows optional amountBrl/amountUsdt to be undefined', () => {
      const input = { ...validCreateInput }
      delete (input as Record<string, unknown>).amountBrl
      expect(validateCreateDealInput(input)).toBeNull()
    })
  })

  // ============================================================
  // State transitions
  // ============================================================

  describe('isValidTransition', () => {
    it('allows quoted → locked', () => {
      expect(isValidTransition('quoted', 'locked')).toBe(true)
    })

    it('allows quoted → expired', () => {
      expect(isValidTransition('quoted', 'expired')).toBe(true)
    })

    it('allows quoted → cancelled', () => {
      expect(isValidTransition('quoted', 'cancelled')).toBe(true)
    })

    it('allows locked → computing', () => {
      expect(isValidTransition('locked', 'computing')).toBe(true)
    })

    it('allows locked → expired', () => {
      expect(isValidTransition('locked', 'expired')).toBe(true)
    })

    it('allows locked → cancelled', () => {
      expect(isValidTransition('locked', 'cancelled')).toBe(true)
    })

    it('allows computing → completed', () => {
      expect(isValidTransition('computing', 'completed')).toBe(true)
    })

    it('allows computing → cancelled', () => {
      expect(isValidTransition('computing', 'cancelled')).toBe(true)
    })

    it('rejects quoted → completed (must go through locked/computing)', () => {
      expect(isValidTransition('quoted', 'completed')).toBe(false)
    })

    it('rejects completed → anything', () => {
      expect(isValidTransition('completed', 'quoted')).toBe(false)
      expect(isValidTransition('completed', 'locked')).toBe(false)
      expect(isValidTransition('completed', 'cancelled')).toBe(false)
    })

    it('rejects expired → anything', () => {
      expect(isValidTransition('expired', 'quoted')).toBe(false)
    })

    it('rejects cancelled → anything', () => {
      expect(isValidTransition('cancelled', 'quoted')).toBe(false)
    })

    it('rejects backwards transitions', () => {
      expect(isValidTransition('locked', 'quoted')).toBe(false)
      expect(isValidTransition('computing', 'locked')).toBe(false)
    })
  })

  // ============================================================
  // Create deal
  // ============================================================

  describe('createDeal', () => {
    it('creates a deal in quoted state', async () => {
      setupSequentialChains([
        { data: [], error: null }, // check for existing deals
        { data: mockDealRow, error: null }, // insert
      ])

      const result = await createDeal(validCreateInput)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.state).toBe('quoted')
        expect(result.data.groupJid).toBe(groupJid)
        expect(result.data.clientJid).toBe(clientJid)
        expect(result.data.quotedRate).toBe(5.25)
        expect(result.data.baseRate).toBe(5.20)
        expect(result.data.side).toBe('client_buys_usdt')
      }
    })

    it('rejects if client has existing active deal', async () => {
      setupSequentialChains([
        { data: [{ id: 'existing-deal', state: 'quoted' }], error: null },
      ])

      const result = await createDeal(validCreateInput)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('already has an active deal')
      }
    })

    it('rejects invalid input', async () => {
      const result = await createDeal({ ...validCreateInput, quotedRate: -1 })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('quotedRate must be positive')
      }
    })

    it('handles Supabase insert error', async () => {
      setupSequentialChains([
        { data: [], error: null },
        { data: null, error: { message: 'DB error', code: '23505' } },
      ])

      const result = await createDeal(validCreateInput)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Failed to create deal')
      }
    })

    it('snapshots rule when provided', async () => {
      const rule = {
        id: 'rule-1',
        groupJid,
        name: 'Business Hours',
        description: null,
        scheduleStartTime: '09:00',
        scheduleEndTime: '18:00',
        scheduleDays: ['mon', 'tue', 'wed', 'thu', 'fri'] as ('mon' | 'tue' | 'wed' | 'thu' | 'fri')[],
        scheduleTimezone: 'America/Sao_Paulo',
        priority: 10,
        pricingSource: 'commercial_dollar' as const,
        spreadMode: 'bps' as const,
        sellSpread: 50,
        buySpread: 30,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const chains = setupSequentialChains([
        { data: [], error: null },
        { data: { ...mockDealRow, rule_id_used: rule.id, rule_name: rule.name, pricing_source: 'commercial_dollar', sell_spread: 50, buy_spread: 30 }, error: null },
      ])

      const result = await createDeal({ ...validCreateInput, rule })

      expect(result.ok).toBe(true)
      // Verify the insert was called (chain[1] is the insert chain)
      expect(chains[1].insert).toHaveBeenCalled()
    })
  })

  // ============================================================
  // Get deals
  // ============================================================

  describe('getActiveDeals', () => {
    it('returns active deals for a group', async () => {
      setupSequentialChains([
        { data: [mockDealRow], error: null },
      ])

      const result = await getActiveDeals(groupJid)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toHaveLength(1)
        expect(result.data[0].state).toBe('quoted')
      }
    })

    it('returns cached results on second call', async () => {
      setupSequentialChains([
        { data: [mockDealRow], error: null },
      ])

      await getActiveDeals(groupJid)
      const result = await getActiveDeals(groupJid)

      expect(result.ok).toBe(true)
      // from() should only be called once (cached on second call)
      expect(mockSupabase.from).toHaveBeenCalledTimes(1)
    })

    it('rejects empty groupJid', async () => {
      const result = await getActiveDeals('')
      expect(result.ok).toBe(false)
    })
  })

  describe('getDealById', () => {
    it('returns deal when found and group matches', async () => {
      setupChain({ data: mockDealRow, error: null })

      const result = await getDealById('deal-1', groupJid)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.id).toBe('deal-1')
      }
    })

    it('rejects deal from different group (authorization boundary)', async () => {
      setupChain({ data: { ...mockDealRow, group_jid: 'other-group@g.us' }, error: null })

      const result = await getDealById('deal-1', groupJid)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Deal not found')
      }
    })

    it('returns error for non-existent deal', async () => {
      setupChain({ data: null, error: { code: 'PGRST116', message: 'not found' } })

      const result = await getDealById('nonexistent', groupJid)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Deal not found')
      }
    })
  })

  describe('findClientDeal', () => {
    it('returns active deal for client', async () => {
      setupChain({ data: [mockDealRow], error: null })

      const result = await findClientDeal(groupJid, clientJid)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).not.toBeNull()
        expect(result.data!.clientJid).toBe(clientJid)
      }
    })

    it('returns null when no active deal', async () => {
      setupChain({ data: [], error: null })

      const result = await findClientDeal(groupJid, clientJid)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBeNull()
      }
    })

    it('rejects missing parameters', async () => {
      const result = await findClientDeal('', clientJid)
      expect(result.ok).toBe(false)
    })
  })

  // ============================================================
  // Lock deal
  // ============================================================

  describe('lockDeal', () => {
    it('transitions quoted → locked with locked rate', async () => {
      // getDealById call + update call
      setupSequentialChains([
        { data: mockDealRow, error: null }, // getDealById
        { data: mockLockedRow, error: null }, // update
      ])

      const result = await lockDeal('deal-1', groupJid, {
        lockedRate: 5.25,
        amountBrl: 10000,
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.state).toBe('locked')
        expect(result.data.lockedRate).toBe(5.25)
      }
    })

    it('rejects invalid lockedRate', async () => {
      const result = await lockDeal('deal-1', groupJid, { lockedRate: -1 })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('lockedRate must be positive')
      }
    })

    it('rejects invalid amountBrl', async () => {
      const result = await lockDeal('deal-1', groupJid, { lockedRate: 5.25, amountBrl: -1 })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('amountBrl must be positive')
      }
    })
  })

  // ============================================================
  // Complete deal
  // ============================================================

  describe('completeDeal', () => {
    it('transitions computing → completed with amounts', async () => {
      setupSequentialChains([
        { data: mockComputingRow, error: null }, // getDealById
        { data: { ...mockComputingRow, state: 'completed', amount_brl: 10000, amount_usdt: 1904.76 }, error: null },
      ])

      const result = await completeDeal('deal-1', groupJid, {
        amountBrl: 10000,
        amountUsdt: 1904.76,
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.state).toBe('completed')
      }
    })

    it('rejects invalid amounts', async () => {
      const result = await completeDeal('deal-1', groupJid, {
        amountBrl: -1,
        amountUsdt: 100,
      })

      expect(result.ok).toBe(false)
    })
  })

  // ============================================================
  // Cancel deal
  // ============================================================

  describe('cancelDeal', () => {
    it('cancels a quoted deal', async () => {
      setupSequentialChains([
        { data: mockDealRow, error: null },
        { data: { ...mockDealRow, state: 'cancelled' }, error: null },
      ])

      const result = await cancelDeal('deal-1', groupJid, 'cancelled_by_client')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.state).toBe('cancelled')
      }
    })

    it('cancels a locked deal', async () => {
      setupSequentialChains([
        { data: mockLockedRow, error: null },
        { data: { ...mockLockedRow, state: 'cancelled' }, error: null },
      ])

      const result = await cancelDeal('deal-1', groupJid, 'cancelled_by_operator')

      expect(result.ok).toBe(true)
    })
  })

  // ============================================================
  // Extend TTL
  // ============================================================

  describe('extendDealTtl', () => {
    it('extends TTL for active deal', async () => {
      const futureExpiry = new Date(Date.now() + 300000).toISOString()
      setupSequentialChains([
        { data: mockDealRow, error: null }, // getDealById
        { data: { ...mockDealRow, ttl_expires_at: futureExpiry }, error: null }, // update
      ])

      const result = await extendDealTtl('deal-1', groupJid, 300)

      expect(result.ok).toBe(true)
    })

    it('rejects non-positive seconds', async () => {
      const result = await extendDealTtl('deal-1', groupJid, 0)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('additionalSeconds must be positive')
      }
    })

    it('rejects extending terminal-state deal', async () => {
      setupSequentialChains([
        { data: { ...mockDealRow, state: 'completed' }, error: null },
      ])

      const result = await extendDealTtl('deal-1', groupJid, 300)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Cannot extend TTL')
      }
    })
  })

  // ============================================================
  // TTL Sweep
  // ============================================================

  describe('sweepExpiredDeals', () => {
    it('returns empty array when no expired deals', async () => {
      setupChain({ data: [], error: null })

      const result = await sweepExpiredDeals()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual([])
      }
    })

    it('handles sweep query error', async () => {
      setupChain({ data: null, error: { message: 'DB error' } })

      const result = await sweepExpiredDeals()

      expect(result.ok).toBe(false)
    })
  })

  // ============================================================
  // Deal History
  // ============================================================

  describe('getDealHistory', () => {
    it('returns history records', async () => {
      const historyRow = {
        id: 'deal-1',
        group_jid: groupJid,
        client_jid: clientJid,
        final_state: 'completed',
        side: 'client_buys_usdt',
        quoted_rate: 5.25,
        base_rate: 5.20,
        locked_rate: 5.25,
        amount_brl: 10000,
        amount_usdt: 1904.76,
        quoted_at: '2026-02-05T10:00:00Z',
        locked_at: '2026-02-05T10:01:00Z',
        completed_at: '2026-02-05T10:02:00Z',
        ttl_expires_at: '2026-02-05T10:03:00Z',
        rule_id_used: null,
        rule_name: null,
        pricing_source: 'usdt_binance',
        spread_mode: 'bps',
        sell_spread: 0,
        buy_spread: 0,
        metadata: {},
        completion_reason: 'confirmed',
        created_at: '2026-02-05T10:00:00Z',
        archived_at: '2026-02-05T10:02:00Z',
      }

      setupChain({ data: [historyRow], error: null })

      const result = await getDealHistory(groupJid)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toHaveLength(1)
        expect(result.data[0].finalState).toBe('completed')
        expect(result.data[0].completionReason).toBe('confirmed')
      }
    })

    it('limits results to max 200', async () => {
      const chain = setupChain({ data: [], error: null })

      await getDealHistory(groupJid, 500)

      // Verify limit was capped
      expect(chain.limit).toHaveBeenCalledWith(200)
    })

    it('rejects empty groupJid', async () => {
      const result = await getDealHistory('')
      expect(result.ok).toBe(false)
    })
  })

  // ============================================================
  // Invalid transition handling
  // ============================================================

  describe('invalid transitions', () => {
    it('rejects quoted → completed (skip states)', async () => {
      setupSequentialChains([
        { data: mockDealRow, error: null }, // getDealById returns quoted
        // No update should happen
      ])

      const result = await completeDeal('deal-1', groupJid, {
        amountBrl: 10000,
        amountUsdt: 1904.76,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Invalid transition')
      }
    })

    it('rejects locking a completed deal', async () => {
      setupSequentialChains([
        { data: { ...mockDealRow, state: 'completed' }, error: null },
      ])

      const result = await lockDeal('deal-1', groupJid, { lockedRate: 5.25 })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Invalid transition')
      }
    })
  })

  // ============================================================
  // Sprint 9: New State Transitions
  // ============================================================

  describe('isValidTransition (Sprint 9 new states)', () => {
    it('quoted → rejected is valid', () => {
      expect(isValidTransition('quoted', 'rejected')).toBe(true)
    })

    it('locked → awaiting_amount is valid', () => {
      expect(isValidTransition('locked', 'awaiting_amount')).toBe(true)
    })

    it('awaiting_amount → computing is valid', () => {
      expect(isValidTransition('awaiting_amount', 'computing')).toBe(true)
    })

    it('awaiting_amount → expired is valid', () => {
      expect(isValidTransition('awaiting_amount', 'expired')).toBe(true)
    })

    it('awaiting_amount → cancelled is valid', () => {
      expect(isValidTransition('awaiting_amount', 'cancelled')).toBe(true)
    })

    it('rejected is terminal (no transitions out)', () => {
      expect(isValidTransition('rejected', 'quoted')).toBe(false)
      expect(isValidTransition('rejected', 'completed')).toBe(false)
    })
  })

  describe('getActiveDealForSender', () => {
    it('returns deal for matching sender', async () => {
      setupChain({ data: [mockDealRow], error: null })

      const result = await getActiveDealForSender(groupJid, clientJid)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).not.toBeNull()
        expect(result.data?.clientJid).toBe(clientJid)
      }
    })

    it('returns null when no deal for sender', async () => {
      setupChain({ data: [mockDealRow], error: null })

      const result = await getActiveDealForSender(groupJid, 'other@s.whatsapp.net')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBeNull()
      }
    })
  })

  describe('startAwaitingAmount', () => {
    it('transitions locked → awaiting_amount', async () => {
      const awaitingRow = { ...mockLockedRow, state: 'awaiting_amount' }
      setupSequentialChains([
        { data: mockLockedRow, error: null }, // fetch current
        { data: awaitingRow, error: null },   // update
      ])

      const result = await startAwaitingAmount('deal-1', groupJid)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.state).toBe('awaiting_amount')
      }
    })
  })

  describe('rejectDeal', () => {
    it('transitions quoted → rejected', async () => {
      const rejectedRow = { ...mockDealRow, state: 'rejected' }
      setupSequentialChains([
        { data: mockDealRow, error: null }, // fetch current
        { data: rejectedRow, error: null }, // update
      ])

      const result = await rejectDeal('deal-1', groupJid)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.state).toBe('rejected')
      }
    })
  })

  describe('getDealsNeedingReprompt', () => {
    it('returns empty when no awaiting_amount deals', async () => {
      setupChain({ data: [], error: null })

      const result = await getDealsNeedingReprompt()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.needsReprompt).toHaveLength(0)
        expect(result.data.needsExpiry).toHaveLength(0)
      }
    })

    it('returns deal needing reprompt when old enough and not yet reprompted', async () => {
      const oldLockedAt = new Date(Date.now() - 120_000).toISOString() // 2 min ago
      setupChain({
        data: [{
          id: 'deal-1',
          group_jid: groupJid,
          client_jid: clientJid,
          locked_rate: 5.25,
          quoted_rate: 5.25,
          reprompted_at: null,
          locked_at: oldLockedAt,
        }],
        error: null,
      })

      const result = await getDealsNeedingReprompt()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.needsReprompt).toHaveLength(1)
        expect(result.data.needsExpiry).toHaveLength(0)
      }
    })

    it('returns deal needing expiry when already reprompted', async () => {
      const oldLockedAt = new Date(Date.now() - 120_000).toISOString()
      const repromptedAt = new Date(Date.now() - 60_000).toISOString()
      setupChain({
        data: [{
          id: 'deal-1',
          group_jid: groupJid,
          client_jid: clientJid,
          locked_rate: 5.25,
          quoted_rate: 5.25,
          reprompted_at: repromptedAt,
          locked_at: oldLockedAt,
        }],
        error: null,
      })

      const result = await getDealsNeedingReprompt()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.needsReprompt).toHaveLength(0)
        expect(result.data.needsExpiry).toHaveLength(1)
      }
    })
  })

  describe('markReprompted', () => {
    it('updates reprompted_at in database', async () => {
      const chain = setupChain({ data: null, error: null })

      const result = await markReprompted('deal-1')

      expect(result.ok).toBe(true)
      expect(mockSupabase.from).toHaveBeenCalledWith('active_deals')
      expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
        reprompted_at: expect.any(String),
      }))
    })
  })
})
