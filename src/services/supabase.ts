/**
 * Supabase service for auth state persistence.
 * All functions return Result<T>, never throw.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'
import type { EnvConfig } from '../types/config.js'
import { saveAuthStateToFile, loadAuthStateFromFile } from './authBackup.js'
import { queueControlNotification } from '../bot/notifications.js'

// Supabase client singleton
let supabase: SupabaseClient | null = null

// Health check configuration
const HEALTH_CHECK_TIMEOUT_MS = 5000

// Extended retry configuration for auth state loading (Story 5.4 AC4)
export const AUTH_RETRY_CONFIG = {
  maxRetries: 10,
  delays: [1000, 2000, 4000, 8000, 16000, 30000, 60000, 120000, 180000, 300000], // ms
  totalWindowMs: 5 * 60 * 1000, // 5 minutes total
}

// Database connectivity alerting configuration (Story 5.4 AC5)
const DB_ALERT_THRESHOLD_MS = 60 * 1000 // 60 seconds
const DB_ALERT_COOLDOWN_MS = 10 * 60 * 1000 // 10 minutes

// Database failure tracking state
let firstFailureTime: number | null = null
let lastAlertTime: number | null = null

/**
 * Track a database failure for alerting purposes.
 * If failures persist for 60+ seconds, sends a control notification.
 * Rate limited to max 1 alert per 10 minutes.
 *
 * Story 5.4 AC5: Database connectivity alert.
 */
export function trackDatabaseFailure(): void {
  const now = Date.now()

  if (!firstFailureTime) {
    firstFailureTime = now
    logger.debug('Database failure tracking started', {
      event: 'db_failure_tracking_started',
    })
  }

  const failureDuration = now - firstFailureTime

  if (failureDuration >= DB_ALERT_THRESHOLD_MS) {
    if (!lastAlertTime || now - lastAlertTime >= DB_ALERT_COOLDOWN_MS) {
      lastAlertTime = now
      queueControlNotification('Database unreachable for 60+ seconds - using local backup')
      logger.error('Database connectivity alert', {
        event: 'db_connectivity_alert',
        failureDurationMs: failureDuration,
      })
    }
  }
}

/**
 * Clear database failure tracking on successful operation.
 * Logs recovery if there was a previous failure.
 */
export function clearDatabaseFailureTracking(): void {
  if (firstFailureTime) {
    const downDuration = Date.now() - firstFailureTime
    logger.info('Database connectivity restored', {
      event: 'db_connectivity_restored',
      downDurationMs: downDuration,
    })
  }
  firstFailureTime = null
}

/**
 * Reset database failure tracking state for testing.
 */
export function resetDatabaseFailureTracking(): void {
  firstFailureTime = null
  lastAlertTime = null
}

/**
 * Zod schema for validating Baileys credentials structure.
 * Validates required fields exist (structure check) while keeping types loose
 * since Uint8Array serializes to { "0": n, "1": m, ... } in JSON.
 */
const baileysCredsSchema = z.object({
  // Required Baileys authentication fields - validate existence, not exact types
  noiseKey: z.object({
    private: z.unknown(),
    public: z.unknown(),
  }),
  signedIdentityKey: z.object({
    private: z.unknown(),
    public: z.unknown(),
  }),
  signedPreKey: z.object({
    keyPair: z.object({
      private: z.unknown(),
      public: z.unknown(),
    }),
    signature: z.unknown(),
    keyId: z.number(),
  }),
  registrationId: z.number(),
  advSecretKey: z.string(),
  nextPreKeyId: z.number(),
  firstUnuploadedPreKeyId: z.number(),
  accountSyncCounter: z.number(),
  accountSettings: z.object({
    unarchiveChats: z.boolean(),
  }),
  // Optional fields that may not exist initially
  me: z.object({
    id: z.string(),
    name: z.string().optional(),
  }).optional(),
  registered: z.boolean().optional(),
}).passthrough() // Allow additional fields Baileys may add

/**
 * Stored auth state type - uses Record for TypeScript compatibility.
 * The baileysCredsSchema validates structure, but we use loose types here.
 */
export interface StoredAuthState {
  creds: Record<string, unknown>
  keys: Record<string, Record<string, unknown>>
}

