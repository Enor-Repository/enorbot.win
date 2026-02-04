import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Activity, TrendingUp, Settings } from 'lucide-react'
import { ActivityHeatmap } from '@/components/analytics/ActivityHeatmap'
import { PriceTracker } from '@/components/shared/PriceTracker'
import { API_ENDPOINTS, writeHeaders } from '@/lib/api'
import { showToast } from '@/lib/toast'

// Constants (no magic numbers)
const MAX_GROUP_LIST_HEIGHT = '200px'
const FETCH_TIMEOUT_MS = 10000 // 10 seconds

interface Group {
  id: string
  jid: string
  name: string
  mode: 'learning' | 'active' | 'paused'
  isControlGroup: boolean
  messagesCollected: number
  learningDays: number
  rulesActive: number
  lastActivity: string | null
}

export function OverviewPage() {
  const navigate = useNavigate()
  const [groups, setGroups] = useState<Group[]>([])
  const [loadingGroups, setLoadingGroups] = useState(true)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [updatingMode, setUpdatingMode] = useState<string | null>(null)

  const fetchGroups = useCallback(async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      setLoadingError(null)
      const response = await fetch(API_ENDPOINTS.groups, {
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      setGroups(data.groups || [])
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to fetch groups'
      setLoadingError(errorMsg)

      if (import.meta.env.DEV) {
        console.error('Failed to fetch groups:', error)
      }

      showToast({
        type: 'error',
        message: `Failed to load groups: ${errorMsg}`
      })
    } finally {
      clearTimeout(timeoutId)
      setLoadingGroups(false)
    }
  }, [])

  useEffect(() => {
    fetchGroups()
  }, [fetchGroups])

  const handleModeChange = async (groupJid: string, newMode: 'learning' | 'active' | 'paused') => {
    // Optimistic update to prevent race conditions
    const previousGroups = [...groups]
    setGroups(groups.map(g =>
      g.jid === groupJid ? { ...g, mode: newMode } : g
    ))

    setUpdatingMode(groupJid)
    try {
      const response = await fetch(API_ENDPOINTS.groupMode(groupJid), {
        method: 'PUT',
        headers: writeHeaders(),
        body: JSON.stringify({ mode: newMode }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update mode')
      }

      showToast({
        type: 'success',
        message: `Mode changed to ${newMode}`
      })
    } catch (error) {
      // Revert optimistic update on error
      setGroups(previousGroups)

      const errorMsg = error instanceof Error ? error.message : 'Failed to update mode'

      if (import.meta.env.DEV) {
        console.error('Failed to update mode:', error)
      }

      showToast({
        type: 'error',
        message: `Failed to change mode: ${errorMsg}`
      })
    } finally {
      setUpdatingMode(null)
    }
  }

  const stats = {
    connection: 'connected',
    activeGroups: groups.length,
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-2 text-lg">
          Real-time insights into eNorBOT performance and activity
        </p>
      </div>

      {/* Status Cards Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 via-cyan-500/5 to-transparent shadow-lg shadow-cyan-500/5 hover:shadow-cyan-500/10 transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
            <CardTitle className="text-xs font-semibold text-cyan-100">Connection</CardTitle>
            <div className="h-6 w-6 rounded-lg bg-cyan-500/20 flex items-center justify-center">
              <Activity className="h-3 w-3 text-cyan-400" />
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-center gap-2">
              <Badge className="bg-cyan-500/30 text-cyan-300 border-cyan-500/40 font-semibold px-2 py-0.5 text-xs">
                {stats.connection}
              </Badge>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              WhatsApp connected
            </p>
          </CardContent>
        </Card>

        <Card className="border-purple-500/30 bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent shadow-lg shadow-purple-500/5 hover:shadow-purple-500/10 transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
            <CardTitle className="text-xs font-semibold text-purple-100">Active Groups</CardTitle>
            <div className="h-6 w-6 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <TrendingUp className="h-3 w-3 text-purple-400" />
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-xl font-bold text-purple-300">
              {stats.activeGroups}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 mb-3">
              Monitoring conversations
            </p>

            {/* Groups List with Scrollbar */}
            <div className="overflow-y-auto space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-purple-500/30 scrollbar-track-transparent" style={{ maxHeight: MAX_GROUP_LIST_HEIGHT }}>
              {loadingGroups ? (
                <div className="text-[10px] text-muted-foreground text-center py-2">
                  Loading...
                </div>
              ) : loadingError ? (
                <div className="text-[10px] text-red-400 text-center py-2">
                  <div>{loadingError}</div>
                  <button
                    onClick={fetchGroups}
                    className="mt-2 text-purple-300 hover:text-purple-200 underline"
                  >
                    Retry
                  </button>
                </div>
              ) : groups.length === 0 ? (
                <div className="text-[10px] text-muted-foreground text-center py-2">
                  No groups found
                </div>
              ) : (
                groups.map((group) => {
                  const modeColors = {
                    learning: { bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/40' },
                    active: { bg: 'bg-green-500/20', text: 'text-green-300', border: 'border-green-500/40' },
                    paused: { bg: 'bg-gray-500/20', text: 'text-gray-300', border: 'border-gray-500/40' },
                  }
                  const colors = modeColors[group.mode]
                  const hasRulebook = group.rulesActive > 0

                  return (
                    <div
                      key={group.id}
                      className="flex items-center gap-2 p-2 rounded bg-purple-500/5 border border-purple-500/20 hover:bg-purple-500/10 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <div className="text-[10px] font-mono text-foreground truncate">
                            {group.name}
                          </div>
                          {group.isControlGroup && (
                            <Badge className="bg-purple-500/30 text-purple-300 border-purple-500/40 text-[8px] px-1 py-0">
                              CTRL
                            </Badge>
                          )}
                        </div>
                        <div className="text-[9px] text-muted-foreground font-mono">
                          {group.messagesCollected} msgs • {group.learningDays}d
                        </div>
                      </div>

                      {/* Mode Selector */}
                      <select
                        value={group.mode}
                        onChange={(e) => handleModeChange(group.jid, e.target.value as 'learning' | 'active' | 'paused')}
                        disabled={updatingMode === group.jid}
                        className={`text-[9px] font-mono px-2 py-0.5 rounded border ${colors.bg} ${colors.text} ${colors.border} bg-opacity-50 hover:bg-opacity-70 transition-all disabled:opacity-50 cursor-pointer w-[52px]`}
                        title="Change mode"
                      >
                        <option value="learning">Learn</option>
                        <option value="active">Live</option>
                        <option value="paused">Pause</option>
                      </select>

                      <button
                        onClick={() => navigate('/groups')}
                        className={`p-1 rounded bg-purple-500/10 hover:bg-purple-500/20 border transition-all ${
                          hasRulebook
                            ? 'border-green-500/50 shadow-[0_0_8px_rgba(34,197,94,0.3)]'
                            : 'border-purple-500/30'
                        }`}
                        title="Set Rulebook"
                      >
                        <Settings className={`h-3 w-3 transition-colors ${
                          hasRulebook ? 'text-green-400' : 'text-purple-400'
                        }`} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* Price Tracker Card */}
        <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent shadow-lg shadow-amber-500/5 hover:shadow-amber-500/10 transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
            <CardTitle className="text-xs font-mono font-semibold text-amber-100 uppercase tracking-wider">
              Market Prices
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <PriceTracker />
          </CardContent>
        </Card>
      </div>

      {/* Activity Heatmap */}
      <ActivityHeatmap
        groupId="all"
        days={30}
        onCellClick={(hour, day) => {
          if (import.meta.env.DEV) {
            console.log(`Clicked: ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]} ${hour}:00`)
          }
        }}
      />
    </div>
  )
}
