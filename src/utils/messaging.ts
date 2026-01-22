/**
 * Messaging Utility - Anti-Detection Message Sending
 *
 * Provides human-like message sending with typing indicators
 * and chaotic delays to avoid WhatsApp detection.
 *
 * Flow:
 * 1. Show typing indicator (1-4 seconds, NFR15)
 * 2. Stop typing indicator (paused)
 * 3. Apply chaotic delay (3-15 seconds, NFR14)
 * 4. Send message
 */

import type { WASocket } from '@whiskeysockets/baileys'
import { chaosDelay } from './chaos.js'
import { logger } from './logger.js'
import { type Result, ok, err } from './result.js'

/**
 * Minimum typing indicator duration in milliseconds (NFR15).
 */
export const MIN_TYPING_MS = 1000 // 1 second

/**
 * Maximum typing indicator duration in milliseconds (NFR15).
 */
export const MAX_TYPING_MS = 4000 // 4 seconds

/**
 * Sleep utility - waits for specified milliseconds.
 *
 * @param ms - Milliseconds to wait
 * @returns Promise that resolves after delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Generate random typing duration between MIN and MAX (inclusive).
 *
 * @returns Typing duration in milliseconds
 */
export function getTypingDuration(): number {
  // +1 to make MAX_TYPING_MS inclusive (Math.random() returns [0, 1))
  return Math.floor(MIN_TYPING_MS + Math.random() * (MAX_TYPING_MS - MIN_TYPING_MS + 1))
}

/**
 * Send message with anti-detection behavior.
 *
 * Flow:
 * 1. Show typing indicator (1-4 seconds, NFR15)
 * 2. Stop typing indicator (paused presence)
 * 3. Apply chaotic delay (3-15 seconds from Story 1.5, NFR14)
 * 4. Send message
 *
 * @param sock - WhatsApp socket connection
 * @param jid - Chat JID to send message to
 * @param message - Text message to send
 * @returns Result<void> - success or error message, never throws
 */
export async function sendWithAntiDetection(
  sock: WASocket,
  jid: string,
  message: string
): Promise<Result<void>> {
  // Input validation
  if (!jid || jid.trim() === '') {
    return err('Invalid jid: must be non-empty')
  }
  if (!message || message.trim() === '') {
    return err('Invalid message: must be non-empty')
  }

  try {
    // Step 1: Show typing indicator (AC1, AC2)
    const typingDurationMs = getTypingDuration()
    await sock.sendPresenceUpdate('composing', jid)

    logger.debug('Typing indicator started', {
      event: 'typing_start',
      jid,
      typingDurationMs,
    })

    await sleep(typingDurationMs)

    // Step 2: Stop typing indicator (AC2)
    await sock.sendPresenceUpdate('paused', jid)

    // Step 3: Apply chaotic delay (AC1)
    const chaoticDelayMs = await chaosDelay()

    logger.debug('Anti-detection complete', {
      event: 'anti_detection_complete',
      jid,
      typingDurationMs,
      chaoticDelayMs,
      totalDelayMs: typingDurationMs + chaoticDelayMs,
    })

    // Step 4: Send message (AC1)
    await sock.sendMessage(jid, { text: message })

    logger.info('Message sent', {
      event: 'message_sent',
      jid,
    })

    return ok(undefined)
  } catch (e) {
    // AC3: Error handling with Result type - never throw
    const errorMessage = e instanceof Error ? e.message : 'Unknown error'

    logger.error('Message send failed', {
      event: 'message_error',
      jid,
      error: errorMessage,
    })

    return err(errorMessage)
  }
}
