/**
 * Group Triggers Editor Component
 * Sprint 3: Manage per-group trigger patterns
 *
 * Features:
 * - List triggers with action type badges
 * - Add/Edit/Delete triggers via modal
 * - Pattern type selection (exact, contains, regex)
 * - Action type selection with ActionSelector
 * - Trigger tester showing which rule would apply
 * - Enable/disable toggle
 */
import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Edit, X, Zap, Search, ToggleLeft, ToggleRight, Shield, Download } from 'lucide-react'
import { API_ENDPOINTS, writeHeaders } from '@/lib/api'
import { showToast } from '@/lib/toast'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

// ============================================================================
// Types (intentional duplication to avoid cross-build dependencies — L2 pattern)
// ============================================================================

type PatternType = 'exact' | 'contains' | 'regex'
type TriggerActionType =
  | 'price_quote' | 'volume_quote' | 'text_response' | 'ai_prompt'
  | 'deal_lock' | 'deal_cancel' | 'deal_confirm' | 'deal_volume'
  | 'tronscan_process' | 'receipt_process' | 'control_command'

type TriggerScope = 'group' | 'control_only'

interface GroupTrigger {
  id: string
  groupJid: string
  triggerPhrase: string
  patternType: PatternType
  actionType: TriggerActionType
  actionParams: Record<string, unknown>
  priority: number
  isActive: boolean
  isSystem: boolean
  scope: TriggerScope
  createdAt: string
  updatedAt: string
}

interface TriggerForm {
  triggerPhrase: string
  patternType: PatternType
  actionType: TriggerActionType
  actionParams: Record<string, unknown>
  priority: number
  isActive: boolean
  scope: TriggerScope
}

