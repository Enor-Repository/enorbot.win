/**
 * Group Spread Service - Per-group pricing configuration
 *
 * Manages spread configurations for OTC trades:
 * - Each group can have its own spread (added to Binance rate)
 * - Separate spreads for buy vs sell side
 * - Quote TTL for locking deals
 * - Language and currency defaults
 *
 * This is Daniel's (CIO) primary control interface for pricing.
 */
import { getSupabase } from './supabase.js'
import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'

// ============================================================================
// Types
// ============================================================================

/** Spread calculation modes */
export type SpreadMode = 'bps' | 'abs_brl' | 'flat'

/** Trade direction from client's perspective */
export type TradeSide = 'client_buys_usdt' | 'client_sells_usdt'

/** Currency for amount interpretation */
export type Currency = 'BRL' | 'USDT'

/** Language for response formatting */
export type Language = 'pt-BR' | 'en'

/** Deal flow mode */
export type DealFlowMode = 'classic' | 'simple'

/** Group language for bilingual prompts (simpler than Language) */
export type GroupLanguage = 'pt' | 'en'

/** Spread configuration for a group */
export interface SpreadConfig {
  groupJid: string
  spreadMode: SpreadMode
  sellSpread: number // When client BUYS USDT (eNor sells)
  buySpread: number // When client SELLS USDT (eNor buys)
  quoteTtlSeconds: number
  defaultSide: TradeSide
  defaultCurrency: Currency
  language: Language
  /** Sprint 9: Deal flow mode — 'classic' (3-step) or 'simple' (Daniel's 2-step) */
  dealFlowMode: DealFlowMode
  /** Sprint 9: Operator JID to @mention on deal completion/rejection */
  operatorJid: string | null
  /** Sprint 9: Seconds to wait for USDT amount after lock in simple mode */
  amountTimeoutSeconds: number
  /** Sprint 9: Language for bilingual prompts ('pt' or 'en') */
  groupLanguage: GroupLanguage
  createdAt: Date
  updatedAt: Date
}

/** Database row type (snake_case) */
interface SpreadConfigRow {
  group_jid: string
  spread_mode: SpreadMode
  sell_spread: number
  buy_spread: number
  quote_ttl_seconds: number
  default_side: TradeSide
  default_currency: Currency
  language: Language
  deal_flow_mode: DealFlowMode
  operator_jid: string | null
  amount_timeout_seconds: number
  group_language: GroupLanguage
  created_at: string
  updated_at: string
}

/** Default configuration used when no group-specific config exists */
const DEFAULT_CONFIG: Omit<SpreadConfig, 'groupJid' | 'createdAt' | 'updatedAt'> = {
  spreadMode: 'bps',
  sellSpread: 0,
  buySpread: 0,
  quoteTtlSeconds: 180,
  defaultSide: 'client_buys_usdt',
  defaultCurrency: 'BRL',
  language: 'pt-BR',
  dealFlowMode: 'classic',
  operatorJid: null,
  amountTimeoutSeconds: 60,
  groupLanguage: 'pt',
}

// ============================================================================
// Cache
// ============================================================================

/** In-memory cache for spread configs */
const spreadCache: Map<string, SpreadConfig> = new Map()

/** Cache TTL in milliseconds (5 minutes) */
const CACHE_TTL_MS = 5 * 60 * 1000

/** Maximum spread in basis points (±5%) */
const MAX_SPREAD_BPS = 500

/** Maximum spread in absolute BRL (±R$ 1.00) */
const MAX_SPREAD_ABS_BRL = 1.0

/** Decimal precision for rate calculations */
const RATE_PRECISION = 10000

/** Cache timestamps for TTL checking */
const cacheTimestamps: Map<string, number> = new Map()

/**
 * Check if cached entry is still valid
 */
function isCacheValid(groupJid: string): boolean {
  const timestamp = cacheTimestamps.get(groupJid)
  if (!timestamp) return false
  return Date.now() - timestamp < CACHE_TTL_MS
}

/**
 * Validate spread value is within acceptable bounds
 * Returns clamped value if out of bounds, with warning logged
 */
function validateSpread(spread: number, mode: SpreadMode, context: string): number {
  const maxSpread = mode === 'bps' ? MAX_SPREAD_BPS : MAX_SPREAD_ABS_BRL

  if (Math.abs(spread) > maxSpread) {
    const clampedSpread = Math.sign(spread) * maxSpread
    logger.warn('Spread value out of bounds, clamping', {
      event: 'spread_clamped',
      original: spread,
      clamped: clampedSpread,
      mode,
      context,
      maxAllowed: maxSpread,
    })
    return clampedSpread
  }

  return spread
}

