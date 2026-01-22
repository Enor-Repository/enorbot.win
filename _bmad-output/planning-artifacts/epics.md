---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments:
  - prd.md
  - architecture.md
  - sample-receipt-pdf
workflowType: 'epics-and-stories'
project_name: 'eNorBOT'
user_name: 'Boss'
date: '2026-01-15'
epic6_added: '2026-01-19'
---

# eNorBOT - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for eNorBOT, decomposing the requirements from the PRD and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

**Price Quoting (Core Value)**
- FR1: Bot can detect price trigger keywords in monitored group messages
- FR2: Bot can fetch current USDT/BRL spot price from Binance
- FR3: Bot can respond to trigger messages with formatted price quote
- FR4: Bot can format prices in Brazilian Portuguese currency style (R$X,XX)

**CIO Control Interface**
- FR5: CIO can pause bot activity for a specific group via control group command
- FR6: CIO can resume bot activity for a paused group via control group command
- FR7: CIO can query bot status to see activity summary
- FR8: Bot can send status notifications to control group (online, offline, errors)
- FR9: Control group messages are never responded to with price quotes

**Session & Connection Management**
- FR10: Bot can persist WhatsApp session credentials across restarts
- FR11: Bot can automatically reconnect after connection loss
- FR12: Bot can detect disconnection state and notify control group

**Anti-Detection Behavior**
- FR14: Bot can delay responses with randomized chaotic timing
- FR15: Bot can simulate typing indicator before sending messages
- FR16: Bot can vary response patterns to avoid detection signatures

**Logging & Audit Trail**
- FR17: Bot can log each price quote interaction to Excel Online
- FR18: Log entries include timestamp, group name, client identifier, and quote given
- FR19: CIO can review interaction history via Excel spreadsheet

**Error Handling & Safety**
- FR20: Bot can detect Binance API failures before responding
- FR21: Bot can send human-like stall message when price unavailable
- FR22: Bot can auto-pause and alert CIO on critical unrecoverable errors
- FR23: Bot can recover and resume automatically when transient errors resolve

**Receipt Processing (Epic 6)**
- FR24: Bot can detect when a PDF document is received in monitored groups
- FR25: Bot can download and extract text content from received PDF files using unpdf library
- FR26: Bot can parse PIX transfer receipt data from extracted PDF text (valor, data/hora, tipo, identificador, recebedor, pagador)
- FR27: Bot can validate parsed receipt data using Zod schemas
- FR28: Bot can store validated receipt data in Supabase `receipts` table
- FR29: Bot can send confirmation message to control group when receipt is successfully processed
- FR30: Bot handles malformed/unreadable PDFs gracefully without crashing
- FR31: Bot can detect when an image (screenshot) is received in monitored groups
- FR32: Bot can extract receipt data from images via OpenRouter Claude Haiku Vision API
- FR33: Bot uses unified processing pipeline for both PDF and image receipts
- FR34: Bot detects and skips duplicate receipts (same EndToEnd ID)
- FR35: Bot notifies control group when receipt extraction fails with reason
- FR36: Bot stores raw PDF/image file in Supabase alongside extracted data

**Implicit Requirements (Party Mode Review)**
- FR-IMP1: Bot identifies control group by configured group name pattern (e.g., "GRUPO DE CONTROLE")
- FR-IMP2: Bot detects price triggers using keywords: "preço", "cotação" (configurable in triggers.ts)
- FR-IMP3: Status command (FR7) includes message counts, group activity summary, and system health
- FR-IMP4: Error handling sequence: detect failure → send stall → retry → (success? recover) OR (fail? alert CIO → auto-pause)

**Removed Requirements:**
- ~~FR12 (QR code auth)~~: Not applicable - session auth handled differently

### NonFunctional Requirements

**Reliability**
- NFR1: Bot maintains WhatsApp connection 99%+ of the time (excluding planned restarts)
- NFR2: Session credentials persist across VPS restarts without re-authentication
- NFR3: Bot auto-recovers from transient errors within 60 seconds
- NFR4: Bot notifies control group within 30 seconds of disconnection
- NFR5: Process restarts automatically via PM2 on crash

**Security**
- NFR6: WhatsApp session credentials stored encrypted in Supabase
- NFR7: VPS access restricted to SSH key authentication only
- NFR8: Environment variables never logged or exposed in error messages
- NFR9: Microsoft Graph tokens refreshed automatically before expiry

**Integration**
- NFR10: Binance API requests complete within 2 seconds or trigger fallback
- NFR11: Excel Online logging tolerates temporary Graph API unavailability (queue in Supabase)
- NFR12: Supabase operations complete within 1 second for state reads/writes
- NFR13: All external API failures logged for debugging

**Operational Performance**
- NFR14: Response delay randomization between 3-15 seconds (chaotic timing)
- NFR15: Typing indicator duration between 1-4 seconds before message send
- NFR16: Message throughput capped at <100 messages/day (anti-ban)
- NFR17: Bot startup completes within 30 seconds of process start

