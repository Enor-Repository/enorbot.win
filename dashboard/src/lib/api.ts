/**
 * API Configuration
 * Centralizes API URL configuration to avoid hardcoded localhost
 */

// Use environment variable or fallback to localhost for development
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3003'

/**
 * API Endpoints
 * Type-safe API endpoint generator
 */
export const API_ENDPOINTS = {
  /** Get all groups */
  groups: `${API_BASE_URL}/api/groups`,
  /** Update group mode */
  groupMode: (jid: string): string => `${API_BASE_URL}/api/groups/${jid}/mode`,
  /** Get all rules */
  rules: `${API_BASE_URL}/api/rules`,
  /** Get/Update/Delete specific rule by ID */
  rule: (id: string): string => `${API_BASE_URL}/api/rules/${id}`,
  /** Get rules for specific group */
  groupRules: (groupJid: string): string => `${API_BASE_URL}/api/rules?groupJid=${groupJid}`,
  /** Get players for specific group */
  groupPlayers: (groupJid: string): string => `${API_BASE_URL}/api/groups/${groupJid}/players`,
  /** Update player role */
  playerRole: (groupJid: string, playerJid: string): string => `${API_BASE_URL}/api/groups/${groupJid}/players/${playerJid}/role`,
} as const

/**
 * Type guards for API endpoint validation
 */
export type APIEndpoint = typeof API_ENDPOINTS
export type APIEndpointKey = keyof APIEndpoint
