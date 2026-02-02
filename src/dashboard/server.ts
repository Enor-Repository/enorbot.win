/**
 * eNorBOT Dashboard Server
 * Express server serving React dashboard and API endpoints
 * Story D.13: Dashboard Server
 */
import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { logger } from '../utils/logger.js'
import { getConfig } from '../config.js'
import { statusRouter } from './api/status.js'
import { groupsRouter } from './api/groups.js'
import { analyticsRouter } from './api/analytics.js'
import { costsRouter } from './api/costs.js'
import { rulesRouter } from './api/rules.js'
import { pricesRouter } from './api/prices.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

// Middleware
app.use(cors())
app.use(express.json())

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info('Dashboard API request', {
    event: 'dashboard_request',
    method: req.method,
    path: req.path,
  })
  next()
})

// API routes
app.use('/api/status', statusRouter)
app.use('/api/groups', groupsRouter)
app.use('/api/groups', analyticsRouter)
app.use('/api/costs', costsRouter)
app.use('/api/rules', rulesRouter)
app.use('/api/prices', pricesRouter)

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Serve static dashboard files
const dashboardPath = path.join(__dirname, '../../dist/dashboard')
app.use(express.static(dashboardPath))

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
  const port = config.DASHBOARD_PORT || 3001

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
