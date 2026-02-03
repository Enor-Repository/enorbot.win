/**
 * Message History Service - Supabase logging for contacts, groups, and messages
 *
 * Story 7.1: Contacts Tracking Service - Track all contacts with message counts
 * Story 7.2: Groups Tracking Service - Track groups with control flag
 * Story 7.3: Message History Logging - Fire-and-forget message logging
 * Story 7.4: Bot Message Tracking - Log outgoing bot messages
 * Story 7.5: History Query API - Query message history
 *
 * All operations use Result<T> pattern (never throw) and fire-and-forget
 * to ensure message processing is never blocked by database issues.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'
import type { EnvConfig } from '../types/config.js'

let supabase: SupabaseClient | null = null

// Story 7.3 AC5: Performance monitoring threshold
const PERFORMANCE_THRESHOLD_MS = 100

/**
 * Message types for incoming messages
 */
export type IncomingMessageType = 'text' | 'image' | 'document' | 'other'

/**
 * Message types for outgoing bot messages
 * Story 7.4 AC6: Message Type Enum
 */
export type BotMessageType = 'price_response' | 'stall' | 'notification' | 'status' | 'error'
  | 'deal_quote' | 'deal_lock_confirmation' | 'deal_completed' | 'deal_cancelled'
  | 'deal_reminder' | 'deal_expired' | 'deal_expiration' | 'deal_no_active'
  | 'deal_state_reminder' | 'deal_state_hint' | 'deal_amount_needed'

/**
 * All supported message types
 */
export type MessageType = IncomingMessageType | BotMessageType

/**
 * Helper to measure and log slow operations.
 * Story 7.3 AC5: Performance Monitoring
 */
async function withPerformanceMonitoring<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now()
  try {
    return await fn()
  } finally {
    const elapsed = Date.now() - start
    if (elapsed > PERFORMANCE_THRESHOLD_MS) {
      logger.warn('Slow message history operation', {
        event: 'message_history_slow',
        operation,
        elapsedMs: elapsed,
        thresholdMs: PERFORMANCE_THRESHOLD_MS,
      })
    }
  }
}

/**
 * Extract phone number from WhatsApp JID.
 * Handles both standard format (5511999999999@s.whatsapp.net)
 * and device identifier format (5511999999999:123@s.whatsapp.net)
 *
 * Story 7.1 AC1: Phone Extraction from JID
 */
export function extractPhoneFromJid(jid: string): string {
  return jid.split('@')[0].split(':')[0]
}

/**
 * Set the Supabase client for testing.
 * @internal
 */
export function setMessageHistoryClient(client: SupabaseClient): void {
  supabase = client
}

/**
 * Reset the Supabase client (for testing).
 * @internal
 */
export function resetMessageHistoryClient(): void {
  supabase = null
}

/**
 * Initialize the message history service.
 * Uses the same Supabase client config as auth state.
 */
export function initMessageHistory(config: EnvConfig): void {
  supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY)
  logger.info('Message history service initialized', { event: 'message_history_init' })
}

/**
 * Upsert a contact (create or update) with atomic message_count increment.
 * Uses Supabase RPC function for atomic operations.
 * Fire-and-forget - errors are logged but don't block message processing.
 *
 * Story 7.1 AC2: Contact Upsert on Message
 * Story 7.1 AC3: Push Name Storage
 * Story 7.1 AC4: First Seen Tracking (handled by RPC)
 * Story 7.1 AC5: Fire-and-Forget Pattern
 */
export async function upsertContact(
  jid: string,
  pushName?: string
): Promise<Result<void>> {
  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    const phone = extractPhoneFromJid(jid)

    // Use RPC for atomic upsert with message_count increment
    // The RPC handles: first_seen_at on INSERT, last_seen_at on UPDATE,
    // message_count increment, and COALESCE for push_name
    const { error } = await supabase.rpc('upsert_contact', {
      p_jid: jid,
      p_phone: phone,
      p_push_name: pushName || null,
    })

    if (error) {
      logger.warn('Failed to upsert contact', {
        event: 'contact_upsert_error',
        jid,
        error: error.message,
      })
      return err(error.message)
    }

    return ok(undefined)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.warn('Contact upsert exception', {
      event: 'contact_upsert_exception',
      jid,
      error: errorMessage,
    })
    return err(errorMessage)
  }
}

