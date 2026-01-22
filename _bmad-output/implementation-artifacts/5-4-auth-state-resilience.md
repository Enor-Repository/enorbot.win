# Story 5.4: Auth State Resilience & Local Backup

Status: done

## Story

As a **CIO**,
I want **the bot's WhatsApp session to survive temporary database outages**,
So that **network hiccups don't force me to re-pair the phone**.

## Background

On 2026-01-19, the bot was logged out after ~3 days of successful operation. Root cause analysis revealed:

1. **Network disruption** between VPS and Supabase caused repeated `TypeError: fetch failed` errors
2. **No fallback** - when Supabase was unreachable, auth state couldn't be loaded
3. **Corrupted reconnection** - bot attempted reconnection with missing/invalid credentials
4. **WhatsApp rejection** - server detected invalid session and forced 401 logout

**Timeline:**
- Jan 16, 21:15 - Phone paired successfully
- Jan 16-19 - Bot working normally (~3 days)
- Jan 19, 09:05 - Supabase connectivity lost
- Jan 19, 09:05-09:27 - 50+ failed auth state load attempts
- Jan 19, 09:29:33 - WhatsApp forced logout (401)

## Acceptance Criteria

1. **AC1: Local file backup**
   - Given auth state is successfully saved to Supabase
   - When the save completes
   - Then a local backup is also written to `/opt/enorbot/auth_state_backup.json`

2. **AC2: Fallback on Supabase failure**
   - Given Supabase is unreachable when loading auth state
   - When the bot attempts to restore session
   - Then it falls back to the local file backup
   - And logs "Using local auth state backup (Supabase unreachable)"

3. **AC3: Health check before reconnection**
   - Given the bot needs to reconnect after disconnection
   - When Supabase health check fails
   - Then reconnection is delayed (not attempted with invalid state)
   - And a warning is logged: "Delaying reconnection - Supabase unreachable"

4. **AC4: Extended retry window**
   - Given Supabase connectivity is intermittent
   - When loading auth state fails
   - Then the bot retries with exponential backoff up to 5 minutes (not 60 seconds)
   - And does NOT create fresh auth state until all retries exhausted

5. **AC5: Database connectivity alert**
   - Given Supabase has been unreachable for 60+ seconds
   - When the threshold is exceeded
   - Then a notification is queued: "Database unreachable - using local backup"

6. **AC6: Prevent invalid session reconnection**
   - Given auth state could not be loaded from any source
   - When the bot would normally request a pairing code
   - Then it logs "Auth state unavailable - waiting for database recovery"
   - And does NOT attempt pairing (avoids session conflict)

## Tasks / Subtasks

- [x] Task 1: Implement local file backup (AC: 1, 2)
  - [x] 1.1: Create `saveAuthStateToFile(state: StoredAuthState): Promise<Result<void>>`
  - [x] 1.2: Create `loadAuthStateFromFile(): Promise<Result<StoredAuthState | null>>`
  - [x] 1.3: Define backup file path constant `AUTH_STATE_BACKUP_PATH`
  - [x] 1.4: Call `saveAuthStateToFile()` after successful Supabase save
  - [x] 1.5: Add file permissions check on startup
  - [x] 1.6: Add unit tests for file operations
  - [x] 1.7: Handle JSON serialization of Uint8Array fields (same as Supabase)

- [x] Task 2: Implement fallback loading logic (AC: 2)
  - [x] 2.1: Update `loadAuthState()` to try Supabase first
  - [x] 2.2: On Supabase failure, attempt `loadAuthStateFromFile()`
  - [x] 2.3: Log which source was used (supabase vs local_file)
  - [x] 2.4: Add structured logging for fallback events
  - [x] 2.5: Add unit tests for fallback scenarios

- [x] Task 3: Implement Supabase health check (AC: 3)
  - [x] 3.1: Create `checkSupabaseHealth(): Promise<Result<void>>`
  - [x] 3.2: Simple SELECT query with 5-second timeout
  - [x] 3.3: Integrate health check in `connection.ts` before reconnection
  - [x] 3.4: If health check fails, delay reconnection attempt
  - [x] 3.5: Add unit tests for health check

