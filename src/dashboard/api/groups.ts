/**
 * Dashboard API: Groups endpoints
 * Manage group configurations and modes
 * Stories D.11-D.12: Mode Selector & AI Threshold
 */
import { Router, type Request, type Response } from 'express'
import { getAllGroupConfigs, setGroupMode, getGroupConfigSync, setPlayerRole, removePlayerRole, type PlayerRole } from '../../services/groupConfig.js'
import { getSupabase } from '../../services/supabase.js'
import { seedDefaultTriggers } from '../../services/systemTriggerSeeder.js'
import { reconcileSystemTriggers } from '../../services/systemTriggerReconciler.js'
import { cloneGroupRuleset } from '../../services/ruleService.js'
import { logger } from '../../utils/logger.js'

// Validate group JID format
function isValidGroupJid(jid: string): boolean {
  return /^\d+@g\.us$/.test(jid)
}

export const groupsRouter = Router()

// Constants for query bounds
const MAX_PLAYERS_LIMIT = 100
const MAX_DAYS_LOOKBACK = 90
const MAX_GROUPS_LIMIT = 500

/**
 * GET /api/groups
 * Returns all known groups with configuration and message stats
 */
groupsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const configs = await getAllGroupConfigs()
    const supabase = getSupabase()

    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    // Fetch message stats from the groups table (with limit for safety)
    let groupStats: Map<string, { messageCount: number; lastActivity: string | null }> = new Map()

    const { data: statsData, error: statsError } = await supabase
      .from('groups')
      .select('jid, message_count, last_activity_at')
      .limit(MAX_GROUPS_LIMIT)

    if (statsError) {
      logger.warn('Failed to fetch group stats', {
        event: 'group_stats_error',
        error: statsError.message,
      })
    }

    if (statsData) {
      for (const row of statsData) {
        groupStats.set(row.jid, {
          messageCount: row.message_count || 0,
          lastActivity: row.last_activity_at,
        })
      }
    }

    // Fetch trigger counts per group from group_triggers
    const triggerCounts: Map<string, number> = new Map()
    const { data: triggerData, error: triggerError } = await supabase
      .from('group_triggers')
      .select('group_jid')
      .eq('is_active', true)
      .limit(5000)

    if (triggerError) {
      logger.warn('Failed to fetch trigger counts', {
        event: 'trigger_counts_error',
        error: triggerError.message,
      })
    }

    if (triggerData) {
      for (const row of triggerData) {
        triggerCounts.set(row.group_jid, (triggerCounts.get(row.group_jid) || 0) + 1)
      }
    }

    const groups = Array.from(configs.values())
      .map((config) => {
        const stats = groupStats.get(config.groupJid)
        return {
          id: config.groupJid,
          jid: config.groupJid, // Frontend needs both id and jid
          name: config.groupName,
          mode: config.mode,
          isControlGroup: config.groupName.includes('CONTROLE'),
          learningDays: Math.floor((Date.now() - config.learningStartedAt.getTime()) / (1000 * 60 * 60 * 24)),
          messagesCollected: stats?.messageCount ?? 0,
          rulesActive: triggerCounts.get(config.groupJid) || 0,
          lastActivity: stats?.lastActivity ?? null,
        }
      })
      .sort((a, b) => {
        // Control groups first, then alphabetical
        if (a.isControlGroup && !b.isControlGroup) return -1
        if (!a.isControlGroup && b.isControlGroup) return 1
        return a.name.localeCompare(b.name)
      })

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

/**
 * GET /api/groups/:groupJid/players
 * Returns players/contacts for a group with message counts
 * Used by GroupsAndRulesPage for player role management
 */
