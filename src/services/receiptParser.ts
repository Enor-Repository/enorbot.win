/**
 * Receipt Parser Service
 *
 * Story 6.4 - Parses and validates receipt data from extracted text.
 * Returns Result type - never throws.
 */

import { ok, err, type Result } from '../utils/result.js'
import { logger } from '../utils/logger.js'
import {
  receiptDataSchema,
  type ReceiptData,
  type RawReceiptData,
  type ReceiptParty,
} from '../types/receipt.js'

/**
 * Parse Brazilian currency format to centavos.
 * Examples:
 * - "R$ 300.000,00" → 30000000
 * - "R$ 1.234,56" → 123456
 * - "R$100,00" → 10000
 * - "300.000,00" → 30000000
 *
 * @param valorStr - Brazilian currency string
 * @returns Parsed value in centavos or null if invalid
 */
export function parseValor(valorStr: string): number | null {
  if (!valorStr) return null

  // Remove currency symbol, spaces, and normalize
  let cleaned = valorStr.replace(/R\$\s*/gi, '').trim()

  // Remove thousand separators (dots) and convert decimal comma to dot
  // Brazilian format: 300.000,00 → 300000.00
  cleaned = cleaned.replace(/\./g, '').replace(',', '.')

  const value = parseFloat(cleaned)
  if (isNaN(value)) return null

  // Convert to centavos (multiply by 100, round to handle floating point)
  return Math.round(value * 100)
}

/**
 * Parse Brazilian date format to ISO string.
 * Examples:
 * - "19/01/2026 17:10:23" → "2026-01-19T17:10:23.000Z"
 * - "19/01/2026" → "2026-01-19T00:00:00.000Z"
 *
 * @param dataHoraStr - Brazilian date string
 * @returns ISO date string or null if invalid
 */
export function parseDataHora(dataHoraStr: string): string | null {
  if (!dataHoraStr) return null

  // Match DD/MM/YYYY HH:MM:SS or DD/MM/YYYY
  const fullMatch = dataHoraStr.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/)
  const dateOnlyMatch = dataHoraStr.match(/(\d{2})\/(\d{2})\/(\d{4})/)

  if (fullMatch) {
    const [, day, month, year, hours, minutes, seconds] = fullMatch
    const d = parseInt(day)
    const m = parseInt(month)
    const h = parseInt(hours)
    const min = parseInt(minutes)
    const s = parseInt(seconds)

    // Validate date/time ranges
    if (d < 1 || d > 31 || m < 1 || m > 12 || h > 23 || min > 59 || s > 59) {
      return null
    }

    const date = new Date(Date.UTC(parseInt(year), m - 1, d, h, min, s))
    if (isNaN(date.getTime())) return null
    return date.toISOString()
  }

  if (dateOnlyMatch) {
    const [, day, month, year] = dateOnlyMatch
    const d = parseInt(day)
    const m = parseInt(month)

    // Validate date ranges
    if (d < 1 || d > 31 || m < 1 || m > 12) {
      return null
    }

    const date = new Date(Date.UTC(parseInt(year), m - 1, d))
    if (isNaN(date.getTime())) return null
    return date.toISOString()
  }

  return null
}

/**
 * Clean CPF/CNPJ to digits only.
 * Examples:
 * - "36.328.973/0001-00" → "36328973000100"
 * - "123.456.789-01" → "12345678901"
 *
 * @param cpfCnpj - CPF or CNPJ string with formatting
 * @returns Digits only string
 */
export function cleanCpfCnpj(cpfCnpj: string): string {
  return cpfCnpj.replace(/\D/g, '')
}

/**
 * Extract EndToEnd ID (identificador) from text.
 * PIX EndToEnd IDs are typically UUID-like or alphanumeric strings of 32+ characters.
 *
 * @param text - Full receipt text
 * @returns Extracted EndToEnd ID or null
 */
function extractIdentificador(text: string): string | null {
  // Look for UUID pattern (most common for EndToEnd)
  const uuidMatch = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  if (uuidMatch) return uuidMatch[0]

  // Look for alphanumeric EndToEnd ID (32+ chars)
  const endToEndMatch = text.match(/E\d{8,}[0-9a-zA-Z]{20,}/i)
  if (endToEndMatch) return endToEndMatch[0]

  // Look for "Identificador" followed by the ID
  const labelMatch = text.match(/(?:Identificador|EndToEnd|ID\s*da\s*Trans)[:\s]*\n?\s*([^\n\s]{20,})/i)
  if (labelMatch) return labelMatch[1].trim()

  return null
}