- [x] Task 4: Extend retry window for auth state loading (AC: 4)
  - [x] 4.1: Increase `MAX_AUTH_LOAD_RETRIES` from 3 to 10
  - [x] 4.2: Increase retry delays: 1s, 2s, 4s, 8s, 16s, 30s, 60s, 120s, 180s, 300s
  - [x] 4.3: Add `TOTAL_AUTH_RETRY_WINDOW_MS = 5 * 60 * 1000` (5 minutes)
  - [x] 4.4: Log retry progress with attempt number and next delay
  - [x] 4.5: Update tests for extended retry window

- [x] Task 5: Add database connectivity alerting (AC: 5)
  - [x] 5.1: Track first Supabase failure timestamp
  - [x] 5.2: If failures persist 60+ seconds, queue control notification
  - [x] 5.3: Clear failure tracking on successful operation
  - [x] 5.4: Rate limit alerts (max 1 per 10 minutes)
  - [x] 5.5: Add unit tests for alerting logic

- [x] Task 6: Prevent invalid session reconnection (AC: 6)
  - [x] 6.1: Add flag `authStateEverLoaded` in state.ts
  - [x] 6.2: Before requesting pairing code, check if auth state was ever loaded
  - [x] 6.3: If no auth state available and Supabase unreachable, wait instead of pairing
  - [x] 6.4: Log "Waiting for database recovery" instead of generating pairing code
  - [x] 6.5: Add test for pairing prevention logic (via connection.ts integration)

- [x] Task 7: Integration and cleanup (AC: all)
  - [x] 7.1: Add `checkBackupPermissions()` to startup in index.ts
  - [x] 7.2: Ensure backup directory exists on startup (via checkBackupPermissions)
  - [ ] 7.3: Add cleanup of stale backup files (>7 days old) - skipped, nice-to-have
  - [x] 7.4: Integration tests via component tests (full failover covered)
  - [x] 7.5: Update project-context.md with new patterns

## Dev Notes

### Local Backup File Strategy

```typescript
// src/services/authBackup.ts
import { writeFile, readFile, access } from 'fs/promises'
import { constants } from 'fs'
import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'
import type { StoredAuthState } from './supabase.js'

const AUTH_STATE_BACKUP_PATH = process.env.AUTH_BACKUP_PATH || '/opt/enorbot/auth_state_backup.json'

export async function saveAuthStateToFile(state: StoredAuthState): Promise<Result<void>> {
  try {
    const json = JSON.stringify(state, null, 2)
    await writeFile(AUTH_STATE_BACKUP_PATH, json, 'utf-8')
    logger.debug('Auth state backed up to file', {
      event: 'auth_backup_saved',
      path: AUTH_STATE_BACKUP_PATH
    })
    return ok(undefined)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    logger.warn('Failed to save auth state backup', {
      event: 'auth_backup_save_failed',
      error,
      path: AUTH_STATE_BACKUP_PATH
    })
    return err(error)
  }
}

export async function loadAuthStateFromFile(): Promise<Result<StoredAuthState | null>> {
  try {
    await access(AUTH_STATE_BACKUP_PATH, constants.R_OK)
    const json = await readFile(AUTH_STATE_BACKUP_PATH, 'utf-8')
    const state = JSON.parse(json) as StoredAuthState

    logger.info('Auth state loaded from local backup', {
      event: 'auth_backup_loaded',
      path: AUTH_STATE_BACKUP_PATH
    })
    return ok(state)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.debug('No local auth backup found', { event: 'auth_backup_not_found' })
      return ok(null)
    }
    const error = e instanceof Error ? e.message : String(e)
    logger.warn('Failed to load auth state backup', {
      event: 'auth_backup_load_failed',
      error
    })
    return err(error)
  }
}
```

### Updated Auth State Loading with Fallback

```typescript
// In supabase.ts - updated loadAuthState()

import { loadAuthStateFromFile } from './authBackup.js'

export async function loadAuthState(): Promise<Result<StoredAuthState | null>> {
  // Try Supabase first
  const supabaseResult = await loadAuthStateFromSupabase()

  if (supabaseResult.ok) {
    return supabaseResult
  }

  // Supabase failed - try local backup
  logger.warn('Supabase unreachable, trying local backup', {
    event: 'auth_state_fallback',
    supabaseError: supabaseResult.error
  })

  const fileResult = await loadAuthStateFromFile()

  if (fileResult.ok && fileResult.data) {
    logger.info('Using local auth state backup', {
      event: 'auth_state_from_backup'
    })
    return fileResult
  }

  // Both failed
  logger.error('Auth state unavailable from all sources', {
    event: 'auth_state_unavailable',
    supabaseError: supabaseResult.error,
    fileError: fileResult.ok ? 'no_backup_exists' : fileResult.error
  })

  return err('Auth state unavailable from Supabase and local backup')
}
```

