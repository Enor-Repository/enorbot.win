/**
 * System Pattern Service
 * Loads editable keyword patterns from Supabase with in-memory caching.
 * These are global patterns (not per-group) that control bot behavior.
 *
 * Pattern keys:
 * - price_request: keywords that trigger price quotes
 * - deal_cancellation: keywords that cancel active deals
 * - price_lock: keywords that lock deal rates
 * - deal_confirmation: keywords that confirm deals
 */

import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'
import { getSupabase } from './supabase.js'
import { buildWordBoundaryRegex } from '../utils/triggers.js'

// ============================================================================
// Types
// ============================================================================

export interface SystemPattern {
  id: string
  patternKey: string
  keywords: string[]
  patternType: string
  handler: string
  description: string
  updatedAt: string
}

/** Valid pattern keys that can be edited via dashboard */
export type PatternKey = 'price_request' | 'deal_cancellation' | 'price_lock' | 'deal_confirmation'

// ============================================================================
// Cache
// ============================================================================

const CACHE_TTL_MS = 60_000 // 1 minute

interface CacheEntry {
  patterns: SystemPattern[]
  fetchedAt: number
}

let cache: CacheEntry | null = null

// ============================================================================
// Fallback defaults (used if DB is unreachable)
// ============================================================================

const FALLBACK_KEYWORDS: Record<PatternKey, string[]> = {
  price_request: ['preço', 'cotação'],
  deal_cancellation: ['cancela', 'cancelar', 'cancel'],
  price_lock: ['trava', 'lock', 'travar'],
  deal_confirmation: ['fechado', 'fecha', 'fechar', 'confirma', 'confirmado', 'confirmed'],
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Load all system patterns from Supabase.
 * Uses cache if available and fresh (< 1 min old).
 */
export async function getAllPatterns(): Promise<Result<SystemPattern[]>> {
  // Check cache
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return ok([...cache.patterns]) // Return snapshot
  }

  const supabase = getSupabase()
  if (!supabase) {
    // Return cached data even if stale, or fallback
    if (cache) {
      logger.warn('Supabase not initialized, using stale cache for system patterns', {
        event: 'system_pattern_stale_cache',
      })
      return ok([...cache.patterns])
    }
    return err('Supabase not initialized and no cached patterns available')
  }

  try {
    const { data, error } = await supabase
      .from('system_patterns')
      .select('*')
      .order('pattern_key')

    if (error) {
      logger.error('Failed to load system patterns', {
        event: 'system_pattern_load_error',
        error: error.message,
      })
      // Return stale cache if available
      if (cache) {
        return ok([...cache.patterns])
      }
      return err(error.message)
    }

    const patterns: SystemPattern[] = (data || []).map((row) => ({
      id: row.id,
      patternKey: row.pattern_key,
      keywords: row.keywords || [],
      patternType: row.pattern_type,
      handler: row.handler,
      description: row.description,
      updatedAt: row.updated_at,
    }))

    // Update cache
    cache = { patterns, fetchedAt: Date.now() }

    return ok([...patterns])
  } catch (e) {
    logger.error('Exception loading system patterns', {
      event: 'system_pattern_load_exception',
      error: e instanceof Error ? e.message : String(e),
    })
    if (cache) {
      return ok([...cache.patterns])
    }
    return err(e instanceof Error ? e.message : String(e))
  }
}

/**
 * Get keywords for a specific pattern key.
 * Returns the keyword array for matching in bot handlers.
 * Falls back to hardcoded defaults if DB is unreachable.
 */
export async function getKeywordsForPattern(key: PatternKey): Promise<string[]> {
  const result = await getAllPatterns()

  if (result.ok) {
    const pattern = result.data.find((p) => p.patternKey === key)
    if (pattern && pattern.keywords.length > 0) {
      return pattern.keywords
    }
  }

  // Fallback to hardcoded defaults
  logger.warn('Using fallback keywords for pattern', {
    event: 'system_pattern_fallback',
    patternKey: key,
  })
  return FALLBACK_KEYWORDS[key] || []
}

