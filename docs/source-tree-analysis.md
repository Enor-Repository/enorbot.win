# eNorBOT Source Tree Analysis

## Directory Structure

```
eNorBOT/
├── src/                          # TypeScript source code
│   ├── index.ts                  # Entry point - startup, health endpoint, shutdown
│   ├── config.ts                 # Config validation with Zod (singleton pattern)
│   │
│   ├── bot/                      # WhatsApp bot layer
│   │   ├── connection.ts         # Baileys socket creation, reconnection, message routing
│   │   ├── connection.test.ts    # Connection tests
│   │   ├── authState.ts          # Baileys auth state adapter for Supabase
│   │   ├── router.ts             # Message routing (control/price/receipt/tronscan/ignore)
│   │   ├── router.test.ts        # Router tests
│   │   ├── state.ts              # In-memory state (connection, pause, activity, training)
│   │   ├── state.test.ts         # State tests
│   │   ├── notifications.ts      # Control group notifications queue
│   │   └── notifications.test.ts # Notifications tests
│   │
│   ├── handlers/                 # Message handlers
│   │   ├── price.ts              # Price quote handler (Binance fetch + format + send)
│   │   ├── price.test.ts         # Price handler tests
│   │   ├── control.ts            # CIO commands (pause/resume/status/training)
│   │   ├── control.test.ts       # Control handler tests
│   │   ├── receipt.ts            # Receipt processing handler (Epic 6)
│   │   ├── receipt.test.ts       # Receipt handler tests
│   │   └── tronscan.ts           # Tronscan link handler (Excel tx update)
│   │
│   ├── services/                 # External integrations & business logic
│   │   ├── binance.ts            # Binance API client for USDT/BRL price
│   │   ├── binance.test.ts       # Binance tests
│   │   ├── supabase.ts           # Session persistence (auth state CRUD)
│   │   ├── supabase.test.ts      # Supabase tests
│   │   ├── excel.ts              # MS Graph Excel logging
│   │   ├── excel.test.ts         # Excel tests
│   │   ├── graph.ts              # MS Graph API client (OAuth2, file access)
│   │   ├── graph.test.ts         # Graph tests
│   │   ├── logQueue.ts           # Async queue for Excel logging (offline support)
│   │   ├── logQueue.test.ts      # LogQueue tests
│   │   ├── messageHistory.ts     # Message history logging to Supabase
│   │   ├── messageHistory.test.ts # MessageHistory tests
│   │   ├── openrouter.ts         # AI/LLM for receipt OCR
│   │   ├── openrouter.test.ts    # OpenRouter tests
│   │   ├── receiptParser.ts      # Receipt data extraction from OCR
│   │   ├── receiptParser.test.ts # ReceiptParser tests
│   │   ├── receiptStorage.ts     # Receipt file storage (Supabase)
│   │   ├── receiptStorage.test.ts # ReceiptStorage tests
│   │   ├── receiptNotifications.ts # Receipt processing notifications
│   │   ├── receiptNotifications.test.ts
│   │   ├── fileStorage.ts        # Generic file storage utilities
│   │   ├── fileStorage.test.ts   # FileStorage tests
│   │   ├── pdf.ts                # PDF text extraction
│   │   ├── pdf.test.ts           # PDF tests
│   │   ├── errors.ts             # Error classification & escalation tracking
│   │   ├── errors.test.ts        # Errors tests
│   │   ├── autoPause.ts          # Auto-pause trigger logic
│   │   ├── autoPause.test.ts     # AutoPause tests
│   │   ├── autoRecovery.ts       # Scheduled recovery from pause
│   │   ├── autoRecovery.test.ts  # AutoRecovery tests
│   │   ├── transientErrors.ts    # Sliding window error tracking
│   │   ├── transientErrors.test.ts
│   │   ├── authBackup.ts         # Local auth state backup (file-based fallback)
│   │   └── authBackup.test.ts    # AuthBackup tests
│   │
│   ├── utils/                    # Shared utilities
│   │   ├── logger.ts             # Pino-based structured logging
│   │   ├── result.ts             # Rust-like Result<T, E> type
│   │   ├── triggers.ts           # Price trigger keyword detection + volume extraction
│   │   ├── triggers.test.ts      # Triggers tests
│   │   ├── messaging.ts          # Anti-detection message sending
│   │   ├── messaging.test.ts     # Messaging tests
│   │   ├── format.ts             # Brazilian price/duration formatting
│   │   ├── format.test.ts        # Format tests
│   │   ├── backoff.ts            # Exponential backoff calculation
│   │   ├── chaos.ts              # Chaos testing utilities
│   │   └── chaos.test.ts         # Chaos tests
│   │
│   └── types/                    # TypeScript type definitions
│       ├── config.ts             # Zod env schema + type guards
│       ├── handlers.ts           # Handler result types
│       └── receipt.ts            # Receipt parsing types
│
├── supabase/                     # Database migrations
│   └── migrations/
│       ├── README.md             # Migration instructions
│       ├── 20260115_001_create_sessions_table.sql
│       ├── 20260116_001_create_log_queue_table.sql
│       ├── 20260119_001_create_receipts_table.sql
│       └── 20260123_001_update_log_queue_schema.sql
│
├── dist/                         # Compiled JavaScript output
├── docs/                         # Project documentation
├── node_modules/                 # Dependencies
│
├── .env                          # Environment variables (not in git)
├── .env.example                  # Environment template
├── .gitignore                    # Git ignore patterns
├── package.json                  # Dependencies and scripts
├── package-lock.json             # Locked dependency versions
├── tsconfig.json                 # TypeScript configuration
├── vitest.config.ts              # Test configuration
├── ecosystem.config.js           # PM2 configuration (ESM)
├── ecosystem.config.cjs          # PM2 config (CommonJS)
└── README.md                     # Project README
```

