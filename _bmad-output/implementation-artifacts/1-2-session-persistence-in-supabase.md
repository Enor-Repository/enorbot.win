# Story 1.2: Session Persistence in Supabase

Status: done

## Story

As a **CIO**,
I want **the bot session to survive VPS restarts**,
So that **I don't need to re-authenticate every time the server reboots**.

## Acceptance Criteria

1. **AC1: Supabase Auth State Storage**
   - **Given** a Supabase project is configured with auth_state table
   - **When** the bot connects successfully
   - **Then** the auth credentials are stored in Supabase JSONB
   - **And** the credentials persist across process restarts

2. **AC2: Session Restoration on Restart**
   - **Given** the bot process restarts
   - **When** Baileys initializes
   - **Then** it loads existing auth state from Supabase
   - **And** reconnects without requiring new authentication

3. **AC3: Graceful Fresh Auth Fallback**
   - **Given** the auth state is corrupted, missing, or invalid
   - **When** the bot starts
   - **Then** it prompts for fresh authentication via pairing code
   - **And** stores the new credentials in Supabase

## Tasks / Subtasks

- [x] **Task 1: Create Supabase Auth Service** (AC: #1, #2, #3)
  - [x] 1.1 Create `src/services/supabase.ts` with Supabase client initialization
  - [x] 1.2 Implement `loadAuthState(): Promise<Result<AuthState | null>>` function
  - [x] 1.3 Implement `saveAuthState(state: AuthState): Promise<Result<void>>` function
  - [x] 1.4 Implement `clearAuthState(): Promise<Result<void>>` function
  - [x] 1.5 Add Zod schema validation for auth state structure

- [x] **Task 2: Create Custom Auth State Provider** (AC: #1, #2)
  - [x] 2.1 Create `src/bot/authState.ts` with Baileys-compatible auth state interface
  - [x] 2.2 Implement `useSupabaseAuthState()` function matching Baileys pattern
  - [x] 2.3 Return `{ state, saveCreds }` structure compatible with makeWASocket
  - [x] 2.4 Handle initial load from Supabase on first call

- [x] **Task 3: Update Connection to Use Supabase Auth** (AC: #1, #2, #3)
  - [x] 3.1 Replace `useMultiFileAuthState` with `useSupabaseAuthState` in connection.ts
  - [x] 3.2 Handle auth state load failure gracefully (start fresh)
  - [x] 3.3 Remove temporary file-based auth directory reference
  - [x] 3.4 Log auth state source ("Loaded from Supabase" vs "Fresh auth required")

- [x] **Task 4: Add Config Validation** (AC: #1)
  - [x] 4.1 Add SUPABASE_URL and SUPABASE_KEY to required environment validation
  - [x] 4.2 Update `.env.example` with actual Supabase placeholders
  - [x] 4.3 Add validation error messages for missing Supabase credentials

- [x] **Task 5: Test Session Persistence** (AC: #2, #3) - *Manual verification required*
  - [x] 5.1 Verify auth state saves to Supabase on successful connection
  - [x] 5.2 Restart bot process and verify it reconnects without pairing code
  - [x] 5.3 Clear Supabase table and verify bot prompts for fresh auth
  - [x] 5.4 Test corrupted auth state handling (graceful fallback)

## Dev Notes

### Architecture Compliance

**CRITICAL - Follow These Patterns:**

1. **Result Type Pattern** - All Supabase service functions return `Result<T>`, never throw
   ```typescript
   type Result<T> = { ok: true; data: T } | { ok: false; error: string }
   ```

2. **Logger Pattern** - Use structured JSON logger for ALL output
   ```typescript
   logger.info('Auth state loaded from Supabase', { event: 'auth_loaded' })
   logger.warn('Auth state missing, fresh auth required', { event: 'auth_missing' })
   ```

3. **Naming Conventions:**
   - Files: camelCase.ts (`supabase.ts`, `authState.ts`)
   - Functions: camelCase (`loadAuthState`, `saveAuthState`)
   - Types: PascalCase (`AuthState`, `SupabaseConfig`)
   - Database columns: snake_case (`auth_state`, `updated_at`)

### Supabase Schema

**CRITICAL:** Create this table in Supabase before running the bot:

```sql
-- Run this in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY DEFAULT 'default',
  auth_state JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (optional for single-user bot)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Create policy for service role access
CREATE POLICY "Service role access" ON sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

### Baileys Auth State Interface

The custom auth state must match Baileys' expected interface:

```typescript
import type { AuthenticationCreds, SignalDataTypeMap } from '@whiskeysockets/baileys'

interface AuthState {
  creds: AuthenticationCreds
  keys: SignalDataTypeMap
}

// useSupabaseAuthState must return this structure:
interface AuthStateResult {
  state: {
    creds: AuthenticationCreds
    keys: {
      get: (type: keyof SignalDataTypeMap, ids: string[]) => Promise<Record<string, any>>
      set: (data: any) => Promise<void>
    }
  }
  saveCreds: () => Promise<void>
}
```

### Implementation Approach

**Option A (Simple - Recommended for MVP):** Store entire auth state as single JSONB
- Pros: Simple implementation, single read/write per operation
- Cons: Larger payloads on each update
- Decision: Use this for Story 1.2 (simplicity > optimization)

**Option B (Optimized):** Separate tables for creds and signal keys
- Pros: Smaller updates, better for high-volume
- Cons: More complex implementation
- Decision: Consider for future optimization if needed

### Supabase Service Implementation

```typescript
// src/services/supabase.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'
import type { EnvConfig } from '../types/config.js'

let supabase: SupabaseClient | null = null

export function initSupabase(config: EnvConfig): void {
  supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY)
  logger.info('Supabase client initialized', { event: 'supabase_init' })
}

export async function loadAuthState(): Promise<Result<object | null>> {
  if (!supabase) {
    return err('Supabase not initialized')
  }

  const { data, error } = await supabase
    .from('sessions')
    .select('auth_state')
    .eq('id', 'default')
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      // Row not found - fresh auth needed
      return ok(null)
    }
    logger.error('Failed to load auth state', { event: 'auth_load_error', error: error.message })
    return err(`Supabase error: ${error.message}`)
  }

  return ok(data.auth_state)
}

export async function saveAuthState(state: object): Promise<Result<void>> {
  if (!supabase) {
    return err('Supabase not initialized')
  }

  const { error } = await supabase
    .from('sessions')
    .upsert({
      id: 'default',
      auth_state: state,
      updated_at: new Date().toISOString()
    })

  if (error) {
    logger.error('Failed to save auth state', { event: 'auth_save_error', error: error.message })
    return err(`Supabase error: ${error.message}`)
  }

  logger.debug('Auth state saved to Supabase', { event: 'auth_saved' })
  return ok(undefined)
}
```

### Custom Auth State Provider

```typescript
// src/bot/authState.ts
import { proto } from '@whiskeysockets/baileys'
import type { AuthenticationCreds, SignalDataTypeMap } from '@whiskeysockets/baileys'
import { initAuthCreds } from '@whiskeysockets/baileys'
import { loadAuthState, saveAuthState } from '../services/supabase.js'
import { logger } from '../utils/logger.js'

interface StoredAuthState {
  creds: AuthenticationCreds
  keys: Record<string, Record<string, any>>
}

export async function useSupabaseAuthState() {
  const loadResult = await loadAuthState()

  let creds: AuthenticationCreds
  let keys: Record<string, Record<string, any>> = {}

  if (loadResult.ok && loadResult.data) {
    const stored = loadResult.data as StoredAuthState
    creds = stored.creds
    keys = stored.keys || {}
    logger.info('Auth state loaded from Supabase', { event: 'auth_loaded' })
  } else {
    creds = initAuthCreds()
    logger.info('Fresh auth state created', { event: 'auth_fresh' })
  }

  const saveCreds = async () => {
    const state: StoredAuthState = { creds, keys }
    await saveAuthState(state)
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type: keyof SignalDataTypeMap, ids: string[]) => {
          const data: Record<string, any> = {}
          const typeData = keys[type] || {}
          for (const id of ids) {
            const value = typeData[id]
            if (value) {
              if (type === 'app-state-sync-key') {
                data[id] = proto.Message.AppStateSyncKeyData.fromObject(value)
              } else {
                data[id] = value
              }
            }
          }
          return data
        },
        set: async (data: any) => {
          for (const category in data) {
            const categoryData = data[category]
            keys[category] = keys[category] || {}
            for (const id in categoryData) {
              keys[category][id] = categoryData[id]
            }
          }
          await saveCreds()
        }
      }
    },
    saveCreds
  }
}
```

### Migration from File-Based Auth

Story 1.1 created file-based auth in `auth_info/` directory. When Story 1.2 is implemented:

1. The `auth_info/` directory will become obsolete
2. Add `auth_info/` to `.gitignore` if not already present
3. Delete the directory after successful Supabase migration
4. Remove `useMultiFileAuthState` import from connection.ts

### Environment Variables Update

Update `.env.example`:
```
# Supabase - REQUIRED for session persistence
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  # Service role key

