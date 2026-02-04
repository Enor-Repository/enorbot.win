import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { WASocket } from '@whiskeysockets/baileys'

// ============================================================================
// Mocks
// ============================================================================

const mockGetGroupModeSync = vi.hoisted(() => vi.fn())
const mockMatchTrigger = vi.hoisted(() => vi.fn())

vi.mock('../services/groupConfig.js', () => ({
  getGroupModeSync: mockGetGroupModeSync,
}))

vi.mock('../services/triggerService.js', () => ({
  matchTrigger: mockMatchTrigger,
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import {
  routeMessage,
  isControlGroupMessage,
  detectReceiptType,
  type RouterContext,
  type BaileysMessage,
} from './router.js'
import { RECEIPT_MIME_TYPES } from '../types/handlers.js'

// ============================================================================
// Helpers
// ============================================================================

function makeTrigger(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trigger-1',
    groupJid: '123456789@g.us',
    triggerPhrase: 'preço',
    patternType: 'contains',
    actionType: 'price_quote',
    actionParams: {},
    priority: 100,
    isActive: true,
    isSystem: false,
    scope: 'group',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('routeMessage', () => {
  const mockSock = {} as WASocket

  const baseContext: RouterContext = {
    groupId: '123456789@g.us',
    groupName: 'Test Group',
    message: '',
    sender: 'user@s.whatsapp.net',
    isControlGroup: false,
    sock: mockSock,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetGroupModeSync.mockReturnValue('active')
    mockMatchTrigger.mockResolvedValue({ ok: true, data: null })
  })

  // ---- Trigger detection routing (via matchTrigger) ----

  describe('trigger detection routing', () => {
    it('routes price_quote trigger to PRICE_HANDLER', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger() })
      const context = { ...baseContext, message: 'preço' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('PRICE_HANDLER')
      expect(result.context.hasTrigger).toBe(true)
    })

    it('routes volume_quote trigger to PRICE_HANDLER', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger({ actionType: 'volume_quote' }) })
      const context = { ...baseContext, message: 'compro 10k' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('PRICE_HANDLER')
    })

    it('routes text_response trigger to PRICE_HANDLER', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger({ actionType: 'text_response' }) })
      const context = { ...baseContext, message: 'ajuda' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('PRICE_HANDLER')
    })

    it('routes ai_prompt trigger to PRICE_HANDLER', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger({ actionType: 'ai_prompt' }) })
      const context = { ...baseContext, message: 'pergunta' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('PRICE_HANDLER')
    })

    it('sets hasTrigger and matchedTrigger on context', async () => {
      const trigger = makeTrigger()
      mockMatchTrigger.mockResolvedValue({ ok: true, data: trigger })
      const context = { ...baseContext, message: 'preço' }
      const result = await routeMessage(context)
      expect(result.context.hasTrigger).toBe(true)
      expect(result.context.matchedTrigger).toBeDefined()
      expect(result.context.matchedTrigger?.triggerPhrase).toBe('preço')
    })
  })

  // ---- Delegation actions (deal flow, tronscan) ----

  describe('delegation action routing', () => {
    it('routes deal_cancel to DEAL_HANDLER with cancellation dealAction', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger({ actionType: 'deal_cancel' }) })
      const context = { ...baseContext, message: 'cancela' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('cancellation')
    })

    it('routes deal_lock to DEAL_HANDLER with price_lock dealAction', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger({ actionType: 'deal_lock' }) })
      const context = { ...baseContext, message: 'trava' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('price_lock')
    })

    it('routes deal_confirm to DEAL_HANDLER with confirmation dealAction', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger({ actionType: 'deal_confirm' }) })
      const context = { ...baseContext, message: 'fechado' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('confirmation')
    })

    it('routes deal_volume to DEAL_HANDLER with volume_inquiry dealAction', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger({ actionType: 'deal_volume' }) })
      const context = { ...baseContext, message: '10k' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('volume_inquiry')
    })

    it('routes tronscan_process to TRONSCAN_HANDLER', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger({ actionType: 'tronscan_process' }) })
      const context = { ...baseContext, message: 'https://tronscan.org/#/transaction/abc123' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('TRONSCAN_HANDLER')
    })

    it('routes receipt_process to RECEIPT_HANDLER', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger({ actionType: 'receipt_process' }) })
      const context = { ...baseContext, message: 'comprovante' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('RECEIPT_HANDLER')
    })
  })

  // ---- Non-trigger messages ----

  describe('non-trigger message handling', () => {
    it('routes non-trigger message to IGNORE', async () => {
      const context = { ...baseContext, message: 'hello world' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('IGNORE')
    })

    it('routes empty message to IGNORE', async () => {
      const context = { ...baseContext, message: '' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('IGNORE')
    })

    it('sets hasTrigger: false for non-triggered messages', async () => {
      const context = { ...baseContext, message: 'hello' }
      const result = await routeMessage(context)
      expect(result.context.hasTrigger).toBe(false)
    })
  })

  // ---- Control group routing ----

  describe('control group priority', () => {
    it('routes control group trigger to resolved destination', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger() })
      const context = { ...baseContext, message: 'preço', isControlGroup: true }
      const result = await routeMessage(context)
      expect(result.destination).toBe('PRICE_HANDLER')
      expect(result.context.hasTrigger).toBe(true)
    })

    it('routes control group non-trigger to CONTROL_HANDLER', async () => {
      const context = { ...baseContext, message: 'status', isControlGroup: true }
      const result = await routeMessage(context)
      expect(result.destination).toBe('CONTROL_HANDLER')
      expect(result.context.hasTrigger).toBe(false)
    })

    it('routes control group deal trigger to DEAL_HANDLER', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger({ actionType: 'deal_cancel' }) })
      const context = { ...baseContext, message: 'cancela', isControlGroup: true }
      const result = await routeMessage(context)
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('cancellation')
    })

    it('routes control_command trigger to CONTROL_HANDLER', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger({ actionType: 'control_command', triggerPhrase: 'status' }) })
      const context = { ...baseContext, message: 'status', isControlGroup: true }
      const result = await routeMessage(context)
      expect(result.destination).toBe('CONTROL_HANDLER')
      expect(result.context.hasTrigger).toBe(true)
    })

    it('passes isControlGroup=true to matchTrigger for control groups', async () => {
      const context = { ...baseContext, message: 'status', isControlGroup: true }
      await routeMessage(context)
      expect(mockMatchTrigger).toHaveBeenCalledWith('status', '123456789@g.us', true)
    })

    it('passes isControlGroup=false to matchTrigger for regular groups', async () => {
      const context = { ...baseContext, message: 'preço' }
      await routeMessage(context)
      expect(mockMatchTrigger).toHaveBeenCalledWith('preço', '123456789@g.us', false)
    })
  })

  // ---- Context preservation ----

  describe('context preservation', () => {
    it('preserves original context fields', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger() })
      const context = { ...baseContext, message: 'preço' }
      const result = await routeMessage(context)
      expect(result.context.groupId).toBe('123456789@g.us')
      expect(result.context.groupName).toBe('Test Group')
      expect(result.context.sender).toBe('user@s.whatsapp.net')
    })
  })

})

