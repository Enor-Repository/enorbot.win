/**
 * Simulator API Routes
 *
 * Provides endpoints for the WhatsApp message simulator.
 * Messages are routed through the real bot pipeline (router → handlers)
 * with a mock socket that captures responses instantly.
 */
import { Router, type Request, type Response } from 'express'
import { logger } from '../../utils/logger.js'
import { getConfig } from '../../config.js'
import { routeMessage, isControlGroupMessage, type RouterContext } from '../../bot/router.js'
import { handleControlMessage } from '../../handlers/control.js'
import { handlePriceMessage } from '../../handlers/price.js'
import { handleTronscanMessage } from '../../handlers/tronscan.js'
import { getGroupConfigSync, getAllGroupConfigs, isIgnoredPlayer } from '../../services/groupConfig.js'
import { getGroupMessages } from '../../services/messageHistory.js'
import { getSupabase } from '../../services/supabase.js'
import { createMockSocket } from './simulatorSocket.js'
import { runInSimulation } from '../../utils/simulationContext.js'

export const simulatorRouter = Router()

/**
 * GET /api/simulator/groups
 * Returns all groups with their player roles for the UI picker.
 */
simulatorRouter.get('/groups', async (_req: Request, res: Response) => {
  try {
    const allConfigs = await getAllGroupConfigs()
    const config = getConfig()
    const supabase = getSupabase()!

    // Get all non-bot message senders across all groups (recent messages)
    const { data: senderRows } = await supabase
      .from('messages')
      .select('group_jid, sender_jid')
      .eq('is_from_bot', false)
      .order('created_at', { ascending: false })
      .limit(5000)

    // Deduplicate: group → set of sender JIDs
    const groupSenders = new Map<string, Set<string>>()
    for (const row of senderRows || []) {
      if (!groupSenders.has(row.group_jid)) groupSenders.set(row.group_jid, new Set())
      groupSenders.get(row.group_jid)!.add(row.sender_jid)
    }

    // Get push_name for all unique JIDs
    const allJids = [...new Set((senderRows || []).map((r: any) => r.sender_jid))]
    const contactMap = new Map<string, string>()
    if (allJids.length > 0) {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('jid, push_name')
        .in('jid', allJids)
      contacts?.forEach((c: any) => contactMap.set(c.jid, c.push_name || ''))
    }

    const groups = [...allConfigs.values()].map((gc) => {
      // Merge: senders from messages + any JIDs in playerRoles
      const senders = groupSenders.get(gc.groupJid) || new Set<string>()
      for (const jid of Object.keys(gc.playerRoles)) senders.add(jid)

      const players = [...senders].map((jid) => ({
        jid,
        name: contactMap.get(jid) || formatPhone(jid),
        role: gc.playerRoles[jid] || null,
      }))

      return {
        groupJid: gc.groupJid,
        groupName: gc.groupName,
        mode: 'active',
        isControlGroup: isControlGroupMessage(gc.groupName, config.CONTROL_GROUP_PATTERN),
        playerRoles: gc.playerRoles,
        players,
      }
    })

    res.json({ groups })
  } catch (error) {
    logger.error('Simulator groups fetch failed', {
      event: 'simulator_groups_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({ error: 'Failed to fetch groups' })
  }
})

/**
 * POST /api/simulator/send
 * Sends a simulated message through the real bot pipeline.
 *
 * Body: { groupId, senderJid, senderName, message }
 * Returns: { route, responses[], processingTimeMs }
 */
simulatorRouter.post('/send', async (req: Request, res: Response) => {
  const startTime = Date.now()

  // ── Run entire handler inside simulation context ──
  // All downstream deal/logging operations use in-memory storage only.
  await runInSimulation(async () => {
    try {
      const { groupId, senderJid, senderName, message } = req.body

      // Validate required fields
      if (!groupId || typeof groupId !== 'string') {
        res.status(400).json({ error: 'groupId is required' })
        return
      }
      if (!senderJid || typeof senderJid !== 'string') {
        res.status(400).json({ error: 'senderJid is required' })
        return
      }
      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'message is required' })
        return
      }

      // Verify group exists in config cache
      const groupConfig = getGroupConfigSync(groupId)
      if (!groupConfig) {
        res.status(404).json({ error: 'Group not found in config cache' })
        return
      }

      // Check ignored player
      if (isIgnoredPlayer(groupId, senderJid)) {
        res.json({
          route: { destination: 'IGNORED_PLAYER', dealAction: null, hasTrigger: false },
          responses: [],
          processingTimeMs: Date.now() - startTime,
        })
        return
      }

      const config = getConfig()
      const groupName = groupConfig.groupName
      const isControlGroup = isControlGroupMessage(groupName, config.CONTROL_GROUP_PATTERN)

      // Temporarily force group mode to 'active' so the router processes the
      // message through triggers and handlers regardless of the real mode.
      // This is in-memory only — no DB writes. Restored in the finally block.
      const originalMode = groupConfig.mode
      groupConfig.mode = 'active'

      // Create mock socket
      const { sock, getCapturedMessages } = createMockSocket(groupId, groupName)

      const context: RouterContext = {
        groupId,
        groupName,
        message: message.trim(),
        sender: senderJid,
        senderName: senderName || undefined,
        isControlGroup,
        sock,
      }

      let route: Awaited<ReturnType<typeof routeMessage>>
      try {
        // Route the message through the real router
        route = await routeMessage(context)

        logger.info('Simulator message routed', {
          event: 'simulator_routed',
          groupId,
          sender: senderJid,
          destination: route.destination,
          dealAction: route.context.dealAction,
          hasTrigger: route.context.hasTrigger,
        })

        // Dispatch to handler based on route destination.
        if (route.destination === 'CONTROL_HANDLER') {
          await handleControlMessage(context)
        } else if (route.destination === 'PRICE_HANDLER') {
          await handlePriceMessage(context)
        } else if (route.destination === 'TRONSCAN_HANDLER') {
          await handleTronscanMessage(context)
        } else if (route.destination === 'DEAL_HANDLER') {
          const { handleDealRouted } = await import('../../handlers/deal.js')
          await handleDealRouted(route.context)
        }
      } finally {
        groupConfig.mode = originalMode
      }

      const responses = getCapturedMessages().map((msg) => ({
        text: msg.text,
        mentions: msg.mentions,
        timestamp: msg.timestamp,
      }))

      res.json({
        route: {
          destination: route.destination,
          dealAction: route.context.dealAction || null,
          hasTrigger: route.context.hasTrigger || false,
        },
        responses,
        processingTimeMs: Date.now() - startTime,
      })
    } catch (error) {
      logger.error('Simulator send failed', {
        event: 'simulator_send_error',
        error: error instanceof Error ? error.message : String(error),
      })
      res.status(500).json({
        error: 'Simulation failed',
        message: error instanceof Error ? error.message : String(error),
        processingTimeMs: Date.now() - startTime,
      })
    }
  })
})

