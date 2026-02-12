/**
 * TradingView Scraper Service for commercial USD/BRL exchange rate.
 *
 * Strategy:
 * - Launches a stealth headless Chromium (playwright-extra + stealth plugin)
 * - Navigates to TradingView's generic chart for FX_IDC:USDBRL
 * - TradingView auto-updates the page title with the live price (e.g. "USDBRL 5,2169 ▼ −1.05%")
 * - On demand: reads the page title to extract the current price — zero DOM queries, zero interaction
 * - TradingView is the sole runtime source for commercial dollar quotes
 *
 * Lifecycle follows the same pattern as binanceWebSocket.ts:
 * - startScraper() on bot startup
 * - stopScraper() on graceful shutdown
 * - Exponential backoff reconnection on failures
 */

import { chromium as playwrightChromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser, Page } from 'playwright-core'
import { logger } from '../utils/logger.js'
import { recordSuccess, recordFailure } from './errors.js'
import { emitPriceTick } from './dataLake.js'

// Apply stealth plugin to avoid bot detection
playwrightChromium.use(StealthPlugin())

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TRADINGVIEW_URL =
  process.env.TRADINGVIEW_URL ||
  'https://br.tradingview.com/chart/?symbol=FX_IDC%3AUSDBRL'

/** Max time to wait for the page title to contain a price on initial load. */
const PAGE_LOAD_TIMEOUT_MS = 30_000

/** How long to wait for chart rendering after domcontentloaded. */
const CHART_RENDER_WAIT_MS = 12_000

/** Price is considered stale after this many ms without a successful read. */
const STALE_THRESHOLD_MS = Number(process.env.TRADINGVIEW_STALE_MS) || 120_000

/** If the price hasn't changed for this long, the page is likely frozen. */
const FROZEN_PRICE_THRESHOLD_MS = Number(process.env.TRADINGVIEW_FROZEN_MS) || 90_000

/** How often the watchdog checks for a frozen price. */
const WATCHDOG_INTERVAL_MS = Number(process.env.TRADINGVIEW_WATCHDOG_MS) || 15_000

/** Max page navigations (refresh/reconnect) per hour. Initial startup is exempt. */
const MAX_NAVIGATIONS_PER_HOUR = Number(process.env.TRADINGVIEW_MAX_NAV_PER_HOUR) || 12

/**
 * If navigation budget is exhausted, allow one controlled bypass at this interval.
 * Avoids prolonged stale prices when TradingView needs a forced refresh.
 */
const RATE_LIMIT_BYPASS_INTERVAL_MS = Number(process.env.TRADINGVIEW_RATE_LIMIT_BYPASS_MS) || 5 * 60_000

/** Reconnection backoff settings (matches binanceWebSocket.ts). */
const INITIAL_RECONNECT_DELAY_MS = 2_000
const MAX_RECONNECT_DELAY_MS = 30_000
const RECONNECT_MULTIPLIER = 2

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

type ScraperStatus = 'stopped' | 'starting' | 'running' | 'reconnecting'

let browser: Browser | null = null
let page: Page | null = null
let currentPrice: number | null = null
let lastSuccessfulRead: number | null = null
let lastPriceChange: number | null = null
let status: ScraperStatus = 'stopped'
let reconnectDelay = INITIAL_RECONNECT_DELAY_MS
let reconnectTimer: NodeJS.Timeout | null = null
let watchdogTimer: NodeJS.Timeout | null = null
let lastRateLimitBypassAt = 0

/** Sliding window of navigation timestamps (refreshes + reconnects, NOT initial startup). */
let navigationTimestamps: number[] = []

// ---------------------------------------------------------------------------
// Title parsing
// ---------------------------------------------------------------------------

/**
 * Parse USD/BRL price from TradingView page title.
 * Expected format: "USDBRL 5,2169 ▼ −1.05%" or "USDBRL 5.2169 ▲ +0.5%"
 *
 * @returns Parsed price or null if not found/invalid.
 */
