/**
 * Deal Flow Service - Stateful Deal Tracking
 * Sprint 4: Deal Flow Engine
 *
 * Implements stateful deal tracking: quote → lock → compute → confirm
 *
 * State machine:
 *   QUOTED → LOCKED → COMPUTING → COMPLETED
 *                                → EXPIRED (via TTL sweep)
 *                                → CANCELLED (by client or operator)
 *
 * Key design:
 * - Rule snapshot frozen at deal creation (no mid-deal rule switching)
 * - TTL-based expiration with sweeper function
 * - One active deal per client per group at a time
 * - All functions return Result<T>, never throw
 */
import { getSupabase } from './supabase.js'
import { logger } from '../utils/logger.js'
import { ok, err, type Result } from '../utils/result.js'
import type { GroupRule, PricingSource, SpreadMode } from './ruleService.js'
import type { SpreadConfig, TradeSide } from './groupSpreadService.js'
import { emitDealEvent } from './dataLake.js'

// ============================================================================
// Types
// ============================================================================

/** Deal states */
export type DealState = 'quoted' | 'locked' | 'awaiting_amount' | 'computing' | 'completed' | 'expired' | 'cancelled' | 'rejected'

/** Terminal states — deals in these states cannot transition further */
const TERMINAL_STATES: DealState[] = ['completed', 'expired', 'cancelled', 'rejected']

/** Valid state transitions */
const VALID_TRANSITIONS: Record<DealState, DealState[]> = {
  quoted: ['locked', 'expired', 'cancelled', 'rejected'],
  locked: ['awaiting_amount', 'computing', 'expired', 'cancelled'],
  awaiting_amount: ['computing', 'expired', 'cancelled'],
  computing: ['completed', 'cancelled'],
  completed: [],
  expired: [],
  cancelled: [],
  rejected: [],
}

/** Completion reasons for terminal states */
export type CompletionReason =
  | 'confirmed'
  | 'expired'
  | 'cancelled_by_client'
  | 'cancelled_by_operator'
  | 'rejected_by_client'

