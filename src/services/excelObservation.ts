/**
 * Excel Observation Service (Story 8.3)
 *
 * Logs observation entries to a separate Excel worksheet for pattern analysis.
 * Uses the same MS Graph authentication as excel.ts.
 *
 * Key features:
 * - Appends rows to Observations worksheet
 * - 18 columns for comprehensive pattern data
 * - Queues failed entries for retry
 * - Returns Result type, never throws
 */
import { ok, err, type Result } from '../utils/result.js'
import { logger } from '../utils/logger.js'
import { getConfig } from '../config.js'
import { isSimulation } from '../utils/simulationContext.js'
import { ensureValidToken, classifyGraphError } from './graph.js'
import { getContentPreview, type OTCMessageType, type PlayerRole } from './messageClassifier.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Observation log entry for pattern analysis.
 * Designed for per-group behavioral extraction.
 *
 * Excel columns (18 total):
 * Timestamp, Group_ID, Group_Name, Player_JID, Player_Name, Player_Role,
 * Message_Type, Trigger_Pattern, Conversation_Thread, Volume_BRL, Volume_USDT,
 * Content_Preview, Response_Required, Response_Given, Response_Time_ms,
 * Hour_of_Day, Day_of_Week, AI_Used
 */
export interface ObservationLogEntry {
  // Identity & Partitioning
  timestamp: Date
  groupId: string
  groupName: string
  playerJid: string
  playerName: string
  playerRole: PlayerRole

  // Message Classification
  messageType: OTCMessageType
  triggerPattern: string | null      // What phrase triggered this
  conversationThread: string | null  // UUID linking related messages

  // Extracted Data
  volumeBrl: number | null
  volumeUsdt: number | null
  contentPreview: string             // First 100 chars for reference

  // Response Tracking
  responseRequired: boolean          // Did this message need a bot response?
  responseGiven: string | null       // What the bot said (first 100 chars)
  responseTimeMs: number | null      // Latency tracking

  // Activity Patterns
  hourOfDay: number                  // 0-23 for activity analysis
  dayOfWeek: number                  // 0-6 (Sunday-Saturday)

  // Cost Tracking
  aiUsed: boolean                    // Did we use OpenRouter for this?
}

/**
 * Response type for Excel row append.
 */
