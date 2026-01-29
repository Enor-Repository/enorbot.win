# eNorBOT Architecture

## Executive Summary

eNorBOT is a WhatsApp bot service that provides real-time USDT/BRL OTC price quotes to client groups. Built with TypeScript and Node.js, it uses the Baileys library for WhatsApp connectivity, integrates with Binance for pricing data, and persists session state via Supabase.

**Key Capabilities:**
- Real-time USDT/BRL price quotes from Binance API
- WhatsApp group monitoring with trigger word detection ("preço", "cotação")
- CIO control interface (pause/resume/status/training commands)
- Auto-pause on critical errors with scheduled recovery
- Excel Online logging via MS Graph API with offline queue
- Receipt processing with AI-powered OCR (Epic 6)
- Message history logging to Supabase
- Tronscan transaction tracking

## Technology Stack

| Category | Technology | Version | Purpose |
|----------|------------|---------|---------|
| **Runtime** | Node.js | 20+ | JavaScript runtime |
| **Language** | TypeScript | 5.9+ | Type-safe development |
| **WhatsApp** | Baileys | 7.0.0-rc.9 | WhatsApp Web API client |
| **Database** | Supabase | 2.90+ | Session persistence (PostgreSQL) |
| **Validation** | Zod | 4.3+ | Runtime schema validation |
| **HTTP Client** | Native fetch | - | Binance API calls |
| **Auth** | @azure/msal-node | 3.8+ | MS Graph OAuth2 |
| **PDF** | unpdf | 1.4+ | Receipt PDF extraction |
| **Process Manager** | PM2 | - | Production deployment |
| **Testing** | Vitest | 4.0+ | Unit testing |

## Architecture Pattern

**Event-Driven Message Router** with modular service architecture.

