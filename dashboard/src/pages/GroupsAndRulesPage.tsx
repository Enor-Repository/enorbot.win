import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronRight, Zap, Clock, DollarSign, Handshake, Users } from 'lucide-react'
import { API_ENDPOINTS } from '@/lib/api'
import { showToast } from '@/lib/toast'
import { GroupSpreadEditor } from '@/components/groups/GroupSpreadEditor'
import { GroupTimeRulesEditor } from '@/components/groups/GroupTimeRulesEditor'
import { GroupTriggersEditor } from '@/components/groups/GroupTriggersEditor'
import GroupDealsView from '@/components/groups/GroupDealsView'

const FETCH_TIMEOUT_MS = 10000

const SECTION_STORAGE_KEY = 'enorbot-sections'
const DEFAULT_SECTIONS: Record<string, boolean> = { triggers: true, timeRules: false, spread: false, deals: false, players: false }

function getSavedSections(groupJid: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(`${SECTION_STORAGE_KEY}-${groupJid}`)
    return raw ? { ...DEFAULT_SECTIONS, ...JSON.parse(raw) } : { ...DEFAULT_SECTIONS }
  } catch {
    return { ...DEFAULT_SECTIONS }
  }
}

function saveSectionState(groupJid: string, key: string, expanded: boolean): void {
  const current = getSavedSections(groupJid)
  current[key] = expanded
  localStorage.setItem(`${SECTION_STORAGE_KEY}-${groupJid}`, JSON.stringify(current))
}

const SECTIONS = [
  { key: 'triggers', icon: Zap, label: 'Triggers', color: 'teal' },
  { key: 'timeRules', icon: Clock, label: 'Time-Based Rules', color: 'blue' },
  { key: 'spread', icon: DollarSign, label: 'Pricing Configuration', color: 'amber' },
  { key: 'deals', icon: Handshake, label: 'Active Deals', color: 'emerald' },
  { key: 'players', icon: Users, label: 'Player Roles', color: 'cyan' },
] as const

