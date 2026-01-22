# Story 3.3: Auto-Recovery from Transient Errors

Status: done

## Story

As a **CIO**,
I want **the bot to recover automatically from temporary issues**,
So that **I don't need to intervene for every hiccup**.

## Acceptance Criteria

1. **AC1: Transient Error Counter Reset**
   - **Given** a transient error occurred and was logged
   - **When** the next successful operation completes
   - **Then** the error counter resets
   - **And** the bot logs "Recovered from transient error"

2. **AC2: Transient Error Escalation**
   - **Given** transient errors accumulate (3+ in 60 seconds)
   - **When** the threshold is breached
   - **Then** the error is escalated to critical
   - **And** auto-pause is triggered (Story 3.2)

3. **AC3: Auto-Recovery Attempt**
   - **Given** the bot was auto-paused due to escalated transient errors
   - **When** 5 minutes pass without manual intervention
   - **Then** the bot attempts one auto-recovery cycle
   - **And** if successful, resumes normal operation with control group notification: "✅ Auto-recovered"

4. **AC4: Auto-Recovery Failure**
   - **Given** auto-recovery fails
   - **When** the retry is unsuccessful
   - **Then** the bot remains paused
   - **And** sends notification: "⚠️ Auto-recovery failed. Manual intervention required."

## Tasks / Subtasks

