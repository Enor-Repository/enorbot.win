# Story 2.2: Binance Price Service

Status: done

## Story

As a **developer**,
I want **a service that fetches USDT/BRL spot price from Binance**,
So that **the bot has accurate, real-time pricing data**.

## Acceptance Criteria

1. **AC1: Successful Price Fetch**
   - **Given** the Binance public API is available
   - **When** `fetchPrice()` is called
   - **Then** it returns `{ok: true, data: number}` with the current USDT/BRL rate

2. **AC2: Fast Response (NFR10 Compliance)**
   - **Given** the Binance API responds within 2 seconds
   - **When** the request completes
   - **Then** the price is returned immediately

3. **AC3: Timeout Handling**
   - **Given** the Binance API does NOT respond within 2 seconds
   - **When** the timeout triggers
   - **Then** it returns `{ok: false, error: "Binance timeout"}`

4. **AC4: API Error Handling**
   - **Given** the Binance API returns an error
   - **When** the request fails
   - **Then** it returns `{ok: false, error: "..."}` with the error message
   - **And** the error is logged via structured logger

5. **AC5: Latency Monitoring**
   - **Given** the service is called
   - **When** any outcome occurs (success, timeout, or error)
   - **Then** the latency is logged for monitoring

## Tasks / Subtasks

