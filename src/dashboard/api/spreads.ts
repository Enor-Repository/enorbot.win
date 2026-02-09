/**
 * Dashboard API: Spread Configuration Endpoints
 * Enables Daniel (CIO) to configure per-group pricing via dashboard.
 */
import { Router, type Request, type Response } from 'express'
import { logger } from '../../utils/logger.js'
import {
  getSpreadConfig,
  upsertSpreadConfig,
  getAllSpreadConfigs,
  clearSpreadCache,
  calculateQuote,
  type SpreadConfig,
  type SpreadMode,
  type TradeSide,
  type Currency,
  type Language,
  type DealFlowMode,
  type GroupLanguage,
} from '../../services/groupSpreadService.js'
import { getSupabase } from '../../services/supabase.js'

export const spreadsRouter = Router()

/**
 * Validate spread mode
 */
function isValidSpreadMode(mode: unknown): mode is SpreadMode {
  return mode === 'bps' || mode === 'abs_brl' || mode === 'flat'
}

/**
 * Validate trade side
 */
function isValidTradeSide(side: unknown): side is TradeSide {
  return side === 'client_buys_usdt' || side === 'client_sells_usdt'
}

/**
 * Validate currency
 */
function isValidCurrency(currency: unknown): currency is Currency {
  return currency === 'BRL' || currency === 'USDT'
}

/**
 * Validate language
 */
function isValidLanguage(lang: unknown): lang is Language {
  return lang === 'pt-BR' || lang === 'en'
}

/**
 * Validate deal flow mode (Sprint 9)
 */
function isValidDealFlowMode(mode: unknown): mode is DealFlowMode {
  return mode === 'classic' || mode === 'simple'
}

/**
 * Validate group language (Sprint 9)
 */
function isValidGroupLanguage(lang: unknown): lang is GroupLanguage {
  return lang === 'pt' || lang === 'en'
}

/**
 * GET /api/spreads
 * Get all spread configurations
 */
spreadsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await getAllSpreadConfigs()

    if (!result.ok) {
      return res.status(500).json({
        error: 'Failed to fetch spread configs',
        message: result.error,
      })
    }

    res.json({ spreads: result.data })
  } catch (error) {
    logger.error('Failed to fetch spread configs', {
      event: 'spreads_fetch_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to fetch spread configs',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * GET /api/spreads/:groupJid
 * Get spread configuration for a specific group
 */
spreadsRouter.get('/:groupJid', async (req: Request, res: Response) => {
  try {
    const groupJid = req.params.groupJid as string

    if (!groupJid) {
      return res.status(400).json({
        error: 'Missing groupJid parameter',
      })
    }

    const result = await getSpreadConfig(groupJid)

    if (!result.ok) {
      return res.status(500).json({
        error: 'Failed to fetch spread config',
        message: result.error,
      })
    }

    res.json({ spread: result.data })
  } catch (error) {
    logger.error('Failed to fetch spread config', {
      event: 'spread_fetch_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to fetch spread config',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * PUT /api/spreads/:groupJid
 * Update spread configuration for a group
 */
spreadsRouter.put('/:groupJid', async (req: Request, res: Response) => {
  try {
    const groupJid = req.params.groupJid as string
    const {
      spreadMode,
      sellSpread,
      buySpread,
      quoteTtlSeconds,
      defaultSide,
      defaultCurrency,
      language,
      dealFlowMode,
      operatorJid,
      amountTimeoutSeconds,
      groupLanguage,
    } = req.body

    if (!groupJid) {
      return res.status(400).json({
        error: 'Missing groupJid parameter',
      })
    }

    // Validate fields if provided
    if (spreadMode !== undefined && !isValidSpreadMode(spreadMode)) {
      return res.status(400).json({
        error: 'Invalid spreadMode',
        message: 'spreadMode must be "bps", "abs_brl", or "flat"',
      })
    }

    if (defaultSide !== undefined && !isValidTradeSide(defaultSide)) {
      return res.status(400).json({
        error: 'Invalid defaultSide',
        message: 'defaultSide must be "client_buys_usdt" or "client_sells_usdt"',
      })
    }

    if (defaultCurrency !== undefined && !isValidCurrency(defaultCurrency)) {
      return res.status(400).json({
        error: 'Invalid defaultCurrency',
        message: 'defaultCurrency must be "BRL" or "USDT"',
      })
    }

    if (language !== undefined && !isValidLanguage(language)) {
      return res.status(400).json({
        error: 'Invalid language',
        message: 'language must be "pt-BR" or "en"',
      })
    }

    if (sellSpread !== undefined && typeof sellSpread !== 'number') {
      return res.status(400).json({
        error: 'Invalid sellSpread',
        message: 'sellSpread must be a number',
      })
    }

    if (buySpread !== undefined && typeof buySpread !== 'number') {
      return res.status(400).json({
        error: 'Invalid buySpread',
        message: 'buySpread must be a number',
      })
    }

    if (quoteTtlSeconds !== undefined) {
      if (typeof quoteTtlSeconds !== 'number' || quoteTtlSeconds < 1 || quoteTtlSeconds > 3600) {
        return res.status(400).json({
          error: 'Invalid quoteTtlSeconds',
          message: 'quoteTtlSeconds must be a number between 1 and 3600',
        })
      }
    }

    // Sprint 9: Validate new deal flow fields
    if (dealFlowMode !== undefined && !isValidDealFlowMode(dealFlowMode)) {
      return res.status(400).json({
        error: 'Invalid dealFlowMode',
        message: 'dealFlowMode must be "classic" or "simple"',
      })
    }

    if (operatorJid !== undefined && operatorJid !== null && typeof operatorJid !== 'string') {
      return res.status(400).json({
        error: 'Invalid operatorJid',
        message: 'operatorJid must be a string or null',
      })
    }

    if (amountTimeoutSeconds !== undefined) {
      if (typeof amountTimeoutSeconds !== 'number' || amountTimeoutSeconds < 30 || amountTimeoutSeconds > 300) {
        return res.status(400).json({
          error: 'Invalid amountTimeoutSeconds',
          message: 'amountTimeoutSeconds must be a number between 30 and 300',
        })
      }
    }

    if (groupLanguage !== undefined && !isValidGroupLanguage(groupLanguage)) {
      return res.status(400).json({
        error: 'Invalid groupLanguage',
        message: 'groupLanguage must be "pt" or "en"',
      })
    }

    // Build config object with only provided fields
    const config: Partial<SpreadConfig> & { groupJid: string } = { groupJid }

    if (spreadMode !== undefined) config.spreadMode = spreadMode
    if (sellSpread !== undefined) config.sellSpread = sellSpread
    if (buySpread !== undefined) config.buySpread = buySpread
    if (quoteTtlSeconds !== undefined) config.quoteTtlSeconds = quoteTtlSeconds
    if (defaultSide !== undefined) config.defaultSide = defaultSide
    if (defaultCurrency !== undefined) config.defaultCurrency = defaultCurrency
    if (language !== undefined) config.language = language
    if (dealFlowMode !== undefined) config.dealFlowMode = dealFlowMode
    if (operatorJid !== undefined) config.operatorJid = operatorJid
    if (amountTimeoutSeconds !== undefined) config.amountTimeoutSeconds = amountTimeoutSeconds
    if (groupLanguage !== undefined) config.groupLanguage = groupLanguage

    const result = await upsertSpreadConfig(config)

    if (!result.ok) {
      return res.status(500).json({
        error: 'Failed to save spread config',
        message: result.error,
      })
    }

    logger.info('Spread config updated via dashboard', {
      event: 'spread_config_dashboard_update',
      groupJid,
      spreadMode: result.data.spreadMode,
      sellSpread: result.data.sellSpread,
      buySpread: result.data.buySpread,
    })

    res.json({ spread: result.data })
  } catch (error) {
    logger.error('Failed to save spread config', {
      event: 'spread_save_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to save spread config',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * DELETE /api/spreads/:groupJid
 * Reset spread configuration to defaults (deletes the row)
 */
spreadsRouter.delete('/:groupJid', async (req: Request, res: Response) => {
  try {
    const groupJid = req.params.groupJid as string

    if (!groupJid) {
      return res.status(400).json({
        error: 'Missing groupJid parameter',
      })
    }

    // M3 fix: Use top-level import instead of dynamic import
    const supabase = getSupabase()

    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }

    const { error } = await supabase
      .from('group_spreads')
      .delete()
      .eq('group_jid', groupJid)

    if (error) {
      return res.status(500).json({
        error: 'Failed to delete spread config',
        message: error.message,
      })
    }

    // Clear cache
    clearSpreadCache(groupJid)

    logger.info('Spread config reset to defaults', {
      event: 'spread_config_deleted',
      groupJid,
    })

    res.json({ success: true, message: 'Spread config reset to defaults' })
  } catch (error) {
    logger.error('Failed to delete spread config', {
      event: 'spread_delete_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to delete spread config',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * POST /api/spreads/preview
 * Calculate quote preview without saving
 * Useful for live preview in dashboard
 */
spreadsRouter.post('/preview', async (req: Request, res: Response) => {
  try {
    const { binanceRate, spreadMode, sellSpread, buySpread } = req.body

    if (typeof binanceRate !== 'number' || binanceRate <= 0) {
      return res.status(400).json({
        error: 'Invalid binanceRate',
        message: 'binanceRate must be a positive number',
      })
    }

    // Use provided values or defaults
    const mode: SpreadMode = isValidSpreadMode(spreadMode) ? spreadMode : 'bps'
    const sell = typeof sellSpread === 'number' ? sellSpread : 0
    const buy = typeof buySpread === 'number' ? buySpread : 0

    // M3 fix: Use top-level import instead of dynamic import
    // Create temporary config for calculation
    const tempConfig: SpreadConfig = {
      groupJid: 'preview',
      spreadMode: mode,
      sellSpread: sell,
      buySpread: buy,
      quoteTtlSeconds: 180,
      defaultSide: 'client_buys_usdt' as TradeSide,
      defaultCurrency: 'BRL' as Currency,
      language: 'pt-BR' as Language,
      dealFlowMode: 'classic',
      operatorJid: null,
      amountTimeoutSeconds: 60,
      groupLanguage: 'pt',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const buyUsdtRate = calculateQuote(binanceRate, tempConfig, 'client_buys_usdt')
    const sellUsdtRate = calculateQuote(binanceRate, tempConfig, 'client_sells_usdt')

    res.json({
      binanceRate,
      clientBuysUsdt: {
        rate: buyUsdtRate,
        spreadApplied: sell,
        spreadMode: mode,
      },
      clientSellsUsdt: {
        rate: sellUsdtRate,
        spreadApplied: buy,
        spreadMode: mode,
      },
    })
  } catch (error) {
    logger.error('Failed to calculate spread preview', {
      event: 'spread_preview_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to calculate preview',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
