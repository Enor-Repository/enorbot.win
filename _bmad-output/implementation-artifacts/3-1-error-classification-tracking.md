# Story 3.1: Error Classification & Tracking

Status: done

## Story

As a **developer**,
I want **errors classified as transient or critical**,
So that **the system knows how to respond appropriately**.

## Acceptance Criteria

1. **AC1: Binance Transient Errors**
   - **Given** Binance API returns a timeout or 5xx error
   - **When** the error is classified
   - **Then** it is marked as "transient" (recoverable)
   - **And** logged with `event: 'error_classified'`, `classification: 'transient'`

2. **AC2: Consecutive Failure Escalation**
   - **Given** Binance API returns consistent failures (3+ in a row)
   - **When** the error is classified
   - **Then** it is escalated to "critical" (unrecoverable without intervention)
   - **And** logged with `event: 'error_escalated'`, `from: 'transient'`, `to: 'critical'`

3. **AC3: WhatsApp Connection Drop**
   - **Given** WhatsApp connection drops (DisconnectReason != loggedOut/banned)
   - **When** the error is classified
   - **Then** it is marked as "transient" (auto-reconnect will handle)
   - **And** logged with `event: 'error_classified'`, `source: 'whatsapp'`

4. **AC4: WhatsApp Critical Errors**
   - **Given** WhatsApp returns "logged out" (DisconnectReason.loggedOut) or "banned" status
   - **When** the error is classified
   - **Then** it is marked as "critical" (requires manual intervention)
   - **And** logged with `event: 'error_classified'`, `classification: 'critical'`

5. **AC5: Error Logging Format (NFR13)**
   - **Given** any error occurs
   - **When** it is logged
   - **Then** the log includes: error type, classification, timestamp, context
   - **And** follows structured JSON logger pattern

## Tasks / Subtasks

