/**
 * System Trigger Reconciler
 *
 * Keeps required system triggers present for each group without overriding
 * user-owned trigger customizations.
 *
 * Safety policy:
 * - Missing required triggers are inserted.
 * - Drifted system-owned triggers are updated to canonical shape.
 * - User-owned conflicts (same phrase, different action) are preserved and reported.
 */

import { getSupabase } from './supabase.js'
import { buildSystemTriggerRows, type SystemTriggerRow } from './systemTriggerTemplates.js'
import { clearTriggersCache } from './triggerService.js'
import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'

interface GroupTriggerRow {
  id: string
  group_jid: string
  trigger_phrase: string
  pattern_type: string
  action_type: string
  priority: number
  is_active: boolean
  is_system: boolean
  scope: string
  display_name: string | null
}

export interface ReconcileConflict {
  triggerPhrase: string
  existingActionType: string
  requiredActionType: string
  reason: 'user_owned_conflict' | 'insert_conflict'
}

export interface ReconcileSummary {
  groupJid: string
  isControlGroup: boolean
  requiredCount: number
  matchedCount: number
  insertedCount: number
  updatedCount: number
  conflicts: ReconcileConflict[]
}

function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase()
}

function dedupeRequiredRows(rows: SystemTriggerRow[]): SystemTriggerRow[] {
  const byPhrase = new Map<string, SystemTriggerRow>()
  for (const row of rows) {
    const key = normalizePhrase(row.trigger_phrase)
    if (!byPhrase.has(key)) {
      byPhrase.set(key, row)
      continue
    }

    // If duplicates happen, keep the highest-priority row deterministically.
    const current = byPhrase.get(key)!
    if (row.priority > current.priority) {
      byPhrase.set(key, row)
    }
  }
  return Array.from(byPhrase.values())
}

function requiresSystemUpdate(existing: GroupTriggerRow, required: SystemTriggerRow): boolean {
  return (
    existing.pattern_type !== required.pattern_type ||
    existing.action_type !== required.action_type ||
    existing.priority !== required.priority ||
    existing.is_active !== true ||
    existing.is_system !== true ||
    existing.scope !== required.scope ||
    (existing.display_name ?? null) !== (required.display_name ?? null)
  )
}

/**
 * Reconcile one group against canonical system trigger definitions.
 */
