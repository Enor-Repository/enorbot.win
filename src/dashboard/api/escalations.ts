/**
 * Volatility Escalations API
 * Dashboard endpoints for managing escalation alerts.
 */
import { Router, type Request, type Response } from 'express'
import { logger } from '../../utils/logger.js'
import { getSupabase } from '../../services/supabase.js'
import { unpauseGroup } from '../../services/volatilityMonitor.js'

export const escalationsRouter = Router({ mergeParams: true })

/**
 * GET /api/groups/:groupJid/escalations
 * Get escalations for a group.
 * Query params:
 *   - active=true: Only return undismissed escalations
 */
escalationsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const groupJid = req.params.groupJid as string
  const activeOnly = req.query.active === 'true'

  if (!groupJid) {
    res.status(400).json({ error: 'Missing groupJid parameter' })
    return
  }

  const supabase = getSupabase()
  if (!supabase) {
    res.status(503).json({ error: 'Database not available' })
    return
  }

  try {
    let query = supabase
      .from('volatility_escalations')
      .select('id, group_jid, escalated_at, dismissed_at, quote_price, market_price, reprice_count')
      .eq('group_jid', groupJid)
      .order('escalated_at', { ascending: false })

    if (activeOnly) {
      query = query.is('dismissed_at', null)
    }

    const { data, error } = await query.limit(10)

    if (error) {
      logger.error('Failed to get escalations', {
        event: 'escalations_get_error',
        groupJid,
        error: error.message,
      })
      res.status(500).json({ error: error.message })
      return
    }

    res.json({
      escalations: data.map((e) => ({
        id: e.id,
        groupJid: e.group_jid,
        escalatedAt: e.escalated_at,
        dismissedAt: e.dismissed_at,
        quotePrice: e.quote_price,
        marketPrice: e.market_price,
        repriceCount: e.reprice_count,
      })),
    })
  } catch (e) {
    logger.error('Escalations get exception', {
      event: 'escalations_get_exception',
      groupJid,
      error: e instanceof Error ? e.message : String(e),
    })
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /api/groups/:groupJid/escalations/:escalationId/dismiss
 * Dismiss an escalation alert.
 */
escalationsRouter.post('/:escalationId/dismiss', async (req: Request, res: Response): Promise<void> => {
  const groupJid = req.params.groupJid as string
  const escalationId = req.params.escalationId as string

  if (!groupJid || !escalationId) {
    res.status(400).json({ error: 'Missing required parameters' })
    return
  }

  const supabase = getSupabase()
  if (!supabase) {
    res.status(503).json({ error: 'Database not available' })
    return
  }

  try {
    const { error } = await supabase
      .from('volatility_escalations')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', escalationId)
      .eq('group_jid', groupJid)

    if (error) {
      logger.error('Failed to dismiss escalation', {
        event: 'escalation_dismiss_error',
        groupJid,
        escalationId,
        error: error.message,
      })
      res.status(500).json({ error: error.message })
      return
    }

    // Unpause the group so volatility monitoring resumes
    unpauseGroup(groupJid)

    logger.info('Escalation dismissed', {
      event: 'escalation_dismissed',
      groupJid,
      escalationId,
    })

    res.json({ success: true })
  } catch (e) {
    logger.error('Escalation dismiss exception', {
      event: 'escalation_dismiss_exception',
      groupJid,
      escalationId,
      error: e instanceof Error ? e.message : String(e),
    })
    res.status(500).json({ error: 'Internal server error' })
  }
})