/**
 * Internal Zod schema for validation only.
 * Type is not exported - use StoredAuthState interface instead.
 */
const storedAuthStateSchema = z.object({
  creds: baileysCredsSchema,
  keys: z.record(z.string(), z.record(z.string(), z.unknown())).optional().default({}),
})

/**
 * Initialize Supabase client with config.
 * Must be called before any other Supabase operations.
 */
export function initSupabase(config: EnvConfig): void {
  supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY)
  logger.info('Supabase client initialized', { event: 'supabase_init' })
}

/**
 * Get the Supabase client instance.
 * Returns null if not initialized.
 */
export function getSupabase() {
  return supabase
}

/**
 * Check if Supabase is reachable with a simple query.
 * Uses a 5-second timeout to detect connectivity issues quickly.
 *
 * Used before reconnection attempts to avoid connecting with invalid/missing auth state.
 */
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
        error: error.message,
        code: error.code,
      })
      return err(error.message)
    }

    logger.debug('Supabase health check passed', { event: 'supabase_health_ok' })
    return ok(undefined)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    const isAbort = e instanceof Error && e.name === 'AbortError'

    logger.warn('Supabase health check exception', {
      event: 'supabase_health_exception',
      error: errorMessage,
      isTimeout: isAbort,
    })

    return err(isAbort ? 'Health check timeout' : errorMessage)
  }
}

/**
 * Load auth state from Supabase sessions table (internal implementation).
 * Returns null if no auth state exists (fresh auth needed).
 * Returns validated StoredAuthState if found.
 */
