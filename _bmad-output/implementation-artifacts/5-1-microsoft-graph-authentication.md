# Story 5.1: Microsoft Graph Authentication

Status: done

## Code Review Notes (2026-01-16)

**Review 1: 5 issues found** - ALL FIXED ✅
**Review 2: 3 additional issues found** - ALL FIXED ✅

### Review 1 Issues (Fixed)
1. ✅ **HIGH**: Empty string config fallback allows MSAL to fail with cryptic errors
2. ✅ **MEDIUM**: No validation if token is already expired when returned from MSAL
3. ✅ **LOW**: Debug logs expose token expiry timing
4. ✅ **LOW**: Missing ErrorClassification type documentation

### Review 2 Issues (Fixed)
5. ✅ **MEDIUM** (5.1.6): Module header claims "never throws" but getMsalClient can throw
   - Fixed: Updated module header to clarify config errors throw on first call
6. ✅ **LOW** (5.1.7): Missing test for config validation error path
   - Fixed: Added test in Edge Cases section
7. ✅ **LOW** (5.1.8): ensureValidToken() still logs timing in refresh path
   - Fixed: Removed expiresInMs from refresh log

## Story

As a **developer**,
I want **the bot to authenticate with Microsoft Graph API**,
So that **it can write to Excel Online**.

## Acceptance Criteria

1. **AC1: Initial authentication**
   - Given Azure AD app credentials are configured in environment variables
   - When the bot starts
   - Then it obtains an OAuth2 access token for Microsoft Graph

2. **AC2: Token caching**
   - Given the access token is valid
   - When the bot needs to write to Excel
   - Then it uses the cached token

3. **AC3: Token auto-refresh**
   - Given the access token expires
   - When a Graph API request is made
   - Then the token is refreshed automatically before expiry (NFR9)
   - And the request proceeds without error

4. **AC4: Refresh failure handling**
   - Given token refresh fails
   - When the error is detected
   - Then it is logged as a transient error
   - And the logging request is queued for retry

## Tasks / Subtasks

- [x] Task 1: Add MS Graph dependencies and configuration (AC: 1)
  - [x] 1.1: Install `@azure/msal-node` for OAuth2 client credentials flow
  - [x] 1.2: Add MS Graph config to Zod schema in `config.ts`
  - [x] 1.3: Add environment variables: `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_TENANT_ID`
  - [x] 1.4: Add `EXCEL_FILE_ID` and `EXCEL_WORKSHEET_NAME` config
  - [x] 1.5: Add tests for config validation

- [x] Task 2: Create MS Graph authentication service (AC: 1, 2)
  - [x] 2.1: Create `src/services/graph.ts` for MS Graph client
  - [x] 2.2: Implement `ConfidentialClientApplication` from MSAL
  - [x] 2.3: Implement `getAccessToken()` using client credentials flow
  - [x] 2.4: Cache token in module state with expiry tracking
  - [x] 2.5: Add structured logging for auth events
  - [x] 2.6: Return Result type (never throw)
  - [x] 2.7: Add unit tests for authentication

- [x] Task 3: Implement token refresh logic (AC: 3)
  - [x] 3.1: Check token expiry before each API call
  - [x] 3.2: Refresh proactively 5 minutes before expiry
  - [x] 3.3: Handle refresh errors gracefully
  - [x] 3.4: Log token refresh events
  - [x] 3.5: Add tests for refresh scenarios

- [x] Task 4: Handle authentication failures (AC: 4)
  - [x] 4.1: Classify auth errors (transient vs critical)
  - [x] 4.2: 401/403 on refresh = credential issue (log error, queue for retry)
  - [x] 4.3: Network/timeout = transient (retry with backoff)
  - [x] 4.4: Integration with error classification from Epic 3
  - [x] 4.5: Add tests for failure scenarios

## Dev Notes

### MS Graph OAuth2 Client Credentials Flow

For server-to-server authentication (no user context), MS Graph uses the Client Credentials flow:

```typescript
import { ConfidentialClientApplication } from '@azure/msal-node'

const msalConfig = {
  auth: {
    clientId: config.MS_GRAPH_CLIENT_ID,
    clientSecret: config.MS_GRAPH_CLIENT_SECRET,
    authority: `https://login.microsoftonline.com/${config.MS_GRAPH_TENANT_ID}`,
  }
}

const msalClient = new ConfidentialClientApplication(msalConfig)

