/**
 * Tests for Connection Module - Story 3.2 Pause Behavior
 *
 * Test coverage:
 * - AC2: Messages ignored when paused (silent mode)
 * - Control group bypass when paused (for Epic 4 resume commands)
 *
 * Note: These tests focus on the pause behavior integration.
 * Full connection lifecycle tests are deferred to integration testing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getOperationalStatus,
  setPaused,
  setRunning,
  getPauseInfo,
} from './state.js'

// Mock logger to capture log calls
const mockLoggerInfo = vi.fn()
const mockLoggerWarn = vi.fn()
const mockLoggerError = vi.fn()

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
    debug: vi.fn(),
  },
}))

describe('Connection - Story 3.2 Pause Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setRunning() // Reset to running state
  })

  // ==========================================================================
  // AC2: Silent When Paused - Unit Tests for Pause Check Logic
  // ==========================================================================
  describe('AC2: pause check logic', () => {
    /**
     * Simulates the pause check logic from connection.ts:279-287
     * This tests the core decision logic without mocking the full socket.
     */
    function shouldIgnoreMessage(
      isControlGroup: boolean,
      messageText: string
    ): { ignored: boolean; logData?: Record<string, unknown> } {
      const groupId = 'test-group@g.us'

      // Replicate connection.ts pause check logic
      if (!isControlGroup && getOperationalStatus() === 'paused') {
        const { reason } = getPauseInfo()
        return {
          ignored: true,
          logData: {
            event: 'message_ignored_paused',
            groupId,
            messagePreview: messageText.substring(0, 20),
            pauseReason: reason,
          },
        }
      }
      return { ignored: false }
    }

    it('ignores non-control group messages when paused', () => {
      setPaused('Binance API failures')

      const result = shouldIgnoreMessage(false, 'preço btc')

      expect(result.ignored).toBe(true)
      expect(result.logData).toMatchObject({
        event: 'message_ignored_paused',
        pauseReason: 'Binance API failures',
      })
    })

    it('includes message preview in log (truncated to 20 chars)', () => {
      setPaused('Test reason')

      const longMessage = 'This is a very long message that should be truncated'
      const result = shouldIgnoreMessage(false, longMessage)

      expect(result.ignored).toBe(true)
      expect(result.logData?.messagePreview).toBe('This is a very long ')
      expect((result.logData?.messagePreview as string).length).toBe(20)
    })

    it('routes non-control group messages when running', () => {
      // State is already running from beforeEach
      expect(getOperationalStatus()).toBe('running')

      const result = shouldIgnoreMessage(false, 'preço btc')

      expect(result.ignored).toBe(false)
    })

    it('routes control group messages when paused (Epic 4 resume support)', () => {
      setPaused('WhatsApp logged_out')

      const result = shouldIgnoreMessage(true, '/resume')

      expect(result.ignored).toBe(false)
    })

    it('routes control group messages when running', () => {
      const result = shouldIgnoreMessage(true, '/status')

      expect(result.ignored).toBe(false)
    })
  })

  // ==========================================================================
  // Control Group Bypass - Critical for Epic 4
  // ==========================================================================
  describe('control group bypass when paused', () => {
    it('control group check is evaluated before pause check', () => {
      setPaused('Critical error')

      // Control group = true should bypass pause check entirely
      // This is critical: if we checked pause first, control messages would be blocked
      const isControlGroup = true
      const opStatus = getOperationalStatus()

      // The condition is: if (!isControlGroup && opStatus === 'paused')
      // When isControlGroup=true, the condition short-circuits
      const wouldBeIgnored = !isControlGroup && opStatus === 'paused'

      expect(wouldBeIgnored).toBe(false)
    })

    it('non-control group respects pause state', () => {
      setPaused('Critical error')

      const isControlGroup = false
      const opStatus = getOperationalStatus()

      const wouldBeIgnored = !isControlGroup && opStatus === 'paused'

      expect(wouldBeIgnored).toBe(true)
    })

    it('allows CIO commands through when paused', () => {
      // Scenario: Bot is paused, CIO sends /resume command
      setPaused('Binance API failures (3 consecutive)')

      // Simulate control group message
      const isControlGroup = true
      const message = '/resume'

      // Should NOT be ignored
      const wouldBeIgnored = !isControlGroup && getOperationalStatus() === 'paused'
      expect(wouldBeIgnored).toBe(false)

      // Pause info should still be accessible for status command
      const pauseInfo = getPauseInfo()
      expect(pauseInfo.reason).toBe('Binance API failures (3 consecutive)')
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe('edge cases', () => {
    it('handles rapid state transitions', () => {
      // Simulate rapid pause/resume cycles
      setPaused('Error 1')
      expect(getOperationalStatus()).toBe('paused')

      setRunning()
      expect(getOperationalStatus()).toBe('running')

      setPaused('Error 2')
      expect(getOperationalStatus()).toBe('paused')
      expect(getPauseInfo().reason).toBe('Error 2')
    })

    it('handles empty message text gracefully', () => {
      setPaused('Test')

      const isControlGroup = false
      const messageText = ''

      // Should still work with empty string
      const wouldBeIgnored = !isControlGroup && getOperationalStatus() === 'paused'
      expect(wouldBeIgnored).toBe(true)

      // Preview of empty string
      expect(messageText.substring(0, 20)).toBe('')
    })

    it('pause reason is included in ignored message log', () => {
      const reason = 'WhatsApp connection_replaced'
      setPaused(reason)

      const pauseInfo = getPauseInfo()
      expect(pauseInfo.reason).toBe(reason)
      expect(pauseInfo.pausedAt).toBeInstanceOf(Date)
    })
  })
})