export function parsePriceFromTitle(title: string): number | null {
  // Match "USDBRL" followed by a price with comma or period decimal separator
  const match = title.match(/USDBRL\s+(\d+[.,]\d+)/)
  if (!match) return null

  const cleaned = match[1].replace(',', '.')
  const price = parseFloat(cleaned)

  // Sanity check: USD/BRL should be between 3 and 10
  if (!Number.isFinite(price) || price < 3 || price > 10) return null

  return price
}

// ---------------------------------------------------------------------------
// Core: read price from page title
// ---------------------------------------------------------------------------

/**
 * Read the current price by checking the page title.
 * TradingView updates the title in real-time via its own WebSocket.
 * This is the least detectable approach — no DOM queries, no element interaction.
 */
async function readPriceFromTitle(): Promise<number | null> {
  if (!page) return null

  try {
    const title = await page.title()
    return parsePriceFromTitle(title)
  } catch (error) {
    logger.warn('Failed to read TradingView page title', {
      event: 'tradingview_title_read_error',
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// ---------------------------------------------------------------------------
// Browser lifecycle
// ---------------------------------------------------------------------------

/**
 * Launch the stealth browser and navigate to TradingView.
 */
async function launchBrowser(): Promise<boolean> {
  try {
    browser = await playwrightChromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    })

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    })

    page = await context.newPage()

    logger.info('Navigating to TradingView', {
      event: 'tradingview_navigating',
      url: TRADINGVIEW_URL,
    })

    await page.goto(TRADINGVIEW_URL, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_LOAD_TIMEOUT_MS,
    })

    // Wait for chart to render and title to populate with price
    // Using plain setTimeout instead of page.waitForTimeout to avoid
    // Playwright-internal lifecycle issues in production cluster mode
    await new Promise((resolve) => setTimeout(resolve, CHART_RENDER_WAIT_MS))

    // Verify we got a price
    const price = await readPriceFromTitle()
    if (price === null) {
      const title = await page.title().catch(() => '(unknown)')
      logger.error('TradingView page loaded but no price in title', {
        event: 'tradingview_no_price_in_title',
        title,
      })
      return false
    }

    currentPrice = price
    lastSuccessfulRead = Date.now()
    lastPriceChange = Date.now()
    reconnectDelay = INITIAL_RECONNECT_DELAY_MS

    logger.info('TradingView scraper ready', {
      event: 'tradingview_scraper_ready',
      price,
    })

    recordSuccess('tradingview')
    return true
  } catch (error) {
    logger.error('Failed to launch TradingView scraper', {
      event: 'tradingview_launch_error',
      error: error instanceof Error ? error.message : String(error),
    })
    recordFailure('tradingview')
    return false
  }
}

/**
 * Close browser and clean up resources.
 */
async function closeBrowser(): Promise<void> {
  try {
    if (browser) {
      await browser.close()
    }
  } catch {
    // Browser may already be closed
  }
  browser = null
  page = null
}

/**
 * Schedule reconnection with exponential backoff.
 */
function scheduleReconnect(): void {
  if (reconnectTimer || status === 'stopped') return

  status = 'reconnecting'

  logger.info('Scheduling TradingView scraper reconnection', {
    event: 'tradingview_reconnect_scheduled',
    delayMs: reconnectDelay,
  })

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null

    if (!canNavigateWithBypass('reconnect')) {
      logger.warn('Navigation rate limit reached — deferring reconnect until bypass cooldown', {
        event: 'tradingview_reconnect_rate_limited',
        navigationsInLastHour: navigationsUsed(),
        maxPerHour: MAX_NAVIGATIONS_PER_HOUR,
        bypassIntervalMs: RATE_LIMIT_BYPASS_INTERVAL_MS,
      })
      // Retry after the max backoff delay; budget may have replenished by then
      reconnectDelay = MAX_RECONNECT_DELAY_MS
      scheduleReconnect()
      return
    }

    recordNavigation()
    await closeBrowser()

    const success = await launchBrowser()
    if (success) {
      status = 'running'
      startWatchdog()
    } else {
      reconnectDelay = Math.min(reconnectDelay * RECONNECT_MULTIPLIER, MAX_RECONNECT_DELAY_MS)
      scheduleReconnect()
    }
  }, reconnectDelay)

  reconnectDelay = Math.min(reconnectDelay * RECONNECT_MULTIPLIER, MAX_RECONNECT_DELAY_MS)
}