**Receipt Processing (Epic 6)**
- NFR18: PDF text extraction completes within 5 seconds or times out
- NFR19: Receipt data stored in Supabase follows existing snake_case conventions
- NFR20: Control group notifications for receipts use same anti-detection timing as other messages
- NFR21: Image OCR processing completes within 10 seconds or times out
- NFR22: OpenRouter API costs tracked and logged for monitoring

### Additional Requirements

**Operational Notes (Outside Scope):**
- 30-day warm-up period is operational procedure, not bot-tracked feature
- When ready, bot goes live - no warm-up tracking in code

**From Architecture - Starter Template:**
- Minimal TypeScript Project (no framework)
- Node.js 20 LTS + TypeScript strict + ESM modules
- Dependencies: @arceos/baileys, @supabase/supabase-js, dotenv, zod

**From Architecture - Project Initialization:**
```bash
mkdir eNorBOT && cd eNorBOT
npm init -y
npm i @arceos/baileys @supabase/supabase-js dotenv zod
npm i -D typescript @types/node tsx
```

**From Architecture - Implementation Patterns:**
- Result type pattern for error handling (services never throw)
- Structured JSON logging (no console.log)
- snake_case for database, camelCase for TypeScript
- Co-located tests (*.test.ts next to source)

**From Architecture - Infrastructure:**
- Health endpoint on port 3000 for UptimeRobot
- PM2 ecosystem.config.js for process management
- Manual deploy: SSH + git pull + pm2 restart

**From Architecture - Project Structure:**
```
src/
├── index.ts              # Entry point
├── config.ts             # Zod env validation
├── bot/
│   ├── connection.ts     # Baileys socket
│   ├── router.ts         # Message dispatch
│   └── state.ts          # Connection state
├── handlers/
│   ├── price.ts          # Price request handler
│   └── control.ts        # CIO commands
├── services/
│   ├── binance.ts        # Price fetching
│   ├── excel.ts          # MS Graph logging
│   └── supabase.ts       # Session persistence
├── utils/
│   ├── chaos.ts          # Chaotic timing
│   ├── logger.ts         # Structured logger
│   ├── result.ts         # Result<T> type
│   └── triggers.ts       # Price trigger patterns
└── types/
    ├── config.ts         # Config schemas
    ├── messages.ts       # WhatsApp types
    └── services.ts       # Service types
```

### FR Coverage Map

| Requirement | Epic | Description |
|-------------|------|-------------|
| FR1 | Epic 2 | Detect price trigger keywords |
| FR2 | Epic 2 | Fetch Binance USDT/BRL price |
| FR3 | Epic 2 | Respond with formatted quote |
| FR4 | Epic 2 | Brazilian currency format |
| FR5 | Epic 4 | Pause group command |
| FR6 | Epic 4 | Resume group command |
| FR7 | Epic 4 | Status query command |
| FR8 | Epic 4 | Status notifications |
| FR9 | Epic 1 | Control group isolation (router awareness) |
| FR10 | Epic 1 | Session persistence |
| FR11 | Epic 1 | Auto-reconnect |
| FR12 | Epic 1 | Disconnection notification |
| FR14 | Epic 1 | Chaotic timing delays |
| FR15 | Epic 1 | Typing indicator |
| FR16 | Epic 1 | Response pattern variation |
| FR17 | Epic 5 | Log to Excel Online |
| FR18 | Epic 5 | Log entry format |
| FR19 | Epic 5 | Spreadsheet access |
| FR20 | Epic 2 | API failure detection (graceful degradation) |
| FR21 | Epic 2 | Stall message (graceful degradation) |
| FR22 | Epic 3 | Auto-pause on critical error |
| FR23 | Epic 3 | Auto-recovery |
| FR-IMP1 | Epic 1 | Control group identification (router awareness) |
| FR-IMP2 | Epic 2 | Trigger keywords config |
| FR-IMP3 | Epic 4 | Status metrics details |
| FR-IMP4 | Epic 3 | Error handling sequence |
| FR24 | Epic 6 | Detect PDF documents in groups |
| FR25 | Epic 6 | Extract text from PDFs (unpdf) |
| FR26 | Epic 6 | Parse PIX receipt data fields |
| FR27 | Epic 6 | Validate receipt data (Zod) |
| FR28 | Epic 6 | Store receipts in Supabase |
| FR29 | Epic 6 | Send confirmation to control group |
| FR30 | Epic 6 | Handle malformed documents gracefully |
| FR31 | Epic 6 | Detect image screenshots in groups |
| FR32 | Epic 6 | Extract data from images (Claude Haiku) |
| FR33 | Epic 6 | Unified processing pipeline |
| FR34 | Epic 6 | Deduplication by EndToEnd ID |
| FR35 | Epic 6 | Notify control group on extraction failures |
| FR36 | Epic 6 | Store raw PDF/image files in Supabase |

**Total:** 39 FRs covered across 6 epics

## Epic List

### Epic 1: Bot Foundation & Connection

**Goal:** Bot connects to WhatsApp, maintains persistent session across restarts, sends messages with anti-detection behavior, and knows to ignore the control group.

**User Outcome:** The bot is running, connected, stays connected, and sends messages safely without getting banned.

