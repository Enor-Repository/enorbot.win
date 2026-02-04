import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DollarSign, TrendingDown, TrendingUp, AlertCircle, RefreshCw, Bot, FileImage } from 'lucide-react'
import { API_ENDPOINTS } from '@/lib/api'

// Budget alert threshold (could be made configurable via env var in future)
const BUDGET_ALERT_THRESHOLD = 50

interface CostSummary {
  period: string
  totalCost: number
  totalCalls: number
  successfulCalls: number
  totalInputTokens: number
  totalOutputTokens: number
  avgDurationMs: number
  avgCostPerCall: number
  byService: Record<string, { calls: number; cost: number }>
}

interface GroupCost {
  groupJid: string
  groupName: string
  calls: number
  cost: number
}

interface TrendPoint {
  date: string
  calls: number
  cost: number
}

export function CostsPage() {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day')
  const [summary, setSummary] = useState<CostSummary | null>(null)
  const [groupCosts, setGroupCosts] = useState<GroupCost[]>([])
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // H1 Fix: AbortController to prevent memory leaks on unmount
  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchCostData = useCallback(async () => {
    // Cancel any in-flight requests
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    setLoading(true)
    setError(null)

    // H2 Fix: Calculate days based on period for trend endpoint
    const trendDays = period === 'day' ? 7 : period === 'week' ? 14 : 30

    try {
      const [summaryRes, groupsRes, trendRes] = await Promise.all([
        fetch(API_ENDPOINTS.costSummary(period), { signal }),
        fetch(API_ENDPOINTS.costByGroup(period), { signal }),
        fetch(API_ENDPOINTS.costTrend(trendDays), { signal }),
      ])

      if (!summaryRes.ok || !groupsRes.ok || !trendRes.ok) {
        throw new Error('Failed to fetch cost data')
      }

      const [summaryData, groupsData, trendData] = await Promise.all([
        summaryRes.json(),
        groupsRes.json(),
        trendRes.json(),
      ])

      // Only update state if not aborted
      if (!signal.aborted) {
        setSummary(summaryData)
        setGroupCosts(groupsData.groups || [])
        setTrend(trendData.trend || [])
      }
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Failed to fetch cost data')
    } finally {
      if (!abortControllerRef.current?.signal.aborted) {
        setLoading(false)
      }
    }
  }, [period])

  useEffect(() => {
    fetchCostData()
    // Cleanup on unmount
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [fetchCostData])

  // Calculate week and month comparison (simplified)
  const weekCost = trend.slice(-7).reduce((sum, t) => sum + (t.cost || 0), 0)
  const monthCost = trend.reduce((sum, t) => sum + (t.cost || 0), 0)
  const lastWeekCost = trend.slice(-14, -7).reduce((sum, t) => sum + (t.cost || 0), 0)
  const weekChange = lastWeekCost > 0 ? ((weekCost - lastWeekCost) / lastWeekCost) * 100 : 0

  // Calculate totals from trend for display
  const totalCalls = trend.reduce((sum, t) => sum + (t.calls || 0), 0)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Costs & Usage</h1>
          <p className="text-muted-foreground mt-2">
            Track AI API costs and optimize spending
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            {(['day', 'week', 'month'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-sm capitalize transition-colors ${
                  period === p
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchCostData}
            disabled={loading}
          >
            <RefreshCw className={`size-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
          {error}
        </div>
      )}

      {/* Cost Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-green-500/20 bg-gradient-to-br from-green-500/5 to-transparent">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today</CardTitle>
            <DollarSign className="size-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-400">
              ${summary?.totalCost?.toFixed(4) || '0.0000'}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {summary?.totalCalls || 0} AI calls
            </p>
          </CardContent>
        </Card>

        <Card className="border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-transparent">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Week</CardTitle>
            {weekChange <= 0 ? (
              <TrendingDown className="size-4 text-blue-500" />
            ) : (
              <TrendingUp className="size-4 text-amber-500" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-400">
              ${weekCost.toFixed(4)}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {weekChange !== 0 && (
                <span className={weekChange < 0 ? 'text-green-400' : 'text-amber-400'}>
                  {weekChange > 0 ? '+' : ''}{weekChange.toFixed(0)}% vs last week
                </span>
              )}
              {weekChange === 0 && 'No previous week data'}
            </p>
          </CardContent>
        </Card>

        <Card className="border-purple-500/20 bg-gradient-to-br from-purple-500/5 to-transparent">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Month</CardTitle>
            <DollarSign className="size-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-400">
              ${monthCost.toFixed(4)}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {totalCalls} total calls
            </p>
          </CardContent>
        </Card>

        <Card className="border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg per Call</CardTitle>
            <AlertCircle className="size-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-400">
              ${summary?.avgCostPerCall?.toFixed(6) || '0.000000'}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              OpenRouter pricing
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Service Breakdown */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-5 text-cyan-500" />
              AI Classification
            </CardTitle>
            <CardDescription>
              Message type classification calls
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-cyan-400">
              {summary?.byService?.classification?.calls || 0}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              calls this {period} (${(summary?.byService?.classification?.cost || 0).toFixed(4)})
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Badge variant="outline" className="border-cyan-500/50 text-cyan-400">
                Haiku
              </Badge>
              <span className="text-xs text-muted-foreground">
                ~$0.00025/call
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileImage className="size-5 text-violet-500" />
              Receipt OCR
            </CardTitle>
            <CardDescription>
              Image-to-text extraction calls
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-violet-400">
              {summary?.byService?.ocr?.calls || 0}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              calls this {period} (${(summary?.byService?.ocr?.cost || 0).toFixed(4)})
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Badge variant="outline" className="border-violet-500/50 text-violet-400">
                Haiku Vision
              </Badge>
              <span className="text-xs text-muted-foreground">
                ~$0.002/call
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Token Usage */}
      <Card>
        <CardHeader>
          <CardTitle>Token Usage</CardTitle>
          <CardDescription>
            Input and output tokens consumed
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-2xl font-bold text-cyan-400">
                {(summary?.totalInputTokens || 0).toLocaleString()}
              </div>
              <p className="text-sm text-muted-foreground">Input tokens</p>
            </div>
            <div>
              <div className="text-2xl font-bold text-violet-400">
                {(summary?.totalOutputTokens || 0).toLocaleString()}
              </div>
              <p className="text-sm text-muted-foreground">Output tokens</p>
            </div>
          </div>
          <div className="mt-4 text-sm text-muted-foreground">
            Avg duration: {(summary?.avgDurationMs || 0).toFixed(0)}ms per call
          </div>
        </CardContent>
      </Card>

      {/* Cost by Group */}
      {groupCosts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Cost by Group</CardTitle>
            <CardDescription>
              AI costs breakdown per WhatsApp group
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {groupCosts.slice(0, 10).map((group) => (
                <div
                  key={group.groupJid}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div>
                    <div className="font-medium">{group.groupName}</div>
                    <div className="text-xs text-muted-foreground">
                      {group.calls} AI calls
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-green-400">
                      ${(group.cost || 0).toFixed(4)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 30-Day Trend */}
      <Card>
        <CardHeader>
          <CardTitle>30-Day Cost Trend</CardTitle>
          <CardDescription>
            Daily AI costs over the last month
          </CardDescription>
        </CardHeader>
        <CardContent>
          {trend.length > 0 ? (
            <div className="h-[200px] flex items-end gap-1">
              {trend.slice(-30).map((day, i, arr) => {
                const maxCost = Math.max(...trend.map((t) => t.cost || 0), 0.001)
                const height = ((day.cost || 0) / maxCost) * 100
                const isLastBar = i === arr.length - 1
                return (
                  <div
                    key={day.date}
                    className="flex-1 group relative"
                    title={`${day.date}: $${(day.cost || 0).toFixed(4)}`}
                  >
                    <div
                      className="bg-gradient-to-t from-cyan-500 to-blue-500 rounded-t transition-all hover:from-cyan-400 hover:to-blue-400"
                      style={{ height: `${Math.max(height, 2)}%` }}
                    />
                    {isLastBar && (
                      <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs text-muted-foreground whitespace-nowrap">
                        ${(day.cost || 0).toFixed(4)}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground">
              No trend data available yet
            </div>
          )}
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>{trend[0]?.date || 'Start'}</span>
            <span>{trend[trend.length - 1]?.date || 'Today'}</span>
          </div>
        </CardContent>
      </Card>

      {/* Budget Alerts */}
      <Card className="border-amber-500/20">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="size-5 text-amber-500" />
            <CardTitle>Budget Status</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {monthCost > BUDGET_ALERT_THRESHOLD ? (
              <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-center gap-2">
                  <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/50">
                    Warning
                  </Badge>
                  <span className="text-sm">
                    Monthly cost (${monthCost.toFixed(2)}) exceeds ${BUDGET_ALERT_THRESHOLD}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <div className="flex items-center gap-2">
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/50">
                    OK
                  </Badge>
                  <span className="text-sm">Costs are within expected range (${monthCost.toFixed(4)} this month)</span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
