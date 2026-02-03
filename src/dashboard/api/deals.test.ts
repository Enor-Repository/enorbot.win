/**
 * Tests for Dashboard API: Deal Flow Endpoints
 * Sprint 4 - Code Review M2 Fix
 *
 * Tests all 7 endpoints:
 * - GET /                   - List active deals
 * - GET /all                - List all deals
 * - GET /history            - List deal history
 * - POST /sweep             - Manual sweep
 * - GET /:dealId            - Get specific deal
 * - POST /:dealId/cancel    - Cancel deal
 * - POST /:dealId/extend    - Extend deal TTL
 *
 * Coverage: input validation, auth boundary, happy path, error handling
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ActiveDeal } from '../../services/dealFlowService.js'

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../services/dealFlowService.js', () => ({
  getActiveDeals: vi.fn(),
  getAllDeals: vi.fn(),
  getDealById: vi.fn(),
  cancelDeal: vi.fn(),
  extendDealTtl: vi.fn(),
  getDealHistory: vi.fn(),
  sweepExpiredDeals: vi.fn(),
}))

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import {
  getActiveDeals,
  getAllDeals,
  getDealById,
  cancelDeal,
  extendDealTtl,
  getDealHistory,
  sweepExpiredDeals,
} from '../../services/dealFlowService.js'

// ============================================================================
// Test Helpers
// ============================================================================

const GROUP_JID = 'test-group@g.us'
const DEAL_ID = 'deal-uuid-1234'

function makeMockDeal(overrides: Partial<ActiveDeal> = {}): ActiveDeal {
  return {
    id: DEAL_ID,
    groupJid: GROUP_JID,
    clientJid: 'client@s.whatsapp.net',
    state: 'quoted',
    quotedRate: 5.25,
    baseRate: 5.20,
    quotedAt: new Date('2026-02-03T12:00:00Z'),
    lockedRate: null,
    lockedAt: null,
    amountBrl: 100000,
    amountUsdt: null,
    side: 'client_buys_usdt',
    ttlExpiresAt: new Date('2026-02-03T12:05:00Z'),
    ruleIdUsed: null,
    ruleName: null,
    pricingSource: 'usdt_binance',
    spreadMode: 'bps',
    sellSpread: 0,
    buySpread: 0,
    metadata: { pricing_source: 'usdt_binance' },
    createdAt: new Date('2026-02-03T12:00:00Z'),
    updatedAt: new Date('2026-02-03T12:00:00Z'),
    ...overrides,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (...args: any[]) => Promise<void> }> } }

interface MockRes {
  statusCode: number
  body: unknown
  status: (code: number) => MockRes
  json: (data: unknown) => MockRes
}

function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: null,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(data: unknown) {
      res.body = data
      return res
    },
  }
  return res
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockReq(params: Record<string, string>, query: Record<string, string> = {}, body: Record<string, unknown> = {}): any {
  return { params, query, body }
}

async function getHandler(path: string, method: 'get' | 'post') {
  const { dealsRouter } = await import('./deals.js')
  const layer = (dealsRouter.stack as RouteLayer[]).find(
    (l) => l.route?.path === path && l.route?.methods[method]
  )
  return layer?.route?.stack[0]?.handle
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================================
// GET / - List Active Deals
// ============================================================================

describe('GET /deals - List active deals', () => {
  async function callHandler(groupJid: string) {
    const handle = await getHandler('/', 'get')
    const req = createMockReq({ groupJid })
    const res = createMockRes()
    await handle!(req, res)
    return res
  }

  it('returns active deals for group', async () => {
    vi.mocked(getActiveDeals).mockResolvedValue({ ok: true, data: [makeMockDeal()] })
    const res = await callHandler(GROUP_JID)

    expect(res.statusCode).toBe(200)
    expect((res.body as { deals: ActiveDeal[] }).deals).toHaveLength(1)
    expect(getActiveDeals).toHaveBeenCalledWith(GROUP_JID)
  })

  it('returns empty array when no active deals', async () => {
    vi.mocked(getActiveDeals).mockResolvedValue({ ok: true, data: [] })
    const res = await callHandler(GROUP_JID)

    expect(res.statusCode).toBe(200)
    expect((res.body as { deals: ActiveDeal[] }).deals).toEqual([])
  })

  it('returns 500 when service returns error', async () => {
    vi.mocked(getActiveDeals).mockResolvedValue({ ok: false, error: 'DB error' })
    const res = await callHandler(GROUP_JID)

    expect(res.statusCode).toBe(500)
    expect((res.body as { error: string }).error).toBe('Failed to fetch active deals')
  })

  it('returns 500 on unexpected exception', async () => {
    vi.mocked(getActiveDeals).mockRejectedValue(new Error('Connection lost'))
    const res = await callHandler(GROUP_JID)

    expect(res.statusCode).toBe(500)
    expect((res.body as { error: string }).error).toBe('Internal server error')
  })
})

// ============================================================================
// GET /all - List All Deals
// ============================================================================

describe('GET /deals/all - List all deals', () => {
  async function callHandler(groupJid: string) {
    const handle = await getHandler('/all', 'get')
    const req = createMockReq({ groupJid })
    const res = createMockRes()
    await handle!(req, res)
    return res
  }

  it('returns all deals including terminal states', async () => {
    vi.mocked(getAllDeals).mockResolvedValue({
      ok: true,
      data: [makeMockDeal(), makeMockDeal({ id: 'deal-2', state: 'completed' })],
    })
    const res = await callHandler(GROUP_JID)

    expect(res.statusCode).toBe(200)
    expect((res.body as { deals: ActiveDeal[] }).deals).toHaveLength(2)
    expect(getAllDeals).toHaveBeenCalledWith(GROUP_JID)
  })

  it('returns 500 when service returns error', async () => {
    vi.mocked(getAllDeals).mockResolvedValue({ ok: false, error: 'DB error' })
    const res = await callHandler(GROUP_JID)

    expect(res.statusCode).toBe(500)
    expect((res.body as { error: string }).error).toBe('Failed to fetch all deals')
  })

  it('returns 500 on unexpected exception', async () => {
    vi.mocked(getAllDeals).mockRejectedValue(new Error('Timeout'))
    const res = await callHandler(GROUP_JID)

    expect(res.statusCode).toBe(500)
    expect((res.body as { error: string }).error).toBe('Internal server error')
  })
})

// ============================================================================
// GET /history - List Deal History
// ============================================================================

describe('GET /deals/history - List deal history', () => {
  async function callHandler(groupJid: string, query: Record<string, string> = {}) {
    const handle = await getHandler('/history', 'get')
    const req = createMockReq({ groupJid }, query)
    const res = createMockRes()
    await handle!(req, res)
    return res
  }

  it('returns deal history with default limit of 50', async () => {
    vi.mocked(getDealHistory).mockResolvedValue({ ok: true, data: [] })
    const res = await callHandler(GROUP_JID)

    expect(res.statusCode).toBe(200)
    expect(getDealHistory).toHaveBeenCalledWith(GROUP_JID, 50, {})
  })

  it('respects custom limit query parameter', async () => {
    vi.mocked(getDealHistory).mockResolvedValue({ ok: true, data: [] })
    const res = await callHandler(GROUP_JID, { limit: '10' })

    expect(res.statusCode).toBe(200)
    expect(getDealHistory).toHaveBeenCalledWith(GROUP_JID, 10, {})
  })

  it('caps limit at 200', async () => {
    vi.mocked(getDealHistory).mockResolvedValue({ ok: true, data: [] })
    const res = await callHandler(GROUP_JID, { limit: '500' })

    expect(res.statusCode).toBe(200)
    expect(getDealHistory).toHaveBeenCalledWith(GROUP_JID, 200, {})
  })

  it('ignores invalid limit and uses default', async () => {
    vi.mocked(getDealHistory).mockResolvedValue({ ok: true, data: [] })
    const res = await callHandler(GROUP_JID, { limit: 'abc' })

    expect(res.statusCode).toBe(200)
    expect(getDealHistory).toHaveBeenCalledWith(GROUP_JID, 50, {})
  })

  it('ignores negative limit and uses default', async () => {
    vi.mocked(getDealHistory).mockResolvedValue({ ok: true, data: [] })
    const res = await callHandler(GROUP_JID, { limit: '-5' })

    expect(res.statusCode).toBe(200)
    expect(getDealHistory).toHaveBeenCalledWith(GROUP_JID, 50, {})
  })

  it('returns 500 when service returns error', async () => {
    vi.mocked(getDealHistory).mockResolvedValue({ ok: false, error: 'DB error' })
    const res = await callHandler(GROUP_JID)

    expect(res.statusCode).toBe(500)
    expect((res.body as { error: string }).error).toBe('Failed to fetch deal history')
  })

  // Sprint 5, Task 5.3: L3 tech debt - date range filter tests
  it('passes from date filter when valid ISO date provided', async () => {
    vi.mocked(getDealHistory).mockResolvedValue({ ok: true, data: [] })
    const res = await callHandler(GROUP_JID, { from: '2026-01-01T00:00:00Z' })

    expect(res.statusCode).toBe(200)
    expect(getDealHistory).toHaveBeenCalledWith(
      GROUP_JID,
      50,
      { from: new Date('2026-01-01T00:00:00Z') }
    )
  })

  it('passes to date filter when valid ISO date provided', async () => {
    vi.mocked(getDealHistory).mockResolvedValue({ ok: true, data: [] })
    const res = await callHandler(GROUP_JID, { to: '2026-01-31T23:59:59Z' })

    expect(res.statusCode).toBe(200)
    expect(getDealHistory).toHaveBeenCalledWith(
      GROUP_JID,
      50,
      { to: new Date('2026-01-31T23:59:59Z') }
    )
  })

  it('passes both from and to date filters', async () => {
    vi.mocked(getDealHistory).mockResolvedValue({ ok: true, data: [] })
    const res = await callHandler(GROUP_JID, {
      from: '2026-01-01T00:00:00Z',
      to: '2026-01-31T23:59:59Z',
    })

    expect(res.statusCode).toBe(200)
    expect(getDealHistory).toHaveBeenCalledWith(
      GROUP_JID,
      50,
      {
        from: new Date('2026-01-01T00:00:00Z'),
        to: new Date('2026-01-31T23:59:59Z'),
      }
    )
  })

  it('ignores invalid from date', async () => {
    vi.mocked(getDealHistory).mockResolvedValue({ ok: true, data: [] })
    const res = await callHandler(GROUP_JID, { from: 'not-a-date' })

    expect(res.statusCode).toBe(200)
    expect(getDealHistory).toHaveBeenCalledWith(GROUP_JID, 50, {})
  })

  it('ignores invalid to date', async () => {
    vi.mocked(getDealHistory).mockResolvedValue({ ok: true, data: [] })
    const res = await callHandler(GROUP_JID, { to: 'garbage' })

    expect(res.statusCode).toBe(200)
    expect(getDealHistory).toHaveBeenCalledWith(GROUP_JID, 50, {})
  })
})

// ============================================================================
// POST /sweep - Manual Sweep
// ============================================================================

describe('POST /deals/sweep - Manual sweep', () => {
  async function callHandler(groupJid: string) {
    const handle = await getHandler('/sweep', 'post')
    const req = createMockReq({ groupJid })
    const res = createMockRes()
    await handle!(req, res)
    return res
  }

  it('triggers sweep and returns expired count', async () => {
    vi.mocked(sweepExpiredDeals).mockResolvedValue({ ok: true, data: 3 })
    const res = await callHandler(GROUP_JID)

    expect(res.statusCode).toBe(200)
    expect((res.body as { expired: number }).expired).toBe(3)
  })

  it('returns zero when no deals expired', async () => {
    vi.mocked(sweepExpiredDeals).mockResolvedValue({ ok: true, data: 0 })
    const res = await callHandler(GROUP_JID)

    expect(res.statusCode).toBe(200)
    expect((res.body as { expired: number }).expired).toBe(0)
  })

  it('returns 500 when sweep fails', async () => {
    vi.mocked(sweepExpiredDeals).mockResolvedValue({ ok: false, error: 'DB error' })
    const res = await callHandler(GROUP_JID)

    expect(res.statusCode).toBe(500)
    expect((res.body as { error: string }).error).toBe('Sweep failed')
  })

  it('returns 500 on unexpected exception', async () => {
    vi.mocked(sweepExpiredDeals).mockRejectedValue(new Error('Crash'))
    const res = await callHandler(GROUP_JID)

    expect(res.statusCode).toBe(500)
    expect((res.body as { error: string }).error).toBe('Internal server error')
  })
})

// ============================================================================
// GET /:dealId - Get Specific Deal
// ============================================================================

describe('GET /deals/:dealId - Get specific deal', () => {
  async function callHandler(groupJid: string, dealId: string) {
    const handle = await getHandler('/:dealId', 'get')
    const req = createMockReq({ groupJid, dealId })
    const res = createMockRes()
    await handle!(req, res)
    return res
  }

  it('returns deal with group authorization check', async () => {
    vi.mocked(getDealById).mockResolvedValue({ ok: true, data: makeMockDeal() })
    const res = await callHandler(GROUP_JID, DEAL_ID)

    expect(res.statusCode).toBe(200)
    expect((res.body as { deal: ActiveDeal }).deal.id).toBe(DEAL_ID)
    expect(getDealById).toHaveBeenCalledWith(DEAL_ID, GROUP_JID)
  })

  it('passes groupJid for authorization boundary', async () => {
    vi.mocked(getDealById).mockResolvedValue({ ok: true, data: makeMockDeal({ groupJid: 'other-group@g.us' }) })
    await callHandler('other-group@g.us', DEAL_ID)

    expect(getDealById).toHaveBeenCalledWith(DEAL_ID, 'other-group@g.us')
  })

  it('returns 404 when deal not found', async () => {
    vi.mocked(getDealById).mockResolvedValue({ ok: false, error: 'Deal not found' })
    const res = await callHandler(GROUP_JID, 'nonexistent')

    expect(res.statusCode).toBe(404)
    expect((res.body as { error: string }).error).toBe('Deal not found')
  })

  it('returns 500 on non-404 service error', async () => {
    vi.mocked(getDealById).mockResolvedValue({ ok: false, error: 'DB connection failed' })
    const res = await callHandler(GROUP_JID, DEAL_ID)

    expect(res.statusCode).toBe(500)
    expect((res.body as { error: string }).error).toBe('Failed to fetch deal')
  })

  it('returns 500 on unexpected exception', async () => {
    vi.mocked(getDealById).mockRejectedValue(new Error('Network error'))
    const res = await callHandler(GROUP_JID, DEAL_ID)

    expect(res.statusCode).toBe(500)
    expect((res.body as { error: string }).error).toBe('Internal server error')
  })
})

// ============================================================================
// POST /:dealId/cancel - Cancel Deal
// ============================================================================

describe('POST /deals/:dealId/cancel - Cancel deal', () => {
  async function callHandler(groupJid: string, dealId: string) {
    const handle = await getHandler('/:dealId/cancel', 'post')
    const req = createMockReq({ groupJid, dealId })
    const res = createMockRes()
    await handle!(req, res)
    return res
  }

  it('cancels deal with cancelled_by_operator reason', async () => {
    vi.mocked(cancelDeal).mockResolvedValue({ ok: true, data: makeMockDeal({ state: 'cancelled' }) })
    const res = await callHandler(GROUP_JID, DEAL_ID)

    expect(res.statusCode).toBe(200)
    expect((res.body as { deal: ActiveDeal }).deal.state).toBe('cancelled')
    expect(cancelDeal).toHaveBeenCalledWith(DEAL_ID, GROUP_JID, 'cancelled_by_operator')
  })

  it('returns 404 when deal not found', async () => {
    vi.mocked(cancelDeal).mockResolvedValue({ ok: false, error: 'Deal not found' })
    const res = await callHandler(GROUP_JID, 'nonexistent')

    expect(res.statusCode).toBe(404)
  })

  it('returns 409 when transition is invalid (already completed)', async () => {
    vi.mocked(cancelDeal).mockResolvedValue({ ok: false, error: 'Invalid transition from completed to cancelled' })
    const res = await callHandler(GROUP_JID, DEAL_ID)

    expect(res.statusCode).toBe(409)
    expect((res.body as { message: string }).message).toContain('Invalid transition')
  })

  it('returns 500 on generic service error', async () => {
    vi.mocked(cancelDeal).mockResolvedValue({ ok: false, error: 'DB write failed' })
    const res = await callHandler(GROUP_JID, DEAL_ID)

    expect(res.statusCode).toBe(500)
  })

  it('returns 500 on unexpected exception', async () => {
    vi.mocked(cancelDeal).mockRejectedValue(new Error('Crash'))
    const res = await callHandler(GROUP_JID, DEAL_ID)

    expect(res.statusCode).toBe(500)
    expect((res.body as { error: string }).error).toBe('Internal server error')
  })
})

// ============================================================================
// POST /:dealId/extend - Extend Deal TTL
// ============================================================================

describe('POST /deals/:dealId/extend - Extend deal TTL', () => {
  async function callHandler(groupJid: string, dealId: string, body: Record<string, unknown> = {}) {
    const handle = await getHandler('/:dealId/extend', 'post')
    const req = createMockReq({ groupJid, dealId }, {}, body)
    const res = createMockRes()
    await handle!(req, res)
    return res
  }

  it('extends TTL with valid seconds', async () => {
    vi.mocked(extendDealTtl).mockResolvedValue({ ok: true, data: makeMockDeal() })
    const res = await callHandler(GROUP_JID, DEAL_ID, { seconds: 300 })

    expect(res.statusCode).toBe(200)
    expect(extendDealTtl).toHaveBeenCalledWith(DEAL_ID, GROUP_JID, 300)
  })

  it('accepts maximum value of 86400', async () => {
    vi.mocked(extendDealTtl).mockResolvedValue({ ok: true, data: makeMockDeal() })
    const res = await callHandler(GROUP_JID, DEAL_ID, { seconds: 86400 })

    expect(res.statusCode).toBe(200)
    expect(extendDealTtl).toHaveBeenCalledWith(DEAL_ID, GROUP_JID, 86400)
  })

  // --- Input validation ---

  it('returns 400 when seconds is missing', async () => {
    const res = await callHandler(GROUP_JID, DEAL_ID, {})

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toBe('seconds must be a positive number')
    expect(extendDealTtl).not.toHaveBeenCalled()
  })

  it('returns 400 when seconds is zero', async () => {
    const res = await callHandler(GROUP_JID, DEAL_ID, { seconds: 0 })

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toBe('seconds must be a positive number')
  })

  it('returns 400 when seconds is negative', async () => {
    const res = await callHandler(GROUP_JID, DEAL_ID, { seconds: -100 })

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toBe('seconds must be a positive number')
  })

  it('returns 400 when seconds is a string', async () => {
    const res = await callHandler(GROUP_JID, DEAL_ID, { seconds: '300' })

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toBe('seconds must be a positive number')
  })

  it('returns 400 when seconds exceeds 86400', async () => {
    const res = await callHandler(GROUP_JID, DEAL_ID, { seconds: 86401 })

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toBe('seconds cannot exceed 86400 (24 hours)')
  })

  it('returns 400 when seconds is boolean', async () => {
    const res = await callHandler(GROUP_JID, DEAL_ID, { seconds: true })

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toBe('seconds must be a positive number')
  })

  // --- Service errors ---

  it('returns 404 when deal not found', async () => {
    vi.mocked(extendDealTtl).mockResolvedValue({ ok: false, error: 'Deal not found' })
    const res = await callHandler(GROUP_JID, 'nonexistent', { seconds: 300 })

    expect(res.statusCode).toBe(404)
  })

  it('returns 409 when deal cannot be extended', async () => {
    vi.mocked(extendDealTtl).mockResolvedValue({ ok: false, error: 'Cannot extend completed deal' })
    const res = await callHandler(GROUP_JID, DEAL_ID, { seconds: 300 })

    expect(res.statusCode).toBe(409)
    expect((res.body as { message: string }).message).toContain('Cannot extend')
  })

  it('returns 500 on generic service error', async () => {
    vi.mocked(extendDealTtl).mockResolvedValue({ ok: false, error: 'DB write failed' })
    const res = await callHandler(GROUP_JID, DEAL_ID, { seconds: 300 })

    expect(res.statusCode).toBe(500)
  })

  it('returns 500 on unexpected exception', async () => {
    vi.mocked(extendDealTtl).mockRejectedValue(new Error('Crash'))
    const res = await callHandler(GROUP_JID, DEAL_ID, { seconds: 300 })

    expect(res.statusCode).toBe(500)
    expect((res.body as { error: string }).error).toBe('Internal server error')
  })
})
