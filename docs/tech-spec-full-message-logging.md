# Tech Spec: Observation & Learning System for OTC Groups

## 1. Overview

### Strategic Context

This is NOT a simple logging system. It is an **Observation and Learning System** designed to enable per-group tailoring of bot behavior based on observed patterns.

**Business Goals:**
- **Learning Mode**: Bot will watch multiple OTC groups in "observation" mode for weeks
- **Pattern Discovery**: Each group has different operators, CIOs, and clients with unique behaviors
- **Group Tailoring**: After collecting history, bot behavior will be customized per-group
- **Cost Optimization**: Minimize AI/OpenRouter calls by extracting rules from patterns (AI is expensive)
- **Data for Analysis**: Structure data for pattern extraction, not just storage

**Key Insight**: The Excel data must support queries like:
- "Who are the most active operators in Group X?"
- "What times does Group Y have peak activity?"
- "What phrases consistently trigger price requests?"
- "How long do negotiations typically take in each group?"
- "Which player roles exist and how do they interact?"

## 2. Current State

### Existing Excel Logging (`src/services/excel.ts`)
- **LogEntry interface**: Logs price quotes only with schema: `[Timestamp, Group_name, Client_identifier, Volume_brl, Quote, Acquired_usdt, Onchain_tx]`
- **Functions**: `logPriceQuote()`, `appendRowDirect()`, `validateExcelAccess()`, `updateOnchainTx()`
- **Integration**: MS Graph API via `graph.ts` for auth, auto-retry via `logQueue.ts`
- **Limitation**: Only captures completed transactions, misses the negotiation flow

### Existing Message History (`src/services/messageHistory.ts`)
- **Supabase-based**: Tracks contacts, groups, and messages in database
- **Message types**: Basic `IncomingMessageType` (text, image, document, other) + `BotMessageType` (price_response, stall, notification, status, error)
- **Functions**: `logMessageToHistory()`, `logBotMessage()`, `saveMessage()`
- **Limitation**: Types too generic for OTC pattern analysis

### Router (`src/bot/router.ts`)
- **Route destinations**: CONTROL_HANDLER, PRICE_HANDLER, RECEIPT_HANDLER, TRONSCAN_HANDLER, OBSERVE_ONLY, IGNORE
- **Context includes**: groupId, groupName, message, sender, senderName, isControlGroup, hasTrigger, hasTronscan
- **Trigger detection**: Uses `isPriceTrigger()` and `hasTronscanLink()` from `src/utils/triggers.ts`

### Trigger Detection (`src/utils/triggers.ts`)
- **Price triggers**: Keywords `['preço', 'cotação']`
- **Volume extraction**: Parses BRL amounts from messages (e.g., "compro 5k" → 5000)
- **Tronscan detection**: Extracts transaction hashes from URLs

## 3. Changes Required

### 3.1 New Excel Service: `src/services/excelObservation.ts`

Create a dedicated service for observation logging (keeps `excel.ts` unchanged for price quotes).

