/**
 * Log Queue Service (Story 5.3)
 *
 * Stores failed log entries in Supabase for later retry.
 * Implements opportunistic and periodic sync to Excel.
 *
 * Key features:
 * - Persists failed entries to Supabase log_queue table
 * - Opportunistic sync after successful Excel writes
 * - Periodic sync every 5 minutes
 * - Backlog warning when queue exceeds threshold
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ok, err, type Result } from '../utils/result.js'
import { logger } from '../utils/logger.js'
import { getConfig } from '../config.js'
import { queueControlNotification } from '../bot/notifications.js'
import type { LogEntry } from './excel.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Queued log entry with metadata.
 */
export interface QueuedEntry {
  id: string
  entry: LogEntry
  createdAt: Date
  attempts: number
  lastAttemptAt: Date | null
  status: 'pending' | 'syncing' | 'failed'
}

/**
 * Supabase row structure for log_queue table.
 */
interface LogQueueRow {
  id: string
  timestamp: string
  group_name: string
  group_id: string
  client_identifier: string
  quote_value: number
  quote_formatted: string
  created_at: string
  attempts: number
  last_attempt_at: string | null
  status: 'pending' | 'syncing' | 'failed'
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Threshold for backlog warning (AC4).
 */
export const BACKLOG_THRESHOLD = 100

/**
 * Cooldown period for backlog warnings (1 hour).
 */
export const BACKLOG_WARN_COOLDOWN_MS = 60 * 60 * 1000

/**
 * Periodic sync interval (5 minutes).
 */
export const SYNC_INTERVAL_MS = 5 * 60 * 1000

/**
 * Maximum entries to process per sync batch.
 */
const BATCH_SIZE = 50

/**
 * Issue 5.3.6 fix: Maximum retry attempts before marking entry as failed.
 * After this many attempts, entries are marked 'failed' and skipped.
 */
export const MAX_RETRY_ATTEMPTS = 10

// =============================================================================
// Module State
// =============================================================================

/**
 * Supabase client singleton for log queue.
 */
let supabase: SupabaseClient | null = null

/**
 * Last time backlog warning was sent.
 */
let lastBacklogWarnTime: number | null = null

/**
 * Periodic sync timer.
 */
let syncTimer: ReturnType<typeof setInterval> | null = null

/**
 * Excel append function injected from excel.ts (avoids circular dep).
 */
let appendRowFn: ((entry: LogEntry) => Promise<Result<{ rowNumber: number }>>) | null = null

/**
 * Issue 5.3.3 fix: Mutex to prevent concurrent flush operations.
 * Prevents race conditions when multiple triggers call flushQueuedEntries.
 */
let isFlushInProgress = false

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize the log queue service.
 * Must be called before any queue operations.
 */
export function initLogQueue(): void {
  try {
    const config = getConfig()
    supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY)
    logger.info('Log queue initialized', { event: 'log_queue_init' })
  } catch (error) {
    logger.warn('Log queue initialization failed, using in-memory fallback', {
      event: 'log_queue_init_fallback',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Set the Excel append function for queue flushing.
 * Called from excel.ts to inject the append function.
 */
export function setAppendRowFn(fn: (entry: LogEntry) => Promise<Result<{ rowNumber: number }>>): void {
  appendRowFn = fn
}

// =============================================================================
// Queue Operations
// =============================================================================

/**
 * Queue a log entry for later retry.
 *
 * AC1: Store failed entries in Supabase.
 *
 * @param entry - The log entry that failed to write
 * @returns Promise<void> - Resolves when entry is queued
 */
export async function queueLogEntry(entry: LogEntry): Promise<void> {
  if (!supabase) {
    // Fallback to in-memory logging
    logger.warn('Log queue not initialized, entry will be lost', {
      event: 'log_entry_lost',
      groupName: entry.groupName,
    })
    return
  }

  try {
    const { error } = await supabase.from('log_queue').insert({
      timestamp: entry.timestamp.toISOString(),
      group_name: entry.groupName,
      group_id: entry.groupId,
      client_identifier: entry.clientIdentifier,
      quote_value: entry.quoteValue,
      quote_formatted: entry.quoteFormatted,
    })

    if (error) {
      logger.error('Failed to queue log entry', {
        event: 'log_queue_error',
        error: error.message,
        groupName: entry.groupName,
      })
      return
    }

    logger.info('Log entry queued for retry', {
      event: 'log_entry_queued',
      groupName: entry.groupName,
    })

    // Check backlog threshold
    await checkBacklogThreshold()
  } catch (error) {
    logger.error('Exception queueing log entry', {
      event: 'log_queue_exception',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Get queued entries in chronological order.
 *
 * AC5: Chronological order for sync.
 *
 * @returns Promise<Result<QueuedEntry[]>>
 */
export async function getQueuedEntries(): Promise<Result<QueuedEntry[]>> {
  if (!supabase) {
    return err('Log queue not initialized')
  }

  try {
    const { data, error } = await supabase
      .from('log_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (error) {
      return err(error.message)
    }

    const entries: QueuedEntry[] = (data as LogQueueRow[]).map((row) => ({
      id: row.id,
      entry: {
        timestamp: new Date(row.timestamp),
        groupName: row.group_name,
        groupId: row.group_id,
        clientIdentifier: row.client_identifier,
        quoteValue: row.quote_value,
        quoteFormatted: row.quote_formatted,
      },
      createdAt: new Date(row.created_at),
      attempts: row.attempts,
      lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at) : null,
      status: row.status,
    }))

    return ok(entries)
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error')
  }
}

/**
 * Remove an entry from the queue after successful sync.
 *
 * @param id - The entry ID to remove
 * @returns Promise<Result<void>>
 */
export async function removeFromQueue(id: string): Promise<Result<void>> {
  if (!supabase) {
    return err('Log queue not initialized')
  }

  try {
    const { error } = await supabase.from('log_queue').delete().eq('id', id)

    if (error) {
      return err(error.message)
    }

    logger.info('Log entry synced and removed from queue', {
      event: 'log_entry_synced',
      id,
    })

    return ok(undefined)
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error')
  }
}

/**
 * Get current queue length.
 *
 * @returns Promise<Result<number>>
 */
export async function getQueueLength(): Promise<Result<number>> {
  if (!supabase) {
    return ok(0)
  }

  try {
    const { count, error } = await supabase
      .from('log_queue')
      .select('*', { count: 'exact', head: true })

    if (error) {
      return err(error.message)
    }

    return ok(count ?? 0)
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Unknown error')
  }
}

// =============================================================================
// Backlog Warning
// =============================================================================

/**
 * Check if queue exceeds backlog threshold and warn if needed.
 *
 * AC4: Backlog warning at 100+ entries.
 */
async function checkBacklogThreshold(): Promise<void> {
  if (!supabase) return

  try {
    const { count, error } = await supabase
      .from('log_queue')
      .select('*', { count: 'exact', head: true })

    if (error || count === null) return

    if (count >= BACKLOG_THRESHOLD) {
      const now = Date.now()
      if (!lastBacklogWarnTime || now - lastBacklogWarnTime > BACKLOG_WARN_COOLDOWN_MS) {
        lastBacklogWarnTime = now
        queueControlNotification(`⚠️ Excel sync backlog: ${count}+ entries queued`)
        logger.warn('Backlog threshold exceeded', {
          event: 'log_queue_backlog',
          count,
        })
      }
    }
  } catch (error) {
    logger.error('Error checking backlog threshold', {
      event: 'backlog_check_error',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// =============================================================================
// Sync Operations
// =============================================================================

/**
 * Flush queued entries to Excel.
 *
 * AC2: Opportunistic sync after successful write.
 * AC5: Chronological order (oldest first).
 */
export async function flushQueuedEntries(): Promise<void> {
  if (!appendRowFn) {
    logger.debug('No append function set, skipping queue flush', {
      event: 'queue_flush_skipped',
    })
    return
  }

  // Issue 5.3.3 fix: Prevent concurrent flush operations
  if (isFlushInProgress) {
    logger.debug('Queue flush already in progress, skipping', {
      event: 'queue_flush_concurrent_skip',
    })
    return
  }

  isFlushInProgress = true

  try {
    const queueResult = await getQueuedEntries()
    if (!queueResult.ok || queueResult.data.length === 0) {
      return // Nothing to sync
    }

    logger.info('Flushing queued entries', {
      event: 'queue_flush_started',
      count: queueResult.data.length,
    })

    for (const queued of queueResult.data) {
      if (!supabase) break

      // Issue 5.3.6 fix: Check max retry attempts
      if (queued.attempts >= MAX_RETRY_ATTEMPTS) {
        await supabase
          .from('log_queue')
          .update({ status: 'failed' })
          .eq('id', queued.id)

        logger.warn('Entry exceeded max retry attempts, marking as failed', {
          event: 'queue_entry_max_retries',
          id: queued.id,
          attempts: queued.attempts,
          maxAttempts: MAX_RETRY_ATTEMPTS,
        })
        continue // Skip to next entry
      }

      // Mark as syncing
      await supabase
        .from('log_queue')
        .update({
          status: 'syncing',
          attempts: queued.attempts + 1,
          last_attempt_at: new Date().toISOString(),
        })
        .eq('id', queued.id)

      // Attempt write
      const result = await appendRowFn(queued.entry)

      if (result.ok) {
        await removeFromQueue(queued.id)
      } else {
        // Mark as pending again for next attempt
        await supabase
          .from('log_queue')
          .update({ status: 'pending' })
          .eq('id', queued.id)

        // Stop on first failure - maintain order
        logger.warn('Queue flush stopped on failure', {
          event: 'queue_flush_stopped',
          id: queued.id,
          remaining: queueResult.data.length,
          error: result.error,
        })
        break
      }
    }
  } finally {
    isFlushInProgress = false
  }
}

// =============================================================================
// Periodic Sync
// =============================================================================

/**
 * Start periodic sync timer.
 *
 * AC3: Periodic sync every 5 minutes.
 */
export function startPeriodicSync(): void {
  if (syncTimer) {
    logger.debug('Periodic sync already running', { event: 'periodic_sync_already_running' })
    return
  }

  syncTimer = setInterval(async () => {
    await flushQueuedEntries()
  }, SYNC_INTERVAL_MS)

  logger.info('Periodic sync started', {
    event: 'periodic_sync_started',
    intervalMs: SYNC_INTERVAL_MS,
  })
}

/**
 * Stop periodic sync timer.
 */
export function stopPeriodicSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
    logger.info('Periodic sync stopped', { event: 'periodic_sync_stopped' })
  }
}

/**
 * Check if periodic sync is running.
 */
export function isPeriodicSyncRunning(): boolean {
  return syncTimer !== null
}

// =============================================================================
// Testing Utilities
// =============================================================================

/**
 * Reset queue state for testing.
 * Issue 5.3.5 fix: Also reset supabase client.
 */
export function resetQueueState(): void {
  lastBacklogWarnTime = null
  stopPeriodicSync()
  appendRowFn = null
  isFlushInProgress = false
  supabase = null
}

/**
 * Set last backlog warn time for testing.
 */
export function setLastBacklogWarnTime(time: number | null): void {
  lastBacklogWarnTime = time
}
