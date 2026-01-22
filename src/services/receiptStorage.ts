/**
 * Receipt Storage Service
 *
 * Story 6.5 - Stores validated receipts in Supabase.
 * Returns Result type - never throws.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ok, err, type Result } from '../utils/result.js'
import { logger } from '../utils/logger.js'
import { getConfig } from '../config.js'
import type { ReceiptData, ReceiptParty } from '../types/receipt.js'

/**
 * Receipt metadata not included in ReceiptData.
 */
export interface ReceiptMeta {
  /** URL of the raw file in Supabase Storage (optional) */
  rawFileUrl: string | null
  /** Source type: 'pdf' or 'image' */
  sourceType: 'pdf' | 'image'
  /** WhatsApp group JID where receipt was received */
  groupJid: string
}

/**
 * Result of successful receipt storage.
 */
export interface StoredReceipt {
  /** UUID of the stored receipt */
  id: string
  /** EndToEnd ID (unique identifier) */
  endToEndId: string
}

/**
 * Supabase row type for receipts table.
 * snake_case per database convention.
 */
interface ReceiptRow {
  id: string
  end_to_end_id: string
  valor: number
  data_hora: string
  tipo: string | null
  recebedor: ReceiptParty
  pagador: ReceiptParty
  raw_file_url: string | null
  source_type: 'pdf' | 'image'
  group_jid: string
  created_at: string
}

// Supabase client singleton for receipts
let supabaseClient: SupabaseClient | null = null

/**
 * Get or create Supabase client for receipt storage.
 * Uses the main app config.
 */
function getSupabaseClient(): SupabaseClient | null {
  if (!supabaseClient) {
    try {
      const config = getConfig()
      supabaseClient = createClient(config.SUPABASE_URL, config.SUPABASE_KEY)
    } catch {
      return null
    }
  }
  return supabaseClient
}

/**
 * Postgres error code for unique constraint violation.
 */
const UNIQUE_VIOLATION_CODE = '23505'

/**
 * Store a validated receipt in Supabase.
 * Handles deduplication via unique constraint on end_to_end_id.
 *
 * @param data - Validated receipt data
 * @param meta - Receipt metadata (source type, group, file URL)
 * @returns Result with stored receipt info or error
 */
export async function storeReceipt(
  data: ReceiptData,
  meta: ReceiptMeta
): Promise<Result<StoredReceipt>> {
  const supabase = getSupabaseClient()

  if (!supabase) {
    logger.error('Supabase not initialized for receipt storage', {
      event: 'receipt_storage_not_initialized',
    })
    return err('Supabase not initialized')
  }

  // Transform to snake_case for database
  const row = {
    end_to_end_id: data.identificador,
    valor: data.valor,
    data_hora: data.dataHora,
    tipo: data.tipo,
    recebedor: data.recebedor,
    pagador: data.pagador,
    raw_file_url: meta.rawFileUrl,
    source_type: meta.sourceType,
    group_jid: meta.groupJid,
  }

  try {
    const { data: inserted, error } = await supabase
      .from('receipts')
      .insert(row)
      .select('id, end_to_end_id')
      .single()

    if (error) {
      // Check for duplicate (unique constraint violation)
      if (error.code === UNIQUE_VIOLATION_CODE) {
        logger.info('Duplicate receipt detected', {
          event: 'receipt_duplicate',
          endToEndId: data.identificador,
        })
        return err('Duplicate receipt')
      }

      logger.error('Failed to store receipt', {
        event: 'receipt_storage_error',
        errorCode: error.code,
        errorMessage: error.message,
        endToEndId: data.identificador,
      })
      return err(`Database error: ${error.message}`)
    }

    const result: StoredReceipt = {
      id: inserted.id,
      endToEndId: inserted.end_to_end_id,
    }

    logger.info('Receipt stored successfully', {
      event: 'receipt_stored',
      id: result.id,
      endToEndId: result.endToEndId,
      sourceType: meta.sourceType,
      groupJid: meta.groupJid,
    })

    return ok(result)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Unexpected error storing receipt', {
      event: 'receipt_storage_exception',
      error: errorMessage,
      endToEndId: data.identificador,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Check if a receipt with the given EndToEnd ID already exists.
 *
 * @param endToEndId - EndToEnd ID to check
 * @returns Result with boolean (true if exists)
 */
export async function receiptExists(endToEndId: string): Promise<Result<boolean>> {
  const supabase = getSupabaseClient()

  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    const { count, error } = await supabase
      .from('receipts')
      .select('id', { count: 'exact', head: true })
      .eq('end_to_end_id', endToEndId)

    if (error) {
      logger.error('Failed to check receipt existence', {
        event: 'receipt_exists_error',
        errorCode: error.code,
        errorMessage: error.message,
        endToEndId,
      })
      return err(`Database error: ${error.message}`)
    }

    return ok((count ?? 0) > 0)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Unexpected error checking receipt existence', {
      event: 'receipt_exists_exception',
      error: errorMessage,
      endToEndId,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Reset the Supabase client (for testing).
 */
export function resetSupabaseClient(): void {
  supabaseClient = null
}

/**
 * Set a mock Supabase client (for testing).
 */
export function setSupabaseClient(client: SupabaseClient): void {
  supabaseClient = client
}