**FRs Covered:** FR9, FR10, FR11, FR12, FR14, FR15, FR16, FR-IMP1

**Key NFRs:** NFR1 (99% uptime), NFR2 (persist across restarts), NFR3 (auto-recover <60s), NFR5 (PM2 restart), NFR14-15 (timing parameters), NFR17 (startup <30s)

**Implementation Notes:**
- Project initialization from Architecture (npm init, dependencies)
- Health endpoint on port 3000 for UptimeRobot
- Router must identify control group by name pattern from day 1
- Anti-detection (chaos.ts) built as standalone utility then integrated

---

### Epic 2: Price Quoting with Graceful Degradation

**Goal:** Bot detects price trigger keywords, fetches Binance prices, responds with formatted quotes, and handles API failures gracefully with stall messages.

**User Outcome:** Clients ask "preço" and get "R$5,82" automatically. If Binance is down, they get "Checking prices, one moment..." instead of wrong data.

**FRs Covered:** FR1, FR2, FR3, FR4, FR20, FR21, FR-IMP2

**Key NFRs:** NFR10 (Binance <2s or fallback), NFR16 (<100 msgs/day)

**Implementation Notes:**
- Trigger keywords: "preço", "cotação" (configurable in triggers.ts)
- Result type pattern for Binance service
- Stall message is human-like, buys time for retry
- Price format: R$X,XX (Brazilian Portuguese style)

---

### Epic 3: Error Handling & Safety

**Goal:** Bot auto-pauses on critical unrecoverable errors and auto-recovers when transient errors resolve.

**User Outcome:** If something goes seriously wrong, the bot stops and alerts Daniel instead of causing damage. It recovers automatically when possible.

**FRs Covered:** FR22, FR23, FR-IMP4

**Key NFRs:** NFR3 (recover <60s), NFR13 (log all API failures)

**Implementation Notes:**
- Error sequence: detect → stall → retry → (success? recover) OR (fail? alert → auto-pause)
- Critical errors = auto-pause + control group notification
- Transient errors = retry with exponential backoff
- This epic ensures "100% price accuracy" - one wrong price = failure

---

### Epic 4: CIO Control Interface

**Goal:** Daniel can control and monitor bot behavior through the dedicated control group.

**User Outcome:** Daniel types "pause Binance group" and the bot stops responding there. "status" shows activity summary with counts and health.

**FRs Covered:** FR5, FR6, FR7, FR8, FR-IMP3

**Key NFRs:** NFR4 (notify within 30s of disconnect)

**Implementation Notes:**
- Pause/resume per group via control group commands
- Status includes: message counts, group activity, system health
- Status notifications: online, offline, errors, recoveries

---

### Epic 5: Interaction Logging

**Goal:** All price quote interactions are logged to Excel Online for audit trail.

**User Outcome:** Daniel wakes up and checks the spreadsheet - every overnight interaction is there with timestamps.

**FRs Covered:** FR17, FR18, FR19

**Key NFRs:** NFR11 (queue in Supabase if Graph API unavailable)

**Implementation Notes:**
- Log entries: timestamp, group name, client identifier, quote given
- MS Graph API with OAuth2 app authentication
- Queue locally in Supabase if Excel Online temporarily unavailable

---

### Epic 6: Receipt Processing & Storage

**Goal:** Bot receives PIX transfer receipts (PDFs and screenshots), extracts transaction data, deduplicates by EndToEnd ID, stores both extracted data and raw files in Supabase, and notifies CIO only on failures.

**User Outcome:** Clients send payment receipts and the bot silently processes and stores them. Daniel only gets notified if something goes wrong. Raw files are preserved for audit.

**FRs Covered:** FR24, FR25, FR26, FR27, FR28, FR29, FR30, FR31, FR32, FR33, FR34, FR35, FR36

**Key NFRs:** NFR18 (PDF <5s), NFR19 (snake_case), NFR20 (anti-detection timing), NFR21 (Image <10s), NFR22 (cost tracking)

**Implementation Notes:**
- Uses `unpdf` for PDF text extraction
- Uses OpenRouter Claude Haiku Vision API for image OCR
- Unified pipeline: router detects document/image → handler delegates to appropriate extractor
- Supabase `receipts` table with `end_to_end_id` unique constraint for deduplication
- Raw files stored in Supabase Storage, URL referenced in receipts table
- Only notifies control group on extraction failures (no spam on success)
- Follows existing Result<T> pattern and anti-detection timing

---

## Epic 1: Bot Foundation & Connection

Bot connects to WhatsApp, maintains persistent session across restarts, sends messages with anti-detection behavior, and knows to ignore the control group.

### Story 1.1: Project Setup & Basic Connection

As a **developer**,
I want **the project initialized with Baileys connection and health endpoint**,
So that **I have a working foundation to build upon**.

**Acceptance Criteria:**

**Given** the project is initialized with npm and dependencies installed
**When** I run `npm run dev`
**Then** the bot attempts to connect to WhatsApp via Baileys
**And** a health endpoint responds on port 3000 with `{"status": "ok"}`

