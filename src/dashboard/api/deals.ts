/**
 * Dashboard API: Deal Flow Endpoints
 * Sprint 4: Deal Flow Engine
 *
 * Enables Daniel (CIO) to monitor and manage active deals.
 * Routes are mounted under /api/groups/:groupJid/deals
 *
 * Endpoints:
 * - GET /                   - List active deals for group
 * - GET /all                - List all deals (including terminal) for group
 * - GET /history            - List deal history (archived deals)
 * - GET /:dealId            - Get specific deal
 * - POST /:dealId/cancel    - Cancel a deal (operator action)
 * - POST /:dealId/extend    - Extend deal TTL
 */
import { Router, type Request, type Response } from 'express'
import { logger } from '../../utils/logger.js'
import {
  getActiveDeals,
  getAllDeals,
  getDealById,
  cancelDeal,
  extendDealTtl,
  getDealHistory,
  sweepExpiredDeals,
} from '../../services/dealFlowService.js'

// Use mergeParams to access :groupJid from parent router
export const dealsRouter = Router({ mergeParams: true })

/**
 * Extract and validate groupJid from route params
 */
function getGroupJid(req: Request): string | null {
  const groupJid = req.params.groupJid
  if (typeof groupJid !== 'string' || !groupJid) return null
  return groupJid
}

// ============================================================================
// Endpoints
// ============================================================================

/**
 * GET /api/groups/:groupJid/deals
 * List active (non-terminal) deals for a group
 */
dealsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const result = await getActiveDeals(groupJid)

    if (!result.ok) {
      return res.status(500).json({
        error: 'Failed to fetch active deals',
        message: result.error,
      })
    }

    return res.json({ deals: result.data })
  } catch (e) {
    logger.error('Unexpected error in GET /deals', {
      event: 'deals_api_error',
      error: e instanceof Error ? e.message : String(e),
    })
    return res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /api/groups/:groupJid/deals/all
 * List all deals (including terminal states) for dashboard view
 */
dealsRouter.get('/all', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const result = await getAllDeals(groupJid)

    if (!result.ok) {
      return res.status(500).json({
        error: 'Failed to fetch all deals',
        message: result.error,
      })
    }

    return res.json({ deals: result.data })
  } catch (e) {
    logger.error('Unexpected error in GET /deals/all', {
      event: 'deals_all_api_error',
      error: e instanceof Error ? e.message : String(e),
    })
    return res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /api/groups/:groupJid/deals/history
 * List deal history (archived deals) for audit
 */
dealsRouter.get('/history', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const limitParam = req.query.limit
    let limit = 50
    if (typeof limitParam === 'string') {
      const parsed = parseInt(limitParam, 10)
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.min(parsed, 200)
      }
    }

    // Sprint 5, Task 5.3: L3 tech debt - date range filter
    const dateOptions: { from?: Date; to?: Date } = {}
    if (typeof req.query.from === 'string') {
      const fromDate = new Date(req.query.from)
      if (Number.isFinite(fromDate.getTime())) {
        dateOptions.from = fromDate
      }
    }
    if (typeof req.query.to === 'string') {
      const toDate = new Date(req.query.to)
      if (Number.isFinite(toDate.getTime())) {
        dateOptions.to = toDate
      }
    }

    const result = await getDealHistory(groupJid, limit, dateOptions)

    if (!result.ok) {
      return res.status(500).json({
        error: 'Failed to fetch deal history',
        message: result.error,
      })
    }

    return res.json({ history: result.data })
  } catch (e) {
    logger.error('Unexpected error in GET /deals/history', {
      event: 'deals_history_api_error',
      error: e instanceof Error ? e.message : String(e),
    })
    return res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /api/groups/:groupJid/deals/sweep
 * Manually trigger deal sweep (expire stale deals)
 */
dealsRouter.post('/sweep', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const result = await sweepExpiredDeals()

    if (!result.ok) {
      return res.status(500).json({
        error: 'Sweep failed',
        message: result.error,
      })
    }

    logger.info('Manual deal sweep triggered', {
      event: 'manual_deal_sweep',
      groupJid,
      expiredCount: result.data.length,
    })

    return res.json({ expired: result.data.length })
  } catch (e) {
    logger.error('Unexpected error in POST /deals/sweep', {
      event: 'deals_sweep_api_error',
      error: e instanceof Error ? e.message : String(e),
    })
    return res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /api/groups/:groupJid/deals/:dealId
 * Get a specific deal (with group authorization check)
 */
dealsRouter.get('/:dealId', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const dealId = req.params.dealId
    if (typeof dealId !== 'string' || !dealId) {
      return res.status(400).json({ error: 'Missing dealId parameter' })
    }

    const result = await getDealById(dealId, groupJid)

    if (!result.ok) {
      const status = result.error === 'Deal not found' ? 404 : 500
      return res.status(status).json({
        error: result.error === 'Deal not found' ? 'Deal not found' : 'Failed to fetch deal',
        message: result.error,
      })
    }

    return res.json({ deal: result.data })
  } catch (e) {
    logger.error('Unexpected error in GET /deals/:dealId', {
      event: 'deal_get_api_error',
      error: e instanceof Error ? e.message : String(e),
    })
    return res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /api/groups/:groupJid/deals/:dealId/cancel
 * Cancel a deal (operator action via dashboard)
 */
dealsRouter.post('/:dealId/cancel', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const dealId = req.params.dealId
    if (typeof dealId !== 'string' || !dealId) {
      return res.status(400).json({ error: 'Missing dealId parameter' })
    }

    const result = await cancelDeal(dealId, groupJid, 'cancelled_by_operator')

    if (!result.ok) {
      const status = result.error === 'Deal not found' ? 404
        : result.error.includes('Invalid transition') ? 409
        : 500
      return res.status(status).json({
        error: 'Failed to cancel deal',
        message: result.error,
      })
    }

    logger.info('Deal cancelled via dashboard', {
      event: 'deal_cancelled_dashboard',
      dealId,
      groupJid,
    })

    return res.json({ deal: result.data })
  } catch (e) {
    logger.error('Unexpected error in POST /deals/:dealId/cancel', {
      event: 'deal_cancel_api_error',
      error: e instanceof Error ? e.message : String(e),
    })
    return res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /api/groups/:groupJid/deals/:dealId/extend
 * Extend deal TTL (operator action via dashboard)
 *
 * Body: { seconds: number } - Additional seconds to add to TTL
 */
dealsRouter.post('/:dealId/extend', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const dealId = req.params.dealId
    if (typeof dealId !== 'string' || !dealId) {
      return res.status(400).json({ error: 'Missing dealId parameter' })
    }

    // Validate input
    const { seconds } = req.body
    if (typeof seconds !== 'number' || seconds <= 0) {
      return res.status(400).json({ error: 'seconds must be a positive number' })
    }
    if (seconds > 86400) {
      return res.status(400).json({ error: 'seconds cannot exceed 86400 (24 hours)' })
    }

    const result = await extendDealTtl(dealId, groupJid, seconds)

    if (!result.ok) {
      const status = result.error === 'Deal not found' ? 404
        : result.error.includes('Cannot extend') ? 409
        : 500
      return res.status(status).json({
        error: 'Failed to extend deal TTL',
        message: result.error,
      })
    }

    logger.info('Deal TTL extended via dashboard', {
      event: 'deal_ttl_extended_dashboard',
      dealId,
      groupJid,
      seconds,
    })

    return res.json({ deal: result.data })
  } catch (e) {
    logger.error('Unexpected error in POST /deals/:dealId/extend', {
      event: 'deal_extend_api_error',
      error: e instanceof Error ? e.message : String(e),
    })
    return res.status(500).json({ error: 'Internal server error' })
  }
})