### Supabase Health Check

```typescript
// In supabase.ts

const HEALTH_CHECK_TIMEOUT_MS = 5000

export async function checkSupabaseHealth(): Promise<Result<void>> {
  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS)

    const { error } = await supabase
      .from('sessions')
      .select('id')
      .limit(1)
      .abortSignal(controller.signal)

    clearTimeout(timeout)

    if (error) {
      logger.warn('Supabase health check failed', {
        event: 'supabase_health_failed',
        error: error.message
      })
      return err(error.message)
    }

    return ok(undefined)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    logger.warn('Supabase health check exception', {
      event: 'supabase_health_exception',
      error
    })
    return err(error)
  }
}
```

### Extended Retry Configuration

```typescript
// In connection.ts or a new config file

export const AUTH_RETRY_CONFIG = {
  maxRetries: 10,
  delays: [1000, 2000, 4000, 8000, 16000, 30000, 60000, 120000, 180000, 300000], // ms
  totalWindowMs: 5 * 60 * 1000, // 5 minutes total
}

export async function loadAuthStateWithRetry(): Promise<Result<StoredAuthState | null>> {
  const startTime = Date.now()

  for (let attempt = 0; attempt < AUTH_RETRY_CONFIG.maxRetries; attempt++) {
    const result = await loadAuthState()

    if (result.ok) {
      if (attempt > 0) {
        logger.info('Auth state loaded after retry', {
          event: 'auth_state_retry_success',
          attempts: attempt + 1
        })
      }
      return result
    }

    const elapsed = Date.now() - startTime
    if (elapsed >= AUTH_RETRY_CONFIG.totalWindowMs) {
      logger.error('Auth state retry window exhausted', {
        event: 'auth_state_retry_exhausted',
        attempts: attempt + 1,
        elapsedMs: elapsed
      })
      break
    }

    const delay = AUTH_RETRY_CONFIG.delays[attempt] || AUTH_RETRY_CONFIG.delays[AUTH_RETRY_CONFIG.delays.length - 1]

    logger.warn('Auth state load failed, retrying', {
      event: 'auth_state_retry_scheduled',
      attempt: attempt + 1,
      nextRetryMs: delay,
      error: result.error
    })

    await new Promise(resolve => setTimeout(resolve, delay))
  }

  return err('Failed to load auth state after all retries')
}
```

### Preventing Invalid Session Reconnection

```typescript
// In connection.ts

let authStateEverLoaded = false

async function createConnection(config: EnvConfig): Promise<void> {
  // Health check before reconnection
  const healthResult = await checkSupabaseHealth()
  if (!healthResult.ok) {
    logger.warn('Delaying connection - Supabase unreachable', {
      event: 'connection_delayed_no_db'
    })
    // Schedule retry instead of proceeding with potentially invalid state
    scheduleReconnection(1) // Will retry with backoff
    return
  }

  const authResult = await loadAuthStateWithRetry()

  if (authResult.ok && authResult.data) {
    authStateEverLoaded = true
    // Proceed with connection using valid auth state
    await connectWithAuth(authResult.data)
  } else if (authStateEverLoaded) {
    // Previously had auth, now lost - wait for recovery instead of re-pairing
    logger.warn('Auth state lost - waiting for database recovery', {
      event: 'auth_state_lost_waiting'
    })
    queueControlNotification('Database unreachable - session recovery pending')
    scheduleReconnection(1)
  } else {
    // Fresh install - no auth ever existed, OK to request pairing
    logger.info('Fresh auth state created', { event: 'auth_state_fresh' })
    await connectWithFreshAuth()
  }
}
```

### Database Connectivity Alerting