**Given** the bot process starts
**When** Baileys prompts for authentication
**Then** a pairing code is displayed in the console for phone linking

**Given** the phone is linked successfully
**When** the connection is established
**Then** the bot logs "Connected to WhatsApp" via structured logger

---

### Story 1.2: Session Persistence in Supabase

As a **CIO**,
I want **the bot session to survive VPS restarts**,
So that **I don't need to re-authenticate every time the server reboots**.

**Acceptance Criteria:**

**Given** a Supabase project is configured with auth_state table
**When** the bot connects successfully
**Then** the auth credentials are stored encrypted in Supabase

**Given** the bot process restarts
**When** Baileys initializes
**Then** it loads existing auth state from Supabase
**And** reconnects without requiring new authentication

**Given** the auth state is corrupted or missing
**When** the bot starts
**Then** it prompts for fresh authentication via pairing code
**And** stores the new credentials in Supabase

---

### Story 1.3: Auto-Reconnect with State Tracking

As a **CIO**,
I want **the bot to reconnect automatically after network issues**,
So that **temporary outages don't require manual intervention**.

**Acceptance Criteria:**

**Given** the bot is connected
**When** the WebSocket connection drops
**Then** the bot attempts reconnection with exponential backoff (1s, 2s, 4s, 8s, max 30s)

**Given** reconnection succeeds within 60 seconds
**When** the connection is restored
**Then** the bot logs "Reconnected" and continues normal operation

**Given** the bot transitions to disconnected state
**When** the disconnection is detected
**Then** the internal state tracker updates to "disconnected"
**And** the event is logged with timestamp

**Given** disconnection persists beyond 30 seconds
**When** the state remains "disconnected"
**Then** a notification is queued for the control group (FR12)

---

### Story 1.4: Control Group Identification & Router

As a **developer**,
I want **the router to identify the control group and skip price responses**,
So that **CIO commands aren't treated as price requests**.

**Acceptance Criteria:**

**Given** a group name contains the configured pattern (e.g., "GRUPO DE CONTROLE")
**When** the bot receives a message from that group
**Then** the router flags it as `isControlGroup: true`

**Given** a message arrives from the control group
**When** the router dispatches the message
**Then** it is NOT sent to the price handler
**And** it is routed to the control handler instead

**Given** a message arrives from a non-control group
**When** the router dispatches the message
**Then** it may be sent to the price handler (if trigger matches)

**Given** the control group pattern is configurable via environment variable
**When** `CONTROL_GROUP_PATTERN` is set
**Then** the router uses that pattern for matching

---

### Story 1.5: Chaotic Timing Utility

As a **CIO**,
I want **the bot to delay responses with randomized timing**,
So that **WhatsApp doesn't detect automated behavior**.

**Acceptance Criteria:**

**Given** the chaos utility is called with default parameters
**When** a delay is requested
**Then** the delay is between 3-15 seconds (NFR14)
**And** the delay uses multi-layer randomization (not simple random)

**Given** multiple messages arrive in sequence
**When** chaotic delays are applied
**Then** each delay is independently randomized
**And** no two consecutive delays are identical

**Given** the chaos utility returns
**When** the promise resolves
**Then** the actual delay time is logged for debugging

---

### Story 1.6: Typing Indicator & Message Sending

As a **CIO**,
I want **the bot to show typing before sending messages**,
So that **responses appear human-like**.

**Acceptance Criteria:**

**Given** the bot is about to send a message
**When** the sendWithAntiDetection function is called
**Then** it first triggers "composing" presence for 1-4 seconds (NFR15)
**And** then applies chaotic delay from Story 1.5
**And** then sends the actual message

**Given** typing indicator is shown
**When** the duration expires
**Then** "paused" presence is sent before the message

**Given** message sending fails
**When** an error occurs
**Then** the error is logged but not thrown (Result type)
**And** the function returns `{ok: false, error: "..."}`

---

## Epic 2: Price Quoting with Graceful Degradation

Bot detects price trigger keywords, fetches Binance prices, responds with formatted quotes, and handles API failures gracefully with stall messages.

### Story 2.1: Trigger Detection

As a **client**,
I want **the bot to recognize when I'm asking for a price**,
So that **I get a quote without using exact commands**.

**Acceptance Criteria:**

**Given** a message contains "preço" (case-insensitive)
**When** the router processes the message
**Then** it is flagged as a price trigger

**Given** a message contains "cotação" (case-insensitive)
**When** the router processes the message
**Then** it is flagged as a price trigger

**Given** the trigger keywords are defined in triggers.ts
**When** new keywords need to be added
**Then** they can be configured without code changes to handlers

**Given** a message from a non-control group contains a trigger
**When** the router dispatches
**Then** the message is sent to the price handler

**Given** a message does NOT contain any trigger keywords
**When** the router processes the message
**Then** it is NOT sent to the price handler

---

### Story 2.2: Binance Price Service

As a **developer**,
I want **a service that fetches USDT/BRL spot price from Binance**,
So that **the bot has accurate, real-time pricing data**.

**Acceptance Criteria:**

