# Code Review Checklist

> **Use this checklist for every code review. Check each item before approving.**

## Required Checks

### 1. Logging Assertions
- [ ] **Every new log event has a test** - If code adds `logger.info/warn/error` with a new event name, there must be a test asserting it fires
- [ ] **Log events include required fields** - `event`, `source`, `timestamp` at minimum
- [ ] **Log levels are appropriate** - info for success, warn for transient errors, error for critical

### 2. Input Validation
- [ ] **External API responses are validated** - Use Zod schemas for Binance, Graph API, etc.
- [ ] **Numeric edge cases handled** - Check for NaN, Infinity, negative values where applicable
- [ ] **Undefined/null handled explicitly** - Especially for optional fields like `statusCode`

### 3. Error Handling
- [ ] **Services return Result type, never throw** - `{ ok: true, data } | { ok: false, error }`
- [ ] **Failures are recorded** - Call `recordFailure()` at each failure point
- [ ] **Successes reset counters** - Call `recordSuccess()` after successful operations
- [ ] **Error classification is correct** - Transient vs critical matches the error type

### 4. Test Coverage
- [ ] **All new functions have tests** - Unit tests for each exported function
- [ ] **Edge cases are covered** - Empty arrays, null values, boundary conditions
- [ ] **Integration points tested** - Mock dependencies, verify calls to other modules
- [ ] **Timer tests use fake timers** - `vi.useFakeTimers()` for setTimeout/setInterval

### 5. Documentation
- [ ] **Test counts match reality** - If story says "X tests", verify that count
- [ ] **Task descriptions match implementation** - Dev notes reflect what was actually built
- [ ] **Learned patterns documented** - If a new pattern emerges, add to project-context.md

### 6. Architecture Compliance
- [ ] **Result pattern followed** - No throwing from service functions
- [ ] **Structured logging used** - No `console.log`, use `logger` utility
- [ ] **Tests co-located** - `foo.ts` → `foo.test.ts` in same directory
- [ ] **Naming conventions followed** - camelCase files, SCREAMING_SNAKE constants

## Common Issues to Check

### From Epic 1
- [ ] ESM imports use `.js` extension
- [ ] Mocks use `vi.hoisted()` pattern
- [ ] Timer tests clean up with `vi.useRealTimers()`

### From Epic 2
- [ ] Binance responses validated with Zod
- [ ] Price formatting handles truncation (not rounding)
- [ ] Retry logic has proper spacing

### From Epic 3
- [ ] `recordFailure()` called at EACH failure point (not just end of function)
- [ ] `recordSuccess()` called after recovery, not just normal success
- [ ] Timer state cleared on both success and cancellation
- [ ] Sliding window filters expired entries before counting

## Review Process

1. **Read the story acceptance criteria** - Know what "done" means
2. **Run the tests** - `npm test` must pass
3. **Check each item above** - Don't skip any
4. **Note issues found** - Use severity: CRITICAL, MEDIUM, LOW, INFO
5. **Verify fixes** - Re-check after developer addresses issues

## Severity Guide

| Severity | Definition | Action |
|----------|------------|--------|
| CRITICAL | Breaks AC, causes wrong behavior | Must fix before merge |
| MEDIUM | Missing tests, validation gaps | Should fix before merge |
| LOW | Style, naming, minor improvements | Fix or document as tech debt |
| INFO | Suggestions, future considerations | Optional |

---

*Created: 2026-01-16*
*Source: Epic 2 & 3 Retrospective Action Items*