// ---------------------------------------------------------------------------
// Navigation rate limiter (prevents bans from too many page loads)
// ---------------------------------------------------------------------------

/**
 * Check if we're allowed to navigate (refresh or reconnect).
 * Prunes timestamps older than 1 hour, then checks against the cap.
 */
function canNavigate(): boolean {
  const oneHourAgo = Date.now() - 60 * 60_000
  navigationTimestamps = navigationTimestamps.filter((t) => t > oneHourAgo)
  return navigationTimestamps.length < MAX_NAVIGATIONS_PER_HOUR
}

function recordNavigation(): void {
  navigationTimestamps.push(Date.now())
}

function navigationsUsed(): number {
  const oneHourAgo = Date.now() - 60 * 60_000
  navigationTimestamps = navigationTimestamps.filter((t) => t > oneHourAgo)
  return navigationTimestamps.length
}

/**
 * Allow navigation if budget exists, or bypass rate limiting with cooldown.
 */
function canNavigateWithBypass(reason: 'refresh' | 'reconnect'): boolean {
  if (canNavigate()) return true

  const now = Date.now()
  const elapsed = now - lastRateLimitBypassAt
  if (elapsed >= RATE_LIMIT_BYPASS_INTERVAL_MS) {
    lastRateLimitBypassAt = now
    logger.warn('TradingView navigation budget exhausted — applying controlled bypass', {
      event: 'tradingview_rate_limit_bypass',
      reason,
      bypassIntervalMs: RATE_LIMIT_BYPASS_INTERVAL_MS,
      navigationsInLastHour: navigationsUsed(),
      maxPerHour: MAX_NAVIGATIONS_PER_HOUR,
    })
    return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Watchdog: detect frozen price (TradingView internal WS may silently drop)
// ---------------------------------------------------------------------------

/**
 * Refresh the page without closing the browser.
 * Lighter than a full reconnect — just re-navigates.
 */
async function refreshPage(): Promise<boolean> {
  if (!page) return false

  if (!canNavigateWithBypass('refresh')) {
    logger.warn('Navigation rate limit reached — skipping refresh until bypass cooldown', {
      event: 'tradingview_rate_limited',
      navigationsInLastHour: navigationsUsed(),
      maxPerHour: MAX_NAVIGATIONS_PER_HOUR,
      bypassIntervalMs: RATE_LIMIT_BYPASS_INTERVAL_MS,
    })
    return false
  }

  recordNavigation()

  try {
    logger.info('Refreshing TradingView page', {
      event: 'tradingview_page_refresh',
      navigationBudget: `${navigationsUsed()}/${MAX_NAVIGATIONS_PER_HOUR}`,
    })

    await page.goto(TRADINGVIEW_URL, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_LOAD_TIMEOUT_MS,
    })
    await new Promise((resolve) => setTimeout(resolve, CHART_RENDER_WAIT_MS))

    const price = await readPriceFromTitle()
    if (price !== null) {
      currentPrice = price
      lastSuccessfulRead = Date.now()
      lastPriceChange = Date.now()
      recordSuccess('tradingview')
      logger.info('TradingView page refreshed successfully', {
        event: 'tradingview_page_refresh_success',
        price,
      })
      return true
    }

    logger.warn('TradingView page refresh got no price', {
      event: 'tradingview_page_refresh_no_price',
    })
    return false
  } catch (error) {
    logger.error('TradingView page refresh failed', {
      event: 'tradingview_page_refresh_error',
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Watchdog tick: check if the price has been frozen too long.
 * If so, refresh the page. If refresh fails, trigger full reconnect.
 */
async function watchdogTick(): Promise<void> {
  if (status !== 'running' || !page) return

  // Read the current title to see if it's changed
  const price = await readPriceFromTitle()
  if (price !== null && price !== currentPrice) {
    // Price is moving — update tracking
    currentPrice = price
    lastSuccessfulRead = Date.now()
    lastPriceChange = Date.now()
    return
  }

  // Check if frozen
  if (!lastPriceChange) return
  const frozenMs = Date.now() - lastPriceChange
  if (frozenMs < FROZEN_PRICE_THRESHOLD_MS) return

  logger.warn('TradingView price appears frozen — refreshing page', {
    event: 'tradingview_price_frozen',
    frozenMs,
    lastPrice: currentPrice,
    navigationBudget: `${navigationsUsed()}/${MAX_NAVIGATIONS_PER_HOUR}`,
  })

  const refreshed = await refreshPage()
  if (!refreshed) {
    logger.error('Page refresh failed — triggering full reconnect', {
      event: 'tradingview_watchdog_reconnect',
    })
    scheduleReconnect()
  }
}

function startWatchdog(): void {
  stopWatchdog()
  watchdogTimer = setInterval(() => {
    watchdogTick().catch((err) => {
      logger.error('Watchdog tick error', {
        event: 'tradingview_watchdog_error',
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }, WATCHDOG_INTERVAL_MS)
}

function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the TradingView scraper.
 * Launches headless Chromium with stealth, navigates to TradingView chart.
 * Non-fatal: if launch fails, commercial-dollar pricing stays unavailable until recovery.
 */
export async function startScraper(): Promise<void> {
  if (status !== 'stopped') {
    logger.warn('TradingView scraper already running', {
      event: 'tradingview_already_running',
      status,
    })
    return
  }

  status = 'starting'

  logger.info('Starting TradingView scraper service', {
    event: 'tradingview_service_start',
    url: TRADINGVIEW_URL,
  })

  const success = await launchBrowser()
  if (success) {
    status = 'running'
    startWatchdog()
  } else {
    status = 'reconnecting'
    scheduleReconnect()
  }
}

/**
 * Stop the TradingView scraper and release all resources.
 * Called on graceful shutdown.
 */
export async function stopScraper(): Promise<void> {
  logger.info('Stopping TradingView scraper service', {
    event: 'tradingview_service_stop',
  })

  status = 'stopped'

  stopWatchdog()

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  await closeBrowser()

  currentPrice = null
  lastSuccessfulRead = null
  lastPriceChange = null
  lastRateLimitBypassAt = 0
  reconnectDelay = INITIAL_RECONNECT_DELAY_MS
  navigationTimestamps = []
}

/**
 * Get the current commercial dollar price from TradingView.
 * Reads the page title on demand — no polling, no DOM queries.
 * Returns null if the scraper isn't running or the page has gone stale.
 */
export async function getCommercialDollarPrice(): Promise<number | null> {
  if (status !== 'running' || !page) return null

  const price = await readPriceFromTitle()

  if (price !== null) {
    if (price !== currentPrice) {
      lastPriceChange = Date.now()
    }
    currentPrice = price
    lastSuccessfulRead = Date.now()
    recordSuccess('tradingview')

    // Bronze layer: emit price tick
    emitPriceTick('tradingview', 'USD/BRL', price)

    return price
  }

  // Title read failed — page may have gone stale
  const escalated = recordFailure('tradingview')
  if (escalated) {
    logger.error('TradingView scraper consecutive failures — triggering reconnect', {
      event: 'tradingview_escalated_failure',
    })
    scheduleReconnect()
  }

  // Return cached price if still fresh
  if (currentPrice !== null && lastSuccessfulRead !== null) {
    const age = Date.now() - lastSuccessfulRead
    if (age < STALE_THRESHOLD_MS) {
      logger.warn('Returning cached TradingView price', {
        event: 'tradingview_using_cache',
        price: currentPrice,
        ageMs: age,
      })
      return currentPrice
    }
  }

  return null
}

/**
 * Check if the scraped price is stale.
 */
export function isScraperStale(): boolean {
  if (!lastSuccessfulRead) return true
  return Date.now() - lastSuccessfulRead > STALE_THRESHOLD_MS
}

/**
 * Get the current scraper status for health/dashboard.
 */
export function getScraperStatus(): {
  status: ScraperStatus
  currentPrice: number | null
  lastSuccessfulRead: number | null
  lastPriceChange: number | null
  stale: boolean
} {
  return {
    status,
    currentPrice,
    lastSuccessfulRead,
    lastPriceChange,
    stale: isScraperStale(),
  }
}

/**
 * Reset module state for testing.
 */
export async function _resetForTesting(): Promise<void> {
  await stopScraper()
}
