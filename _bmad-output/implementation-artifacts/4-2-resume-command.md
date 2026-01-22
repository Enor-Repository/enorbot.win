# Story 4.2: Resume Command

Status: done

## Story

As a **CIO**,
I want **to resume bot activity for a paused group**,
So that **the bot continues handling requests after I'm done**.

## Acceptance Criteria

1. **AC1: Basic resume command**
   - Given Daniel sends "resume [group name]" in the control group
   - When the control handler processes the message
   - Then the specified group is removed from the paused list
   - And the bot responds: "▶️ Resumed for [group name]"

2. **AC2: Resumed group behavior**
   - Given a group is resumed
   - When a price trigger arrives from that group
   - Then the bot responds normally with anti-detection timing

3. **AC3: Global resume**
   - Given Daniel sends "resume" without a group name
   - When the control handler processes the message
   - Then ALL groups are resumed (global resume)
   - And the bot responds: "▶️ All groups resumed"

4. **AC4: Resume clears error state**
   - Given the bot was auto-paused due to critical error
   - When Daniel sends "resume"
   - Then the bot resumes AND clears the error state
   - And responds: "▶️ Resumed. Error state cleared."

## Tasks / Subtasks

- [x] Task 1: Extend state.ts for resume operations (AC: 1, 2, 3)
  - [x] 1.1: Create `resumeGroup(groupId: string)` function
  - [x] 1.2: Create `resumeAllGroups()` function (clears pausedGroups + globalPause)
  - [x] 1.3: Ensure `setRunning()` is called for error state clear
  - [x] 1.4: Add tests for all new state functions

- [x] Task 2: Implement resume command parsing in control.ts (AC: 1, 3, 4)
  - [x] 2.1: Extend `parseControlCommand()` with "resume" detection
  - [x] 2.2: Reuse fuzzy group matching from Story 4.1
  - [x] 2.3: Add tests for resume command parsing

- [x] Task 3: Update handleControlMessage for resume (AC: 1, 3, 4)
  - [x] 3.1: Handle "resume" (global) vs "resume [name]" (specific)
  - [x] 3.2: Call state functions to apply resume
  - [x] 3.3: **CRITICAL: Call `cancelAutoRecovery()`** on any resume
  - [x] 3.4: Check if error state was active and clear it
  - [x] 3.5: Send appropriate confirmation response
  - [x] 3.6: Log resume events with structured logging
  - [x] 3.7: Add integration tests

- [x] Task 4: Verify price handler resumes correctly (AC: 2)
  - [x] 4.1: Confirm resumed group processes price triggers
  - [x] 4.2: Add end-to-end test for pause → resume → trigger flow

## Dev Notes

### CRITICAL INTEGRATION: cancelAutoRecovery()

**This is the most critical integration point in Epic 4.**

When the CIO manually resumes, any pending auto-recovery timer MUST be cancelled. Failure to do this creates a race condition:

```
1. Bot auto-pauses due to transient errors
2. Auto-recovery timer starts (5 minutes)
3. CIO manually resumes after 2 minutes
4. Bot is now running
5. After 3 more minutes, auto-recovery fires
6. Recovery logic runs on already-running bot (undefined behavior)
```

**Solution:** Always call `cancelAutoRecovery()` on resume:

```typescript
import { cancelAutoRecovery } from '../services/autoRecovery.js'

async function handleResume(context: RouterContext, groupName?: string) {
  // CRITICAL: Cancel any pending auto-recovery first
  cancelAutoRecovery()

  if (groupName) {
    resumeGroup(findMatchingGroup(groupName))
  } else {
    resumeAllGroups()
    // Also clear error state on global resume
    if (getOperationalStatus() === 'paused') {
      setRunning()
    }
  }
  // ... send confirmation
}
```

### State Functions Design

```typescript
// Resume specific group
export function resumeGroup(groupId: string): boolean {
  if (!pausedGroups.has(groupId)) {
    return false  // Group wasn't paused
  }
  pausedGroups.delete(groupId)
  return true
}

// Resume all groups
export function resumeAllGroups(): void {
  pausedGroups.clear()
  globalPause = false
}
```

### Response Messages

