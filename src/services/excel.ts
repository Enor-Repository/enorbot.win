/**
 * Excel Logging Service (Story 5.2)
 *
 * Logs price quotes to Excel Online via MS Graph API.
 * Uses the authentication service from Story 5.1.
 *
 * Key features:
 * - Appends rows to configured Excel worksheet
 * - Validates Excel file access on initialization
 * - Queues failed entries for retry (Story 5.3)
 * - Returns Result type, never throws
 */
import { ok, err, type Result } from '../utils/result.js'
import { logger } from '../utils/logger.js'
import { getConfig } from '../config.js'
import { ensureValidToken, classifyGraphError } from './graph.js'
import { queueLogEntry, flushQueuedEntries, setAppendRowFn } from './logQueue.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Log entry for price quotes.
 * Contains all information needed for audit trail.
 */
export interface LogEntry {
  timestamp: Date
  groupName: string
  groupId: string
  clientIdentifier: string
  quoteValue: number
  quoteFormatted: string
}

/**
 * Issue 5.2.6 fix: Explicit type for Excel API row response.
 */
interface ExcelRowResponse {
  index?: number
  values?: string[][]
}

/**
 * Issue 5.2.6 fix: Explicit type for Excel file metadata response.
 */
interface ExcelFileMetadata {
  name?: string
  id?: string
}

// =============================================================================
// Constants
// =============================================================================

/**
 * MS Graph API base URL.
 */
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0'

/**
 * Timeout for Graph API requests.
 */
const GRAPH_TIMEOUT_MS = 10000

// =============================================================================
// Private Functions
// =============================================================================

/**
 * Build the URL for the Excel rows endpoint.
 * Issue 5.2.1 fix: Use sites/drives API for app-only auth instead of /me/
 */
function buildRowsUrl(): string {
  const config = getConfig()
  const siteId = config.EXCEL_SITE_ID || ''
  const driveId = config.EXCEL_DRIVE_ID || ''
  const fileId = config.EXCEL_FILE_ID || ''
  const worksheetName = config.EXCEL_WORKSHEET_NAME || 'Quotes'
  const tableName = config.EXCEL_TABLE_NAME || 'Table1'

  // Use sites/{siteId}/drives/{driveId}/items pattern for app-only auth
  return `${GRAPH_API_BASE}/sites/${siteId}/drives/${driveId}/items/${fileId}/workbook/worksheets/${worksheetName}/tables/${tableName}/rows`
}

/**
 * Build the URL for the Excel file metadata endpoint.
 * Issue 5.2.1 fix: Use sites/drives API for app-only auth instead of /me/
 */
function buildFileUrl(): string {
  const config = getConfig()
  const siteId = config.EXCEL_SITE_ID || ''
  const driveId = config.EXCEL_DRIVE_ID || ''
  const fileId = config.EXCEL_FILE_ID || ''

  return `${GRAPH_API_BASE}/sites/${siteId}/drives/${driveId}/items/${fileId}`
}

/**
 * Format log entry as row data array.
 * Order: [timestamp, groupName, clientIdentifier, quoteFormatted]
 */
function formatRowData(entry: LogEntry): string[][] {
  return [
    [
      entry.timestamp.toISOString(),
      entry.groupName,
      entry.clientIdentifier,
      entry.quoteFormatted,
    ],
  ]
}

// =============================================================================
// Public Functions
// =============================================================================

/**
 * Log a price quote to Excel Online.
 *
 * AC1: Appends row to configured worksheet
 * AC2: Row format: [timestamp, group, client, quote]
 * AC4: Returns {ok: true, data: {rowNumber}} on success
 * AC5: Returns {ok: false, error: "..."} on failure and queues for retry
 *
 * @param entry - The log entry to write
 * @returns Promise<Result<{rowNumber: number}>> - Row number on success
 */