/**
 * Upsert a group (create or update) with atomic message_count increment.
 * Uses Supabase RPC function for atomic operations.
 * Fire-and-forget - errors are logged but don't block message processing.
 *
 * Story 7.2 AC1: Group Upsert on Message
 * Story 7.2 AC2: Last Activity Update (handled by RPC)
 * Story 7.2 AC3: Control Group Flag
 * Story 7.2 AC4: First Seen Tracking (handled by RPC)
 * Story 7.2 AC5: Fire-and-Forget Pattern
 */
export async function upsertGroup(
  jid: string,
  name: string,
  isControlGroup: boolean = false
): Promise<Result<void>> {
  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    // Use RPC for atomic upsert with message_count increment
    // The RPC handles: first_seen_at on INSERT, last_activity_at on UPDATE,
    // message_count increment, and COALESCE for name (won't overwrite with empty)
    const { error } = await supabase.rpc('upsert_group', {
      p_jid: jid,
      p_name: name,
      p_is_control_group: isControlGroup,
    })

    if (error) {
      logger.warn('Failed to upsert group', {
        event: 'group_upsert_error',
        jid,
        error: error.message,
      })
      return err(error.message)
    }

    return ok(undefined)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.warn('Group upsert exception', {
      event: 'group_upsert_exception',
      jid,
      error: errorMessage,
    })
    return err(errorMessage)
  }
}

/**
 * Save a message to history.
 * Fire-and-forget - errors are logged but don't block message processing.
 *
 * Story 7.3 AC1: Message Logging on Receive
 * Story 7.3 AC3: Database Schema (includes is_control_group)
 * Story 7.3 AC5: Performance Monitoring
 * Story 7.3 AC6: Trigger Detection Flag
 */
export async function saveMessage(params: {
  messageId?: string
  groupJid: string
  senderJid: string
  isControlGroup?: boolean
  messageType: MessageType
  content: string
  isFromBot: boolean
  isTrigger: boolean
  metadata?: Record<string, unknown>
}): Promise<Result<void>> {
  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    return await withPerformanceMonitoring('saveMessage', async () => {
      const { error } = await supabase!
        .from('messages')
        .insert({
          message_id: params.messageId || null,
          group_jid: params.groupJid,
          sender_jid: params.senderJid,
          is_control_group: params.isControlGroup ?? false,
          message_type: params.messageType,
          content: params.content,
          is_from_bot: params.isFromBot,
          is_trigger: params.isTrigger,
          metadata: params.metadata || {},
        })

      if (error) {
        logger.warn('Failed to save message', {
          event: 'message_save_error',
          groupJid: params.groupJid,
          error: error.message,
        })
        return err(error.message)
      }

      logger.debug('Message saved to history', {
        event: 'message_saved',
        groupJid: params.groupJid,
        messageType: params.messageType,
        isTrigger: params.isTrigger,
      })

      return ok(undefined)
    })
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.warn('Message save exception', {
      event: 'message_save_exception',
      groupJid: params.groupJid,
      error: errorMessage,
    })
    return err(errorMessage)
  }
}

/**
 * Log a message and its context (contact + group + message).
 * Convenience function that handles all three upserts.
 *
 * IMPORTANT: This is a fire-and-forget function. It returns immediately
 * without waiting for database operations to complete. Errors are logged
 * but never propagated to callers. This ensures message processing is
 * never blocked by database issues.
 *
 * Story 7.3 AC1: Message Logging on Receive
 * Story 7.3 AC4: Parallel Operations
 */
export function logMessageToHistory(params: {
  messageId?: string
  groupJid: string
  groupName: string
  senderJid: string
  senderName?: string
  isControlGroup: boolean
  messageType: IncomingMessageType
  content: string
  isFromBot: boolean
  isTrigger: boolean
}): void {
  // Fire all three operations in parallel - don't await individually
  // Story 7.3 AC4: Parallel Operations via Promise.all
  // Note: Intentionally not awaited - fire-and-forget pattern
  Promise.all([
    upsertContact(params.senderJid, params.senderName),
    upsertGroup(params.groupJid, params.groupName, params.isControlGroup),
    saveMessage({
      messageId: params.messageId,
      groupJid: params.groupJid,
      senderJid: params.senderJid,
      isControlGroup: params.isControlGroup,
      messageType: params.messageType,
      content: params.content,
      isFromBot: params.isFromBot,
      isTrigger: params.isTrigger,
    }),
  ]).catch((e) => {
    logger.warn('Message history logging failed', {
      event: 'message_history_error',
      error: e instanceof Error ? e.message : String(e),
    })
  })
}

