/**
 * Receipt Data Types
 *
 * Story 6.3/6.4 - Types for PIX receipt data extraction and validation.
 * Used by both image OCR (6.3) and PDF parsing (6.4) services.
 */

import { z } from 'zod'

/**
 * Party in a PIX transaction (sender/receiver).
 */
export interface ReceiptParty {
  nome: string
  cpfCnpj: string // Numbers only, no formatting
}

/**
 * Validated receipt data extracted from PDF or image.
 * All fields are required after validation.
 */
export interface ReceiptData {
  /** Transaction amount in centavos (R$ 300.000,00 = 30000000) */
  valor: number
  /** ISO date string of the transaction */
  dataHora: string
  /** Transaction type (e.g., "Pix", "Transferência") */
  tipo: string | null
  /** EndToEnd ID (UUID format) - unique identifier for PIX transactions */
  identificador: string
  /** Receiver party details */
  recebedor: ReceiptParty
  /** Sender party details */
  pagador: ReceiptParty
}

/**
 * Zod schema for ReceiptParty validation.
 */
export const receiptPartySchema = z.object({
  nome: z.string().min(1, 'Nome is required'),
  cpfCnpj: z
    .string()
    .regex(/^\d+$/, 'CPF/CNPJ must contain only digits')
    .min(11, 'CPF/CNPJ must have at least 11 digits')
    .max(14, 'CPF/CNPJ must have at most 14 digits'),
})

/**
 * Zod schema for ReceiptData validation.
 * Story 6.4 - Validates extracted receipt data.
 */
export const receiptDataSchema = z.object({
  valor: z
    .number()
    .int('Valor must be an integer (centavos)')
    .positive('Valor must be positive'),
  dataHora: z.string().datetime({ message: 'dataHora must be a valid ISO date' }),
  tipo: z.string().nullable(),
  identificador: z
    .string()
    .min(20, 'Identificador (EndToEnd ID) must be at least 20 characters'),
  recebedor: receiptPartySchema,
  pagador: receiptPartySchema,
})

/**
 * Raw receipt data as returned from OCR/parsing before validation.
 * May have partial or invalid data.
 */
export interface RawReceiptData {
  valor?: number | string | null
  dataHora?: string | null
  tipo?: string | null
  identificador?: string | null
  recebedor?: Partial<ReceiptParty> | null
  pagador?: Partial<ReceiptParty> | null
  error?: string
}

/**
 * OpenRouter response for image OCR.
 * Includes either extracted data or an error message.
 */
export interface OcrResponse {
  data?: RawReceiptData
  error?: string
}
