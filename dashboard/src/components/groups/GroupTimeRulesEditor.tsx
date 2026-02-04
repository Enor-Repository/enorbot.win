/**
 * Group Time-Based Rules Editor
 * Sprint 2: Allows Daniel (CIO) to manage time-based pricing rules per group.
 * Rules define WHEN and HOW pricing behaves (schedule + pricing source + spreads).
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Trash2, Edit, X, Clock, Calendar, Zap, AlertTriangle, Eye } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { API_ENDPOINTS, writeHeaders } from '@/lib/api'
import { showToast } from '@/lib/toast'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

// ============================================================================
// Types (mirror of ruleService.ts types - kept local to avoid cross-build deps)
// ============================================================================

type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
type PricingSource = 'commercial_dollar' | 'usdt_binance'
type SpreadMode = 'bps' | 'abs_brl' | 'flat'

interface TimeRule {
  id: string
  groupJid: string
  name: string
  description: string | null
  scheduleStartTime: string
  scheduleEndTime: string
  scheduleDays: DayOfWeek[]
  scheduleTimezone: string
  priority: number
  pricingSource: PricingSource
  spreadMode: SpreadMode
  sellSpread: number
  buySpread: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface TimeRuleForm {
  name: string
  description: string
  scheduleStartTime: string
  scheduleEndTime: string
  scheduleDays: DayOfWeek[]
  scheduleTimezone: string
  priority: number
  pricingSource: PricingSource
  spreadMode: SpreadMode
  sellSpread: number
  buySpread: number
  isActive: boolean
}

interface GroupTimeRulesEditorProps {
  groupJid: string
  hideTitle?: boolean
  onCountChange?: (count: number) => void
}

// ============================================================================
// Constants
// ============================================================================

const ALL_DAYS: { key: DayOfWeek; label: string; short: string }[] = [
  { key: 'mon', label: 'Monday', short: 'Mon' },
  { key: 'tue', label: 'Tuesday', short: 'Tue' },
  { key: 'wed', label: 'Wednesday', short: 'Wed' },
  { key: 'thu', label: 'Thursday', short: 'Thu' },
  { key: 'fri', label: 'Friday', short: 'Fri' },
  { key: 'sat', label: 'Saturday', short: 'Sat' },
  { key: 'sun', label: 'Sunday', short: 'Sun' },
]

const DEFAULT_FORM: TimeRuleForm = {
  name: '',
  description: '',
  scheduleStartTime: '09:00',
  scheduleEndTime: '18:00',
  scheduleDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  scheduleTimezone: 'America/Sao_Paulo',
  priority: 0,
  pricingSource: 'usdt_binance',
  spreadMode: 'bps',
  sellSpread: 0,
  buySpread: 0,
  isActive: true,
}

const FETCH_TIMEOUT_MS = 10000

// ============================================================================
// Component
// ============================================================================

export function GroupTimeRulesEditor({ groupJid, hideTitle, onCountChange }: GroupTimeRulesEditorProps) {
  const [rules, setRules] = useState<TimeRule[]>([])
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingRule, setEditingRule] = useState<TimeRule | null>(null)
  const [form, setForm] = useState<TimeRuleForm>({ ...DEFAULT_FORM })
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<TimeRule | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)

  // --------------------------------------------------------------------------
  // Data fetching
  // --------------------------------------------------------------------------

  const fetchRules = useCallback(async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const response = await fetch(API_ENDPOINTS.groupTimeRules(groupJid), {
        signal: controller.signal,
      })
      if (!response.ok) throw new Error('Failed to fetch rules')
      const data = await response.json()
      setRules(data.rules || [])
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to fetch time rules:', error)
      }
      setRules([])
    } finally {
      clearTimeout(timeoutId)
      setLoading(false)
    }
  }, [groupJid])

  const fetchActiveRule = useCallback(async () => {
    try {
      const response = await fetch(API_ENDPOINTS.groupActiveRule(groupJid))
      if (!response.ok) throw new Error('Failed to fetch active rule')
      const data = await response.json()
      setActiveRuleId(data.activeRule?.id ?? null)
    } catch {
      setActiveRuleId(null)
    }
  }, [groupJid])

  useEffect(() => {
    fetchRules()
    fetchActiveRule()
  }, [fetchRules, fetchActiveRule])

  // Report count changes to parent
  useEffect(() => {
    onCountChange?.(rules.length)
  }, [rules.length, onCountChange])

  // Escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showModal) {
        closeModal()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [showModal])

  // --------------------------------------------------------------------------
  // Modal helpers
  // --------------------------------------------------------------------------

  const openAddModal = () => {
    setEditingRule(null)
    setForm({ ...DEFAULT_FORM })
    setShowModal(true)
  }

  const openEditModal = (rule: TimeRule) => {
    setEditingRule(rule)
    setForm({
      name: rule.name,
      description: rule.description ?? '',
      scheduleStartTime: rule.scheduleStartTime,
      scheduleEndTime: rule.scheduleEndTime,
      scheduleDays: [...rule.scheduleDays],
      scheduleTimezone: rule.scheduleTimezone,
      priority: rule.priority,
      pricingSource: rule.pricingSource,
      spreadMode: rule.spreadMode,
      sellSpread: rule.sellSpread,
      buySpread: rule.buySpread,
      isActive: rule.isActive,
    })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingRule(null)
    setForm({ ...DEFAULT_FORM })
  }

  // --------------------------------------------------------------------------
  // CRUD operations
  // --------------------------------------------------------------------------

  const saveRule = async () => {
    if (!form.name.trim()) {
      showToast({ type: 'error', message: 'Rule name is required' })
      return
    }
    if (form.name.trim().length > 100) {
      showToast({ type: 'error', message: 'Rule name must be 100 characters or less' })
      return
    }
    if (form.scheduleDays.length === 0) {
      showToast({ type: 'error', message: 'Select at least one day' })
      return
    }

    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        scheduleStartTime: form.scheduleStartTime,
        scheduleEndTime: form.scheduleEndTime,
        scheduleDays: form.scheduleDays,
        scheduleTimezone: form.scheduleTimezone,
        priority: form.priority,
        pricingSource: form.pricingSource,
        spreadMode: form.spreadMode,
        sellSpread: form.sellSpread,
        buySpread: form.buySpread,
        isActive: form.isActive,
      }

      const url = editingRule
        ? API_ENDPOINTS.groupTimeRule(groupJid, editingRule.id)
        : API_ENDPOINTS.groupTimeRules(groupJid)

      const response = await fetch(url, {
        method: editingRule ? 'PUT' : 'POST',
        headers: writeHeaders(),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || errorData.error || 'Failed to save rule')
      }

      const savedData = await response.json().catch(() => null)
      const savedId = editingRule?.id || savedData?.rule?.id
      showToast({
        type: 'success',
        message: editingRule ? `Rule "${form.name}" updated` : `Rule "${form.name}" created`,
      })

      closeModal()
      fetchRules()
      fetchActiveRule()
      if (savedId) {
        setFlashId(savedId)
        setTimeout(() => setFlashId(null), 1500)
      }
    } catch (error) {
      showToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to save rule',
      })
    } finally {
      setSaving(false)
    }
  }

  const deleteTimeRule = async (ruleId: string) => {
    setDeletingId(ruleId)
    try {
      const response = await fetch(API_ENDPOINTS.groupTimeRule(groupJid, ruleId), {
        method: 'DELETE',
        headers: writeHeaders(),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || errorData.error || 'Failed to delete rule')
      }

      const deleted = rules.find(r => r.id === ruleId)
      showToast({ type: 'success', message: `Rule "${deleted?.name || ''}" deleted` })
      fetchRules()
      fetchActiveRule()
    } catch (error) {
      showToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to delete rule',
      })
    } finally {
      setDeletingId(null)
    }
  }

  // --------------------------------------------------------------------------
  // Day toggle
  // --------------------------------------------------------------------------

  const toggleDay = (day: DayOfWeek) => {
    setForm(prev => ({
      ...prev,
      scheduleDays: prev.scheduleDays.includes(day)
        ? prev.scheduleDays.filter(d => d !== day)
        : [...prev.scheduleDays, day],
    }))
  }

  const selectWeekdays = () => {
    setForm(prev => ({
      ...prev,
      scheduleDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    }))
  }

  const selectAllDays = () => {
    setForm(prev => ({
      ...prev,
      scheduleDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    }))
  }

  // --------------------------------------------------------------------------
  // Display helpers
  // --------------------------------------------------------------------------

  const formatDays = (days: DayOfWeek[]): string => {
    const weekdays: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri']
    const weekend: DayOfWeek[] = ['sat', 'sun']

    if (days.length === 7) return 'Every day'
    if (weekdays.every(d => days.includes(d)) && !weekend.some(d => days.includes(d))) return 'Weekdays'
    if (weekend.every(d => days.includes(d)) && !weekdays.some(d => days.includes(d))) return 'Weekends'

    return days.map(d => ALL_DAYS.find(ad => ad.key === d)?.short ?? d).join(', ')
  }

  const formatTime = (time: string): string => time.slice(0, 5)

  const getSpreadUnit = (mode: SpreadMode): string => {
    switch (mode) {
      case 'bps': return 'bps'
      case 'abs_brl': return 'BRL'
      case 'flat': return ''
    }
  }

  // --------------------------------------------------------------------------
  // Live preview & overlap detection
  // --------------------------------------------------------------------------

  /** Build a human-readable schedule preview from form state */
  const schedulePreview = useMemo((): string => {
    if (form.scheduleDays.length === 0) return 'No days selected'
    const days = formatDays(form.scheduleDays)
    const start = form.scheduleStartTime.slice(0, 5)
    const end = form.scheduleEndTime.slice(0, 5)
    const isOvernight = start > end && start !== end
    const tz = form.scheduleTimezone.split('/').pop()?.replace(/_/g, ' ') ?? form.scheduleTimezone
    return `${days} ${start}\u2013${end}${isOvernight ? ' (overnight)' : ''} (${tz})`
  }, [form.scheduleDays, form.scheduleStartTime, form.scheduleEndTime, form.scheduleTimezone])

  /** Convert HH:MM to minutes since midnight */
  const timeToMinutes = (time: string): number => {
    const [h, m] = time.split(':').map(Number)
    return h * 60 + m
  }

  /** Check if two time ranges overlap on any shared day */
  const schedulesOverlap = (
    aStart: string, aEnd: string, aDays: DayOfWeek[],
    bStart: string, bEnd: string, bDays: DayOfWeek[]
  ): boolean => {
    // Must share at least one day
    const sharedDays = aDays.filter(d => bDays.includes(d))
    if (sharedDays.length === 0) return false

    const aS = timeToMinutes(aStart)
    const aE = timeToMinutes(aEnd)
    const bS = timeToMinutes(bStart)
    const bE = timeToMinutes(bEnd)

    // Equal start/end = all day
    const aAllDay = aS === aE
    const bAllDay = bS === bE

    if (aAllDay || bAllDay) return true

    // Normalize ranges - for overnight, treat as two windows is complex,
    // so use a simpler heuristic: convert to sets of covered minutes
    const coveredMinutes = (start: number, end: number): Set<number> => {
      const set = new Set<number>()
      if (start < end) {
        for (let i = start; i < end; i++) set.add(i)
      } else {
        // Overnight
        for (let i = start; i < 1440; i++) set.add(i)
        for (let i = 0; i < end; i++) set.add(i)
      }
      return set
    }

    const aCov = coveredMinutes(aS, aE)
    const bCov = coveredMinutes(bS, bE)

    for (const m of aCov) {
      if (bCov.has(m)) return true
    }
    return false
  }

  /** Find rules that overlap with the current form's schedule */
  const overlappingRules = useMemo((): TimeRule[] => {
    if (form.scheduleDays.length === 0) return []
    return rules.filter(rule => {
      // Don't compare with self when editing
      if (editingRule && rule.id === editingRule.id) return false
      // Only compare rules in the same timezone (different TZ overlap is complex)
      if (rule.scheduleTimezone !== form.scheduleTimezone) return false
      return schedulesOverlap(
        form.scheduleStartTime, form.scheduleEndTime, form.scheduleDays,
        rule.scheduleStartTime, rule.scheduleEndTime, rule.scheduleDays
      )
    })
  }, [rules, editingRule, form.scheduleDays, form.scheduleStartTime, form.scheduleEndTime, form.scheduleTimezone])

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="text-center py-4 text-muted-foreground text-sm">
        Loading time-based rules...
      </div>
    )
  }

  return (
    <>
      <div className="space-y-3">
        {/* Section Header */}
        <div className={`flex items-center justify-between${hideTitle ? '' : ' pb-2 border-b border-blue-500/10'}`}>
          {!hideTitle && (
            <h4 className="text-xs font-mono text-blue-400 uppercase tracking-widest flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-blue-400 animate-pulse"></span>
              Time-Based Rules
            </h4>
          )}
          <button
            onClick={openAddModal}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-300 text-xs font-mono transition-all hover:shadow-[0_0_10px_rgba(59,130,246,0.3)]"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>

        {/* Rules List */}
        {rules.length === 0 ? (
          <div className="text-center py-6 border border-dashed border-blue-500/30 rounded-md">
            <Clock className="h-8 w-8 mx-auto mb-2 text-blue-500/30" />
            <p className="text-muted-foreground text-xs">
              No time-based rules configured
            </p>
            <p className="text-muted-foreground text-[10px] mt-1">
              Without rules, the bot uses the default pricing configuration above.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {rules.map(rule => {
              const isActive = rule.id === activeRuleId
              return (
                <div
                  key={rule.id}
                  className={`px-3 py-2 rounded-md bg-background/30 border backdrop-blur-sm transition-all duration-500 ${
                    flashId === rule.id
                      ? 'bg-green-500/20 border-green-500/40 ring-1 ring-green-500/30'
                      : isActive
                      ? 'border-green-500/40 shadow-[0_0_12px_rgba(34,197,94,0.15)]'
                      : 'border-blue-500/10 hover:border-blue-500/30 hover:shadow-[0_0_8px_rgba(59,130,246,0.1)]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      {/* Row 1: Name + badges */}
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-mono font-semibold text-foreground truncate">
                          {rule.name}
                        </span>
                        {isActive && (
                          <Badge className="bg-green-500/20 text-green-300 border-green-500/40 text-[10px] px-1 py-0 flex items-center gap-0.5">
                            <Zap className="h-2.5 w-2.5" />
                            ACTIVE
                          </Badge>
                        )}
                        {!rule.isActive && (
                          <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/40 text-[10px] px-1 py-0">
                            OFF
                          </Badge>
                        )}
                        <Badge
                          className="bg-blue-500/20 text-blue-300 border-blue-500/40 text-[10px] px-1 py-0 cursor-help"
                          title="Higher priority wins when schedules overlap"
                        >
                          P{rule.priority}
                        </Badge>
                      </div>
                      {/* Row 2: Schedule info */}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-blue-400/60" />
                          {formatTime(rule.scheduleStartTime)}-{formatTime(rule.scheduleEndTime)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-blue-400/60" />
                          {formatDays(rule.scheduleDays)}
                        </span>
                        <span className="opacity-60">
                          {rule.pricingSource === 'usdt_binance' ? 'Binance' : 'BCB'}
                          {rule.spreadMode !== 'flat' && ` | ${rule.sellSpread}/${rule.buySpread} ${getSpreadUnit(rule.spreadMode)}`}
                        </span>
                      </div>
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => openEditModal(rule)}
                        className="p-1.5 rounded hover:bg-blue-500/20 text-blue-400 transition-colors"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(rule)}
                        disabled={deletingId === rule.id}
                        className={`p-1.5 rounded hover:bg-red-500/20 text-red-400 transition-colors ${
                          deletingId === rule.id ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                      >
                        <Trash2 className={`h-3.5 w-3.5 ${deletingId === rule.id ? 'animate-pulse' : ''}`} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add/Edit Rule Modal */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={closeModal}
        >
          <div
            className="bg-card border border-blue-500/30 rounded-lg shadow-lg shadow-blue-500/20 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-blue-500/20 sticky top-0 bg-card z-10">
              <h3 className="text-lg font-mono font-semibold text-foreground">
                {editingRule ? 'Edit Time Rule' : 'Add Time Rule'}
              </h3>
              <button
                onClick={closeModal}
                className="p-1 rounded hover:bg-blue-500/20 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 space-y-5">
              {/* --- Identity Section --- */}
              <div className="space-y-3">
                <h5 className="text-[10px] font-mono text-blue-400 uppercase tracking-widest">
                  Identity
                </h5>
                <div>
                  <label className="block text-xs font-mono text-muted-foreground mb-1.5">
                    Rule Name *
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value.slice(0, 100) }))}
                    placeholder='e.g., "Business Hours", "After Hours"'
                    maxLength={100}
                    className="w-full px-3 py-2 bg-background border border-blue-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-muted-foreground mb-1.5">
                    Description
                  </label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Optional notes"
                    className="w-full px-3 py-2 bg-background border border-blue-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30"
                  />
                </div>
              </div>

              {/* --- Schedule Section --- */}
              <div className="space-y-3">
                <h5 className="text-[10px] font-mono text-blue-400 uppercase tracking-widest">
                  Schedule
                </h5>
                {/* Time range */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-mono text-muted-foreground mb-1.5">
                      Start Time *
                    </label>
                    <input
                      type="time"
                      value={form.scheduleStartTime}
                      onChange={e => setForm(prev => ({ ...prev, scheduleStartTime: e.target.value }))}
                      className="w-full px-3 py-2 bg-background border border-blue-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-blue-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-mono text-muted-foreground mb-1.5">
                      End Time *
                    </label>
                    <input
                      type="time"
                      value={form.scheduleEndTime}
                      onChange={e => setForm(prev => ({ ...prev, scheduleEndTime: e.target.value }))}
                      className="w-full px-3 py-2 bg-background border border-blue-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-blue-500/50"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  End before start = overnight rule (e.g., 18:00-09:00)
                </p>

                {/* Day selection */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-mono text-muted-foreground">
                      Active Days *
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={selectWeekdays}
                        className="text-[10px] font-mono text-blue-400 hover:text-blue-300"
                      >
                        Weekdays
                      </button>
                      <button
                        type="button"
                        onClick={selectAllDays}
                        className="text-[10px] font-mono text-blue-400 hover:text-blue-300"
                      >
                        All
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {ALL_DAYS.map(day => (
                      <button
                        key={day.key}
                        type="button"
                        onClick={() => toggleDay(day.key)}
                        className={`flex-1 py-1.5 rounded-md text-[11px] font-mono font-semibold transition-all ${
                          form.scheduleDays.includes(day.key)
                            ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50 shadow-[0_0_6px_rgba(59,130,246,0.2)]'
                            : 'bg-background/50 text-muted-foreground border border-blue-500/10 hover:border-blue-500/30'
                        }`}
                      >
                        {day.short}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Timezone */}
                <div>
                  <label className="block text-xs font-mono text-muted-foreground mb-1.5">
                    Timezone
                  </label>
                  <select
                    value={form.scheduleTimezone}
                    onChange={e => setForm(prev => ({ ...prev, scheduleTimezone: e.target.value }))}
                    className="w-full px-3 py-2 bg-background border border-blue-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-blue-500/50"
                  >
                    <option value="America/Sao_Paulo">America/Sao_Paulo (BRT)</option>
                    <option value="America/New_York">America/New_York (ET)</option>
                    <option value="America/Chicago">America/Chicago (CT)</option>
                    <option value="America/Los_Angeles">America/Los_Angeles (PT)</option>
                    <option value="Europe/London">Europe/London (GMT)</option>
                    <option value="UTC">UTC</option>
                  </select>
                </div>
              </div>

              {/* --- Live Preview --- */}
              <div className="px-3 py-2 rounded-md bg-blue-500/5 border border-blue-500/20">
                <div className="flex items-center gap-1.5 text-xs font-mono">
                  <Eye className="h-3.5 w-3.5 text-blue-400" />
                  <span className="text-blue-400">Active:</span>
                  <span className="text-foreground">{schedulePreview}</span>
                </div>
              </div>

              {/* --- Overlap Warning --- */}
              {overlappingRules.length > 0 && (
                <div className="px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30">
                  <div className="flex items-start gap-1.5 text-xs font-mono">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-amber-300">Overlaps with: </span>
                      {overlappingRules.map((r, i) => (
                        <span key={r.id} className="text-amber-200">
                          {i > 0 && ', '}
                          &quot;{r.name}&quot; (P{r.priority})
                        </span>
                      ))}
                      <p className="text-amber-400/70 mt-0.5">
                        Higher priority wins when schedules overlap
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* --- Priority & Status Section --- */}
              <div className="space-y-3">
                <h5 className="text-[10px] font-mono text-blue-400 uppercase tracking-widest">
                  Priority & Status
                </h5>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-mono text-muted-foreground mb-1.5">
                      Priority (0-100)
                    </label>
                    <input
                      type="number"
                      value={form.priority}
                      onChange={e => setForm(prev => ({ ...prev, priority: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) }))}
                      min={0}
                      max={100}
                      className="w-full px-3 py-2 bg-background border border-blue-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-blue-500/50"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Higher = wins when rules overlap
                    </p>
                  </div>
                  <div className="flex items-end pb-6">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.isActive}
                        onChange={e => setForm(prev => ({ ...prev, isActive: e.target.checked }))}
                        className="w-4 h-4 rounded border-blue-500/30 text-blue-500 focus:ring-blue-500/30"
                      />
                      <span className="text-sm font-mono text-muted-foreground">Active</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* --- Pricing Section --- */}
              <div className="space-y-3">
                <h5 className="text-[10px] font-mono text-amber-400 uppercase tracking-widest">
                  Pricing Configuration
                </h5>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-mono text-muted-foreground mb-1.5">
                      Pricing Source
                    </label>
                    <select
                      value={form.pricingSource}
                      onChange={e => setForm(prev => ({ ...prev, pricingSource: e.target.value as PricingSource }))}
                      className="w-full px-3 py-2 bg-background border border-amber-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-amber-500/50"
                    >
                      <option value="usdt_binance">USDT Binance</option>
                      <option value="commercial_dollar">Commercial Dollar (BCB)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-mono text-muted-foreground mb-1.5">
                      Spread Mode
                    </label>
                    <select
                      value={form.spreadMode}
                      onChange={e => setForm(prev => ({ ...prev, spreadMode: e.target.value as SpreadMode }))}
                      className="w-full px-3 py-2 bg-background border border-amber-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-amber-500/50"
                    >
                      <option value="bps">Basis Points (bps)</option>
                      <option value="abs_brl">Absolute BRL</option>
                      <option value="flat">Flat (No Spread)</option>
                    </select>
                  </div>
                </div>

                {form.spreadMode !== 'flat' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-mono text-muted-foreground mb-1.5">
                        Client BUYS USDT
                        <span className="text-amber-400 ml-1">({getSpreadUnit(form.spreadMode)})</span>
                      </label>
                      <input
                        type="number"
                        value={form.sellSpread}
                        onChange={e => setForm(prev => ({ ...prev, sellSpread: parseFloat(e.target.value) || 0 }))}
                        className="w-full px-3 py-2 bg-background border border-amber-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-amber-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-mono text-muted-foreground mb-1.5">
                        Client SELLS USDT
                        <span className="text-amber-400 ml-1">({getSpreadUnit(form.spreadMode)})</span>
                      </label>
                      <input
                        type="number"
                        value={form.buySpread}
                        onChange={e => setForm(prev => ({ ...prev, buySpread: parseFloat(e.target.value) || 0 }))}
                        className="w-full px-3 py-2 bg-background border border-amber-500/30 rounded-md font-mono text-sm focus:outline-none focus:border-amber-500/50"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end gap-2 p-4 border-t border-blue-500/20 sticky bottom-0 bg-card">
              <button
                onClick={closeModal}
                className="px-4 py-2 rounded-md text-sm font-mono text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveRule}
                disabled={saving || !form.name.trim() || form.scheduleDays.length === 0}
                className="px-4 py-2 rounded-md bg-blue-500/20 border border-blue-500/30 text-blue-300 text-sm font-mono hover:bg-blue-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : editingRule ? 'Update Rule' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}
        title="Delete rule"
        description={`Delete rule "${confirmDelete?.name}"? This cannot be undone. If this rule is currently active, pricing will fall back to the default spread.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loading={deletingId === confirmDelete?.id}
        onConfirm={async () => {
          if (confirmDelete) {
            await deleteTimeRule(confirmDelete.id)
            setConfirmDelete(null)
          }
        }}
      />
    </>
  )
}
