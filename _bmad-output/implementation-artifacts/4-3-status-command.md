# Story 4.3: Status Command

Status: done

## Story

As a **CIO**,
I want **to check the bot's current status and activity**,
So that **I know it's working without checking each group**.

## Acceptance Criteria

1. **AC1: Status summary**
   - Given Daniel sends "status" in the control group
   - When the control handler processes the message
   - Then the bot responds with a status summary including:
     - Connection state (connected/disconnected)
     - Uptime since last restart
     - Messages sent today (count)
     - Active/paused groups list
     - Last activity timestamp
     - Error state (if any)

2. **AC2: Activity metrics**
   - Given the bot has sent 47 messages today across 3 groups
   - When Daniel checks status
   - Then the response shows: "📊 47 quotes today | 3 groups active | Last: 2min ago"

3. **AC3: Paused state display**
   - Given the bot is paused (manually or auto)
   - When Daniel checks status
   - Then the response clearly shows: "⏸️ PAUSED: [reason]"

4. **AC4: Normal state display**
   - Given there are no recent errors
   - When Daniel checks status
   - Then the response shows: "✅ All systems normal"

## Tasks / Subtasks

- [x] Task 1: Add activity tracking to state.ts (AC: 1, 2)
  - [x] 1.1: Add `messagesSentToday: number` counter
  - [x] 1.2: Add `lastActivityAt: Date | null` timestamp
  - [x] 1.3: Add `startedAt: Date` for uptime calculation
  - [x] 1.4: Create `recordMessageSent(groupId: string)` function
  - [x] 1.5: Create `getActivityStats()` function returning all metrics
  - [x] 1.6: Create `resetDailyStats()` for midnight reset (or process restart)
  - [x] 1.7: Add tests for activity tracking

- [x] Task 2: Implement status command in control.ts (AC: 1, 3, 4)
  - [x] 2.1: Extend `parseControlCommand()` with "status" detection
  - [x] 2.2: Create `buildStatusMessage()` helper function
  - [x] 2.3: Gather all state: connection, operational, pause info
  - [x] 2.4: Gather recovery info: `isRecoveryPending()`, `getRecoveryTimeRemaining()`
  - [x] 2.5: Format human-readable response
  - [x] 2.6: Add tests for status message building

- [x] Task 3: Integrate activity recording (AC: 2)
  - [x] 3.1: Call `recordMessageSent()` after successful price response
  - [x] 3.2: Increment counter on each sendWithAntiDetection call
  - [x] 3.3: Update lastActivityAt timestamp
  - [x] 3.4: Add tests for activity recording integration

- [x] Task 4: Status response formatting (AC: 1, 2, 3, 4)
  - [x] 4.1: Format uptime as human-readable (e.g., "2h 15m")
  - [x] 4.2: Format last activity as relative time (e.g., "2min ago")
  - [x] 4.3: Format recovery time remaining if pending
  - [x] 4.4: Add tests for all formatting functions

## Dev Notes

### Status Response Format

Multi-line response for comprehensive status:

```
📊 eNorBOT Status

Connection: 🟢 Connected
Uptime: 4h 32m
Status: ✅ All systems normal

📈 Today's Activity
• 47 quotes sent
• 3 groups active
• Last activity: 2min ago

📂 Groups
• Binance VIP - Active
• Crypto OTC - Active
• Private Deals - ⏸️ Paused
```

### Paused State Response

```
📊 eNorBOT Status

Connection: 🟢 Connected
Uptime: 4h 32m
Status: ⏸️ PAUSED: Binance API failures (3 consecutive)

⏱️ Auto-recovery in 3m 42s

📈 Today's Activity
• 42 quotes sent (before pause)
• Last activity: 8min ago
```

### State Gathering

```typescript
import { getConnectionStatus, getOperationalStatus, getPauseInfo, getPausedGroups } from '../bot/state.js'
import { isRecoveryPending, getRecoveryTimeRemaining, getPendingRecoveryReason } from '../services/autoRecovery.js'

interface StatusInfo {
  // Connection
  connectionStatus: ConnectionStatus
  uptime: number  // milliseconds

  // Operational
  operationalStatus: OperationalStatus
  pauseReason: string | null
  pausedAt: Date | null

  // Recovery
  recoveryPending: boolean
  recoveryTimeRemaining: number | null  // milliseconds
  recoveryReason: string | null

  // Activity
  messagesSentToday: number
  lastActivityAt: Date | null
  activeGroupCount: number
  pausedGroupCount: number

  // Groups
  pausedGroups: string[]  // Group names (not IDs)
}

function gatherStatus(): StatusInfo {
  const state = getState()
  return {
    connectionStatus: state.connectionStatus,
    uptime: state.startedAt ? Date.now() - state.startedAt.getTime() : 0,
    operationalStatus: state.operationalStatus,
    pauseReason: state.pauseReason,
    pausedAt: state.pausedAt,
    recoveryPending: isRecoveryPending(),
    recoveryTimeRemaining: getRecoveryTimeRemaining(),
    recoveryReason: getPendingRecoveryReason(),
    messagesSentToday: state.messagesSentToday,
    lastActivityAt: state.lastActivityAt,
    activeGroupCount: knownGroups.size - state.pausedGroups.size,
    pausedGroupCount: state.pausedGroups.size,
    pausedGroups: getPausedGroupNames(),
  }
}
```

