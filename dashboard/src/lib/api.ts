/**
 * API Configuration
 * Centralizes API URL configuration to avoid hardcoded localhost
 */

// Use environment variable or fallback to localhost for development
export const API_BASE_URL = import.meta.env.VITE_API_URL || ''

/**
 * API Endpoints
 * Type-safe API endpoint generator
 */
export const API_ENDPOINTS = {
  /** Get all groups */
  groups: `${API_BASE_URL}/api/groups`,
  /** Update group mode */
  groupMode: (jid: string): string => `${API_BASE_URL}/api/groups/${jid}/mode`,
  /** Get group config (D.11/D.12) */
  groupConfig: (jid: string): string => `${API_BASE_URL}/api/groups/${jid}/config`,
  /** Update AI threshold (D.12) */
  groupThreshold: (jid: string): string => `${API_BASE_URL}/api/groups/${jid}/threshold`,
  /** Get players for specific group */
  groupPlayers: (groupJid: string): string => `${API_BASE_URL}/api/groups/${groupJid}/players`,
  /** Update player role */
  playerRole: (groupJid: string, playerJid: string): string => `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/players/${encodeURIComponent(playerJid)}/role`,
  /** Cost summary (period=day|week|month) */
  costSummary: (period?: string): string =>
    `${API_BASE_URL}/api/costs/summary${period ? `?period=${period}` : ''}`,
  /** Cost breakdown by group */
  costByGroup: (period?: string): string =>
    `${API_BASE_URL}/api/costs/by-group${period ? `?period=${period}` : ''}`,
  /** Cost trend over time (days=30) */
  costTrend: (days?: number): string =>
    `${API_BASE_URL}/api/costs/trend${days ? `?days=${days}` : ''}`,
  /** Get all spread configs — not currently used by any component */
  spreads: `${API_BASE_URL}/api/spreads`,
  /** Get/Update spread config for specific group */
  groupSpread: (groupJid: string): string => `${API_BASE_URL}/api/spreads/${encodeURIComponent(groupJid)}`,
  /** Preview spread calculation */
  spreadPreview: `${API_BASE_URL}/api/spreads/preview`,
  /** Get all time-based rules for a group */
  groupTimeRules: (groupJid: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/rules`,
  /** Get the currently active time-based rule for a group */
  groupActiveRule: (groupJid: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/rules/active`,
  /** Get/Update/Delete a specific time-based rule */
  groupTimeRule: (groupJid: string, ruleId: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/rules/${ruleId}`,
  /** Get all triggers for a group */
  groupTriggers: (groupJid: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/triggers`,
  /** Get/Update/Delete a specific trigger */
  groupTrigger: (groupJid: string, triggerId: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/triggers/${triggerId}`,
  /** Test a message against a group's triggers */
  groupTriggerTest: (groupJid: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/triggers/test`,
  /** Seed default triggers for a group */
  groupTriggerSeed: (groupJid: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/seed`,
  /** Reconcile required system triggers for a group */
  groupSystemTriggerReconcile: (groupJid: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/system-triggers/reconcile`,
  /** System status */
  status: `${API_BASE_URL}/api/status`,
  /** Current USDT/BRL price */
  priceUsdtBrl: `${API_BASE_URL}/api/prices/usdt-brl`,
  /** SSE stream for real-time USDT/BRL prices */
  priceStream: `${API_BASE_URL}/api/prices/stream`,
  /** SSE stream status */
  priceStreamStatus: `${API_BASE_URL}/api/prices/stream/status`,
  /** Get/Update volatility config for specific group */
  groupVolatility: (groupJid: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/volatility`,
  /** Get active escalations for a group */
  groupEscalations: (groupJid: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/escalations`,
  /** Dismiss an escalation */
  groupEscalationDismiss: (groupJid: string, escalationId: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/escalations/${escalationId}/dismiss`,
  /** Get active quote for a group (for threshold line baseline) */
  groupQuote: (groupJid: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/quote`,
  /** Get all active quotes */
  quotes: `${API_BASE_URL}/api/quotes`,
  /** Activity heatmap for a group */
  analyticsHeatmap: (groupId: string, days?: number): string =>
    `${API_BASE_URL}/api/groups/${groupId}/analytics/heatmap${days ? `?days=${days}` : ''}`,
  /** Player leaderboard for a group */
  analyticsPlayers: (groupId: string, limit?: number): string =>
    `${API_BASE_URL}/api/groups/${groupId}/analytics/players${limit ? `?limit=${limit}` : ''}`,
  /** Sprint 4: Get active deals for a group */
  groupDeals: (groupJid: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/deals`,
  /** Sprint 4: Get all deals for a group (including terminal) — not currently used by any component */
  groupDealsAll: (groupJid: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/deals/all`,
  /** Sprint 4: Get deal history for a group */
  groupDealHistory: (groupJid: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/deals/history`,
  /** Sprint 4: Cancel a deal */
  groupDealCancel: (groupJid: string, dealId: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/deals/${dealId}/cancel`,
  /** Sprint 4: Extend deal TTL */
  groupDealExtend: (groupJid: string, dealId: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/deals/${dealId}/extend`,
  /** Sprint 4: Trigger manual deal sweep */
  groupDealSweep: (groupJid: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/deals/sweep`,
  /** Clone ruleset from source group to target group */
  cloneRuleset: (targetGroupJid: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(targetGroupJid)}/clone-ruleset`,
  /** Simulator: list groups */
  simulatorGroups: `${API_BASE_URL}/api/simulator/groups`,
  /** Simulator: send message */
  simulatorSend: `${API_BASE_URL}/api/simulator/send`,
  /** Simulator: replay history through pipeline */
  simulatorReplay: `${API_BASE_URL}/api/simulator/replay`,
  /** Simulator: message history for a group */
  simulatorHistory: (groupJid: string): string =>
    `${API_BASE_URL}/api/simulator/history/${encodeURIComponent(groupJid)}`,
} as const

/**
 * Type guards for API endpoint validation
 */
export type APIEndpoint = typeof API_ENDPOINTS
export type APIEndpointKey = keyof APIEndpoint

// ============================================================================
// Clone Ruleset Types
// ============================================================================

/** Request body for clone ruleset */
export interface CloneRulesetRequest {
  sourceGroupJid: string
  cloneTriggers?: boolean
  cloneRules?: boolean
  cloneSpreads?: boolean
}

/** Per-category clone counts */
export interface CloneCategoryCounts {
  created: number
  updated: number
  skipped: number
}

/** Response from clone ruleset endpoint */
export interface CloneRulesetResponse {
  success: boolean
  triggers: CloneCategoryCounts
  rules: CloneCategoryCounts
  spreads: { updated: boolean }
}

/**
 * Dashboard auth secret from build-time env var.
 * Sent as X-Dashboard-Key header on all write requests.
 *
 * NOTE: This value is embedded in the JS bundle at build time. It is NOT
 * a true secret — anyone with browser DevTools can read it. The header
 * acts as an accidental-write guard, not as a security boundary. For
 * proper auth, replace with session-based authentication (Sprint 7B+).
 */
const DASHBOARD_SECRET = import.meta.env.VITE_DASHBOARD_SECRET || ''

/**
 * Returns headers object for write requests (POST/PUT/DELETE).
 * Includes Content-Type and auth header if configured.
 */
export function writeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (DASHBOARD_SECRET) {
    headers['X-Dashboard-Key'] = DASHBOARD_SECRET
  }
  return headers
}
