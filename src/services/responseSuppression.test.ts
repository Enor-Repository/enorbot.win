/**
 * Tests for Response Suppression Service
 * Sprint 5, Task 5.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  shouldSuppressResponse,
  recordBotResponse,
  resetSuppressionState,
} from './responseSuppression.js'

// Mock message history module
vi.mock('./messageHistory.js', () => ({
  getRecentGroupMessages: vi.fn(),
  buildSenderContext: vi.fn(),
}))

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { getRecentGroupMessages } from './messageHistory.js'
import type { Message } from './messageHistory.js'

const mockGetRecentGroupMessages = vi.mocked(getRecentGroupMessages)

function makeMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: '1',
    message_id: null,
    group_jid: 'group@g.us',
    sender_jid: 'sender@s.whatsapp.net',
    is_control_group: false,
    message_type: 'text',
    content: 'hello',
    is_from_bot: false,
    is_trigger: false,
    metadata: {},
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('Sprint 5, Task 5.2: Response Suppression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSuppressionState()
  })

  afterEach(() => {
    resetSuppressionState()
  })

  // ========================================================================
  // Cooldown Check
  // ========================================================================
  describe('Cooldown check', () => {
    it('does not suppress when no previous response recorded', async () => {
      // No DB queries needed for cooldown check - mock for subsequent checks
      mockGetRecentGroupMessages.mockResolvedValue({ ok: true, data: [] })

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'sender@s.whatsapp.net',
        messageContent: 'preço',
      })

      expect(result.shouldSuppress).toBe(false)
    })

    it('suppresses when cooldown is active', async () => {
      // Record a response just now
      recordBotResponse('group@g.us')

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'sender@s.whatsapp.net',
        messageContent: 'preço',
        cooldownSeconds: 60, // 60 second cooldown
      })

      expect(result.shouldSuppress).toBe(true)
      expect(result.reason).toBe('cooldown_active')
    })

    it('does not suppress when cooldown has elapsed', async () => {
      // Record a response in the past (manually set the timestamp)
      recordBotResponse('group@g.us')

      // Override with old timestamp by accessing the internal map
      // We need to wait for cooldown to elapse, or use a shorter cooldown
      mockGetRecentGroupMessages.mockResolvedValue({ ok: true, data: [] })

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'sender@s.whatsapp.net',
        messageContent: 'preço',
        cooldownSeconds: 0, // 0 second cooldown = always elapsed
      })

      expect(result.shouldSuppress).toBe(false)
    })

    it('tracks cooldown per group independently', async () => {
      recordBotResponse('group1@g.us')

      mockGetRecentGroupMessages.mockResolvedValue({ ok: true, data: [] })

      // group2 should NOT be suppressed
      const result = await shouldSuppressResponse({
        groupJid: 'group2@g.us',
        senderJid: 'sender@s.whatsapp.net',
        messageContent: 'preço',
        cooldownSeconds: 60,
      })

      expect(result.shouldSuppress).toBe(false)
    })
  })

  // ========================================================================
  // Bot Already Responded
  // ========================================================================
  describe('Bot already responded check', () => {
    it('suppresses when bot sent price_response recently', async () => {
      const botPriceMsg = makeMockMessage({
        sender_jid: 'bot',
        is_from_bot: true,
        message_type: 'price_response',
        content: 'USDT/BRL: R$ 5,25',
        created_at: new Date().toISOString(),
      })

      // First call: botOnly check returns price_response
      // Second call: operator check returns empty
      mockGetRecentGroupMessages
        .mockResolvedValueOnce({ ok: true, data: [botPriceMsg] })
        .mockResolvedValueOnce({ ok: true, data: [] })

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'sender@s.whatsapp.net',
        messageContent: 'preço',
      })

      expect(result.shouldSuppress).toBe(true)
      expect(result.reason).toBe('bot_already_responded')
    })

    it('does not suppress for non-price bot messages', async () => {
      const botNotificationMsg = makeMockMessage({
        sender_jid: 'bot',
        is_from_bot: true,
        message_type: 'notification',
        content: 'Bot online',
        created_at: new Date().toISOString(),
      })

      mockGetRecentGroupMessages
        .mockResolvedValueOnce({ ok: true, data: [botNotificationMsg] })
        .mockResolvedValueOnce({ ok: true, data: [] })

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'sender@s.whatsapp.net',
        messageContent: 'preço',
      })

      expect(result.shouldSuppress).toBe(false)
    })

    it('does not suppress when no recent bot messages', async () => {
      mockGetRecentGroupMessages.mockResolvedValue({ ok: true, data: [] })

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'sender@s.whatsapp.net',
        messageContent: 'preço',
      })

      expect(result.shouldSuppress).toBe(false)
    })

    it('does not suppress on DB error (conservative)', async () => {
      mockGetRecentGroupMessages.mockResolvedValue({
        ok: false,
        error: 'Database unavailable',
      })

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'sender@s.whatsapp.net',
        messageContent: 'preço',
      })

      // Conservative: DB error = don't suppress
      expect(result.shouldSuppress).toBe(false)
    })
  })

  // ========================================================================
  // Operator Already Answered
  // ========================================================================
  describe('Operator already answered check', () => {
    it('suppresses when operator responded after sender trigger', async () => {
      const triggerTime = new Date()
      const operatorTime = new Date(triggerTime.getTime() + 5000) // 5s after trigger

      const senderTrigger = makeMockMessage({
        sender_jid: 'client@s.whatsapp.net',
        is_trigger: true,
        content: 'preço',
        created_at: triggerTime.toISOString(),
      })

      const operatorResponse = makeMockMessage({
        sender_jid: 'operator@s.whatsapp.net',
        is_from_bot: false,
        is_trigger: false,
        content: '5.25 hoje',
        created_at: operatorTime.toISOString(),
      })

      // First call: botOnly check (no recent price response)
      // Second call: all recent messages (contains trigger + operator response)
      mockGetRecentGroupMessages
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockResolvedValueOnce({ ok: true, data: [operatorResponse, senderTrigger] })

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'client@s.whatsapp.net',
        messageContent: 'preço',
      })

      expect(result.shouldSuppress).toBe(true)
      expect(result.reason).toBe('operator_answered')
    })

    it('does not suppress when operator message is BEFORE trigger', async () => {
      const operatorTime = new Date()
      const triggerTime = new Date(operatorTime.getTime() + 5000) // trigger AFTER operator

      const senderTrigger = makeMockMessage({
        sender_jid: 'client@s.whatsapp.net',
        is_trigger: true,
        content: 'preço',
        created_at: triggerTime.toISOString(),
      })

      const operatorChat = makeMockMessage({
        sender_jid: 'operator@s.whatsapp.net',
        is_from_bot: false,
        content: 'bom dia',
        created_at: operatorTime.toISOString(),
      })

      mockGetRecentGroupMessages
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockResolvedValueOnce({ ok: true, data: [senderTrigger, operatorChat] })

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'client@s.whatsapp.net',
        messageContent: 'preço',
      })

      expect(result.shouldSuppress).toBe(false)
    })

    it('does not suppress when no sender trigger found', async () => {
      const operatorMsg = makeMockMessage({
        sender_jid: 'operator@s.whatsapp.net',
        is_from_bot: false,
        content: 'something',
      })

      mockGetRecentGroupMessages
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockResolvedValueOnce({ ok: true, data: [operatorMsg] })

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'client@s.whatsapp.net',
        messageContent: 'preço',
      })

      expect(result.shouldSuppress).toBe(false)
    })

    it('does not count bot messages as operator responses', async () => {
      const triggerTime = new Date()
      const botTime = new Date(triggerTime.getTime() + 5000)

      const senderTrigger = makeMockMessage({
        sender_jid: 'client@s.whatsapp.net',
        is_trigger: true,
        content: 'preço',
        created_at: triggerTime.toISOString(),
      })

      const botMsg = makeMockMessage({
        sender_jid: 'bot',
        is_from_bot: true,
        message_type: 'notification',
        content: 'Bot notification',
        created_at: botTime.toISOString(),
      })

      mockGetRecentGroupMessages
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockResolvedValueOnce({ ok: true, data: [botMsg, senderTrigger] })

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'client@s.whatsapp.net',
        messageContent: 'preço',
      })

      // Bot messages should NOT count as operator response
      expect(result.shouldSuppress).toBe(false)
    })

    it('does not count sender messages as operator responses', async () => {
      const triggerTime = new Date()
      const followupTime = new Date(triggerTime.getTime() + 5000)

      const senderTrigger = makeMockMessage({
        sender_jid: 'client@s.whatsapp.net',
        is_trigger: true,
        content: 'preço',
        created_at: triggerTime.toISOString(),
      })

      const senderFollowup = makeMockMessage({
        sender_jid: 'client@s.whatsapp.net',
        is_trigger: false,
        content: 'de usdt',
        created_at: followupTime.toISOString(),
      })

      mockGetRecentGroupMessages
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockResolvedValueOnce({ ok: true, data: [senderFollowup, senderTrigger] })

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'client@s.whatsapp.net',
        messageContent: 'preço',
      })

      // Sender's own follow-up should NOT count as operator response
      expect(result.shouldSuppress).toBe(false)
    })

    it('skips operator check when skipOperatorCheck is true', async () => {
      mockGetRecentGroupMessages
        .mockResolvedValueOnce({ ok: true, data: [] }) // bot check only

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'client@s.whatsapp.net',
        messageContent: 'preço',
        skipOperatorCheck: true,
      })

      expect(result.shouldSuppress).toBe(false)
      // Should only call getRecentGroupMessages once (for bot check), not twice
      expect(mockGetRecentGroupMessages).toHaveBeenCalledTimes(1)
    })

    it('does not suppress on operator check DB error (conservative)', async () => {
      mockGetRecentGroupMessages
        .mockResolvedValueOnce({ ok: true, data: [] }) // bot check OK
        .mockResolvedValueOnce({ ok: false, error: 'DB error' }) // operator check fails

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'client@s.whatsapp.net',
        messageContent: 'preço',
      })

      // Conservative: DB error = don't suppress
      expect(result.shouldSuppress).toBe(false)
    })
  })

  // ========================================================================
  // Integration: Check Priority Order
  // ========================================================================
  describe('Check priority order', () => {
    it('cooldown takes priority over DB checks', async () => {
      // Set active cooldown
      recordBotResponse('group@g.us')

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'sender@s.whatsapp.net',
        messageContent: 'preço',
        cooldownSeconds: 60,
      })

      // Should suppress immediately without any DB query
      expect(result.shouldSuppress).toBe(true)
      expect(result.reason).toBe('cooldown_active')
      expect(mockGetRecentGroupMessages).not.toHaveBeenCalled()
    })

    it('returns no suppression when all checks pass', async () => {
      mockGetRecentGroupMessages.mockResolvedValue({ ok: true, data: [] })

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'sender@s.whatsapp.net',
        messageContent: 'preço',
      })

      expect(result.shouldSuppress).toBe(false)
      expect(result.reason).toBeNull()
    })

    it('bot check uses 5-minute lookback window', async () => {
      mockGetRecentGroupMessages.mockResolvedValue({ ok: true, data: [] })

      const before = Date.now()
      await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'sender@s.whatsapp.net',
        messageContent: 'preço',
      })

      // First call is the bot check (botOnly: true, since: ~5 min ago)
      const botCall = mockGetRecentGroupMessages.mock.calls[0]
      expect(botCall[0]).toBe('group@g.us')
      expect(botCall[1]).toBe(5) // limit
      expect(botCall[2]).toHaveProperty('botOnly', true)
      const sinceDateMs = (botCall[2] as { since: Date }).since.getTime()
      const expectedMs = before - 5 * 60 * 1000
      // Allow 1s tolerance for test execution time
      expect(Math.abs(sinceDateMs - expectedMs)).toBeLessThan(1000)
    })

    it('operator check uses 3-minute lookback window', async () => {
      mockGetRecentGroupMessages.mockResolvedValue({ ok: true, data: [] })

      const before = Date.now()
      await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'sender@s.whatsapp.net',
        messageContent: 'preço',
      })

      // Second call is the operator check (no botOnly, since: ~3 min ago)
      expect(mockGetRecentGroupMessages).toHaveBeenCalledTimes(2)
      const operatorCall = mockGetRecentGroupMessages.mock.calls[1]
      expect(operatorCall[0]).toBe('group@g.us')
      expect(operatorCall[1]).toBe(20) // limit
      expect(operatorCall[2]).not.toHaveProperty('botOnly')
      const sinceDateMs = (operatorCall[2] as { since: Date }).since.getTime()
      const expectedMs = before - 3 * 60 * 1000
      // Allow 1s tolerance for test execution time
      expect(Math.abs(sinceDateMs - expectedMs)).toBeLessThan(1000)
    })
  })

  // ========================================================================
  // State Management
  // ========================================================================
  describe('State management', () => {
    it('recordBotResponse updates cooldown timestamp', async () => {
      recordBotResponse('group@g.us')

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'sender@s.whatsapp.net',
        messageContent: 'preço',
        cooldownSeconds: 60,
      })

      expect(result.shouldSuppress).toBe(true)
    })

    it('resetSuppressionState clears all cooldowns', async () => {
      recordBotResponse('group@g.us')
      resetSuppressionState()

      mockGetRecentGroupMessages.mockResolvedValue({ ok: true, data: [] })

      const result = await shouldSuppressResponse({
        groupJid: 'group@g.us',
        senderJid: 'sender@s.whatsapp.net',
        messageContent: 'preço',
        cooldownSeconds: 60,
      })

      expect(result.shouldSuppress).toBe(false)
    })
  })
})