/**
 * Update keywords for a specific pattern.
 * Invalidates cache immediately so next read gets fresh data.
 */
export async function updatePatternKeywords(
  patternKey: string,
  keywords: string[]
): Promise<Result<SystemPattern>> {
  const supabase = getSupabase()
  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    const { data, error } = await supabase
      .from('system_patterns')
      .update({
        keywords,
        updated_at: new Date().toISOString(),
      })
      .eq('pattern_key', patternKey)
      .select()

    if (error) {
      logger.error('Failed to update system pattern', {
        event: 'system_pattern_update_error',
        patternKey,
        error: error.message,
      })
      return err(error.message)
    }

    if (!data || data.length === 0) {
      return err('Pattern not found')
    }

    const row = data[0]
    const pattern: SystemPattern = {
      id: row.id,
      patternKey: row.pattern_key,
      keywords: row.keywords || [],
      patternType: row.pattern_type,
      handler: row.handler,
      description: row.description,
      updatedAt: row.updated_at,
    }

    // Invalidate cache so next getKeywordsForPattern reads fresh data
    invalidateCache()

    logger.info('System pattern updated', {
      event: 'system_pattern_updated',
      patternKey,
      keywordCount: keywords.length,
    })

    return ok(pattern)
  } catch (e) {
    logger.error('Exception updating system pattern', {
      event: 'system_pattern_update_exception',
      patternKey,
      error: e instanceof Error ? e.message : String(e),
    })
    return err(e instanceof Error ? e.message : String(e))
  }
}

/**
 * Get keywords for a specific pattern key (synchronous).
 * Reads from the in-memory cache populated by previous async calls.
 * Falls back to hardcoded defaults if cache is empty (e.g., before first DB load).
 *
 * Used by the messageClassifier which cannot be async.
 * The router's async getKeywordsForPattern is the primary gate — this is secondary.
 */
export function getKeywordsForPatternSync(key: PatternKey): string[] {
  if (cache) {
    const pattern = cache.patterns.find((p) => p.patternKey === key)
    if (pattern && pattern.keywords.length > 0) {
      return pattern.keywords
    }
  }
  return FALLBACK_KEYWORDS[key] || []
}

// ============================================================================
// Pattern Testing
// ============================================================================

/** Result of testing a message against one pattern */
export interface PatternMatch {
  patternKey: string
  matched: boolean
  matchedKeyword: string | null
}

/**
 * Test a message against all system patterns.
 * Returns which patterns match and which keyword triggered the match.
 * Used by the inline pattern tester in the dashboard.
 */
export async function testMessageAgainstPatterns(message: string): Promise<PatternMatch[]> {
  const result = await getAllPatterns()
  const patterns = result.ok ? result.data : []

  // If DB failed, use fallback keywords for testing
  const patternKeys: PatternKey[] = ['price_request', 'deal_cancellation', 'price_lock', 'deal_confirmation']

  const matches: PatternMatch[] = []
  const lower = message.toLowerCase().trim()

  for (const key of patternKeys) {
    const pattern = patterns.find((p) => p.patternKey === key)
    const keywords = pattern ? pattern.keywords : FALLBACK_KEYWORDS[key] || []

    let matched = false
    let matchedKeyword: string | null = null

    // Use the shared word-boundary regex from triggers.ts (single source of truth)
    for (const kw of keywords) {
      const regex = buildWordBoundaryRegex([kw])
      if (regex.test(lower)) {
        matched = true
        matchedKeyword = kw
        break
      }
    }

    matches.push({ patternKey: key, matched, matchedKeyword })
  }

  return matches
}

/**
 * Invalidate the pattern cache.
 * Called after updates to ensure immediate effect.
 */
export function invalidateCache(): void {
  cache = null
}

/**
 * Cleanup function for graceful shutdown.
 */
export function cleanupSystemPatternService(): void {
  cache = null
}
