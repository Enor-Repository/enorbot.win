/**
 * Dashboard API: Cost monitoring endpoints
 * Stories D.9-D.10: AI Usage Tracking & Cost Dashboard
 */
import { Router, type Request, type Response } from 'express'
import { getSupabase } from '../../services/supabase.js'
import { logger } from '../../utils/logger.js'

export const costsRouter = Router()

// Valid period values
const VALID_PERIODS = ['day', 'week', 'month'] as const
type Period = (typeof VALID_PERIODS)[number]

/**
 * Get date filter based on period
 */
function getDateFilter(period: Period): Date {
  const now = new Date()
  switch (period) {
    case 'day':
      return new Date(now.setHours(0, 0, 0, 0))
    case 'week':
      return new Date(now.setDate(now.getDate() - 7))
    case 'month':
      return new Date(now.setMonth(now.getMonth() - 1))
  }
}

/**
 * GET /api/costs/summary
 * Returns cost summary for the specified period
 */
costsRouter.get('/summary', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || 'day'

    if (!VALID_PERIODS.includes(period as Period)) {
      return res.status(400).json({ error: 'Invalid period. Must be: day, week, or month' })
    }

    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    const startDate = getDateFilter(period as Period)

    const { data, error } = await supabase
      .from('ai_usage')
      .select('service, cost_usd, input_tokens, output_tokens, duration_ms, is_success')
      .gte('created_at', startDate.toISOString())

    if (error) throw error

    // Aggregate stats
    const stats = {
      totalCost: 0,
      totalCalls: 0,
      successfulCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      avgDurationMs: 0,
      byService: {} as Record<string, { calls: number; cost: number }>,
    }

    let totalDuration = 0

    data?.forEach((row: any) => {
      stats.totalCost += row.cost_usd || 0
      stats.totalCalls++
      if (row.is_success) stats.successfulCalls++
      stats.totalInputTokens += row.input_tokens || 0
      stats.totalOutputTokens += row.output_tokens || 0
      totalDuration += row.duration_ms || 0

      const service = row.service || 'unknown'
      if (!stats.byService[service]) {
        stats.byService[service] = { calls: 0, cost: 0 }
      }
      stats.byService[service].calls++
      stats.byService[service].cost += row.cost_usd || 0
    })

    stats.avgDurationMs = stats.totalCalls > 0 ? totalDuration / stats.totalCalls : 0

    res.json({
      period,
      ...stats,
      avgCostPerCall: stats.totalCalls > 0 ? stats.totalCost / stats.totalCalls : 0,
    })
  } catch (error) {
    logger.error('Failed to get cost summary', {
      event: 'cost_summary_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to get cost summary',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * GET /api/costs/by-group
 * Returns cost breakdown by group
 */
costsRouter.get('/by-group', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || 'day'

    if (!VALID_PERIODS.includes(period as Period)) {
      return res.status(400).json({ error: 'Invalid period. Must be: day, week, or month' })
    }

    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    const startDate = getDateFilter(period as Period)

    const { data, error } = await supabase
      .from('ai_usage')
      .select('group_jid, cost_usd')
      .gte('created_at', startDate.toISOString())
      .not('group_jid', 'is', null)

    if (error) throw error

    // Aggregate by group
    const groupMap = new Map<string, { calls: number; cost: number }>()

    data?.forEach((row: any) => {
      const existing = groupMap.get(row.group_jid) || { calls: 0, cost: 0 }
      existing.calls++
      existing.cost += row.cost_usd || 0
      groupMap.set(row.group_jid, existing)
    })

    // Get group names
    const groupJids = Array.from(groupMap.keys())
    const { data: groups } = await supabase
      .from('groups')
      .select('jid, name')
      .in('jid', groupJids)

    const groupNameMap = new Map(groups?.map((g: any) => [g.jid, g.name]) || [])

    const groupsWithCosts = Array.from(groupMap.entries())
      .map(([jid, stats]) => ({
        groupJid: jid,
        groupName: groupNameMap.get(jid) || jid,
        ...stats,
      }))
      .sort((a, b) => b.cost - a.cost)

    res.json({ period, groups: groupsWithCosts })
  } catch (error) {
    logger.error('Failed to get costs by group', {
      event: 'cost_by_group_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to get costs by group',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * GET /api/costs/trend
 * Returns daily cost trend for the specified number of days
 */
costsRouter.get('/trend', async (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 365)

    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    startDate.setHours(0, 0, 0, 0)

    const { data, error } = await supabase
      .from('ai_usage')
      .select('created_at, cost_usd')
      .gte('created_at', startDate.toISOString())

    if (error) throw error

    // Aggregate by day
    const dayMap = new Map<string, { cost: number; calls: number }>()

    data?.forEach((row: any) => {
      const date = new Date(row.created_at).toISOString().split('T')[0]
      const existing = dayMap.get(date) || { cost: 0, calls: 0 }
      existing.cost += row.cost_usd || 0
      existing.calls++
      dayMap.set(date, existing)
    })

    // Fill in missing days with zeros
    const trend = []
    const current = new Date(startDate)
    const today = new Date()

    while (current <= today) {
      const dateStr = current.toISOString().split('T')[0]
      const stats = dayMap.get(dateStr) || { cost: 0, calls: 0 }
      trend.push({
        date: dateStr,
        ...stats,
      })
      current.setDate(current.getDate() + 1)
    }

    res.json({ days, trend })
  } catch (error) {
    logger.error('Failed to get cost trend', {
      event: 'cost_trend_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to get cost trend',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
