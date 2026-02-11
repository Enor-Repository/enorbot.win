import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { WASocket } from '@whiskeysockets/baileys'

// ============================================================================
// Mocks
// ============================================================================

const mockGetGroupModeSync = vi.hoisted(() => vi.fn())
const mockMatchTrigger = vi.hoisted(() => vi.fn())
const mockGetActiveDealForSender = vi.hoisted(() => vi.fn())
const mockGetSpreadConfig = vi.hoisted(() => vi.fn())
const mockGetKeywordsForPatternSync = vi.hoisted(() => vi.fn())
const mockParseBrazilianNumber = vi.hoisted(() => vi.fn())
const mockGetActiveQuote = vi.hoisted(() => vi.fn())
const mockForceAccept = vi.hoisted(() => vi.fn())

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

vi.mock('../services/dealFlowService.js', () => ({
  getActiveDealForSender: mockGetActiveDealForSender,
}))

vi.mock('../services/groupSpreadService.js', () => ({
  getSpreadConfig: mockGetSpreadConfig,
}))

vi.mock('../services/systemPatternService.js', () => ({
  getKeywordsForPatternSync: mockGetKeywordsForPatternSync,
}))

vi.mock('../services/dealComputation.js', () => ({
  parseBrazilianNumber: mockParseBrazilianNumber,
}))

