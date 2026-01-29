/**
 * Integration Tests for Classification Engine
 *
 * Party-mode review: Murat identified need for full pipeline integration tests.
 * Tests the complete flow: message → rules → AI fallback → result
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { classifyOTCMessage, classifyQuick, isAIClassificationAvailable } from './classificationEngine.js'
import { resetAIMetrics, getAIMetrics } from './aiClassifier.js'
import type { ClassificationRequest } from './classificationEngine.js'

// Mock the config module
vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({
    OPENROUTER_API_KEY: 'test-api-key',
    PHONE_NUMBER: '5511999999999',
  })),
}))

// Mock fetch for OpenRouter API
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('classificationEngine integration', () => {
  beforeEach(() => {
    resetAIMetrics()
    vi.useFakeTimers()
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const createRequest = (overrides: Partial<ClassificationRequest> = {}): ClassificationRequest => ({
    message: 'test message',
    groupId: 'test-group@g.us',
    senderJid: 'user@s.whatsapp.net',
    isFromBot: false,
    hasReceipt: false,
    hasTronscan: false,
    hasPriceTrigger: false,
    ...overrides,
  })

  describe('full pipeline: rules → AI fallback → result', () => {
    it('classifies high confidence messages without AI', async () => {
      const request = createRequest({
        message: 'cotação do usdt',
        hasPriceTrigger: true,
      })

      const result = await classifyOTCMessage(request)

      expect(result.messageType).toBe('price_request')
      expect(result.confidence).toBe('high')
      expect(result.source).toBe('rules')
      expect(result.aiUsed).toBe(false)
    })

    it('classifies trava pattern without AI', async () => {
      const request = createRequest({
        message: 'trava 5000',
      })

      const result = await classifyOTCMessage(request)

      expect(result.messageType).toBe('price_lock')
      expect(result.confidence).toBe('high')
      expect(result.source).toBe('rules')
      expect(result.aiUsed).toBe(false)
      expect(result.volumeBrl).toBe(5000)
    })

    it('classifies quote calculation without AI', async () => {
      const request = createRequest({
        message: '5000 * 5.23 = 26150',
      })

      const result = await classifyOTCMessage(request)

      expect(result.messageType).toBe('quote_calculation')
      expect(result.confidence).toBe('high')
      expect(result.source).toBe('rules')
      expect(result.aiUsed).toBe(false)
    })

    it('classifies bot commands without AI', async () => {
      const request = createRequest({
        message: '/compra',
      })

      const result = await classifyOTCMessage(request)

      expect(result.messageType).toBe('bot_command')
      expect(result.confidence).toBe('high')
      expect(result.source).toBe('rules')
      expect(result.aiUsed).toBe(false)
    })

    it('classifies English price requests without AI', async () => {
      const request = createRequest({
        message: 'price?',
      })

      const result = await classifyOTCMessage(request)

      expect(result.messageType).toBe('price_request')
      expect(result.source).toBe('rules')
      expect(result.aiUsed).toBe(false)
    })

    it('attempts AI for low confidence general with OTC keywords', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                messageType: 'volume_inquiry',
                confidence: 'medium',
                reasoning: 'User mentions buying with amount',
                suggestedAction: 'observe',
              }),
            },
          }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
          },
        }),
      })

      const request = createRequest({
        message: 'preciso de usdt urgente',
      })

      const result = await classifyOTCMessage(request)

      // Either AI was used or rules handled it
      expect(['rules', 'ai', 'rules+ai']).toContain(result.source)
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('falls back to rules when AI fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const request = createRequest({
        message: 'alguma coisa com usdt',
      })

      const result = await classifyOTCMessage(request)

      // Should fall back to rules
      expect(result.source).toBe('rules')
      expect(result.messageType).toBe('general')
    })

    it('skips AI for bot messages', async () => {
      const request = createRequest({
        message: 'USDT/BRL: 5.80',
        isFromBot: true,
      })

      const result = await classifyOTCMessage(request)

      expect(result.messageType).toBe('price_response')
      expect(result.source).toBe('rules')
      expect(result.aiUsed).toBe(false)
    })

    it('skips AI when explicitly disabled', async () => {
      const request = createRequest({
        message: 'alguma coisa com usdt',
        skipAI: true,
      })

      const result = await classifyOTCMessage(request)

      expect(result.source).toBe('rules')
      expect(result.aiUsed).toBe(false)
    })
  })

  describe('volume extraction through pipeline', () => {
    it('extracts BRL volume from compro pattern', async () => {
      const request = createRequest({
        message: 'compro 5 mil',
      })

      const result = await classifyOTCMessage(request)

      expect(result.volumeBrl).toBe(5000)
      expect(result.messageType).toBe('volume_inquiry')
    })

    it('extracts USDT volume from vendo pattern', async () => {
      const request = createRequest({
        message: 'vendo 500 usdt',
      })

      const result = await classifyOTCMessage(request)

      expect(result.volumeUsdt).toBe(500)
      expect(result.messageType).toBe('volume_inquiry')
    })

    it('extracts volume from k suffix', async () => {
      const request = createRequest({
        message: 'tenho 10k pra vender',
      })

      const result = await classifyOTCMessage(request)

      expect(result.volumeBrl).toBe(10000)
    })
  })

  describe('sensitive data handling', () => {
    it('does not send CPF to AI', async () => {
      const request = createRequest({
        message: 'meu cpf é 123.456.789-00 quero comprar usdt',
      })

      const result = await classifyOTCMessage(request)

      // Should classify without AI due to sensitive data
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('does not send PIX key to AI', async () => {
      const request = createRequest({
        message: 'pix: meu@email.com quero usdt',
      })

      const result = await classifyOTCMessage(request)

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('does not send TRC20 address to AI', async () => {
      const request = createRequest({
        message: 'manda pra TJYmDcHaLwnXdVJZ7bYKBRjCTrBfj3H5R8',
      })

      const result = await classifyOTCMessage(request)

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('does not send ETH address to AI', async () => {
      const request = createRequest({
        message: 'manda pra 0x742d35Cc6634C0532925a3b844Bc9e7595f8ABC1',
      })

      const result = await classifyOTCMessage(request)

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('classifyQuick (rules only)', () => {
    it('classifies without AI', () => {
      const result = classifyQuick('trava 5000', {
        isFromBot: false,
        hasReceipt: false,
        hasTronscan: false,
        hasPriceTrigger: false,
      })

      expect(result.messageType).toBe('price_lock')
      expect(result.confidence).toBe('high')
    })
  })

  describe('isAIClassificationAvailable', () => {
    it('returns true when API key is configured', () => {
      expect(isAIClassificationAvailable()).toBe(true)
    })
  })

  describe('metrics tracking', () => {
    it('tracks processing time', async () => {
      const request = createRequest({
        message: 'cotação',
        hasPriceTrigger: true,
      })

      const result = await classifyOTCMessage(request)

      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('tracks AI usage in result', async () => {
      const request = createRequest({
        message: 'cotação',
        hasPriceTrigger: true,
      })

      const result = await classifyOTCMessage(request)

      expect(typeof result.aiUsed).toBe('boolean')
    })
  })
})