**Given** the Binance public API is available
**When** `fetchPrice()` is called
**Then** it returns `{ok: true, data: number}` with the current USDT/BRL rate

**Given** the Binance API responds within 2 seconds (NFR10)
**When** the request completes
**Then** the price is returned immediately

**Given** the Binance API does not respond within 2 seconds
**When** the timeout triggers
**Then** it returns `{ok: false, error: "Binance timeout"}`

**Given** the Binance API returns an error
**When** the request fails
**Then** it returns `{ok: false, error: "..."}` with the error message
**And** the error is logged via structured logger

**Given** the service is called
**When** any outcome occurs
**Then** the latency is logged for monitoring

---

### Story 2.3: Price Response with Formatting

As a **client**,
I want **to receive the price formatted in Brazilian style**,
So that **I can read it naturally without conversion**.

**Acceptance Criteria:**

**Given** Binance returns price 5.82
**When** the price is formatted
**Then** the output is "R$5,82" (comma as decimal separator)

**Given** Binance returns price 5.8234
**When** the price is formatted
**Then** the output is "R$5,82" (truncated to 2 decimal places)

**Given** a price trigger is detected and Binance returns successfully
**When** the price handler executes
**Then** the formatted price is sent to the group using sendWithAntiDetection (from Epic 1)

**Given** the response is sent
**When** the message is delivered
**Then** the handler returns `{ok: true, data: {price, group, timestamp}}`

---

### Story 2.4: Graceful Degradation (Stall & Retry)

As a **CIO**,
I want **the bot to send a stall message instead of failing silently**,
So that **clients know their request was received and no wrong price is ever sent**.

**Acceptance Criteria:**

**Given** Binance API fails on first attempt
**When** the price handler detects `{ok: false}`
**Then** it sends a human-like stall message: "Um momento, verificando..." (with anti-detection)

**Given** a stall message was sent
**When** the handler retries Binance (up to 2 retries)
**Then** each retry is spaced 2 seconds apart

**Given** retry succeeds
**When** the price is fetched
**Then** the formatted price is sent as a follow-up message
**And** the handler logs "Recovered after retry"

**Given** all retries fail
**When** the handler exhausts attempts
**Then** NO price message is sent (never send wrong data)
**And** the handler returns `{ok: false, error: "Price unavailable after retries"}`
**And** the failure is logged for Epic 3 error handling to process

---

## Epic 3: Error Handling & Safety

Bot auto-pauses on critical unrecoverable errors and auto-recovers when transient errors resolve.

### Story 3.1: Error Classification & Tracking

As a **developer**,
I want **errors classified as transient or critical**,
So that **the system knows how to respond appropriately**.

**Acceptance Criteria:**

**Given** Binance API returns a timeout or 5xx error
**When** the error is classified
**Then** it is marked as "transient" (recoverable)

**Given** Binance API returns consistent failures (3+ in a row)
**When** the error is classified
**Then** it is escalated to "critical" (unrecoverable without intervention)

**Given** WhatsApp connection drops
**When** the error is classified
**Then** it is marked as "transient" (auto-reconnect will handle)

**Given** WhatsApp returns "logged out" or "banned" status
**When** the error is classified
**Then** it is marked as "critical" (requires manual intervention)

**Given** any error occurs
**When** it is logged
**Then** the log includes: error type, classification, timestamp, context (NFR13)

---

### Story 3.2: Auto-Pause on Critical Errors

As a **CIO**,
I want **the bot to stop operating when something critical happens**,
So that **it doesn't cause damage by continuing blindly**.

**Acceptance Criteria:**

**Given** a critical error is detected
**When** the error handler processes it
**Then** the bot sets global state to "paused"
**And** a notification is sent to control group: "🚨 CRITICAL: [error description]. Bot paused."

**Given** the bot is in paused state
**When** a price trigger arrives
**Then** the bot does NOT respond (silent)

**Given** auto-pause was triggered
**When** the CIO checks status
**Then** the status shows "paused" with reason and timestamp

**Given** multiple critical errors occur in sequence
**When** notifications would spam the control group
**Then** only the first notification is sent within a 5-minute window

**Implementation Note:** Pause state is stored in-memory via `state.ts`, not persisted to Supabase. On process restart, state resets to "running" (PM2 restart = fresh start). This is intentional - if the bot crashes and restarts, it should attempt normal operation.

---

### Story 3.3: Auto-Recovery from Transient Errors

As a **CIO**,
I want **the bot to recover automatically from temporary issues**,
So that **I don't need to intervene for every hiccup**.

**Acceptance Criteria:**

**Given** a transient error occurred and was logged
**When** the next successful operation completes
**Then** the error counter resets
**And** the bot logs "Recovered from transient error"

**Given** transient errors accumulate (3+ in 60 seconds)
**When** the threshold is breached
**Then** the error is escalated to critical
**And** auto-pause is triggered (Story 3.2)

**Given** the bot was auto-paused due to escalated transient errors
**When** 5 minutes pass without manual intervention
**Then** the bot attempts one auto-recovery cycle
**And** if successful, resumes normal operation with control group notification: "✅ Auto-recovered"

