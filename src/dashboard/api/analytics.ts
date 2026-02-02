/**
 * Dashboard API: Analytics endpoints
 * Story D.1: Analytics Backend
 */
import { Router, type Request, type Response } from 'express'
import { getSupabase } from '../../services/supabase.js'
import { logger } from '../../utils/logger.js'
export const analyticsRouter = Router()

/**
 * GET /api/groups/:groupId/analytics/heatmap
 * Returns message activity heatmap (hour x day of week)
 *
 * Response: {
 *   heatmap: Array<{ hour: number, dayOfWeek: number, count: number, topTrigger?: string }>
 *   range: { start: string, end: string }
 * }
 */
// Safety limits to prevent DoS
const MAX_HEATMAP_MESSAGES = 10000
const MAX_PLAYERS_MESSAGES = 10000
const MAX_DAYS_LOOKBACK = 365

analyticsRouter.get('/:groupId/analytics/heatmap', async (req: Request, res: Response) => {
  try {
    const groupId = req.params.groupId as string
    const days = Math.min(parseInt(req.query.days as string) || 30, MAX_DAYS_LOOKBACK)

    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // Query to get message count by hour and day of week
    // Skip RPC and use direct query (more reliable)
    let query = supabase
      .from('messages')
      .select('created_at, content, is_trigger')
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false })

    // If groupId is 'all', don't filter by group - aggregate all groups
    if (groupId !== 'all') {
      query = query.eq('group_jid', groupId)
    }

    // Always apply safety limit to prevent OOM
    query = query.limit(MAX_HEATMAP_MESSAGES)

    const { data: messages, error: queryError } = await query

    if (queryError) {
      throw queryError
    }

    // Aggregate in-memory
    const heatmapMap = new Map<string, { count: number; triggers: string[] }>()

    messages?.forEach((msg: any) => {
      const date = new Date(msg.created_at)
      const hour = date.getHours()
      const dayOfWeek = date.getDay() // 0 = Sunday
      const key = `${hour}-${dayOfWeek}`

      const existing = heatmapMap.get(key) || { count: 0, triggers: [] }
      existing.count++
      if (msg.is_trigger && msg.content) {
        existing.triggers.push(msg.content)
      }
      heatmapMap.set(key, existing)
    })

    const heatmap = Array.from(heatmapMap.entries()).map(([key, data]) => {
      const [hour, dayOfWeek] = key.split('-').map(Number)
      return {
        hour,
        dayOfWeek,
        count: data.count,
        topTrigger: data.triggers[0] || null,
      }
    })

    res.json({
      heatmap,
      range: {
        start: startDate.toISOString(),
        end: new Date().toISOString(),
      },
    })
  } catch (error) {
    logger.error('Failed to get heatmap analytics', {
      event: 'heatmap_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to get heatmap',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * GET /api/groups/:groupId/analytics/players
 * Returns top active players/users in a group
 *
 * Response: {
 *   players: Array<{
 *     jid: string
 *     phone: string
 *     pushName: string
 *     messageCount: number
 *     triggerCount: number
 *     role?: string
 *     lastActive: string
 *   }>
 * }
 */
analyticsRouter.get('/:groupId/analytics/players', async (req: Request, res: Response) => {
  try {
    const groupId = req.params.groupId as string
    const limit = parseInt(req.query.limit as string) || 20
    const days = parseInt(req.query.days as string) || 30

    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // Get message counts per sender in this group (with safety limit)
    const { data: messages, error } = await supabase
      .from('messages')
      .select('sender_jid, is_trigger, created_at')
      .eq('group_jid', groupId)
      .eq('is_from_bot', false) // Exclude bot messages
      .gte('created_at', startDate.toISOString())
      .limit(MAX_PLAYERS_MESSAGES)

    if (error) throw error

    // Aggregate by sender
    const playerMap = new Map<string, { messageCount: number; triggerCount: number; lastActive: string }>()

    messages?.forEach((msg: any) => {
      const existing = playerMap.get(msg.sender_jid) || {
        messageCount: 0,
        triggerCount: 0,
        lastActive: msg.created_at,
      }
      existing.messageCount++
      if (msg.is_trigger) existing.triggerCount++
      if (msg.created_at > existing.lastActive) existing.lastActive = msg.created_at
      playerMap.set(msg.sender_jid, existing)
    })

    // Get contact info for top players
    const topPlayerJids = Array.from(playerMap.entries())
      .sort((a, b) => b[1].messageCount - a[1].messageCount)
      .slice(0, limit)
      .map(([jid]) => jid)

    const { data: contacts, error: contactsError } = await supabase
      .from('contacts')
      .select('jid, phone, push_name')
      .in('jid', topPlayerJids)

    if (contactsError) throw contactsError

    const players = topPlayerJids.map((jid) => {
      const stats = playerMap.get(jid)!
      const contact = contacts?.find((c: any) => c.jid === jid)
      return {
        jid,
        phone: contact?.phone || jid,
        pushName: contact?.push_name || 'Unknown',
        messageCount: stats.messageCount,
        triggerCount: stats.triggerCount,
        role: null, // TODO: Get from player_roles table when implemented
        lastActive: stats.lastActive,
      }
    })

    res.json({ players })
  } catch (error) {
    logger.error('Failed to get player analytics', {
      event: 'players_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to get players',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * GET /api/groups/:groupId/analytics/patterns
 * Returns common trigger patterns that don't have rules yet
 *
 * Response: {
 *   patterns: Array<{
 *     phrase: string
 *     count: number
 *     hasRule: boolean
 *     examples: string[]
 *   }>
 * }
 */
analyticsRouter.get('/:groupId/analytics/patterns', async (req: Request, res: Response) => {
  try {
    const groupId = req.params.groupId as string
    const limit = parseInt(req.query.limit as string) || 10
    const days = parseInt(req.query.days as string) || 30

    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // Get trigger messages
    const { data: messages, error } = await supabase
      .from('messages')
      .select('content')
      .eq('group_jid', groupId)
      .eq('is_trigger', true)
      .gte('created_at', startDate.toISOString())
      .limit(1000) // Limit for performance

    if (error) throw error

    // Extract common patterns (simple implementation - can be enhanced with NLP)
    const patternMap = new Map<string, { count: number; examples: string[] }>()

    messages?.forEach((msg: any) => {
      const content = msg.content.toLowerCase().trim()

      // Extract first few words as pattern (simple heuristic)
      const words = content.split(/\s+/).slice(0, 3).join(' ')
      if (words.length < 3) return // Skip very short patterns

      const existing = patternMap.get(words) || { count: 0, examples: [] }
      existing.count++
      if (existing.examples.length < 3) {
        existing.examples.push(msg.content)
      }
      patternMap.set(words, existing)
    })

    // Sort by count and take top patterns
    const patterns = Array.from(patternMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([phrase, data]) => ({
        phrase,
        count: data.count,
        hasRule: false, // TODO: Check against rules table when implemented
        examples: data.examples,
      }))

    res.json({ patterns })
  } catch (error) {
    logger.error('Failed to get pattern analytics', {
      event: 'patterns_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to get patterns',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * GET /api/groups/:groupId/learning
 * Returns learning mode progress for a group
 *
 * Response: {
 *   mode: string
 *   messagesCollected: number
 *   uniquePlayers: number
 *   triggersCaptured: number
 *   patternsDiscovered: number
 *   learningStartedAt: string
 *   daysInLearning: number
 * }
 */
analyticsRouter.get('/:groupId/learning', async (req: Request, res: Response) => {
  try {
    const groupId = req.params.groupId as string

    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    // Get group info
    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('name, first_seen_at, message_count')
      .eq('jid', groupId)
      .single()

    if (groupError) throw groupError
    if (!group) {
      return res.status(404).json({ error: 'Group not found' })
    }

    // Get unique players count (limit to recent messages for performance)
    const { data: uniquePlayers, error: playersError } = await supabase
      .from('messages')
      .select('sender_jid')
      .eq('group_jid', groupId)
      .eq('is_from_bot', false)
      .limit(MAX_PLAYERS_MESSAGES)

    if (playersError) throw playersError

    const uniquePlayerCount = new Set(uniquePlayers?.map((p: any) => p.sender_jid)).size

    // Get trigger count
    const { count: triggerCount, error: triggerError } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('group_jid', groupId)
      .eq('is_trigger', true)

    if (triggerError) throw triggerError

    // Get pattern count (unique trigger phrases)
    const { data: triggers, error: triggersError } = await supabase
      .from('messages')
      .select('content')
      .eq('group_jid', groupId)
      .eq('is_trigger', true)

    if (triggersError) throw triggersError

    const uniquePatterns = new Set(triggers?.map((t: any) => t.content.toLowerCase().trim())).size

    const learningStartedAt = new Date(group.first_seen_at)
    const daysInLearning = Math.floor((Date.now() - learningStartedAt.getTime()) / (1000 * 60 * 60 * 24))

    res.json({
      mode: 'learning', // TODO: Get actual mode from group_configs when available
      messagesCollected: group.message_count,
      uniquePlayers: uniquePlayerCount,
      triggersCaptured: triggerCount || 0,
      patternsDiscovered: uniquePatterns,
      learningStartedAt: group.first_seen_at,
      daysInLearning,
    })
  } catch (error) {
    logger.error('Failed to get learning progress', {
      event: 'learning_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to get learning progress',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
