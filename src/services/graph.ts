/**
 * MS Graph Authentication Service (Story 5.1)
 *
 * Provides OAuth2 client credentials flow authentication for MS Graph API.
 * Used by Excel logging service (Story 5.2) to write quote logs.
 *
 * Key features:
 * - Token caching with proactive refresh
 * - Error classification (transient vs critical)
 * - Result type pattern for public functions (API errors returned, not thrown)
 *
 * Note: Config validation errors throw on first call if MS_GRAPH_* env vars are missing.
 * This is intentional to fail fast during initialization rather than silently failing.
 *
 * Exports:
 * - getAccessToken(): Get fresh token from Azure AD (throws if not configured)
 * - ensureValidToken(): Get cached or fresh token (throws if not configured)
 * - isTokenValid(): Check if cached token is still valid
 * - classifyGraphError(): Classify errors as 'transient' or 'critical'
 * - ErrorClassification: Type for error classification ('transient' | 'critical')
 * - TOKEN_REFRESH_MARGIN_MS: Token refresh margin constant (5 minutes)
 */
import { ConfidentialClientApplication, type Configuration } from '@azure/msal-node'
import { ok, err, type Result } from '../utils/result.js'
import { logger } from '../utils/logger.js'
import { getConfig } from '../config.js'

// =============================================================================
// Constants
// =============================================================================

/**
 * Refresh token 5 minutes before expiry (NFR9).
 */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000

/**
 * Default token validity if not provided by MSAL (1 hour).
 */
const DEFAULT_TOKEN_VALIDITY_MS = 60 * 60 * 1000

/**
 * MS Graph API scope for application permissions.
 */
const GRAPH_SCOPES = ['https://graph.microsoft.com/.default']

// =============================================================================
// Types
// =============================================================================

/**
 * Token cache entry with expiry tracking.
 */
interface TokenCache {
  accessToken: string
  expiresAt: number // Unix timestamp in ms
}

/**
 * Error classification for retry logic.
 */
export type ErrorClassification = 'transient' | 'critical'

// =============================================================================
// Module State
// =============================================================================

/**
 * Cached token with expiry.
 */
let tokenCache: TokenCache | null = null

/**
 * MSAL client singleton - initialized lazily.
 */
let msalClient: ConfidentialClientApplication | null = null

// =============================================================================
// Private Functions
// =============================================================================

/**
 * Initialize MSAL client with Azure AD credentials.
 * Lazy initialization to avoid errors when MS Graph is not configured.
 *
 * @throws Error if MS Graph is not configured (missing required env vars)
 */