- [x] **Task 1: Implement Transient Error Counter with Decay** (AC: #1, #2)
  - [x] 1.1 Create `src/services/transientErrors.ts` for transient error tracking
  - [x] 1.2 Add `TransientErrorEntry` type with `{ timestamp: Date, source: ErrorSource }`
  - [x] 1.3 Add `transientErrorWindow: TransientErrorEntry[]` array for sliding window
  - [x] 1.4 Add constant `TRANSIENT_WINDOW_MS = 60 * 1000` (60 seconds per AC2)
  - [x] 1.5 Implement `recordTransientError(source: ErrorSource): { shouldEscalate: boolean, count: number }`
  - [x] 1.6 In `recordTransientError`, filter out expired entries (>60s old) before counting
  - [x] 1.7 In `recordTransientError`, return `shouldEscalate: true` when count >= 3 within window
  - [x] 1.8 Implement `clearTransientErrors(source: ErrorSource): void` for success reset
  - [x] 1.9 Log `event: 'transient_error_recorded'` with source, windowCount, timestamp
  - [x] 1.10 Log `event: 'transient_errors_cleared'` on success with previousCount

- [x] **Task 2: Success Recovery Logging** (AC: #1)
  - [x] 2.1 Implement `recordSuccessfulOperation(source: ErrorSource): void` in transientErrors.ts
  - [x] 2.2 Check if there were previous transient errors for source before clearing
  - [x] 2.3 If previous errors existed, log `event: 'recovered_from_transient'` with source
  - [x] 2.4 Call `recordSuccess(source)` from errors.ts to reset consecutive failure counter

- [x] **Task 3: Create Auto-Recovery Timer Service** (AC: #3, #4)
  - [x] 3.1 Create `src/services/autoRecovery.ts` for auto-recovery orchestration
  - [x] 3.2 Add constant `AUTO_RECOVERY_DELAY_MS = 5 * 60 * 1000` (5 minutes per AC3)
  - [x] 3.3 Add `autoRecoveryTimer: NodeJS.Timeout | null` state variable
  - [x] 3.4 Add `recoveryAttemptPending: boolean` flag to track pending recovery
  - [x] 3.5 Implement `scheduleAutoRecovery(pauseReason: string): void`
  - [x] 3.6 In `scheduleAutoRecovery`, only schedule if triggered by transient error escalation
  - [x] 3.7 In `scheduleAutoRecovery`, use setTimeout for 5-minute delay
  - [x] 3.8 Log `event: 'auto_recovery_scheduled'` with scheduledAt, recoverAt timestamps

- [x] **Task 4: Implement Recovery Attempt Logic** (AC: #3, #4)
  - [x] 4.1 Implement `attemptRecovery(): Promise<boolean>` function
  - [x] 4.2 In `attemptRecovery`, perform health check (Binance ping via fetchPrice)
  - [x] 4.3 Health check uses Binance API only (WhatsApp reconnects passively via event-driven connection)
  - [x] 4.4 Log `event: 'auto_recovery_attempting'` at start
  - [x] 4.5 If recovery succeeds, call `setRunning()` from state.ts
  - [x] 4.6 If recovery succeeds, log `event: 'auto_recovery_succeeded'`
  - [x] 4.7 If recovery succeeds, queue notification: "✅ Auto-recovered from [reason]"
  - [x] 4.8 If recovery fails, log `event: 'auto_recovery_failed'`
  - [x] 4.9 If recovery fails, queue notification: "⚠️ Auto-recovery failed. Manual intervention required."
  - [x] 4.10 Clear `recoveryAttemptPending` flag after attempt

- [x] **Task 5: Cancel Recovery on Manual Intervention** (AC: #3, #4)
  - [x] 5.1 Implement `cancelAutoRecovery(): void` function
  - [x] 5.2 Clear `autoRecoveryTimer` if active
  - [x] 5.3 Set `recoveryAttemptPending` to false
  - [x] 5.4 Log `event: 'auto_recovery_cancelled'` with reason (manual intervention)
  - [x] 5.5 Export `isRecoveryPending(): boolean` for status queries

- [x] **Task 6: Integrate with Auto-Pause Service** (AC: #2, #3)
  - [x] 6.1 Modify `triggerAutoPause` in autoPause.ts to accept `{ isTransientEscalation: boolean }` option
  - [x] 6.2 If `isTransientEscalation: true`, call `scheduleAutoRecovery(reason)` after pause
  - [x] 6.3 Update price.ts escalation call to pass `{ isTransientEscalation: true }`
  - [x] 6.4 Update connection.ts critical disconnect call to pass `{ isTransientEscalation: false }`
  - [x] 6.5 Log `event: 'auto_pause_with_recovery'` when recovery scheduled

- [x] **Task 7: Integrate Success Tracking in Handlers** (AC: #1)
  - [x] 7.1 Import `recordSuccessfulOperation` in price.ts
  - [x] 7.2 After successful Binance response, call `recordSuccessfulOperation('binance')`
  - [x] 7.3 Import `recordSuccessfulOperation` in connection.ts
  - [x] 7.4 After successful reconnection, call `recordSuccessfulOperation('whatsapp')`
  - [x] 7.5 Ensure recovery logging happens before normal response flow continues

- [x] **Task 8: Integrate Escalation in Handlers** (AC: #2)
  - [x] 8.1 Import `recordTransientError` in price.ts
  - [x] 8.2 On transient Binance error, call `recordTransientError('binance')`
  - [x] 8.3 Check return value for `shouldEscalate` and trigger auto-pause if true
  - [x] 8.4 Import `recordTransientError` in connection.ts
  - [x] 8.5 On transient WhatsApp error, call `recordTransientError('whatsapp')`
  - [x] 8.6 Ensure escalation calls `triggerAutoPause` with `isTransientEscalation: true`

- [x] **Task 9: Unit Tests** (AC: #1, #2, #3, #4)
  - [x] 9.1 Create `src/services/transientErrors.test.ts` co-located with source
  - [x] 9.2 Test recordTransientError adds entry to window
  - [x] 9.3 Test recordTransientError filters expired entries (>60s old)
  - [x] 9.4 Test recordTransientError returns shouldEscalate: true at threshold
  - [x] 9.5 Test recordTransientError returns shouldEscalate: false below threshold
  - [x] 9.6 Test clearTransientErrors removes entries for source
  - [x] 9.7 Test recordSuccessfulOperation clears errors and logs recovery if previous errors
  - [x] 9.8 Create `src/services/autoRecovery.test.ts` co-located with source
  - [x] 9.9 Test scheduleAutoRecovery sets timer
  - [x] 9.10 Test scheduleAutoRecovery logs scheduled event
  - [x] 9.11 Test attemptRecovery calls health check
  - [x] 9.12 Test attemptRecovery success calls setRunning and queues notification
  - [x] 9.13 Test attemptRecovery failure keeps paused state and queues failure notification
  - [x] 9.14 Test cancelAutoRecovery clears timer
  - [x] 9.15 Test cancelAutoRecovery logs cancellation event
  - [x] 9.16 Test integration: transient escalation triggers auto-pause with recovery scheduled

## Dev Notes

### Architecture Compliance

**CRITICAL - Follow These Patterns:**

1. **Result Type Pattern** - Services return Result, NEVER throw:
   ```typescript
   // attemptRecovery returns boolean (success/fail)
   // Internal health check uses Result pattern
   async function attemptRecovery(): Promise<boolean> {
     const result = await fetchPrice() // Returns Result<number>
     if (result.ok) {
       setRunning()
       queueControlNotification('✅ Auto-recovered from ...')
       return true
     }
     queueControlNotification('⚠️ Auto-recovery failed. Manual intervention required.')
     return false
   }
   ```

2. **Logger Pattern** - Use structured JSON logger:
   ```typescript
   logger.info('Recovered from transient error', {
     event: 'recovered_from_transient',
     source: 'binance',
     previousErrorCount: 2,
     timestamp: new Date().toISOString(),
   })

   logger.info('Auto-recovery scheduled', {
     event: 'auto_recovery_scheduled',
     reason: 'Binance API failures (3 consecutive)',
     scheduledAt: new Date().toISOString(),
     recoverAt: new Date(Date.now() + AUTO_RECOVERY_DELAY_MS).toISOString(),
   })

   logger.warn('Transient error recorded', {
     event: 'transient_error_recorded',
     source: 'binance',
     windowCount: 2,
     windowMs: TRANSIENT_WINDOW_MS,
     timestamp: new Date().toISOString(),
   })
   ```

3. **Naming Conventions:**
   - File: `transientErrors.ts`, `autoRecovery.ts` (camelCase)
   - Functions: `recordTransientError`, `attemptRecovery`, `scheduleAutoRecovery` (camelCase)
   - Constants: `AUTO_RECOVERY_DELAY_MS`, `TRANSIENT_WINDOW_MS` (SCREAMING_SNAKE)
   - Types: `TransientErrorEntry` (PascalCase)

### State Management Design

**Key Design Decision: Time-based sliding window for transient errors**

From Story 3.3 ACs:
> "Transient errors accumulate (3+ in 60 seconds) → escalate to critical"

This requires a sliding window approach, not a simple counter:

```typescript
// src/services/transientErrors.ts

/**
 * Entry in the transient error sliding window.
 */
interface TransientErrorEntry {
  source: ErrorSource
  timestamp: Date
}

/**
 * Sliding window for transient errors.
 * Entries older than TRANSIENT_WINDOW_MS are ignored.
 */
const transientErrorWindow: TransientErrorEntry[] = []

/**
 * Window duration for transient error accumulation.
 * 60 seconds per AC2.
 */
export const TRANSIENT_WINDOW_MS = 60 * 1000

/**
 * Threshold for escalating transient → critical.
 * 3+ errors in the window per AC2.
 */
export const TRANSIENT_ESCALATION_THRESHOLD = 3

/**
 * Record a transient error and check if escalation is needed.
 */
export function recordTransientError(source: ErrorSource): {
  shouldEscalate: boolean
  count: number
} {
  const now = new Date()

  // Add new error
  transientErrorWindow.push({ source, timestamp: now })

  // Filter to recent errors (within window) for this source
  const cutoff = now.getTime() - TRANSIENT_WINDOW_MS
  const recentForSource = transientErrorWindow.filter(
    e => e.source === source && e.timestamp.getTime() > cutoff
  )

  // Clean up old entries periodically (keep window manageable)
  const validEntries = transientErrorWindow.filter(e => e.timestamp.getTime() > cutoff)
  transientErrorWindow.length = 0
  transientErrorWindow.push(...validEntries)

  const count = recentForSource.length
  const shouldEscalate = count >= TRANSIENT_ESCALATION_THRESHOLD

  logger.warn('Transient error recorded', {
    event: 'transient_error_recorded',
    source,
    windowCount: count,
    windowMs: TRANSIENT_WINDOW_MS,
    threshold: TRANSIENT_ESCALATION_THRESHOLD,
    willEscalate: shouldEscalate,
    timestamp: now.toISOString(),
  })

  return { shouldEscalate, count }
}
```

**Auto-Recovery Timer Design:**

```typescript
// src/services/autoRecovery.ts

import { logger } from '../utils/logger.js'
import { setRunning, getOperationalStatus, getPauseInfo } from '../bot/state.js'
import { queueControlNotification } from '../bot/notifications.js'
import { fetchPrice } from './binance.js'
import { getConnectionStatus } from '../bot/state.js'

/**
 * Delay before auto-recovery attempt.
 * 5 minutes per AC3.
 */
export const AUTO_RECOVERY_DELAY_MS = 5 * 60 * 1000

let autoRecoveryTimer: NodeJS.Timeout | null = null
let recoveryAttemptPending = false
let lastPauseReason: string | null = null

/**
 * Schedule an auto-recovery attempt after the configured delay.
 * Only schedules if triggered by transient error escalation.
 */
export function scheduleAutoRecovery(pauseReason: string): void {
  // Clear any existing timer
  if (autoRecoveryTimer) {
    clearTimeout(autoRecoveryTimer)
  }

  lastPauseReason = pauseReason
  recoveryAttemptPending = true

  const scheduledAt = new Date()
  const recoverAt = new Date(scheduledAt.getTime() + AUTO_RECOVERY_DELAY_MS)

  logger.info('Auto-recovery scheduled', {
    event: 'auto_recovery_scheduled',
    reason: pauseReason,
    scheduledAt: scheduledAt.toISOString(),
    recoverAt: recoverAt.toISOString(),
    delayMs: AUTO_RECOVERY_DELAY_MS,
  })

  autoRecoveryTimer = setTimeout(async () => {
    await attemptRecovery()
  }, AUTO_RECOVERY_DELAY_MS)
}

/**
 * Attempt to recover from paused state.
 * Performs health check and resumes if successful.
 */
async function attemptRecovery(): Promise<boolean> {
  if (getOperationalStatus() !== 'paused') {
    logger.info('Auto-recovery skipped - already running', {
      event: 'auto_recovery_skipped',
      reason: 'not_paused',
    })
    recoveryAttemptPending = false
    return true
  }

  logger.info('Attempting auto-recovery', {
    event: 'auto_recovery_attempting',
    pauseReason: lastPauseReason,
    timestamp: new Date().toISOString(),
  })

  // Perform health check based on what caused the pause
  let recoverySuccessful = false

  // Try Binance health check
  const priceResult = await fetchPrice()
  if (priceResult.ok) {
    recoverySuccessful = true
  }

  recoveryAttemptPending = false
  autoRecoveryTimer = null

  if (recoverySuccessful) {
    setRunning()

    const message = `✅ Auto-recovered from ${lastPauseReason || 'previous error'}`
    queueControlNotification(message)

    logger.info('Auto-recovery succeeded', {
      event: 'auto_recovery_succeeded',
      previousReason: lastPauseReason,
      timestamp: new Date().toISOString(),
    })

    lastPauseReason = null
    return true
  } else {
    const message = '⚠️ Auto-recovery failed. Manual intervention required.'
    queueControlNotification(message)

    logger.error('Auto-recovery failed', {
      event: 'auto_recovery_failed',
      reason: lastPauseReason,
      timestamp: new Date().toISOString(),
    })

    return false
  }
}

/**
 * Cancel any pending auto-recovery.
 * Called when manual intervention occurs (resume command).
 */
export function cancelAutoRecovery(): void {
  if (autoRecoveryTimer) {
    clearTimeout(autoRecoveryTimer)
    autoRecoveryTimer = null
  }

  if (recoveryAttemptPending) {
    logger.info('Auto-recovery cancelled', {
      event: 'auto_recovery_cancelled',
      reason: 'manual_intervention',
      timestamp: new Date().toISOString(),
    })
  }

  recoveryAttemptPending = false
  lastPauseReason = null
}

/**
 * Check if a recovery attempt is pending.
 * Useful for status command (Epic 4).
 */
export function isRecoveryPending(): boolean {
  return recoveryAttemptPending
}

/**
 * Reset auto-recovery state (for testing).
 */
export function resetAutoRecoveryState(): void {
  cancelAutoRecovery()
}
```

### Integration Points

**1. price.ts - Transient Error Recording & Escalation:**

```typescript
// In handlePriceRequest, after Binance failure:
import { recordTransientError, recordSuccessfulOperation } from '../services/transientErrors.js'
import { classifyBinanceError } from '../services/errors.js'
import { triggerAutoPause } from '../services/autoPause.js'

// On failure:
const classification = classifyBinanceError(result.error)
if (classification === 'transient') {
  const { shouldEscalate, count } = recordTransientError('binance')
  if (shouldEscalate) {
    triggerAutoPause(
      `Binance API failures (${count} in 60s)`,
      { source: 'binance', isTransientEscalation: true }
    )
  }
}

// On success:
recordSuccessfulOperation('binance')
```

**2. autoPause.ts - Scheduling Auto-Recovery:**

```typescript
// Modify triggerAutoPause signature:
import { scheduleAutoRecovery } from './autoRecovery.js'

export function triggerAutoPause(
  reason: string,
  context?: Record<string, unknown> & { isTransientEscalation?: boolean }
): void {
  // ... existing pause logic ...

  // Schedule auto-recovery if transient escalation
  if (context?.isTransientEscalation) {
    scheduleAutoRecovery(reason)
  }
}
```

**3. connection.ts - Success Recording:**

```typescript
// After successful reconnection:
import { recordSuccessfulOperation } from '../services/transientErrors.js'

// In reconnect success handler:
recordSuccessfulOperation('whatsapp')
```

### Testing Strategy

**Mock Setup:**

```typescript
// src/services/transientErrors.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  recordTransientError,
  clearTransientErrors,
  recordSuccessfulOperation,
  TRANSIENT_WINDOW_MS,
  TRANSIENT_ESCALATION_THRESHOLD,
  resetTransientErrorState,
} from './transientErrors.js'

describe('Transient Error Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetTransientErrorState()
  })

  describe('recordTransientError', () => {
    it('returns shouldEscalate: false for first error', () => {
      const result = recordTransientError('binance')
      expect(result.shouldEscalate).toBe(false)
      expect(result.count).toBe(1)
    })

    it('returns shouldEscalate: true at threshold (3 errors)', () => {
      recordTransientError('binance')
      recordTransientError('binance')
      const result = recordTransientError('binance')

      expect(result.shouldEscalate).toBe(true)
      expect(result.count).toBe(3)
    })

    it('filters out expired entries', () => {
      vi.useFakeTimers()

      recordTransientError('binance')
      vi.advanceTimersByTime(TRANSIENT_WINDOW_MS + 1000) // Past window

      const result = recordTransientError('binance')
      expect(result.count).toBe(1) // Old one filtered out
      expect(result.shouldEscalate).toBe(false)

      vi.useRealTimers()
    })

    it('tracks sources independently', () => {
      recordTransientError('binance')
      recordTransientError('binance')
      recordTransientError('whatsapp')

      // binance should have 2, whatsapp should have 1
      const binanceResult = recordTransientError('binance')
      expect(binanceResult.count).toBe(3)
      expect(binanceResult.shouldEscalate).toBe(true)
    })
  })
})
```

```typescript
// src/services/autoRecovery.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  scheduleAutoRecovery,
  cancelAutoRecovery,
  isRecoveryPending,
  AUTO_RECOVERY_DELAY_MS,
  resetAutoRecoveryState,
} from './autoRecovery.js'
import * as state from '../bot/state.js'
import * as binance from './binance.js'
import * as notifications from '../bot/notifications.js'

vi.mock('../bot/state.js')
vi.mock('./binance.js')
vi.mock('../bot/notifications.js')

describe('Auto-Recovery Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    resetAutoRecoveryState()
    vi.mocked(state.getOperationalStatus).mockReturnValue('paused')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('scheduleAutoRecovery', () => {
    it('schedules recovery attempt after delay', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: true, data: 5.82 })

      scheduleAutoRecovery('Test reason')

      expect(isRecoveryPending()).toBe(true)

      // Fast-forward to recovery time
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(binance.fetchPrice).toHaveBeenCalled()
      expect(state.setRunning).toHaveBeenCalled()
    })

    it('sends success notification on recovery', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: true, data: 5.82 })

      scheduleAutoRecovery('Binance failures')
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(notifications.queueControlNotification).toHaveBeenCalledWith(
        expect.stringContaining('✅ Auto-recovered')
      )
    })

    it('sends failure notification on failed recovery', async () => {
      vi.mocked(binance.fetchPrice).mockResolvedValue({ ok: false, error: 'Still failing' })

      scheduleAutoRecovery('Binance failures')
      await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

      expect(notifications.queueControlNotification).toHaveBeenCalledWith(
        expect.stringContaining('⚠️ Auto-recovery failed')
      )
      expect(state.setRunning).not.toHaveBeenCalled()
    })
  })

  describe('cancelAutoRecovery', () => {
    it('cancels pending recovery', () => {
      scheduleAutoRecovery('Test')
      expect(isRecoveryPending()).toBe(true)

      cancelAutoRecovery()

      expect(isRecoveryPending()).toBe(false)
    })
  })
})
```

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/transientErrors.ts` | Sliding window transient error tracking |
| `src/services/transientErrors.test.ts` | Unit tests for transient error tracking |
| `src/services/autoRecovery.ts` | Auto-recovery timer and orchestration |
| `src/services/autoRecovery.test.ts` | Unit tests for auto-recovery |

### Files to Modify

| File | Changes |
|------|---------|
| `src/services/autoPause.ts` | Add `isTransientEscalation` option, integrate with autoRecovery |
| `src/handlers/price.ts` | Integrate transient error recording and success tracking |
| `src/bot/connection.ts` | Integrate success tracking on reconnect |

### Learnings from Story 3.2

**Code Review Issues to Avoid:**
- ✅ Test all integration points explicitly (not just unit tests)
- ✅ Verify logging events are emitted correctly
- ✅ Document actual implementation vs design notes differences
- ✅ Include edge case tests (timer cancellation, multiple triggers)

**Testing Patterns:**
- Use `vi.useFakeTimers()` for time-based tests (5-minute delay)
- Use `vi.advanceTimersByTimeAsync()` for async timers
- Reset all mocks and state in `beforeEach`
- Test both positive and negative paths
- Verify notification messages match AC requirements exactly

### NFR Compliance

| NFR | Requirement | Implementation |
|-----|-------------|----------------|
| NFR3 | Recover <60s | Auto-recovery after 5min is for escalated errors; instant retry handles fast recovery |
| NFR4 | Notify within 30s | Control group notification on recovery success/failure |
| NFR13 | All API failures logged | transient_error_recorded, auto_recovery_attempting/succeeded/failed events |

### Dependencies from Previous Stories

| Component | Location | Usage |
|-----------|----------|-------|
| `triggerAutoPause` | src/services/autoPause.ts | Trigger pause on escalation |
| `setPaused`, `setRunning`, `getOperationalStatus` | src/bot/state.ts | State management |
| `queueControlNotification` | src/bot/notifications.ts | Notification queuing |
| `fetchPrice` | src/services/binance.ts | Health check for recovery |
| `classifyBinanceError` | src/services/errors.ts | Error classification |
| `recordFailure`, `recordSuccess` | src/services/errors.ts | Consecutive failure tracking |
| `ErrorSource` | src/services/errors.ts | Type for error sources |

### Relationship to Story 3.1 and 3.2

**Story 3.1 (Error Classification):**
- Provides `classifyBinanceError`, `classifyWhatsAppError` for determining transient vs critical
- Provides `ErrorSource` type used in transient error tracking

**Story 3.2 (Auto-Pause):**
- Provides `triggerAutoPause` that this story extends with auto-recovery scheduling
- Provides `setPaused`, `setRunning` state functions used in recovery

**Story 3.3 (This Story):**
- Adds sliding window transient error tracking (60s window, 3+ threshold)
- Adds auto-recovery timer (5-minute delay after escalated transient errors)
- Bridges transient classification → escalation → pause → recovery cycle

### Epic 4 Integration

This story prepares for Epic 4:
- **Story 4.2 (Resume Command):** Will call `cancelAutoRecovery()` when CIO manually resumes
- **Story 4.3 (Status Command):** Will use `isRecoveryPending()` to show recovery countdown
- **Story 4.4 (Notifications):** Will send the actual queued notifications

### Anti-Patterns to AVOID

- Do NOT use simple counter - must use sliding window with timestamp decay
- Do NOT schedule recovery for critical errors (loggedOut, banned) - only transient escalations
- Do NOT skip cancellation on manual intervention - recovery must be cancelled
- Do NOT throw from attemptRecovery - return boolean success/failure
- Do NOT forget to clear timer on successful recovery or cancellation
- Do NOT hardcode notification messages - use constants for consistency

### Edge Cases to Consider

1. **Multiple rapid transient errors**: Window correctly counts only recent errors
2. **Timer cancelled before firing**: Manual resume clears pending recovery
3. **Recovery attempt while already running**: Skip and return success
4. **Different sources escalate independently**: binance errors don't affect whatsapp threshold
5. **Success clears transient window**: Successful operation clears source-specific errors
6. **Recovery fails but bot was resumed**: Check operational status before attempting

### References

- [Source: docs/project-context.md#Non-Negotiables] - "Never sends wrong prices", "CIO stays in control"
- [Source: _bmad-output/planning-artifacts/architecture.md#Error Handling Pattern] - Result type
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3] - Acceptance criteria
- [Source: _bmad-output/implementation-artifacts/3-1-error-classification-tracking.md] - Error classification foundation
- [Source: _bmad-output/implementation-artifacts/3-2-auto-pause-on-critical-errors.md] - Auto-pause foundation
- [Source: src/services/errors.ts] - Error classification and tracking functions
- [Source: src/services/autoPause.ts] - Auto-pause service to extend
- [Source: src/bot/state.ts] - State management patterns

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None.

### Completion Notes List

1. **All 9 tasks completed** with full test coverage (308 tests passing)
2. **Transient error tracking** uses sliding window approach with 60-second decay
3. **Auto-recovery service** schedules recovery after 5-minute delay for escalated transient errors
4. **Handler integration** properly tracks success/failure and triggers escalation when threshold reached
5. **Test isolation** - Added mocks for error tracking services in price.test.ts to prevent auto-recovery timer from interfering with retry tests

### Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-01-16 | Created transientErrors.ts | Task 1-2: Sliding window transient error tracking |
| 2026-01-16 | Created autoRecovery.ts | Task 3-5: Auto-recovery timer and orchestration |
| 2026-01-16 | Modified autoPause.ts | Task 6: Added isTransientEscalation option |
| 2026-01-16 | Modified price.ts | Task 7-8: Added success/failure tracking |
| 2026-01-16 | Modified connection.ts | Task 7-8: Added success/failure tracking |
| 2026-01-16 | Modified price.test.ts | Task 9: Added mocks for error services |
| 2026-01-16 | Code Review Fix #1 | Updated Task 4.3 description to match Binance-only health check |
| 2026-01-16 | Code Review Fix #2 | Added recordSuccessfulOperation('binance') to recovery success path |
| 2026-01-16 | Code Review Fix #3 | Track scheduledAt for accurate getRecoveryTimeRemaining() |
| 2026-01-16 | Code Review Fix #4 | Clear lastPauseReason on recovery failure to prevent stale data |
| 2026-01-16 | Code Review Tests | Added 7 new tests for code review fixes (315 total passing)

### File List

| File | Action | Description |
|------|--------|-------------|
| `src/services/transientErrors.ts` | Created | Sliding window transient error tracking with recordTransientError, clearTransientErrors, recordSuccessfulOperation |
| `src/services/transientErrors.test.ts` | Created | 23 unit tests for transient error tracking |
| `src/services/autoRecovery.ts` | Created | Auto-recovery timer service with scheduleAutoRecovery, attemptRecovery, cancelAutoRecovery |
| `src/services/autoRecovery.test.ts` | Created | 26 unit tests for auto-recovery service |
| `src/services/autoPause.ts` | Modified | Added AutoPauseOptions interface with isTransientEscalation, integrated with scheduleAutoRecovery |
| `src/services/autoPause.test.ts` | Modified | Added 9 tests for auto-recovery integration |
| `src/handlers/price.ts` | Modified | Added transient error tracking and success tracking on first/retry success/failure paths |
| `src/handlers/price.test.ts` | Modified | Added mocks for errors.ts, transientErrors.ts, autoPause.ts to isolate handler tests |
| `src/bot/connection.ts` | Modified | Added transient error tracking on WhatsApp disconnects, recordSuccessfulOperation on reconnect |
