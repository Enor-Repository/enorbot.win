/**
 * Group Spread Editor Component
 * Allows Daniel (CIO) to configure per-group pricing spreads
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, Save, RotateCcw } from 'lucide-react'
import { API_ENDPOINTS, API_BASE_URL } from '@/lib/api'
import { showToast } from '@/lib/toast'

type SpreadMode = 'bps' | 'abs_brl' | 'flat'
type TradeSide = 'client_buys_usdt' | 'client_sells_usdt'
type Currency = 'BRL' | 'USDT'
type Language = 'pt-BR' | 'en'

interface SpreadConfig {
  groupJid: string
  spreadMode: SpreadMode
  sellSpread: number
  buySpread: number
  quoteTtlSeconds: number
  defaultSide: TradeSide
  defaultCurrency: Currency
  language: Language
}

interface PreviewResult {
  binanceRate: number
  clientBuysUsdt: { rate: number; spreadApplied: number }
  clientSellsUsdt: { rate: number; spreadApplied: number }
}

interface GroupSpreadEditorProps {
  groupJid: string
}

const DEFAULT_CONFIG: Omit<SpreadConfig, 'groupJid'> = {
  spreadMode: 'bps',
  sellSpread: 0,
  buySpread: 0,
  quoteTtlSeconds: 180,
  defaultSide: 'client_buys_usdt',
  defaultCurrency: 'BRL',
  language: 'pt-BR',
}

export function GroupSpreadEditor({ groupJid }: GroupSpreadEditorProps) {
  const [config, setConfig] = useState<SpreadConfig>({ ...DEFAULT_CONFIG, groupJid })
  const [originalConfig, setOriginalConfig] = useState<SpreadConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [binanceRate, setBinanceRate] = useState<number | null>(null)
  const [, setLoadError] = useState<string | null>(null)
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch current config
  const fetchConfig = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(API_ENDPOINTS.groupSpread(groupJid))
      if (!response.ok) throw new Error('Failed to fetch config')

      const data = await response.json()
      const fetchedConfig: SpreadConfig = {
        groupJid: data.spread.groupJid,
        spreadMode: data.spread.spreadMode,
        sellSpread: data.spread.sellSpread,
        buySpread: data.spread.buySpread,
        quoteTtlSeconds: data.spread.quoteTtlSeconds,
        defaultSide: data.spread.defaultSide,
        defaultCurrency: data.spread.defaultCurrency,
        language: data.spread.language,
      }
      setConfig(fetchedConfig)
      setOriginalConfig(fetchedConfig)
    } catch (error) {
      // M5 fix: Differentiate between "not configured" (404) and actual errors
      const isNetworkError = error instanceof TypeError && error.message.includes('fetch')
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      if (isNetworkError || errorMessage.includes('500')) {
        // Actual error - show toast
        setLoadError(errorMessage)
        showToast({
          type: 'error',
          message: 'Failed to load pricing config. Using defaults.'
        })
      }

      // Use defaults regardless
      const defaultConfig = { ...DEFAULT_CONFIG, groupJid }
      setConfig(defaultConfig)
      setOriginalConfig(null)
    } finally {
      setLoading(false)
    }
  }, [groupJid])

  // Fetch Binance rate for preview
  const fetchBinanceRate = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/prices/usdt-brl`)
      if (!response.ok) throw new Error('Failed to fetch rate')
      const data = await response.json()
      setBinanceRate(data.price)
    } catch (error) {
      console.error('Failed to fetch Binance rate:', error)
    }
  }, [])

  // Calculate preview
  const calculatePreview = useCallback(async () => {
    if (!binanceRate) return

    setLoadingPreview(true)
    try {
      const response = await fetch(API_ENDPOINTS.spreadPreview, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          binanceRate,
          spreadMode: config.spreadMode,
          sellSpread: config.sellSpread,
          buySpread: config.buySpread,
        }),
      })

      if (!response.ok) throw new Error('Preview failed')
      const data = await response.json()
      setPreview(data)
    } catch (error) {
      console.error('Preview calculation failed:', error)
    } finally {
      setLoadingPreview(false)
    }
  }, [binanceRate, config.spreadMode, config.sellSpread, config.buySpread])

  // Initial load
  useEffect(() => {
    fetchConfig()
    fetchBinanceRate()
  }, [fetchConfig, fetchBinanceRate])

  // M4 fix: Debounced preview update when config changes
  useEffect(() => {
    if (!binanceRate) return

    // Clear existing debounce timer
    if (previewDebounceRef.current) {
      clearTimeout(previewDebounceRef.current)
    }

    // Set new debounce timer (300ms)
    previewDebounceRef.current = setTimeout(() => {
      calculatePreview()
    }, 300)

    // Cleanup on unmount or dependency change
    return () => {
      if (previewDebounceRef.current) {
        clearTimeout(previewDebounceRef.current)
      }
    }
  }, [binanceRate, calculatePreview])

  // Save config
  const saveConfig = async () => {
    setSaving(true)
    try {
      const response = await fetch(API_ENDPOINTS.groupSpread(groupJid), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadMode: config.spreadMode,
          sellSpread: config.sellSpread,
          buySpread: config.buySpread,
          quoteTtlSeconds: config.quoteTtlSeconds,
          defaultSide: config.defaultSide,
          defaultCurrency: config.defaultCurrency,
          language: config.language,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || 'Failed to save')
      }

      const data = await response.json()
      setOriginalConfig(data.spread)
      showToast({ type: 'success', message: 'Pricing config saved' })
    } catch (error) {
      showToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to save config'
      })
    } finally {
      setSaving(false)
    }
  }

  // Reset to original
  const resetConfig = () => {
    if (originalConfig) {
      setConfig(originalConfig)
    } else {
      setConfig({ ...DEFAULT_CONFIG, groupJid })
    }
  }

  // Check if config has changes
  const hasChanges = JSON.stringify(config) !== JSON.stringify(originalConfig || { ...DEFAULT_CONFIG, groupJid })

  // Format number for display
  const formatRate = (rate: number) => {
    return config.language === 'pt-BR'
      ? rate.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
      : rate.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  }

  // Get spread unit label
  const getSpreadUnit = () => {
    switch (config.spreadMode) {
      case 'bps': return 'bps'
      case 'abs_brl': return 'BRL'
      case 'flat': return ''
    }
  }

  if (loading) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        Loading pricing config...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-amber-500/10">
        <h4 className="text-xs font-mono text-amber-400 uppercase tracking-widest flex items-center gap-2">
          <span className="h-1 w-1 rounded-full bg-amber-400 animate-pulse"></span>
          Pricing Configuration
        </h4>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <button
              onClick={resetConfig}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          )}
          <button
            onClick={saveConfig}
            disabled={saving || !hasChanges}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-mono transition-all hover:shadow-[0_0_10px_rgba(245,158,11,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Config Form */}
      <div className="grid grid-cols-2 gap-4">
        {/* Spread Mode */}
        <div>
          <label className="block text-xs font-mono text-muted-foreground mb-1.5">
            Spread Mode
          </label>
          <select
            value={config.spreadMode}
            onChange={(e) => setConfig(prev => ({ ...prev, spreadMode: e.target.value as SpreadMode }))}
            className="w-full px-3 py-2 bg-background border border-amber-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-amber-500/50"
          >
            <option value="bps">Basis Points (bps)</option>
            <option value="abs_brl">Absolute BRL</option>
            <option value="flat">Flat (No Spread)</option>
          </select>
        </div>

        {/* Quote TTL */}
        <div>
          <label className="block text-xs font-mono text-muted-foreground mb-1.5">
            Quote TTL (seconds)
          </label>
          <input
            type="number"
            value={config.quoteTtlSeconds}
            onChange={(e) => setConfig(prev => ({ ...prev, quoteTtlSeconds: Math.max(1, Math.min(3600, parseInt(e.target.value) || 180)) }))}
            min={1}
            max={3600}
            className="w-full px-3 py-2 bg-background border border-amber-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-amber-500/50"
          />
        </div>

        {/* Sell Spread (Client buys USDT) */}
        <div>
          <label className="block text-xs font-mono text-muted-foreground mb-1.5">
            Client BUYS USDT Spread
            <span className="text-amber-400 ml-1">({getSpreadUnit()})</span>
          </label>
          <input
            type="number"
            value={config.sellSpread}
            onChange={(e) => setConfig(prev => ({ ...prev, sellSpread: parseFloat(e.target.value) || 0 }))}
            disabled={config.spreadMode === 'flat'}
            placeholder="e.g., 50 for +50 bps"
            className="w-full px-3 py-2 bg-background border border-amber-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-amber-500/50 disabled:opacity-50"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Positive = adds to rate (eNor margin)
          </p>
        </div>

        {/* Buy Spread (Client sells USDT) */}
        <div>
          <label className="block text-xs font-mono text-muted-foreground mb-1.5">
            Client SELLS USDT Spread
            <span className="text-amber-400 ml-1">({getSpreadUnit()})</span>
          </label>
          <input
            type="number"
            value={config.buySpread}
            onChange={(e) => setConfig(prev => ({ ...prev, buySpread: parseFloat(e.target.value) || 0 }))}
            disabled={config.spreadMode === 'flat'}
            placeholder="e.g., -30 for -30 bps"
            className="w-full px-3 py-2 bg-background border border-amber-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-amber-500/50 disabled:opacity-50"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Negative = subtracts from rate
          </p>
        </div>

        {/* Default Side */}
        <div>
          <label className="block text-xs font-mono text-muted-foreground mb-1.5">
            Default Trade Side
          </label>
          <select
            value={config.defaultSide}
            onChange={(e) => setConfig(prev => ({ ...prev, defaultSide: e.target.value as TradeSide }))}
            className="w-full px-3 py-2 bg-background border border-amber-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-amber-500/50"
          >
            <option value="client_buys_usdt">Client buys USDT</option>
            <option value="client_sells_usdt">Client sells USDT</option>
          </select>
        </div>

        {/* Default Currency */}
        <div>
          <label className="block text-xs font-mono text-muted-foreground mb-1.5">
            Default Currency
          </label>
          <select
            value={config.defaultCurrency}
            onChange={(e) => setConfig(prev => ({ ...prev, defaultCurrency: e.target.value as Currency }))}
            className="w-full px-3 py-2 bg-background border border-amber-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-amber-500/50"
          >
            <option value="BRL">BRL (Brazilian Real)</option>
            <option value="USDT">USDT</option>
          </select>
        </div>

        {/* Language */}
        <div className="col-span-2">
          <label className="block text-xs font-mono text-muted-foreground mb-1.5">
            Response Language
          </label>
          <select
            value={config.language}
            onChange={(e) => setConfig(prev => ({ ...prev, language: e.target.value as Language }))}
            className="w-full px-3 py-2 bg-background border border-amber-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-amber-500/50"
          >
            <option value="pt-BR">Portugues (BR)</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {/* Live Preview */}
      <div className="mt-4 p-3 rounded-lg border border-green-500/20 bg-green-500/5">
        <div className="flex items-center justify-between mb-3">
          <h5 className="text-xs font-mono text-green-400 uppercase tracking-wider flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400"></span>
            Live Preview
          </h5>
          <button
            onClick={() => { fetchBinanceRate(); calculatePreview(); }}
            disabled={loadingPreview}
            className="flex items-center gap-1 text-[10px] font-mono text-green-400 hover:text-green-300"
          >
            <RefreshCw className={`h-3 w-3 ${loadingPreview ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {binanceRate && preview ? (
          <div className="space-y-2 font-mono text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Binance USDT/BRL:</span>
              <span className="text-foreground">R$ {formatRate(binanceRate)}</span>
            </div>
            <div className="h-px bg-green-500/20"></div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Client BUYS USDT:</span>
              <span className="text-green-400 font-semibold">
                R$ {formatRate(preview.clientBuysUsdt.rate)}
                {config.spreadMode !== 'flat' && (
                  <span className="text-green-400/60 text-xs ml-1">
                    (+{config.sellSpread} {getSpreadUnit()})
                  </span>
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Client SELLS USDT:</span>
              <span className="text-amber-400 font-semibold">
                R$ {formatRate(preview.clientSellsUsdt.rate)}
                {config.spreadMode !== 'flat' && (
                  <span className="text-amber-400/60 text-xs ml-1">
                    ({config.buySpread} {getSpreadUnit()})
                  </span>
                )}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-center text-muted-foreground text-xs">
            {loadingPreview ? 'Calculating...' : 'Unable to load preview'}
          </div>
        )}
      </div>
    </div>
  )
}
