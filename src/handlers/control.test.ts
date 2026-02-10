/**
 * Tests for Control Handler - Epic 4 + Group Modes
 *
 * Test coverage:
 * - Story 4.1: Pause command parsing and execution
 * - Story 4.2: Resume command parsing and execution
 * - Story 4.3: Status command
 * - Group Modes: mode, modes, config commands
 * - Backward compatibility: training commands
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
const mockLogBotMessage = vi.hoisted(() => vi.fn())

// Mock dealFlowService
const mockGetActiveDeals = vi.hoisted(() => vi.fn())
const mockCancelDeal = vi.hoisted(() => vi.fn())
const mockArchiveDeal = vi.hoisted(() => vi.fn())

// Mock activeQuotes
const mockCancelQuote = vi.hoisted(() => vi.fn())

// Mock groupConfig service
const mockSetGroupMode = vi.hoisted(() => vi.fn())
const mockGetAllGroupConfigs = vi.hoisted(() => vi.fn())
const mockGetGroupModeStats = vi.hoisted(() => vi.fn())
const mockFindGroupByName = vi.hoisted(() => vi.fn())
const mockGetGroupsByMode = vi.hoisted(() => vi.fn())
const mockResolveOperatorJid = vi.hoisted(() => vi.fn())
const mockGetGroupModeSync = vi.hoisted(() => vi.fn())
const mockFormatMention = vi.hoisted(() => vi.fn())

vi.mock('../utils/messaging.js', () => ({
  sendWithAntiDetection: mockSendWithAntiDetection,
  formatMention: mockFormatMention,
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

vi.mock('../services/messageHistory.js', () => ({
  logBotMessage: mockLogBotMessage,
}))

vi.mock('../services/groupConfig.js', () => ({
  setGroupMode: mockSetGroupMode,
  getAllGroupConfigs: mockGetAllGroupConfigs,
  getGroupModeStats: mockGetGroupModeStats,
  findGroupByName: mockFindGroupByName,
  getGroupsByMode: mockGetGroupsByMode,
  resolveOperatorJid: mockResolveOperatorJid,
  getGroupModeSync: mockGetGroupModeSync,
}))

vi.mock('../services/dealFlowService.js', () => ({
  getActiveDeals: mockGetActiveDeals,
  cancelDeal: mockCancelDeal,
  archiveDeal: mockArchiveDeal,
}))

vi.mock('../services/activeQuotes.js', () => ({
  cancelQuote: mockCancelQuote,
}))

import {
  parseControlCommand,
  findMatchingGroup,
  registerKnownGroup,
  getKnownGroups,
  clearKnownGroups,
  handleControlMessage,
  buildStatusMessage,
} from './control.js'
import type { RouterContext } from '../bot/router.js'
import {
  setRunning,
  setPaused,
  getOperationalStatus,
  resetActivityState,
  setConnectionStatus,
  recordMessageSent,
} from '../bot/state.js'

// Mock group configs for testing
const mockGroupConfigs = new Map([
  ['binance@g.us', {
    groupJid: 'binance@g.us',
    groupName: 'Binance VIP Trading',
    mode: 'learning' as const,
    triggerPatterns: [],
    responseTemplates: {},
    playerRoles: {},
    aiThreshold: 50,
    learningStartedAt: new Date('2025-01-01'),
    activatedAt: null,
    updatedAt: new Date(),
    updatedBy: null,
  }],
  ['otc@g.us', {
    groupJid: 'otc@g.us',
    groupName: 'Crypto OTC Brasil',
    mode: 'active' as const,
    triggerPatterns: ['compro usdt'],
    responseTemplates: {},
    playerRoles: {},
    aiThreshold: 50,
    learningStartedAt: new Date('2025-01-01'),
    activatedAt: new Date('2025-01-10'),
    updatedAt: new Date(),
    updatedBy: 'admin@s.whatsapp.net',
  }],
])

describe('Control Handler - Epic 4 + Group Modes', () => {
  const mockSock = { sendMessage: vi.fn().mockResolvedValue(undefined) } as unknown as WASocket

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
    resetActivityState()
    clearKnownGroups()
    setRunning()
    setConnectionStatus('connected')
    mockSendWithAntiDetection.mockResolvedValue({ ok: true, data: undefined })
    mockSetGroupMode.mockResolvedValue({ ok: true, data: undefined })
    mockGetActiveDeals.mockResolvedValue({ ok: true, data: [] })
    mockCancelDeal.mockResolvedValue({ ok: true, data: undefined })
    mockArchiveDeal.mockResolvedValue({ ok: true, data: undefined })
    mockCancelQuote.mockReturnValue(false)
    mockResolveOperatorJid.mockReturnValue(null)
    mockGetGroupModeSync.mockReturnValue('active')
    mockFormatMention.mockImplementation((jid: string) => ({
      jid,
      textSegment: `@${jid.replace('@s.whatsapp.net', '')}`,
    }))
    mockGetAllGroupConfigs.mockResolvedValue(mockGroupConfigs)
    mockGetGroupModeStats.mockReturnValue({ learning: 1, assisted: 0, active: 1, paused: 0 })
    mockGetGroupsByMode.mockImplementation((mode: string) => {
      return [...mockGroupConfigs.values()].filter(c => c.mode === mode)
    })
    mockFindGroupByName.mockImplementation((search: string) => {
      const lower = search.toLowerCase()
      for (const config of mockGroupConfigs.values()) {
        if (config.groupName.toLowerCase().includes(lower)) {
          return config
        }
      }
      return null
    })
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
    })

    describe('resume command', () => {
      it('parses "resume" as global resume', () => {
        const result = parseControlCommand('resume')
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
    })

    describe('mode command', () => {
      it('parses "mode binance learning"', () => {
        const result = parseControlCommand('mode binance learning')
        expect(result.type).toBe('mode')
        expect(result.args).toEqual(['binance', 'learning'])
      })

      it('parses "mode OTC Brasil active"', () => {
        const result = parseControlCommand('mode OTC Brasil active')
        expect(result.type).toBe('mode')
        expect(result.args).toEqual(['OTC', 'Brasil', 'active'])
      })

      it('parses quoted group name: mode "OTC Brasil" active', () => {
        const result = parseControlCommand('mode "OTC Brasil" active')
        expect(result.type).toBe('mode')
        expect(result.args).toEqual(['OTC Brasil', 'active'])
      })
    })

    describe('modes command', () => {
      it('parses "modes"', () => {
        const result = parseControlCommand('modes')
        expect(result.type).toBe('modes')
        expect(result.args).toEqual([])
      })
    })

    describe('config command', () => {
      it('parses "config binance"', () => {
        const result = parseControlCommand('config binance')
        expect(result.type).toBe('config')
        expect(result.args).toEqual(['binance'])
      })
    })

    describe('training command', () => {
      it('parses "training on"', () => {
        const result = parseControlCommand('training on')
        expect(result.type).toBe('training')
        expect(result.args).toEqual(['on'])
      })

      it('parses "training off"', () => {
        const result = parseControlCommand('training off')
        expect(result.type).toBe('training')
        expect(result.args).toEqual(['off'])
      })
    })

    describe('off command', () => {
      it('parses "off" as bare off (no args)', () => {
        const result = parseControlCommand('off')
        expect(result.type).toBe('off')
        expect(result.args).toEqual([])
      })

      it('parses "off OTC Test" with group name', () => {
        const result = parseControlCommand('off OTC Test')
        expect(result.type).toBe('off')
        expect(result.args).toEqual(['OTC Test'])
      })

      it('parses "off off" for all groups', () => {
        const result = parseControlCommand('off off')
        expect(result.type).toBe('off')
        expect(result.args).toEqual(['off'])
      })

      it('strips @mention prefix: "@5511999999999 off OTC"', () => {
        const result = parseControlCommand('@5511999999999 off OTC')
        expect(result.type).toBe('off')
        expect(result.args).toEqual(['OTC'])
      })

      it('does not conflict with "training off"', () => {
        const result = parseControlCommand('training off')
        expect(result.type).toBe('training')
        expect(result.args).toEqual(['off'])
      })
    })

    describe('unknown commands', () => {
      it('returns unknown for unrecognized commands', () => {
        const result = parseControlCommand('hello world')
        expect(result.type).toBe('unknown')
      })
    })
  })

  // ==========================================================================
  // Fuzzy Group Matching Tests
  // ==========================================================================
  describe('Fuzzy Group Matching', () => {
    describe('findMatchingGroup', () => {
      it('finds group by partial name (case insensitive)', () => {
        const result = findMatchingGroup('binance')
        expect(result.found).toBe(true)
        expect(result.groupId).toBe('binance@g.us')
        expect(result.groupName).toBe('Binance VIP Trading')
      })

      it('returns not found for no match', () => {
        mockFindGroupByName.mockReturnValueOnce(null)
        const result = findMatchingGroup('nonexistent')
        expect(result.found).toBe(false)
        expect(result.groupId).toBeNull()
      })

      it('returns not found for empty string search', () => {
        const result = findMatchingGroup('')
        expect(result.found).toBe(false)
      })
    })
  })

  // ==========================================================================
  // Mode Command Tests (New)
  // ==========================================================================
  describe('Mode Command', () => {
    it('sets mode for specific group', async () => {
      const context = { ...baseContext, message: 'mode binance active' }

      await handleControlMessage(context)

      expect(mockSetGroupMode).toHaveBeenCalledWith('binance@g.us', 'active', 'daniel@s.whatsapp.net')
      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('Binance VIP Trading set to ACTIVE mode') }
      )
    })

    it('shows error for invalid mode', async () => {
      const context = { ...baseContext, message: 'mode binance invalid' }

      await handleControlMessage(context)

      expect(mockSetGroupMode).not.toHaveBeenCalled()
      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('Invalid mode') }
      )
    })

    it('shows error when group not found', async () => {
      mockFindGroupByName.mockReturnValueOnce(null)
      const context = { ...baseContext, message: 'mode nonexistent active' }

      await handleControlMessage(context)

      expect(mockSetGroupMode).not.toHaveBeenCalled()
      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('No group matching') }
      )
    })

    it('shows usage when args missing', async () => {
      const context = { ...baseContext, message: 'mode binance' }

      await handleControlMessage(context)

      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('Usage:') }
      )
    })
  })

  // ==========================================================================
  // Modes Command Tests (New)
  // ==========================================================================
  describe('Modes Command', () => {
    it('lists all groups with modes', async () => {
      const context = { ...baseContext, message: 'modes' }

      await handleControlMessage(context)

      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('📋 Group Modes') }
      )
      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('🔵 Learning: 1') }
      )
    })

    it('shows message when no groups registered', async () => {
      mockGetAllGroupConfigs.mockResolvedValueOnce(new Map())
      const context = { ...baseContext, message: 'modes' }

      await handleControlMessage(context)

      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: '📋 No groups registered yet' }
      )
    })
  })

  // ==========================================================================
  // Config Command Tests (New)
  // ==========================================================================
  describe('Config Command', () => {
    it('shows group configuration', async () => {
      const context = { ...baseContext, message: 'config binance' }

      await handleControlMessage(context)

      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('📊 Config: Binance VIP Trading') }
      )
      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('Mode: 🔵 LEARNING') }
      )
    })

    it('shows error when group not found', async () => {
      mockFindGroupByName.mockReturnValueOnce(null)
      const context = { ...baseContext, message: 'config nonexistent' }

      await handleControlMessage(context)

      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('No group matching') }
      )
    })
  })

  // ==========================================================================
  // Pause Command Tests (Backward Compatibility)
  // ==========================================================================
  describe('Pause Command (Backward Compatible)', () => {
    it('pauses specific group by setting mode to paused', async () => {
      const context = { ...baseContext, message: 'pause binance' }

      await handleControlMessage(context)

      expect(mockSetGroupMode).toHaveBeenCalledWith('binance@g.us', 'paused', 'daniel@s.whatsapp.net')
      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('Paused: Binance VIP Trading') }
      )
    })

    it('pauses all groups on global pause', async () => {
      const context = { ...baseContext, message: 'pause' }

      await handleControlMessage(context)

      // Should call setGroupMode for each non-paused group
      expect(mockSetGroupMode).toHaveBeenCalled()
      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('All groups paused') }
      )
    })

    it('shows error when group not found', async () => {
      mockFindGroupByName.mockReturnValueOnce(null)
      const context = { ...baseContext, message: 'pause nonexistent' }

      await handleControlMessage(context)

      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('No group matching') }
      )
    })
  })

  // ==========================================================================
  // Resume Command Tests (Backward Compatibility)
  // ==========================================================================
  describe('Resume Command (Backward Compatible)', () => {
    it('resumes specific group by setting mode to active', async () => {
      const context = { ...baseContext, message: 'resume binance' }

      await handleControlMessage(context)

      expect(mockSetGroupMode).toHaveBeenCalledWith('binance@g.us', 'active', 'daniel@s.whatsapp.net')
      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('Resumed: Binance VIP Trading') }
      )
    })

    it('cancels auto-recovery on resume', async () => {
      const context = { ...baseContext, message: 'resume' }

      await handleControlMessage(context)

      expect(mockCancelAutoRecovery).toHaveBeenCalled()
    })

    it('clears error state on resume', async () => {
      setPaused('Test error')
      expect(getOperationalStatus()).toBe('paused')

      const context = { ...baseContext, message: 'resume' }
      await handleControlMessage(context)

      expect(getOperationalStatus()).toBe('running')
    })
  })

  // ==========================================================================
  // Training Command Tests (Backward Compatibility)
  // ==========================================================================
  describe('Training Command (Backward Compatible)', () => {
    it('sets all groups to learning mode on training on', async () => {
      const context = { ...baseContext, message: 'training on' }

      await handleControlMessage(context)

      expect(mockSetGroupMode).toHaveBeenCalled()
      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('Training Mode ON') }
      )
    })

    it('shows interactive group selection on training off', async () => {
      const context = { ...baseContext, message: 'training off' }

      await handleControlMessage(context)

      // Should show numbered list instead of immediately activating
      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('Which group would you like to activate?') }
      )
      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('1. ') }
      )
    })

    it('activates selected group when number is replied', async () => {
      // First, trigger the training off to set up pending selection
      const offContext = { ...baseContext, message: 'training off' }
      await handleControlMessage(offContext)

      // Reset mocks for clarity
      mockSetGroupMode.mockClear()
      mockSendWithAntiDetection.mockClear()
      ;(mockSock.sendMessage as ReturnType<typeof vi.fn>).mockClear()

      // Now send a number selection
      const selectContext = { ...baseContext, message: '1' }
      await handleControlMessage(selectContext)

      // Should have activated the first group
      expect(mockSetGroupMode).toHaveBeenCalledWith(
        'binance@g.us',
        'active',
        expect.any(String)
      )
      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('is now ACTIVE!') }
      )
    })

    it('shows all groups active message when none in learning mode', async () => {
      // Mock no learning groups
      mockGetGroupsByMode.mockImplementation((mode: string) => {
        if (mode === 'learning') return []
        if (mode === 'active') return [{
          groupJid: 'active@g.us',
          groupName: 'Active Group',
          mode: 'active',
        }]
        return []
      })

      const context = { ...baseContext, message: 'training off' }
      await handleControlMessage(context)

      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('All 1 groups are already active!') }
      )

      // Restore mock
      mockGetGroupsByMode.mockImplementation((mode: string) => {
        if (mode === 'learning') return [mockGroupConfigs.get('binance@g.us')]
        if (mode === 'active') return [mockGroupConfigs.get('otc@g.us')]
        return []
      })
    })

    it('shows error for invalid training action', async () => {
      // This should never happen with proper parsing, but test defensive code
      const context = { ...baseContext, message: 'training invalid' }

      await handleControlMessage(context)

      // Should be unknown command (training without on/off)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Unknown control command',
        expect.anything()
      )
    })
  })

  // ==========================================================================
  // Status Command Tests
  // ==========================================================================
  describe('Status Command', () => {
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

      it('shows learning system stats', async () => {
        const message = await buildStatusMessage()

        expect(message).toContain('📚 Learning System')
        expect(message).toContain('1 groups learning')
        expect(message).toContain('1 groups active')
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

      it('shows pending logs when queue has entries', async () => {
        mockGetQueueLength.mockResolvedValueOnce({ ok: true, data: 5 })
        const message = await buildStatusMessage()

        expect(message).toContain('5 logs pending sync')
      })
    })

    describe('handleControlMessage with status', () => {
      it('sends status message', async () => {
        const context = { ...baseContext, message: 'status' }

        await handleControlMessage(context)

        expect(mockSock.sendMessage).toHaveBeenCalledWith(
          'control-group@g.us',
          { text: expect.stringContaining('📊 eNorBOT Status') }
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

  // ==========================================================================
  // Off Command Handler Tests
  // ==========================================================================
  describe('Off Command Handler', () => {
    it('"off off" skips active groups with no deals or quotes', async () => {
      const context = { ...baseContext, message: 'off off' }

      await handleControlMessage(context)

      // No deals, no quotes → nothing to cancel
      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: 'Nenhum deal ou cotação ativa em nenhum grupo.' }
      )
    })

    it('"off off" cancels active quotes found along the way', async () => {
      mockCancelQuote.mockImplementation((groupJid: string) => groupJid === 'otc@g.us')

      const context = { ...baseContext, message: 'off off' }
      await handleControlMessage(context)

      expect(mockCancelQuote).toHaveBeenCalledWith('otc@g.us')
      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('cotação') }
      )
    })

    it('"off off" cancels active deals found along the way', async () => {
      mockGetActiveDeals.mockResolvedValue({
        ok: true,
        data: [{ id: 'deal_1', group_jid: 'otc@g.us' }],
      })

      const context = { ...baseContext, message: 'off off' }
      await handleControlMessage(context)

      expect(mockCancelDeal).toHaveBeenCalledWith('deal_1', 'otc@g.us', 'cancelled_by_operator')
      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('1 deal(s) cancelados') }
      )
    })

    it('"off off" with no active-mode groups replies accordingly', async () => {
      mockGetAllGroupConfigs.mockResolvedValueOnce(new Map([
        ['binance@g.us', { ...mockGroupConfigs.get('binance@g.us')!, mode: 'learning' }],
      ]))

      const context = { ...baseContext, message: 'off off' }
      await handleControlMessage(context)

      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: 'Nenhum deal ou cotação ativa em nenhum grupo.' }
      )
    })

    it('"off <group>" cancels both deals and quotes', async () => {
      mockGetActiveDeals.mockResolvedValue({
        ok: true,
        data: [{ id: 'deal_1', group_jid: 'otc@g.us' }],
      })
      mockCancelDeal.mockResolvedValue({ ok: true, data: undefined })
      mockCancelQuote.mockReturnValue(true)

      const context = { ...baseContext, message: 'off otc' }
      await handleControlMessage(context)

      expect(mockCancelDeal).toHaveBeenCalledWith('deal_1', 'otc@g.us', 'cancelled_by_operator')
      expect(mockCancelQuote).toHaveBeenCalledWith('otc@g.us')
      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('off enviado para Crypto OTC Brasil') }
      )
    })

    it('"off <group>" reports quote cancelled when only quote active', async () => {
      mockCancelQuote.mockReturnValue(true)

      const context = { ...baseContext, message: 'off otc' }
      await handleControlMessage(context)

      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('cotação cancelada') }
      )
    })

    it('"off <group>" with unknown group shows guidance', async () => {
      mockFindGroupByName.mockReturnValueOnce(null)

      const context = { ...baseContext, message: 'off nonexistent' }
      await handleControlMessage(context)

      expect(mockSock.sendMessage).toHaveBeenCalledWith(
        'control-group@g.us',
        { text: expect.stringContaining('Grupo não encontrado') }
      )
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
  // Legacy Known Groups (Deprecated)
  // ==========================================================================
  describe('Legacy Known Groups (Deprecated)', () => {
    it('registerKnownGroup still works', () => {
      registerKnownGroup('test@g.us', 'Test Group')
      expect(getKnownGroups().get('test@g.us')).toBe('Test Group')
    })

    it('clearKnownGroups still works', () => {
      registerKnownGroup('test@g.us', 'Test Group')
      clearKnownGroups()
      expect(getKnownGroups().size).toBe(0)
    })
  })
})
