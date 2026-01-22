/**
 * Chaotic Timing Utility
 *
 * Provides human-like randomized delays for anti-detection.
 * Uses multi-layer randomization to avoid detectable patterns.
 *
 * NFR14: Response delay 3-15 seconds
 */

import { logger } from './logger.js'

// Constants (Task 1.3) - exported for test maintainability
export const MIN_DELAY_MS = 3000 // 3 seconds (NFR14)
export const MAX_DELAY_MS = 15000 // 15 seconds (NFR14)

// Module-level state for consecutive delay prevention (Task 3.1)
let lastDelay = 0

/**
 * Sleep utility - waits for specified milliseconds.
 *
 * @param ms - Milliseconds to wait
 * @returns Promise that resolves after delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Generate a chaotic value using multi-layer randomization.
 * This produces more "human-like" unpredictability than simple Math.random().
 *
 * Layers:
 * 1. Base random in range (3s-15s)
 * 2. Jitter (+/- 500ms)
 * 3. Occasional extension (20% chance of +1-3 seconds)
 *
 * @returns Delay value in milliseconds, clamped to bounds
 */
function generateChaoticValue(): number {
  // Layer 1: Base random in range (Task 2.1)
  const range = MAX_DELAY_MS - MIN_DELAY_MS
  const base = MIN_DELAY_MS + Math.random() * range

  // Layer 2: Jitter +/- 500ms (Task 2.2)
  const jitter = (Math.random() - 0.5) * 1000

  // Layer 3: Occasional extension - 20% chance of +1-3 seconds (Task 2.3)
  const extension = Math.random() < 0.2 ? Math.random() * 3000 : 0

  // Combine and clamp to bounds (Task 2.4)
  const raw = base + jitter + extension
  return Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, Math.round(raw)))
}

/**
 * Generate a chaotic delay using multi-layer randomization.
 * Returns actual delay in milliseconds after waiting.
 *
 * Features:
 * - Multi-layer randomization for human-like unpredictability
 * - Prevents identical consecutive delays
 * - Logs actual delay for debugging
 *
 * @returns Promise resolving to the actual delay applied in milliseconds
 */
export async function chaosDelay(): Promise<number> {
  let delay = generateChaoticValue()

  // Ensure not identical to last delay (Task 3.2 - AC2)
  // Max 10 iterations to prevent theoretical infinite loop
  let iterations = 0
  const MAX_REGENERATE_ATTEMPTS = 10
  while (delay === lastDelay && iterations < MAX_REGENERATE_ATTEMPTS) {
    delay = generateChaoticValue()
    iterations++
  }
  // If still matching after max attempts, add 1ms offset (extremely rare edge case)
  if (delay === lastDelay) {
    delay = delay === MAX_DELAY_MS ? delay - 1 : delay + 1
  }
  lastDelay = delay

  // Apply the delay
  await sleep(delay)

  // Log for debugging (Task 4.1 - AC3)
  logger.debug('Chaotic delay applied', {
    event: 'chaos_delay',
    delayMs: delay,
  })

  return delay
}

/**
 * Reset last delay tracking - for testing purposes.
 * Allows tests to start with a clean state.
 */
export function resetLastDelay(): void {
  lastDelay = 0
}

/**
 * Get the last delay value - for testing purposes.
 * Allows tests to verify delay tracking behavior.
 *
 * @returns The last delay value in milliseconds
 */
export function getLastDelay(): number {
  return lastDelay
}
