# Story 2.1: Trigger Detection

Status: done

## Story

As a **client**,
I want **the bot to recognize when I'm asking for a price**,
So that **I don't have to use exact commands**.

## Acceptance Criteria

1. **AC1: "preço" Keyword Detection**
   - **Given** a message contains "preço" (case-insensitive)
   - **When** the message is processed by the router
   - **Then** it is flagged as a price trigger
   - **And** routed to the price handler

2. **AC2: "cotação" Keyword Detection**
   - **Given** a message contains "cotação" (case-insensitive)
   - **When** the message is processed by the router
   - **Then** it is flagged as a price trigger
   - **And** routed to the price handler

3. **AC3: Configurable Keywords**
   - **Given** keywords are defined in `triggers.ts`
   - **When** keywords need to be changed
   - **Then** they are configurable without code changes to router
   - **And** exported as `PRICE_TRIGGER_KEYWORDS` array

4. **AC4: Non-Trigger Messages Filtered**
   - **Given** a message does NOT contain any trigger keywords
   - **When** the router processes the message
   - **Then** it is NOT sent to the price handler
   - **And** returns `IGNORE` destination

5. **AC5: Control Group Bypass**
   - **Given** a message is from the control group
   - **When** the message contains a trigger keyword
   - **Then** it is still routed to control handler (NOT price handler)
   - **Note:** Control group routing takes precedence (established in Story 1.4)

## Tasks / Subtasks