/**
 * Log an outgoing bot message to history.
 * Fire-and-forget pattern - never blocks message sending.
 *
 * Story 7.4 AC1: Price Response Logging
 * Story 7.4 AC2: Stall Message Logging
 * Story 7.4 AC3: Notification Logging
 * Story 7.4 AC5: Fire-and-Forget Pattern
 * Story 7.4 AC6: Message Type Enum
 */
export function logBotMessage(params: {
  groupJid: string
  content: string
  messageType: BotMessageType
  isControlGroup?: boolean
  metadata?: Record<string, unknown>
}): void {
  // Fire-and-forget - don't await
  saveMessage({
    groupJid: params.groupJid,
    senderJid: 'bot', // Special marker for bot messages
    isControlGroup: params.isControlGroup ?? false,
    messageType: params.messageType,
    content: params.content,
    isFromBot: true,
    isTrigger: false, // Bot messages are never triggers
    metadata: params.metadata,
  }).catch((e) => {
    logger.warn('Bot message logging failed', {
      event: 'bot_message_log_error',
      error: e instanceof Error ? e.message : String(e),
      groupJid: params.groupJid,
      messageType: params.messageType,
    })
  })
}

// ============================================================================
// Story 7.5: History Query API
// ============================================================================

/**
 * Query options for paginated results.
 * Story 7.5 AC5: Query Options
 */
export interface QueryOptions {
  /** Number of results to return (default 50, max 100) */
  limit?: number
  /** Number of results to skip (default 0) */
  offset?: number
  /** Sort order by created_at (default 'desc') */
  orderBy?: 'asc' | 'desc'
  /** Filter results from this date */
  from?: Date
  /** Filter results to this date */
  to?: Date
}

/**
 * Paginated result wrapper.
 * Story 7.5 AC4: Pagination Metadata
 */