// ============================================================================
// isControlGroupMessage
// ============================================================================

describe('isControlGroupMessage', () => {
  it('matches exact pattern (case-insensitive)', () => {
    expect(isControlGroupMessage('CONTROLE', 'controle')).toBe(true)
  })

  it('matches pattern in group name', () => {
    expect(isControlGroupMessage('GRUPO DE CONTROLE ENOR', 'CONTROLE')).toBe(true)
  })

  it('returns false when pattern not found', () => {
    expect(isControlGroupMessage('Regular Group', 'CONTROLE')).toBe(false)
  })
})

// ============================================================================
// detectReceiptType
// ============================================================================

describe('detectReceiptType', () => {
  describe('PDF detection', () => {
    it('returns "pdf" for application/pdf MIME type', () => {
      const message: BaileysMessage = {
        documentMessage: { mimetype: RECEIPT_MIME_TYPES.PDF },
      }
      expect(detectReceiptType(message)).toBe('pdf')
    })

    it('returns "pdf" for PDF with filename', () => {
      const message: BaileysMessage = {
        documentMessage: {
          mimetype: 'application/pdf',
          fileName: 'receipt.pdf',
        },
      }
      expect(detectReceiptType(message)).toBe('pdf')
    })
  })

  describe('image detection', () => {
    it('returns "image" for image/jpeg MIME type', () => {
      const message: BaileysMessage = {
        imageMessage: { mimetype: RECEIPT_MIME_TYPES.JPEG },
      }
      expect(detectReceiptType(message)).toBe('image')
    })

    it('returns "image" for image/png MIME type', () => {
      const message: BaileysMessage = {
        imageMessage: { mimetype: RECEIPT_MIME_TYPES.PNG },
      }
      expect(detectReceiptType(message)).toBe('image')
    })

    it('returns "image" for image/webp MIME type', () => {
      const message: BaileysMessage = {
        imageMessage: { mimetype: RECEIPT_MIME_TYPES.WEBP },
      }
      expect(detectReceiptType(message)).toBe('image')
    })
  })

  describe('non-receipt messages', () => {
    it('returns null for undefined message', () => {
      expect(detectReceiptType(undefined)).toBeNull()
    })

    it('returns null for empty message', () => {
      expect(detectReceiptType({})).toBeNull()
    })

    it('returns null for unsupported document type', () => {
      const message: BaileysMessage = {
        documentMessage: { mimetype: 'application/msword' },
      }
      expect(detectReceiptType(message)).toBeNull()
    })

    it('returns null for unsupported image type', () => {
      const message: BaileysMessage = {
        imageMessage: { mimetype: 'image/gif' },
      }
      expect(detectReceiptType(message)).toBeNull()
    })
  })
})

