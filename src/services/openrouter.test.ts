import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  extractImageReceipt,
  OPENROUTER_API_URL,
  OPENROUTER_MODEL,
  OCR_TIMEOUT_MS,
} from './openrouter.js'

// Mock getConfig
vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({
    OPENROUTER_API_KEY: 'test-api-key',
  })),
}))

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { getConfig } from '../config.js'
import { logger } from '../utils/logger.js'

const mockGetConfig = getConfig as ReturnType<typeof vi.fn>

describe('extractImageReceipt', () => {
  const sampleReceiptData = {
    valor: 30000000,
    dataHora: '2024-01-15T10:30:00Z',
    tipo: 'Pix',
    identificador: 'E12345678901234567890123456789012',
    recebedor: { nome: 'João Silva', cpfCnpj: '12345678901' },
    pagador: { nome: 'Maria Santos', cpfCnpj: '98765432101' },
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue({ OPENROUTER_API_KEY: 'test-api-key' })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('constants', () => {
    it('exports correct OPENROUTER_API_URL', () => {
      expect(OPENROUTER_API_URL).toBe('https://openrouter.ai/api/v1/chat/completions')
    })

    it('exports correct OPENROUTER_MODEL', () => {
      expect(OPENROUTER_MODEL).toBe('anthropic/claude-3-5-haiku-20241022')
    })

    it('exports OCR_TIMEOUT_MS as 10000ms (NFR21)', () => {
      expect(OCR_TIMEOUT_MS).toBe(10000)
    })
  })

  describe('AC1: Successful Receipt Extraction', () => {
    it('returns extracted receipt data on success', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              choices: [{ message: { content: JSON.stringify(sampleReceiptData) } }],
              usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
            }),
        })
      )

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual(sampleReceiptData)
      }
    })

    it('sends correct request to OpenRouter API', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: JSON.stringify(sampleReceiptData) } }],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const buffer = Buffer.from('test-image-data')
      const resultPromise = extractImageReceipt(buffer, 'image/png')
      await vi.runAllTimersAsync()
      await resultPromise

      expect(mockFetch).toHaveBeenCalledWith(
        OPENROUTER_API_URL,
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          },
        })
      )

      // Verify request body structure
      const callArgs = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(callArgs[1].body)
      expect(requestBody.model).toBe(OPENROUTER_MODEL)
      expect(requestBody.messages[0].content).toHaveLength(2)
      expect(requestBody.messages[0].content[0].type).toBe('text')
      expect(requestBody.messages[0].content[1].type).toBe('image_url')
      expect(requestBody.messages[0].content[1].image_url.url).toContain('data:image/png;base64,')
    })

    it('converts buffer to base64 for API request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: JSON.stringify(sampleReceiptData) } }],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const originalContent = 'test image bytes'
      const buffer = Buffer.from(originalContent)
      const expectedBase64 = buffer.toString('base64')

      const resultPromise = extractImageReceipt(buffer, 'image/webp')
      await vi.runAllTimersAsync()
      await resultPromise

      const callArgs = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(callArgs[1].body)
      expect(requestBody.messages[0].content[1].image_url.url).toBe(
        `data:image/webp;base64,${expectedBase64}`
      )
    })
  })

  describe('AC2: Fast Response (NFR21 Compliance)', () => {
    it('returns immediately when API responds quickly', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              choices: [{ message: { content: JSON.stringify(sampleReceiptData) } }],
              usage: { prompt_tokens: 100, completion_tokens: 50 },
            }),
        })
      )

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(true)
    })
  })

  describe('AC3: Timeout Handling', () => {
    it('returns timeout error after 10 seconds', async () => {
      // Create a fetch that never resolves
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})))

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')

      // Advance timer past timeout
      await vi.advanceTimersByTimeAsync(10001)
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('OCR timeout')
      }
    })

    it('does NOT timeout before 10 seconds', async () => {
      let resolvePromise: (value: Response) => void
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              resolvePromise = resolve
            })
        )
      )

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')

      // Advance to just before timeout
      await vi.advanceTimersByTimeAsync(9999)

      // Resolve the fetch
      resolvePromise!({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: JSON.stringify(sampleReceiptData) } }],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
      } as Response)

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(true)
    })

    it('logs timeout with duration and config', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})))

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')

      await vi.advanceTimersByTimeAsync(10001)
      await resultPromise

      expect(logger.warn).toHaveBeenCalledWith(
        'OpenRouter OCR timeout',
        expect.objectContaining({
          event: 'openrouter_ocr_timeout',
          durationMs: expect.any(Number),
          timeoutMs: 10000,
        })
      )
    })
  })

  describe('AC4: Extraction Failure Handling', () => {
    it('returns error when Claude cannot extract data', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              choices: [{ message: { content: JSON.stringify({ error: 'Image is blurry' }) } }],
              usage: { prompt_tokens: 100, completion_tokens: 20 },
            }),
        })
      )

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Could not extract receipt data')
        expect(result.error).toContain('Image is blurry')
      }
    })

    it('returns error when response is not valid JSON', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              choices: [{ message: { content: 'This is not JSON' } }],
              usage: { prompt_tokens: 100, completion_tokens: 20 },
            }),
        })
      )

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Could not extract receipt data')
      }
    })

    it('returns error when response content is empty', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              choices: [{ message: { content: '' } }],
              usage: { prompt_tokens: 100, completion_tokens: 0 },
            }),
        })
      )

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('OpenRouter returned empty content')
      }
    })

    it('logs extraction failure from Claude', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              choices: [{ message: { content: JSON.stringify({ error: 'No receipt found' }) } }],
              usage: { prompt_tokens: 100, completion_tokens: 20 },
            }),
        })
      )

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')
      await vi.runAllTimersAsync()
      await resultPromise

      expect(logger.warn).toHaveBeenCalledWith(
        'Claude could not extract receipt data',
        expect.objectContaining({
          event: 'openrouter_extraction_failed',
          reason: 'No receipt found',
        })
      )
    })
  })

  describe('AC5: API Key Configuration', () => {
    it('returns error when API key is not configured', async () => {
      mockGetConfig.mockReturnValue({ OPENROUTER_API_KEY: undefined })

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('OpenRouter API key not configured')
      }
    })

    it('logs error when API key is missing', async () => {
      mockGetConfig.mockReturnValue({ OPENROUTER_API_KEY: '' })

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')
      await vi.runAllTimersAsync()
      await resultPromise

      expect(logger.error).toHaveBeenCalledWith(
        'OpenRouter API key not configured',
        expect.objectContaining({
          event: 'openrouter_not_configured',
        })
      )
    })
  })

  describe('AC6: Cost/Token Logging (NFR22)', () => {
    it('logs token usage and cost on success', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              choices: [{ message: { content: JSON.stringify(sampleReceiptData) } }],
              usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
            }),
        })
      )

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')
      await vi.runAllTimersAsync()
      await resultPromise

      expect(logger.info).toHaveBeenCalledWith(
        'OpenRouter OCR completed',
        expect.objectContaining({
          event: 'openrouter_ocr_completed',
          model: OPENROUTER_MODEL,
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          costUsd: expect.any(String),
          durationMs: expect.any(Number),
        })
      )
    })

    it('calculates cost correctly', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              choices: [{ message: { content: JSON.stringify(sampleReceiptData) } }],
              usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 },
            }),
        })
      )

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')
      await vi.runAllTimersAsync()
      await resultPromise

      // Input: 1000 tokens * $0.0008/1K = $0.0008
      // Output: 1000 tokens * $0.004/1K = $0.004
      // Total: $0.0048
      expect(logger.info).toHaveBeenCalledWith(
        'OpenRouter OCR completed',
        expect.objectContaining({
          costUsd: '0.004800',
        })
      )
    })
  })

  describe('API Error Handling', () => {
    it('returns error on HTTP 401 Unauthorized', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
        })
      )

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('401')
      }
    })

    it('returns error on HTTP 500', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        })
      )

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('500')
      }
    })

    it('returns error on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Network error')
      }
    })

    it('returns error when API returns error object', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              error: { message: 'Rate limit exceeded', code: 'rate_limit' },
            }),
        })
      )

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Rate limit exceeded')
      }
    })

    it('logs API error with status code', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 429,
        })
      )

      const buffer = Buffer.from('fake-image-content')
      const resultPromise = extractImageReceipt(buffer, 'image/jpeg')
      await vi.runAllTimersAsync()
      await resultPromise

      expect(logger.error).toHaveBeenCalledWith(
        'OpenRouter API error',
        expect.objectContaining({
          event: 'openrouter_api_error',
          status: 429,
        })
      )
    })
  })

  describe('Result pattern compliance', () => {
    it('never throws, always returns Result', async () => {
      const errorScenarios = [
        vi.fn().mockRejectedValue(new Error('Network error')),
        vi.fn().mockRejectedValue(new TypeError('Type error')),
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
        vi
          .fn()
          .mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('JSON error')) }),
      ]

      for (const mockFetch of errorScenarios) {
        vi.stubGlobal('fetch', mockFetch)
        mockGetConfig.mockReturnValue({ OPENROUTER_API_KEY: 'test-key' })

        const buffer = Buffer.from('fake-image-content')
        const resultPromise = extractImageReceipt(buffer, 'image/jpeg')
        await vi.runAllTimersAsync()
        const result = await resultPromise

        expect(result).toHaveProperty('ok')
        if (!result.ok) {
          expect(result).toHaveProperty('error')
          expect(typeof result.error).toBe('string')
        }
      }
    })
  })
})
