import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  storeReceipt,
  receiptExists,
  resetSupabaseClient,
  setSupabaseClient,
  type ReceiptMeta,
} from './receiptStorage.js'
import type { ReceiptData } from '../types/receipt.js'

// Mock getConfig
vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_KEY: 'test-key',
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

import { logger } from '../utils/logger.js'

// Sample test data
const sampleReceiptData: ReceiptData = {
  valor: 30000000,
  dataHora: '2026-01-19T17:10:23.000Z',
  tipo: 'Pix',
  identificador: '7c005681-9f98-4ea5-a12e-45a7a71345e2',
  recebedor: { nome: 'IBLF CONSULTORIA', cpfCnpj: '36328973000100' },
  pagador: { nome: 'ES CAPITAL', cpfCnpj: '45959199000118' },
}

const sampleMeta: ReceiptMeta = {
  rawFileUrl: 'https://storage.supabase.co/receipts/abc.pdf',
  sourceType: 'pdf',
  groupJid: '5511999999999@g.us',
}

// Create mock Supabase client
function createMockSupabase() {
  const mockFrom = vi.fn()
  const mockInsert = vi.fn()
  const mockSelect = vi.fn()
  const mockSingle = vi.fn()
  const mockEq = vi.fn()

  // Default chain for insert().select().single()
  mockSingle.mockResolvedValue({
    data: { id: 'generated-uuid', end_to_end_id: sampleReceiptData.identificador },
    error: null,
  })
  mockSelect.mockReturnValue({ single: mockSingle })
  mockInsert.mockReturnValue({ select: mockSelect })
  mockEq.mockReturnValue({ then: (fn: (v: { count: number; error: null }) => void) => fn({ count: 0, error: null }) })

  mockFrom.mockReturnValue({
    insert: mockInsert,
    select: mockSelect,
    eq: mockEq,
  })

  return {
    from: mockFrom,
    _mockInsert: mockInsert,
    _mockSelect: mockSelect,
    _mockSingle: mockSingle,
    _mockEq: mockEq,
  }
}

