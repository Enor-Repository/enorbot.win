/**
 * Groups Page - Story D.11/D.12
 *
 * Manage group configurations and operational modes.
 * Features:
 * - List all WhatsApp groups with real-time status
 * - Mode selector with confirmation for active mode
 * - AI threshold slider per group
 * - Group details panel
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Users, RefreshCw, ChevronRight, MessageSquare, Clock, Zap } from 'lucide-react'
import { ModeSelector, type GroupMode } from '@/components/config/ModeSelector'
import { AIThreshold } from '@/components/config/AIThreshold'
import { PlayerLeaderboard } from '@/components/analytics/PlayerLeaderboard'
import { API_ENDPOINTS } from '@/lib/api'

interface Group {
  id: string
  jid: string
  name: string
  mode: GroupMode
  isControlGroup: boolean
  learningDays: number
  messagesCollected: number
  rulesActive: number
  lastActivity: string | null
}

interface GroupConfig {
  groupJid: string
  mode: GroupMode
  aiThreshold: number
  learningStartedAt: string | null
  patternCoverage: number
  rulesActive: number
}

export function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [groupConfig, setGroupConfig] = useState<GroupConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const configAbortRef = useRef<AbortController | null>(null)

  const fetchGroups = useCallback(async () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(API_ENDPOINTS.groups, {
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error('Failed to fetch groups')
      }

      const data = await response.json()
      setGroups(data.groups || [])
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Failed to fetch groups')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchGroupConfig = useCallback(async (jid: string) => {
    // Cancel any pending config fetch
    configAbortRef.current?.abort()
    configAbortRef.current = new AbortController()

    setConfigLoading(true)
    try {
      const response = await fetch(API_ENDPOINTS.groupConfig(jid), {
        signal: configAbortRef.current.signal,
      })
      if (!response.ok) throw new Error('Failed to fetch config')
      const data = await response.json()
      setGroupConfig(data)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.error('Config fetch error:', err)
      setGroupConfig(null)
    } finally {
      setConfigLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchGroups()
    return () => {
      abortControllerRef.current?.abort()
      configAbortRef.current?.abort()
    }
  }, [fetchGroups])

  // Fetch config when group is selected
  useEffect(() => {
    if (selectedGroup) {
      fetchGroupConfig(selectedGroup.jid)
    } else {
      setGroupConfig(null)
    }
  }, [selectedGroup, fetchGroupConfig])

  const handleModeChange = async (group: Group, newMode: GroupMode) => {
    setConfigError(null)
    try {
      const response = await fetch(API_ENDPOINTS.groupMode(group.jid), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update mode')
      }

      // Update local state
      setGroups((prev) =>
        prev.map((g) => (g.jid === group.jid ? { ...g, mode: newMode } : g))
      )

      // Update selected group if it's the same
      if (selectedGroup?.jid === group.jid) {
        setSelectedGroup({ ...selectedGroup, mode: newMode })
        setGroupConfig((prev) => (prev ? { ...prev, mode: newMode } : null))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update mode'
      setConfigError(message)
      console.error('Mode change error:', err)
      throw err
    }
  }

  const handleThresholdSave = async (threshold: number) => {
    if (!selectedGroup) return

    setConfigError(null)
    try {
      const response = await fetch(API_ENDPOINTS.groupThreshold(selectedGroup.jid), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update threshold')
      }

      // Update local config
      setGroupConfig((prev) => (prev ? { ...prev, aiThreshold: threshold } : null))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update threshold'
      setConfigError(message)
      console.error('Threshold save error:', err)
      throw err
    }
  }

  const getModeColor = (mode: string) => {
    switch (mode) {
      case 'learning':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/50'
      case 'assisted':
        return 'bg-purple-500/20 text-purple-400 border-purple-500/50'
      case 'active':
        return 'bg-green-500/20 text-green-400 border-green-500/50'
      case 'paused':
        return 'bg-gray-500/20 text-gray-400 border-gray-500/50'
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/50'
    }
  }

  const formatLastActivity = (dateStr: string | null) => {
    if (!dateStr) return 'Never'
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Groups</h1>
          <p className="text-muted-foreground mt-2">
            Manage group configurations and operational modes
          </p>
        </div>
        <Button variant="outline" onClick={fetchGroups} disabled={loading}>
          <RefreshCw className={`size-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
          {error}
        </div>
      )}

      {/* Groups Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => (
          <Card
            key={group.id}
            className="hover:border-primary/50 transition-colors cursor-pointer group"
            onClick={() => setSelectedGroup(group)}
          >
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Users className="size-5 text-muted-foreground" />
                  <CardTitle className="text-lg">{group.name}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  {group.isControlGroup && (
                    <Badge variant="outline" className="text-xs">
                      Control
                    </Badge>
                  )}
                  <ChevronRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Mode</span>
                <Badge className={getModeColor(group.mode)}>{group.mode}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <MessageSquare className="size-3" />
                  Messages
                </span>
                <span className="text-sm font-medium">
                  {group.messagesCollected.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <Zap className="size-3" />
                  Rules
                </span>
                <span className="text-sm font-medium">{group.rulesActive} active</span>
              </div>
              {group.mode === 'learning' && group.learningDays > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <Clock className="size-3" />
                    Learning
                  </span>
                  <span className="text-sm font-medium">{group.learningDays} days</span>
                </div>
              )}
              <div className="pt-2 border-t border-border">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Last activity</span>
                  <span>{formatLastActivity(group.lastActivity)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {/* Loading skeletons */}
        {loading && groups.length === 0 && (
          <>
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="size-5 bg-muted rounded" />
                      <div className="h-5 w-32 bg-muted rounded" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="h-4 w-16 bg-muted rounded" />
                    <div className="h-5 w-20 bg-muted rounded" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="h-4 w-20 bg-muted rounded" />
                    <div className="h-4 w-12 bg-muted rounded" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="h-4 w-14 bg-muted rounded" />
                    <div className="h-4 w-16 bg-muted rounded" />
                  </div>
                  <div className="pt-2 border-t border-border">
                    <div className="flex items-center justify-between">
                      <div className="h-3 w-20 bg-muted rounded" />
                      <div className="h-3 w-12 bg-muted rounded" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        )}

        {groups.length === 0 && !loading && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            No groups found. Make sure the bot is connected to WhatsApp.
          </div>
        )}
      </div>

      {/* Group Details Dialog */}
      <Dialog open={!!selectedGroup} onOpenChange={(open) => { if (!open) { setSelectedGroup(null); setConfigError(null); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {selectedGroup && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Users className="size-5" />
                  {selectedGroup.name}
                  {selectedGroup.isControlGroup && (
                    <Badge variant="outline" className="ml-2">
                      Control Group
                    </Badge>
                  )}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-6 py-4">
                {/* Config Error Alert */}
                {configError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                    {configError}
                  </div>
                )}

                {/* Mode Selector */}
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground">
                    Operational Mode
                  </h3>
                  <ModeSelector
                    groupName={selectedGroup.name}
                    currentMode={selectedGroup.mode}
                    learningDays={selectedGroup.learningDays}
                    rulesActive={selectedGroup.rulesActive}
                    patternCoverage={groupConfig?.patternCoverage || 0}
                    onModeChange={(mode) => handleModeChange(selectedGroup, mode)}
                    disabled={configLoading}
                  />
                </div>

                {/* AI Threshold */}
                {groupConfig && (
                  <AIThreshold
                    currentThreshold={groupConfig.aiThreshold}
                    onSave={handleThresholdSave}
                    disabled={configLoading}
                  />
                )}

                {/* Quick Stats */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 rounded-lg bg-muted/50 text-center">
                    <div className="text-2xl font-bold">
                      {selectedGroup.messagesCollected.toLocaleString()}
                    </div>
                    <div className="text-sm text-muted-foreground">Messages</div>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50 text-center">
                    <div className="text-2xl font-bold">{selectedGroup.rulesActive}</div>
                    <div className="text-sm text-muted-foreground">Active Rules</div>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50 text-center">
                    <div className="text-2xl font-bold">{groupConfig?.patternCoverage || 0}%</div>
                    <div className="text-sm text-muted-foreground">Pattern Coverage</div>
                  </div>
                </div>

                {/* Player Leaderboard */}
                <div className="pt-4 border-t border-border">
                  <PlayerLeaderboard
                    groupId={selectedGroup.jid}
                    limit={10}
                    onRoleChange={(jid, role) => {
                      console.log(`Role changed for ${jid}: ${role}`)
                    }}
                  />
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