## Critical Files

### Entry Points

| File | Purpose |
|------|---------|
| `src/index.ts` | Application entry - validates config, starts health endpoint, creates WhatsApp connection |
| `dist/index.js` | Compiled entry point for production |

### Core Bot Logic

| File | Purpose | Key Functions |
|------|---------|---------------|
| `src/bot/connection.ts` | WhatsApp connection lifecycle | `createConnection()`, `getSocket()` |
| `src/bot/router.ts` | Message routing | `routeMessage()`, `isControlGroupMessage()`, `detectReceiptType()` |
| `src/bot/state.ts` | State management | `getState()`, `setPaused()`, `pauseGroup()`, `isTrainingMode()` |
| `src/bot/authState.ts` | Baileys auth adapter | `useSupabaseAuthState()` |
| `src/bot/notifications.ts` | Control notifications | `queueControlNotification()`, `sendStartupNotification()` |

### Handlers

| File | Trigger | Response |
|------|---------|----------|
| `src/handlers/price.ts` | "preço", "cotação" | Binance price formatted as R$X,XX |
| `src/handlers/control.ts` | "pause", "resume", "status", "training" | Control commands |
| `src/handlers/receipt.ts` | PDF/image attachments | Receipt parsing response |
| `src/handlers/tronscan.ts` | tronscan.org links | Update Excel with tx hash |

### External Services

| File | External System | Purpose |
|------|-----------------|---------|
| `src/services/binance.ts` | Binance API | Price fetching |
| `src/services/supabase.ts` | Supabase (Postgres) | Session persistence, health check |
| `src/services/excel.ts` | MS Graph API | Quote logging |
| `src/services/graph.ts` | MS Graph API | OAuth2 token management |
| `src/services/logQueue.ts` | Supabase | Offline log queue |
| `src/services/messageHistory.ts` | Supabase | Message history logging |
| `src/services/openrouter.ts` | OpenRouter | Receipt OCR |

### Error Handling Chain

| File | Responsibility |
|------|----------------|
| `src/services/errors.ts` | Classify errors (transient/critical), track consecutive failures |
| `src/services/transientErrors.ts` | Sliding window tracking (10 in 60s = escalate) |
| `src/services/autoPause.ts` | Trigger pause, notify control group |
| `src/services/autoRecovery.ts` | Schedule and execute recovery |

### Receipt Processing Pipeline

| File | Responsibility |
|------|----------------|
| `src/services/pdf.ts` | Extract text from PDF files |
| `src/services/openrouter.ts` | OCR images using Claude Haiku Vision |
| `src/services/receiptParser.ts` | Parse PIX data from extracted text |
| `src/services/receiptStorage.ts` | Store receipts in Supabase |
| `src/services/fileStorage.ts` | Upload raw files to Supabase Storage |

## Configuration Files

| File | Purpose |
|------|---------|
| `.env` | Runtime secrets (Supabase, MS Graph, OpenRouter keys) |
| `.env.example` | Environment variable template |
| `tsconfig.json` | TypeScript: ES2022, NodeNext modules, strict mode |
| `ecosystem.config.js` | PM2: process name, log paths, restart policy |
| `vitest.config.ts` | Vitest test runner configuration |

## Database Migrations

| File | Purpose |
|------|---------|
| `20260115_001_create_sessions_table.sql` | WhatsApp auth state persistence |
| `20260116_001_create_log_queue_table.sql` | Offline Excel logging queue |
| `20260119_001_create_receipts_table.sql` | PIX receipt storage |
| `20260123_001_update_log_queue_schema.sql` | Add volume_brl, acquired_usdt, onchain_tx |

## Test Files Summary

All test files are co-located with source using `*.test.ts` naming:

| Directory | Test Files | Coverage |
|-----------|------------|----------|
| `src/bot/` | 4 files | connection, router, state, notifications |
| `src/handlers/` | 3 files | price, control, receipt |
| `src/services/` | 17 files | All services tested |
| `src/utils/` | 4 files | triggers, messaging, format, chaos |

**Total: 28 test files**

## VPS Deployment Structure

```
/opt/enorbot/                     # Production deployment path
├── dist/                         # Compiled JS
├── node_modules/                 # Dependencies
├── logs/                         # PM2 logs
│   ├── out.log                   # stdout
│   └── error.log                 # stderr
├── .env                          # Production secrets
├── package.json                  # Dependencies
├── ecosystem.config.cjs          # PM2 config
├── auth_state_backup.json        # Local auth backup (Story 5.4)
└── tsconfig.json                 # TypeScript config
```

---

*Documentation generated: 2026-01-27*
*Scan level: Deep*