/** Active deal record */
export interface ActiveDeal {
  id: string
  groupJid: string
  clientJid: string
  state: DealState
  side: TradeSide
  quotedRate: number
  baseRate: number
  quotedAt: Date
  lockedRate: number | null
  lockedAt: Date | null
  amountBrl: number | null
  amountUsdt: number | null
  ttlExpiresAt: Date
  ruleIdUsed: string | null
  ruleName: string | null
  pricingSource: PricingSource
  spreadMode: SpreadMode
  sellSpread: number
  buySpread: number
  /** Sprint 9: When the awaiting_amount re-prompt was sent */
  repromptedAt: Date | null
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/** Deal history record (archived deals) */
export interface DealHistoryRecord {
  id: string
  groupJid: string
  clientJid: string
  finalState: DealState
  side: TradeSide
  quotedRate: number
  baseRate: number
  lockedRate: number | null
  amountBrl: number | null
  amountUsdt: number | null
  quotedAt: Date
  lockedAt: Date | null
  completedAt: Date | null
  ttlExpiresAt: Date
  ruleIdUsed: string | null
  ruleName: string | null
  pricingSource: PricingSource
  spreadMode: SpreadMode
  sellSpread: number
  buySpread: number
  metadata: Record<string, unknown>
  completionReason: CompletionReason | null
  createdAt: Date
  archivedAt: Date
}

/** Database row type for active_deals (snake_case) */
interface ActiveDealRow {
  id: string
  group_jid: string
  client_jid: string
  state: string
  side: string
  quoted_rate: number
  base_rate: number
  quoted_at: string
  locked_rate: number | null
  locked_at: string | null
  amount_brl: number | null
  amount_usdt: number | null
  ttl_expires_at: string
  rule_id_used: string | null
  rule_name: string | null
  pricing_source: string
  spread_mode: string
  sell_spread: number
  buy_spread: number
  reprompted_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

/** Database row type for deal_history (snake_case) */
interface DealHistoryRow {
  id: string
  group_jid: string
  client_jid: string
  final_state: string
  side: string
  quoted_rate: number
  base_rate: number
  locked_rate: number | null
  amount_brl: number | null
  amount_usdt: number | null
  quoted_at: string
  locked_at: string | null
  completed_at: string | null
  ttl_expires_at: string
  rule_id_used: string | null
  rule_name: string | null
  pricing_source: string
  spread_mode: string
  sell_spread: number
  buy_spread: number
  metadata: Record<string, unknown>
  completion_reason: string | null
  created_at: string
  archived_at: string
}

/** Input for creating a new deal (quote stage) */
export interface CreateDealInput {
  groupJid: string
  clientJid: string
  side: TradeSide
  quotedRate: number
  baseRate: number
  amountBrl?: number
  amountUsdt?: number
  ttlSeconds: number
  /** Rule snapshot (null if using default spread) */
  rule?: GroupRule | null
  /** Spread config snapshot (fallback when no rule) */
  spreadConfig?: SpreadConfig
  metadata?: Record<string, unknown>
}

/** Input for locking a deal */
export interface LockDealInput {
  lockedRate: number
  amountBrl?: number
  amountUsdt?: number
  ttlSeconds?: number
}

/** Input for completing computation */
export interface ComputeDealInput {
  amountBrl: number
  amountUsdt: number
}

// ============================================================================
// Cache
// ============================================================================

/**
 * In-memory cache for active deals per group.
 * TTL: 30 seconds (deals change frequently during active trading).
 */
const dealsCache: Map<string, ActiveDeal[]> = new Map()
const cacheTimestamps: Map<string, number> = new Map()
const CACHE_TTL_MS = 30 * 1000

function isCacheValid(groupJid: string): boolean {
  const timestamp = cacheTimestamps.get(groupJid)
  if (!timestamp) return false
  return Date.now() - timestamp < CACHE_TTL_MS
}

/** Clear cache for a specific group or all groups */
export function clearDealsCache(groupJid?: string): void {
  if (groupJid) {
    dealsCache.delete(groupJid)
    cacheTimestamps.delete(groupJid)
  } else {
    dealsCache.clear()
    cacheTimestamps.clear()
  }
}

// ============================================================================
// Data Conversion
// ============================================================================

/** Convert database row to ActiveDeal object */
function rowToDeal(row: ActiveDealRow): ActiveDeal {
  return {
    id: row.id,
    groupJid: row.group_jid,
    clientJid: row.client_jid,
    state: row.state as DealState,
    side: row.side as TradeSide,
    quotedRate: Number(row.quoted_rate),
    baseRate: Number(row.base_rate),
    quotedAt: new Date(row.quoted_at),
    lockedRate: row.locked_rate !== null ? Number(row.locked_rate) : null,
    lockedAt: row.locked_at ? new Date(row.locked_at) : null,
    amountBrl: row.amount_brl !== null ? Number(row.amount_brl) : null,
    amountUsdt: row.amount_usdt !== null ? Number(row.amount_usdt) : null,
    ttlExpiresAt: new Date(row.ttl_expires_at),
    ruleIdUsed: row.rule_id_used,
    ruleName: row.rule_name,
    pricingSource: row.pricing_source as PricingSource,
    spreadMode: row.spread_mode as SpreadMode,
    sellSpread: Number(row.sell_spread),
    buySpread: Number(row.buy_spread),
    repromptedAt: row.reprompted_at ? new Date(row.reprompted_at) : null,
    metadata: row.metadata || {},
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

/** Convert database row to DealHistoryRecord */
function rowToHistory(row: DealHistoryRow): DealHistoryRecord {
  return {
    id: row.id,
    groupJid: row.group_jid,
    clientJid: row.client_jid,
    finalState: row.final_state as DealState,
    side: row.side as TradeSide,
    quotedRate: Number(row.quoted_rate),
    baseRate: Number(row.base_rate),
    lockedRate: row.locked_rate !== null ? Number(row.locked_rate) : null,
    amountBrl: row.amount_brl !== null ? Number(row.amount_brl) : null,
    amountUsdt: row.amount_usdt !== null ? Number(row.amount_usdt) : null,
    quotedAt: new Date(row.quoted_at),
    lockedAt: row.locked_at ? new Date(row.locked_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    ttlExpiresAt: new Date(row.ttl_expires_at),
    ruleIdUsed: row.rule_id_used,
    ruleName: row.rule_name,
    pricingSource: row.pricing_source as PricingSource,
    spreadMode: row.spread_mode as SpreadMode,
    sellSpread: Number(row.sell_spread),
    buySpread: Number(row.buy_spread),
    metadata: row.metadata || {},
    completionReason: row.completion_reason as CompletionReason | null,
    createdAt: new Date(row.created_at),
    archivedAt: new Date(row.archived_at),
  }
}

// ============================================================================
// Validation
// ============================================================================

/** Valid deal states */
const VALID_STATES: DealState[] = ['quoted', 'locked', 'awaiting_amount', 'computing', 'completed', 'expired', 'cancelled', 'rejected']

/** Valid trade sides */
const VALID_SIDES: TradeSide[] = ['client_buys_usdt', 'client_sells_usdt']

/** Check if a state transition is valid */
export function isValidTransition(from: DealState, to: DealState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

/** Validate create deal input */
export function validateCreateDealInput(input: CreateDealInput): string | null {
  if (!input.groupJid || typeof input.groupJid !== 'string') return 'groupJid is required'
  if (!input.clientJid || typeof input.clientJid !== 'string') return 'clientJid is required'
  if (!input.side || !VALID_SIDES.includes(input.side)) return 'Invalid side'
  if (typeof input.quotedRate !== 'number' || input.quotedRate <= 0) return 'quotedRate must be positive'
  if (typeof input.baseRate !== 'number' || input.baseRate <= 0) return 'baseRate must be positive'
  if (typeof input.ttlSeconds !== 'number' || input.ttlSeconds <= 0) return 'ttlSeconds must be positive'
  if (input.amountBrl !== undefined && (typeof input.amountBrl !== 'number' || input.amountBrl <= 0)) {
    return 'amountBrl must be positive'
  }
  if (input.amountUsdt !== undefined && (typeof input.amountUsdt !== 'number' || input.amountUsdt <= 0)) {
    return 'amountUsdt must be positive'
  }
  return null
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new deal in QUOTED state.
 * Snapshots the active rule at creation time.
 * Enforces: one active deal per client per group.
 */
export async function createDeal(input: CreateDealInput): Promise<Result<ActiveDeal>> {
  const validationError = validateCreateDealInput(input)
  if (validationError) return err(validationError)

  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  try {
    // Check for existing active deal for this client in this group
    const { data: existing, error: checkError } = await supabase
      .from('active_deals')
      .select('id, state')
      .eq('group_jid', input.groupJid)
      .eq('client_jid', input.clientJid)
      .not('state', 'in', '("completed","expired","cancelled","rejected")')
      .limit(1)

    if (checkError) {
      logger.error('Failed to check existing deals', {
        event: 'deal_check_error',
        groupJid: input.groupJid,
        clientJid: input.clientJid,
        error: checkError.message,
      })
      return err(`Failed to check existing deals: ${checkError.message}`)
    }

    if (existing && existing.length > 0) {
      return err(`Client already has an active deal (${existing[0].state}) in this group`)
    }

    // Build rule snapshot
    const rule = input.rule
    const spreadConfig = input.spreadConfig
    const ttlExpiresAt = new Date(Date.now() + input.ttlSeconds * 1000)

    const row: Record<string, unknown> = {
      group_jid: input.groupJid,
      client_jid: input.clientJid,
      state: 'quoted',
      side: input.side,
      quoted_rate: input.quotedRate,
      base_rate: input.baseRate,
      quoted_at: new Date().toISOString(),
      ttl_expires_at: ttlExpiresAt.toISOString(),
      // Rule snapshot
      rule_id_used: rule?.id ?? null,
      rule_name: rule?.name ?? null,
      pricing_source: rule?.pricingSource ?? 'usdt_binance',
      spread_mode: rule?.spreadMode ?? spreadConfig?.spreadMode ?? 'bps',
      sell_spread: rule?.sellSpread ?? spreadConfig?.sellSpread ?? 0,
      buy_spread: rule?.buySpread ?? spreadConfig?.buySpread ?? 0,
      metadata: input.metadata ?? {},
    }

    if (input.amountBrl !== undefined) row.amount_brl = input.amountBrl
    if (input.amountUsdt !== undefined) row.amount_usdt = input.amountUsdt

    const { data, error } = await supabase
      .from('active_deals')
      .insert(row)
      .select()
      .single()

    if (error) {
      logger.error('Failed to create deal', {
        event: 'deal_create_error',
        groupJid: input.groupJid,
        clientJid: input.clientJid,
        error: error.message,
      })
      return err(`Failed to create deal: ${error.message}`)
    }

    const deal = rowToDeal(data as ActiveDealRow)
    clearDealsCache(input.groupJid)

    logger.info('Deal created', {
      event: 'deal_created',
      dealId: deal.id,
      groupJid: deal.groupJid,
      clientJid: deal.clientJid,
      state: deal.state,
      quotedRate: deal.quotedRate,
      side: deal.side,
      ruleName: deal.ruleName,
      ttlExpiresAt: deal.ttlExpiresAt.toISOString(),
    })

    // Bronze layer: emit deal creation event
    emitDealEvent({
      dealId: deal.id,
      groupJid: deal.groupJid,
      clientJid: deal.clientJid,
      fromState: null,
      toState: 'quoted',
      eventType: 'created',
      dealSnapshot: data as Record<string, unknown>,
    })

    return ok(deal)
  } catch (e) {
    return err(`Unexpected error creating deal: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Get all active (non-terminal) deals for a group.
 */
export async function getActiveDeals(groupJid: string): Promise<Result<ActiveDeal[]>> {
  if (!groupJid) return err('groupJid is required')

  // Check cache
  if (isCacheValid(groupJid)) {
    const cached = dealsCache.get(groupJid)
    if (cached) return ok(cached)
  }

  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  try {
    const { data, error } = await supabase
      .from('active_deals')
      .select('*')
      .eq('group_jid', groupJid)
      .not('state', 'in', '("completed","expired","cancelled","rejected")')
      .order('created_at', { ascending: false })

    if (error) {
      logger.error('Failed to load active deals', {
        event: 'deals_load_error',
        groupJid,
        error: error.message,
      })
      return err(`Failed to load deals: ${error.message}`)
    }

    const deals = (data || []).map((row) => rowToDeal(row as ActiveDealRow))

    // Update cache
    dealsCache.set(groupJid, deals)
    cacheTimestamps.set(groupJid, Date.now())

    return ok(deals)
  } catch (e) {
    return err(`Unexpected error loading deals: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Get a sender's active (non-terminal) deal in a group, if any.
 * Used by the simple-mode router intercept to check deal state before trigger matching.
 */
export async function getActiveDealForSender(groupJid: string, senderJid: string): Promise<Result<ActiveDeal | null>> {
  const result = await getActiveDeals(groupJid)
  if (!result.ok) return err(result.error)
  const deal = result.data.find((d) => d.clientJid === senderJid) ?? null
  return ok(deal)
}

/**
 * Get all deals for a group (including terminal states) for dashboard view.
 */
export async function getAllDeals(groupJid: string): Promise<Result<ActiveDeal[]>> {
  if (!groupJid) return err('groupJid is required')

  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  try {
    const { data, error } = await supabase
      .from('active_deals')
      .select('*')
      .eq('group_jid', groupJid)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) return err(`Failed to load deals: ${error.message}`)

    const deals = (data || []).map((row) => rowToDeal(row as ActiveDealRow))
    return ok(deals)
  } catch (e) {
    return err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Get a single deal by ID, verifying it belongs to the specified group.
 */
export async function getDealById(dealId: string, groupJid: string): Promise<Result<ActiveDeal>> {
  if (!dealId) return err('dealId is required')
  if (!groupJid) return err('groupJid is required')

  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  try {
    const { data, error } = await supabase
      .from('active_deals')
      .select('*')
      .eq('id', dealId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return err('Deal not found')
      return err(`Failed to load deal: ${error.message}`)
    }

    const deal = rowToDeal(data as ActiveDealRow)

    // Authorization: verify deal belongs to this group
    if (deal.groupJid !== groupJid) return err('Deal not found')

    return ok(deal)
  } catch (e) {
    return err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Find the active deal for a specific client in a group.
 * Returns null (not error) if no active deal exists.
 */
export async function findClientDeal(
  groupJid: string,
  clientJid: string
): Promise<Result<ActiveDeal | null>> {
  if (!groupJid || !clientJid) return err('groupJid and clientJid are required')

  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  try {
    const { data, error } = await supabase
      .from('active_deals')
      .select('*')
      .eq('group_jid', groupJid)
      .eq('client_jid', clientJid)
      .not('state', 'in', '("completed","expired","cancelled","rejected")')
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) return err(`Failed to find client deal: ${error.message}`)

    if (!data || data.length === 0) return ok(null)

    return ok(rowToDeal(data[0] as ActiveDealRow))
  } catch (e) {
    return err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// ============================================================================
// State Transitions
// ============================================================================

/**
 * Transition a deal to a new state with validation.
 */
async function transitionDeal(
  dealId: string,
  groupJid: string,
  toState: DealState,
  updates: Record<string, unknown>,
  logEvent: string
): Promise<Result<ActiveDeal>> {
  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  try {
    // Load current deal
    const dealResult = await getDealById(dealId, groupJid)
    if (!dealResult.ok) return dealResult

    const deal = dealResult.data

    // Validate transition
    if (!isValidTransition(deal.state, toState)) {
      return err(`Invalid transition: ${deal.state} → ${toState}`)
    }

    // Check TTL (only for non-terminal transitions)
    if (!TERMINAL_STATES.includes(toState) && new Date() > deal.ttlExpiresAt) {
      // Auto-expire the deal
      const expireResult = await expireDeal(dealId, groupJid)
      if (expireResult.ok) {
        return err('Deal has expired')
      }
      return err('Deal has expired and could not be updated')
    }

    // H1 Fix: Merge metadata instead of overwriting
    const row: Record<string, unknown> = {
      state: toState,
      ...updates,
    }
    if (typeof updates.metadata === 'object' && updates.metadata !== null) {
      row.metadata = { ...deal.metadata, ...(updates.metadata as Record<string, unknown>) }
    }

    // H2 Fix: Optimistic concurrency — guard on expected current state
    const { data, error } = await supabase
      .from('active_deals')
      .update(row)
      .eq('id', dealId)
      .eq('group_jid', groupJid)
      .eq('state', deal.state)
      .select()
      .single()

    if (error) {
      // PGRST116 = no rows matched — state changed between read and update
      if (error.code === 'PGRST116') {
        logger.warn('Deal state changed concurrently during transition', {
          event: 'deal_transition_conflict',
          dealId,
          expectedState: deal.state,
          toState,
        })
        return err(`Deal state changed concurrently (expected ${deal.state})`)
      }
      logger.error(`Failed to transition deal to ${toState}`, {
        event: `deal_transition_error`,
        dealId,
        fromState: deal.state,
        toState,
        error: error.message,
      })
      return err(`Failed to transition deal: ${error.message}`)
    }

    const updated = rowToDeal(data as ActiveDealRow)
    clearDealsCache(groupJid)

    logger.info(`Deal transitioned: ${deal.state} → ${toState}`, {
      event: logEvent,
      dealId,
      groupJid,
      clientJid: deal.clientJid,
      fromState: deal.state,
      toState,
    })

    // Bronze layer: emit deal transition event
    emitDealEvent({
      dealId,
      groupJid,
      clientJid: deal.clientJid,
      fromState: deal.state,
      toState,
      eventType: toState,
      dealSnapshot: data as Record<string, unknown>,
    })

    return ok(updated)
  } catch (e) {
    return err(`Unexpected error transitioning deal: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Lock a deal: QUOTED → LOCKED
 * Client confirms the quoted rate.
 */
export async function lockDeal(
  dealId: string,
  groupJid: string,
  input: LockDealInput
): Promise<Result<ActiveDeal>> {
  if (typeof input.lockedRate !== 'number' || input.lockedRate <= 0) {
    return err('lockedRate must be positive')
  }

  const updates: Record<string, unknown> = {
    locked_rate: input.lockedRate,
    locked_at: new Date().toISOString(),
  }

  if (input.amountBrl !== undefined) {
    if (typeof input.amountBrl !== 'number' || input.amountBrl <= 0) {
      return err('amountBrl must be positive')
    }
    updates.amount_brl = input.amountBrl
  }
  if (input.amountUsdt !== undefined) {
    if (typeof input.amountUsdt !== 'number' || input.amountUsdt <= 0) {
      return err('amountUsdt must be positive')
    }
    updates.amount_usdt = input.amountUsdt
  }

  // Optionally extend TTL on lock
  if (input.ttlSeconds !== undefined) {
    if (typeof input.ttlSeconds !== 'number' || input.ttlSeconds <= 0) {
      return err('ttlSeconds must be positive')
    }
    updates.ttl_expires_at = new Date(Date.now() + input.ttlSeconds * 1000).toISOString()
  }

  return transitionDeal(dealId, groupJid, 'locked', updates, 'deal_locked')
}

/**
 * Start computation: LOCKED → COMPUTING
 */
export async function startComputation(
  dealId: string,
  groupJid: string
): Promise<Result<ActiveDeal>> {
  return transitionDeal(dealId, groupJid, 'computing', {}, 'deal_computing')
}

/**
 * Complete computation and finalize: COMPUTING → COMPLETED
 */
export async function completeDeal(
  dealId: string,
  groupJid: string,
  input: ComputeDealInput
): Promise<Result<ActiveDeal>> {
  if (typeof input.amountBrl !== 'number' || input.amountBrl <= 0) {
    return err('amountBrl must be positive')
  }
  if (typeof input.amountUsdt !== 'number' || input.amountUsdt <= 0) {
    return err('amountUsdt must be positive')
  }

  const updates: Record<string, unknown> = {
    amount_brl: input.amountBrl,
    amount_usdt: input.amountUsdt,
  }

  return transitionDeal(dealId, groupJid, 'completed', updates, 'deal_completed')
}

/**
 * Transition to awaiting amount: LOCKED → AWAITING_AMOUNT
 * Used in simple mode when lock has no inline amount.
 */
export async function startAwaitingAmount(
  dealId: string,
  groupJid: string
): Promise<Result<ActiveDeal>> {
  return transitionDeal(dealId, groupJid, 'awaiting_amount', {}, 'deal_awaiting_amount')
}

/**
 * Reject a deal: QUOTED → REJECTED
 * Client sent "off" to decline the quoted price.
 */
export async function rejectDeal(
  dealId: string,
  groupJid: string
): Promise<Result<ActiveDeal>> {
  return transitionDeal(
    dealId,
    groupJid,
    'rejected',
    { metadata: { completion_reason: 'rejected_by_client' } },
    'deal_rejected'
  )
}

/**
 * Cancel a deal: any non-terminal state → CANCELLED
 */
export async function cancelDeal(
  dealId: string,
  groupJid: string,
  reason: 'cancelled_by_client' | 'cancelled_by_operator'
): Promise<Result<ActiveDeal>> {
  return transitionDeal(
    dealId,
    groupJid,
    'cancelled',
    { metadata: { completion_reason: reason } },
    'deal_cancelled'
  )
}

/**
 * Expire a deal: QUOTED, LOCKED, or AWAITING_AMOUNT → EXPIRED
 * Called by TTL sweeper or on-demand when deal is accessed after TTL.
 */
export async function expireDeal(
  dealId: string,
  groupJid: string
): Promise<Result<ActiveDeal>> {
  return transitionDeal(
    dealId,
    groupJid,
    'expired',
    { metadata: { completion_reason: 'expired' } },
    'deal_expired'
  )
}

/**
 * Extend TTL for an active deal.
 * Used by operators via dashboard to prevent expiration.
 */
export async function extendDealTtl(
  dealId: string,
  groupJid: string,
  additionalSeconds: number
): Promise<Result<ActiveDeal>> {
  if (typeof additionalSeconds !== 'number' || additionalSeconds <= 0) {
    return err('additionalSeconds must be positive')
  }

  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  try {
    // Load current deal
    const dealResult = await getDealById(dealId, groupJid)
    if (!dealResult.ok) return dealResult

    const deal = dealResult.data
    if (TERMINAL_STATES.includes(deal.state)) {
      return err(`Cannot extend TTL for deal in ${deal.state} state`)
    }

    const newTtl = new Date(Math.max(
      deal.ttlExpiresAt.getTime(),
      Date.now()
    ) + additionalSeconds * 1000)

    const { data, error } = await supabase
      .from('active_deals')
      .update({ ttl_expires_at: newTtl.toISOString() })
      .eq('id', dealId)
      .eq('group_jid', groupJid)
      .select()
      .single()

    if (error) return err(`Failed to extend TTL: ${error.message}`)

    const updated = rowToDeal(data as ActiveDealRow)
    clearDealsCache(groupJid)

    logger.info('Deal TTL extended', {
      event: 'deal_ttl_extended',
      dealId,
      groupJid,
      additionalSeconds,
      newTtlExpiresAt: newTtl.toISOString(),
    })

    return ok(updated)
  } catch (e) {
    return err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// ============================================================================
// TTL Sweep & Re-prompt
// ============================================================================

/** Info about an awaiting_amount deal that needs a re-prompt or expiry */
export interface AwaitingAmountDealInfo {
  id: string
  groupJid: string
  clientJid: string
  lockedRate: number | null
  quotedRate: number
  repromptedAt: Date | null
  lockedAt: Date | null
}

/**
 * Sprint 9: Find awaiting_amount deals that need re-prompt or expiry.
 * Returns deals grouped by action needed.
 */
export async function getDealsNeedingReprompt(): Promise<Result<{
  needsReprompt: AwaitingAmountDealInfo[]
  needsExpiry: AwaitingAmountDealInfo[]
}>> {
  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  try {
    const { data, error } = await supabase
      .from('active_deals')
      .select('id, group_jid, client_jid, locked_rate, quoted_rate, reprompted_at, locked_at')
      .eq('state', 'awaiting_amount')
      .limit(50)

    if (error) return err(`Failed to query awaiting_amount deals: ${error.message}`)
    if (!data || data.length === 0) return ok({ needsReprompt: [], needsExpiry: [] })

    const needsReprompt: AwaitingAmountDealInfo[] = []
    const needsExpiry: AwaitingAmountDealInfo[] = []

    for (const row of data) {
      const info: AwaitingAmountDealInfo = {
        id: row.id,
        groupJid: row.group_jid,
        clientJid: row.client_jid,
        lockedRate: row.locked_rate,
        quotedRate: row.quoted_rate,
        repromptedAt: row.reprompted_at ? new Date(row.reprompted_at) : null,
        lockedAt: row.locked_at ? new Date(row.locked_at) : null,
      }

      // Age is measured from locked_at (when the deal entered locked/awaiting state)
      const lockedAt = info.lockedAt ?? new Date()
      const ageSeconds = (Date.now() - lockedAt.getTime()) / 1000

      // We use a default timeout; the handler layer will check group-specific config
      // For classification, use a generous threshold
      if (info.repromptedAt !== null) {
        // Already reprompted — check if enough time for expiry (2× timeout)
        // The handler layer will validate against group-specific timeout
        needsExpiry.push(info)
      } else if (ageSeconds > 30) {
        // Not yet reprompted and at least 30s old — might need reprompt
        // The handler layer will validate against group-specific amount_timeout_seconds
        needsReprompt.push(info)
      }
    }

    return ok({ needsReprompt, needsExpiry })
  } catch (e) {
    return err(`Unexpected error in getDealsNeedingReprompt: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Sprint 9: Mark a deal as reprompted (set reprompted_at = NOW()).
 * Prevents double-prompts.
 */
export async function markReprompted(dealId: string): Promise<Result<void>> {
  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  const { error } = await supabase
    .from('active_deals')
    .update({ reprompted_at: new Date().toISOString() })
    .eq('id', dealId)

  if (error) return err(`Failed to mark reprompted: ${error.message}`)
  return ok(undefined)
}

/**
 * Sweep expired deals: find deals past TTL and transition to EXPIRED.
 * Should be called periodically (e.g., every 30 seconds).
 * Returns count of deals expired.
 */
export async function sweepExpiredDeals(): Promise<Result<number>> {
  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  try {
    const now = new Date().toISOString()

    // Find all expired deals in quotable/lockable/awaiting states
    const { data, error } = await supabase
      .from('active_deals')
      .select('id, group_jid')
      .in('state', ['quoted', 'locked', 'awaiting_amount'])
      .lt('ttl_expires_at', now)
      .limit(50)

    if (error) {
      logger.error('Failed to sweep expired deals', {
        event: 'deal_sweep_error',
        error: error.message,
      })
      return err(`Sweep failed: ${error.message}`)
    }

    if (!data || data.length === 0) return ok(0)

    let expiredCount = 0
    for (const row of data) {
      const result = await expireDeal(row.id, row.group_jid)
      if (result.ok) {
        expiredCount++
      } else {
        logger.warn('Failed to expire deal during sweep', {
          event: 'deal_sweep_expire_error',
          dealId: row.id,
          error: result.error,
        })
      }
    }

    if (expiredCount > 0) {
      logger.info('Deal sweep completed', {
        event: 'deal_sweep_complete',
        expired: expiredCount,
        total: data.length,
      })
    }

    return ok(expiredCount)
  } catch (e) {
    return err(`Unexpected error during sweep: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// ============================================================================
// Archival (Move to History)
// ============================================================================

/**
 * Archive a completed/expired/cancelled deal to deal_history.
 * Removes it from active_deals after copying to history.
 */
export async function archiveDeal(
  dealId: string,
  groupJid: string
): Promise<Result<DealHistoryRecord>> {
  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  try {
    // Load the deal
    const dealResult = await getDealById(dealId, groupJid)
    if (!dealResult.ok) return err(dealResult.error)

    const deal = dealResult.data
    if (!TERMINAL_STATES.includes(deal.state)) {
      return err(`Cannot archive deal in ${deal.state} state — must be completed, expired, or cancelled`)
    }

    const completionReason = typeof deal.metadata?.completion_reason === 'string'
      ? deal.metadata.completion_reason
      : deal.state === 'completed' ? 'confirmed'
      : deal.state === 'expired' ? 'expired'
      : deal.state === 'rejected' ? 'rejected_by_client'
      : null

    // Insert into deal_history
    const historyRow: Record<string, unknown> = {
      id: deal.id,
      group_jid: deal.groupJid,
      client_jid: deal.clientJid,
      final_state: deal.state,
      side: deal.side,
      quoted_rate: deal.quotedRate,
      base_rate: deal.baseRate,
      locked_rate: deal.lockedRate,
      amount_brl: deal.amountBrl,
      amount_usdt: deal.amountUsdt,
      quoted_at: deal.quotedAt.toISOString(),
      locked_at: deal.lockedAt?.toISOString() ?? null,
      completed_at: new Date().toISOString(),
      ttl_expires_at: deal.ttlExpiresAt.toISOString(),
      rule_id_used: deal.ruleIdUsed,
      rule_name: deal.ruleName,
      pricing_source: deal.pricingSource,
      spread_mode: deal.spreadMode,
      sell_spread: deal.sellSpread,
      buy_spread: deal.buySpread,
      metadata: deal.metadata,
      completion_reason: completionReason,
      created_at: deal.createdAt.toISOString(),
    }

    const { data: histData, error: histError } = await supabase
      .from('deal_history')
      .insert(historyRow)
      .select()
      .single()

    if (histError) {
      logger.error('Failed to archive deal to history', {
        event: 'deal_archive_error',
        dealId,
        error: histError.message,
      })
      return err(`Failed to archive deal: ${histError.message}`)
    }

    // Delete from active_deals
    const { data: delData, error: delError } = await supabase
      .from('active_deals')
      .delete()
      .eq('id', dealId)
      .eq('group_jid', groupJid)
      .select()

    if (delError) {
      logger.warn('Deal archived but not deleted from active_deals', {
        event: 'deal_delete_after_archive_error',
        dealId,
        error: delError.message,
      })
    } else if (!delData || delData.length === 0) {
      logger.warn('Deal archive delete found no rows', {
        event: 'deal_delete_after_archive_empty',
        dealId,
      })
    }

    clearDealsCache(groupJid)

    const historyRecord = rowToHistory(histData as DealHistoryRow)

    logger.info('Deal archived to history', {
      event: 'deal_archived',
      dealId,
      groupJid,
      finalState: deal.state,
      completionReason,
    })

    // Bronze layer: emit archive event
    emitDealEvent({
      dealId,
      groupJid,
      clientJid: deal.clientJid,
      fromState: deal.state,
      toState: 'archived',
      eventType: 'archived',
      dealSnapshot: historyRow as Record<string, unknown>,
      metadata: { completionReason },
    })

    return ok(historyRecord)
  } catch (e) {
    return err(`Unexpected error archiving deal: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// ============================================================================
// Deal History Queries
// ============================================================================

/**
 * Get deal history for a group.
 */
export async function getDealHistory(
  groupJid: string,
  limit: number = 50,
  options: { from?: Date; to?: Date } = {}
): Promise<Result<DealHistoryRecord[]>> {
  if (!groupJid) return err('groupJid is required')

  const supabase = getSupabase()
  if (!supabase) return err('Supabase not initialized')

  try {
    let query = supabase
      .from('deal_history')
      .select('*')
      .eq('group_jid', groupJid)
      .order('archived_at', { ascending: false })
      .limit(Math.min(limit, 200))

    // Sprint 5, Task 5.3: L3 tech debt - date range filter.
    // Safe to filter on archived_at: the deal_history table defines it as
    // `archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` (see migration
    // 20260205_001_active_deals.sql:139), so no NULL values can exist.
    if (options.from) {
      query = query.gte('archived_at', options.from.toISOString())
    }
    if (options.to) {
      query = query.lte('archived_at', options.to.toISOString())
    }

    const { data, error } = await query

    if (error) return err(`Failed to load deal history: ${error.message}`)

    const history = (data || []).map((row) => rowToHistory(row as DealHistoryRow))
    return ok(history)
  } catch (e) {
    return err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`)
  }
}
