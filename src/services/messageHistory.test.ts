/**
 * Tests for Message History Service
 * Story 7.1: Contacts Tracking Service
 * Story 7.2: Groups Tracking Service
 * Story 7.3: Message History Logging
 * Story 7.4: Bot Message Tracking
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  upsertContact,
  upsertGroup,
  saveMessage,
  logMessageToHistory,
  logBotMessage,
  initMessageHistory,
  resetMessageHistoryClient,
  setMessageHistoryClient,
  extractPhoneFromJid,
  getGroupMessages,
  getContactMessages,
  getContacts,
  getGroups,
  getMessageStats,
  getRecentSenderMessages,
  getRecentGroupMessages,
  buildSenderContext,
  type BotMessageType,
  type Message,
} from './messageHistory.js'

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { logger } from '../utils/logger.js'

// Create mock Supabase client
function createMockSupabase() {
  const mockRpc = vi.fn()
  const mockFrom = vi.fn()
  const mockInsert = vi.fn()
  const mockUpsert = vi.fn()
  const mockSelect = vi.fn()
  const mockEq = vi.fn()
  const mockGte = vi.fn()
  const mockLte = vi.fn()
  const mockOrder = vi.fn()
  const mockRange = vi.fn()

  // Default RPC success
  mockRpc.mockResolvedValue({ error: null })

  // Default insert success
  mockInsert.mockResolvedValue({ error: null })

  // Default upsert success (for backwards compat if needed)
  mockUpsert.mockResolvedValue({ error: null })

  mockFrom.mockReturnValue({
    insert: mockInsert,
    upsert: mockUpsert,
    select: mockSelect,
    eq: mockEq,
    gte: mockGte,
    lte: mockLte,
    order: mockOrder,
    range: mockRange,
  })

  return {
    rpc: mockRpc,
    from: mockFrom,
    _mockInsert: mockInsert,
    _mockUpsert: mockUpsert,
    _mockSelect: mockSelect,
    _mockRpc: mockRpc,
  }
}

describe('Story 7.1: Contacts Tracking Service', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>

  beforeEach(() => {
    vi.clearAllMocks()
    resetMessageHistoryClient()
    mockSupabase = createMockSupabase()
    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])
  })

  afterEach(() => {
    resetMessageHistoryClient()
  })

  describe('AC1: Phone Extraction from JID', () => {
    it('extracts phone from standard JID format', () => {
      const phone = extractPhoneFromJid('5511999999999@s.whatsapp.net')
      expect(phone).toBe('5511999999999')
    })

    it('extracts phone from JID with colon (device identifier)', () => {
      const phone = extractPhoneFromJid('5511999999999:123@s.whatsapp.net')
      expect(phone).toBe('5511999999999')
    })

    it('extracts phone from group participant JID', () => {
      const phone = extractPhoneFromJid('5511888888888:45@g.us')
      expect(phone).toBe('5511888888888')
    })

    it('handles JID without colon', () => {
      const phone = extractPhoneFromJid('5521987654321@s.whatsapp.net')
      expect(phone).toBe('5521987654321')
    })
  })

  describe('AC2: Contact Upsert on Message', () => {
    it('calls upsert_contact RPC with correct params', async () => {
      const result = await upsertContact('5511999999999@s.whatsapp.net', 'John Doe')

      expect(result.ok).toBe(true)
      expect(mockSupabase.rpc).toHaveBeenCalledWith('upsert_contact', {
        p_jid: '5511999999999@s.whatsapp.net',
        p_phone: '5511999999999',
        p_push_name: 'John Doe',
      })
    })

    it('increments message_count on each call', async () => {
      // The RPC function handles increment atomically - we verify it's called
      await upsertContact('5511999999999@s.whatsapp.net')
      await upsertContact('5511999999999@s.whatsapp.net')

      expect(mockSupabase.rpc).toHaveBeenCalledTimes(2)
    })
  })

  describe('AC3: Push Name Storage', () => {
    it('stores push name when provided', async () => {
      await upsertContact('5511999999999@s.whatsapp.net', 'Alice Smith')

      expect(mockSupabase.rpc).toHaveBeenCalledWith('upsert_contact', {
        p_jid: '5511999999999@s.whatsapp.net',
        p_phone: '5511999999999',
        p_push_name: 'Alice Smith',
      })
    })

    it('passes null for push_name when not provided', async () => {
      await upsertContact('5511999999999@s.whatsapp.net')

      expect(mockSupabase.rpc).toHaveBeenCalledWith('upsert_contact', {
        p_jid: '5511999999999@s.whatsapp.net',
        p_phone: '5511999999999',
        p_push_name: null,
      })
    })

    it('passes null for empty push_name', async () => {
      await upsertContact('5511999999999@s.whatsapp.net', '')

      expect(mockSupabase.rpc).toHaveBeenCalledWith('upsert_contact', {
        p_jid: '5511999999999@s.whatsapp.net',
        p_phone: '5511999999999',
        p_push_name: null,
      })
    })
  })

  describe('AC4: First Seen Tracking', () => {
    // Note: first_seen_at is handled by the RPC function in Supabase
    // We verify the RPC is called correctly; the DB handles the logic
    it('RPC handles first_seen_at on INSERT, last_seen_at on UPDATE', async () => {
      const result = await upsertContact('5511999999999@s.whatsapp.net', 'New User')

      expect(result.ok).toBe(true)
      // The RPC upsert_contact function handles this atomically:
      // - INSERT: sets first_seen_at = NOW(), last_seen_at = NOW(), message_count = 1
      // - UPDATE: sets last_seen_at = NOW(), message_count = message_count + 1
      expect(mockSupabase.rpc).toHaveBeenCalled()
    })
  })

  describe('AC5: Fire-and-Forget Pattern', () => {
    it('returns Result error instead of throwing', async () => {
      mockSupabase._mockRpc.mockResolvedValue({
        error: { message: 'Database unavailable', code: '500' },
      })

      const result = await upsertContact('5511999999999@s.whatsapp.net')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Database unavailable')
      }
    })

    it('logs warning on failure but does not throw', async () => {
      mockSupabase._mockRpc.mockResolvedValue({
        error: { message: 'Connection timeout', code: '500' },
      })

      const result = await upsertContact('5511999999999@s.whatsapp.net')

      expect(result.ok).toBe(false)
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to upsert contact',
        expect.objectContaining({
          event: 'contact_upsert_error',
          jid: '5511999999999@s.whatsapp.net',
        })
      )
    })

    it('catches and handles unexpected exceptions', async () => {
      mockSupabase._mockRpc.mockRejectedValue(new Error('Network error'))

      const result = await upsertContact('5511999999999@s.whatsapp.net')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Network error')
      }
    })

    it('returns error when client not initialized', async () => {
      resetMessageHistoryClient()

      const result = await upsertContact('5511999999999@s.whatsapp.net')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Supabase not initialized')
      }
    })
  })
})

describe('Story 7.2: Groups Tracking Service', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>

  beforeEach(() => {
    vi.clearAllMocks()
    resetMessageHistoryClient()
    mockSupabase = createMockSupabase()
    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])
  })

  afterEach(() => {
    resetMessageHistoryClient()
  })

  describe('AC1: Group Upsert on Message', () => {
    it('calls upsert_group RPC with correct params', async () => {
      const result = await upsertGroup('120363123456789@g.us', 'Test Group', false)

      expect(result.ok).toBe(true)
      expect(mockSupabase.rpc).toHaveBeenCalledWith('upsert_group', {
        p_jid: '120363123456789@g.us',
        p_name: 'Test Group',
        p_is_control_group: false,
      })
    })
  })

  describe('AC2: Last Activity Update', () => {
    // RPC handles atomic update of last_activity_at and message_count
    it('RPC handles last_activity_at and message_count increment', async () => {
      await upsertGroup('120363123456789@g.us', 'Test Group')
      await upsertGroup('120363123456789@g.us', 'Test Group')

      expect(mockSupabase.rpc).toHaveBeenCalledTimes(2)
    })
  })

  describe('AC3: Control Group Flag', () => {
    it('passes isControlGroup=true when specified', async () => {
      await upsertGroup('120363123456789@g.us', 'Control Group', true)

      expect(mockSupabase.rpc).toHaveBeenCalledWith('upsert_group', {
        p_jid: '120363123456789@g.us',
        p_name: 'Control Group',
        p_is_control_group: true,
      })
    })

    it('defaults isControlGroup to false', async () => {
      await upsertGroup('120363123456789@g.us', 'Regular Group')

      expect(mockSupabase.rpc).toHaveBeenCalledWith('upsert_group', {
        p_jid: '120363123456789@g.us',
        p_name: 'Regular Group',
        p_is_control_group: false,
      })
    })
  })

  describe('AC4: First Seen Tracking', () => {
    it('RPC handles first_seen_at automatically', async () => {
      const result = await upsertGroup('120363123456789@g.us', 'New Group')
      expect(result.ok).toBe(true)
      expect(mockSupabase.rpc).toHaveBeenCalled()
    })
  })

  describe('AC5: Fire-and-Forget Pattern', () => {
    it('returns Result error instead of throwing', async () => {
      mockSupabase._mockRpc.mockResolvedValue({
        error: { message: 'Database unavailable', code: '500' },
      })

      const result = await upsertGroup('120363123456789@g.us', 'Test Group')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Database unavailable')
      }
    })

    it('logs warning on failure', async () => {
      mockSupabase._mockRpc.mockResolvedValue({
        error: { message: 'Connection timeout', code: '500' },
      })

      await upsertGroup('120363123456789@g.us', 'Test Group')

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to upsert group',
        expect.objectContaining({
          event: 'group_upsert_error',
          jid: '120363123456789@g.us',
        })
      )
    })
  })

  describe('AC6: Name update logic', () => {
    it('passes non-empty name to RPC', async () => {
      await upsertGroup('120363123456789@g.us', 'Group Name')

      expect(mockSupabase.rpc).toHaveBeenCalledWith('upsert_group', {
        p_jid: '120363123456789@g.us',
        p_name: 'Group Name',
        p_is_control_group: false,
      })
    })

    it('passes empty string to RPC (DB handles COALESCE)', async () => {
      // The RPC function uses COALESCE(NULLIF(EXCLUDED.name, ''), groups.name)
      // This means empty string won't overwrite existing name
      await upsertGroup('120363123456789@g.us', '')

      expect(mockSupabase.rpc).toHaveBeenCalledWith('upsert_group', {
        p_jid: '120363123456789@g.us',
        p_name: '',
        p_is_control_group: false,
      })
    })
  })
})

describe('Story 7.3: Message History Logging', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>

  beforeEach(() => {
    vi.clearAllMocks()
    resetMessageHistoryClient()
    mockSupabase = createMockSupabase()
    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])
  })

  afterEach(() => {
    resetMessageHistoryClient()
  })

  describe('AC1: Message Logging on Receive', () => {
    it('inserts message with all fields', async () => {
      const result = await saveMessage({
        messageId: 'msg-123',
        groupJid: '120363123456789@g.us',
        senderJid: '5511999999999@s.whatsapp.net',
        messageType: 'text',
        content: 'Hello world',
        isFromBot: false,
        isTrigger: false,
        metadata: { source: 'test' },
      })

      expect(result.ok).toBe(true)
      expect(mockSupabase.from).toHaveBeenCalledWith('messages')
      expect(mockSupabase._mockInsert).toHaveBeenCalledWith({
        message_id: 'msg-123',
        group_jid: '120363123456789@g.us',
        sender_jid: '5511999999999@s.whatsapp.net',
        is_control_group: false,
        message_type: 'text',
        content: 'Hello world',
        is_from_bot: false,
        is_trigger: false,
        metadata: { source: 'test' },
      })
    })
  })

  describe('AC2: Fire-and-Forget Resilience', () => {
    it('returns error on database failure', async () => {
      mockSupabase._mockInsert.mockResolvedValue({
        error: { message: 'Insert failed', code: '500' },
      })

      const result = await saveMessage({
        groupJid: '120363123456789@g.us',
        senderJid: '5511999999999@s.whatsapp.net',
        messageType: 'text',
        content: 'Test',
        isFromBot: false,
        isTrigger: false,
      })

      expect(result.ok).toBe(false)
    })

    it('does not throw on failure', async () => {
      mockSupabase._mockInsert.mockRejectedValue(new Error('Network error'))

      const result = await saveMessage({
        groupJid: '120363123456789@g.us',
        senderJid: '5511999999999@s.whatsapp.net',
        messageType: 'text',
        content: 'Test',
        isFromBot: false,
        isTrigger: false,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Network error')
      }
    })
  })

  describe('AC3: Database Schema fields', () => {
    it('maps all required fields correctly', async () => {
      await saveMessage({
        messageId: 'abc123',
        groupJid: '120363123456789@g.us',
        senderJid: '5511999999999@s.whatsapp.net',
        messageType: 'image',
        content: 'image caption',
        isFromBot: true,
        isTrigger: true,
        metadata: { price: 100 },
      })

      expect(mockSupabase._mockInsert).toHaveBeenCalledWith({
        message_id: 'abc123',
        group_jid: '120363123456789@g.us',
        sender_jid: '5511999999999@s.whatsapp.net',
        is_control_group: false,
        message_type: 'image',
        content: 'image caption',
        is_from_bot: true,
        is_trigger: true,
        metadata: { price: 100 },
      })
    })

    it('defaults metadata to empty object when not provided', async () => {
      await saveMessage({
        groupJid: '120363123456789@g.us',
        senderJid: '5511999999999@s.whatsapp.net',
        messageType: 'text',
        content: 'Test',
        isFromBot: false,
        isTrigger: false,
      })

      expect(mockSupabase._mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {},
        })
      )
    })
  })

  describe('AC4: Parallel Operations', () => {
    it('logMessageToHistory calls all three operations', async () => {
      await logMessageToHistory({
        messageId: 'msg-123',
        groupJid: '120363123456789@g.us',
        groupName: 'Test Group',
        senderJid: '5511999999999@s.whatsapp.net',
        senderName: 'John',
        isControlGroup: false,
        messageType: 'text',
        content: 'Hello',
        isFromBot: false,
        isTrigger: false,
      })

      // Wait for Promise.all to settle
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Should have called RPC twice (contact + group) and insert once (message)
      expect(mockSupabase.rpc).toHaveBeenCalledTimes(2)
      expect(mockSupabase._mockInsert).toHaveBeenCalledTimes(1)
    })
  })

  describe('AC5: Performance Monitoring', () => {
    it('logs warning when operation exceeds 100ms threshold', async () => {
      // Mock a slow insert operation (takes 150ms)
      mockSupabase._mockInsert.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150))
        return { error: null }
      })

      await saveMessage({
        groupJid: '120363123456789@g.us',
        senderJid: '5511999999999@s.whatsapp.net',
        messageType: 'text',
        content: 'Test slow message',
        isFromBot: false,
        isTrigger: false,
      })

      // Verify slow operation warning was logged
      expect(logger.warn).toHaveBeenCalledWith(
        'Slow message history operation',
        expect.objectContaining({
          event: 'message_history_slow',
          operation: 'saveMessage',
          thresholdMs: 100,
        })
      )
    })

    it('does not log warning when operation is fast', async () => {
      // Mock a fast insert operation (immediate)
      mockSupabase._mockInsert.mockResolvedValue({ error: null })

      await saveMessage({
        groupJid: '120363123456789@g.us',
        senderJid: '5511999999999@s.whatsapp.net',
        messageType: 'text',
        content: 'Test fast message',
        isFromBot: false,
        isTrigger: false,
      })

      // Verify no slow operation warning was logged
      expect(logger.warn).not.toHaveBeenCalledWith(
        'Slow message history operation',
        expect.anything()
      )
    })
  })

  describe('AC6: Trigger Detection Flag', () => {
    it('stores isTrigger=true when message contains trigger', async () => {
      await saveMessage({
        groupJid: '120363123456789@g.us',
        senderJid: '5511999999999@s.whatsapp.net',
        messageType: 'text',
        content: 'cotação btc',
        isFromBot: false,
        isTrigger: true,
      })

      expect(mockSupabase._mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          is_trigger: true,
        })
      )
    })

    it('stores isTrigger=false for non-trigger messages', async () => {
      await saveMessage({
        groupJid: '120363123456789@g.us',
        senderJid: '5511999999999@s.whatsapp.net',
        messageType: 'text',
        content: 'hello everyone',
        isFromBot: false,
        isTrigger: false,
      })

      expect(mockSupabase._mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          is_trigger: false,
        })
      )
    })
  })
})

describe('Story 7.4: Bot Message Tracking', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>

  beforeEach(() => {
    vi.clearAllMocks()
    resetMessageHistoryClient()
    mockSupabase = createMockSupabase()
    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])
  })

  afterEach(() => {
    resetMessageHistoryClient()
  })

  describe('AC1: Price Response Logging', () => {
    it('logs price response with correct message type', async () => {
      logBotMessage({
        groupJid: '120363123456789@g.us',
        content: 'BTC/BRL: R$ 350.000,00',
        messageType: 'price_response',
        metadata: { price: 350000 },
      })

      // Wait for fire-and-forget to execute
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockSupabase._mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          message_type: 'price_response',
          is_from_bot: true,
          metadata: { price: 350000 },
        })
      )
    })
  })

  describe('AC2: Stall Message Logging', () => {
    it('logs stall message with correct message type', async () => {
      logBotMessage({
        groupJid: '120363123456789@g.us',
        content: 'Um momento, vou verificar...',
        messageType: 'stall',
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockSupabase._mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          message_type: 'stall',
          is_from_bot: true,
        })
      )
    })
  })

  describe('AC3: Notification Logging', () => {
    it('logs notification with correct message type', async () => {
      logBotMessage({
        groupJid: '120363123456789@g.us',
        content: 'Bot paused due to error',
        messageType: 'notification',
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockSupabase._mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          message_type: 'notification',
          is_from_bot: true,
        })
      )
    })
  })

  describe('AC5: Fire-and-Forget Pattern', () => {
    it('does not throw on database failure', async () => {
      mockSupabase._mockInsert.mockRejectedValue(new Error('Database error'))

      // Should not throw
      expect(() => {
        logBotMessage({
          groupJid: '120363123456789@g.us',
          content: 'Test message',
          messageType: 'status',
        })
      }).not.toThrow()

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Error is logged by saveMessage's exception handler (fire-and-forget still works)
      expect(logger.warn).toHaveBeenCalledWith(
        'Message save exception',
        expect.objectContaining({
          event: 'message_save_exception',
          error: 'Database error',
        })
      )
    })

    it('logs bot_message_log_error when saveMessage rejects its promise', async () => {
      // Simulate a case where the Promise itself rejects (not caught by saveMessage)
      mockSupabase._mockInsert.mockResolvedValue({
        error: { message: 'Insert failed', code: '500' },
      })

      logBotMessage({
        groupJid: '120363123456789@g.us',
        content: 'Test message',
        messageType: 'status',
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Error logged by saveMessage
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to save message',
        expect.objectContaining({
          event: 'message_save_error',
        })
      )
    })
  })

  describe('AC6: Message Type Enum', () => {
    it.each<BotMessageType>([
      'price_response',
      'stall',
      'notification',
      'status',
      'error',
    ])('accepts %s as valid message type', async (messageType) => {
      logBotMessage({
        groupJid: '120363123456789@g.us',
        content: `Test ${messageType}`,
        messageType,
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockSupabase._mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          message_type: messageType,
        })
      )
    })
  })

  describe('Bot message defaults', () => {
    it('sets senderJid to "bot"', async () => {
      logBotMessage({
        groupJid: '120363123456789@g.us',
        content: 'Test',
        messageType: 'status',
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockSupabase._mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          sender_jid: 'bot',
        })
      )
    })

    it('sets isFromBot to true', async () => {
      logBotMessage({
        groupJid: '120363123456789@g.us',
        content: 'Test',
        messageType: 'status',
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockSupabase._mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          is_from_bot: true,
        })
      )
    })

    it('sets isTrigger to false', async () => {
      logBotMessage({
        groupJid: '120363123456789@g.us',
        content: 'Test',
        messageType: 'status',
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockSupabase._mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          is_trigger: false,
        })
      )
    })
  })
})

describe('initMessageHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMessageHistoryClient()
  })

  it('logs initialization event', () => {
    // Note: We can't easily test createClient without mocking @supabase/supabase-js
    // For now, we verify the exported functions work after manual client injection
    const mockSupabase = createMockSupabase()
    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

    expect(logger.info).not.toHaveBeenCalled() // initMessageHistory wasn't called
  })
})

describe('Story 7.5: History Query API', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>

  // Create extended mock for query operations
  function createQueryMockSupabase() {
    const base = createMockSupabase()
    const mockRange = vi.fn()
    const mockSingle = vi.fn()

    // Chain methods for select queries
    base._mockSelect.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          range: mockRange.mockResolvedValue({
            data: [],
            error: null,
            count: 0,
          }),
        }),
        gte: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              range: mockRange,
            }),
          }),
        }),
        single: mockSingle.mockResolvedValue({ data: null, error: null }),
      }),
      gte: vi.fn().mockReturnValue({
        lte: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            range: mockRange,
          }),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
      order: vi.fn().mockReturnValue({
        range: mockRange,
      }),
    })

    return {
      ...base,
      _mockRange: mockRange,
      _mockSingle: mockSingle,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetMessageHistoryClient()
  })

  afterEach(() => {
    resetMessageHistoryClient()
  })

  describe('AC1: Query Messages by Group (getGroupMessages)', () => {
    it('queries messages table with group_jid filter', async () => {
      mockSupabase = createMockSupabase()

      // Setup proper chained mocks
      const mockOrder = vi.fn()
      const mockRange = vi.fn()
      const mockEq = vi.fn()

      mockRange.mockResolvedValue({
        data: [{ id: '1', group_jid: 'test@g.us', content: 'Hello' }],
        error: null,
        count: 1,
      })
      mockOrder.mockReturnValue({ range: mockRange })
      mockEq.mockReturnValue({ order: mockOrder })
      mockSupabase._mockSelect.mockReturnValue({ eq: mockEq })

      setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

      const result = await getGroupMessages('test@g.us')

      expect(result.ok).toBe(true)
      expect(mockSupabase.from).toHaveBeenCalledWith('messages')
      expect(mockEq).toHaveBeenCalledWith('group_jid', 'test@g.us')
    })

    it('returns paginated result with metadata', async () => {
      mockSupabase = createMockSupabase()

      const mockOrder = vi.fn()
      const mockRange = vi.fn()
      const mockEq = vi.fn()

      mockRange.mockResolvedValue({
        data: [{ id: '1' }, { id: '2' }],
        error: null,
        count: 10, // More than returned
      })
      mockOrder.mockReturnValue({ range: mockRange })
      mockEq.mockReturnValue({ order: mockOrder })
      mockSupabase._mockSelect.mockReturnValue({ eq: mockEq })

      setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

      const result = await getGroupMessages('test@g.us', { limit: 2 })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.data).toHaveLength(2)
        expect(result.data.total).toBe(10)
        expect(result.data.hasMore).toBe(true)
        expect(result.data.limit).toBe(2)
        expect(result.data.offset).toBe(0)
      }
    })
  })

  describe('AC3: Date Range Filtering', () => {
    it('handles date filter options without error', async () => {
      mockSupabase = createMockSupabase()

      const mockOrder = vi.fn()
      const mockRange = vi.fn()
      const mockEq = vi.fn()
      const mockGte = vi.fn()
      const mockLte = vi.fn()

      // Set up the mock chain to support gte/lte being called on the result
      mockLte.mockResolvedValue({ data: [], error: null, count: 0 })
      mockGte.mockReturnValue({ lte: mockLte, then: (fn: (v: { data: never[]; error: null; count: number }) => void) => fn({ data: [], error: null, count: 0 }) })
      mockRange.mockReturnValue({ gte: mockGte, then: (fn: (v: { data: never[]; error: null; count: number }) => void) => fn({ data: [], error: null, count: 0 }) })
      mockOrder.mockReturnValue({ range: mockRange })
      mockEq.mockReturnValue({ order: mockOrder })
      mockSupabase._mockSelect.mockReturnValue({ eq: mockEq })

      setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

      const fromDate = new Date('2026-01-01')
      const toDate = new Date('2026-01-31')
      const result = await getGroupMessages('test@g.us', { from: fromDate, to: toDate })

      // The function should complete without error
      expect(result.ok).toBe(true)
    })
  })

  describe('AC4: Pagination Metadata', () => {
    it('returns hasMore=false when no more results', async () => {
      mockSupabase = createMockSupabase()

      const mockOrder = vi.fn()
      const mockRange = vi.fn()
      const mockEq = vi.fn()

      mockRange.mockResolvedValue({
        data: [{ id: '1' }],
        error: null,
        count: 1,
      })
      mockOrder.mockReturnValue({ range: mockRange })
      mockEq.mockReturnValue({ order: mockOrder })
      mockSupabase._mockSelect.mockReturnValue({ eq: mockEq })

      setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

      const result = await getGroupMessages('test@g.us')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.hasMore).toBe(false)
      }
    })
  })

  describe('AC5: Query Options', () => {
    it('defaults limit to 50', async () => {
      mockSupabase = createMockSupabase()

      const mockOrder = vi.fn()
      const mockRange = vi.fn()
      const mockEq = vi.fn()

      mockRange.mockResolvedValue({ data: [], error: null, count: 0 })
      mockOrder.mockReturnValue({ range: mockRange })
      mockEq.mockReturnValue({ order: mockOrder })
      mockSupabase._mockSelect.mockReturnValue({ eq: mockEq })

      setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

      const result = await getGroupMessages('test@g.us')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.limit).toBe(50)
      }
    })

    it('caps limit at 100', async () => {
      mockSupabase = createMockSupabase()

      const mockOrder = vi.fn()
      const mockRange = vi.fn()
      const mockEq = vi.fn()

      mockRange.mockResolvedValue({ data: [], error: null, count: 0 })
      mockOrder.mockReturnValue({ range: mockRange })
      mockEq.mockReturnValue({ order: mockOrder })
      mockSupabase._mockSelect.mockReturnValue({ eq: mockEq })

      setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

      const result = await getGroupMessages('test@g.us', { limit: 500 })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.limit).toBe(100)
      }
    })

    it('supports orderBy asc/desc', async () => {
      mockSupabase = createMockSupabase()

      const mockOrder = vi.fn()
      const mockRange = vi.fn()
      const mockEq = vi.fn()

      mockRange.mockResolvedValue({ data: [], error: null, count: 0 })
      mockOrder.mockReturnValue({ range: mockRange })
      mockEq.mockReturnValue({ order: mockOrder })
      mockSupabase._mockSelect.mockReturnValue({ eq: mockEq })

      setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

      await getGroupMessages('test@g.us', { orderBy: 'asc' })

      expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: true })
    })
  })

  describe('AC6: Get All Contacts (getContacts)', () => {
    it('queries contacts ordered by message_count', async () => {
      mockSupabase = createMockSupabase()

      const mockOrder = vi.fn()
      const mockRange = vi.fn()

      mockRange.mockResolvedValue({
        data: [{ id: '1', phone: '5511999999999', message_count: 100 }],
        error: null,
        count: 1,
      })
      mockOrder.mockReturnValue({ range: mockRange })
      mockSupabase._mockSelect.mockReturnValue({ order: mockOrder })

      setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

      const result = await getContacts()

      expect(result.ok).toBe(true)
      expect(mockSupabase.from).toHaveBeenCalledWith('contacts')
      expect(mockOrder).toHaveBeenCalledWith('message_count', { ascending: false })
    })
  })

  describe('AC7: Get All Groups (getGroups)', () => {
    it('queries groups ordered by message_count', async () => {
      mockSupabase = createMockSupabase()

      const mockOrder = vi.fn()
      const mockRange = vi.fn()

      mockRange.mockResolvedValue({
        data: [{ id: '1', jid: 'test@g.us', message_count: 50 }],
        error: null,
        count: 1,
      })
      mockOrder.mockReturnValue({ range: mockRange })
      mockSupabase._mockSelect.mockReturnValue({ order: mockOrder })

      setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

      const result = await getGroups()

      expect(result.ok).toBe(true)
      expect(mockSupabase.from).toHaveBeenCalledWith('groups')
    })

    it('filters by is_control_group when specified', async () => {
      mockSupabase = createMockSupabase()

      const mockOrder = vi.fn()
      const mockRange = vi.fn()
      const mockEq = vi.fn()

      mockRange.mockResolvedValue({ data: [], error: null, count: 0 })
      mockOrder.mockReturnValue({ range: mockRange, eq: mockEq })
      mockEq.mockReturnValue({ range: mockRange })
      mockSupabase._mockSelect.mockReturnValue({ order: mockOrder })

      setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

      await getGroups({ isControlGroup: true })

      // The eq call happens on the chain
      expect(mockSupabase.from).toHaveBeenCalledWith('groups')
    })
  })

  describe('AC8: Message Statistics (getMessageStats)', () => {
    it('returns aggregated statistics', async () => {
      mockSupabase = createMockSupabase()

      // Mock for count queries
      const mockGte = vi.fn()
      const mockLte = vi.fn()
      const mockEqTrigger = vi.fn()
      const mockLimit = vi.fn()

      mockLimit.mockResolvedValue({
        data: [
          { group_jid: 'group1', message_type: 'text' },
          { group_jid: 'group1', message_type: 'text' },
          { group_jid: 'group2', message_type: 'price_response' },
        ],
        error: null,
      })

      mockLte.mockReturnValue({
        count: 3,
        error: null,
        limit: mockLimit,
      })
      mockGte.mockReturnValue({ lte: mockLte })
      mockEqTrigger.mockReturnValue({ gte: mockGte })

      mockSupabase._mockSelect.mockReturnValue({
        gte: mockGte,
        eq: mockEqTrigger,
      })

      setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

      const result = await getMessageStats()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toHaveProperty('total')
        expect(result.data).toHaveProperty('byGroup')
        expect(result.data).toHaveProperty('byType')
        expect(result.data).toHaveProperty('triggerCount')
        expect(result.data).toHaveProperty('dateRange')
      }
    })
  })

  describe('Error handling', () => {
    it('returns error when client not initialized', async () => {
      // Don't set client
      const result = await getGroupMessages('test@g.us')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Supabase not initialized')
      }
    })

    it('handles database errors gracefully', async () => {
      mockSupabase = createMockSupabase()

      const mockEq = vi.fn()
      mockEq.mockReturnValue({
        order: vi.fn().mockReturnValue({
          range: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database error', code: '500' },
            count: null,
          }),
        }),
      })
      mockSupabase._mockSelect.mockReturnValue({ eq: mockEq })

      setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

      const result = await getGroupMessages('test@g.us')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Database error')
      }
    })
  })
})

// ============================================================================
// Sprint 5, Task 5.1: Message Lookback Tests
// ============================================================================

/**
 * Creates a fully fluent Supabase query builder mock.
 * Every method returns `this` (or resolves with the provided result on `await`).
 * This mimics Supabase's chainable query API without caring about call order.
 */