- [x] **Task 1: Create Binance Service Module** (AC: #1, #2, #3, #4, #5)
  - [x] 1.1 Create `src/services/binance.ts` following architecture patterns
  - [x] 1.2 Define `BINANCE_API_URL` constant for USDT/BRL endpoint
  - [x] 1.3 Define `BINANCE_TIMEOUT_MS = 2000` constant (NFR10)
  - [x] 1.4 Implement `fetchPrice(): Promise<Result<number>>` function
  - [x] 1.5 Use native `fetch` with `AbortController` for timeout
  - [x] 1.6 Parse price from Binance response and return as number

- [x] **Task 2: Implement Timeout Mechanism** (AC: #3)
  - [x] 2.1 Create `AbortController` with 2-second timeout
  - [x] 2.2 Pass `signal` to fetch options
  - [x] 2.3 Handle `AbortError` to return timeout-specific error
  - [x] 2.4 Clean up timeout on successful response

- [x] **Task 3: Error Handling with Result Pattern** (AC: #4)
  - [x] 3.1 Import `ok`, `err` from `utils/result.ts`
  - [x] 3.2 Return `ok(price)` on success
  - [x] 3.3 Return `err("Binance timeout")` on timeout
  - [x] 3.4 Return `err(message)` on API errors
  - [x] 3.5 NEVER throw exceptions - always return Result

- [x] **Task 4: Structured Logging** (AC: #5)
  - [x] 4.1 Log start time before fetch
  - [x] 4.2 Calculate latency after response
  - [x] 4.3 Log success: `logger.info('Binance price fetched', { event, price, latencyMs })`
  - [x] 4.4 Log timeout: `logger.warn('Binance timeout', { event, latencyMs })`
  - [x] 4.5 Log error: `logger.error('Binance fetch failed', { event, error, latencyMs })`

- [x] **Task 5: Zod Validation for Response** (AC: #1, #4)
  - [x] 5.1 Create Zod schema for Binance ticker response
  - [x] 5.2 Validate response structure before parsing price
  - [x] 5.3 Return validation error if response doesn't match expected shape
  - [x] 5.4 Export `BinanceTickerResponse` type (co-located in binance.ts for encapsulation)

- [x] **Task 6: Unit Tests** (AC: #1, #2, #3, #4, #5)
  - [x] 6.1 Create `src/services/binance.test.ts` co-located with source
  - [x] 6.2 Test successful fetch returns price number
  - [x] 6.3 Test 2-second timeout returns error
  - [x] 6.4 Test API error returns error with message
  - [x] 6.5 Test invalid response format returns validation error
  - [x] 6.6 Test latency is logged for all outcomes
  - [x] 6.7 Mock fetch using `vi.fn()` or `vi.stubGlobal('fetch', ...)`

## Dev Notes

### Architecture Compliance

**CRITICAL - Follow These Patterns:**

1. **Result Type Pattern** - Services return Result, NEVER throw:
   ```typescript
   import { ok, err, type Result } from '../utils/result.js'

   export async function fetchPrice(): Promise<Result<number>> {
     try {
       // ... fetch logic
       return ok(price)
     } catch (e) {
       return err(e.message)
     }
   }
   ```

2. **Logger Pattern** - Use structured JSON logger:
   ```typescript
   logger.info('Binance price fetched', {
     event: 'binance_price_fetched',
     price: 5.82,
     latencyMs: 342,
   })
   ```

3. **Naming Conventions:**
   - File: `binance.ts` (camelCase)
   - Function: `fetchPrice` (camelCase)
   - Constants: `BINANCE_API_URL`, `BINANCE_TIMEOUT_MS` (SCREAMING_SNAKE)
   - Types: `BinanceTickerResponse` (PascalCase)

### Binance API Details

**Endpoint:** `https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL`

**Response Format:**
```json
{
  "symbol": "USDTBRL",
  "price": "5.82340000"
}
```

**Important Notes:**
- Public API - no authentication required
- Rate limit: 1200 requests/minute (we're using <100/day)
- Price is returned as STRING, must convert to number
- Symbol is USDTBRL (not USDT/BRL or USDT-BRL)

### Implementation Example

```typescript
// src/services/binance.ts
import { z } from 'zod'
import { ok, err, type Result } from '../utils/result.js'
import { logger } from '../utils/logger.js'

export const BINANCE_API_URL = 'https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL'
export const BINANCE_TIMEOUT_MS = 2000 // NFR10: <2s or fallback

const BinanceTickerSchema = z.object({
  symbol: z.string(),
  price: z.string(),
})

export type BinanceTickerResponse = z.infer<typeof BinanceTickerSchema>

/**
 * Fetch current USDT/BRL spot price from Binance.
 * Returns Result type - never throws.
 */
export async function fetchPrice(): Promise<Result<number>> {
  const startTime = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), BINANCE_TIMEOUT_MS)

  try {
    const response = await fetch(BINANCE_API_URL, {
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    const latencyMs = Date.now() - startTime

    if (!response.ok) {
      logger.error('Binance API error', {
        event: 'binance_api_error',
        status: response.status,
        latencyMs,
      })
      return err(`Binance API error: ${response.status}`)
    }

    const data = await response.json()
    const parsed = BinanceTickerSchema.safeParse(data)

    if (!parsed.success) {
      logger.error('Binance response validation failed', {
        event: 'binance_validation_error',
        error: parsed.error.message,
        latencyMs,
      })
      return err('Invalid Binance response format')
    }

    const price = parseFloat(parsed.data.price)

    logger.info('Binance price fetched', {
      event: 'binance_price_fetched',
      price,
      latencyMs,
    })

    return ok(price)
  } catch (error) {
    clearTimeout(timeoutId)
    const latencyMs = Date.now() - startTime

    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn('Binance timeout', {
        event: 'binance_timeout',
        latencyMs,
        timeoutMs: BINANCE_TIMEOUT_MS,
      })
      return err('Binance timeout')
    }

    logger.error('Binance fetch failed', {
      event: 'binance_fetch_error',
      error: error instanceof Error ? error.message : String(error),
      latencyMs,
    })
    return err(error instanceof Error ? error.message : 'Unknown error')
  }
}
```

### Timeout Implementation

**Why AbortController:**
- Native browser/Node.js API
- No external dependencies
- Clean abort semantics
- Works with fetch natively

```typescript
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), 2000)

try {
  const response = await fetch(url, { signal: controller.signal })
  clearTimeout(timeoutId) // Clean up on success
  // ...
} catch (e) {
  clearTimeout(timeoutId) // Clean up on any error
  if (e.name === 'AbortError') {
    // Timeout specific handling
  }
}
```

### Learnings from Story 2.1

**From Trigger Detection:**
- Co-located tests with `vi.fn()` mocking
- Export constants for test access
- Pure functions are easy to test
- Result pattern works well for services

**From Code Review Issues:**
- Verify all tasks are actually implemented
- Add assertions for edge cases
- Watch for inconsistent field enrichment
- Remove redundant operations

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/binance.ts` | Binance price fetching service |
| `src/services/binance.test.ts` | Unit tests for price service |

### Files to Modify

| File | Changes |
|------|---------|
| `src/types/services.ts` | Add `BinanceTickerResponse` type (if not using inline) |

### Testing Notes

**Mocking fetch in Vitest:**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchPrice, BINANCE_API_URL, BINANCE_TIMEOUT_MS } from './binance.js'

describe('fetchPrice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns price on successful fetch', async () => {
    const mockResponse = { symbol: 'USDTBRL', price: '5.82340000' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }))

    const result = await fetchPrice()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toBeCloseTo(5.8234)
    }
  })

  it('returns timeout error after 2 seconds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(
      () => new Promise((_, reject) => {
        setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 3000)
      })
    ))

    const resultPromise = fetchPrice()
    vi.advanceTimersByTime(2000) // Trigger timeout

    const result = await resultPromise

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Binance timeout')
    }
  })

  it('returns error on API failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }))

    const result = await fetchPrice()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('500')
    }
  })

  it('returns error on invalid response format', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ invalid: 'data' }),
    }))

    const result = await fetchPrice()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Invalid')
    }
  })
})
```

### NFR Compliance

| NFR | Requirement | Implementation |
|-----|-------------|----------------|
| NFR10 | Binance <2s or fallback | `BINANCE_TIMEOUT_MS = 2000` with AbortController |
| NFR13 | All API failures logged | Structured logging for all error paths |

### Dependencies from Previous Stories

| Component | Location | Usage |
|-----------|----------|-------|
| Result type | src/utils/result.ts | Return type for fetchPrice |
| Logger | src/utils/logger.ts | Structured logging |
| isPriceTrigger | src/utils/triggers.ts | Story 2.1 - triggers call to this service |
| handlePriceMessage | src/handlers/price.ts | Will call fetchPrice in Story 2.3 |

### Ready for Story 2.3

This story creates the price fetching service. Story 2.3 (Price Response with Formatting) will:
1. Call `fetchPrice()` from price handler
2. Format the price as R$X,XX
3. Send response via `sendWithAntiDetection`
4. Handle Result error case

### Anti-Patterns to AVOID

- Do NOT cache Binance prices (always real-time)
- Do NOT throw exceptions (use Result pattern)
- Do NOT use external timeout libraries (native AbortController)
- Do NOT log actual API keys or sensitive data
- Do NOT ignore latency logging (critical for monitoring)
- Do NOT hardcode magic numbers (use named constants)

### References

- [Source: docs/project-context.md#Technical Context] - Binance Public API
- [Source: _bmad-output/planning-artifacts/architecture.md#Error Handling Pattern] - Result type
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.2] - Acceptance criteria
- [Source: _bmad-output/implementation-artifacts/2-1-trigger-detection.md] - Previous story patterns
- [Source: Binance API Docs] - https://binance-docs.github.io/apidocs/spot/en/#symbol-price-ticker

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None required - implementation straightforward.

### Completion Notes List

1. **Binance Service Module**: Created `src/services/binance.ts` with `fetchPrice()` function, `BINANCE_API_URL` and `BINANCE_TIMEOUT_MS` constants. Uses native `fetch` with `AbortController` for 2-second timeout (NFR10 compliant).

2. **Result Pattern**: Function returns `Result<number>` type, never throws. All error paths return `err(message)`, success returns `ok(price)`.

3. **Zod Validation**: Created `BinanceTickerSchema` to validate API response structure. Returns validation error if response doesn't match `{ symbol: string, price: string }` shape.

4. **Structured Logging**: All outcomes log latency. Events: `binance_price_fetched` (info), `binance_timeout` (warn), `binance_api_error`, `binance_validation_error`, `binance_parse_error`, `binance_fetch_error` (error).

5. **NaN Price Handling**: Added validation for `parseFloat` result - returns error if price string cannot be parsed to valid number.

6. **Unit Tests**: Created 19 tests in `src/services/binance.test.ts` covering all ACs:
   - AC1: Successful fetch (2 tests)
   - AC2: Fast response verification (1 test)
   - AC3: Timeout handling (2 tests)
   - AC4: API errors, validation, network (6 tests)
   - AC5: Logging verification (5 tests)
   - Result pattern compliance (1 test)
   - Constants verification (2 tests)

7. **Test Results**: 79 total tests passing (19 binance + 60 existing). Build compiles successfully.

### File List

| File | Action | Description |
|------|--------|-------------|
| `src/services/binance.ts` | Created | Binance price service with fetchPrice(), timeout, Zod validation, Result pattern |
| `src/services/binance.test.ts` | Created | 19 unit tests covering all acceptance criteria |

### Change Log

| Date | Change |
|------|--------|
| 2026-01-16 | Story created with comprehensive Binance API context and patterns |
| 2026-01-16 | Implementation complete - all 6 tasks done, 19 new tests added, 79 total tests passing |
| 2026-01-16 | Code review complete - 5 issues fixed, 20 binance tests, 80 total tests passing |

## Senior Developer Review (AI)

### Review Date: 2026-01-16

### Review Outcome: ✅ APPROVED

### Issues Found and Fixed

| # | Severity | Issue | Resolution |
|---|----------|-------|------------|
| 1 | MEDIUM | Missing test for `binance_parse_error` logging (AC5 gap) | Added logging assertion to NaN price test |
| 2 | MEDIUM | Task 5.4 specification mismatch | Updated task description to reflect inline export |
| 3 | LOW | Unused `startTime` variable in test | Removed unused variable |
| 4 | LOW | Missing test for symbol field validation | Added test for invalid symbol type |
| 5 | LOW | Test coverage gap for Zod error message | Added `error` field assertion in validation test |

### Issues Not Fixed (Acceptable)

| # | Severity | Issue | Reason |
|---|----------|-------|--------|
| 6 | LOW | BinanceTickerSchema not exported | Design choice - encapsulation is preferred |
| 7 | LOW | No User-Agent header | API works without it, adds unnecessary complexity |

### Verification

- All 80 tests passing (20 binance + 60 existing)
- Build compiles successfully
- All ACs verified as implemented
- All [x] tasks confirmed as done
