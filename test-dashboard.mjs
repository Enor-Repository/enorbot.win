#!/usr/bin/env node
/**
 * Standalone dashboard server with REAL data from Supabase
 *
 * SECURITY WARNING: Never commit .env file with credentials!
 * Ensure SUPABASE_URL and SUPABASE_KEY are in .env and .gitignore
 */
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import rateLimit from 'express-rate-limit'

// Load environment variables
dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const port = 3003

// Initialize Supabase (credentials loaded from .env - DO NOT commit .env!)
const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ ERROR: SUPABASE_URL and SUPABASE_KEY must be set in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Security: CORS restricted to allowed origins
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3002,http://localhost:3003,http://localhost:5173').split(',')
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true
}))

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: { error: 'Too many requests, please try again later' }
})

const modeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 mode changes per minute
  message: { error: 'Too many mode changes, please slow down' }
})

// Middleware
app.use(express.json())
app.use('/api/', apiLimiter)

// Validation helpers
const isValidGroupJid = (jid) => {
  // WhatsApp group JID format: digits@g.us
  return typeof jid === 'string' && /^\d+@g\.us$/.test(jid)
}

// Mock status endpoint
app.get('/api/status', (_req, res) => {
  res.json({
    connection: 'connected',
    operational: 'running',
    globalPause: false,
    uptime: Math.floor(process.uptime() * 1000),
    messagesSentToday: 42,
    aiCallsToday: 15,
    estimatedCostToday: 1.23,
    lastActivityAt: new Date().toISOString(),
    pauseInfo: {
      reason: null,
      pausedAt: null,
    },
    groupModes: {
      learning: 3,
      assisted: 2,
      active: 1,
      paused: 0,
    },
  })
})

app.get('/api/groups', async (_req, res) => {
  try {
    // Fetch groups and their configs
    const { data: groups, error: groupsError } = await supabase
      .from('groups')
      .select('*')
      .order('name', { ascending: true })

    if (groupsError) {
      console.error('Groups error:', groupsError)
      return res.status(500).json({ error: groupsError.message })
    }

    const { data: configs, error: configError } = await supabase
      .from('group_config')
      .select('*')

    if (configError) {
      console.error('Config error:', configError)
      return res.status(500).json({ error: configError.message })
    }

    // Get rule counts per group
    const { data: rules, error: rulesError } = await supabase
      .from('rules')
      .select('group_jid, is_active')

    if (rulesError) {
      console.error('Rules error:', rulesError)
    }

    // Build config and rules maps for quick lookup
    const configMap = new Map()
    configs?.forEach((config) => {
      configMap.set(config.group_jid, config)
    })

    const rulesMap = new Map()
    rules?.forEach((rule) => {
      if (rule.is_active) {
        rulesMap.set(rule.group_jid, (rulesMap.get(rule.group_jid) || 0) + 1)
      }
    })

    // Combine groups with their config
    const groupsWithConfig = groups?.map((group) => {
      const config = configMap.get(group.jid)

      // Warn if group has no config (indicates setup issue)
      if (!config) {
        console.warn(`⚠️  Group ${group.jid} (${group.name}) has no config entry - defaulting to learning mode`)
      }

      const learningStarted = config?.learning_started_at ? new Date(config.learning_started_at) : null
      const learningDays = learningStarted
        ? Math.floor((Date.now() - learningStarted.getTime()) / (1000 * 60 * 60 * 24))
        : 0

      return {
        id: group.id,
        jid: group.jid,
        name: group.name,
        mode: config?.mode || 'learning',
        isControlGroup: group.is_control_group,
        learningDays,
        messagesCollected: group.message_count || 0,
        rulesActive: rulesMap.get(group.jid) || 0,
        lastActivity: group.last_activity_at,
      }
    }) || []

    res.json({ groups: groupsWithConfig })
  } catch (err) {
    console.error('Groups fetch error:', err)
    res.status(500).json({ error: err.message })
  }
})