describe('storeReceipt', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>

  beforeEach(() => {
    vi.clearAllMocks()
    resetSupabaseClient()
    mockSupabase = createMockSupabase()
    setSupabaseClient(mockSupabase as unknown as Parameters<typeof setSupabaseClient>[0])
  })

  afterEach(() => {
    resetSupabaseClient()
  })

  describe('AC1: Insert receipt into table', () => {
    it('stores receipt successfully', async () => {
      const result = await storeReceipt(sampleReceiptData, sampleMeta)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.id).toBe('generated-uuid')
        expect(result.data.endToEndId).toBe(sampleReceiptData.identificador)
      }
    })

    it('calls Supabase with correct table name', async () => {
      await storeReceipt(sampleReceiptData, sampleMeta)
      expect(mockSupabase.from).toHaveBeenCalledWith('receipts')
    })

    it('transforms data to snake_case for Supabase', async () => {
      await storeReceipt(sampleReceiptData, sampleMeta)

      expect(mockSupabase._mockInsert).toHaveBeenCalledWith({
        end_to_end_id: sampleReceiptData.identificador,
        valor: sampleReceiptData.valor,
        data_hora: sampleReceiptData.dataHora,
        tipo: sampleReceiptData.tipo,
        recebedor: sampleReceiptData.recebedor,
        pagador: sampleReceiptData.pagador,
        raw_file_url: sampleMeta.rawFileUrl,
        source_type: sampleMeta.sourceType,
        group_jid: sampleMeta.groupJid,
      })
    })

    it('handles null rawFileUrl', async () => {
      const metaWithoutUrl: ReceiptMeta = { ...sampleMeta, rawFileUrl: null }
      await storeReceipt(sampleReceiptData, metaWithoutUrl)

      expect(mockSupabase._mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          raw_file_url: null,
        })
      )
    })
  })

  describe('AC2: Schema fields stored correctly', () => {
    it('includes all required fields in insert', async () => {
      await storeReceipt(sampleReceiptData, sampleMeta)

      const insertCall = mockSupabase._mockInsert.mock.calls[0][0]
      expect(insertCall).toHaveProperty('end_to_end_id')
      expect(insertCall).toHaveProperty('valor')
      expect(insertCall).toHaveProperty('data_hora')
      expect(insertCall).toHaveProperty('tipo')
      expect(insertCall).toHaveProperty('recebedor')
      expect(insertCall).toHaveProperty('pagador')
      expect(insertCall).toHaveProperty('raw_file_url')
      expect(insertCall).toHaveProperty('source_type')
      expect(insertCall).toHaveProperty('group_jid')
    })
  })

  describe('AC3: Deduplication (FR34)', () => {
    it('returns error for duplicate receipt', async () => {
      mockSupabase._mockSingle.mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      })

      const result = await storeReceipt(sampleReceiptData, sampleMeta)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Duplicate receipt')
      }
    })

    it('logs duplicate detection', async () => {
      mockSupabase._mockSingle.mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'duplicate key' },
      })

      await storeReceipt(sampleReceiptData, sampleMeta)

      expect(logger.info).toHaveBeenCalledWith(
        'Duplicate receipt detected',
        expect.objectContaining({
          event: 'receipt_duplicate',
          endToEndId: sampleReceiptData.identificador,
        })
      )
    })
  })

  describe('AC4: Success response', () => {
    it('returns id and end_to_end_id on success', async () => {
      const result = await storeReceipt(sampleReceiptData, sampleMeta)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({
          id: 'generated-uuid',
          endToEndId: sampleReceiptData.identificador,
        })
      }
    })

    it('logs successful storage', async () => {
      await storeReceipt(sampleReceiptData, sampleMeta)

      expect(logger.info).toHaveBeenCalledWith(
        'Receipt stored successfully',
        expect.objectContaining({
          event: 'receipt_stored',
          id: 'generated-uuid',
          endToEndId: sampleReceiptData.identificador,
        })
      )
    })
  })

  describe('Error handling', () => {
    it('returns error for non-duplicate database errors', async () => {
      mockSupabase._mockSingle.mockResolvedValue({
        data: null,
        error: { code: '42P01', message: 'relation "receipts" does not exist' },
      })

      const result = await storeReceipt(sampleReceiptData, sampleMeta)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Database error')
      }
    })

    it('logs database errors', async () => {
      mockSupabase._mockSingle.mockResolvedValue({
        data: null,
        error: { code: '42P01', message: 'table does not exist' },
      })

      await storeReceipt(sampleReceiptData, sampleMeta)

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to store receipt',
        expect.objectContaining({
          event: 'receipt_storage_error',
          errorCode: '42P01',
        })
      )
    })

    it('handles exceptions gracefully', async () => {
      mockSupabase._mockSingle.mockRejectedValue(new Error('Network error'))

      const result = await storeReceipt(sampleReceiptData, sampleMeta)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Unexpected error')
      }
    })

    it('returns error when Supabase not initialized', async () => {
      resetSupabaseClient()
      // Mock getConfig to throw
      vi.mocked(await import('../config.js')).getConfig.mockImplementation(() => {
        throw new Error('Config not available')
      })

      const result = await storeReceipt(sampleReceiptData, sampleMeta)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Supabase not initialized')
      }
    })
  })

  describe('Result pattern compliance', () => {
    it('never throws, always returns Result', async () => {
      const errorScenarios = [
        () => mockSupabase._mockSingle.mockRejectedValue(new Error('error')),
        () => mockSupabase._mockSingle.mockRejectedValue(null),
        () => mockSupabase._mockSingle.mockResolvedValue({ data: null, error: { code: 'xxx' } }),
      ]

      for (const setup of errorScenarios) {
        setup()
        const result = await storeReceipt(sampleReceiptData, sampleMeta)
        expect(result).toHaveProperty('ok')
        if (!result.ok) {
          expect(result).toHaveProperty('error')
          expect(typeof result.error).toBe('string')
        }
      }
    })
  })
})

describe('receiptExists', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>
  let mockEq: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    resetSupabaseClient()
    mockSupabase = createMockSupabase()
    setSupabaseClient(mockSupabase as unknown as Parameters<typeof setSupabaseClient>[0])

    // Setup mock for exists query: from().select().eq() returns promise
    mockEq = vi.fn().mockResolvedValue({ count: 0, error: null })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    mockSupabase.from.mockReturnValue({ select: mockSelect })
  })

  afterEach(() => {
    resetSupabaseClient()
  })

  it('returns true when receipt exists', async () => {
    mockEq.mockResolvedValue({ count: 1, error: null })

    const result = await receiptExists('test-id')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toBe(true)
    }
  })

  it('returns false when receipt does not exist', async () => {
    mockEq.mockResolvedValue({ count: 0, error: null })

    const result = await receiptExists('test-id')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toBe(false)
    }
  })

  it('returns error on database failure', async () => {
    mockEq.mockResolvedValue({ count: null, error: { code: 'xxx', message: 'error' } })

    const result = await receiptExists('test-id')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Database error')
    }
  })
})
