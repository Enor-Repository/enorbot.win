/**
 * Data Lake Service — Medallion Architecture (Bronze → Silver → Gold)
 *
 * Thin orchestration layer that:
 * - Emits raw events to Bronze tables (fire-and-forget, never blocks caller)
 * - Refreshes Silver aggregates (every 60s, piggybacked on sweep timer)
 * - Refreshes Gold aggregates (every 5 minutes)
 * - Runs Bronze retention cleanup (daily)
 */
import { getSupabase } from './supabase.js'
import { logger } from '../utils/logger.js'
import { getCurrentPrice } from './binanceWebSocket.js'

// ============================================================================
// Configuration
// ============================================================================

/** Throttle for Binance WS ticks — store at most one every 5 seconds */
const BINANCE_WS_THROTTLE_MS = 5_000

/** Silver refresh interval: 60 seconds */
const SILVER_REFRESH_INTERVAL_MS = 60_000

/** Gold refresh interval: 5 minutes */
const GOLD_REFRESH_INTERVAL_MS = 5 * 60_000

/** Bronze retention cleanup: once per day */
const RETENTION_CLEANUP_INTERVAL_MS = 24 * 60 * 60_000

// ============================================================================
// Module State
// ============================================================================

let silverTimer: ReturnType<typeof setInterval> | null = null
let goldTimer: ReturnType<typeof setInterval> | null = null
let retentionTimer: ReturnType<typeof setInterval> | null = null
let initialRefreshTimer: ReturnType<typeof setTimeout> | null = null

/** Track last Binance WS tick insertion for throttling */
let lastBinanceWsTick = 0

/** Invocation counter for gating group activity refresh (every 5th Silver cycle) */
let silverRefreshCount = 0

/** Concurrency guards — prevent overlapping refreshes */
let silverRefreshing = false
let goldRefreshing = false

// ============================================================================
// Bronze: Price Tick Emission
// ============================================================================

export type PriceSource = 'binance_ws' | 'binance_rest' | 'tradingview' | 'awesomeapi'

/**
 * Emit a raw price tick to bronze_price_ticks.
 * Fire-and-forget — never blocks the caller, never throws.
 * For binance_ws source, applies 5-second throttle.
 */
export function emitPriceTick(
  source: PriceSource,
  symbol: string,
  price: number,
  bid?: number,
  ask?: number
): void {
  // Throttle binance_ws ticks
  if (source === 'binance_ws') {
    const now = Date.now()
    if (now - lastBinanceWsTick < BINANCE_WS_THROTTLE_MS) return
    lastBinanceWsTick = now
  }

  const supabase = getSupabase()
  if (!supabase) return

  const row: Record<string, unknown> = {
    source,
    symbol,
    price,
    captured_at: new Date().toISOString(),
  }
  if (bid !== undefined) row.bid = bid
  if (ask !== undefined) row.ask = ask

  Promise.resolve()
    .then(() => supabase.from('bronze_price_ticks').insert(row))
    .then(({ error }) => {
      if (error) {
        logger.warn('Bronze tick insert failed', {
          event: 'bronze_tick_error',
          source,
          error: error.message,
        })
      }
    })
    .catch(() => {
      // Swallow — fire-and-forget
    })
}

// ============================================================================
// Bronze: Deal Event Emission
// ============================================================================

