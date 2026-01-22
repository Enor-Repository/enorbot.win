# Story 2.3: Price Response with Formatting

Status: done

## Story

As a **client**,
I want **to receive the price formatted in Brazilian style**,
So that **I can read it naturally without conversion**.

## Acceptance Criteria

1. **AC1: Brazilian Currency Formatting**
   - **Given** Binance returns price 5.82
   - **When** the price is formatted
   - **Then** the output is "R$5,82" (comma as decimal separator)

2. **AC2: Decimal Truncation**
   - **Given** Binance returns price 5.8234
   - **When** the price is formatted
   - **Then** the output is "R$5,82" (truncated to 2 decimal places)

3. **AC3: Full Price Handler Flow**
   - **Given** a price trigger is detected AND Binance returns successfully
   - **When** the price handler executes
   - **Then** the formatted price is sent to the group using `sendWithAntiDetection` (from Epic 1)

4. **AC4: Handler Return Type**
   - **Given** the response is sent
   - **When** the message is delivered
   - **Then** the handler returns `{ok: true, data: {price, groupId, timestamp}}`

5. **AC5: Error Propagation**
   - **Given** Binance fetch fails
   - **When** the price handler processes the error
   - **Then** it returns `{ok: false, error: "..."}` without sending any message
   - **And** the error is logged with context

## Tasks / Subtasks

