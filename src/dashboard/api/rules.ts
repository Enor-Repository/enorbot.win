/**
 * Dashboard API: Rules endpoints
 * Story D.5-D.7: Rule Builder
 */
import { Router, type Request, type Response } from 'express'
import { getSupabase } from '../../services/supabase.js'
import { logger } from '../../utils/logger.js'

export const rulesRouter = Router()

/**
 * GET /api/rules
 * Get all rules, optionally filtered by group
 */
rulesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const groupJid = req.query.groupJid as string | undefined
    const supabase = getSupabase()

    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    let query = supabase
      .from('rules')
      .select('*')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })

    if (groupJid) {
      query = query.eq('group_jid', groupJid)
    }

    const { data: rules, error } = await query

    if (error) throw error

    res.json({ rules: rules || [] })
  } catch (error) {
    logger.error('Failed to fetch rules', {
      event: 'rules_fetch_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to fetch rules',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * POST /api/rules
 * Create a new rule
 */
rulesRouter.post('/', async (req: Request, res: Response) => {
  try {
    const {
      groupJid,
      triggerPhrase,
      responseTemplate,
      isActive = true,
      priority = 0,
      conditions = {},
    } = req.body

    // Validation
    if (!groupJid || !triggerPhrase || !responseTemplate) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['groupJid', 'triggerPhrase', 'responseTemplate'],
      })
    }

    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    const { data: rule, error } = await supabase
      .from('rules')
      .insert({
        group_jid: groupJid,
        trigger_phrase: triggerPhrase.toLowerCase().trim(),
        response_template: responseTemplate,
        is_active: isActive,
        priority,
        conditions,
        created_by: 'dashboard',
      })
      .select()
      .single()

    if (error) throw error

    logger.info('Rule created', {
      event: 'rule_created',
      rule_id: rule.id,
      group_jid: groupJid,
      trigger: triggerPhrase,
    })

    res.status(201).json({ rule })
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
 * PUT /api/rules/:id
 * Update a rule
 */
rulesRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const updates = req.body

    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    // Normalize trigger phrase if provided
    if (updates.triggerPhrase) {
      updates.trigger_phrase = updates.triggerPhrase.toLowerCase().trim()
      delete updates.triggerPhrase
    }
    if (updates.responseTemplate) {
      updates.response_template = updates.responseTemplate
      delete updates.responseTemplate
    }
    if (updates.isActive !== undefined) {
      updates.is_active = updates.isActive
      delete updates.isActive
    }

    const { data: rule, error } = await supabase
      .from('rules')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    logger.info('Rule updated', {
      event: 'rule_updated',
      rule_id: id,
    })

    res.json({ rule })
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
 * DELETE /api/rules/:id
 * Delete a rule
 */
rulesRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const supabase = getSupabase()

    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    const { error } = await supabase.from('rules').delete().eq('id', id)

    if (error) throw error

    logger.info('Rule deleted', {
      event: 'rule_deleted',
      rule_id: id,
    })

    res.json({ success: true })
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

/**
 * POST /api/rules/test
 * Test a message against rules to see which would match
 */
rulesRouter.post('/test', async (req: Request, res: Response) => {
  try {
    const { message, groupJid } = req.body

    if (!message || !groupJid) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['message', 'groupJid'],
      })
    }

    const supabase = getSupabase()
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    // Get all active rules for this group
    const { data: rules, error } = await supabase
      .from('rules')
      .select('*')
      .eq('group_jid', groupJid)
      .eq('is_active', true)
      .order('priority', { ascending: false })

    if (error) throw error

    // Find matching rule
    const messageLower = message.toLowerCase()
    const matchedRule = rules?.find((rule) =>
      messageLower.includes(rule.trigger_phrase.toLowerCase())
    )

    res.json({
      matched: !!matchedRule,
      rule: matchedRule || null,
      allRules: rules || [],
    })
  } catch (error) {
    logger.error('Failed to test rules', {
      event: 'rule_test_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to test rules',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
