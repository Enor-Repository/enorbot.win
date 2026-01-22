/**
 * Exponential backoff utility for reconnection attempts.
 * Implements jittered exponential backoff to prevent thundering herd.
 */

// Base delay in milliseconds (1 second)
export const BASE_DELAY = 1000

// Maximum delay cap in milliseconds (30 seconds per NFR3)
export const MAX_DELAY = 30000

// Jitter factor (+/- 10%) to prevent synchronized reconnections
const JITTER_FACTOR = 0.1

// Threshold before queuing notification (30 seconds per NFR4)
export const NOTIFICATION_THRESHOLD_MS = 30000

// Maximum time to attempt recovery (60 seconds per NFR3)
export const MAX_RECONNECT_TIME_MS = 60000

/**
 * Calculate exponential backoff delay with jitter.
 *
 * @param attempt - The reconnection attempt number (0-indexed)
 * @returns Delay in milliseconds with jitter applied
 *
 * Expected sequence (approximate):
 * | Attempt | Base Delay | With Jitter     |
 * |---------|------------|-----------------|
 * | 0       | 1000ms     | 900-1100ms      |
 * | 1       | 2000ms     | 1800-2200ms     |
 * | 2       | 4000ms     | 3600-4400ms     |
 * | 3       | 8000ms     | 7200-8800ms     |
 * | 4       | 16000ms    | 14400-17600ms   |
 * | 5+      | 30000ms    | 27000-33000ms   |
 */
export function calculateBackoff(attempt: number): number {
  // Calculate base exponential delay: BASE_DELAY * 2^attempt
  const exponentialDelay = Math.min(BASE_DELAY * Math.pow(2, attempt), MAX_DELAY)

  // Add jitter to prevent synchronized reconnections
  const jitterRange = exponentialDelay * JITTER_FACTOR
  const jitter = (Math.random() * 2 - 1) * jitterRange

  return Math.round(exponentialDelay + jitter)
}