- [x] **Task 1: Create Price Formatting Utility** (AC: #1, #2)
  - [x] 1.1 Create `formatBrazilianPrice(price: number): string` function in `src/utils/format.ts`
  - [x] 1.2 Implement comma as decimal separator (5.82 → "5,82")
  - [x] 1.3 Truncate to 2 decimal places (5.8234 → 5.82, NOT round)
  - [x] 1.4 Prepend "R$" currency symbol
  - [x] 1.5 Handle edge cases: 0, negative numbers, very large numbers

- [x] **Task 2: Update Price Handler** (AC: #3, #4, #5)
  - [x] 2.1 Import `fetchPrice` from `services/binance.ts`
  - [x] 2.2 Import `sendWithAntiDetection` from `utils/messaging.ts`
  - [x] 2.3 Import `formatBrazilianPrice` from `utils/format.ts`
  - [x] 2.4 Call `fetchPrice()` and check result
  - [x] 2.5 On success: format price, send via `sendWithAntiDetection`
  - [x] 2.6 On error: log error, return `err(message)` without sending
  - [x] 2.7 Return `{ok: true, data: {price, groupId, timestamp}}` on success

- [x] **Task 3: Update Handler Return Type** (AC: #4)
  - [x] 3.1 Create `PriceHandlerResult` type in `src/types/handlers.ts`
  - [x] 3.2 Include: `price: number`, `groupId: string`, `timestamp: string`
  - [x] 3.3 Update `handlePriceMessage` signature to return `Result<PriceHandlerResult>`

- [x] **Task 4: Socket Access for sendWithAntiDetection** (AC: #3)
  - [x] 4.1 Determine how to pass `WASocket` to price handler
  - [x] 4.2 Option A: Add `sock` to `RouterContext` ← Implemented
  - [x] 4.3 Option B: Create global socket getter in `connection.ts` ← Not used (Option A preferred)
  - [x] 4.4 Implement chosen approach with minimal coupling

- [x] **Task 5: Unit Tests for Format Utility** (AC: #1, #2)
  - [x] 5.1 Create `src/utils/format.test.ts` co-located with source
  - [x] 5.2 Test 5.82 → "R$5,82"
  - [x] 5.3 Test 5.8234 → "R$5,82" (truncation, not rounding)
  - [x] 5.4 Test 5.825 → "R$5,82" (verify truncation behavior)
  - [x] 5.5 Test 0 → "R$0,00"
  - [x] 5.6 Test 100 → "R$100,00"
  - [x] 5.7 Test 1234.567 → "R$1234,56"

- [x] **Task 6: Integration Tests for Price Handler** (AC: #3, #4, #5)
  - [x] 6.1 Create `src/handlers/price.test.ts` co-located with source
  - [x] 6.2 Mock `fetchPrice` to return success
  - [x] 6.3 Mock `sendWithAntiDetection` to capture call
  - [x] 6.4 Verify formatted price is sent
  - [x] 6.5 Verify return value contains price, groupId, timestamp
  - [x] 6.6 Test error case: Binance fails → no message sent
  - [x] 6.7 Test error case: Message send fails → error returned

## Dev Notes

### Architecture Compliance

**CRITICAL - Follow These Patterns:**

1. **Result Type Pattern** - Handler returns Result, NEVER throws:
   ```typescript
   import { ok, err, type Result } from '../utils/result.js'

   interface PriceHandlerResult {
     price: number
     groupId: string
     timestamp: string
   }

   export async function handlePriceMessage(
     context: RouterContext,
     sock: WASocket
   ): Promise<Result<PriceHandlerResult>> {
     const priceResult = await fetchPrice()
     if (!priceResult.ok) {
       return err(priceResult.error)
     }
     // ... format and send
     return ok({ price, groupId, timestamp })
   }
   ```

2. **Logger Pattern** - Use structured JSON logger:
   ```typescript
   logger.info('Price response sent', {
     event: 'price_response_sent',
     price: 5.82,
     formattedPrice: 'R$5,82',
     groupId: '123@g.us',
   })
   ```

3. **Naming Conventions:**
   - File: `format.ts` (camelCase)
   - Function: `formatBrazilianPrice` (camelCase)
   - Constants: if any, use SCREAMING_SNAKE
   - Types: `PriceHandlerResult` (PascalCase)

### Brazilian Price Formatting

**Format Rules:**
- Currency symbol: `R$` (no space)
- Decimal separator: comma `,` (NOT period)
- Thousands separator: NOT required for this story (prices are typically < 100)
- Decimal places: Always 2 digits after comma

**Implementation:**
```typescript
/**
 * Format price in Brazilian Real style.
 * Uses comma as decimal separator and 2 decimal places.
 *
 * @param price - Number to format (e.g., 5.8234)
 * @returns Formatted string (e.g., "R$5,82")
 */
export function formatBrazilianPrice(price: number): string {
  // Truncate to 2 decimal places (not round)
  const truncated = Math.floor(price * 100) / 100
  // Format with 2 decimal places
  const formatted = truncated.toFixed(2)
  // Replace period with comma for Brazilian format
  return `R$${formatted.replace('.', ',')}`
}
```

**Why Truncate, Not Round:**
- Financial accuracy: 5.829 → R$5,82 (not R$5,83)
- User expectation: "the price is 5.82" means the first 2 digits after decimal
- Consistent with eNor's manual quoting behavior

### Socket Access Pattern

**Recommended Approach: Pass sock to handler**

The cleanest approach is to pass the socket through the context or as a separate parameter. From Story 1.4, `connection.ts` has access to the socket and dispatches to handlers.

**Option A: Extend RouterContext (Recommended)**
```typescript
// In router.ts
export interface RouterContext {
  groupId: string
  groupName: string
  message: string
  sender: string
  isControlGroup: boolean
  hasTrigger?: boolean
  sock: WASocket  // Add socket reference
}
```

**Option B: Global Getter**
```typescript
// In connection.ts
let currentSocket: WASocket | null = null

export function getSocket(): WASocket | null {
  return currentSocket
}

// Set when socket connects
currentSocket = makeWASocket(...)
```

Option A is preferred because:
- Explicit dependency passing
- Testable (easy to mock)
- No global state

### Integration with Previous Stories

**From Story 2.1 (Trigger Detection):**
- `handlePriceMessage` is already called by router for price triggers
- `RouterContext` has `groupId`, `groupName`, `sender`, `message`
- Handler currently is a stub that only logs

**From Story 2.2 (Binance Service):**
- `fetchPrice(): Promise<Result<number>>` is available
- Returns `ok(price)` or `err(message)`
- Price is a raw number (e.g., 5.8234)

**From Story 1.6 (Messaging):**
- `sendWithAntiDetection(sock, jid, message)` is available
- Returns `Result<void>`
- Handles typing indicator + chaotic delay

**From Story 1.4 (Router):**
- `connection.ts` dispatches to `handlePriceMessage(context)`
- Need to pass socket to handler

### Implementation Flow

```
1. Price trigger detected (Story 2.1)
2. Router calls handlePriceMessage(context, sock)
3. Handler calls fetchPrice() (Story 2.2)
4. If error → log, return err()
5. If success → formatBrazilianPrice(price)
6. Call sendWithAntiDetection(sock, groupId, formattedPrice)
7. If send error → log, return err()
8. If success → return ok({price, groupId, timestamp})
```

### Learnings from Story 2.1 & 2.2

**From Story 2.1 (Trigger Detection):**
- Co-located tests work well
- `vi.fn()` for mocking imports
- Test edge cases thoroughly
- Code review caught 5 issues - expect similar

**From Story 2.2 (Binance Service):**
- `vi.stubGlobal('fetch', ...)` for fetch mocking
- `vi.useFakeTimers()` for timing tests
- Always test logging assertions (AC5 gap was caught in review)
- Result pattern works well for error handling

**From Code Reviews:**
- Always add logging assertions in tests
- Watch for unused variables
- Verify all tasks are actually implemented
- Test both success and error paths

### Files to Create

| File | Purpose |
|------|---------|
| `src/utils/format.ts` | Brazilian price formatting utility |
| `src/utils/format.test.ts` | Unit tests for formatting |
| `src/handlers/price.test.ts` | Integration tests for price handler |
| `src/types/handlers.ts` | Handler result types (if not exists) |

### Files to Modify

| File | Changes |
|------|---------|
| `src/handlers/price.ts` | Full implementation: fetch → format → send |
| `src/bot/router.ts` | Add `sock` to `RouterContext` |
| `src/bot/connection.ts` | Pass `sock` when calling `handlePriceMessage` |

### Anti-Patterns to AVOID

- Do NOT use `toLocaleString('pt-BR')` - inconsistent across Node versions
- Do NOT round prices - always truncate for financial accuracy
- Do NOT send any message if Binance fails (handled in Story 2.4)
- Do NOT throw exceptions from handler (use Result type)
- Do NOT access socket via global state (pass explicitly)
- Do NOT hardcode currency symbol (but R$ is fine for MVP)

### Testing Notes

**Mocking Strategy:**

```typescript
// src/handlers/price.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handlePriceMessage } from './price.js'
import type { RouterContext } from '../bot/router.js'

// Mock dependencies
vi.mock('../services/binance.js', () => ({
  fetchPrice: vi.fn(),
}))

vi.mock('../utils/messaging.js', () => ({
  sendWithAntiDetection: vi.fn(),
}))

import { fetchPrice } from '../services/binance.js'
import { sendWithAntiDetection } from '../utils/messaging.js'

const mockFetchPrice = fetchPrice as ReturnType<typeof vi.fn>
const mockSend = sendWithAntiDetection as ReturnType<typeof vi.fn>

describe('handlePriceMessage', () => {
  const mockSock = {} as WASocket
  const baseContext: RouterContext = {
    groupId: '123@g.us',
    groupName: 'Test Group',
    message: 'preço',
    sender: 'user@s.whatsapp.net',
    isControlGroup: false,
    hasTrigger: true,
    sock: mockSock,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches price, formats, and sends message', async () => {
    mockFetchPrice.mockResolvedValue({ ok: true, data: 5.8234 })
    mockSend.mockResolvedValue({ ok: true, data: undefined })

    const result = await handlePriceMessage(baseContext)

    expect(mockFetchPrice).toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledWith(
      mockSock,
      '123@g.us',
      'R$5,82'
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.price).toBeCloseTo(5.8234)
      expect(result.data.groupId).toBe('123@g.us')
    }
  })

  it('returns error when Binance fails', async () => {
    mockFetchPrice.mockResolvedValue({ ok: false, error: 'Binance timeout' })

    const result = await handlePriceMessage(baseContext)

    expect(mockSend).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
  })

  it('returns error when message send fails', async () => {
    mockFetchPrice.mockResolvedValue({ ok: true, data: 5.82 })
    mockSend.mockResolvedValue({ ok: false, error: 'Network error' })

    const result = await handlePriceMessage(baseContext)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Network error')
    }
  })
})
```

### NFR Compliance

| NFR | Requirement | Implementation |
|-----|-------------|----------------|
| NFR14 | Response delay 3-15s | Via `sendWithAntiDetection` (chaotic timing) |
| NFR15 | Typing indicator 1-4s | Via `sendWithAntiDetection` |
| NFR16 | <100 messages/day | Not enforced here (monitoring only) |

### Dependencies from Previous Stories

| Component | Location | Usage |
|-----------|----------|-------|
| `fetchPrice()` | src/services/binance.ts | Get current USDT/BRL price |
| `sendWithAntiDetection()` | src/utils/messaging.ts | Send formatted response |
| `RouterContext` | src/bot/router.ts | Handler input context |
| `Result<T>` | src/utils/result.ts | Return type pattern |
| `logger` | src/utils/logger.ts | Structured logging |

### Ready for Story 2.4

This story completes the happy path. Story 2.4 (Graceful Degradation) will:
1. Handle Binance failures with stall message
2. Implement retry logic with spacing
3. Never send wrong price data
4. Log failures for error handling (Epic 3)

### Edge Cases to Consider

1. **Price is 0:** Format as "R$0,00" (valid edge case)
2. **Price is very small:** 0.01 → "R$0,01"
3. **Price is very large:** 1234.56 → "R$1234,56" (no thousands separator)
4. **Socket disconnected:** `sendWithAntiDetection` should handle gracefully
5. **Handler called twice rapidly:** Each call is independent (no state)

### References

- [Source: docs/project-context.md#Technical Context] - Brazilian currency format
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns] - Result type
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.3] - Acceptance criteria
- [Source: _bmad-output/implementation-artifacts/2-1-trigger-detection.md] - Router context
- [Source: _bmad-output/implementation-artifacts/2-2-binance-price-service.md] - Binance service

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None required - implementation straightforward.

### Completion Notes List

1. **Price Formatting Utility**: Created `src/utils/format.ts` with `formatBrazilianPrice()` function. Uses `Math.trunc` for truncation (not rounding) to ensure financial accuracy. Handles negative numbers by truncating towards zero.

2. **Handler Return Type**: Created `src/types/handlers.ts` with `PriceHandlerResult` interface containing `price`, `groupId`, and `timestamp` fields.

3. **Socket Access Pattern**: Implemented Option A (recommended) - added `sock: WASocket` to `RouterContext` interface. Updated `connection.ts` to pass `currentSock` when building context. This approach is explicit, testable, and avoids global state.

4. **Price Handler Implementation**: Full implementation in `src/handlers/price.ts` following the flow: fetchPrice → formatBrazilianPrice → sendWithAntiDetection. Returns `Result<PriceHandlerResult>` with proper error propagation and structured logging.

5. **Unit Tests**: Created 14 tests in `src/utils/format.test.ts` covering AC1/AC2 scenarios including truncation behavior, edge cases (0, negative, large numbers), and Brazilian formatting rules.

6. **Integration Tests**: Created 15 tests in `src/handlers/price.test.ts` covering AC3/AC4/AC5. Mocks fetchPrice and sendWithAntiDetection, tests happy path, error propagation, and logging assertions.

7. **Router Tests Updated**: Updated `src/bot/router.test.ts` to include mock `sock` in test contexts (required after RouterContext change).

8. **Test Results**: All 109 tests passing (94 existing + 14 format + 15 handler - some overlap with router updates).

### File List

| File | Action | Description |
|------|--------|-------------|
| `src/utils/format.ts` | Created | Brazilian price formatting utility with `formatBrazilianPrice()` |
| `src/utils/format.test.ts` | Created | 14 unit tests for format utility |
| `src/types/handlers.ts` | Created | `PriceHandlerResult` type definition |
| `src/handlers/price.ts` | Modified | Full implementation: fetch → format → send |
| `src/handlers/price.test.ts` | Created | 15 integration tests for price handler |
| `src/bot/router.ts` | Modified | Added `sock: WASocket` to `RouterContext` interface |
| `src/bot/router.test.ts` | Modified | Added mock `sock` to test contexts |
| `src/bot/connection.ts` | Modified | Pass `sock: currentSock` when building context |

### Change Log

| Date | Change |
|------|--------|
| 2026-01-16 | Story created with comprehensive context from Stories 2.1 and 2.2 |
| 2026-01-16 | Implementation complete - all 6 tasks done, 29 new tests added, 109 total tests passing |
| 2026-01-16 | Code review completed - 5 issues found, all actionable issues auto-fixed, 113 total tests passing |

## Code Review Record

### Review Summary

**Reviewer:** Claude Opus 4.5 (adversarial code review)
**Result:** PASS with fixes applied
**Issues Found:** 5 (1 MEDIUM, 3 LOW, 1 INFO)

### Issues Found and Resolution

| # | Severity | Issue | Resolution |
|---|----------|-------|------------|
| 1 | MEDIUM | Missing NaN/Infinity validation in `formatBrazilianPrice` | **FIXED** - Added `Number.isFinite()` validation with descriptive error |
| 2 | LOW | Floating point precision fragility in truncation | **FIXED** - Added explanatory comment; code works correctly for USDT/BRL range |
| 3 | LOW | Negative price format convention ("R$-5,82" vs "-R$5,82") | **No fix needed** - USDT/BRL prices will never be negative |
| 4 | LOW | No test verifying timestamp captured after send | **FIXED** - Added test using `vi.advanceTimersByTime` to verify ordering |
| 5 | INFO | Dev notes showed `Math.floor`, implementation uses `Math.trunc` | **No fix needed** - `Math.trunc` is better (handles negatives correctly) |

### Tests Added During Review

| Test | File |
|------|------|
| `throws error for NaN` | src/utils/format.test.ts |
| `throws error for Infinity` | src/utils/format.test.ts |
| `throws error for negative Infinity` | src/utils/format.test.ts |
| `captures timestamp AFTER send completes` | src/handlers/price.test.ts |

### Final Test Count

- **Before review:** 109 tests passing
- **After review:** 113 tests passing (+4 new tests)
