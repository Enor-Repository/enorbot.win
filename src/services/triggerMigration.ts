/**
 * Trigger Migration Shadow Mode
 * Sprint 3, Task 3.7
 *
 * Runs both old (rulesService.findMatchingRule) and new (triggerService.matchTrigger)
 * matchers in parallel and logs discrepancies for validation before cutover.
 *
 * Shadow mode is controlled by TRIGGER_SHADOW_MODE env var:
 * - "shadow" (default): Run both, log comparison, use OLD result for routing
 * - "new": Use NEW trigger system only (post-cutover)
 * - "off": Use OLD rules system only (rollback)
 */
import { logger } from '../utils/logger.js'
import { findMatchingRule, type Rule } from './rulesService.js'
import { matchTrigger, type GroupTrigger } from './triggerService.js'

// ============================================================================
// Types
// ============================================================================

export type TriggerMode = 'shadow' | 'new' | 'off'

export interface ShadowMatchResult {
  /** Which system to use for actual routing */
  mode: TriggerMode
  /** Old system match result */
  oldMatch: Rule | null
  /** New system match result */
  newMatch: GroupTrigger | null
  /** Whether both systems agree on match/no-match */
  parity: boolean
  /** Parity details for logging */
  parityDetail: string
  /** Error from new system (distinct from no-match) */
  newError?: string
}

// ============================================================================
// Configuration
// ============================================================================

let currentMode: TriggerMode = 'shadow'

/**
 * Set the trigger mode. Called from config on startup.
 */
export function setTriggerMode(mode: TriggerMode): void {
  currentMode = mode
  logger.info('Trigger mode set', {
    event: 'trigger_mode_set',
    mode,
  })
}

/**
 * Initialize trigger mode from environment variable.
 * Should be called during app startup.
 */
export function initTriggerMode(): void {
  const envMode = process.env.TRIGGER_SHADOW_MODE
  if (envMode && ['shadow', 'new', 'off'].includes(envMode)) {
    setTriggerMode(envMode as TriggerMode)
  }
}

/**
 * Get current trigger mode.
 */
export function getTriggerMode(): TriggerMode {
  return currentMode
}

/** Strip control characters from log values */
function sanitizeLogValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, '')
}

// ============================================================================
// Shadow Mode Comparison
// ============================================================================

/**
 * Run shadow mode comparison between old and new trigger systems.
 *
 * In "shadow" mode:
 * - Both systems run
 * - Discrepancies are logged as warnings
 * - Old system result is used for actual routing
 *
 * In "new" mode:
 * - Only new system runs
 * - Old system is skipped
 *
 * In "off" mode:
 * - Only old system runs
 * - New system is skipped
 */
export async function shadowMatch(
  groupJid: string,
  message: string
): Promise<ShadowMatchResult> {
  // Capture mode once to avoid race conditions during async execution
  const mode = currentMode

  if (mode === 'off') {
    // Old system only
    const oldMatch = findMatchingRule(groupJid, message)
    return {
      mode: 'off',
      oldMatch,
      newMatch: null,
      parity: true,
      parityDetail: 'mode=off, old system only',
    }
  }

  if (mode === 'new') {
    // New system only — wrap in try-catch for resilience
    let newMatch: GroupTrigger | null = null
    let newError: string | undefined
    try {
      const newResult = await matchTrigger(message, groupJid)
      if (newResult.ok) {
        newMatch = newResult.data
      } else {
        newError = newResult.error
        logger.error('New trigger system error', {
          event: 'trigger_new_system_error',
          groupJid,
          error: newResult.error,
        })
      }
    } catch (e) {
      newError = e instanceof Error ? e.message : String(e)
      logger.error('New trigger system threw', {
        event: 'trigger_new_system_exception',
        groupJid,
        error: newError,
      })
    }
    return {
      mode: 'new',
      oldMatch: null,
      newMatch,
      newError,
      parity: true,
      parityDetail: 'mode=new, new system only',
    }
  }

  // Shadow mode: run both and compare
  const oldMatch = findMatchingRule(groupJid, message)

  let newMatch: GroupTrigger | null = null
  let newError: string | undefined
  try {
    const newResult = await matchTrigger(message, groupJid)
    if (newResult.ok) {
      newMatch = newResult.data
    } else {
      newError = newResult.error
      logger.error('New trigger system error in shadow mode', {
        event: 'trigger_new_system_error',
        groupJid,
        error: newResult.error,
      })
    }
  } catch (e) {
    newError = e instanceof Error ? e.message : String(e)
    logger.error('New trigger system threw in shadow mode', {
      event: 'trigger_new_system_exception',
      groupJid,
      error: newError,
    })
  }

  // Check parity (only meaningful when new system didn't error)
  const oldMatched = oldMatch !== null
  const newMatched = newMatch !== null

  let parity = true
  let parityDetail = 'both agree'

  if (newError) {
    // New system errored — don't report as parity mismatch
    parity = false
    parityDetail = `NEW system error: ${newError}`
  } else if (oldMatched && !newMatched) {
    parity = false
    parityDetail = `OLD matched (${oldMatch.triggerPhrase} → ${oldMatch.actionType}) but NEW did not`
  } else if (!oldMatched && newMatch) {
    parity = false
    parityDetail = `NEW matched (${newMatch.triggerPhrase} → ${newMatch.actionType}) but OLD did not`
  } else if (oldMatch && newMatch) {
    // Both matched — check if they matched the same trigger phrase
    const sameTrigger = oldMatch.triggerPhrase.toLowerCase() === newMatch.triggerPhrase.toLowerCase()
    if (!sameTrigger) {
      parity = false
      parityDetail = `Both matched but different triggers: OLD="${oldMatch.triggerPhrase}" vs NEW="${newMatch.triggerPhrase}"`
    } else {
      parityDetail = `both matched "${oldMatch.triggerPhrase}"`
    }
  } else {
    parityDetail = 'both returned no match'
  }

  // Log result
  if (!parity && !newError) {
    logger.warn('Shadow mode parity mismatch', {
      event: 'trigger_shadow_mismatch',
      groupJid,
      message: sanitizeLogValue(message.substring(0, 100)),
      parityDetail,
      oldTrigger: oldMatch?.triggerPhrase || null,
      oldAction: oldMatch?.actionType || null,
      newTrigger: newMatch?.triggerPhrase || null,
      newAction: newMatch?.actionType || null,
    })
  } else if (parity) {
    logger.debug('Shadow mode parity OK', {
      event: 'trigger_shadow_parity',
      groupJid,
      matched: oldMatched || newMatched,
      trigger: oldMatch?.triggerPhrase || newMatch?.triggerPhrase || null,
    })
  }

  return {
    mode: 'shadow',
    oldMatch,
    newMatch,
    newError,
    parity,
    parityDetail,
  }
}
