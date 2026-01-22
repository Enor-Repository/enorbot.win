# Story 2.4: Graceful Degradation (Stall & Retry)

Status: done

## Story

As a **CIO**,
I want **the bot to send a stall message instead of failing silently**,
So that **clients know their request was received and no wrong price is ever sent**.

## Acceptance Criteria

1. **AC1: Stall Message on First Failure**
   - **Given** Binance API fails on first attempt
   - **When** the price handler detects `{ok: false}`
   - **Then** it sends a human-like stall message: "Um momento, verificando..." (with anti-detection)
   - **And** logs `event: 'price_stall_sent'`

2. **AC2: Retry with Spacing**
   - **Given** a stall message was sent
   - **When** the handler retries Binance (up to 2 retries)
   - **Then** each retry is spaced 2 seconds apart
   - **And** logs `event: 'price_retry_attempt'` with attempt number

3. **AC3: Recovery Success**
   - **Given** retry succeeds
   - **When** the price is fetched
   - **Then** the formatted price is sent as a follow-up message
   - **And** logs `event: 'price_recovered_after_retry'` with attempt count
   - **And** returns `{ok: true, data: {price, groupId, timestamp, recovered: true, retryCount}}`

4. **AC4: Exhausted Retries**
   - **Given** all retries fail (3 total attempts: initial + 2 retries)
   - **When** the handler exhausts attempts
   - **Then** NO price message is sent (never send wrong data)
   - **And** returns `{ok: false, error: "Price unavailable after retries"}`
   - **And** logs `event: 'price_unavailable_after_retries'` with total attempts

5. **AC5: Stall Message Format**
   - **Given** the stall message is sent
   - **When** it appears in the client's chat
   - **Then** it uses Brazilian Portuguese: "Um momento, verificando..."
   - **And** it is sent via `sendWithAntiDetection` (typing indicator + chaotic delay)

## Tasks / Subtasks

