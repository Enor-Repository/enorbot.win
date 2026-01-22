import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseValor,
  parseDataHora,
  cleanCpfCnpj,
  parseReceiptText,
  validateReceiptData,
  parseAndValidateReceipt,
} from './receiptParser.js'
import type { RawReceiptData } from '../types/receipt.js'

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

describe('parseValor', () => {
  describe('AC2: Brazilian currency to centavos conversion', () => {
    it('parses "R$ 300.000,00" to 30000000', () => {
      expect(parseValor('R$ 300.000,00')).toBe(30000000)
    })

    it('parses "R$ 1.234,56" to 123456', () => {
      expect(parseValor('R$ 1.234,56')).toBe(123456)
    })

    it('parses "R$100,00" to 10000 (no space)', () => {
      expect(parseValor('R$100,00')).toBe(10000)
    })

    it('parses "300.000,00" to 30000000 (no currency symbol)', () => {
      expect(parseValor('300.000,00')).toBe(30000000)
    })

    it('parses "1,50" to 150 (small amounts)', () => {
      expect(parseValor('1,50')).toBe(150)
    })

    it('parses "0,01" to 1 (minimum amount)', () => {
      expect(parseValor('0,01')).toBe(1)
    })

    it('parses "R$ 1.000.000,00" to 100000000 (millions)', () => {
      expect(parseValor('R$ 1.000.000,00')).toBe(100000000)
    })

    it('returns null for empty string', () => {
      expect(parseValor('')).toBe(null)
    })

    it('returns null for invalid format', () => {
      expect(parseValor('not a number')).toBe(null)
    })

    it('handles whitespace variations', () => {
      expect(parseValor('  R$  100,00  ')).toBe(10000)
    })
  })
})

describe('parseDataHora', () => {
  describe('AC3: Brazilian date to ISO conversion', () => {
    it('parses "19/01/2026 17:10:23" to ISO string', () => {
      const result = parseDataHora('19/01/2026 17:10:23')
      expect(result).toBe('2026-01-19T17:10:23.000Z')
    })

    it('parses "01/12/2025 00:00:00" correctly', () => {
      const result = parseDataHora('01/12/2025 00:00:00')
      expect(result).toBe('2025-12-01T00:00:00.000Z')
    })

    it('parses date-only "19/01/2026" with midnight time', () => {
      const result = parseDataHora('19/01/2026')
      expect(result).toBe('2026-01-19T00:00:00.000Z')
    })

    it('returns null for empty string', () => {
      expect(parseDataHora('')).toBe(null)
    })

    it('returns null for invalid format', () => {
      expect(parseDataHora('2026-01-19')).toBe(null)
    })

    it('returns null for invalid date', () => {
      expect(parseDataHora('32/13/2026 25:61:61')).toBe(null)
    })
  })
})

describe('cleanCpfCnpj', () => {
  it('cleans CNPJ "36.328.973/0001-00" to "36328973000100"', () => {
    expect(cleanCpfCnpj('36.328.973/0001-00')).toBe('36328973000100')
  })

  it('cleans CPF "123.456.789-01" to "12345678901"', () => {
    expect(cleanCpfCnpj('123.456.789-01')).toBe('12345678901')
  })

  it('handles already clean input', () => {
    expect(cleanCpfCnpj('12345678901')).toBe('12345678901')
  })

  it('handles spaces', () => {
    expect(cleanCpfCnpj('123 456 789 01')).toBe('12345678901')
  })
})