- [x] **Task 1: Create Trigger Detection Module** (AC: #1, #2, #3)
  - [x] 1.1 Create `src/utils/triggers.ts` with trigger detection logic
  - [x] 1.2 Define `PRICE_TRIGGER_KEYWORDS` array: `['preço', 'cotação']`
  - [x] 1.3 Implement `isPriceTrigger(message: string): boolean` function
  - [x] 1.4 Ensure case-insensitive matching (normalize with `.toLowerCase()`)
  - [x] 1.5 Handle accented characters properly (Portuguese: ç, ã, etc.)

- [x] **Task 2: Update Router to Use Triggers** (AC: #1, #2, #4, #5)
  - [x] 2.1 Import `isPriceTrigger` in `src/bot/router.ts`
  - [x] 2.2 Modify `routeMessage()` to check trigger before routing to price handler
  - [x] 2.3 Return `IGNORE` for non-control messages without trigger
  - [x] 2.4 Maintain control group priority (check `isControlGroup` FIRST)
  - [x] 2.5 Add `hasTrigger` field to `RouterContext` for logging

- [x] **Task 3: Update Price Handler Stub** (AC: #1, #2)
  - [x] 3.1 Update `src/handlers/price.ts` logging to include trigger info
  - [x] 3.2 Add `event: 'price_trigger_detected'` log for matched messages
  - [x] 3.3 Prepare for Epic 2.2 (Binance price fetch) integration

- [x] **Task 4: Add Logging for Trigger Detection** (AC: #1, #2, #4)
  - [x] 4.1 Log trigger detection: `logger.info('Price trigger detected', { event, hasTrigger, messageLength })`
  - [x] 4.2 Log routing decision: `logger.info('Message routed', { hasTrigger, destination })`
  - [x] 4.3 DO NOT log actual message content (privacy)

- [x] **Task 5: Unit Tests** (AC: #1, #2, #3, #4)
  - [x] 5.1 Create `src/utils/triggers.test.ts` co-located with source
  - [x] 5.2 Test "preço" detection (lowercase)
  - [x] 5.3 Test "PREÇO" detection (uppercase)
  - [x] 5.4 Test "Preço" detection (mixed case)
  - [x] 5.5 Test "cotação" detection (with ç)
  - [x] 5.6 Test "cotacao" detection (without cedilla - optional tolerance)
  - [x] 5.7 Test message without triggers returns false
  - [x] 5.8 Test trigger in sentence: "qual o preço do USDT?"
  - [x] 5.9 Test multiple triggers in one message
  - [x] 5.10 Test empty string returns false

- [x] **Task 6: Integration Test with Router** (AC: #4, #5)
  - [x] 6.1 Create `src/bot/router.test.ts` co-located with source
  - [x] 6.2 Test non-trigger message returns `IGNORE`
  - [x] 6.3 Test trigger message from regular group returns `PRICE_HANDLER`
  - [x] 6.4 Test trigger message from control group returns `CONTROL_HANDLER`

## Dev Notes

### Architecture Compliance

**CRITICAL - Follow These Patterns:**

1. **Result Type Not Needed Here** - `isPriceTrigger()` is a pure function that always returns boolean. No external dependencies that can fail.

2. **Logger Pattern** - Use structured JSON logger:
   ```typescript
   logger.debug('Trigger detected', {
     event: 'trigger_detected',
     trigger: 'preço',
     messageLength: message.length,
   })
   ```

3. **Naming Conventions:**
   - Files: camelCase.ts (`triggers.ts`)
   - Functions: camelCase (`isPriceTrigger`)
   - Constants: SCREAMING_SNAKE (`PRICE_TRIGGER_KEYWORDS`)
   - Types: PascalCase (if needed)

### Trigger Detection Implementation

**Module Structure:**
```typescript
// src/utils/triggers.ts

/**
 * Keywords that trigger price quote requests.
 * Case-insensitive matching applied.
 */
export const PRICE_TRIGGER_KEYWORDS = ['preço', 'cotação'] as const

/**
 * Check if a message contains a price trigger keyword.
 * Case-insensitive matching.
 *
 * @param message - The message text to check
 * @returns true if message contains a trigger keyword
 */
export function isPriceTrigger(message: string): boolean {
  const normalized = message.toLowerCase()
  return PRICE_TRIGGER_KEYWORDS.some(keyword =>
    normalized.includes(keyword.toLowerCase())
  )
}
```

### Router Integration

**Current router.ts (from Story 1.4):**
```typescript
export function routeMessage(context: RouterContext): RouteResult {
  // Control group messages always go to control handler
  if (context.isControlGroup) {
    return { destination: 'CONTROL_HANDLER', context }
  }

  // Non-control group messages go to price handler
  return { destination: 'PRICE_HANDLER', context }
}
```

**Updated router.ts:**
```typescript
import { isPriceTrigger } from '../utils/triggers.js'

export function routeMessage(context: RouterContext): RouteResult {
  // Control group messages always go to control handler (AC5)
  if (context.isControlGroup) {
    return { destination: 'CONTROL_HANDLER', context }
  }

  // Check for price trigger (AC1, AC2, AC4)
  if (isPriceTrigger(context.message)) {
    return { destination: 'PRICE_HANDLER', context }
  }

  // No trigger - ignore message
  return { destination: 'IGNORE', context }
}
```

### Portuguese Character Handling

**Important:** Portuguese uses accented characters:
- `preço` (with cedilla ç)
- `cotação` (with cedilla ç and tilde ã)

The implementation MUST handle these correctly. JavaScript's `toLowerCase()` handles accented characters properly:
```typescript
'PREÇO'.toLowerCase() === 'preço'  // true
'COTAÇÃO'.toLowerCase() === 'cotação'  // true
```

**Optional Enhancement:** Consider also matching without accents for user convenience:
- `preco` → should also trigger (user may not have accent key)
- `cotacao` → should also trigger

This can be added as a follow-up if needed, but primary implementation should match exact Portuguese spelling.

### Connection.ts Update

The `messages.upsert` handler in `connection.ts` (Story 1.4) dispatches based on `route.destination`. With `IGNORE` now being a real routing decision (not just reserved), ensure the handler properly ignores these messages:

```typescript
// In connection.ts messages.upsert handler
if (route.destination === 'CONTROL_HANDLER') {
  await handleControlMessage(context)
} else if (route.destination === 'PRICE_HANDLER') {
  await handlePriceMessage(context)
}
// IGNORE destination - do nothing (already the case)
```

No changes needed to connection.ts - `IGNORE` is already handled by not matching either case.

### Learnings from Epic 1

**From Story 1.4 (Router):**
- Router is pure function - easy to test
- Control group check happens first - maintain this priority
- `IGNORE` destination was reserved - now we use it
- Group metadata caching prevents rate limits

**From Story 1.5 (Chaotic Timing):**
- `vi.useFakeTimers()` for timing tests
- Export constants for test maintainability
- Co-located tests work great

**From Story 1.6 (Messaging):**
- `vi.hoisted()` for ESM mock hoisting
- `vi.runAllTimersAsync()` for async operations
- Input validation is important (caught in code review)

**From Epic 1 Retrospective:**
- Code review caught issues in every story - expect 3-6 issues
- State transition bugs are common - test edge cases
- Always test with fake timers to avoid slow tests

### Files to Create

| File | Purpose |
|------|---------|
| `src/utils/triggers.ts` | Trigger detection with keyword matching |
| `src/utils/triggers.test.ts` | Unit tests for trigger detection |
| `src/bot/router.test.ts` | Integration tests for router with triggers |

### Files to Modify

| File | Changes |
|------|---------|
| `src/bot/router.ts` | Import `isPriceTrigger`, add trigger check before PRICE_HANDLER |
| `src/handlers/price.ts` | Update logging to include trigger info |

### Anti-Patterns to AVOID

- Do NOT hardcode keywords in router (use triggers.ts)
- Do NOT use regex for simple string matching (includes() is clearer)
- Do NOT log actual message content (privacy)
- Do NOT skip control group check (must remain first)
- Do NOT throw errors from isPriceTrigger (always return boolean)

### Testing Notes

**Unit Test Approach for triggers.ts:**
```typescript
// src/utils/triggers.test.ts
import { describe, it, expect } from 'vitest'
import { isPriceTrigger, PRICE_TRIGGER_KEYWORDS } from './triggers.js'

describe('isPriceTrigger', () => {
  it('detects "preço" keyword', () => {
    expect(isPriceTrigger('preço')).toBe(true)
  })

  it('detects "PREÇO" (uppercase)', () => {
    expect(isPriceTrigger('PREÇO')).toBe(true)
  })

  it('detects "cotação" keyword', () => {
    expect(isPriceTrigger('cotação')).toBe(true)
  })

  it('detects trigger in sentence', () => {
    expect(isPriceTrigger('qual o preço do USDT?')).toBe(true)
  })

  it('returns false for message without trigger', () => {
    expect(isPriceTrigger('hello world')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isPriceTrigger('')).toBe(false)
  })
})

describe('PRICE_TRIGGER_KEYWORDS', () => {
  it('exports keywords array', () => {
    expect(PRICE_TRIGGER_KEYWORDS).toContain('preço')
    expect(PRICE_TRIGGER_KEYWORDS).toContain('cotação')
  })
})
```

**Router Integration Tests:**
```typescript
// src/bot/router.test.ts
import { describe, it, expect } from 'vitest'
import { routeMessage, type RouterContext } from './router.js'

describe('routeMessage', () => {
  const baseContext: RouterContext = {
    groupId: '123@g.us',
    groupName: 'Test Group',
    message: '',
    sender: 'user@s.whatsapp.net',
    isControlGroup: false,
  }

  it('routes trigger message to PRICE_HANDLER', () => {
    const context = { ...baseContext, message: 'qual o preço?' }
    const result = routeMessage(context)
    expect(result.destination).toBe('PRICE_HANDLER')
  })

  it('routes non-trigger message to IGNORE', () => {
    const context = { ...baseContext, message: 'hello' }
    const result = routeMessage(context)
    expect(result.destination).toBe('IGNORE')
  })

  it('routes control group trigger to CONTROL_HANDLER', () => {
    const context = { ...baseContext, message: 'preço', isControlGroup: true }
    const result = routeMessage(context)
    expect(result.destination).toBe('CONTROL_HANDLER')
  })
})
```

### NFR Compliance

| NFR | Requirement | Implementation |
|-----|-------------|----------------|
| - | Trigger keywords configurable | `PRICE_TRIGGER_KEYWORDS` array in triggers.ts |
| - | Case-insensitive matching | `.toLowerCase()` normalization |

### Dependencies from Epic 1

| Component | Location | Usage |
|-----------|----------|-------|
| routeMessage() | src/bot/router.ts | Will be modified to use isPriceTrigger |
| handlePriceMessage() | src/handlers/price.ts | Receives triggered messages |
| logger | src/utils/logger.ts | Structured logging for trigger events |
| Result pattern | src/utils/result.ts | Not needed - pure boolean function |

### Ready for Epic 2.2

This story establishes trigger detection. Story 2.2 (Binance Price Service) will:
1. Receive messages routed to price handler
2. Extract the trigger keyword to understand context
3. Fetch price from Binance API
4. Format response with R$X,XX pattern

The price handler stub will be expanded in Story 2.2.

### References

- [Source: docs/project-context.md#Technical Context] - Trigger keywords: "preço", "cotação"
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure] - utils/triggers.ts location
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1] - Acceptance criteria
- [Source: _bmad-output/implementation-artifacts/1-4-control-group-identification-router.md] - Router implementation
- [Source: _bmad-output/implementation-artifacts/epic-1-retrospective.md] - Learnings from Epic 1

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None required - implementation straightforward.

### Completion Notes List

1. **Trigger Detection Module**: Created `src/utils/triggers.ts` with `isPriceTrigger()` function and `PRICE_TRIGGER_KEYWORDS` constant. Case-insensitive matching via `.toLowerCase()` which handles Portuguese accents (ç, ã) correctly.

2. **Router Integration**: Updated `src/bot/router.ts` to import and use `isPriceTrigger`. Added `hasTrigger` optional field to `RouterContext`. Messages without triggers now return `IGNORE` destination. Control group priority maintained (checked first).

3. **Price Handler Update**: Updated `src/handlers/price.ts` with new logging event `price_trigger_detected` that includes `hasTrigger`, `messageLength`, and other metadata. Stub remains for Epic 2.2.

4. **Logging**: Added `hasTrigger` to `message_routed` log in connection.ts. Privacy maintained - no message content logged.

5. **Unit Tests**: Created 18 tests in `src/utils/triggers.test.ts` covering all trigger detection scenarios including case variations, empty strings, triggers in sentences, accent sensitivity (no tolerance for missing accents), and keyword export verification.

6. **Integration Tests**: Created 14 tests in `src/bot/router.test.ts` covering routing to PRICE_HANDLER, IGNORE, and CONTROL_HANDLER destinations. Verified control group bypass (AC5).

7. **Test Results**: 58 total tests passing (16 triggers + 14 router + 28 existing). Build compiles successfully.

### File List

| File | Action | Description |
|------|--------|-------------|
| `src/utils/triggers.ts` | Created | Trigger detection with `isPriceTrigger()` and `PRICE_TRIGGER_KEYWORDS` |
| `src/utils/triggers.test.ts` | Created | 16 unit tests for trigger detection |
| `src/bot/router.ts` | Modified | Added trigger check, `hasTrigger` field, `IGNORE` routing |
| `src/bot/router.test.ts` | Created | 14 integration tests for routing with triggers |
| `src/handlers/price.ts` | Modified | Updated logging to `price_trigger_detected` event |
| `src/bot/connection.ts` | Modified | Added `hasTrigger` to `message_routed` log |

### Change Log

| Date | Change |
|------|--------|
| 2026-01-16 | Story created with comprehensive context from Epic 1 learnings and architecture |
| 2026-01-16 | Implementation complete - all 6 tasks done, 30 new tests added, 58 total tests passing |