export interface PaginatedResult<T> {
  data: T[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

/**
 * Message statistics for analytics.
 * Story 7.5 AC8: Message Statistics
 */
export interface MessageStats {
  total: number
  byGroup: Record<string, number>
  byType: Record<string, number>
  triggerCount: number
  dateRange: { from: Date; to: Date }
}

/**
 * Message record from database
 * Story 7.3 AC3: Full schema including is_control_group
 */
export interface Message {
  id: string
  message_id: string | null
  group_jid: string
  sender_jid: string
  is_control_group: boolean
  message_type: string
  content: string
  is_from_bot: boolean
  is_trigger: boolean
  metadata: Record<string, unknown>
  created_at: string
}

/**
 * Contact record from database
 */
export interface Contact {
  id: string
  jid: string
  phone: string
  push_name: string | null
  first_seen_at: string
  last_seen_at: string
  message_count: number
}

/**
 * Group record from database
 */
export interface Group {
  id: string
  jid: string
  name: string
  is_control_group: boolean
  first_seen_at: string
  last_activity_at: string
  message_count: number
}

// Default query options
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

// Safety limit for aggregation queries (getMessageStats)
const AGGREGATION_LIMIT = 10000

/**
 * Normalize query options with defaults and bounds.
 */
function normalizeQueryOptions(options: QueryOptions = {}): Required<Omit<QueryOptions, 'from' | 'to'>> & Pick<QueryOptions, 'from' | 'to'> {
  return {
    limit: Math.min(options.limit || DEFAULT_LIMIT, MAX_LIMIT),
    offset: options.offset || 0,
    orderBy: options.orderBy || 'desc',
    from: options.from,
    to: options.to,
  }
}

/**
 * Query messages for a specific group with pagination.
 *
 * Story 7.5 AC1: Query Messages by Group
 * Story 7.5 AC3: Date Range Filtering
 * Story 7.5 AC4: Pagination Metadata
 * Story 7.5 AC5: Query Options
 */
export async function getGroupMessages(
  groupJid: string,
  options: QueryOptions = {}
): Promise<Result<PaginatedResult<Message>>> {
  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    const { limit, offset, orderBy, from, to } = normalizeQueryOptions(options)

    let query = supabase
      .from('messages')
      .select('*', { count: 'exact' })
      .eq('group_jid', groupJid)
      .order('created_at', { ascending: orderBy === 'asc' })
      .range(offset, offset + limit - 1)

    if (from) {
      query = query.gte('created_at', from.toISOString())
    }
    if (to) {
      query = query.lte('created_at', to.toISOString())
    }

    const { data, error, count } = await query

    if (error) {
      logger.warn('Failed to get group messages', {
        event: 'group_messages_error',
        groupJid,
        error: error.message,
      })
      return err(error.message)
    }

    return ok({
      data: (data ?? []) as Message[],
      total: count ?? 0,
      limit,
      offset,
      hasMore: (count ?? 0) > offset + (data?.length ?? 0),
    })
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.warn('Get group messages exception', {
      event: 'group_messages_exception',
      groupJid,
      error: errorMessage,
    })
    return err(errorMessage)
  }
}

/**
 * Query messages from a specific contact (by phone) across all groups.
 *
 * Note: This uses a two-query approach (lookup contact JID, then query messages)
 * rather than a JOIN for simplicity. For high-volume use cases, consider
 * using a database view or RPC function with JOIN.
 *
 * Story 7.5 AC2: Query Messages by Contact
 * Story 7.5 AC3: Date Range Filtering
 * Story 7.5 AC4: Pagination Metadata
 * Story 7.5 AC5: Query Options
 */
export async function getContactMessages(
  phone: string,
  options: QueryOptions = {}
): Promise<Result<PaginatedResult<Message>>> {
  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    const { limit, offset, orderBy, from, to } = normalizeQueryOptions(options)

    // First, get the contact's JID from phone
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('jid')
      .eq('phone', phone)
      .single()

    if (contactError) {
      if (contactError.code === 'PGRST116') {
        // Not found - return empty result
        return ok({
          data: [],
          total: 0,
          limit,
          offset,
          hasMore: false,
        })
      }
      logger.warn('Failed to find contact', {
        event: 'contact_lookup_error',
        phone,
        error: contactError.message,
      })
      return err(contactError.message)
    }

    // Now query messages by sender_jid
    let query = supabase
      .from('messages')
      .select('*', { count: 'exact' })
      .eq('sender_jid', contact.jid)
      .order('created_at', { ascending: orderBy === 'asc' })
      .range(offset, offset + limit - 1)

    if (from) {
      query = query.gte('created_at', from.toISOString())
    }
    if (to) {
      query = query.lte('created_at', to.toISOString())
    }

    const { data, error, count } = await query

    if (error) {
      logger.warn('Failed to get contact messages', {
        event: 'contact_messages_error',
        phone,
        error: error.message,
      })
      return err(error.message)
    }

    return ok({
      data: (data ?? []) as Message[],
      total: count ?? 0,
      limit,
      offset,
      hasMore: (count ?? 0) > offset + (data?.length ?? 0),
    })
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.warn('Get contact messages exception', {
      event: 'contact_messages_exception',
      phone,
      error: errorMessage,
    })
    return err(errorMessage)
  }
}

/**
 * Get all contacts with optional date filtering.
 *
 * Story 7.5 AC6: Get All Contacts
 */
export async function getContacts(
  options: QueryOptions = {}
): Promise<Result<PaginatedResult<Contact>>> {
  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    const { limit, offset, from, to } = normalizeQueryOptions(options)

    let query = supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .order('message_count', { ascending: false }) // Most active first
      .range(offset, offset + limit - 1)

    if (from) {
      query = query.gte('first_seen_at', from.toISOString())
    }
    if (to) {
      query = query.lte('first_seen_at', to.toISOString())
    }

    const { data, error, count } = await query

    if (error) {
      logger.warn('Failed to get contacts', {
        event: 'get_contacts_error',
        error: error.message,
      })
      return err(error.message)
    }

    return ok({
      data: (data ?? []) as Contact[],
      total: count ?? 0,
      limit,
      offset,
      hasMore: (count ?? 0) > offset + (data?.length ?? 0),
    })
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.warn('Get contacts exception', {
      event: 'get_contacts_exception',
      error: errorMessage,
    })
    return err(errorMessage)
  }
}

/**
 * Get all groups with optional control group filter.
 *
 * Story 7.5 AC7: Get All Groups
 */