describe('parseReceiptText', () => {
  const samplePdfText = `COMPROVANTE PIX

Valor: R$ 300.000,00
Data/Hora 19/01/2026 17:10:23
Tipo: Transferência INTERNA

Identificador
7c005681-9f98-4ea5-a12e-45a7a71345e2

Recebedor
IBLF CONSULTORIA
CNPJ: 36.328.973/0001-00

Pagador
ES CAPITAL
CNPJ: 45.959.199/0001-18`

  describe('AC1: Extract all fields from PDF text', () => {
    it('extracts valor correctly', () => {
      const result = parseReceiptText(samplePdfText)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.valor).toBe(30000000)
      }
    })

    it('extracts dataHora correctly', () => {
      const result = parseReceiptText(samplePdfText)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.dataHora).toBe('2026-01-19T17:10:23.000Z')
      }
    })

    it('extracts tipo correctly', () => {
      const result = parseReceiptText(samplePdfText)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.tipo).toBe('Transferência INTERNA')
      }
    })

    it('extracts identificador (EndToEnd ID) correctly', () => {
      const result = parseReceiptText(samplePdfText)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.identificador).toBe('7c005681-9f98-4ea5-a12e-45a7a71345e2')
      }
    })

    it('extracts recebedor nome correctly', () => {
      const result = parseReceiptText(samplePdfText)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.recebedor?.nome).toBe('IBLF CONSULTORIA')
      }
    })

    it('extracts recebedor cpfCnpj correctly (cleaned)', () => {
      const result = parseReceiptText(samplePdfText)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.recebedor?.cpfCnpj).toBe('36328973000100')
      }
    })

    it('extracts pagador nome correctly', () => {
      const result = parseReceiptText(samplePdfText)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.pagador?.nome).toBe('ES CAPITAL')
      }
    })

    it('extracts pagador cpfCnpj correctly (cleaned)', () => {
      const result = parseReceiptText(samplePdfText)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.pagador?.cpfCnpj).toBe('45959199000118')
      }
    })

    it('returns error for empty text', () => {
      const result = parseReceiptText('')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Empty text provided')
      }
    })

    it('returns error for whitespace-only text', () => {
      const result = parseReceiptText('   \n\n   ')
      expect(result.ok).toBe(false)
    })

    it('handles partial data gracefully', () => {
      const partialText = 'Valor: R$ 100,00'
      const result = parseReceiptText(partialText)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.valor).toBe(10000)
        expect(result.data.dataHora).toBeUndefined()
      }
    })

    it('logs parsing details', () => {
      parseReceiptText(samplePdfText)
      expect(logger.debug).toHaveBeenCalledWith(
        'Receipt text parsed',
        expect.objectContaining({
          event: 'receipt_text_parsed',
        })
      )
    })
  })

  describe('Alternative text formats', () => {
    it('handles CPF format for pagador/recebedor', () => {
      const cpfText = `Valor: R$ 50,00
Data: 01/01/2026

Recebedor
João Silva
CPF: 123.456.789-01

Pagador
Maria Santos
CPF: 987.654.321-09

Identificador
abcd1234-efgh-5678-ijkl-9012mnop3456`

      const result = parseReceiptText(cpfText)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.recebedor?.cpfCnpj).toBe('12345678901')
        expect(result.data.pagador?.cpfCnpj).toBe('98765432109')
      }
    })

    it('handles "Data:" without "Hora"', () => {
      const text = 'Data: 15/06/2025\nIdentificador\n12345678901234567890123456789012'
      const result = parseReceiptText(text)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.dataHora).toBe('2025-06-15T00:00:00.000Z')
      }
    })
  })
})

