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

    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    // Read from Silver layer — pre-aggregated heatmap data
    let query = supabase
      .from('silver_group_activity')
      .select('group_jid, hour_of_day, day_of_week, message_count, trigger_count, top_trigger')

    // If groupId is 'all', don't filter by group - aggregate all groups
    if (groupId !== 'all') {
      query = query.eq('group_jid', groupId)
    }

    const { data: rows, error: queryError } = await query

    if (queryError) {
      // Fall back to old approach if silver table doesn't exist yet
      if (queryError.code === 'PGRST205' || queryError.code === '42P01') {
        return res.json({ heatmap: [], range: { start: new Date().toISOString(), end: new Date().toISOString() }, notice: 'Silver layer not yet initialized' })
      }
      throw queryError
    }

    // If groupId is 'all', aggregate across groups
    const heatmapMap = new Map<string, { count: number; topTrigger: string | null }>()

    rows?.forEach((row: any) => {
      const key = `${row.hour_of_day}-${row.day_of_week}`
      const existing = heatmapMap.get(key) || { count: 0, topTrigger: null }
      existing.count += row.message_count || 0
      if (!existing.topTrigger && row.top_trigger) {
        existing.topTrigger = row.top_trigger
      }
      heatmapMap.set(key, existing)
    })

    const heatmap = Array.from(heatmapMap.entries()).map(([key, data]) => {
      const [hour, dayOfWeek] = key.split('-').map(Number)
      return {
        hour,
        dayOfWeek,
        count: data.count,
        topTrigger: data.topTrigger,
      }
    })

    // Derive range from current time (silver is pre-aggregated over last 30 days)
    const rangeEnd = new Date().toISOString()
    const rangeStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    res.json({
      heatmap,
      range: { start: rangeStart, end: rangeEnd },
    })
  } catch (error) {
    logger.error('Failed to get heatmap analytics', {
      event: 'heatmap_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({ error: 'Failed to get heatmap' })
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
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100)

    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    // Read from Silver layer — pre-aggregated player stats
    const { data: stats, error } = await supabase
      .from('silver_player_stats')
      .select('sender_jid, message_count, trigger_count, last_active, first_seen')
      .eq('group_jid', groupId)
      .order('message_count', { ascending: false })
      .limit(limit)

    if (error) {
      // Fall back gracefully if silver table doesn't exist yet
      if (error.code === 'PGRST205' || error.code === '42P01') {
        return res.json({ players: [], notice: 'Silver layer not yet initialized' })
      }
      throw error
    }

    if (!stats || stats.length === 0) {
      return res.json({ players: [] })
    }

    // Get contact info for the players
    const playerJids = stats.map((s: any) => s.sender_jid)

    const { data: contacts, error: contactsError } = await supabase
      .from('contacts')
      .select('jid, phone, push_name')
      .in('jid', playerJids)

    if (contactsError) throw contactsError

    const contactMap = new Map<string, { phone: string; pushName: string }>()
    contacts?.forEach((c: any) => {
      contactMap.set(c.jid, { phone: c.phone || c.jid, pushName: c.push_name || 'Unknown' })
    })

    const players = stats.map((s: any) => {
      const contact = contactMap.get(s.sender_jid)
      return {
        jid: s.sender_jid,
        phone: contact?.phone || s.sender_jid,
        pushName: contact?.pushName || 'Unknown',
        messageCount: s.message_count,
        triggerCount: s.trigger_count,
        role: null,
        lastActive: s.last_active,
      }
    })

    res.json({ players })
  } catch (error) {
    logger.error('Failed to get player analytics', {
      event: 'players_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({ error: 'Failed to get players' })
  }
})

/**
 * GET /api/groups/:groupId/analytics/patterns
 * Returns trigger patterns with rule status from the unified rules table.
 *
 * Response: {
 *   patterns: Array<{
 *     trigger: string
 *     count: number
 *     hasRule: boolean
 *     isEnabled: boolean
 *     ruleId: string | null
 *     isSystem: boolean
 *     scope: 'group' | 'global' | 'control_only'
 *   }>
 * }
 */
/**
 * Validate groupId format for safe use in queries.
 * Valid formats: 'all', 'number@g.us'
 */
function isValidGroupId(id: string): boolean {
  if (id === 'all') return true
  return /^\d+@g\.us$/.test(id)
}

analyticsRouter.get('/:groupId/analytics/patterns', async (req: Request, res: Response) => {
  try {
    const groupId = req.params.groupId as string
    const limit = parseInt(req.query.limit as string) || 20
    const days = Math.min(parseInt(req.query.days as string) || 30, MAX_DAYS_LOOKBACK)

    // Validate groupId to prevent injection in .or() filter
    if (!isValidGroupId(groupId)) {
      return res.status(400).json({
        error: 'Invalid groupId format',
        message: 'groupId must be "all" or a valid WhatsApp group JID',
      })
    }

    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // Step 1: Fetch all rules for this group AND global rules (group_jid='*')
    // groupId is validated above to prevent injection
    const { data: rules, error: rulesError } = await supabase
      .from('rules')
      .select('id, trigger_phrase, is_active, group_jid, metadata')
      .or(`group_jid.eq.${groupId},group_jid.eq.*`)
      .order('priority', { ascending: false })

    if (rulesError) throw rulesError

    // Build lookup map by trigger phrase (lowercase for matching)
    // Note: scope and is_system columns may not exist yet, so we infer from group_jid and metadata
    const ruleMap = new Map<string, {
      id: string
      isActive: boolean
      scope: string
      isSystem: boolean
    }>()

    rules?.forEach((r: any) => {
      const key = r.trigger_phrase.toLowerCase()
      // Infer system status: global patterns (group_jid='*') with source='triggers.ts' are system patterns
      const isGlobal = r.group_jid === '*'
      const isSystem = isGlobal && (r.metadata?.source === 'triggers.ts')
      const scope = isGlobal ? 'global' : 'group'

      // Don't overwrite group-specific rules with global ones
      if (!ruleMap.has(key) || r.group_jid !== '*') {
        ruleMap.set(key, {
          id: r.id,
          isActive: r.is_active,
          scope,
          isSystem,
        })
      }
    })

    // Step 2: Get trigger messages to discover patterns
    let messagesQuery = supabase
      .from('messages')
      .select('content')
      .eq('is_trigger', true)
      .gte('created_at', startDate.toISOString())
      .limit(1000)

    // Filter by group unless requesting all groups
    if (groupId !== 'all') {
      messagesQuery = messagesQuery.eq('group_jid', groupId)
    }

    const { data: messages, error: messagesError } = await messagesQuery

    if (messagesError) throw messagesError

    // Step 3: Extract patterns from messages and cross-reference with rules
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

    // Step 4: Build response with discovered patterns
    const discoveredPatterns = Array.from(patternMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([phrase, data]) => {
        const matchingRule = ruleMap.get(phrase.toLowerCase())
        return {
          trigger: phrase,
          count: data.count,
          hasRule: !!matchingRule,
          isEnabled: matchingRule?.isActive ?? false,
          ruleId: matchingRule?.id ?? null,
          isSystem: matchingRule?.isSystem ?? false,
          scope: matchingRule?.scope as 'group' | 'global' | 'control_only' | undefined,
        }
      })

    // Step 5: Add system/global patterns that weren't discovered in messages
    // Infer system patterns from group_jid='*' and metadata.source='triggers.ts'
    const systemPatterns = rules?.filter((r: any) =>
      r.group_jid === '*' && r.metadata?.source === 'triggers.ts'
    ) || []
    const existingTriggers = new Set(discoveredPatterns.map(p => p.trigger.toLowerCase()))

    for (const rule of systemPatterns) {
      const triggerLower = rule.trigger_phrase.toLowerCase()
      if (!existingTriggers.has(triggerLower)) {
        discoveredPatterns.unshift({
          trigger: rule.trigger_phrase,
          count: 0, // Not detected in messages
          hasRule: true,
          isEnabled: rule.is_active,
          ruleId: rule.id,
          isSystem: true,
          scope: 'global', // System patterns are always global
        })
      }
    }

    res.json({ patterns: discoveredPatterns })
  } catch (error) {
    logger.error('Failed to get pattern analytics', {
      event: 'patterns_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({ error: 'Failed to get patterns' })
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

    // Get pattern count (unique trigger phrases, capped for performance)
    const { data: triggers, error: triggersError } = await supabase
      .from('messages')
      .select('content')
      .eq('group_jid', groupId)
      .eq('is_trigger', true)
      .limit(5000)

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
    res.status(500).json({ error: 'Failed to get learning progress' })
  }
})
