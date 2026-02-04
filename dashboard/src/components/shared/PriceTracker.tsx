/**
 * Price Tracker Component
 * Shows live USDT/BRL from Binance and Commercial Dollar from AwesomeAPI
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { TrendingUp, RefreshCw, DollarSign, Clock } from 'lucide-react'
import { API_BASE_URL } from '@/lib/api'

// Constants
const PRICE_REFRESH_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes
const MIN_VALID_PRICE = 1.0 // Minimum reasonable USDT/BRL price
const MAX_VALID_PRICE = 10.0 // Maximum reasonable USDT/BRL price

interface CommercialDollarData {
  bid: number
  ask: number
  spread: number
  timestamp: string
  cached: boolean
  cacheAge: number
}

interface PriceData {
  usdtBrl: number | null
  commercialDollar: CommercialDollarData | null
  lastUpdate: Date | null
  loading: boolean
  error: string | null
}

export function PriceTracker() {
  const [prices, setPrices] = useState<PriceData>({
    usdtBrl: null,
    commercialDollar: null,
    lastUpdate: null,
    loading: true,
    error: null,
  })

  // Use ref to prevent stale closure issues with intervals
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchPrices = useCallback(async (forceRefresh = false) => {
    try {
      setPrices((prev) => ({ ...prev, loading: true, error: null }))

      // Fetch both prices in parallel via our backend proxy (avoids CORS)
      // When forceRefresh=true, bypass server-side cache to get fresh data
      const commercialUrl = forceRefresh
        ? `${API_BASE_URL}/api/prices/commercial-dollar?force=true`
        : `${API_BASE_URL}/api/prices/commercial-dollar`

      const [binanceResponse, commercialResponse] = await Promise.allSettled([
        fetch(`${API_BASE_URL}/api/prices/usdt-brl`),
        fetch(commercialUrl),
      ])

      let usdtBrl: number | null = null
      let commercialDollar: CommercialDollarData | null = null

      // Process USDT/BRL response (via our backend proxy)
      if (binanceResponse.status === 'fulfilled' && binanceResponse.value.ok) {
        const data = await binanceResponse.value.json()
        // Our proxy returns { price: number, ... } directly
        const price = typeof data.price === 'number' ? data.price : parseFloat(data.price)
        if (!isNaN(price) && price >= MIN_VALID_PRICE && price <= MAX_VALID_PRICE) {
          usdtBrl = price
        }
      }

      // Process Commercial Dollar response (from our cached backend)
      if (commercialResponse.status === 'fulfilled' && commercialResponse.value.ok) {
        const data = await commercialResponse.value.json()
        if (data && data.bid && data.ask) {
          commercialDollar = {
            bid: data.bid,
            ask: data.ask,
            spread: data.spread,
            timestamp: data.timestamp,
            cached: data.cached,
            cacheAge: data.cacheAge,
          }
        }
      } else if (commercialResponse.status === 'fulfilled') {
        // Log error but don't fail - commercial dollar is optional
        const errorData = await commercialResponse.value.json().catch(() => ({}))
        if (import.meta.env.DEV) {
          console.warn('Commercial dollar fetch failed:', errorData.error || 'Unknown error')
        }
      }

      setPrices({
        usdtBrl,
        commercialDollar,
        lastUpdate: new Date(),
        loading: false,
        error: usdtBrl === null ? 'Failed to fetch USDT/BRL' : null,
      })
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Price fetch error:', error)
      }

      // Keep last known values if available, only show error if no data at all
      setPrices((prev) => ({
        ...prev,
        loading: false,
        error: prev.usdtBrl === null
          ? (error instanceof Error ? error.message : 'Failed to fetch prices')
          : null,
      }))
    }
  }, [])

  // Initial fetch (uses cache if available)
  useEffect(() => {
    fetchPrices(false)
  }, [fetchPrices])

  // Auto-refresh with proper cleanup
  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }

    // Set new interval (auto-refresh uses cache, no force)
    intervalRef.current = setInterval(() => fetchPrices(false), PRICE_REFRESH_INTERVAL_MS)

    // Cleanup on unmount
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [fetchPrices])

  const formatPrice = (price: number | null) => {
    if (price === null) return '---'
    return price.toLocaleString('pt-BR', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    })
  }

  const formatLastUpdate = (date: Date | null) => {
    if (!date) return 'Never'
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just now'
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
          ) : prices.error ? (
            <div className="text-xs font-mono text-red-400">Error: {prices.error}</div>
          ) : (
            <>
              <div className="text-xl font-bold text-amber-300 font-mono tabular-nums">
                R$ {formatPrice(prices.usdtBrl)}
              </div>
              <p className="text-xs text-muted-foreground mt-2 font-mono flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-green-400" />
                {formatLastUpdate(prices.lastUpdate)}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Commercial Dollar Card */}
      <div className="border-blue-500/30 bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent shadow-sm hover:shadow-blue-500/10 transition-shadow rounded-lg border p-3">
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
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground font-mono">Compra / Bid</span>
                  <span className="text-sm font-bold text-blue-300 font-mono tabular-nums">
                    R$ {formatPrice(prices.commercialDollar.bid)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground font-mono">Venda / Ask</span>
                  <span className="text-sm font-bold text-blue-300 font-mono tabular-nums">
                    R$ {formatPrice(prices.commercialDollar.ask)}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-blue-500/20">
                <p className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
                  <TrendingUp className="h-2.5 w-2.5 text-green-400" />
                  {formatLastUpdate(prices.lastUpdate)}
                </p>
                {prices.commercialDollar.cached && (
                  <span className="text-[9px] text-blue-400/60 font-mono flex items-center gap-0.5" title="Server-side cached to protect API quota">
                    <Clock className="h-2.5 w-2.5" />
                    cached
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-bold text-blue-300 font-mono tabular-nums opacity-40">
                R$ ---
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 font-mono">
                Not available
              </p>
            </>
          )}
        </div>
      </div>

      {/* Manual Refresh Button */}
      <button
        onClick={() => fetchPrices(true)}
        disabled={prices.loading}
        className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded border border-border/30 bg-muted/20 hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors text-xs font-mono disabled:opacity-50"
      >
        <RefreshCw className={`h-3 w-3 ${prices.loading ? 'animate-spin' : ''}`} />
        {prices.loading ? 'Updating...' : 'Refresh'}
      </button>
    </div>
  )
}
