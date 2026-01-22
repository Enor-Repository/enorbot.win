# Story 4.4: Status Notifications

Status: done

## Story

As a **CIO**,
I want **to receive automatic notifications about bot state changes**,
So that **I'm informed without having to check manually**.

## Acceptance Criteria

1. **AC1: Startup notification**
   - Given the bot connects successfully on startup
   - When the connection is established
   - Then the control group receives: "🟢 eNorBOT online"

2. **AC2: Disconnection notification**
   - Given the bot loses connection
   - When disconnection persists beyond 30 seconds (NFR4)
   - Then the control group receives: "🔴 Disconnected for Xs. Attempting reconnect..."

3. **AC3: Reconnection notification**
   - Given the bot reconnects after disconnection
   - When the connection is restored
   - Then the control group receives: "🟢 Reconnected"

4. **AC4: Auto-recovery notification**
   - Given an auto-recovery completes successfully
   - When the bot resumes normal operation
   - Then the control group receives: "✅ Auto-recovered from [error type]"

5. **AC5: Anti-detection compliance**
   - Given notifications are sent
   - When they use sendWithAntiDetection
   - Then they include typing indicator and chaotic timing (same as price responses)

## Tasks / Subtasks

- [x] Task 1: Upgrade notifications.ts to actually send (AC: 1, 2, 3, 4, 5)
  - [x] 1.1: Import WASocket type and sendWithAntiDetection
  - [x] 1.2: Store socket reference in module state
  - [x] 1.3: Store control group ID from config
  - [x] 1.4: Create `initializeNotifications(sock, controlGroupId)` function
  - [x] 1.5: Modify `queueControlNotification()` to send immediately if socket available
  - [x] 1.6: Flush queued notifications on socket initialization
  - [x] 1.7: Add tests for notification sending

- [x] Task 2: Integrate startup notification (AC: 1, 5)
  - [x] 2.1: Call `initializeNotifications()` in connection.ts on connect
  - [x] 2.2: Send "🟢 eNorBOT online" on first successful connect
  - [x] 2.3: Distinguish first connect from reconnect
  - [x] 2.4: Add tests for startup notification

