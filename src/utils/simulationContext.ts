/**
 * Simulation Context — AsyncLocalStorage-based isolation for the simulator.
 *
 * When a request runs inside `runInSimulation()`, all downstream code can
 * check `isSimulation()` and:
 * - Skip Supabase writes (logBotMessage, emitDealEvent, etc.)
 * - Skip Excel logging
 * - Use an in-memory deal store instead of the real `active_deals` table
 *
 * This ensures the simulator NEVER pollutes production state, while still
 * letting the deal state machine work correctly for replay accuracy.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { ActiveDeal, DealState, DealHistoryRecord } from '../services/dealFlowService.js'

// ============================================================================
// Storage
// ============================================================================

interface SimulationStore {
  /** In-memory deal store: dealId → ActiveDeal */
  deals: Map<string, ActiveDeal>
}

const storage = new AsyncLocalStorage<SimulationStore>()

// ============================================================================
// Public API
// ============================================================================

/**
 * Run a function within simulation context.
 * All deal operations will use in-memory storage; all logging is skipped.
 */
export function runInSimulation<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ deals: new Map() }, fn)
}

/** Check if the current execution context is inside a simulation. */
export function isSimulation(): boolean {
  return storage.getStore() !== undefined
}

/** Get the in-memory deal store (null if not in simulation). */
export function getSimulationDeals(): Map<string, ActiveDeal> | null {
  return storage.getStore()?.deals ?? null
}

// ============================================================================
// In-Memory Deal Operations (used by dealFlowService in simulation mode)
// ============================================================================

/** Column-name-to-property mapping for applying DB-style updates to ActiveDeal objects */
const COL_TO_PROP: Record<string, keyof ActiveDeal> = {
  state: 'state',
  locked_rate: 'lockedRate',
  locked_at: 'lockedAt',
  amount_brl: 'amountBrl',
  amount_usdt: 'amountUsdt',
  ttl_expires_at: 'ttlExpiresAt',
  reprompted_at: 'repromptedAt',
}

/** Date fields that need string → Date conversion */
const DATE_FIELDS = new Set(['locked_at', 'ttl_expires_at', 'reprompted_at'])

/**
 * Apply snake_case DB-column updates to a camelCase ActiveDeal object.
 * Used by the simulated transitionDeal.
 */
export function applyUpdatesToDeal(deal: ActiveDeal, updates: Record<string, unknown>): void {
  for (const [col, value] of Object.entries(updates)) {
    if (col === 'metadata' && typeof value === 'object' && value !== null) {
      deal.metadata = { ...deal.metadata, ...(value as Record<string, unknown>) }
      continue
    }
    const prop = COL_TO_PROP[col]
    if (prop) {
      if (DATE_FIELDS.has(col)) {
        (deal as any)[prop] = value ? new Date(value as string) : null
      } else {
        (deal as any)[prop] = value
      }
    }
  }
  deal.updatedAt = new Date()
}

/** Generate a unique deal ID for simulated deals. */
export function generateSimDealId(): string {
  return `sim-${randomUUID()}`
}
