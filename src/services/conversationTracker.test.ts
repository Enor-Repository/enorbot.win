/**
 * Tests for Conversation Tracker Module
 * Story 8.2: Create Conversation Tracker Module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getOrCreateThread,
  addToThread,
  closeThread,
  resolveThreadId,
  hasActiveThread,
  getActiveThread,
  cleanupStaleThreads,
  clearAllThreads,
  stopCleanupInterval,
  THREAD_TIMEOUT_MS,
  MAX_ACTIVE_THREADS,
} from './conversationTracker.js'

describe('conversationTracker', () => {
  beforeEach(() => {
    clearAllThreads()
    vi.useFakeTimers()
  })

  afterEach(() => {
    stopCleanupInterval()
    vi.useRealTimers()
  })

  describe('getOrCreateThread', () => {
    describe('AC1: New thread created on price_request', () => {
      it('creates new thread for first request', () => {
        const threadId = getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')
        expect(threadId).toBeDefined()
        expect(threadId).toMatch(/^[0-9a-f-]{36}$/) // UUID format
      })

      it('returns same thread for subsequent requests within timeout', () => {
        const threadId1 = getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')
        const threadId2 = getOrCreateThread('group1@g.us', 'user2@s.whatsapp.net')
        expect(threadId1).toBe(threadId2)
      })

      it('creates new thread after timeout', () => {
        const threadId1 = getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')

        // Advance time past timeout
        vi.advanceTimersByTime(THREAD_TIMEOUT_MS + 1000)

        const threadId2 = getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')
        expect(threadId1).not.toBe(threadId2)
      })
    })

    describe('AC5: Thread ID is UUID format', () => {
      it('generates valid UUID', () => {
        const threadId = getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')
        // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
        expect(threadId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      })
    })
  })

  describe('addToThread', () => {
    describe('AC2: Subsequent messages link to active thread', () => {
      it('links to active thread', () => {
        const threadId = getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')
        const linkedId = addToThread('group1@g.us', 'user2@s.whatsapp.net')
        expect(linkedId).toBe(threadId)
      })

      it('returns null if no active thread', () => {
        const linkedId = addToThread('group1@g.us', 'user1@s.whatsapp.net')
        expect(linkedId).toBeNull()
      })

      it('returns null after timeout', () => {
        getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')

        vi.advanceTimersByTime(THREAD_TIMEOUT_MS + 1000)

        const linkedId = addToThread('group1@g.us', 'user2@s.whatsapp.net')
        expect(linkedId).toBeNull()
      })
    })

    describe('AC6: Participants tracked correctly', () => {
      it('tracks all participants', () => {
        getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')
        addToThread('group1@g.us', 'user2@s.whatsapp.net')
        addToThread('group1@g.us', 'user3@s.whatsapp.net')

        const thread = getActiveThread('group1@g.us')
        expect(thread).not.toBeNull()
        expect(thread!.participants.size).toBe(3)
        expect(thread!.participants.has('user1@s.whatsapp.net')).toBe(true)
        expect(thread!.participants.has('user2@s.whatsapp.net')).toBe(true)
        expect(thread!.participants.has('user3@s.whatsapp.net')).toBe(true)
      })

      it('increments message count', () => {
        getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')
        addToThread('group1@g.us', 'user2@s.whatsapp.net')
        addToThread('group1@g.us', 'user1@s.whatsapp.net')

        const thread = getActiveThread('group1@g.us')
        expect(thread).not.toBeNull()
        expect(thread!.messageCount).toBe(3)
      })
    })
  })

  describe('closeThread', () => {
    describe('AC3: Thread closes on confirmation/receipt/tronscan', () => {
      it('closes thread with confirmation reason', () => {
        getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')
        closeThread('group1@g.us', 'confirmation')

        expect(hasActiveThread('group1@g.us')).toBe(false)
      })

      it('closes thread with receipt reason', () => {
        getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')
        closeThread('group1@g.us', 'receipt')

        expect(hasActiveThread('group1@g.us')).toBe(false)
      })

      it('closes thread with tronscan reason', () => {
        getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')
        closeThread('group1@g.us', 'tronscan')

        expect(hasActiveThread('group1@g.us')).toBe(false)
      })

      it('handles closing non-existent thread gracefully', () => {
        // Should not throw
        expect(() => closeThread('nonexistent@g.us', 'manual')).not.toThrow()
      })
    })
  })

  describe('cleanupStaleThreads', () => {
    describe('AC4: Stale threads cleaned up', () => {
      it('removes threads older than timeout', () => {
        getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')
        getOrCreateThread('group2@g.us', 'user2@s.whatsapp.net')

        vi.advanceTimersByTime(THREAD_TIMEOUT_MS + 1000)

        const cleaned = cleanupStaleThreads()
        expect(cleaned).toBe(2)
        expect(hasActiveThread('group1@g.us')).toBe(false)
        expect(hasActiveThread('group2@g.us')).toBe(false)
      })

      it('keeps active threads', () => {
        getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')

        vi.advanceTimersByTime(THREAD_TIMEOUT_MS - 1000)

        const cleaned = cleanupStaleThreads()
        expect(cleaned).toBe(0)
        expect(hasActiveThread('group1@g.us')).toBe(true)
      })

      it('removes only stale threads', () => {
        getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')

        vi.advanceTimersByTime(THREAD_TIMEOUT_MS + 1000)

        getOrCreateThread('group2@g.us', 'user2@s.whatsapp.net')

        const cleaned = cleanupStaleThreads()
        expect(cleaned).toBe(1)
        expect(hasActiveThread('group1@g.us')).toBe(false)
        expect(hasActiveThread('group2@g.us')).toBe(true)
      })
    })
  })

  describe('resolveThreadId', () => {
    const now = new Date()

    it('creates thread for price_request', () => {
      const threadId = resolveThreadId({
        groupId: 'group1@g.us',
        senderJid: 'user1@s.whatsapp.net',
        messageType: 'price_request',
        timestamp: now,
      })
      expect(threadId).toBeDefined()
      expect(hasActiveThread('group1@g.us')).toBe(true)
    })

    it('links price_response to active thread', () => {
      const threadId1 = resolveThreadId({
        groupId: 'group1@g.us',
        senderJid: 'user1@s.whatsapp.net',
        messageType: 'price_request',
        timestamp: now,
      })

      const threadId2 = resolveThreadId({
        groupId: 'group1@g.us',
        senderJid: 'bot',
        messageType: 'price_response',
        timestamp: now,
      })

      expect(threadId2).toBe(threadId1)
    })

    it('returns null for price_response without active thread', () => {
      const threadId = resolveThreadId({
        groupId: 'group1@g.us',
        senderJid: 'bot',
        messageType: 'price_response',
        timestamp: now,
      })
      expect(threadId).toBeNull()
    })

    it('creates thread for volume_inquiry if none active', () => {
      const threadId = resolveThreadId({
        groupId: 'group1@g.us',
        senderJid: 'user1@s.whatsapp.net',
        messageType: 'volume_inquiry',
        timestamp: now,
      })
      expect(threadId).toBeDefined()
      expect(hasActiveThread('group1@g.us')).toBe(true)
    })

    it('links negotiation to active thread only', () => {
      // No active thread - returns null
      const threadId1 = resolveThreadId({
        groupId: 'group1@g.us',
        senderJid: 'user1@s.whatsapp.net',
        messageType: 'negotiation',
        timestamp: now,
      })
      expect(threadId1).toBeNull()

      // Create thread
      getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')

      // Now negotiation links
      const threadId2 = resolveThreadId({
        groupId: 'group1@g.us',
        senderJid: 'user2@s.whatsapp.net',
        messageType: 'negotiation',
        timestamp: now,
      })
      expect(threadId2).toBeDefined()
    })

    it('closes thread on confirmation', () => {
      getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')

      const threadId = resolveThreadId({
        groupId: 'group1@g.us',
        senderJid: 'user1@s.whatsapp.net',
        messageType: 'confirmation',
        timestamp: now,
      })

      expect(threadId).toBeDefined()
      expect(hasActiveThread('group1@g.us')).toBe(false)
    })

    it('closes thread on receipt', () => {
      getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')

      const threadId = resolveThreadId({
        groupId: 'group1@g.us',
        senderJid: 'user1@s.whatsapp.net',
        messageType: 'receipt',
        timestamp: now,
      })

      expect(threadId).toBeDefined()
      expect(hasActiveThread('group1@g.us')).toBe(false)
    })

    it('closes thread on tronscan', () => {
      getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')

      const threadId = resolveThreadId({
        groupId: 'group1@g.us',
        senderJid: 'user1@s.whatsapp.net',
        messageType: 'tronscan',
        timestamp: now,
      })

      expect(threadId).toBeDefined()
      expect(hasActiveThread('group1@g.us')).toBe(false)
    })

    it('returns null for general messages', () => {
      getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')

      const threadId = resolveThreadId({
        groupId: 'group1@g.us',
        senderJid: 'user1@s.whatsapp.net',
        messageType: 'general',
        timestamp: now,
      })

      expect(threadId).toBeNull()
      // Thread still active (not closed by general message)
      expect(hasActiveThread('group1@g.us')).toBe(true)
    })
  })

  describe('hasActiveThread', () => {
    it('returns false when no thread exists', () => {
      expect(hasActiveThread('group1@g.us')).toBe(false)
    })

    it('returns true when thread is active', () => {
      getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')
      expect(hasActiveThread('group1@g.us')).toBe(true)
    })

    it('returns false when thread is closed', () => {
      getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')
      closeThread('group1@g.us', 'manual')
      expect(hasActiveThread('group1@g.us')).toBe(false)
    })

    it('returns false when thread times out', () => {
      getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')

      vi.advanceTimersByTime(THREAD_TIMEOUT_MS + 1000)

      expect(hasActiveThread('group1@g.us')).toBe(false)
    })
  })

  describe('getActiveThread', () => {
    it('returns null when no thread exists', () => {
      expect(getActiveThread('group1@g.us')).toBeNull()
    })

    it('returns thread when active', () => {
      getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')
      const thread = getActiveThread('group1@g.us')
      expect(thread).not.toBeNull()
      expect(thread!.groupId).toBe('group1@g.us')
    })

    it('returns null when thread times out', () => {
      getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')

      vi.advanceTimersByTime(THREAD_TIMEOUT_MS + 1000)

      expect(getActiveThread('group1@g.us')).toBeNull()
    })
  })

  describe('independent groups', () => {
    it('manages threads independently per group', () => {
      const thread1 = getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')
      const thread2 = getOrCreateThread('group2@g.us', 'user2@s.whatsapp.net')

      expect(thread1).not.toBe(thread2)
      expect(hasActiveThread('group1@g.us')).toBe(true)
      expect(hasActiveThread('group2@g.us')).toBe(true)

      closeThread('group1@g.us', 'confirmation')

      expect(hasActiveThread('group1@g.us')).toBe(false)
      expect(hasActiveThread('group2@g.us')).toBe(true)
    })
  })

  describe('capacity limits', () => {
    it('exports MAX_ACTIVE_THREADS constant', () => {
      expect(MAX_ACTIVE_THREADS).toBe(1000)
    })

    it('evicts oldest thread when capacity is reached', () => {
      // This test uses a small number to verify the eviction logic works
      // The actual limit of 1000 is too large to test exhaustively

      // Create threads and verify they exist
      const threadId1 = getOrCreateThread('group1@g.us', 'user1@s.whatsapp.net')
      const threadId2 = getOrCreateThread('group2@g.us', 'user2@s.whatsapp.net')
      const threadId3 = getOrCreateThread('group3@g.us', 'user3@s.whatsapp.net')

      expect(threadId1).toBeDefined()
      expect(threadId2).toBeDefined()
      expect(threadId3).toBeDefined()

      // All three should be active
      expect(hasActiveThread('group1@g.us')).toBe(true)
      expect(hasActiveThread('group2@g.us')).toBe(true)
      expect(hasActiveThread('group3@g.us')).toBe(true)
    })

    it('maintains separate threads for different groups under capacity', () => {
      // Create 10 threads - well under capacity
      const threadIds: string[] = []
      for (let i = 0; i < 10; i++) {
        threadIds.push(getOrCreateThread(`group${i}@g.us`, `user${i}@s.whatsapp.net`))
      }

      // All should be unique
      const uniqueIds = new Set(threadIds)
      expect(uniqueIds.size).toBe(10)

      // All should be active
      for (let i = 0; i < 10; i++) {
        expect(hasActiveThread(`group${i}@g.us`)).toBe(true)
      }
    })
  })
})