// ============================================================================
// Receipt routing
// ============================================================================

describe('routeMessage receipt routing', () => {
  const mockSock = {} as WASocket

  const baseContext: RouterContext = {
    groupId: '123456789@g.us',
    groupName: 'Test Group',
    message: '',
    sender: 'user@s.whatsapp.net',
    isControlGroup: false,
    sock: mockSock,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetGroupModeSync.mockReturnValue('active')
    mockMatchTrigger.mockResolvedValue({ ok: true, data: null })
  })

  it('routes PDF document to RECEIPT_HANDLER', async () => {
    const context = { ...baseContext }
    const baileysMessage: BaileysMessage = {
      documentMessage: { mimetype: 'application/pdf' },
    }
    const result = await routeMessage(context, baileysMessage)

    expect(result.destination).toBe('RECEIPT_HANDLER')
    expect(result.context.isReceipt).toBe(true)
    expect(result.context.receiptType).toBe('pdf')
  })

  it('routes JPEG image to RECEIPT_HANDLER', async () => {
    const context = { ...baseContext }
    const baileysMessage: BaileysMessage = {
      imageMessage: { mimetype: 'image/jpeg' },
    }
    const result = await routeMessage(context, baileysMessage)

    expect(result.destination).toBe('RECEIPT_HANDLER')
    expect(result.context.isReceipt).toBe(true)
    expect(result.context.receiptType).toBe('image')
  })

  it('routes control group PDF to CONTROL_HANDLER, NOT receipt handler', async () => {
    const context = { ...baseContext, isControlGroup: true }
    const baileysMessage: BaileysMessage = {
      documentMessage: { mimetype: 'application/pdf' },
    }
    const result = await routeMessage(context, baileysMessage)

    expect(result.destination).toBe('CONTROL_HANDLER')
    expect(result.context.isReceipt).toBe(false)
    expect(result.context.receiptType).toBeNull()
  })

  it('routes unsupported document type to IGNORE', async () => {
    const context = { ...baseContext }
    const baileysMessage: BaileysMessage = {
      documentMessage: { mimetype: 'application/msword' },
    }
    const result = await routeMessage(context, baileysMessage)

    expect(result.destination).toBe('IGNORE')
    expect(result.context.isReceipt).toBe(false)
  })
})

// ============================================================================
// Per-group mode routing
// ============================================================================