interface ExcelRowResponse {
  index?: number
  values?: string[][]
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
 * Check if a group name matches the Liqd group pattern.
 * Case-insensitive match for "liqd" anywhere in the name.
 */
function isLiqdGroup(groupName: string): boolean {
  return groupName.toLowerCase().includes('liqd')
}

/**
 * Build the URL for the Observations worksheet rows endpoint.
 * Uses the EXCEL_OBSERVATIONS_WORKSHEET_NAME and EXCEL_OBSERVATIONS_TABLE_NAME config.
 */
function buildObservationsRowsUrl(): string {
  const config = getConfig()
  const siteId = config.EXCEL_SITE_ID || ''
  const driveId = config.EXCEL_DRIVE_ID || ''
  const fileId = config.EXCEL_FILE_ID || ''
  const worksheetName = config.EXCEL_OBSERVATIONS_WORKSHEET_NAME || 'Observations'
  const tableName = config.EXCEL_OBSERVATIONS_TABLE_NAME || 'ObservationsTable'

  return `${GRAPH_API_BASE}/sites/${siteId}/drives/${driveId}/items/${fileId}/workbook/worksheets/${worksheetName}/tables/${tableName}/rows`
}

/**
 * Build the URL for the Liqd worksheet rows endpoint.
 * Dedicated worksheet for Liqd group observations.
 */
function buildLiqdRowsUrl(): string {
  const config = getConfig()
  const siteId = config.EXCEL_SITE_ID || ''
  const driveId = config.EXCEL_DRIVE_ID || ''
  const fileId = config.EXCEL_FILE_ID || ''
  const worksheetName = config.EXCEL_LIQD_WORKSHEET_NAME || 'Liqd'
  const tableName = config.EXCEL_LIQD_TABLE_NAME || 'LiqdTable'

  return `${GRAPH_API_BASE}/sites/${siteId}/drives/${driveId}/items/${fileId}/workbook/worksheets/${worksheetName}/tables/${tableName}/rows`
}

/**
 * Extract time patterns from a date.
 * Story 8.3 AC4/AC5: Extract hour_of_day and day_of_week
 */
export function extractTimePatterns(date: Date): { hourOfDay: number; dayOfWeek: number } {
  return {
    hourOfDay: date.getHours(),  // 0-23
    dayOfWeek: date.getDay(),    // 0-6 (Sunday = 0)
  }
}

/**
 * Format observation entry as row data array.
 * Order matches the 18-column schema defined in tech spec.
 *
 * Column order:
 * [Timestamp, Group_ID, Group_Name, Player_JID, Player_Name, Player_Role,
 *  Message_Type, Trigger_Pattern, Conversation_Thread, Volume_BRL, Volume_USDT,
 *  Content_Preview, Response_Required, Response_Given, Response_Time_ms,
 *  Hour_of_Day, Day_of_Week, AI_Used]
 */
function formatObservationRow(entry: ObservationLogEntry): string[][] {
  return [
    [
      entry.timestamp.toISOString(),                           // Timestamp
      entry.groupId,                                           // Group_ID
      entry.groupName,                                         // Group_Name
      entry.playerJid,                                         // Player_JID
      entry.playerName,                                        // Player_Name
      entry.playerRole,                                        // Player_Role
      entry.messageType,                                       // Message_Type
      entry.triggerPattern ?? '',                              // Trigger_Pattern
      entry.conversationThread ?? '',                          // Conversation_Thread
      entry.volumeBrl !== null ? entry.volumeBrl.toString() : '',     // Volume_BRL
      entry.volumeUsdt !== null ? entry.volumeUsdt.toString() : '',   // Volume_USDT
      entry.contentPreview,                                    // Content_Preview
      entry.responseRequired ? 'TRUE' : 'FALSE',               // Response_Required
      entry.responseGiven ?? '',                               // Response_Given
      entry.responseTimeMs !== null ? entry.responseTimeMs.toString() : '',  // Response_Time_ms
      entry.hourOfDay.toString(),                              // Hour_of_Day
      entry.dayOfWeek.toString(),                              // Day_of_Week
      entry.aiUsed ? 'TRUE' : 'FALSE',                         // AI_Used
    ],
  ]
}

// =============================================================================
// Private Helper
// =============================================================================

/**
 * Core implementation for appending observation row to Excel.
 * Issue fix: Extracted to avoid code duplication.
 *
 * Routes Liqd group messages to dedicated worksheet, others to general Observations.
 *
 * @param entry - The observation entry to write
 * @param eventPrefix - Prefix for log events ('observation' or 'observation_direct')
 * @returns Promise<Result<{rowNumber: number}>> - Row number on success
 */
async function appendObservationRowCore(
  entry: ObservationLogEntry,
  eventPrefix: 'observation' | 'observation_direct'
): Promise<Result<{ rowNumber: number }>> {
  const tokenResult = await ensureValidToken()
  if (!tokenResult.ok) {
    logger.warn(`${eventPrefix === 'observation' ? 'Observation logging' : 'Observation direct append'} auth failed`, {
      event: `${eventPrefix}_auth_error`,
      error: tokenResult.error,
      groupId: entry.groupId,
    })
    return err(`Auth failed: ${tokenResult.error}`)
  }

  // Route to Liqd worksheet if group name matches, otherwise general Observations
  const isLiqd = isLiqdGroup(entry.groupName)
  const url = isLiqd ? buildLiqdRowsUrl() : buildObservationsRowsUrl()
  const rowData = formatObservationRow(entry)

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
      logger.warn(`${eventPrefix === 'observation' ? 'Observation append' : 'Observation direct append'} failed`, {
        event: `${eventPrefix}_append_error`,
        status: response.status,
        statusText: response.statusText,
        groupId: entry.groupId,
        ...(eventPrefix === 'observation' && { messageType: entry.messageType }),
      })
      return err(`Excel API error: ${response.status} ${response.statusText}`)
    }

    const result = (await response.json()) as ExcelRowResponse
    const rowNumber = result.index ?? 0

