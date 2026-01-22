import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  logPriceQuote,
  validateExcelAccess,
  type LogEntry,
} from './excel.js'

// =============================================================================
// Mocks
// =============================================================================
const mockFetch = vi.hoisted(() => vi.fn())
const mockEnsureValidToken = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))
const mockConfig = vi.hoisted(() => ({
  EXCEL_SITE_ID: 'test-site-id',
  EXCEL_DRIVE_ID: 'test-drive-id',
  EXCEL_FILE_ID: 'test-file-id',
  EXCEL_WORKSHEET_NAME: 'Quotes',
  EXCEL_TABLE_NAME: 'Table1',
}))
const mockQueueLogEntry = vi.hoisted(() => vi.fn())
const mockFlushQueuedEntries = vi.hoisted(() => vi.fn())

vi.stubGlobal('fetch', mockFetch)

vi.mock('./graph.js', () => ({
  ensureValidToken: mockEnsureValidToken,
  classifyGraphError: vi.fn().mockReturnValue('transient'),
}))

vi.mock('../utils/logger.js', () => ({
  logger: mockLogger,
}))

vi.mock('../config.js', () => ({
  getConfig: () => mockConfig,
}))

// Mock the log queue module
vi.mock('./logQueue.js', () => ({
  queueLogEntry: mockQueueLogEntry,
  flushQueuedEntries: mockFlushQueuedEntries,
  setAppendRowFn: vi.fn(),
}))

// =============================================================================
// Test Data
// =============================================================================
const testLogEntry: LogEntry = {
  timestamp: new Date('2026-01-16T12:00:00Z'),
  groupName: 'Crypto OTC Brasil',
  groupId: '551199999999-1234567890@g.us',
  clientIdentifier: '+55 11 99999-9999',
  quoteValue: 5.82,
  quoteFormatted: 'R$5,82',
}

// =============================================================================
// Story 5.2: Excel Logging Service Tests
// =============================================================================
describe('excel.ts - Story 5.2: Excel Logging Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnsureValidToken.mockResolvedValue({ ok: true, data: 'test-token' })
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ index: 5 }),
    })
    mockQueueLogEntry.mockResolvedValue(undefined)
    mockFlushQueuedEntries.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  // ===========================================================================
  // AC1: Log entry creation
  // ===========================================================================
  describe('AC1: Log entry creation - logPriceQuote()', () => {
    it('appends row to Excel worksheet on success', async () => {
      const result = await logPriceQuote(testLogEntry)

      expect(result.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('calls Graph API with correct URL', async () => {
      await logPriceQuote(testLogEntry)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('test-file-id'),
        expect.any(Object)
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('Quotes'),
        expect.any(Object)
      )
    })

    it('passes bearer token in authorization header', async () => {
      await logPriceQuote(testLogEntry)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      )
    })
  })

  // ===========================================================================
  // AC2: Log entry format
  // ===========================================================================
  describe('AC2: Log entry format', () => {
    it('sends row data with correct format [timestamp, group, client, quote]', async () => {
      await logPriceQuote(testLogEntry)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('2026-01-16T12:00:00.000Z'),
        })
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('Crypto OTC Brasil'),
        })
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('+55 11 99999-9999'),
        })
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('R$5,82'),
        })
      )
    })

    it('includes Content-Type application/json header', async () => {
      await logPriceQuote(testLogEntry)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )
    })
  })

  // ===========================================================================
  // AC3: Excel file validation
  // ===========================================================================
  describe('AC3: Excel file validation - validateExcelAccess()', () => {
    it('returns ok when file is accessible', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'Quotes.xlsx' }),
      })

      const result = await validateExcelAccess()

      expect(result.ok).toBe(true)
    })

    it('returns error when file is not accessible', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      const result = await validateExcelAccess()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('404')
      }
    })

    it('returns error when authentication fails', async () => {
      mockEnsureValidToken.mockResolvedValueOnce({ ok: false, error: 'Auth failed' })

      const result = await validateExcelAccess()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Auth')
      }
    })

    it('logs validation success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'Quotes.xlsx' }),
      })

      await validateExcelAccess()

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          event: 'excel_validation_success',
        })
      )
    })

    it('logs validation failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      await validateExcelAccess()

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          event: 'excel_validation_error',
        })
      )
    })
  })

  // ===========================================================================
  // AC4: Success response
  // ===========================================================================
  describe('AC4: Success response', () => {
    it('returns ok true with row number on success', async () => {
      // Ensure mocks are set correctly for this test
      mockEnsureValidToken.mockResolvedValue({ ok: true, data: 'test-token' })
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ index: 42 }),
      })

      const result = await logPriceQuote(testLogEntry)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.rowNumber).toBe(42)
      }
    })

    it('logs successful append with row number', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ index: 10 }),
      })

      await logPriceQuote(testLogEntry)

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          event: 'excel_row_appended',
          rowNumber: 10,
        })
      )
    })
  })

  // ===========================================================================
  // AC5: Failure response
  // ===========================================================================
  describe('AC5: Failure response', () => {
    it('returns ok false with error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      const result = await logPriceQuote(testLogEntry)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('500')
      }
    })

    it('returns ok false with error on auth failure', async () => {
      mockEnsureValidToken.mockResolvedValueOnce({ ok: false, error: 'Token expired' })

      const result = await logPriceQuote(testLogEntry)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Auth')
      }
    })

    it('queues entry for retry on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      })

      await logPriceQuote(testLogEntry)

      expect(mockQueueLogEntry).toHaveBeenCalledWith(testLogEntry)
    })

    it('logs failure with context', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      })

      await logPriceQuote(testLogEntry)

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          event: 'excel_append_error',
          status: 429,
        })
      )
    })

    it('handles network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'))

      const result = await logPriceQuote(testLogEntry)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Network timeout')
      }
    })

    it('queues entry on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'))

      await logPriceQuote(testLogEntry)

      expect(mockQueueLogEntry).toHaveBeenCalledWith(testLogEntry)
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================
  describe('Edge cases', () => {
    it('handles special characters in group name', async () => {
      const entryWithSpecialChars = {
        ...testLogEntry,
        groupName: 'Crypto & OTC "Deals" <Brasil>',
      }

      await logPriceQuote(entryWithSpecialChars)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('Crypto & OTC'),
        })
      )
    })

    it('handles very long client identifiers', async () => {
      // Ensure mocks are set correctly for this test
      mockEnsureValidToken.mockResolvedValue({ ok: true, data: 'test-token' })
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ index: 1 }),
      })

      const entryWithLongId = {
        ...testLogEntry,
        clientIdentifier: 'João da Silva Oliveira Pereira Santos',
      }

      const result = await logPriceQuote(entryWithLongId)

      expect(result.ok).toBe(true)
    })

    it('handles decimal quote values correctly', async () => {
      const entryWithDecimal = {
        ...testLogEntry,
        quoteValue: 5.824567,
        quoteFormatted: 'R$5,82',
      }

      await logPriceQuote(entryWithDecimal)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('R$5,82'),
        })
      )
    })
  })
})