/**
 * Extract party (recebedor/pagador) information from text.
 *
 * @param text - Full receipt text
 * @param partyLabel - "Recebedor" or "Pagador"
 * @returns Extracted party info or null
 */
function extractParty(text: string, partyLabel: string): ReceiptParty | null {
  // Pattern: Recebedor\nNOME\nCNPJ: 00.000.000/0000-00
  const pattern = new RegExp(
    `${partyLabel}[:\\s]*\\n?\\s*([^\\n]+)\\n\\s*(?:CNPJ|CPF)[:\\s]*([0-9./-]+)`,
    'i'
  )
  const match = text.match(pattern)

  if (match) {
    return {
      nome: match[1].trim(),
      cpfCnpj: cleanCpfCnpj(match[2]),
    }
  }

  return null
}

/**
 * Parse receipt text and extract all fields.
 * Returns RawReceiptData with any extractable fields.
 *
 * @param text - Raw text extracted from PDF
 * @returns Result with parsed data or error
 */
export function parseReceiptText(text: string): Result<RawReceiptData> {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return err('Empty text provided')
  }

  const raw: RawReceiptData = {}

  // Extract valor
  const valorMatch = text.match(/Valor[:\s]*(?:R\$\s*)?([0-9.,]+)/i)
  if (valorMatch) {
    const valorStr = valorMatch[0].replace(/Valor[:\s]*/i, '')
    raw.valor = parseValor(valorStr)
  }

  // Extract dataHora
  const dataMatch = text.match(/(?:Data\/?Hora|Data)[:\s]*(\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2}:\d{2})?)/i)
  if (dataMatch) {
    raw.dataHora = parseDataHora(dataMatch[1])
  }

  // Extract tipo
  const tipoMatch = text.match(/Tipo[:\s]*([^\n]+)/i)
  if (tipoMatch) {
    raw.tipo = tipoMatch[1].trim()
  }

  // Extract identificador
  raw.identificador = extractIdentificador(text)

  // Extract recebedor and pagador
  raw.recebedor = extractParty(text, 'Recebedor')
  raw.pagador = extractParty(text, 'Pagador')

  logger.debug('Receipt text parsed', {
    event: 'receipt_text_parsed',
    hasValor: raw.valor !== undefined,
    hasDataHora: raw.dataHora !== undefined,
    hasTipo: raw.tipo !== undefined,
    hasIdentificador: raw.identificador !== undefined,
    hasRecebedor: raw.recebedor !== null,
    hasPagador: raw.pagador !== null,
  })

  return ok(raw)
}

/**
 * Validate parsed receipt data using Zod schema.
 * Returns Result with validated data or validation errors.
 *
 * @param raw - Raw parsed data
 * @returns Result with validated ReceiptData or error message
 */
export function validateReceiptData(raw: RawReceiptData): Result<ReceiptData> {
  // Guard against null/undefined input
  if (!raw || typeof raw !== 'object') {
    return err('Invalid input: raw data is required')
  }

  // Transform raw data to expected format
  const data = {
    valor: typeof raw.valor === 'number' ? raw.valor : 0,
    dataHora: raw.dataHora ?? '',
    tipo: raw.tipo ?? null,
    identificador: raw.identificador ?? '',
    recebedor: {
      nome: raw.recebedor?.nome ?? '',
      cpfCnpj: raw.recebedor?.cpfCnpj ?? '',
    },
    pagador: {
      nome: raw.pagador?.nome ?? '',
      cpfCnpj: raw.pagador?.cpfCnpj ?? '',
    },
  }

  const result = receiptDataSchema.safeParse(data)

  if (!result.success) {
    const errors = result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
    logger.warn('Receipt validation failed', {
      event: 'receipt_validation_failed',
      errors,
      raw: {
        hasValor: raw.valor !== undefined,
        hasDataHora: raw.dataHora !== undefined,
        hasIdentificador: raw.identificador !== undefined,
      },
    })
    return err(`Validation failed: ${errors}`)
  }

  logger.info('Receipt data validated', {
    event: 'receipt_data_validated',
    identificador: result.data.identificador,
    valor: result.data.valor,
  })

  return ok(result.data)
}

/**
 * Parse and validate receipt text in one step.
 * Convenience function combining parseReceiptText and validateReceiptData.
 *
 * @param text - Raw text extracted from PDF
 * @returns Result with validated ReceiptData or error
 */
export function parseAndValidateReceipt(text: string): Result<ReceiptData> {
  const parseResult = parseReceiptText(text)
  if (!parseResult.ok) {
    return parseResult
  }

  return validateReceiptData(parseResult.data)
}
