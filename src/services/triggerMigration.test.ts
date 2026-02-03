/**
 * Tests for Trigger Migration Shadow Mode
 * Sprint 3, Task 3.7
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Hoist mock functions so they're available before module loading
const { mockFindMatchingRule, mockMatchTrigger } = vi.hoisted(() => ({
  mockFindMatchingRule: vi.fn(),
  mockMatchTrigger: vi.fn(),
}))

vi.mock('./rulesService.js', () => ({
  findMatchingRule: mockFindMatchingRule,
}))

vi.mock('./triggerService.js', () => ({
  matchTrigger: mockMatchTrigger,
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}))

import {
  shadowMatch,
  setTriggerMode,
  getTriggerMode,
  initTriggerMode,
  type TriggerMode,
} from './triggerMigration.js'
import { logger } from '../utils/logger.js'

describe('triggerMigration', () => {
  const groupJid = '123456@g.us'
  const message = 'preço'

  const oldRule = {
    id: 'old-1',
    groupJid: '*',
    triggerPhrase: 'preço',
    responseTemplate: '',
    actionType: 'usdt_quote',
    actionParams: {},
    isActive: true,
    priority: 1000,
    conditions: {},
    scope: 'global',
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const newTrigger = {
    id: 'new-1',
    groupJid,
    triggerPhrase: 'preço',
    patternType: 'contains' as const,
    actionType: 'price_quote' as const,
    actionParams: {},
    priority: 1000,
    isActive: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setTriggerMode('shadow')
  })

  // ============================================================
  // Mode management
  // ============================================================

  describe('mode management', () => {
    it('defaults to shadow mode', () => {
      expect(getTriggerMode()).toBe('shadow')
    })

    it('sets and gets mode', () => {
      setTriggerMode('new')
      expect(getTriggerMode()).toBe('new')

      setTriggerMode('off')
      expect(getTriggerMode()).toBe('off')

      setTriggerMode('shadow')
      expect(getTriggerMode()).toBe('shadow')
    })

    it('logs mode change', () => {
      setTriggerMode('new')
      expect(logger.info).toHaveBeenCalledWith(
        'Trigger mode set',
        expect.objectContaining({ mode: 'new' })
      )
    })
  })

  // ============================================================
  // Off mode (old system only)
  // ============================================================

  describe('off mode', () => {
    beforeEach(() => setTriggerMode('off'))

    it('only uses old system', async () => {
      mockFindMatchingRule.mockReturnValue(oldRule)

      const result = await shadowMatch(groupJid, message)

      expect(result.mode).toBe('off')
      expect(result.oldMatch).toBe(oldRule)
      expect(result.newMatch).toBeNull()
      expect(result.parity).toBe(true)
      expect(mockFindMatchingRule).toHaveBeenCalledWith(groupJid, message)
      expect(mockMatchTrigger).not.toHaveBeenCalled()
    })

    it('returns null when old system has no match', async () => {
      mockFindMatchingRule.mockReturnValue(null)

      const result = await shadowMatch(groupJid, message)

      expect(result.oldMatch).toBeNull()
      expect(result.parity).toBe(true)
    })
  })

  // ============================================================
  // New mode (new system only)
  // ============================================================

  describe('new mode', () => {
    beforeEach(() => setTriggerMode('new'))

    it('only uses new system', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: true, data: newTrigger })

      const result = await shadowMatch(groupJid, message)

      expect(result.mode).toBe('new')
      expect(result.oldMatch).toBeNull()
      expect(result.newMatch).toBe(newTrigger)
      expect(result.parity).toBe(true)
      expect(mockMatchTrigger).toHaveBeenCalledWith(message, groupJid)
      expect(mockFindMatchingRule).not.toHaveBeenCalled()
    })

    it('returns null when new system has no match', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: true, data: null })

      const result = await shadowMatch(groupJid, message)

      expect(result.newMatch).toBeNull()
      expect(result.parity).toBe(true)
    })

    it('handles new system errors gracefully', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: false, error: 'DB error' })

      const result = await shadowMatch(groupJid, message)

      expect(result.newMatch).toBeNull()
      expect(result.parity).toBe(true)
    })
  })

  // ============================================================
  // Shadow mode (both systems, compare)
  // ============================================================

  describe('shadow mode', () => {
    it('runs both systems', async () => {
      mockFindMatchingRule.mockReturnValue(oldRule)
      mockMatchTrigger.mockResolvedValue({ ok: true, data: newTrigger })

      const result = await shadowMatch(groupJid, message)

      expect(result.mode).toBe('shadow')
      expect(mockFindMatchingRule).toHaveBeenCalledWith(groupJid, message)
      expect(mockMatchTrigger).toHaveBeenCalledWith(message, groupJid)
    })

    it('reports parity when both match same trigger', async () => {
      mockFindMatchingRule.mockReturnValue(oldRule)
      mockMatchTrigger.mockResolvedValue({ ok: true, data: newTrigger })

      const result = await shadowMatch(groupJid, message)

      expect(result.parity).toBe(true)
      expect(result.parityDetail).toContain('both matched')
      expect(logger.debug).toHaveBeenCalled()
    })

    it('reports parity when neither matches', async () => {
      mockFindMatchingRule.mockReturnValue(null)
      mockMatchTrigger.mockResolvedValue({ ok: true, data: null })

      const result = await shadowMatch(groupJid, message)

      expect(result.parity).toBe(true)
      expect(result.parityDetail).toContain('both returned no match')
    })

    it('detects mismatch: old matches but new does not', async () => {
      mockFindMatchingRule.mockReturnValue(oldRule)
      mockMatchTrigger.mockResolvedValue({ ok: true, data: null })

      const result = await shadowMatch(groupJid, message)

      expect(result.parity).toBe(false)
      expect(result.parityDetail).toContain('OLD matched')
      expect(result.parityDetail).toContain('but NEW did not')
      expect(logger.warn).toHaveBeenCalledWith(
        'Shadow mode parity mismatch',
        expect.objectContaining({ event: 'trigger_shadow_mismatch' })
      )
    })

    it('detects mismatch: new matches but old does not', async () => {
      mockFindMatchingRule.mockReturnValue(null)
      mockMatchTrigger.mockResolvedValue({ ok: true, data: newTrigger })

      const result = await shadowMatch(groupJid, message)

      expect(result.parity).toBe(false)
      expect(result.parityDetail).toContain('NEW matched')
      expect(result.parityDetail).toContain('but OLD did not')
      expect(logger.warn).toHaveBeenCalled()
    })

    it('detects mismatch: both match but different triggers', async () => {
      const differentTrigger = {
        ...newTrigger,
        triggerPhrase: 'cotação',
      }
      mockFindMatchingRule.mockReturnValue(oldRule)
      mockMatchTrigger.mockResolvedValue({ ok: true, data: differentTrigger })

      const result = await shadowMatch(groupJid, message)

      expect(result.parity).toBe(false)
      expect(result.parityDetail).toContain('Both matched but different triggers')
      expect(logger.warn).toHaveBeenCalled()
    })

    it('handles new system error as no-match in shadow mode', async () => {
      mockFindMatchingRule.mockReturnValue(oldRule)
      mockMatchTrigger.mockResolvedValue({ ok: false, error: 'DB error' })

      const result = await shadowMatch(groupJid, message)

      expect(result.newMatch).toBeNull()
      expect(result.parity).toBe(false) // Old matched, new didn't
    })

    it('truncates long messages in log', async () => {
      const longMessage = 'a'.repeat(200)
      mockFindMatchingRule.mockReturnValue(oldRule)
      mockMatchTrigger.mockResolvedValue({ ok: true, data: null })

      await shadowMatch(groupJid, longMessage)

      expect(logger.warn).toHaveBeenCalledWith(
        'Shadow mode parity mismatch',
        expect.objectContaining({
          message: 'a'.repeat(100), // Truncated to 100
        })
      )
    })

    it('recovers from thrown errors in matchTrigger', async () => {
      mockFindMatchingRule.mockReturnValue(oldRule)
      mockMatchTrigger.mockRejectedValue(new Error('DB crash'))

      const result = await shadowMatch(groupJid, message)

      expect(result.newMatch).toBeNull()
      expect(result.newError).toBe('DB crash')
      expect(result.parity).toBe(false)
      expect(logger.error).toHaveBeenCalledWith(
        'New trigger system threw in shadow mode',
        expect.objectContaining({ event: 'trigger_new_system_exception' })
      )
    })

    it('reports newError when matchTrigger returns Result error', async () => {
      mockFindMatchingRule.mockReturnValue(null)
      mockMatchTrigger.mockResolvedValue({ ok: false, error: 'Connection refused' })

      const result = await shadowMatch(groupJid, message)

      expect(result.newMatch).toBeNull()
      expect(result.newError).toBe('Connection refused')
      expect(logger.error).toHaveBeenCalledWith(
        'New trigger system error in shadow mode',
        expect.objectContaining({ error: 'Connection refused' })
      )
    })
  })

  // ============================================================
  // New mode error handling
  // ============================================================

  describe('new mode error handling', () => {
    beforeEach(() => setTriggerMode('new'))

    it('recovers from thrown errors in new mode', async () => {
      mockMatchTrigger.mockRejectedValue(new Error('Unexpected failure'))

      const result = await shadowMatch(groupJid, message)

      expect(result.newMatch).toBeNull()
      expect(result.newError).toBe('Unexpected failure')
      expect(logger.error).toHaveBeenCalled()
    })
  })

  // ============================================================
  // initTriggerMode from env
  // ============================================================

  describe('initTriggerMode', () => {
    const originalEnv = process.env.TRIGGER_SHADOW_MODE

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.TRIGGER_SHADOW_MODE = originalEnv
      } else {
        delete process.env.TRIGGER_SHADOW_MODE
      }
      setTriggerMode('shadow')
    })

    it('reads TRIGGER_SHADOW_MODE=new from env', () => {
      process.env.TRIGGER_SHADOW_MODE = 'new'
      initTriggerMode()
      expect(getTriggerMode()).toBe('new')
    })

    it('reads TRIGGER_SHADOW_MODE=off from env', () => {
      process.env.TRIGGER_SHADOW_MODE = 'off'
      initTriggerMode()
      expect(getTriggerMode()).toBe('off')
    })

    it('ignores invalid TRIGGER_SHADOW_MODE values', () => {
      process.env.TRIGGER_SHADOW_MODE = 'invalid'
      setTriggerMode('shadow')
      initTriggerMode()
      expect(getTriggerMode()).toBe('shadow')
    })

    it('keeps default when env var is not set', () => {
      delete process.env.TRIGGER_SHADOW_MODE
      setTriggerMode('shadow')
      initTriggerMode()
      expect(getTriggerMode()).toBe('shadow')
    })
  })
})