const SECTION_COLORS: Record<string, { text: string; border: string; bg: string; badge: string }> = {
  teal: { text: 'text-teal-400', border: 'border-teal-500/20', bg: 'hover:bg-teal-500/5', badge: 'bg-teal-500/15 text-teal-400 border-teal-500/30' },
  blue: { text: 'text-blue-400', border: 'border-blue-500/20', bg: 'hover:bg-blue-500/5', badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  amber: { text: 'text-amber-400', border: 'border-amber-500/20', bg: 'hover:bg-amber-500/5', badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  emerald: { text: 'text-emerald-400', border: 'border-emerald-500/20', bg: 'hover:bg-emerald-500/5', badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  cyan: { text: 'text-cyan-400', border: 'border-cyan-500/20', bg: 'hover:bg-cyan-500/5', badge: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' },
}

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

interface Player {
  jid: string
  name: string
  messageCount: number
  role: 'eNor' | 'non-eNor' | null
}

export function GroupsAndRulesPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)
  const [groupPlayers, setGroupPlayers] = useState<Record<string, Player[]>>({})
  const [loadingGroups, setLoadingGroups] = useState(true)
  const [loadingPlayers, setLoadingPlayers] = useState<Record<string, boolean>>({})
  // updatingRole removed — backend route not yet implemented
  const [sectionState, setSectionState] = useState<Record<string, Record<string, boolean>>>({})
  const [mountedSections, setMountedSections] = useState<Record<string, Set<string>>>({})

  // Section counts per group { [groupJid]: { triggers: 5, timeRules: 3, deals: 0 } }
  const [sectionCounts, setSectionCounts] = useState<Record<string, Record<string, number>>>({})

  const handleCountChange = useCallback((groupJid: string, sectionKey: string, count: number) => {
    setSectionCounts(prev => {
      const current = prev[groupJid] || {}
      if (current[sectionKey] === count) return prev
      return { ...prev, [groupJid]: { ...current, [sectionKey]: count } }
    })
  }, [])

  // Stable callback refs per group+section (avoids child useEffect re-fires)
  const countCallbackCache = useRef<Record<string, (count: number) => void>>({})
  const getCountCallback = useCallback((groupJid: string, sectionKey: string) => {
    const key = `${groupJid}::${sectionKey}`
    if (!countCallbackCache.current[key]) {
      countCallbackCache.current[key] = (count: number) => handleCountChange(groupJid, sectionKey, count)
    }
    return countCallbackCache.current[key]
  }, [handleCountChange])

  const fetchGroups = useCallback(async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const response = await fetch(API_ENDPOINTS.groups, {
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()
      setGroups(data.groups || [])
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to fetch groups:', error)
      }
      showToast({
        type: 'error',
        message: 'Failed to load groups'
      })
    } finally {
      clearTimeout(timeoutId)
      setLoadingGroups(false)
    }
  }, [])

  const fetchGroupPlayers = async (groupJid: string) => {
    setLoadingPlayers(prev => ({ ...prev, [groupJid]: true }))

    try {
      const response = await fetch(API_ENDPOINTS.groupPlayers(groupJid))

      if (!response.ok) {
        throw new Error('Failed to fetch players')
      }

      const data = await response.json()
      const players = data.players || []
      setGroupPlayers(prev => ({ ...prev, [groupJid]: players }))
      handleCountChange(groupJid, 'players', players.length)
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to fetch players:', error)
      }
      setGroupPlayers(prev => ({ ...prev, [groupJid]: [] }))
      handleCountChange(groupJid, 'players', 0)
    } finally {
      setLoadingPlayers(prev => ({ ...prev, [groupJid]: false }))
    }
  }

  const updatePlayerRole = async (_groupJid: string, _playerJid: string, _role: 'eNor' | 'non-eNor' | null) => {
    // Backend route for player roles not yet implemented (Sprint backlog)
    showToast({
      type: 'info',
      message: 'Player role management coming soon'
    })
  }

  useEffect(() => {
    fetchGroups()
  }, [fetchGroups])

  const toggleGroup = (groupId: string, groupJid: string) => {
    if (expandedGroupId === groupId) {
      setExpandedGroupId(null)
    } else {
      setExpandedGroupId(groupId)
      const saved = getSavedSections(groupJid)
      setSectionState(prev => ({ ...prev, [groupJid]: saved }))
      setMountedSections(prev => {
        const openKeys = Object.entries(saved).filter(([, v]) => v).map(([k]) => k)
        return { ...prev, [groupJid]: new Set(openKeys) }
      })

      if (!groupPlayers[groupJid]) {
        fetchGroupPlayers(groupJid)
      }
    }
  }

  const toggleSection = (groupJid: string, sectionKey: string) => {
    setSectionState(prev => {
      const current = prev[groupJid] || { ...DEFAULT_SECTIONS }
      const newVal = !current[sectionKey]
      saveSectionState(groupJid, sectionKey, newVal)
      if (newVal) {
        setMountedSections(mp => {
          const existing = mp[groupJid] || new Set<string>()
          return { ...mp, [groupJid]: new Set([...existing, sectionKey]) }
        })
      }
      return { ...prev, [groupJid]: { ...current, [sectionKey]: newVal } }
    })
  }

  const getModeColor = (mode: string) => {
    const colors = {
      learning: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
      active: 'bg-green-500/20 text-green-300 border-green-500/40',
      paused: 'bg-gray-500/20 text-gray-300 border-gray-500/40',
    }
    return colors[mode as keyof typeof colors] || colors.learning
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-4xl font-bold tracking-tight">Groups & Rules</h1>
        <p className="text-muted-foreground mt-2 text-lg">
          Manage groups, triggers, and response rules
        </p>
      </div>

      {/* Groups List */}
      <div className="space-y-2">
        {loadingGroups ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="border-purple-500/30 animate-pulse">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-4 rounded bg-purple-500/20" />
                    <div className="h-4 w-32 rounded bg-purple-500/10" />
                    <div className="h-4 w-16 rounded bg-purple-500/10 ml-auto" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <Card className="border-purple-500/30">
            <CardContent className="p-8 text-center text-muted-foreground">
              No groups found
            </CardContent>
          </Card>
        ) : (
          groups.map((group) => {
            const isExpanded = expandedGroupId === group.id
            const players = groupPlayers[group.jid] || []
            const isLoadingPlayers = loadingPlayers[group.jid]

            return (
              <Card
                key={group.id}
                className="border-purple-500/30 bg-gradient-to-br from-purple-500/5 via-purple-500/5 to-transparent hover:from-purple-500/10 transition-all relative overflow-hidden"
              >
                {/* Tech-y glow effect */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

                {/* Group Header - Clickable */}
                <button
                  onClick={() => toggleGroup(group.id, group.jid)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-purple-500/5 transition-all duration-200 rounded-t-lg border-l-2 border-l-transparent hover:border-l-purple-400 relative"
                >
                  {/* Expand/Collapse Icon */}
                  <div className="flex-shrink-0">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-purple-400" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-purple-400" />
                    )}
                  </div>

                  {/* Group Info - Single Line */}
                  <div className="flex-1 min-w-0 flex items-center gap-3">
                    <h3 className="text-base font-mono font-semibold text-foreground truncate">
                      {group.name}
                    </h3>
                    {group.isControlGroup && (
                      <Badge className="bg-purple-500/30 text-purple-300 border-purple-500/40 text-[10px] px-1.5 py-0 uppercase">
                        CTRL
                      </Badge>
                    )}
                    <Badge className={`${getModeColor(group.mode)} text-[10px] font-mono px-1.5 py-0 uppercase`}>
                      {group.mode}
                    </Badge>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono ml-auto">
                      <span className="flex items-center gap-1">
                        <span className="text-purple-400">{group.messagesCollected}</span>
                        <span className="opacity-60">msg</span>
                      </span>
                      <span className="opacity-40">|</span>
                      <span className="flex items-center gap-1">
                        <span className="text-purple-400">{group.learningDays}</span>
                        <span className="opacity-60">d</span>
                      </span>
                      {group.rulesActive > 0 && (
                        <>
                          <span className="opacity-40">|</span>
                          <span className="flex items-center gap-1 text-green-400 font-semibold">
                            {group.rulesActive} rules
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Rules Count Badge */}
                  {group.rulesActive > 0 && (
                    <div className="flex-shrink-0 h-6 w-6 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center shadow-[0_0_8px_rgba(34,197,94,0.3)]">
                      <span className="text-xs font-bold text-green-400">{group.rulesActive}</span>
                    </div>
                  )}
                </button>

                {/* Expanded Sections — Collapsible Accordion */}
                {isExpanded && (
                  <div className="border-t border-purple-500/20 bg-gradient-to-b from-purple-500/5 to-transparent">
                    {SECTIONS.map((section, idx) => {
                      const sections = sectionState[group.jid] || { ...DEFAULT_SECTIONS }
                      const isSectionOpen = sections[section.key] ?? false
                      const isMounted = mountedSections[group.jid]?.has(section.key) || isSectionOpen
                      const colors = SECTION_COLORS[section.color]
                      const SectionIcon = section.icon
                      const isLast = idx === SECTIONS.length - 1

                      return (
                        <div key={section.key} className={!isLast ? `border-b ${colors.border}` : ''}>
                          {/* Section Header */}
                          <button
                            onClick={() => toggleSection(group.jid, section.key)}
                            className={`w-full text-left flex items-center gap-3 px-4 py-3 transition-all duration-150 ${colors.bg}`}
                          >
                            <div className="flex-shrink-0">
                              {isSectionOpen ? (
                                <ChevronDown className={`h-3.5 w-3.5 ${colors.text}`} />
                              ) : (
                                <ChevronRight className={`h-3.5 w-3.5 ${colors.text}`} />
                              )}
                            </div>
                            <SectionIcon className={`h-4 w-4 ${colors.text}`} />
                            <span className={`text-sm font-semibold uppercase tracking-wider ${colors.text}`}>
                              {section.label}
                            </span>
                            {(sectionCounts[group.jid]?.[section.key] ?? -1) >= 0 && (
                              <Badge className={`text-[9px] font-mono px-1.5 py-0 ${colors.badge}`}>
                                {sectionCounts[group.jid][section.key]}
                              </Badge>
                            )}
                          </button>

                          {/* Section Content — kept mounted once opened to avoid re-fetching */}
                          {isMounted && (
                            <div className={`px-4 pb-4${isSectionOpen ? '' : ' hidden'}`}>
                              {section.key === 'triggers' && (
                                <GroupTriggersEditor groupJid={group.jid} hideTitle onCountChange={getCountCallback(group.jid, 'triggers')} />
                              )}
                              {section.key === 'timeRules' && (
                                <GroupTimeRulesEditor groupJid={group.jid} hideTitle onCountChange={getCountCallback(group.jid, 'timeRules')} />
                              )}
                              {section.key === 'spread' && (
                                <GroupSpreadEditor groupJid={group.jid} hideTitle onCountChange={getCountCallback(group.jid, 'spread')} />
                              )}
                              {section.key === 'deals' && (
                                <GroupDealsView groupJid={group.jid} hideTitle isVisible={isSectionOpen} onCountChange={getCountCallback(group.jid, 'deals')} />
                              )}
                              {section.key === 'players' && (
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                                    <span className="flex items-center gap-1">
                                      <div className="h-1.5 w-1.5 rounded-full bg-cyan-400"></div>
                                      eNor
                                    </span>
                                    <span className="opacity-40">|</span>
                                    <span className="flex items-center gap-1">
                                      <div className="h-1.5 w-1.5 rounded-full bg-amber-400"></div>
                                      non-eNor
                                    </span>
                                  </div>

                                  {isLoadingPlayers ? (
                                    <div className="text-center py-4 text-muted-foreground text-sm">
                                      Loading players...
                                    </div>
                                  ) : players.length === 0 ? (
                                    <div className="text-center py-4 border border-dashed border-cyan-500/30 rounded-md">
                                      <p className="text-muted-foreground text-xs">
                                        No active players yet
                                      </p>
                                    </div>
                                  ) : (
                                    <div className="max-h-[240px] overflow-y-auto space-y-1.5 pr-2 scrollbar-thin scrollbar-thumb-cyan-500/30 scrollbar-track-transparent">
                                      {players.map((player) => (
                                          <div
                                            key={player.jid}
                                            className="flex items-center gap-2 px-3 py-2 rounded-md bg-background/30 border border-cyan-500/10 hover:border-cyan-500/30 hover:shadow-[0_0_8px_rgba(34,211,238,0.1)] transition-all backdrop-blur-sm"
                                          >
                                            <div className="flex-1 min-w-0">
                                              <div className="text-sm font-mono font-semibold text-foreground truncate">
                                                {player.name}
                                              </div>
                                              <div className="text-[10px] text-muted-foreground font-mono">
                                                {player.messageCount} msg
                                              </div>
                                            </div>

                                            {/* Role Toggle Switch */}
                                            <div className="relative inline-flex items-center bg-purple-500/10 border border-purple-500/30 rounded-lg p-0.5 w-[140px]">
                                              <button
                                                onClick={() => updatePlayerRole(group.jid, player.jid, 'eNor')}
                                                className={`relative z-10 flex-1 px-2 py-1 text-[10px] font-mono transition-all rounded-md ${
                                                  player.role === 'eNor'
                                                    ? 'text-cyan-300'
                                                    : 'text-muted-foreground hover:text-foreground'
                                                }`}
                                              >
                                                eNor
                                              </button>
                                              <button
                                                onClick={() => updatePlayerRole(group.jid, player.jid, 'non-eNor')}
                                                className={`relative z-10 flex-1 px-2 py-1 text-[10px] font-mono transition-all rounded-md ${
                                                  player.role === 'non-eNor'
                                                    ? 'text-amber-300'
                                                    : 'text-muted-foreground hover:text-foreground'
                                                }`}
                                              >
                                                non-eNor
                                              </button>
                                              {/* Sliding indicator */}
                                              <div
                                                className={`absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] transition-all duration-200 rounded-md ${
                                                  player.role === 'eNor'
                                                    ? 'left-0.5 bg-cyan-500/30 border border-cyan-500/50 shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                                                    : player.role === 'non-eNor'
                                                    ? 'left-[calc(50%+0.5px)] bg-amber-500/30 border border-amber-500/50 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
                                                    : 'opacity-0'
                                                }`}
                                              />
                                            </div>
                                          </div>
                                        ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
