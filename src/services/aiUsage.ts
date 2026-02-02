/**
 * AI Usage Tracking Service - Story D.9
 *
 * Logs AI API calls to Supabase for cost monitoring.
 * Called by aiClassifier.ts and openrouter.ts after each AI call.
 *
 * Design decisions:
 * - Fire-and-forget: Logging failures don't affect main flow
 * - Batching: Could batch inserts for high volume (not implemented yet)
 * - In-memory aggregates: Kept for fast access, DB for persistence
 */

import { getSupabase } from './supabase.js'
import { logger } from '../utils/logger.js'

/**
 * AI usage record structure.
 */
export interface AIUsageRecord {
  service: 'classification' | 'ocr'
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  groupJid?: string
  durationMs?: number
  success: boolean
  errorMessage?: string
  metadata?: Record<string, unknown>
}

/**
 * Aggregated daily costs by group.
 */
export interface DailyCostSummary {
  date: string
  totalCalls: number
  totalTokens: number
  totalCostUsd: number
  byService: {
    classification: { calls: number; costUsd: number }
    ocr: { calls: number; costUsd: number }
  }
  byGroup: Array<{
    groupJid: string
    calls: number
    costUsd: number
  }>
}

/**
 * In-memory aggregates for fast access.
 */
let memoryTotals = {
  totalCalls: 0,
  totalTokens: 0,
  totalCostUsd: 0,
  todaysCalls: 0,
  todaysCostUsd: 0,
  lastResetDate: new Date().toDateString(),
}

/**
 * Log an AI usage record to Supabase.
 * Fire-and-forget - errors are logged but don't affect main flow.
 */
export async function logAIUsage(record: AIUsageRecord): Promise<void> {
  // Update in-memory totals
  memoryTotals.totalCalls++
  memoryTotals.totalTokens += record.inputTokens + record.outputTokens
  memoryTotals.totalCostUsd += record.costUsd

  // Reset daily totals if date changed
  const today = new Date().toDateString()
  if (memoryTotals.lastResetDate !== today) {
    memoryTotals.todaysCalls = 0
    memoryTotals.todaysCostUsd = 0
    memoryTotals.lastResetDate = today
  }
  memoryTotals.todaysCalls++
  memoryTotals.todaysCostUsd += record.costUsd

  // Log to Supabase (fire-and-forget)
  try {
    const client = getSupabase()
    if (!client) {
      logger.debug('Supabase not initialized, skipping AI usage log', {
        event: 'ai_usage_skip_no_client',
      })
      return
    }

    const { error } = await client.from('ai_usage').insert({
      service: record.service,
      model: record.model,
      input_tokens: record.inputTokens,
      output_tokens: record.outputTokens,
      cost_usd: record.costUsd,
      group_jid: record.groupJid || null,
      duration_ms: record.durationMs || null,
      success: record.success,
      error_message: record.errorMessage || null,
      metadata: record.metadata || {},
    })

    if (error) {
      logger.warn('Failed to log AI usage to Supabase', {
        event: 'ai_usage_log_error',
        error: error.message,
      })
    } else {
      logger.debug('AI usage logged', {
        event: 'ai_usage_logged',
        service: record.service,
        costUsd: record.costUsd.toFixed(6),
      })
    }
  } catch (err) {
    logger.warn('Exception logging AI usage', {
      event: 'ai_usage_exception',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Get in-memory usage totals (fast, no DB query).
 */
export function getMemoryTotals(): typeof memoryTotals {
  return { ...memoryTotals }
}

/**
 * Get cost summary for a date range from Supabase.
 */
export async function getCostSummary(
  startDate: Date,
  endDate: Date
): Promise<DailyCostSummary[] | null> {
  try {
    const client = getSupabase()
    if (!client) return null

    const { data, error } = await client
      .from('ai_usage')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: true })

    if (error) {
      logger.error('Failed to fetch AI usage', {
        event: 'ai_usage_fetch_error',
        error: error.message,
      })
      return null
    }

    // Aggregate by date
    const byDate = new Map<string, DailyCostSummary>()

    for (const row of data || []) {
      const date = new Date(row.created_at).toISOString().split('T')[0]

      if (!byDate.has(date)) {
        byDate.set(date, {
          date,
          totalCalls: 0,
          totalTokens: 0,
          totalCostUsd: 0,
          byService: {
            classification: { calls: 0, costUsd: 0 },
            ocr: { calls: 0, costUsd: 0 },
          },
          byGroup: [],
        })
      }

      const summary = byDate.get(date)!
      summary.totalCalls++
      summary.totalTokens += row.total_tokens || 0
      summary.totalCostUsd += Number(row.cost_usd) || 0

      // By service
      const service = row.service as 'classification' | 'ocr'
      if (summary.byService[service]) {
        summary.byService[service].calls++
        summary.byService[service].costUsd += Number(row.cost_usd) || 0
      }

      // By group (aggregate later)
      if (row.group_jid) {
        const groupEntry = summary.byGroup.find((g) => g.groupJid === row.group_jid)
        if (groupEntry) {
          groupEntry.calls++
          groupEntry.costUsd += Number(row.cost_usd) || 0
        } else {
          summary.byGroup.push({
            groupJid: row.group_jid,
            calls: 1,
            costUsd: Number(row.cost_usd) || 0,
          })
        }
      }
    }

    return Array.from(byDate.values())
  } catch (err) {
    logger.error('Exception fetching AI usage', {
      event: 'ai_usage_fetch_exception',
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * Get today's cost summary.
 */
export async function getTodaysCosts(): Promise<{
  calls: number
  costUsd: number
  byService: { classification: number; ocr: number }
} | null> {
  try {
    const client = getSupabase()
    if (!client) return null

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const { data, error } = await client
      .from('ai_usage')
      .select('service, cost_usd')
      .gte('created_at', today.toISOString())

    if (error) {
      logger.error('Failed to fetch today costs', {
        event: 'ai_usage_today_error',
        error: error.message,
      })
      return null
    }

    let totalCalls = 0
    let totalCostUsd = 0
    const byService = { classification: 0, ocr: 0 }

    for (const row of data || []) {
      totalCalls++
      totalCostUsd += Number(row.cost_usd) || 0
      const service = row.service as 'classification' | 'ocr'
      if (byService[service] !== undefined) {
        byService[service] += Number(row.cost_usd) || 0
      }
    }

    return { calls: totalCalls, costUsd: totalCostUsd, byService }
  } catch (err) {
    logger.error('Exception fetching today costs', {
      event: 'ai_usage_today_exception',
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * Reset in-memory totals (for testing).
 * @internal
 */
export function resetMemoryTotals(): void {
  memoryTotals = {
    totalCalls: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    todaysCalls: 0,
    todaysCostUsd: 0,
    lastResetDate: new Date().toDateString(),
  }
}
