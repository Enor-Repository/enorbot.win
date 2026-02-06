/**
 * Volatility Monitor Service
 * Core engine that monitors price movements and triggers repricing when thresholds are breached.
 *
 * Flow:
 * 1. Subscribe to price updates from WebSocket
 * 2. On each update, check all active quotes against the active rule's spread threshold
 * 3. If threshold breached, attempt reprice (respecting state machine lock)
 * 4. After max reprices, escalate to control group and pause automation
 *
 * Threshold is derived from the active time-based rule's spread:
 * - If spreadMode is 'bps', use sellSpread as basis points
 * - If spreadMode is 'abs_brl', compare absolute price difference vs sellSpread
 * - If spreadMode is 'flat' or no rule, use default 30 bps
 */

import type { WASocket } from '@whiskeysockets/baileys'
import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'
import { onPriceUpdate, getCurrentPrice } from './binanceWebSocket.js'
import { fetchPrice } from './binance.js'
import {
  getActiveQuote,
  tryLockForReprice,
  unlockAfterReprice,
  incrementRepriceCount,
  getAllActiveQuotes,
} from './activeQuotes.js'
import { sendWithAntiDetection } from '../utils/messaging.js'
import { formatBrazilianPrice, formatDuration } from '../utils/format.js'
import { queueControlNotification } from '../bot/notifications.js'
import { getSupabase } from './supabase.js'
import { getActiveRule, type GroupRule } from './ruleService.js'

/**
 * The reprice cancellation message - EXACT STRING per OTC convention.
 */
const REPRICE_CANCEL_MESSAGE = 'off'

/**
 * Default threshold in basis points (0.30%) when no rule is active.
 */
const DEFAULT_THRESHOLD_BPS = 30

/**
 * Default max reprices before escalation.
 */
const DEFAULT_MAX_REPRICES = 3

/**
 * Threshold configuration - can be bps-based or absolute BRL-based.
 */
interface ThresholdConfig {
  mode: 'bps' | 'abs_brl' | 'flat'
  value: number // bps value or BRL amount depending on mode
}

/**
 * Cached volatility config per group.
 */
interface VolatilityConfig {
  enabled: boolean
  threshold: ThresholdConfig
  maxReprices: number
}

// Module state
let unsubscribe: (() => void) | null = null
let socket: WASocket | null = null
const configCache = new Map<string, VolatilityConfig>()

// Cache for active rules (shorter TTL since rules can change)
const ruleCache = new Map<string, { rule: GroupRule | null; cachedAt: number }>()
const RULE_CACHE_TTL_MS = 5000 // 5 seconds

// Track paused groups (after max reprices hit)
const pausedGroups = new Set<string>()

/**
 * Get the active rule for a group (with caching).
 */
async function getCachedActiveRule(groupJid: string): Promise<GroupRule | null> {
  const cached = ruleCache.get(groupJid)
  if (cached && Date.now() - cached.cachedAt < RULE_CACHE_TTL_MS) {
    return cached.rule
  }

  const result = await getActiveRule(groupJid)
  const rule = result.ok ? result.data : null
  ruleCache.set(groupJid, { rule, cachedAt: Date.now() })
  return rule
}

/**
 * Load volatility config for a group.
 * Threshold comes from active rule's spread; maxReprices and enabled from DB.
 */
