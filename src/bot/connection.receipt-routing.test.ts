import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvConfig } from '../types/config.js'

const registeredHandlers = vi.hoisted(() => ({} as Record<string, (...args: any[]) => Promise<void> | void>))
const mockRouteMessage = vi.hoisted(() => vi.fn())
const mockLogMessageToHistory = vi.hoisted(() => vi.fn())
const mockHandleReceipt = vi.hoisted(() => vi.fn())

const mockSocket = vi.hoisted(() => ({
  ev: {
    on: vi.fn((event: string, handler: (...args: any[]) => Promise<void> | void) => {
      registeredHandlers[event] = handler
    }),
  },
  groupMetadata: vi.fn(async () => ({ subject: 'OTC LIQD > eNor' })),
  requestPairingCode: vi.fn(async () => '123456'),
}))

const mockMakeWASocket = vi.hoisted(() => vi.fn(() => mockSocket))

vi.mock('@whiskeysockets/baileys', () => ({
  default: () => mockMakeWASocket(),
  DisconnectReason: { loggedOut: 401 },
  Browsers: { ubuntu: vi.fn(() => 'Chrome') },
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../utils/backoff.js', () => ({
  calculateBackoff: vi.fn(() => 1000),
  NOTIFICATION_THRESHOLD_MS: 30000,
  MAX_RECONNECT_TIME_MS: 60000,
}))

vi.mock('./state.js', () => ({
  setConnectionStatus: vi.fn(),
  incrementReconnectAttempts: vi.fn(() => 1),
  getDisconnectedDuration: vi.fn(() => null),
  getState: vi.fn(() => ({ reconnectAttempts: 0, notificationSent: false })),
  setNotificationSent: vi.fn(),
  getOperationalStatus: vi.fn(() => 'running'),
  getPauseInfo: vi.fn(() => ({ reason: 'test' })),
  wasAuthStateEverLoaded: vi.fn(() => false),
}))

vi.mock('./notifications.js', () => ({
  queueControlNotification: vi.fn(),
  clearNotificationQueue: vi.fn(),
  initializeNotifications: vi.fn(),
  sendStartupNotification: vi.fn(),
  sendReconnectNotification: vi.fn(),
  sendDisconnectNotification: vi.fn(),
}))

vi.mock('./authState.js', () => ({
  useSupabaseAuthState: vi.fn(async () => ({
    state: { creds: { registered: true } },
    saveCreds: vi.fn(),
  })),
}))

vi.mock('../services/supabase.js', () => ({
  clearAuthState: vi.fn(async () => ({ ok: true })),
  checkSupabaseHealth: vi.fn(async () => ({ ok: true })),
}))

vi.mock('./router.js', () => ({
  routeMessage: (...args: unknown[]) => mockRouteMessage(...args),
  isControlGroupMessage: vi.fn(() => false),
}))

vi.mock('../handlers/control.js', () => ({
  handleControlMessage: vi.fn(async () => undefined),
}))

vi.mock('../handlers/price.js', () => ({
  handlePriceMessage: vi.fn(async () => undefined),
}))

vi.mock('../handlers/tronscan.js', () => ({
  handleTronscanMessage: vi.fn(async () => undefined),
}))

vi.mock('../services/groupConfig.js', () => ({
  ensureGroupRegistered: vi.fn(async () => ({ ok: true })),
  getGroupModeSync: vi.fn(() => 'active'),
  isIgnoredPlayer: vi.fn(() => false),
}))

vi.mock('../services/systemTriggerReconciler.js', () => ({
  scheduleSystemTriggerReconciliation: vi.fn(),
}))

vi.mock('../utils/messaging.js', () => ({
  sendWithAntiDetection: vi.fn(async () => undefined),
}))

vi.mock('../services/errors.js', () => ({
  classifyWhatsAppError: vi.fn(() => 'transient'),
  logClassifiedError: vi.fn(),
  recordFailure: vi.fn(),
  logErrorEscalation: vi.fn(),
}))

vi.mock('../services/autoPause.js', () => ({
  triggerAutoPause: vi.fn(),
}))

vi.mock('../services/transientErrors.js', () => ({
  recordTransientError: vi.fn(() => ({ shouldEscalate: false, count: 0 })),
  recordSuccessfulOperation: vi.fn(),
}))

vi.mock('../services/excel.js', () => ({
  initExcelService: vi.fn(),
}))

