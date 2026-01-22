# Story 1.6: Typing Indicator & Message Sending

Status: done

## Story

As a **CIO**,
I want **the bot to show typing before sending messages**,
So that **responses appear human-like**.

## Acceptance Criteria

1. **AC1: Anti-Detection Message Flow**
   - **Given** the bot is about to send a message
   - **When** the `sendWithAntiDetection` function is called
   - **Then** it first triggers "composing" presence for 1-4 seconds (NFR15)
   - **And** then applies chaotic delay from Story 1.5 (3-15 seconds)
   - **And** then sends the actual message

2. **AC2: Typing Indicator Lifecycle**
   - **Given** typing indicator is shown
   - **When** the duration expires
   - **Then** "paused" presence is sent before the message

3. **AC3: Error Handling with Result Type**
   - **Given** message sending fails
   - **When** an error occurs
   - **Then** the error is logged but not thrown (Result type)
   - **And** the function returns `{ok: false, error: "..."}`

## Tasks / Subtasks

- [x] **Task 1: Create Messaging Utility Module** (AC: #1, #3)
  - [x] 1.1 Create `src/utils/messaging.ts` with `sendWithAntiDetection()` function
  - [x] 1.2 Function signature: `sendWithAntiDetection(sock: WASocket, jid: string, message: string): Promise<Result<void>>`
  - [x] 1.3 Import `chaosDelay` from `./chaos.js`
  - [x] 1.4 Import `Result`, `ok`, `err` from `./result.js`
  - [x] 1.5 Import `logger` from `./logger.js`

- [x] **Task 2: Implement Typing Indicator Flow** (AC: #1, #2)
  - [x] 2.1 Generate random typing duration between 1000-4000ms (NFR15)
  - [x] 2.2 Call `sock.sendPresenceUpdate('composing', jid)` to show typing
  - [x] 2.3 Wait for typing duration using `await sleep(typingDuration)`
  - [x] 2.4 Call `sock.sendPresenceUpdate('paused', jid)` after typing stops

- [x] **Task 3: Integrate Chaotic Delay** (AC: #1)
  - [x] 3.1 After typing indicator flow, call `await chaosDelay()` (3-15 seconds from Story 1.5)
  - [x] 3.2 Log total delay (typing + chaotic) for debugging

- [x] **Task 4: Send Message with Error Handling** (AC: #3)
  - [x] 4.1 Wrap `sock.sendMessage(jid, { text: message })` in try/catch
  - [x] 4.2 On success, return `ok(undefined)` (void Result)
  - [x] 4.3 On error, log via `logger.error()` and return `err(errorMessage)`
  - [x] 4.4 Never throw - always return Result type

- [x] **Task 5: Add Debug Logging** (AC: #1, #3)
  - [x] 5.1 Log typing indicator start: `logger.debug('Typing indicator started', { jid, typingDurationMs })`
  - [x] 5.2 Log chaotic delay applied (already done by chaosDelay)
  - [x] 5.3 Log message sent: `logger.info('Message sent', { event: 'message_sent', jid })`
  - [x] 5.4 Log message failed: `logger.error('Message send failed', { event: 'message_error', jid, error })`

- [x] **Task 6: Unit Tests** (AC: #1, #2, #3)
  - [x] 6.1 Create `src/utils/messaging.test.ts` co-located with source
  - [x] 6.2 Test typing duration is within 1000-4000ms bounds
  - [x] 6.3 Test "composing" presence is called before delay
  - [x] 6.4 Test "paused" presence is called after typing duration
  - [x] 6.5 Test chaosDelay is called after typing indicator
  - [x] 6.6 Test successful message returns `{ok: true}`
  - [x] 6.7 Test failed message returns `{ok: false, error: "..."}`
  - [x] 6.8 Test logger.error is called on failure

## Dev Notes

### Architecture Compliance

**CRITICAL - Follow These Patterns:**

1. **Result Type Pattern** - This function CAN fail (network errors, WhatsApp errors). MUST use Result type:
   ```typescript
   import { Result, ok, err } from './result.js'

   export async function sendWithAntiDetection(
     sock: WASocket,
     jid: string,
     message: string
   ): Promise<Result<void>> {
     try {
       // ... implementation
       return ok(undefined)
     } catch (e) {
       logger.error('Message send failed', { event: 'message_error', error: e })
       return err(e instanceof Error ? e.message : 'Unknown error')
     }
   }
   ```

2. **Logger Pattern** - Use structured JSON logger:
   ```typescript
   logger.debug('Typing indicator started', {
     event: 'typing_start',
     jid,
     typingDurationMs,
   })
   ```

3. **Naming Conventions:**
   - Files: camelCase.ts (`messaging.ts`)
   - Functions: camelCase (`sendWithAntiDetection`)
   - Constants: SCREAMING_SNAKE (`MIN_TYPING_MS`, `MAX_TYPING_MS`)
   - Types: PascalCase (already defined in Baileys)

### Baileys API Reference

**Presence Updates:**
```typescript
// Show typing indicator
await sock.sendPresenceUpdate('composing', jid)

// Stop typing indicator (before sending)
await sock.sendPresenceUpdate('paused', jid)

// Send text message
await sock.sendMessage(jid, { text: 'Your message here' })
```

**WASocket Type Import:**
```typescript
import type { WASocket } from '@whiskeysockets/baileys'
```

### Implementation Algorithm

```typescript
// src/utils/messaging.ts
import type { WASocket } from '@whiskeysockets/baileys'
import { chaosDelay } from './chaos.js'
import { logger } from './logger.js'
import { Result, ok, err } from './result.js'

// Constants (NFR15: typing indicator 1-4 seconds)
const MIN_TYPING_MS = 1000  // 1 second
const MAX_TYPING_MS = 4000  // 4 seconds

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Generate random typing duration between MIN and MAX
 */
function getTypingDuration(): number {
  return Math.floor(MIN_TYPING_MS + Math.random() * (MAX_TYPING_MS - MIN_TYPING_MS))
}

/**
 * Send message with anti-detection behavior:
 * 1. Show typing indicator (1-4 seconds)
 * 2. Stop typing indicator
 * 3. Apply chaotic delay (3-15 seconds)
 * 4. Send message
 *
 * @returns Result<void> - success or error message
 */
export async function sendWithAntiDetection(
  sock: WASocket,
  jid: string,
  message: string
): Promise<Result<void>> {
  try {
    // Step 1: Show typing indicator (AC1, AC2)
    const typingDurationMs = getTypingDuration()
    await sock.sendPresenceUpdate('composing', jid)

    logger.debug('Typing indicator started', {
      event: 'typing_start',
      jid,
      typingDurationMs,
    })

    await sleep(typingDurationMs)

    // Step 2: Stop typing indicator (AC2)
    await sock.sendPresenceUpdate('paused', jid)

    // Step 3: Apply chaotic delay (AC1)
    const chaoticDelayMs = await chaosDelay()

    logger.debug('Anti-detection complete', {
      event: 'anti_detection_complete',
      jid,
      typingDurationMs,
      chaoticDelayMs,
      totalDelayMs: typingDurationMs + chaoticDelayMs,
    })

    // Step 4: Send message (AC1)
    await sock.sendMessage(jid, { text: message })

    logger.info('Message sent', {
      event: 'message_sent',
      jid,
    })

    return ok(undefined)
  } catch (e) {
    // AC3: Error handling with Result type
    const errorMessage = e instanceof Error ? e.message : 'Unknown error'

    logger.error('Message send failed', {
      event: 'message_error',
      jid,
      error: errorMessage,
    })

    return err(errorMessage)
  }
}
```

### Testing Strategy

**Unit Test Approach:**

```typescript
// src/utils/messaging.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { sendWithAntiDetection } from './messaging.js'

// Mock the dependencies
vi.mock('./chaos.js', () => ({
  chaosDelay: vi.fn().mockResolvedValue(5000),
}))

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

describe('sendWithAntiDetection', () => {
  let mockSocket: any

  beforeEach(() => {
    vi.useFakeTimers()
    mockSocket = {
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('shows composing presence before delay (AC1, AC2)', async () => {
    const promise = sendWithAntiDetection(mockSocket, 'group@g.us', 'Hello')

    // Composing should be called first
    expect(mockSocket.sendPresenceUpdate).toHaveBeenCalledWith('composing', 'group@g.us')

    vi.runAllTimers()
    await promise
  })

  it('shows paused presence after typing duration (AC2)', async () => {
    const promise = sendWithAntiDetection(mockSocket, 'group@g.us', 'Hello')
    vi.runAllTimers()
    await promise

    // Both composing and paused should be called
    expect(mockSocket.sendPresenceUpdate).toHaveBeenCalledWith('composing', 'group@g.us')
    expect(mockSocket.sendPresenceUpdate).toHaveBeenCalledWith('paused', 'group@g.us')
  })

  it('returns ok result on success (AC3)', async () => {
    const promise = sendWithAntiDetection(mockSocket, 'group@g.us', 'Hello')
    vi.runAllTimers()
    const result = await promise

    expect(result.ok).toBe(true)
  })

  it('returns err result on failure (AC3)', async () => {
    mockSocket.sendMessage.mockRejectedValue(new Error('Network error'))

    const promise = sendWithAntiDetection(mockSocket, 'group@g.us', 'Hello')
    vi.runAllTimers()
    const result = await promise

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Network error')
    }
  })
})
```

**Note:** Testing timing functions requires mocking timers. Use Vitest's `vi.useFakeTimers()` to avoid slow tests. Mock the socket and chaosDelay to isolate the unit under test.

### Integration with Price Handler (Future)

This utility will be used in `handlers/price.ts` and `handlers/control.ts`:

```typescript
// handlers/price.ts (future usage)
import { sendWithAntiDetection } from '../utils/messaging.js'
import { getSocket } from '../bot/connection.js'

async function handlePriceMessage(context: RouterContext) {
  const sock = getSocket()
  if (!sock) return // Not connected

  const result = await sendWithAntiDetection(
    sock,
    context.groupId,
    `R$${formattedPrice}`
  )

  if (!result.ok) {
    // Handle error - maybe queue for retry
    logger.warn('Price response failed', { error: result.error })
  }
}
```

### Files to Create

| File | Purpose |
|------|---------|
| `src/utils/messaging.ts` | Anti-detection message sending utility |
| `src/utils/messaging.test.ts` | Unit tests for messaging utility |

### Files to Modify

None - this is a standalone utility module. Integration with handlers will be done in Epic 2.

### Anti-Patterns to AVOID

- Do NOT throw errors from sendWithAntiDetection (use Result type)
- Do NOT skip the typing indicator phase
- Do NOT skip the chaotic delay phase
- Do NOT use `console.log` (use logger utility)
- Do NOT hardcode timing values (use constants)

### Learnings from Previous Stories

**From Story 1.5 (Chaotic Timing):**
- Module-level state tracking works well for testing (like lastDelay tracking)
- Use `vi.useFakeTimers()` for testing delay-based functions - avoids slow tests
- Add defensive code (like max iteration guards) for edge cases
- Export constants (`MIN_TYPING_MS`, `MAX_TYPING_MS`) for test maintainability
- Add logger spy tests to verify logging behavior
- Code review found infinite loop risk - consider similar edge cases here

**From Story 1.4 (Router):**
- Group metadata caching pattern works well
- Error handling wrapper protects against crashes
- Co-located tests (*.test.ts) work great

### NFR Compliance

| NFR | Requirement | Implementation |
|-----|-------------|----------------|
| NFR15 | Typing indicator duration 1-4 seconds | `MIN_TYPING_MS = 1000`, `MAX_TYPING_MS = 4000`, random selection |
| NFR14 | Response delay 3-15 seconds | Uses `chaosDelay()` from Story 1.5 |

### References

- [Source: docs/project-context.md#Technical Context] - NFR14, NFR15 timing requirements
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns] - Result type, logger patterns
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure] - utils/messaging.ts location
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.6] - Acceptance criteria
- [Source: src/utils/chaos.ts] - chaosDelay() function from Story 1.5
- [Source: src/utils/result.ts] - Result<T> type definition
- [Source: src/bot/connection.ts] - WASocket usage patterns

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None.

### Completion Notes List

1. Implementation follows the story's provided algorithm exactly
2. Used `vi.hoisted()` for proper ESM mock hoisting in tests (learned from initial test failures)
3. Used `vi.runAllTimersAsync()` instead of `vi.runAllTimers()` to properly handle promise-based async operations with fake timers
4. Created vitest.config.ts to exclude dist/ folder from test runs
5. All 21 tests pass (3 for getTypingDuration, 18 for sendWithAntiDetection)
6. Build compiles without errors
7. Exported `getTypingDuration` function and constants for test maintainability (following pattern from Story 1.5)
8. **Code Review Fixes Applied:**
   - Added input validation for jid and message parameters (M1)
   - Fixed getTypingDuration() to be inclusive of MAX_TYPING_MS (M3)
   - Added JSDoc documentation for MIN_TYPING_MS and MAX_TYPING_MS constants (L2)
   - Added test for chaosDelay call order verification (H1)
   - Added test for anti_detection_complete log message (M2)
   - Added logger.warn to test mock for completeness (L1)
   - Added 6 new tests: 4 for input validation, 1 for call order, 1 for anti_detection_complete log

### File List

| File | Action | Description |
|------|--------|-------------|
| src/utils/messaging.ts | Created | Anti-detection message sending utility with typing indicator flow |
| src/utils/messaging.test.ts | Created | 15 unit tests covering AC1, AC2, AC3 |
| vitest.config.ts | Created | Test configuration to exclude dist/ folder |

### Change Log

| Date | Change |
|------|--------|
| 2026-01-16 | Story created with comprehensive context from epics, architecture, and previous stories |
| 2026-01-16 | Implementation completed - all tasks done, 15 tests passing, build successful |
| 2026-01-16 | Code review completed - 7 issues found (1H, 3M, 3L), all auto-fixed, 21 tests passing |
