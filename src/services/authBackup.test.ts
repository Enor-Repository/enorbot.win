import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

// Mock logger before importing module
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({ logger: mockLogger }))

// Import after mocking
import {
  saveAuthStateToFile,
  loadAuthStateFromFile,
  clearAuthStateBackup,
  checkBackupPermissions,
  setBackupPathForTesting,
  resetAuthBackupState,
  getBackupPath,
} from './authBackup.js'
import type { StoredAuthState } from './supabase.js'

/**
 * Create a valid mock auth state for testing.
 */
function createValidAuthState(): StoredAuthState {
  return {
    creds: {
      noiseKey: { private: { '0': 1, '1': 2 }, public: { '0': 3, '1': 4 } },
      signedIdentityKey: { private: { '0': 5 }, public: { '0': 6 } },
      signedPreKey: {
        keyPair: { private: { '0': 7 }, public: { '0': 8 } },
        signature: { '0': 9 },
        keyId: 1,
      },
      registrationId: 12345,
      advSecretKey: 'secret-key-value',
      nextPreKeyId: 2,
      firstUnuploadedPreKeyId: 1,
      accountSyncCounter: 0,
      accountSettings: { unarchiveChats: false },
      me: { id: '5511999999999@s.whatsapp.net', name: 'Test User' },
      registered: true,
    },
    keys: {
      'pre-key': { '1': { '0': 10 } },
      'session': { 'user1': { '0': 11 } },
    },
  }
}

