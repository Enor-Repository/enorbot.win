import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Copy, CheckCircle2, AlertCircle } from 'lucide-react'
import {
  API_ENDPOINTS,
  writeHeaders,
  type CloneRulesetRequest,
  type CloneRulesetResponse,
} from '@/lib/api'

interface GroupOption {
  jid: string
  name: string
  mode: string
}

interface CloneRulesetModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceGroup: { jid: string; name: string }
  allGroups: GroupOption[]
  onSuccess: () => void
}

type CloneState = 'idle' | 'loading' | 'success' | 'error'

export function CloneRulesetModal({
  open,
  onOpenChange,
  sourceGroup,
  allGroups,
  onSuccess,
}: CloneRulesetModalProps) {
  const [targetJid, setTargetJid] = useState('')
  const [cloneTriggers, setCloneTriggers] = useState(true)
  const [cloneRules, setCloneRules] = useState(true)
  const [cloneSpreads, setCloneSpreads] = useState(true)
  const [state, setState] = useState<CloneState>('idle')
  const [result, setResult] = useState<CloneRulesetResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setTargetJid('')
      setCloneTriggers(true)
      setCloneRules(true)
      setCloneSpreads(true)
      setState('idle')
      setResult(null)
      setErrorMsg('')
    }
  }, [open])

  // Auto-close on success after 2s
  useEffect(() => {
    if (state === 'success') {
      const timer = setTimeout(() => {
        onOpenChange(false)
        onSuccess()
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [state, onOpenChange, onSuccess])

  const targetGroups = allGroups.filter(g => g.jid !== sourceGroup.jid)
  const atLeastOneChecked = cloneTriggers || cloneRules || cloneSpreads
  const canClone = targetJid && atLeastOneChecked && state !== 'loading'

  const handleClone = useCallback(async () => {
    if (!canClone) return
    setState('loading')
    setErrorMsg('')

    try {
      const body: CloneRulesetRequest = {
        sourceGroupJid: sourceGroup.jid,
        cloneTriggers,
        cloneRules,
        cloneSpreads,
      }

      const response = await fetch(API_ENDPOINTS.cloneRuleset(targetJid), {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`)
      }

      setResult(data as CloneRulesetResponse)
      setState('success')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error')
      setState('error')
    }
  }, [canClone, sourceGroup.jid, targetJid, cloneTriggers, cloneRules, cloneSpreads])

  return (
    <Dialog open={open} onOpenChange={state === 'loading' ? () => {} : onOpenChange}>
      <DialogContent showCloseButton={state !== 'loading'} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-4 w-4 text-purple-400" />
            Clone Ruleset
          </DialogTitle>
          <DialogDescription>
            Copy triggers, time rules, and spread config to another group.
          </DialogDescription>
        </DialogHeader>

        {state === 'success' && result ? (
          <div className="py-4 space-y-3">
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-semibold">Clone Complete</span>
            </div>
            <div className="text-sm text-muted-foreground font-mono space-y-1">
              {cloneTriggers && (
                <p>
                  Triggers: {result.triggers.created} created, {result.triggers.updated} updated
                  {result.triggers.skipped > 0 && `, ${result.triggers.skipped} skipped`}
                </p>
              )}
              {cloneRules && (
                <p>
                  Rules: {result.rules.created} created, {result.rules.updated} updated
                  {result.rules.skipped > 0 && `, ${result.rules.skipped} skipped`}
                </p>
              )}
              {cloneSpreads && (
                <p>Spreads: {result.spreads.updated ? 'updated' : 'no changes'}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* Source (read-only) */}
            <div>
              <label className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
                Source
              </label>
              <div className="mt-1 px-3 py-2 rounded-md bg-background/50 border border-purple-500/20 text-sm font-mono">
                {sourceGroup.name}
              </div>
            </div>

            {/* Target selector */}
            <div>
              <label className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
                Target Group
              </label>
              <select
                value={targetJid}
                onChange={e => setTargetJid(e.target.value)}
                disabled={state === 'loading'}
                className="mt-1 w-full px-3 py-2 rounded-md bg-background border border-purple-500/30 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-50"
              >
                <option value="">Select a group...</option>
                {targetGroups.map(g => (
                  <option key={g.jid} value={g.jid}>
                    {g.name} ({g.mode})
                  </option>
                ))}
              </select>
            </div>

            {/* Checkboxes */}
            <div>
              <label className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
                What to Clone
              </label>
              <div className="mt-2 space-y-2">
                {[
                  { key: 'triggers', label: 'Triggers', checked: cloneTriggers, set: setCloneTriggers },
                  { key: 'rules', label: 'Time Rules', checked: cloneRules, set: setCloneRules },
                  { key: 'spreads', label: 'Spread Config', checked: cloneSpreads, set: setCloneSpreads },
                ].map(item => (
                  <label
                    key={item.key}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-purple-500/5 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={e => item.set(e.target.checked)}
                      disabled={state === 'loading'}
                      className="rounded border-purple-500/40 text-purple-500 focus:ring-purple-500/50 bg-background"
                    />
                    <span className="text-sm font-mono">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Warning */}
            <p className="text-[11px] text-amber-400/80 font-mono">
              Existing items in the target group with matching names will be overwritten.
            </p>

            {/* Error */}
            {state === 'error' && errorMsg && (
              <div className="flex items-start gap-2 text-red-400 text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span className="font-mono">{errorMsg}</span>
              </div>
            )}
          </div>
        )}

        {state !== 'success' && (
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={state === 'loading'}
            >
              Cancel
            </Button>
            <Button
              onClick={handleClone}
              disabled={!canClone}
              loading={state === 'loading'}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              Clone
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