```typescript
// New file: src/services/excelObservation.ts

/**
 * Message types for OTC pattern classification.
 * Used to categorize messages for behavioral analysis.
 */
export type OTCMessageType =
  | 'price_request'      // "preço?", "cotação", "quanto tá?"
  | 'price_response'     // Bot's price quote response
  | 'volume_inquiry'     // "compro 10k", "tenho 5000 pra vender"
  | 'negotiation'        // Counter-offers, price discussion
  | 'confirmation'       // "fechado", "ok", "vamos"
  | 'receipt'            // PDF/image receipt posted
  | 'tronscan'           // Transaction link shared
  | 'general'            // Chit-chat, greetings, unclassified

/**
 * Player roles in OTC groups.
 * Can be updated later as patterns emerge.
 */
export type PlayerRole =
  | 'operator'    // Runs the group, posts official prices
  | 'cio'         // Chief Investment Officer, makes decisions
  | 'client'      // Buys/sells USDT
  | 'unknown'     // Not yet classified

/**
 * Observation log entry for pattern analysis.
 * Designed for per-group behavioral extraction.
 */
export interface ObservationLogEntry {
  // Identity & Partitioning
  timestamp: Date
  groupId: string
  groupName: string
  playerJid: string
  playerName: string
  playerRole: PlayerRole

  // Message Classification
  messageType: OTCMessageType
  triggerPattern: string | null      // What phrase triggered this (e.g., "preço", "cotação")
  conversationThread: string | null  // Link related messages (UUID, generated on price_request)

  // Extracted Data
  volumeBrl: number | null
  volumeUsdt: number | null
  contentPreview: string             // First 100 chars for reference

  // Response Tracking
  responseRequired: boolean          // Did this message need a bot response?
  responseGiven: string | null       // What the bot said (first 100 chars)
  responseTimeMs: number | null      // Latency tracking

  // Activity Patterns
  hourOfDay: number                  // 0-23 for activity analysis
  dayOfWeek: number                  // 0-6 (Sunday-Saturday)

  // Cost Tracking
  aiUsed: boolean                    // Did we use OpenRouter for this?
}

export async function logObservation(entry: ObservationLogEntry): Promise<Result<{ rowNumber: number }>>
export async function appendObservationRowDirect(entry: ObservationLogEntry): Promise<Result<{ rowNumber: number }>>
```

### 3.2 Message Classification Module: `src/services/messageClassifier.ts`

Create a rules-based classifier for OTC messages (avoids AI calls).

```typescript
// New file: src/services/messageClassifier.ts

import type { OTCMessageType, PlayerRole } from './excelObservation.js'

/**
 * Classification patterns for OTC messages.
 * Extracted from observation - can be tuned per-group later.
 */
interface ClassificationResult {
  messageType: OTCMessageType
  triggerPattern: string | null
  volumeBrl: number | null
  volumeUsdt: number | null
  confidence: 'high' | 'medium' | 'low'
}

/**
 * Classify a message without using AI.
 * Uses keyword matching and regex patterns.
 */
export function classifyMessage(message: string, context: {
  isFromBot: boolean
  hasReceipt: boolean
  hasTronscan: boolean
  hasPriceTrigger: boolean
}): ClassificationResult

/**
 * Pattern definitions for each message type.
 * Exported for per-group customization.
 */
export const MESSAGE_PATTERNS: Record<OTCMessageType, RegExp[]>

/**
 * Attempt to infer player role from message history.
 * Returns 'unknown' if insufficient data.
 */
export function inferPlayerRole(params: {
  playerJid: string
  groupId: string
  recentMessages: Array<{ content: string; messageType: OTCMessageType }>
}): PlayerRole
```

### 3.3 Conversation Threading: `src/services/conversationTracker.ts`

Track conversation threads to link related messages.

```typescript
// New file: src/services/conversationTracker.ts

import { v4 as uuidv4 } from 'uuid'

/**
 * Active conversation threads by group.
 * Key: groupId, Value: { threadId, startTime, participantJids, lastActivity }
 */
interface ConversationThread {
  threadId: string
  groupId: string
  startedBy: string           // JID of who started (price_request)
  startTime: Date
  participants: Set<string>   // All JIDs involved
  lastActivity: Date
  messageCount: number
}

/**
 * Get or create a conversation thread for a price request.
 * Returns existing thread if within timeout window (5 minutes).
 */
export function getOrCreateThread(groupId: string, starterJid: string): string

/**
 * Add a message to an existing thread.
 * Returns null if no active thread for this group.
 */
export function addToThread(groupId: string, participantJid: string): string | null

/**
 * Close a thread (confirmation received or timeout).
 */
export function closeThread(groupId: string): void

/**
 * Get thread ID for a message based on context and timing.
 */
export function resolveThreadId(params: {
  groupId: string
  senderJid: string
  messageType: OTCMessageType
  timestamp: Date
}): string | null
```