**Given** auto-recovery fails
**When** the retry is unsuccessful
**Then** the bot remains paused
**And** sends notification: "⚠️ Auto-recovery failed. Manual intervention required."

---

## Epic 4: CIO Control Interface

Daniel can control and monitor bot behavior through the dedicated control group.

### Story 4.1: Pause Command

As a **CIO**,
I want **to pause the bot for a specific group**,
So that **I can handle sensitive negotiations personally**.

**Acceptance Criteria:**

**Given** Daniel sends "pause [group name]" in the control group
**When** the control handler processes the message
**Then** the specified group is added to the paused list
**And** the bot responds: "⏸️ Paused for [group name]"

**Given** a group is paused
**When** a price trigger arrives from that group
**Then** the bot does NOT respond

**Given** Daniel sends "pause" without a group name
**When** the control handler processes the message
**Then** ALL monitored groups are paused (global pause)
**And** the bot responds: "⏸️ All groups paused"

**Given** the group name is fuzzy (partial match)
**When** Daniel sends "pause binance"
**Then** the bot matches groups containing "binance" (case-insensitive)
**And** confirms which group was paused

---

### Story 4.2: Resume Command

As a **CIO**,
I want **to resume bot activity for a paused group**,
So that **the bot continues handling requests after I'm done**.

**Acceptance Criteria:**

**Given** Daniel sends "resume [group name]" in the control group
**When** the control handler processes the message
**Then** the specified group is removed from the paused list
**And** the bot responds: "▶️ Resumed for [group name]"

**Given** a group is resumed
**When** a price trigger arrives from that group
**Then** the bot responds normally with anti-detection timing

**Given** Daniel sends "resume" without a group name
**When** the control handler processes the message
**Then** ALL groups are resumed (global resume)
**And** the bot responds: "▶️ All groups resumed"

**Given** the bot was auto-paused due to critical error
**When** Daniel sends "resume"
**Then** the bot resumes AND clears the error state
**And** responds: "▶️ Resumed. Error state cleared."

---

### Story 4.3: Status Command

As a **CIO**,
I want **to check the bot's current status and activity**,
So that **I know it's working without checking each group**.

**Acceptance Criteria:**

**Given** Daniel sends "status" in the control group
**When** the control handler processes the message
**Then** the bot responds with a status summary including:
- Connection state (connected/disconnected)
- Uptime since last restart
- Messages sent today (count)
- Active/paused groups list
- Last activity timestamp
- Error state (if any)

**Given** the bot has sent 47 messages today across 3 groups
**When** Daniel checks status
**Then** the response shows: "📊 47 quotes today | 3 groups active | Last: 2min ago"

**Given** the bot is paused (manually or auto)
**When** Daniel checks status
**Then** the response clearly shows: "⏸️ PAUSED: [reason]"

**Given** there are no recent errors
**When** Daniel checks status
**Then** the response shows: "✅ All systems normal"

---

### Story 4.4: Status Notifications

As a **CIO**,
I want **to receive automatic notifications about bot state changes**,
So that **I'm informed without having to check manually**.

**Acceptance Criteria:**

**Given** the bot connects successfully on startup
**When** the connection is established
**Then** the control group receives: "🟢 eNorBOT online"

**Given** the bot loses connection
**When** disconnection persists beyond 30 seconds (NFR4)
**Then** the control group receives: "🔴 Disconnected. Attempting reconnect..."

**Given** the bot reconnects after disconnection
**When** the connection is restored
**Then** the control group receives: "🟢 Reconnected"

**Given** an auto-recovery completes successfully
**When** the bot resumes normal operation
**Then** the control group receives: "✅ Auto-recovered from [error type]"

**Given** notifications are sent
**When** they use sendWithAntiDetection
**Then** they include typing indicator and chaotic timing (same as price responses)

---

## Epic 5: Interaction Logging

All price quote interactions are logged to Excel Online for audit trail.

### Story 5.1: Microsoft Graph Authentication

As a **developer**,
I want **the bot to authenticate with Microsoft Graph API**,
So that **it can write to Excel Online**.

**Acceptance Criteria:**

**Given** Azure AD app credentials are configured in environment variables
**When** the bot starts
**Then** it obtains an OAuth2 access token for Microsoft Graph

**Given** the access token is valid
**When** the bot needs to write to Excel
**Then** it uses the cached token

**Given** the access token expires
**When** a Graph API request is made
**Then** the token is refreshed automatically before expiry (NFR9)
**And** the request proceeds without error

**Given** token refresh fails
**When** the error is detected
**Then** it is logged as a transient error
**And** the logging request is queued for retry

---

### Story 5.2: Excel Logging Service

As a **CIO**,
I want **every price quote logged to my Excel spreadsheet**,
So that **I have a complete audit trail of all interactions**.

**Acceptance Criteria:**

**Given** a price quote is successfully sent
**When** the logging service is called
**Then** a new row is appended to the configured Excel worksheet

**Given** a log entry is created
**When** it is written to Excel
**Then** it contains: timestamp, group name, client phone/name, quote value (FR18)

**Given** the Excel file ID is configured via environment variable
**When** the service initializes
**Then** it validates the file exists and is accessible