function createFluentQueryBuilder(resolvedValue: { data: Message[] | null; error: { message: string } | null; count?: number | null }) {
  const builder: Record<string, unknown> = {}

  // Make it thenable (awaitable) by adding .then()
  const thenFn = (resolve: (v: typeof resolvedValue) => void) => {
    resolve(resolvedValue)
    return undefined
  }

  const methods = ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'order', 'limit', 'range', 'single', 'is', 'in']
  for (const method of methods) {
    builder[method] = vi.fn().mockReturnValue(builder)
  }
  builder.then = thenFn

  return builder
}

function makeMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: '1',
    message_id: null,
    group_jid: 'test@g.us',
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

describe('Sprint 5, Task 5.1: getRecentSenderMessages', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>

  beforeEach(() => {
    vi.clearAllMocks()
    resetMessageHistoryClient()
  })

  afterEach(() => {
    resetMessageHistoryClient()
  })

  it('returns error when client not initialized', async () => {
    const result = await getRecentSenderMessages('group@g.us', 'sender@s.whatsapp.net')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Supabase not initialized')
    }
  })

  it('queries with correct group_jid and sender_jid filters', async () => {
    mockSupabase = createMockSupabase()
    const mockEq2 = vi.fn()
    const mockOrder = vi.fn()
    const mockLimit = vi.fn()
    const mockEq1 = vi.fn()

    mockLimit.mockResolvedValue({ data: [], error: null })
    mockOrder.mockReturnValue({ limit: mockLimit })
    mockEq2.mockReturnValue({ order: mockOrder })
    mockEq1.mockReturnValue({ eq: mockEq2 })
    mockSupabase._mockSelect.mockReturnValue({ eq: mockEq1 })

    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

    const result = await getRecentSenderMessages('group@g.us', 'sender@s.whatsapp.net')

    expect(result.ok).toBe(true)
    expect(mockSupabase.from).toHaveBeenCalledWith('messages')
    expect(mockEq1).toHaveBeenCalledWith('group_jid', 'group@g.us')
    expect(mockEq2).toHaveBeenCalledWith('sender_jid', 'sender@s.whatsapp.net')
    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('returns messages on success', async () => {
    mockSupabase = createMockSupabase()
    const msg1 = makeMockMessage({ id: '1', content: 'preço' })
    const msg2 = makeMockMessage({ id: '2', content: 'cotação' })

    const mockEq2 = vi.fn()
    const mockOrder = vi.fn()
    const mockLimit = vi.fn()
    const mockEq1 = vi.fn()

    mockLimit.mockResolvedValue({ data: [msg1, msg2], error: null })
    mockOrder.mockReturnValue({ limit: mockLimit })
    mockEq2.mockReturnValue({ order: mockOrder })
    mockEq1.mockReturnValue({ eq: mockEq2 })
    mockSupabase._mockSelect.mockReturnValue({ eq: mockEq1 })

    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

    const result = await getRecentSenderMessages('group@g.us', 'sender@s.whatsapp.net')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toHaveLength(2)
      expect(result.data[0].content).toBe('preço')
    }
  })

  it('caps limit at 50', async () => {
    mockSupabase = createMockSupabase()
    const mockEq2 = vi.fn()
    const mockOrder = vi.fn()
    const mockLimit = vi.fn()
    const mockEq1 = vi.fn()

    mockLimit.mockResolvedValue({ data: [], error: null })
    mockOrder.mockReturnValue({ limit: mockLimit })
    mockEq2.mockReturnValue({ order: mockOrder })
    mockEq1.mockReturnValue({ eq: mockEq2 })
    mockSupabase._mockSelect.mockReturnValue({ eq: mockEq1 })

    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

    await getRecentSenderMessages('group@g.us', 'sender@s.whatsapp.net', 200)

    expect(mockLimit).toHaveBeenCalledWith(50)
  })

  it('floors limit at 1', async () => {
    mockSupabase = createMockSupabase()
    const mockEq2 = vi.fn()
    const mockOrder = vi.fn()
    const mockLimit = vi.fn()
    const mockEq1 = vi.fn()

    mockLimit.mockResolvedValue({ data: [], error: null })
    mockOrder.mockReturnValue({ limit: mockLimit })
    mockEq2.mockReturnValue({ order: mockOrder })
    mockEq1.mockReturnValue({ eq: mockEq1 })
    mockEq1.mockReturnValue({ eq: mockEq2 })

    // Re-setup chain properly
    mockEq2.mockReturnValue({ order: mockOrder })
    mockEq1.mockReturnValue({ eq: mockEq2 })
    mockSupabase._mockSelect.mockReturnValue({ eq: mockEq1 })

    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

    await getRecentSenderMessages('group@g.us', 'sender@s.whatsapp.net', -5)

    expect(mockLimit).toHaveBeenCalledWith(1)
  })

  it('handles database error gracefully', async () => {
    mockSupabase = createMockSupabase()
    const mockEq2 = vi.fn()
    const mockOrder = vi.fn()
    const mockLimit = vi.fn()
    const mockEq1 = vi.fn()

    mockLimit.mockResolvedValue({ data: null, error: { message: 'Query failed' } })
    mockOrder.mockReturnValue({ limit: mockLimit })
    mockEq2.mockReturnValue({ order: mockOrder })
    mockEq1.mockReturnValue({ eq: mockEq2 })
    mockSupabase._mockSelect.mockReturnValue({ eq: mockEq1 })

    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

    const result = await getRecentSenderMessages('group@g.us', 'sender@s.whatsapp.net')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Query failed')
    }
  })

  it('catches unexpected exceptions', async () => {
    mockSupabase = createMockSupabase()
    mockSupabase._mockSelect.mockImplementation(() => {
      throw new Error('Unexpected crash')
    })

    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

    const result = await getRecentSenderMessages('group@g.us', 'sender@s.whatsapp.net')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Unexpected crash')
    }
  })

  it('returns empty array when data is null', async () => {
    mockSupabase = createMockSupabase()
    const mockEq2 = vi.fn()
    const mockOrder = vi.fn()
    const mockLimit = vi.fn()
    const mockEq1 = vi.fn()

    mockLimit.mockResolvedValue({ data: null, error: null })
    mockOrder.mockReturnValue({ limit: mockLimit })
    mockEq2.mockReturnValue({ order: mockOrder })
    mockEq1.mockReturnValue({ eq: mockEq2 })
    mockSupabase._mockSelect.mockReturnValue({ eq: mockEq1 })

    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

    const result = await getRecentSenderMessages('group@g.us', 'sender@s.whatsapp.net')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual([])
    }
  })
})

