# Story 6.8: Control Group Failure Notifications

Status: review

## Story

As a **CIO**,
I want **to be notified when receipt processing fails**,
so that **I can manually review problematic receipts**.

## Acceptance Criteria

1. Given receipt extraction fails, when the failure notification is sent, then it includes: group name, sender, failure reason, timestamp

2. Given the notification format, when sent to control group, then the message is: "⚠️ Receipt failed | [Group] | [Sender] | [Reason]"

3. Given notifications are sent, when using sendWithAntiDetection, then they include typing indicator and chaotic timing (NFR20)

4. Given multiple failures occur in quick succession, when notifications would spam the control group, then only the first notification is sent within a 5-minute window (similar to Epic 3)

## Tasks / Subtasks

- [x] Task 1: Create notification service for receipts (AC: 1, 2)
  - [x] 1.1 Create `src/services/receiptNotifications.ts`
  - [x] 1.2 Implement `notifyReceiptFailure(context: ReceiptFailureContext): Promise<Result<{sent: boolean}>>`
  - [x] 1.3 Format message as "⚠️ Receipt failed | [Group] | [Sender] | [Reason]"
  - [x] 1.4 Include timestamp in context for logging

- [x] Task 2: Integrate with queueControlNotification (AC: 3)
  - [x] 2.1 Use existing queueControlNotification from `src/bot/notifications.ts`
  - [x] 2.2 Typing indicator and chaotic timing handled by notification queue
  - [x] 2.3 Chaotic timing applied via sendWithAntiDetection
  - [x] 2.4 Write unit test verifying queue integration

- [x] Task 3: Implement notification throttling (AC: 4)
  - [x] 3.1 Create throttle state tracker for receipt notifications
  - [x] 3.2 Track last notification time per type (receipt failures)
  - [x] 3.3 Skip notifications within 5-minute window
  - [x] 3.4 Log skipped notifications
  - [x] 3.5 Write unit test for throttling behavior

- [x] Task 4: Wire up to receipt handler (AC: 1)
  - [x] 4.1 Call notifyReceiptFailure from receipt handler on failure
  - [x] 4.2 Pass failure context (group, sender, reason)
  - [x] 4.3 Notification is async (doesn't block handler return)
  - [x] 4.4 Write integration tests with receipt handler

- [x] Task 5: Add comprehensive tests
  - [x] 5.1 Write unit test for notification format (30 tests in receiptNotifications.test.ts)
  - [x] 5.2 Write unit test for throttling
  - [x] 5.3 Write unit test for queue integration
  - [x] 5.4 Mock queueControlNotification
  - [x] 5.5 Write integration tests in receipt handler (8 tests)

## Dev Notes

### Architecture Patterns
- Follow Result<T> pattern from `src/utils/result.ts`
- Use existing notification patterns from `src/bot/notifications.ts`
- Throttling pattern similar to Epic 3 error notifications

### Source Files to Create/Modify
- `src/services/receiptNotifications.ts` - New file
- `src/services/receiptNotifications.test.ts` - New file
- `src/handlers/receipt.ts` - Wire up notification calls

### Notification Context Type
```typescript
interface ReceiptFailureContext {
  groupName: string;
  groupJid: string;
  senderName: string;
  senderJid: string;
  reason: string;
  timestamp: Date;
  receiptType: 'pdf' | 'image';
}
```

### Notification Format
```typescript
const formatNotification = (ctx: ReceiptFailureContext): string => {
  return `⚠️ Receipt failed | ${ctx.groupName} | ${ctx.senderName} | ${ctx.reason}`;
};
```

### Throttling Pattern (from Epic 3)
```typescript
const throttleState = {
  lastNotificationTime: 0,
  THROTTLE_WINDOW_MS: 5 * 60 * 1000, // 5 minutes
};

const shouldNotify = (): boolean => {
  const now = Date.now();
  if (now - throttleState.lastNotificationTime < throttleState.THROTTLE_WINDOW_MS) {
    logger.info('Notification throttled', {
      timeSinceLast: now - throttleState.lastNotificationTime
    });
    return false;
  }
  return true;
};

const notifyReceiptFailure = async (ctx: ReceiptFailureContext): Promise<Result<void>> => {
  if (!shouldNotify()) {
    return { ok: true, data: undefined }; // Throttled, but not an error
  }

  throttleState.lastNotificationTime = Date.now();

  const message = formatNotification(ctx);
  return sendToControlGroup(message);
};
```

### Anti-Detection Integration
```typescript
import { sendWithAntiDetection } from '../utils/messaging';

const sendToControlGroup = async (message: string): Promise<Result<void>> => {
  const controlGroupJid = getControlGroupJid();
  return sendWithAntiDetection(sock, controlGroupJid, message);
};
```

### Testing Standards
- Co-located tests in `src/services/receiptNotifications.test.ts`
- Mock sendWithAntiDetection
- Test throttling with time manipulation (jest.useFakeTimers)

### NFR Reference
- NFR20: Control group notifications for receipts use same anti-detection timing as other messages

### Project Structure Notes
- Notification service follows pattern from `src/bot/notifications.ts`
- Throttling is specific to receipt notifications (separate from error throttling)

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.8]
- [Source: src/bot/notifications.ts - existing notification pattern]
- [Source: src/services/autoPause.ts - throttling pattern from Epic 3]
- [Source: src/utils/messaging.ts - sendWithAntiDetection]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.5

### Debug Log References
- All 30 notification service tests passed on first run
- All 35 receipt handler tests passed (27 original + 8 notification integration)

### Completion Notes List
- Created `src/services/receiptNotifications.ts` with:
  - `notifyReceiptFailure()` - Send failure notification to control group
  - `formatReceiptFailureNotification()` - Format message with group/sender/reason
  - `shouldSendNotification()` - Throttle check with 5-minute window
  - `resetThrottle()` for testing
- Integrated with `queueControlNotification` from existing notification system
- Added notification calls to receipt handler on:
  - Download failure
  - Extraction failure
  - Storage failure (but NOT for duplicates)
- Silent success (no notification on successful receipt processing)
- 30 unit tests in receiptNotifications.test.ts
- 8 integration tests in receipt.test.ts for notification behavior
- Reason truncated to 50 chars in notification message

### File List
- src/services/receiptNotifications.ts (created)
- src/services/receiptNotifications.test.ts (created)
- src/handlers/receipt.ts (updated with notification calls)
- src/handlers/receipt.test.ts (updated with notification tests)
