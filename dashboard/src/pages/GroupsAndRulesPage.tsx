import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight, Zap, Clock, DollarSign, Handshake, Users, Shield, Lock, Plus, X, Save, Loader2, Search, Check } from 'lucide-react'
import { API_ENDPOINTS, writeHeaders } from '@/lib/api'
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

/** Pattern from the system_patterns API (editable) */
interface SystemPatternFromAPI {
  id: string
  patternKey: string
  keywords: string[]
  patternType: string
  handler: string
  description: string
  updatedAt: string
}

/** Display info for handler badge colors */
const HANDLER_COLORS: Record<string, string> = {
  PRICE_HANDLER: 'bg-green-500/20 text-green-300 border-green-500/40',
  DEAL_HANDLER: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  TRONSCAN_HANDLER: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  RECEIPT_HANDLER: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
}

/** Friendly names for pattern keys */
const PATTERN_NAMES: Record<string, string> = {
  price_request: 'Price Request',
  deal_cancellation: 'Deal Cancellation',
  price_lock: 'Price Lock',
  deal_confirmation: 'Deal Confirmation',
}

/** Friendly handler labels */
const HANDLER_LABELS: Record<string, string> = {
  PRICE_HANDLER: 'PRICE',
  DEAL_HANDLER: 'DEAL',
  TRONSCAN_HANDLER: 'TRONSCAN',
  RECEIPT_HANDLER: 'RECEIPT',
}

/** Patterns that remain read-only (complex parsing, not simple keywords) */
interface StaticPattern {
  category: string
  handler: string
  handlerColor: string
  keywords: string[]
  patternType: string
  description: string
}

const STATIC_PATTERNS: StaticPattern[] = [
  {
    category: 'Volume Detection',
    handler: 'DEAL',
    handlerColor: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    keywords: ['10k', '5mil', '5000', '5.000'],
    patternType: 'pattern',
    description: 'Extracts BRL/USDT amounts to initiate a deal quote',
  },
  {
    category: 'Tronscan Link',
    handler: 'TRONSCAN',
    handlerColor: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    keywords: ['tronscan.org/#/transaction/...'],
    patternType: 'url',
    description: 'Extracts transaction hash and updates the Excel log',
  },
  {
    category: 'Receipt Detection',
    handler: 'RECEIPT',
    handlerColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    keywords: ['PDF attachment', 'Image attachment'],
    patternType: 'mime',
    description: 'Processes payment receipts (PIX comprovantes)',
  },
]