- [x] **Task 1: Define Error Classification Types** (AC: #1, #2, #3, #4)
  - [x] 1.1 Create `src/services/errors.ts` for error classification system
  - [x] 1.2 Define `ErrorClassification` type: `'transient' | 'critical'`
  - [x] 1.3 Define `ErrorSource` type: `'binance' | 'whatsapp' | 'excel' | 'supabase'`
  - [x] 1.4 Define `ClassifiedError` interface with type, classification, source, timestamp, context
  - [x] 1.5 Export types for use in handlers and state

- [x] **Task 2: Create Error Classifier Functions** (AC: #1, #3, #4)
  - [x] 2.1 Implement `classifyBinanceError(error: string): ErrorClassification`
  - [x] 2.2 Binance timeout → transient
  - [x] 2.3 Binance 5xx (500, 502, 503, 504) → transient
  - [x] 2.4 Binance 4xx (400, 401, 403, 404, 429) → critical (config/rate limit issue)
  - [x] 2.5 Implement `classifyWhatsAppError(disconnectReason: DisconnectReason): ErrorClassification`
  - [x] 2.6 WhatsApp loggedOut → critical
  - [x] 2.7 WhatsApp banned (DisconnectReason.forbidden) → critical
  - [x] 2.8 All other WhatsApp disconnects → transient

- [x] **Task 3: Implement Error Tracker** (AC: #2)
  - [x] 3.1 Create `ErrorTracker` class/module to track consecutive failures
  - [x] 3.2 Track failures per source (binance, whatsapp)
  - [x] 3.3 Implement `recordFailure(source, error)` method
  - [x] 3.4 Implement `recordSuccess(source)` method to reset counter
  - [x] 3.5 Implement `shouldEscalate(source): boolean` (3+ consecutive failures)
  - [x] 3.6 Add `ESCALATION_THRESHOLD = 3` constant
  - [x] 3.7 Export tracker instance and functions for testing

- [x] **Task 4: Create Classified Error Logging** (AC: #5)
  - [x] 4.1 Implement `logClassifiedError(error: ClassifiedError)` function
  - [x] 4.2 Include all required fields: type, classification, timestamp, context
  - [x] 4.3 Use structured logger pattern (`event: 'error_classified'`)
  - [x] 4.4 Log escalation events separately (`event: 'error_escalated'`)
  - [x] 4.5 Ensure all error paths use classified logging

- [x] **Task 5: Integrate with Existing Error Paths** (AC: #1, #3, #4)
  - [x] 5.1 Add classification to `price_unavailable_after_retries` event in price.ts
  - [x] 5.2 Add classification to WhatsApp connection close in connection.ts
  - [x] 5.3 Add `recordSuccess('binance')` on successful Binance fetch in binance.ts (classification happens in consumer)
  - [x] 5.4 Track consecutive failures via ErrorTracker (in price.ts retry loop and connection.ts disconnect)
  - [x] 5.5 Reset tracker on successful operations (binance.ts, connection.ts)

- [x] **Task 6: Unit Tests** (AC: #1, #2, #3, #4, #5)
  - [x] 6.1 Create `src/services/errors.test.ts` co-located with source
  - [x] 6.2 Test Binance timeout → transient classification
  - [x] 6.3 Test Binance 5xx errors → transient classification
  - [x] 6.4 Test Binance 4xx errors → critical classification
  - [x] 6.5 Test WhatsApp loggedOut → critical classification
  - [x] 6.6 Test WhatsApp banned → critical classification
  - [x] 6.7 Test WhatsApp connection drop → transient classification
  - [x] 6.8 Test consecutive failure escalation (3+ → critical)
  - [x] 6.9 Test success resets failure counter
  - [x] 6.10 Test error logging format includes all required fields
  - [x] 6.11 Test escalation logging (from transient to critical)

## Dev Notes

### Architecture Compliance

**CRITICAL - Follow These Patterns:**

1. **Result Type Pattern** - Services return Result, NEVER throw:
   ```typescript
   // Error classification functions return values, don't throw
   export function classifyBinanceError(error: string): ErrorClassification {
     if (error.includes('timeout') || error.includes('5')) {
       return 'transient'
     }
     return 'critical'
   }
   ```

2. **Logger Pattern** - Use structured JSON logger:
   ```typescript
   logger.warn('Error classified', {
     event: 'error_classified',
     type: 'binance_timeout',
     classification: 'transient',
     source: 'binance',
     timestamp: new Date().toISOString(),
     context: { groupId, latencyMs },
   })

   logger.error('Error escalated', {
     event: 'error_escalated',
     source: 'binance',
     from: 'transient',
     to: 'critical',
     consecutiveFailures: 3,
     timestamp: new Date().toISOString(),
   })
   ```

3. **Naming Conventions:**
   - File: `errors.ts` (camelCase)
   - Functions: `classifyBinanceError`, `classifyWhatsAppError` (camelCase)
   - Constants: `ESCALATION_THRESHOLD` (SCREAMING_SNAKE)
   - Types: `ErrorClassification`, `ClassifiedError` (PascalCase)

### Error Classification Logic

**Binance Errors:**

| Error Type | Classification | Reason |
|------------|---------------|--------|
| Timeout (AbortError) | Transient | Network issue, will likely resolve |
| HTTP 500, 502, 503, 504 | Transient | Server issue, will recover |
| HTTP 400 | Critical | Invalid request - config bug |
| HTTP 401, 403 | Critical | Auth issue - needs intervention |
| HTTP 404 | Critical | Wrong endpoint - config bug |
| HTTP 429 | Critical | Rate limited - needs intervention |
| Network error | Transient | Temporary connectivity |
| Parse error (NaN) | Critical | Unexpected response format |
| Validation error | Critical | API contract changed |

**WhatsApp Errors (via DisconnectReason):**

| Disconnect Reason | Classification | Reason |
|------------------|---------------|--------|
| loggedOut (401) | Critical | Session invalid - re-auth required |
| forbidden (403) | Critical | Banned - manual intervention |
| connectionClosed | Transient | Network issue - auto-reconnect |
| connectionLost | Transient | Network issue - auto-reconnect |
| connectionReplaced | Critical | Another session took over |
| restartRequired | Transient | Server requested restart |
| timedOut | Transient | Connection timeout |

### Implementation Strategy

**Option A: Centralized Error Service (Recommended)**

Single `errors.ts` module with all classification logic:

```typescript
// src/services/errors.ts

import { DisconnectReason } from '@whiskeysockets/baileys'
import { logger } from '../utils/logger.js'

// Types
export type ErrorClassification = 'transient' | 'critical'
export type ErrorSource = 'binance' | 'whatsapp' | 'excel' | 'supabase'

export interface ClassifiedError {
  type: string
  classification: ErrorClassification
  source: ErrorSource
  timestamp: string
  context?: Record<string, unknown>
}

// Constants
export const ESCALATION_THRESHOLD = 3

// In-memory failure tracking
const failureCounts: Record<ErrorSource, number> = {
  binance: 0,
  whatsapp: 0,
  excel: 0,
  supabase: 0,
}

/**
 * Classify a Binance API error.
 */
export function classifyBinanceError(error: string): ErrorClassification {
  const lowerError = error.toLowerCase()

  // Transient: timeouts and 5xx errors
  if (lowerError.includes('timeout') || lowerError.includes('aborted')) {
    return 'transient'
  }
  if (/5\d\d/.test(error)) {
    return 'transient'
  }

  // Critical: 4xx errors, validation, parse errors
  if (/4\d\d/.test(error) || lowerError.includes('rate limit')) {
    return 'critical'
  }
  if (lowerError.includes('invalid') || lowerError.includes('nan')) {
    return 'critical'
  }

  // Default: network errors are transient
  if (lowerError.includes('network') || lowerError.includes('fetch')) {
    return 'transient'
  }

  return 'transient' // Default to transient for unknown
}

/**
 * Classify a WhatsApp disconnect reason.
 */
export function classifyWhatsAppError(reason: DisconnectReason): ErrorClassification {
  switch (reason) {
    case DisconnectReason.loggedOut:
    case DisconnectReason.forbidden:
    case DisconnectReason.connectionReplaced:
      return 'critical'
    default:
      return 'transient'
  }
}

/**
 * Record a failure for a source. Returns whether escalation is triggered.
 */
export function recordFailure(source: ErrorSource): boolean {
  failureCounts[source]++
  return failureCounts[source] >= ESCALATION_THRESHOLD
}

/**
 * Record a success, resetting the failure counter for a source.
 */
export function recordSuccess(source: ErrorSource): void {
  failureCounts[source] = 0
}

/**
 * Get current failure count for a source.
 */
export function getFailureCount(source: ErrorSource): number {
  return failureCounts[source]
}

/**
 * Reset all failure counters (for testing).
 */
export function resetAllCounters(): void {
  failureCounts.binance = 0
  failureCounts.whatsapp = 0
  failureCounts.excel = 0
  failureCounts.supabase = 0
}

/**
 * Log a classified error with full context.
 */
export function logClassifiedError(error: ClassifiedError): void {
  const logData = {
    event: 'error_classified',
    type: error.type,
    classification: error.classification,
    source: error.source,
    timestamp: error.timestamp,
    ...(error.context && { context: error.context }),
  }

  if (error.classification === 'critical') {
    logger.error('Error classified as critical', logData)
  } else {
    logger.warn('Error classified as transient', logData)
  }
}

/**
 * Log an error escalation event.
 */
export function logErrorEscalation(
  source: ErrorSource,
  consecutiveFailures: number
): void {
  logger.error('Error escalated to critical', {
    event: 'error_escalated',
    source,
    from: 'transient',
    to: 'critical',
    consecutiveFailures,
    timestamp: new Date().toISOString(),
  })
}
```

### Existing Events to Enhance

**From price.ts (Story 2.4):**
```typescript
// Current event - add classification
logger.error('Price unavailable after retries', {
  event: 'price_unavailable_after_retries',
  totalAttempts,
  groupId: context.groupId,
})

// Enhanced with classification (Story 3.1)
const classification = classifyBinanceError(lastError)
const shouldEscalate = recordFailure('binance')
if (shouldEscalate) {
  logErrorEscalation('binance', ESCALATION_THRESHOLD)
}
logClassifiedError({
  type: 'price_fetch_exhausted',
  classification: shouldEscalate ? 'critical' : classification,
  source: 'binance',
  timestamp: new Date().toISOString(),
  context: { totalAttempts, groupId: context.groupId },
})
```

**From connection.ts (Epic 1):**
```typescript
// Current logic
const shouldReconnect = statusCode !== DisconnectReason.loggedOut

// Enhanced with classification (Story 3.1)
import { classifyWhatsAppError, logClassifiedError, recordFailure } from '../services/errors.js'

const classification = classifyWhatsAppError(statusCode)
logClassifiedError({
  type: DisconnectReason[statusCode] || 'unknown_disconnect',
  classification,
  source: 'whatsapp',
  timestamp: new Date().toISOString(),
  context: { statusCode },
})
```

### Testing Strategy

**Mock Setup:**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DisconnectReason } from '@whiskeysockets/baileys'
import {
  classifyBinanceError,
  classifyWhatsAppError,
  recordFailure,
  recordSuccess,
  getFailureCount,
  resetAllCounters,
  ESCALATION_THRESHOLD,
} from './errors.js'

describe('Error Classification', () => {
  beforeEach(() => {
    resetAllCounters()
  })

  describe('classifyBinanceError', () => {
    it('classifies timeout as transient', () => {
      expect(classifyBinanceError('Binance timeout')).toBe('transient')
    })

    it('classifies 5xx errors as transient', () => {
      expect(classifyBinanceError('Binance API error: 503')).toBe('transient')
    })

    it('classifies 429 rate limit as critical', () => {
      expect(classifyBinanceError('rate limit exceeded')).toBe('critical')
    })

    it('classifies validation errors as critical', () => {
      expect(classifyBinanceError('Invalid Binance response format')).toBe('critical')
    })
  })

  describe('classifyWhatsAppError', () => {
    it('classifies loggedOut as critical', () => {
      expect(classifyWhatsAppError(DisconnectReason.loggedOut)).toBe('critical')
    })

    it('classifies forbidden as critical', () => {
      expect(classifyWhatsAppError(DisconnectReason.forbidden)).toBe('critical')
    })

    it('classifies connectionClosed as transient', () => {
      expect(classifyWhatsAppError(DisconnectReason.connectionClosed)).toBe('transient')
    })
  })

  describe('Consecutive Failure Tracking', () => {
    it('escalates after 3 consecutive failures', () => {
      expect(recordFailure('binance')).toBe(false) // 1
      expect(recordFailure('binance')).toBe(false) // 2
      expect(recordFailure('binance')).toBe(true)  // 3 - escalate!
    })

    it('resets counter on success', () => {
      recordFailure('binance')
      recordFailure('binance')
      recordSuccess('binance')
      expect(getFailureCount('binance')).toBe(0)
    })

    it('tracks failures per source independently', () => {
      recordFailure('binance')
      recordFailure('binance')
      recordFailure('whatsapp')
      expect(getFailureCount('binance')).toBe(2)
      expect(getFailureCount('whatsapp')).toBe(1)
    })
  })
})
```

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/errors.ts` | Error classification system |
| `src/services/errors.test.ts` | Unit tests for error classification |

### Files to Modify

| File | Changes |
|------|---------|
| `src/handlers/price.ts` | Add classification to exhausted retries path |
| `src/bot/connection.ts` | Add classification to disconnect handling |
| `src/services/binance.ts` | Track failures via ErrorTracker |

### Learnings from Previous Stories

**From Epic 1 Retrospective:**
- State transition bugs are common (Stories 1.2, 1.3, 1.4)
- Test all state transitions explicitly
- ESM mocking requires `vi.hoisted()` pattern

**From Epic 2 Retrospective:**
- Zero AC-breaking bugs achieved with thorough testing
- Always test logging assertions (recurring issue)
- Input validation gaps caught in review
- Document all new log events

**From Story 2.4:**
- Retry logic with failure tracking works well
- `price_unavailable_after_retries` event is the key integration point for this story
- Recovery metadata pattern can be extended for error classification

**From Code Reviews:**
- Expect 3-6 issues per story
- Log assertions are frequently missed
- Test edge cases (negative values, boundary conditions)
- Document accuracy matters (test counts, task descriptions)

### NFR Compliance

| NFR | Requirement | Implementation |
|-----|-------------|----------------|
| NFR3 | Recover <60s | Transient errors tracked for auto-recovery (Story 3.3) |
| NFR13 | All API failures logged | ClassifiedError includes all required fields |

### Dependencies from Previous Stories

| Component | Location | Usage |
|-----------|----------|-------|
| `price_unavailable_after_retries` event | src/handlers/price.ts | Trigger for classification |
| `price_stall_sent` event | src/handlers/price.ts | Transient error indicator |
| `price_retry_attempt` event | src/handlers/price.ts | Retry tracking |
| Result pattern | src/utils/result.ts | Error propagation |
| Structured logger | src/utils/logger.ts | Classified error logging |
| DisconnectReason | @whiskeysockets/baileys | WhatsApp error types |
| connection.ts events | src/bot/connection.ts | WhatsApp disconnect handling |
| BotState | src/bot/state.ts | Connection state tracking |

### Ready for Stories 3.2 & 3.3

This story creates the error classification foundation. Story 3.2 (Auto-Pause) and Story 3.3 (Auto-Recovery) will:

1. **Story 3.2**: Subscribe to `error_escalated` events to trigger auto-pause
2. **Story 3.3**: Use `recordSuccess()` to detect recovery from transient errors
3. Both stories will use `ErrorClassification` type for decision making

The `error_classified` and `error_escalated` events from this story feed into:
- Story 3.2's auto-pause trigger logic
- Story 3.3's auto-recovery detection
- Future alerting/monitoring systems

### Anti-Patterns to AVOID

- Do NOT throw exceptions from classifier functions (return values)
- Do NOT hardcode magic numbers (use `ESCALATION_THRESHOLD` constant)
- Do NOT forget to reset counters on success
- Do NOT mix classification logic with action logic (separate concerns)
- Do NOT log raw error objects (extract message strings)
- Do NOT skip logging assertions in tests (recurring issue from Epic 2)

### Edge Cases to Consider

1. **Unknown Binance error format**: Default to transient (safer)
2. **Unknown WhatsApp disconnect reason**: Default to transient
3. **Multiple sources failing simultaneously**: Track independently
4. **Counter overflow**: Unlikely at <100 msgs/day, but cap at reasonable max
5. **Race condition in counter updates**: Single-threaded Node.js, not a concern

### References

- [Source: docs/project-context.md#Non-Negotiables] - "Never sends wrong prices"
- [Source: _bmad-output/planning-artifacts/architecture.md#Error Handling Pattern] - Result type
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1] - Acceptance criteria
- [Source: _bmad-output/implementation-artifacts/2-4-graceful-degradation-stall-retry.md] - Retry events
- [Source: _bmad-output/implementation-artifacts/epic-2-retrospective.md] - Learnings and patterns
- [Source: @whiskeysockets/baileys] - DisconnectReason enum

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None required - implementation straightforward.

### Completion Notes List

1. **Error Classification Service Module**: Created `src/services/errors.ts` with complete error classification system:
   - Types: `ErrorClassification`, `ErrorSource`, `ClassifiedError`
   - Constants: `ESCALATION_THRESHOLD = 3`
   - Classifiers: `classifyBinanceError()`, `classifyWhatsAppError()`
   - Tracker: `recordFailure()`, `recordSuccess()`, `getFailureCount()`, `resetAllCounters()`
   - Logging: `logClassifiedError()`, `logErrorEscalation()`

2. **Binance Classification Logic**:
   - Transient: timeout, AbortError, 5xx errors, network/fetch errors
   - Critical: 4xx errors, validation errors, NaN parse errors, rate limits
   - Default: unknown errors → transient (safer for retries)

3. **WhatsApp Classification Logic**:
   - Critical: loggedOut, forbidden (banned), connectionReplaced
   - Transient: all other disconnect reasons (connectionClosed, connectionLost, timedOut, restartRequired)

4. **Consecutive Failure Tracking**:
   - Per-source tracking (binance, whatsapp, excel, supabase)
   - Escalation at 3+ consecutive failures
   - Reset on successful operations

5. **Integration with Existing Code**:
   - `price.ts`: Added classification and escalation tracking to exhausted retries path
   - `connection.ts`: Added classification to WhatsApp disconnect handler, reset on connect
   - `binance.ts`: Added `recordSuccess('binance')` on successful price fetch

6. **Unit Tests**: 47 new tests in `src/services/errors.test.ts`:
   - Type exports verification (3 tests)
   - Binance classification (15 tests covering all error types)
   - WhatsApp classification (9 tests covering all disconnect reasons)
   - Consecutive failure tracking (10 tests)
   - Logging format verification (7 tests)
   - Integration tests (3 tests)

7. **Test Results**: All 186 tests pass (47 new + 139 existing), build compiles successfully.

### File List

| File | Action | Description |
|------|--------|-------------|
| `src/services/errors.ts` | Created | Error classification service with types, classifiers, tracker, and logging |
| `src/services/errors.test.ts` | Created | 47 unit tests covering all acceptance criteria |
| `src/handlers/price.ts` | Modified | Added error classification and escalation tracking to exhausted retries |
| `src/bot/connection.ts` | Modified | Added WhatsApp disconnect classification and success tracking |
| `src/services/binance.ts` | Modified | Added recordSuccess on successful price fetch |

### Change Log

| Date | Change |
|------|--------|
| 2026-01-16 | Story created with comprehensive context from Epic 2 learnings and existing error handling code |
| 2026-01-16 | Implementation complete - all 6 tasks done, 47 new tests added, 186 total tests passing |

## Senior Developer Review (AI)

### Review Date

2026-01-16

### Review Outcome

**APPROVED with fixes applied** ✅

### Issues Found and Fixed

| # | Severity | Issue | Fix Applied |
|---|----------|-------|-------------|
| 1 | 🔴 Critical | Missing `recordFailure` on individual retry failures | Added `recordFailure('binance')` to first failure and each retry failure in price.ts |
| 2 | 🔴 Critical | Missing `recordFailure('whatsapp')` for disconnects | Added `recordFailure('whatsapp')` for transient disconnects in connection.ts |
| 3 | 🔴 Critical | Undefined statusCode handling bug | Added null check before classifying, handle undefined gracefully |
| 4 | 🟡 Medium | Task 5.3 description mismatch | Updated task description to reflect actual implementation |
| 5 | 🟡 Medium | Missing test for undefined DisconnectReason | Added test case for undefined input |
| 6 | 🟢 Low | Network error codes not explicitly handled | Added explicit checks for ECONNREFUSED, ENOTFOUND, ETIMEDOUT, etc. |
| 7 | 🟢 Low | First fetch failure not tracked | Fixed by Issue #1 fix |

### Additional Fix Required During Review

- **NaN regex bug**: The `'nan'` substring check was matching "binance" → fixed to use word boundary regex `/\bnan\b/`

### Files Modified During Review

| File | Changes |
|------|---------|
| `src/handlers/price.ts` | Added `recordFailure` for first failure and each retry failure, imported `ESCALATION_THRESHOLD` |
| `src/bot/connection.ts` | Added `recordFailure('whatsapp')` for transient disconnects, null handling for statusCode |
| `src/services/errors.ts` | Added explicit network error code handling, fixed NaN regex |
| `src/services/errors.test.ts` | Added 2 new tests (undefined DisconnectReason, network error codes) |

### Test Results After Fixes

- **188 tests passing** (49 in errors.test.ts)
- Build compiles successfully
- All ACs verified