```typescript
// Specific group resume
'▶️ Resumed for Binance VIP'

// Global resume (no error state)
'▶️ All groups resumed'

// Global resume with error state cleared
'▶️ Resumed. Error state cleared.'

// Group wasn't paused
'ℹ️ "Binance VIP" was not paused'

// No matching group found
'⚠️ No group matching "xyz" found'
```

### Error State Detection

Need to check both:
1. Per-group pause (`pausedGroups`, `globalPause`)
2. Auto-pause error state (`operationalStatus === 'paused'`)

```typescript
function wasInErrorState(): boolean {
  return getOperationalStatus() === 'paused'
}

// In resume handler
const hadErrorState = wasInErrorState()

cancelAutoRecovery()  // Always cancel first
resumeAllGroups()

if (hadErrorState) {
  setRunning()  // Clear error state
  await sendWithAntiDetection(sock, groupId, '▶️ Resumed. Error state cleared.')
} else {
  await sendWithAntiDetection(sock, groupId, '▶️ All groups resumed')
}
```

### Testing Strategy

1. **Unit tests for state.ts:**
   - `resumeGroup()` removes from set
   - `resumeAllGroups()` clears everything
   - Resuming non-paused group returns false

2. **Unit tests for control.ts:**
   - Resume command parsing
   - Fuzzy matching for resume

3. **Integration tests:**
   - `cancelAutoRecovery()` called on every resume
   - Error state cleared on global resume
   - Correct response messages

4. **Critical race condition test:**
   - Pause bot via auto-pause
   - Verify recovery timer is pending
   - Send resume command
   - Verify `cancelAutoRecovery()` was called
   - Advance timers - recovery should NOT fire

### Project Structure Notes

Files to modify:
- `src/bot/state.ts` - Add resume functions
- `src/handlers/control.ts` - Add resume command handling

No new files needed - builds on Story 4.1.

### References

- [Source: src/services/autoRecovery.ts#cancelAutoRecovery] - Cancel function
- [Source: src/bot/state.ts#setRunning] - Clear error state
- [Source: docs/project-context.md#Error Handling Patterns] - Error state management
- [Source: _bmad-output/implementation-artifacts/3-3-auto-recovery-from-transient-errors.md] - Auto-recovery design

### Dependencies

- **From Story 4.1:** `resumeGroup()` pattern, fuzzy matching, `parseControlCommand()`
- **From Story 3.3:** `cancelAutoRecovery()`, `isRecoveryPending()`
- **From Story 3.2:** `setRunning()`, `getOperationalStatus()`

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-sonnet-4-20250514)

### Completion Notes List

- **Note:** Most of Story 4.2 was implemented as part of Story 4.1 to ensure cohesive control handler implementation. The resume command was built alongside pause to share command parsing and fuzzy matching infrastructure.

- **Task 1:** `resumeGroup()` and `resumeAllGroups()` were implemented in state.ts during Story 4.1. Both functions have comprehensive tests in state.test.ts.

- **Task 2:** `parseControlCommand()` handles "resume" command with optional group name. Case-insensitive parsing implemented. Tests added for resume command parsing.

- **Task 3:** `handleResumeCommand()` implemented with all required functionality:
  - Global vs specific group resume
  - **CRITICAL: `cancelAutoRecovery()` called on EVERY resume command** (prevents race condition)
  - Error state detection and clearing with `setRunning()`
  - Appropriate confirmation messages ("▶️ Resumed. Error state cleared." when error was active)
  - Full structured logging

- **Task 4:** Added end-to-end tests verifying pause → resume → trigger flow works correctly. Tests confirm `isGroupPaused()` returns false after resume.

### File List

- `src/bot/state.ts` - Resume functions (resumeGroup, resumeAllGroups) - from Story 4.1
- `src/bot/state.test.ts` - Resume tests - from Story 4.1
- `src/handlers/control.ts` - handleResumeCommand with cancelAutoRecovery integration
- `src/handlers/control.test.ts` - 51 tests including end-to-end resume flow tests

## Senior Developer Review (AI)

### Review Date: 2026-01-16
### Reviewer: Claude Opus 4.5 (Code Review Workflow)

**No issues specific to Story 4.2 - implementation verified correct.**

The CRITICAL `cancelAutoRecovery()` call is correctly placed at the start of `handleResumeCommand()`, preventing the race condition described in Dev Notes.

**Verification:** All 438 tests passing.
