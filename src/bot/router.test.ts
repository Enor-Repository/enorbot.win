import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { WASocket } from '@whiskeysockets/baileys'

// Mock groupConfig service before importing router
const mockGetGroupModeSync = vi.hoisted(() => vi.fn())
const mockGetGroupConfigSync = vi.hoisted(() => vi.fn())
const mockMatchTrigger = vi.hoisted(() => vi.fn())

vi.mock('../services/groupConfig.js', () => ({
  getGroupModeSync: mockGetGroupModeSync,
  getGroupConfigSync: mockGetGroupConfigSync,
}))

vi.mock('../services/triggerService.js', () => ({
  matchTrigger: mockMatchTrigger,
}))

// Mock systemPatternService so router exercises DB-read code path
vi.mock('../services/systemPatternService.js', () => ({
  getKeywordsForPattern: vi.fn((key: string) => {
    const defaults: Record<string, string[]> = {
      price_request: ['preço', 'cotação'],
      deal_cancellation: ['cancela', 'cancelar', 'cancel'],
      price_lock: ['trava', 'lock', 'travar'],
      deal_confirmation: ['fechado', 'fecha', 'fechar', 'confirma', 'confirmado', 'confirmed'],
    }
    return Promise.resolve(defaults[key] || [])
  }),
  getKeywordsForPatternSync: vi.fn((key: string) => {
    const defaults: Record<string, string[]> = {
      price_request: ['preço', 'cotação'],
      deal_cancellation: ['cancela', 'cancelar', 'cancel'],
      price_lock: ['trava', 'lock', 'travar'],
      deal_confirmation: ['fechado', 'fecha', 'fechar', 'confirma', 'confirmado', 'confirmed'],
    }
    return defaults[key] || []
  }),
}))

import {
  routeMessage,
  isControlGroupMessage,
  detectReceiptType,
  type RouterContext,
  type BaileysMessage,
} from './router.js'
import { RECEIPT_MIME_TYPES } from '../types/handlers.js'

