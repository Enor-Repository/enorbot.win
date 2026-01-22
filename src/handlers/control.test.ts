/**
 * Tests for Control Handler - Epic 4
 *
 * Test coverage:
 * - Story 4.1: Pause command parsing and execution
 * - Story 4.2: Resume command parsing and execution
 * - Fuzzy group matching
 * - Integration with state management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { WASocket } from '@whiskeysockets/baileys'

// Mock dependencies using vi.hoisted
const mockSendWithAntiDetection = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))
const mockCancelAutoRecovery = vi.hoisted(() => vi.fn())
const mockIsRecoveryPending = vi.hoisted(() => vi.fn().mockReturnValue(false))
const mockGetRecoveryTimeRemaining = vi.hoisted(() => vi.fn().mockReturnValue(null))
const mockGetPendingRecoveryReason = vi.hoisted(() => vi.fn().mockReturnValue(null))
const mockGetQueueLength = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, data: 0 }))

vi.mock('../utils/messaging.js', () => ({
  sendWithAntiDetection: mockSendWithAntiDetection,
}))

vi.mock('../utils/logger.js', () => ({
  logger: mockLogger,
}))

vi.mock('../services/autoRecovery.js', () => ({
  cancelAutoRecovery: mockCancelAutoRecovery,
  isRecoveryPending: mockIsRecoveryPending,
  getRecoveryTimeRemaining: mockGetRecoveryTimeRemaining,
  getPendingRecoveryReason: mockGetPendingRecoveryReason,
}))

vi.mock('../services/logQueue.js', () => ({
  getQueueLength: mockGetQueueLength,
}))

import {
  parseControlCommand,
  findMatchingGroup,
  registerKnownGroup,
  getKnownGroups,
  clearKnownGroups,
  handleControlMessage,
  buildStatusMessage,
  type ControlCommand,
} from './control.js'
import type { RouterContext } from '../bot/router.js'
import {
  resetPauseState,
  pauseGroup,
  isGroupPaused,
  isGlobalPauseActive,
  getPausedGroups,
  setPaused,
  setRunning,
  getOperationalStatus,
  resetActivityState,
  setConnectionStatus,
  recordMessageSent,
} from '../bot/state.js'

describe('Control Handler - Epic 4', () => {
  // Mock socket
  const mockSock = {} as WASocket

  // Base context for tests
  const baseContext: RouterContext = {
    groupId: 'control-group@g.us',
    groupName: 'CONTROLE eNor',
    message: '',
    sender: 'daniel@s.whatsapp.net',
    isControlGroup: true,
    sock: mockSock,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetPauseState()
    resetActivityState()
    clearKnownGroups()
    setRunning()
    setConnectionStatus('connected')
    mockSendWithAntiDetection.mockResolvedValue({ ok: true, data: undefined })
  })

  // ==========================================================================
  // Command Parsing Tests
  // ==========================================================================
  describe('parseControlCommand', () => {
    describe('pause command', () => {
      it('parses "pause" as global pause', () => {
        const result = parseControlCommand('pause')
        expect(result.type).toBe('pause')
        expect(result.args).toEqual([])
      })

      it('parses "PAUSE" (case insensitive)', () => {
        const result = parseControlCommand('PAUSE')
        expect(result.type).toBe('pause')
        expect(result.args).toEqual([])
      })

      it('parses "pause binance" with group name', () => {
        const result = parseControlCommand('pause binance')
        expect(result.type).toBe('pause')
        expect(result.args).toEqual(['binance'])
      })

      it('parses "pause Binance VIP" with multi-word group name', () => {
        const result = parseControlCommand('pause Binance VIP')
        expect(result.type).toBe('pause')
        expect(result.args).toEqual(['binance vip'])
      })

      it('handles extra whitespace', () => {
        const result = parseControlCommand('  pause   binance  ')
        expect(result.type).toBe('pause')
        expect(result.args).toEqual(['binance'])
      })
    })

    describe('resume command', () => {
      it('parses "resume" as global resume', () => {
        const result = parseControlCommand('resume')
        expect(result.type).toBe('resume')
        expect(result.args).toEqual([])
      })

      it('parses "RESUME" (case insensitive)', () => {
        const result = parseControlCommand('RESUME')
        expect(result.type).toBe('resume')
        expect(result.args).toEqual([])
      })

      it('parses "resume binance" with group name', () => {
        const result = parseControlCommand('resume binance')
        expect(result.type).toBe('resume')
        expect(result.args).toEqual(['binance'])
      })
    })

    describe('status command', () => {
      it('parses "status"', () => {
        const result = parseControlCommand('status')
        expect(result.type).toBe('status')
        expect(result.args).toEqual([])
      })

      it('parses "STATUS" (case insensitive)', () => {
        const result = parseControlCommand('STATUS')
        expect(result.type).toBe('status')
        expect(result.args).toEqual([])
      })
    })

    describe('unknown commands', () => {
      it('returns unknown for unrecognized commands', () => {
        const result = parseControlCommand('hello world')
        expect(result.type).toBe('unknown')
      })

      it('returns unknown for empty string', () => {
        const result = parseControlCommand('')
        expect(result.type).toBe('unknown')
      })

      it('returns unknown for partial commands', () => {
        const result = parseControlCommand('pau')
        expect(result.type).toBe('unknown')
      })
    })
  })

  // ==========================================================================
  // Fuzzy Group Matching Tests
  // ==========================================================================
  describe('Fuzzy Group Matching', () => {
    beforeEach(() => {
      registerKnownGroup('group1@g.us', 'Binance VIP Trading')
      registerKnownGroup('group2@g.us', 'Crypto OTC Brasil')
      registerKnownGroup('group3@g.us', 'Private Deals')
    })

    describe('registerKnownGroup', () => {
      it('adds group to known groups', () => {
        registerKnownGroup('new@g.us', 'New Group')
        expect(getKnownGroups().get('new@g.us')).toBe('New Group')
      })

      it('updates existing group name', () => {
        registerKnownGroup('group1@g.us', 'Updated Name')
        expect(getKnownGroups().get('group1@g.us')).toBe('Updated Name')
      })
    })

    describe('findMatchingGroup', () => {
      it('finds group by partial name (case insensitive)', () => {
        const result = findMatchingGroup('binance')
        expect(result.found).toBe(true)
        expect(result.groupId).toBe('group1@g.us')
        expect(result.groupName).toBe('Binance VIP Trading')
      })

      it('finds group with uppercase search', () => {
        const result = findMatchingGroup('BINANCE')
        expect(result.found).toBe(true)
        expect(result.groupId).toBe('group1@g.us')
      })

      it('finds group with partial match', () => {
        const result = findMatchingGroup('vip')
        expect(result.found).toBe(true)
        expect(result.groupId).toBe('group1@g.us')
      })

      it('returns not found for no match', () => {
        const result = findMatchingGroup('nonexistent')
        expect(result.found).toBe(false)
        expect(result.groupId).toBeNull()
        expect(result.groupName).toBeNull()
      })

      it('returns first matching group when multiple match', () => {
        // "crypto" matches "Crypto OTC Brasil", "private" matches "Private Deals"
        const result = findMatchingGroup('crypto')
        expect(result.found).toBe(true)
        expect(result.groupId).toBe('group2@g.us')
      })

      it('returns not found for empty string search', () => {
        const result = findMatchingGroup('')
        expect(result.found).toBe(false)
        expect(result.groupId).toBeNull()
      })

      it('returns not found for whitespace-only search', () => {
        const result = findMatchingGroup('   ')
        expect(result.found).toBe(false)
        expect(result.groupId).toBeNull()
      })
    })
  })

  // ==========================================================================
  // Story 4.1: Pause Command Tests
  // ==========================================================================
  describe('Story 4.1: Pause Command', () => {
    beforeEach(() => {
      registerKnownGroup('binance@g.us', 'Binance VIP Trading')
      registerKnownGroup('otc@g.us', 'Crypto OTC Brasil')
    })

    describe('AC1: Basic pause command', () => {
      it('pauses specific group and sends confirmation', async () => {
        const context = { ...baseContext, message: 'pause binance' }

        await handleControlMessage(context)

        expect(isGroupPaused('binance@g.us')).toBe(true)
        expect(mockSendWithAntiDetection).toHaveBeenCalledWith(
          mockSock,
          'control-group@g.us',
          '⏸️ Paused for Binance VIP Trading'
        )
      })

      it('logs pause event with structured logging', async () => {
        const context = { ...baseContext, message: 'pause binance' }

        await handleControlMessage(context)

        expect(mockLogger.info).toHaveBeenCalledWith(
          'Group paused',
          expect.objectContaining({
            event: 'group_paused',
            groupId: 'binance@g.us',
            groupName: 'Binance VIP Trading',
          })
        )
      })
    })

    describe('AC2: Paused group behavior (verified in price handler)', () => {
      it('isGroupPaused returns true for paused group', async () => {
        const context = { ...baseContext, message: 'pause binance' }

        await handleControlMessage(context)

        expect(isGroupPaused('binance@g.us')).toBe(true)
        expect(isGroupPaused('otc@g.us')).toBe(false)
      })
    })

    describe('AC3: Global pause', () => {
      it('pauses all groups and sends confirmation', async () => {
        const context = { ...baseContext, message: 'pause' }

        await handleControlMessage(context)

        expect(isGlobalPauseActive()).toBe(true)
        expect(mockSendWithAntiDetection).toHaveBeenCalledWith(
          mockSock,
          'control-group@g.us',
          '⏸️ All groups paused'
        )
      })

      it('isGroupPaused returns true for any group when global pause active', async () => {
        const context = { ...baseContext, message: 'pause' }

        await handleControlMessage(context)

        expect(isGroupPaused('any-group@g.us')).toBe(true)
        expect(isGroupPaused('another@g.us')).toBe(true)
      })
    })

    describe('AC4: Fuzzy group matching', () => {
      it('matches partial group name (case insensitive)', async () => {
        const context = { ...baseContext, message: 'pause vip' }

        await handleControlMessage(context)

        expect(isGroupPaused('binance@g.us')).toBe(true)
      })

      it('sends error message when no group matches', async () => {
        const context = { ...baseContext, message: 'pause nonexistent' }

        await handleControlMessage(context)

        expect(mockSendWithAntiDetection).toHaveBeenCalledWith(
          mockSock,
          'control-group@g.us',
          '⚠️ No group matching "nonexistent" found'
        )
      })
    })
  })

  // ==========================================================================
  // Story 4.2: Resume Command Tests
  // ==========================================================================
  describe('Story 4.2: Resume Command', () => {
    beforeEach(() => {
      registerKnownGroup('binance@g.us', 'Binance VIP Trading')
      registerKnownGroup('otc@g.us', 'Crypto OTC Brasil')
    })

    describe('AC1: Basic resume command', () => {
      it('resumes specific group and sends confirmation', async () => {
        // First pause the group
        pauseGroup('binance@g.us')
        expect(isGroupPaused('binance@g.us')).toBe(true)

        // Then resume
        const context = { ...baseContext, message: 'resume binance' }
        await handleControlMessage(context)

        expect(isGroupPaused('binance@g.us')).toBe(false)
        expect(mockSendWithAntiDetection).toHaveBeenCalledWith(
          mockSock,
          'control-group@g.us',
          '▶️ Resumed for Binance VIP Trading'
        )
      })

      it('sends message when group was not paused', async () => {
        const context = { ...baseContext, message: 'resume binance' }

        await handleControlMessage(context)

        expect(mockSendWithAntiDetection).toHaveBeenCalledWith(
          mockSock,
          'control-group@g.us',
          'ℹ️ "Binance VIP Trading" was not paused'
        )
      })
    })

    describe('AC3: Global resume', () => {
      it('resumes all groups and sends confirmation', async () => {
        // First pause some groups
        pauseGroup('binance@g.us')
        pauseGroup('otc@g.us')

        const context = { ...baseContext, message: 'resume' }
        await handleControlMessage(context)

        expect(getPausedGroups().size).toBe(0)
        expect(mockSendWithAntiDetection).toHaveBeenCalledWith(
          mockSock,
          'control-group@g.us',
          '▶️ All groups resumed'
        )
      })
    })

    describe('AC4: Resume clears error state', () => {
      it('clears error state on global resume', async () => {
        // Set error state (auto-pause scenario)
        setPaused('Binance API failures')
        expect(getOperationalStatus()).toBe('paused')

        const context = { ...baseContext, message: 'resume' }
        await handleControlMessage(context)

        expect(getOperationalStatus()).toBe('running')
        expect(mockSendWithAntiDetection).toHaveBeenCalledWith(
          mockSock,
          'control-group@g.us',
          '▶️ Resumed. Error state cleared.'
        )
      })
    })

    describe('CRITICAL: cancelAutoRecovery on resume', () => {
      it('calls cancelAutoRecovery on any resume command', async () => {
        const context = { ...baseContext, message: 'resume' }

        await handleControlMessage(context)

        expect(mockCancelAutoRecovery).toHaveBeenCalled()
      })

      it('calls cancelAutoRecovery on specific group resume', async () => {
        pauseGroup('binance@g.us')
        const context = { ...baseContext, message: 'resume binance' }

        await handleControlMessage(context)

        expect(mockCancelAutoRecovery).toHaveBeenCalled()
      })

      it('calls cancelAutoRecovery even when group not found', async () => {
        const context = { ...baseContext, message: 'resume nonexistent' }

        await handleControlMessage(context)

        expect(mockCancelAutoRecovery).toHaveBeenCalled()
      })
    })
  })

  // ==========================================================================
  // Story 4.2: End-to-End Pause → Resume → Trigger Flow
  // ==========================================================================
  describe('Story 4.2 AC2: Resumed group behavior', () => {
    beforeEach(() => {
      registerKnownGroup('binance@g.us', 'Binance VIP Trading')
    })

    it('isGroupPaused returns false after resume (e2e flow)', async () => {
      // 1. Pause the group
      const pauseContext = { ...baseContext, message: 'pause binance' }
      await handleControlMessage(pauseContext)
      expect(isGroupPaused('binance@g.us')).toBe(true)

      // 2. Resume the group
      const resumeContext = { ...baseContext, message: 'resume binance' }
      await handleControlMessage(resumeContext)
      expect(isGroupPaused('binance@g.us')).toBe(false)

      // 3. Verify group is no longer paused (price handler would process)
      // This confirms the group can receive price triggers again
      expect(isGroupPaused('binance@g.us')).toBe(false)
    })

    it('global pause → global resume clears all groups', async () => {
      // 1. Global pause
      const pauseContext = { ...baseContext, message: 'pause' }
      await handleControlMessage(pauseContext)
      expect(isGlobalPauseActive()).toBe(true)
      expect(isGroupPaused('any-group@g.us')).toBe(true)

      // 2. Global resume
      const resumeContext = { ...baseContext, message: 'resume' }
      await handleControlMessage(resumeContext)
      expect(isGlobalPauseActive()).toBe(false)
      expect(isGroupPaused('any-group@g.us')).toBe(false)
    })
  })

  // ==========================================================================
  // Logging Tests
  // ==========================================================================
  describe('Logging', () => {
    it('logs control command received', async () => {
      const context = { ...baseContext, message: 'pause' }

      await handleControlMessage(context)

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Control command received',
        expect.objectContaining({
          event: 'control_command_received',
          commandType: 'pause',
        })
      )
    })

    it('logs unknown command at debug level', async () => {
      const context = { ...baseContext, message: 'hello world' }

      await handleControlMessage(context)

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Unknown control command',
        expect.objectContaining({
          event: 'control_unknown_command',
        })
      )
    })
  })

  // ==========================================================================
  // Story 4.3: Status Command Tests
  // ==========================================================================
  describe('Story 4.3: Status Command', () => {
    describe('buildStatusMessage', () => {
      it('includes connection status', async () => {
        setConnectionStatus('connected')
        const message = await buildStatusMessage()

        expect(message).toContain('🟢 Connected')
        expect(message).toContain('📊 eNorBOT Status')
      })

      it('shows disconnected status', async () => {
        setConnectionStatus('disconnected')
        const message = await buildStatusMessage()

        expect(message).toContain('🔴 Disconnected')
      })

      it('includes uptime', async () => {
        const message = await buildStatusMessage()
        expect(message).toContain('Uptime:')
      })

      it('shows "All systems normal" when no issues', async () => {
        const message = await buildStatusMessage()
        expect(message).toContain('✅ All systems normal')
      })

      it('shows paused status when error-paused', async () => {
        setPaused('Binance API failures')
        const message = await buildStatusMessage()

        expect(message).toContain('⏸️ PAUSED: Binance API failures')
      })

      it('shows activity stats', async () => {
        recordMessageSent('group1@g.us')
        recordMessageSent('group2@g.us')
        const message = await buildStatusMessage()

        expect(message).toContain("📈 Today's Activity")
        expect(message).toContain('2 quotes sent')
      })

      it('shows groups monitored count', async () => {
        registerKnownGroup('group1@g.us', 'Group 1')
        registerKnownGroup('group2@g.us', 'Group 2')
        const message = await buildStatusMessage()

        expect(message).toContain('2 groups monitored')
      })

      it('shows last activity time', async () => {
        const message = await buildStatusMessage()
        // No activity yet
        expect(message).toContain('Last activity: Never')
      })

      it('shows paused groups when some are paused', async () => {
        registerKnownGroup('binance@g.us', 'Binance VIP')
        pauseGroup('binance@g.us')
        const message = await buildStatusMessage()

        expect(message).toContain('📂 Groups')
        expect(message).toContain('Binance VIP - ⏸️ Paused')
      })

      it('shows pending logs when queue has entries', async () => {
        mockGetQueueLength.mockResolvedValueOnce({ ok: true, data: 5 })
        const message = await buildStatusMessage()

        expect(message).toContain('5 logs pending sync')
      })

      it('does not show pending logs when queue is empty', async () => {
        mockGetQueueLength.mockResolvedValueOnce({ ok: true, data: 0 })
        const message = await buildStatusMessage()

        expect(message).not.toContain('logs pending sync')
      })
    })

    describe('handleControlMessage with status', () => {
      it('sends status message', async () => {
        const context = { ...baseContext, message: 'status' }

        await handleControlMessage(context)

        expect(mockSendWithAntiDetection).toHaveBeenCalledWith(
          mockSock,
          'control-group@g.us',
          expect.stringContaining('📊 eNorBOT Status')
        )
      })

      it('logs status command processed', async () => {
        const context = { ...baseContext, message: 'status' }

        await handleControlMessage(context)

        expect(mockLogger.info).toHaveBeenCalledWith(
          'Status command processed',
          expect.objectContaining({
            event: 'status_command_processed',
          })
        )
      })
    })
  })
})