function getMsalClient(): ConfidentialClientApplication {
  if (msalClient) {
    return msalClient
  }

  const config = getConfig()

  // Validate required config before creating client (Issue 5.1.1 fix)
  if (!config.MS_GRAPH_CLIENT_ID || !config.MS_GRAPH_CLIENT_SECRET || !config.MS_GRAPH_TENANT_ID) {
    const missing: string[] = []
    if (!config.MS_GRAPH_CLIENT_ID) missing.push('MS_GRAPH_CLIENT_ID')
    if (!config.MS_GRAPH_CLIENT_SECRET) missing.push('MS_GRAPH_CLIENT_SECRET')
    if (!config.MS_GRAPH_TENANT_ID) missing.push('MS_GRAPH_TENANT_ID')

    logger.error('MS Graph not configured', {
      event: 'graph_config_error',
      missing,
    })
    throw new Error(`MS Graph not configured: missing ${missing.join(', ')}`)
  }

  const msalConfig: Configuration = {
    auth: {
      clientId: config.MS_GRAPH_CLIENT_ID,
      clientSecret: config.MS_GRAPH_CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${config.MS_GRAPH_TENANT_ID}`,
    },
  }

  msalClient = new ConfidentialClientApplication(msalConfig)
  return msalClient
}

// =============================================================================
// Public Functions
// =============================================================================

/**
 * Get access token from Azure AD using client credentials flow.
 *
 * AC1: Initial authentication
 *
 * @returns Promise<Result<string>> - ok(token) on success, err(message) on failure
 */
export async function getAccessToken(): Promise<Result<string>> {
  try {
    const client = getMsalClient()

    const result = await client.acquireTokenByClientCredential({
      scopes: GRAPH_SCOPES,
    })

    if (!result?.accessToken) {
      logger.error('MS Graph auth returned no token', {
        event: 'graph_auth_error',
        reason: 'no_token',
      })
      return err('No access token received from Azure AD')
    }

    // Cache the token with expiry
    const expiresAt = result.expiresOn
      ? result.expiresOn.getTime()
      : Date.now() + DEFAULT_TOKEN_VALIDITY_MS

    // Issue 5.1.2 fix: Validate token isn't already expired
    const expiresInMs = expiresAt - Date.now()
    if (expiresInMs <= 0) {
      logger.error('MS Graph returned already-expired token', {
        event: 'graph_auth_error',
        reason: 'token_already_expired',
        expiresAt,
      })
      return err('Received already-expired token from Azure AD')
    }

    tokenCache = {
      accessToken: result.accessToken,
      expiresAt,
    }

    logger.info('MS Graph authentication successful', {
      event: 'graph_auth_success',
      expiresInMs,
      expiresInMinutes: Math.round(expiresInMs / 60000),
    })

    return ok(result.accessToken)
  } catch (error) {
    logger.error('MS Graph authentication failed', {
      event: 'graph_auth_error',
      error: error instanceof Error ? error.message : String(error),
    })

    return err('Authentication failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
  }
}

/**
 * Check if cached token is valid (not expired and not within refresh margin).
 *
 * AC2: Token caching
 *
 * @returns boolean - true if token is valid and not near expiry
 */
export function isTokenValid(): boolean {
  if (!tokenCache) {
    return false
  }

  // Token is invalid if within refresh margin of expiry
  return Date.now() < tokenCache.expiresAt - TOKEN_REFRESH_MARGIN_MS
}

/**
 * Ensure we have a valid token, refreshing proactively if needed.
 *
 * AC2: Token caching - returns cached token if valid
 * AC3: Token auto-refresh - refreshes proactively before expiry
 *
 * @returns Promise<Result<string>> - ok(token) on success, err(message) on failure
 */
export async function ensureValidToken(): Promise<Result<string>> {
  // If token is valid, return cached
  if (isTokenValid() && tokenCache) {
    // Issue 5.1.4 fix: Don't log token timing details
    logger.debug('Using cached MS Graph token', {
      event: 'graph_token_cache_hit',
    })
    return ok(tokenCache.accessToken)
  }

  // Need to refresh
  const hadToken = tokenCache !== null

  if (hadToken) {
    // Issue 5.1.8 fix: Don't log token timing details
    logger.info('Proactively refreshing MS Graph token', {
      event: 'graph_token_refresh',
      reason: 'expiry_approaching',
    })
  }

  return getAccessToken()
}

/**
 * Classify MS Graph API error for retry logic.
 *
 * AC4: Refresh failure handling
 *
 * - 401/403: Critical (credential issue, stop retrying)
 * - 5xx/429/network: Transient (retry with backoff)
 *
 * @param error - The error to classify
 * @returns ErrorClassification - 'transient' or 'critical'
 */
export function classifyGraphError(error: unknown): ErrorClassification {
  const statusCode = (error as { statusCode?: number })?.statusCode

  let classification: ErrorClassification = 'transient'

  // Auth failures are critical - credentials may be wrong or revoked
  if (statusCode === 401 || statusCode === 403) {
    classification = 'critical'
  }

  // Everything else is transient (network, rate limits, 5xx, etc.)

  logger.warn('MS Graph error classified', {
    event: 'graph_error_classified',
    classification,
    source: 'graph',
    statusCode,
    errorMessage: error instanceof Error ? error.message : String(error),
  })

  return classification
}

/**
 * Reset token cache.
 * Used for testing and when credentials are updated.
 */
export function resetTokenCache(): void {
  tokenCache = null
}

/**
 * Reset MSAL client.
 * Used for testing to reinitialize with different config.
 */
export function resetMsalClient(): void {
  msalClient = null
  tokenCache = null
}