export interface DealEventInput {
  dealId: string
  groupJid: string
  clientJid: string
  fromState: string | null
  toState: string
  eventType: string
  marketPrice?: number
  dealSnapshot?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

/**
 * Emit a deal state transition event to bronze_deal_events.
 * Fire-and-forget — never blocks the caller, never throws.
 */
export function emitDealEvent(input: DealEventInput): void {
  const supabase = getSupabase()
  if (!supabase) return

  // Get current market price if not provided
  const marketPrice = input.marketPrice ?? getCurrentPrice() ?? undefined

  const row: Record<string, unknown> = {
    deal_id: input.dealId,
    group_jid: input.groupJid,
    client_jid: input.clientJid,
    from_state: input.fromState,
    to_state: input.toState,
    event_type: input.eventType,
    market_price: marketPrice,
    deal_snapshot: input.dealSnapshot ?? null,
    metadata: input.metadata ?? {},
    created_at: new Date().toISOString(),
  }

  Promise.resolve()
    .then(() => supabase.from('bronze_deal_events').insert(row))
    .then(({ error }) => {
      if (error) {
        logger.warn('Bronze deal event insert failed', {
          event: 'bronze_deal_event_error',
          dealId: input.dealId,
          eventType: input.eventType,
          error: error.message,
        })
      }
    })
    .catch(() => {
      // Swallow — fire-and-forget
    })
}

// ============================================================================
// Silver Layer Refresh
// ============================================================================

/**
 * Refresh all Silver layer tables.
 * Called every 60 seconds. Uses Postgres functions for heavy lifting.
 */
export async function refreshSilverLayer(): Promise<void> {
  if (silverRefreshing) return // Prevent overlapping runs
  silverRefreshing = true

  const supabase = getSupabase()
  if (!supabase) { silverRefreshing = false; return }

  const start = Date.now()
  silverRefreshCount++

  try {
    // Refresh OHLC candles (last 5 minutes of ticks)
    const { error: ohlcError } = await supabase.rpc('refresh_silver_ohlc')
    if (ohlcError) {
      logger.warn('Silver OHLC refresh failed', {
        event: 'silver_ohlc_error',
        error: ohlcError.message,
      })
    }

    // Refresh player stats (full replace from messages)
    const { error: playerError } = await supabase.rpc('refresh_silver_player_stats')
    if (playerError) {
      logger.warn('Silver player stats refresh failed', {
        event: 'silver_player_stats_error',
        error: playerError.message,
      })
    }

    // Refresh group activity (full replace, last 30 days)
    // Only run the full replace every 5th cycle (~5 minutes) to reduce load
    if (silverRefreshCount === 1 || silverRefreshCount % 5 === 0) {
      const { error: activityError } = await supabase.rpc('refresh_silver_group_activity')
      if (activityError) {
        logger.warn('Silver group activity refresh failed', {
          event: 'silver_group_activity_error',
          error: activityError.message,
        })
      }
    }

    const elapsed = Date.now() - start
    if (elapsed > 5000) {
      logger.warn('Silver refresh took too long', {
        event: 'silver_refresh_slow',
        elapsedMs: elapsed,
      })
    }
  } catch (e) {
    logger.warn('Silver refresh exception', {
      event: 'silver_refresh_exception',
      error: e instanceof Error ? e.message : String(e),
    })
  } finally {
    silverRefreshing = false
  }
}

// ============================================================================
// Gold Layer Refresh
// ============================================================================

/**
 * Refresh all Gold layer tables.
 * Called every 5 minutes. Uses the master refresh_gold_layer() Postgres function.
 */
export async function refreshGoldLayer(): Promise<void> {
  if (goldRefreshing) return // Prevent overlapping runs
  goldRefreshing = true

  const supabase = getSupabase()
  if (!supabase) { goldRefreshing = false; return }

  const start = Date.now()

  try {
    const { error } = await supabase.rpc('refresh_gold_layer')
    if (error) {
      logger.warn('Gold refresh failed', {
        event: 'gold_refresh_error',
        error: error.message,
      })
      return
    }

    const elapsed = Date.now() - start
    logger.info('Gold layer refreshed', {
      event: 'gold_refresh_complete',
      elapsedMs: elapsed,
    })
  } catch (e) {
    logger.warn('Gold refresh exception', {
      event: 'gold_refresh_exception',
      error: e instanceof Error ? e.message : String(e),
    })
  } finally {
    goldRefreshing = false
  }
}

// ============================================================================
// Bronze Retention Cleanup
// ============================================================================

/**
 * Run Bronze retention cleanup (delete ticks older than 90 days).
 */
export async function runRetentionCleanup(): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return

  try {
    const { data, error } = await supabase.rpc('bronze_retention_cleanup')
    if (error) {
      logger.warn('Bronze retention cleanup failed', {
        event: 'bronze_retention_error',
        error: error.message,
      })
      return
    }

    if (data && data > 0) {
      logger.info('Bronze retention cleanup completed', {
        event: 'bronze_retention_complete',
        deletedTicks: data,
      })
    }
  } catch (e) {
    logger.warn('Bronze retention exception', {
      event: 'bronze_retention_exception',
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

// ============================================================================
// Lifecycle: Start / Stop
// ============================================================================

/**
 * Start the Data Lake refresh timers.
 * Should be called once during bot initialization, after Supabase is ready.
 */
export function startDataLakeRefresh(): void {
  if (silverTimer || goldTimer || retentionTimer) return // Already running

  // Silver refresh every 60 seconds
  silverTimer = setInterval(() => {
    refreshSilverLayer().catch(() => {})
  }, SILVER_REFRESH_INTERVAL_MS)

  // Gold refresh every 5 minutes
  goldTimer = setInterval(() => {
    refreshGoldLayer().catch(() => {})
  }, GOLD_REFRESH_INTERVAL_MS)

  // Bronze retention cleanup once per day
  retentionTimer = setInterval(() => {
    runRetentionCleanup().catch(() => {})
  }, RETENTION_CLEANUP_INTERVAL_MS)

  // Run initial Silver + Gold refresh after 10 seconds (let data accumulate)
  initialRefreshTimer = setTimeout(() => {
    initialRefreshTimer = null
    refreshSilverLayer().catch(() => {})
    refreshGoldLayer().catch(() => {})
  }, 10_000)

  logger.info('Data Lake refresh timers started', {
    event: 'datalake_started',
    silverIntervalMs: SILVER_REFRESH_INTERVAL_MS,
    goldIntervalMs: GOLD_REFRESH_INTERVAL_MS,
  })
}

/**
 * Stop all Data Lake refresh timers.
 * Call during graceful shutdown.
 */
export function stopDataLakeRefresh(): void {
  if (silverTimer) {
    clearInterval(silverTimer)
    silverTimer = null
  }
  if (goldTimer) {
    clearInterval(goldTimer)
    goldTimer = null
  }
  if (retentionTimer) {
    clearInterval(retentionTimer)
    retentionTimer = null
  }
  if (initialRefreshTimer) {
    clearTimeout(initialRefreshTimer)
    initialRefreshTimer = null
  }
  silverRefreshCount = 0
  silverRefreshing = false
  goldRefreshing = false
  lastBinanceWsTick = 0

  logger.info('Data Lake refresh timers stopped', {
    event: 'datalake_stopped',
  })
}

// ============================================================================
// Testing Helpers
// ============================================================================

/** Reset module state for testing */
export function _resetForTesting(): void {
  stopDataLakeRefresh()
}

/** Expose throttle state for testing */
export function _getLastBinanceWsTick(): number {
  return lastBinanceWsTick
}

/** Set throttle state for testing */
export function _setLastBinanceWsTick(ts: number): void {
  lastBinanceWsTick = ts
}