vi.mock('../services/logQueue.js', () => ({
  initLogQueue: vi.fn(),
  startPeriodicSync: vi.fn(),
  queueObservationEntry: vi.fn(),
  setAppendObservationRowFn: vi.fn(),
}))

vi.mock('../types/config.js', () => ({
  isExcelLoggingConfigured: vi.fn(() => false),
  isObservationLoggingConfigured: vi.fn(() => false),
}))

vi.mock('../services/messageHistory.js', () => ({
  initMessageHistory: vi.fn(),
  logMessageToHistory: (...args: unknown[]) => mockLogMessageToHistory(...args),
}))

vi.mock('../services/responseSuppression.js', () => ({
  shouldSuppressResponse: vi.fn(async () => ({ shouldSuppress: false })),
}))

vi.mock('../services/activeQuotes.js', () => ({
  getActiveQuote: vi.fn(() => null),
}))

vi.mock('../services/messageClassifier.js', () => ({
  classifyMessage: vi.fn(() => ({
    messageType: 'general',
    triggerPattern: null,
    volumeBrl: null,
    volumeUsdt: null,
  })),
  inferPlayerRole: vi.fn(() => 'client'),
}))

vi.mock('../services/conversationTracker.js', () => ({
  resolveThreadId: vi.fn(() => 'thread-1'),
}))

vi.mock('../services/excelObservation.js', () => ({
  logObservation: vi.fn(async () => ({ ok: true })),
  createObservationEntry: vi.fn(() => ({ id: 'obs-1' })),
  appendObservationRowDirect: vi.fn(),
}))

vi.mock('../services/volatilityMonitor.js', () => ({
  initializeVolatilityMonitor: vi.fn(),
}))

vi.mock('../handlers/receipt.js', () => ({
  handleReceipt: (...args: unknown[]) => mockHandleReceipt(...args),
}))

import { createConnection } from './connection.js'

const TEST_CONFIG = {
  PHONE_NUMBER: '5511999999999',
  CONTROL_GROUP_PATTERN: 'CONTROLE',
} as unknown as EnvConfig

describe('connection receipt routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const event of Object.keys(registeredHandlers)) {
      delete registeredHandlers[event]
    }

    mockRouteMessage.mockResolvedValue({
      destination: 'RECEIPT_HANDLER',
      context: {
        groupId: '120363421013716073@g.us',
        groupName: 'OTC LIQD > eNor',
        message: '',
        sender: '5511999999999@s.whatsapp.net',
        senderName: 'Alice',
        isControlGroup: false,
        sock: mockSocket,
        isReceipt: true,
        receiptType: 'pdf',
        hasTrigger: false,
      },
    })
    mockHandleReceipt.mockResolvedValue({ ok: true, data: { receiptId: 'r1' } })
  })

  it('processes media-only receipts without text and dispatches RECEIPT_HANDLER', async () => {
    await createConnection(TEST_CONFIG)
    const upsert = registeredHandlers['messages.upsert']
    expect(upsert).toBeDefined()

    await upsert({
      type: 'notify',
      messages: [{
        key: {
          id: 'msg-1',
          remoteJid: '120363421013716073@g.us',
          participant: '5511999999999@s.whatsapp.net',
        },
        pushName: 'Alice',
        message: {
          documentMessage: {
            mimetype: 'application/pdf',
          },
        },
      }],
    })

    expect(mockRouteMessage).toHaveBeenCalledTimes(1)
    expect(mockRouteMessage.mock.calls[0]?.[1]).toMatchObject({
      documentMessage: { mimetype: 'application/pdf' },
    })

    expect(mockHandleReceipt).toHaveBeenCalledTimes(1)
    expect(mockLogMessageToHistory).toHaveBeenCalledWith(expect.objectContaining({
      messageType: 'document',
      content: '[document]',
    }))
  })

  it('still skips messages that are both empty text and media-empty', async () => {
    await createConnection(TEST_CONFIG)
    const upsert = registeredHandlers['messages.upsert']
    expect(upsert).toBeDefined()

    await upsert({
      type: 'notify',
      messages: [{
        key: {
          id: 'msg-2',
          remoteJid: '120363421013716073@g.us',
          participant: '5511999999999@s.whatsapp.net',
        },
        pushName: 'Alice',
        message: {},
      }],
    })

    expect(mockRouteMessage).not.toHaveBeenCalled()
    expect(mockHandleReceipt).not.toHaveBeenCalled()
  })
})
