import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleReceipt } from './receipt.js'
import type { RouterContext } from '../bot/router.js'
import type { WASocket, proto } from '@whiskeysockets/baileys'
import type { ReceiptData } from '../types/receipt.js'

// Mock Baileys downloadMediaMessage
vi.mock('@whiskeysockets/baileys', () => ({
  downloadMediaMessage: vi.fn(),
}))

// Mock all service dependencies
vi.mock('../services/pdf.js', () => ({
  extractPdfText: vi.fn(),
}))

vi.mock('../services/openrouter.js', () => ({
  extractImageReceipt: vi.fn(),
}))

vi.mock('../services/receiptParser.js', () => ({
  parseReceiptText: vi.fn(),
  validateReceiptData: vi.fn(),
}))

vi.mock('../services/receiptStorage.js', () => ({
  storeReceipt: vi.fn(),
}))

vi.mock('../services/fileStorage.js', () => ({
  storeRawFile: vi.fn(),
}))

vi.mock('../services/receiptNotifications.js', () => ({
  notifyReceiptFailure: vi.fn(),
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

import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { extractPdfText } from '../services/pdf.js'
import { extractImageReceipt } from '../services/openrouter.js'
import { parseReceiptText, validateReceiptData } from '../services/receiptParser.js'
import { storeReceipt } from '../services/receiptStorage.js'
import { storeRawFile } from '../services/fileStorage.js'
import { notifyReceiptFailure } from '../services/receiptNotifications.js'
import { logger } from '../utils/logger.js'

const mockDownloadMediaMessage = downloadMediaMessage as ReturnType<typeof vi.fn>
const mockExtractPdfText = extractPdfText as ReturnType<typeof vi.fn>
const mockExtractImageReceipt = extractImageReceipt as ReturnType<typeof vi.fn>
const mockParseReceiptText = parseReceiptText as ReturnType<typeof vi.fn>
const mockValidateReceiptData = validateReceiptData as ReturnType<typeof vi.fn>
const mockStoreReceipt = storeReceipt as ReturnType<typeof vi.fn>
const mockStoreRawFile = storeRawFile as ReturnType<typeof vi.fn>
const mockNotifyReceiptFailure = notifyReceiptFailure as ReturnType<typeof vi.fn>

// Sample test data
const sampleReceiptData: ReceiptData = {
  valor: 30000000,
  dataHora: '2026-01-19T17:10:23.000Z',
  tipo: 'Pix',
  identificador: '7c005681-9f98-4ea5-a12e-45a7a71345e2',
  recebedor: { nome: 'IBLF CONSULTORIA', cpfCnpj: '36328973000100' },
  pagador: { nome: 'ES CAPITAL', cpfCnpj: '45959199000118' },
}

// Create mock context
function createMockContext(overrides: Partial<RouterContext> = {}): RouterContext {
  return {
    groupId: '5511999999999@g.us',
    groupName: 'Test Group',
    message: '',
    sender: '5511888888888@s.whatsapp.net',
    isControlGroup: false,
    sock: { updateMediaMessage: vi.fn() } as unknown as WASocket,
    isReceipt: true,
    receiptType: 'pdf',
    rawMessage: {
      key: { remoteJid: '5511999999999@g.us' },
      message: {
        documentMessage: { mimetype: 'application/pdf' },
      },
    } as proto.IWebMessageInfo,
    ...overrides,
  }
}

describe('handleReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default successful mocks
    mockDownloadMediaMessage.mockResolvedValue(Buffer.from('fake-content'))
    mockExtractPdfText.mockResolvedValue({ ok: true, data: 'Sample PDF text content with enough characters to pass validation' })
    mockParseReceiptText.mockReturnValue({ ok: true, data: sampleReceiptData })
    mockValidateReceiptData.mockReturnValue({ ok: true, data: sampleReceiptData })
    mockStoreRawFile.mockResolvedValue({ ok: true, data: 'https://storage.supabase.co/receipts/test.pdf' })
    mockStoreReceipt.mockResolvedValue({
      ok: true,
      data: { id: 'generated-uuid', endToEndId: sampleReceiptData.identificador },
    })
    mockNotifyReceiptFailure.mockResolvedValue({ ok: true, data: { sent: true } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('AC1: PDF Processing Pipeline', () => {
    it('processes PDF receipt successfully', async () => {
      const context = createMockContext({ receiptType: 'pdf' })
      const result = await handleReceipt(context)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.receiptId).toBe('generated-uuid')
        expect(result.data.endToEndId).toBe(sampleReceiptData.identificador)
        expect(result.data.receiptType).toBe('pdf')
      }
    })

    it('calls PDF extraction for PDF type', async () => {
      const context = createMockContext({ receiptType: 'pdf' })
      await handleReceipt(context)

      expect(mockExtractPdfText).toHaveBeenCalled()
    })

    it('calls parseReceiptText with extracted text', async () => {
      const context = createMockContext({ receiptType: 'pdf' })
      await handleReceipt(context)

      expect(mockParseReceiptText).toHaveBeenCalled()
    })

    it('calls validateReceiptData with parsed data', async () => {
      const context = createMockContext({ receiptType: 'pdf' })
      await handleReceipt(context)

      expect(mockValidateReceiptData).toHaveBeenCalled()
    })
  })

  describe('AC2: Image Processing Pipeline', () => {
    it('processes image receipt successfully', async () => {
      const context = createMockContext({
        receiptType: 'image',
        rawMessage: {
          key: { remoteJid: '5511999999999@g.us' },
          message: {
            imageMessage: { mimetype: 'image/jpeg' },
          },
        } as proto.IWebMessageInfo,
      })

      mockExtractImageReceipt.mockResolvedValue({ ok: true, data: sampleReceiptData })

      const result = await handleReceipt(context)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.receiptType).toBe('image')
      }
    })

    it('calls OpenRouter OCR for image type', async () => {
      const context = createMockContext({
        receiptType: 'image',
        rawMessage: {
          key: { remoteJid: '5511999999999@g.us' },
          message: {
            imageMessage: { mimetype: 'image/jpeg' },
          },
        } as proto.IWebMessageInfo,
      })

      mockExtractImageReceipt.mockResolvedValue({ ok: true, data: sampleReceiptData })

      await handleReceipt(context)

      expect(mockExtractImageReceipt).toHaveBeenCalled()
    })
  })

  describe('AC3: PDF to OCR Fallback', () => {
    it('falls back to OCR when PDF extraction fails', async () => {
      const context = createMockContext({ receiptType: 'pdf' })
      mockExtractPdfText.mockResolvedValue({ ok: false, error: 'PDF corrupted' })
      mockExtractImageReceipt.mockResolvedValue({ ok: true, data: sampleReceiptData })

      const result = await handleReceipt(context)

      expect(mockExtractImageReceipt).toHaveBeenCalled()
      expect(result.ok).toBe(true)
    })

    it('falls back to OCR when PDF text too short', async () => {
      const context = createMockContext({ receiptType: 'pdf' })
      mockExtractPdfText.mockResolvedValue({ ok: true, data: 'short' }) // < 50 chars
      mockExtractImageReceipt.mockResolvedValue({ ok: true, data: sampleReceiptData })

      const result = await handleReceipt(context)

      expect(mockExtractImageReceipt).toHaveBeenCalled()
      expect(result.ok).toBe(true)
    })

    it('falls back to OCR when PDF parsing fails', async () => {
      const context = createMockContext({ receiptType: 'pdf' })
      mockParseReceiptText.mockReturnValue({ ok: false, error: 'Parse failed' })
      mockExtractImageReceipt.mockResolvedValue({ ok: true, data: sampleReceiptData })

      const result = await handleReceipt(context)

      expect(mockExtractImageReceipt).toHaveBeenCalled()
      expect(result.ok).toBe(true)
    })

    it('falls back to OCR when PDF validation fails', async () => {
      const context = createMockContext({ receiptType: 'pdf' })
      mockValidateReceiptData.mockReturnValueOnce({ ok: false, error: 'Invalid data' })
      mockExtractImageReceipt.mockResolvedValue({ ok: true, data: sampleReceiptData })
      mockValidateReceiptData.mockReturnValueOnce({ ok: true, data: sampleReceiptData })

      const result = await handleReceipt(context)

      expect(mockExtractImageReceipt).toHaveBeenCalled()
      expect(result.ok).toBe(true)
    })

    it('logs fallback occurrence', async () => {
      const context = createMockContext({ receiptType: 'pdf' })
      mockExtractPdfText.mockResolvedValue({ ok: false, error: 'PDF error' })
      mockExtractImageReceipt.mockResolvedValue({ ok: true, data: sampleReceiptData })

      await handleReceipt(context)

      expect(logger.warn).toHaveBeenCalledWith(
        'PDF text extraction failed, trying OCR fallback',
        expect.objectContaining({
          event: 'pdf_extraction_failed_fallback',
        })
      )
    })
  })

  describe('AC4: Success Response (Silent)', () => {
    it('returns success result with receipt info', async () => {
      const context = createMockContext()
      const result = await handleReceipt(context)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toHaveProperty('receiptId')
        expect(result.data).toHaveProperty('endToEndId')
        expect(result.data).toHaveProperty('receiptType')
        expect(result.data).toHaveProperty('groupId')
        expect(result.data).toHaveProperty('timestamp')
      }
    })

    it('logs successful processing', async () => {
      const context = createMockContext()
      await handleReceipt(context)

      expect(logger.info).toHaveBeenCalledWith(
        'Receipt processed successfully',
        expect.objectContaining({
          event: 'receipt_processed_success',
          receiptId: 'generated-uuid',
        })
      )
    })
  })

  describe('AC5: Failure Response', () => {
    it('returns error when download fails', async () => {
      const context = createMockContext()
      mockDownloadMediaMessage.mockRejectedValue(new Error('Network error'))

      const result = await handleReceipt(context)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Download failed')
      }
    })

    it('returns error when no raw message', async () => {
      const context = createMockContext({ rawMessage: undefined })

      const result = await handleReceipt(context)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('No raw message')
      }
    })

    it('returns error when all extraction methods fail', async () => {
      const context = createMockContext({ receiptType: 'pdf' })
      mockExtractPdfText.mockResolvedValue({ ok: false, error: 'PDF error' })
      mockExtractImageReceipt.mockResolvedValue({ ok: false, error: 'OCR error' })

      const result = await handleReceipt(context)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('OCR failed')
      }
    })

    it('returns error when storage fails', async () => {
      const context = createMockContext()
      mockStoreReceipt.mockResolvedValue({ ok: false, error: 'Database error' })

      const result = await handleReceipt(context)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Storage failed')
      }
    })

    it('handles duplicate receipts gracefully', async () => {
      const context = createMockContext()
      mockStoreReceipt.mockResolvedValue({ ok: false, error: 'Duplicate receipt' })

      const result = await handleReceipt(context)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Duplicate receipt')
      }
    })

    it('logs failure events', async () => {
      const context = createMockContext()
      mockDownloadMediaMessage.mockRejectedValue(new Error('Network error'))

      await handleReceipt(context)

      expect(logger.error).toHaveBeenCalledWith(
        'Receipt download failed',
        expect.objectContaining({
          event: 'receipt_download_failed',
        })
      )
    })
  })

  describe('File Storage (Graceful Degradation)', () => {
    it('stores raw file on success', async () => {
      const context = createMockContext()
      await handleReceipt(context)

      expect(mockStoreRawFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        sampleReceiptData.identificador,
        'application/pdf'
      )
    })

    it('continues when file storage fails', async () => {
      const context = createMockContext()
      mockStoreRawFile.mockResolvedValue({ ok: false, error: 'Storage bucket error' })

      const result = await handleReceipt(context)

      // Should still succeed with receipt storage
      expect(result.ok).toBe(true)
    })

    it('logs warning when file storage fails', async () => {
      const context = createMockContext()
      mockStoreRawFile.mockResolvedValue({ ok: false, error: 'Storage bucket error' })

      await handleReceipt(context)

      expect(logger.warn).toHaveBeenCalledWith(
        'Raw file storage failed, continuing without file',
        expect.objectContaining({
          event: 'raw_file_storage_failed',
        })
      )
    })

    it('passes null rawFileUrl when file storage fails', async () => {
      const context = createMockContext()
      mockStoreRawFile.mockResolvedValue({ ok: false, error: 'Storage error' })

      await handleReceipt(context)

      expect(mockStoreReceipt).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          rawFileUrl: null,
        })
      )
    })
  })

  describe('MIME Type Detection', () => {
    it('detects PDF MIME type from document message', async () => {
      const context = createMockContext({
        rawMessage: {
          key: { remoteJid: '5511999999999@g.us' },
          message: { documentMessage: { mimetype: 'application/pdf' } },
        } as proto.IWebMessageInfo,
      })

      await handleReceipt(context)

      expect(mockStoreRawFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.any(String),
        'application/pdf'
      )
    })

    it('detects JPEG MIME type from image message', async () => {
      const context = createMockContext({
        receiptType: 'image',
        rawMessage: {
          key: { remoteJid: '5511999999999@g.us' },
          message: { imageMessage: { mimetype: 'image/jpeg' } },
        } as proto.IWebMessageInfo,
      })

      mockExtractImageReceipt.mockResolvedValue({ ok: true, data: sampleReceiptData })

      await handleReceipt(context)

      expect(mockStoreRawFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.any(String),
        'image/jpeg'
      )
    })

    it('defaults to application/pdf for PDF type without MIME', async () => {
      const context = createMockContext({
        receiptType: 'pdf',
        rawMessage: {
          key: { remoteJid: '5511999999999@g.us' },
          message: {},
        } as proto.IWebMessageInfo,
      })

      await handleReceipt(context)

      expect(mockStoreRawFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.any(String),
        'application/pdf'
      )
    })
  })

  describe('Result Pattern Compliance', () => {
    it('never throws, always returns Result', async () => {
      const context = createMockContext()

      const errorScenarios = [
        () => mockDownloadMediaMessage.mockRejectedValue(new Error('error')),
        () => mockDownloadMediaMessage.mockRejectedValue(null),
        () => mockDownloadMediaMessage.mockResolvedValue(null),
        () => mockDownloadMediaMessage.mockResolvedValue(Buffer.alloc(0)),
      ]

      for (const setup of errorScenarios) {
        vi.clearAllMocks()
        mockDownloadMediaMessage.mockResolvedValue(Buffer.from('content'))
        setup()

        const result = await handleReceipt(context)

        expect(result).toHaveProperty('ok')
        if (!result.ok) {
          expect(result).toHaveProperty('error')
          expect(typeof result.error).toBe('string')
        }
      }
    })
  })

  describe('AC5: Control Group Failure Notifications (Story 6.8)', () => {
    it('notifies control group on download failure', async () => {
      const context = createMockContext()
      mockDownloadMediaMessage.mockRejectedValue(new Error('Network error'))

      await handleReceipt(context)

      expect(mockNotifyReceiptFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          groupName: 'Test Group',
          groupJid: '5511999999999@g.us',
          senderName: '5511888888888@s.whatsapp.net',
          senderJid: '5511888888888@s.whatsapp.net',
          reason: expect.stringContaining('Network error'),
          receiptType: 'pdf',
        })
      )
    })

    it('notifies control group on extraction failure', async () => {
      const context = createMockContext({ receiptType: 'pdf' })
      mockExtractPdfText.mockResolvedValue({ ok: false, error: 'PDF corrupted' })
      mockExtractImageReceipt.mockResolvedValue({ ok: false, error: 'OCR also failed' })

      await handleReceipt(context)

      expect(mockNotifyReceiptFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          groupName: 'Test Group',
          reason: expect.stringContaining('OCR'),
          receiptType: 'pdf',
        })
      )
    })

    it('notifies control group on storage failure', async () => {
      const context = createMockContext()
      mockStoreReceipt.mockResolvedValue({ ok: false, error: 'Database error' })

      await handleReceipt(context)

      expect(mockNotifyReceiptFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'Database error',
        })
      )
    })

    it('does NOT notify control group on duplicate receipt', async () => {
      const context = createMockContext()
      mockStoreReceipt.mockResolvedValue({ ok: false, error: 'Duplicate receipt' })

      await handleReceipt(context)

      expect(mockNotifyReceiptFailure).not.toHaveBeenCalled()
    })

    it('does NOT notify control group on success', async () => {
      const context = createMockContext()

      await handleReceipt(context)

      expect(mockNotifyReceiptFailure).not.toHaveBeenCalled()
    })

    it('includes timestamp in notification context', async () => {
      const context = createMockContext()
      mockDownloadMediaMessage.mockRejectedValue(new Error('Error'))

      const beforeCall = new Date()
      await handleReceipt(context)
      const afterCall = new Date()

      expect(mockNotifyReceiptFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(Date),
        })
      )

      const callArg = mockNotifyReceiptFailure.mock.calls[0][0]
      expect(callArg.timestamp.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime())
      expect(callArg.timestamp.getTime()).toBeLessThanOrEqual(afterCall.getTime())
    })

    it('uses groupId as groupName fallback when groupName is undefined', async () => {
      const context = createMockContext({ groupName: undefined })
      mockDownloadMediaMessage.mockRejectedValue(new Error('Error'))

      await handleReceipt(context)

      expect(mockNotifyReceiptFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          groupName: '5511999999999@g.us',
        })
      )
    })

    it('sets correct receiptType for image receipts', async () => {
      const context = createMockContext({
        receiptType: 'image',
        rawMessage: {
          key: { remoteJid: '5511999999999@g.us' },
          message: { imageMessage: { mimetype: 'image/jpeg' } },
        } as proto.IWebMessageInfo,
      })
      mockExtractImageReceipt.mockResolvedValue({ ok: false, error: 'OCR error' })

      await handleReceipt(context)

      expect(mockNotifyReceiptFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          receiptType: 'image',
        })
      )
    })
  })
})
