/**
 * Group Spread Editor Component - Volatility Protection Widget
 * Shows real-time USDT/BRL chart with threshold derived from active time-based rule
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { AlertTriangle, Activity, Settings, XCircle, Wifi, WifiOff, Info } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts'
import { API_ENDPOINTS, writeHeaders } from '../../lib/api'

interface GroupSpreadEditorProps {
  groupJid?: string
  hideTitle?: boolean
  onCountChange?: (count: number) => void
}

interface VolatilityConfig {
  enabled: boolean
  maxReprices: number
  isDefault?: boolean
}

interface PricePoint {
  timestamp: number
  price: number
}

interface Escalation {
  id: string
  groupJid: string
  escalatedAt: string
  quotePrice: number
  marketPrice: number
  repriceCount: number
}

interface ActiveQuote {
  hasActiveQuote: boolean
  quotedPrice: number | null
  priceSource: string | null
  quotedAt: string | null
  repriceCount: number | null
  status: string | null
}

interface ActiveRule {
  id: string
  name: string
  pricingSource: 'commercial_dollar' | 'usdt_binance'
  spreadMode: 'bps' | 'abs_brl' | 'flat'
  sellSpread: number
  buySpread: number
}

const DEFAULT_CONFIG: VolatilityConfig = {
  enabled: true,
  maxReprices: 3,
  isDefault: true,
}

// Buffer 60 seconds of price data
const PRICE_BUFFER_SIZE = 60

export function GroupSpreadEditor({ groupJid, hideTitle, onCountChange }: GroupSpreadEditorProps) {
  const [config, setConfig] = useState<VolatilityConfig>(DEFAULT_CONFIG)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [priceData, setPriceData] = useState<PricePoint[]>([])
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting')
  const [activeEscalation, setActiveEscalation] = useState<Escalation | null>(null)
  const [activeQuote, setActiveQuote] = useState<ActiveQuote | null>(null)
  const [activeRule, setActiveRule] = useState<ActiveRule | null>(null)
  const [showSettings, setShowSettings] = useState(true)

  const eventSourceRef = useRef<EventSource | null>(null)

  // Report count to parent (1 if has config, 0 if default)
  useEffect(() => {
    onCountChange?.(config.isDefault ? 0 : 1)
  }, [config.isDefault, onCountChange])

  // Load volatility config (now only has enabled + maxReprices)
  const loadConfig = useCallback(async () => {
    if (!groupJid) return

    try {
      const response = await fetch(API_ENDPOINTS.groupVolatility(groupJid))
      if (!response.ok) throw new Error('Failed to load config')
      const data = await response.json()
      setConfig({
        enabled: data.enabled,
        maxReprices: data.maxReprices,
        isDefault: data.isDefault,
      })
    } catch (e) {
      console.error('Failed to load volatility config:', e)
      setConfig(DEFAULT_CONFIG)
    } finally {
      setIsLoading(false)
    }
  }, [groupJid])

  // Load active time-based rule (provides threshold)
  const loadActiveRule = useCallback(async () => {
    if (!groupJid) return

    try {
      const response = await fetch(API_ENDPOINTS.groupActiveRule(groupJid))
      if (!response.ok) return
      const data = await response.json()
      if (data.hasActiveRule && data.activeRule) {
        setActiveRule(data.activeRule)
      } else {
        setActiveRule(null)
      }
    } catch {
      // Non-fatal
    }
  }, [groupJid])

  // Load active escalations
  const loadEscalations = useCallback(async () => {
    if (!groupJid) return

    try {
      const response = await fetch(`${API_ENDPOINTS.groupEscalations(groupJid)}?active=true`)
      if (!response.ok) return
      const data = await response.json()
      if (data.escalations?.length > 0) {
        setActiveEscalation(data.escalations[0])
      } else {
        setActiveEscalation(null)
      }
    } catch {
      // Non-fatal
    }
  }, [groupJid])

  // Load active quote for threshold baseline
  const loadActiveQuote = useCallback(async () => {
    if (!groupJid) return

    try {
      const response = await fetch(API_ENDPOINTS.groupQuote(groupJid))
      if (!response.ok) return
      const data = await response.json()
      setActiveQuote(data)
    } catch {
      // Non-fatal
    }
  }, [groupJid])

  // Connect to SSE price stream
  useEffect(() => {
    const eventSource = new EventSource(API_ENDPOINTS.priceStream)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      setConnectionStatus('connected')
    }

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.price !== null && data.price !== undefined) {
          setCurrentPrice(data.price)
          setPriceData((prev) => {
            const newPoint = { timestamp: data.timestamp, price: data.price }
            const updated = [...prev, newPoint]
            // Keep only last 60 seconds
            return updated.slice(-PRICE_BUFFER_SIZE)
          })
        }
        if (data.connectionStatus) {
          setConnectionStatus(data.connectionStatus)
        }
      } catch {
        // Ignore parse errors
      }
    }

    eventSource.onerror = () => {
      setConnectionStatus('disconnected')
    }

    return () => {
      eventSource.close()
      eventSourceRef.current = null
    }
  }, [])

  // Load config, escalations, active quote, and active rule on mount
  useEffect(() => {
    loadConfig()
    loadEscalations()
    loadActiveQuote()
    loadActiveRule()

    // Poll active quote and rule every 5 seconds (they can change)
    const pollInterval = setInterval(() => {
      loadActiveQuote()
      loadActiveRule()
    }, 5000)
    return () => clearInterval(pollInterval)
  }, [loadConfig, loadEscalations, loadActiveQuote, loadActiveRule])

  // Save config changes (only enabled + maxReprices)
  const saveConfig = async (updates: Partial<VolatilityConfig>) => {
    if (!groupJid) return

    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch(API_ENDPOINTS.groupVolatility(groupJid), {
        method: 'PUT',
        headers: writeHeaders(),
        body: JSON.stringify(updates),
      })

      if (!response.ok) throw new Error('Failed to save config')
      const data = await response.json()
      setConfig({
        enabled: data.enabled,
        maxReprices: data.maxReprices,
        isDefault: data.isDefault,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  // Dismiss escalation
  const dismissEscalation = async () => {
    if (!groupJid || !activeEscalation) return

    try {
      await fetch(API_ENDPOINTS.groupEscalationDismiss(groupJid, activeEscalation.id), {
        method: 'POST',
        headers: writeHeaders(),
      })
      setActiveEscalation(null)
    } catch {
      // Non-fatal
    }
  }

  // Get threshold from active rule's spread (or default 30 bps)
  const getThresholdFromRule = (): { value: number; unit: 'bps' | 'centavos'; displayText: string; isDefault: boolean } => {
    if (!activeRule) {
      // No active rule - show default 30 bps
      return {
        value: 30,
        unit: 'bps',
        displayText: '30 bps (padrão)',
        isDefault: true,
      }
    }

    const spread = activeRule.sellSpread // Use sell spread (when client buys USDT)

    if (activeRule.spreadMode === 'bps') {
      return {
        value: spread,
        unit: 'bps',
        displayText: `${spread} bps`,
        isDefault: false,
      }
    } else if (activeRule.spreadMode === 'abs_brl') {
      // Convert to centavos for display (spread is in BRL)
      const centavos = Math.round(spread * 100)
      return {
        value: spread,
        unit: 'centavos',
        displayText: `${centavos} centavo${centavos !== 1 ? 's' : ''}`,
        isDefault: false,
      }
    } else {
      // flat mode - no spread
      return {
        value: 0,
        unit: 'bps',
        displayText: 'flat (sem spread)',
        isDefault: false,
      }
    }
  }

  // Calculate threshold lines for chart
  // Uses QUOTED PRICE as baseline (what we told customer) - not current market price
  // Threshold comes from the active rule's spread
  const getThresholdLines = () => {
    const ruleThreshold = getThresholdFromRule()

    // If we have an active quote, use the quoted price as baseline
    if (activeQuote?.hasActiveQuote && activeQuote.quotedPrice) {
      const baseline = activeQuote.quotedPrice

      if (!ruleThreshold || ruleThreshold.value === 0) {
        return { baseline, upper: null, lower: null, hasQuote: true }
      }

      let thresholdAmount: number
      if (ruleThreshold.unit === 'bps') {
        // Convert bps to percentage
        thresholdAmount = baseline * (ruleThreshold.value / 10000)
      } else {
        // abs_brl - use the spread value directly as BRL amount
        thresholdAmount = ruleThreshold.value
      }

      return {
        baseline,
        upper: baseline + thresholdAmount,
        lower: baseline - thresholdAmount,
        hasQuote: true,
      }
    }

    // No active quote - don't show any lines (no misleading placeholder)
    return { upper: null, lower: null, baseline: null, hasQuote: false }
  }

  const thresholds = getThresholdLines()
  const ruleThreshold = getThresholdFromRule()

  // Compute Y-axis domain to always include quoted price (resistance line)
  const getYAxisDomain = (): [number, number] | [string, string] => {
    if (priceData.length === 0) {
      return ['dataMin - 0.001', 'dataMax + 0.001'] as [string, string]
    }

    const prices = priceData.map(p => p.price)
    let minPrice = Math.min(...prices)
    let maxPrice = Math.max(...prices)

    // Include quoted price in the range if we have an active quote
    if (activeQuote?.hasActiveQuote && activeQuote.quotedPrice) {
      const quotedPrice = activeQuote.quotedPrice
      minPrice = Math.min(minPrice, quotedPrice)
      maxPrice = Math.max(maxPrice, quotedPrice)
    }

    // Add padding (0.1% on each side)
    const range = maxPrice - minPrice
    const padding = Math.max(range * 0.1, 0.002) // At least 0.002 padding

    return [minPrice - padding, maxPrice + padding]
  }

  // Format price for display
  const formatPrice = (price: number) => price.toFixed(4).replace('.', ',')

  // Format time for x-axis (Brazil timezone: America/Sao_Paulo)
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  }

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-amber-500/10 rounded w-1/3"></div>
        <div className="h-48 bg-amber-500/10 rounded"></div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      {!hideTitle && (
        <div className="pb-2 border-b border-amber-500/10 flex items-center justify-between">
          <h4 className="text-xs font-mono text-amber-400 uppercase tracking-widest flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-amber-400 animate-pulse"></span>
            Volatility Protection
          </h4>
          <div className="flex items-center gap-2">
            {connectionStatus === 'connected' ? (
              <Wifi className="h-4 w-4 text-green-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-red-400" />
            )}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-1 hover:bg-amber-500/10 rounded transition-colors"
            >
              <Settings className="h-4 w-4 text-amber-400" />
            </button>
          </div>
        </div>
      )}

      {/* Escalation Alert Banner */}
      {activeEscalation && (
        <div className="bg-red-500/20 border border-red-500/50 rounded-md p-3 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-red-300 font-mono text-sm font-bold">
              {activeEscalation.repriceCount}x reprices reached
            </p>
            <p className="text-red-400/80 text-xs mt-1">
              Quote: {formatPrice(activeEscalation.quotePrice)} → Market: {formatPrice(activeEscalation.marketPrice)}
            </p>
            <p className="text-red-400/60 text-xs">
              Manual intervention required
            </p>
          </div>
          <button
            onClick={dismissEscalation}
            className="p-1 hover:bg-red-500/20 rounded transition-colors"
            title="Dismiss alert"
          >
            <XCircle className="h-4 w-4 text-red-400" />
          </button>
        </div>
      )}

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-zinc-800/50 rounded-md p-3 space-y-3 border border-amber-500/10">
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between">
            <label className="text-xs text-amber-300 font-mono">Enabled</label>
            <button
              onClick={() => saveConfig({ enabled: !config.enabled })}
              disabled={isSaving}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                config.enabled ? 'bg-amber-500' : 'bg-zinc-600'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  config.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Threshold Display (read-only, from active rule) */}
          <div className="flex items-center justify-between">
            <label className="text-xs text-amber-300 font-mono flex items-center gap-1">
              Threshold
              <Info className="h-3 w-3 text-amber-400/50" title="Derived from active time-based rule" />
            </label>
            <span className={`text-xs font-mono bg-zinc-900 px-2 py-1 rounded border border-amber-500/10 ${
              ruleThreshold.isDefault ? 'text-amber-300/50' : 'text-amber-300/80'
            }`}>
              {ruleThreshold.displayText}
            </span>
          </div>

          {/* Active Rule Info */}
          {activeRule ? (
            <p className="text-xs text-amber-400/50">
              Regra: {activeRule.name}
              {activeRule.pricingSource === 'commercial_dollar' && ' (dólar comercial)'}
            </p>
          ) : (
            <p className="text-xs text-amber-400/40">
              Nenhuma regra ativa - usando threshold padrão
            </p>
          )}

          {/* Max Reprices Input (still editable) */}
          <div className="flex items-center justify-between">
            <label className="text-xs text-amber-300 font-mono">Max Reprices</label>
            <input
              type="number"
              min={1}
              max={10}
              value={config.maxReprices}
              onChange={(e) => {
                const value = Math.max(1, Math.min(10, Math.round(Number(e.target.value))))
                setConfig((prev) => ({ ...prev, maxReprices: value }))
              }}
              onBlur={() => saveConfig({ maxReprices: config.maxReprices })}
              disabled={isSaving}
              className="w-20 px-2 py-1 bg-zinc-900 border border-amber-500/20 rounded text-amber-300 text-xs font-mono text-right focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>
      )}

      {/* Price Chart */}
      <div className="bg-zinc-800/50 rounded-md p-3 border border-amber-500/10">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-mono text-amber-300">USDT/BRL Live</span>
            {activeQuote?.hasActiveQuote && (
              <span className="text-xs font-mono text-green-400/70">
                • Quote {activeQuote.repriceCount && activeQuote.repriceCount > 0 ? `(${activeQuote.repriceCount}x)` : 'active'}
              </span>
            )}
          </div>
          {currentPrice && (
            <span className="text-sm font-mono text-amber-300 font-bold">
              {formatPrice(currentPrice)}
            </span>
          )}
        </div>

        {priceData.length > 0 ? (
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={priceData}>
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={formatTime}
                  tick={{ fill: '#a3a3a3', fontSize: 10 }}
                  stroke="#525252"
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={getYAxisDomain()}
                  tick={{ fill: '#a3a3a3', fontSize: 10 }}
                  stroke="#525252"
                  tickFormatter={(v) => v.toFixed(3)}
                  width={50}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#18181b',
                    border: '1px solid #f59e0b33',
                    borderRadius: '4px',
                    fontSize: 11,
                  }}
                  labelFormatter={(ts) => new Date(ts).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false })}
                  formatter={(value: number) => [formatPrice(value), 'Price']}
                />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                {thresholds.upper && (
                  <ReferenceLine
                    y={thresholds.upper}
                    stroke="#ef4444"
                    strokeDasharray="3 3"
                    strokeOpacity={0.5}
                  />
                )}
                {thresholds.lower && (
                  <ReferenceLine
                    y={thresholds.lower}
                    stroke="#ef4444"
                    strokeDasharray="3 3"
                    strokeOpacity={0.5}
                  />
                )}
                {thresholds.baseline && (
                  <ReferenceLine
                    y={thresholds.baseline}
                    stroke="#22c55e"
                    strokeWidth={2}
                    strokeOpacity={0.8}
                    label={{
                      value: `Quote: ${thresholds.baseline.toFixed(4).replace('.', ',')}`,
                      position: 'right',
                      fill: '#22c55e',
                      fontSize: 9,
                    }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-40 flex items-center justify-center text-amber-400/50 text-xs">
            {connectionStatus === 'connected' ? 'Waiting for price data...' : 'Connecting to price stream...'}
          </div>
        )}
      </div>

      {/* Status Footer */}
      <div className="flex items-center justify-between text-xs text-amber-400/60">
        <span>
          {config.enabled ? (
            <span className="text-green-400">● Active</span>
          ) : (
            <span className="text-zinc-500">● Disabled</span>
          )}
        </span>
        <span>
          Threshold: ±{ruleThreshold.displayText}
        </span>
      </div>

      {/* Error Display */}
      {error && (
        <p className="text-red-400 text-xs">{error}</p>
      )}
    </div>
  )
}