groupsRouter.get('/:groupJid/players', async (req: Request, res: Response) => {
  try {
    const groupJid = req.params.groupJid as string

    // Validate and bound query parameters to prevent abuse
    const requestedLimit = parseInt(req.query.limit as string) || 50
    const requestedDays = parseInt(req.query.days as string) || 30
    const limit = Math.min(Math.max(1, requestedLimit), MAX_PLAYERS_LIMIT)
    const days = Math.min(Math.max(1, requestedDays), MAX_DAYS_LOOKBACK)

    if (!isValidGroupJid(groupJid)) {
      return res.status(400).json({ error: 'Invalid group JID format' })
    }

    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // Get message counts per sender in this group (with safety limit)
    // Limit to 10k messages to prevent memory issues on very active groups
    const { data: messages, error } = await supabase
      .from('messages')
      .select('sender_jid, created_at')
      .eq('group_jid', groupJid)
      .eq('is_from_bot', false)
      .gte('created_at', startDate.toISOString())
      .limit(10000)

    if (error) throw error

    // Aggregate by sender
    const playerMap = new Map<string, { messageCount: number; lastActive: Date }>()

    messages?.forEach((msg: any) => {
      const msgDate = new Date(msg.created_at)
      const existing = playerMap.get(msg.sender_jid) || {
        messageCount: 0,
        lastActive: msgDate,
      }
      existing.messageCount++
      // Use proper Date comparison instead of string comparison
      if (msgDate > existing.lastActive) existing.lastActive = msgDate
      playerMap.set(msg.sender_jid, existing)
    })

    // Get top players sorted by message count
    const topPlayerJids = Array.from(playerMap.entries())
      .sort((a, b) => b[1].messageCount - a[1].messageCount)
      .slice(0, limit)
      .map(([jid]) => jid)

    if (topPlayerJids.length === 0) {
      return res.json({ players: [] })
    }

    // Get contact info for top players
    const { data: contacts, error: contactsError } = await supabase
      .from('contacts')
      .select('jid, push_name')
      .in('jid', topPlayerJids)

    if (contactsError) {
      logger.warn('Failed to fetch contact names for players', {
        event: 'player_contacts_error',
        groupJid,
        error: contactsError.message,
      })
    }

    const contactMap = new Map<string, string>()
    contacts?.forEach((c: any) => {
      contactMap.set(c.jid, c.push_name || 'Unknown')
    })

    // Build response matching frontend's expected format
    const groupConfig = getGroupConfigSync(groupJid)
    const players = topPlayerJids.map((jid) => {
      const stats = playerMap.get(jid)!
      return {
        jid,
        name: contactMap.get(jid) || 'Unknown',
        messageCount: stats.messageCount,
        role: groupConfig?.playerRoles?.[jid] ?? null,
      }
    })

    res.json({ players })
  } catch (error) {
    logger.error('Failed to get group players', {
      event: 'group_players_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to get players',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * PUT /api/groups/:groupJid/players/:playerJid/role
 * Set or remove a player's role in a group.
 * Body: { "role": "operator" | "client" | "cio" | null }
 * Enforces one operator per group: setting a new operator demotes the previous one to client.
 */
groupsRouter.put('/:groupJid/players/:playerJid/role', async (req: Request, res: Response) => {
  try {
    const groupJid = req.params.groupJid as string
    const playerJid = req.params.playerJid as string

    if (!isValidGroupJid(groupJid)) {
      return res.status(400).json({ error: 'Invalid group JID format' })
    }

    if (!playerJid || !/^\d+@(s\.whatsapp\.net|lid)$/.test(playerJid)) {
      return res.status(400).json({ error: 'Invalid player JID format' })
    }

    const { role } = req.body
    const validRoles: (PlayerRole | null)[] = ['operator', 'client', 'cio', 'ignore', null]
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be "operator", "client", "cio", "ignore", or null' })
    }

    // Remove role
    if (role === null) {
      const result = await removePlayerRole(groupJid, playerJid, 'dashboard')
      if (!result.ok) {
        return res.status(400).json({ error: result.error })
      }
      logger.info('Player role removed via dashboard', {
        event: 'player_role_removed_dashboard',
        groupJid,
        playerJid,
      })
      return res.json({ ok: true })
    }

    // Enforce one operator per group: demote existing operator before promoting new one
    if (role === 'operator') {
      const config = getGroupConfigSync(groupJid)
      if (config?.playerRoles) {
        for (const [existingJid, existingRole] of Object.entries(config.playerRoles)) {
          if (existingRole === 'operator' && existingJid !== playerJid) {
            await setPlayerRole(groupJid, existingJid, 'client', 'dashboard')
          }
        }
      }
    }

    const result = await setPlayerRole(groupJid, playerJid, role, 'dashboard')
    if (!result.ok) {
      return res.status(400).json({ error: result.error })
    }

    logger.info('Player role updated via dashboard', {
      event: 'player_role_updated_dashboard',
      groupJid,
      playerJid,
      role,
    })

    res.json({ ok: true })
  } catch (error) {
    logger.error('Failed to update player role', {
      event: 'player_role_update_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to update player role',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * POST /api/groups/:groupJid/seed
 * Manually trigger system trigger seeding for a group.
 * Idempotent: safe to call multiple times.
 */
groupsRouter.post('/:groupJid/seed', async (req: Request, res: Response) => {
  try {
    const groupJid = req.params.groupJid as string

    if (!isValidGroupJid(groupJid)) {
      return res.status(400).json({ error: 'Invalid group JID format' })
    }

    // Detect control group from group config
    const config = getGroupConfigSync(groupJid)
    const isControlGroup = config ? config.groupName.includes('CONTROLE') : false

    await seedDefaultTriggers(groupJid, isControlGroup)

    logger.info('Default triggers seeded via dashboard', {
      event: 'manual_seed_dashboard',
      groupJid,
      isControlGroup,
    })

    res.json({ success: true, groupJid })
  } catch (error) {
    logger.error('Failed to seed system triggers', {
      event: 'manual_seed_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to seed triggers',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * POST /api/groups/:groupJid/system-triggers/reconcile
 * Run on-demand system trigger reconciliation for one group and return summary.
 * Safe/idempotent: inserts missing system triggers and heals system-owned drift.
 */
groupsRouter.post('/:groupJid/system-triggers/reconcile', async (req: Request, res: Response) => {
  try {
    const groupJid = req.params.groupJid as string

    if (!isValidGroupJid(groupJid)) {
      return res.status(400).json({ error: 'Invalid group JID format' })
    }

    const config = getGroupConfigSync(groupJid)
    const isControlGroup = config ? config.groupName.includes('CONTROLE') : false

    const result = await reconcileSystemTriggers(groupJid, isControlGroup)
    if (!result.ok) {
      const status = result.error.includes('Supabase not initialized') ? 503 : 500
      return res.status(status).json({
        error: 'Failed to reconcile system triggers',
        message: result.error,
      })
    }

    logger.info('System triggers reconciled via dashboard', {
      event: 'system_trigger_reconcile_dashboard',
      groupJid,
      isControlGroup,
      insertedCount: result.data.insertedCount,
      updatedCount: result.data.updatedCount,
      conflictCount: result.data.conflicts.length,
    })

    res.json({
      success: true,
      summary: {
        ...result.data,
        reconciledAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    logger.error('Failed to reconcile system triggers', {
      event: 'system_trigger_reconcile_dashboard_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to reconcile system triggers',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * POST /api/groups/:groupJid/clone-ruleset
 * Clone triggers, time rules, and/or spread config from a source group.
 * Uses upsert strategy — safe to call multiple times (idempotent).
 *
 * Body: { sourceGroupJid: string, cloneTriggers?: boolean, cloneRules?: boolean, cloneSpreads?: boolean }
 */
groupsRouter.post('/:groupJid/clone-ruleset', async (req: Request, res: Response) => {
  try {
    const targetGroupJid = req.params.groupJid as string

    if (!isValidGroupJid(targetGroupJid)) {
      return res.status(400).json({ error: 'Invalid target group JID format' })
    }

    const { sourceGroupJid, cloneTriggers, cloneRules, cloneSpreads } = req.body

    if (!sourceGroupJid || typeof sourceGroupJid !== 'string') {
      return res.status(400).json({ error: 'sourceGroupJid is required' })
    }

    if (!isValidGroupJid(sourceGroupJid)) {
      return res.status(400).json({ error: 'Invalid source group JID format' })
    }

    // Self-clone and "nothing selected" are validated by cloneGroupRuleset()
    const result = await cloneGroupRuleset({
      sourceGroupJid,
      targetGroupJid,
      cloneTriggers: cloneTriggers !== false,
      cloneRules: cloneRules !== false,
      cloneSpreads: cloneSpreads !== false,
    })

    if (!result.ok) {
      return res.status(400).json({ error: result.error })
    }

    logger.info('Ruleset cloned via dashboard', {
      event: 'ruleset_cloned_dashboard',
      sourceGroupJid,
      targetGroupJid,
      triggers: result.data.triggers,
      rules: result.data.rules,
      spreads: result.data.spreads,
    })

    res.json({ success: true, ...result.data })
  } catch (error) {
    logger.error('Failed to clone ruleset', {
      event: 'clone_ruleset_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to clone ruleset',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
