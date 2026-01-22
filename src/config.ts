import { config as loadEnv } from 'dotenv'
import { envSchema, type EnvConfig } from './types/config.js'
import { logger } from './utils/logger.js'
import { err, ok, type Result } from './utils/result.js'

// Load .env file
loadEnv()

/**
 * Validate and return environment configuration.
 * Returns Result type, never throws.
 */
export function validateConfig(): Result<EnvConfig> {
  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    const errors = result.error.issues
      .map((e) => `${String(e.path.join('.'))}: ${e.message}`)
      .join(', ')

    logger.error('Configuration validation failed', { errors })
    return err(`Invalid configuration: ${errors}`)
  }

  logger.info('Configuration validated', {
    nodeEnv: result.data.NODE_ENV,
    healthPort: result.data.HEALTH_PORT,
  })

  return ok(result.data)
}

// Singleton config instance
let configInstance: EnvConfig | null = null

/**
 * Get the validated config.
 * Throws only during initialization if config is invalid.
 */
export function getConfig(): EnvConfig {
  if (!configInstance) {
    const result = validateConfig()
    if (!result.ok) {
      throw new Error(result.error)
    }
    configInstance = result.data
  }
  return configInstance
}