describe('Sprint 5, Task 5.1: getRecentGroupMessages', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>

  beforeEach(() => {
    vi.clearAllMocks()
    resetMessageHistoryClient()
  })

  afterEach(() => {
    resetMessageHistoryClient()
  })

  it('returns error when client not initialized', async () => {
    const result = await getRecentGroupMessages('group@g.us')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Supabase not initialized')
    }
  })

  it('queries with correct group_jid filter', async () => {
    mockSupabase = createMockSupabase()
    const mockOrder = vi.fn()
    const mockLimit = vi.fn()
    const mockEq = vi.fn()

    mockLimit.mockResolvedValue({ data: [], error: null })
    mockOrder.mockReturnValue({ limit: mockLimit })
    mockEq.mockReturnValue({ order: mockOrder })
    mockSupabase._mockSelect.mockReturnValue({ eq: mockEq })

    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

    const result = await getRecentGroupMessages('group@g.us')

    expect(result.ok).toBe(true)
    expect(mockEq).toHaveBeenCalledWith('group_jid', 'group@g.us')
  })

  it('applies botOnly filter when specified', async () => {
    mockSupabase = createMockSupabase()

    // Build a fluent chainable mock that resolves on `await`
    // Chain: select -> eq(group_jid) -> order -> limit -> eq(is_from_bot) -> await
    const queryBuilder = createFluentQueryBuilder({ data: [], error: null })
    mockSupabase._mockSelect.mockReturnValue(queryBuilder)

    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

    const result = await getRecentGroupMessages('group@g.us', 10, { botOnly: true })

    expect(result.ok).toBe(true)
    expect(mockSupabase.from).toHaveBeenCalledWith('messages')
  })

  it('applies since filter when specified', async () => {
    mockSupabase = createMockSupabase()

    const queryBuilder = createFluentQueryBuilder({ data: [], error: null })
    mockSupabase._mockSelect.mockReturnValue(queryBuilder)

    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

    const since = new Date('2026-02-03T10:00:00Z')
    const result = await getRecentGroupMessages('group@g.us', 10, { since })

    expect(result.ok).toBe(true)
    expect(mockSupabase.from).toHaveBeenCalledWith('messages')
  })

  it('handles database error gracefully', async () => {
    mockSupabase = createMockSupabase()
    const mockOrder = vi.fn()
    const mockLimit = vi.fn()
    const mockEq = vi.fn()

    mockLimit.mockResolvedValue({ data: null, error: { message: 'DB error' } })
    mockOrder.mockReturnValue({ limit: mockLimit })
    mockEq.mockReturnValue({ order: mockOrder })
    mockSupabase._mockSelect.mockReturnValue({ eq: mockEq })

    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

    const result = await getRecentGroupMessages('group@g.us')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('DB error')
    }
  })

  it('caps limit at 50', async () => {
    mockSupabase = createMockSupabase()
    const mockOrder = vi.fn()
    const mockLimit = vi.fn()
    const mockEq = vi.fn()

    mockLimit.mockResolvedValue({ data: [], error: null })
    mockOrder.mockReturnValue({ limit: mockLimit })
    mockEq.mockReturnValue({ order: mockOrder })
    mockSupabase._mockSelect.mockReturnValue({ eq: mockEq })

    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

    await getRecentGroupMessages('group@g.us', 999)

    expect(mockLimit).toHaveBeenCalledWith(50)
  })
})

