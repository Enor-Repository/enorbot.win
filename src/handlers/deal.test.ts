/**
 * Tests for Deal Handler - Sprint 4, Task 4.4
 *
 * Tests the WhatsApp integration layer for deal flow:
 * - Volume inquiry → creates QUOTED deal
 * - Price lock → locks deal at quoted rate
 * - Confirmation → computes and completes deal
 * - Cancellation → cancels deal
 * - Message classification bridge functions
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RouterContext } from '../bot/router.js'
import type { WASocket } from '@whiskeysockets/baileys'

// ============================================================================
// Mocks
// ============================================================================

// Mock dealFlowService
vi.mock('../services/dealFlowService.js', () => ({
  findClientDeal: vi.fn(),
  createDeal: vi.fn(),
  lockDeal: vi.fn(),
  startComputation: vi.fn(),
  completeDeal: vi.fn(),
  cancelDeal: vi.fn(),
  rejectDeal: vi.fn(),
  startAwaitingAmount: vi.fn(),
  sweepExpiredDeals: vi.fn(),
  archiveDeal: vi.fn(),
  getDealsNeedingReprompt: vi.fn(),
  markReprompted: vi.fn(),
  expireDeal: vi.fn(),
}))

vi.mock('../bot/connection.js', () => ({
  getSocket: vi.fn(),
}))

// Mock dealComputation
vi.mock('../services/dealComputation.js', () => ({
  extractBrlAmount: vi.fn(),
  extractUsdtAmount: vi.fn(),
  parseBrazilianNumber: vi.fn(),
  computeBrlToUsdt: vi.fn(),
  computeUsdtToBrl: vi.fn(),
  formatBrl: (v: number) => `R$ ${v.toFixed(2)}`,
  formatUsdt: (v: number) => `${v.toFixed(2)} USDT`,
  formatRate: (v: number) => v.toFixed(4),
}))

// Mock binance
vi.mock('../services/binance.js', () => ({
  fetchPrice: vi.fn(),
}))

// Mock groupSpreadService
vi.mock('../services/groupSpreadService.js', () => ({
  getSpreadConfig: vi.fn(),
  calculateQuote: vi.fn((baseRate: number) => baseRate),
}))

// Mock groupConfig - resolveOperatorJid is the sole source for operator tagging
vi.mock('../services/groupConfig.js', () => ({
  resolveOperatorJid: vi.fn().mockReturnValue(null),
}))

// Mock ruleService
vi.mock('../services/ruleService.js', () => ({
  getActiveRule: vi.fn(),
}))

// Mock messaging
vi.mock('../utils/messaging.js', () => ({
  sendWithAntiDetection: vi.fn(),
}))

// Mock messageHistory
vi.mock('../services/messageHistory.js', () => ({
  logBotMessage: vi.fn(),
}))

// Mock state
vi.mock('../bot/state.js', () => ({
  recordMessageSent: vi.fn(),
}))

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// Mock systemPatternService - return default keywords
vi.mock('../services/systemPatternService.js', () => ({
  getKeywordsForPattern: vi.fn((key: string) => {
    const defaults: Record<string, string[]> = {
      deal_cancellation: ['cancela', 'cancelar', 'cancel'],
      price_lock: ['trava', 'lock', 'travar'],
      deal_confirmation: ['fechado', 'fecha', 'fechar', 'confirma', 'confirmado', 'confirmed'],
    }
    return Promise.resolve(defaults[key] || [])
  }),
}))

// Import mocked modules
import { findClientDeal, createDeal, lockDeal, startComputation, completeDeal, cancelDeal, rejectDeal, startAwaitingAmount, archiveDeal } from '../services/dealFlowService.js'
import { extractBrlAmount, extractUsdtAmount, parseBrazilianNumber, computeBrlToUsdt, computeUsdtToBrl } from '../services/dealComputation.js'
import { fetchPrice } from '../services/binance.js'
import { getSpreadConfig } from '../services/groupSpreadService.js'
import { resolveOperatorJid } from '../services/groupConfig.js'
import { getActiveRule } from '../services/ruleService.js'
import { sendWithAntiDetection } from '../utils/messaging.js'

// Import handlers under test
import {
  handleVolumeInquiry,
  handlePriceLock,
  handleConfirmation,
  handleDealCancellation,
  handleRejection,
  handleVolumeInput,
} from './deal.js'

// ============================================================================
// Test Helpers
// ============================================================================

function createTestContext(overrides: Partial<RouterContext> = {}): RouterContext {
  return {
    groupId: 'group-123@g.us',
    groupName: 'Test OTC Group',
    message: 'test message',
    sender: '5511999999999@s.whatsapp.net',
    senderName: 'Test Client',
    isControlGroup: false,
    sock: {
      sendPresenceUpdate: vi.fn(),
      sendMessage: vi.fn(),
    } as unknown as WASocket,
    ...overrides,
  }
}

const MOCK_DEAL = {
  id: 'deal-uuid-1',
  groupJid: 'group-123@g.us',
  clientJid: '5511999999999@s.whatsapp.net',
  state: 'quoted' as const,
  side: 'client_buys_usdt' as const,
  quotedRate: 5.25,
  baseRate: 5.20,
  quotedAt: new Date(),
  lockedRate: null,
  lockedAt: null,
  amountBrl: 10000,
  amountUsdt: 1904.76,
  ttlExpiresAt: new Date(Date.now() + 180000), // 3 min from now
  ruleIdUsed: null,
  ruleName: null,
  pricingSource: 'usdt_binance' as const,
  spreadMode: 'bps' as const,
  sellSpread: 50,
  buySpread: 30,
  repromptedAt: null,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
}

// ============================================================================
// handleVolumeInquiry Tests
// ============================================================================

describe('handleVolumeInquiry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendWithAntiDetection).mockResolvedValue({ ok: true, data: undefined })
  })

  it('creates a QUOTED deal when no active deal exists', async () => {
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: null })
    vi.mocked(fetchPrice).mockResolvedValue({ ok: true, data: 5.20 })
    vi.mocked(getSpreadConfig).mockResolvedValue({ ok: false, error: 'not found' })
    vi.mocked(getActiveRule).mockResolvedValue({ ok: true, data: null })
    vi.mocked(extractBrlAmount).mockReturnValue(10000)
    vi.mocked(extractUsdtAmount).mockReturnValue(null)
    vi.mocked(computeBrlToUsdt).mockReturnValue({
      ok: true,
      data: { amountBrl: 10000, amountUsdt: 1923.07, rate: 5.20, display: '', formatted: { brl: '', usdt: '', rate: '' } },
    })
    vi.mocked(createDeal).mockResolvedValue({ ok: true, data: MOCK_DEAL })

    const context = createTestContext({ message: 'compro 10k' })
    const result = await handleVolumeInquiry(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('deal_quoted')
      expect(result.data.dealId).toBe('deal-uuid-1')
    }
    expect(createDeal).toHaveBeenCalledTimes(1)
    expect(sendWithAntiDetection).toHaveBeenCalled()
  })

  it('sends reminder when client already has an active deal', async () => {
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: MOCK_DEAL })

    const context = createTestContext({ message: 'compro 20k' })
    const result = await handleVolumeInquiry(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('no_action')
    }
    expect(createDeal).not.toHaveBeenCalled()
    // Should send reminder
    expect(sendWithAntiDetection).toHaveBeenCalled()
  })

  it('returns error when Binance rate fetch fails', async () => {
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: null })
    vi.mocked(fetchPrice).mockResolvedValue({ ok: false, error: 'API timeout' })
    vi.mocked(extractBrlAmount).mockReturnValue(10000)
    vi.mocked(extractUsdtAmount).mockReturnValue(null)

    const context = createTestContext({ message: 'compro 10k' })
    const result = await handleVolumeInquiry(context)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Could not fetch current rate')
    }
    expect(createDeal).not.toHaveBeenCalled()
  })

  it('computes USDT from BRL when only BRL provided', async () => {
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: null })
    vi.mocked(fetchPrice).mockResolvedValue({ ok: true, data: 5.25 })
    vi.mocked(getSpreadConfig).mockResolvedValue({ ok: false, error: 'not found' })
    vi.mocked(getActiveRule).mockResolvedValue({ ok: true, data: null })
    vi.mocked(extractBrlAmount).mockReturnValue(5000)
    vi.mocked(extractUsdtAmount).mockReturnValue(null)
    vi.mocked(computeBrlToUsdt).mockReturnValue({
      ok: true,
      data: { amountBrl: 5000, amountUsdt: 952.38, rate: 5.25, display: '', formatted: { brl: '', usdt: '', rate: '' } },
    })
    vi.mocked(createDeal).mockResolvedValue({ ok: true, data: { ...MOCK_DEAL, amountBrl: 5000, amountUsdt: 952.38 } })

    const context = createTestContext({ message: 'tenho 5000 reais' })
    const result = await handleVolumeInquiry(context)

    expect(result.ok).toBe(true)
    expect(computeBrlToUsdt).toHaveBeenCalledWith(5000, 5.25)
  })

  it('computes BRL from USDT when only USDT provided', async () => {
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: null })
    vi.mocked(fetchPrice).mockResolvedValue({ ok: true, data: 5.25 })
    vi.mocked(getSpreadConfig).mockResolvedValue({ ok: false, error: 'not found' })
    vi.mocked(getActiveRule).mockResolvedValue({ ok: true, data: null })
    vi.mocked(extractBrlAmount).mockReturnValue(null)
    vi.mocked(extractUsdtAmount).mockReturnValue(500)
    vi.mocked(computeUsdtToBrl).mockReturnValue({
      ok: true,
      data: { amountBrl: 2625, amountUsdt: 500, rate: 5.25, display: '', formatted: { brl: '', usdt: '', rate: '' } },
    })
    vi.mocked(createDeal).mockResolvedValue({ ok: true, data: { ...MOCK_DEAL, amountBrl: 2625, amountUsdt: 500 } })

    const context = createTestContext({ message: 'quero 500 usdt' })
    const result = await handleVolumeInquiry(context)

    expect(result.ok).toBe(true)
    expect(computeUsdtToBrl).toHaveBeenCalledWith(500, 5.25)
  })
})

// ============================================================================
// handlePriceLock Tests
// ============================================================================

describe('handlePriceLock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendWithAntiDetection).mockResolvedValue({ ok: true, data: undefined })
  })

  it('locks an active QUOTED deal', async () => {
    const quotedDeal = { ...MOCK_DEAL, state: 'quoted' as const }
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: quotedDeal })
    vi.mocked(extractBrlAmount).mockReturnValue(null)
    vi.mocked(extractUsdtAmount).mockReturnValue(null)

    const lockedDeal = {
      ...quotedDeal,
      state: 'locked' as const,
      lockedRate: 5.25,
      lockedAt: new Date(),
    }
    vi.mocked(lockDeal).mockResolvedValue({ ok: true, data: lockedDeal })

    const context = createTestContext({ message: 'trava' })
    const result = await handlePriceLock(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('deal_locked')
      expect(result.data.dealId).toBe('deal-uuid-1')
    }
    expect(lockDeal).toHaveBeenCalledWith('deal-uuid-1', 'group-123@g.us', {
      lockedRate: 5.25,
    })
  })

  it('sends message when no active deal exists', async () => {
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: null })

    const context = createTestContext({ message: 'trava' })
    const result = await handlePriceLock(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('no_action')
    }
    expect(lockDeal).not.toHaveBeenCalled()
    expect(sendWithAntiDetection).toHaveBeenCalled()
  })

  it('sends reminder when deal is already locked', async () => {
    const lockedDeal = { ...MOCK_DEAL, state: 'locked' as const }
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: lockedDeal })

    const context = createTestContext({ message: 'trava' })
    const result = await handlePriceLock(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('no_action')
    }
    expect(lockDeal).not.toHaveBeenCalled()
  })

  it('handles expired deal during lock', async () => {
    const quotedDeal = { ...MOCK_DEAL, state: 'quoted' as const }
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: quotedDeal })
    vi.mocked(extractBrlAmount).mockReturnValue(null)
    vi.mocked(extractUsdtAmount).mockReturnValue(null)
    vi.mocked(lockDeal).mockResolvedValue({ ok: false, error: 'Deal has expired' })

    const context = createTestContext({ message: 'trava' })
    const result = await handlePriceLock(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('no_action')
      expect(result.data.message).toContain('expired')
    }
  })
})

// ============================================================================
// handleConfirmation Tests
// ============================================================================

describe('handleConfirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendWithAntiDetection).mockResolvedValue({ ok: true, data: undefined })
  })

  it('completes a LOCKED deal with amounts', async () => {
    const lockedDeal = {
      ...MOCK_DEAL,
      state: 'locked' as const,
      lockedRate: 5.25,
      lockedAt: new Date(),
      amountBrl: 10000,
      amountUsdt: 1904.76,
    }
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: lockedDeal })
    vi.mocked(startComputation).mockResolvedValue({
      ok: true,
      data: { ...lockedDeal, state: 'computing' as const },
    })
    vi.mocked(completeDeal).mockResolvedValue({
      ok: true,
      data: { ...lockedDeal, state: 'completed' as const },
    })
    vi.mocked(archiveDeal).mockResolvedValue({ ok: true, data: {} as any })

    const context = createTestContext({ message: 'fechado' })
    const result = await handleConfirmation(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('deal_computed')
      expect(result.data.dealId).toBe('deal-uuid-1')
    }
    expect(startComputation).toHaveBeenCalled()
    expect(completeDeal).toHaveBeenCalledWith('deal-uuid-1', 'group-123@g.us', {
      amountBrl: 10000,
      amountUsdt: 1904.76,
    })
  })

  it('tells client to lock first when deal is in QUOTED state', async () => {
    const quotedDeal = { ...MOCK_DEAL, state: 'quoted' as const }
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: quotedDeal })

    const context = createTestContext({ message: 'fechado' })
    const result = await handleConfirmation(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('no_action')
      expect(result.data.message).toContain('needs lock first')
    }
    expect(startComputation).not.toHaveBeenCalled()
  })

  it('returns no_action when no active deal exists', async () => {
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: null })

    const context = createTestContext({ message: 'fechado' })
    const result = await handleConfirmation(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('no_action')
    }
  })

  it('asks for amount when amounts not set on locked deal', async () => {
    const lockedDeal = {
      ...MOCK_DEAL,
      state: 'locked' as const,
      lockedRate: 5.25,
      lockedAt: new Date(),
      amountBrl: null,
      amountUsdt: null,
    }
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: lockedDeal })
    vi.mocked(startComputation).mockResolvedValue({
      ok: true,
      data: { ...lockedDeal, state: 'computing' as const },
    })

    const context = createTestContext({ message: 'fechado' })
    const result = await handleConfirmation(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('no_action')
      expect(result.data.message).toContain('Amounts not set')
    }
    expect(completeDeal).not.toHaveBeenCalled()
  })

  it('computes USDT from BRL when only BRL set', async () => {
    const lockedDeal = {
      ...MOCK_DEAL,
      state: 'locked' as const,
      lockedRate: 5.25,
      lockedAt: new Date(),
      amountBrl: 10000,
      amountUsdt: null,
    }
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: lockedDeal })
    vi.mocked(startComputation).mockResolvedValue({
      ok: true,
      data: { ...lockedDeal, state: 'computing' as const },
    })
    vi.mocked(computeBrlToUsdt).mockReturnValue({
      ok: true,
      data: { amountBrl: 10000, amountUsdt: 1904.76, rate: 5.25, display: '', formatted: { brl: '', usdt: '', rate: '' } },
    })
    vi.mocked(completeDeal).mockResolvedValue({
      ok: true,
      data: { ...lockedDeal, state: 'completed' as const, amountUsdt: 1904.76 },
    })
    vi.mocked(archiveDeal).mockResolvedValue({ ok: true, data: {} as any })

    const context = createTestContext({ message: 'fechado' })
    const result = await handleConfirmation(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('deal_computed')
    }
    expect(computeBrlToUsdt).toHaveBeenCalledWith(10000, 5.25)
    expect(completeDeal).toHaveBeenCalledWith('deal-uuid-1', 'group-123@g.us', {
      amountBrl: 10000,
      amountUsdt: 1904.76,
    })
  })

  it('handles expired deal during confirmation', async () => {
    const lockedDeal = {
      ...MOCK_DEAL,
      state: 'locked' as const,
      lockedRate: 5.25,
      lockedAt: new Date(),
    }
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: lockedDeal })
    vi.mocked(startComputation).mockResolvedValue({ ok: false, error: 'Deal has expired' })

    const context = createTestContext({ message: 'fechado' })
    const result = await handleConfirmation(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('no_action')
      expect(result.data.message).toContain('expired')
    }
  })
})

// ============================================================================
// handleDealCancellation Tests
// ============================================================================

describe('handleDealCancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendWithAntiDetection).mockResolvedValue({ ok: true, data: undefined })
  })

  it('cancels an active deal', async () => {
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: MOCK_DEAL })
    vi.mocked(cancelDeal).mockResolvedValue({
      ok: true,
      data: { ...MOCK_DEAL, state: 'cancelled' as const },
    })
    vi.mocked(archiveDeal).mockResolvedValue({ ok: true, data: {} as any })

    const context = createTestContext({ message: 'cancela' })
    const result = await handleDealCancellation(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('deal_cancelled')
      expect(result.data.dealId).toBe('deal-uuid-1')
    }
    expect(cancelDeal).toHaveBeenCalledWith('deal-uuid-1', 'group-123@g.us', 'cancelled_by_client')
  })

  it('returns no_action when no active deal exists', async () => {
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: null })

    const context = createTestContext({ message: 'cancela' })
    const result = await handleDealCancellation(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('no_action')
    }
    expect(cancelDeal).not.toHaveBeenCalled()
  })
})

// ============================================================================
// handleRejection Tests (Sprint 9)
// ============================================================================

describe('handleRejection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendWithAntiDetection).mockResolvedValue({ ok: true, data: undefined })
    vi.mocked(archiveDeal).mockResolvedValue({ ok: true, data: undefined as never })
  })

  it('rejects a QUOTED deal, sends "off" with @mention, and archives', async () => {
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: { ...MOCK_DEAL, state: 'quoted' } })
    vi.mocked(rejectDeal).mockResolvedValue({ ok: true, data: { ...MOCK_DEAL, state: 'rejected' } })
    vi.mocked(resolveOperatorJid).mockReturnValue('5511888888888@s.whatsapp.net')

    const context = createTestContext({ message: 'off' })
    const result = await handleRejection(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('deal_rejected')
      expect(result.data.dealId).toBe('deal-uuid-1')
    }
    expect(rejectDeal).toHaveBeenCalledWith('deal-uuid-1', 'group-123@g.us')
    expect(sendWithAntiDetection).toHaveBeenCalledWith(
      expect.anything(),
      'group-123@g.us',
      'off @5511888888888',
      ['5511888888888@s.whatsapp.net']
    )
  })

  it('sends "off" without mention when no operator configured', async () => {
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: { ...MOCK_DEAL, state: 'quoted' } })
    vi.mocked(rejectDeal).mockResolvedValue({ ok: true, data: { ...MOCK_DEAL, state: 'rejected' } })
    vi.mocked(resolveOperatorJid).mockReturnValue(null)

    const context = createTestContext({ message: 'off' })
    const result = await handleRejection(context)

    expect(result.ok).toBe(true)
    expect(sendWithAntiDetection).toHaveBeenCalledWith(
      expect.anything(),
      'group-123@g.us',
      'off',
      []
    )
  })

  it('returns no_action when no active deal exists', async () => {
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: null })

    const context = createTestContext({ message: 'off' })
    const result = await handleRejection(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('no_action')
    }
    expect(rejectDeal).not.toHaveBeenCalled()
  })

  it('returns no_action when deal is not in quoted state', async () => {
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: { ...MOCK_DEAL, state: 'locked' } })

    const context = createTestContext({ message: 'off' })
    const result = await handleRejection(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('no_action')
    }
    expect(rejectDeal).not.toHaveBeenCalled()
  })

  it('returns error when rejectDeal fails', async () => {
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: { ...MOCK_DEAL, state: 'quoted' } })
    vi.mocked(rejectDeal).mockResolvedValue({ ok: false, error: 'DB error' })

    const context = createTestContext({ message: 'off' })
    const result = await handleRejection(context)

    expect(result.ok).toBe(false)
  })
})

// ============================================================================
// handlePriceLock — Simple Mode Tests (Sprint 9, Task 9.6)
// ============================================================================

describe('handlePriceLock simple mode', () => {
  const LOCKED_DEAL = { ...MOCK_DEAL, state: 'locked' as const, lockedRate: 5.25 }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendWithAntiDetection).mockResolvedValue({ ok: true, data: undefined })
    vi.mocked(archiveDeal).mockResolvedValue({ ok: true, data: undefined as never })
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: { ...MOCK_DEAL, state: 'quoted' } })
    vi.mocked(lockDeal).mockResolvedValue({ ok: true, data: LOCKED_DEAL })
    vi.mocked(extractBrlAmount).mockReturnValue(null)
    vi.mocked(extractUsdtAmount).mockReturnValue(null)
    vi.mocked(parseBrazilianNumber).mockReturnValue(null)
  })

  it('simple mode with inline amount: locks, computes, completes, sends calc + @mention', async () => {
    vi.mocked(getSpreadConfig).mockResolvedValue({
      ok: true,
      data: { dealFlowMode: 'simple', groupLanguage: 'pt' } as never,
    })
    vi.mocked(resolveOperatorJid).mockReturnValue('5511888888888@s.whatsapp.net')
    vi.mocked(parseBrazilianNumber).mockImplementation((input: string) => {
      if (input === '5000') return 5000
      return null
    })
    vi.mocked(computeUsdtToBrl).mockReturnValue({
      ok: true,
      data: { amountBrl: 26250, amountUsdt: 5000, rate: 5.25, display: '', formatted: { brl: '', usdt: '', rate: '' } },
    })
    vi.mocked(startComputation).mockResolvedValue({ ok: true, data: LOCKED_DEAL as never })
    vi.mocked(completeDeal).mockResolvedValue({ ok: true, data: { ...LOCKED_DEAL, state: 'completed' } as never })

    const context = createTestContext({ message: 'trava 5000' })
    const result = await handlePriceLock(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('deal_computed')
    }
    expect(startComputation).toHaveBeenCalled()
    expect(completeDeal).toHaveBeenCalled()
    expect(sendWithAntiDetection).toHaveBeenCalledWith(
      expect.anything(),
      'group-123@g.us',
      expect.stringContaining('×'),
      ['5511888888888@s.whatsapp.net']
    )
  })

  it('simple mode without amount: locks, transitions to awaiting_amount, sends prompt (PT)', async () => {
    vi.mocked(getSpreadConfig).mockResolvedValue({
      ok: true,
      data: { dealFlowMode: 'simple', groupLanguage: 'pt' } as never,
    })
    vi.mocked(startAwaitingAmount).mockResolvedValue({ ok: true, data: { ...LOCKED_DEAL, state: 'awaiting_amount' } as never })

    const context = createTestContext({ message: 'ok' })
    const result = await handlePriceLock(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('deal_locked')
      expect(result.data.message).toContain('Taxa travada')
      expect(result.data.message).toContain('USDTs')
    }
    expect(startAwaitingAmount).toHaveBeenCalledWith('deal-uuid-1', 'group-123@g.us')
  })

  it('simple mode without amount: sends EN prompt when group language is EN', async () => {
    vi.mocked(getSpreadConfig).mockResolvedValue({
      ok: true,
      data: { dealFlowMode: 'simple', groupLanguage: 'en' } as never,
    })
    vi.mocked(startAwaitingAmount).mockResolvedValue({ ok: true, data: { ...LOCKED_DEAL, state: 'awaiting_amount' } as never })

    const context = createTestContext({ message: 'ok' })
    const result = await handlePriceLock(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.message).toContain('Rate locked')
      expect(result.data.message).toContain('USDT')
    }
  })

  it('classic mode: existing behavior unchanged (no simple mode branching)', async () => {
    vi.mocked(getSpreadConfig).mockResolvedValue({
      ok: true,
      data: { dealFlowMode: 'classic', groupLanguage: 'pt' } as never,
    })

    const context = createTestContext({ message: 'trava' })
    const result = await handlePriceLock(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('deal_locked')
      expect(result.data.message).toContain('Taxa Travada')
    }
    expect(startAwaitingAmount).not.toHaveBeenCalled()
    expect(startComputation).not.toHaveBeenCalled()
  })
})

// ============================================================================
// handleVolumeInput Tests (Sprint 9, Task 9.7)
// ============================================================================

describe('handleVolumeInput', () => {
  const AWAITING_DEAL = { ...MOCK_DEAL, state: 'awaiting_amount' as const, lockedRate: 5.25 }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendWithAntiDetection).mockResolvedValue({ ok: true, data: undefined })
    vi.mocked(archiveDeal).mockResolvedValue({ ok: true, data: undefined as never })
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: AWAITING_DEAL })
    vi.mocked(extractUsdtAmount).mockReturnValue(null)
    vi.mocked(parseBrazilianNumber).mockReturnValue(null)
  })

  it('parses amount, computes, completes deal, sends calc + @mention', async () => {
    vi.mocked(extractUsdtAmount).mockReturnValue(5000)
    vi.mocked(computeUsdtToBrl).mockReturnValue({
      ok: true,
      data: { amountBrl: 26250, amountUsdt: 5000, rate: 5.25, display: '', formatted: { brl: '', usdt: '', rate: '' } },
    })
    vi.mocked(startComputation).mockResolvedValue({ ok: true, data: AWAITING_DEAL as never })
    vi.mocked(completeDeal).mockResolvedValue({ ok: true, data: { ...AWAITING_DEAL, state: 'completed' } as never })
    vi.mocked(getSpreadConfig).mockResolvedValue({
      ok: true,
      data: { groupLanguage: 'pt' } as never,
    })
    vi.mocked(resolveOperatorJid).mockReturnValue('5511888888888@s.whatsapp.net')

    const context = createTestContext({ message: '5000' })
    const result = await handleVolumeInput(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('deal_computed')
      expect(result.data.message).toContain('×')
    }
    expect(startComputation).toHaveBeenCalled()
    expect(completeDeal).toHaveBeenCalledWith('deal-uuid-1', 'group-123@g.us', {
      amountBrl: 26250,
      amountUsdt: 5000,
    })
    expect(sendWithAntiDetection).toHaveBeenCalledWith(
      expect.anything(),
      'group-123@g.us',
      expect.stringContaining('@5511888888888'),
      ['5511888888888@s.whatsapp.net']
    )
  })

  it('uses parseBrazilianNumber as fallback when extractUsdtAmount returns null', async () => {
    vi.mocked(extractUsdtAmount).mockReturnValue(null)
    vi.mocked(parseBrazilianNumber).mockReturnValue(10000)
    vi.mocked(computeUsdtToBrl).mockReturnValue({
      ok: true,
      data: { amountBrl: 52500, amountUsdt: 10000, rate: 5.25, display: '', formatted: { brl: '', usdt: '', rate: '' } },
    })
    vi.mocked(startComputation).mockResolvedValue({ ok: true, data: AWAITING_DEAL as never })
    vi.mocked(completeDeal).mockResolvedValue({ ok: true, data: { ...AWAITING_DEAL, state: 'completed' } as never })
    vi.mocked(getSpreadConfig).mockResolvedValue({ ok: true, data: { groupLanguage: 'pt' } as never })

    const context = createTestContext({ message: '10k' })
    const result = await handleVolumeInput(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('deal_computed')
    }
  })

  it('sends gentle error message when amount cannot be parsed (PT)', async () => {
    vi.mocked(getSpreadConfig).mockResolvedValue({ ok: true, data: { groupLanguage: 'pt' } as never })

    const context = createTestContext({ message: 'abc' })
    const result = await handleVolumeInput(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('no_action')
    }
    expect(sendWithAntiDetection).toHaveBeenCalledWith(
      expect.anything(),
      'group-123@g.us',
      expect.stringContaining('Não entendi')
    )
  })

  it('sends gentle error message when amount cannot be parsed (EN)', async () => {
    vi.mocked(getSpreadConfig).mockResolvedValue({ ok: true, data: { groupLanguage: 'en' } as never })

    const context = createTestContext({ message: 'abc' })
    const result = await handleVolumeInput(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('no_action')
    }
    expect(sendWithAntiDetection).toHaveBeenCalledWith(
      expect.anything(),
      'group-123@g.us',
      expect.stringContaining("Couldn't understand")
    )
  })

  it('returns no_action when no deal in awaiting_amount state', async () => {
    vi.mocked(findClientDeal).mockResolvedValue({ ok: true, data: null })

    const context = createTestContext({ message: '5000' })
    const result = await handleVolumeInput(context)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.action).toBe('no_action')
    }
    expect(startComputation).not.toHaveBeenCalled()
  })
})

