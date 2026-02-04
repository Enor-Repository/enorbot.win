/**
 * Tests for Dashboard Auth Middleware
 * Sprint 7A.0: Shared-secret authentication for write endpoints
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// Mocks
// ============================================================================

const mockGetConfig = vi.fn()

vi.mock('../../config.js', () => ({
  getConfig: () => mockGetConfig(),
}))

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import type { Response, NextFunction } from 'express'
import { dashboardAuth } from './auth.js'

// ============================================================================
// Test Helpers
// ============================================================================

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
function createMockReq(method: string, headers: Record<string, string> = {}, ip?: string): any {
  return { method, headers, path: '/test', ip, socket: { remoteAddress: ip || '127.0.0.1' } }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================================
// Tests
// ============================================================================

describe('dashboardAuth middleware', () => {
  // ---- Read methods always pass ----

  it('allows GET requests without auth', () => {
    mockGetConfig.mockReturnValue({ DASHBOARD_SECRET: 'my-secret-123' })
    const req = createMockReq('GET')
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    dashboardAuth(req, res as unknown as Response, next)

    expect(next).toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
  })

  it('allows HEAD requests without auth', () => {
    mockGetConfig.mockReturnValue({ DASHBOARD_SECRET: 'my-secret-123' })
    const req = createMockReq('HEAD')
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    dashboardAuth(req, res as unknown as Response, next)

    expect(next).toHaveBeenCalled()
  })

  it('allows OPTIONS requests without auth', () => {
    mockGetConfig.mockReturnValue({ DASHBOARD_SECRET: 'my-secret-123' })
    const req = createMockReq('OPTIONS')
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    dashboardAuth(req, res as unknown as Response, next)

    expect(next).toHaveBeenCalled()
  })

  // ---- No secret configured (dev mode) ----

  it('allows all methods when DASHBOARD_SECRET is not set', () => {
    mockGetConfig.mockReturnValue({})
    const next = vi.fn() as unknown as NextFunction

    for (const method of ['PUT', 'POST', 'DELETE', 'PATCH']) {
      const req = createMockReq(method)
      const res = createMockRes()
      dashboardAuth(req, res as unknown as Response, next)
    }

    expect(next).toHaveBeenCalledTimes(4)
  })

  it('allows all methods when DASHBOARD_SECRET is undefined', () => {
    mockGetConfig.mockReturnValue({ DASHBOARD_SECRET: undefined })
    const req = createMockReq('PUT')
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    dashboardAuth(req, res as unknown as Response, next)

    expect(next).toHaveBeenCalled()
  })

  // ---- Write methods with valid secret ----

  it('allows PUT with correct X-Dashboard-Key', () => {
    mockGetConfig.mockReturnValue({ DASHBOARD_SECRET: 'my-secret-123' })
    const req = createMockReq('PUT', { 'x-dashboard-key': 'my-secret-123' })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    dashboardAuth(req, res as unknown as Response, next)

    expect(next).toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
  })

  it('allows POST with correct X-Dashboard-Key', () => {
    mockGetConfig.mockReturnValue({ DASHBOARD_SECRET: 'my-secret-123' })
    const req = createMockReq('POST', { 'x-dashboard-key': 'my-secret-123' })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    dashboardAuth(req, res as unknown as Response, next)

    expect(next).toHaveBeenCalled()
  })

  it('allows DELETE with correct X-Dashboard-Key', () => {
    mockGetConfig.mockReturnValue({ DASHBOARD_SECRET: 'my-secret-123' })
    const req = createMockReq('DELETE', { 'x-dashboard-key': 'my-secret-123' })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    dashboardAuth(req, res as unknown as Response, next)

    expect(next).toHaveBeenCalled()
  })

  // ---- Write methods blocked without valid secret ----

  it('rejects PUT with missing header', () => {
    mockGetConfig.mockReturnValue({ DASHBOARD_SECRET: 'my-secret-123' })
    const req = createMockReq('PUT')
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    dashboardAuth(req, res as unknown as Response, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    expect((res.body as { error: string }).error).toContain('Unauthorized')
  })

  it('rejects PUT with wrong secret', () => {
    mockGetConfig.mockReturnValue({ DASHBOARD_SECRET: 'my-secret-123' })
    const req = createMockReq('PUT', { 'x-dashboard-key': 'wrong-secret' })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    dashboardAuth(req, res as unknown as Response, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })

  it('rejects POST with missing header', () => {
    mockGetConfig.mockReturnValue({ DASHBOARD_SECRET: 'my-secret-123' })
    const req = createMockReq('POST')
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    dashboardAuth(req, res as unknown as Response, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })

  it('rejects DELETE with wrong secret', () => {
    mockGetConfig.mockReturnValue({ DASHBOARD_SECRET: 'my-secret-123' })
    const req = createMockReq('DELETE', { 'x-dashboard-key': 'nope' })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    dashboardAuth(req, res as unknown as Response, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })

  it('rejects PATCH with missing header', () => {
    mockGetConfig.mockReturnValue({ DASHBOARD_SECRET: 'my-secret-123' })
    const req = createMockReq('PATCH')
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    dashboardAuth(req, res as unknown as Response, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })

  it('allows PATCH with correct secret', () => {
    mockGetConfig.mockReturnValue({ DASHBOARD_SECRET: 'my-secret-123' })
    const req = createMockReq('PATCH', { 'x-dashboard-key': 'my-secret-123' })
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    dashboardAuth(req, res as unknown as Response, next)

    expect(next).toHaveBeenCalled()
  })

  // ---- Logging ----

  it('logs warning on auth failure with IP address', async () => {
    mockGetConfig.mockReturnValue({ DASHBOARD_SECRET: 'my-secret-123' })
    const req = createMockReq('PUT', { 'x-dashboard-key': 'bad' }, '10.0.0.42')
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    dashboardAuth(req, res as unknown as Response, next)

    const { logger } = await import('../../utils/logger.js')
    expect(logger.warn).toHaveBeenCalledWith(
      'Dashboard auth failed',
      expect.objectContaining({
        event: 'dashboard_auth_failed',
        method: 'PUT',
        ip: '10.0.0.42',
      })
    )
  })

  it('logs warning when DASHBOARD_SECRET is not set (dev mode)', async () => {
    mockGetConfig.mockReturnValue({})
    const req = createMockReq('POST')
    const res = createMockRes()
    const next = vi.fn() as unknown as NextFunction

    dashboardAuth(req, res as unknown as Response, next)

    expect(next).toHaveBeenCalled()
    const { logger } = await import('../../utils/logger.js')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('DASHBOARD_SECRET not set'),
      expect.objectContaining({
        event: 'dashboard_auth_disabled',
      })
    )
  })
})
