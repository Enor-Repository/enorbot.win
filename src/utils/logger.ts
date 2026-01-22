/**
 * Structured JSON logger for all output.
 * NEVER use console.log directly - use this logger.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  [key: string]: unknown
}

function formatLog(level: LogLevel, message: string, context?: Record<string, unknown>): string {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  }
  return JSON.stringify(entry)
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const formatted = formatLog(level, message, context)

  switch (level) {
    case 'error':
      process.stderr.write(formatted + '\n')
      break
    default:
      process.stdout.write(formatted + '\n')
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => log('error', message, context),
}
