/**
 * Tests for dashboard endpoint:
 * POST /api/groups/:groupJid/system-triggers/reconcile
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================================
// Mocks
// ============================================================================

const mockGetGroupConfigSync = vi.hoisted(() => vi.fn())
const mockReconcileSystemTriggers = vi.hoisted(() => vi.fn())

vi.mock('../../services/groupConfig.js', () => ({
  getAllGroupConfigs: vi.fn(),
  setGroupMode: vi.fn(),
  getGroupConfigSync: (...args: unknown[]) => mockGetGroupConfigSync(...args),
  setPlayerRole: vi.fn(),
  removePlayerRole: vi.fn(),
}))

vi.mock('../../services/systemTriggerReconciler.js', () => ({
  reconcileSystemTriggers: (...args: unknown[]) => mockReconcileSystemTriggers(...args),
}))

vi.mock('../../services/supabase.js', () => ({
  getSupabase: vi.fn(),
}))

vi.mock('../../services/systemTriggerSeeder.js', () => ({
  seedDefaultTriggers: vi.fn(),
}))

vi.mock('../../services/ruleService.js', () => ({
  cloneGroupRuleset: vi.fn(),
}))

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// ============================================================================
// Helpers
// ============================================================================

interface MockRes {
  statusCode: number
  body: unknown
  status: (code: number) => MockRes
  json: (data: unknown) => MockRes
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (...args: any[]) => Promise<void> }> } }

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
function createMockReq(params: Record<string, string>): any {
  return { params, query: {}, body: {} }
}

async function getHandler(path: string, method: 'post') {
  const { groupsRouter } = await import('./groups.js')
  const layer = (groupsRouter.stack as RouteLayer[]).find(
    (l) => l.route?.path === path && l.route?.methods[method]
  )
  return layer?.route?.stack[0]?.handle
}

// ============================================================================
// Tests
// ============================================================================

describe('POST /groups/:groupJid/system-triggers/reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns reconciliation summary for valid group', async () => {
    const handle = await getHandler('/:groupJid/system-triggers/reconcile', 'post')
    const req = createMockReq({ groupJid: '120363421013716073@g.us' })
    const res = createMockRes()

    mockGetGroupConfigSync.mockReturnValue({ groupName: 'OTC LIQD > eNor CONTROLE' })
    mockReconcileSystemTriggers.mockResolvedValue({
      ok: true,
      data: {
        groupJid: '120363421013716073@g.us',
        isControlGroup: true,
        requiredCount: 16,
        matchedCount: 14,
        insertedCount: 1,
        updatedCount: 1,
        conflicts: [],
      },
    })

    await handle!(req, res)

    expect(res.statusCode).toBe(200)
    expect(mockReconcileSystemTriggers).toHaveBeenCalledWith('120363421013716073@g.us', true)
    expect((res.body as { success: boolean }).success).toBe(true)
    expect((res.body as { summary: { insertedCount: number } }).summary.insertedCount).toBe(1)
  })

  it('returns 400 for invalid group jid', async () => {
    const handle = await getHandler('/:groupJid/system-triggers/reconcile', 'post')
    const req = createMockReq({ groupJid: 'invalid-jid' })
    const res = createMockRes()

    await handle!(req, res)

    expect(res.statusCode).toBe(400)
    expect(mockReconcileSystemTriggers).not.toHaveBeenCalled()
  })

  it('returns 503 when service reports Supabase not initialized', async () => {
    const handle = await getHandler('/:groupJid/system-triggers/reconcile', 'post')
    const req = createMockReq({ groupJid: '120363421013716073@g.us' })
    const res = createMockRes()

    mockGetGroupConfigSync.mockReturnValue(null)
    mockReconcileSystemTriggers.mockResolvedValue({
      ok: false,
      error: 'Supabase not initialized',
    })

    await handle!(req, res)

    expect(res.statusCode).toBe(503)
    expect((res.body as { error: string }).error).toBe('Failed to reconcile system triggers')
  })

  it('returns 500 when reconciliation fails generically', async () => {
    const handle = await getHandler('/:groupJid/system-triggers/reconcile', 'post')
    const req = createMockReq({ groupJid: '120363421013716073@g.us' })
    const res = createMockRes()

    mockGetGroupConfigSync.mockReturnValue({ groupName: 'OTC LIQD > eNor' })
    mockReconcileSystemTriggers.mockResolvedValue({
      ok: false,
      error: 'query timeout',
    })

    await handle!(req, res)

    expect(res.statusCode).toBe(500)
    expect(mockReconcileSystemTriggers).toHaveBeenCalledWith('120363421013716073@g.us', false)
  })
})
