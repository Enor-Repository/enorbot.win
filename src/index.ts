import { createServer, type Server } from 'http'
import { validateConfig } from './config.js'
import { logger } from './utils/logger.js'
import { initSupabase } from './services/supabase.js'
import { initGroupConfigs } from './services/groupConfig.js'
import { checkBackupPermissions } from './services/authBackup.js'
import { createConnection, getSocket } from './bot/connection.js'
import { startDealSweepTimer, stopDealSweepTimer } from './handlers/deal.js'
// TradingView scraper for commercial dollar pricing
import { startScraper, stopScraper } from './services/tradingViewScraper.js'
// Volatility Protection: WebSocket and monitoring services
import { startWebSocket, stopWebSocket } from './services/binanceWebSocket.js'
import { startMonitoring, stopMonitoring } from './services/volatilityMonitor.js'
import { expireOldQuotes } from './services/activeQuotes.js'
// Medallion Data Architecture: Bronze → Silver → Gold
import { startDataLakeRefresh, stopDataLakeRefresh } from './services/dataLake.js'

let healthServer: Server | null = null
let quoteCleanupInterval: NodeJS.Timeout | null = null

// Quote cleanup interval (60 seconds)
const QUOTE_CLEANUP_INTERVAL_MS = 60 * 1000

/**
 * Entry point for eNorBOT.
 * - Validates configuration (using Result pattern)
 * - Starts health endpoint
 * - Initializes WhatsApp connection
 */
async function main(): Promise<void> {
  logger.info('eNorBOT starting', { version: '1.0.0' })

  // Validate configuration using Result pattern
  const configResult = validateConfig()
  if (!configResult.ok) {
    logger.error('Startup failed', { reason: configResult.error })
    process.exit(1)
  }
  const config = configResult.data

  // Initialize Supabase for session persistence
  initSupabase(config)

  // Initialize group config service for per-group modes
  const groupConfigResult = await initGroupConfigs(config)
  if (!groupConfigResult.ok) {
    logger.warn('Group config initialization failed, using defaults', {
      event: 'group_config_init_warning',
      error: groupConfigResult.error,
    })
  }

  // Story 5.4: Initialize auth state backup directory
  const backupCheck = await checkBackupPermissions()
  if (!backupCheck.ok) {
    logger.warn('Auth backup directory not writable', {
      event: 'backup_init_warning',
      error: backupCheck.error,
    })
  }

  // Start health endpoint
  healthServer = createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
  })

  healthServer.listen(config.HEALTH_PORT, () => {
    logger.info('Health endpoint started', { port: config.HEALTH_PORT })
  })

  // Start dashboard server (only if enabled and express is available)
  if (config.DASHBOARD_ENABLED) {
    try {
      const { startDashboardServer } = await import('./dashboard/server.js')
      startDashboardServer()
    } catch (err) {
      logger.warn('Dashboard server not started', {
        event: 'dashboard_start_skipped',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Sprint 4: Start periodic deal TTL sweep (every 30s)
  startDealSweepTimer()

  // Commercial dollar: Start TradingView scraper (non-fatal if fails)
  startScraper().catch((error) => {
    logger.warn('TradingView scraper failed to start, will use AwesomeAPI fallback', {
      event: 'tradingview_start_error',
      error: error instanceof Error ? error.message : String(error),
    })
  })

  // Volatility Protection: Start Binance WebSocket IMMEDIATELY
  // Price streaming is independent of WhatsApp connection
  startWebSocket()

  // Volatility Protection: Start monitoring (subscribes to price updates)
  startMonitoring()

  // Volatility Protection: Periodic cleanup of expired quotes (every 60s)
  quoteCleanupInterval = setInterval(() => {
    expireOldQuotes().catch(() => { /* logged internally */ })
  }, QUOTE_CLEANUP_INTERVAL_MS)

  logger.info('Volatility protection services started', {
    event: 'volatility_protection_started',
    cleanupIntervalMs: QUOTE_CLEANUP_INTERVAL_MS,
  })

  // Medallion Data Architecture: Start Silver/Gold refresh timers
  startDataLakeRefresh()

  // Initialize WhatsApp connection
  await createConnection(config)
}

/**
 * Graceful shutdown handler for PM2 and manual termination.
 */
function shutdown(signal: string): void {
  logger.info('Shutdown initiated', { signal })

  // Stop deal sweep timer
  stopDealSweepTimer()

  // Stop data sources first (stop generating events)
  stopScraper().catch(() => {})
  if (quoteCleanupInterval) {
    clearInterval(quoteCleanupInterval)
    quoteCleanupInterval = null
  }
  stopMonitoring()
  stopWebSocket()

  // Stop data lake consumers after sources are stopped
  stopDataLakeRefresh()

  // Close health server
  if (healthServer) {
    healthServer.close(() => {
      logger.info('Health server closed')
    })
  }

  // Close WhatsApp socket
  const sock = getSocket()
  if (sock) {
    sock.end(undefined)
    logger.info('WhatsApp socket closed')
  }

  // Exit after cleanup (give 1s for graceful close)
  setTimeout(() => {
    logger.info('Shutdown complete')
    process.exit(0)
  }, 1000)
}

// Graceful shutdown on SIGTERM (PM2) and SIGINT (Ctrl+C)
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack })
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) })
  process.exit(1)
})

// Start the application
main().catch((error) => {
  logger.error('Failed to start', { error: error.message })
  process.exit(1)
})
