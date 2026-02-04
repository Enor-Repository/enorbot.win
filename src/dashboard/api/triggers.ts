/**
 * Dashboard API: Group Triggers Endpoints
 * Sprint 3: Group Triggers
 *
 * Enables Daniel (CIO) to manage per-group trigger patterns via dashboard.
 * Routes are mounted under /api/groups/:groupJid/triggers
 *
 * Sprint 2 retro lessons applied:
 * - API boundary validation on all POST/PUT endpoints
 * - Authorization scope verification on GET-by-ID
 * - Delete verification with .select() + data.length check
 */
import { Router, type Request, type Response } from 'express'
import { logger } from '../../utils/logger.js'
import {
  getTriggersForGroup,
  getTriggerById,
  matchTrigger,
  createTrigger,
  updateTrigger,
  deleteTrigger,
  isValidPatternType,
  isValidActionType,
  isValidScope,
  isValidRegex,
  type TriggerInput,
  type TriggerUpdateInput,
  type PatternType,
  type TriggerActionType,
  type TriggerScope,
  type GroupTrigger,
} from '../../services/triggerService.js'
import { getActiveRule } from '../../services/ruleService.js'
import { executeAction } from '../../services/actionExecutor.js'

// Use mergeParams to access :groupJid from parent router
export const groupTriggersRouter = Router({ mergeParams: true })

/**
 * Extract and validate groupJid from route params
 */
function getGroupJid(req: Request): string | null {
  const groupJid = req.params.groupJid as string
  return groupJid || null
}

// ============================================================================
// Endpoints
// ============================================================================

/**
 * GET /api/groups/:groupJid/triggers
 * List all triggers for a group (ordered by priority DESC)
 */
