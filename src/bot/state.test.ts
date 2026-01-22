/**
 * Tests for Bot State - Story 3.2 additions
 *
 * Test coverage:
 * - AC1: setPaused sets operational status
 * - AC3: getPauseInfo returns correct reason and timestamp
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  getOperationalStatus,
  setPaused,
  setRunning,
  getPauseInfo,
  setConnectionStatus,
  getState,
  pauseGroup,
  isGroupPaused,
  pauseAllGroups,
  getPausedGroups,
  isGlobalPauseActive,
  resumeGroup,
  resumeAllGroups,
  resetPauseState,
  recordMessageSent,
  getActivityStats,
  resetDailyStats,
  resetActivityState,
  type OperationalStatus,
  type PauseInfo,
  type ActivityStats,
} from './state.js'

describe('Bot State - Story 3.2 Pause Tracking', () => {
  // Reset state before each test by setting to running
  beforeEach(() => {
    setRunning()
    setConnectionStatus('disconnected')
    resetPauseState()
    resetActivityState()
  })

  // ==========================================================================
  // Task 1 Tests: Type Exports
  // ==========================================================================
  describe('type exports', () => {
    it('OperationalStatus type allows running and paused', () => {
      const running: OperationalStatus = 'running'
      const paused: OperationalStatus = 'paused'
      expect(running).toBe('running')
      expect(paused).toBe('paused')
    })

    it('PauseInfo interface has reason and pausedAt', () => {
      const info: PauseInfo = { reason: 'test', pausedAt: new Date() }
      expect(info.reason).toBe('test')
      expect(info.pausedAt).toBeInstanceOf(Date)
    })
  })

  // ==========================================================================
  // Task 1 Tests: getOperationalStatus (6.8)
  // ==========================================================================
  describe('getOperationalStatus (6.8)', () => {
    it('returns running by default', () => {
      expect(getOperationalStatus()).toBe('running')
    })

    it('returns paused after setPaused', () => {
      setPaused('Test reason')
      expect(getOperationalStatus()).toBe('paused')
    })

    it('returns running after setRunning', () => {
      setPaused('Test reason')
      setRunning()
      expect(getOperationalStatus()).toBe('running')
    })
  })

  // ==========================================================================
  // Task 1 Tests: setPaused (6.9)
  // ==========================================================================
  describe('setPaused (6.9)', () => {
    it('sets operationalStatus to paused', () => {
      setPaused('Binance failures')
      expect(getOperationalStatus()).toBe('paused')
    })

    it('sets pauseReason correctly', () => {
      setPaused('Binance API failures (3 consecutive)')
      const info = getPauseInfo()
      expect(info.reason).toBe('Binance API failures (3 consecutive)')
    })

    it('sets pausedAt timestamp', () => {
      const before = new Date()
      setPaused('Test reason')
      const after = new Date()

      const info = getPauseInfo()
      expect(info.pausedAt).not.toBeNull()
      expect(info.pausedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(info.pausedAt!.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('updates reason and timestamp on subsequent calls', () => {
      setPaused('First reason')
      const firstInfo = getPauseInfo()

      // Small delay to ensure different timestamps
      const firstTimestamp = firstInfo.pausedAt!.getTime()

      setPaused('Second reason')
      const secondInfo = getPauseInfo()

      expect(secondInfo.reason).toBe('Second reason')
      expect(secondInfo.pausedAt!.getTime()).toBeGreaterThanOrEqual(firstTimestamp)
    })
  })

  // ==========================================================================
  // Task 1 Tests: setRunning (6.10)
  // ==========================================================================
  describe('setRunning (6.10)', () => {
    it('sets operationalStatus to running', () => {
      setPaused('Test reason')
      setRunning()
      expect(getOperationalStatus()).toBe('running')
    })

    it('clears pauseReason', () => {
      setPaused('Test reason')
      setRunning()
      const info = getPauseInfo()
      expect(info.reason).toBeNull()
    })

    it('clears pausedAt timestamp', () => {
      setPaused('Test reason')
      setRunning()
      const info = getPauseInfo()
      expect(info.pausedAt).toBeNull()
    })

    it('is idempotent - multiple calls have same effect', () => {
      setRunning()
      setRunning()
      expect(getOperationalStatus()).toBe('running')
      expect(getPauseInfo().reason).toBeNull()
    })
  })

  // ==========================================================================
  // Task 1 Tests: getPauseInfo (6.6)
  // ==========================================================================
  describe('getPauseInfo (6.6)', () => {
    it('returns null values when not paused', () => {
      const info = getPauseInfo()
      expect(info.reason).toBeNull()
      expect(info.pausedAt).toBeNull()
    })

    it('returns correct reason and timestamp when paused', () => {
      setPaused('WhatsApp logged_out')
      const info = getPauseInfo()

      expect(info.reason).toBe('WhatsApp logged_out')
      expect(info.pausedAt).toBeInstanceOf(Date)
    })

    it('returns fresh object each call (not reference)', () => {
      setPaused('Test reason')
      const info1 = getPauseInfo()
      const info2 = getPauseInfo()

      expect(info1).not.toBe(info2)
      expect(info1.reason).toBe(info2.reason)
    })
  })

  // ==========================================================================
  // Integration with existing state
  // ==========================================================================
  describe('integration with existing state', () => {
    it('pause state is independent of connection status', () => {
      setConnectionStatus('connected')
      setPaused('Test reason')

      expect(getOperationalStatus()).toBe('paused')
      expect(getState().connectionStatus).toBe('connected')
    })

    it('getState includes pause fields', () => {
      setPaused('Test reason')
      const state = getState()

      expect(state.operationalStatus).toBe('paused')
      expect(state.pauseReason).toBe('Test reason')
      expect(state.pausedAt).toBeInstanceOf(Date)
    })

    it('setConnectionStatus does not affect pause state', () => {
      setPaused('Test reason')
      setConnectionStatus('disconnected')
      setConnectionStatus('connected')

      // Pause state should remain unchanged
      expect(getOperationalStatus()).toBe('paused')
      expect(getPauseInfo().reason).toBe('Test reason')
    })
  })

  // ==========================================================================
  // Edge cases
  // ==========================================================================
  describe('edge cases', () => {
    it('handles empty string reason', () => {
      setPaused('')
      expect(getPauseInfo().reason).toBe('')
      expect(getOperationalStatus()).toBe('paused')
    })

    it('handles very long reason string', () => {
      const longReason = 'A'.repeat(1000)
      setPaused(longReason)
      expect(getPauseInfo().reason).toBe(longReason)
    })

    it('handles special characters in reason', () => {
      const specialReason = 'Error: "test" & <html> 🚨'
      setPaused(specialReason)
      expect(getPauseInfo().reason).toBe(specialReason)
    })
  })
})

// =============================================================================
// Story 4.1: Per-Group Pause Tracking Tests
// =============================================================================
describe('Bot State - Story 4.1 Per-Group Pause Tracking', () => {
  beforeEach(() => {
    setRunning()
    setConnectionStatus('disconnected')
    resetPauseState()
    resetActivityState()
  })

  // ==========================================================================
  // Task 1.1: pausedGroups in BotState
  // ==========================================================================
  describe('pausedGroups in BotState', () => {
    it('getState includes pausedGroups as Set', () => {
      const state = getState()
      expect(state.pausedGroups).toBeInstanceOf(Set)
    })

    it('pausedGroups is empty by default', () => {
      const state = getState()
      expect(state.pausedGroups.size).toBe(0)
    })

    it('getState includes globalPause flag', () => {
      const state = getState()
      expect(typeof state.globalPause).toBe('boolean')
    })

    it('globalPause is false by default', () => {
      const state = getState()
      expect(state.globalPause).toBe(false)
    })
  })

  // ==========================================================================
  // Task 1.2: pauseGroup function
  // ==========================================================================
  describe('pauseGroup (1.2)', () => {
    it('adds groupId to pausedGroups set', () => {
      pauseGroup('123456789@g.us')
      expect(getPausedGroups().has('123456789@g.us')).toBe(true)
    })

    it('can pause multiple groups', () => {
      pauseGroup('group1@g.us')
      pauseGroup('group2@g.us')
      pauseGroup('group3@g.us')

      const paused = getPausedGroups()
      expect(paused.size).toBe(3)
      expect(paused.has('group1@g.us')).toBe(true)
      expect(paused.has('group2@g.us')).toBe(true)
      expect(paused.has('group3@g.us')).toBe(true)
    })

    it('is idempotent - pausing same group twice has no effect', () => {
      pauseGroup('group1@g.us')
      pauseGroup('group1@g.us')

      expect(getPausedGroups().size).toBe(1)
    })
  })

  // ==========================================================================
  // Task 1.3: isGroupPaused function
  // ==========================================================================
  describe('isGroupPaused (1.3)', () => {
    it('returns false for non-paused group', () => {
      expect(isGroupPaused('123456789@g.us')).toBe(false)
    })

    it('returns true for paused group', () => {
      pauseGroup('123456789@g.us')
      expect(isGroupPaused('123456789@g.us')).toBe(true)
    })

    it('returns true for any group when global pause is active', () => {
      pauseAllGroups()
      expect(isGroupPaused('any-group@g.us')).toBe(true)
      expect(isGroupPaused('another-group@g.us')).toBe(true)
    })

    it('returns true if group is individually paused even without global pause', () => {
      pauseGroup('group1@g.us')
      expect(isGroupPaused('group1@g.us')).toBe(true)
      expect(isGroupPaused('group2@g.us')).toBe(false)
    })
  })

  // ==========================================================================
  // Task 1.4: pauseAllGroups function
  // ==========================================================================
  describe('pauseAllGroups (1.4)', () => {
    it('sets globalPause to true', () => {
      expect(isGlobalPauseActive()).toBe(false)
      pauseAllGroups()
      expect(isGlobalPauseActive()).toBe(true)
    })

    it('is idempotent - multiple calls have same effect', () => {
      pauseAllGroups()
      pauseAllGroups()
      expect(isGlobalPauseActive()).toBe(true)
    })
  })

  // ==========================================================================
  // Task 1.5: getPausedGroups function
  // ==========================================================================
  describe('getPausedGroups (1.5)', () => {
    it('returns empty set when no groups paused', () => {
      expect(getPausedGroups().size).toBe(0)
    })

    it('returns set of paused group IDs', () => {
      pauseGroup('group1@g.us')
      pauseGroup('group2@g.us')

      const paused = getPausedGroups()
      expect(paused.has('group1@g.us')).toBe(true)
      expect(paused.has('group2@g.us')).toBe(true)
    })

    it('returns a copy (not reference to internal state)', () => {
      pauseGroup('group1@g.us')

      const paused1 = getPausedGroups()
      const paused2 = getPausedGroups()

      expect(paused1).not.toBe(paused2)
      expect(paused1).toEqual(paused2)
    })

    it('modifications to returned set do not affect internal state', () => {
      pauseGroup('group1@g.us')

      const paused = getPausedGroups()
      paused.add('fake-group@g.us')

      expect(getPausedGroups().has('fake-group@g.us')).toBe(false)
    })
  })

  // ==========================================================================
  // Story 4.2 Preview: Resume Functions
  // ==========================================================================
  describe('resumeGroup (Story 4.2 preview)', () => {
    it('removes group from pausedGroups', () => {
      pauseGroup('group1@g.us')
      expect(isGroupPaused('group1@g.us')).toBe(true)

      resumeGroup('group1@g.us')
      expect(isGroupPaused('group1@g.us')).toBe(false)
    })

    it('returns true when group was paused', () => {
      pauseGroup('group1@g.us')
      expect(resumeGroup('group1@g.us')).toBe(true)
    })

    it('returns false when group was not paused', () => {
      expect(resumeGroup('group1@g.us')).toBe(false)
    })
  })

  describe('resumeAllGroups (Story 4.2 preview)', () => {
    it('clears all paused groups', () => {
      pauseGroup('group1@g.us')
      pauseGroup('group2@g.us')

      resumeAllGroups()

      expect(getPausedGroups().size).toBe(0)
    })

    it('clears globalPause flag', () => {
      pauseAllGroups()
      expect(isGlobalPauseActive()).toBe(true)

      resumeAllGroups()
      expect(isGlobalPauseActive()).toBe(false)
    })
  })

  // ==========================================================================
  // Integration: Pause Hierarchy
  // ==========================================================================
  describe('Pause Hierarchy Integration', () => {
    it('per-group pause is independent of operational status', () => {
      pauseGroup('group1@g.us')
      expect(getOperationalStatus()).toBe('running')
      expect(isGroupPaused('group1@g.us')).toBe(true)
    })

    it('global pause is independent of operational status', () => {
      pauseAllGroups()
      expect(getOperationalStatus()).toBe('running')
      expect(isGlobalPauseActive()).toBe(true)
    })

    it('setRunning does not affect per-group pause state', () => {
      pauseGroup('group1@g.us')
      setPaused('test')
      setRunning()

      expect(isGroupPaused('group1@g.us')).toBe(true)
    })

    it('setRunning does not affect global pause state', () => {
      pauseAllGroups()
      setPaused('test')
      setRunning()

      expect(isGlobalPauseActive()).toBe(true)
    })
  })
})

// =============================================================================
// Story 4.3: Activity Tracking Tests
// =============================================================================
describe('Bot State - Story 4.3 Activity Tracking', () => {
  beforeEach(() => {
    setRunning()
    setConnectionStatus('disconnected')
    resetPauseState()
    resetActivityState()
  })

  // ==========================================================================
  // ActivityStats type
  // ==========================================================================
  describe('ActivityStats type', () => {
    it('has correct structure', () => {
      const stats: ActivityStats = getActivityStats()
      expect(typeof stats.messagesSentToday).toBe('number')
      expect(stats.lastActivityAt === null || stats.lastActivityAt instanceof Date).toBe(true)
      expect(stats.startedAt).toBeInstanceOf(Date)
      expect(typeof stats.uptimeMs).toBe('number')
    })
  })

  // ==========================================================================
  // Task 1.1: messagesSentToday counter
  // ==========================================================================
  describe('messagesSentToday (1.1)', () => {
    it('starts at 0', () => {
      expect(getActivityStats().messagesSentToday).toBe(0)
    })

    it('increments when recordMessageSent is called', () => {
      recordMessageSent('group1@g.us')
      expect(getActivityStats().messagesSentToday).toBe(1)

      recordMessageSent('group2@g.us')
      expect(getActivityStats().messagesSentToday).toBe(2)
    })
  })

  // ==========================================================================
  // Task 1.2: lastActivityAt timestamp
  // ==========================================================================
  describe('lastActivityAt (1.2)', () => {
    it('starts as null', () => {
      expect(getActivityStats().lastActivityAt).toBeNull()
    })

    it('updates when recordMessageSent is called', () => {
      const before = new Date()
      recordMessageSent('group1@g.us')
      const after = new Date()

      const lastActivity = getActivityStats().lastActivityAt
      expect(lastActivity).toBeInstanceOf(Date)
      expect(lastActivity!.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(lastActivity!.getTime()).toBeLessThanOrEqual(after.getTime())
    })
  })

  // ==========================================================================
  // Task 1.3: startedAt for uptime
  // ==========================================================================
  describe('startedAt (1.3)', () => {
    it('is set to a Date on init', () => {
      expect(getActivityStats().startedAt).toBeInstanceOf(Date)
    })

    it('uptimeMs is calculated correctly', () => {
      const stats = getActivityStats()
      const calculatedUptime = Date.now() - stats.startedAt.getTime()

      // Allow small tolerance for timing
      expect(Math.abs(stats.uptimeMs - calculatedUptime)).toBeLessThan(100)
    })
  })

  // ==========================================================================
  // Task 1.4: recordMessageSent
  // ==========================================================================
  describe('recordMessageSent (1.4)', () => {
    it('increments messagesSentToday', () => {
      recordMessageSent('group1@g.us')
      expect(getActivityStats().messagesSentToday).toBe(1)
    })

    it('updates lastActivityAt', () => {
      recordMessageSent('group1@g.us')
      expect(getActivityStats().lastActivityAt).toBeInstanceOf(Date)
    })

    it('accepts any group ID', () => {
      recordMessageSent('any-group@g.us')
      recordMessageSent('another-group@g.us')
      expect(getActivityStats().messagesSentToday).toBe(2)
    })
  })

  // ==========================================================================
  // Task 1.5: getActivityStats
  // ==========================================================================
  describe('getActivityStats (1.5)', () => {
    it('returns complete stats object', () => {
      recordMessageSent('group1@g.us')

      const stats = getActivityStats()
      expect(stats.messagesSentToday).toBe(1)
      expect(stats.lastActivityAt).toBeInstanceOf(Date)
      expect(stats.startedAt).toBeInstanceOf(Date)
      expect(stats.uptimeMs).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // Task 1.6: resetDailyStats
  // ==========================================================================
  describe('resetDailyStats (1.6)', () => {
    it('resets messagesSentToday to 0', () => {
      recordMessageSent('group1@g.us')
      recordMessageSent('group2@g.us')
      expect(getActivityStats().messagesSentToday).toBe(2)

      resetDailyStats()
      expect(getActivityStats().messagesSentToday).toBe(0)
    })

    it('does NOT reset lastActivityAt', () => {
      recordMessageSent('group1@g.us')
      const lastActivity = getActivityStats().lastActivityAt

      resetDailyStats()

      // lastActivityAt should still be the same
      expect(getActivityStats().lastActivityAt).toEqual(lastActivity)
    })
  })

  // ==========================================================================
  // Integration with getState
  // ==========================================================================
  describe('Integration with getState', () => {
    it('getState includes activity fields', () => {
      recordMessageSent('group1@g.us')
      const state = getState()

      expect(state.messagesSentToday).toBe(1)
      expect(state.lastActivityAt).toBeInstanceOf(Date)
      expect(state.startedAt).toBeInstanceOf(Date)
    })
  })
})