vi.mock('../services/activeQuotes.js', () => ({
  getActiveQuote: mockGetActiveQuote,
  forceAccept: mockForceAccept,
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
    // Default: classic mode (intercept skipped)
    mockGetSpreadConfig.mockResolvedValue({ ok: true, data: { dealFlowMode: 'classic' } })
    mockGetActiveDealForSender.mockResolvedValue({ ok: true, data: null })
    mockGetKeywordsForPatternSync.mockReturnValue(['trava', 'lock', 'travar'])
    mockParseBrazilianNumber.mockReturnValue(null)
    mockGetActiveQuote.mockReturnValue(null)
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
    mockGetSpreadConfig.mockResolvedValue({ ok: true, data: { dealFlowMode: 'classic' } })
    mockGetActiveDealForSender.mockResolvedValue({ ok: true, data: null })
    mockGetKeywordsForPatternSync.mockReturnValue(['trava', 'lock', 'travar'])
    mockParseBrazilianNumber.mockReturnValue(null)
    mockGetActiveQuote.mockReturnValue(null)
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
    mockGetSpreadConfig.mockResolvedValue({ ok: true, data: { dealFlowMode: 'classic' } })
    mockGetActiveDealForSender.mockResolvedValue({ ok: true, data: null })
    mockGetKeywordsForPatternSync.mockReturnValue(['trava', 'lock', 'travar'])
    mockParseBrazilianNumber.mockReturnValue(null)
    mockGetActiveQuote.mockReturnValue(null)
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

// ============================================================================
// Sprint 9: Simple Mode Deal-State Intercept
// ============================================================================

describe('routeMessage simple mode intercept', () => {
  const mockSock = {} as WASocket

  const baseContext: RouterContext = {
    groupId: '123456789@g.us',
    groupName: 'Test Group',
    message: '',
    sender: 'client@s.whatsapp.net',
    isControlGroup: false,
    sock: mockSock,
  }

  const MOCK_QUOTED_DEAL = {
    id: 'deal-1',
    clientJid: 'client@s.whatsapp.net',
    state: 'quoted',
    groupJid: '123456789@g.us',
  }

  const MOCK_AWAITING_DEAL = {
    id: 'deal-2',
    clientJid: 'client@s.whatsapp.net',
    state: 'awaiting_amount',
    groupJid: '123456789@g.us',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetGroupModeSync.mockReturnValue('active')
    mockMatchTrigger.mockResolvedValue({ ok: true, data: null })
    // Default: simple mode with lock keywords
    mockGetSpreadConfig.mockResolvedValue({ ok: true, data: { dealFlowMode: 'simple' } })
    mockGetActiveDealForSender.mockResolvedValue({ ok: true, data: null })
    mockGetKeywordsForPatternSync.mockReturnValue(['trava', 'lock', 'travar'])
    mockParseBrazilianNumber.mockReturnValue(null)
    mockGetActiveQuote.mockReturnValue(null)
  })

  // ---- Classic mode: zero behavior change ----

  describe('classic mode regression', () => {
    beforeEach(() => {
      mockGetSpreadConfig.mockResolvedValue({ ok: true, data: { dealFlowMode: 'classic' } })
      mockGetActiveDealForSender.mockResolvedValue({ ok: true, data: MOCK_QUOTED_DEAL })
    })

    it('skips intercept entirely in classic mode even with active deal', async () => {
      const context = { ...baseContext, message: 'trava' }
      const result = await routeMessage(context)
      // Falls through to normal routing → no trigger → IGNORE
      expect(result.destination).toBe('IGNORE')
      expect(result.context.dealAction).toBeUndefined()
    })

    it('does not intercept "off" in classic mode', async () => {
      const context = { ...baseContext, message: 'off' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('IGNORE')
      expect(result.context.dealAction).toBeUndefined()
    })
  })

  // ---- Simple mode: QUOTED state intercepts ----

  describe('simple mode QUOTED state', () => {
    beforeEach(() => {
      mockGetActiveDealForSender.mockResolvedValue({ ok: true, data: MOCK_QUOTED_DEAL })
    })

    it('intercepts "off" → rejection', async () => {
      const context = { ...baseContext, message: 'off' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('rejection')
    })

    it('intercepts "Off" (case insensitive) → rejection', async () => {
      const context = { ...baseContext, message: 'Off' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('rejection')
    })

    it('intercepts "trava" → price_lock', async () => {
      const context = { ...baseContext, message: 'trava' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('price_lock')
    })

    it('intercepts "lock" (system pattern keyword) → price_lock', async () => {
      const context = { ...baseContext, message: 'lock' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('price_lock')
    })

    it('intercepts "ok" (extra lock keyword) → price_lock', async () => {
      const context = { ...baseContext, message: 'ok' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('price_lock')
    })

    it('intercepts "fecha" (extra lock keyword) → price_lock', async () => {
      const context = { ...baseContext, message: 'fecha' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('price_lock')
    })

    it('intercepts unrelated messages in quoted state → tags operator via deal handler', async () => {
      const context = { ...baseContext, message: 'hello world' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('unrecognized_input')
    })

    it('intercepts a number ≥ 100 in QUOTED state → price_lock (auto-lock shortcut)', async () => {
      mockParseBrazilianNumber.mockReturnValue(5000)
      const context = { ...baseContext, message: '5000' }
      const result = await routeMessage(context)
      // Simple mode: bare number in QUOTED state auto-locks with amount
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('price_lock')
    })
  })

  // ---- Simple mode: AWAITING_AMOUNT state intercepts ----

  describe('simple mode AWAITING_AMOUNT state', () => {
    beforeEach(() => {
      mockGetActiveDealForSender.mockResolvedValue({ ok: true, data: MOCK_AWAITING_DEAL })
    })

    it('intercepts a valid number → volume_input', async () => {
      mockParseBrazilianNumber.mockReturnValue(5000)
      const context = { ...baseContext, message: '5000' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('volume_input')
    })

    it('intercepts "10k" as number → volume_input', async () => {
      mockParseBrazilianNumber.mockReturnValue(10000)
      const context = { ...baseContext, message: '10k' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('volume_input')
    })

    it('intercepts cancel keyword → cancellation', async () => {
      mockGetKeywordsForPatternSync.mockImplementation((key: string) => {
        if (key === 'deal_cancellation') return ['cancela', 'cancelar', 'cancel']
        if (key === 'price_lock') return ['trava', 'lock', 'travar']
        return []
      })
      const context = { ...baseContext, message: 'cancela' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('cancellation')
    })

    it('intercepts non-number, non-cancel message → unrecognized_input feedback', async () => {
      const context = { ...baseContext, message: 'hello' }
      const result = await routeMessage(context)
      // Simple mode: unrecognized input during AWAITING_AMOUNT gets feedback
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('unrecognized_input')
    })
  })

  // ---- Cross-talk guard: sender B does not affect sender A's deal ----

  describe('cross-talk guard', () => {
    it('sender B saying "off" does not intercept when only sender A has deal', async () => {
      // Deal belongs to sender A
      mockGetActiveDealForSender.mockResolvedValue({ ok: true, data: null })
      const context = { ...baseContext, sender: 'senderB@s.whatsapp.net', message: 'off' }
      const result = await routeMessage(context)
      // No deal for sender B → falls through
      expect(result.destination).toBe('IGNORE')
    })
  })

  // ---- No active deal: "ok" in casual chat ----

  describe('no active deal — false positive guards', () => {
    it('"ok" without deal falls through to normal triggers', async () => {
      mockGetActiveDealForSender.mockResolvedValue({ ok: true, data: null })
      const context = { ...baseContext, message: 'ok' }
      const result = await routeMessage(context)
      // No deal → falls through to trigger matching → no match → IGNORE
      expect(result.destination).toBe('IGNORE')
    })

    it('"trava" without deal falls through to normal triggers', async () => {
      mockGetActiveDealForSender.mockResolvedValue({ ok: true, data: null })
      // If a database trigger matches "trava", it should still fire
      mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger({ actionType: 'deal_lock' }) })
      const context = { ...baseContext, message: 'trava' }
      const result = await routeMessage(context)
      // Falls through to trigger matching → deal_lock trigger fires
      expect(result.destination).toBe('DEAL_HANDLER')
      expect(result.context.dealAction).toBe('price_lock')
    })

    it('"5000" without deal falls through to normal routing', async () => {
      mockGetActiveDealForSender.mockResolvedValue({ ok: true, data: null })
      mockParseBrazilianNumber.mockReturnValue(5000)
      const context = { ...baseContext, message: '5000' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('IGNORE')
    })
  })

  // ---- Error handling ----

  describe('intercept error handling', () => {
    it('falls through to normal routing if getSpreadConfig fails', async () => {
      mockGetSpreadConfig.mockResolvedValue({ ok: false, error: 'DB down' })
      mockGetActiveDealForSender.mockResolvedValue({ ok: true, data: MOCK_QUOTED_DEAL })
      const context = { ...baseContext, message: 'off' }
      const result = await routeMessage(context)
      // Config error → intercept returns null → normal routing → IGNORE
      expect(result.destination).toBe('IGNORE')
    })

    it('falls through to normal routing if getActiveDealForSender fails', async () => {
      mockGetActiveDealForSender.mockResolvedValue({ ok: false, error: 'DB down' })
      const context = { ...baseContext, message: 'off' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('IGNORE')
    })

    it('falls through to normal routing if intercept throws', async () => {
      mockGetSpreadConfig.mockRejectedValue(new Error('Unexpected error'))
      const context = { ...baseContext, message: 'off' }
      const result = await routeMessage(context)
      // Error is caught by try/catch in routeMessage → falls through
      expect(result.destination).toBe('IGNORE')
    })
  })
})

// ============================================================================
// Phase 3: Active Quote Catch-All
// ============================================================================

describe('routeMessage active quote catch-all', () => {
  const mockSock = {} as WASocket

  const baseContext: RouterContext = {
    groupId: '123456789@g.us',
    groupName: 'Test Group',
    message: '',
    sender: 'client@s.whatsapp.net',
    isControlGroup: false,
    sock: mockSock,
  }

  const MOCK_ACTIVE_QUOTE = {
    id: 'quote-1',
    groupJid: '123456789@g.us',
    requesterJid: 'client@s.whatsapp.net',
    quotedPrice: 5.25,
    basePrice: 5.20,
    status: 'pending' as const,
    quotedAt: new Date(),
    repriceCount: 0,
    priceSource: 'usdt_brl' as const,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetGroupModeSync.mockReturnValue('active')
    mockMatchTrigger.mockResolvedValue({ ok: true, data: null })
    // Default: classic mode (simple mode intercept skipped)
    mockGetSpreadConfig.mockResolvedValue({ ok: true, data: { dealFlowMode: 'classic' } })
    mockGetActiveDealForSender.mockResolvedValue({ ok: true, data: null })
    mockGetKeywordsForPatternSync.mockReturnValue(['trava', 'lock', 'travar'])
    mockParseBrazilianNumber.mockReturnValue(null)
    mockGetActiveQuote.mockReturnValue(null)
  })

  it('routes unmatched message to DEAL_HANDLER when active quote exists (pending)', async () => {
    mockGetActiveQuote.mockReturnValue(MOCK_ACTIVE_QUOTE)
    const context = { ...baseContext, message: 'melhorar?' }
    const result = await routeMessage(context)
    expect(result.destination).toBe('DEAL_HANDLER')
    expect(result.context.dealAction).toBe('unrecognized_input')
  })

  it('routes unmatched message to DEAL_HANDLER when active quote is repricing', async () => {
    mockGetActiveQuote.mockReturnValue({ ...MOCK_ACTIVE_QUOTE, status: 'repricing' })
    const context = { ...baseContext, message: 'consegue melhor?' }
    const result = await routeMessage(context)
    expect(result.destination).toBe('DEAL_HANDLER')
    expect(result.context.dealAction).toBe('unrecognized_input')
  })

  it('routes to IGNORE when active quote is in terminal state (accepted)', async () => {
    mockGetActiveQuote.mockReturnValue({ ...MOCK_ACTIVE_QUOTE, status: 'accepted' })
    const context = { ...baseContext, message: 'hello' }
    const result = await routeMessage(context)
    expect(result.destination).toBe('IGNORE')
  })

  it('routes to IGNORE when active quote is expired', async () => {
    mockGetActiveQuote.mockReturnValue({ ...MOCK_ACTIVE_QUOTE, status: 'expired' })
    const context = { ...baseContext, message: 'hello' }
    const result = await routeMessage(context)
    expect(result.destination).toBe('IGNORE')
  })

  it('routes to IGNORE when no active quote exists', async () => {
    mockGetActiveQuote.mockReturnValue(null)
    const context = { ...baseContext, message: 'hello' }
    const result = await routeMessage(context)
    expect(result.destination).toBe('IGNORE')
  })

  it('trigger match takes priority over active quote catch-all', async () => {
    mockGetActiveQuote.mockReturnValue(MOCK_ACTIVE_QUOTE)
    mockMatchTrigger.mockResolvedValue({ ok: true, data: makeTrigger({ triggerPhrase: 'atualiza', actionType: 'price_quote' }) })
    const context = { ...baseContext, message: 'atualiza' }
    const result = await routeMessage(context)
    expect(result.destination).toBe('PRICE_HANDLER')
    expect(result.context.hasTrigger).toBe(true)
  })

  it('simple mode: catch-all fires when intercept falls through (non-amount, non-keyword)', async () => {
    // Simple mode intercept checks active quote for amounts/lock keywords only.
    // "melhorar?" doesn't match either → intercept returns null → trigger matching → catch-all.
    mockGetSpreadConfig.mockResolvedValue({ ok: true, data: { dealFlowMode: 'simple' } })
    mockGetActiveDealForSender.mockResolvedValue({ ok: true, data: null })
    mockGetActiveQuote.mockReturnValue(MOCK_ACTIVE_QUOTE)
    const context = { ...baseContext, message: 'melhorar?' }
    const result = await routeMessage(context)
    expect(result.destination).toBe('DEAL_HANDLER')
    expect(result.context.dealAction).toBe('unrecognized_input')
  })

  it('routes non-requester message to IGNORE during active quote (sender scoping)', async () => {
    mockGetActiveQuote.mockReturnValue(MOCK_ACTIVE_QUOTE)
    const context = { ...baseContext, sender: 'other-client@s.whatsapp.net', message: 'boa noite' }
    const result = await routeMessage(context)
    expect(result.destination).toBe('IGNORE')
  })

  it('routes to OBSERVE_ONLY (not catch-all) when matchTrigger throws', async () => {
    // matchTrigger DB failure → OBSERVE_ONLY, skipping catch-all.
    // Safer: we can't be sure no trigger would have matched.
    mockGetActiveQuote.mockReturnValue(MOCK_ACTIVE_QUOTE)
    mockMatchTrigger.mockRejectedValue(new Error('DB connection failed'))
    const context = { ...baseContext, message: 'melhorar?' }
    const result = await routeMessage(context)
    expect(result.destination).toBe('OBSERVE_ONLY')
  })
})