**Given** Excel write succeeds
**When** the service returns
**Then** it returns `{ok: true, data: {rowNumber}}`

**Given** Excel write fails
**When** the service returns
**Then** it returns `{ok: false, error: "..."}` (never throws)
**And** the log entry is queued for retry (Story 5.3)

---

### Story 5.3: Offline Queue & Sync

As a **CIO**,
I want **logs to be preserved even if Excel is temporarily unavailable**,
So that **no interactions are lost**.

**Acceptance Criteria:**

**Given** Excel Online is unavailable (Graph API timeout/error)
**When** a log entry fails to write
**Then** it is stored in Supabase `log_queue` table

**Given** entries exist in the log queue
**When** the next successful Excel write occurs
**Then** queued entries are synced to Excel in order
**And** successfully synced entries are removed from queue

**Given** the queue has entries
**When** a periodic sync runs (every 5 minutes)
**Then** it attempts to flush the queue to Excel

**Given** the queue grows beyond 100 entries
**When** the threshold is exceeded
**Then** a warning is sent to control group: "⚠️ Excel sync backlog: 100+ entries queued"

**Given** Daniel reviews the spreadsheet (FR19)
**When** he opens Excel Online
**Then** all logged interactions are visible in chronological order

---

### Story 5.4: Auth State Resilience & Local Backup

As a **CIO**,
I want **the bot's WhatsApp session to survive temporary database outages**,
So that **network hiccups don't force me to re-pair the phone**.

**Acceptance Criteria:**

**Given** auth state is successfully saved to Supabase
**When** the save completes
**Then** a local backup is also written to the VPS filesystem

**Given** Supabase is unreachable when loading auth state
**When** the bot attempts to restore session
**Then** it falls back to the local file backup
**And** logs "Using local auth state backup"

**Given** the bot needs to reconnect after disconnection
**When** Supabase health check fails
**Then** reconnection is delayed (not attempted with invalid state)

**Given** Supabase connectivity is intermittent
**When** loading auth state fails
**Then** the bot retries with exponential backoff up to 5 minutes

**Given** Supabase has been unreachable for 60+ seconds
**When** the threshold is exceeded
**Then** a notification is queued to control group

**Given** auth state could not be loaded from any source
**When** the bot would normally request a pairing code
**Then** it waits for database recovery instead of re-pairing

---

## Epic 6: Receipt Processing & Storage

Bot receives PIX transfer receipts (PDFs and screenshots), extracts transaction data, deduplicates by EndToEnd ID, stores both extracted data and raw files in Supabase, and notifies CIO only on failures.

### Story 6.1: Receipt Detection in Router

As a **developer**,
I want **the router to detect when a PDF or image is received in a monitored group**,
So that **receipt documents are dispatched to the appropriate handler**.

**Acceptance Criteria:**

**Given** a message arrives in a monitored group
**When** the message contains a document with MIME type `application/pdf`
**Then** the router flags it as `isReceipt: true` and `receiptType: 'pdf'`

**Given** a message arrives in a monitored group
**When** the message contains an image (MIME type `image/jpeg`, `image/png`, `image/webp`)
**Then** the router flags it as `isReceipt: true` and `receiptType: 'image'`

**Given** a receipt message is detected
**When** the router dispatches the message
**Then** it is sent to the receipt handler (not the price handler)

**Given** a document/image arrives from the control group
**When** the router processes the message
**Then** it is NOT sent to the receipt handler (control group excluded)

---

### Story 6.2: PDF Text Extraction Service

As a **developer**,
I want **a service that extracts text from PDF files using unpdf**,
So that **receipt data can be parsed from PDF documents**.

**Acceptance Criteria:**

**Given** a PDF buffer is provided to the service
**When** `extractPdfText()` is called
**Then** it returns `{ok: true, data: string}` with the extracted text

**Given** the PDF extraction completes within 5 seconds (NFR18)
**When** the extraction succeeds
**Then** the text is returned immediately

**Given** the PDF extraction exceeds 5 seconds
**When** the timeout triggers
**Then** it returns `{ok: false, error: "PDF extraction timeout"}`

**Given** the PDF is malformed or unreadable
**When** extraction fails
**Then** it returns `{ok: false, error: "..."}` with the error message
**And** the error is logged via structured logger

---

### Story 6.3: Image OCR Service (OpenRouter)

As a **developer**,
I want **a service that extracts receipt data from images using OpenRouter Claude Haiku Vision**,
So that **screenshot receipts can be processed**.

**Acceptance Criteria:**

**Given** an image buffer and MIME type are provided
**When** `extractImageReceipt()` is called
**Then** it sends the image to OpenRouter Claude Haiku 4.5 with a structured prompt
**And** returns `{ok: true, data: ReceiptData}` on success

**Given** the OCR request completes within 10 seconds (NFR21)
**When** Claude returns valid JSON
**Then** the parsed receipt data is returned immediately

**Given** the OCR request exceeds 10 seconds
**When** the timeout triggers
**Then** it returns `{ok: false, error: "OCR timeout"}`

