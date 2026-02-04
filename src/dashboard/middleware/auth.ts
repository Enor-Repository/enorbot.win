/**
 * Dashboard API Authentication Middleware
 * Sprint 7A.0: Protects write endpoints (POST, PUT, DELETE) with a shared secret.
 *
 * The client sends the secret via X-Dashboard-Key header.
 * If DASHBOARD_SECRET is not configured, all requests are allowed (development mode).
 */

import { timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { logger } from '../../utils/logger.js'
import { getConfig } from '../../config.js'

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Constant-time string comparison to prevent timing attacks. */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/**
 * Express middleware that validates X-Dashboard-Key header on write requests.
 * GET/HEAD/OPTIONS requests pass through without auth.
 * If DASHBOARD_SECRET env var is not set, all requests pass (dev mode).
 */
export function dashboardAuth(req: Request, res: Response, next: NextFunction): void {
  // Read methods are always allowed
  if (READ_METHODS.has(req.method)) {
    next()
    return
  }

  const config = getConfig()
  const secret = config.DASHBOARD_SECRET

  // If no secret configured, allow all (development mode)
  if (!secret) {
    logger.warn('Dashboard auth middleware: DASHBOARD_SECRET not set — write endpoints unprotected', {
      event: 'dashboard_auth_disabled',
      method: req.method,
      path: req.path,
    })
    next()
    return
  }

  const provided = req.headers['x-dashboard-key']

  if (typeof provided !== 'string' || !safeCompare(provided, secret)) {
    logger.warn('Dashboard auth failed', {
      event: 'dashboard_auth_failed',
      method: req.method,
      path: req.path,
      hasHeader: !!provided,
      ip: req.ip || req.socket?.remoteAddress || 'unknown',
    })
    res.status(401).json({ error: 'Unauthorized — invalid or missing X-Dashboard-Key header' })
    return
  }

  next()
}
