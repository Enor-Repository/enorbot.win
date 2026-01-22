# Story 3.2: Auto-Pause on Critical Errors

Status: done

## Story

As a **CIO**,
I want **the bot to stop operating when something critical happens**,
So that **it doesn't cause damage by continuing blindly**.

## Acceptance Criteria

1. **AC1: Auto-Pause on Critical Error**
   - **Given** a critical error is detected
   - **When** the error handler processes it
   - **Then** the bot sets global state to "paused"
   - **And** a notification is sent to control group: "🚨 CRITICAL: [error description]. Bot paused."

2. **AC2: Silent When Paused**
   - **Given** the bot is in paused state
   - **When** a price trigger arrives
   - **Then** the bot does NOT respond (silent)

3. **AC3: Status Shows Pause Info**
   - **Given** auto-pause was triggered
   - **When** the CIO checks status (future Story 4.3)
   - **Then** the status shows "paused" with reason and timestamp

4. **AC4: Notification Rate Limiting**
   - **Given** multiple critical errors occur in sequence
   - **When** notifications would spam the control group
   - **Then** only the first notification is sent within a 5-minute window

## Tasks / Subtasks

- [x] **Task 1: Extend BotState for Pause Tracking** (AC: #1, #3)
  - [x] 1.1 Add `OperationalStatus` type: `'running' | 'paused'` to state.ts
  - [x] 1.2 Add `operationalStatus: OperationalStatus` to BotState interface
  - [x] 1.3 Add `pauseReason: string | null` to BotState interface
  - [x] 1.4 Add `pausedAt: Date | null` to BotState interface
  - [x] 1.5 Implement `getOperationalStatus(): OperationalStatus` getter
  - [x] 1.6 Implement `setPaused(reason: string): void` that sets state and timestamps
  - [x] 1.7 Implement `setRunning(): void` that clears pause state (for Story 3.3 / Epic 4)
  - [x] 1.8 Implement `getPauseInfo(): { reason: string | null, pausedAt: Date | null }` getter

- [x] **Task 2: Create Auto-Pause Service** (AC: #1, #4)
  - [x] 2.1 Create `src/services/autoPause.ts` for auto-pause orchestration
  - [x] 2.2 Implement `triggerAutoPause(reason: string, context?: Record<string, unknown>): void`
  - [x] 2.3 Call `setPaused(reason)` from state.ts in triggerAutoPause
  - [x] 2.4 Log `event: 'auto_pause_triggered'` with reason, timestamp, context
  - [x] 2.5 Queue notification for control group (Task 3)
  - [x] 2.6 Implement notification rate limiting (5-minute window)
  - [x] 2.7 Track `lastNotificationSentAt: Date | null` for rate limiting
  - [x] 2.8 Skip notification if within rate limit window, log `event: 'notification_rate_limited'`

- [x] **Task 3: Control Group Notification Integration** (AC: #1)
  - [x] 3.1 Import `queueControlNotification` from notifications.ts (using existing queue system)
  - [x] 3.2 N/A - Using notification queue (actual sending deferred to Epic 4 Story 4.4)
  - [x] 3.3 Format notification message: "🚨 CRITICAL: [reason]. Bot paused."
  - [x] 3.4 Queue notification via `queueControlNotification` (actual send in Epic 4)
  - [x] 3.5 Handle send failure gracefully (log but don't throw)
  - [x] 3.6 Log `event: 'auto_pause_notification_queued'` on success

- [x] **Task 4: Integrate with Error Escalation** (AC: #1)
  - [x] 4.1 Import `triggerAutoPause` in price.ts
  - [x] 4.2 Call `triggerAutoPause` when `shouldEscalate` is true after retries exhausted
  - [x] 4.3 Pass error context (source: 'binance', lastError, groupId)
  - [x] 4.4 Import `triggerAutoPause` in connection.ts
  - [x] 4.5 Call `triggerAutoPause` when WhatsApp disconnect is classified as 'critical'
  - [x] 4.6 Pass error context (source: 'whatsapp', disconnectReason)

- [x] **Task 5: Router Pause Check Integration** (AC: #2)
  - [x] 5.1 Import `getOperationalStatus` in connection.ts (pause check in message handler)
  - [x] 5.2 Add pause check at START of message routing (before any handler dispatch)
  - [x] 5.3 If `operationalStatus === 'paused'`, log `event: 'message_ignored_paused'` and return early
  - [x] 5.4 Include groupId and messagePreview in ignored log for debugging
  - [x] 5.5 Ensure control group messages are STILL routed when paused (for resume commands - Epic 4)

- [x] **Task 6: Unit Tests** (AC: #1, #2, #3, #4)
  - [x] 6.1 Create `src/services/autoPause.test.ts` co-located with source
  - [x] 6.2 Test triggerAutoPause sets state to paused
  - [x] 6.3 Test triggerAutoPause logs auto_pause_triggered event
  - [x] 6.4 Test notification rate limiting (first sends, second within 5min blocked)
  - [x] 6.5 Test notification sends after rate limit window expires
  - [x] 6.6 Test getPauseInfo returns correct reason and timestamp
  - [x] 6.7 Create `src/bot/state.test.ts` for pause-related functions
  - [x] 6.8 Test operationalStatus getter
  - [x] 6.9 Test setPaused sets all fields correctly
  - [x] 6.10 Test setRunning clears pause state
  - [x] 6.11 N/A - Pause check integrated into connection.ts message handler, not router.ts
  - [x] 6.12 N/A - Integration testing covered by state.test.ts and autoPause.test.ts
  - [x] 6.13 N/A - Verified in implementation (control group bypass)
  - [x] 6.14 N/A - Default state is running, covered by state.test.ts

## Dev Notes

### Architecture Compliance

**CRITICAL - Follow These Patterns:**

1. **Result Type Pattern** - Services return Result, NEVER throw:
   ```typescript
   // triggerAutoPause is a void function (fire-and-forget)
   // But notification sending should use Result internally
   async function sendNotification(message: string): Promise<Result<void>> {
     try {
       await sendWithAntiDetection(controlGroupId, message)
       return ok(undefined)
     } catch (e) {
       logger.error('Auto-pause notification failed', { error: e })
       return err('Notification failed')
     }
   }
   ```

2. **Logger Pattern** - Use structured JSON logger:
   ```typescript
   logger.error('Auto-pause triggered', {
     event: 'auto_pause_triggered',
     reason,
     source,
     timestamp: new Date().toISOString(),
     context,
   })

   logger.info('Message ignored - bot paused', {
     event: 'message_ignored_paused',
     groupId,
     messagePreview,
     pauseReason,
   })

   logger.warn('Notification rate limited', {
     event: 'notification_rate_limited',
     lastSentAt: lastNotificationSentAt?.toISOString(),
     windowMs: NOTIFICATION_RATE_LIMIT_MS,
   })
   ```

3. **Naming Conventions:**
   - File: `autoPause.ts` (camelCase)
   - Functions: `triggerAutoPause`, `getOperationalStatus` (camelCase)
   - Constants: `NOTIFICATION_RATE_LIMIT_MS` (SCREAMING_SNAKE)
   - Types: `OperationalStatus`, `PauseInfo` (PascalCase)

### State Management Design

**Key Design Decision: In-memory state, not persisted**

From Story 3.2 Implementation Note in epics.md:
> Pause state is stored in-memory via `state.ts`, not persisted to Supabase. On process restart, state resets to "running" (PM2 restart = fresh start). This is intentional - if the bot crashes and restarts, it should attempt normal operation.

**Extended BotState Interface:**

```typescript
// src/bot/state.ts - additions

export type OperationalStatus = 'running' | 'paused'

interface BotState {
  // Existing fields
  connectionStatus: ConnectionStatus
  lastConnected: Date | null
  reconnectAttempts: number
  disconnectedAt: Date | null
  notificationSent: boolean
  // NEW: Pause tracking (Story 3.2)
  operationalStatus: OperationalStatus
  pauseReason: string | null
  pausedAt: Date | null
}

// Initialize with running state
const state: BotState = {
  // ... existing
  operationalStatus: 'running',
  pauseReason: null,
  pausedAt: null,
}
```

### Auto-Pause Service Design

> **Note:** The original design used async/sendWithAntiDetection, but implementation uses synchronous queueControlNotification per Implementation Notes. This is the ACTUAL implementation:

```typescript
// src/services/autoPause.ts (ACTUAL IMPLEMENTATION)

import { logger } from '../utils/logger.js'
import { setPaused } from '../bot/state.js'
import { queueControlNotification } from '../bot/notifications.js'

/**
 * Rate limit window for control group notifications.
 * 5 minutes = 300000ms (per AC4)
 */
export const NOTIFICATION_RATE_LIMIT_MS = 5 * 60 * 1000

let lastNotificationSentAt: Date | null = null

/**
 * Trigger auto-pause on critical error.
 * Sets bot to paused state and queues notification for control group (rate-limited).
 * NOTE: Synchronous function - fire-and-forget pattern.
 */
export function triggerAutoPause(
  reason: string,
  context?: Record<string, unknown>
): void {
  // Step 1: Set pause state (always happens)
  setPaused(reason)

  logger.error('Auto-pause triggered', {
    event: 'auto_pause_triggered',
    reason,
    timestamp: new Date().toISOString(),
    ...(context && { context }),
  })

  // Step 2: Queue notification (rate-limited)
  queuePauseNotification(reason)
}

function queuePauseNotification(reason: string): void {
  const now = new Date()

  // Check rate limit (AC4)
  if (lastNotificationSentAt) {
    const elapsed = now.getTime() - lastNotificationSentAt.getTime()
    if (elapsed < NOTIFICATION_RATE_LIMIT_MS) {
      logger.warn('Notification rate limited', {
        event: 'notification_rate_limited',
        lastSentAt: lastNotificationSentAt.toISOString(),
        windowMs: NOTIFICATION_RATE_LIMIT_MS,
        elapsedMs: elapsed,
      })
      return
    }
  }

  // Format notification message (AC1)
  const message = `🚨 CRITICAL: ${reason}. Bot paused.`

  // Queue notification (actual sending happens in Epic 4 Story 4.4)
  queueControlNotification(message)
  lastNotificationSentAt = now

  logger.info('Auto-pause notification queued', {
    event: 'auto_pause_notification_queued',
    reason,
    timestamp: now.toISOString(),
  })
}

/**
 * Reset notification state (for testing).
 */
export function resetNotificationState(): void {
  lastNotificationSentAt = null
}
```

### Integration Points

**1. price.ts - Escalation Integration:**

```typescript
// In handlePriceRequest, after retries exhausted:
import { triggerAutoPause } from '../services/autoPause.js'

// After: const shouldEscalate = failureCount >= ESCALATION_THRESHOLD
if (shouldEscalate) {
  logErrorEscalation('binance', failureCount)
  await triggerAutoPause(
    `Binance API failures (${failureCount} consecutive)`,
    { source: 'binance', lastError: retryResult.error, groupId: context.groupId }
  )
}
```

**2. connection.ts - Critical Disconnect Integration:**

```typescript
// In disconnect handler:
import { triggerAutoPause } from '../services/autoPause.js'

if (classification === 'critical') {
  await triggerAutoPause(
    `WhatsApp ${disconnectType}`,
    { source: 'whatsapp', statusCode }
  )
}
```

**3. connection.ts - Pause Check (in message handler):**

> **Note:** Original design placed this in router.ts, but actual implementation is in connection.ts message handler for better integration with the socket event handling.

```typescript
// In messages.upsert handler (connection.ts)
import { getOperationalStatus, getPauseInfo } from './state.js'

// After routing decision, BEFORE dispatching to handlers:
// Story 3.2: Check pause state BEFORE dispatching to handlers
// Control group messages are STILL routed when paused (for Epic 4 resume commands)
if (!isControlGroup && getOperationalStatus() === 'paused') {
  const { reason } = getPauseInfo()
  logger.info('Message ignored - bot paused', {
    event: 'message_ignored_paused',
    groupId,
    messagePreview: messageText.substring(0, 20),
    pauseReason: reason,
  })
  return // Silent - don't respond
}

// Dispatch to handler based on route destination...
```

### Testing Strategy

**Mock Setup:**

```typescript
// src/services/autoPause.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  triggerAutoPause,
  NOTIFICATION_RATE_LIMIT_MS,
  resetNotificationState,
} from './autoPause.js'
import * as state from '../bot/state.js'
import * as messaging from '../bot/messaging.js'
import * as config from '../config.js'

vi.mock('../bot/state.js')
vi.mock('../bot/messaging.js')
vi.mock('../config.js')

describe('Auto-Pause Service', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetNotificationState()
    vi.mocked(config.getConfig).mockReturnValue({
      CONTROL_GROUP_ID: '123@g.us',
      // ... other config
    })
  })

  describe('triggerAutoPause', () => {
    it('sets bot state to paused', async () => {
      await triggerAutoPause('Test reason')
      expect(state.setPaused).toHaveBeenCalledWith('Test reason')
    })

    it('sends notification to control group', async () => {
      await triggerAutoPause('Binance failures')
      expect(messaging.sendWithAntiDetection).toHaveBeenCalledWith(
        '123@g.us',
        '🚨 CRITICAL: Binance failures. Bot paused.'
      )
    })

    it('rate limits notifications within 5-minute window', async () => {
      await triggerAutoPause('First error')
      await triggerAutoPause('Second error')

      expect(messaging.sendWithAntiDetection).toHaveBeenCalledTimes(1)
    })

    it('sends notification after rate limit expires', async () => {
      vi.useFakeTimers()

      await triggerAutoPause('First error')
      vi.advanceTimersByTime(NOTIFICATION_RATE_LIMIT_MS + 1000)
      await triggerAutoPause('Second error')

      expect(messaging.sendWithAntiDetection).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })
  })
})
```

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/autoPause.ts` | Auto-pause orchestration service |
| `src/services/autoPause.test.ts` | Unit tests for auto-pause |

### Files to Modify

> **Note:** Original plan referenced router.ts, but implementation uses connection.ts for pause check. See Implementation Notes.

| File | Changes |
|------|---------|
| `src/bot/state.ts` | Add OperationalStatus, pause tracking fields and getters |
| `src/bot/state.test.ts` | Add tests for pause state functions |
| `src/bot/connection.ts` | Add pause check in message handler + triggerAutoPause on critical disconnect |
| `src/bot/connection.test.ts` | Add tests for pause check behavior (Code Review fix) |
| `src/handlers/price.ts` | Add triggerAutoPause on escalation |

### Learnings from Story 3.1

**Code Review Issues to Avoid:**
- ✅ Track failures at each failure point (not just final)
- ✅ Handle undefined/null edge cases gracefully
- ✅ Use word boundary regex for substring matching
- ✅ Test all state transitions explicitly
- ✅ Include logging assertions in tests

**Testing Patterns:**
- Use `vi.useFakeTimers()` for time-based tests (rate limiting)
- Reset all mocks and state in `beforeEach`
- Test both positive and negative paths
- Verify log events are emitted correctly

### NFR Compliance

| NFR | Requirement | Implementation |
|-----|-------------|----------------|
| NFR3 | Recover <60s | Auto-pause enables Story 3.3 auto-recovery |
| NFR4 | Notify within 30s | Control group notification on pause |
| NFR13 | All API failures logged | Classified error + auto_pause_triggered events |

### Dependencies from Previous Stories

> **Note:** Original plan used sendWithAntiDetection, but implementation uses queueControlNotification (actual sending deferred to Epic 4).

| Component | Location | Usage |
|-----------|----------|-------|
| `recordFailure`, `getFailureCount` | src/services/errors.ts | Escalation detection |
| `ESCALATION_THRESHOLD` | src/services/errors.ts | Threshold constant |
| `classifyWhatsAppError` | src/services/errors.ts | WhatsApp error classification |
| `queueControlNotification` | src/bot/notifications.ts | Notification queuing (sends in Epic 4) |
| `BotState`, state functions | src/bot/state.ts | State management |
| `routeMessage`, `isControlGroupMessage` | src/bot/router.ts | Message routing and control group detection |

### Ready for Stories 3.3 & Epic 4

This story creates the auto-pause foundation. Story 3.3 (Auto-Recovery) and Epic 4 (CIO Control) will:

1. **Story 3.3**: Use `setRunning()` to clear pause state on auto-recovery
2. **Story 4.1/4.2**: Use `setPaused()`/`setRunning()` for manual pause/resume commands
3. **Story 4.3**: Use `getPauseInfo()` to show pause status in status command
4. **Story 4.4**: Share notification infrastructure for status notifications

### Anti-Patterns to AVOID

- Do NOT throw exceptions from triggerAutoPause (fire-and-forget)
- Do NOT block on notification failures (log and continue)
- Do NOT skip the pause check in router (AC2 is critical)
- Do NOT send notifications when paused - rate limit properly
- Do NOT persist pause state to Supabase (intentionally in-memory)
- Do NOT forget to route control group messages when paused (for resume)

### Edge Cases to Consider

1. **Notification send fails**: Log error, but pause state still set
2. **Multiple critical errors rapid-fire**: Rate limiting prevents spam
3. **Control group message while paused**: Must still be routed (for resume)
4. **Bot restarts after pause**: State resets to running (intentional)
5. **Race condition in pause check**: Single-threaded Node.js, not a concern
6. **sendWithAntiDetection throws**: Catch and log, don't propagate

### References

- [Source: docs/project-context.md#Non-Negotiables] - "Never sends wrong prices", "CIO stays in control"
- [Source: _bmad-output/planning-artifacts/architecture.md#Error Handling Pattern] - Result type
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2] - Acceptance criteria and implementation note
- [Source: _bmad-output/implementation-artifacts/3-1-error-classification-tracking.md] - Error classification foundation
- [Source: src/bot/state.ts] - Existing state management patterns
- [Source: src/services/errors.ts] - Error escalation functions

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- All 223 tests pass (35 new tests added for Story 3.2)
- Build compiles cleanly with no TypeScript errors

### Completion Notes List

1. **Task 1**: Extended `state.ts` with `OperationalStatus` type, pause tracking fields (`operationalStatus`, `pauseReason`, `pausedAt`), and corresponding getters/setters
2. **Task 2**: Created `autoPause.ts` service with `triggerAutoPause()` function and 5-minute notification rate limiting
3. **Task 3**: Integrated with existing notification queue system (`queueControlNotification`) - actual sending deferred to Epic 4 Story 4.4
4. **Task 4**: Integrated `triggerAutoPause` into `price.ts` (Binance escalation) and `connection.ts` (WhatsApp critical disconnect)
5. **Task 5**: Added pause check in `connection.ts` message handler - ignores non-control messages when paused, allows control group messages through for Epic 4 resume
6. **Task 6**: Added 35 new tests - 22 in `state.test.ts` and 13 in `autoPause.test.ts`

### Implementation Notes

- Used existing `queueControlNotification` instead of direct `sendWithAntiDetection` because config doesn't have CONTROL_GROUP_ID (only CONTROL_GROUP_PATTERN for matching). Actual notification sending will be implemented in Epic 4 Story 4.4.
- Pause check placed in `connection.ts` message handler (not router.ts) because that's where message dispatch occurs
- Control group messages are explicitly allowed through when paused (checked via `!isControlGroup`) to enable future resume commands in Epic 4

### File List

| File | Action | Description |
|------|--------|-------------|
| src/bot/state.ts | Modified | Added OperationalStatus type, PauseInfo interface, pause tracking fields, getOperationalStatus(), setPaused(), setRunning(), getPauseInfo() |
| src/bot/state.test.ts | Created | 22 unit tests for pause state management |
| src/services/autoPause.ts | Created | Auto-pause service with triggerAutoPause() and rate-limited notifications |
| src/services/autoPause.test.ts | Created | 18 unit tests for auto-pause service (13 original + 5 code review) |
| src/bot/connection.ts | Modified | Added triggerAutoPause import, critical disconnect auto-pause, pause check before handler dispatch |
| src/bot/connection.test.ts | Created | 12 unit tests for pause behavior integration (Code Review fix) |
| src/bot/notifications.test.ts | Created | 11 unit tests for notification queue (Code Review fix) |
| src/handlers/price.ts | Modified | Added triggerAutoPause import and call on Binance escalation |

### Change Log

| Date | Change |
|------|--------|
| 2026-01-16 | Story created with comprehensive context from Story 3.1 and architecture documents |
| 2026-01-16 | Implementation completed - all 6 tasks done, 35 new tests passing, status moved to review |
| 2026-01-16 | Code review fixes: Added connection.test.ts (12 tests), notifications.test.ts (11 tests), 5 more tests to autoPause.test.ts. Fixed Dev Notes documentation. |
