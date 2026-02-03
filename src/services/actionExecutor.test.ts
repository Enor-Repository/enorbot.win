/**
 * Tests for Action Executor
 * Sprint 3: Group Triggers
 *
 * Critical coverage: all 4 action types, rule context application,
 * fallback behavior, error handling
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock dependencies with vi.hoisted
const mockFetchPrice = vi.hoisted(() => vi.fn())
const mockGetSpreadConfig = vi.hoisted(() => vi.fn())
const mockCalculateQuote = vi.hoisted(() => vi.fn())
const mockCalculateBothQuotes = vi.hoisted(() => vi.fn())
const mockExtractVolumeBrl = vi.hoisted(() => vi.fn())
const mockFormatBrazilianPrice = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('./binance.js', () => ({ fetchPrice: mockFetchPrice }))
vi.mock('./groupSpreadService.js', () => ({
  getSpreadConfig: mockGetSpreadConfig,
  calculateQuote: mockCalculateQuote,
  calculateBothQuotes: mockCalculateBothQuotes,
}))
vi.mock('../utils/triggers.js', () => ({
  extractVolumeBrl: mockExtractVolumeBrl,
}))
vi.mock('../utils/format.js', () => ({
  formatBrazilianPrice: mockFormatBrazilianPrice,
}))
vi.mock('../utils/logger.js', () => ({ logger: mockLogger }))

import { executeAction, type ActionContext } from './actionExecutor.js'
import type { GroupTrigger } from './triggerService.js'
import type { GroupRule } from './ruleService.js'

// ============================================================================
// Test Helpers
// ============================================================================

function createTestTrigger(overrides: Partial<GroupTrigger> = {}): GroupTrigger {
  return {
    id: 'trigger-1',
    groupJid: 'group@g.us',
    triggerPhrase: 'preço',
    patternType: 'contains',
    actionType: 'price_quote',
    actionParams: {},
    priority: 10,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function createTestRule(overrides: Partial<GroupRule> = {}): GroupRule {
  return {
    id: 'rule-1',
    groupJid: 'group@g.us',
    name: 'Business Hours',
    description: null,
    scheduleStartTime: '09:00',
    scheduleEndTime: '18:00',
    scheduleDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    scheduleTimezone: 'America/Sao_Paulo',
    priority: 10,
    pricingSource: 'usdt_binance',
    spreadMode: 'bps',
    sellSpread: 50,
    buySpread: -30,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function createTestContext(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    message: 'preço',
    groupJid: 'group@g.us',
    ...overrides,
  }
}

describe('actionExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock implementations
    mockFetchPrice.mockResolvedValue({ ok: true, data: 5.82 })
    mockFormatBrazilianPrice.mockImplementation((n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`)
    mockGetSpreadConfig.mockResolvedValue({
      ok: true,
      data: {
        groupJid: 'group@g.us',
        spreadMode: 'flat',
        sellSpread: 0,
        buySpread: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })
    mockCalculateQuote.mockImplementation((rate: number) => rate)
    mockCalculateBothQuotes.mockImplementation((rate: number) => ({
      buyRate: rate,
      sellRate: rate,
    }))
    mockExtractVolumeBrl.mockReturnValue(null)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // =========================================================================
  // price_quote action
  // =========================================================================

  describe('price_quote', () => {
    it('returns price without spread when no rule and no group spread', async () => {
      const trigger = createTestTrigger({ actionType: 'price_quote' })
      const result = await executeAction(trigger, null, createTestContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.actionType).toBe('price_quote')
        expect(result.data.ruleApplied).toBe(false)
        expect(result.data.message).toContain('USDT/BRL')
      }
    })

    it('applies active rule spread config', async () => {
      const rule = createTestRule({ sellSpread: 50, buySpread: -30, spreadMode: 'bps' })
      const trigger = createTestTrigger({ actionType: 'price_quote' })

      mockCalculateBothQuotes.mockReturnValue({ buyRate: 5.85, sellRate: 5.80 })

      const result = await executeAction(trigger, rule, createTestContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.ruleApplied).toBe(true)
        expect(result.data.ruleName).toBe('Business Hours')
        expect(result.data.message).toContain('Compra')
        expect(result.data.message).toContain('Venda')
        expect(result.data.metadata.spreadMode).toBe('bps')
      }
    })

    it('falls back to group_spreads when no rule', async () => {
      mockGetSpreadConfig.mockResolvedValue({
        ok: true,
        data: {
          groupJid: 'group@g.us',
          spreadMode: 'bps',
          sellSpread: 30,
          buySpread: -20,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
      mockCalculateBothQuotes.mockReturnValue({ buyRate: 5.84, sellRate: 5.81 })

      const trigger = createTestTrigger({ actionType: 'price_quote' })
      const result = await executeAction(trigger, null, createTestContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.ruleApplied).toBe(false)
        expect(result.data.message).toContain('Compra')
        expect(result.data.message).toContain('Venda')
      }
    })

    it('returns error when Binance fails', async () => {
      mockFetchPrice.mockResolvedValue({ ok: false, error: 'Binance timeout' })

      const trigger = createTestTrigger({ actionType: 'price_quote' })
      const result = await executeAction(trigger, null, createTestContext())

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Price unavailable')
      }
    })

    it('adds prefix from actionParams', async () => {
      const trigger = createTestTrigger({
        actionType: 'price_quote',
        actionParams: { prefix: '💰' },
      })

      const result = await executeAction(trigger, null, createTestContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.message).toMatch(/^💰/)
      }
    })

    it('logs price quote execution', async () => {
      const trigger = createTestTrigger({ actionType: 'price_quote' })
      await executeAction(trigger, null, createTestContext())

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Price quote action executed',
        expect.objectContaining({
          event: 'action_price_quote',
          groupJid: 'group@g.us',
        })
      )
    })
  })

  // =========================================================================
  // volume_quote action
  // =========================================================================

  describe('volume_quote', () => {
    it('calculates volume when amount is found in message', async () => {
      mockExtractVolumeBrl.mockReturnValue(10000)
      mockCalculateQuote.mockReturnValue(5.85)
      mockFormatBrazilianPrice.mockReturnValue('R$ 5,85')

      const trigger = createTestTrigger({ actionType: 'volume_quote' })
      const result = await executeAction(trigger, null, createTestContext({ message: 'compro 10k' }))

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.actionType).toBe('volume_quote')
        expect(result.data.message).toContain('USDT')
        expect(result.data.metadata.volumeBrl).toBe(10000)
      }
    })

    it('falls back to price quote when no volume found', async () => {
      mockExtractVolumeBrl.mockReturnValue(null)

      const trigger = createTestTrigger({ actionType: 'volume_quote' })
      const result = await executeAction(trigger, null, createTestContext({ message: 'preço' }))

      expect(result.ok).toBe(true)
      if (result.ok) {
        // Falls back to price_quote behavior
        expect(result.data.actionType).toBe('price_quote')
      }
    })

    it('applies rule pricing to volume calculation', async () => {
      mockExtractVolumeBrl.mockReturnValue(5000)
      mockCalculateQuote.mockReturnValue(5.90)
      mockFormatBrazilianPrice.mockReturnValue('R$ 5,90')

      const rule = createTestRule({ sellSpread: 80, spreadMode: 'bps', name: 'Weekend Premium' })
      const trigger = createTestTrigger({ actionType: 'volume_quote' })

      const result = await executeAction(trigger, rule, createTestContext({ message: 'compro 5k' }))

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.ruleApplied).toBe(true)
        expect(result.data.ruleName).toBe('Weekend Premium')
        expect(result.data.metadata.volumeBrl).toBe(5000)
      }
    })

    it('returns error when Binance fails for volume', async () => {
      mockExtractVolumeBrl.mockReturnValue(10000)
      mockFetchPrice.mockResolvedValue({ ok: false, error: 'Network error' })

      const trigger = createTestTrigger({ actionType: 'volume_quote' })
      const result = await executeAction(trigger, null, createTestContext({ message: 'compro 10k' }))

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Price unavailable')
      }
    })
  })

  // =========================================================================
  // text_response action
  // =========================================================================

  describe('text_response', () => {
    it('returns static text from actionParams', async () => {
      const trigger = createTestTrigger({
        actionType: 'text_response',
        actionParams: { text: 'Como posso ajudar?' },
      })

      const result = await executeAction(trigger, null, createTestContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.actionType).toBe('text_response')
        expect(result.data.message).toBe('Como posso ajudar?')
        expect(result.data.ruleApplied).toBe(false)
      }
    })

    it('returns error when text is missing', async () => {
      const trigger = createTestTrigger({
        actionType: 'text_response',
        actionParams: {},
      })

      const result = await executeAction(trigger, null, createTestContext())

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('no "text"')
      }
    })

    it('ignores active rule for text_response', async () => {
      const rule = createTestRule()
      const trigger = createTestTrigger({
        actionType: 'text_response',
        actionParams: { text: 'Hello!' },
      })

      const result = await executeAction(trigger, rule, createTestContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.ruleApplied).toBe(false)
        expect(result.data.message).toBe('Hello!')
      }
    })
  })

  // =========================================================================
  // ai_prompt action
  // =========================================================================

  describe('ai_prompt', () => {
    it('returns prompt configuration', async () => {
      const trigger = createTestTrigger({
        actionType: 'ai_prompt',
        actionParams: { prompt: 'Help the user with their question' },
      })

      const result = await executeAction(trigger, null, createTestContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.actionType).toBe('ai_prompt')
        expect(result.data.message).toContain('Help the user')
        expect(result.data.metadata.isAiPrompt).toBe(true)
        expect(result.data.ruleApplied).toBe(false)
      }
    })

    it('includes rule context when rule is active', async () => {
      const rule = createTestRule({
        name: 'Business Hours',
        pricingSource: 'commercial_dollar',
        spreadMode: 'bps',
        sellSpread: 50,
        buySpread: -30,
      })
      const trigger = createTestTrigger({
        actionType: 'ai_prompt',
        actionParams: { prompt: 'Help the user' },
      })

      const result = await executeAction(trigger, rule, createTestContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.ruleApplied).toBe(true)
        expect(result.data.ruleName).toBe('Business Hours')
        expect(result.data.message).toContain('Business Hours')
        expect(result.data.message).toContain('commercial_dollar')
        expect(result.data.metadata.ruleContext).toBeDefined()
      }
    })

    it('includes additional context from actionParams', async () => {
      const trigger = createTestTrigger({
        actionType: 'ai_prompt',
        actionParams: {
          prompt: 'Help the user',
          context: 'This is a crypto OTC group',
        },
      })

      const result = await executeAction(trigger, null, createTestContext())

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.message).toContain('Help the user')
        expect(result.data.message).toContain('crypto OTC group')
      }
    })

    it('returns error when prompt is missing', async () => {
      const trigger = createTestTrigger({
        actionType: 'ai_prompt',
        actionParams: {},
      })

      const result = await executeAction(trigger, null, createTestContext())

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('no "prompt"')
      }
    })

    it('includes senderName in metadata', async () => {
      const trigger = createTestTrigger({
        actionType: 'ai_prompt',
        actionParams: { prompt: 'Help the user' },
      })

      const result = await executeAction(trigger, null, createTestContext({ senderName: 'João' }))

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.metadata.senderName).toBe('João')
      }
    })
  })

  // =========================================================================
  // Unknown action type
  // =========================================================================

  describe('unknown action type', () => {
    it('returns error for unknown action', async () => {
      const trigger = createTestTrigger({
        actionType: 'custom' as any,
      })

      const result = await executeAction(trigger, null, createTestContext())

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Unknown action type')
      }
    })
  })

  // =========================================================================
  // Error handling
  // =========================================================================

  describe('error handling', () => {
    it('catches exceptions and returns err', async () => {
      mockFetchPrice.mockRejectedValue(new Error('Network failure'))

      const trigger = createTestTrigger({ actionType: 'price_quote' })
      const result = await executeAction(trigger, null, createTestContext())

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Action execution failed')
        expect(result.error).toContain('Network failure')
      }
    })

    it('logs action execution start', async () => {
      const trigger = createTestTrigger({ actionType: 'price_quote' })
      await executeAction(trigger, null, createTestContext())

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Executing action',
        expect.objectContaining({
          event: 'action_execute_start',
          triggerId: 'trigger-1',
          actionType: 'price_quote',
        })
      )
    })
  })
})
