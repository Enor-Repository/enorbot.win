/**
 * Tests for Dashboard API: System Patterns Endpoints
 * Sprint 6 - Code Review Action Item: API tests mandatory for every endpoint
 * Sprint 7A.2 - Added POST /test endpoint tests
 *
 * Tests all 3 endpoints:
 * - GET /                     - List all system patterns
 * - POST /test                - Test a message against all patterns
 * - PUT /:patternKey          - Update keywords for a pattern
 *
 * Coverage: input validation, happy path, error handling, edge cases
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SystemPattern } from '../../services/systemPatternService.js'

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../services/systemPatternService.js', () => ({
  getAllPatterns: vi.fn(),
  updatePatternKeywords: vi.fn(),
  testMessageAgainstPatterns: vi.fn(),
}))

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import { getAllPatterns, updatePatternKeywords, testMessageAgainstPatterns } from '../../services/systemPatternService.js'

// ============================================================================
// Test Helpers
// ============================================================================

const SAMPLE_PATTERNS: SystemPattern[] = [
  {
    id: 'uuid-1',
    patternKey: 'price_request',
    keywords: ['preço', 'cotação'],
    patternType: 'contains',
    handler: 'PRICE_HANDLER',
    description: 'Triggers a price quote',
    updatedAt: '2026-02-04T12:00:00Z',
  },
  {
    id: 'uuid-2',
    patternKey: 'deal_cancellation',
    keywords: ['cancela', 'cancelar', 'cancel'],
    patternType: 'regex',
    handler: 'DEAL_HANDLER',
    description: 'Cancels the active deal',
    updatedAt: '2026-02-04T12:00:00Z',
  },
  {
    id: 'uuid-3',
    patternKey: 'price_lock',
    keywords: ['trava', 'lock', 'travar'],
    patternType: 'regex',
    handler: 'DEAL_HANDLER',
    description: 'Locks the quoted rate',
    updatedAt: '2026-02-04T12:00:00Z',
  },
  {
    id: 'uuid-4',
    patternKey: 'deal_confirmation',
    keywords: ['fechado', 'fecha', 'fechar', 'confirma', 'confirmado', 'confirmed'],
    patternType: 'regex',
    handler: 'DEAL_HANDLER',
    description: 'Confirms and completes the locked deal',
    updatedAt: '2026-02-04T12:00:00Z',
  },
]

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
function createMockReq(params: Record<string, string> = {}, body: Record<string, unknown> = {}): any {
  return { params, body }
}

async function getHandler(path: string, method: 'get' | 'put' | 'post') {
  const { systemPatternsRouter } = await import('./systemPatterns.js')
  const layer = (systemPatternsRouter.stack as RouteLayer[]).find(
    (l) => l.route?.path === path && l.route?.methods[method]
  )
  return layer?.route?.stack[0]?.handle
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================================
// GET / - List All System Patterns
// ============================================================================

describe('GET /system-patterns - List all patterns', () => {
  async function callHandler() {
    const handle = await getHandler('/', 'get')
    const req = createMockReq()
    const res = createMockRes()
    await handle!(req, res)
    return res
  }

  it('returns all system patterns on success', async () => {
    vi.mocked(getAllPatterns).mockResolvedValue({ ok: true, data: SAMPLE_PATTERNS })
    const res = await callHandler()

    expect(res.statusCode).toBe(200)
    const body = res.body as { patterns: SystemPattern[] }
    expect(body.patterns).toHaveLength(4)
    expect(body.patterns[0].patternKey).toBe('price_request')
    expect(body.patterns[1].patternKey).toBe('deal_cancellation')
  })

  it('returns empty array when no patterns exist', async () => {
    vi.mocked(getAllPatterns).mockResolvedValue({ ok: true, data: [] })
    const res = await callHandler()

    expect(res.statusCode).toBe(200)
    expect((res.body as { patterns: SystemPattern[] }).patterns).toEqual([])
  })

  it('returns 500 when service returns error result', async () => {
    vi.mocked(getAllPatterns).mockResolvedValue({ ok: false, error: 'Database connection failed' })
    const res = await callHandler()

    expect(res.statusCode).toBe(500)
    const body = res.body as { error: string; message: string }
    expect(body.error).toBe('Failed to fetch system patterns')
    expect(body.message).toBe('Database connection failed')
  })

  it('returns 500 when service throws unexpected error', async () => {
    vi.mocked(getAllPatterns).mockRejectedValue(new Error('Unexpected crash'))
    const res = await callHandler()

    expect(res.statusCode).toBe(500)
    const body = res.body as { error: string; message: string }
    expect(body.error).toBe('Failed to fetch system patterns')
    expect(body.message).toBe('Unexpected crash')
  })

  it('handles non-Error thrown values', async () => {
    vi.mocked(getAllPatterns).mockRejectedValue('raw string error')
    const res = await callHandler()

    expect(res.statusCode).toBe(500)
    const body = res.body as { error: string; message: string }
    expect(body.message).toBe('raw string error')
  })
})

// ============================================================================
// POST /test - Test Message Against Patterns
// ============================================================================

describe('POST /system-patterns/test - Test message', () => {
  async function callHandler(body: Record<string, unknown> = {}) {
    const handle = await getHandler('/test', 'post')
    const req = createMockReq({}, body)
    const res = createMockRes()
    await handle!(req, res)
    return res
  }

  const SAMPLE_MATCHES = [
    { patternKey: 'price_request', matched: true, matchedKeyword: 'preço' },
    { patternKey: 'deal_cancellation', matched: false, matchedKeyword: null },
    { patternKey: 'price_lock', matched: false, matchedKeyword: null },
    { patternKey: 'deal_confirmation', matched: false, matchedKeyword: null },
  ]

  it('returns matches for a valid message', async () => {
    vi.mocked(testMessageAgainstPatterns).mockResolvedValue(SAMPLE_MATCHES)

    const res = await callHandler({ message: 'preço' })

    expect(res.statusCode).toBe(200)
    const body = res.body as { message: string; matches: typeof SAMPLE_MATCHES }
    expect(body.message).toBe('preço')
    expect(body.matches).toHaveLength(4)
    expect(body.matches[0].matched).toBe(true)
    expect(body.matches[0].matchedKeyword).toBe('preço')
    expect(testMessageAgainstPatterns).toHaveBeenCalledWith('preço')
  })

  it('returns all non-matches for unrecognized message', async () => {
    const noMatches = SAMPLE_MATCHES.map(m => ({ ...m, matched: false, matchedKeyword: null }))
    vi.mocked(testMessageAgainstPatterns).mockResolvedValue(noMatches)

    const res = await callHandler({ message: 'hello world' })

    expect(res.statusCode).toBe(200)
    const body = res.body as { matches: typeof SAMPLE_MATCHES }
    expect(body.matches.every(m => !m.matched)).toBe(true)
  })

  it('rejects non-string message', async () => {
    const res = await callHandler({ message: 123 })

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toBe('message must be a string')
    expect(testMessageAgainstPatterns).not.toHaveBeenCalled()
  })

  it('rejects undefined message', async () => {
    const res = await callHandler({})

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toBe('message must be a string')
  })

  it('rejects empty message', async () => {
    const res = await callHandler({ message: '   ' })

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toContain('cannot be empty')
  })

  it('rejects message exceeding 500 characters', async () => {
    const longMsg = 'a'.repeat(501)
    const res = await callHandler({ message: longMsg })

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toContain('500 character limit')
  })

  it('accepts message at exactly 500 characters', async () => {
    const exact500 = 'a'.repeat(500)
    vi.mocked(testMessageAgainstPatterns).mockResolvedValue(SAMPLE_MATCHES)

    const res = await callHandler({ message: exact500 })
    expect(res.statusCode).toBe(200)
  })

  it('returns 500 when service throws unexpected error', async () => {
    vi.mocked(testMessageAgainstPatterns).mockRejectedValue(new Error('DB crash'))

    const res = await callHandler({ message: 'test' })

    expect(res.statusCode).toBe(500)
    const body = res.body as { error: string; message: string }
    expect(body.error).toBe('Failed to test message')
    expect(body.message).toBe('DB crash')
  })

  it('handles non-Error thrown values', async () => {
    vi.mocked(testMessageAgainstPatterns).mockRejectedValue('raw error')

    const res = await callHandler({ message: 'test' })

    expect(res.statusCode).toBe(500)
    expect((res.body as { message: string }).message).toBe('raw error')
  })
})

// ============================================================================
// PUT /:patternKey - Update Pattern Keywords
// ============================================================================

describe('PUT /system-patterns/:patternKey - Update keywords', () => {
  async function callHandler(patternKey: string, body: Record<string, unknown> = {}) {
    const handle = await getHandler('/:patternKey', 'put')
    const req = createMockReq({ patternKey }, body)
    const res = createMockRes()
    await handle!(req, res)
    return res
  }

  // ---- Happy path ----

  it('updates keywords successfully', async () => {
    const updatedPattern: SystemPattern = {
      ...SAMPLE_PATTERNS[0],
      keywords: ['preço', 'cotação', 'novo'],
    }
    vi.mocked(updatePatternKeywords).mockResolvedValue({ ok: true, data: updatedPattern })

    const res = await callHandler('price_request', { keywords: ['preço', 'cotação', 'novo'] })

    expect(res.statusCode).toBe(200)
    const body = res.body as { pattern: SystemPattern }
    expect(body.pattern.keywords).toEqual(['preço', 'cotação', 'novo'])
    expect(updatePatternKeywords).toHaveBeenCalledWith('price_request', ['preço', 'cotação', 'novo'])
  })

  it('trims and deduplicates keywords', async () => {
    const updatedPattern: SystemPattern = {
      ...SAMPLE_PATTERNS[0],
      keywords: ['preço', 'cotação'],
    }
    vi.mocked(updatePatternKeywords).mockResolvedValue({ ok: true, data: updatedPattern })

    await callHandler('price_request', { keywords: [' Preço ', 'PREÇO', ' cotação'] })

    // Should be trimmed + lowercased + deduplicated before reaching the service
    expect(updatePatternKeywords).toHaveBeenCalledWith('price_request', ['preço', 'cotação'])
  })

  // ---- Validation: keywords must be an array ----

  it('rejects non-array keywords', async () => {
    const res = await callHandler('price_request', { keywords: 'not-an-array' })

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toBe('keywords must be an array')
    expect(updatePatternKeywords).not.toHaveBeenCalled()
  })

  it('rejects undefined keywords', async () => {
    const res = await callHandler('price_request', {})

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toBe('keywords must be an array')
  })

  // ---- Validation: empty array ----

  it('rejects empty keywords array', async () => {
    const res = await callHandler('price_request', { keywords: [] })

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toContain('cannot be empty')
  })

  // ---- Validation: max 20 keywords ----

  it('rejects more than 20 keywords', async () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `kw${i}`)
    const res = await callHandler('price_request', { keywords: tooMany })

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toContain('Maximum 20 keywords')
  })

  it('accepts exactly 20 keywords', async () => {
    const exactly20 = Array.from({ length: 20 }, (_, i) => `keyword${i}`)
    vi.mocked(updatePatternKeywords).mockResolvedValue({
      ok: true,
      data: { ...SAMPLE_PATTERNS[0], keywords: exactly20 },
    })

    const res = await callHandler('price_request', { keywords: exactly20 })
    expect(res.statusCode).toBe(200)
  })

  // ---- Validation: keyword types ----

  it('rejects non-string keyword entries', async () => {
    const res = await callHandler('price_request', { keywords: ['valid', 123] })

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toContain('keywords[1] must be a string')
  })

  it('rejects empty string keywords', async () => {
    const res = await callHandler('price_request', { keywords: ['valid', '   '] })

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toContain('keywords[1] cannot be empty')
  })

  // ---- Validation: keyword length ----

  it('rejects keywords exceeding 50 characters', async () => {
    const longKeyword = 'a'.repeat(51)
    const res = await callHandler('price_request', { keywords: [longKeyword] })

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toContain('exceeds 50 character limit')
  })

  it('accepts keywords at exactly 50 characters', async () => {
    const exact50 = 'a'.repeat(50)
    vi.mocked(updatePatternKeywords).mockResolvedValue({
      ok: true,
      data: { ...SAMPLE_PATTERNS[0], keywords: [exact50] },
    })

    const res = await callHandler('price_request', { keywords: [exact50] })
    expect(res.statusCode).toBe(200)
  })

  // ---- Validation: patternKey whitelist ----

  it('rejects invalid patternKey with 400', async () => {
    const res = await callHandler('nonexistent_pattern', { keywords: ['test'] })

    expect(res.statusCode).toBe(400)
    expect((res.body as { error: string }).error).toContain('Invalid patternKey')
    expect(updatePatternKeywords).not.toHaveBeenCalled()
  })

  // ---- Error handling: pattern not found ----

  it('returns 404 when pattern key does not exist in DB', async () => {
    vi.mocked(updatePatternKeywords).mockResolvedValue({ ok: false, error: 'Pattern not found' })

    const res = await callHandler('price_request', { keywords: ['test'] })

    expect(res.statusCode).toBe(404)
    const body = res.body as { error: string; message: string }
    expect(body.error).toBe('Pattern not found')
  })

  // ---- Error handling: service failure ----

  it('returns 500 when service returns generic error', async () => {
    vi.mocked(updatePatternKeywords).mockResolvedValue({ ok: false, error: 'Supabase timeout' })

    const res = await callHandler('price_request', { keywords: ['test'] })

    expect(res.statusCode).toBe(500)
    const body = res.body as { error: string; message: string }
    expect(body.error).toBe('Failed to update pattern')
    expect(body.message).toBe('Supabase timeout')
  })

  it('returns 500 when service throws unexpected error', async () => {
    vi.mocked(updatePatternKeywords).mockRejectedValue(new Error('Connection reset'))

    const res = await callHandler('price_request', { keywords: ['test'] })

    expect(res.statusCode).toBe(500)
    const body = res.body as { error: string; message: string }
    expect(body.error).toBe('Failed to update system pattern')
    expect(body.message).toBe('Connection reset')
  })

  it('handles non-Error thrown values in PUT', async () => {
    vi.mocked(updatePatternKeywords).mockRejectedValue('raw error')

    const res = await callHandler('price_request', { keywords: ['test'] })

    expect(res.statusCode).toBe(500)
    expect((res.body as { message: string }).message).toBe('raw error')
  })
})