async function loadAuthStateFromSupabase(): Promise<Result<StoredAuthState | null>> {
  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('auth_state')
      .eq('id', 'default')
      .single()

    if (error) {
      // PGRST116 = row not found - this is expected for fresh auth
      // Supabase is reachable, just no data yet
      if (error.code === 'PGRST116') {
        clearDatabaseFailureTracking() // Supabase is working
        logger.info('No existing auth state found in Supabase', { event: 'auth_not_found_supabase' })
        return ok(null)
      }
      // Actual error - track failure (Story 5.4 AC5)
      trackDatabaseFailure()
      logger.error('Failed to load auth state from Supabase', {
        event: 'auth_load_error',
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Supabase error: ${error.message}`)
    }

    // Success - clear any failure tracking (Story 5.4 AC5)
    clearDatabaseFailureTracking()

    // Validate the loaded auth state structure
    const parseResult = storedAuthStateSchema.safeParse(data.auth_state)
    if (!parseResult.success) {
      logger.warn('Auth state structure invalid, treating as corrupted', {
        event: 'auth_invalid',
        errors: parseResult.error.issues.map((i) => i.message).join(', '),
      })
      return ok(null) // Treat invalid state as missing - will trigger fresh auth
    }

    logger.info('Auth state loaded from Supabase', {
      event: 'auth_loaded',
      source: 'supabase',
    })
    return ok(parseResult.data)
  } catch (e) {
    // Exception - track failure (Story 5.4 AC5)
    trackDatabaseFailure()
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Unexpected error loading auth state from Supabase', {
      event: 'auth_load_exception',
      error: errorMessage,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Load auth state with fallback from Supabase to local file.
 * Tries Supabase first, falls back to local backup if Supabase fails.
 * Returns null only if both sources have no auth state.
 */
export async function loadAuthState(): Promise<Result<StoredAuthState | null>> {
  // Try Supabase first
  const supabaseResult = await loadAuthStateFromSupabase()

  if (supabaseResult.ok) {
    // Supabase succeeded - return the result (could be null if no auth exists)
    return supabaseResult
  }

  // Supabase failed - try local backup
  logger.warn('Supabase unreachable, trying local backup', {
    event: 'auth_state_fallback',
    supabaseError: supabaseResult.error,
  })

  const fileResult = await loadAuthStateFromFile()

  if (fileResult.ok && fileResult.data) {
    logger.info('Using local auth state backup (Supabase unreachable)', {
      event: 'auth_loaded',
      source: 'local_file',
    })
    return fileResult
  }

  // Check if local file had no data (not found is ok, means fresh auth)
  if (fileResult.ok && fileResult.data === null) {
    logger.warn('Auth state unavailable from all sources', {
      event: 'auth_state_unavailable',
      supabaseError: supabaseResult.error,
      fileStatus: 'not_found',
    })
    // Return the original Supabase error so caller knows it failed
    return supabaseResult
  }

  // Both failed with errors - extract errors for logging
  const supabaseErr = !supabaseResult.ok ? supabaseResult.error : 'unknown'
  const fileErr = !fileResult.ok ? fileResult.error : 'unknown'

  logger.error('Auth state unavailable from all sources', {
    event: 'auth_state_unavailable',
    supabaseError: supabaseErr,
    fileError: fileErr,
  })

  return err(`Auth state unavailable: Supabase (${supabaseErr}), Local (${fileErr})`)
}

/**
 * Load auth state with extended retry window.
 * Retries with exponential backoff up to 5 minutes before giving up.
 * Used during connection establishment to handle temporary database outages.
 *
 * Story 5.4 AC4: Extended retry window to prevent premature session loss.
 */
export async function loadAuthStateWithRetry(): Promise<Result<StoredAuthState | null>> {
  const startTime = Date.now()

  for (let attempt = 0; attempt < AUTH_RETRY_CONFIG.maxRetries; attempt++) {
    const result = await loadAuthState()

    if (result.ok) {
      if (attempt > 0) {
        logger.info('Auth state loaded after retry', {
          event: 'auth_state_retry_success',
          attempts: attempt + 1,
          elapsedMs: Date.now() - startTime,
        })
      }
      return result
    }

    const elapsed = Date.now() - startTime
    if (elapsed >= AUTH_RETRY_CONFIG.totalWindowMs) {
      logger.error('Auth state retry window exhausted', {
        event: 'auth_state_retry_exhausted',
        attempts: attempt + 1,
        elapsedMs: elapsed,
        error: result.error,
      })
      return err(`Failed to load auth state after ${attempt + 1} attempts (${Math.round(elapsed / 1000)}s)`)
    }

    // Get delay for this attempt (use last delay if we exceed array length)
    const delay =
      AUTH_RETRY_CONFIG.delays[attempt] ||
      AUTH_RETRY_CONFIG.delays[AUTH_RETRY_CONFIG.delays.length - 1]

    logger.warn('Auth state load failed, retrying', {
      event: 'auth_state_retry_scheduled',
      attempt: attempt + 1,
      nextRetryMs: delay,
      elapsedMs: elapsed,
      error: result.error,
    })

    await new Promise((resolve) => setTimeout(resolve, delay))
  }

  return err('Failed to load auth state after all retries')
}

/**
 * Save auth state to Supabase sessions table.
 * Uses upsert to create or update the session.
 */
export async function saveAuthState(state: StoredAuthState): Promise<Result<void>> {
  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    const { error } = await supabase.from('sessions').upsert({
      id: 'default',
      auth_state: state,
      updated_at: new Date().toISOString(),
    })

    if (error) {
      logger.error('Failed to save auth state', {
        event: 'auth_save_error',
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Supabase error: ${error.message}`)
    }

    logger.debug('Auth state saved to Supabase', { event: 'auth_saved' })

    // Also save to local file as backup (fire-and-forget, don't fail main save)
    saveAuthStateToFile(state).catch((e) => {
      logger.warn('Local backup save failed', {
        event: 'auth_backup_async_failed',
        error: e instanceof Error ? e.message : String(e),
      })
    })

    return ok(undefined)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Unexpected error saving auth state', {
      event: 'auth_save_exception',
      error: errorMessage,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Clear auth state from Supabase (delete the session row).
 * Used for forced re-authentication or testing.
 */
export async function clearAuthState(): Promise<Result<void>> {
  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    const { error } = await supabase.from('sessions').delete().eq('id', 'default')

    if (error) {
      logger.error('Failed to clear auth state', {
        event: 'auth_clear_error',
        errorCode: error.code,
        errorMessage: error.message,
      })
      return err(`Supabase error: ${error.message}`)
    }

    logger.info('Auth state cleared from Supabase', { event: 'auth_cleared' })
    return ok(undefined)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Unexpected error clearing auth state', {
      event: 'auth_clear_exception',
      error: errorMessage,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}
