/**
 * Price Tracker Component
 * Shows live USDT/BRL from Binance and Commercial Dollar from TradingView
 *
 * Polling strategy:
 * - Commercial dollar: 1s interval (TradingView title reads are instant)
 * - USDT/BRL: 30s interval (supplementary to SSE stream)
 *
 * Staleness detection:
 * - Each price source tracks its own last-successful-update timestamp
 * - A 1s ticker re-evaluates staleness so the UI reacts within seconds
 * - Visual states: fresh (< 5s), stale-warning (5–30s), stale-error (> 30s)
 *
 * Note on the 1s ticker (setNow): When the commercial dollar poll is working,
 * the component already re-renders every 1s from setPrices() calls. The ticker
 * only adds extra re-renders when fetches STOP — exactly when we need them to
 * drive the staleness indicator forward. When both are firing, they're redundant.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { TrendingUp, RefreshCw, DollarSign, AlertTriangle } from 'lucide-react'
import { API_BASE_URL } from '@/lib/api'

// Constants
const COMMERCIAL_REFRESH_MS = 1_000 // 1 second — TradingView title reads are free
const USDT_REFRESH_MS = 1_000 // 1 second — match commercial dollar refresh rate
const STALENESS_CHECK_MS = 1_000 // Re-evaluate staleness every 1 second
const STALE_WARNING_MS = 5_000 // Show warning after 5s without update
const STALE_ERROR_MS = 30_000 // Show error state after 30s without update
const USDT_STALE_WARNING_MS = 5_000 // Warn after 5s (same as commercial)
const USDT_STALE_ERROR_MS = 30_000 // Error after 30s (same as commercial)
const MIN_VALID_PRICE = 1.0 // Minimum reasonable USDT/BRL price
const MAX_VALID_PRICE = 10.0 // Maximum reasonable USDT/BRL price

interface CommercialDollarData {
  price: number
  timestamp: string
}

interface PriceData {
  usdtBrl: number | null
  commercialDollar: CommercialDollarData | null
  lastCommercialUpdate: Date | null
  lastUsdtUpdate: Date | null
  loading: boolean
  usdtError: string | null
  commercialError: string | null
}

type Staleness = 'fresh' | 'warning' | 'error'

/** Freshness indicator icon — defined outside component for stable identity */
function FreshnessIcon({ staleness }: { staleness: Staleness }) {
  if (staleness === 'error') return <AlertTriangle className="h-3 w-3 text-red-400" />
  if (staleness === 'warning') return <AlertTriangle className="h-3 w-3 text-amber-400" />
  return <TrendingUp className="h-3 w-3 text-green-400" />
}

