/**
 * Local file backup for WhatsApp auth state.
 * Provides fallback when Supabase is unreachable.
 * All functions return Result<T>, never throw.
 */
import { writeFile, readFile, access, rename, mkdir } from 'fs/promises'
import { constants } from 'fs'
import { dirname } from 'path'
import { z } from 'zod'
import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'
import type { StoredAuthState } from './supabase.js'

/**
 * Default backup file path - can be overridden via AUTH_BACKUP_PATH env var.
 * Uses /opt/enorbot in production, ./auth_state_backup.json for development.
 */
export const AUTH_STATE_BACKUP_PATH =
  process.env.AUTH_BACKUP_PATH || '/opt/enorbot/auth_state_backup.json'

/**
 * Zod schema for validating loaded auth state structure.
 * Matches the baileysCredsSchema from supabase.ts for consistency.
 */
const baileysCredsSchema = z.object({
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
  me: z
    .object({
      id: z.string(),
      name: z.string().optional(),
    })
    .optional(),
  registered: z.boolean().optional(),
}).passthrough()

const storedAuthStateSchema = z.object({
  creds: baileysCredsSchema,
  keys: z.record(z.string(), z.record(z.string(), z.unknown())).optional().default({}),
})

/**
 * Module-level state for testing purposes.
 */
let backupPathOverride: string | null = null

/**
 * Get the current backup file path (allows test override).
 */
export function getBackupPath(): string {
  return backupPathOverride || AUTH_STATE_BACKUP_PATH
}

/**
 * Override backup path for testing.
 * Call with null to reset to default.
 */
export function setBackupPathForTesting(path: string | null): void {
  backupPathOverride = path
}

/**
 * Check if backup directory is writable.
 * Returns ok if writable, error if not.
 */
export async function checkBackupPermissions(): Promise<Result<void>> {
  const backupPath = getBackupPath()
  const dir = dirname(backupPath)

  try {
    // Ensure directory exists
    await mkdir(dir, { recursive: true })

    // Check write access
    await access(dir, constants.W_OK)

    logger.debug('Backup directory writable', {
      event: 'backup_permissions_ok',
      path: dir,
    })
    return ok(undefined)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    logger.warn('Backup directory not writable', {
      event: 'backup_permissions_failed',
      path: dir,
      error,
    })
    return err(`Backup directory not writable: ${error}`)
  }
}

/**
 * Save auth state to local file as JSON.
 * Uses atomic write (write to temp, then rename) to prevent corruption.
 */
export async function saveAuthStateToFile(state: StoredAuthState): Promise<Result<void>> {
  const backupPath = getBackupPath()
  const tempPath = `${backupPath}.tmp`

  try {
    // Ensure directory exists
    const dir = dirname(backupPath)
    await mkdir(dir, { recursive: true })

    // Serialize to JSON with pretty formatting
    const json = JSON.stringify(state, null, 2)

    // Atomic write: write to temp file, then rename
    await writeFile(tempPath, json, 'utf-8')
    await rename(tempPath, backupPath)

    logger.debug('Auth state backed up to file', {
      event: 'auth_backup_saved',
      path: backupPath,
    })
    return ok(undefined)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    logger.warn('Failed to save auth state backup', {
      event: 'auth_backup_save_failed',
      error,
      path: backupPath,
    })
    return err(error)
  }
}

/**
 * Load auth state from local file.
 * Returns null if file doesn't exist (not an error).
 * Validates structure before returning.
 */
export async function loadAuthStateFromFile(): Promise<Result<StoredAuthState | null>> {
  const backupPath = getBackupPath()

  try {
    // Check if file exists
    await access(backupPath, constants.R_OK)

    // Read and parse
    const json = await readFile(backupPath, 'utf-8')
    const parsed = JSON.parse(json)

    // Validate structure
    const validation = storedAuthStateSchema.safeParse(parsed)
    if (!validation.success) {
      logger.warn('Auth backup file corrupted', {
        event: 'auth_backup_corrupted',
        path: backupPath,
        errors: validation.error.issues.map((i) => i.message).join(', '),
      })
      return err('Auth backup file corrupted')
    }

    logger.info('Auth state loaded from local backup', {
      event: 'auth_backup_loaded',
      path: backupPath,
    })
    return ok(validation.data)
  } catch (e) {
    // File not found is not an error - just means no backup exists
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.debug('No local auth backup found', {
        event: 'auth_backup_not_found',
        path: backupPath,
      })
      return ok(null)
    }

    const error = e instanceof Error ? e.message : String(e)
    logger.warn('Failed to load auth state backup', {
      event: 'auth_backup_load_failed',
      error,
      path: backupPath,
    })
    return err(error)
  }
}

/**
 * Delete auth state backup file if it exists.
 * Used for cleanup or forced re-authentication.
 */
export async function clearAuthStateBackup(): Promise<Result<void>> {
  const backupPath = getBackupPath()

  try {
    const { unlink } = await import('fs/promises')
    await unlink(backupPath)

    logger.info('Auth state backup cleared', {
      event: 'auth_backup_cleared',
      path: backupPath,
    })
    return ok(undefined)
  } catch (e) {
    // File not found is not an error
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.debug('No auth backup to clear', {
        event: 'auth_backup_already_clear',
        path: backupPath,
      })
      return ok(undefined)
    }

    const error = e instanceof Error ? e.message : String(e)
    logger.warn('Failed to clear auth state backup', {
      event: 'auth_backup_clear_failed',
      error,
      path: backupPath,
    })
    return err(error)
  }
}

/**
 * Reset module state for testing.
 */
export function resetAuthBackupState(): void {
  backupPathOverride = null
}