### 3.4 Extended Log Queue: `src/services/logQueue.ts`

Extend queue to support observation entries.

```typescript
// Add to existing logQueue.ts
export type QueueEntryType = 'price_quote' | 'observation'

export interface QueuedObservationEntry {
  id: string
  entryType: 'observation'
  entry: ObservationLogEntry
  createdAt: Date
  attempts: number
  lastAttemptAt: Date | null
  status: 'pending' | 'synced' | 'failed'
}

export async function queueObservationEntry(entry: ObservationLogEntry): Promise<void>
export async function getQueuedObservationEntries(): Promise<QueuedObservationEntry[]>
export async function flushObservationEntries(): Promise<void>
```

### 3.5 Config Updates: `src/types/config.ts`

Add new worksheet configuration for observations.

```typescript
// Add to envSchema
EXCEL_OBSERVATIONS_WORKSHEET_NAME: z.string().default('Observations'),
EXCEL_OBSERVATIONS_TABLE_NAME: z.string().default('ObservationsTable'),
```

### 3.6 Integration Points

- **`src/bot/router.ts`**: After routing, call observation logging
- **`src/bot/connection.ts`**: Capture all messages before dispatch for observation
- **Response handlers**: Track response times and content for observation entries

## 4. New Data Schema

### Excel Worksheet: "Observations" (new)

| Column | Type | Purpose | Example |
|--------|------|---------|---------|
| `Timestamp` | DateTime (ISO) | When message occurred | `2024-01-15T14:32:05.123Z` |
| `Group_ID` | String | Partition by group (JID) | `120363123456789@g.us` |
| `Group_Name` | String | Human-readable group name | `OTC - Corretora Alpha` |
| `Player_JID` | String | Individual identifier | `5511999999999@s.whatsapp.net` |
| `Player_Name` | String | WhatsApp display name | `João Operador` |
| `Player_Role` | Enum | operator/client/cio/unknown | `operator` |
| `Message_Type` | Enum | Classification (see types above) | `price_request` |
| `Trigger_Pattern` | String/null | What phrase triggered classification | `cotação` |
| `Conversation_Thread` | UUID/null | Links request→response→confirm | `a1b2c3d4-e5f6-...` |
| `Volume_BRL` | Number/null | BRL amount if mentioned | `5000` |
| `Volume_USDT` | Number/null | USDT amount if mentioned | `862.07` |
| `Content_Preview` | String | First 100 chars of message | `Boa tarde, qual o preço...` |
| `Response_Required` | Boolean | Did this need bot response? | `TRUE` |
| `Response_Given` | String/null | Bot's response (first 100 chars) | `Cotação: R$ 5.80...` |
| `Response_Time_ms` | Number/null | Latency in milliseconds | `1523` |
| `Hour_of_Day` | Number | 0-23 for activity patterns | `14` |
| `Day_of_Week` | Number | 0-6 (Sun-Sat) for patterns | `1` (Monday) |
| `AI_Used` | Boolean | Did we call OpenRouter? | `FALSE` |

### Message Type Classification Logic

| Message Type | Detection Method | Trigger Patterns |
|-------------|------------------|------------------|
| `price_request` | `isPriceTrigger()` returns true | `preço`, `cotação`, `quanto tá`, `valor` |
| `price_response` | Message is from bot + follows price_request | N/A (bot response) |
| `volume_inquiry` | Contains BRL/USDT amount + buy/sell keywords | `compro`, `vendo`, `tenho`, `preciso` + number |
| `negotiation` | Numeric content in thread after price_response | Counter-offer patterns |
| `confirmation` | Affirmative keywords in active thread | `fechado`, `ok`, `vamos`, `feito`, `deal` |
| `receipt` | Has PDF/image attachment | Detected by `detectReceiptType()` |
| `tronscan` | Contains Tronscan URL | Detected by `hasTronscanLink()` |
| `general` | None of the above | N/A (fallback) |

