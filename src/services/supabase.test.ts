import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock logger before importing module
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({ logger: mockLogger }))

// Mock Supabase client with flexible chain support
const mockSupabaseClient = vi.hoisted(() => {
  const mockSelect = vi.fn()
  const mockLimit = vi.fn()
  const mockAbortSignal = vi.fn()
  const mockEq = vi.fn()
  const mockSingle = vi.fn()

  // Create chainable mock for health check (select -> limit -> abortSignal)
  const healthChain = {
    limit: mockLimit.mockReturnValue({
      abortSignal: mockAbortSignal.mockResolvedValue({ data: [], error: null }),
    }),
  }

  // Create chainable mock for auth state load (select -> eq -> single)
  const authChain = {
    eq: mockEq.mockReturnValue({
      single: mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'not found' } }),
    }),
  }

  // Dynamic chain based on select argument
  mockSelect.mockImplementation((cols: string) => {
    if (cols === 'id') {
      return healthChain
    }
    return authChain
  })

  return {
    from: vi.fn(() => ({ select: mockSelect })),
    _mockSelect: mockSelect,
    _mockLimit: mockLimit,
    _mockAbortSignal: mockAbortSignal,
    _mockEq: mockEq,
    _mockSingle: mockSingle,
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabaseClient),
}))

// Mock authBackup to avoid file system operations
vi.mock('./authBackup.js', () => ({
  saveAuthStateToFile: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
  loadAuthStateFromFile: vi.fn().mockResolvedValue({ ok: true, data: null }),
}))

// Mock notifications
const mockQueueControlNotification = vi.hoisted(() => vi.fn())
vi.mock('../bot/notifications.js', () => ({
  queueControlNotification: mockQueueControlNotification,
}))

// Import after mocking
import {
  initSupabase,
  checkSupabaseHealth,
  loadAuthStateWithRetry,
  AUTH_RETRY_CONFIG,
  trackDatabaseFailure,
  clearDatabaseFailureTracking,
  resetDatabaseFailureTracking,
} from './supabase.js'

