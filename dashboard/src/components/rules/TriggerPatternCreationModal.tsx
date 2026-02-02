/**
 * Trigger Pattern Creation Modal
 * Modal for creating new trigger patterns (keyword → action)
 */
import { useState } from 'react'
import { X, Plus, AlertCircle, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ActionSelector } from '@/components/actions/ActionSelector'
import { type ActionType, validateActionParams } from '@/types/actions'

interface TriggerPatternCreationModalProps {
  isOpen: boolean
  onClose: () => void
  groupId?: string
  prefillTrigger?: string
  onPatternCreated?: () => void
}

export function TriggerPatternCreationModal({
  isOpen,
  onClose,
  groupId = 'demo-group-id',
  prefillTrigger = '',
  onPatternCreated,
}: TriggerPatternCreationModalProps) {
  const [triggerPhrase, setTriggerPhrase] = useState(prefillTrigger)
  const [actionType, setActionType] = useState<ActionType>('text_response')
  const [actionParams, setActionParams] = useState<any>({ template: '' })
  const [priority, setPriority] = useState(0)
  const [isActive, setIsActive] = useState(true)
  const [scope, setScope] = useState<'all_groups' | 'control_group_only'>('all_groups')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validate action type is valid
    const validActionTypes: ActionType[] = ['text_response', 'usdt_quote', 'commercial_dollar_quote', 'ai_prompt', 'custom']
    if (!validActionTypes.includes(actionType)) {
      setError(`Invalid action type: ${actionType}`)
      return
    }

    // Validate action params
    const validation = validateActionParams(actionType, actionParams)
    if (!validation.valid) {
      setError(validation.error || 'Invalid action configuration')
      return
    }

    setSaving(true)

    try {
      const response = await fetch('http://localhost:3003/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupJid: groupId,
          triggerPhrase,
          responseTemplate: actionType === 'text_response' ? actionParams.template : '', // Backward compat
          action_type: actionType,
          action_params: actionParams,
          priority,
          isActive,
          scope,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create rule')
      }

      setSuccess(true)
      setTimeout(() => {
        onClose()
        onPatternCreated?.()
        // Reset form
        setTriggerPhrase('')
        setActionType('text_response')
        setActionParams({ template: '' })
        setPriority(0)
        setIsActive(true)
        setSuccess(false)
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rule')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-card border border-border/50 rounded-lg shadow-2xl shadow-purple-500/10">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-purple-500/10 via-transparent to-cyan-500/10 border-b border-border/30 p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-cyan-500/20 border border-purple-500/30 flex items-center justify-center">
                <Plus className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <h2 className="text-2xl font-mono font-bold bg-gradient-to-r from-purple-400 to-cyan-500 bg-clip-text text-transparent">
                  Create Trigger Pattern
                </h2>
                <p className="text-sm text-muted-foreground font-mono mt-1">
                  Keyword recognition → automated response
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Trigger Phrase */}
          <div>
            <label className="block text-sm font-mono font-semibold text-foreground mb-2">
              Trigger Phrase <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={triggerPhrase}
              onChange={(e) => setTriggerPhrase(e.target.value)}
              placeholder="e.g., compro USDT, vendo BTC, preço"
              required
              className="w-full px-4 py-3 bg-black/30 border border-border/30 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 placeholder:text-muted-foreground/50"
            />
            <p className="mt-2 text-xs text-muted-foreground font-mono">
              The phrase that will trigger this automated response (case-insensitive)
            </p>
          </div>

          {/* Action Configuration */}
          <ActionSelector
            value={{ type: actionType, params: actionParams }}
            onChange={(type, params) => {
              setActionType(type)
              setActionParams(params)
            }}
          />

          {/* Scope Selector */}
          <div>
            <label className="block text-sm font-mono font-semibold text-foreground mb-2">
              Pattern Scope <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setScope('all_groups')}
                className={`
                  px-4 py-3 rounded-lg border font-mono text-sm transition-all
                  ${scope === 'all_groups'
                    ? 'bg-green-500/20 border-green-500/50 text-green-300 shadow-[0_0_12px_rgba(34,197,94,0.3)]'
                    : 'bg-muted/20 border-border/30 text-muted-foreground hover:bg-muted/30'
                  }
                `}
              >
                All Groups
              </button>
              <button
                type="button"
                onClick={() => setScope('control_group_only')}
                className={`
                  px-4 py-3 rounded-lg border font-mono text-sm transition-all
                  ${scope === 'control_group_only'
                    ? 'bg-purple-500/20 border-purple-500/50 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.3)]'
                    : 'bg-muted/20 border-border/30 text-muted-foreground hover:bg-muted/30'
                  }
                `}
              >
                Control Group Only
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground font-mono">
              {scope === 'all_groups'
                ? 'This pattern will trigger in all monitored groups'
                : 'This pattern will only trigger in the CONTROLE_eNorBOT group'
              }
            </p>
          </div>

          {/* Priority & Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-mono font-semibold text-foreground mb-2">
                Priority
              </label>
              <input
                type="number"
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value))}
                min={0}
                max={100}
                className="w-full px-4 py-3 bg-black/30 border border-border/30 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 tabular-nums"
              />
              <p className="mt-2 text-xs text-muted-foreground font-mono">
                Higher priority rules match first (0-100)
              </p>
            </div>

            <div>
              <label className="block text-sm font-mono font-semibold text-foreground mb-2">
                Status
              </label>
              <div className="flex items-center gap-3 h-[50px]">
                <button
                  type="button"
                  onClick={() => setIsActive(!isActive)}
                  className={`
                    relative inline-flex h-7 w-14 items-center rounded-full transition-colors
                    ${isActive ? 'bg-green-500/30 border-green-500/50' : 'bg-muted/30 border-border/50'}
                    border
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
            </div>
          </div>


          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-3 p-4 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <span className="font-mono text-sm">{error}</span>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="flex items-center gap-3 p-4 rounded-lg border border-green-500/30 bg-green-500/10 text-green-400">
              <Check className="h-5 w-5 flex-shrink-0" />
              <span className="font-mono text-sm">Trigger pattern created successfully!</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border/30">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="font-mono"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!triggerPhrase || saving}
              className="font-mono bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 gap-2"
            >
              {saving ? (
                <>
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Create Pattern
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
