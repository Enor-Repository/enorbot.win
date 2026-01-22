# Story 1.3: Auto-Reconnect with State Tracking

Status: done

## Story

As a **CIO**,
I want **the bot to reconnect automatically after network issues**,
So that **temporary outages don't require manual intervention**.

## Acceptance Criteria

1. **AC1: Exponential Backoff Reconnection**
   - **Given** the bot is connected
   - **When** the WebSocket connection drops
   - **Then** the bot attempts reconnection with exponential backoff (1s, 2s, 4s, 8s, max 30s)

2. **AC2: Successful Reconnection Handling**
   - **Given** reconnection succeeds within 60 seconds
   - **When** the connection is restored
   - **Then** the bot logs "Reconnected" and continues normal operation
   - **And** the reconnect attempt counter resets to 0

3. **AC3: State Tracking on Disconnection**
   - **Given** the bot transitions to disconnected state
   - **When** the disconnection is detected
   - **Then** the internal state tracker updates to "disconnected"
   - **And** the disconnection timestamp is recorded
   - **And** the event is logged with timestamp

4. **AC4: Prolonged Disconnection Notification** *(Stub for Epic 4)*
   - **Given** disconnection persists beyond 30 seconds
   - **When** the state remains "disconnected"
   - **Then** a notification is queued for the control group (FR12)
   - **Note:** Actual notification sending is Epic 4 (Story 4.4), this story only queues

## Tasks / Subtasks

