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

vi.mock('../services/groupConfig.js', () => ({
  getGroupModeSync: () => 'active',
}))

import {
  sendWithAntiDetection,
  getTypingDuration,
  formatMention,
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

describe('formatMention', () => {
  it('returns textSegment with display name when provided', () => {
    const result = formatMention('5511999999999@s.whatsapp.net', 'Daniel Hon')
    expect(result.textSegment).toBe('@Daniel Hon')
    expect(result.jid).toBe('5511999999999@s.whatsapp.net')
  })

  it('extracts phone number from JID when no display name provided', () => {
    const result = formatMention('5511999999999@s.whatsapp.net')
    expect(result.textSegment).toBe('@5511999999999')
    expect(result.jid).toBe('5511999999999@s.whatsapp.net')
  })

  it('handles group JID format', () => {
    const result = formatMention('120363123456789@g.us', 'Group Name')
    expect(result.textSegment).toBe('@Group Name')
    expect(result.jid).toBe('120363123456789@g.us')
  })

  it('preserves the full JID unchanged', () => {
    const jid = '5511999999999@s.whatsapp.net'
    const result = formatMention(jid, 'Test')
    expect(result.jid).toBe(jid)
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

  it('sends message WITHOUT mentions when not provided (backward compat)', async () => {
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
    // Verify mentions key is NOT in the payload
    const payload = mockSocket.sendMessage.mock.calls[0][1]
    expect(payload).not.toHaveProperty('mentions')
  })

  it('sends message WITH mentions when provided', async () => {
    const mentions = ['5511999999999@s.whatsapp.net']
    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      '@Daniel Hon deal completed',
      mentions
    )
    await vi.runAllTimersAsync()
    await promise

    expect(mockSocket.sendMessage).toHaveBeenCalledWith('group@g.us', {
      text: '@Daniel Hon deal completed',
      mentions: ['5511999999999@s.whatsapp.net'],
    })
  })

  it('sends message WITH multiple mentions', async () => {
    const mentions = [
      '5511999999999@s.whatsapp.net',
      '5511888888888@s.whatsapp.net',
    ]
    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      '@Daniel @Davi deal confirmed',
      mentions
    )
    await vi.runAllTimersAsync()
    await promise

    const payload = mockSocket.sendMessage.mock.calls[0][1]
    expect(payload.mentions).toEqual(mentions)
    expect(payload.mentions).toHaveLength(2)
  })

  it('ignores empty mentions array (no mentions key in payload)', async () => {
    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      'Hello',
      []
    )
    await vi.runAllTimersAsync()
    await promise

    const payload = mockSocket.sendMessage.mock.calls[0][1]
    expect(payload).not.toHaveProperty('mentions')
  })

  it('ignores undefined mentions (backward compat)', async () => {
    const promise = sendWithAntiDetection(
      mockSocket as never,
      'group@g.us',
      'Hello',
      undefined
    )
    await vi.runAllTimersAsync()
    await promise

    const payload = mockSocket.sendMessage.mock.calls[0][1]
    expect(payload).not.toHaveProperty('mentions')
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

  describe('simulator mode (_simulatorMode flag)', () => {
    let simSocket: {
      _simulatorMode: boolean
      sendPresenceUpdate: ReturnType<typeof vi.fn>
      sendMessage: ReturnType<typeof vi.fn>
    }

    beforeEach(() => {
      simSocket = {
        _simulatorMode: true,
        sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockResolvedValue(undefined),
      }
    })

    it('skips typing indicator and chaos delay', async () => {
      const result = await sendWithAntiDetection(
        simSocket as never,
        'group@g.us',
        'Hello'
      )

      expect(result.ok).toBe(true)
      expect(simSocket.sendPresenceUpdate).not.toHaveBeenCalled()
      expect(mockChaosDelay).not.toHaveBeenCalled()
      expect(simSocket.sendMessage).toHaveBeenCalledOnce()
    })

    it('sends message with correct payload', async () => {
      await sendWithAntiDetection(
        simSocket as never,
        'group@g.us',
        'Test message'
      )

      expect(simSocket.sendMessage).toHaveBeenCalledWith('group@g.us', {
        text: 'Test message',
      })
    })

    it('includes mentions when provided', async () => {
      const mentions = ['5511999@s.whatsapp.net']
      await sendWithAntiDetection(
        simSocket as never,
        'group@g.us',
        'Hello @user',
        mentions
      )

      expect(simSocket.sendMessage).toHaveBeenCalledWith('group@g.us', {
        text: 'Hello @user',
        mentions: ['5511999@s.whatsapp.net'],
      })
    })

    it('omits mentions for empty array', async () => {
      await sendWithAntiDetection(
        simSocket as never,
        'group@g.us',
        'Hello',
        []
      )

      const payload = simSocket.sendMessage.mock.calls[0][1]
      expect(payload).not.toHaveProperty('mentions')
    })

    it('returns err on sendMessage failure', async () => {
      simSocket.sendMessage.mockRejectedValue(new Error('Mock error'))

      const result = await sendWithAntiDetection(
        simSocket as never,
        'group@g.us',
        'Hello'
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Mock error')
      }
    })

    it('never throws on sendMessage failure', async () => {
      simSocket.sendMessage.mockRejectedValue(new Error('Crash'))

      await expect(
        sendWithAntiDetection(simSocket as never, 'group@g.us', 'Hello')
      ).resolves.not.toThrow()
    })

    it('bypasses learning mode block', async () => {
      // The simulator bypass runs BEFORE the learning mode check,
      // so even learning-mode group JIDs get a response
      const result = await sendWithAntiDetection(
        simSocket as never,
        'learning-group@g.us',
        'Hello'
      )

      expect(result.ok).toBe(true)
      expect(simSocket.sendMessage).toHaveBeenCalledOnce()
    })
  })
})
