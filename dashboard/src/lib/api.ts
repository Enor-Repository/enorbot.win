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
  /** @deprecated Sprint 6: Old rules system — kept for rollback safety net only. Use groupTriggers instead. */
  rules: `${API_BASE_URL}/api/rules`,
  /** @deprecated Sprint 6: Old rules system — kept for rollback safety net only. */
  rule: (id: string): string => `${API_BASE_URL}/api/rules/${id}`,
  /** @deprecated Sprint 6: Old rules system — kept for rollback safety net only. */
  groupRules: (groupJid: string): string => `${API_BASE_URL}/api/rules?groupJid=${groupJid}`,
  /** Get players for specific group */
  groupPlayers: (groupJid: string): string => `${API_BASE_URL}/api/groups/${groupJid}/players`,
  /** Update player role */
  playerRole: (groupJid: string, playerJid: string): string => `${API_BASE_URL}/api/groups/${groupJid}/players/${playerJid}/role`,
  /** @deprecated Sprint 6: Old rules system — kept for rollback safety net only. */
  testRule: `${API_BASE_URL}/api/rules/test`,
  /** Cost summary (period=day|week|month) */
  costSummary: (period?: string): string =>
    `${API_BASE_URL}/api/costs/summary${period ? `?period=${period}` : ''}`,
  /** Cost breakdown by group */
  costByGroup: `${API_BASE_URL}/api/costs/by-group`,
  /** Cost trend over time (days=30) */
  costTrend: (days?: number): string =>
    `${API_BASE_URL}/api/costs/trend${days ? `?days=${days}` : ''}`,
  /** Get all spread configs */
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
  /** Sprint 4: Get active deals for a group */
  groupDeals: (groupJid: string): string =>
    `${API_BASE_URL}/api/groups/${encodeURIComponent(groupJid)}/deals`,
  /** Sprint 4: Get all deals for a group (including terminal) */
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
} as const

/**
 * Type guards for API endpoint validation
 */
export type APIEndpoint = typeof API_ENDPOINTS
export type APIEndpointKey = keyof APIEndpoint