describe('validateReceiptData', () => {
  const validRawData: RawReceiptData = {
    valor: 30000000,
    dataHora: '2026-01-19T17:10:23.000Z',
    tipo: 'Pix',
    identificador: '7c005681-9f98-4ea5-a12e-45a7a71345e2',
    recebedor: { nome: 'IBLF CONSULTORIA', cpfCnpj: '36328973000100' },
    pagador: { nome: 'ES CAPITAL', cpfCnpj: '45959199000118' },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('AC4: Validate all required fields', () => {
    it('validates valid data successfully', () => {
      const result = validateReceiptData(validRawData)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.valor).toBe(30000000)
        expect(result.data.identificador).toBe('7c005681-9f98-4ea5-a12e-45a7a71345e2')
      }
    })

    it('returns validated ReceiptData type', () => {
      const result = validateReceiptData(validRawData)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toHaveProperty('valor')
        expect(result.data).toHaveProperty('dataHora')
        expect(result.data).toHaveProperty('identificador')
        expect(result.data).toHaveProperty('recebedor')
        expect(result.data).toHaveProperty('pagador')
      }
    })

    it('allows null tipo', () => {
      const data = { ...validRawData, tipo: null }
      const result = validateReceiptData(data)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.tipo).toBe(null)
      }
    })
  })

  describe('AC5: Validation error reporting', () => {
    it('fails when valor is missing', () => {
      const data = { ...validRawData, valor: undefined }
      const result = validateReceiptData(data)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('valor')
      }
    })

    it('fails when valor is zero', () => {
      const data = { ...validRawData, valor: 0 }
      const result = validateReceiptData(data)
      expect(result.ok).toBe(false)
    })

    it('fails when valor is negative', () => {
      const data = { ...validRawData, valor: -100 }
      const result = validateReceiptData(data)
      expect(result.ok).toBe(false)
    })

    it('fails when dataHora is missing', () => {
      const data = { ...validRawData, dataHora: undefined }
      const result = validateReceiptData(data)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('dataHora')
      }
    })

    it('fails when dataHora is invalid format', () => {
      const data = { ...validRawData, dataHora: '19/01/2026' }
      const result = validateReceiptData(data)
      expect(result.ok).toBe(false)
    })

    it('fails when identificador is too short', () => {
      const data = { ...validRawData, identificador: 'short' }
      const result = validateReceiptData(data)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Identificador')
      }
    })

    it('fails when recebedor nome is empty', () => {
      const data = { ...validRawData, recebedor: { nome: '', cpfCnpj: '12345678901' } }
      const result = validateReceiptData(data)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('nome')
      }
    })

    it('fails when recebedor cpfCnpj is invalid', () => {
      const data = { ...validRawData, recebedor: { nome: 'Test', cpfCnpj: '123' } }
      const result = validateReceiptData(data)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('CPF')
      }
    })

    it('fails when cpfCnpj contains non-digits', () => {
      const data = {
        ...validRawData,
        recebedor: { nome: 'Test', cpfCnpj: '123.456.789-01' },
      }
      const result = validateReceiptData(data)
      expect(result.ok).toBe(false)
    })

    it('fails when pagador is missing', () => {
      const data = { ...validRawData, pagador: undefined }
      const result = validateReceiptData(data)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('pagador')
      }
    })

    it('logs validation failures', () => {
      const data = { ...validRawData, valor: undefined }
      validateReceiptData(data)
      expect(logger.warn).toHaveBeenCalledWith(
        'Receipt validation failed',
        expect.objectContaining({
          event: 'receipt_validation_failed',
          errors: expect.any(String),
        })
      )
    })

    it('logs successful validation', () => {
      validateReceiptData(validRawData)
      expect(logger.info).toHaveBeenCalledWith(
        'Receipt data validated',
        expect.objectContaining({
          event: 'receipt_data_validated',
          identificador: validRawData.identificador,
        })
      )
    })
  })
})

describe('parseAndValidateReceipt', () => {
  const samplePdfText = `COMPROVANTE PIX

Valor: R$ 300.000,00
Data/Hora 19/01/2026 17:10:23
Tipo: Transferência INTERNA

Identificador
7c005681-9f98-4ea5-a12e-45a7a71345e2

Recebedor
IBLF CONSULTORIA
CNPJ: 36.328.973/0001-00

Pagador
ES CAPITAL
CNPJ: 45.959.199/0001-18`

  it('parses and validates valid text successfully', () => {
    const result = parseAndValidateReceipt(samplePdfText)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.valor).toBe(30000000)
      expect(result.data.identificador).toBe('7c005681-9f98-4ea5-a12e-45a7a71345e2')
    }
  })

  it('returns error for empty text', () => {
    const result = parseAndValidateReceipt('')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Empty text provided')
    }
  })

  it('returns validation error for incomplete text', () => {
    const incompleteText = 'Some random text without receipt data'
    const result = parseAndValidateReceipt(incompleteText)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Validation failed')
    }
  })
})

describe('Result pattern compliance', () => {
  it('parseReceiptText never throws', () => {
    const inputs = ['', null as unknown as string, undefined as unknown as string, {}, []]
    for (const input of inputs) {
      const result = parseReceiptText(input as string)
      expect(result).toHaveProperty('ok')
    }
  })

  it('validateReceiptData never throws', () => {
    const inputs = [
      {},
      null,
      undefined,
      { valor: 'not a number' },
      { recebedor: null },
    ] as unknown[]
    for (const input of inputs) {
      const result = validateReceiptData(input as RawReceiptData)
      expect(result).toHaveProperty('ok')
    }
  })
})