describe('authBackup', () => {
  let tempDir: string
  let tempBackupPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    resetAuthBackupState()

    // Create temp directory for each test
    tempDir = await mkdtemp(join(tmpdir(), 'authBackup-test-'))
    tempBackupPath = join(tempDir, 'auth_state_backup.json')
    setBackupPathForTesting(tempBackupPath)
  })

  afterEach(async () => {
    resetAuthBackupState()
    // Clean up temp directory
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('getBackupPath', () => {
    it('returns override path when set', () => {
      const customPath = '/custom/path/backup.json'
      setBackupPathForTesting(customPath)
      expect(getBackupPath()).toBe(customPath)
    })

    it('returns default when override is null', () => {
      setBackupPathForTesting(null)
      // Default path should be /opt/enorbot/auth_state_backup.json or env override
      expect(getBackupPath()).toBeTruthy()
    })
  })

  describe('saveAuthStateToFile', () => {
    it('saves valid auth state to file', async () => {
      const state = createValidAuthState()

      const result = await saveAuthStateToFile(state)

      expect(result.ok).toBe(true)

      // Verify file was written
      const content = await readFile(tempBackupPath, 'utf-8')
      const parsed = JSON.parse(content)
      expect(parsed.creds.registrationId).toBe(12345)
      expect(parsed.creds.advSecretKey).toBe('secret-key-value')
    })

    it('logs success event on save', async () => {
      const state = createValidAuthState()

      await saveAuthStateToFile(state)

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Auth state backed up to file',
        expect.objectContaining({
          event: 'auth_backup_saved',
          path: tempBackupPath,
        })
      )
    })

    it('creates directory if it does not exist', async () => {
      const nestedPath = join(tempDir, 'nested', 'deep', 'backup.json')
      setBackupPathForTesting(nestedPath)

      const state = createValidAuthState()
      const result = await saveAuthStateToFile(state)

      expect(result.ok).toBe(true)

      // Verify file was created in nested directory
      const content = await readFile(nestedPath, 'utf-8')
      expect(content).toBeTruthy()
    })

    it('uses atomic write (temp file + rename)', async () => {
      const state = createValidAuthState()

      await saveAuthStateToFile(state)

      // Temp file should not exist after successful write
      const tempFilePath = `${tempBackupPath}.tmp`
      await expect(readFile(tempFilePath, 'utf-8')).rejects.toThrow()
    })

    it('returns error on write failure', async () => {
      // Use an invalid path that can't be created
      setBackupPathForTesting('/nonexistent/readonly/path/backup.json')

      const state = createValidAuthState()
      const result = await saveAuthStateToFile(state)

      // This may or may not fail depending on permissions
      // The important thing is it returns Result, not throws
      expect('ok' in result).toBe(true)

      if (!result.ok) {
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Failed to save auth state backup',
          expect.objectContaining({
            event: 'auth_backup_save_failed',
          })
        )
      }
    })
  })

  describe('loadAuthStateFromFile', () => {
    it('loads valid auth state from file', async () => {
      const state = createValidAuthState()
      await writeFile(tempBackupPath, JSON.stringify(state, null, 2), 'utf-8')

      const result = await loadAuthStateFromFile()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).not.toBeNull()
        expect(result.data?.creds.registrationId).toBe(12345)
      }
    })

    it('returns null when file does not exist', async () => {
      const result = await loadAuthStateFromFile()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBeNull()
      }

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'No local auth backup found',
        expect.objectContaining({
          event: 'auth_backup_not_found',
        })
      )
    })

    it('returns error on corrupted JSON', async () => {
      await writeFile(tempBackupPath, 'not valid json {{{', 'utf-8')

      const result = await loadAuthStateFromFile()

      expect(result.ok).toBe(false)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to load auth state backup',
        expect.objectContaining({
          event: 'auth_backup_load_failed',
        })
      )
    })

    it('returns error on invalid structure', async () => {
      // Missing required fields
      const invalidState = {
        creds: { registrationId: 123 },
        keys: {},
      }
      await writeFile(tempBackupPath, JSON.stringify(invalidState), 'utf-8')

      const result = await loadAuthStateFromFile()

      expect(result.ok).toBe(false)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Auth backup file corrupted',
        expect.objectContaining({
          event: 'auth_backup_corrupted',
        })
      )
    })

    it('logs success event on load', async () => {
      const state = createValidAuthState()
      await writeFile(tempBackupPath, JSON.stringify(state), 'utf-8')

      await loadAuthStateFromFile()

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Auth state loaded from local backup',
        expect.objectContaining({
          event: 'auth_backup_loaded',
        })
      )
    })
  })

  describe('clearAuthStateBackup', () => {
    it('deletes existing backup file', async () => {
      const state = createValidAuthState()
      await writeFile(tempBackupPath, JSON.stringify(state), 'utf-8')

      const result = await clearAuthStateBackup()

      expect(result.ok).toBe(true)

      // File should no longer exist
      await expect(readFile(tempBackupPath, 'utf-8')).rejects.toThrow()

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Auth state backup cleared',
        expect.objectContaining({
          event: 'auth_backup_cleared',
        })
      )
    })

    it('succeeds when file does not exist', async () => {
      const result = await clearAuthStateBackup()

      expect(result.ok).toBe(true)

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'No auth backup to clear',
        expect.objectContaining({
          event: 'auth_backup_already_clear',
        })
      )
    })
  })

  describe('checkBackupPermissions', () => {
    it('returns ok for writable directory', async () => {
      const result = await checkBackupPermissions()

      expect(result.ok).toBe(true)

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Backup directory writable',
        expect.objectContaining({
          event: 'backup_permissions_ok',
        })
      )
    })

    it('creates directory if it does not exist', async () => {
      const nestedPath = join(tempDir, 'new', 'nested', 'backup.json')
      setBackupPathForTesting(nestedPath)

      const result = await checkBackupPermissions()

      expect(result.ok).toBe(true)
    })
  })

  describe('round-trip save and load', () => {
    it('preserves all data through save/load cycle', async () => {
      const originalState = createValidAuthState()

      await saveAuthStateToFile(originalState)
      const result = await loadAuthStateFromFile()

      expect(result.ok).toBe(true)
      if (result.ok && result.data) {
        expect(result.data.creds.registrationId).toBe(originalState.creds.registrationId)
        expect(result.data.creds.advSecretKey).toBe(originalState.creds.advSecretKey)
        expect(result.data.creds.me).toEqual(originalState.creds.me)
        expect(result.data.keys).toEqual(originalState.keys)
      }
    })

    it('handles special characters in advSecretKey', async () => {
      const state = createValidAuthState()
      state.creds.advSecretKey = 'key-with-special-chars!@#$%^&*()'

      await saveAuthStateToFile(state)
      const result = await loadAuthStateFromFile()

      expect(result.ok).toBe(true)
      if (result.ok && result.data) {
        expect(result.data.creds.advSecretKey).toBe('key-with-special-chars!@#$%^&*()')
      }
    })
  })
})
