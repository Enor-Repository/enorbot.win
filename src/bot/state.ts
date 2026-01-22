/**
 * Connection state tracking.
 * Tracks whether the bot is connected to WhatsApp.
 *
 * Story 3.2: Extended with pause tracking for auto-pause functionality.
 * Pause state is intentionally in-memory only - on process restart,
 * state resets to "running" (PM2 restart = fresh start).
 */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

/**
 * Operational status for auto-pause functionality (Story 3.2).
 * - running: Bot operates normally
 * - paused: Bot ignores price triggers (silent mode)
 */
export type OperationalStatus = 'running' | 'paused'

/**
 * Pause information returned by getPauseInfo().
 */
export interface PauseInfo {
  reason: string | null
  pausedAt: Date | null
}

interface BotState {
  connectionStatus: ConnectionStatus
  lastConnected: Date | null
  reconnectAttempts: number
  disconnectedAt: Date | null
  notificationSent: boolean
  // Story 3.2: Pause tracking fields
  operationalStatus: OperationalStatus
  pauseReason: string | null
  pausedAt: Date | null
  // Story 4.1: Per-group pause tracking
  pausedGroups: Set<string>
  globalPause: boolean
  // Story 4.3: Activity tracking
  messagesSentToday: number
  lastActivityAt: Date | null
  startedAt: Date
  // Story 5.4: Auth state tracking for session protection
  authStateEverLoaded: boolean
}

// In-memory state (not persisted to Supabase - that's Story 1.2)
// Story 3.2: Initialize with running state - pause is not persisted
// Story 4.1: Initialize with empty paused groups
// Story 4.3: Initialize activity tracking
const state: BotState = {
  connectionStatus: 'disconnected',
  lastConnected: null,
  reconnectAttempts: 0,
  disconnectedAt: null,
  notificationSent: false,
  operationalStatus: 'running',
  pauseReason: null,
  pausedAt: null,
  pausedGroups: new Set<string>(),
  globalPause: false,
  messagesSentToday: 0,
  lastActivityAt: null,
  startedAt: new Date(),
  authStateEverLoaded: false,
}

export function getConnectionStatus(): ConnectionStatus {
  return state.connectionStatus
}

export function setConnectionStatus(status: ConnectionStatus): void {
  state.connectionStatus = status
  if (status === 'connected') {
    state.lastConnected = new Date()
    state.reconnectAttempts = 0
    state.disconnectedAt = null
    state.notificationSent = false
  } else if (status === 'disconnected') {
    // Only set disconnectedAt on FIRST disconnect, not on subsequent reconnect failures
    // This ensures duration accumulates across reconnect attempts for notification threshold
    if (state.disconnectedAt === null) {
      state.disconnectedAt = new Date()
    }
  }
}

export function incrementReconnectAttempts(): number {
  state.reconnectAttempts += 1
  return state.reconnectAttempts
}

/**
 * Get a readonly snapshot of the current bot state.
 * Returns a deep copy to prevent external mutation of Set/Map.
 */
export function getState(): Readonly<BotState> {
  return {
    ...state,
    // Deep copy the Set to prevent external mutation
    pausedGroups: new Set(state.pausedGroups),
  }
}

export function getDisconnectedDuration(): number | null {
  if (!state.disconnectedAt) {
    return null
  }
  return Date.now() - state.disconnectedAt.getTime()
}

export function setNotificationSent(sent: boolean): void {
  state.notificationSent = sent
}

// =============================================================================
// Story 3.2: Pause State Functions
// =============================================================================

/**
 * Get the current operational status.
 *
 * @returns Current operational status ('running' | 'paused')
 */
export function getOperationalStatus(): OperationalStatus {
  return state.operationalStatus
}

/**
 * Set the bot to paused state.
 * Called when auto-pause is triggered on critical error.
 *
 * @param reason - Human-readable reason for pause (e.g., "Binance API failures (3 consecutive)")
 */
export function setPaused(reason: string): void {
  state.operationalStatus = 'paused'
  state.pauseReason = reason
  state.pausedAt = new Date()
}

/**
 * Set the bot back to running state.
 * Clears pause reason and timestamp.
 * Used by Story 3.3 (auto-recovery) and Epic 4 (manual resume).
 */
export function setRunning(): void {
  state.operationalStatus = 'running'
  state.pauseReason = null
  state.pausedAt = null
}

/**
 * Get current pause information.
 * Useful for status display (Story 4.3).
 *
 * @returns Object with reason and pausedAt timestamp
 */
