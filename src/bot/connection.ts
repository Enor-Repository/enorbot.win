import makeWASocket, {
  DisconnectReason,
  Browsers,
  type WASocket,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import { logger } from '../utils/logger.js'
import { calculateBackoff, NOTIFICATION_THRESHOLD_MS, MAX_RECONNECT_TIME_MS } from '../utils/backoff.js'
import {
  setConnectionStatus,
  incrementReconnectAttempts,
  getDisconnectedDuration,
  getState,
  setNotificationSent,
  getOperationalStatus,
  getPauseInfo,
  isGroupPaused,
  wasAuthStateEverLoaded,
} from './state.js'
import {
  queueControlNotification,
  clearNotificationQueue,
  initializeNotifications,
  sendStartupNotification,
  sendReconnectNotification,
  sendDisconnectNotification,
} from './notifications.js'
import { useSupabaseAuthState } from './authState.js'
import { clearAuthState, checkSupabaseHealth } from '../services/supabase.js'
import { routeMessage, isControlGroupMessage, type RouterContext } from './router.js'
import { handleControlMessage, registerKnownGroup } from '../handlers/control.js'
import { handlePriceMessage } from '../handlers/price.js'
import type { EnvConfig } from '../types/config.js'
import {
  classifyWhatsAppError,
  logClassifiedError,
  recordFailure,
  logErrorEscalation,
} from '../services/errors.js'
import { triggerAutoPause } from '../services/autoPause.js'
import { recordTransientError, recordSuccessfulOperation } from '../services/transientErrors.js'
// Story 5.2/5.3: Excel logging and queue services
import { initExcelService } from '../services/excel.js'
import { initLogQueue, startPeriodicSync } from '../services/logQueue.js'
import { isExcelLoggingConfigured } from '../types/config.js'

let sock: WASocket | null = null

/**
 * In-memory cache for group metadata to avoid repeated API calls.
 * Key: groupId, Value: group subject (name)
 * Persists for session lifetime - group names rarely change.
 */
const groupMetadataCache = new Map<string, string>()

/**
 * Create and initialize WhatsApp connection using pairing code authentication.
 * CRITICAL: Uses pairing code, NOT QR code.
 */
export async function createConnection(config: EnvConfig): Promise<WASocket> {
  logger.info('Attempting connection...', { event: 'connection_attempt' })
  setConnectionStatus('connecting')

  // Story 5.4 AC3: Health check before reconnection
  // Verify Supabase is reachable before attempting to load auth state
  const healthResult = await checkSupabaseHealth()
  if (!healthResult.ok) {
    logger.warn('Delaying reconnection - Supabase unreachable', {
      event: 'connection_delayed_no_db',
      error: healthResult.error,
    })
    setConnectionStatus('disconnected')

    // Schedule retry with exponential backoff
    const attempt = getState().reconnectAttempts
    const delayMs = calculateBackoff(attempt)
    incrementReconnectAttempts()

    logger.info('Scheduling reconnection after health check failure', {
      event: 'reconnect_scheduled_health_fail',
      attempt: attempt + 1,
      delayMs,
    })

    setTimeout(() => createConnection(config), delayMs)
    return null as unknown as WASocket // Return placeholder, actual socket created on retry
  }

  // Load auth state from Supabase (persists across restarts)
  const { state, saveCreds } = await useSupabaseAuthState()

  sock = makeWASocket({
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false, // Skip full history sync to receive messages immediately
  })

  // Handle credential updates
  sock.ev.on('creds.update', saveCreds)

  // Handle connection updates
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    // Request pairing code when QR is presented
    if (qr && !state.creds.registered) {
      // Story 5.4 AC6: Prevent pairing if we previously had auth but lost database connectivity
      // This avoids creating a session conflict when the database recovers
      if (wasAuthStateEverLoaded()) {
        const healthCheck = await checkSupabaseHealth()
        if (!healthCheck.ok) {
          logger.warn('Auth state unavailable - waiting for database recovery', {
            event: 'pairing_prevented_db_down',
            reason: 'Had previous auth session, cannot reach database',
            healthError: healthCheck.error,
          })
          queueControlNotification('Auth state lost - waiting for database recovery (not re-pairing)')
          // Schedule reconnection retry instead of pairing
          const attempt = getState().reconnectAttempts
          const delayMs = calculateBackoff(attempt)
          incrementReconnectAttempts()
          setTimeout(() => createConnection(config), delayMs)
          return
        }
      }

      logger.info('Requesting pairing code', { event: 'pairing_code_request' })
      try {
        const code = await sock!.requestPairingCode(config.PHONE_NUMBER)
        logger.info('Pairing code generated', {
          event: 'pairing_code',
          code,
          instructions: 'Enter this code in WhatsApp > Linked Devices > Link a Device',
        })
      } catch (error) {
        logger.error('Failed to request pairing code', {
          event: 'pairing_code_error',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (connection === 'close') {
      setConnectionStatus('disconnected')
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode

      // Story 3.1: Classify WhatsApp disconnect error (handle undefined statusCode)
      const classification = statusCode !== undefined
        ? classifyWhatsAppError(statusCode)
        : 'transient'  // Unknown disconnect defaults to transient
      const disconnectType = statusCode !== undefined
        ? (DisconnectReason[statusCode] || 'unknown_disconnect')
        : 'connection_closed_no_reason'

      logClassifiedError({
        type: disconnectType,
        classification,
        source: 'whatsapp',
        timestamp: new Date().toISOString(),
        context: { statusCode: statusCode ?? null },
      })

      // Story 3.1 AC2: Track transient failures for escalation
      if (classification === 'transient') {
        recordFailure('whatsapp')

        // Story 3.3: Track transient error in sliding window for escalation
        const { shouldEscalate, count } = recordTransientError('whatsapp')
        if (shouldEscalate) {
          logErrorEscalation('whatsapp', count)
          triggerAutoPause(
            `WhatsApp disconnects (${count} in 60s)`,
            { source: 'whatsapp', isTransientEscalation: true, statusCode: statusCode ?? null }
          )
        }
      }

      // Story 3.2: Trigger auto-pause on critical WhatsApp disconnect
      if (classification === 'critical') {
        triggerAutoPause(
          `WhatsApp ${disconnectType}`,
          { source: 'whatsapp', statusCode: statusCode ?? null }
        )
      }

      logger.warn('Connection closed', {
        event: 'connection_close',
        statusCode: statusCode ?? null,
        reason: disconnectType,
        classification,
      })

      // Handle reconnection based on disconnect reason
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      if (shouldReconnect) {
        const attempt = incrementReconnectAttempts()
        const disconnectedDuration = getDisconnectedDuration()

        // Check if we've exceeded max recovery time (NFR3: 60 seconds)
        if (disconnectedDuration && disconnectedDuration > MAX_RECONNECT_TIME_MS) {
          logger.error('Max reconnection time exceeded, exiting for PM2 restart', {
            event: 'max_reconnect_exceeded',
            disconnectedDuration,
            maxAllowed: MAX_RECONNECT_TIME_MS,
            attempts: attempt,
          })
          process.exit(1)
        }

        // Check for prolonged disconnection notification (NFR4: 30 seconds)
        // Story 4.4 AC2: Send disconnect notification after 30s threshold
        if (disconnectedDuration && disconnectedDuration > NOTIFICATION_THRESHOLD_MS) {
          if (!getState().notificationSent) {
            sendDisconnectNotification(Math.round(disconnectedDuration / 1000))
            setNotificationSent(true)
          }
        }

        // Calculate exponential backoff delay (attempt is 1-indexed from increment)
        const delayMs = calculateBackoff(attempt - 1)
        logger.info('Scheduling reconnection', {
          event: 'reconnect_scheduled',
          attempt,
          delayMs,
        })
        setTimeout(() => createConnection(config), delayMs)
      } else {
        // Clear invalid auth state so next restart prompts fresh authentication
        const clearResult = await clearAuthState()
        if (!clearResult.ok) {
          logger.warn('Failed to clear auth state after logout', {
            event: 'auth_clear_failed',
            error: clearResult.error,
          })
        }
        logger.error('Logged out - auth state cleared, re-authentication required on restart', {
          event: 'logged_out',
        })
      }
    } else if (connection === 'open') {
      // Check if this is a reconnection (attempts > 0 before we reset)
      const wasReconnecting = getState().reconnectAttempts > 0
      const totalDowntimeMs = getDisconnectedDuration()

      setConnectionStatus('connected')

      // Story 3.3: Record successful operation (resets both consecutive and transient error counters)
      recordSuccessfulOperation('whatsapp')

      // Story 4.4: Initialize notifications with socket and control group
      // Note: Control group ID is discovered dynamically when first message is routed
      // Notifications will be initialized when control group is identified in router.ts

      // Story 5.2/5.3: Initialize Excel logging and queue services
      // Issues 5.2.2, 5.3.1, 5.3.2 fix: Call init functions at startup
      if (isExcelLoggingConfigured(config)) {
        initLogQueue()
        initExcelService()
        startPeriodicSync()
        logger.info('Excel logging services initialized', { event: 'excel_services_init' })
      }

      if (wasReconnecting) {
        logger.info('Reconnected to WhatsApp', {
          event: 'reconnected',
          totalDowntimeMs,
        })
        // Story 4.4 AC3: Send reconnect notification FIRST, then clear old queued notifications
        // Order matters: reconnect notification is more important than stale queued messages
        sendReconnectNotification()
        clearNotificationQueue()
      } else {
        logger.info('Connected to WhatsApp', { event: 'connection_open' })
        // Story 4.4 AC1: Send startup notification on first connection
        sendStartupNotification()
      }
    }
  })

  // Handle incoming messages - route to appropriate handler
  // Capture sock reference for use in async handler (avoids non-null assertion issues)
  const currentSock = sock

  currentSock.ev.on('messages.upsert', async (m) => {
    try {
      // Only process real-time notifications, not history sync
      // 'notify' = new message received in real-time
      // 'append'/'prepend' = historical messages during sync
      if (m.type !== 'notify') return

      const msg = m.messages[0]
      if (!msg?.message) return // Ignore empty messages

      const groupId = msg.key.remoteJid || ''

      // Only process group messages (JIDs ending with @g.us)
      if (!groupId.endsWith('@g.us')) return

      // Extract message text from various message types
      const messageText =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        ''

      // Skip empty messages
      if (!messageText.trim()) return

      const sender = msg.key.participant || msg.key.remoteJid || ''

      // Get group name from cache or fetch from metadata (with caching)
      let groupName = groupMetadataCache.get(groupId)

      if (groupName === undefined) {
        // Not in cache - fetch from WhatsApp API
        try {
          const groupMetadata = await currentSock.groupMetadata(groupId)
          groupName = groupMetadata.subject || ''
          // Cache the result for future messages
          groupMetadataCache.set(groupId, groupName)
          logger.info('Group metadata cached', {
            event: 'group_metadata_cached',
            groupId,
            groupName,
          })
        } catch {
          // CRITICAL: If metadata fetch fails and we have no cache,
          // we cannot safely determine if this is control group.
          // Skip message to avoid misrouting (AC2 compliance).
          logger.warn('Could not fetch group metadata, skipping message', {
            event: 'group_metadata_error',
            groupId,
          })
          return
        }
      }

      // Determine if control group by pattern matching
      const isControlGroup = isControlGroupMessage(groupName, config.CONTROL_GROUP_PATTERN)

      // Story 4.1: Register group for fuzzy matching in control commands
      if (!isControlGroup) {
        registerKnownGroup(groupId, groupName)
      }

      const context: RouterContext = {
        groupId,
        groupName,
        message: messageText,
        sender,
        isControlGroup,
        sock: currentSock,
      }

      logger.info('Message received', {
        event: 'message_received',
        groupId,
        groupName,
        isControlGroup,
        // DO NOT log message content for privacy
      })

      const route = routeMessage(context)

      logger.info('Message routed', {
        event: 'message_routed',
        destination: route.destination,
        groupId,
        hasTrigger: route.context.hasTrigger,
      })

      // Story 3.2 + 4.1: Check pause state BEFORE dispatching to handlers
      // Control group messages are STILL routed when paused (for Epic 4 resume commands)
      // Check both: error-auto-pause (operationalStatus) AND per-group pause (isGroupPaused)
      if (!isControlGroup) {
        // Check error-auto-pause (Story 3.2)
        if (getOperationalStatus() === 'paused') {
          const { reason } = getPauseInfo()
          logger.info('Message ignored - bot paused (error state)', {
            event: 'message_ignored_paused',
            groupId,
            messagePreview: messageText.substring(0, 20),
            pauseReason: reason,
          })
          return // Silent - don't respond
        }

        // Check per-group pause (Story 4.1)
        if (isGroupPaused(groupId)) {
          logger.info('Message ignored - group paused', {
            event: 'message_ignored_group_paused',
            groupId,
            groupName,
            messagePreview: messageText.substring(0, 20),
          })
          return // Silent - don't respond
        }
      }

      // Dispatch to handler based on route destination
      if (route.destination === 'CONTROL_HANDLER') {
        await handleControlMessage(context)
      } else if (route.destination === 'PRICE_HANDLER') {
        await handlePriceMessage(context)
      }
      // IGNORE destination: no action (reserved for future use)
    } catch (error) {
      // Top-level error handler to prevent message processing crashes
      logger.error('Error processing message', {
        event: 'message_processing_error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  return sock
}

/**
 * Get the current socket instance.
 */
export function getSocket(): WASocket | null {
  return sock
}
