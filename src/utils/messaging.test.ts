/**
 * Unit tests for Messaging Utility
 *
 * Tests:
 * - AC1: Anti-detection flow (composing → paused → chaosDelay → send)
 * - AC2: Typing indicator lifecycle (composing → paused)
 * - AC3: Error handling with Result type
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Use vi.hoisted for proper ESM mock hoisting
const { mockChaosDelay, mockLogger } = vi.hoisted(() => ({
  mockChaosDelay: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('./chaos.js', () => ({
  chaosDelay: mockChaosDelay,
}))

vi.mock('./logger.js', () => ({
  logger: mockLogger,
}))

import {
  sendWithAntiDetection,
  getTypingDuration,
  MIN_TYPING_MS,
  MAX_TYPING_MS,
} from './messaging.js'

describe('getTypingDuration', () => {
  it('returns duration within MIN_TYPING_MS-MAX_TYPING_MS bounds', () => {
    // Run multiple times to verify bounds
    for (let i = 0; i < 100; i++) {
      const duration = getTypingDuration()
      expect(duration).toBeGreaterThanOrEqual(MIN_TYPING_MS)
      expect(duration).toBeLessThanOrEqual(MAX_TYPING_MS)
    }
  })

  it('returns an integer value', () => {
    const duration = getTypingDuration()
    expect(Number.isInteger(duration)).toBe(true)
  })

  it('produces varied durations across multiple calls', () => {
    const durations: number[] = []
    for (let i = 0; i < 20; i++) {
      durations.push(getTypingDuration())
    }
    const uniqueDurations = new Set(durations)
    // Should have some variation (not all same value)
    expect(uniqueDurations.size).toBeGreaterThan(1)
  })
})

describe('sendWithAntiDetection', () => {
  let mockSocket: {
    sendPresenceUpdate: ReturnType<typeof vi.fn>
    sendMessage: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    // Mock chaosDelay to resolve immediately (doesn't use internal sleep)
    mockChaosDelay.mockResolvedValue(5000)
    mockSocket = {
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns err for empty jid', async () => {
    const result = await sendWithAntiDetection(
      mockSocket as never,
      '',
      'Hello'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Invalid jid: must be non-empty')
    }
    expect(mockSocket.sendPresenceUpdate).not.toHaveBeenCalled()
  })

  it('returns err for whitespace-only jid', async () => {
    const result = await sendWithAntiDetection(
      mockSocket as never,
      '   ',
      'Hello'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Invalid jid: must be non-empty')
    }
  })

  it('returns err for empty message', async () => {
    const result = await sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      ''
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Invalid message: must be non-empty')
    }
    expect(mockSocket.sendPresenceUpdate).not.toHaveBeenCalled()
  })

  it('returns err for whitespace-only message', async () => {
    const result = await sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      '   '
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Invalid message: must be non-empty')
    }
  })

  it('shows composing presence before delays (AC1, AC2)', async () => {
    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      'Hello'
    )

    // Composing should be called immediately
    expect(mockSocket.sendPresenceUpdate).toHaveBeenCalledWith(
      'composing',
      'group@g.us'
    )

    await vi.runAllTimersAsync()
    await promise
  })

  it('shows paused presence after typing duration (AC2)', async () => {
    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      'Hello'
    )
    await vi.runAllTimersAsync()
    await promise

    // Both composing and paused should be called in order
    const calls = mockSocket.sendPresenceUpdate.mock.calls
    expect(calls[0]).toEqual(['composing', 'group@g.us'])
    expect(calls[1]).toEqual(['paused', 'group@g.us'])
  })

  it('calls chaosDelay after typing indicator (AC1)', async () => {
    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      'Hello'
    )
    await vi.runAllTimersAsync()
    await promise

    expect(mockChaosDelay).toHaveBeenCalled()
  })

  it('calls chaosDelay AFTER paused presence, BEFORE sendMessage (AC1 order)', async () => {
    const callOrder: string[] = []

    mockSocket.sendPresenceUpdate.mockImplementation(
      async (presence: string) => {
        callOrder.push(`presence:${presence}`)
      }
    )
    mockChaosDelay.mockImplementation(async () => {
      callOrder.push('chaosDelay')
      return 5000
    })
    mockSocket.sendMessage.mockImplementation(async () => {
      callOrder.push('sendMessage')
    })

    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      'Hello'
    )
    await vi.runAllTimersAsync()
    await promise

    // Verify order: composing → paused → chaosDelay → sendMessage
    expect(callOrder).toEqual([
      'presence:composing',
      'presence:paused',
      'chaosDelay',
      'sendMessage',
    ])
  })

  it('sends message after all delays (AC1)', async () => {
    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      'Hello world'
    )
    await vi.runAllTimersAsync()
    await promise

    expect(mockSocket.sendMessage).toHaveBeenCalledWith('group@g.us', {
      text: 'Hello world',
    })
  })

  it('returns ok result on success (AC3)', async () => {
    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      'Hello'
    )
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.ok).toBe(true)
  })

  it('returns err result on presence update failure (AC3)', async () => {
    mockSocket.sendPresenceUpdate.mockRejectedValue(new Error('Network error'))

    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      'Hello'
    )
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Network error')
    }
  })

  it('returns err result on message send failure (AC3)', async () => {
    mockSocket.sendMessage.mockRejectedValue(new Error('Connection lost'))

    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      'Hello'
    )
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Connection lost')
    }
  })

  it('handles non-Error exceptions (AC3)', async () => {
    mockSocket.sendMessage.mockRejectedValue('string error')

    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      'Hello'
    )
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Unknown error')
    }
  })

  it('logs typing indicator start (AC1)', async () => {
    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      'Hello'
    )
    await vi.runAllTimersAsync()
    await promise

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Typing indicator started',
      expect.objectContaining({
        event: 'typing_start',
        jid: 'group@g.us',
      })
    )
  })

  it('logs anti_detection_complete with timing details (AC1)', async () => {
    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      'Hello'
    )
    await vi.runAllTimersAsync()
    await promise

    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Anti-detection complete',
      expect.objectContaining({
        event: 'anti_detection_complete',
        jid: 'group@g.us',
        chaoticDelayMs: 5000,
      })
    )
  })

  it('logs message sent on success', async () => {
    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      'Hello'
    )
    await vi.runAllTimersAsync()
    await promise

    expect(mockLogger.info).toHaveBeenCalledWith('Message sent', {
      event: 'message_sent',
      jid: 'group@g.us',
    })
  })

  it('logs error on failure (AC3)', async () => {
    mockSocket.sendMessage.mockRejectedValue(new Error('Send failed'))

    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      'Hello'
    )
    await vi.runAllTimersAsync()
    await promise

    expect(mockLogger.error).toHaveBeenCalledWith('Message send failed', {
      event: 'message_error',
      jid: 'group@g.us',
      error: 'Send failed',
    })
  })

  it('never throws exceptions (AC3)', async () => {
    mockSocket.sendPresenceUpdate.mockRejectedValue(new Error('Crash'))
    mockSocket.sendMessage.mockRejectedValue(new Error('Crash'))

    // Should not throw, only return err result
    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      'Hello'
    )
    await vi.runAllTimersAsync()

    await expect(promise).resolves.not.toThrow()
  })
})