### Conversation Thread Linking

Threads are created and managed as follows:

1. **Thread Creation**: When a `price_request` is detected, generate a new UUID thread ID
2. **Thread Association**: Subsequent messages in the same group within 5 minutes are linked to the thread
3. **Thread Closure**: Thread closes on:
   - `confirmation` message from the requester
   - `receipt` or `tronscan` message (transaction complete)
   - 5-minute timeout with no activity
4. **Participant Tracking**: All JIDs that send messages in a thread are tracked as participants

### Supabase Table: `observation_queue` (new)

```sql
CREATE TABLE observation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  timestamp TIMESTAMPTZ NOT NULL,
  group_id TEXT NOT NULL,
  group_name TEXT NOT NULL,
  player_jid TEXT NOT NULL,
  player_name TEXT NOT NULL,
  player_role TEXT NOT NULL DEFAULT 'unknown',

  -- Classification
  message_type TEXT NOT NULL,
  trigger_pattern TEXT,
  conversation_thread UUID,

  -- Extracted data
  volume_brl NUMERIC,
  volume_usdt NUMERIC,
  content_preview TEXT NOT NULL,

  -- Response tracking
  response_required BOOLEAN DEFAULT false,
  response_given TEXT,
  response_time_ms INTEGER,

  -- Activity patterns
  hour_of_day SMALLINT NOT NULL,
  day_of_week SMALLINT NOT NULL,

  -- Cost tracking
  ai_used BOOLEAN DEFAULT false,

  -- Queue metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  attempts INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending'
);

-- Indexes for pattern queries
CREATE INDEX idx_observation_queue_group ON observation_queue(group_id);
CREATE INDEX idx_observation_queue_thread ON observation_queue(conversation_thread);
CREATE INDEX idx_observation_queue_status ON observation_queue(status);
```

## 5. Implementation Stories

### Story 8.1: Create Message Classifier Module
**Files**: `src/services/messageClassifier.ts` (new)

**Tasks**:
1. Define `MESSAGE_PATTERNS` with regex for each `OTCMessageType`
2. Implement `classifyMessage()` with pattern matching priority
3. Integrate with existing `isPriceTrigger()` and `extractVolumeBrl()` from triggers.ts
4. Add USDT extraction pattern (e.g., "862 usdt", "862u")
5. Implement `inferPlayerRole()` based on message history heuristics

**Classification Priority**:
```
1. isFromBot → price_response (if follows request) | notification | status
2. hasReceipt → receipt
3. hasTronscan → tronscan
4. hasPriceTrigger → price_request
5. hasVolumePattern + buyKeyword → volume_inquiry
6. inActiveThread + hasNumber → negotiation
7. inActiveThread + confirmKeyword → confirmation
8. else → general
```

**Acceptance Criteria**:
- [ ] AC1: `classifyMessage()` returns correct type for price requests
- [ ] AC2: Volume extraction works for BRL patterns (5k, 5000, 5.000)
- [ ] AC3: Volume extraction works for USDT patterns (862u, 862 usdt)
- [ ] AC4: Bot messages correctly classified as responses
- [ ] AC5: `inferPlayerRole()` returns 'operator' for frequent price responders
- [ ] AC6: All classification is rules-based (no AI calls)

---

### Story 8.2: Create Conversation Tracker Module
**Files**: `src/services/conversationTracker.ts` (new)

**Tasks**:
1. Implement in-memory thread storage (Map<groupId, ConversationThread>)
2. Implement `getOrCreateThread()` with 5-minute timeout window
3. Implement `addToThread()` for subsequent messages
4. Implement `closeThread()` for explicit closure
5. Implement `resolveThreadId()` that uses message type + timing to link messages
6. Add thread cleanup on interval (remove stale threads)

