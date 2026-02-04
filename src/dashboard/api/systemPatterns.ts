/**
 * Dashboard API: System Patterns Endpoints
 * Enables Daniel to edit global system pattern keywords via dashboard.
 *
 * Routes:
 *   GET  /api/system-patterns        — List all system patterns
 *   PUT  /api/system-patterns/:key   — Update keywords for a pattern
 *   POST /api/system-patterns/test   — Test a message against all patterns
 */
import { Router, type Request, type Response } from 'express'
import { logger } from '../../utils/logger.js'
import {
  getAllPatterns,
  updatePatternKeywords,
  testMessageAgainstPatterns,
  type PatternKey,
} from '../../services/systemPatternService.js'

const VALID_PATTERN_KEYS: Set<string> = new Set<PatternKey>([
  'price_request', 'deal_cancellation', 'price_lock', 'deal_confirmation',
])

export const systemPatternsRouter = Router()

/**
 * GET /api/system-patterns
 * List all system patterns with their current keywords.
 */
systemPatternsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await getAllPatterns()

    if (!result.ok) {
      return res.status(500).json({
        error: 'Failed to fetch system patterns',
        message: result.error,
      })
    }

    res.json({ patterns: result.data })
  } catch (error) {
    logger.error('Failed to fetch system patterns', {
      event: 'system_patterns_fetch_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to fetch system patterns',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * POST /api/system-patterns/test
 * Test a message against all system patterns.
 * Returns which patterns match, useful for Daniel to verify keyword changes.
 * Body: { message: string }
 */
systemPatternsRouter.post('/test', async (req: Request, res: Response) => {
  try {
    const { message } = req.body

    if (typeof message !== 'string') {
      return res.status(400).json({ error: 'message must be a string' })
    }

    const trimmed = message.trim()

    if (trimmed.length === 0) {
      return res.status(400).json({ error: 'message cannot be empty' })
    }

    if (trimmed.length > 500) {
      return res.status(400).json({ error: 'message exceeds 500 character limit' })
    }

    const matches = await testMessageAgainstPatterns(trimmed)

    res.json({ message: trimmed, matches })
  } catch (error) {
    logger.error('Failed to test message against patterns', {
      event: 'system_pattern_test_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to test message',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * PUT /api/system-patterns/:patternKey
 * Update keywords for a specific pattern.
 * Body: { keywords: string[] }
 *
 * Validation:
 * - keywords must be a non-empty array of non-empty strings
 * - each keyword max 50 chars
 * - max 20 keywords per pattern
 */
systemPatternsRouter.put('/:patternKey', async (req: Request, res: Response) => {
  try {
    const patternKey = req.params.patternKey as string
    if (!patternKey) {
      return res.status(400).json({ error: 'Missing patternKey parameter' })
    }
    if (!VALID_PATTERN_KEYS.has(patternKey)) {
      return res.status(400).json({
        error: `Invalid patternKey. Must be one of: ${[...VALID_PATTERN_KEYS].join(', ')}`,
      })
    }

    const { keywords } = req.body

    // ---- API boundary validation ----

    if (!Array.isArray(keywords)) {
      return res.status(400).json({ error: 'keywords must be an array' })
    }

    if (keywords.length === 0) {
      return res.status(400).json({ error: 'keywords array cannot be empty — at least one keyword is required' })
    }

    if (keywords.length > 20) {
      return res.status(400).json({ error: 'Maximum 20 keywords allowed per pattern' })
    }

    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i]
      if (typeof kw !== 'string') {
        return res.status(400).json({ error: `keywords[${i}] must be a string` })
      }
      if (kw.trim().length === 0) {
        return res.status(400).json({ error: `keywords[${i}] cannot be empty` })
      }
      if (kw.length > 50) {
        return res.status(400).json({ error: `keywords[${i}] exceeds 50 character limit` })
      }
    }

    // Trim and deduplicate
    const cleanedKeywords = [...new Set(keywords.map((k: string) => k.trim().toLowerCase()))]

    // ---- End validation ----

    const result = await updatePatternKeywords(patternKey, cleanedKeywords)

    if (!result.ok) {
      const status = result.error === 'Pattern not found' ? 404 : 500
      return res.status(status).json({
        error: result.error === 'Pattern not found' ? 'Pattern not found' : 'Failed to update pattern',
        message: result.error,
      })
    }

    logger.info('System pattern updated via dashboard', {
      event: 'system_pattern_dashboard_update',
      patternKey,
      keywordCount: cleanedKeywords.length,
      keywords: cleanedKeywords,
    })

    res.json({ pattern: result.data })
  } catch (error) {
    logger.error('Failed to update system pattern', {
      event: 'system_pattern_update_error',
      error: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({
      error: 'Failed to update system pattern',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