- [x] **Task 1: Enhance State Tracking** (AC: #3)
  - [x] 1.1 Add `disconnectedAt: Date | null` field to BotState in state.ts
  - [x] 1.2 Create `setDisconnectedAt(timestamp: Date | null)` function
  - [x] 1.3 Create `getDisconnectedDuration(): number | null` function (returns ms since disconnect)
  - [x] 1.4 Update `setConnectionStatus()` to set disconnectedAt when status becomes 'disconnected'
  - [x] 1.5 Reset `disconnectedAt` to null when status becomes 'connected'

- [x] **Task 2: Implement Exponential Backoff** (AC: #1, #2)
  - [x] 2.1 Create `src/utils/backoff.ts` with exponential backoff utility
  - [x] 2.2 Implement `calculateBackoff(attempt: number, maxDelay: number): number` function
  - [x] 2.3 Add jitter to prevent thundering herd (random +/- 10%)
  - [x] 2.4 Define constants: BASE_DELAY=1000, MAX_DELAY=30000

- [x] **Task 3: Update Connection Reconnection Logic** (AC: #1, #2, #3)
  - [x] 3.1 Replace fixed 5000ms timeout with exponential backoff calculation
  - [x] 3.2 Use `incrementReconnectAttempts()` return value for backoff calculation
  - [x] 3.3 Log reconnection attempts with delay value: `{ attempt, delayMs }`
  - [x] 3.4 Reset reconnect attempts on successful connection (already in state.ts)
  - [x] 3.5 Add "Reconnected" log message distinct from initial "Connected to WhatsApp"

- [x] **Task 4: Implement Notification Queue Stub** (AC: #4)
  - [x] 4.1 Create `src/bot/notifications.ts` with notification queue interface
  - [x] 4.2 Implement `queueControlNotification(message: string): void` (logs for now, sends in Epic 4)
  - [x] 4.3 Add disconnection duration check in connection.ts
  - [x] 4.4 If disconnectedDuration > 30000ms, call `queueControlNotification()`
  - [x] 4.5 Prevent duplicate notifications with `notificationSent` flag in state

- [ ] **Task 5: Test Reconnection Behavior** (AC: #1, #2, #3, #4) - *Manual verification*
  - [ ] 5.1 Verify exponential backoff timing: 1s, 2s, 4s, 8s, 16s, 30s, 30s...
  - [ ] 5.2 Verify state updates on disconnect (disconnectedAt populated)
  - [ ] 5.3 Verify state resets on reconnect (disconnectedAt null, attempts 0)
  - [ ] 5.4 Verify 30-second notification queue trigger (check logs)
  - [ ] 5.5 Verify "Reconnected" vs "Connected" log distinction

## Dev Notes

### Architecture Compliance

**CRITICAL - Follow These Patterns:**

1. **Result Type Pattern** - Not directly applicable here, but any new functions should follow if returning errors
   ```typescript
   type Result<T> = { ok: true; data: T } | { ok: false; error: string }
   ```

2. **Logger Pattern** - Use structured JSON logger for ALL output
   ```typescript
   logger.info('Reconnected to WhatsApp', { event: 'reconnected', attempt: 3, totalDowntimeMs: 15000 })
   logger.warn('Prolonged disconnection detected', { event: 'prolonged_disconnect', durationMs: 35000 })
   ```

3. **Naming Conventions:**
   - Files: camelCase.ts (`backoff.ts`, `notifications.ts`)
   - Functions: camelCase (`calculateBackoff`, `queueControlNotification`)
   - Types: PascalCase (`NotificationQueue`)
   - Constants: SCREAMING_SNAKE (`BASE_DELAY`, `MAX_DELAY`, `NOTIFICATION_THRESHOLD_MS`)

### Exponential Backoff Implementation

**Formula:** `delay = min(BASE_DELAY * 2^attempt, MAX_DELAY) * jitter`

**Reference Implementation:**
```typescript
// src/utils/backoff.ts
const BASE_DELAY = 1000    // 1 second
const MAX_DELAY = 30000    // 30 seconds
const JITTER_FACTOR = 0.1  // +/- 10%

export function calculateBackoff(attempt: number): number {
  // attempt 0 = 1s, attempt 1 = 2s, attempt 2 = 4s, etc.
  const exponentialDelay = Math.min(BASE_DELAY * Math.pow(2, attempt), MAX_DELAY)

  // Add jitter to prevent synchronized reconnections
  const jitterRange = exponentialDelay * JITTER_FACTOR
  const jitter = (Math.random() * 2 - 1) * jitterRange

  return Math.round(exponentialDelay + jitter)
}
```

**Expected Sequence (approximate):**
| Attempt | Base Delay | With Jitter |
|---------|------------|-------------|
| 0       | 1000ms     | 900-1100ms  |
| 1       | 2000ms     | 1800-2200ms |
| 2       | 4000ms     | 3600-4400ms |
| 3       | 8000ms     | 7200-8800ms |
| 4       | 16000ms    | 14400-17600ms |
| 5+      | 30000ms    | 27000-33000ms |

### State Tracking Enhancement

**Current state.ts structure:**
```typescript
interface BotState {
  connectionStatus: ConnectionStatus
  lastConnected: Date | null
  reconnectAttempts: number
}
```

**Required additions:**
```typescript
interface BotState {
  connectionStatus: ConnectionStatus
  lastConnected: Date | null
  reconnectAttempts: number
  disconnectedAt: Date | null           // NEW: When disconnect occurred
  notificationSent: boolean             // NEW: Prevent duplicate notifications
}
```

### Connection.ts Changes

**Current reconnection (line 73-74):**
```typescript
// Simple reconnect for now (exponential backoff in Story 1.3)
setTimeout(() => createConnection(config), 5000)
```

**Target implementation:**
```typescript
import { calculateBackoff } from '../utils/backoff.js'

// Check for prolonged disconnection notification
const disconnectedDuration = getDisconnectedDuration()
if (disconnectedDuration && disconnectedDuration > NOTIFICATION_THRESHOLD_MS) {
  if (!getState().notificationSent) {
    queueControlNotification(`Disconnected for ${Math.round(disconnectedDuration / 1000)}s. Reconnecting...`)
    setNotificationSent(true)
  }
}

// Exponential backoff reconnection
const delayMs = calculateBackoff(attempt - 1) // attempt is 1-indexed from increment
logger.info('Scheduling reconnection', {
  event: 'reconnect_scheduled',
  attempt,
  delayMs
})
setTimeout(() => createConnection(config), delayMs)
```

### Notification Queue Stub

**Purpose:** Prepare for Epic 4 (Story 4.4) notification sending without implementing full control group messaging.

**Implementation approach:**
```typescript
// src/bot/notifications.ts
import { logger } from '../utils/logger.js'

// Stub queue - notifications are logged for now, sent in Epic 4
const notificationQueue: string[] = []

export function queueControlNotification(message: string): void {
  notificationQueue.push(message)
  logger.warn('Control notification queued (sending in Epic 4)', {
    event: 'notification_queued',
    message,
    queueLength: notificationQueue.length,
  })
}

export function getQueuedNotifications(): string[] {
  return [...notificationQueue]
}

export function clearNotificationQueue(): void {
  notificationQueue.length = 0
}
```

### Constants to Define

```typescript
// Can be in backoff.ts or a central constants file
export const BASE_DELAY = 1000              // 1 second base
export const MAX_DELAY = 30000              // 30 second cap (NFR3)
export const NOTIFICATION_THRESHOLD_MS = 30000  // 30 seconds before notifying (NFR4)
export const MAX_RECONNECT_TIME_MS = 60000  // 60 second recovery window (NFR3)
```

### Learnings from Previous Stories

**From Story 1.1:**
- Use `@whiskeysockets/baileys` (not `@arceos/baileys`)
- Result pattern is established in `src/utils/result.ts`
- Structured logger is in `src/utils/logger.ts`
- `incrementReconnectAttempts()` already wired in connection.ts

**From Story 1.2:**
- Supabase auth state persistence is working
- `clearAuthState()` is called on logout
- Debounced save with retry logic implemented
- Build compiles with `npm run build`

**Current connection.ts state:**
- Uses fixed 5000ms reconnect delay (line 74)
- Tracks attempts via `incrementReconnectAttempts()`
- Distinguishes logged out vs other disconnections
- Already logs disconnect reason

### Files to Create

| File | Purpose |
|------|---------|
| `src/utils/backoff.ts` | Exponential backoff calculation |
| `src/bot/notifications.ts` | Notification queue stub |

### Files to Modify

| File | Changes |
|------|---------|
| `src/bot/state.ts` | Add disconnectedAt, notificationSent fields |
| `src/bot/connection.ts` | Replace fixed delay with backoff, add notification check |

### Anti-Patterns to AVOID

- Do NOT use fixed delay (already exists, must replace)
- Do NOT send notifications directly (Epic 4 handles this)
- Do NOT reset reconnect attempts before successful connection
- Do NOT log with console.log (use logger)
- Do NOT implement full control group messaging (out of scope)

### Testing Notes

**Manual Verification Steps:**

1. **Test Exponential Backoff:**
   ```bash
   # Start bot, let it connect
   npm run dev
   # Disconnect network/VPN
   # Watch logs for increasing delays: 1s, 2s, 4s, 8s, 16s, 30s, 30s...
   # Restore network
   # Should see "Reconnected" log
   ```

2. **Test State Updates:**
   ```typescript
   // Add temporary debug log in connection.ts:
   console.log('State:', getState())
   // Verify disconnectedAt is populated on disconnect
   // Verify disconnectedAt is null on reconnect
   ```

3. **Test 30-Second Notification:**
   ```bash
   # Disconnect network for >30 seconds
   # Watch for "notification_queued" log
   # Verify only one notification queued (no duplicates)
   ```

### NFR Compliance Checklist

| NFR | Requirement | Implementation |
|-----|-------------|----------------|
| NFR3 | Auto-recover within 60 seconds | Exponential backoff caps at 30s, allows multiple attempts |
| NFR4 | Notify within 30 seconds of disconnect | Notification queued after 30s threshold |
| NFR5 | PM2 auto-restart on crash | Not affected by this story |

### References

- [Source: docs/project-context.md#Technical Context] - NFR3, NFR4 requirements
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3] - Acceptance criteria
- [Source: 1-1-project-setup-basic-connection.md#Dev Agent Record] - incrementReconnectAttempts usage
- [Source: 1-2-session-persistence-in-supabase.md#Dev Agent Record] - Current connection.ts state

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None required - implementation straightforward.

### Completion Notes List

1. **State Tracking Enhancement**: Added `disconnectedAt` and `notificationSent` fields to BotState. The `setConnectionStatus()` function now automatically manages these fields on status transitions.

2. **Exponential Backoff**: Implemented with jitter (+/- 10%) to prevent thundering herd. Constants exported for reuse: `BASE_DELAY`, `MAX_DELAY`, `NOTIFICATION_THRESHOLD_MS`, `MAX_RECONNECT_TIME_MS`.

3. **Reconnection Logic**: Replaced fixed 5000ms delay with exponential backoff. Added prolonged disconnection check (>30s triggers notification queue). Distinguished "Reconnected" vs "Connected to WhatsApp" log messages.

4. **Notification Stub**: Created queue-based stub for Epic 4. Notifications are logged with `event: 'notification_queued'` for now. Actual sending will be implemented in Story 4.4.

### File List

| File | Action | Description |
|------|--------|-------------|
| `src/bot/state.ts` | Modified | Added disconnectedAt, notificationSent fields; updated setConnectionStatus(); added helper functions |
| `src/utils/backoff.ts` | Created | Exponential backoff utility with jitter and constants |
| `src/bot/notifications.ts` | Created | Notification queue stub for control group notifications |
| `src/bot/connection.ts` | Modified | Replaced fixed delay with exponential backoff; added notification check; added reconnection logging |

### Change Log

| Date | Change |
|------|--------|
| 2026-01-15 | Initial implementation of Story 1.3 - all code tasks complete, pending manual verification |
| 2026-01-15 | Code review fixes: Fixed AC4-breaking bug (disconnectedAt reset), added max reconnect time check (60s), auto-clear notification queue, removed dead code, improved logging |