**Thread Rules**:
```
- price_request → creates new thread (or returns existing if < 5 min old)
- price_response → links to most recent thread in group
- volume_inquiry → may create new thread if no active one
- negotiation → links to active thread only
- confirmation → links to active thread, then closes it
- receipt/tronscan → links to active thread, then closes it
- general → no thread linking
```

**Acceptance Criteria**:
- [ ] AC1: New thread created on price_request
- [ ] AC2: Subsequent messages link to active thread within 5 minutes
- [ ] AC3: Thread closes on confirmation/receipt/tronscan
- [ ] AC4: Stale threads (> 5 min inactive) are cleaned up
- [ ] AC5: Thread ID is UUID format
- [ ] AC6: Participants tracked correctly in thread

---

### Story 8.3: Create Observation Excel Service
**Files**: `src/services/excelObservation.ts` (new)

**Tasks**:
1. Create `ObservationLogEntry` interface with all analytical fields
2. Implement `buildObservationsRowsUrl()` using new worksheet config
3. Implement `formatObservationRow()` with correct column order
4. Implement `logObservation()` with same pattern as `logPriceQuote()`
5. Implement `appendObservationRowDirect()` for queue flushing
6. Add helper `extractTimePatterns()` for hour_of_day and day_of_week

**Column Order**:
```
[Timestamp, Group_ID, Group_Name, Player_JID, Player_Name, Player_Role,
 Message_Type, Trigger_Pattern, Conversation_Thread, Volume_BRL, Volume_USDT,
 Content_Preview, Response_Required, Response_Given, Response_Time_ms,
 Hour_of_Day, Day_of_Week, AI_Used]
```

**Acceptance Criteria**:
- [ ] AC1: `logObservation()` appends row to Observations worksheet
- [ ] AC2: All 18 columns populated correctly
- [ ] AC3: Failed writes queue to `observation_queue` table
- [ ] AC4: `hour_of_day` correctly extracted from timestamp (0-23)
- [ ] AC5: `day_of_week` correctly extracted (0=Sunday, 6=Saturday)
- [ ] AC6: Does not affect existing `excel.ts` price quote logging

---

### Story 8.4: Extend Log Queue for Observations
**Files**: `src/services/logQueue.ts`, Supabase migration

**Tasks**:
1. Create `observation_queue` table in Supabase (see schema above)
2. Add `QueuedObservationEntry` type
3. Implement `queueObservationEntry()` function
4. Implement `getQueuedObservationEntries()` function
5. Implement `flushObservationEntries()` separate from price queue
6. Add indexes for pattern queries

**Acceptance Criteria**:
- [ ] AC1: `observation_queue` table created with all columns
- [ ] AC2: `queueObservationEntry()` inserts to correct table
- [ ] AC3: Periodic sync flushes observation queue
- [ ] AC4: Indexes created for group_id, conversation_thread, status
- [ ] AC5: Existing price quote queue unchanged

---

### Story 8.5: Add Config for Observations Worksheet
**Files**: `src/types/config.ts`

**Tasks**:
1. Add `EXCEL_OBSERVATIONS_WORKSHEET_NAME` env var (default: "Observations")
2. Add `EXCEL_OBSERVATIONS_TABLE_NAME` env var (default: "ObservationsTable")
3. Add `isObservationLoggingConfigured()` helper
4. Document Excel setup requirements

**Acceptance Criteria**:
- [ ] AC1: Config validated at startup
- [ ] AC2: Defaults work without env vars set
- [ ] AC3: `isObservationLoggingConfigured()` checks all required fields

---

### Story 8.6: Integrate Observation Logging in Message Flow
**Files**: `src/bot/connection.ts`, `src/bot/router.ts`

**Tasks**:
1. Import observation logging services in connection.ts
2. After message dispatch, create observation entry with:
   - Classification from `classifyMessage()`
   - Thread ID from `resolveThreadId()`
   - Time patterns from timestamp