export async function logPriceQuote(entry: LogEntry): Promise<Result<{ rowNumber: number }>> {
  // Get valid token
  const tokenResult = await ensureValidToken()
  if (!tokenResult.ok) {
    logger.error('Excel logging auth failed', {
      event: 'excel_auth_error',
      error: tokenResult.error,
      groupName: entry.groupName,
    })

    // Queue for retry
    await queueLogEntry(entry)

    return err(`Auth failed: ${tokenResult.error}`)
  }

  const url = buildRowsUrl()
  const rowData = formatRowData(entry)

  // Issue 5.2.3 fix: Use try-finally for proper timeout cleanup
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenResult.data}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: rowData }),
      signal: controller.signal,
    })

    if (!response.ok) {
      logger.error('Excel append failed', {
        event: 'excel_append_error',
        status: response.status,
        statusText: response.statusText,
        groupName: entry.groupName,
      })

      // Queue for retry
      await queueLogEntry(entry)

      return err(`Excel API error: ${response.status} ${response.statusText}`)
    }

    const result = (await response.json()) as ExcelRowResponse
    const rowNumber = result.index ?? 0

    logger.info('Excel row appended', {
      event: 'excel_row_appended',
      rowNumber,
      groupName: entry.groupName,
      quote: entry.quoteFormatted,
    })

    // Story 5.3: Opportunistic queue flush after successful write
    flushQueuedEntries().catch((flushError) => {
      logger.debug('Queue flush failed after successful write', {
        event: 'queue_flush_opportunistic_error',
        error: flushError instanceof Error ? flushError.message : String(flushError),
      })
    })

    return ok({ rowNumber })
  } catch (error) {
    const classification = classifyGraphError(error)

    logger.error('Excel logging exception', {
      event: 'excel_log_exception',
      classification,
      error: error instanceof Error ? error.message : String(error),
      groupName: entry.groupName,
    })

    // Queue for retry
    await queueLogEntry(entry)

    return err(error instanceof Error ? error.message : 'Excel logging failed')
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Validate Excel file access.
 *
 * AC3: Verifies file exists and is accessible with current credentials.
 *
 * @returns Promise<Result<void>> - ok if accessible, error otherwise
 */
export async function validateExcelAccess(): Promise<Result<void>> {
  // Get valid token
  const tokenResult = await ensureValidToken()
  if (!tokenResult.ok) {
    logger.error('Excel validation auth failed', {
      event: 'excel_validation_error',
      error: tokenResult.error,
    })
    return err(`Auth failed: ${tokenResult.error}`)
  }

  const url = buildFileUrl()

  // Issue 5.2.3 fix: Use try-finally for proper timeout cleanup
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenResult.data}`,
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      logger.error('Excel validation failed', {
        event: 'excel_validation_error',
        status: response.status,
        statusText: response.statusText,
      })
      return err(`Excel file not accessible: ${response.status} ${response.statusText}`)
    }

    const metadata = (await response.json()) as ExcelFileMetadata
    const fileName = metadata.name ?? 'unknown'

    logger.info('Excel validation successful', {
      event: 'excel_validation_success',
      fileName,
    })

    return ok(undefined)
  } catch (error) {
    logger.error('Excel validation exception', {
      event: 'excel_validation_error',
      error: error instanceof Error ? error.message : String(error),
    })

    return err(error instanceof Error ? error.message : 'Excel validation failed')
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Append row directly to Excel without queue integration.
 * Used by logQueue to flush queued entries (avoids circular queueing).
 *
 * @param entry - The log entry to write
 * @returns Promise<Result<{rowNumber: number}>> - Row number on success
 */
export async function appendRowDirect(entry: LogEntry): Promise<Result<{ rowNumber: number }>> {
  // Get valid token
  const tokenResult = await ensureValidToken()
  if (!tokenResult.ok) {
    logger.error('Excel direct append auth failed', {
      event: 'excel_direct_auth_error',
      error: tokenResult.error,
      groupName: entry.groupName,
    })
    return err(`Auth failed: ${tokenResult.error}`)
  }

  const url = buildRowsUrl()
  const rowData = formatRowData(entry)

  // Issue 5.2.3 fix: Use try-finally for proper timeout cleanup
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenResult.data}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: rowData }),
      signal: controller.signal,
    })

    if (!response.ok) {
      logger.error('Excel direct append failed', {
        event: 'excel_direct_append_error',
        status: response.status,
        statusText: response.statusText,
        groupName: entry.groupName,
      })
      return err(`Excel API error: ${response.status} ${response.statusText}`)
    }

    const result = (await response.json()) as ExcelRowResponse
    const rowNumber = result.index ?? 0

    logger.info('Excel row appended (direct)', {
      event: 'excel_direct_row_appended',
      rowNumber,
      groupName: entry.groupName,
    })

    return ok({ rowNumber })
  } catch (error) {
    logger.error('Excel direct append exception', {
      event: 'excel_direct_exception',
      error: error instanceof Error ? error.message : String(error),
      groupName: entry.groupName,
    })
    return err(error instanceof Error ? error.message : 'Excel direct append failed')
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Initialize the Excel service.
 * Registers the append function with logQueue for queue flush.
 * Validates Excel file access (AC3) - fire-and-forget to not block startup.
 */
export function initExcelService(): void {
  setAppendRowFn(appendRowDirect)

  // Issue 5.2.5 fix: Validate Excel access on init (fire-and-forget)
  // Don't block startup, but log validation result
  validateExcelAccess()
    .then((result) => {
      if (!result.ok) {
        logger.warn('Excel validation failed during init', {
          event: 'excel_init_validation_failed',
          error: result.error,
        })
      }
    })
    .catch((error) => {
      logger.warn('Excel validation exception during init', {
        event: 'excel_init_validation_exception',
        error: error instanceof Error ? error.message : String(error),
      })
    })

  logger.info('Excel service initialized', { event: 'excel_service_init' })
}
