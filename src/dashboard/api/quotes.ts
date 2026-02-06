/**
 * Active Quotes API
 * Dashboard endpoint for retrieving active quote information.
 * Used to display threshold lines around the quoted price.
 */
import { Router, type Request, type Response } from 'express'
import { getActiveQuote, getAllActiveQuotes } from '../../services/activeQuotes.js'

export const quotesRouter = Router({ mergeParams: true })

/**
 * GET /api/groups/:groupJid/quote
 * Get active quote for a specific group.
 * Returns the quoted price that threshold lines should be based on.
 */
quotesRouter.get('/', (req: Request, res: Response): void => {
  const groupJid = req.params.groupJid as string

  if (!groupJid) {
    res.status(400).json({ error: 'Missing groupJid parameter' })
    return
  }

  const quote = getActiveQuote(groupJid)

  if (!quote) {
    res.json({
      hasActiveQuote: false,
      quotedPrice: null,
      priceSource: null,
      quotedAt: null,
      repriceCount: null,
      status: null,
    })
    return
  }

  res.json({
    hasActiveQuote: true,
    quotedPrice: quote.quotedPrice,
    basePrice: quote.basePrice,
    priceSource: quote.priceSource,
    quotedAt: quote.quotedAt.toISOString(),
    repriceCount: quote.repriceCount,
    status: quote.status,
  })
})

/**
 * GET /api/quotes
 * Get all active quotes (for dashboard overview).
 */
export const allQuotesRouter = Router()

allQuotesRouter.get('/', (_req: Request, res: Response): void => {
  const quotes = getAllActiveQuotes()

  res.json({
    quotes: quotes.map(q => ({
      groupJid: q.groupJid,
      quotedPrice: q.quotedPrice,
      basePrice: q.basePrice,
      priceSource: q.priceSource,
      quotedAt: q.quotedAt.toISOString(),
      repriceCount: q.repriceCount,
      status: q.status,
    })),
    count: quotes.length,
  })
})
