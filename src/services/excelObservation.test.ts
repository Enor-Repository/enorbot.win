/**
 * Tests for Excel Observation Service
 * Story 8.3: Create Observation Excel Service
 */

import { describe, it, expect } from 'vitest'
import {
  extractTimePatterns,
  createObservationEntry,
  type ObservationLogEntry,
} from './excelObservation.js'

describe('excelObservation', () => {
  describe('extractTimePatterns', () => {
    describe('AC4: hour_of_day correctly extracted (0-23)', () => {
      it('extracts hour 0 for midnight', () => {
        const date = new Date('2024-01-15T00:30:00')
        const { hourOfDay } = extractTimePatterns(date)
        expect(hourOfDay).toBe(0)
      })

      it('extracts hour 12 for noon', () => {
        const date = new Date('2024-01-15T12:30:00')
        const { hourOfDay } = extractTimePatterns(date)
        expect(hourOfDay).toBe(12)
      })

      it('extracts hour 23 for 11pm', () => {
        const date = new Date('2024-01-15T23:30:00')
        const { hourOfDay } = extractTimePatterns(date)
        expect(hourOfDay).toBe(23)
      })
    })

    describe('AC5: day_of_week correctly extracted (0=Sunday, 6=Saturday)', () => {
      it('extracts 0 for Sunday', () => {
        const date = new Date('2024-01-14T12:00:00') // Sunday
        const { dayOfWeek } = extractTimePatterns(date)
        expect(dayOfWeek).toBe(0)
      })

      it('extracts 1 for Monday', () => {
        const date = new Date('2024-01-15T12:00:00') // Monday
        const { dayOfWeek } = extractTimePatterns(date)
        expect(dayOfWeek).toBe(1)
      })

      it('extracts 6 for Saturday', () => {
        const date = new Date('2024-01-20T12:00:00') // Saturday
        const { dayOfWeek } = extractTimePatterns(date)
        expect(dayOfWeek).toBe(6)
      })
    })
  })

  describe('createObservationEntry', () => {
    it('creates entry with all required fields', () => {
      const entry = createObservationEntry({
        groupId: 'group@g.us',
        groupName: 'Test Group',
        playerJid: 'user@s.whatsapp.net',
        playerName: 'Test User',
        playerRole: 'client',
        messageType: 'price_request',
        triggerPattern: 'preço',
        conversationThread: 'thread-123',
        volumeBrl: 5000,
        volumeUsdt: null,
        content: 'qual o preço?',
        responseRequired: true,
      })

      expect(entry.groupId).toBe('group@g.us')
      expect(entry.groupName).toBe('Test Group')
      expect(entry.playerJid).toBe('user@s.whatsapp.net')
      expect(entry.playerName).toBe('Test User')
      expect(entry.playerRole).toBe('client')
      expect(entry.messageType).toBe('price_request')
      expect(entry.triggerPattern).toBe('preço')
      expect(entry.conversationThread).toBe('thread-123')
      expect(entry.volumeBrl).toBe(5000)
      expect(entry.volumeUsdt).toBeNull()
      expect(entry.contentPreview).toBe('qual o preço?')
      expect(entry.responseRequired).toBe(true)
      expect(entry.responseGiven).toBeNull()
      expect(entry.responseTimeMs).toBeNull()
      expect(entry.aiUsed).toBe(false)
      expect(entry.timestamp).toBeInstanceOf(Date)
      expect(entry.hourOfDay).toBeGreaterThanOrEqual(0)
      expect(entry.hourOfDay).toBeLessThanOrEqual(23)
      expect(entry.dayOfWeek).toBeGreaterThanOrEqual(0)
      expect(entry.dayOfWeek).toBeLessThanOrEqual(6)
    })

    it('truncates long content to max length with ellipsis', () => {
      const longContent = 'a'.repeat(150)
      const entry = createObservationEntry({
        groupId: 'group@g.us',
        groupName: 'Test Group',
        playerJid: 'user@s.whatsapp.net',
        playerName: 'Test User',
        playerRole: 'unknown',
        messageType: 'general',
        triggerPattern: null,
        conversationThread: null,
        volumeBrl: null,
        volumeUsdt: null,
        content: longContent,
        responseRequired: false,
      })

      // Issue fix: Now uses getContentPreview which adds '...' to truncated content
      expect(entry.contentPreview.length).toBe(103) // 100 + '...'
      expect(entry.contentPreview).toBe('a'.repeat(100) + '...')
    })

    it('does not truncate short content', () => {
      const shortContent = 'hello world'
      const entry = createObservationEntry({
        groupId: 'group@g.us',
        groupName: 'Test Group',
        playerJid: 'user@s.whatsapp.net',
        playerName: 'Test User',
        playerRole: 'unknown',
        messageType: 'general',
        triggerPattern: null,
        conversationThread: null,
        volumeBrl: null,
        volumeUsdt: null,
        content: shortContent,
        responseRequired: false,
      })

      expect(entry.contentPreview).toBe(shortContent)
    })

    it('includes optional response fields when provided', () => {
      const entry = createObservationEntry({
        groupId: 'group@g.us',
        groupName: 'Test Group',
        playerJid: 'user@s.whatsapp.net',
        playerName: 'Test User',
        playerRole: 'operator',
        messageType: 'price_response',
        triggerPattern: null,
        conversationThread: 'thread-456',
        volumeBrl: null,
        volumeUsdt: null,
        content: 'USDT/BRL: 5.80',
        responseRequired: false,
        responseGiven: 'USDT/BRL: 5.80',
        responseTimeMs: 1523,
        aiUsed: true,
      })

      expect(entry.responseGiven).toBe('USDT/BRL: 5.80')
      expect(entry.responseTimeMs).toBe(1523)
      expect(entry.aiUsed).toBe(true)
    })

    it('handles null values correctly', () => {
      const entry = createObservationEntry({
        groupId: 'group@g.us',
        groupName: 'Test Group',
        playerJid: 'user@s.whatsapp.net',
        playerName: 'Test User',
        playerRole: 'unknown',
        messageType: 'general',
        triggerPattern: null,
        conversationThread: null,
        volumeBrl: null,
        volumeUsdt: null,
        content: 'hello',
        responseRequired: false,
      })

      expect(entry.triggerPattern).toBeNull()
      expect(entry.conversationThread).toBeNull()
      expect(entry.volumeBrl).toBeNull()
      expect(entry.volumeUsdt).toBeNull()
      expect(entry.responseGiven).toBeNull()
      expect(entry.responseTimeMs).toBeNull()
    })

    it('handles volume USDT', () => {
      const entry = createObservationEntry({
        groupId: 'group@g.us',
        groupName: 'Test Group',
        playerJid: 'user@s.whatsapp.net',
        playerName: 'Test User',
        playerRole: 'client',
        messageType: 'volume_inquiry',
        triggerPattern: 'compro',
        conversationThread: 'thread-789',
        volumeBrl: null,
        volumeUsdt: 862,
        content: 'compro 862 usdt',
        responseRequired: true,
      })

      expect(entry.volumeBrl).toBeNull()
      expect(entry.volumeUsdt).toBe(862)
    })
  })

  describe('ObservationLogEntry type', () => {
    it('allows all valid message types', () => {
      const messageTypes = [
        'price_request',
        'price_response',
        'volume_inquiry',
        'negotiation',
        'confirmation',
        'receipt',
        'tronscan',
        'general',
      ] as const

      for (const messageType of messageTypes) {
        const entry = createObservationEntry({
          groupId: 'group@g.us',
          groupName: 'Test',
          playerJid: 'user@s.whatsapp.net',
          playerName: 'User',
          playerRole: 'unknown',
          messageType,
          triggerPattern: null,
          conversationThread: null,
          volumeBrl: null,
          volumeUsdt: null,
          content: 'test',
          responseRequired: false,
        })
        expect(entry.messageType).toBe(messageType)
      }
    })

    it('allows all valid player roles', () => {
      const playerRoles = ['operator', 'cio', 'client', 'unknown'] as const

      for (const playerRole of playerRoles) {
        const entry = createObservationEntry({
          groupId: 'group@g.us',
          groupName: 'Test',
          playerJid: 'user@s.whatsapp.net',
          playerName: 'User',
          playerRole,
          messageType: 'general',
          triggerPattern: null,
          conversationThread: null,
          volumeBrl: null,
          volumeUsdt: null,
          content: 'test',
          responseRequired: false,
        })
        expect(entry.playerRole).toBe(playerRole)
      }
    })
  })
})
