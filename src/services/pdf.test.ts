import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { extractPdfText, PDF_EXTRACTION_TIMEOUT_MS } from './pdf.js'

// Mock unpdf
vi.mock('unpdf', () => ({
  extractText: vi.fn(),
}))

// Mock logger to verify logging behavior
vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Import mocked modules for assertions
import { extractText } from 'unpdf'
import { logger } from '../utils/logger.js'

const mockExtractText = extractText as ReturnType<typeof vi.fn>

describe('extractPdfText', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('constants', () => {
    it('exports PDF_EXTRACTION_TIMEOUT_MS as 5000ms (NFR18)', () => {
      expect(PDF_EXTRACTION_TIMEOUT_MS).toBe(5000)
    })
  })

  describe('AC1: Successful Text Extraction', () => {
    it('returns extracted text on success', async () => {
      const sampleText = 'Comprovante de Transferência PIX\nValor: R$ 100,00'
      mockExtractText.mockResolvedValue({ text: sampleText })

      const buffer = Buffer.from('fake-pdf-content')
      const resultPromise = extractPdfText(buffer)
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe(sampleText)
      }
    })

    it('returns empty string when PDF has no text', async () => {
      mockExtractText.mockResolvedValue({ text: '' })

      const buffer = Buffer.from('fake-pdf-content')
      const resultPromise = extractPdfText(buffer)
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe('')
      }
    })

    it('handles undefined text in response', async () => {
      mockExtractText.mockResolvedValue({})

      const buffer = Buffer.from('fake-pdf-content')
      const resultPromise = extractPdfText(buffer)
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe('')
      }
    })

    it('passes buffer to extractText function', async () => {
      mockExtractText.mockResolvedValue({ text: 'some text' })

      const buffer = Buffer.from('specific-pdf-content')
      const resultPromise = extractPdfText(buffer)
      await vi.runAllTimersAsync()
      await resultPromise

      expect(mockExtractText).toHaveBeenCalledWith(buffer)
    })
  })

  describe('AC2: Fast Response (NFR18 Compliance)', () => {
    it('returns immediately when extraction completes quickly', async () => {
      mockExtractText.mockResolvedValue({ text: 'Quick extraction' })

      const buffer = Buffer.from('fake-pdf-content')
      const resultPromise = extractPdfText(buffer)
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe('Quick extraction')
      }
    })

    it('succeeds if extraction completes just before timeout', async () => {
      let resolveExtraction: (value: { text: string }) => void
      mockExtractText.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveExtraction = resolve
          })
      )

      const buffer = Buffer.from('fake-pdf-content')
      const resultPromise = extractPdfText(buffer)

      // Advance to just before timeout
      await vi.advanceTimersByTimeAsync(4999)

      // Resolve extraction
      resolveExtraction!({ text: 'Just in time' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe('Just in time')
      }
    })
  })

  describe('AC3: Timeout Handling', () => {
    it('returns timeout error after 5 seconds', async () => {
      // Create extraction that never resolves
      mockExtractText.mockImplementation(() => new Promise(() => {}))

      const buffer = Buffer.from('fake-pdf-content')
      const resultPromise = extractPdfText(buffer)

      // Advance timer past timeout
      await vi.advanceTimersByTimeAsync(5001)
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('PDF extraction timeout')
      }
    })

    it('does NOT timeout before 5 seconds', async () => {
      let resolveExtraction: (value: { text: string }) => void
      mockExtractText.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveExtraction = resolve
          })
      )

      const buffer = Buffer.from('fake-pdf-content')
      const resultPromise = extractPdfText(buffer)

      // Advance to just before timeout
      await vi.advanceTimersByTimeAsync(4999)

      // Resolve the extraction
      resolveExtraction!({ text: 'Completed before timeout' })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Should succeed, not timeout
      expect(result.ok).toBe(true)
    })

    it('logs timeout with duration and timeout config', async () => {
      mockExtractText.mockImplementation(() => new Promise(() => {}))

      const buffer = Buffer.from('fake-pdf-content')
      const resultPromise = extractPdfText(buffer)

      await vi.advanceTimersByTimeAsync(5001)
      await resultPromise

      expect(logger.warn).toHaveBeenCalledWith(
        'PDF extraction timeout',
        expect.objectContaining({
          event: 'pdf_extraction_timeout',
          durationMs: expect.any(Number),
          timeoutMs: 5000,
        })
      )
    })
  })

  describe('AC4: Malformed PDF Handling', () => {
    it('returns error for malformed PDF', async () => {
      mockExtractText.mockRejectedValue(new Error('Invalid PDF structure'))

      const buffer = Buffer.from('not-a-real-pdf')
      const resultPromise = extractPdfText(buffer)
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Invalid PDF structure')
      }
    })

    it('returns error for empty buffer', async () => {
      mockExtractText.mockRejectedValue(new Error('Empty PDF'))

      const buffer = Buffer.alloc(0)
      const resultPromise = extractPdfText(buffer)
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Empty PDF')
      }
    })

    it('returns error for corrupted PDF', async () => {
      mockExtractText.mockRejectedValue(new Error('PDF is corrupted'))

      const buffer = Buffer.from('corrupted-pdf-content')
      const resultPromise = extractPdfText(buffer)
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('PDF is corrupted')
      }
    })

    it('handles non-Error thrown objects', async () => {
      mockExtractText.mockRejectedValue('String error message')

      const buffer = Buffer.from('fake-pdf-content')
      const resultPromise = extractPdfText(buffer)
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('String error message')
      }
    })

    it('logs extraction error with details', async () => {
      mockExtractText.mockRejectedValue(new Error('Parse failed at offset 42'))

      const buffer = Buffer.from('fake-pdf-content')
      const resultPromise = extractPdfText(buffer)
      await vi.runAllTimersAsync()
      await resultPromise

      expect(logger.error).toHaveBeenCalledWith(
        'PDF extraction failed',
        expect.objectContaining({
          event: 'pdf_extraction_error',
          error: 'Parse failed at offset 42',
          durationMs: expect.any(Number),
        })
      )
    })
  })

  describe('Logging and Metrics', () => {
    it('logs success with duration and text length', async () => {
      const sampleText = 'Sample extracted text content'
      mockExtractText.mockResolvedValue({ text: sampleText })

      const buffer = Buffer.from('fake-pdf-content')
      const resultPromise = extractPdfText(buffer)
      await vi.runAllTimersAsync()
      await resultPromise

      expect(logger.info).toHaveBeenCalledWith(
        'PDF text extracted',
        expect.objectContaining({
          event: 'pdf_text_extracted',
          durationMs: expect.any(Number),
          textLength: sampleText.length,
        })
      )
    })

    it('logs text length as 0 for empty extraction', async () => {
      mockExtractText.mockResolvedValue({ text: '' })

      const buffer = Buffer.from('fake-pdf-content')
      const resultPromise = extractPdfText(buffer)
      await vi.runAllTimersAsync()
      await resultPromise

      expect(logger.info).toHaveBeenCalledWith(
        'PDF text extracted',
        expect.objectContaining({
          textLength: 0,
        })
      )
    })
  })

  describe('Result pattern compliance', () => {
    it('never throws, always returns Result', async () => {
      // Test with various error scenarios
      const errorScenarios = [
        vi.fn().mockRejectedValue(new Error('Error 1')),
        vi.fn().mockRejectedValue(new TypeError('Type error')),
        vi.fn().mockRejectedValue(null),
        vi.fn().mockRejectedValue(undefined),
        vi.fn().mockRejectedValue({ custom: 'error object' }),
      ]

      for (const mockFn of errorScenarios) {
        vi.mocked(extractText).mockImplementation(mockFn)

        const buffer = Buffer.from('fake-pdf-content')
        const resultPromise = extractPdfText(buffer)
        await vi.runAllTimersAsync()
        const result = await resultPromise

        // Should always return a Result object
        expect(result).toHaveProperty('ok')
        if (!result.ok) {
          expect(result).toHaveProperty('error')
          expect(typeof result.error).toBe('string')
        }
      }
    })

    it('returns Result with ok: true on success', async () => {
      mockExtractText.mockResolvedValue({ text: 'success' })

      const buffer = Buffer.from('fake-pdf-content')
      const resultPromise = extractPdfText(buffer)
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result).toEqual({
        ok: true,
        data: 'success',
      })
    })

    it('returns Result with ok: false on error', async () => {
      mockExtractText.mockRejectedValue(new Error('fail'))

      const buffer = Buffer.from('fake-pdf-content')
      const resultPromise = extractPdfText(buffer)
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(typeof result.error).toBe('string')
        expect(result.error).toContain('fail')
      }
    })
  })
})
