import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { API_ENDPOINTS } from '@/lib/api'

export interface SimulatorPlayer {
  jid: string
  name: string
  role: string | null
}

export interface SimulatorGroup {
  groupJid: string
  groupName: string
  mode: string
  isControlGroup: boolean
  playerRoles: Record<string, string>
  players: SimulatorPlayer[]
}

interface SimulatorGroupListProps {
  selectedGroupJid: string | null
  onSelectGroup: (group: SimulatorGroup) => void
}

const MODE_BADGES: Record<string, { label: string; className: string }> = {
  active: { label: 'active', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  learning: { label: 'learning', className: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  assisted: { label: 'assisted', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  paused: { label: 'paused', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
}

export function SimulatorGroupList({ selectedGroupJid, onSelectGroup }: SimulatorGroupListProps) {
  const [groups, setGroups] = useState<SimulatorGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetchGroups() {
      try {
        setLoading(true)
        const res = await fetch(API_ENDPOINTS.simulatorGroups)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) {
          setGroups(data.groups || [])
          setError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to fetch groups')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchGroups()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="p-4 text-sm text-muted-foreground animate-pulse">
        Loading groups...
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-400">
        Error: {error}
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No groups found. Make sure the bot has connected to WhatsApp.
      </div>
    )
  }

  // Sort: control group first, then by name
  const sorted = [...groups].sort((a, b) => {
    if (a.isControlGroup && !b.isControlGroup) return -1
    if (!a.isControlGroup && b.isControlGroup) return 1
    return a.groupName.localeCompare(b.groupName)
  })

  return (
    <div className="flex flex-col">
      {sorted.map((group) => {
        const modeBadge = MODE_BADGES[group.mode]
        const isSelected = selectedGroupJid === group.groupJid

        return (
          <button
            key={group.groupJid}
            onClick={() => onSelectGroup(group)}
            className={cn(
              'flex items-center gap-3 px-4 py-3 text-left transition-all border-b border-border/50',
              isSelected
                ? 'bg-primary/10 border-l-2 border-l-primary'
                : 'hover:bg-accent/50 border-l-2 border-l-transparent'
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">
                  {group.groupName}
                </span>
                {group.isControlGroup && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/30 shrink-0">
                    CONTROL
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                {modeBadge && (
                  <Badge variant="outline" className={cn('text-[10px] h-4', modeBadge.className)}>
                    {modeBadge.label}
                  </Badge>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {group.players.length} players
                </span>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
