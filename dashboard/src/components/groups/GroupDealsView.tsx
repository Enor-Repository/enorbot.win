/**
 * Group Deals View
 * Sprint 4: Shows active deals, deal history, and manual controls.
 * Allows Daniel (CIO) to monitor deal flow and intervene when needed.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Clock,
  XCircle,
  CheckCircle,
  AlertTriangle,
  Timer,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { API_ENDPOINTS } from '@/lib/api'
import { showToast } from '@/lib/toast'

// ============================================================================
// Types (local mirrors of service types)
// ============================================================================

type DealState = 'quoted' | 'locked' | 'computing' | 'completed' | 'expired' | 'cancelled'
type TradeSide = 'client_buys_usdt' | 'client_sells_usdt'

interface ActiveDeal {
  id: string
  groupJid: string
  clientJid: string
  state: DealState
  side: TradeSide
  quotedRate: number
  baseRate: number
  quotedAt: string
  lockedRate: number | null
  lockedAt: string | null
  amountBrl: number | null
  amountUsdt: number | null
  ttlExpiresAt: string
  ruleIdUsed: string | null
  ruleName: string | null
  pricingSource: string
  spreadMode: string
  sellSpread: number
  buySpread: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

interface DealHistoryRecord {
  id: string
  groupJid: string
  clientJid: string
  finalState: string
  side: TradeSide
  quotedRate: number
  baseRate: number
  lockedRate: number | null
  amountBrl: number | null
  amountUsdt: number | null
  quotedAt: string
  lockedAt: string | null
  completedAt: string | null
  ttlExpiresAt: string
  ruleName: string | null
  completionReason: string | null
  createdAt: string
  archivedAt: string
}

interface Props {
  groupJid: string
}

// ============================================================================
// Helpers
// ============================================================================

const FETCH_TIMEOUT_MS = 10000

function formatRate(rate: number): string {
  return rate.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

function formatBrl(value: number): string {
  return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatUsdt(value: number): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function getTimeRemaining(ttlExpiresAt: string): string {
  const remaining = new Date(ttlExpiresAt).getTime() - Date.now()
  if (remaining <= 0) return 'Expired'
  const seconds = Math.floor(remaining / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

function getStateColor(state: DealState): string {
  switch (state) {
    case 'quoted': return 'bg-blue-500/20 text-blue-300 border-blue-500/40'
    case 'locked': return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
    case 'computing': return 'bg-purple-500/20 text-purple-300 border-purple-500/40'
    case 'completed': return 'bg-green-500/20 text-green-300 border-green-500/40'
    case 'expired': return 'bg-gray-500/20 text-gray-400 border-gray-500/40'
    case 'cancelled': return 'bg-red-500/20 text-red-300 border-red-500/40'
  }
}

function getStateIcon(state: DealState) {
  switch (state) {
    case 'quoted': return <Clock className="h-4 w-4 text-blue-400" />
    case 'locked': return <Timer className="h-4 w-4 text-yellow-400" />
    case 'computing': return <RefreshCw className="h-4 w-4 text-purple-400 animate-spin" />
    case 'completed': return <CheckCircle className="h-4 w-4 text-green-400" />
    case 'expired': return <AlertTriangle className="h-4 w-4 text-gray-400" />
    case 'cancelled': return <XCircle className="h-4 w-4 text-red-400" />
  }
}

function getClientPhone(jid: string): string {
  return jid.replace(/@.*$/, '')
}

// ============================================================================
// Component
// ============================================================================

export default function GroupDealsView({ groupJid }: Props) {
  const [activeDeals, setActiveDeals] = useState<ActiveDeal[]>([])
  const [history, setHistory] = useState<DealHistoryRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [extending, setExtending] = useState<string | null>(null)

  // Fetch active deals
  const fetchDeals = useCallback(async () => {
    setLoading(true)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

      const res = await fetch(API_ENDPOINTS.groupDeals(groupJid), {
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (res.ok) {
        const data = await res.json()
        setActiveDeals(data.deals || [])
      }
    } catch {
      // Silently fail on fetch errors
    } finally {
      setLoading(false)
    }
  }, [groupJid])

  // Fetch deal history
  const fetchHistory = useCallback(async () => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

      const res = await fetch(API_ENDPOINTS.groupDealHistory(groupJid), {
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (res.ok) {
        const data = await res.json()
        setHistory(data.history || [])
      }
    } catch {
      // Silently fail
    }
  }, [groupJid])

  // Auto-refresh active deals every 15 seconds
  useEffect(() => {
    fetchDeals()
    const interval = setInterval(fetchDeals, 15000)
    return () => clearInterval(interval)
  }, [fetchDeals])

  // Fetch history when section is expanded
  useEffect(() => {
    if (showHistory) {
      fetchHistory()
    }
  }, [showHistory, fetchHistory])

  // Cancel deal
  const handleCancel = async (dealId: string) => {
    try {
      const res = await fetch(API_ENDPOINTS.groupDealCancel(groupJid, dealId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (res.ok) {
        showToast({ type: 'success', message: 'Deal cancelled' })
        fetchDeals()
      } else {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }))
        showToast({ type: 'error', message: data.message || data.error || 'Failed to cancel' })
      }
    } catch {
      showToast({ type: 'error', message: 'Failed to cancel deal' })
    }
  }

  // Extend TTL
  const handleExtend = async (dealId: string, seconds: number) => {
    setExtending(dealId)
    try {
      const res = await fetch(API_ENDPOINTS.groupDealExtend(groupJid, dealId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds }),
      })

      if (res.ok) {
        showToast({ type: 'success', message: `TTL extended by ${Math.floor(seconds / 60)} min` })
        fetchDeals()
      } else {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }))
        showToast({ type: 'error', message: data.message || data.error || 'Failed to extend TTL' })
      }
    } catch {
      showToast({ type: 'error', message: 'Failed to extend TTL' })
    } finally {
      setExtending(null)
    }
  }

  // Sweep expired deals
  const handleSweep = async () => {
    try {
      const res = await fetch(API_ENDPOINTS.groupDealSweep(groupJid), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (res.ok) {
        const data = await res.json()
        showToast({ type: 'success', message: `Sweep complete: ${data.expired} expired` })
        fetchDeals()
      } else {
        showToast({ type: 'error', message: 'Sweep failed' })
      }
    } catch {
      showToast({ type: 'error', message: 'Sweep failed' })
    }
  }

  return (
    <div className="space-y-3">
      {/* Header with actions */}
      <div className="flex items-center justify-between pb-2 border-b border-emerald-500/10">
        <h4 className="text-xs font-mono text-emerald-400 uppercase tracking-widest flex items-center gap-2">
          <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse"></span>
          Active Deals
          {activeDeals.length > 0 && (
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px] px-1.5 py-0">
              {activeDeals.length}
            </Badge>
          )}
        </h4>
        <div className="flex gap-1.5">
          <button
            onClick={handleSweep}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] font-mono transition-all"
            title="Expire stale deals"
          >
            <AlertTriangle className="h-3 w-3" />
            Sweep
          </button>
          <button
            onClick={fetchDeals}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[10px] font-mono transition-all"
            disabled={loading}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Active Deals List */}
      {loading && activeDeals.length === 0 ? (
        <div className="text-center py-4 text-muted-foreground text-sm">
          Loading deals...
        </div>
      ) : activeDeals.length === 0 ? (
        <div className="text-center py-4 border border-dashed border-emerald-500/30 rounded-md">
          <p className="text-muted-foreground text-xs">
            No active deals in this group
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {activeDeals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              onCancel={handleCancel}
              onExtend={handleExtend}
              extending={extending === deal.id}
            />
          ))}
        </div>
      )}

      {/* Deal History Section */}
      <div className="pt-2 border-t border-emerald-500/10">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-emerald-400 transition-colors"
        >
          {showHistory ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          Deal History
          {history.length > 0 && (
            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px] px-1 py-0">
              {history.length}
            </Badge>
          )}
        </button>

        {showHistory && (
          <div className="mt-2 space-y-1.5 max-h-[300px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-emerald-500/30 scrollbar-track-transparent">
            {history.length === 0 ? (
              <div className="text-center py-3 text-muted-foreground text-xs">
                No deal history for this group
              </div>
            ) : (
              history.map((record) => (
                <HistoryRow key={record.id} record={record} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Sub-components
// ============================================================================

function DealCard({
  deal,
  onCancel,
  onExtend,
  extending,
}: {
  deal: ActiveDeal
  onCancel: (id: string) => void
  onExtend: (id: string, seconds: number) => void
  extending: boolean
}) {
  const isTerminal = ['completed', 'expired', 'cancelled'].includes(deal.state)
  const isExpired = new Date(deal.ttlExpiresAt).getTime() < Date.now()
  const clientName = (deal.metadata?.senderName as string) || getClientPhone(deal.clientJid)

  return (
    <div className="rounded-md bg-background/30 border border-emerald-500/10 hover:border-emerald-500/30 hover:shadow-[0_0_8px_rgba(16,185,129,0.1)] transition-all backdrop-blur-sm p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {getStateIcon(deal.state)}
          <Badge className={`${getStateColor(deal.state)} text-[10px] font-mono px-1.5 py-0 uppercase`}>
            {deal.state}
          </Badge>
          <span className="text-sm font-mono font-semibold text-foreground">{clientName}</span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {deal.side === 'client_buys_usdt' ? 'BUYS' : 'SELLS'}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">{formatRelativeTime(deal.createdAt)}</span>
      </div>

      {/* Rate and amounts */}
      <div className="flex items-center gap-4 text-xs font-mono">
        <div>
          <span className="text-muted-foreground">Rate: </span>
          <span className="text-foreground">{formatRate(deal.lockedRate ?? deal.quotedRate)}</span>
          {deal.lockedRate && (
            <span className="text-yellow-400 ml-1">(locked)</span>
          )}
        </div>
        {deal.amountBrl !== null && (
          <div>
            <span className="text-muted-foreground">BRL: </span>
            <span className="text-foreground">{formatBrl(deal.amountBrl)}</span>
          </div>
        )}
        {deal.amountUsdt !== null && (
          <div>
            <span className="text-muted-foreground">USDT: </span>
            <span className="text-foreground">{formatUsdt(deal.amountUsdt)}</span>
          </div>
        )}
      </div>

      {/* TTL and rule info + Actions */}
      <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className={isExpired ? 'text-red-400 font-semibold' : ''}>
            TTL: {getTimeRemaining(deal.ttlExpiresAt)}
          </span>
          {deal.ruleName && (
            <span>Rule: {deal.ruleName}</span>
          )}
        </div>

        {/* Actions */}
        {!isTerminal && (
          <div className="flex gap-1">
            <button
              onClick={() => onExtend(deal.id, 300)}
              disabled={extending}
              className="px-1.5 py-0.5 rounded bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-300 transition-all disabled:opacity-50"
              title="Extend TTL by 5 minutes"
            >
              <span className="flex items-center gap-0.5">
                <Timer className="h-2.5 w-2.5" />
                {extending ? '...' : '+5m'}
              </span>
            </button>
            <button
              onClick={() => onExtend(deal.id, 900)}
              disabled={extending}
              className="px-1.5 py-0.5 rounded bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-300 transition-all disabled:opacity-50"
              title="Extend TTL by 15 minutes"
            >
              {extending ? '...' : '+15m'}
            </button>
            <button
              onClick={() => onCancel(deal.id)}
              className="px-1.5 py-0.5 rounded bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 transition-all flex items-center gap-0.5"
              title="Cancel this deal"
            >
              <XCircle className="h-2.5 w-2.5" />
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function HistoryRow({ record }: { record: DealHistoryRecord }) {
  const stateColors: Record<string, string> = {
    completed: 'text-green-400',
    expired: 'text-gray-500',
    cancelled: 'text-red-400',
  }

  return (
    <div className="flex items-center justify-between py-1.5 px-3 rounded-md bg-background/30 border border-emerald-500/10 text-xs font-mono">
      <div className="flex items-center gap-3">
        <span className={`font-semibold ${stateColors[record.finalState] || 'text-muted-foreground'}`}>
          {record.finalState.toUpperCase()}
        </span>
        <span className="text-foreground">{getClientPhone(record.clientJid)}</span>
        <span className="text-muted-foreground">{formatRate(record.lockedRate ?? record.quotedRate)}</span>
      </div>
      <div className="flex items-center gap-3 text-muted-foreground text-[10px]">
        {record.amountBrl !== null && (
          <span>{formatBrl(record.amountBrl)}</span>
        )}
        {record.completionReason && (
          <span>{record.completionReason}</span>
        )}
        <span>{formatRelativeTime(record.archivedAt)}</span>
      </div>
    </div>
  )
}