### Time Formatting Utilities

```typescript
/**
 * Format milliseconds as human-readable duration.
 * e.g., 9000000 → "2h 30m"
 */
function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000))
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000))

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

/**
 * Format timestamp as relative time.
 * e.g., 2 minutes ago → "2min ago"
 */
function formatRelativeTime(date: Date | null): string {
  if (!date) return 'Never'

  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / (60 * 1000))

  if (diffMin < 1) return 'Just now'
  if (diffMin === 1) return '1min ago'
  if (diffMin < 60) return `${diffMin}min ago`

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours === 1) return '1h ago'
  return `${diffHours}h ago`
}
```

### Activity Recording Integration

Add call in price.ts after successful response:

```typescript
// In handlePriceMessage, after sendWithAntiDetection succeeds
import { recordMessageSent } from '../bot/state.js'

// After successful send
recordMessageSent(context.groupId)
```

### Testing Strategy

1. **Unit tests for state.ts activity tracking:**
   - `recordMessageSent()` increments counter
   - `getActivityStats()` returns correct values
   - Multiple groups tracked correctly

2. **Unit tests for status message building:**
   - All sections present
   - Correct formatting for various states
   - Recovery info shown when pending

3. **Unit tests for time formatting:**
   - formatDuration edge cases
   - formatRelativeTime edge cases

4. **Integration tests:**
   - Status command returns complete message
   - Different states produce different outputs

### Project Structure Notes

Files to modify:
- `src/bot/state.ts` - Add activity tracking
- `src/handlers/control.ts` - Add status command
- `src/handlers/price.ts` - Add recordMessageSent call

New utility functions can go in control.ts or a new `src/utils/format.ts` if needed.

### References

- [Source: src/services/autoRecovery.ts] - `isRecoveryPending()`, `getRecoveryTimeRemaining()`
- [Source: src/bot/state.ts] - Existing state functions
- [Source: docs/project-context.md#Logging Assertion Patterns] - Event logging

### Dependencies

- **From Story 4.1:** `getPausedGroups()`, known groups mapping
- **From Story 4.2:** Recovery state functions
- **From Story 3.3:** `isRecoveryPending()`, `getRecoveryTimeRemaining()`

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-sonnet-4-20250514)

### Completion Notes List

- **Task 1:** Added activity tracking to `state.ts`:
  - `messagesSentToday`, `lastActivityAt`, `startedAt` fields
  - `recordMessageSent()`, `getActivityStats()`, `resetDailyStats()`, `resetActivityState()` functions
  - `ActivityStats` interface for type safety
  - 14 comprehensive tests for activity tracking

- **Task 2:** Implemented status command in `control.ts`:
  - `buildStatusMessage()` builds comprehensive multi-line status with all sections
  - Gathers: connection status, operational status, pause info, recovery info, activity stats
  - Shows paused groups with human-readable names
  - `handleStatusCommand()` sends status via `sendWithAntiDetection()`
  - 11 tests for status message building

- **Task 3:** Integrated activity recording in `price.ts`:
  - Calls `recordMessageSent(context.groupId)` after successful price response
  - Also records for recovery success path
  - Mocked in price.test.ts to isolate tests

- **Task 4:** Added time formatting utilities to `format.ts`:
  - `formatDuration(ms)` - formats milliseconds as "2h 30m" or "45m"
  - `formatRelativeTime(date)` - formats as "2min ago", "1h ago", "Never", "Just now"
  - 17 tests for time formatting edge cases

### File List

- `src/bot/state.ts` - Extended with activity tracking (ActivityStats, recordMessageSent, etc.)
- `src/bot/state.test.ts` - 62 tests (added Story 4.3 activity tracking tests)
- `src/handlers/control.ts` - buildStatusMessage, handleStatusCommand
- `src/handlers/control.test.ts` - 51 tests (added Story 4.3 status tests)
- `src/handlers/price.ts` - Added recordMessageSent calls
- `src/handlers/price.test.ts` - Added state mock
- `src/utils/format.ts` - Added formatDuration, formatRelativeTime
- `src/utils/format.test.ts` - 36 tests (added time formatting tests)

## Senior Developer Review (AI)

### Review Date: 2026-01-16
### Reviewer: Claude Opus 4.5 (Code Review Workflow)

**Issues Fixed:**
1. **MEDIUM-5**: Enhanced `formatDuration()` to show seconds for durations under 1 minute instead of "0m"
2. Updated tests: "0m" → "0s", added tests for 30s and 59s edge cases

**Verification:** All 438 tests passing after fixes.
