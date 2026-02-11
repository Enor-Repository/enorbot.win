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
import { createMockSocket } from './simulatorSocket.js'

export const simulatorRouter = Router()

/**
 * GET /api/simulator/groups
 * Returns all groups with their player roles for the UI picker.
 */
simulatorRouter.get('/groups', async (_req: Request, res: Response) => {
  try {
    const allConfigs = await getAllGroupConfigs()
    const config = getConfig()

    const groups = [...allConfigs.values()].map((gc) => ({
      groupJid: gc.groupJid,
      groupName: gc.groupName,
      mode: gc.mode,
      isControlGroup: isControlGroupMessage(gc.groupName, config.CONTROL_GROUP_PATTERN),
      playerRoles: gc.playerRoles,
    }))

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

  try {
    const { groupId, senderJid, senderName, message } = req.body

    // Validate required fields
    if (!groupId || typeof groupId !== 'string') {
      return res.status(400).json({ error: 'groupId is required' })
    }
    if (!senderJid || typeof senderJid !== 'string') {
      return res.status(400).json({ error: 'senderJid is required' })
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' })
    }

    // Verify group exists in config cache
    const groupConfig = getGroupConfigSync(groupId)
    if (!groupConfig) {
      return res.status(404).json({ error: 'Group not found in config cache' })
    }

    // Check ignored player
    if (isIgnoredPlayer(groupId, senderJid)) {
      return res.json({
        route: { destination: 'IGNORED_PLAYER', dealAction: null, hasTrigger: false },
        responses: [],
        processingTimeMs: Date.now() - startTime,
      })
    }

    const config = getConfig()
    const groupName = groupConfig.groupName
    const isControlGroup = isControlGroupMessage(groupName, config.CONTROL_GROUP_PATTERN)

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

    // Route the message through the real router
    const route = await routeMessage(context)

    logger.info('Simulator message routed', {
      event: 'simulator_routed',
      groupId,
      sender: senderJid,
      destination: route.destination,
      dealAction: route.context.dealAction,
      hasTrigger: route.context.hasTrigger,
    })

    // Dispatch to handler based on route destination.
    // Matches connection.ts dispatch: control/price/tronscan get original context,
    // deal handler gets enriched route.context (with dealAction, matchedTrigger, etc.).
    // NOTE: We intentionally skip shouldSuppressResponse() and the Phase 3 active-quote
    // redirect — the simulator always shows the full response so testers see what the
    // bot *would* say, even if production would suppress duplicates.
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
    // OBSERVE_ONLY and IGNORE: no handler dispatched

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
