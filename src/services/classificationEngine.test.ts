/**
 * Tests for Classification Engine
 *
 * Tests the unified classification pipeline.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  classifyOTCMessage,
  classifyQuick,
  isAIClassificationAvailable,
  type ClassificationRequest,
} from './classificationEngine.js'

// Mock the AI classifier to avoid actual API calls
vi.mock('./aiClassifier.js', async () => {
  const actual = await vi.importActual('./aiClassifier.js')
  return {
    ...actual,
    classifyWithAI: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        messageType: 'price_lock',
        confidence: 'high',
        reasoning: 'Contains "trava" pattern with amount',
        suggestedAction: 'respond',
        extractedData: { volumeUsdt: 5000, intent: 'buy' },
      },
    }),
    shouldUseAI: vi.fn().mockReturnValue(false), // Default to not using AI
  }
})

// Mock config
vi.mock('../config.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    OPENROUTER_API_KEY: 'test-key',
    PHONE_NUMBER: '5511999999999',
  }),
}))

describe('classificationEngine', () => {
  const createRequest = (
    message: string,
    overrides: Partial<ClassificationRequest> = {}
  ): ClassificationRequest => ({
    message,
    groupId: 'group@g.us',
    senderJid: 'user@s.whatsapp.net',
    isFromBot: false,
    hasReceipt: false,
    hasTronscan: false,
    hasPriceTrigger: false,
    ...overrides,
  })

  describe('classifyOTCMessage', () => {
    describe('rules-only classification', () => {
      it('classifies price_request correctly', async () => {
        const result = await classifyOTCMessage(createRequest('cotação'))
        expect(result.messageType).toBe('price_request')
        expect(result.source).toBe('rules')
        expect(result.aiUsed).toBe(false)
      })

      it('classifies price_lock (trava) correctly', async () => {
        const result = await classifyOTCMessage(createRequest('trava 5000'))
        expect(result.messageType).toBe('price_lock')
        expect(result.source).toBe('rules')
        expect(result.confidence).toBe('high')
      })

      it('classifies quote_calculation correctly', async () => {
        const result = await classifyOTCMessage(
          createRequest('5000 * 5.230 = 26,150.00 BRL')
        )
        expect(result.messageType).toBe('quote_calculation')
        expect(result.source).toBe('rules')
      })

      it('classifies bot_command correctly', async () => {
        const result = await classifyOTCMessage(createRequest('/compra'))
        expect(result.messageType).toBe('bot_command')
        expect(result.source).toBe('rules')
      })

      it('classifies confirmation correctly', async () => {
        const result = await classifyOTCMessage(
          createRequest('Fecha', { inActiveThread: true })
        )
        expect(result.messageType).toBe('confirmation')
      })

      it('classifies tronscan correctly', async () => {
        const result = await classifyOTCMessage(
          createRequest('https://tronscan.org/#/transaction/abc123', {
            hasTronscan: true,
          })
        )
        expect(result.messageType).toBe('tronscan')
        expect(result.confidence).toBe('high')
      })

      it('classifies English price requests correctly', async () => {
        const result = await classifyOTCMessage(createRequest('price?'))
        expect(result.messageType).toBe('price_request')
      })

      it('classifies tx pls as price_request', async () => {
        const result = await classifyOTCMessage(createRequest('tx pls'))
        expect(result.messageType).toBe('price_request')
      })
    })

    describe('skipAI option', () => {
      it('never invokes AI when skipAI is true', async () => {
        const result = await classifyOTCMessage(
          createRequest('ambiguous message', { skipAI: true })
        )
        expect(result.aiUsed).toBe(false)
        expect(result.source).toBe('rules')
      })
    })

    describe('forceAI option', async () => {
      const { shouldUseAI, classifyWithAI } = await import('./aiClassifier.js')

      beforeEach(() => {
        vi.mocked(shouldUseAI).mockReturnValue(false)
        vi.mocked(classifyWithAI).mockResolvedValue({
          ok: true,
          data: {
            messageType: 'price_lock',
            confidence: 'high',
            reasoning: 'Test',
            suggestedAction: 'respond',
          },
        })
      })

      it('invokes AI when forceAI is true', async () => {
        const result = await classifyOTCMessage(
          createRequest('some message', { forceAI: true })
        )
        expect(result.aiUsed).toBe(true)
        expect(result.aiInvocationReason).toBe('forced')
      })
    })

    describe('result structure', () => {
      it('includes processingTimeMs', async () => {
        const result = await classifyOTCMessage(createRequest('cotação'))
        expect(result.processingTimeMs).toBeGreaterThanOrEqual(0)
      })

      it('includes source', async () => {
        const result = await classifyOTCMessage(createRequest('cotação'))
        expect(result.source).toBeDefined()
      })

      it('includes aiUsed flag', async () => {
        const result = await classifyOTCMessage(createRequest('cotação'))
        expect(typeof result.aiUsed).toBe('boolean')
      })
    })

    describe('volume extraction', () => {
      it('extracts BRL volume', async () => {
        const result = await classifyOTCMessage(createRequest('trava 5000'))
        expect(result.volumeBrl).toBe(5000)
      })

      it('extracts USDT volume', async () => {
        const result = await classifyOTCMessage(createRequest('vendo 500 usdt'))
        expect(result.volumeUsdt).toBe(500)
      })
    })
  })

  describe('classifyQuick', () => {
    it('performs rules-only classification', () => {
      const result = classifyQuick('cotação', {
        isFromBot: false,
        hasReceipt: false,
        hasTronscan: false,
        hasPriceTrigger: false,
      })
      expect(result.messageType).toBe('price_request')
    })

    it('respects context flags', () => {
      const result = classifyQuick('any message', {
        isFromBot: true,
        hasReceipt: false,
        hasTronscan: false,
        hasPriceTrigger: false,
      })
      expect(result.messageType).toBe('price_response')
    })
  })

  describe('isAIClassificationAvailable', () => {
    it('returns true when API key is configured', () => {
      expect(isAIClassificationAvailable()).toBe(true)
    })
  })
})