interface TestResult {
  matched: boolean
  trigger: GroupTrigger | null
  activeRule: { name: string; pricingSource: string } | null
  actionResult: { message: string; actionType: string; ruleApplied: boolean; ruleName?: string } | null
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_FORM: TriggerForm = {
  triggerPhrase: '',
  patternType: 'contains',
  actionType: 'price_quote',
  actionParams: {},
  priority: 0,
  isActive: true,
  scope: 'group',
}

const FETCH_TIMEOUT_MS = 10000

const PATTERN_TYPE_LABELS: Record<PatternType, string> = {
  exact: 'Exact Match',
  contains: 'Contains',
  regex: 'Regex',
}

const ACTION_TYPE_CONFIG: Record<TriggerActionType, { label: string; icon: string; badge: string; active: string }> = {
  price_quote: { label: 'Price Quote', icon: '📊', badge: 'bg-green-500/20 text-green-300', active: 'bg-green-500/20 border-green-500/50 text-green-300' },
  volume_quote: { label: 'Volume Quote', icon: '🧮', badge: 'bg-blue-500/20 text-blue-300', active: 'bg-blue-500/20 border-blue-500/50 text-blue-300' },
  text_response: { label: 'Text Response', icon: '💬', badge: 'bg-purple-500/20 text-purple-300', active: 'bg-purple-500/20 border-purple-500/50 text-purple-300' },
  ai_prompt: { label: 'AI Prompt', icon: '🤖', badge: 'bg-cyan-500/20 text-cyan-300', active: 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300' },
  deal_lock: { label: 'Price Lock', icon: '🔒', badge: 'bg-blue-500/20 text-blue-300', active: 'bg-blue-500/20 border-blue-500/50 text-blue-300' },
  deal_cancel: { label: 'Deal Cancel', icon: '❌', badge: 'bg-red-500/20 text-red-300', active: 'bg-red-500/20 border-red-500/50 text-red-300' },
  deal_confirm: { label: 'Deal Confirm', icon: '✅', badge: 'bg-emerald-500/20 text-emerald-300', active: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' },
  deal_volume: { label: 'Volume Detect', icon: '📦', badge: 'bg-yellow-500/20 text-yellow-300', active: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300' },
  tronscan_process: { label: 'Tronscan', icon: '🔗', badge: 'bg-purple-500/20 text-purple-300', active: 'bg-purple-500/20 border-purple-500/50 text-purple-300' },
  receipt_process: { label: 'Receipt', icon: '🧾', badge: 'bg-amber-500/20 text-amber-300', active: 'bg-amber-500/20 border-amber-500/50 text-amber-300' },
  control_command: { label: 'Control Cmd', icon: '⚙️', badge: 'bg-slate-500/20 text-slate-300', active: 'bg-slate-500/20 border-slate-500/50 text-slate-300' },
}

/** All available action types for trigger creation */
const USER_ACTION_TYPES: TriggerActionType[] = [
  'price_quote', 'volume_quote', 'text_response', 'ai_prompt',
  'deal_lock', 'deal_cancel', 'deal_confirm', 'deal_volume',
  'tronscan_process', 'receipt_process', 'control_command',
]

const SCOPE_LABELS: Record<TriggerScope, string> = {
  group: 'This Group',
  control_only: 'Control Only',
}

// ============================================================================
// Component
// ============================================================================

interface GroupTriggersEditorProps {
  groupJid: string
  hideTitle?: boolean
  onCountChange?: (count: number) => void
}

export function GroupTriggersEditor({ groupJid, hideTitle, onCountChange }: GroupTriggersEditorProps) {
  const [triggers, setTriggers] = useState<GroupTrigger[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingTrigger, setEditingTrigger] = useState<GroupTrigger | null>(null)
  const [form, setForm] = useState<TriggerForm>({ ...DEFAULT_FORM })
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<GroupTrigger | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState(false)

  const [seeding, setSeeding] = useState(false)

  // Tester state
  const [showTester, setShowTester] = useState(false)
  const [testMessage, setTestMessage] = useState('')
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)

  // ---- Data Fetching ----

  const fetchTriggers = useCallback(async () => {
    setFetchError(false)
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

      const response = await fetch(API_ENDPOINTS.groupTriggers(groupJid), {
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = await response.json()
      setTriggers(data.triggers || [])
    } catch (e) {
      // Show error if it's a real failure (timeout, network), not just empty triggers
      if (e instanceof DOMException && e.name === 'AbortError') {
        setFetchError(true)
      }
      setTriggers([])
    } finally {
      setLoading(false)
    }
  }, [groupJid])

  useEffect(() => {
    fetchTriggers()
  }, [fetchTriggers])

  // Report count changes to parent
  useEffect(() => {
    onCountChange?.(triggers.length)
  }, [triggers.length, onCountChange])

  // ---- Modal Management ----

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showModal) closeModal()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [showModal])

  const closeModal = () => {
    setShowModal(false)
    setEditingTrigger(null)
    setForm({ ...DEFAULT_FORM })
  }

  const openAddModal = () => {
    setEditingTrigger(null)
    setForm({ ...DEFAULT_FORM })
    setShowModal(true)
  }

  const openEditModal = (trigger: GroupTrigger) => {
    setEditingTrigger(trigger)
    setForm({
      triggerPhrase: trigger.triggerPhrase,
      patternType: trigger.patternType,
      actionType: trigger.actionType,
      actionParams: { ...trigger.actionParams },
      priority: trigger.priority,
      isActive: trigger.isActive,
      scope: trigger.scope || 'group',
    })
    setShowModal(true)
  }

  // ---- CRUD Operations ----

  const saveTrigger = async () => {
    // Validation
    if (!form.triggerPhrase.trim()) {
      showToast({ type: 'error', message: 'Trigger phrase is required' })
      return
    }
    if (form.triggerPhrase.trim().length > 200) {
      showToast({ type: 'error', message: 'Trigger phrase must be 200 characters or less' })
      return
    }
    if (form.patternType === 'regex') {
      try {
        new RegExp(form.triggerPhrase, 'i')
      } catch {
        showToast({ type: 'error', message: 'Invalid regex pattern' })
        return
      }
    }
    if (form.actionType === 'text_response') {
      const text = form.actionParams?.text
      if (!text || typeof text !== 'string' || (text as string).trim().length === 0) {
        showToast({ type: 'error', message: 'Response text is required for text_response' })
        return
      }
    }
    if (form.actionType === 'ai_prompt') {
      const prompt = form.actionParams?.prompt
      if (!prompt || typeof prompt !== 'string' || (prompt as string).trim().length === 0) {
        showToast({ type: 'error', message: 'Prompt is required for ai_prompt' })
        return
      }
    }

    setSaving(true)
    try {
      const url = editingTrigger
        ? API_ENDPOINTS.groupTrigger(groupJid, editingTrigger.id)
        : API_ENDPOINTS.groupTriggers(groupJid)

      const method = editingTrigger ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: writeHeaders(),
        body: JSON.stringify({
          triggerPhrase: form.triggerPhrase.trim(),
          patternType: form.patternType,
          actionType: form.actionType,
          actionParams: form.actionParams,
          priority: form.priority,
          isActive: form.isActive,
          scope: form.scope,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || errorData.error || `HTTP ${response.status}`)
      }

      const savedData = await response.json().catch(() => null)
      const savedId = editingTrigger?.id || savedData?.trigger?.id
      showToast({ type: 'success', message: editingTrigger ? `Trigger "${form.triggerPhrase.trim()}" updated` : `Trigger "${form.triggerPhrase.trim()}" created` })
      closeModal()
      await fetchTriggers()
      if (savedId) {
        setFlashId(savedId)
        setTimeout(() => setFlashId(null), 1500)
      }
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Failed to save trigger' })
    } finally {
      setSaving(false)
    }
  }

  const deleteTriggerById = async (triggerId: string) => {
    setDeletingId(triggerId)
    try {
      const response = await fetch(API_ENDPOINTS.groupTrigger(groupJid, triggerId), {
        method: 'DELETE',
        headers: writeHeaders(),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || errorData.error || `HTTP ${response.status}`)
      }

      const deleted = triggers.find(t => t.id === triggerId)
      showToast({ type: 'success', message: `Trigger "${deleted?.triggerPhrase || ''}" deleted` })
      await fetchTriggers()
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Failed to delete trigger' })
    } finally {
      setDeletingId(null)
    }
  }

  const toggleTrigger = async (trigger: GroupTrigger) => {
    try {
      const response = await fetch(API_ENDPOINTS.groupTrigger(groupJid, trigger.id), {
        method: 'PUT',
        headers: writeHeaders(),
        body: JSON.stringify({ isActive: !trigger.isActive }),
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      showToast({ type: 'success', message: `Trigger "${trigger.triggerPhrase}" ${trigger.isActive ? 'disabled' : 'enabled'}` })
      await fetchTriggers()
    } catch {
      showToast({ type: 'error', message: 'Failed to toggle trigger' })
    }
  }

  // ---- Trigger Tester ----

  const testTrigger = async () => {
    if (!testMessage.trim()) return

    setTesting(true)
    setTestResult(null)
    try {
      const response = await fetch(API_ENDPOINTS.groupTriggerTest(groupJid), {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify({ message: testMessage }),
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const result = await response.json()
      setTestResult(result)
    } catch {
      showToast({ type: 'error', message: 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  // ---- Seed Defaults ----

  const seedDefaults = async () => {
    setSeeding(true)
    try {
      const response = await fetch(API_ENDPOINTS.groupTriggerSeed(groupJid), {
        method: 'POST',
        headers: writeHeaders(),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || errorData.error || `HTTP ${response.status}`)
      }

      showToast({ type: 'success', message: 'Default triggers seeded' })
      await fetchTriggers()
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Failed to seed triggers' })
    } finally {
      setSeeding(false)
    }
  }

  // ---- Render ----

  if (loading) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-teal-400 flex items-center gap-2">
          <Zap className="h-4 w-4" /> Group Triggers
        </h3>
        <p className="text-xs text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-3">
        {/* Section Header */}
        <div className="flex items-center justify-between">
          {!hideTitle && (
            <h3 className="text-sm font-semibold text-teal-400 flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Group Triggers
              <span className="text-xs text-muted-foreground font-normal">({triggers.length})</span>
            </h3>
          )}
          <div className={`flex items-center gap-2${hideTitle ? ' ml-auto' : ''}`}>
            <button
              onClick={() => setShowTester(!showTester)}
              className="px-2 py-1 text-xs font-mono rounded bg-teal-500/10 border border-teal-500/30 text-teal-300 hover:bg-teal-500/20 transition-colors"
            >
              <Search className="h-3 w-3 inline mr-1" />
              Test
            </button>
            <button
              onClick={openAddModal}
              className="px-2 py-1 text-xs font-mono rounded bg-teal-500/10 border border-teal-500/30 text-teal-300 hover:bg-teal-500/20 transition-colors"
            >
              <Plus className="h-3 w-3 inline mr-1" />
              Add
            </button>
          </div>
        </div>

        {/* Trigger Tester */}
        {showTester && (
          <div className="p-3 bg-teal-500/5 border border-teal-500/20 rounded-lg space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') testTrigger() }}
                placeholder="Type a message to test..."
                className="flex-1 px-3 py-2 bg-black/30 border border-border/30 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50"
              />
              <button
                onClick={testTrigger}
                disabled={testing || !testMessage.trim()}
                className="px-3 py-2 text-xs font-mono rounded bg-teal-500/20 border border-teal-500/50 text-teal-300 hover:bg-teal-500/30 disabled:opacity-50 transition-colors"
              >
                {testing ? 'Testing...' : 'Test'}
              </button>
            </div>
            {testResult && (
              <div className={`p-3 rounded-lg text-sm font-mono ${
                testResult.matched
                  ? 'bg-green-500/10 border border-green-500/30 text-green-300'
                  : 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-300'
              }`}>
                {testResult.matched ? (
                  <div className="space-y-1">
                    <p>Matched: <strong>"{testResult.trigger?.triggerPhrase}"</strong> ({testResult.trigger?.patternType})</p>
                    <p>Action: {testResult.trigger?.actionType}</p>
                    {testResult.activeRule && (
                      <p>Active rule: {testResult.activeRule.name} ({testResult.activeRule.pricingSource})</p>
                    )}
                    {testResult.actionResult && !('error' in testResult.actionResult) && (
                      <p>Response: {testResult.actionResult.message}</p>
                    )}
                  </div>
                ) : (
                  <p>No trigger matched this message</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Triggers List */}
        {fetchError ? (
          <button
            onClick={() => fetchTriggers()}
            className="w-full px-4 py-6 text-center text-sm text-muted-foreground bg-red-500/5 border border-red-500/20 rounded-lg hover:bg-red-500/10 transition-colors"
          >
            <p>Unable to load triggers</p>
            <p className="text-xs mt-1 text-red-400">Tap to retry</p>
          </button>
        ) : triggers.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground bg-teal-500/5 border border-teal-500/10 rounded-lg">
            <Zap className="h-8 w-8 mx-auto mb-2 text-teal-500/30" />
            <p>No triggers configured</p>
            <p className="text-xs mt-1 mb-3">Add triggers to define which messages the bot responds to.</p>
            <button
              onClick={seedDefaults}
              disabled={seeding}
              className="px-4 py-2 text-xs font-mono rounded-lg bg-teal-500/20 border border-teal-500/50 text-teal-300 hover:bg-teal-500/30 disabled:opacity-50 transition-colors"
            >
              <Download className="h-3 w-3 inline mr-1" />
              {seeding ? 'Seeding...' : 'Seed Default Triggers'}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {[...triggers].sort((a, b) => {
              // System triggers first, then by priority DESC
              if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1
              return b.priority - a.priority
            }).map((trigger) => {
              const actionConfig = ACTION_TYPE_CONFIG[trigger.actionType] || ACTION_TYPE_CONFIG.text_response
              return (
                <div
                  key={trigger.id}
                  className={`p-3 rounded-lg border transition-all duration-500 ${
                    flashId === trigger.id
                      ? 'bg-green-500/20 border-green-500/40 ring-1 ring-green-500/30'
                      : trigger.isSystem
                      ? 'bg-slate-500/5 border-slate-500/20'
                      : trigger.isActive
                      ? 'bg-teal-500/5 border-teal-500/20'
                      : 'bg-muted/10 border-border/20 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {trigger.isSystem && (
                          <Shield className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                        )}
                        <span className="font-mono text-sm font-semibold text-foreground">
                          "{trigger.triggerPhrase}"
                        </span>
                        {trigger.isSystem && (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-500/20 text-slate-400 border border-slate-500/30">
                            DEFAULT
                          </span>
                        )}
                        <span className={`px-1.5 py-0.5 text-[10px] font-mono rounded ${
                          trigger.patternType === 'exact'
                            ? 'bg-orange-500/20 text-orange-300'
                            : trigger.patternType === 'regex'
                            ? 'bg-red-500/20 text-red-300'
                            : 'bg-teal-500/20 text-teal-300'
                        }`}>
                          {PATTERN_TYPE_LABELS[trigger.patternType]}
                        </span>
                        <span className={`px-1.5 py-0.5 text-[10px] font-mono rounded ${actionConfig.badge}`}>
                          {actionConfig.icon} {actionConfig.label}
                        </span>
                        {trigger.priority > 0 && (
                          <span
                            className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-yellow-500/20 text-yellow-300 cursor-help"
                            title="Higher priority wins when multiple triggers match the same message"
                          >
                            P{trigger.priority}
                          </span>
                        )}
                        {trigger.scope === 'control_only' && (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            Control Only
                          </span>
                        )}
                      </div>
                      {trigger.actionType === 'text_response' && typeof trigger.actionParams?.text === 'string' && (
                        <p className="text-xs text-muted-foreground mt-1 truncate max-w-[300px]">
                          {trigger.actionParams.text}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <button
                        onClick={() => toggleTrigger(trigger)}
                        className="p-1 rounded hover:bg-teal-500/20 text-muted-foreground hover:text-teal-300 transition-colors"
                        title={trigger.isActive ? 'Disable' : 'Enable'}
                      >
                        {trigger.isActive ? (
                          <ToggleRight className="h-4 w-4 text-teal-400" />
                        ) : (
                          <ToggleLeft className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => openEditModal(trigger)}
                        className="p-1 rounded hover:bg-teal-500/20 text-muted-foreground hover:text-teal-300 transition-colors"
                        title="Edit"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(trigger)}
                        disabled={deletingId === trigger.id}
                        className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-50"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border/30">
              <h3 className="text-sm font-semibold text-teal-400 flex items-center gap-2">
                <Zap className="h-4 w-4" />
                {editingTrigger ? 'Edit Trigger' : 'Add Trigger'}
              </h3>
              <button onClick={closeModal} className="p-1 rounded hover:bg-muted/30 text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Form */}
            <div className="p-4 space-y-4">
              {/* Trigger Phrase */}
              <div>
                <label className="block text-xs font-mono font-semibold text-foreground mb-1">
                  Trigger Phrase <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.triggerPhrase}
                  onChange={(e) => setForm({ ...form, triggerPhrase: e.target.value.slice(0, 200) })}
                  placeholder="e.g., preço, cotação, compro"
                  maxLength={200}
                  className="w-full px-3 py-2 bg-black/30 border border-border/30 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {form.triggerPhrase.length}/200 characters
                </p>
              </div>

              {/* Pattern Type */}
              <div>
                <label className="block text-xs font-mono font-semibold text-foreground mb-1">
                  Pattern Type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['contains', 'exact', 'regex'] as PatternType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setForm({ ...form, patternType: type })}
                      className={`px-3 py-2 text-xs font-mono rounded-lg border transition-all ${
                        form.patternType === type
                          ? 'bg-teal-500/20 border-teal-500/50 text-teal-300'
                          : 'bg-muted/10 border-border/30 text-foreground hover:bg-muted/20'
                      }`}
                    >
                      {PATTERN_TYPE_LABELS[type]}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {form.patternType === 'exact' && 'Message must match exactly (case-insensitive)'}
                  {form.patternType === 'contains' && 'Message must contain this phrase (case-insensitive)'}
                  {form.patternType === 'regex' && 'Uses regular expression pattern matching'}
                </p>
              </div>

              {/* Action Type */}
              <div>
                <label className="block text-xs font-mono font-semibold text-foreground mb-2">
                  Action Type <span className="text-red-400">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {USER_ACTION_TYPES.map((type) => {
                    const config = ACTION_TYPE_CONFIG[type]
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setForm({ ...form, actionType: type, actionParams: {} })}
                        className={`px-3 py-2 text-xs font-mono rounded-lg border transition-all text-left ${
                          form.actionType === type
                            ? config.active
                            : 'bg-muted/10 border-border/30 text-foreground hover:bg-muted/20'
                        }`}
                      >
                        <span className="text-sm">{config.icon}</span> {config.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Action Params */}
              {form.actionType === 'price_quote' && (
                <div className="px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-lg">
                  <p className="text-xs font-mono text-green-300">
                    Uses the active time-based rule's pricing source and spread.
                    Falls back to group default when no rule is active.
                  </p>
                </div>
              )}

              {form.actionType === 'volume_quote' && (
                <div className="px-3 py-2 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                  <p className="text-xs font-mono text-blue-300">
                    Extracts volume from the message and calculates using the active rule's pricing.
                  </p>
                </div>
              )}

              {form.actionType === 'text_response' && (
                <div>
                  <label className="block text-xs font-mono font-semibold text-foreground mb-1">
                    Response Text <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    value={(form.actionParams?.text as string) || ''}
                    onChange={(e) => setForm({ ...form, actionParams: { ...form.actionParams, text: e.target.value } })}
                    placeholder="Enter the response message..."
                    rows={3}
                    className="w-full px-3 py-2 bg-black/30 border border-border/30 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none"
                  />
                </div>
              )}

              {form.actionType === 'ai_prompt' && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-mono font-semibold text-foreground mb-1">
                      AI Prompt <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      value={(form.actionParams?.prompt as string) || ''}
                      onChange={(e) => setForm({ ...form, actionParams: { ...form.actionParams, prompt: e.target.value } })}
                      placeholder="Instructions for the AI..."
                      rows={3}
                      className="w-full px-3 py-2 bg-black/30 border border-border/30 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-mono font-semibold text-foreground mb-1">
                      Context (optional)
                    </label>
                    <textarea
                      value={(form.actionParams?.context as string) || ''}
                      onChange={(e) => setForm({ ...form, actionParams: { ...form.actionParams, context: e.target.value } })}
                      placeholder="Additional context for the AI..."
                      rows={2}
                      className="w-full px-3 py-2 bg-black/30 border border-border/30 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-none"
                    />
                  </div>
                </div>
              )}

              {/* Priority */}
              <div>
                <label className="block text-xs font-mono font-semibold text-foreground mb-1">
                  Priority (0-100)
                </label>
                <input
                  type="number"
                  value={form.priority}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0))
                    setForm({ ...form, priority: v })
                  }}
                  min={0}
                  max={100}
                  className="w-20 px-3 py-2 bg-black/30 border border-border/30 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Higher priority triggers match first when multiple could match
                </p>
              </div>

              {/* Scope */}
              <div>
                <label className="block text-xs font-mono font-semibold text-foreground mb-1">
                  Scope
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['group', 'control_only'] as TriggerScope[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm({ ...form, scope: s })}
                      className={`px-3 py-2 text-xs font-mono rounded-lg border transition-all ${
                        form.scope === s
                          ? s === 'control_only'
                            ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                            : 'bg-teal-500/20 border-teal-500/50 text-teal-300'
                          : 'bg-muted/10 border-border/30 text-foreground hover:bg-muted/20'
                      }`}
                    >
                      {SCOPE_LABELS[s]}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {form.scope === 'group' && 'Fires in this group (normal behavior)'}
                  {form.scope === 'control_only' && 'Only fires when message is in the control group'}
                </p>
              </div>

              {/* Active Toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="w-4 h-4 rounded border-border/30 bg-black/30 text-teal-500 focus:ring-2 focus:ring-teal-500/50"
                />
                <span className="text-sm font-mono text-foreground">Active</span>
              </label>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 p-4 border-t border-border/30">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm font-mono rounded-lg border border-border/30 text-foreground hover:bg-muted/20 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveTrigger}
                disabled={saving || !form.triggerPhrase.trim()}
                className="px-4 py-2 text-sm font-mono rounded-lg bg-teal-500/20 border border-teal-500/50 text-teal-300 hover:bg-teal-500/30 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : editingTrigger ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}
        title="Delete trigger"
        description={`Delete trigger "${confirmDelete?.triggerPhrase}"? The bot will no longer respond to this phrase in this group.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loading={deletingId === confirmDelete?.id}
        onConfirm={async () => {
          if (confirmDelete) {
            await deleteTriggerById(confirmDelete.id)
            setConfirmDelete(null)
          }
        }}
      />
    </>
  )
}