const SECTION_COLORS: Record<string, { text: string; border: string; bg: string; badge: string }> = {
  teal: { text: 'text-teal-400', border: 'border-teal-500/20', bg: 'hover:bg-teal-500/5', badge: 'bg-teal-500/15 text-teal-400 border-teal-500/30' },
  slate: { text: 'text-slate-400', border: 'border-slate-500/20', bg: 'hover:bg-slate-500/5', badge: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
  blue: { text: 'text-blue-400', border: 'border-blue-500/20', bg: 'hover:bg-blue-500/5', badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  amber: { text: 'text-amber-400', border: 'border-amber-500/20', bg: 'hover:bg-amber-500/5', badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  emerald: { text: 'text-emerald-400', border: 'border-emerald-500/20', bg: 'hover:bg-emerald-500/5', badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  cyan: { text: 'text-cyan-400', border: 'border-cyan-500/20', bg: 'hover:bg-cyan-500/5', badge: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' },
}

/** Extracted component for the system patterns section */
function SystemPatternsSection({
  patterns,
  loading,
  onLoad,
  editingPattern,
  editKeywords,
  newKeyword,
  savingPattern,
  newKeywordRef,
  onStartEdit,
  onCancelEdit,
  onAddKeyword,
  onRemoveKeyword,
  onSave,
  onNewKeywordChange,
  testMessage,
  testResults,
  testingPattern,
  onTestMessageChange,
}: {
  patterns: SystemPatternFromAPI[]
  loading: boolean
  onLoad: () => void
  editingPattern: string | null
  editKeywords: string[]
  newKeyword: string
  savingPattern: boolean
  newKeywordRef: React.RefObject<HTMLInputElement | null>
  onStartEdit: (p: SystemPatternFromAPI) => void
  onCancelEdit: () => void
  onAddKeyword: () => void
  onRemoveKeyword: (i: number) => void
  onSave: (key: string) => void
  onNewKeywordChange: (v: string) => void
  testMessage: string
  testResults: Array<{ patternKey: string; matched: boolean; matchedKeyword: string | null }> | null
  testingPattern: boolean
  onTestMessageChange: (v: string) => void
}) {
  useEffect(() => { onLoad() }, [onLoad])

  if (loading) {
    return (
      <div className="text-center py-4 text-muted-foreground text-sm">
        Loading system patterns...
      </div>
    )
  }

  // Build a lookup for test results by patternKey
  const testResultMap = new Map(testResults?.map(r => [r.patternKey, r]) ?? [])

  return (
    <div className="space-y-2">
      {/* Pattern Tester */}
      <div className="mb-3 p-3 rounded-md bg-slate-500/5 border border-slate-500/15">
        <div className="flex items-center gap-2 mb-2">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-[11px] font-mono font-semibold text-slate-400 uppercase tracking-wider">
            Pattern Tester
          </span>
          {testingPattern && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
        </div>
        <input
          type="text"
          value={testMessage}
          onChange={(e) => onTestMessageChange(e.target.value)}
          placeholder="Type a message to test which pattern matches..."
          className="w-full px-2.5 py-1.5 text-xs font-mono bg-background border border-slate-500/30 rounded focus:border-slate-400/50 focus:outline-none placeholder:text-muted-foreground/50"
        />
        {testResults && testMessage.trim() && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {testResults.map((r) => (
              <span
                key={r.patternKey}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border ${
                  r.matched
                    ? 'bg-green-500/15 text-green-300 border-green-500/30'
                    : 'bg-slate-500/5 text-slate-500 border-slate-500/15'
                }`}
              >
                {r.matched && <Check className="h-2.5 w-2.5" />}
                {PATTERN_NAMES[r.patternKey] || r.patternKey}
                {r.matchedKeyword && (
                  <code className="ml-1 text-green-200">"{r.matchedKeyword}"</code>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Editable patterns from DB */}
      {patterns.map((pattern) => {
        const isEditing = editingPattern === pattern.patternKey
        const handlerColor = HANDLER_COLORS[pattern.handler] || 'bg-slate-500/20 text-slate-300 border-slate-500/40'
        const handlerLabel = HANDLER_LABELS[pattern.handler] || pattern.handler
        const displayName = PATTERN_NAMES[pattern.patternKey] || pattern.patternKey
        const testHit = testResultMap.get(pattern.patternKey)
        const isTestMatch = testHit?.matched && testMessage.trim()

        return (
          <div
            key={pattern.patternKey}
            className={`px-3 py-2.5 rounded-md border transition-all ${
              isTestMatch
                ? 'bg-green-500/5 border-green-500/30'
                : isEditing
                ? 'bg-slate-500/10 border-slate-400/30'
                : 'bg-slate-500/5 border-slate-500/10 hover:border-slate-500/20'
            }`}
          >
            <div className="flex items-start gap-3">
              <Shield className="h-3.5 w-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-mono font-semibold text-slate-300">
                    {displayName}
                  </span>
                  <Badge className={`${handlerColor} text-[9px] font-mono px-1.5 py-0 uppercase`}>
                    {handlerLabel}
                  </Badge>
                  <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30 text-[9px] font-mono px-1.5 py-0">
                    {pattern.patternType}
                  </Badge>
                  {!isEditing && (
                    <button
                      onClick={() => onStartEdit(pattern)}
                      className="ml-auto text-[10px] text-slate-500 hover:text-slate-300 font-mono transition-colors"
                    >
                      edit
                    </button>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-2">
                    {/* Current keywords with remove buttons */}
                    <div className="flex flex-wrap gap-1.5">
                      {editKeywords.map((kw, i) => (
                        <span
                          key={`${kw}-${i}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-500/15 border border-slate-500/30 text-[11px] font-mono text-slate-200"
                        >
                          {kw}
                          <button
                            onClick={() => onRemoveKeyword(i)}
                            className="text-slate-500 hover:text-red-400 transition-colors"
                            title="Remove keyword"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>

                    {/* Add new keyword */}
                    <div className="flex items-center gap-2">
                      <input
                        ref={newKeywordRef}
                        type="text"
                        value={newKeyword}
                        onChange={(e) => onNewKeywordChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); onAddKeyword() }
                          if (e.key === 'Escape') onCancelEdit()
                        }}
                        placeholder="Add keyword..."
                        className="flex-1 px-2 py-1 text-xs font-mono bg-background border border-slate-500/30 rounded focus:border-slate-400/50 focus:outline-none"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onAddKeyword}
                        className="h-7 px-2 text-xs text-slate-400 hover:text-slate-200"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>

                    {/* Save / Cancel */}
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={() => onSave(pattern.patternKey)}
                        disabled={savingPattern || editKeywords.length === 0}
                        className="h-7 px-3 text-xs bg-green-600/80 hover:bg-green-600 text-white"
                      >
                        {savingPattern ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onCancelEdit}
                        disabled={savingPattern}
                        className="h-7 px-3 text-xs text-slate-400"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {pattern.keywords.map((kw) => (
                        <code
                          key={kw}
                          className="px-1.5 py-0.5 rounded bg-slate-500/10 border border-slate-500/20 text-[11px] font-mono text-slate-300"
                        >
                          {kw}
                        </code>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {pattern.description}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {/* Static read-only patterns (not editable — complex parsing logic) */}
      {STATIC_PATTERNS.map((pattern) => (
        <div
          key={pattern.category}
          className="flex items-start gap-3 px-3 py-2.5 rounded-md bg-slate-500/5 border border-slate-500/10 opacity-70"
        >
          <Lock className="h-3.5 w-3.5 text-slate-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-mono font-semibold text-slate-300">
                {pattern.category}
              </span>
              <Badge className={`${pattern.handlerColor} text-[9px] font-mono px-1.5 py-0 uppercase`}>
                {pattern.handler}
              </Badge>
              <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30 text-[9px] font-mono px-1.5 py-0">
                {pattern.patternType}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1">
              {pattern.keywords.map((kw) => (
                <code
                  key={kw}
                  className="px-1.5 py-0.5 rounded bg-slate-500/10 border border-slate-500/20 text-[11px] font-mono text-slate-300"
                >
                  {kw}
                </code>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {pattern.description}
            </p>
          </div>
        </div>
      ))}

      <div className="pt-2 border-t border-slate-500/10">
        <p className="text-[10px] text-muted-foreground font-mono">
          Editable patterns apply to all active groups. Changes take effect immediately.
          Volume, Tronscan, and Receipt patterns use complex parsing and are read-only.
        </p>
      </div>
    </div>
  )
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

  // System patterns state (editable — global, not per-group)
  const [systemPatternsOpen, setSystemPatternsOpen] = useState(false)
  const [systemPatterns, setSystemPatterns] = useState<SystemPatternFromAPI[]>([])
  const [loadingPatterns, setLoadingPatterns] = useState(false)
  const [patternsLoaded, setPatternsLoaded] = useState(false)
  const [editingPattern, setEditingPattern] = useState<string | null>(null)
  const [editKeywords, setEditKeywords] = useState<string[]>([])
  const [newKeyword, setNewKeyword] = useState('')
  const [savingPattern, setSavingPattern] = useState(false)
  const newKeywordRef = useRef<HTMLInputElement>(null)

  // Pattern tester state
  const [testMessage, setTestMessage] = useState('')
  const [testResults, setTestResults] = useState<Array<{ patternKey: string; matched: boolean; matchedKeyword: string | null }> | null>(null)
  const [testing, setTesting] = useState(false)
  const testDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const testPatterns = useCallback(async (message: string) => {
    if (!message.trim()) {
      setTestResults(null)
      return
    }
    setTesting(true)
    try {
      const res = await fetch(API_ENDPOINTS.systemPatternTest, {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({ message }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setTestResults(data.matches)
    } catch {
      setTestResults(null)
    } finally {
      setTesting(false)
    }
  }, [])

  const handleTestMessageChange = useCallback((value: string) => {
    setTestMessage(value)
    if (testDebounceRef.current) clearTimeout(testDebounceRef.current)
    testDebounceRef.current = setTimeout(() => testPatterns(value), 300)
  }, [testPatterns])

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

  const fetchSystemPatterns = useCallback(async () => {
    if (patternsLoaded) return
    setLoadingPatterns(true)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(API_ENDPOINTS.systemPatterns, { signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSystemPatterns(data.patterns || [])
      setPatternsLoaded(true)
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to fetch system patterns:', error)
      showToast({ type: 'error', message: 'Failed to load system patterns' })
    } finally {
      clearTimeout(timeoutId)
      setLoadingPatterns(false)
    }
  }, [patternsLoaded])

  const startEditing = (pattern: SystemPatternFromAPI) => {
    setEditingPattern(pattern.patternKey)
    setEditKeywords([...pattern.keywords])
    setNewKeyword('')
  }

  const cancelEditing = () => {
    setEditingPattern(null)
    setEditKeywords([])
    setNewKeyword('')
  }

  const addKeyword = () => {
    const kw = newKeyword.trim().toLowerCase()
    if (!kw) return
    if (editKeywords.includes(kw)) {
      showToast({ type: 'error', message: 'Keyword already exists' })
      return
    }
    setEditKeywords(prev => [...prev, kw])
    setNewKeyword('')
    newKeywordRef.current?.focus()
  }

  const removeKeyword = (index: number) => {
    if (editKeywords.length <= 1) {
      showToast({ type: 'error', message: 'At least one keyword is required' })
      return
    }
    setEditKeywords(prev => prev.filter((_, i) => i !== index))
  }

  const savePattern = async (patternKey: string) => {
    if (editKeywords.length === 0) {
      showToast({ type: 'error', message: 'At least one keyword is required' })
      return
    }
    setSavingPattern(true)
    try {
      const res = await fetch(API_ENDPOINTS.systemPattern(patternKey), {
        method: 'PUT',
        headers: writeHeaders(),
        body: JSON.stringify({ keywords: editKeywords }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      // Update local state
      setSystemPatterns(prev => prev.map(p => p.patternKey === patternKey ? data.pattern : p))
      setEditingPattern(null)
      setEditKeywords([])
      showToast({ type: 'success', message: 'Keywords updated — bot will use new keywords immediately' })
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : 'Failed to save' })
    } finally {
      setSavingPattern(false)
    }
  }

  useEffect(() => {
    fetchGroups()
  }, [fetchGroups])

  // Cleanup debounce timer on unmount (F8)
  useEffect(() => {
    const ref = testDebounceRef
    return () => { if (ref.current) clearTimeout(ref.current) }
  }, [])

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

      {/* Global System Patterns — applies to ALL groups */}
      <Card className="border-slate-500/30 bg-gradient-to-br from-slate-500/5 via-slate-500/5 to-transparent relative overflow-hidden">
        <button
          onClick={() => {
            setSystemPatternsOpen(prev => !prev)
            if (!patternsLoaded) fetchSystemPatterns()
          }}
          className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-500/5 transition-all duration-200 rounded-t-lg"
        >
          <div className="flex-shrink-0">
            {systemPatternsOpen ? (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronRight className="h-4 w-4 text-slate-400" />
            )}
          </div>
          <Shield className="h-4 w-4 text-slate-400" />
          <span className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            System Patterns
          </span>
          <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30 text-[9px] font-mono px-1.5 py-0 uppercase ml-1">
            GLOBAL
          </Badge>
        </button>
        {systemPatternsOpen && (
          <div className="px-4 pb-4 border-t border-slate-500/20">
            <SystemPatternsSection
              patterns={systemPatterns}
              loading={loadingPatterns}
              onLoad={fetchSystemPatterns}
              editingPattern={editingPattern}
              editKeywords={editKeywords}
              newKeyword={newKeyword}
              savingPattern={savingPattern}
              newKeywordRef={newKeywordRef}
              onStartEdit={startEditing}
              onCancelEdit={cancelEditing}
              onAddKeyword={addKeyword}
              onRemoveKeyword={removeKeyword}
              onSave={savePattern}
              onNewKeywordChange={setNewKeyword}
              testMessage={testMessage}
              testResults={testResults}
              testingPattern={testing}
              onTestMessageChange={handleTestMessageChange}
            />
          </div>
        )}
      </Card>

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
                                <GroupSpreadEditor groupJid={group.jid} hideTitle />
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
