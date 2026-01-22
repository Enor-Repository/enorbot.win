# Story 1.4: Control Group Identification & Router

Status: done

## Story

As a **developer**,
I want **the router to identify the control group and skip price responses**,
So that **CIO commands aren't treated as price requests**.

## Acceptance Criteria

1. **AC1: Control Group Pattern Matching**
   - **Given** a group name contains the configured pattern (e.g., "GRUPO DE CONTROLE")
   - **When** the bot receives a message from that group
   - **Then** the router flags it as `isControlGroup: true`

2. **AC2: Control Group Message Routing**
   - **Given** a message arrives from the control group
   - **When** the router dispatches the message
   - **Then** it is NOT sent to the price handler
   - **And** it is routed to the control handler instead

3. **AC3: Non-Control Group Message Routing**
   - **Given** a message arrives from a non-control group
   - **When** the router dispatches the message
   - **Then** it may be sent to the price handler (if trigger matches)

4. **AC4: Configurable Pattern via Environment**
   - **Given** the control group pattern is configurable via environment variable
   - **When** `CONTROL_GROUP_PATTERN` is set
   - **Then** the router uses that pattern for matching

## Tasks / Subtasks

- [x] **Task 1: Create Router Module** (AC: #1, #2, #3, #4)
  - [x] 1.1 Create `src/bot/router.ts` with message routing logic
  - [x] 1.2 Define `RouterContext` type with `isControlGroup`, `groupId`, `groupName`, `message`, `sender`
  - [x] 1.3 Implement `isControlGroupMessage(groupName: string, pattern: string): boolean` function
  - [x] 1.4 Implement `routeMessage(context: RouterContext): RouteResult` function
  - [x] 1.5 Export `RouteDestination` enum: `CONTROL_HANDLER | PRICE_HANDLER | IGNORE`

- [x] **Task 2: Create Handler Stubs** (AC: #2, #3)
  - [x] 2.1 Create `src/handlers/control.ts` with stub function `handleControlMessage(context: RouterContext): Promise<Result<void>>`
  - [x] 2.2 Create `src/handlers/price.ts` with stub function `handlePriceMessage(context: RouterContext): Promise<Result<void>>`
  - [x] 2.3 Both handlers log receipt and return `{ ok: true, data: undefined }` for now

- [x] **Task 3: Integrate Router with Connection** (AC: #1, #2, #3, #4)
  - [x] 3.1 Add `messages.upsert` event listener in connection.ts
  - [x] 3.2 Extract group JID and name from incoming message
  - [x] 3.3 Call router with message context
  - [x] 3.4 Dispatch to appropriate handler based on route result
  - [x] 3.5 Use `CONTROL_GROUP_PATTERN` from config for pattern matching

- [x] **Task 4: Add Logging for Message Flow** (AC: #1, #2, #3)
  - [x] 4.1 Log incoming messages with `event: 'message_received'` including `groupId`, `isControlGroup`
  - [x] 4.2 Log routing decisions with `event: 'message_routed'` including `destination`
  - [x] 4.3 Ensure no sensitive message content is logged (only metadata)

- [ ] **Task 5: Test Router Logic** (AC: #1, #2, #3, #4) - *Manual verification*
  - [ ] 5.1 Send message from control group → verify logs show `isControlGroup: true`
  - [ ] 5.2 Send message from regular group → verify logs show `isControlGroup: false`
  - [ ] 5.3 Change `CONTROL_GROUP_PATTERN` in .env → verify new pattern used
  - [ ] 5.4 Verify control messages NOT routed to price handler

## Dev Notes

### Architecture Compliance

**CRITICAL - Follow These Patterns:**

1. **Result Type Pattern** - All handler functions return Result, never throw
   ```typescript
   type Result<T> = { ok: true; data: T } | { ok: false; error: string }
   ```

2. **Logger Pattern** - Use structured JSON logger for ALL output
   ```typescript
   logger.info('Message received', { event: 'message_received', groupId, isControlGroup })
   logger.info('Message routed', { event: 'message_routed', destination: 'CONTROL_HANDLER' })
   ```

3. **Naming Conventions:**
   - Files: camelCase.ts (`router.ts`, `control.ts`, `price.ts`)
   - Functions: camelCase (`routeMessage`, `isControlGroupMessage`)
   - Types: PascalCase (`RouterContext`, `RouteResult`)
   - Constants: SCREAMING_SNAKE (`CONTROL_GROUP_PATTERN`)

### Router Implementation

**Router Module Structure:**
```typescript
// src/bot/router.ts
import { getConfig } from '../config.js'
import { logger } from '../utils/logger.js'

export type RouteDestination = 'CONTROL_HANDLER' | 'PRICE_HANDLER' | 'IGNORE'

export interface RouterContext {
  groupId: string
  groupName: string
  message: string
  sender: string
  isControlGroup: boolean
}

export interface RouteResult {
  destination: RouteDestination
  context: RouterContext
}

/**
 * Check if a group name matches the control group pattern.
 * Case-insensitive matching.
 */
export function isControlGroupMessage(groupName: string, pattern: string): boolean {
  return groupName.toLowerCase().includes(pattern.toLowerCase())
}

/**
 * Route a message to the appropriate handler.
 * Pure function - no side effects, easy to test.
 */
export function routeMessage(context: RouterContext): RouteResult {
  // Control group messages always go to control handler
  if (context.isControlGroup) {
    return { destination: 'CONTROL_HANDLER', context }
  }

  // Non-control group messages go to price handler
  // (price trigger detection is in the price handler itself)
  return { destination: 'PRICE_HANDLER', context }
}
```

### Connection.ts Integration

**Message Event Listener (add to connection.ts):**
```typescript
import { routeMessage, isControlGroupMessage, type RouterContext } from './router.js'
import { handleControlMessage } from '../handlers/control.js'
import { handlePriceMessage } from '../handlers/price.js'

// Inside createConnection, after sock is created:
sock.ev.on('messages.upsert', async (m) => {
  const msg = m.messages[0]
  if (!msg.message || msg.key.fromMe) return // Ignore our own messages

  const groupId = msg.key.remoteJid || ''
  const groupName = msg.pushName || '' // May need to fetch from store
  const messageText = msg.message.conversation ||
                      msg.message.extendedTextMessage?.text || ''
  const sender = msg.key.participant || msg.key.remoteJid || ''

  // Determine if control group
  const config = getConfig()
  const isControlGroup = isControlGroupMessage(groupName, config.CONTROL_GROUP_PATTERN)

  const context: RouterContext = {
    groupId,
    groupName,
    message: messageText,
    sender,
    isControlGroup,
  }

  logger.info('Message received', {
    event: 'message_received',
    groupId,
    isControlGroup,
    // DO NOT log message content for privacy
  })

  const route = routeMessage(context)

  logger.info('Message routed', {
    event: 'message_routed',
    destination: route.destination,
    groupId,
  })

  // Dispatch to handler
  if (route.destination === 'CONTROL_HANDLER') {
    await handleControlMessage(context)
  } else if (route.destination === 'PRICE_HANDLER') {
    await handlePriceMessage(context)
  }
})
```

### Handler Stubs

**Control Handler (src/handlers/control.ts):**
```typescript
import { logger } from '../utils/logger.js'
import { ok, type Result } from '../utils/result.js'
import type { RouterContext } from '../bot/router.js'

/**
 * Handle control group messages.
 * Stub for now - full implementation in Epic 4.
 */
export async function handleControlMessage(context: RouterContext): Promise<Result<void>> {
  logger.info('Control message received (handler stub)', {
    event: 'control_message_stub',
    groupId: context.groupId,
    sender: context.sender,
  })

  return ok(undefined)
}
```

**Price Handler (src/handlers/price.ts):**
```typescript
import { logger } from '../utils/logger.js'
import { ok, type Result } from '../utils/result.js'
import type { RouterContext } from '../bot/router.js'

/**
 * Handle price trigger messages.
 * Stub for now - full implementation in Epic 2.
 */
export async function handlePriceMessage(context: RouterContext): Promise<Result<void>> {
  logger.info('Price message received (handler stub)', {
    event: 'price_message_stub',
    groupId: context.groupId,
    sender: context.sender,
  })

  return ok(undefined)
}
```

### Baileys Message Structure

**Key fields from Baileys message object:**
```typescript
// WAMessage structure (from @whiskeysockets/baileys)
interface WAMessage {
  key: {
    remoteJid: string    // Group/chat JID (e.g., "123456789@g.us")
    fromMe: boolean      // Is from bot itself
    participant?: string // Sender JID in group
    id: string           // Message ID
  }
  message?: {
    conversation?: string              // Simple text message
    extendedTextMessage?: { text: string }  // Text with link preview
    // ... other message types
  }
  pushName?: string      // Sender display name
}
```

**Group JID vs Group Name:**
- `remoteJid` is the JID (e.g., `123456789@g.us`) - stable identifier
- `pushName` is the sender name, NOT the group name
- To get group name, need to fetch from group metadata (or use store)

**IMPORTANT:** For MVP, the control group pattern matching should work on the group JID or use Baileys store to get group subject. Let me clarify the approach:

**Option 1 (Simpler - Recommended for MVP):** Use CONTROL_GROUP_JID environment variable with exact JID match:
```typescript
// In types/config.ts - add:
CONTROL_GROUP_JID: z.string().optional(), // Optional exact JID match
```

**Option 2 (Original - Pattern match on group name):** Requires fetching group metadata:
```typescript
const groupMetadata = await sock.groupMetadata(groupId)
const groupName = groupMetadata.subject // This is the actual group name
```

**Recommendation:** Implement both - use JID match if provided, fall back to pattern match on group name.

### Environment Configuration

**Current CONTROL_GROUP_PATTERN (in types/config.ts line 25):**
```typescript
CONTROL_GROUP_PATTERN: z.string().min(1).default('CONTROLE'),
```

This is already defined. No changes needed to config schema.

### Learnings from Previous Stories

**From Story 1.1:**
- Use `@whiskeysockets/baileys` (not `@arceos/baileys`)
- Result pattern established in `src/utils/result.ts`
- Structured logger in `src/utils/logger.ts`

**From Story 1.2:**
- Supabase auth state persistence working
- `clearAuthState()` on logout
- Debounced save with retry

**From Story 1.3:**
- State tracking in `src/bot/state.ts` with connection status
- Notification queue stub in `src/bot/notifications.ts`
- Exponential backoff in `src/utils/backoff.ts`
- Code review caught bug with state reset - always test state transitions!

**Current connection.ts state:**
- Handles `connection.update` events
- Has `createConnection()` and `getSocket()` exports
- Does NOT yet handle `messages.upsert` events

### Files to Create

| File | Purpose |
|------|---------|
| `src/bot/router.ts` | Message routing logic with control group detection |
| `src/handlers/control.ts` | Control message handler stub |
| `src/handlers/price.ts` | Price message handler stub |

### Files to Modify

| File | Changes |
|------|---------|
| `src/bot/connection.ts` | Add `messages.upsert` event listener with routing |

### Anti-Patterns to AVOID

- Do NOT log actual message content (privacy)
- Do NOT implement full control commands (Epic 4)
- Do NOT implement price trigger detection (Epic 2)
- Do NOT throw errors from handlers (use Result type)
- Do NOT hardcode control group pattern (use config)

### Testing Notes

**Manual Verification Steps:**

1. **Test Control Group Detection:**
   ```bash
   # Set CONTROL_GROUP_PATTERN=CONTROLE in .env
   npm run dev
   # Send message from a group with "CONTROLE" in name
   # Check logs for: isControlGroup: true
   ```

2. **Test Non-Control Group:**
   ```bash
   # Send message from a regular group
   # Check logs for: isControlGroup: false
   ```

3. **Test Pattern Matching:**
   ```bash
   # Test case-insensitive: "controle" should match "CONTROLE"
   # Test partial match: "GRUPO DE CONTROLE ENOR" should match
   ```

### NFR Compliance

| NFR | Requirement | Implementation |
|-----|-------------|----------------|
| FR9 | Control group messages not treated as price requests | Router routes to control handler, not price handler |
| FR-IMP1 | Control group identification by name pattern | Pattern matching via CONTROL_GROUP_PATTERN |

### References

- [Source: docs/project-context.md#Technical Context] - FR9, FR-IMP1 requirements
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure] - File locations
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4] - Acceptance criteria
- [Source: 1-3-auto-reconnect-with-state-tracking.md#Dev Agent Record] - Previous story learnings

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None required - implementation straightforward.

### Completion Notes List

1. **Router Module**: Created `src/bot/router.ts` with pure functions for routing logic. `isControlGroupMessage()` performs case-insensitive pattern matching. `routeMessage()` returns destination without side effects.

2. **Handler Stubs**: Created `src/handlers/control.ts` and `src/handlers/price.ts` as stubs that log receipt and return `ok(undefined)`. These will be expanded in Epic 4 and Epic 2 respectively.

3. **Connection Integration**: Added `messages.upsert` event listener in `connection.ts`. Uses `groupMetadata()` to fetch actual group name for pattern matching. Only processes group messages (JIDs ending with `@g.us`).

4. **Message Flow Logging**: Added structured logging for `message_received` and `message_routed` events. Message content is NOT logged for privacy - only metadata (groupId, groupName, isControlGroup, destination).

5. **Group Name Resolution**: Implemented group metadata fetch with error handling and caching to prevent rate limiting.

6. **Code Review Fixes (2026-01-15)**:
   - Added in-memory group metadata cache to avoid repeated API calls (rate limit/ban risk)
   - Fixed AC2-breaking bug: if metadata fetch fails, message is now skipped instead of misrouted to price handler
   - Added top-level try/catch error handler in messages.upsert to prevent crashes
   - Captured sock reference at handler setup to avoid non-null assertion issues
   - Removed unused logger import from router.ts
   - Added comment for IGNORE route destination (reserved for future use)

### File List

| File | Action | Description |
|------|--------|-------------|
| `src/bot/router.ts` | Created | Message routing logic with RouterContext, RouteResult, isControlGroupMessage, routeMessage |
| `src/handlers/control.ts` | Created | Control message handler stub (Epic 4 implementation) |
| `src/handlers/price.ts` | Created | Price message handler stub (Epic 2 implementation) |
| `src/bot/connection.ts` | Modified | Added messages.upsert event listener with routing integration |

### Change Log

| Date | Change |
|------|--------|
| 2026-01-15 | Initial implementation of Story 1.4 - all code tasks complete, pending manual verification |
| 2026-01-15 | Code review fixes: Added metadata caching, fixed AC2 misrouting bug, added error handling, removed dead code |