    logger.debug(`Observation row appended${eventPrefix === 'observation_direct' ? ' (direct)' : ''}`, {
      event: `${eventPrefix}_row_appended`,
      rowNumber,
      groupId: entry.groupId,
      messageType: entry.messageType,
      worksheet: isLiqd ? 'Liqd' : 'Observations',
      ...(eventPrefix === 'observation' && { threadId: entry.conversationThread }),
    })

    return ok({ rowNumber })
  } catch (error) {
    if (eventPrefix === 'observation') {
      const classification = classifyGraphError(error)
      logger.warn('Observation logging exception', {
        event: 'observation_log_exception',
        classification,
        error: error instanceof Error ? error.message : String(error),
        groupId: entry.groupId,
      })
    } else {
      logger.warn('Observation direct append exception', {
        event: 'observation_direct_exception',
        error: error instanceof Error ? error.message : String(error),
        groupId: entry.groupId,
      })
    }

    return err(error instanceof Error ? error.message : `${eventPrefix === 'observation' ? 'Observation logging' : 'Observation direct append'} failed`)
  } finally {
    clearTimeout(timeoutId)
  }
}

// =============================================================================
// Public Functions
// =============================================================================

/**
 * Log an observation to Excel Online.
 *
 * Story 8.3 AC1: logObservation() appends row to Observations worksheet
 * Story 8.3 AC2: All 18 columns populated correctly
 * Story 8.3 AC3: Failed writes queue to observation_queue table (via caller)
 * Story 8.3 AC6: Does not affect existing excel.ts price quote logging
 *
 * @param entry - The observation entry to write
 * @returns Promise<Result<{rowNumber: number}>> - Row number on success
 */
export async function logObservation(entry: ObservationLogEntry): Promise<Result<{ rowNumber: number }>> {
  if (isSimulation()) return ok({ rowNumber: -1 })
  return appendObservationRowCore(entry, 'observation')
}

/**
 * Append observation row directly without queue integration.
 * Used by logQueue to flush queued entries (avoids circular queueing).
 *
 * @param entry - The observation entry to write
 * @returns Promise<Result<{rowNumber: number}>> - Row number on success
 */
export async function appendObservationRowDirect(entry: ObservationLogEntry): Promise<Result<{ rowNumber: number }>> {
  return appendObservationRowCore(entry, 'observation_direct')
}

/**
 * Maximum length for content preview.
 */
export const CONTENT_PREVIEW_MAX_LENGTH = 100

/**
 * Create an observation entry from message context.
 * Helper function to build ObservationLogEntry from router context.
 *
 * Issue fix: Added input validation to prevent corrupted Excel rows.
 */
export function createObservationEntry(params: {
  groupId: string
  groupName: string
  playerJid: string
  playerName: string
  playerRole: PlayerRole
  messageType: OTCMessageType
  triggerPattern: string | null
  conversationThread: string | null
  volumeBrl: number | null
  volumeUsdt: number | null
  content: string
  responseRequired: boolean
  responseGiven?: string | null
  responseTimeMs?: number | null
  aiUsed?: boolean
}): ObservationLogEntry {
  // Validate required string fields (Issue fix: prevent corrupted rows)
  const groupId = params.groupId || 'unknown'
  const groupName = params.groupName || 'Unknown Group'
  const playerJid = params.playerJid || 'unknown@s.whatsapp.net'
  const playerName = params.playerName || 'Unknown'
  const content = params.content ?? ''

  const now = new Date()
  const { hourOfDay, dayOfWeek } = extractTimePatterns(now)

  // Issue fix: Use consistent truncation from messageClassifier (truncates at word boundaries)
  const contentPreview = getContentPreview(content, CONTENT_PREVIEW_MAX_LENGTH)

  return {
    timestamp: now,
    groupId,
    groupName,
    playerJid,
    playerName,
    playerRole: params.playerRole,
    messageType: params.messageType,
    triggerPattern: params.triggerPattern,
    conversationThread: params.conversationThread,
    volumeBrl: params.volumeBrl,
    volumeUsdt: params.volumeUsdt,
    contentPreview,
    responseRequired: params.responseRequired,
    responseGiven: params.responseGiven ?? null,
    responseTimeMs: params.responseTimeMs ?? null,
    hourOfDay,
    dayOfWeek,
    aiUsed: params.aiUsed ?? false,
  }
}
