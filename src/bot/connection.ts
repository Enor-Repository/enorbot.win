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
import { handleControlMessage } from '../handlers/control.js'
import { ensureGroupRegistered, getGroupModeSync, isIgnoredPlayer } from '../services/groupConfig.js'
import { sendWithAntiDetection } from '../utils/messaging.js'
import { handlePriceMessage } from '../handlers/price.js'
import { handleTronscanMessage } from '../handlers/tronscan.js'
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
import { initLogQueue, startPeriodicSync, queueObservationEntry, setAppendObservationRowFn } from '../services/logQueue.js'
import { isExcelLoggingConfigured, isObservationLoggingConfigured } from '../types/config.js'
// Message history logging to Supabase
import { initMessageHistory, logMessageToHistory } from '../services/messageHistory.js'
// Sprint 5: Response suppression (cooldown + dedup)
import { shouldSuppressResponse } from '../services/responseSuppression.js'
// Phase 3 extension: redirect suppressed price to deal handler during active quotes
import { getActiveQuote } from '../services/activeQuotes.js'
// Story 8.6: Observation logging services
import { classifyMessage, inferPlayerRole } from '../services/messageClassifier.js'
import { resolveThreadId } from '../services/conversationTracker.js'
import { logObservation, createObservationEntry, appendObservationRowDirect } from '../services/excelObservation.js'
// Volatility Protection: Initialize monitor with socket when connected
import { initializeVolatilityMonitor } from '../services/volatilityMonitor.js'

let sock: WASocket | null = null

/**
 * Maximum number of groups to cache metadata for.
 * Prevents unbounded memory growth in long-running sessions.
 */
const GROUP_CACHE_MAX_SIZE = 500

/**
 * In-memory cache for group metadata to avoid repeated API calls.
 * Key: groupId, Value: group subject (name)
 * Persists for session lifetime - group names rarely change.
 * Issue fix: Limited to GROUP_CACHE_MAX_SIZE entries with LRU eviction.
 */
const groupMetadataCache = new Map<string, string>()

/**
 * Add entry to group metadata cache with LRU eviction.
 * When cache exceeds max size, removes the oldest entry (first inserted).
 */
