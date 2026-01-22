# Story 1.5: Chaotic Timing Utility

Status: done

## Story

As a **CIO**,
I want **the bot to delay responses with randomized timing**,
So that **WhatsApp doesn't detect automated behavior**.

## Acceptance Criteria

1. **AC1: Default Delay Range**
   - **Given** the chaos utility is called with default parameters
   - **When** a delay is requested
   - **Then** the delay is between 3-15 seconds (NFR14)
   - **And** the delay uses multi-layer randomization (not simple random)

2. **AC2: Independent Randomization**
   - **Given** multiple messages arrive in sequence
   - **When** chaotic delays are applied
   - **Then** each delay is independently randomized
   - **And** no two consecutive delays are identical

3. **AC3: Delay Logging**
   - **Given** the chaos utility returns
   - **When** the promise resolves
   - **Then** the actual delay time is logged for debugging

## Tasks / Subtasks

- [x] **Task 1: Create Chaotic Delay Function** (AC: #1)
  - [x] 1.1 Create `src/utils/chaos.ts` with core chaotic delay function
  - [x] 1.2 Implement multi-layer randomization algorithm (not simple `Math.random()`)
  - [x] 1.3 Define constants `MIN_DELAY_MS = 3000` and `MAX_DELAY_MS = 15000`
  - [x] 1.4 Function signature: `chaosDelay(): Promise<number>` returns actual delay in ms

- [x] **Task 2: Implement Multi-Layer Randomization** (AC: #1)
  - [x] 2.1 Layer 1: Base random in range (3s-15s)
  - [x] 2.2 Layer 2: Add jitter (+/- random offset)
  - [x] 2.3 Layer 3: Occasionally extend delay for extra unpredictability
  - [x] 2.4 Ensure final delay stays within bounds (3s-15s)

- [x] **Task 3: Prevent Consecutive Identical Delays** (AC: #2)
  - [x] 3.1 Track the last delay value in module-level variable
  - [x] 3.2 If new delay matches last delay, regenerate with additional jitter
  - [x] 3.3 Export `resetLastDelay()` for testing purposes

- [x] **Task 4: Add Delay Logging** (AC: #3)
  - [x] 4.1 Log actual delay before returning: `logger.debug('Chaotic delay applied', { delayMs, event: 'chaos_delay' })`
  - [x] 4.2 Log at debug level to avoid noise in production

- [x] **Task 5: Unit Tests** (AC: #1, #2, #3)
  - [x] 5.1 Create `src/utils/chaos.test.ts` co-located with source
  - [x] 5.2 Test that delays are within 3000-15000ms bounds
  - [x] 5.3 Test that consecutive delays are different (call 10 times, verify no adjacent duplicates)
  - [x] 5.4 Test that function returns the actual delay value

## Dev Notes

### Architecture Compliance

**CRITICAL - Follow These Patterns:**

1. **Result Type Not Needed Here** - This is a utility function that should NOT fail. It always returns a delay value. No external dependencies that can fail.

2. **Logger Pattern** - Use structured JSON logger for debugging:
   ```typescript
   logger.debug('Chaotic delay applied', {
     event: 'chaos_delay',
     delayMs: actualDelay,
     layers: { base, jitter, extension }
   })
   ```

3. **Naming Conventions:**
   - Files: camelCase.ts (`chaos.ts`)
   - Functions: camelCase (`chaosDelay`, `resetLastDelay`)
   - Constants: SCREAMING_SNAKE (`MIN_DELAY_MS`, `MAX_DELAY_MS`)
   - Types: PascalCase (`DelayConfig` if needed)

### Multi-Layer Randomization Algorithm

**Why not simple random?**
WhatsApp's anti-bot detection looks for patterns. Simple `Math.random()` produces uniform distribution - a detectable signature. Multi-layer randomization creates more "human-like" unpredictability.

**Recommended Algorithm:**

```typescript
// src/utils/chaos.ts
import { logger } from './logger.js'

const MIN_DELAY_MS = 3000   // 3 seconds (NFR14)
const MAX_DELAY_MS = 15000  // 15 seconds (NFR14)

let lastDelay = 0  // Track for consecutive check

/**
 * Generate a chaotic delay using multi-layer randomization.
 * Returns actual delay in milliseconds after waiting.
 */
export async function chaosDelay(): Promise<number> {
  let delay = generateChaoticValue()

  // Ensure not identical to last delay (AC2)
  while (delay === lastDelay) {
    delay = generateChaoticValue()
  }
  lastDelay = delay

  // Apply the delay
  await sleep(delay)

  // Log for debugging (AC3)
  logger.debug('Chaotic delay applied', {
    event: 'chaos_delay',
    delayMs: delay,
  })

  return delay
}

/**
 * Multi-layer randomization for human-like unpredictability.
 */
function generateChaoticValue(): number {
  // Layer 1: Base random in range
  const range = MAX_DELAY_MS - MIN_DELAY_MS
  const base = MIN_DELAY_MS + Math.random() * range

  // Layer 2: Jitter (+/- 500ms)
  const jitter = (Math.random() - 0.5) * 1000

  // Layer 3: Occasional extension (20% chance of +1-3 seconds)
  const extension = Math.random() < 0.2
    ? Math.random() * 3000
    : 0

  // Combine and clamp to bounds
  const raw = base + jitter + extension
  return Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, Math.round(raw)))
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Reset last delay - for testing
 */
export function resetLastDelay(): void {
  lastDelay = 0
}
```

### Testing Strategy

**Unit Test Approach:**

```typescript
// src/utils/chaos.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { chaosDelay, resetLastDelay } from './chaos.js'

describe('chaosDelay', () => {
  beforeEach(() => {
    resetLastDelay()
  })

  it('returns delay within 3000-15000ms bounds', async () => {
    // Mock setTimeout to run instantly
    vi.useFakeTimers()

    const delayPromise = chaosDelay()
    vi.runAllTimers()

    const delay = await delayPromise
    expect(delay).toBeGreaterThanOrEqual(3000)
    expect(delay).toBeLessThanOrEqual(15000)

    vi.useRealTimers()
  })

  it('generates different consecutive delays', async () => {
    vi.useFakeTimers()

    const delays: number[] = []
    for (let i = 0; i < 10; i++) {
      const promise = chaosDelay()
      vi.runAllTimers()
      delays.push(await promise)
    }

    // Check no adjacent duplicates
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).not.toBe(delays[i - 1])
    }

    vi.useRealTimers()
  })
})
```

**Note:** Testing timing functions requires mocking timers. Use Vitest's `vi.useFakeTimers()` to avoid slow tests.

### Integration with Message Sending (Story 1.6)

This utility will be used in Story 1.6's `sendWithAntiDetection()` function:

```typescript
// handlers/price.ts (future - Story 1.6)
import { chaosDelay } from '../utils/chaos.js'

async function sendWithAntiDetection(sock: WASocket, jid: string, message: string) {
  // 1. Show typing indicator (1-4 seconds) - Story 1.6
  // 2. Apply chaotic delay (3-15 seconds) - THIS STORY
  await chaosDelay()
  // 3. Send message
  await sock.sendMessage(jid, { text: message })
}
```

### Files to Create

| File | Purpose |
|------|---------|
| `src/utils/chaos.ts` | Chaotic timing delay utility |
| `src/utils/chaos.test.ts` | Unit tests for chaos utility |

### Files to Modify

None - this is a standalone utility module.

### Anti-Patterns to AVOID

- Do NOT use simple `Math.random() * range` as the only randomization
- Do NOT allow delays outside 3-15 second bounds
- Do NOT skip the consecutive delay check
- Do NOT throw errors (this function should always succeed)
- Do NOT use `console.log` (use logger utility)

### Learnings from Previous Stories

**From Story 1.1-1.3:**
- Result pattern established - but NOT needed here (no failure modes)
- Structured logger works well - use `logger.debug()` for timing info
- Test co-location pattern works (*.test.ts next to source)

**From Story 1.4:**
- Code review caught performance issue with repeated API calls → Added caching
- Applied error handling wrapper for safety
- Module-level state tracking (like `groupMetadataCache`) works well - use similar pattern for `lastDelay`

### NFR Compliance

| NFR | Requirement | Implementation |
|-----|-------------|----------------|
| NFR14 | Response delay 3-15 seconds | `MIN_DELAY_MS = 3000`, `MAX_DELAY_MS = 15000`, clamped bounds |

### References

- [Source: docs/project-context.md#Technical Context] - NFR14 timing requirements
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure] - `utils/chaos.ts` location
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns] - Naming conventions
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5] - Acceptance criteria

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None required - implementation straightforward.

### Completion Notes List

1. **Chaotic Delay Function**: Created `src/utils/chaos.ts` with `chaosDelay()` function that returns a Promise resolving to the actual delay in milliseconds. Function uses multi-layer randomization and ensures bounds of 3000-15000ms (NFR14).

2. **Multi-Layer Randomization**: Implemented three-layer algorithm:
   - Layer 1: Base random in 3s-15s range
   - Layer 2: Jitter of +/- 500ms
   - Layer 3: 20% chance of +1-3 second extension
   - Final value clamped to MIN_DELAY_MS/MAX_DELAY_MS bounds

3. **Consecutive Delay Prevention**: Module-level `lastDelay` variable tracks previous delay. If new delay matches, regenerates until different. Also added `getLastDelay()` helper for testing.

4. **Delay Logging**: Logs via `logger.debug()` with structured format: `{ event: 'chaos_delay', delayMs }`.

5. **Unit Tests**: Created comprehensive test suite in `src/utils/chaos.test.ts` with 6 tests covering bounds validation, consecutive delay prevention, state tracking, and delay variance. All 12 tests pass (source + dist).

6. **Additional Files**: Added vitest as dev dependency, added `test` and `test:watch` npm scripts.

### File List

| File | Action | Description |
|------|--------|-------------|
| `src/utils/chaos.ts` | Create | Chaotic timing delay utility with multi-layer randomization |
| `src/utils/chaos.test.ts` | Create | Unit tests for chaos utility (6 tests) |
| `package.json` | Modified | Added vitest dev dependency, test scripts |

### Change Log

| Date | Change |
|------|--------|
| 2026-01-15 | Story created and ready for development |
| 2026-01-16 | Implementation complete - all tasks done, 12 tests pass |
| 2026-01-16 | Code review fixes: (1) Added max iteration guard to prevent theoretical infinite loop in consecutive delay prevention, (2) Added test for logger.debug call (AC3 coverage), (3) Exported MIN_DELAY_MS/MAX_DELAY_MS constants for test maintainability. Now 14 tests pass. |