describe('routeMessage', () => {
  // Mock socket for tests
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
    // Default: groups are in 'active' mode
    mockGetGroupModeSync.mockReturnValue('active')
    mockGetGroupConfigSync.mockReturnValue({
      groupJid: '123456789@g.us',
      groupName: 'Test Group',
      mode: 'active',
      triggerPatterns: [],
      responseTemplates: {},
      playerRoles: {},
      aiThreshold: 50,
      learningStartedAt: new Date(),
      activatedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: null,
    })
    // Default: no trigger match from database
    mockMatchTrigger.mockResolvedValue({ ok: true, data: null })
  })

  // AC1, AC2: Trigger messages routed to PRICE_HANDLER
  describe('trigger detection routing', () => {
    it('routes "preço" message to PRICE_HANDLER', async () => {
      const context = { ...baseContext, message: 'preço' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('PRICE_HANDLER')
    })

    it('routes "cotação" message to PRICE_HANDLER', async () => {
      const context = { ...baseContext, message: 'cotação' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('PRICE_HANDLER')
    })

    it('routes trigger in sentence to PRICE_HANDLER', async () => {
      const context = { ...baseContext, message: 'qual o preço do USDT?' }
      const result = await routeMessage(context)
      expect(result.destination).toBe('PRICE_HANDLER')
    })

    it('sets hasTrigger: true for triggered messages', async () => {
      const context = { ...baseContext, message: 'preço' }
      const result = await routeMessage(context)
      expect(result.context.hasTrigger).toBe(true)
    })
  })

  // AC4: Non-trigger messages filtered
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

  // AC5: Control group routing
  describe('control group priority', () => {
    it('routes control group price trigger to PRICE_HANDLER', async () => {
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

    it('routes control group cotação to PRICE_HANDLER', async () => {
      const context = { ...baseContext, message: 'cotação', isControlGroup: true }
      const result = await routeMessage(context)
      expect(result.destination).toBe('PRICE_HANDLER')
      expect(result.context.hasTrigger).toBe(true)
    })
  })

  // Context preservation
  describe('context preservation', () => {
    it('preserves original context fields', async () => {
      const context = { ...baseContext, message: 'preço' }
      const result = await routeMessage(context)
      expect(result.context.groupId).toBe('123456789@g.us')
      expect(result.context.groupName).toBe('Test Group')
      expect(result.context.sender).toBe('user@s.whatsapp.net')
    })
  })
})

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

// Story 6.1: Receipt Detection Tests
describe('detectReceiptType', () => {
  // AC1: PDF detection
  describe('PDF detection (AC1)', () => {
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

  // AC2: Image detection
  describe('image detection (AC2)', () => {
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

// Story 6.1: Receipt Routing Tests
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
    mockGetGroupConfigSync.mockReturnValue({
      groupJid: '123456789@g.us',
      groupName: 'Test Group',
      mode: 'active',
      triggerPatterns: [],
      responseTemplates: {},
      playerRoles: {},
      aiThreshold: 50,
      learningStartedAt: new Date(),
      activatedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: null,
    })
    // Default: no trigger match from database
    mockMatchTrigger.mockResolvedValue({ ok: true, data: null })
  })

  // AC1: PDF routing
  describe('PDF routing (AC1, AC3)', () => {
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
  })

  // AC2: Image routing
  describe('image routing (AC2, AC3)', () => {
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

    it('routes PNG image to RECEIPT_HANDLER', async () => {
      const context = { ...baseContext }
      const baileysMessage: BaileysMessage = {
        imageMessage: { mimetype: 'image/png' },
      }
      const result = await routeMessage(context, baileysMessage)

      expect(result.destination).toBe('RECEIPT_HANDLER')
      expect(result.context.isReceipt).toBe(true)
      expect(result.context.receiptType).toBe('image')
    })

    it('routes WEBP image to RECEIPT_HANDLER', async () => {
      const context = { ...baseContext }
      const baileysMessage: BaileysMessage = {
        imageMessage: { mimetype: 'image/webp' },
      }
      const result = await routeMessage(context, baileysMessage)

      expect(result.destination).toBe('RECEIPT_HANDLER')
      expect(result.context.isReceipt).toBe(true)
      expect(result.context.receiptType).toBe('image')
    })
  })

  // AC4: Control group exclusion
  describe('control group exclusion (AC4)', () => {
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

    it('routes control group image to CONTROL_HANDLER, NOT receipt handler', async () => {
      const context = { ...baseContext, isControlGroup: true }
      const baileysMessage: BaileysMessage = {
        imageMessage: { mimetype: 'image/jpeg' },
      }
      const result = await routeMessage(context, baileysMessage)

      expect(result.destination).toBe('CONTROL_HANDLER')
      expect(result.context.isReceipt).toBe(false)
      expect(result.context.receiptType).toBeNull()
    })
  })

  // Price trigger priority over receipt
  describe('price trigger priority', () => {
    it('routes message with both receipt and trigger to PRICE_HANDLER (trigger has priority)', async () => {
      const context = { ...baseContext, message: 'preço' }
      const baileysMessage: BaileysMessage = {
        documentMessage: { mimetype: 'application/pdf' },
      }
      const result = await routeMessage(context, baileysMessage)

      expect(result.destination).toBe('PRICE_HANDLER')
      expect(result.context.isReceipt).toBe(true)
      expect(result.context.hasTrigger).toBe(true)
    })
  })

  // Unsupported types fall through
  describe('unsupported types', () => {
    it('routes unsupported document type to IGNORE (no trigger)', async () => {
      const context = { ...baseContext }
      const baileysMessage: BaileysMessage = {
        documentMessage: { mimetype: 'application/msword' },
      }
      const result = await routeMessage(context, baileysMessage)

      expect(result.destination).toBe('IGNORE')
      expect(result.context.isReceipt).toBe(false)
    })

    it('routes unsupported image type to IGNORE (no trigger)', async () => {
      const context = { ...baseContext }
      const baileysMessage: BaileysMessage = {
        imageMessage: { mimetype: 'image/gif' },
      }
      const result = await routeMessage(context, baileysMessage)

      expect(result.destination).toBe('IGNORE')
      expect(result.context.isReceipt).toBe(false)
    })
  })
})

// Per-Group Mode Routing Tests (replaces Training Mode)
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
    // Default: no trigger match from database
    mockMatchTrigger.mockResolvedValue({ ok: true, data: null })
  })

  describe('PAUSED mode - completely ignored', () => {
    beforeEach(() => {
      mockGetGroupModeSync.mockReturnValue('paused')
    })

    it('routes price trigger to IGNORE when group is paused', async () => {
      const context = { ...baseContext, message: 'preço' }
      const result = await routeMessage(context)

      expect(result.destination).toBe('IGNORE')
    })

    it('routes non-trigger to IGNORE when group is paused', async () => {
      const context = { ...baseContext, message: 'hello' }
      const result = await routeMessage(context)

      expect(result.destination).toBe('IGNORE')
    })

    it('routes receipt to IGNORE when group is paused', async () => {
      const context = { ...baseContext }
      const baileysMessage: BaileysMessage = {
        documentMessage: { mimetype: 'application/pdf' },
      }
      const result = await routeMessage(context, baileysMessage)

      expect(result.destination).toBe('IGNORE')
    })
  })

  describe('LEARNING mode - observe only', () => {
    beforeEach(() => {
      mockGetGroupModeSync.mockReturnValue('learning')
    })

    it('routes price trigger to OBSERVE_ONLY when group is learning', async () => {
      const context = { ...baseContext, message: 'preço' }
      const result = await routeMessage(context)

      expect(result.destination).toBe('OBSERVE_ONLY')
      expect(result.context.hasTrigger).toBe(true)
    })

    it('routes non-trigger message to OBSERVE_ONLY when group is learning', async () => {
      const context = { ...baseContext, message: 'hello world' }
      const result = await routeMessage(context)

      expect(result.destination).toBe('OBSERVE_ONLY')
      expect(result.context.hasTrigger).toBe(false)
    })

    it('routes receipt to OBSERVE_ONLY when group is learning', async () => {
      const context = { ...baseContext }
      const baileysMessage: BaileysMessage = {
        documentMessage: { mimetype: 'application/pdf' },
      }
      const result = await routeMessage(context, baileysMessage)

      expect(result.destination).toBe('OBSERVE_ONLY')
      expect(result.context.isReceipt).toBe(true)
    })
  })

  describe('ASSISTED mode - observe only (future: suggestions)', () => {
    beforeEach(() => {
      mockGetGroupModeSync.mockReturnValue('assisted')
    })

    it('routes price trigger to OBSERVE_ONLY when group is assisted', async () => {
      const context = { ...baseContext, message: 'preço' }
      const result = await routeMessage(context)

      expect(result.destination).toBe('OBSERVE_ONLY')
    })

    it('routes receipt to OBSERVE_ONLY when group is assisted', async () => {
      const context = { ...baseContext }
      const baileysMessage: BaileysMessage = {
        documentMessage: { mimetype: 'application/pdf' },
      }
      const result = await routeMessage(context, baileysMessage)

      expect(result.destination).toBe('OBSERVE_ONLY')
    })
  })

  describe('ACTIVE mode - normal routing with database triggers', () => {
    beforeEach(() => {
      mockGetGroupModeSync.mockReturnValue('active')
      mockGetGroupConfigSync.mockReturnValue({
        groupJid: '123456789@g.us',
        groupName: 'Test Group',
        mode: 'active',
        triggerPatterns: [],
        responseTemplates: {},
        playerRoles: {},
        aiThreshold: 50,
        learningStartedAt: new Date(),
        activatedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: null,
      })
      // Default: no trigger match
      mockMatchTrigger.mockResolvedValue({ ok: true, data: null })
    })

    it('routes global price trigger to PRICE_HANDLER', async () => {
      const context = { ...baseContext, message: 'preço' }
      const result = await routeMessage(context)

      expect(result.destination).toBe('PRICE_HANDLER')
    })

    it('routes database trigger match to PRICE_HANDLER', async () => {
      const trigger = {
        id: 'trigger-1',
        groupJid: '123456789@g.us',
        triggerPhrase: 'compro usdt',
        patternType: 'contains',
        actionType: 'price_quote',
        actionParams: {},
        priority: 100,
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      }

      mockMatchTrigger.mockResolvedValue({ ok: true, data: trigger })

      const context = { ...baseContext, message: 'quero compro usdt agora' }
      const result = await routeMessage(context)

      expect(result.destination).toBe('PRICE_HANDLER')
      expect(result.context.matchedTrigger).toBeDefined()
      expect(result.context.matchedTrigger?.triggerPhrase).toBe('compro usdt')
    })

    it('routes non-trigger to IGNORE in active mode', async () => {
      const context = { ...baseContext, message: 'hello' }
      const result = await routeMessage(context)

      expect(result.destination).toBe('IGNORE')
    })

    it('routes receipt to RECEIPT_HANDLER in active mode', async () => {
      const context = { ...baseContext }
      const baileysMessage: BaileysMessage = {
        documentMessage: { mimetype: 'application/pdf' },
      }
      const result = await routeMessage(context, baileysMessage)

      expect(result.destination).toBe('RECEIPT_HANDLER')
    })
  })

  describe('Control group works normally regardless of group mode', () => {
    it('routes control group price trigger to PRICE_HANDLER even when groups are paused', async () => {
      mockGetGroupModeSync.mockReturnValue('paused')
      const context = { ...baseContext, message: 'preço', isControlGroup: true }
      const result = await routeMessage(context)

      expect(result.destination).toBe('PRICE_HANDLER')
      expect(result.context.hasTrigger).toBe(true)
    })

    it('routes control group non-trigger to CONTROL_HANDLER even when groups are learning', async () => {
      mockGetGroupModeSync.mockReturnValue('learning')
      const context = { ...baseContext, message: 'status', isControlGroup: true }
      const result = await routeMessage(context)

      expect(result.destination).toBe('CONTROL_HANDLER')
    })

    it('routes control group receipt to CONTROL_HANDLER, not RECEIPT_HANDLER', async () => {
      mockGetGroupModeSync.mockReturnValue('active')
      const context = { ...baseContext, isControlGroup: true }
      const baileysMessage: BaileysMessage = {
        documentMessage: { mimetype: 'application/pdf' },
      }
      const result = await routeMessage(context, baileysMessage)

      expect(result.destination).toBe('CONTROL_HANDLER')
      expect(result.context.isReceipt).toBe(false)
    })
  })

  describe('Group config sync function called correctly', () => {
    it('calls getGroupModeSync with groupId', async () => {
      mockGetGroupModeSync.mockReturnValue('active')
      mockGetGroupConfigSync.mockReturnValue(null)

      const context = { ...baseContext, groupId: 'specific-group@g.us', message: 'hello' }
      await routeMessage(context)

      expect(mockGetGroupModeSync).toHaveBeenCalledWith('specific-group@g.us')
    })

    it('handles null groupConfig gracefully', async () => {
      mockGetGroupModeSync.mockReturnValue('active')
      mockGetGroupConfigSync.mockReturnValue(null)

      const context = { ...baseContext, message: 'compro usdt' }
      const result = await routeMessage(context)

      // Without group config, only global triggers work
      expect(result.destination).toBe('IGNORE')
    })
  })

  // Trigger service integration tests
  describe('trigger service integration', () => {
    beforeEach(() => {
      mockGetGroupModeSync.mockReturnValue('active')
    })

    it('calls matchTrigger for active groups', async () => {
      const context = { ...baseContext, message: 'hello' }
      await routeMessage(context)

      expect(mockMatchTrigger).toHaveBeenCalledWith('hello', '123456789@g.us')
    })

    it('calls matchTrigger for control group', async () => {
      const context = { ...baseContext, message: 'hello', isControlGroup: true }
      await routeMessage(context)

      expect(mockMatchTrigger).toHaveBeenCalledWith('hello', '123456789@g.us')
    })

    it('populates matchedTrigger when trigger matches', async () => {
      const trigger = {
        id: 'trigger-1',
        groupJid: '123456789@g.us',
        triggerPhrase: 'compro usdt',
        patternType: 'contains',
        actionType: 'price_quote',
        actionParams: {},
        priority: 100,
        isActive: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      }
      mockMatchTrigger.mockResolvedValue({ ok: true, data: trigger })

      const context = { ...baseContext, message: 'compro usdt' }
      const result = await routeMessage(context)

      expect(result.destination).toBe('PRICE_HANDLER')
      expect(result.context.matchedTrigger).toBeDefined()
      expect(result.context.matchedTrigger?.triggerPhrase).toBe('compro usdt')
    })

    it('falls back gracefully when matchTrigger throws in active mode', async () => {
      mockMatchTrigger.mockRejectedValue(new Error('DB connection failed'))

      const context = { ...baseContext, message: 'hello' }
      const result = await routeMessage(context)

      // Should fall through to IGNORE without crashing
      expect(result.destination).toBe('IGNORE')
    })

    it('falls back to PRICE_HANDLER via hasTrigger when matchTrigger throws', async () => {
      mockMatchTrigger.mockRejectedValue(new Error('DB connection failed'))

      const context = { ...baseContext, message: 'preço' }
      const result = await routeMessage(context)

      expect(result.destination).toBe('PRICE_HANDLER')
    })

    it('falls back gracefully when matchTrigger throws in control group', async () => {
      mockMatchTrigger.mockRejectedValue(new Error('DB connection failed'))

      const context = { ...baseContext, message: 'status', isControlGroup: true }
      const result = await routeMessage(context)

      expect(result.destination).toBe('CONTROL_HANDLER')
    })
  })
})
