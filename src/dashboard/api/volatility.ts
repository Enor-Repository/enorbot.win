/**
 * Volatility Protection API
 * Dashboard endpoints for managing per-group volatility thresholds.
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { logger } from '../../utils/logger.js'
import { getSupabase } from '../../services/supabase.js'
import { invalidateConfigCache } from '../../services/volatilityMonitor.js'

export const volatilityRouter = Router({ mergeParams: true })

/**
 * Zod schema for volatility config updates.
 * thresholdBps: minimum 10 bps (0.10%) to prevent excessive repricing on every tick
 * maxReprices: 1-10 reprices before escalation
 */
const VolatilityConfigSchema = z.object({
  enabled: z.boolean().optional(),
  thresholdBps: z.number().int().min(10).max(1000).optional(),
  maxReprices: z.number().int().min(1).max(10).optional(),
})

/**
 * GET /api/groups/:groupJid/volatility
 * Get volatility config for a group.
 */
volatilityRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const groupJid = req.params.groupJid as string

  if (!groupJid) {
    res.status(400).json({ error: 'Missing groupJid parameter' })
    return
  }

  const supabase = getSupabase()
  if (!supabase) {
    res.status(503).json({ error: 'Database not available' })
    return
  }

  try {
    const { data, error } = await supabase
      .from('group_volatility_config')
      .select('enabled, threshold_bps, max_reprices, created_at, updated_at')
      .eq('group_jid', groupJid)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        // No config exists - return defaults
        res.json({
          enabled: true,
          thresholdBps: 30,
          maxReprices: 3,
          isDefault: true,
        })
        return
      }
      logger.error('Failed to get volatility config', {
        event: 'volatility_config_get_error',
        groupJid,
        error: error.message,
      })
      res.status(500).json({ error: error.message })
      return
    }

    res.json({
      enabled: data.enabled,
      thresholdBps: data.threshold_bps,
      maxReprices: data.max_reprices,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      isDefault: false,
    })
  } catch (e) {
    logger.error('Volatility config get exception', {
      event: 'volatility_config_get_exception',
      groupJid,
      error: e instanceof Error ? e.message : String(e),
    })
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * PUT /api/groups/:groupJid/volatility
 * Update volatility config for a group.
 */
volatilityRouter.put('/', async (req: Request, res: Response): Promise<void> => {
  const groupJid = req.params.groupJid as string

  if (!groupJid) {
    res.status(400).json({ error: 'Missing groupJid parameter' })
    return
  }

  const parsed = VolatilityConfigSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request body',
      details: parsed.error.issues,
    })
    return
  }

  const supabase = getSupabase()
  if (!supabase) {
    res.status(503).json({ error: 'Database not available' })
    return
  }

  try {
    const updates: Record<string, unknown> = {}
    if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled
    if (parsed.data.thresholdBps !== undefined) updates.threshold_bps = parsed.data.thresholdBps
    if (parsed.data.maxReprices !== undefined) updates.max_reprices = parsed.data.maxReprices

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No updates provided' })
      return
    }

    const { data, error } = await supabase
      .from('group_volatility_config')
      .upsert({
        group_jid: groupJid,
        ...updates,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'group_jid',
      })
      .select('enabled, threshold_bps, max_reprices, created_at, updated_at')
      .single()

    if (error) {
      logger.error('Failed to update volatility config', {
        event: 'volatility_config_update_error',
        groupJid,
        error: error.message,
      })
      res.status(500).json({ error: error.message })
      return
    }

    // Invalidate cache so monitor picks up new config
    invalidateConfigCache(groupJid)

    logger.info('Volatility config updated', {
      event: 'volatility_config_updated',
      groupJid,
      updates,
    })

    res.json({
      enabled: data.enabled,
      thresholdBps: data.threshold_bps,
      maxReprices: data.max_reprices,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      isDefault: false,
    })
  } catch (e) {
    logger.error('Volatility config update exception', {
      event: 'volatility_config_update_exception',
      groupJid,
      error: e instanceof Error ? e.message : String(e),
    })
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /api/groups/:groupJid/volatility
 * Create volatility config with defaults for a group.
 */
volatilityRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const groupJid = req.params.groupJid as string

  if (!groupJid) {
    res.status(400).json({ error: 'Missing groupJid parameter' })
    return
  }

  const supabase = getSupabase()
  if (!supabase) {
    res.status(503).json({ error: 'Database not available' })
    return
  }

  try {
    const { data, error } = await supabase
      .from('group_volatility_config')
      .insert({
        group_jid: groupJid,
        enabled: true,
        threshold_bps: 30,
        max_reprices: 3,
      })
      .select('enabled, threshold_bps, max_reprices, created_at, updated_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        // Unique violation - config already exists
        res.status(409).json({ error: 'Config already exists for this group' })
        return
      }
      logger.error('Failed to create volatility config', {
        event: 'volatility_config_create_error',
        groupJid,
        error: error.message,
      })
      res.status(500).json({ error: error.message })
      return
    }

    logger.info('Volatility config created', {
      event: 'volatility_config_created',
      groupJid,
    })

    res.status(201).json({
      enabled: data.enabled,
      thresholdBps: data.threshold_bps,
      maxReprices: data.max_reprices,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      isDefault: false,
    })
  } catch (e) {
    logger.error('Volatility config create exception', {
      event: 'volatility_config_create_exception',
      groupJid,
      error: e instanceof Error ? e.message : String(e),
    })
    res.status(500).json({ error: 'Internal server error' })
  }
})