export async function getGroups(
  options: QueryOptions & { isControlGroup?: boolean } = {}
): Promise<Result<PaginatedResult<Group>>> {
  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    const { limit, offset } = normalizeQueryOptions(options)
    const { isControlGroup } = options

    let query = supabase
      .from('groups')
      .select('*', { count: 'exact' })
      .order('message_count', { ascending: false }) // Most active first
      .range(offset, offset + limit - 1)

    if (isControlGroup !== undefined) {
      query = query.eq('is_control_group', isControlGroup)
    }

    const { data, error, count } = await query

    if (error) {
      logger.warn('Failed to get groups', {
        event: 'get_groups_error',
        error: error.message,
      })
      return err(error.message)
    }

    return ok({
      data: (data ?? []) as Group[],
      total: count ?? 0,
      limit,
      offset,
      hasMore: (count ?? 0) > offset + (data?.length ?? 0),
    })
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.warn('Get groups exception', {
      event: 'get_groups_exception',
      error: errorMessage,
    })
    return err(errorMessage)
  }
}

/**
 * Get message statistics for a date range.
 *
 * Note: The byGroup and byType aggregations are limited to 10,000 messages
 * for memory safety. The `total` count is accurate (uses COUNT), but
 * breakdowns may be incomplete for very large date ranges. For production
 * analytics with large datasets, consider using database-side aggregation
 * via Supabase RPC functions.
 *
 * Story 7.5 AC8: Message Statistics
 */
export async function getMessageStats(
  options: { from?: Date; to?: Date } = {}
): Promise<Result<MessageStats>> {
  if (!supabase) {
    return err('Supabase not initialized')
  }

  try {
    const from = options.from || new Date(0) // Beginning of time
    const to = options.to || new Date() // Now

    // Get total count
    let countQuery = supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())

    const { count: total, error: countError } = await countQuery

    if (countError) {
      return err(countError.message)
    }

    // Get trigger count
    const { count: triggerCount, error: triggerError } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('is_trigger', true)
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())

    if (triggerError) {
      return err(triggerError.message)
    }

    // Get messages for aggregation (limited to prevent memory issues)
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('group_jid, message_type')
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .limit(AGGREGATION_LIMIT)

    if (messagesError) {
      return err(messagesError.message)
    }

    const messageCount = messages?.length ?? 0

    // Issue fix: Warn when aggregation limit is hit (data may be incomplete)
    if (messageCount >= AGGREGATION_LIMIT) {
      logger.warn('Message stats aggregation limit reached', {
        event: 'message_stats_limit_reached',
        limit: AGGREGATION_LIMIT,
        totalMessages: total ?? 0,
        note: 'byGroup and byType breakdowns may be incomplete',
      })
    }

    // Aggregate by group
    const byGroup: Record<string, number> = {}
    const byType: Record<string, number> = {}

    for (const msg of messages || []) {
      byGroup[msg.group_jid] = (byGroup[msg.group_jid] || 0) + 1
      byType[msg.message_type] = (byType[msg.message_type] || 0) + 1
    }

    return ok({
      total: total ?? 0,
      byGroup,
      byType,
      triggerCount: triggerCount ?? 0,
      dateRange: { from, to },
    })
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.warn('Get message stats exception', {
      event: 'message_stats_exception',
      error: errorMessage,
    })
    return err(errorMessage)
  }
}

// ============================================================================
// Sprint 5, Task 5.1: Message Lookback
// ============================================================================

/**
 * Default limit for lookback queries.
 * Small enough for fast queries, large enough for context.
 */
const LOOKBACK_DEFAULT_LIMIT = 10
const LOOKBACK_MAX_LIMIT = 50

/**
 * Get recent messages from a specific sender in a specific group.
 * Used for conversation context (amounts, ongoing deal discussion).
 *
 * Uses composite index: idx_messages_group_sender_created
 *
 * Sprint 5, Task 5.1: Sender Message Lookback
 *
 * @param groupJid - The group to look in
 * @param senderJid - The sender to look up
 * @param limit - Max messages to return (default 10, max 50)
 * @returns Recent messages from the sender, newest first
 */