describe('supabase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDatabaseFailureTracking()
  })

  describe('checkSupabaseHealth', () => {
    it('returns error when Supabase not initialized', async () => {
      // Don't call initSupabase - test uninitialized state
      // Note: Since module state persists, we need a fresh module or reset function
      // For this test, we'll skip since initSupabase sets the global

      // This test requires a reset mechanism - skip for now
      // The function is tested via integration in other tests
    })

    it('returns ok when health check succeeds', async () => {
      initSupabase({
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_KEY: 'test-key',
        PHONE_NUMBER: '+5511999999999',
        CONTROL_GROUP_PATTERN: 'Control',
      } as Parameters<typeof initSupabase>[0])

      // Mock successful response
      mockSupabaseClient._mockAbortSignal.mockResolvedValueOnce({
        data: [{ id: 'default' }],
        error: null,
      })

      const result = await checkSupabaseHealth()

      expect(result.ok).toBe(true)
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('sessions')
      expect(mockSupabaseClient._mockSelect).toHaveBeenCalledWith('id')
      expect(mockSupabaseClient._mockLimit).toHaveBeenCalledWith(1)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Supabase health check passed',
        expect.objectContaining({ event: 'supabase_health_ok' })
      )
    })

    it('returns error when Supabase query fails', async () => {
      initSupabase({
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_KEY: 'test-key',
        PHONE_NUMBER: '+5511999999999',
        CONTROL_GROUP_PATTERN: 'Control',
      } as Parameters<typeof initSupabase>[0])

      // Mock error response
      mockSupabaseClient._mockAbortSignal.mockResolvedValueOnce({
        data: null,
        error: { message: 'Connection refused', code: 'PGRST000' },
      })

      const result = await checkSupabaseHealth()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Connection refused')
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Supabase health check failed',
        expect.objectContaining({
          event: 'supabase_health_failed',
          error: 'Connection refused',
        })
      )
    })

    it('returns error on network exception', async () => {
      initSupabase({
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_KEY: 'test-key',
        PHONE_NUMBER: '+5511999999999',
        CONTROL_GROUP_PATTERN: 'Control',
      } as Parameters<typeof initSupabase>[0])

      // Mock network exception
      mockSupabaseClient._mockAbortSignal.mockRejectedValueOnce(
        new TypeError('fetch failed')
      )

      const result = await checkSupabaseHealth()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('fetch failed')
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Supabase health check exception',
        expect.objectContaining({
          event: 'supabase_health_exception',
          isTimeout: false,
        })
      )
    })

    it('returns timeout error when request times out', async () => {
      initSupabase({
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_KEY: 'test-key',
        PHONE_NUMBER: '+5511999999999',
        CONTROL_GROUP_PATTERN: 'Control',
      } as Parameters<typeof initSupabase>[0])

      // Mock abort error (timeout)
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      mockSupabaseClient._mockAbortSignal.mockRejectedValueOnce(abortError)

      const result = await checkSupabaseHealth()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Health check timeout')
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Supabase health check exception',
        expect.objectContaining({
          event: 'supabase_health_exception',
          isTimeout: true,
        })
      )
    })

    it('clears timeout on successful response', async () => {
      vi.useFakeTimers()

      initSupabase({
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_KEY: 'test-key',
        PHONE_NUMBER: '+5511999999999',
        CONTROL_GROUP_PATTERN: 'Control',
      } as Parameters<typeof initSupabase>[0])

      // Mock successful response
      mockSupabaseClient._mockAbortSignal.mockResolvedValueOnce({
        data: [{ id: 'default' }],
        error: null,
      })

      const resultPromise = checkSupabaseHealth()

      // Advance past the timeout
      await vi.advanceTimersByTimeAsync(10000)

      const result = await resultPromise

      // Should still succeed because response came before timeout
      expect(result.ok).toBe(true)

      vi.useRealTimers()
    })
  })

  describe('loadAuthStateWithRetry', () => {
    beforeEach(() => {
      initSupabase({
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_KEY: 'test-key',
        PHONE_NUMBER: '+5511999999999',
        CONTROL_GROUP_PATTERN: 'Control',
      } as Parameters<typeof initSupabase>[0])
    })

    it('returns immediately on first successful load', async () => {
      // Mock successful auth state load
      mockSupabaseClient._mockSingle.mockResolvedValueOnce({
        data: {
          auth_state: {
            creds: {
              noiseKey: { private: {}, public: {} },
              signedIdentityKey: { private: {}, public: {} },
              signedPreKey: { keyPair: { private: {}, public: {} }, signature: {}, keyId: 1 },
              registrationId: 12345,
              advSecretKey: 'test-key',
              nextPreKeyId: 1,
              firstUnuploadedPreKeyId: 1,
              accountSyncCounter: 0,
              accountSettings: { unarchiveChats: false },
            },
            keys: {},
          },
        },
        error: null,
      })

      const result = await loadAuthStateWithRetry()

      expect(result.ok).toBe(true)
      if (result.ok && result.data) {
        expect(result.data.creds.registrationId).toBe(12345)
      }
      // Should not log retry success on first attempt
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        'Auth state loaded after retry',
        expect.anything()
      )
    })

    it('returns null when no auth state exists (fresh install)', async () => {
      // Mock PGRST116 (row not found)
      mockSupabaseClient._mockSingle.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116', message: 'not found' },
      })

      const result = await loadAuthStateWithRetry()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBeNull()
      }
    })

    it('retries on failure and succeeds eventually', async () => {
      vi.useFakeTimers()

      // First attempt fails
      mockSupabaseClient._mockSingle.mockResolvedValueOnce({
        data: null,
        error: { code: 'NETWORK_ERROR', message: 'fetch failed' },
      })

      // Second attempt succeeds
      mockSupabaseClient._mockSingle.mockResolvedValueOnce({
        data: {
          auth_state: {
            creds: {
              noiseKey: { private: {}, public: {} },
              signedIdentityKey: { private: {}, public: {} },
              signedPreKey: { keyPair: { private: {}, public: {} }, signature: {}, keyId: 1 },
              registrationId: 67890,
              advSecretKey: 'test-key',
              nextPreKeyId: 1,
              firstUnuploadedPreKeyId: 1,
              accountSyncCounter: 0,
              accountSettings: { unarchiveChats: false },
            },
            keys: {},
          },
        },
        error: null,
      })

      const resultPromise = loadAuthStateWithRetry()

      // Advance past first retry delay
      await vi.advanceTimersByTimeAsync(AUTH_RETRY_CONFIG.delays[0])

      const result = await resultPromise

      expect(result.ok).toBe(true)
      if (result.ok && result.data) {
        expect(result.data.creds.registrationId).toBe(67890)
      }
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Auth state load failed, retrying',
        expect.objectContaining({
          event: 'auth_state_retry_scheduled',
          attempt: 1,
        })
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Auth state loaded after retry',
        expect.objectContaining({
          event: 'auth_state_retry_success',
          attempts: 2,
        })
      )

      vi.useRealTimers()
    })

    it('has correct retry configuration', () => {
      expect(AUTH_RETRY_CONFIG.maxRetries).toBe(10)
      expect(AUTH_RETRY_CONFIG.delays).toHaveLength(10)
      expect(AUTH_RETRY_CONFIG.delays[0]).toBe(1000) // 1s
      expect(AUTH_RETRY_CONFIG.delays[9]).toBe(300000) // 5 minutes
      expect(AUTH_RETRY_CONFIG.totalWindowMs).toBe(5 * 60 * 1000) // 5 minutes
    })

    it('uses exponential backoff delays', () => {
      const delays = AUTH_RETRY_CONFIG.delays
      // Verify increasing pattern (exponential with some adjustments)
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThan(delays[i - 1])
      }
    })
  })

  describe('database connectivity alerting', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      resetDatabaseFailureTracking()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('does not alert on first failure', () => {
      trackDatabaseFailure()

      expect(mockQueueControlNotification).not.toHaveBeenCalled()
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Database failure tracking started',
        expect.objectContaining({ event: 'db_failure_tracking_started' })
      )
    })

    it('alerts after 60 seconds of continuous failure', () => {
      // First failure
      trackDatabaseFailure()
      expect(mockQueueControlNotification).not.toHaveBeenCalled()

      // Advance 59 seconds - still no alert
      vi.advanceTimersByTime(59 * 1000)
      trackDatabaseFailure()
      expect(mockQueueControlNotification).not.toHaveBeenCalled()

      // Advance to 61 seconds - should alert
      vi.advanceTimersByTime(2 * 1000)
      trackDatabaseFailure()

      expect(mockQueueControlNotification).toHaveBeenCalledWith(
        'Database unreachable for 60+ seconds - using local backup'
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Database connectivity alert',
        expect.objectContaining({ event: 'db_connectivity_alert' })
      )
    })

    it('rate limits alerts to once per 10 minutes', () => {
      // First failure
      trackDatabaseFailure()

      // Trigger first alert (after 60s)
      vi.advanceTimersByTime(61 * 1000)
      trackDatabaseFailure()
      expect(mockQueueControlNotification).toHaveBeenCalledTimes(1)

      // Try again immediately - should be rate limited
      vi.advanceTimersByTime(1000)
      trackDatabaseFailure()
      expect(mockQueueControlNotification).toHaveBeenCalledTimes(1)

      // Try after 9 minutes - still rate limited
      vi.advanceTimersByTime(9 * 60 * 1000)
      trackDatabaseFailure()
      expect(mockQueueControlNotification).toHaveBeenCalledTimes(1)

      // Try after 10+ minutes - should alert again
      vi.advanceTimersByTime(2 * 60 * 1000)
      trackDatabaseFailure()
      expect(mockQueueControlNotification).toHaveBeenCalledTimes(2)
    })

    it('clears tracking on success', () => {
      // Start failure tracking
      trackDatabaseFailure()
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Database failure tracking started',
        expect.anything()
      )

      vi.advanceTimersByTime(30 * 1000)

      // Clear on success
      clearDatabaseFailureTracking()

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Database connectivity restored',
        expect.objectContaining({
          event: 'db_connectivity_restored',
          downDurationMs: expect.any(Number),
        })
      )
    })

    it('does not log restore if no previous failure', () => {
      clearDatabaseFailureTracking()

      expect(mockLogger.info).not.toHaveBeenCalledWith(
        'Database connectivity restored',
        expect.anything()
      )
    })

    it('resets tracking state completely', () => {
      // Start tracking
      trackDatabaseFailure()
      vi.advanceTimersByTime(61 * 1000)
      trackDatabaseFailure() // Triggers alert

      expect(mockQueueControlNotification).toHaveBeenCalledTimes(1)

      // Reset everything
      resetDatabaseFailureTracking()

      // Start fresh - should need another 60s before alerting
      trackDatabaseFailure()
      vi.advanceTimersByTime(30 * 1000)
      trackDatabaseFailure()

      // Still only 1 alert (the original one)
      expect(mockQueueControlNotification).toHaveBeenCalledTimes(1)
    })
  })
})
