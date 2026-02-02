/**
 * Dashboard API: Groups endpoints
 * Manage group configurations and modes
 * Stories D.11-D.12: Mode Selector & AI Threshold
 */
import { Router, type Request, type Response } from 'express'
import { getAllGroupConfigs, setGroupMode } from '../../services/groupConfig.js'
import { getSupabase } from '../../services/supabase.js'
import { logger } from '../../utils/logger.js'

// Validate group JID format
function isValidGroupJid(jid: string): boolean {
  return /^\d+@g\.us$/.test(jid)
}

export const groupsRouter = Router()

/**
 * GET /api/groups
 * Returns all known groups with configuration
 */
groupsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const configs = await getAllGroupConfigs()
    const groups = Array.from(configs.values()).map((config) => ({
      id: config.groupJid,
      name: config.groupName,
      mode: config.mode,
      isControlGroup: config.groupName.includes('CONTROLE'), // TODO: Better control group detection
      learningDays: Math.floor((Date.now() - config.learningStartedAt.getTime()) / (1000 * 60 * 60 * 24)),
      messagesCollected: 0, // TODO: Get from observation_queue or messages table
      rulesActive: 0, // TODO: Get from rules table when implemented
      lastActivity: null, // TODO: Get from messages table
    }))

    res.json({ groups })
  } catch (error) {
    logger.error('Failed to get groups', {
      event: 'groups_api_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to get groups',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * PUT /api/groups/:groupId/mode
 * Update group operational mode
 */
groupsRouter.put('/:groupId/mode', async (req: Request, res: Response) => {
  try {
    const groupId = req.params.groupId as string
    const { mode } = req.body

    if (!mode || !['learning', 'assisted', 'active', 'paused'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode' })
    }

    const result = await setGroupMode(groupId, mode, 'dashboard-api')

    if (!result.ok) {
      return res.status(400).json({ error: result.error })
    }

    logger.info('Group mode updated via dashboard', {
      event: 'group_mode_updated_dashboard',
      groupId,
      mode,
    })

    res.json({ success: true, mode })
  } catch (error) {
    logger.error('Failed to update group mode', {
      event: 'group_mode_update_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to update mode',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * GET /api/groups/:groupJid/config
 * Returns group configuration including mode, threshold, and pattern coverage
 * Story D.11/D.12
 */
groupsRouter.get('/:groupJid/config', async (req: Request, res: Response) => {
  try {
    const groupJid = req.params.groupJid as string

    if (!isValidGroupJid(groupJid)) {
      return res.status(400).json({ error: 'Invalid group JID format' })
    }

    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    const { data: config, error } = await supabase
      .from('group_config')
      .select('*')
      .eq('group_jid', groupJid)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Group configuration not found' })
      }
      throw error
    }

    // Calculate pattern coverage
    const { data: rules } = await supabase
      .from('rules')
      .select('trigger_phrase')
      .or(`group_jid.eq.${groupJid},group_jid.is.null`)
      .eq('is_active', true)
      .limit(500)

    const { data: triggers } = await supabase
      .from('messages')
      .select('content')
      .eq('group_jid', groupJid)
      .eq('is_trigger', true)
      .limit(1000)

    const uniqueTriggers = new Set(triggers?.map((t: any) => t.content.toLowerCase().trim()) || [])
    const rulePatterns = new Set(rules?.map((r: any) => r.trigger_phrase.toLowerCase().trim()) || [])

    let coveredCount = 0
    if (uniqueTriggers.size > 0 && rulePatterns.size > 0) {
      const patternArray = [...rulePatterns]
      for (const trigger of uniqueTriggers) {
        if (patternArray.some((pattern) => trigger.includes(pattern) || pattern.includes(trigger))) {
          coveredCount++
        }
      }
    }

    const patternCoverage =
      uniqueTriggers.size > 0 ? Math.round((coveredCount / uniqueTriggers.size) * 100) : 0

    // Database stores threshold as 0-100, API returns 0.0-1.0
    const dbThreshold = config.ai_threshold ?? 70
    const apiThreshold = dbThreshold / 100

    res.json({
      groupJid: config.group_jid,
      mode: config.mode || 'learning',
      aiThreshold: apiThreshold,
      learningStartedAt: config.learning_started_at,
      patternCoverage,
      rulesActive: rules?.length || 0,
    })
  } catch (error) {
    logger.error('Failed to get group config', {
      event: 'group_config_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to get group config',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * PUT /api/groups/:groupJid/threshold
 * Update AI confidence threshold for a group
 * Story D.12
 */
groupsRouter.put('/:groupJid/threshold', async (req: Request, res: Response) => {
  try {
    const groupJid = req.params.groupJid as string
    const { threshold } = req.body

    if (!isValidGroupJid(groupJid)) {
      return res.status(400).json({ error: 'Invalid group JID format' })
    }

    const numThreshold = parseFloat(threshold)
    if (isNaN(numThreshold) || numThreshold < 0.5 || numThreshold > 1.0) {
      return res.status(400).json({ error: 'Invalid threshold. Must be between 0.5 and 1.0' })
    }

    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    // Database stores threshold as 0-100, API receives 0.0-1.0
    const dbThreshold = Math.round(numThreshold * 100)

    const { data, error } = await supabase
      .from('group_config')
      .update({
        ai_threshold: dbThreshold,
        updated_at: new Date().toISOString(),
      })
      .eq('group_jid', groupJid)
      .select()

    if (error) throw error

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Group configuration not found' })
    }

    logger.info('Group threshold updated via dashboard', {
      event: 'group_threshold_updated_dashboard',
      groupJid,
      threshold: numThreshold,
    })

    res.json({ success: true, threshold: numThreshold })
  } catch (error) {
    logger.error('Failed to update threshold', {
      event: 'threshold_update_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to update threshold',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