```
┌─────────────────────────────────────────────────────────────────┐
│                         WHATSAPP                                │
└─────────────────────────┬───────────────────────────────────────┘
                          │ Baileys WebSocket
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CONNECTION LAYER                              │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │ connection  │  │  authState   │  │     notifications       │ │
│  │   .ts       │──│    .ts       │  │        .ts              │ │
│  └──────┬──────┘  └──────────────┘  └─────────────────────────┘ │
└─────────┼───────────────────────────────────────────────────────┘
          │ messages.upsert event
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ROUTER LAYER                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                     router.ts                                ││
│  │  isControlGroup? ─────► CONTROL_HANDLER                     ││
│  │  isPriceTrigger? ─────► PRICE_HANDLER                       ││
│  │  hasTronscan?    ─────► TRONSCAN_HANDLER                    ││
│  │  isReceipt?      ─────► RECEIPT_HANDLER                     ││
│  │  trainingMode?   ─────► OBSERVE_ONLY                        ││
│  │  else            ─────► IGNORE                              ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────┬──────────┬─────────────┬────────────┬────────────────┘
          │          │             │            │
          ▼          ▼             ▼            ▼
┌──────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│   CONTROL    │ │  PRICE   │ │ TRONSCAN │ │ RECEIPT  │
│   HANDLER    │ │ HANDLER  │ │ HANDLER  │ │ HANDLER  │
│ (control.ts) │ │(price.ts)│ │(tronscan)│ │(receipt) │
└──────┬───────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘
       │              │            │            │
       ▼              ▼            ▼            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SERVICE LAYER                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────────────┐ │
│  │ binance  │ │ supabase │ │  excel   │ │    openrouter       │ │
│  │   .ts    │ │   .ts    │ │   .ts    │ │      .ts            │ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────────────┐ │
│  │ errors   │ │autoPause │ │autoRecov.│ │  messageHistory     │ │
│  │   .ts    │ │   .ts    │ │   .ts    │ │      .ts            │ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                         │
│  │ logQueue │ │ graph    │ │transient │                         │
│  │   .ts    │ │   .ts    │ │ Errors   │                         │
│  └──────────┘ └──────────┘ └──────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### Router Layer (`src/bot/router.ts`)

Pure function that classifies and routes incoming messages.

**Route Destinations:**

| Destination | Trigger | Action |
|-------------|---------|--------|
| `CONTROL_HANDLER` | Control group message | Process admin commands |
| `PRICE_HANDLER` | Contains "preço" or "cotação" | Fetch and send price |
| `TRONSCAN_HANDLER` | Contains tronscan.org link | Update Excel with tx hash |
| `RECEIPT_HANDLER` | PDF or image attachment | OCR processing |
| `OBSERVE_ONLY` | Training mode active | Log only, no response |
| `IGNORE` | No trigger detected | Skip processing |

**Routing Priority:**
1. Control group messages (always process, even when paused)
2. Training mode check (observe-only if enabled)
3. Price triggers
4. Tronscan links
5. Receipt attachments
6. Ignore (no match)

### State Management (`src/bot/state.ts`)

In-memory state tracking for bot operations. **All state resets on process restart** (PM2 restart = fresh state).

**State Categories:**

| Category | Fields | Persistence |
|----------|--------|-------------|
| Connection | `connectionStatus`, `lastConnected`, `reconnectAttempts` | Memory only |
| Error Pause | `operationalStatus`, `pauseReason`, `pausedAt` | Memory only |
| Per-Group Pause | `pausedGroups`, `globalPause` | Memory only |
| Activity | `messagesSentToday`, `lastActivityAt`, `startedAt` | Memory only |
| Training Mode | `trainingMode` | Memory only |
| Auth Tracking | `authStateEverLoaded` | Memory only |

### Handlers

#### Control Handler (`src/handlers/control.ts`)

**Commands:**

| Command | Action |
|---------|--------|
| `pause` | Pause all OTC groups |
| `pause <group>` | Pause specific group (fuzzy match) |
| `resume` | Resume all groups + clear error state |
| `resume <group>` | Resume specific group |
| `status` | Show bot status dashboard |
| `training on` | Enable observe-only mode |
| `training off` | Resume normal operations |

#### Price Handler (`src/handlers/price.ts`)

**Flow:**
1. Send instant acknowledgment ("Puxando o valor pra você, um momento...")
2. Fetch price from Binance API (2s timeout)
3. On success: Format as R$X,XX and send
4. On failure: Retry up to 2 times with 2s spacing
5. Log to Excel (fire-and-forget)
6. Record to message history

#### Tronscan Handler (`src/handlers/tronscan.ts`)

Extracts transaction hash from tronscan.org links and updates the corresponding Excel row with the `onchain_tx` value.

#### Receipt Handler (`src/handlers/receipt.ts`)

**Flow:**
1. Download media from WhatsApp
2. Extract text (PDF via unpdf, images via OpenRouter OCR)
3. Parse PIX data (end-to-end ID, valor, pagador, recebedor)
4. Validate and deduplicate by `end_to_end_id`
5. Store in Supabase `receipts` table
6. Upload raw file to Supabase Storage

## Data Architecture

### Database Schema (Supabase PostgreSQL)

#### `sessions` Table
Stores WhatsApp authentication state for session persistence.

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY DEFAULT 'default',
  auth_state JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### `log_queue` Table
Offline queue for Excel logging failures.

```sql
CREATE TABLE log_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL,
  group_name TEXT NOT NULL,
  group_id TEXT NOT NULL,
  client_identifier TEXT NOT NULL,
  volume_brl NUMERIC(12, 2),
  quote NUMERIC(12, 4),
  acquired_usdt NUMERIC(12, 2),
  onchain_tx TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'syncing', 'failed')),
  attempts INT DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### `receipts` Table
Validated PIX receipt data.

```sql
CREATE TABLE receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  end_to_end_id VARCHAR(100) UNIQUE NOT NULL,
  valor BIGINT NOT NULL,
  data_hora TIMESTAMPTZ NOT NULL,
  tipo VARCHAR(100),
  recebedor JSONB NOT NULL,
  pagador JSONB NOT NULL,
  raw_file_url VARCHAR(500),
  source_type VARCHAR(10) NOT NULL CHECK (source_type IN ('pdf', 'image')),
  group_jid VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Data Flow

#### Price Quote Flow

```
1. User sends "preço" in WhatsApp group
   │
2. Baileys receives message via WebSocket
   │
3. connection.ts receives 'messages.upsert' event
   │