/**
 * Clear cache for a specific group (called after updates)
 */
export function clearSpreadCache(groupJid?: string): void {
  if (groupJid) {
    spreadCache.delete(groupJid)
    cacheTimestamps.delete(groupJid)
  } else {
    spreadCache.clear()
    cacheTimestamps.clear()
  }
}

// ============================================================================
// Data Conversion
// ============================================================================

/**
 * Convert database row to SpreadConfig object
 */
function rowToConfig(row: SpreadConfigRow): SpreadConfig {
  return {
    groupJid: row.group_jid,
    spreadMode: row.spread_mode,
    sellSpread: Number(row.sell_spread),
    buySpread: Number(row.buy_spread),
    quoteTtlSeconds: row.quote_ttl_seconds,
    defaultSide: row.default_side,
    defaultCurrency: row.default_currency,
    language: row.language,
    dealFlowMode: row.deal_flow_mode ?? 'classic',
    operatorJid: row.operator_jid ?? null,
    amountTimeoutSeconds: row.amount_timeout_seconds ?? 60,
    groupLanguage: row.group_language ?? 'pt',
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

/**
 * Convert SpreadConfig to database row format
 */
function configToRow(config: Partial<SpreadConfig> & { groupJid: string }): Partial<SpreadConfigRow> {
  const row: Partial<SpreadConfigRow> = {
    group_jid: config.groupJid,
  }

  if (config.spreadMode !== undefined) row.spread_mode = config.spreadMode
  if (config.sellSpread !== undefined) row.sell_spread = config.sellSpread
  if (config.buySpread !== undefined) row.buy_spread = config.buySpread
  if (config.quoteTtlSeconds !== undefined) row.quote_ttl_seconds = config.quoteTtlSeconds
  if (config.defaultSide !== undefined) row.default_side = config.defaultSide
  if (config.defaultCurrency !== undefined) row.default_currency = config.defaultCurrency
  if (config.language !== undefined) row.language = config.language
  if (config.dealFlowMode !== undefined) row.deal_flow_mode = config.dealFlowMode
  if (config.operatorJid !== undefined) row.operator_jid = config.operatorJid
  if (config.amountTimeoutSeconds !== undefined) row.amount_timeout_seconds = config.amountTimeoutSeconds
  if (config.groupLanguage !== undefined) row.group_language = config.groupLanguage

  return row
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get spread configuration for a group.
 * Returns default config if no group-specific config exists.
 *
 * @param groupJid - The group JID to get config for
 * @returns SpreadConfig (always returns a valid config, with defaults if needed)
 */
export async function getSpreadConfig(groupJid: string): Promise<Result<SpreadConfig>> {
  // Check cache first
  if (isCacheValid(groupJid)) {
    const cached = spreadCache.get(groupJid)
    if (cached) {
      logger.debug('Spread config from cache', {
        event: 'spread_cache_hit',
        groupJid,
      })
      return ok(cached)
    }
  }

  const supabase = getSupabase()
  if (!supabase) {
    // Return default config if Supabase not available
    logger.warn('Supabase not initialized, using default spread config', {
      event: 'spread_config_default',
      groupJid,
    })
    return ok({
      ...DEFAULT_CONFIG,
      groupJid,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  try {
    const { data, error } = await supabase
      .from('group_spreads')
      .select('*')
      .eq('group_jid', groupJid)
      .single()

    if (error) {
      // PGRST116 = not found - return defaults
      if (error.code === 'PGRST116') {
        logger.debug('No spread config found, using defaults', {
          event: 'spread_config_default',
          groupJid,
        })
        const defaultConfig: SpreadConfig = {
          ...DEFAULT_CONFIG,
          groupJid,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        // Cache the default
        spreadCache.set(groupJid, defaultConfig)
        cacheTimestamps.set(groupJid, Date.now())
        return ok(defaultConfig)
      }

      logger.error('Failed to load spread config', {
        event: 'spread_config_error',
        groupJid,
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Failed to load spread config: ${error.message}`)
    }

    const config = rowToConfig(data as SpreadConfigRow)

    // Cache the result
    spreadCache.set(groupJid, config)
    cacheTimestamps.set(groupJid, Date.now())

    logger.debug('Spread config loaded', {
      event: 'spread_config_loaded',
      groupJid,
      spreadMode: config.spreadMode,
      sellSpread: config.sellSpread,
      buySpread: config.buySpread,
    })

    return ok(config)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Unexpected error loading spread config', {
      event: 'spread_config_exception',
      groupJid,
      error: errorMessage,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Create or update spread configuration for a group.
 *
 * @param config - Partial config with required groupJid
 * @returns Updated SpreadConfig
 */
export async function upsertSpreadConfig(
  config: Partial<SpreadConfig> & { groupJid: string }
): Promise<Result<SpreadConfig>> {
  const supabase = getSupabase()
  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    const row = configToRow(config)

    // M2 fix: Clear cache BEFORE DB operation to prevent race condition
    // where concurrent getSpreadConfig could re-populate with stale data
    clearSpreadCache(config.groupJid)

    const { data, error } = await supabase
      .from('group_spreads')
      .upsert(row, { onConflict: 'group_jid' })
      .select()
      .single()

    if (error) {
      logger.error('Failed to save spread config', {
        event: 'spread_config_save_error',
        groupJid: config.groupJid,
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Failed to save spread config: ${error.message}`)
    }

    const savedConfig = rowToConfig(data as SpreadConfigRow)

    logger.info('Spread config saved', {
      event: 'spread_config_saved',
      groupJid: config.groupJid,
      spreadMode: savedConfig.spreadMode,
      sellSpread: savedConfig.sellSpread,
      buySpread: savedConfig.buySpread,
    })

    return ok(savedConfig)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Unexpected error saving spread config', {
      event: 'spread_config_save_exception',
      groupJid: config.groupJid,
      error: errorMessage,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Get all spread configurations (for dashboard listing).
 */
export async function getAllSpreadConfigs(): Promise<Result<SpreadConfig[]>> {
  const supabase = getSupabase()
  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    const { data, error } = await supabase
      .from('group_spreads')
      .select('*')
      .order('updated_at', { ascending: false })

    if (error) {
      logger.error('Failed to load all spread configs', {
        event: 'spread_configs_error',
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Failed to load spread configs: ${error.message}`)
    }

    const configs = (data || []).map((row) => rowToConfig(row as SpreadConfigRow))

    logger.debug('All spread configs loaded', {
      event: 'spread_configs_loaded',
      count: configs.length,
    })

    return ok(configs)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Unexpected error loading spread configs', {
      event: 'spread_configs_exception',
      error: errorMessage,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}

// ============================================================================
// Quote Calculation
// ============================================================================

/**
 * Calculate the final quote rate with spread applied.
 *
 * @param binanceRate - Current Binance USDT/BRL rate (mid price)
 * @param config - Spread configuration for the group
 * @param side - Trade direction from client's perspective
 * @returns Final rate to quote to the client
 */
export function calculateQuote(
  binanceRate: number,
  config: SpreadConfig,
  side: TradeSide
): number {
  // Select spread based on trade direction
  // When client BUYS USDT, eNor SELLS → use sellSpread (typically positive)
  // When client SELLS USDT, eNor BUYS → use buySpread (typically negative)
  const rawSpread = side === 'client_buys_usdt' ? config.sellSpread : config.buySpread

  // Validate spread is within bounds (M1 fix: input validation)
  const spread = validateSpread(rawSpread, config.spreadMode, `${config.groupJid}:${side}`)

  let finalRate: number

  switch (config.spreadMode) {
    case 'bps':
      // Basis points: 1 bp = 0.01% = 0.0001
      // Positive spread increases rate (client pays more per USDT)
      // Negative spread decreases rate (client pays less per USDT)
      finalRate = binanceRate * (1 + spread / RATE_PRECISION)
      break

    case 'abs_brl':
      // Absolute BRL: add/subtract fixed amount
      finalRate = binanceRate + spread
      break

    case 'flat':
      // No spread
      finalRate = binanceRate
      break

    default:
      // Fallback to no spread
      finalRate = binanceRate
  }

  // Round to 4 decimal places for consistency
  return Math.round(finalRate * RATE_PRECISION) / RATE_PRECISION
}

/**
 * Calculate quotes for both directions (for "compra e venda?" requests)
 */
export function calculateBothQuotes(
  binanceRate: number,
  config: SpreadConfig
): { buyRate: number; sellRate: number } {
  return {
    buyRate: calculateQuote(binanceRate, config, 'client_buys_usdt'),
    sellRate: calculateQuote(binanceRate, config, 'client_sells_usdt'),
  }
}

// ============================================================================
// Cache Stats (for monitoring)
// ============================================================================

/**
 * Get cache statistics
 */
export function getSpreadCacheStats(): { size: number; entries: string[] } {
  return {
    size: spreadCache.size,
    entries: Array.from(spreadCache.keys()),
  }
}