async function loadConfig(groupJid: string): Promise<VolatilityConfig> {
  // Check cache first
  const cached = configCache.get(groupJid)
  if (cached) return cached

  // Get active rule for threshold
  const rule = await getCachedActiveRule(groupJid)

  // Determine threshold from rule's spread
  let threshold: ThresholdConfig
  if (rule) {
    if (rule.spreadMode === 'bps') {
      threshold = { mode: 'bps', value: rule.sellSpread }
    } else if (rule.spreadMode === 'abs_brl') {
      threshold = { mode: 'abs_brl', value: rule.sellSpread }
    } else {
      // flat mode - no spread, use default
      threshold = { mode: 'bps', value: DEFAULT_THRESHOLD_BPS }
    }
  } else {
    // No active rule - use default
    threshold = { mode: 'bps', value: DEFAULT_THRESHOLD_BPS }
  }

  // Load enabled/maxReprices from Supabase
  const supabase = getSupabase()
  let enabled = true
  let maxReprices = DEFAULT_MAX_REPRICES

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('group_volatility_config')
        .select('enabled, max_reprices')
        .eq('group_jid', groupJid)
        .single()

      if (!error && data) {
        enabled = data.enabled
        maxReprices = data.max_reprices
      }
    } catch (e) {
      logger.warn('Failed to load volatility config from DB, using defaults', {
        event: 'volatility_config_load_error',
        groupJid,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const config: VolatilityConfig = { enabled, threshold, maxReprices }
  configCache.set(groupJid, config)
  return config
}

/**
 * Clear config cache for a group (call when config is updated via API).
 */
export function invalidateConfigCache(groupJid: string): void {
  configCache.delete(groupJid)
  ruleCache.delete(groupJid)
}

/**
 * Clear all config cache (for testing).
 */
export function clearConfigCache(): void {
  configCache.clear()
  ruleCache.clear()
}

/**
 * Check if a price has breached the threshold for a quote.
 * Supports both bps-based and absolute BRL-based thresholds.
 *
 * Key business insight:
 * - We BUY at market (USDT/BRL), we SELL to customer at quoted price (market + spread)
 * - We only care about UPWARD market movement (market rising toward our quote)
 * - If market goes DOWN, we have MORE margin (good for us) - no action needed
 * - Trigger when market rises to or past our quoted price (margin exhausted)
 *
 * This applies to BOTH bps and abs_brl modes - we never reprice on downward movement.
 */
export function checkThresholdBreach(
  quotedPrice: number,
  currentPrice: number,
  threshold: ThresholdConfig
): boolean {
  // First check: is market ABOVE our quote? (losing money scenario)
  // Only trigger on UPWARD movement - downward is always good for us
  if (currentPrice < quotedPrice) {
    return false // Market below quote = we have margin, no breach
  }

  if (threshold.mode === 'bps') {
    // For bps mode: check if upward deviation exceeds threshold
    const deviationBps = ((currentPrice - quotedPrice) / quotedPrice) * 10000
    return deviationBps >= threshold.value
  } else if (threshold.mode === 'abs_brl') {
    // For abs_brl mode: market at or above quote = margin exhausted
    // (we already checked currentPrice >= quotedPrice above via < check)
    return true
  } else {
    // flat mode - no threshold checking
    return false
  }
}

/**
 * Legacy function for backwards compatibility with tests.
 * @deprecated Use checkThresholdBreach with ThresholdConfig instead.
 */
export function checkThresholdBreachBps(
  quotedPrice: number,
  currentPrice: number,
  thresholdBps: number
): boolean {
  return checkThresholdBreach(quotedPrice, currentPrice, { mode: 'bps', value: thresholdBps })
}

/**
 * Handle price update - check all active quotes for threshold breaches.
 *
 * Business logic:
 * - We BUY at USDT/BRL (Binance) - this is our actual cost
 * - We QUOTE at commercial dollar + spread (or USDT/BRL + spread) - this is what customer sees
 * - If USDT/BRL (our cost) rises above the quoted price, we're losing money
 * - So we ALWAYS compare USDT/BRL vs quotedPrice, regardless of price source used for quoting
 * - Threshold comes from the active time-based rule's spread (bps or centavos)
 */
async function handlePriceUpdate(currentPrice: number): Promise<void> {
  const activeQuotes = getAllActiveQuotes()
  if (activeQuotes.length === 0) return

  for (const quote of activeQuotes) {
    // Skip if group is paused after max reprices
    if (pausedGroups.has(quote.groupJid)) continue

    // Skip if quote is not in pending state
    if (quote.status !== 'pending') continue

    // Load config for this group (includes threshold from active rule)
    // Note: Cache is invalidated via invalidateConfigCache() when rules change via API
    const config = await loadConfig(quote.groupJid)

    // Skip if volatility protection is disabled for this group
    if (!config.enabled) continue

    // Check threshold breach using rule's spread mode
    const breached = checkThresholdBreach(quote.quotedPrice, currentPrice, config.threshold)

    if (breached) {
      const deviationBps = Math.round(
        (Math.abs(currentPrice - quote.quotedPrice) / quote.quotedPrice) * 10000
      )
      const absoluteDiff = Math.abs(currentPrice - quote.quotedPrice)

      logger.info('Threshold breach detected', {
        event: 'threshold_breach',
        groupJid: quote.groupJid,
        quotedPrice: quote.quotedPrice,
        currentUsdtBrl: currentPrice,
        priceSource: quote.priceSource,
        thresholdMode: config.threshold.mode,
        thresholdValue: config.threshold.value,
        deviationBps,
        absoluteDiffBrl: absoluteDiff.toFixed(4),
      })

      await triggerReprice(quote.groupJid, config)
    }
  }
}

/**
 * Trigger reprice flow for a group.
 * 1. Lock quote for repricing (prevents concurrent reprices)
 * 2. Send "off" message
 * 3. Fetch fresh USDT/BRL price (our actual cost basis)
 * 4. Send new price
 * 5. Unlock and update quote
 * 6. Check for escalation
 *
 * Note: We always use USDT/BRL for repricing because that's our actual cost.
 * The original quote may have used commercial dollar + spread, but repricing
 * sends raw USDT/BRL. TODO: Consider applying spread from group config.
 */
async function triggerReprice(groupJid: string, config: VolatilityConfig): Promise<Result<void>> {
  if (!socket) {
    logger.warn('Cannot reprice - socket not initialized', {
      event: 'reprice_skip_no_socket',
      groupJid,
    })
    return err('Socket not initialized')
  }

  // Try to lock the quote for repricing
  const locked = tryLockForReprice(groupJid)
  if (!locked) {
    logger.debug('Cannot reprice - quote not lockable', {
      event: 'reprice_skip_locked',
      groupJid,
    })
    return ok(undefined) // Not an error - just concurrent reprice prevented
  }

  const quote = getActiveQuote(groupJid)
  if (!quote) {
    logger.warn('Quote disappeared during reprice lock', {
      event: 'reprice_quote_missing',
      groupJid,
    })
    return err('Quote not found')
  }

  const startTime = Date.now()

  try {
    // Step 1: Send "off" message
    logger.info('Sending reprice cancellation', {
      event: 'reprice_cancel_sending',
      groupJid,
    })

    const cancelResult = await sendWithAntiDetection(socket, groupJid, REPRICE_CANCEL_MESSAGE)
    if (!cancelResult.ok) {
      unlockAfterReprice(groupJid, quote.quotedPrice) // Unlock with original price
      return err(`Failed to send cancel: ${cancelResult.error}`)
    }

    // Step 2: Fetch fresh USDT/BRL price
    const priceResult = await fetchPrice()
    if (!priceResult.ok) {
      unlockAfterReprice(groupJid, quote.quotedPrice) // Unlock with original price
      return err(`Failed to fetch price: ${priceResult.error}`)
    }

    const newPrice = priceResult.data

    // Step 3: Apply spread from active rule (same logic as original quote)
    const rule = await getCachedActiveRule(groupJid)
    let finalPrice = newPrice

    if (rule && rule.sellSpread > 0) {
      if (rule.spreadMode === 'bps') {
        // Apply bps spread: price * (1 + spread/10000)
        finalPrice = newPrice * (1 + rule.sellSpread / 10000)
      } else if (rule.spreadMode === 'abs_brl') {
        // Apply absolute BRL spread: price + spread
        finalPrice = newPrice + rule.sellSpread
      }
      // flat mode: no spread applied

      logger.debug('Reprice spread applied', {
        event: 'reprice_spread_applied',
        groupJid,
        basePrice: newPrice,
        finalPrice,
        spreadMode: rule.spreadMode,
        spreadValue: rule.sellSpread,
        ruleName: rule.name,
      })
    }

    // Step 4: Send new price
    const priceMessage = formatBrazilianPrice(finalPrice)
    const sendResult = await sendWithAntiDetection(socket, groupJid, priceMessage)
    if (!sendResult.ok) {
      unlockAfterReprice(groupJid, quote.quotedPrice) // Unlock with original price
      return err(`Failed to send new price: ${sendResult.error}`)
    }

    // Step 5: Increment reprice count and unlock
    const repriceCount = incrementRepriceCount(groupJid)
    unlockAfterReprice(groupJid, finalPrice)

    const duration = Date.now() - startTime

    logger.info('Reprice completed', {
      event: 'reprice_complete',
      groupJid,
      oldPrice: quote.quotedPrice,
      newPrice: finalPrice,
      repriceCount,
      durationMs: duration,
    })

    // Step 6: Check for escalation
    if (repriceCount >= config.maxReprices) {
      await triggerEscalation(groupJid, quote.quotedPrice, finalPrice, repriceCount, duration)
    }

    return ok(undefined)
  } catch (e) {
    // Ensure we unlock on any error
    unlockAfterReprice(groupJid, quote?.quotedPrice ?? 0)
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Reprice failed', {
      event: 'reprice_error',
      groupJid,
      error: errorMessage,
    })
    return err(errorMessage)
  }
}

