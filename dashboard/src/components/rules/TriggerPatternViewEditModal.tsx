/**
 * Trigger Pattern View/Edit Modal
 * Allows viewing and editing existing trigger patterns
 * Read-only mode for hardcoded patterns
 */
import { useState, useEffect } from 'react'
import { X, Edit3, Save, Trash2, AlertCircle, Check, Lock, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { API_ENDPOINTS } from '@/lib/api'
import { ActionSelector } from '@/components/actions/ActionSelector'
import { RuleTester } from '@/components/rules/RuleTester'
import { type ActionType, getActionConfig, getActionDisplayText } from '@/types/actions'

interface TriggerPatternViewEditModalProps {
  isOpen: boolean
  onClose: () => void
  trigger: string
  ruleId: string | null
  scope?: 'all_groups' | 'control_group_only'
  onPatternUpdated?: () => void
  onPatternDeleted?: () => void
}

interface PatternData {
  id: string
  group_jid: string
  trigger_phrase: string
  response_template: string
  action_type?: ActionType
  action_params?: any
  is_active: boolean
  priority: number
  scope?: 'all_groups' | 'control_group_only'
  created_at: string
  updated_at: string
  created_by: string
  metadata?: {
    scope?: 'all_groups' | 'control_group_only'
    [key: string]: any
  }
}

export function TriggerPatternViewEditModal({
  isOpen,
  onClose,
  trigger,
  ruleId,
  scope,
  onPatternUpdated,
  onPatternDeleted,
}: TriggerPatternViewEditModalProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [patternData, setPatternData] = useState<PatternData | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Form state
  const [actionType, setActionType] = useState<ActionType>('text_response')
  const [actionParams, setActionParams] = useState<any>({})
  const [priority, setPriority] = useState(0)
  const [isActive, setIsActive] = useState(true)
  const [ruleScope, setRuleScope] = useState<'all_groups' | 'control_group_only'>('all_groups')

  const isHardcoded = ruleId === 'hardcoded'

  // Fetch rule data when modal opens
  useEffect(() => {
    if (!isOpen) {
      // Reset state when modal closes
      setIsEditing(false)
      setError(null)
      setSuccess(null)
      setShowDeleteConfirm(false)
      return
    }

    if (isHardcoded) {
      // Determine action type for hardcoded patterns
      let hardcodedActionType: ActionType = 'text_response'
      let hardcodedActionParams: any = {}

      // Price triggers use USDT quote action
      if (trigger === 'preço' || trigger === 'cotação') {
        hardcodedActionType = 'usdt_quote'
        hardcodedActionParams = { include_volume: false }
      }
      // Control commands use text response (built into bot logic)
      else if (['pause', 'resume', 'status', 'training on', 'training off', 'mode', 'modes', 'config', 'trigger', 'role'].includes(trigger)) {
        hardcodedActionType = 'text_response'
        hardcodedActionParams = { template: 'Built-in system response' }
      }

      // For hardcoded patterns, create mock data
      setPatternData({
        id: 'hardcoded',
        group_jid: scope === 'control_group_only' ? 'CONTROL_GROUP' : 'ALL_GROUPS',
        trigger_phrase: trigger,
        response_template: '',
        action_type: hardcodedActionType,
        action_params: hardcodedActionParams,
        is_active: true,
        priority: 100,
        scope: scope || 'all_groups',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: 'system',
      })
      setLoading(false)
      return
    }

    // Fetch actual rule data from database
    const fetchRule = async () => {
      setLoading(true)
      setError(null)

      try {
        // Since we don't have a GET /api/rules/:id endpoint, we'll fetch all rules and filter
        const response = await fetch(API_ENDPOINTS.rules)

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const data = await response.json()
        const rule = data.rules?.find((r: PatternData) => r.trigger_phrase === trigger.toLowerCase())

        if (!rule) {
          throw new Error('Rule not found')
        }

        setPatternData(rule)
        setActionType(rule.action_type || 'text_response')
        setActionParams(rule.action_params || { template: rule.response_template })
        setPriority(rule.priority)
        setIsActive(rule.is_active)
        setRuleScope((rule.metadata as any)?.scope || 'all_groups')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load rule')
      } finally {
        setLoading(false)
      }
    }

    fetchRule()
  }, [isOpen, trigger, ruleId, scope, isHardcoded])

  const handleSave = async () => {
    if (!patternData || isHardcoded) return

    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`${API_ENDPOINTS.rules}/${patternData.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response_template: actionType === 'text_response' ? actionParams.template : '',
          action_type: actionType,
          action_params: actionParams,
          priority,
          is_active: isActive,
          scope: ruleScope,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update rule')
      }

      setSuccess('Trigger pattern updated successfully')
      setIsEditing(false)

      // Refresh pattern data
      const updatedResponse = await fetch(API_ENDPOINTS.rules)
      const updatedData = await updatedResponse.json()
      const updatedRule = updatedData.rules?.find((r: PatternData) => r.id === patternData.id)
      if (updatedRule) {
        setPatternData(updatedRule)
      }

      // Delay callback to avoid race condition with parent refresh
      setTimeout(() => {
        onPatternUpdated?.()
      }, 300)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rule')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!patternData || isHardcoded) return

    setDeleting(true)
    setError(null)

    try {
      const response = await fetch(`${API_ENDPOINTS.rules}/${patternData.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete rule')
      }

      setSuccess('Trigger pattern deleted successfully')
      setTimeout(() => {
        onPatternDeleted?.()
        onClose()
      }, 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete rule')
      setShowDeleteConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  const handleCancel = () => {
    if (patternData) {
      setActionType(patternData.action_type || 'text_response')
      setActionParams(patternData.action_params || { template: patternData.response_template })
      setPriority(patternData.priority)
      setIsActive(patternData.is_active)
      setRuleScope((patternData.metadata as any)?.scope || 'all_groups')
    }
    setIsEditing(false)
    setError(null)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-card border border-border/50 rounded-lg shadow-2xl shadow-purple-500/10">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-purple-500/10 via-transparent to-cyan-500/10 border-b border-border/30 p-6 backdrop-blur-sm z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`h-10 w-10 rounded-lg border flex items-center justify-center ${
                isHardcoded
                  ? 'bg-gradient-to-br from-amber-500/20 to-orange-500/20 border-amber-500/30'
                  : 'bg-gradient-to-br from-purple-500/20 to-cyan-500/20 border-purple-500/30'
              }`}>
                {isHardcoded ? (
                  <Lock className="h-5 w-5 text-amber-400" />
                ) : isEditing ? (
                  <Edit3 className="h-5 w-5 text-purple-400" />
                ) : (
                  <Eye className="h-5 w-5 text-cyan-400" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className={`text-2xl font-mono font-bold bg-gradient-to-r ${
                    isHardcoded
                      ? 'from-amber-400 to-orange-500'
                      : 'from-purple-400 to-cyan-500'
                  } bg-clip-text text-transparent`}>
                    {isEditing ? 'Edit Trigger Pattern' : isHardcoded ? 'System Pattern' : 'View Trigger Pattern'}
                  </h2>
                  {isHardcoded && (
                    <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px] px-2 py-0.5 uppercase">
                      READ-ONLY
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground font-mono mt-1">
                  {isHardcoded ? 'Built into bot code - cannot be modified' : 'Custom trigger pattern from dashboard'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-lg border border-border/30 bg-muted/20 hover:bg-muted/40 flex items-center justify-center transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-12 w-12 border-2 border-purple-500/30 border-t-purple-400 rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Trigger Phrase - Always Read-Only */}
              <div>
                <label className="block text-sm font-mono font-semibold text-foreground mb-2">
                  Trigger Phrase
                </label>
                <div className="px-4 py-3 bg-black/30 border border-border/30 rounded-lg font-mono text-sm text-foreground">
                  "{patternData?.trigger_phrase}"
                </div>
                <p className="mt-2 text-xs text-muted-foreground font-mono">
                  Trigger phrases cannot be changed - create a new pattern instead
                </p>
              </div>

              {/* Action Configuration */}
              <div>
                <label className="block text-sm font-mono font-semibold text-foreground mb-2">
                  Action Configuration
                </label>
                {isEditing && !isHardcoded ? (
                  <ActionSelector
                    value={{ type: actionType, params: actionParams }}
                    onChange={(type, params) => {
                      setActionType(type)
                      setActionParams(params)
                    }}
                  />
                ) : (
                  <>
                    <div className="px-4 py-3 bg-black/30 border border-border/30 rounded-lg space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{getActionConfig(actionType).icon}</span>
                        <span className="font-mono font-semibold text-sm text-foreground">
                          {getActionConfig(actionType).label}
                        </span>
                        {isHardcoded && (
                          <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px] px-1.5 py-0 uppercase ml-auto">
                            SYSTEM
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">
                        {getActionDisplayText(actionType, actionParams)}
                      </div>
                    </div>
                    {isHardcoded && (
                      <p className="mt-2 text-xs text-amber-400/70 font-mono">
                        System actions are defined in bot source code and cannot be modified
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Scope */}
              {!isHardcoded && (
                <div>
                  <label className="block text-sm font-mono font-semibold text-foreground mb-2">
                    Pattern Scope
                  </label>
                  {isEditing ? (
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setRuleScope('all_groups')}
                        className={`
                          px-4 py-3 rounded-lg border font-mono text-sm transition-all
                          ${ruleScope === 'all_groups'
                            ? 'bg-green-500/20 border-green-500/50 text-green-300 shadow-[0_0_12px_rgba(34,197,94,0.3)]'
                            : 'bg-muted/20 border-border/30 text-muted-foreground hover:bg-muted/30'
                          }
                        `}
                      >
                        All Groups
                      </button>
                      <button
                        type="button"
                        onClick={() => setRuleScope('control_group_only')}
                        className={`
                          px-4 py-3 rounded-lg border font-mono text-sm transition-all
                          ${ruleScope === 'control_group_only'
                            ? 'bg-purple-500/20 border-purple-500/50 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.3)]'
                            : 'bg-muted/20 border-border/30 text-muted-foreground hover:bg-muted/30'
                          }
                        `}
                      >
                        Control Group Only
                      </button>
                    </div>
                  ) : (
                    <div className="px-4 py-3 bg-black/30 border border-border/30 rounded-lg">
                      <Badge className={
                        ruleScope === 'all_groups'
                          ? 'bg-green-500/20 text-green-300 border-green-500/40'
                          : 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                      }>
                        {ruleScope === 'all_groups' ? 'All Groups' : 'Control Group Only'}
                      </Badge>
                    </div>
                  )}
                </div>
              )}

              {/* Priority & Status */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-mono font-semibold text-foreground mb-2">
                    Priority
                  </label>
                  {isEditing ? (
                    <input
                      type="number"
                      value={priority}
                      onChange={(e) => setPriority(parseInt(e.target.value))}
                      min={0}
                      max={100}
                      className="w-full px-4 py-3 bg-black/30 border border-border/30 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 tabular-nums"
                    />
                  ) : (
                    <div className="px-4 py-3 bg-black/30 border border-border/30 rounded-lg font-mono text-sm tabular-nums">
                      {patternData?.priority}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-mono font-semibold text-foreground mb-2">
                    Status
                  </label>
                  {isEditing ? (
                    <div className="flex items-center gap-3 h-[50px]">
                      <button
                        type="button"
                        onClick={() => setIsActive(!isActive)}
                        className={`
                          relative inline-flex h-7 w-14 items-center rounded-full transition-colors border
                          ${isActive ? 'bg-green-500/30 border-green-500/50' : 'bg-muted/30 border-border/50'}
                        `}
                      >
                        <span
                          className={`
                            inline-block h-5 w-5 transform rounded-full bg-foreground transition-transform
                            ${isActive ? 'translate-x-8' : 'translate-x-1'}
                          `}
                        />
                      </button>
                      <span className={`text-sm font-mono font-semibold ${isActive ? 'text-green-400' : 'text-muted-foreground'}`}>
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center h-[50px]">
                      <Badge className={
                        patternData?.is_active
                          ? 'bg-green-500/20 text-green-300 border-green-500/40'
                          : 'bg-gray-500/20 text-gray-300 border-gray-500/40'
                      }>
                        {patternData?.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>

              {/* Metadata */}
              {!isHardcoded && patternData && (
                <div className="pt-4 border-t border-border/30 space-y-2 text-xs font-mono text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Created:</span>
                    <span>{new Date(patternData.created_at).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Updated:</span>
                    <span>{new Date(patternData.updated_at).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Created by:</span>
                    <span>{patternData.created_by}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Rule ID:</span>
                    <span className="font-mono text-[10px]">{patternData.id}</span>
                  </div>
                </div>
              )}

              {/* Rule Tester - Story D.6 */}
              {patternData && (
                <RuleTester
                  triggerPhrase={patternData.trigger_phrase}
                  groupJid={patternData.group_jid}
                  ruleId={patternData.id}
                />
              )}

              {/* Error/Success Messages */}
              {error && (
                <div className="flex items-center gap-3 p-4 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400">
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  <span className="font-mono text-sm">{error}</span>
                </div>
              )}

              {success && (
                <div className="flex items-center gap-3 p-4 rounded-lg border border-green-500/30 bg-green-500/10 text-green-400">
                  <Check className="h-5 w-5 flex-shrink-0" />
                  <span className="font-mono text-sm">{success}</span>
                </div>
              )}

              {/* Delete Confirmation */}
              {showDeleteConfirm && (
                <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/10 space-y-3">
                  <div className="flex items-start gap-3 text-red-400">
                    <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="font-mono font-semibold text-sm">Delete this trigger pattern permanently?</div>
                      <div className="font-mono text-xs mt-1">This action cannot be undone.</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => setShowDeleteConfirm(false)}
                      variant="outline"
                      size="sm"
                      className="font-mono text-xs"
                      disabled={deleting}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleDelete}
                      size="sm"
                      disabled={deleting}
                      className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
                    >
                      {deleting ? 'Deleting...' : 'Delete Permanently'}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        {!loading && (
          <div className="sticky bottom-0 bg-card/95 backdrop-blur-sm border-t border-border/30 p-6">
            <div className="flex items-center justify-between">
              <div>
                {!isHardcoded && !isEditing && !showDeleteConfirm && (
                  <Button
                    onClick={() => setShowDeleteConfirm(true)}
                    variant="outline"
                    className="font-mono text-red-400 border-red-500/30 hover:bg-red-500/10 gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete Pattern
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-3">
                {isEditing ? (
                  <>
                    <Button
                      onClick={handleCancel}
                      variant="outline"
                      className="font-mono"
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={saving}
                      className="font-mono bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 gap-2"
                    >
                      {saving ? (
                        <>
                          <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4" />
                          Save Changes
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      onClick={onClose}
                      variant="outline"
                      className="font-mono"
                    >
                      Close
                    </Button>
                    {!isHardcoded && (
                      <Button
                        onClick={() => setIsEditing(true)}
                        className="font-mono bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 gap-2"
                      >
                        <Edit3 className="h-4 w-4" />
                        Edit Pattern
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