- [x] **Task 1: Create Retry Constants** (AC: #2)
  - [x] 1.1 Add `MAX_PRICE_RETRIES = 2` constant (2 retries after initial)
  - [x] 1.2 Add `RETRY_DELAY_MS = 2000` constant (2 seconds between retries)
  - [x] 1.3 Add `STALL_MESSAGE = "Um momento, verificando..."` constant
  - [x] 1.4 Export constants for testing

- [x] **Task 2: Create Retry Utility** (AC: #2, #3, #4)
  - [x] 2.1 Create retry logic with configurable attempts and delay
  - [x] 2.2 Implement sleep/delay function using Promise
  - [x] 2.3 Return detailed result including attempt count
  - [x] 2.4 Log each retry attempt

- [x] **Task 3: Update Price Handler for Stall** (AC: #1, #5)
  - [x] 3.1 Detect first `fetchPrice()` failure
  - [x] 3.2 Send stall message via `sendWithAntiDetection`
  - [x] 3.3 Log `price_stall_sent` event with context
  - [x] 3.4 Handle stall message send failure (log and continue with retry)

- [x] **Task 4: Implement Retry Loop** (AC: #2, #3, #4)
  - [x] 4.1 After stall, call `fetchPrice()` up to `MAX_PRICE_RETRIES` times
  - [x] 4.2 Wait `RETRY_DELAY_MS` between each retry
  - [x] 4.3 On success: format price, send follow-up, return success with `recovered: true`
  - [x] 4.4 On all failures: return error, NO message sent, log exhaustion

- [x] **Task 5: Update Return Type** (AC: #3)
  - [x] 5.1 Extend `PriceHandlerResult` with optional `recovered` and `retryCount` fields
  - [x] 5.2 Include recovery metadata in success return
  - [x] 5.3 Preserve backward compatibility (fields optional)

- [x] **Task 6: Unit Tests** (AC: #1, #2, #3, #4, #5)
  - [x] 6.1 Test initial failure triggers stall message
  - [x] 6.2 Test retry succeeds on 2nd attempt - price sent as follow-up
  - [x] 6.3 Test retry succeeds on 3rd attempt - price sent as follow-up
  - [x] 6.4 Test all retries fail - NO price sent, error returned
  - [x] 6.5 Test retry spacing is 2 seconds
  - [x] 6.6 Test logging for all scenarios (stall, retry, recovered, exhausted)
  - [x] 6.7 Test stall message format in Portuguese
  - [x] 6.8 Test return type includes recovered/retryCount on recovery

## Dev Notes

### Architecture Compliance

**CRITICAL - Follow These Patterns:**

1. **Result Type Pattern** - Handler returns Result, NEVER throws:
   ```typescript
   // Success with recovery metadata
   return ok({
     price,
     groupId,
     timestamp,
     recovered: true,
     retryCount: 2,
   })

   // Failure after exhausted retries
   return err('Price unavailable after retries')
   ```

2. **Logger Pattern** - Use structured JSON logger:
   ```typescript
   logger.info('Stall message sent', {
     event: 'price_stall_sent',
     groupId: context.groupId,
     reason: 'Binance API failed',
   })

   logger.warn('Price retry attempt', {
     event: 'price_retry_attempt',
     attempt: 2,
     maxRetries: MAX_PRICE_RETRIES,
     groupId: context.groupId,
   })

   logger.info('Recovered after retry', {
     event: 'price_recovered_after_retry',
     price,
     retryCount: 2,
     groupId: context.groupId,
   })

   logger.error('Price unavailable after retries', {
     event: 'price_unavailable_after_retries',
     totalAttempts: 3,
     groupId: context.groupId,
   })
   ```

3. **Naming Conventions:**
   - Constants: `MAX_PRICE_RETRIES`, `RETRY_DELAY_MS`, `STALL_MESSAGE`
   - Functions: `handlePriceMessage`, `sleep`
   - Types: `PriceHandlerResult`

### Implementation Strategy

**Option A: Modify price.ts directly (Recommended)**

Keep all retry logic in the price handler. This is simpler and avoids over-engineering.

```typescript
// src/handlers/price.ts

export const MAX_PRICE_RETRIES = 2
export const RETRY_DELAY_MS = 2000
export const STALL_MESSAGE = 'Um momento, verificando...'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function handlePriceMessage(
  context: RouterContext
): Promise<Result<PriceHandlerResult>> {
  // Log trigger detection (existing)
  logger.info('Price trigger detected', { ... })

  // Step 1: First attempt
  const firstResult = await fetchPrice()

  if (firstResult.ok) {
    // Happy path - format and send (existing code)
    const formattedPrice = formatBrazilianPrice(firstResult.data)
    const sendResult = await sendWithAntiDetection(context.sock, context.groupId, formattedPrice)
    // ... return success
  }

  // Step 2: First failure - send stall message
  logger.info('Stall message sent', {
    event: 'price_stall_sent',
    groupId: context.groupId,
    reason: firstResult.error,
  })

  const stallResult = await sendWithAntiDetection(
    context.sock,
    context.groupId,
    STALL_MESSAGE
  )

  if (!stallResult.ok) {
    logger.warn('Failed to send stall message', {
      event: 'price_stall_send_failed',
      error: stallResult.error,
      groupId: context.groupId,
    })
    // Continue with retry anyway
  }

  // Step 3: Retry loop
  for (let attempt = 1; attempt <= MAX_PRICE_RETRIES; attempt++) {
    await sleep(RETRY_DELAY_MS)

    logger.warn('Price retry attempt', {
      event: 'price_retry_attempt',
      attempt,
      maxRetries: MAX_PRICE_RETRIES,
      groupId: context.groupId,
    })

    const retryResult = await fetchPrice()

    if (retryResult.ok) {
      // Recovery success!
      const price = retryResult.data
      const formattedPrice = formatBrazilianPrice(price)

      const sendResult = await sendWithAntiDetection(
        context.sock,
        context.groupId,
        formattedPrice
      )

      if (!sendResult.ok) {
        logger.error('Failed to send recovered price', {
          event: 'price_recovered_send_failed',
          error: sendResult.error,
          groupId: context.groupId,
          price,
        })
        return err(sendResult.error)
      }

      const timestamp = new Date().toISOString()

      logger.info('Recovered after retry', {
        event: 'price_recovered_after_retry',
        price,
        formattedPrice,
        retryCount: attempt,
        groupId: context.groupId,
        timestamp,
      })

      return ok({
        price,
        groupId: context.groupId,
        timestamp,
        recovered: true,
        retryCount: attempt,
      })
    }

    // Log retry failure
    logger.warn('Retry failed', {
      event: 'price_retry_failed',
      attempt,
      error: retryResult.error,
      groupId: context.groupId,
    })
  }

  // Step 4: All retries exhausted
  logger.error('Price unavailable after retries', {
    event: 'price_unavailable_after_retries',
    totalAttempts: 1 + MAX_PRICE_RETRIES, // initial + retries
    groupId: context.groupId,
  })

  return err('Price unavailable after retries')
}
```

### Type Updates

**Extend PriceHandlerResult:**
```typescript
// src/types/handlers.ts

export interface PriceHandlerResult {
  price: number
  groupId: string
  timestamp: string
  /** True if price was recovered after initial failure */
  recovered?: boolean
  /** Number of retries before success (only if recovered) */
  retryCount?: number
}
```

### Stall Message Behavior

**Why "Um momento, verificando...":**
- Natural Brazilian Portuguese
- Sounds like a human checking something
- Not robotic ("Please wait while I process your request")
- Consistent with eNor's voice/tone

**Anti-Detection:**
- Stall message uses same `sendWithAntiDetection` as price response
- Includes typing indicator (1-4s)
- Includes chaotic delay (3-15s)
- Total perceived delay: 4-19 seconds before stall appears

### Testing Strategy

**Mock Setup:**
```typescript
vi.mock('../services/binance.js', () => ({
  fetchPrice: vi.fn(),
}))

vi.mock('../utils/messaging.js', () => ({
  sendWithAntiDetection: vi.fn(),
}))

const mockFetchPrice = fetchPrice as ReturnType<typeof vi.fn>
const mockSend = sendWithAntiDetection as ReturnType<typeof vi.fn>
```

**Test Scenarios:**

1. **Happy path (no retry needed)** - existing tests cover this

2. **Stall + retry success on 2nd attempt:**
   ```typescript
   mockFetchPrice
     .mockResolvedValueOnce({ ok: false, error: 'Timeout' })  // 1st fails
     .mockResolvedValueOnce({ ok: true, data: 5.82 })         // 2nd succeeds
   mockSend.mockResolvedValue({ ok: true, data: undefined })

   // Expect: stall sent, then price sent, recovered: true, retryCount: 1
   ```

3. **Stall + retry success on 3rd attempt:**
   ```typescript
   mockFetchPrice
     .mockResolvedValueOnce({ ok: false, error: 'Timeout' })  // 1st fails
     .mockResolvedValueOnce({ ok: false, error: 'Timeout' })  // 2nd fails
     .mockResolvedValueOnce({ ok: true, data: 5.82 })         // 3rd succeeds
   mockSend.mockResolvedValue({ ok: true, data: undefined })

   // Expect: stall sent, then price sent, recovered: true, retryCount: 2
   ```

4. **All retries exhausted:**
   ```typescript
   mockFetchPrice.mockResolvedValue({ ok: false, error: 'Timeout' })
   mockSend.mockResolvedValue({ ok: true, data: undefined })

   // Expect: stall sent, NO price sent, error returned
   ```

5. **Timing verification:**
   ```typescript
   vi.useFakeTimers()
   mockFetchPrice.mockResolvedValue({ ok: false, error: 'Timeout' })

   const promise = handlePriceMessage(context)

   // Verify 2-second delay between retries
   vi.advanceTimersByTime(2000) // First retry
   vi.advanceTimersByTime(2000) // Second retry

   await promise
   // Verify total time elapsed
   ```

### Learnings from Previous Stories

**From Story 2.1 (Trigger Detection):**
- Co-located tests work well (`price.test.ts` alongside `price.ts`)
- Export constants for test access (`MAX_PRICE_RETRIES`, etc.)
- Use `vi.fn()` for mocking

**From Story 2.2 (Binance Service):**
- `vi.useFakeTimers()` essential for timing tests
- Always test logging assertions
- Result pattern works great for error handling

**From Story 2.3 (Price Response):**
- `vi.advanceTimersByTime()` for simulating delays
- Test timestamp ordering matters
- Mock implementation can simulate side effects

**From Code Reviews:**
- Expect 3-6 issues per story
- Always verify logging assertions
- Test edge cases (stall send failure, etc.)

### Files to Modify

| File | Changes |
|------|---------|
| `src/handlers/price.ts` | Add retry logic, stall message, constants |
| `src/handlers/price.test.ts` | Add tests for retry/stall scenarios |
| `src/types/handlers.ts` | Add `recovered` and `retryCount` optional fields |

### Files NOT to Create

This story modifies existing files. No new files needed.

### Anti-Patterns to AVOID

- Do NOT send price message after retries exhausted (AC4: never send wrong data)
- Do NOT use external retry libraries (simple loop is sufficient)
- Do NOT skip stall message on send failure (continue with retry)
- Do NOT throw exceptions (use Result pattern)
- Do NOT hardcode magic numbers (use named constants)
- Do NOT forget to clear timers in tests (`afterEach(() => vi.useRealTimers())`)

### NFR Compliance

| NFR | Requirement | Implementation |
|-----|-------------|----------------|
| NFR10 | Binance <2s or fallback | Retry triggers after timeout (from Story 2.2) |
| NFR13 | All API failures logged | Logging for stall, retry, recovery, exhaustion |
| NFR14 | Response delay 3-15s | Stall uses `sendWithAntiDetection` |
| NFR15 | Typing indicator 1-4s | Stall uses `sendWithAntiDetection` |

### Dependencies from Previous Stories

| Component | Location | Usage |
|-----------|----------|-------|
| `fetchPrice()` | src/services/binance.ts | Price fetching with timeout |
| `formatBrazilianPrice()` | src/utils/format.ts | R$X,XX formatting |
| `sendWithAntiDetection()` | src/utils/messaging.ts | Anti-detection message sending |
| `RouterContext` | src/bot/router.ts | Handler input with sock |
| `Result<T>` | src/utils/result.ts | Return type pattern |
| `PriceHandlerResult` | src/types/handlers.ts | Success return type |
| `logger` | src/utils/logger.ts | Structured logging |

### Ready for Epic 3

This story completes Epic 2's graceful degradation. Epic 3 (Error Handling & Safety) will:
1. Use the `price_unavailable_after_retries` event to detect repeated failures
2. Implement error classification (transient vs critical)
3. Auto-pause on critical errors
4. Auto-recovery from transient errors

The logging events from this story (`price_stall_sent`, `price_retry_attempt`, `price_unavailable_after_retries`) will feed into Epic 3's error tracking system.

### Edge Cases to Consider

1. **Stall message send fails:** Log warning, continue with retry anyway
2. **Price recovered but send fails:** Return error (existing behavior)
3. **First attempt succeeds:** No stall, no retry (existing happy path)
4. **fetchPrice throws unexpected error:** Result pattern handles this (from Story 2.2)
5. **Socket disconnected during retry:** `sendWithAntiDetection` returns error

### References

- [Source: docs/project-context.md#Non-Negotiables] - "Never sends wrong prices"
- [Source: docs/project-context.md#Implementation Patterns] - Result type pattern
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4] - Acceptance criteria
- [Source: _bmad-output/implementation-artifacts/2-2-binance-price-service.md] - fetchPrice implementation
- [Source: _bmad-output/implementation-artifacts/2-3-price-response-with-formatting.md] - Current price handler

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None required - implementation straightforward.

### Completion Notes List

1. **Retry Constants**: Added `MAX_PRICE_RETRIES = 2`, `RETRY_DELAY_MS = 2000`, and `STALL_MESSAGE = 'Um momento, verificando...'` to price.ts. All constants exported for testing.

2. **Sleep Utility**: Created `sleep(ms)` function using Promise-based setTimeout. Exported for testability.

3. **Stall Message Flow**: When first `fetchPrice()` fails, handler immediately sends stall message via `sendWithAntiDetection`. Logs `price_stall_sent` event with reason. If stall send fails, logs warning but continues with retry (graceful handling).

4. **Retry Loop**: After stall, retries up to `MAX_PRICE_RETRIES` times (2) with `RETRY_DELAY_MS` spacing (2s). On success, sends formatted price as follow-up. On all failures, returns error without sending any price (never send wrong data).

5. **Recovery Metadata**: On retry success, returns `{recovered: true, retryCount: N}` in result. Logs `price_recovered_after_retry` event. Updated `PriceHandlerResult` type with optional fields.

6. **Logging Events**: All scenarios logged:
   - `price_stall_sent` - when stall message sent
   - `price_retry_attempt` - each retry attempt
   - `price_retry_failed` - when retry fails
   - `price_recovered_after_retry` - when recovery succeeds
   - `price_unavailable_after_retries` - when all retries exhausted

7. **Helper Function**: Created `sendPriceResponse()` helper to share code between happy path and recovery path. Reduces duplication and ensures consistent logging.

8. **Unit Tests**: Added 22 new tests in Story 2.4 section covering:
   - Constants export verification (3 tests)
   - sleep utility (1 test)
   - AC1: Stall message on first failure (3 tests)
   - AC2: Retry with 2s spacing (2 tests)
   - AC3: Recovery success (4 tests)
   - AC4: Exhausted retries (4 tests)
   - AC5: Stall message format (2 tests)
   - Retry failure logging (1 test)
   - Happy path - no retry needed (2 tests)

9. **Test Updates**: Updated 2 existing Story 2.3 tests to account for new retry behavior (they now use `vi.runAllTimersAsync()`).

10. **Test Results**: 135 total tests passing (38 price handler + 97 existing). Build compiles successfully.

### File List

| File | Action | Description |
|------|--------|-------------|
| `src/handlers/price.ts` | Modified | Added retry constants, sleep utility, stall message logic, retry loop, sendPriceResponse helper |
| `src/handlers/price.test.ts` | Modified | Added 22 new tests for Story 2.4, updated 2 existing tests for retry compatibility |
| `src/types/handlers.ts` | Modified | Added optional `recovered` and `retryCount` fields to PriceHandlerResult |

### Change Log

| Date | Change |
|------|--------|
| 2026-01-16 | Story created with comprehensive context from Stories 2.1, 2.2, 2.3 learnings |
| 2026-01-16 | Implementation complete - all 6 tasks done, 22 new tests added, 135 total tests passing |
| 2026-01-16 | Code review complete - 6 issues fixed, 4 new tests added, 139 total tests passing |

## Senior Developer Review (AI)

### Review Date: 2026-01-16

### Review Outcome: ✅ APPROVED

### Issues Found and Fixed

| # | Severity | Issue | Resolution |
|---|----------|-------|------------|
| 1 | MEDIUM | Pre-emptive stall logging - logged "sent" before send completed | Moved log to after successful send |
| 2 | MEDIUM | Missing recovery send failure test | Added 2 tests for `price_recovered_send_failed` event path |
| 3 | MEDIUM | Trivial sleep test assertion `expect(true).toBe(true)` | Improved test to verify promise state |
| 4 | LOW | sleep utility lacked input validation for negative values | Added `Math.max(0, ms)` guard |
| 5 | LOW | Event name inconsistency (`_send_error` vs `_send_failed`) | Standardized to `price_send_failed` |
| 6 | LOW | Missing sleep edge case tests | Added tests for `sleep(0)` and negative values |

### Verification

- All 139 tests passing (42 price handler + 97 existing)
- Build compiles successfully
- All ACs verified as implemented
- All [x] tasks confirmed as done
- No security vulnerabilities
- Safety-critical requirement met: Never sends wrong price