groupTriggersRouter.get('/', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const result = await getTriggersForGroup(groupJid)

    if (!result.ok) {
      return res.status(500).json({
        error: 'Failed to fetch triggers',
        message: result.error,
      })
    }

    res.json({ triggers: result.data })
  } catch (error) {
    logger.error('Failed to fetch group triggers', {
      event: 'group_triggers_fetch_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to fetch triggers',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * GET /api/groups/:groupJid/triggers/:triggerId
 * Get a specific trigger by ID
 * Retro lesson: Verify authorization boundary (groupJid match)
 */
groupTriggersRouter.get('/:triggerId', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const triggerId = req.params.triggerId as string
    if (!triggerId) {
      return res.status(400).json({ error: 'Missing triggerId parameter' })
    }

    const result = await getTriggerById(triggerId)

    if (!result.ok) {
      const status = result.error === 'Trigger not found' ? 404 : 500
      return res.status(status).json({
        error: result.error === 'Trigger not found' ? 'Trigger not found' : 'Failed to fetch trigger',
        message: result.error,
      })
    }

    // Authorization boundary: verify trigger belongs to this group
    if (result.data.groupJid !== groupJid) {
      return res.status(404).json({ error: 'Trigger not found' })
    }

    res.json({ trigger: result.data })
  } catch (error) {
    logger.error('Failed to fetch trigger', {
      event: 'trigger_fetch_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to fetch trigger',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * POST /api/groups/:groupJid/triggers
 * Create a new trigger
 * Retro lesson: Full input validation at API boundary
 */
groupTriggersRouter.post('/', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const {
      triggerPhrase,
      patternType,
      actionType,
      actionParams,
      priority,
      isActive,
    } = req.body

    const { scope } = req.body

    // ---- API boundary validation (Sprint 2 retro lesson) ----

    // triggerPhrase: required string
    if (!triggerPhrase || typeof triggerPhrase !== 'string') {
      return res.status(400).json({ error: 'triggerPhrase is required and must be a string' })
    }
    if (triggerPhrase.trim().length === 0) {
      return res.status(400).json({ error: 'triggerPhrase cannot be empty' })
    }
    if (triggerPhrase.length > 200) {
      return res.status(400).json({ error: 'triggerPhrase must be 200 characters or less' })
    }

    // actionType: required, must be valid
    if (!actionType || typeof actionType !== 'string') {
      return res.status(400).json({ error: 'actionType is required and must be a string' })
    }
    if (!isValidActionType(actionType)) {
      return res.status(400).json({
        error: `Invalid actionType: ${actionType}. Must be one of: price_quote, volume_quote, text_response, ai_prompt, deal_lock, deal_cancel, deal_confirm, deal_volume, tronscan_process, receipt_process, control_command`,
      })
    }

    // patternType: optional, must be valid if provided
    if (patternType !== undefined) {
      if (typeof patternType !== 'string') {
        return res.status(400).json({ error: 'patternType must be a string' })
      }
      if (!isValidPatternType(patternType)) {
        return res.status(400).json({
          error: `Invalid patternType: ${patternType}. Must be one of: exact, contains, regex`,
        })
      }
    }

    // Validate regex pattern if pattern type is regex
    if (patternType === 'regex' && !isValidRegex(triggerPhrase)) {
      return res.status(400).json({ error: `Invalid regex pattern: ${triggerPhrase}` })
    }

    // priority: optional, must be number 0-100
    if (priority !== undefined && (typeof priority !== 'number' || priority < 0 || priority > 100)) {
      return res.status(400).json({ error: 'priority must be a number between 0 and 100' })
    }

    // actionParams: optional, must be object
    if (actionParams !== undefined && (typeof actionParams !== 'object' || actionParams === null || Array.isArray(actionParams))) {
      return res.status(400).json({ error: 'actionParams must be an object' })
    }

    // Validate action-specific params
    if (actionType === 'text_response') {
      const text = actionParams?.text
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({ error: 'text_response requires a non-empty "text" in actionParams' })
      }
    }
    if (actionType === 'ai_prompt') {
      const prompt = actionParams?.prompt
      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return res.status(400).json({ error: 'ai_prompt requires a non-empty "prompt" in actionParams' })
      }
    }

    // isActive: optional, must be boolean
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' })
    }

    // scope: optional, must be valid
    if (scope !== undefined) {
      if (typeof scope !== 'string') {
        return res.status(400).json({ error: 'scope must be a string' })
      }
      if (!isValidScope(scope)) {
        return res.status(400).json({
          error: `Invalid scope: ${scope}. Must be one of: group, control_only`,
        })
      }
    }

    // ---- End API boundary validation ----

    const input: TriggerInput = {
      groupJid,
      triggerPhrase: triggerPhrase.trim(),
      patternType: patternType as PatternType | undefined,
      actionType: actionType as TriggerActionType,
      actionParams: actionParams || {},
      priority,
      isActive,
      scope: scope as TriggerScope | undefined,
    }

    const result = await createTrigger(input)

    if (!result.ok) {
      const isDuplicate = result.error.includes('already exists')
      const status = isDuplicate ? 409 : 400
      return res.status(status).json({
        error: isDuplicate
          ? 'A trigger with this phrase already exists in this group'
          : 'Failed to create trigger',
      })
    }

    logger.info('Trigger created via dashboard', {
      event: 'trigger_dashboard_create',
      groupJid,
      triggerId: result.data.id,
      phrase: result.data.triggerPhrase,
      actionType: result.data.actionType,
    })

    res.status(201).json({ trigger: result.data })
  } catch (error) {
    logger.error('Failed to create trigger', {
      event: 'trigger_create_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to create trigger',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * PUT /api/groups/:groupJid/triggers/:triggerId
 * Update a trigger
 * Retro lesson: Full input validation at API boundary
 */
groupTriggersRouter.put('/:triggerId', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const triggerId = req.params.triggerId as string
    if (!triggerId) {
      return res.status(400).json({ error: 'Missing triggerId parameter' })
    }

    const {
      triggerPhrase,
      patternType,
      actionType,
      actionParams,
      priority,
      isActive,
      scope,
    } = req.body

    // ---- API boundary validation (Sprint 2 retro lesson) ----

    if (triggerPhrase !== undefined) {
      if (typeof triggerPhrase !== 'string') {
        return res.status(400).json({ error: 'triggerPhrase must be a string' })
      }
      if (triggerPhrase.trim().length === 0) {
        return res.status(400).json({ error: 'triggerPhrase cannot be empty' })
      }
      if (triggerPhrase.length > 200) {
        return res.status(400).json({ error: 'triggerPhrase must be 200 characters or less' })
      }
    }

    if (patternType !== undefined) {
      if (typeof patternType !== 'string') {
        return res.status(400).json({ error: 'patternType must be a string' })
      }
      if (!isValidPatternType(patternType)) {
        return res.status(400).json({
          error: `Invalid patternType: ${patternType}. Must be one of: exact, contains, regex`,
        })
      }
    }

    if (actionType !== undefined) {
      if (typeof actionType !== 'string') {
        return res.status(400).json({ error: 'actionType must be a string' })
      }
      if (!isValidActionType(actionType)) {
        return res.status(400).json({
          error: `Invalid actionType: ${actionType}. Must be one of: price_quote, volume_quote, text_response, ai_prompt, deal_lock, deal_cancel, deal_confirm, deal_volume, tronscan_process, receipt_process, control_command`,
        })
      }
    }

    if (patternType === 'regex' && triggerPhrase !== undefined && !isValidRegex(triggerPhrase)) {
      return res.status(400).json({ error: `Invalid regex pattern: ${triggerPhrase}` })
    }

    if (priority !== undefined && (typeof priority !== 'number' || priority < 0 || priority > 100)) {
      return res.status(400).json({ error: 'priority must be a number between 0 and 100' })
    }

    if (actionParams !== undefined && (typeof actionParams !== 'object' || actionParams === null || Array.isArray(actionParams))) {
      return res.status(400).json({ error: 'actionParams must be an object' })
    }

    // Validate action-specific params if action type is being set
    if (actionType === 'text_response' && actionParams !== undefined) {
      const text = actionParams?.text
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({ error: 'text_response requires a non-empty "text" in actionParams' })
      }
    }
    if (actionType === 'ai_prompt' && actionParams !== undefined) {
      const prompt = actionParams?.prompt
      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return res.status(400).json({ error: 'ai_prompt requires a non-empty "prompt" in actionParams' })
      }
    }

    // isActive: optional, must be boolean
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' })
    }

    // scope: optional, must be valid
    if (scope !== undefined) {
      if (typeof scope !== 'string') {
        return res.status(400).json({ error: 'scope must be a string' })
      }
      if (!isValidScope(scope)) {
        return res.status(400).json({
          error: `Invalid scope: ${scope}. Must be one of: group, control_only`,
        })
      }
    }

    // ---- End API boundary validation ----

    const input: TriggerUpdateInput = {}

    if (triggerPhrase !== undefined) input.triggerPhrase = triggerPhrase
    if (patternType !== undefined) input.patternType = patternType as PatternType
    if (actionType !== undefined) input.actionType = actionType as TriggerActionType
    if (actionParams !== undefined) input.actionParams = actionParams
    if (priority !== undefined) input.priority = priority
    if (isActive !== undefined) input.isActive = isActive
    if (scope !== undefined) input.scope = scope as TriggerScope

    const result = await updateTrigger(triggerId, groupJid, input)

    if (!result.ok) {
      const isNotFound = result.error === 'Trigger not found'
      const isDuplicate = result.error.includes('already exists')
      const status = isNotFound ? 404 : isDuplicate ? 409 : 400
      return res.status(status).json({
        error: isNotFound ? 'Trigger not found'
          : isDuplicate ? 'A trigger with this phrase already exists in this group'
          : 'Failed to update trigger',
      })
    }

    logger.info('Trigger updated via dashboard', {
      event: 'trigger_dashboard_update',
      groupJid,
      triggerId: result.data.id,
      phrase: result.data.triggerPhrase,
    })

    res.json({ trigger: result.data })
  } catch (error) {
    logger.error('Failed to update trigger', {
      event: 'trigger_update_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to update trigger',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * DELETE /api/groups/:groupJid/triggers/:triggerId
 * Delete a trigger
 * Retro lesson: Delete verification (service uses .select() + data.length check)
 */
groupTriggersRouter.delete('/:triggerId', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const triggerId = req.params.triggerId as string
    if (!triggerId) {
      return res.status(400).json({ error: 'Missing triggerId parameter' })
    }

    const result = await deleteTrigger(triggerId, groupJid)

    if (!result.ok) {
      const status = result.error === 'Trigger not found' ? 404 : 500
      return res.status(status).json({
        error: result.error === 'Trigger not found' ? 'Trigger not found' : 'Failed to delete trigger',
        message: result.error,
      })
    }

    logger.info('Trigger deleted via dashboard', {
      event: 'trigger_dashboard_delete',
      groupJid,
      triggerId,
    })

    res.json({ success: true, message: 'Trigger deleted' })
  } catch (error) {
    logger.error('Failed to delete trigger', {
      event: 'trigger_delete_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to delete trigger',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * POST /api/groups/:groupJid/triggers/test
 * Test a message against the group's triggers.
 * Shows which trigger would match and which rule would be applied.
 */
groupTriggersRouter.post('/test', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const { message } = req.body

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'message is required and must be a non-empty string' })
    }

    // Find matching trigger
    const triggerResult = await matchTrigger(message, groupJid)
    if (!triggerResult.ok) {
      return res.status(500).json({
        error: 'Failed to test trigger',
        message: triggerResult.error,
      })
    }

    if (!triggerResult.data) {
      return res.json({
        matched: false,
        trigger: null,
        activeRule: null,
        actionResult: null,
        message: 'No trigger matched this message',
      })
    }

    // Get active rule for context
    const ruleResult = await getActiveRule(groupJid)
    const activeRule = ruleResult.ok ? ruleResult.data : null

    // Execute action to show what would happen
    const actionResult = await executeAction(
      triggerResult.data,
      activeRule,
      { message, groupJid }
    )

    res.json({
      matched: true,
      trigger: triggerResult.data,
      activeRule,
      actionResult: actionResult.ok ? actionResult.data : { error: actionResult.error },
    })
  } catch (error) {
    logger.error('Failed to test trigger', {
      event: 'trigger_test_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to test trigger',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