export function PriceTracker() {
  const [prices, setPrices] = useState<PriceData>({
    usdtBrl: null,
    commercialDollar: null,
    lastCommercialUpdate: null,
    lastUsdtUpdate: null,
    loading: true,
    usdtError: null,
    commercialError: null,
  })

  // Current time tick — drives staleness re-evaluation
  const [now, setNow] = useState(() => Date.now())

  // Interval refs for independent cleanup
  const commercialIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const usdtIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Guard against overlapping commercial dollar fetches (1s interval can pile up)
  const fetchingCommercialRef = useRef(false)

  /**
   * Fetch commercial dollar from TradingView scraper via backend.
   * Runs every 1 second. Overlap-guarded to prevent request pile-up.
   * ALL failure paths surface an error in state — nothing is swallowed.
   */
  const fetchCommercialDollar = useCallback(async () => {
    if (fetchingCommercialRef.current) return
    fetchingCommercialRef.current = true

    try {
      const response = await fetch(`${API_BASE_URL}/api/prices/commercial-dollar`)
      if (!response.ok) {
        setPrices((prev) => ({
          ...prev,
          commercialError: `HTTP ${response.status}`,
          loading: false,
        }))
        return
      }

      const data = await response.json()
      if (!data || typeof data.price !== 'number' || isNaN(data.price)) {
        setPrices((prev) => ({
          ...prev,
          commercialError: 'Invalid response',
          loading: false,
        }))
        return
      }

      setPrices((prev) => ({
        ...prev,
        commercialDollar: { price: data.price, timestamp: data.timestamp },
        lastCommercialUpdate: new Date(),
        commercialError: null,
        loading: false,
      }))
    } catch (error) {
      setPrices((prev) => ({
        ...prev,
        commercialError: error instanceof Error ? error.message : 'Network error',
        loading: false,
      }))
    } finally {
      fetchingCommercialRef.current = false
    }
  }, [])

  /**
   * Fetch USDT/BRL from Binance via backend proxy.
   * Runs every 30 seconds (SSE handles real-time streaming).
   * ALL failure paths surface an error in state.
   */
  const fetchUsdtBrl = useCallback(async () => {
    try {
      // Only show loading spinner on first fetch
      setPrices((prev) => prev.usdtBrl === null
        ? { ...prev, loading: true, usdtError: null }
        : prev,
      )

      const response = await fetch(`${API_BASE_URL}/api/prices/usdt-brl`)
      if (!response.ok) {
        setPrices((prev) => ({
          ...prev,
          loading: false,
          usdtError: `HTTP ${response.status}`,
        }))
        return
      }

      const data = await response.json()
      const price = typeof data.price === 'number' ? data.price : parseFloat(data.price)
      if (isNaN(price) || price < MIN_VALID_PRICE || price > MAX_VALID_PRICE) {
        setPrices((prev) => ({
          ...prev,
          loading: false,
          usdtError: 'Invalid price',
        }))
        return
      }

      setPrices((prev) => ({
        ...prev,
        usdtBrl: price,
        lastUsdtUpdate: new Date(),
        loading: false,
        usdtError: null,
      }))
    } catch (error) {
      setPrices((prev) => ({
        ...prev,
        loading: false,
        usdtError: error instanceof Error ? error.message : 'Network error',
      }))
    }
  }, [])

  // Initial fetch for both prices
  useEffect(() => {
    fetchUsdtBrl()
    fetchCommercialDollar()
  }, [fetchUsdtBrl, fetchCommercialDollar])

  // Commercial dollar: 1s interval
  useEffect(() => {
    commercialIntervalRef.current = setInterval(fetchCommercialDollar, COMMERCIAL_REFRESH_MS)
    return () => {
      if (commercialIntervalRef.current) {
        clearInterval(commercialIntervalRef.current)
        commercialIntervalRef.current = null
      }
    }
  }, [fetchCommercialDollar])

  // USDT/BRL: 30s interval (SSE handles real-time)
  useEffect(() => {
    usdtIntervalRef.current = setInterval(fetchUsdtBrl, USDT_REFRESH_MS)
    return () => {
      if (usdtIntervalRef.current) {
        clearInterval(usdtIntervalRef.current)
        usdtIntervalRef.current = null
      }
    }
  }, [fetchUsdtBrl])

  // Staleness ticker — re-evaluates every 1s so the UI reacts promptly
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), STALENESS_CHECK_MS)
    return () => clearInterval(id)
  }, [])

  // Compute staleness for each price source
  const commercialStaleness: Staleness = (() => {
    if (!prices.lastCommercialUpdate) return prices.commercialDollar ? 'warning' : 'fresh'
    const age = now - prices.lastCommercialUpdate.getTime()
    if (age > STALE_ERROR_MS) return 'error'
    if (age > STALE_WARNING_MS) return 'warning'
    return 'fresh'
  })()

  const usdtStaleness: Staleness = (() => {
    if (!prices.lastUsdtUpdate) return prices.usdtBrl ? 'warning' : 'fresh'
    const age = now - prices.lastUsdtUpdate.getTime()
    if (age > USDT_STALE_ERROR_MS) return 'error'
    if (age > USDT_STALE_WARNING_MS) return 'warning'
    return 'fresh'
  })()

  const formatPrice = (price: number | null) => {
    if (price === null) return '---'
    return price.toLocaleString('pt-BR', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    })
  }

  const formatLastUpdate = (date: Date | null) => {
    if (!date) return 'Never'
    const diffMs = now - date.getTime()
    const diffSecs = Math.floor(diffMs / 1000)

    if (diffSecs < 5) return 'Just now'
    if (diffSecs < 60) return `${diffSecs}s ago`
    const diffMins = Math.floor(diffSecs / 60)
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    return `${diffHours}h ${diffMins % 60}m ago`
  }

  return (
    <div className="space-y-3">
      {/* USDT/BRL Card */}
      <div className="border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent shadow-sm hover:shadow-amber-500/10 transition-shadow rounded-lg border p-3">
        <div className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="text-xs font-mono font-semibold text-amber-100 uppercase tracking-wider">
            USDT/BRL
          </div>
          <div className="h-5 w-5 rounded bg-amber-500/20 flex items-center justify-center">
            <DollarSign className="h-3 w-3 text-amber-400" />
          </div>
        </div>

        <div className="mt-2">
          {prices.loading && !prices.usdtBrl ? (
            <div className="flex items-center gap-2">
              <RefreshCw className="h-3 w-3 animate-spin text-amber-400" />
              <span className="text-xs font-mono text-muted-foreground">Loading...</span>
            </div>
          ) : (
            <>
              <div className={`text-xl font-bold font-mono tabular-nums ${
                usdtStaleness === 'error' ? 'text-red-400 opacity-60' :
                usdtStaleness === 'warning' ? 'text-amber-300 opacity-70' :
                'text-amber-300'
              }`}>
                R$ {formatPrice(prices.usdtBrl)}
              </div>
              <p className="text-xs text-muted-foreground mt-2 font-mono flex items-center gap-1">
                <FreshnessIcon staleness={usdtStaleness} />
                {usdtStaleness === 'error'
                  ? <span className="text-red-400">Connection lost — {formatLastUpdate(prices.lastUsdtUpdate)}</span>
                  : usdtStaleness === 'warning'
                  ? <span className="text-amber-400">Stale — {formatLastUpdate(prices.lastUsdtUpdate)}</span>
                  : formatLastUpdate(prices.lastUsdtUpdate)
                }
              </p>
            </>
          )}
        </div>
      </div>

      {/* Commercial Dollar Card */}
      <div className={`bg-gradient-to-br shadow-sm transition-shadow rounded-lg border p-3 ${
        commercialStaleness === 'error'
          ? 'border-red-500/30 from-red-500/10 via-red-500/5 to-transparent hover:shadow-red-500/10'
          : commercialStaleness === 'warning'
          ? 'border-amber-500/30 from-amber-500/10 via-amber-500/5 to-transparent hover:shadow-amber-500/10'
          : 'border-blue-500/30 from-blue-500/10 via-blue-500/5 to-transparent hover:shadow-blue-500/10'
      }`}>
        <div className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="text-xs font-mono font-semibold text-blue-100 uppercase tracking-wider">
            Dólar Comercial
          </div>
          <div className="h-5 w-5 rounded bg-blue-500/20 flex items-center justify-center">
            <DollarSign className="h-3 w-3 text-blue-400" />
          </div>
        </div>

        <div className="mt-2">
          {prices.loading && !prices.commercialDollar ? (
            <div className="flex items-center gap-2">
              <RefreshCw className="h-3 w-3 animate-spin text-blue-400" />
              <span className="text-xs font-mono text-muted-foreground">Loading...</span>
            </div>
          ) : prices.commercialDollar ? (
            <>
              <div className={`text-xl font-bold font-mono tabular-nums ${
                commercialStaleness === 'error' ? 'text-red-400 opacity-60' :
                commercialStaleness === 'warning' ? 'text-amber-400 opacity-70' :
                'text-blue-300'
              }`}>
                R$ {formatPrice(prices.commercialDollar.price)}
              </div>
              <p className="text-xs text-muted-foreground mt-2 font-mono flex items-center gap-1">
                <FreshnessIcon staleness={commercialStaleness} />
                {commercialStaleness === 'error'
                  ? <span className="text-red-400">Connection lost — {formatLastUpdate(prices.lastCommercialUpdate)}</span>
                  : commercialStaleness === 'warning'
                  ? <span className="text-amber-400">Stale — {formatLastUpdate(prices.lastCommercialUpdate)}</span>
                  : formatLastUpdate(prices.lastCommercialUpdate)
                }
              </p>
            </>
          ) : (
            <>
              <div className="text-xl font-bold text-blue-300 font-mono tabular-nums opacity-40">
                R$ ---
              </div>
              <p className="text-xs text-muted-foreground mt-2 font-mono">
                {prices.commercialError
                  ? <span className="text-red-400">{prices.commercialError}</span>
                  : 'Not available'
                }
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