/**
 * GET /api/simulator/history/:groupId
 * Returns the last 50 messages for a group (newest last).
 */
simulatorRouter.get('/history/:groupId', async (req: Request, res: Response) => {
  try {
    const groupId = decodeURIComponent(req.params.groupId as string)
    const supabase = getSupabase()!

    const result = await getGroupMessages(groupId, { limit: 50, orderBy: 'desc' })
    if (!result.ok) {
      return res.status(500).json({ error: result.error })
    }

    // Collect unique sender JIDs and fetch push_name from contacts
    const uniqueJids = [...new Set(result.data.data.map((m) => m.sender_jid))]
    const contactMap = new Map<string, string>()
    if (uniqueJids.length > 0) {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('jid, push_name')
        .in('jid', uniqueJids)
      contacts?.forEach((c: any) => contactMap.set(c.jid, c.push_name || ''))
    }

    // Reverse so oldest is first (chat order)
    const messages = result.data.data.reverse().map((m) => ({
      id: m.id,
      senderJid: m.sender_jid,
      senderName: m.is_from_bot ? 'eNorBOT' : (contactMap.get(m.sender_jid) || formatPhone(m.sender_jid)),
      isFromBot: m.is_from_bot,
      messageType: m.message_type,
      content: m.content,
      timestamp: new Date(m.created_at).getTime(),
    }))

    res.json({ messages })
  } catch (error) {
    logger.error('Simulator history fetch failed', {
      event: 'simulator_history_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({ error: 'Failed to fetch history' })
  }
})

/**
 * POST /api/simulator/replay
 * Replays non-bot messages from history through the current bot pipeline.
 * Each message is fed sequentially (order matters for deal state).
 *
 * Body: { groupId, limit? }
 * Returns: { steps[], totalMessages, totalProcessingTimeMs }
 */
simulatorRouter.post('/replay', async (req: Request, res: Response) => {
  const startTime = Date.now()

  // ── Run entire replay inside simulation context ──
  // All downstream deal/logging operations use in-memory storage only.
  await runInSimulation(async () => {
    try {
      const { groupId, limit: rawLimit } = req.body

      if (!groupId || typeof groupId !== 'string') {
        res.status(400).json({ error: 'groupId is required' })
        return
      }

      const groupConfig = getGroupConfigSync(groupId)
      if (!groupConfig) {
        res.status(404).json({ error: 'Group not found in config cache' })
        return
      }

      const supabase = getSupabase()!
      const messageLimit = Math.min(Number(rawLimit) || 100, 200)

      // Fetch non-bot messages in chronological order (READ only — safe)
      const { data: rawMessages, error: dbError } = await supabase
        .from('messages')
        .select('id, sender_jid, content, created_at')
        .eq('group_jid', groupId)
        .eq('is_from_bot', false)
        .order('created_at', { ascending: true })
        .limit(messageLimit)

      if (dbError) {
        res.status(500).json({ error: `DB error: ${dbError.message}` })
        return
      }

      if (!rawMessages || rawMessages.length === 0) {
        res.json({ steps: [], totalMessages: 0, totalProcessingTimeMs: 0 })
        return
      }

      // Get contact names (READ only — safe)
      const uniqueJids = [...new Set(rawMessages.map((m: any) => m.sender_jid))]
      const contactMap = new Map<string, string>()
      if (uniqueJids.length > 0) {
        const { data: contacts } = await supabase
          .from('contacts')
          .select('jid, push_name')
          .in('jid', uniqueJids)
        contacts?.forEach((c: any) => contactMap.set(c.jid, c.push_name || ''))
      }

      const config = getConfig()
      const groupName = groupConfig.groupName
      const isControlGroup = isControlGroupMessage(groupName, config.CONTROL_GROUP_PATTERN)

      // Force active mode for the entire replay
      const originalMode = groupConfig.mode
      groupConfig.mode = 'active'

      const steps: Array<{
        input: { senderJid: string; senderName: string; content: string; timestamp: number }
        route: { destination: string; dealAction: string | null; hasTrigger: boolean }
        responses: Array<{ text: string; mentions: string[]; timestamp: number }>
        processingTimeMs: number
      }> = []

      try {
        // Process each message sequentially (deal state depends on prior messages)
        for (const msg of rawMessages) {
          const msgStart = Date.now()
          const senderName = contactMap.get(msg.sender_jid) || formatPhone(msg.sender_jid)
          const content = (msg.content || '').trim()

          if (!content) continue // skip empty messages

          // Skip ignored players
          if (isIgnoredPlayer(groupId, msg.sender_jid)) {
            steps.push({
              input: { senderJid: msg.sender_jid, senderName, content, timestamp: new Date(msg.created_at).getTime() },
              route: { destination: 'IGNORED_PLAYER', dealAction: null, hasTrigger: false },
              responses: [],
              processingTimeMs: Date.now() - msgStart,
            })
            continue
          }

          const { sock, getCapturedMessages } = createMockSocket(groupId, groupName)

          const context: RouterContext = {
            groupId,
            groupName,
            message: content,
            sender: msg.sender_jid,
            senderName,
            isControlGroup,
            sock,
          }

          const route = await routeMessage(context)

          // Dispatch to handler
          if (route.destination === 'CONTROL_HANDLER') {
            await handleControlMessage(context)
          } else if (route.destination === 'PRICE_HANDLER') {
            await handlePriceMessage(context)
          } else if (route.destination === 'TRONSCAN_HANDLER') {
            await handleTronscanMessage(context)
          } else if (route.destination === 'DEAL_HANDLER') {
            const { handleDealRouted } = await import('../../handlers/deal.js')
            await handleDealRouted(route.context)
          }

          steps.push({
            input: {
              senderJid: msg.sender_jid,
              senderName,
              content,
              timestamp: new Date(msg.created_at).getTime(),
            },
            route: {
              destination: route.destination,
              dealAction: route.context.dealAction || null,
              hasTrigger: route.context.hasTrigger || false,
            },
            responses: getCapturedMessages().map((r) => ({
              text: r.text,
              mentions: r.mentions,
              timestamp: r.timestamp,
            })),
            processingTimeMs: Date.now() - msgStart,
          })
        }
      } finally {
        groupConfig.mode = originalMode
      }

      logger.info('Simulator replay completed', {
        event: 'simulator_replay',
        groupId,
        totalMessages: steps.length,
        totalProcessingTimeMs: Date.now() - startTime,
      })

      res.json({
        steps,
        totalMessages: steps.length,
        totalProcessingTimeMs: Date.now() - startTime,
      })
    } catch (error) {
      logger.error('Simulator replay failed', {
        event: 'simulator_replay_error',
        error: error instanceof Error ? error.message : String(error),
      })
      res.status(500).json({
        error: 'Replay failed',
        message: error instanceof Error ? error.message : String(error),
        processingTimeMs: Date.now() - startTime,
      })
    }
  })
})

/** Strip WhatsApp JID suffix to show phone number */
function formatPhone(jid: string): string {
  return jid.replace(/@s\.whatsapp\.net$/, '').replace(/@lid$/, '')
}