3. Set `responseRequired` based on route destination
4. Fire-and-forget call to `logObservation()`
5. Track AI usage flag when OpenRouter is called

**Message Processing Flow**:
```
1. Message received
2. Route determined (existing flow)
3. Classify message type
4. Resolve conversation thread
5. Create ObservationLogEntry
6. Dispatch to handler (existing flow)
7. Log observation (fire-and-forget)
```

**Acceptance Criteria**:
- [ ] AC1: All messages logged to Observations worksheet
- [ ] AC2: Classification correct for each message type
- [ ] AC3: Thread ID linked for related messages
- [ ] AC4: Fire-and-forget (never blocks message processing)
- [ ] AC5: `ai_used` flag set when OpenRouter called

---

### Story 8.7: Track Bot Responses in Observations
**Files**: `src/handlers/price.ts`, `src/handlers/receipt.ts`, `src/bot/notifications.ts`

**Tasks**:
1. Capture response start time before processing
2. After sending response, create observation entry with:
   - `messageType: 'price_response'` (or appropriate type)
   - `responseGiven: firstNChars(responseText, 100)`
   - `responseTimeMs: Date.now() - startTime`
3. Link to same conversation thread as triggering message
4. Set `ai_used: true` if OpenRouter was called for this response

**Acceptance Criteria**:
- [ ] AC1: Bot responses logged with response time
- [ ] AC2: Response content preview captured (100 chars)
- [ ] AC3: Linked to same thread as triggering message
- [ ] AC4: `ai_used` accurately reflects OpenRouter usage
- [ ] AC5: Fire-and-forget pattern maintained

---

### Story 8.8: Player Role Inference (Phase 2)
**Files**: `src/services/messageClassifier.ts`, new RPC function

**Note**: This story can be deferred until sufficient observation data is collected.

**Tasks**:
1. Create Supabase RPC function to query player message history
2. Implement role inference heuristics:
   - High frequency of price_response → likely operator
   - Initiates most price_request → likely client
   - Low volume, high-value transactions → possibly CIO
3. Add `updatePlayerRole()` function for manual corrections
4. Store inferred roles in Supabase for persistence

**Heuristics**:
```
operator: > 50% of group's price_response messages
client: > 70% of messages are price_request or volume_inquiry
cio: Mentioned in high-value (> 50k BRL) confirmations
unknown: Default until pattern emerges
```

**Acceptance Criteria**:
- [ ] AC1: Role inference runs on sufficient data (> 20 messages)
- [ ] AC2: Operator detection based on response frequency
- [ ] AC3: Client detection based on request frequency
- [ ] AC4: Roles can be manually corrected
- [ ] AC5: Roles persist across restarts

---

## 6. Testing Notes

- Test classification with sample OTC messages from each type
- Test thread linking with rapid message sequences
- Test timeout behavior (thread closure after 5 min)
- Verify existing price quote logging still works
- Test with Excel API offline (should queue entries)
- Test activity pattern extraction (hour/day)
- Verify AI usage flag accuracy

## 7. Migration Notes

1. Create `observation_queue` table in Supabase before deployment
2. Create "Observations" worksheet in Excel file with table "ObservationsTable"
3. Table must have all 18 columns with headers matching schema
4. Set env vars if using non-default worksheet/table names
5. Deploy code changes
6. Monitor queue backlog during initial rollout
7. Existing price quote logging continues unchanged

## 8. Future Enhancements

After collecting sufficient observation data:

1. **Per-Group Rule Extraction**: Analyze patterns to create group-specific trigger keywords
2. **Player Profile Building**: Build behavioral profiles for operators, clients, CIOs
3. **Response Time Optimization**: Identify optimal response timing per group
4. **Conversation Flow Templates**: Extract common negotiation patterns
5. **AI Call Reduction**: Replace AI-based classification with learned rules