describe('routeMessage per-group modes', () => {
  const mockSock = {} as WASocket

  const baseContext: RouterContext = {
    groupId: '123456789@g.us',
    groupName: 'Test Group',
    message: '',
    sender: 'user@s.whatsapp.net',
    isControlGroup: false,
    sock: mockSock,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockMatchTrigger.mockResolvedValue({ ok: true, data: null })
  })

  describe('PAUSED mode', () => {
    beforeEach(() => {
      mockGetGroupModeSync.mockReturnValue('paused')
    })

    it('routes any message to IGNORE when paused', async () => {
      const context = { ...baseContext, message: 'preço' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('IGNORE')
    })

    it('routes receipt to IGNORE when paused', async () => {
      const context = { ...baseContext }
      const baileysMessage: BaileysMessage = {
        documentMessage: { mimetype: 'application/pdf' },
      }
      const result = await routeMessage(context, baileysMessage)
      expect(result.destination).toBe('IGNORE')
    })
  })

  describe('LEARNING mode', () => {
    beforeEach(() => {
      mockGetGroupModeSync.mockReturnValue('learning')
    })

    it('routes to OBSERVE_ONLY when learning', async () => {
      const context = { ...baseContext, message: 'preço' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('OBSERVE_ONLY')
    })

    it('routes receipt to OBSERVE_ONLY when learning', async () => {
      const context = { ...baseContext }
      const baileysMessage: BaileysMessage = {
        documentMessage: { mimetype: 'application/pdf' },
      }
      const result = await routeMessage(context, baileysMessage)
      expect(result.destination).toBe('OBSERVE_ONLY')
    })
  })

  describe('ASSISTED mode', () => {
    beforeEach(() => {
      mockGetGroupModeSync.mockReturnValue('assisted')
    })

    it('routes to OBSERVE_ONLY when assisted', async () => {
      const context = { ...baseContext, message: 'preço' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('OBSERVE_ONLY')
    })
  })

  describe('ACTIVE mode', () => {
    beforeEach(() => {
      mockGetGroupModeSync.mockReturnValue('active')
    })

    it('routes trigger match to PRICE_HANDLER', async () => {
      mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger() })
      const context = { ...baseContext, message: 'preço' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('PRICE_HANDLER')
    })

    it('routes non-trigger to IGNORE', async () => {
      const context = { ...baseContext, message: 'hello' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('IGNORE')
    })

    it('routes receipt to RECEIPT_HANDLER', async () => {
      const context = { ...baseContext }
      const baileysMessage: BaileysMessage = {
        documentMessage: { mimetype: 'application/pdf' },
      }
      const result = await routeMessage(context, baileysMessage)
      expect(result.destination).toBe('RECEIPT_HANDLER')
    })
  })

  describe('Control group ignores mode', () => {
    it('routes control group trigger even when paused', async () => {
      mockGetGroupModeSync.mockReturnValue('paused')
      mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger() })
      const context = { ...baseContext, message: 'preço', isControlGroup: true }
      const result = await routeMessage(context)
      expect(result.destination).toBe('PRICE_HANDLER')
    })

    it('routes control group non-trigger to CONTROL_HANDLER when learning', async () => {
      mockGetGroupModeSync.mockReturnValue('learning')
      const context = { ...baseContext, message: 'status', isControlGroup: true }
      const result = await routeMessage(context)
      expect(result.destination).toBe('CONTROL_HANDLER')
    })
  })

  // ---- Error handling ----

  describe('matchTrigger error handling', () => {
    beforeEach(() => {
      mockGetGroupModeSync.mockReturnValue('active')
    })

    it('routes to OBSERVE_ONLY when matchTrigger throws in active mode', async () => {
      mockMatchTrigger.mockRejectedValue(new Error('DB connection failed'))
      const context = { ...baseContext, message: 'hello' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('OBSERVE_ONLY')
    })

    it('routes to CONTROL_HANDLER when matchTrigger throws in control group', async () => {
      mockMatchTrigger.mockRejectedValue(new Error('DB connection failed'))
      const context = { ...baseContext, message: 'status', isControlGroup: true }
      const result = await routeMessage(context)
      expect(result.destination).toBe('CONTROL_HANDLER')
    })
  })
})