**Given** Claude cannot extract receipt data from the image
**When** the response indicates failure
**Then** it returns `{ok: false, error: "Could not extract receipt data"}`

**Given** the OpenRouter API key is configured via `OPENROUTER_API_KEY`
**When** the service initializes
**Then** it uses the configured API key for authentication

**Given** any OCR request is made
**When** the request completes (success or failure)
**Then** the cost/tokens are logged for monitoring (NFR22)

---

### Story 6.4: Receipt Data Parsing & Validation

As a **developer**,
I want **receipt data parsed and validated using Zod schemas**,
So that **only valid receipt data is stored**.

**Acceptance Criteria:**

**Given** extracted text from a PDF
**When** `parseReceiptText()` is called
**Then** it extracts: valor, dataHora, tipo, identificador (EndToEnd), recebedor, pagador

**Given** the PIX receipt contains "Valor: R$ 300.000,00"
**When** the valor is parsed
**Then** it is converted to centavos: 30000000

**Given** the PIX receipt contains "Data/Hora 19/01/2026 17:10:23"
**When** the dataHora is parsed
**Then** it is converted to ISO date string

**Given** parsed receipt data is provided
**When** `ReceiptDataSchema.safeParse()` is called
**Then** it validates all required fields (valor, dataHora, identificador, recebedor.nome, recebedor.cpfCnpj, pagador.nome, pagador.cpfCnpj)

**Given** validation fails
**When** required fields are missing
**Then** it returns the validation errors for logging

---

### Story 6.5: Receipt Storage in Supabase

As a **CIO**,
I want **validated receipts stored in Supabase**,
So that **I have a permanent record of all payment confirmations**.

**Acceptance Criteria:**

**Given** a validated ReceiptData object
**When** `storeReceipt()` is called
**Then** a new row is inserted into the `receipts` table

**Given** the receipts table schema
**When** a receipt is stored
**Then** it contains: id (uuid), end_to_end_id (unique), valor, data_hora, tipo, recebedor (jsonb), pagador (jsonb), raw_file_url, source_type, group_jid, created_at

**Given** a receipt with the same EndToEnd ID already exists
**When** `storeReceipt()` is called (FR34 deduplication)
**Then** it returns `{ok: false, error: "Duplicate receipt"}`
**And** the duplicate is NOT inserted

**Given** storage succeeds
**When** the insert completes
**Then** it returns `{ok: true, data: {id, end_to_end_id}}`

---

### Story 6.6: Raw File Storage

As a **CIO**,
I want **the original PDF/image files stored in Supabase Storage**,
So that **I can review the original documents if needed**.

**Acceptance Criteria:**

**Given** a PDF or image buffer is received
**When** `storeRawFile()` is called
**Then** the file is uploaded to Supabase Storage bucket `receipts`

**Given** the file is uploaded successfully
**When** the upload completes
**Then** it returns the public URL for the file
**And** the URL is stored in the `raw_file_url` column of the receipt record

**Given** the file upload fails
**When** Supabase Storage is unavailable
**Then** the receipt is still stored with `raw_file_url: null`
**And** the failure is logged for retry

**Given** files are stored
**When** naming the file
**Then** the filename format is: `{end_to_end_id}.{extension}`

---

### Story 6.7: Receipt Handler (Unified Pipeline)

As a **developer**,
I want **a unified receipt handler that processes both PDFs and images**,
So that **the router has a single entry point for receipt processing**.

**Acceptance Criteria:**

**Given** a receipt message with type 'pdf'
**When** the receipt handler processes it
**Then** it: downloads the document → extracts text via unpdf → parses receipt data → validates → stores

**Given** a receipt message with type 'image'
**When** the receipt handler processes it
**Then** it: downloads the image → sends to OpenRouter OCR → validates response → stores

**Given** PDF text extraction succeeds but parsing fails
**When** the handler detects parsing failure
**Then** it falls back to OpenRouter OCR for the PDF (treating it as an image)

**Given** receipt processing succeeds
**When** all steps complete
**Then** the handler returns `{ok: true, data: {receiptId, endToEndId}}`
**And** NO notification is sent to control group (silent success)

**Given** receipt processing fails at any step
**When** the error is unrecoverable
**Then** the handler returns `{ok: false, error: "..."}`
**And** a notification IS sent to control group: "⚠️ Receipt processing failed: [reason]" (FR35)

---

### Story 6.8: Control Group Failure Notifications

As a **CIO**,
I want **to be notified when receipt processing fails**,
So that **I can manually review problematic receipts**.

**Acceptance Criteria:**

**Given** receipt extraction fails
**When** the failure notification is sent
**Then** it includes: group name, sender, failure reason, timestamp

**Given** the notification format
**When** sent to control group
**Then** the message is: "⚠️ Receipt failed | [Group] | [Sender] | [Reason]"

**Given** notifications are sent
**When** using sendWithAntiDetection
**Then** they include typing indicator and chaotic timing (NFR20)

**Given** multiple failures occur in quick succession
**When** notifications would spam the control group
**Then** only the first notification is sent within a 5-minute window (similar to Epic 3)