// Update group mode (with rate limiting and validation)
app.put('/api/groups/:groupJid/mode', modeLimiter, async (req, res) => {
  try {
    const { groupJid } = req.params
    const { mode } = req.body

    // Validate JID format (prevent SQL injection)
    if (!isValidGroupJid(groupJid)) {
      return res.status(400).json({ error: 'Invalid group JID format' })
    }

    // Validate mode value
    if (!['learning', 'active', 'paused'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Must be: learning, active, or paused' })
    }

    const { error } = await supabase
      .from('group_config')
      .update({
        mode,
        updated_at: new Date().toISOString(),
      })
      .eq('group_jid', groupJid)

    if (error) {
      console.error('Mode update error:', error)
      return res.status(500).json({ error: error.message })
    }

    res.json({ success: true, mode })
  } catch (err) {
    console.error('Mode update error:', err)
    res.status(500).json({ error: err.message })
  }
})

// Get players for a specific group with their roles
app.get('/api/groups/:groupJid/players', async (req, res) => {
  try {
    const { groupJid } = req.params

    // Validate JID format
    if (!isValidGroupJid(groupJid)) {
      return res.status(400).json({ error: 'Invalid group JID format' })
    }

    // Get group config to access player_roles
    const { data: config, error: configError } = await supabase
      .from('group_config')
      .select('player_roles')
      .eq('group_jid', groupJid)
      .single()

    if (configError) {
      console.error('Config error:', configError)
      return res.status(500).json({ error: configError.message })
    }

    const playerRoles = config?.player_roles || {}

    // Get unique senders from messages in this group
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('sender_jid')
      .eq('group_jid', groupJid)

    if (messagesError) {
      console.error('Messages error:', messagesError)
      return res.status(500).json({ error: messagesError.message })
    }

    // Get unique player JIDs
    const uniquePlayerJids = [...new Set(messages?.map(m => m.sender_jid) || [])]

    // Get contact info for these players
    const { data: contacts, error: contactsError } = await supabase
      .from('contacts')
      .select('jid, push_name, phone, message_count')
      .in('jid', uniquePlayerJids)

    if (contactsError) {
      console.error('Contacts error:', contactsError)
    }

    // Build contact map
    const contactMap = new Map()
    contacts?.forEach(contact => {
      contactMap.set(contact.jid, contact)
    })

    // Count messages per player in this group
    const messageCounts = new Map()
    messages?.forEach(msg => {
      messageCounts.set(msg.sender_jid, (messageCounts.get(msg.sender_jid) || 0) + 1)
    })

    // Build player list with roles
    const players = uniquePlayerJids.map(jid => {
      const contact = contactMap.get(jid)
      return {
        jid,
        name: contact?.push_name || contact?.phone || jid.split('@')[0],
        messageCount: messageCounts.get(jid) || 0,
        role: playerRoles[jid] || null, // 'eNor', 'non-eNor', or null
      }
    })
    .sort((a, b) => b.messageCount - a.messageCount) // Sort by activity

    res.json({ players })
  } catch (err) {
    console.error('Players error:', err)
    res.status(500).json({ error: err.message })
  }
})

// Update player role in a group
app.put('/api/groups/:groupJid/players/:playerJid/role', modeLimiter, async (req, res) => {
  try {
    const { groupJid, playerJid } = req.params
    const { role } = req.body

    // Validate JID formats
    if (!isValidGroupJid(groupJid)) {
      return res.status(400).json({ error: 'Invalid group JID format' })
    }

    // Validate role value (allow null to unset)
    if (role !== null && !['eNor', 'non-eNor'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be: eNor, non-eNor, or null' })
    }

    // Get current player_roles
    const { data: config, error: fetchError } = await supabase
      .from('group_config')
      .select('player_roles')
      .eq('group_jid', groupJid)
      .single()

    if (fetchError) {
      console.error('Fetch error:', fetchError)
      return res.status(500).json({ error: fetchError.message })
    }

    const playerRoles = config?.player_roles || {}

    // Update role
    if (role === null) {
      delete playerRoles[playerJid]
    } else {
      playerRoles[playerJid] = role
    }

    // Save back to database
    const { error: updateError } = await supabase
      .from('group_config')
      .update({
        player_roles: playerRoles,
        updated_at: new Date().toISOString(),
      })
      .eq('group_jid', groupJid)

    if (updateError) {
      console.error('Update error:', updateError)
      return res.status(500).json({ error: updateError.message })
    }

    res.json({ success: true, role })
  } catch (err) {
    console.error('Role update error:', err)
    res.status(500).json({ error: err.message })
  }
})

// [OLD ANALYTICS ENDPOINTS REMOVED - Using corrected versions below at line ~800]
// The old endpoints were missing peakHour/peakDay calculations and had incorrect data formats

// Rules API endpoints
app.get('/api/rules', async (req, res) => {
  try {
    const groupJid = req.query.groupJid

    let query = supabase
      .from('rules')
      .select('*')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })

    if (groupJid) {
      query = query.eq('group_jid', groupJid)
    }

    const { data: rules, error } = await query

    if (error) {
      console.error('Rules fetch error:', error)
      return res.status(500).json({ error: error.message })
    }

    res.json({ rules: rules || [] })
  } catch (err) {
    console.error('Rules error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/rules', async (req, res) => {
  try {
    const {
      groupJid,
      triggerPhrase,
      responseTemplate = '', // Backward compatibility
      action_type = 'text_response',
      action_params = {},
      isActive = true,
      priority = 0,
      conditions = {},
      scope = 'all_groups',
    } = req.body

    if (!groupJid || !triggerPhrase) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['groupJid', 'triggerPhrase'],
      })
    }

    // Validate action type
    const validActionTypes = ['text_response', 'usdt_quote', 'commercial_dollar_quote', 'ai_prompt', 'custom']
    if (!validActionTypes.includes(action_type)) {
      return res.status(400).json({
        error: 'Invalid action_type',
        validTypes: validActionTypes,
      })
    }

    const { data: rule, error } = await supabase
      .from('rules')
      .insert({
        group_jid: groupJid,
        trigger_phrase: triggerPhrase.toLowerCase().trim(),
        response_template: responseTemplate || (action_type === 'text_response' ? action_params.template : ''),
        action_type,
        action_params,
        is_active: isActive,
        priority,
        conditions,
        created_by: 'dashboard',
        metadata: { scope },
      })
      .select()
      .single()

    if (error) {
      console.error('Rule create error:', error)
      return res.status(500).json({ error: error.message })
    }

    res.status(201).json({ rule })
  } catch (err) {
    console.error('Rules error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/rules/:id', async (req, res) => {
  try {
    const { id } = req.params
    const updates = {}

    // Map frontend fields to database fields
    if (req.body.triggerPhrase) {
      updates.trigger_phrase = req.body.triggerPhrase.toLowerCase().trim()
    }
    if (req.body.responseTemplate !== undefined) {
      updates.response_template = req.body.responseTemplate
    }
    if (req.body.response_template !== undefined) {
      updates.response_template = req.body.response_template
    }
    if (req.body.isActive !== undefined) {
      updates.is_active = req.body.isActive
    }
    if (req.body.is_active !== undefined) {
      updates.is_active = req.body.is_active
    }
    if (req.body.priority !== undefined) {
      updates.priority = req.body.priority
    }
    if (req.body.action_type !== undefined) {
      updates.action_type = req.body.action_type
    }
    if (req.body.action_params !== undefined) {
      updates.action_params = req.body.action_params
    }

    // Handle scope in metadata
    if (req.body.scope !== undefined) {
      // Get current rule to merge metadata
      const { data: currentRule } = await supabase
        .from('rules')
        .select('metadata')
        .eq('id', id)
        .single()

      updates.metadata = {
        ...(currentRule?.metadata || {}),
        scope: req.body.scope
      }
    }

    updates.updated_at = new Date().toISOString()

    const { data: rule, error } = await supabase
      .from('rules')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Rule update error:', error)
      return res.status(500).json({ error: error.message })
    }

    res.json({ rule })
  } catch (err) {
    console.error('Rules update error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/rules/:id', async (req, res) => {
  try {
    const { id } = req.params

    const { error } = await supabase.from('rules').delete().eq('id', id)

    if (error) {
      console.error('Rule delete error:', error)
      return res.status(500).json({ error: error.message })
    }

    res.json({ success: true })
  } catch (err) {
    console.error('Rules error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/rules/test', async (req, res) => {
  try {
    const { message, groupJid } = req.body

    if (!message || !groupJid) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['message', 'groupJid'],
      })
    }

    const { data: rules, error } = await supabase
      .from('rules')
      .select('*')
      .eq('group_jid', groupJid)
      .eq('is_active', true)
      .order('priority', { ascending: false })

    if (error) {
      console.error('Rule test error:', error)
      return res.status(500).json({ error: error.message })
    }

    const messageLower = message.toLowerCase()
    const matchedRule = rules?.find((rule) =>
      messageLower.includes(rule.trigger_phrase.toLowerCase())
    )

    res.json({
      matched: !!matchedRule,
      rule: matchedRule || null,
      allRules: rules || [],
    })
  } catch (err) {
    console.error('Rules error:', err)
    res.status(500).json({ error: err.message })
  }
})

// =============================================================================
// Analytics API Endpoints (Story D.1)
// =============================================================================

// GET /api/groups/:id/analytics/heatmap
// Returns activity by hour (0-23) and day (0-6)
app.get('/api/groups/:groupId/analytics/heatmap', async (req, res) => {
  try {
    const { groupId } = req.params

    // Query messages for this group
    const query = supabase
      .from('messages')
      .select('created_at, content, is_trigger')
      .order('created_at', { ascending: false })
      .limit(10000) // Last 10k messages

    // Filter by group if not 'all'
    if (groupId !== 'all') {
      query.eq('group_jid', groupId)
    }

    const { data: messages, error } = await query

    if (error) {
      console.error('Heatmap query error:', error)
      return res.status(500).json({ error: error.message })
    }

    // Build temporary 7x24 matrix for aggregation
    const matrix = Array(7).fill(null).map(() =>
      Array(24).fill(null).map(() => ({
        count: 0,
        triggerCount: 0,
        triggers: {}
      }))
    )

    messages?.forEach((msg) => {
      const date = new Date(msg.created_at)
      const day = date.getDay() // 0-6 (Sunday-Saturday)
      const hour = date.getHours() // 0-23

      matrix[day][hour].count++

      if (msg.is_trigger) {
        matrix[day][hour].triggerCount++
      }

      // Track trigger phrases for this cell
      if (msg.content) {
        const trigger = msg.content.toLowerCase().substring(0, 50)
        matrix[day][hour].triggers[trigger] = (matrix[day][hour].triggers[trigger] || 0) + 1
      }
    })

    // Flatten matrix to array of cell objects with top trigger
    const heatmap = []
    let maxCount = 0
    const hourTotals = Array(24).fill(0)
    const dayTotals = Array(7).fill(0)

    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const cell = matrix[day][hour]
        const count = cell.count
        const triggerCount = cell.triggerCount

        // Find top trigger for this cell
        const entries = Object.entries(cell.triggers)
        let topTrigger = null
        if (entries.length > 0) {
          const [trigger] = entries.sort((a, b) => b[1] - a[1])
          topTrigger = trigger[0]
        }

        heatmap.push({
          dayOfWeek: day,
          hour,
          count,
          triggerCount,
          topTrigger
        })

        // Track totals for peak calculation
        hourTotals[hour] += count
        dayTotals[day] += count
        if (count > maxCount) maxCount = count
      }
    }

    // Calculate peak hour and peak day
    const peakHour = hourTotals.indexOf(Math.max(...hourTotals))
    const peakDay = dayTotals.indexOf(Math.max(...dayTotals))

    res.json({
      heatmap,
      peakHour,
      peakDay,
      totalMessages: messages?.length || 0
    })
  } catch (err) {
    console.error('Heatmap error:', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/groups/:id/analytics/players
// Returns top 20 active players with message counts
app.get('/api/groups/:groupId/analytics/players', async (req, res) => {
  try {
    const { groupId } = req.params

    // Query messages grouped by sender
    const query = supabase
      .from('messages')
      .select('sender_jid, sender_name, created_at, is_trigger')

    if (groupId !== 'all') {
      query.eq('group_jid', groupId)
    }

    const { data: messages, error } = await query

    if (error) {
      console.error('Players query error:', error)
      return res.status(500).json({ error: error.message })
    }

    // Aggregate by player
    const playerStats = {}
    messages?.forEach((msg) => {
      const jid = msg.sender_jid
      if (!playerStats[jid]) {
        playerStats[jid] = {
          jid,
          name: msg.sender_name || jid.split('@')[0],
          messageCount: 0,
          triggerCount: 0,
          lastActive: msg.created_at,
          role: null // Will be populated from group_config
        }
      }

      playerStats[jid].messageCount++
      if (msg.is_trigger) playerStats[jid].triggerCount++

      // Track most recent activity
      if (new Date(msg.created_at) > new Date(playerStats[jid].lastActive)) {
        playerStats[jid].lastActive = msg.created_at
      }
    })

    // Get player roles from group_config if available
    if (groupId !== 'all') {
      const { data: groupConfig } = await supabase
        .from('group_config')
        .select('player_roles')
        .eq('group_jid', groupId)
        .single()

      if (groupConfig?.player_roles) {
        Object.entries(groupConfig.player_roles).forEach(([jid, role]) => {
          if (playerStats[jid]) {
            playerStats[jid].role = role
          }
        })
      }
    }

    // Sort by message count and take top 20
    const topPlayers = Object.values(playerStats)
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, 20)

    res.json({ players: topPlayers })
  } catch (err) {
    console.error('Players error:', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/groups/:id/analytics/patterns
// Returns discovered trigger patterns (already exists, but adding alias for consistency)
app.get('/api/groups/:groupId/analytics/patterns', async (req, res) => {
  // Reuse existing patterns endpoint logic
  try {
    const { groupId } = req.params

    // Build query - if groupId is 'all', query all groups
    let query = supabase
      .from('messages')
      .select('content, is_trigger, group_jid')
      .eq('is_trigger', true)
      .order('created_at', { ascending: false })
      .limit(5000)

    // Filter by specific group if not 'all'
    if (groupId !== 'all') {
      query = query.eq('group_jid', groupId)
    }

    const { data: messages, error: messagesError } = await query

    if (messagesError) {
      console.error('Supabase error:', messagesError)
      return res.status(500).json({ error: messagesError.message })
    }

    // Count trigger occurrences
    const triggerCounts = new Map()

    messages?.forEach((msg) => {
      if (!msg.content) return
      const trigger = msg.content.toLowerCase().trim()
      triggerCounts.set(trigger, (triggerCounts.get(trigger) || 0) + 1)
    })

    // Get top 10 patterns
    const topPatterns = Array.from(triggerCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)

    // Fetch rules for these triggers to check if they have rules and if they're active
    const { data: rules, error: rulesError } = await supabase
      .from('rules')
      .select('id, trigger_phrase, is_active')
      .in('trigger_phrase', topPatterns.map(([trigger]) => trigger))

    if (rulesError) {
      console.error('Rules fetch error:', rulesError)
    }

    // Build a map of trigger -> rule info
    const ruleMap = new Map()
    rules?.forEach((rule) => {
      ruleMap.set(rule.trigger_phrase, {
        ruleId: rule.id,
        isEnabled: rule.is_active,
      })
    })

    // Hardcoded triggers from bot code
    const PRICE_TRIGGERS = ['preço', 'cotação']
    const CONTROL_COMMANDS = [
      'pause', 'resume', 'status', 'training on', 'training off',
      'mode', 'modes', 'config', 'trigger', 'role'
    ]

    // Add hardcoded patterns that may not be in top discovered patterns
    const hardcodedPatterns = new Map()

    // Add price triggers
    PRICE_TRIGGERS.forEach(trigger => {
      const existing = topPatterns.find(([t]) => t === trigger)
      if (!existing) {
        hardcodedPatterns.set(trigger, { count: 0, scope: 'all_groups' })
      }
    })

    // Add control commands
    CONTROL_COMMANDS.forEach(trigger => {
      const existing = topPatterns.find(([t]) => t === trigger)
      if (!existing) {
        hardcodedPatterns.set(trigger, { count: 0, scope: 'control_group_only' })
      }
    })

    // Merge discovered patterns with hardcoded patterns
    const allPatterns = [
      ...topPatterns.map(([trigger, count]) => ({ trigger, count, discovered: true })),
      ...Array.from(hardcodedPatterns.entries()).map(([trigger, info]) => ({
        trigger,
        count: info.count,
        discovered: false,
        scope: info.scope
      }))
    ]

    // Build final pattern list
    const patterns = allPatterns.map(({ trigger, count, discovered, scope }) => {
      const ruleInfo = ruleMap.get(trigger)
      const isPriceTrigger = PRICE_TRIGGERS.includes(trigger)
      const isControlCommand = CONTROL_COMMANDS.includes(trigger)
      const isHardcoded = isPriceTrigger || isControlCommand

      return {
        trigger,
        count,
        hasRule: !!ruleInfo || isHardcoded,
        isEnabled: isHardcoded || (ruleInfo?.isEnabled || false),
        ruleId: ruleInfo?.ruleId || (isHardcoded ? 'hardcoded' : null),
        scope: scope || (isControlCommand ? 'control_group_only' : 'all_groups'),
      }
    }).sort((a, b) => {
      // Sort: hardcoded enabled first, then by count
      if (a.isEnabled && !b.isEnabled) return -1
      if (!a.isEnabled && b.isEnabled) return 1
      return b.count - a.count
    })

    res.json({ patterns })
  } catch (err) {
    console.error('Patterns error:', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/groups/:id/analytics/learning
// Returns learning mode progress for a group
app.get('/api/groups/:groupId/analytics/learning', async (req, res) => {
  try {
    const { groupId } = req.params

    // Get group config
    const { data: groupConfig, error: configError } = await supabase
      .from('group_config')
      .select('mode, learning_started_at, created_at')
      .eq('group_jid', groupId)
      .single()

    if (configError) {
      console.error('Group config error:', configError)
      return res.status(404).json({ error: 'Group not found' })
    }

    const mode = groupConfig.mode || 'learning'
    const startedAt = groupConfig.learning_started_at || groupConfig.created_at
    const daysInMode = startedAt
      ? Math.floor((Date.now() - new Date(startedAt).getTime()) / (1000 * 60 * 60 * 24))
      : 0

    // Count messages collected
    const { count: messagesCollected } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('group_jid', groupId)

    // Count unique triggers
    const { data: triggerMessages } = await supabase
      .from('messages')
      .select('content')
      .eq('group_jid', groupId)
      .eq('is_trigger', true)

    const uniqueTriggers = new Set(
      triggerMessages?.map(m => m.content.toLowerCase().trim()).filter(Boolean)
    ).size

    // Count patterns with rules
    const { data: rules } = await supabase
      .from('rules')
      .select('trigger_phrase')
      .or(`group_jid.eq.${groupId},group_jid.is.null`)
      .eq('is_active', true)

    const patternsCovered = rules?.length || 0

    res.json({
      mode,
      startedAt,
      daysInMode,
      messagesCollected: messagesCollected || 0,
      uniqueTriggers,
      patternsCovered,
      progressPercentage: uniqueTriggers > 0 ? Math.min((patternsCovered / uniqueTriggers) * 100, 100) : 0
    })
  } catch (err) {
    console.error('Learning endpoint error:', err)
    res.status(500).json({ error: err.message })
  }
})

// =============================================================================
// Commercial Dollar API with Server-Side Caching (Protect 10k quota)
// =============================================================================

// Cache config: 5-minute TTL to minimize API calls
// 10k requests/month → ~333/day → 12/hour max → 5min cache is safe
const commercialDollarCache = {
  data: null,
  lastFetched: null,
  ttlMs: 5 * 60 * 1000, // 5 minutes
}

async function fetchCommercialDollarWithCache() {
  const now = Date.now()

  // Return cached data if still valid
  if (commercialDollarCache.data && commercialDollarCache.lastFetched) {
    const age = now - commercialDollarCache.lastFetched
    if (age < commercialDollarCache.ttlMs) {
      return {
        ...commercialDollarCache.data,
        cached: true,
        cacheAge: Math.floor(age / 1000),
      }
    }
  }

  // Fetch fresh data from AwesomeAPI
  const token = process.env.AWESOMEAPI_TOKEN
  if (!token) {
    throw new Error('AWESOMEAPI_TOKEN not configured')
  }

  const response = await fetch(
    `https://economia.awesomeapi.com.br/json/last/USD-BRL?token=${token}`,
    { timeout: 5000 }
  )

  if (!response.ok) {
    throw new Error(`AwesomeAPI returned ${response.status}`)
  }

  const data = await response.json()

  if (!data.USDBRL || !data.USDBRL.bid || !data.USDBRL.ask) {
    throw new Error('Invalid response from AwesomeAPI')
  }

  const result = {
    bid: parseFloat(data.USDBRL.bid),
    ask: parseFloat(data.USDBRL.ask),
    spread: parseFloat(data.USDBRL.ask) - parseFloat(data.USDBRL.bid),
    timestamp: data.USDBRL.create_date,
    source: 'awesomeapi',
  }

  // Update cache
  commercialDollarCache.data = result
  commercialDollarCache.lastFetched = now

  console.log(`💲 Commercial dollar fetched: R$${result.bid.toFixed(4)} / R$${result.ask.toFixed(4)}`)

  return { ...result, cached: false, cacheAge: 0 }
}

// GET /api/prices/commercial-dollar
// Returns commercial dollar exchange rate with server-side caching
app.get('/api/prices/commercial-dollar', async (_req, res) => {
  try {
    const data = await fetchCommercialDollarWithCache()
    res.json(data)
  } catch (error) {
    console.error('Commercial dollar fetch error:', error.message)
    res.status(500).json({
      error: error.message,
      cached: false,
    })
  }
})

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Serve static dashboard files
const dashboardPath = path.join(__dirname, 'dist/dashboard')
app.use(express.static(dashboardPath))

// SPA fallback
app.use((_req, res) => {
  res.sendFile(path.join(dashboardPath, 'index.html'))
})

// Initialize database tables
async function initDatabase() {
  try {
    // Check if rules table exists, if not create it
    const { error } = await supabase.from('rules').select('*').limit(0)

    if (error && error.code === 'PGRST204') {
      console.log('⚠️  Rules table not found. Creating...')
      // Table will be created via Supabase dashboard or migration
      console.log('📝 Please run: supabase/migrations/20260130_002_create_rules_table.sql')
    } else if (!error) {
      console.log('✅ Rules table exists')
    }
  } catch (err) {
    console.warn('Database init check:', err.message)
  }
}

// Start server
app.listen(port, async () => {
  console.log(`\n✅ Dashboard server running with REAL data!`)
  console.log(`📊 Dashboard: http://localhost:${port}`)
  console.log(`🗄️  Database: ${supabaseUrl}`)

  // Initialize database
  await initDatabase()

  console.log(`\nPress Ctrl+C to stop\n`)
})