export function getPauseInfo(): PauseInfo {
  return {
    reason: state.pauseReason,
    pausedAt: state.pausedAt,
  }
}

// =============================================================================
// Story 4.1: Per-Group Pause Functions
// =============================================================================

/**
 * Pause a specific group.
 *
 * @param groupId - The JID of the group to pause
 */
export function pauseGroup(groupId: string): void {
  state.pausedGroups.add(groupId)
}

/**
 * Check if a specific group is paused.
 * Checks both per-group pause and global pause.
 *
 * @param groupId - The JID of the group to check
 * @returns true if the group is paused (individually or globally)
 */
export function isGroupPaused(groupId: string): boolean {
  return state.globalPause || state.pausedGroups.has(groupId)
}

/**
 * Pause all groups (global pause).
 * Sets globalPause flag to true.
 */
export function pauseAllGroups(): void {
  state.globalPause = true
}

/**
 * Get set of paused group IDs.
 * Returns a copy to prevent external mutation.
 * Useful for status display (Story 4.3).
 *
 * @returns Copy of the paused groups set
 */
export function getPausedGroups(): Set<string> {
  return new Set(state.pausedGroups)
}

/**
 * Check if global pause is active.
 * Useful for status display (Story 4.3).
 *
 * @returns true if global pause is active
 */
export function isGlobalPauseActive(): boolean {
  return state.globalPause
}

/**
 * Resume a specific group.
 * Used by Story 4.2.
 *
 * @param groupId - The JID of the group to resume
 * @returns true if the group was paused and is now resumed, false if it wasn't paused
 */
export function resumeGroup(groupId: string): boolean {
  if (!state.pausedGroups.has(groupId)) {
    return false
  }
  state.pausedGroups.delete(groupId)
  return true
}

/**
 * Resume all groups (clear global pause and per-group pauses).
 * Used by Story 4.2.
 */
export function resumeAllGroups(): void {
  state.pausedGroups.clear()
  state.globalPause = false
}

/**
 * Reset per-group pause state.
 * Used for testing.
 */
export function resetPauseState(): void {
  state.pausedGroups.clear()
  state.globalPause = false
}

// =============================================================================
// Story 4.3: Activity Tracking Functions
// =============================================================================

/**
 * Activity statistics for status command.
 */
export interface ActivityStats {
  messagesSentToday: number
  lastActivityAt: Date | null
  startedAt: Date
  uptimeMs: number
}

/**
 * Record a message sent to a group.
 * Called after successful price response.
 *
 * @param _groupId - The JID of the group (for future per-group tracking)
 */
export function recordMessageSent(_groupId: string): void {
  state.messagesSentToday++
  state.lastActivityAt = new Date()
}

/**
 * Get activity statistics.
 *
 * @returns Activity stats including message count, last activity, and uptime
 */
export function getActivityStats(): ActivityStats {
  return {
    messagesSentToday: state.messagesSentToday,
    lastActivityAt: state.lastActivityAt,
    startedAt: state.startedAt,
    uptimeMs: Date.now() - state.startedAt.getTime(),
  }
}

/**
 * Reset daily statistics.
 * Called on process restart or midnight reset.
 */
export function resetDailyStats(): void {
  state.messagesSentToday = 0
  // Note: lastActivityAt is NOT reset - it tracks the most recent activity
}

/**
 * Reset activity state for testing.
 */
export function resetActivityState(): void {
  state.messagesSentToday = 0
  state.lastActivityAt = null
  state.startedAt = new Date()
}

// =============================================================================
// Story 5.4: Auth State Tracking for Session Protection
// =============================================================================

/**
 * Mark that auth state has been successfully loaded at least once.
 * Called when auth state is restored from Supabase or local backup.
 *
 * This flag is used to prevent re-pairing when database connectivity
 * is lost - if we ever had valid auth, we should wait for recovery
 * rather than generating a new pairing code.
 */
export function setAuthStateLoaded(): void {
  state.authStateEverLoaded = true
}

/**
 * Check if auth state was ever successfully loaded.
 * Returns true if setAuthStateLoaded() was called at any point.
 *
 * Used to distinguish between:
 * - Fresh install (never had auth) → OK to request pairing code
 * - Lost session (had auth, now lost) → Wait for database recovery
 */
export function wasAuthStateEverLoaded(): boolean {
  return state.authStateEverLoaded
}

/**
 * Reset auth state tracking for testing.
 */
export function resetAuthStateTracking(): void {
  state.authStateEverLoaded = false
}