/**
 * Trigger escalation after max reprices reached.
 * Order is critical to prevent orphan paused states:
 * 1. Persist to database first (so dashboard can display and dismiss)
 * 2. Only pause automation if persist succeeds
 * 3. Send control group notification
 */
async function triggerEscalation(
  groupJid: string,
  quotePrice: number,
  marketPrice: number,
  repriceCount: number,
  durationMs: number
): Promise<void> {
  logger.warn('Volatility escalation triggered', {
    event: 'volatility_escalation',
    groupJid,
    repriceCount,
    quotePrice,
    marketPrice,
  })

  // Get group name (could be enhanced to fetch from metadata)
  const groupName = groupJid.replace('@g.us', '')

  // Step 1: Persist to database FIRST (critical for dashboard dismiss flow)
  const supabase = getSupabase()
  if (supabase) {
    const { error } = await supabase.from('volatility_escalations').insert({
      group_jid: groupJid,
      quote_price: quotePrice,
      market_price: marketPrice,
      reprice_count: repriceCount,
    })

    if (error) {
      // DO NOT pause if we can't persist - dashboard won't be able to dismiss
      logger.error('Failed to persist escalation - NOT pausing group', {
        event: 'escalation_persist_error',
        groupJid,
        error: error.message,
      })
      // Still send notification so operator knows something is wrong
      await queueControlNotification(`⚠️ VOLATILITY ALERT (DB ERROR)

Group: ${groupName}
Repriced ${repriceCount}x but failed to save escalation.
Group NOT paused due to DB error.

Error: ${error.message}`)
      return
    }
  }

  // Step 2: Pause automation only after successful DB persist
  pausedGroups.add(groupJid)

  // Step 3: Send control group notification
  const message = `⚠️ VOLATILITY ALERT

Group: ${groupName}
Repriced ${repriceCount}x in ${formatDuration(durationMs)}
Automation paused for this quote.

Last price: ${formatBrazilianPrice(quotePrice)}
Current market: ${formatBrazilianPrice(marketPrice)}

Manual intervention required.`

  await queueControlNotification(message)
}

