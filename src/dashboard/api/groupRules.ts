/**
 * Dashboard API: Group Rules Endpoints
 * Sprint 2: Time-Based Pricing Rules
 *
 * Enables Daniel (CIO) to manage time-based pricing rules per group.
 * Routes are mounted under /api/groups/:groupJid/rules
 */
import { Router, type Request, type Response } from 'express'
import { logger } from '../../utils/logger.js'
import {
  getRulesForGroup,
  getRuleById,
  getActiveRule,
  createRule,
  updateRule,
  deleteRule,
  isValidTimeFormat,
  isValidDay,
  isValidPricingSource,
  isValidSpreadMode,
  isValidTimezone,
  type RuleInput,
  type RuleUpdateInput,
  type DayOfWeek,
} from '../../services/ruleService.js'

// Use mergeParams to access :groupJid from parent router
export const groupRulesRouter = Router({ mergeParams: true })

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
 * GET /api/groups/:groupJid/rules
 * List all rules for a group (ordered by priority DESC)
 */
groupRulesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const result = await getRulesForGroup(groupJid)

    if (!result.ok) {
      return res.status(500).json({
        error: 'Failed to fetch rules',
        message: result.error,
      })
    }

    res.json({ rules: result.data })
  } catch (error) {
    logger.error('Failed to fetch group rules', {
      event: 'group_rules_fetch_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to fetch rules',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * GET /api/groups/:groupJid/rules/active
 * Get the currently active rule for a group
 */
groupRulesRouter.get('/active', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const result = await getActiveRule(groupJid)

    if (!result.ok) {
      return res.status(500).json({
        error: 'Failed to determine active rule',
        message: result.error,
      })
    }

    res.json({
      activeRule: result.data,
      hasActiveRule: result.data !== null,
    })
  } catch (error) {
    logger.error('Failed to get active rule', {
      event: 'active_rule_fetch_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to determine active rule',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * GET /api/groups/:groupJid/rules/:ruleId
 * Get a specific rule by ID
 */
groupRulesRouter.get('/:ruleId', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const ruleId = req.params.ruleId as string
    if (!ruleId) {
      return res.status(400).json({ error: 'Missing ruleId parameter' })
    }

    const result = await getRuleById(ruleId)

    if (!result.ok) {
      const status = result.error === 'Rule not found' ? 404 : 500
      return res.status(status).json({
        error: result.error === 'Rule not found' ? 'Rule not found' : 'Failed to fetch rule',
        message: result.error,
      })
    }

    // Authorization boundary: verify rule belongs to this group
    if (result.data.groupJid !== groupJid) {
      return res.status(404).json({ error: 'Rule not found' })
    }

    res.json({ rule: result.data })
  } catch (error) {
    logger.error('Failed to fetch rule', {
      event: 'rule_fetch_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to fetch rule',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * POST /api/groups/:groupJid/rules
 * Create a new rule
 */
groupRulesRouter.post('/', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const {
      name,
      description,
      scheduleStartTime,
      scheduleEndTime,
      scheduleDays,
      scheduleTimezone,
      priority,
      pricingSource,
      spreadMode,
      sellSpread,
      buySpread,
      isActive,
    } = req.body

    // Basic type validation
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required and must be a string' })
    }

    if (!scheduleStartTime || !scheduleEndTime) {
      return res.status(400).json({ error: 'scheduleStartTime and scheduleEndTime are required' })
    }

    if (!Array.isArray(scheduleDays) || scheduleDays.length === 0) {
      return res.status(400).json({ error: 'scheduleDays must be a non-empty array' })
    }

    if (name.length > 100) {
      return res.status(400).json({ error: 'name must be 100 characters or less' })
    }

    // Validate time formats
    if (!isValidTimeFormat(scheduleStartTime)) {
      return res.status(400).json({ error: `Invalid scheduleStartTime: ${scheduleStartTime} (expected HH:MM)` })
    }
    if (!isValidTimeFormat(scheduleEndTime)) {
      return res.status(400).json({ error: `Invalid scheduleEndTime: ${scheduleEndTime} (expected HH:MM)` })
    }

    // Validate day values
    for (const day of scheduleDays) {
      if (!isValidDay(day)) {
        return res.status(400).json({ error: `Invalid day: ${day}` })
      }
    }

    // Validate optional typed fields
    if (scheduleTimezone !== undefined && !isValidTimezone(scheduleTimezone)) {
      return res.status(400).json({ error: `Invalid timezone: ${scheduleTimezone}` })
    }
    if (pricingSource !== undefined && !isValidPricingSource(pricingSource)) {
      return res.status(400).json({ error: `Invalid pricingSource: ${pricingSource}. Must be 'commercial_dollar' or 'usdt_binance'` })
    }
    if (spreadMode !== undefined && !isValidSpreadMode(spreadMode)) {
      return res.status(400).json({ error: `Invalid spreadMode: ${spreadMode}. Must be 'bps', 'abs_brl', or 'flat'` })
    }
    if (priority !== undefined && (typeof priority !== 'number' || priority < 0 || priority > 100)) {
      return res.status(400).json({ error: 'priority must be a number between 0 and 100' })
    }
    if (sellSpread !== undefined && typeof sellSpread !== 'number') {
      return res.status(400).json({ error: 'sellSpread must be a number' })
    }
    if (buySpread !== undefined && typeof buySpread !== 'number') {
      return res.status(400).json({ error: 'buySpread must be a number' })
    }

    const input: RuleInput = {
      groupJid,
      name: name.trim(),
      description: description ?? null,
      scheduleStartTime,
      scheduleEndTime,
      scheduleDays: scheduleDays as DayOfWeek[],
      scheduleTimezone,
      priority,
      pricingSource,
      spreadMode,
      sellSpread: typeof sellSpread === 'number' ? sellSpread : undefined,
      buySpread: typeof buySpread === 'number' ? buySpread : undefined,
      isActive,
    }

    const result = await createRule(input)

    if (!result.ok) {
      const status = result.error.includes('already exists') ? 409 : 400
      return res.status(status).json({
        error: 'Failed to create rule',
        message: result.error,
      })
    }

    logger.info('Rule created via dashboard', {
      event: 'rule_dashboard_create',
      groupJid,
      ruleId: result.data.id,
      name: result.data.name,
    })

    res.status(201).json({ rule: result.data })
  } catch (error) {
    logger.error('Failed to create rule', {
      event: 'rule_create_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to create rule',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * PUT /api/groups/:groupJid/rules/:ruleId
 * Update a rule
 */
groupRulesRouter.put('/:ruleId', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const ruleId = req.params.ruleId as string
    if (!ruleId) {
      return res.status(400).json({ error: 'Missing ruleId parameter' })
    }

    const {
      name,
      description,
      scheduleStartTime,
      scheduleEndTime,
      scheduleDays,
      scheduleTimezone,
      priority,
      pricingSource,
      spreadMode,
      sellSpread,
      buySpread,
      isActive,
    } = req.body

    // Validate typed fields if provided
    if (name !== undefined && typeof name !== 'string') {
      return res.status(400).json({ error: 'name must be a string' })
    }
    if (name !== undefined && name.length > 100) {
      return res.status(400).json({ error: 'name must be 100 characters or less' })
    }
    if (scheduleStartTime !== undefined && !isValidTimeFormat(scheduleStartTime)) {
      return res.status(400).json({ error: `Invalid scheduleStartTime: ${scheduleStartTime} (expected HH:MM)` })
    }
    if (scheduleEndTime !== undefined && !isValidTimeFormat(scheduleEndTime)) {
      return res.status(400).json({ error: `Invalid scheduleEndTime: ${scheduleEndTime} (expected HH:MM)` })
    }
    if (scheduleDays !== undefined) {
      if (!Array.isArray(scheduleDays) || scheduleDays.length === 0) {
        return res.status(400).json({ error: 'scheduleDays must be a non-empty array' })
      }
      for (const day of scheduleDays) {
        if (!isValidDay(day)) {
          return res.status(400).json({ error: `Invalid day: ${day}` })
        }
      }
    }
    if (scheduleTimezone !== undefined && !isValidTimezone(scheduleTimezone)) {
      return res.status(400).json({ error: `Invalid timezone: ${scheduleTimezone}` })
    }
    if (pricingSource !== undefined && !isValidPricingSource(pricingSource)) {
      return res.status(400).json({ error: `Invalid pricingSource: ${pricingSource}` })
    }
    if (spreadMode !== undefined && !isValidSpreadMode(spreadMode)) {
      return res.status(400).json({ error: `Invalid spreadMode: ${spreadMode}` })
    }
    if (priority !== undefined && (typeof priority !== 'number' || priority < 0 || priority > 100)) {
      return res.status(400).json({ error: 'priority must be a number between 0 and 100' })
    }
    if (sellSpread !== undefined && typeof sellSpread !== 'number') {
      return res.status(400).json({ error: 'sellSpread must be a number' })
    }
    if (buySpread !== undefined && typeof buySpread !== 'number') {
      return res.status(400).json({ error: 'buySpread must be a number' })
    }

    const input: RuleUpdateInput = {}

    if (name !== undefined) input.name = name
    if (description !== undefined) input.description = description
    if (scheduleStartTime !== undefined) input.scheduleStartTime = scheduleStartTime
    if (scheduleEndTime !== undefined) input.scheduleEndTime = scheduleEndTime
    if (scheduleDays !== undefined) input.scheduleDays = scheduleDays as DayOfWeek[]
    if (scheduleTimezone !== undefined) input.scheduleTimezone = scheduleTimezone
    if (priority !== undefined) input.priority = priority
    if (pricingSource !== undefined) input.pricingSource = pricingSource
    if (spreadMode !== undefined) input.spreadMode = spreadMode
    if (sellSpread !== undefined) input.sellSpread = sellSpread
    if (buySpread !== undefined) input.buySpread = buySpread
    if (isActive !== undefined) input.isActive = isActive

    const result = await updateRule(ruleId, groupJid, input)

    if (!result.ok) {
      const status = result.error === 'Rule not found' ? 404
        : result.error.includes('already exists') ? 409
        : 400
      return res.status(status).json({
        error: 'Failed to update rule',
        message: result.error,
      })
    }

    logger.info('Rule updated via dashboard', {
      event: 'rule_dashboard_update',
      groupJid,
      ruleId: result.data.id,
      name: result.data.name,
    })

    res.json({ rule: result.data })
  } catch (error) {
    logger.error('Failed to update rule', {
      event: 'rule_update_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to update rule',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * DELETE /api/groups/:groupJid/rules/:ruleId
 * Delete a rule
 */
groupRulesRouter.delete('/:ruleId', async (req: Request, res: Response) => {
  try {
    const groupJid = getGroupJid(req)
    if (!groupJid) {
      return res.status(400).json({ error: 'Missing groupJid parameter' })
    }

    const ruleId = req.params.ruleId as string
    if (!ruleId) {
      return res.status(400).json({ error: 'Missing ruleId parameter' })
    }

    const result = await deleteRule(ruleId, groupJid)

    if (!result.ok) {
      const status = result.error === 'Rule not found' ? 404 : 500
      return res.status(status).json({
        error: result.error === 'Rule not found' ? 'Rule not found' : 'Failed to delete rule',
        message: result.error,
      })
    }

    logger.info('Rule deleted via dashboard', {
      event: 'rule_dashboard_delete',
      groupJid,
      ruleId,
    })

    res.json({ success: true, message: 'Rule deleted' })
  } catch (error) {
    logger.error('Failed to delete rule', {
      event: 'rule_delete_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to delete rule',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