function cacheGroupMetadata(groupId: string, groupName: string): void {
  // If already exists, delete first to update insertion order (move to end)
  if (groupMetadataCache.has(groupId)) {
    groupMetadataCache.delete(groupId)
  }

  // Evict oldest entry if at capacity
  if (groupMetadataCache.size >= GROUP_CACHE_MAX_SIZE) {
    const oldestKey = groupMetadataCache.keys().next().value
    if (oldestKey) {
      groupMetadataCache.delete(oldestKey)
      logger.debug('Group metadata cache evicted oldest entry', {
        event: 'group_cache_eviction',
        evictedGroupId: oldestKey,
        cacheSize: GROUP_CACHE_MAX_SIZE,
      })
    }
  }

  groupMetadataCache.set(groupId, groupName)
}

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

      // Story 8.6: Initialize observation logging service
      if (isObservationLoggingConfigured(config)) {
        setAppendObservationRowFn(appendObservationRowDirect)
        logger.info('Observation logging service initialized', { event: 'observation_services_init' })
      }

      // Initialize message history logging to Supabase
      initMessageHistory(config)
      logger.info('Message history service initialized', { event: 'message_history_init' })

      // Volatility Protection: Initialize monitor with WhatsApp socket for repricing
      initializeVolatilityMonitor(currentSock)
      logger.info('Volatility monitor socket initialized', { event: 'volatility_monitor_init' })

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

      // Skip messages from ignored players (e.g., other bots in the group)
      if (isIgnoredPlayer(groupId, sender)) {
        logger.debug('Message from ignored player skipped', {
          event: 'ignored_player_skipped',
          groupId,
          sender,
        })
        return
      }

      // Extract sender's WhatsApp display name (pushName) if available
      const senderName = msg.pushName || undefined

      // Get group name from cache or fetch from metadata (with caching)
      let groupName = groupMetadataCache.get(groupId)

      if (groupName === undefined) {
        // Not in cache - fetch from WhatsApp API
        try {
          const groupMetadata = await currentSock.groupMetadata(groupId)
          groupName = groupMetadata.subject || ''
          // Cache the result for future messages (with LRU eviction)
          cacheGroupMetadata(groupId, groupName)
          logger.info('Group metadata cached', {
            event: 'group_metadata_cached',
            groupId,
            groupName,
            cacheSize: groupMetadataCache.size,
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

      // Auto-register groups (including control group) with groupConfig service
      // This enables per-group mode management and dashboard visibility
      // Fire-and-forget - don't block message processing
      ensureGroupRegistered(groupId, groupName, sender).catch((e) => {
        logger.warn('Group registration failed', {
          event: 'group_registration_failed',
          groupId,
          error: e instanceof Error ? e.message : String(e),
        })
      })

      const context: RouterContext = {
        groupId,
        groupName,
        message: messageText,
        sender,
        senderName,
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

      const route = await routeMessage(context)

      // Log message to Supabase history (fire-and-forget)
      // Story 7.3 AC6: Pass hasTrigger from router
      logMessageToHistory({
        messageId: msg.key.id || undefined,
        groupJid: groupId,
        groupName,
        senderJid: sender,
        senderName,
        isControlGroup,
        messageType: 'text',
        content: messageText,
        isFromBot: false,
        isTrigger: route.context.hasTrigger ?? false,
      })

      logger.info('Message routed', {
        event: 'message_routed',
        destination: route.destination,
        groupId,
        hasTrigger: route.context.hasTrigger,
      })

      // Story 3.2: Check error auto-pause state BEFORE dispatching to handlers
      // Control group messages are STILL routed when paused (for Epic 4 resume commands)
      // Note: Per-group mode pausing is now handled by the router (getGroupModeSync)
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
      }

      // Dispatch to handler based on route destination
      if (route.destination === 'CONTROL_HANDLER') {
        await handleControlMessage(context)
      } else if (route.destination === 'PRICE_HANDLER') {
        // Sprint 5: Check response suppression before sending price response
        // Only for non-control-group ACTIVE mode. Phased: skipOperatorCheck for now.
        if (!isControlGroup) {
          const suppression = await shouldSuppressResponse({
            groupJid: groupId,
            senderJid: sender,
            messageContent: messageText,
            skipOperatorCheck: true,
          })
          if (suppression.shouldSuppress) {
            logger.info('Price response suppressed', {
              event: 'price_response_suppressed',
              groupId,
              sender,
              reason: suppression.reason,
              explanation: suppression.explanation,
            })

            // Phase 3 extension: don't go silent during active quotes.
            // The trigger match was incidental (e.g., "preço" inside "preço ruim melhora p/ mim").
            // Route to deal handler so operator gets tagged — only for the requester who initiated the quote.
            const activeQuote = getActiveQuote(groupId)
            if (activeQuote && (activeQuote.status === 'pending' || activeQuote.status === 'repricing')
              && sender === activeQuote.requesterJid) {
              logger.info('Suppressed price redirected to deal handler (active quote)', {
                event: 'suppressed_price_active_quote_redirect',
                groupId,
                sender,
                quoteId: activeQuote.id,
                suppressionReason: suppression.reason,
              })
              const { handleDealRouted } = await import('../handlers/deal.js')
              await handleDealRouted({ ...route.context, dealAction: 'unrecognized_input' })
            }

            return // Suppress silently — don't send duplicate response
          }
        }
        await handlePriceMessage(context)
      } else if (route.destination === 'TRONSCAN_HANDLER') {
        // Handle Tronscan transaction links - update Excel row with tx hash
        await handleTronscanMessage(context)
      } else if (route.destination === 'DEAL_HANDLER') {
        // Sprint 9.1: Handle deal flow messages (volume inquiry, price lock, confirmation, etc.)
        const { handleDealRouted } = await import('../handlers/deal.js')
        await handleDealRouted(route.context)
      } else if (route.destination === 'OBSERVE_ONLY') {
        // Training mode: Message was logged above, but no response sent
        logger.debug('Training mode: message observed', {
          event: 'training_mode_observe',
          groupId,
          groupName,
          hasTrigger: route.context.hasTrigger,
        })
      }
      // IGNORE = silence. Operator tagging during active negotiations is handled by
      // the Phase 3 catch-all in router.ts (scoped to requester only).
      // RECEIPT_HANDLER destination: no action in text message handler

      // Story 8.6: Log observation for pattern analysis (fire-and-forget)
      // Skip control group messages and ignored messages
      if (!isControlGroup && route.destination !== 'IGNORE') {
        try {
          const messageTimestamp = new Date()

          // Classify message type
          const classification = classifyMessage(messageText, {
            isFromBot: false,
            hasReceipt: route.context.isReceipt ?? false,
            hasTronscan: route.context.hasTronscan ?? false,
            hasPriceTrigger: route.context.hasTrigger ?? false,
          })

          // Resolve conversation thread (may create new or link to existing)
          const threadId = resolveThreadId({
            groupId,
            senderJid: sender,
            messageType: classification.messageType,
            timestamp: messageTimestamp,
          })

          // Infer player role (basic heuristics for now)
          const playerRole = inferPlayerRole({
            playerJid: sender,
            groupId,
            recentMessages: [], // Empty for now - Story 8.8 will add history
          })

          // Determine if response is required based on route
          const responseRequired = route.destination === 'PRICE_HANDLER' ||
            route.destination === 'RECEIPT_HANDLER' ||
            route.destination === 'TRONSCAN_HANDLER'

          // Create observation entry
          const observation = createObservationEntry({
            groupId,
            groupName,
            playerJid: sender,
            playerName: senderName ?? sender,
            playerRole,
            messageType: classification.messageType,
            triggerPattern: classification.triggerPattern,
            conversationThread: threadId,
            volumeBrl: classification.volumeBrl,
            volumeUsdt: classification.volumeUsdt,
            content: messageText,
            responseRequired,
            // Response fields set by Story 8.7
            responseGiven: null,
            responseTimeMs: null,
            aiUsed: false,
          })

          // Fire-and-forget: don't await, don't block message processing (AC4)
          logObservation(observation)
            .then(result => {
              if (!result.ok) {
                // Queue for retry
                queueObservationEntry(observation)
              }
            })
            .catch(() => {
              // Queue for retry on exception
              queueObservationEntry(observation)
            })

          logger.debug('Observation logged', {
            event: 'observation_logged',
            groupId,
            messageType: classification.messageType,
            threadId,
            playerRole,
          })
        } catch (obsError) {
          // Never let observation logging break message processing
          logger.warn('Observation logging failed', {
            event: 'observation_logging_error',
            error: obsError instanceof Error ? obsError.message : String(obsError),
          })
        }
      }
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