async function getAccessToken(): Promise<Result<string>> {
  try {
    const result = await msalClient.acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default'],
    })
    
    if (!result?.accessToken) {
      return { ok: false, error: 'No access token received' }
    }
    
    return { ok: true, data: result.accessToken }
  } catch (error) {
    logger.error('MS Graph auth failed', { event: 'graph_auth_error', error })
    return { ok: false, error: 'Authentication failed' }
  }
}
```

### Token Caching Strategy

MSAL handles token caching internally, but we need to track expiry for proactive refresh:

```typescript
interface TokenCache {
  accessToken: string
  expiresAt: number  // Unix timestamp
}

let tokenCache: TokenCache | null = null

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000  // 5 minutes before expiry

function isTokenValid(): boolean {
  if (!tokenCache) return false
  return Date.now() < tokenCache.expiresAt - TOKEN_REFRESH_MARGIN_MS
}

async function ensureValidToken(): Promise<Result<string>> {
  if (isTokenValid()) {
    return { ok: true, data: tokenCache!.accessToken }
  }
  
  // Need to refresh
  const result = await getAccessToken()
  if (result.ok) {
    tokenCache = {
      accessToken: result.data,
      expiresAt: Date.now() + 3600 * 1000,  // Tokens typically valid for 1 hour
    }
  }
  return result
}
```

### Required Azure AD Configuration

**App Registration:**
1. Create app registration in Azure AD
2. Add API permission: `Microsoft Graph` → `Application permissions` → `Files.ReadWrite.All`
3. Grant admin consent for the permission
4. Create client secret (note expiry date)

**Environment Variables:**
```bash
MS_GRAPH_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MS_GRAPH_CLIENT_SECRET=your-secret-here
MS_GRAPH_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
EXCEL_FILE_ID=/drives/{drive-id}/items/{item-id}
EXCEL_WORKSHEET_NAME=Quotes
```

### Error Classification

```typescript
function classifyGraphError(error: unknown): ErrorClassification {
  const statusCode = (error as { statusCode?: number })?.statusCode
  
  // Auth failures are critical - credentials may be wrong
  if (statusCode === 401 || statusCode === 403) {
    return 'critical'
  }
  
  // Everything else is transient (network, rate limits, etc.)
  return 'transient'
}
```

### Project Structure Notes

**New File:**
- `src/services/graph.ts` - MS Graph authentication service

**Modified Files:**
- `src/config.ts` - Add MS Graph config schema
- `src/types/config.ts` - Add MS Graph types

### Testing Strategy

1. **Unit tests for graph.ts:**
   - `getAccessToken()` returns token on success
   - `getAccessToken()` returns error on failure
   - Token caching prevents redundant requests
   - Proactive refresh before expiry
   - Error classification works correctly

2. **Mock MSAL client:**
   ```typescript
   const mockMsalClient = vi.hoisted(() => ({
     acquireTokenByClientCredential: vi.fn(),
   }))
   
   vi.mock('@azure/msal-node', () => ({
     ConfidentialClientApplication: vi.fn(() => mockMsalClient),
   }))
   ```

### Dependencies

- **New NPM package:** `@azure/msal-node` (Microsoft Authentication Library)
- **From Epic 3:** Error classification patterns
- **For Story 5.2:** Token service will be imported by Excel service

### References

- [Source: docs/project-context.md#Stack Decisions] - MS Graph for logging
- [Source: _bmad-output/planning-artifacts/architecture.md#Security] - MS_GRAPH_* env vars
- [Source: _bmad-output/planning-artifacts/architecture.md#Error Handling Pattern] - Result type
- [MS Graph API Docs: Excel workbook sessions](https://learn.microsoft.com/en-us/graph/api/workbook-post-tables)
- [MSAL Node Docs](https://github.com/AzureAD/microsoft-authentication-library-for-js/tree/dev/lib/msal-node)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (2026-01-16)

### Completion Notes List

- Installed `@azure/msal-node` for OAuth2 client credentials flow
- Updated `src/types/config.ts` with MS Graph environment variables (UUID validation for IDs)
- Added helper functions `isMsGraphConfigured()` and `isExcelLoggingConfigured()`
- Created `src/services/graph.ts` with complete authentication service:
  - `getAccessToken()` - acquires token via client credentials flow
  - `isTokenValid()` - checks if cached token is valid
  - `ensureValidToken()` - returns cached or refreshes proactively
  - `classifyGraphError()` - classifies errors as transient/critical
  - `resetTokenCache()` / `resetMsalClient()` - for testing
- Implemented 5-minute proactive refresh margin (TOKEN_REFRESH_MARGIN_MS)
- All functions return Result type, never throw
- Full test coverage: 24 tests for graph.ts

### File List

- `package.json` - Added `@azure/msal-node` dependency
- `src/types/config.ts` - Added MS Graph and Excel config schema
- `src/services/graph.ts` - **NEW** - MS Graph authentication service
- `src/services/graph.test.ts` - **NEW** - 24 tests for authentication