export async function reconcileSystemTriggers(
  groupJid: string,
  isControlGroup = false
): Promise<Result<ReconcileSummary>> {
  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  const requiredRowsRaw = await buildSystemTriggerRows(groupJid, isControlGroup)
  const requiredRows = dedupeRequiredRows(requiredRowsRaw)

  try {
    const { data, error } = await supabase
      .from('group_triggers')
      .select('id,group_jid,trigger_phrase,pattern_type,action_type,priority,is_active,is_system,scope,display_name')
      .eq('group_jid', groupJid)

    if (error) {
      logger.error('Failed to load group triggers for reconciliation', {
        event: 'system_trigger_reconcile_load_error',
        groupJid,
        error: error.message,
      })
      return err(`Failed to load triggers: ${error.message}`)
    }

    const existingRows = (data || []) as GroupTriggerRow[]
    // For case-variant phrase duplicates, prefer user-owned rows.
    // This keeps operator customizations visible to conflict reporting.
    const orderedExistingRows = [...existingRows].sort((a, b) => Number(a.is_system) - Number(b.is_system))
    const existingByPhrase = new Map<string, GroupTriggerRow>()
    for (const row of orderedExistingRows) {
      const key = normalizePhrase(row.trigger_phrase)
      if (!existingByPhrase.has(key)) {
        existingByPhrase.set(key, row)
      }
    }

    const summary: ReconcileSummary = {
      groupJid,
      isControlGroup,
      requiredCount: requiredRows.length,
      matchedCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      conflicts: [],
    }

    for (const required of requiredRows) {
      const key = normalizePhrase(required.trigger_phrase)
      const existing = existingByPhrase.get(key)

      if (!existing) {
        const { error: insertError } = await supabase
          .from('group_triggers')
          .insert(required)

        if (insertError) {
          if (insertError.code === '23505') {
            summary.conflicts.push({
              triggerPhrase: required.trigger_phrase,
              existingActionType: 'unknown',
              requiredActionType: required.action_type,
              reason: 'insert_conflict',
            })
            continue
          }
          logger.error('Failed to insert missing system trigger', {
            event: 'system_trigger_reconcile_insert_error',
            groupJid,
            triggerPhrase: required.trigger_phrase,
            error: insertError.message,
          })
          return err(`Failed to insert system trigger "${required.trigger_phrase}": ${insertError.message}`)
        }

        summary.insertedCount += 1
        continue
      }

      summary.matchedCount += 1

      const actionMatches = existing.action_type === required.action_type
      const scopeMatches = existing.scope === required.scope

      if (!actionMatches || !scopeMatches) {
        if (!existing.is_system) {
          summary.conflicts.push({
            triggerPhrase: required.trigger_phrase,
            existingActionType: existing.action_type,
            requiredActionType: required.action_type,
            reason: 'user_owned_conflict',
          })
          continue
        }
      }

      if (!existing.is_system) {
        continue
      }

      if (!requiresSystemUpdate(existing, required)) {
        continue
      }

      const patch: Record<string, unknown> = {
        pattern_type: required.pattern_type,
        action_type: required.action_type,
        priority: required.priority,
        is_active: true,
        is_system: true,
        scope: required.scope,
        display_name: required.display_name ?? null,
      }

      const { error: updateError } = await supabase
        .from('group_triggers')
        .update(patch)
        .eq('id', existing.id)
        .eq('group_jid', groupJid)

      if (updateError) {
        logger.error('Failed to update system trigger during reconciliation', {
          event: 'system_trigger_reconcile_update_error',
          groupJid,
          triggerId: existing.id,
          triggerPhrase: existing.trigger_phrase,
          error: updateError.message,
        })
        return err(`Failed to update system trigger "${existing.trigger_phrase}": ${updateError.message}`)
      }

      summary.updatedCount += 1
    }

    if (summary.insertedCount > 0 || summary.updatedCount > 0) {
      clearTriggersCache(groupJid)
    }

    logger.info('System trigger reconciliation completed', {
      event: 'system_trigger_reconcile_done',
      groupJid,
      isControlGroup,
      requiredCount: summary.requiredCount,
      matchedCount: summary.matchedCount,
      insertedCount: summary.insertedCount,
      updatedCount: summary.updatedCount,
      conflictCount: summary.conflicts.length,
    })

    return ok(summary)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('System trigger reconciliation exception', {
      event: 'system_trigger_reconcile_exception',
      groupJid,
      error: errorMessage,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}

const RECONCILE_COOLDOWN_MS = 5 * 60 * 1000
const inFlight = new Set<string>()
const nextAllowedAt = new Map<string, number>()

function getReconcileKey(groupJid: string, isControlGroup: boolean): string {
  return `${groupJid}:${isControlGroup ? 'control' : 'group'}`
}

/**
 * Fire-and-forget reconciliation with per-group cooldown.
 * Safe to call on every message ingress.
 */
export function scheduleSystemTriggerReconciliation(
  groupJid: string,
  isControlGroup = false
): void {
  const key = getReconcileKey(groupJid, isControlGroup)
  const now = Date.now()

  if (inFlight.has(key)) return

  const next = nextAllowedAt.get(key) ?? 0
  if (now < next) return

  inFlight.add(key)
  nextAllowedAt.set(key, now + RECONCILE_COOLDOWN_MS)

  void reconcileSystemTriggers(groupJid, isControlGroup)
    .then((result) => {
      if (!result.ok) {
        logger.warn('System trigger reconciliation failed', {
          event: 'system_trigger_reconcile_failed',
          groupJid,
          isControlGroup,
          error: result.error,
        })
      }
    })
    .catch((e) => {
      logger.warn('System trigger reconciliation crashed', {
        event: 'system_trigger_reconcile_crash',
        groupJid,
        isControlGroup,
        error: e instanceof Error ? e.message : String(e),
      })
    })
    .finally(() => {
      inFlight.delete(key)
    })
}

/**
 * Test-only helper to reset cooldown/in-flight state.
 */
export function resetSystemTriggerReconciliationStateForTests(): void {
  inFlight.clear()
  nextAllowedAt.clear()
}