# MS Graph - Required for Story 5.1
MS_GRAPH_CLIENT_ID=your-client-id
MS_GRAPH_CLIENT_SECRET=your-client-secret

# Bot configuration
PHONE_NUMBER=5511999999999
CONTROL_GROUP_PATTERN=CONTROLE
NODE_ENV=development
HEALTH_PORT=3000
```

### Anti-Patterns to AVOID

- ❌ Using file-based auth state in production
- ❌ Throwing errors from Supabase service functions
- ❌ Storing auth state in multiple tables (keep simple for MVP)
- ❌ Using `console.log` for auth state debugging
- ❌ Exposing Supabase credentials in logs or error messages

### Testing Notes

**Manual Verification Steps:**

1. **Test Fresh Auth:**
   ```bash
   # Clear Supabase table first
   # Start bot - should show pairing code
   npm run dev
   # Link phone with pairing code
   # Verify auth_state appears in Supabase sessions table
   ```

2. **Test Session Restore:**
   ```bash
   # Stop bot (Ctrl+C)
   # Start bot again
   npm run dev
   # Should show "Auth state loaded from Supabase"
   # Should NOT show pairing code
   # Should connect automatically
   ```

3. **Test Corrupted State:**
   ```bash
   # In Supabase: UPDATE sessions SET auth_state = '{}' WHERE id = 'default';
   # Start bot
   npm run dev
   # Should detect invalid state and prompt for fresh auth
   ```

### Learnings from Story 1.1

**Applied to Story 1.2:**
- Use `@whiskeysockets/baileys` (not `@arceos/baileys`) - correct package
- Zod v4 uses `.issues` not `.errors` for error parsing
- Result pattern is established and working
- Structured logger is in place
- Graceful shutdown handlers exist (will work with new auth state)

### References

- [Source: docs/project-context.md#Technical Context] - Stack decisions (Supabase JSONB)
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] - Sessions table schema
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2] - Acceptance criteria
- [Source: 1-1-project-setup-basic-connection.md#Dev Agent Record] - Implementation learnings

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- Fixed Zod v4 syntax: `z.record()` requires two arguments (key type, value type)
- Fixed Zod v4 syntax: `required_error` parameter not supported in `z.string()`, removed
- Fixed TypeScript type mismatch: Used explicit type assertions for `StoredAuthState.keys`
- Fixed TypeScript conversion: Added `as unknown as` for AppStateSyncKeyData type cast

### Completion Notes List

- Created Supabase service with Result pattern (loadAuthState, saveAuthState, clearAuthState)
- Implemented custom Baileys auth state provider (useSupabaseAuthState) compatible with makeWASocket
- Replaced file-based auth (useMultiFileAuthState) with Supabase persistence
- Made SUPABASE_URL and SUPABASE_KEY required environment variables (no defaults)
- Added Supabase initialization to boot sequence (index.ts)
- Updated .env.example with clearer Supabase documentation
- Zod schema validates auth state structure on load (protects against corruption)
- Build compiles successfully with `npm run build`

### File List

**Created:**
- src/services/supabase.ts - Supabase client, initSupabase, loadAuthState, saveAuthState, clearAuthState
- src/bot/authState.ts - useSupabaseAuthState() Baileys-compatible auth state provider

**Modified:**
- src/bot/connection.ts - Replaced useMultiFileAuthState import with useSupabaseAuthState
- src/types/config.ts - Made SUPABASE_URL and SUPABASE_KEY required (no defaults)
- src/index.ts - Added initSupabase(config) call before connection
- .env.example - Updated Supabase documentation and placeholders

### Change Log

- 2026-01-15: Initial implementation of Story 1.2 - Session Persistence in Supabase
- 2026-01-15: Code review completed - 7 issues identified and fixed:
  - CRITICAL: Added clearAuthState() call on loggedOut disconnect (AC3 compliance)
  - HIGH: Added debounce (500ms) to saveCreds to prevent race conditions
  - MEDIUM: Added retry logic (3 attempts with exponential backoff) for save failures
  - MEDIUM: Strengthened Zod schema to validate required Baileys credential fields
  - MEDIUM: Removed dead getSupabaseClient() function
  - LOW: Standardized logging event names to use `auth_state_*` prefix
  - Build verified after all fixes
