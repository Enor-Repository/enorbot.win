/**
 * eNorBOT Dashboard Server
 * Express server serving React dashboard and API endpoints
 * Story D.13: Dashboard Server
 */
import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import path from 'path'
import { fileURLToPath } from 'url'
import { logger } from '../utils/logger.js'
import { getConfig } from '../config.js'
import { statusRouter } from './api/status.js'
import { groupsRouter } from './api/groups.js'
import { analyticsRouter } from './api/analytics.js'
import { costsRouter } from './api/costs.js'
import { pricesRouter } from './api/prices.js'
import { spreadsRouter } from './api/spreads.js'
import { groupRulesRouter } from './api/groupRules.js'
import { groupTriggersRouter } from './api/triggers.js'
import { dealsRouter } from './api/deals.js'
import { systemPatternsRouter } from './api/systemPatterns.js'
import { volatilityRouter } from './api/volatility.js'
import { escalationsRouter } from './api/escalations.js'
import { quotesRouter, allQuotesRouter } from './api/quotes.js'
import { dashboardAuth } from './middleware/auth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

// Trust proxy (Cloudflare Tunnel adds X-Forwarded-For headers)
app.set('trust proxy', 1)

// Middleware
const config = getConfig()
const allowedOrigins = config.ALLOWED_ORIGINS
  ? config.ALLOWED_ORIGINS.split(',').map((o: string) => o.trim())
  : undefined
app.use(cors(allowedOrigins ? { origin: allowedOrigins } : undefined))

// Security headers — disables X-Powered-By, sets CSP, HSTS, etc.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"],
      // No upgradeInsecureRequests — dashboard served over HTTP
    },
  },
  // No HSTS — no TLS on this deployment
  hsts: false,
}))

// Rate limiting — 100 requests per minute per IP on API routes
// Price endpoints are exempt: the dashboard polls commercial dollar every 1s
// (60 req/min alone), and these are lightweight local reads with no abuse risk.
const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  skip: (req: Request) => req.path === '/prices' || req.path.startsWith('/prices/'),
})
app.use('/api', apiLimiter)

// Stricter limit on write operations — 20 per minute per IP
const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many write requests, please try again later' },
})
app.use('/api', (req: Request, _res: Response, next: NextFunction) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    return writeLimiter(req, _res, next)
  }
  next()
})

app.use(express.json({ limit: '100kb' }))

// Request logging (skip price endpoints — polled every 1s, would flood logs)
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (!req.path.startsWith('/api/prices')) {
    logger.info('Dashboard API request', {
      event: 'dashboard_request',
      method: req.method,
      path: req.path,
    })
  }
  next()
})

// Auth middleware — protects write endpoints (POST/PUT/DELETE), allows reads
app.use('/api', dashboardAuth)

// API routes
app.use('/api/status', statusRouter)
app.use('/api/groups', groupsRouter)
app.use('/api/groups', analyticsRouter)
app.use('/api/costs', costsRouter)
app.use('/api/prices', pricesRouter)
app.use('/api/spreads', spreadsRouter)
app.use('/api/groups/:groupJid/rules', groupRulesRouter)
app.use('/api/groups/:groupJid/triggers', groupTriggersRouter)
app.use('/api/groups/:groupJid/deals', dealsRouter)
app.use('/api/groups/:groupJid/volatility', volatilityRouter)
app.use('/api/groups/:groupJid/escalations', escalationsRouter)
app.use('/api/groups/:groupJid/quote', quotesRouter)
app.use('/api/quotes', allQuotesRouter)
app.use('/api/system-patterns', systemPatternsRouter)

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Serve static dashboard files
const dashboardPath = path.join(__dirname, '../../dist/dashboard')
app.use(express.static(dashboardPath))

// API 404 handler — return JSON for unmatched /api/* routes
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' })
})

// SPA fallback - serve index.html for all non-API routes
app.use((_req: Request, res: Response) => {
  res.sendFile(path.join(dashboardPath, 'index.html'))
})

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Dashboard server error', {
    event: 'dashboard_error',
    error: err.message,
    stack: err.stack,
  })
  res.status(500).json({ error: 'Internal server error' })
})

/**
 * Start the dashboard server
 */
export function startDashboardServer(): void {
  const config = getConfig()
  const port = config.DASHBOARD_PORT

  if (!config.DASHBOARD_ENABLED) {
    logger.info('Dashboard server disabled', { event: 'dashboard_disabled' })
    return
  }

  const server = app.listen(port, () => {
    logger.info('Dashboard server started', {
      event: 'dashboard_started',
      port,
      url: `http://localhost:${port}`,
    })
  })

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('Dashboard server shutting down', { event: 'dashboard_shutdown' })
    server.close(() => {
      logger.info('Dashboard server closed', { event: 'dashboard_closed' })
    })
  })
}
