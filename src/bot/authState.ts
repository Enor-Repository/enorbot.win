/**
 * Custom auth state provider for Baileys using Supabase persistence.
 * Replaces file-based useMultiFileAuthState with database storage.
 * 
 * IMPORTANT: Handles Uint8Array serialization to base64 for JSON storage.
 */
import { proto } from '@whiskeysockets/baileys'
import type { AuthenticationCreds, SignalDataTypeMap } from '@whiskeysockets/baileys'
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys'
import { loadAuthStateWithRetry, saveAuthState, type StoredAuthState } from '../services/supabase.js'
import { logger } from '../utils/logger.js'
import { setAuthStateLoaded } from './state.js'

/**
 * Serialize data with Uint8Array -> base64 conversion for JSON storage.
 */
function serializeState(data: unknown): unknown {
  return JSON.parse(JSON.stringify(data, BufferJSON.replacer))
}

/**
 * Deserialize data with base64 -> Uint8Array conversion from JSON storage.
 */
function deserializeState<T>(data: unknown): T {
  return JSON.parse(JSON.stringify(data), BufferJSON.reviver) as T
}

/**
 * Baileys-compatible auth state interface.
 * Returned by useSupabaseAuthState().
 */
export interface AuthStateResult {
  state: {
    creds: AuthenticationCreds
    keys: {
      get: <T extends keyof SignalDataTypeMap>(
        type: T,
        ids: string[]
      ) => Promise<{ [id: string]: SignalDataTypeMap[T] }>
      set: (data: { [T in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[T] } }) => Promise<void>
    }
  }
  saveCreds: () => Promise<void>
}

/**
 * Create a Supabase-backed auth state provider for Baileys.
 * Compatible with makeWASocket({ auth: state }).
 *
 * @returns AuthStateResult with state and saveCreds function
 */
export async function useSupabaseAuthState(): Promise<AuthStateResult> {
  // Load existing auth state from Supabase with extended retry (Story 5.4 AC4)
  const loadResult = await loadAuthStateWithRetry()

  let creds: AuthenticationCreds
  let keys: Record<string, Record<string, unknown>> = {}

  if (loadResult.ok && loadResult.data) {
    // Existing auth state found - restore it with proper Uint8Array deserialization
    const stored = loadResult.data
    creds = deserializeState<AuthenticationCreds>(stored.creds)
    keys = deserializeState<Record<string, Record<string, unknown>>>(stored.keys || {})
    // Story 5.4 AC6: Mark that we had valid auth (prevents re-pairing on db failure)
    setAuthStateLoaded()
    logger.info('Auth state restored from Supabase', {
      event: 'auth_state_restored',
      hasKeys: Object.keys(keys).length > 0,
    })
  } else {
    // No existing state or load failed - create fresh credentials
    creds = initAuthCreds()
    keys = {}
    logger.info('Fresh auth state created', {
      event: 'auth_state_fresh',
      reason: loadResult.ok ? 'no_existing_state' : loadResult.error,
    })
  }

  // Debounce state to prevent race conditions during rapid key updates
  let saveTimeout: ReturnType<typeof setTimeout> | null = null
  let saveInProgress = false
  let pendingSave = false
  const DEBOUNCE_MS = 500 // Wait 500ms after last update before saving
  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 1000

  /**
   * Save credentials and keys to Supabase with retry logic.
   * Serializes Uint8Array to base64 for JSON storage.
   * @param retryCount Current retry attempt (0-based)
   */
  const saveWithRetry = async (retryCount = 0): Promise<void> => {
    // Serialize with Uint8Array -> base64 conversion
    const state: StoredAuthState = {
      creds: serializeState(creds) as Record<string, unknown>,
      keys: serializeState(keys) as Record<string, Record<string, unknown>>,
    }
    const result = await saveAuthState(state)

    if (!result.ok) {
      if (retryCount < MAX_RETRIES) {
        logger.warn('Auth state save failed, retrying...', {
          event: 'auth_state_save_retry',
          attempt: retryCount + 1,
          maxRetries: MAX_RETRIES,
          error: result.error,
        })
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)))
        return saveWithRetry(retryCount + 1)
      }
      logger.error('Failed to save auth state after retries', {
        event: 'auth_state_save_failed',
        attempts: retryCount + 1,
        error: result.error,
      })
    }
  }

  /**
   * Save credentials and keys to Supabase.
   * Debounced to prevent race conditions during rapid updates.
   * Called by Baileys on credential updates.
   */
  const saveCreds = async (): Promise<void> => {
    // If save is already in progress, mark as pending and return
    if (saveInProgress) {
      pendingSave = true
      return
    }

    // Clear any existing debounce timeout
    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }

    // Debounce: wait for updates to settle before saving
    saveTimeout = setTimeout(async () => {
      saveInProgress = true
      pendingSave = false

      try {
        await saveWithRetry()
      } finally {
        saveInProgress = false
        // If more updates came in while saving, save again
        if (pendingSave) {
          pendingSave = false
          await saveCreds()
        }
      }
    }, DEBOUNCE_MS)
  }

  return {
    state: {
      creds,
      keys: {
        /**
         * Get signal keys by type and IDs.
         * Handles special deserialization for app-state-sync-key.
         */
        get: async <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[]
        ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {}
          const typeData = (keys[type] as Record<string, unknown>) || {}

          for (const id of ids) {
            const value = typeData[id]
            if (value !== undefined && value !== null) {
              // Special handling for app-state-sync-key
              if (type === 'app-state-sync-key' && typeof value === 'object') {
                data[id] = proto.Message.AppStateSyncKeyData.fromObject(
                  value as Record<string, unknown>
                ) as unknown as SignalDataTypeMap[T]
              } else {
                data[id] = value as SignalDataTypeMap[T]
              }
            }
          }

          return data
        },

        /**
         * Set signal keys by type.
         * Saves all keys to Supabase after update.
         */
        set: async (
          data: { [T in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[T] } }
        ): Promise<void> => {
          for (const category in data) {
            const categoryKey = category as keyof SignalDataTypeMap
            const categoryData = data[categoryKey]
            if (categoryData) {
              keys[categoryKey] = keys[categoryKey] || {}
              for (const id in categoryData) {
                ;(keys[categoryKey] as Record<string, unknown>)[id] = categoryData[id]
              }
            }
          }
          await saveCreds()
        },
      },
    },
    saveCreds,
  }
}
