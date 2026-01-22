/**
 * Unit tests for Chaotic Timing Utility
 *
 * Tests:
 * - AC1: Delay between 3-15 seconds with multi-layer randomization
 * - AC2: Each delay independently randomized, no consecutive duplicates
 * - AC3: Function returns actual delay value
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { chaosDelay, resetLastDelay, getLastDelay, MIN_DELAY_MS, MAX_DELAY_MS } from './chaos.js'
import { logger } from './logger.js'

describe('chaosDelay', () => {
  beforeEach(() => {
    // Reset state before each test
    resetLastDelay()
    // Use fake timers to avoid slow tests
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns delay within MIN_DELAY_MS-MAX_DELAY_MS bounds (AC1)', async () => {
    const delayPromise = chaosDelay()
    vi.runAllTimers()

    const delay = await delayPromise
    expect(delay).toBeGreaterThanOrEqual(MIN_DELAY_MS)
    expect(delay).toBeLessThanOrEqual(MAX_DELAY_MS)
  })

  it('returns a number representing the actual delay (AC3)', async () => {
    const delayPromise = chaosDelay()
    vi.runAllTimers()

    const delay = await delayPromise
    expect(typeof delay).toBe('number')
    expect(Number.isInteger(delay)).toBe(true)
  })

  it('generates different consecutive delays (AC2)', async () => {
    const delays: number[] = []

    for (let i = 0; i < 10; i++) {
      const promise = chaosDelay()
      vi.runAllTimers()
      delays.push(await promise)
    }

    // Check no adjacent duplicates
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).not.toBe(delays[i - 1])
    }
  })

  it('tracks last delay value correctly', async () => {
    expect(getLastDelay()).toBe(0)

    const promise1 = chaosDelay()
    vi.runAllTimers()
    const delay1 = await promise1

    expect(getLastDelay()).toBe(delay1)

    const promise2 = chaosDelay()
    vi.runAllTimers()
    const delay2 = await promise2

    expect(getLastDelay()).toBe(delay2)
  })

  it('resetLastDelay clears the tracking state', async () => {
    const promise = chaosDelay()
    vi.runAllTimers()
    await promise

    expect(getLastDelay()).not.toBe(0)

    resetLastDelay()
    expect(getLastDelay()).toBe(0)
  })

  it('produces varied delays across multiple calls', async () => {
    const delays: number[] = []

    // Run 20 times to get a sample
    for (let i = 0; i < 20; i++) {
      const promise = chaosDelay()
      vi.runAllTimers()
      delays.push(await promise)
    }

    // Check that not all delays are the same (statistical validation)
    const uniqueDelays = new Set(delays)
    expect(uniqueDelays.size).toBeGreaterThan(1)

    // All should be within bounds
    delays.forEach((delay) => {
      expect(delay).toBeGreaterThanOrEqual(MIN_DELAY_MS)
      expect(delay).toBeLessThanOrEqual(MAX_DELAY_MS)
    })
  })

  it('logs the delay value for debugging (AC3)', async () => {
    const loggerSpy = vi.spyOn(logger, 'debug')

    const delayPromise = chaosDelay()
    vi.runAllTimers()
    const delay = await delayPromise

    expect(loggerSpy).toHaveBeenCalledWith('Chaotic delay applied', {
      event: 'chaos_delay',
      delayMs: delay,
    })

    loggerSpy.mockRestore()
  })
})
