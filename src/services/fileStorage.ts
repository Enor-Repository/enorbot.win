/**
 * File Storage Service
 *
 * Story 6.6 - Stores raw receipt files (PDFs, images) in Supabase Storage.
 * Returns Result type - never throws.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ok, err, type Result } from '../utils/result.js'
import { logger } from '../utils/logger.js'
import { getConfig } from '../config.js'

/** Supabase Storage bucket for receipt files */
const RECEIPTS_BUCKET = 'receipts'

/** Supported MIME types and their file extensions */
const MIME_TO_EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

// Supabase client singleton for file storage
let supabaseClient: SupabaseClient | null = null

/**
 * Get or create Supabase client for file storage.
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
 * Get file extension from MIME type.
 *
 * @param mimeType - MIME type (e.g., 'application/pdf', 'image/jpeg')
 * @returns File extension (e.g., 'pdf', 'jpg') or 'bin' for unknown types
 */
export function getExtensionFromMimeType(mimeType: string): string {
  return MIME_TO_EXTENSION[mimeType] ?? 'bin'
}

/**
 * Store a raw file (PDF or image) in Supabase Storage.
 *
 * @param buffer - File buffer to upload
 * @param endToEndId - EndToEnd ID (used as filename base)
 * @param mimeType - MIME type of the file
 * @returns Result with public URL on success, error on failure
 */
export async function storeRawFile(
  buffer: Buffer,
  endToEndId: string,
  mimeType: string
): Promise<Result<string>> {
  const supabase = getSupabaseClient()

  if (!supabase) {
    logger.error('Supabase not initialized for file storage', {
      event: 'file_storage_not_initialized',
    })
    return err('Supabase not initialized')
  }

  const extension = getExtensionFromMimeType(mimeType)
  const filename = `${endToEndId}.${extension}`

  try {
    const startTime = Date.now()

    // Upload file to Supabase Storage
    const { data, error: uploadError } = await supabase.storage
      .from(RECEIPTS_BUCKET)
      .upload(filename, buffer, {
        contentType: mimeType,
        upsert: false, // Don't overwrite existing files (deduplication)
      })

    if (uploadError) {
      // Check if error is due to file already existing (duplicate)
      if (uploadError.message?.includes('already exists') || uploadError.message?.includes('Duplicate')) {
        logger.info('File already exists in storage', {
          event: 'file_already_exists',
          filename,
          endToEndId,
        })
        // Return the public URL anyway since file exists
        const { data: urlData } = supabase.storage
          .from(RECEIPTS_BUCKET)
          .getPublicUrl(filename)

        return ok(urlData.publicUrl)
      }

      logger.error('Failed to upload file', {
        event: 'file_upload_error',
        errorMessage: uploadError.message,
        filename,
        endToEndId,
        durationMs: Date.now() - startTime,
      })
      return err(`Upload failed: ${uploadError.message}`)
    }

    // Get public URL for the uploaded file
    const { data: urlData } = supabase.storage
      .from(RECEIPTS_BUCKET)
      .getPublicUrl(filename)

    const durationMs = Date.now() - startTime

    logger.info('File uploaded successfully', {
      event: 'file_uploaded',
      filename,
      path: data.path,
      publicUrl: urlData.publicUrl,
      sizeBytes: buffer.length,
      mimeType,
      durationMs,
    })

    return ok(urlData.publicUrl)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Unexpected error uploading file', {
      event: 'file_upload_exception',
      error: errorMessage,
      filename,
      endToEndId,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Check if a file exists in Supabase Storage.
 *
 * @param endToEndId - EndToEnd ID (filename base)
 * @param extension - File extension
 * @returns Result with boolean (true if exists)
 */
export async function fileExists(
  endToEndId: string,
  extension: string
): Promise<Result<boolean>> {
  const supabase = getSupabaseClient()

  if (!supabase) {
    return err('Supabase not initialized')
  }

  const filename = `${endToEndId}.${extension}`

  try {
    // Try to get file metadata
    const { data, error } = await supabase.storage
      .from(RECEIPTS_BUCKET)
      .list('', {
        search: filename,
        limit: 1,
      })

    if (error) {
      logger.error('Failed to check file existence', {
        event: 'file_exists_error',
        errorMessage: error.message,
        filename,
      })
      return err(`Storage error: ${error.message}`)
    }

    const exists = data.some((file) => file.name === filename)
    return ok(exists)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.error('Unexpected error checking file existence', {
      event: 'file_exists_exception',
      error: errorMessage,
      filename,
    })
    return err(`Unexpected error: ${errorMessage}`)
  }
}

/**
 * Get public URL for a file in storage.
 *
 * @param endToEndId - EndToEnd ID (filename base)
 * @param extension - File extension
 * @returns Public URL (always returns a URL, even if file doesn't exist)
 */
export function getFileUrl(endToEndId: string, extension: string): string | null {
  const supabase = getSupabaseClient()

  if (!supabase) {
    return null
  }

  const filename = `${endToEndId}.${extension}`
  const { data } = supabase.storage.from(RECEIPTS_BUCKET).getPublicUrl(filename)

  return data.publicUrl
}

/**
 * Reset the Supabase client (for testing).
 */
export function resetStorageClient(): void {
  supabaseClient = null
}

/**
 * Set a mock Supabase client (for testing).
 */
export function setStorageClient(client: SupabaseClient): void {
  supabaseClient = client
}