```typescript
// In supabase.ts

const DB_ALERT_THRESHOLD_MS = 60 * 1000 // 60 seconds
const DB_ALERT_COOLDOWN_MS = 10 * 60 * 1000 // 10 minutes

let firstFailureTime: number | null = null
let lastAlertTime: number | null = null

export function trackDatabaseFailure(): void {
  const now = Date.now()

  if (!firstFailureTime) {
    firstFailureTime = now
  }

  const failureDuration = now - firstFailureTime

  if (failureDuration >= DB_ALERT_THRESHOLD_MS) {
    if (!lastAlertTime || now - lastAlertTime >= DB_ALERT_COOLDOWN_MS) {
      lastAlertTime = now
      queueControlNotification('Database unreachable for 60+ seconds - using local backup')
      logger.error('Database connectivity alert', {
        event: 'db_connectivity_alert',
        failureDurationMs: failureDuration
      })
    }
  }
}

export function clearDatabaseFailureTracking(): void {
  if (firstFailureTime) {
    logger.info('Database connectivity restored', {
      event: 'db_connectivity_restored',
      downDurationMs: Date.now() - firstFailureTime
    })
  }
  firstFailureTime = null
}
```

### Project Structure Notes

**New Files:**
- `src/services/authBackup.ts` - Local file backup service
- `src/services/authBackup.test.ts` - Tests for backup service

**Modified Files:**
- `src/services/supabase.ts` - Add health check, fallback logic, failure tracking
- `src/bot/connection.ts` - Integrate extended retry, health check, pairing prevention
- `src/bot/state.ts` - Add `authStateEverLoaded` flag

**Environment Variables:**
- `AUTH_BACKUP_PATH` (optional) - Override default backup file location

### Testing Strategy

1. **Unit tests for authBackup.ts:**
   - File write succeeds with valid JSON
   - File read succeeds and parses correctly
   - Handles missing file gracefully
   - Handles permission errors

2. **Unit tests for fallback logic:**
   - Supabase success → returns Supabase data
   - Supabase fail + file success → returns file data
   - Both fail → returns error

3. **Unit tests for health check:**
   - Healthy Supabase → returns ok
   - Unhealthy Supabase → returns error
   - Timeout handling

4. **Unit tests for extended retry:**
   - Retries with increasing delays
   - Stops after max retries
   - Stops when window exceeded

5. **Integration tests:**
   - Full failover scenario: Supabase down → file backup used → reconnection succeeds
   - Pairing prevention: auth lost + db down → no pairing code generated

### Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Local file gets corrupted | Validate JSON structure on load (same Zod schema as Supabase) |
| File permissions issues | Check permissions on startup, log warning if not writable |
| Disk full | Catch write errors, log but don't crash |
| Stale backup used | Log timestamp of backup, warn if >24h old |
| Race condition on save | Use atomic write (write to temp, then rename) |

### Dependencies

- **From Story 1.2:** `StoredAuthState` interface, Supabase auth functions
- **From Epic 3:** Notification queue, error tracking
- **From Epic 4:** `queueControlNotification()` function

### References

- [Root Cause Analysis: Jan 19 logout incident]
- [Source: docs/project-context.md] - Result type pattern, logging conventions
- [Source: _bmad-output/planning-artifacts/architecture.md] - Supabase patterns

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (2026-01-19)

### Completion Notes List

- Implemented local file backup with atomic write (temp file + rename)
- Created `authBackup.ts` with save/load/clear functions using Result pattern
- Added fallback loading: Supabase → local file → error
- Implemented Supabase health check with 5-second timeout
- Added extended retry window: 10 retries with exponential backoff up to 5 minutes
- Implemented database connectivity alerting with 60s threshold and 10-min rate limit
- Added `authStateEverLoaded` flag to prevent re-pairing when database is down
- Updated connection.ts with health check before reconnection
- Updated authState.ts to use retry and mark auth as loaded
- Added 17 new tests for supabase.ts (health check, retry, alerting)
- Added 18 tests for authBackup.ts
- Updated project-context.md with new patterns
- Total tests: 517 passing (18 pre-existing failures in price.test.ts unrelated)

### File List

**New Files:**
- `src/services/authBackup.ts` - Local file backup service (18 tests)
- `src/services/authBackup.test.ts` - Tests for backup service
- `src/services/supabase.test.ts` - Tests for health check, retry, alerting (17 tests)

**Modified Files:**
- `src/services/supabase.ts` - Added health check, fallback loading, retry, alerting
- `src/bot/authState.ts` - Use loadAuthStateWithRetry, call setAuthStateLoaded
- `src/bot/connection.ts` - Health check before reconnection, pairing prevention
- `src/bot/state.ts` - Added authStateEverLoaded tracking
- `src/index.ts` - Added backup permissions check on startup
- `docs/project-context.md` - Added Auth State Resilience patterns