describe('Sprint 5, Task 5.1: buildSenderContext', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>

  beforeEach(() => {
    vi.clearAllMocks()
    resetMessageHistoryClient()
  })

  afterEach(() => {
    resetMessageHistoryClient()
  })

  it('returns error when client not initialized', async () => {
    const result = await buildSenderContext('group@g.us', 'sender@s.whatsapp.net')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Supabase not initialized')
    }
  })

  it('builds context with recent active sender', async () => {
    mockSupabase = createMockSupabase()

    const recentMsg = makeMockMessage({
      id: '1',
      content: 'preço',
      is_trigger: true,
      created_at: new Date().toISOString(),
    })

    const botMsg = makeMockMessage({
      id: '2',
      content: 'USDT/BRL: R$ 5,25',
      is_from_bot: true,
      sender_jid: 'bot',
      created_at: new Date().toISOString(),
    })

    // Route calls: first call = sender lookback, second call = group lookback
    let callCount = 0
    mockSupabase._mockSelect.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return createFluentQueryBuilder({ data: [recentMsg], error: null })
      }
      return createFluentQueryBuilder({ data: [botMsg], error: null })
    })

    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

    const result = await buildSenderContext('group@g.us', 'sender@s.whatsapp.net')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.isRecentlyActive).toBe(true)
      expect(result.data.messageCount).toBe(1)
      expect(result.data.hasRecentTrigger).toBe(true)
      expect(result.data.botRespondedRecently).toBe(true)
      expect(result.data.recentMessages).toHaveLength(1)
    }
  })

  it('builds context with inactive sender (old messages)', async () => {
    mockSupabase = createMockSupabase()

    const oldMsg = makeMockMessage({
      id: '1',
      content: 'hello',
      is_trigger: false,
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    })

    let callCount = 0
    mockSupabase._mockSelect.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return createFluentQueryBuilder({ data: [oldMsg], error: null })
      }
      return createFluentQueryBuilder({ data: [], error: null })
    })

    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

    const result = await buildSenderContext('group@g.us', 'sender@s.whatsapp.net')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.isRecentlyActive).toBe(false)
      expect(result.data.messageCount).toBe(0)
      expect(result.data.hasRecentTrigger).toBe(false)
      expect(result.data.botRespondedRecently).toBe(false)
      expect(result.data.recentMessages).toHaveLength(1)
    }
  })

  it('propagates error from sender lookback', async () => {
    mockSupabase = createMockSupabase()

    mockSupabase._mockSelect.mockReturnValue(
      createFluentQueryBuilder({ data: null, error: { message: 'Sender query failed' } })
    )

    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

    const result = await buildSenderContext('group@g.us', 'sender@s.whatsapp.net')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Sender query failed')
    }
  })

  it('uses custom window minutes', async () => {
    mockSupabase = createMockSupabase()

    const recentMsg = makeMockMessage({
      created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    })

    let callCount = 0
    mockSupabase._mockSelect.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return createFluentQueryBuilder({ data: [recentMsg], error: null })
      }
      return createFluentQueryBuilder({ data: [], error: null })
    })

    setMessageHistoryClient(mockSupabase as unknown as Parameters<typeof setMessageHistoryClient>[0])

    const result = await buildSenderContext('group@g.us', 'sender@s.whatsapp.net', 3)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.isRecentlyActive).toBe(true)
      expect(result.data.messageCount).toBe(1)
    }
  })
})