export async function getRecentSenderMessages(
  groupJid: string,
  senderJid: string,
  limit: number = LOOKBACK_DEFAULT_LIMIT
): Promise<Result<Message[]>> {
  if (!supabase) {
    return err('Supabase not initialized')
  }

  const safeLimit = Math.min(Math.max(limit, 1), LOOKBACK_MAX_LIMIT)

  try {
    return await withPerformanceMonitoring('getRecentSenderMessages', async () => {
      const { data, error } = await supabase!
        .from('messages')
        .select('*')
        .eq('group_jid', groupJid)
        .eq('sender_jid', senderJid)
        .order('created_at', { ascending: false })
        .limit(safeLimit)

      if (error) {
        logger.warn('Failed to get recent sender messages', {
          event: 'sender_lookback_error',
          groupJid,
          senderJid,
          error: error.message,
        })
        return err(error.message)
      }

      return ok((data ?? []) as Message[])
    })
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.warn('Sender lookback exception', {
      event: 'sender_lookback_exception',
      groupJid,
      senderJid,
      error: errorMessage,
    })
    return err(errorMessage)
  }
}

/**
 * Get recent messages in a group (all senders).
 * Used for response suppression (check if bot already answered, operator responded).
 *
 * Uses index: idx_messages_group_created
 *
 * Sprint 5, Task 5.1: Group Message Lookback
 *
 * @param groupJid - The group to look in
 * @param limit - Max messages to return (default 10, max 50)
 * @param options - Optional filters
 * @returns Recent messages in the group, newest first
 */
export async function getRecentGroupMessages(
  groupJid: string,
  limit: number = LOOKBACK_DEFAULT_LIMIT,
  options: { botOnly?: boolean; since?: Date } = {}
): Promise<Result<Message[]>> {
  if (!supabase) {
    return err('Supabase not initialized')
  }

  const safeLimit = Math.min(Math.max(limit, 1), LOOKBACK_MAX_LIMIT)

  try {
    return await withPerformanceMonitoring('getRecentGroupMessages', async () => {
      let query = supabase!
        .from('messages')
        .select('*')
        .eq('group_jid', groupJid)

      if (options.botOnly) {
        query = query.eq('is_from_bot', true)
      }

      if (options.since) {
        query = query.gte('created_at', options.since.toISOString())
      }

      query = query
        .order('created_at', { ascending: false })
        .limit(safeLimit)

      const { data, error } = await query

      if (error) {
        logger.warn('Failed to get recent group messages', {
          event: 'group_lookback_error',
          groupJid,
          error: error.message,
        })
        return err(error.message)
      }

      return ok((data ?? []) as Message[])
    })
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    logger.warn('Group lookback exception', {
      event: 'group_lookback_exception',
      groupJid,
      error: errorMessage,
    })
    return err(errorMessage)
  }
}

/**
 * Context extracted from message history for intelligent response decisions.
 * Sprint 5, Task 5.1
 */
export interface SenderContext {
  /** Recent messages from this sender (newest first) */
  recentMessages: Message[]
  /** Whether the sender has been active recently (within the lookback window) */
  isRecentlyActive: boolean
  /** Count of messages from this sender in the lookback window */
  messageCount: number
  /** Whether any of the recent messages were triggers */
  hasRecentTrigger: boolean
  /** Whether the bot has responded to this sender recently */
  botRespondedRecently: boolean
}

/**
 * Build context for a sender in a group by looking at recent history.
 * Combines sender messages and bot responses for decision-making.
 *
 * Sprint 5, Task 5.1: Context Extraction
 *
 * @param groupJid - The group to look in
 * @param senderJid - The sender to build context for
 * @param windowMinutes - How far back to look (default 5 minutes)
 * @returns SenderContext with recent activity info
 */
export async function buildSenderContext(
  groupJid: string,
  senderJid: string,
  windowMinutes: number = 5
): Promise<Result<SenderContext>> {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000)

  // Fetch sender messages and bot responses in parallel
  const [senderResult, botResult] = await Promise.all([
    getRecentSenderMessages(groupJid, senderJid, 10),
    getRecentGroupMessages(groupJid, 10, { botOnly: true, since }),
  ])

  if (!senderResult.ok) {
    return err(senderResult.error)
  }
  if (!botResult.ok) {
    return err(botResult.error)
  }

  const senderMessages = senderResult.data
  const botMessages = botResult.data

  // Filter sender messages to the lookback window
  const recentSenderMessages = senderMessages.filter(
    (m) => new Date(m.created_at) >= since
  )

  return ok({
    recentMessages: senderMessages,
    isRecentlyActive: recentSenderMessages.length > 0,
    messageCount: recentSenderMessages.length,
    hasRecentTrigger: recentSenderMessages.some((m) => m.is_trigger),
    botRespondedRecently: botMessages.length > 0,
  })
}