4. router.ts checks:
   ├─ Is control group? NO
   ├─ Is training mode? NO
   ├─ Has price trigger? YES ("preço")
   └─ Route to PRICE_HANDLER
   │
5. price.ts handlePriceMessage():
   ├─ Send instant ack: "Puxando o valor..."
   ├─ Call binance.fetchPrice()
   │   └─ GET api.binance.com/api/v3/ticker/price?symbol=USDTBRL
   ├─ Format: R$X,XX
   ├─ Send response with anti-detection delay
   ├─ Log to Excel (fire-and-forget)
   └─ Log to message history (fire-and-forget)
```

#### Error Handling Flow

```
Binance API fails
   │
   ├─► Record failure (errors.ts)
   │
   ├─► Track transient error (transientErrors.ts)
   │   └─ Sliding window: 10 errors in 60s = escalate
   │
   ├─► Retry up to 2 times with 2s delay
   │
   └─► If 3 consecutive failures OR 10 in 60s:
       ├─► Trigger auto-pause (autoPause.ts)
       ├─► Notify control group
       └─► Schedule auto-recovery in 5 min (autoRecovery.ts)
```

## API Integrations

| Service | Purpose | Auth | Timeout |
|---------|---------|------|---------|
| **Binance API** | Price quotes | None (public) | 2s |
| **MS Graph API** | Excel logging | OAuth2 (MSAL) | - |
| **OpenRouter API** | Receipt OCR | API Key | - |
| **Supabase** | Data persistence | Service Role Key | - |

### Binance API
- **Endpoint**: `https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL`
- **Response**: `{ "symbol": "USDTBRL", "price": "5.82340000" }`

### MS Graph API (Excel)
- **Auth**: OAuth2 client credentials flow
- **Endpoint**: `graph.microsoft.com/v1.0/sites/{siteId}/drives/{driveId}/items/{fileId}/workbook/tables/{tableName}/rows`

### OpenRouter API
- **Endpoint**: `https://openrouter.ai/api/v1/chat/completions`
- **Model**: Claude Haiku (vision)

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VPS (181.215.135.75)                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                        PM2                             │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │              enorbot                             │  │  │
│  │  │  • script: dist/index.js                        │  │  │
│  │  │  • cwd: /opt/enorbot                            │  │  │
│  │  │  • max_memory_restart: 500M                     │  │  │
│  │  │  • max_restarts: 10                             │  │  │
│  │  │  • restart_delay: 5000ms                        │  │  │
│  │  │  • logs: /opt/enorbot/logs/                     │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
    ┌───────────────┐ ┌───────────┐ ┌───────────────┐
    │   Supabase    │ │  Binance  │ │  MS Graph     │
    │   (Postgres)  │ │   API     │ │  (Excel)      │
    └───────────────┘ └───────────┘ └───────────────┘
```

## Error Handling Strategy

### Classification

| Type | Examples | Action |
|------|----------|--------|
| **Transient** | Network timeout, 5xx errors | Retry with backoff |
| **Critical** | Auth failure, 4xx errors, escalation | Auto-pause + notify |
| **Terminal** | Logged out (401) | Clear auth, exit |

### Escalation Thresholds
- **Consecutive failures**: 3 failures trigger auto-pause
- **Frequency threshold**: 10 errors in 60s trigger auto-pause
- **Auto-recovery**: 5 minutes after pause

### Manual Override
CIO can always use `resume` in control group to clear pause state.

## Non-Functional Requirements

| NFR | Requirement | Implementation |
|-----|-------------|----------------|
| NFR1 | Reconnect within 60s | Exponential backoff, PM2 restart |
| NFR2 | No data loss on restart | Supabase session persistence |
| NFR3 | Auto-pause on critical errors | 3 consecutive or 10 in 60s |
| NFR4 | Notify after 30s disconnect | Control group notification |
| NFR10 | Binance <2s timeout | AbortController with 2s timeout |

## Testing Strategy

- **Framework**: Vitest 4.0+
- **Pattern**: Unit tests co-located with source (`*.test.ts`)
- **Coverage**: All services and handlers have test files
- **Run**: `npm test` (single run) or `npm run test:watch` (watch mode)

---

*Documentation generated: 2026-01-27*
*Scan level: Deep*
*Workflow: document-project v1.2.0*
