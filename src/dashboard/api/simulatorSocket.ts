/**
 * Simulator Mock WASocket Factory
 *
 * Creates a minimal mock socket that captures all sendMessage calls
 * for the WhatsApp message simulator. Implements only the WASocket
 * methods that the bot pipeline actually uses.
 */
import type { WASocket } from '@whiskeysockets/baileys'

export interface CapturedMessage {
  jid: string
  text: string
  mentions: string[]
  timestamp: number
}

export interface MockSocketResult {
  sock: WASocket
  getCapturedMessages: () => CapturedMessage[]
}

/**
 * Create a mock WASocket that captures outbound messages.
 * The socket has `_simulatorMode: true` so `sendWithAntiDetection`
 * skips all delays (typing indicator + chaos delay).
 */
export function createMockSocket(groupId: string, groupName: string): MockSocketResult {
  const captured: CapturedMessage[] = []

  const sock = {
    // Flag checked by sendWithAntiDetection to skip delays
    _simulatorMode: true,

    // Capture outbound messages
    sendMessage: async (jid: string, payload: { text?: string; mentions?: string[] }) => {
      captured.push({
        jid,
        text: payload.text || '',
        mentions: payload.mentions || [],
        timestamp: Date.now(),
      })
      return { status: 1 }
    },

    // No-op presence updates
    sendPresenceUpdate: async () => {},

    // Return mock group metadata
    groupMetadata: async (gid: string) => ({
      id: gid,
      subject: gid === groupId ? groupName : 'Unknown Group',
      participants: [],
    }),
  } as unknown as WASocket

  return {
    sock,
    getCapturedMessages: () => captured,
  }
}