/**
 * Check if a group is paused (after max reprices).
 */
export function isGroupPaused(groupJid: string): boolean {
  return pausedGroups.has(groupJid)
}

/**
 * Unpause a group (when escalation is dismissed).
 */
export function unpauseGroup(groupJid: string): void {
  pausedGroups.delete(groupJid)
  logger.info('Group unpaused', {
    event: 'group_unpaused',
    groupJid,
  })
}

/**
 * Initialize the volatility monitor with WhatsApp socket.
 * Call after WhatsApp connection is established.
 */
export function initializeVolatilityMonitor(sock: WASocket): void {
  socket = sock
  logger.info('Volatility monitor socket initialized', {
    event: 'volatility_monitor_socket_init',
  })
}

/**
 * Start monitoring price updates for volatility.
 * Call on bot startup.
 */
export function startMonitoring(): void {
  if (unsubscribe) {
    logger.debug('Monitoring already started', { event: 'monitoring_already_started' })
    return
  }

  unsubscribe = onPriceUpdate(async (price) => {
    try {
      await handlePriceUpdate(price)
    } catch (e) {
      logger.error('Error in price update handler', {
        event: 'price_handler_error',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  })

  logger.info('Volatility monitoring started', {
    event: 'volatility_monitoring_started',
  })
}

/**
 * Stop monitoring price updates.
 * Call on graceful shutdown.
 */
export function stopMonitoring(): void {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  socket = null
  configCache.clear()
  ruleCache.clear()
  pausedGroups.clear()

  logger.info('Volatility monitoring stopped', {
    event: 'volatility_monitoring_stopped',
  })
}

// For testing
export function _resetForTesting(): void {
  stopMonitoring()
}

/**
 * Manually trigger a threshold check (for testing/debugging).
 */
export async function manualThresholdCheck(): Promise<void> {
  const price = getCurrentPrice()
  if (price !== null) {
    await handlePriceUpdate(price)
  }
}
