/**
 * Dashboard API: Status endpoints
 * Returns bot connection and operational status
 */
import { Router, type Request, type Response } from 'express'
import {
  getConnectionStatus,
  getOperationalStatus,
  getPauseInfo,
  getActivityStats,
} from '../../bot/state.js'
import { getGroupModeStats } from '../../services/groupConfig.js'

export const statusRouter = Router()

/**
 * GET /api/status
 * Returns full bot status snapshot
 */
statusRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const connection = getConnectionStatus()
    const operational = getOperationalStatus()
    const pauseInfo = getPauseInfo()
    const stats = getActivityStats()
    const modeStats = getGroupModeStats()

    // TODO: Get actual AI calls and cost from classification metrics
    const aiCallsToday = 0
    const estimatedCostToday = 0

    res.json({
      connection,
      operational,
      globalPause: operational === 'paused',
      uptime: stats.uptimeMs,
      messagesSentToday: stats.messagesSentToday,
      aiCallsToday,
      estimatedCostToday,
      lastActivityAt: stats.lastActivityAt,
      pauseInfo: {
        reason: pauseInfo.reason,
        pausedAt: pauseInfo.pausedAt,
      },
      groupModes: {
        learning: modeStats.learning,
        assisted: modeStats.assisted,
        active: modeStats.active,
        paused: modeStats.paused,
      },
    })
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get status',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