- [x] Task 3: Integrate disconnection notification (AC: 2, 5)
  - [x] 3.1: In connection.ts, detect disconnection event
  - [x] 3.2: Wait 30 seconds before sending notification (NFR4 threshold)
  - [x] 3.3: Use existing `getDisconnectedDuration()` from state.ts
  - [x] 3.4: Send notification once (don't spam on repeated attempts)
  - [x] 3.5: Add tests for disconnection notification

- [x] Task 4: Integrate reconnection notification (AC: 3, 5)
  - [x] 4.1: Detect reconnection (was disconnected, now connected)
  - [x] 4.2: Send "🟢 Reconnected" if was in extended disconnect
  - [x] 4.3: Don't send reconnect notification on initial connect
  - [x] 4.4: Add tests for reconnection notification

- [x] Task 5: Verify auto-recovery notifications work (AC: 4)
  - [x] 5.1: Auto-recovery already queues notifications (Story 3.3)
  - [x] 5.2: Verify they now send when socket available
  - [x] 5.3: Add integration test for recovery → notification flow

## Dev Notes

### Architecture: From Queue to Send

Epic 3 created the notification queue stub. This story transforms it into a real sender:

**Before (Epic 3):**
```typescript
// notifications.ts - just logs
export function queueControlNotification(message: string): void {
  notificationQueue.push(message)
  logger.info('Notification queued (sending in Epic 4)', { message })
}
```

**After (Epic 4):**
```typescript
// notifications.ts - actually sends
import type { WASocket } from '@whiskeysockets/baileys'
import { sendWithAntiDetection } from '../utils/messaging.js'
import { getConfig } from '../config.js'

let socket: WASocket | null = null
let controlGroupId: string | null = null
const notificationQueue: string[] = []

export function initializeNotifications(sock: WASocket, groupId: string): void {
  socket = sock
  controlGroupId = groupId

  // Flush any queued notifications
  while (notificationQueue.length > 0) {
    const message = notificationQueue.shift()!
    sendNotification(message)
  }
}

export async function queueControlNotification(message: string): Promise<void> {
  if (socket && controlGroupId) {
    await sendNotification(message)
  } else {
    // Socket not ready yet - queue for later
    notificationQueue.push(message)
    logger.info('Notification queued (socket not ready)', { message })
  }
}

async function sendNotification(message: string): Promise<void> {
  if (!socket || !controlGroupId) {
    logger.error('Cannot send notification - socket or controlGroupId not set')
    return
  }

  await sendWithAntiDetection(socket, controlGroupId, message)

  logger.info('Control notification sent', {
    event: 'notification_sent',
    message,
  })
}
```

### Control Group ID

The control group ID comes from environment configuration:

```typescript
// In config.ts, CONTROL_GROUP_ID should be defined
// This is the JID of the control group (e.g., "123456789@g.us")

const config = getConfig()
initializeNotifications(sock, config.CONTROL_GROUP_ID)
```

### Connection Lifecycle Notifications

In connection.ts, add notification hooks:

```typescript
import { queueControlNotification, initializeNotifications } from './notifications.js'

// Track if this is first connection or reconnection
let hasConnectedBefore = false

function handleConnectionUpdate(update: ConnectionState) {
  if (update.connection === 'open') {
    if (!hasConnectedBefore) {
      // First connection
      hasConnectedBefore = true
      initializeNotifications(sock, config.CONTROL_GROUP_ID)
      queueControlNotification('🟢 eNorBOT online')
    } else if (state.notificationSent) {
      // Reconnection after extended disconnect
      queueControlNotification('🟢 Reconnected')
      setNotificationSent(false)  // Reset for next disconnect
    }
  }
}
```

### 30-Second Threshold for Disconnect Notification

Using existing state tracking from connection.ts:

```typescript
// In reconnection logic or periodic check
const disconnectedDuration = getDisconnectedDuration()

if (disconnectedDuration && disconnectedDuration >= 30_000 && !state.notificationSent) {
  queueControlNotification('🔴 Disconnected. Attempting reconnect...')
  setNotificationSent(true)  // Only send once per disconnect episode
}
```

### Anti-Detection Compliance (AC5)

All notifications use `sendWithAntiDetection()` which includes:
- Typing indicator simulation
- Chaotic timing delays (3-15 seconds)
- Same patterns as price responses

This is automatic when using the messaging utility.

### Existing Recovery Notifications

Story 3.3 already queues these:
- `✅ Auto-recovered from [reason]` - on successful recovery
- `⚠️ Auto-recovery failed. Manual intervention required.` - on failed recovery

With this story, they will actually send.

### Testing Strategy

1. **Unit tests for notifications.ts:**
   - `initializeNotifications()` stores socket and control group
   - Queued notifications flush on initialization
   - Direct send when socket available

2. **Unit tests for connection notifications:**
   - First connect → "online" notification
   - Reconnect → "reconnected" notification
   - Disconnect >30s → "disconnected" notification

3. **Integration tests:**
   - Full lifecycle: connect → disconnect → reconnect
   - Auto-recovery notification flow
   - sendWithAntiDetection called with correct parameters

### Project Structure Notes

Files to modify:
- `src/bot/notifications.ts` - Transform queue to sender
- `src/bot/connection.ts` - Add notification hooks

No new files - upgrades existing infrastructure.

### CRITICAL: Anti-Ban Considerations

Notifications go to the control group which is owned by the CIO. However:
- Still use full anti-detection timing
- Don't send too many notifications (rate limit already in place)
- Notification count does NOT count toward daily message limit (internal communication)

### References

- [Source: src/utils/messaging.ts] - sendWithAntiDetection implementation
- [Source: src/bot/connection.ts] - Connection lifecycle
- [Source: src/bot/state.ts] - getDisconnectedDuration, notificationSent flag
- [Source: docs/project-context.md#Rate-Limited Notifications] - Cooldown pattern
- [Source: _bmad-output/planning-artifacts/architecture.md] - CONTROL_GROUP_ID config

### Dependencies

- **From Epic 1:** `sendWithAntiDetection()` in messaging.ts
- **From Epic 1:** Connection lifecycle management
- **From Epic 3:** Notification queue infrastructure
- **From Story 3.3:** Auto-recovery notification calls

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5

### Completion Notes List

1. **Task 1 Complete:** Upgraded notifications.ts from queue stub to actual sender
   - Added `initializeNotifications(sock, groupId)` to store socket and control group
   - Modified `queueControlNotification()` to send immediately when initialized
   - Added `sendNotification()` helper using `sendWithAntiDetection`
   - Added flush logic for queued messages on initialization
   - Added `sendStartupNotification()`, `sendReconnectNotification()`, `sendDisconnectNotification()`
   - Added testing utilities: `resetNotificationState()`, `isNotificationsInitialized()`, `hasHadFirstConnection()`, `setHasConnectedBefore()`

2. **Task 2 Complete:** Integrated startup notification in connection.ts
   - Call `initializeNotifications()` on connection open
   - Call `sendStartupNotification()` on first connection
   - First connection flag tracked in notifications.ts module state

3. **Task 3 Complete:** Integrated disconnection notification
   - Updated existing disconnect notification to use `sendDisconnectNotification(seconds)`
   - Uses existing 30s threshold (NOTIFICATION_THRESHOLD_MS)
   - Uses existing notificationSent flag to prevent spam

4. **Task 4 Complete:** Integrated reconnection notification
   - Call `sendReconnectNotification()` when reconnecting (wasReconnecting = true)
   - Distinguishes from first connect using hasConnectedBefore flag

5. **Task 5 Complete:** Auto-recovery notifications verified
   - autoRecovery.ts already uses `queueControlNotification()`
   - With notifications.ts upgrade, these now send immediately
   - Integration tests added to notifications.test.ts

### File List

- `src/bot/notifications.ts` - Upgraded from queue stub to actual sender
- `src/bot/notifications.test.ts` - 24 new tests covering all AC
- `src/bot/connection.ts` - Added notification initialization and lifecycle hooks

## Senior Developer Review (AI)

### Review Date: 2026-01-16
### Reviewer: Claude Opus 4.5 (Code Review Workflow)

**Issues Fixed:**
1. **HIGH-2**: Removed non-null assertion `sock!` - added proper null check `sock &&` before calling `initializeNotifications()`
2. **HIGH-3**: Fixed race condition - reordered to send `sendReconnectNotification()` BEFORE `clearNotificationQueue()` to preserve important reconnect notification
3. **MEDIUM-4**: Added `MAX_QUEUE_SIZE = 50` limit to notification queue to prevent unbounded growth; drops oldest on overflow
4. **LOW-1**: Enhanced JSDoc documentation for `sendStartupNotification()` and `sendReconnectNotification()` with explicit return type documentation

**Verification:** All 438 tests passing after fixes.
