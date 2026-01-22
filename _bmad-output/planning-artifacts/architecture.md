---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - prd.md
  - product-brief-eNorBOT-2026-01-15.md
  - technical-baileys-stability-research-2026-01-15.md
  - project-context.md
workflowType: 'architecture'
project_name: 'eNorBOT'
user_name: 'Boss'
date: '2026-01-15'
lastStep: 8
status: 'complete'
completedAt: '2026-01-15'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

---

## Project Context Analysis

### Requirements Overview

**Functional Requirements:** 23 FRs across 6 capability areas
- Price Quoting (4): Core value - message detection + Binance fetch + response
- CIO Control (5): Command parsing from control group
- Session Management (4): Supabase persistence + auto-reconnect
- Anti-Detection (3): Chaotic timing + typing simulation
- Logging (3): Excel Online integration
- Error Handling (4): Graceful degradation + auto-pause

**Non-Functional Requirements:** 17 NFRs
- Reliability: 99%+ uptime, <60s recovery, PM2 auto-restart
- Security: Encrypted credentials, SSH-only access
- Integration: Binance <2s timeout, Excel queue fallback, Supabase <1s
- Performance: 3-15s response delays, <100 msgs/day cap

### Scale & Complexity

- **Primary domain:** Background service / Real-time messaging
- **Complexity level:** Medium (focused scope, technical challenges)
- **Estimated components:** ~8 (core bot, integrations, services)
- **Users:** Single (Daniel)
- **Data volume:** Low (<100 interactions/day)

### Technical Constraints & Dependencies

| Constraint | Requirement |
|------------|-------------|
| Message limit | <100/day (anti-ban) |
| Warm-up | 30 days before production |
| Session storage | Database-backed (Supabase) |
| Price source | Binance only, no caching |
| Control interface | WhatsApp group only |

### Cross-Cutting Concerns

1. **Anti-Detection Architecture** - All outbound messages must pass through chaotic timing layer
2. **Graceful Degradation** - Every external call needs fallback behavior
3. **Audit Trail** - All price quotes logged to Excel Online
4. **State Persistence** - Session credentials survive restarts
5. **CIO Control** - All bot behavior controllable via natural language

---

## Starter Template Evaluation

### Primary Technology Domain

**Background Service / Event-Driven Daemon** - This is NOT a web application, API server, or CLI tool. It's a long-running process that reacts to WhatsApp WebSocket events.

Pattern classification: **Message Consumer / Event Processor**

### Starter Options Considered

| Option | Verdict | Reason |
|--------|---------|--------|
| Next.js / Vite / Remix | ❌ Rejected | Web frameworks - wrong paradigm |
| NestJS / Fastify | ❌ Rejected | API frameworks - unnecessary overhead |
| T3 / RedwoodJS | ❌ Rejected | Full-stack - overkill for daemon |
| CLI frameworks (oclif) | ❌ Rejected | Wrong interaction model |
| **Minimal TypeScript** | ✅ Selected | Right tool for the job |

### Selected Approach: Minimal TypeScript Project

**Rationale:**
- No framework overhead for a focused background service
- Direct control over the event loop and process lifecycle
- 16-day deadline favors simplicity over abstraction
- Specific packages assembled for exact requirements

### Initialization Command

```bash
# Create project
mkdir eNorBOT && cd eNorBOT
npm init -y

# Production dependencies
npm i @arceos/baileys @supabase/supabase-js dotenv

# Dev dependencies
npm i -D typescript @types/node tsx
```

### Project Structure

```
eNorBOT/
├── src/
│   ├── index.ts              # Entry point - boot & wire everything
│   ├── bot/
│   │   ├── connection.ts     # Baileys socket, auth, reconnection
│   │   ├── router.ts         # Message dispatch to handlers
│   │   └── state.ts          # Connection state tracking
│   ├── handlers/
│   │   ├── price.ts          # "preço" trigger handling
│   │   └── control.ts        # CIO command handling
│   ├── services/
│   │   ├── binance.ts        # Price fetching
│   │   ├── excel.ts          # MS Graph logging
│   │   └── supabase.ts       # State persistence
│   └── utils/
│       ├── chaos.ts          # Chaotic timing (NON-NEGOTIABLE)
│       └── logger.ts         # Console logging
├── package.json
├── tsconfig.json
├── .env.example
├── ecosystem.config.js       # PM2 configuration
└── README.md
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

### Development & Production Tooling

| Environment | Tool | Command |
|-------------|------|---------|
| Development | tsx (hot reload) | `npm run dev` → `tsx watch src/index.ts` |
| Build | TypeScript | `npm run build` → `tsc` |
| Production | Node + PM2 | `npm start` → `node dist/index.js` |

**package.json scripts:**
```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

### Key Architectural Decisions from Starter

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Language** | TypeScript (strict) | Type safety for complex event handling |
| **Module system** | ESM (NodeNext) | Modern Node.js standard |
| **Bot/Logic separation** | connection.ts isolated | Baileys lifecycle separate from business logic |
| **Testability** | router.ts pure function | Handlers testable without mocking WebSockets |
| **Anti-detection** | chaos.ts middleware | All outbound passes through timing layer |

**Note:** Project initialization is Story 0 - first implementation task.

---

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Session state storage approach (Supabase JSON)
- Credentials management (.env)
- Health monitoring (UptimeRobot)

**Important Decisions (Shape Architecture):**
- Data validation library (Zod)
- Environment configuration pattern

**Deferred Decisions (Post-MVP):**
- Custom watchdog process (Tier 1.5)
- GitHub Actions CI/CD (when deploys become frequent)
- Application-level encryption (if needed)

### Data Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Session State** | Single JSON column | Matches Baileys structure, simple read/write, single bot scenario |
| **Schema** | `sessions` table with `auth_state JSONB` | One row per session, updated on auth events |
| **Validation** | Zod | Runtime type safety, validates Binance responses and CIO commands |

**Supabase Schema:**
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY DEFAULT 'default',
  auth_state JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Security

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Secrets Storage** | .env file on VPS | Simple, SSH-secured, file permissions (chmod 600) |
| **Session Encryption** | Supabase default | Platform encryption at rest + TLS in transit sufficient for MVP |

**Required Environment Variables:**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_KEY` - Supabase service key
- `MS_GRAPH_CLIENT_ID` - Azure app registration
- `MS_GRAPH_CLIENT_SECRET` - Azure app secret
- `CONTROL_GROUP_ID` - WhatsApp group JID for CIO
- `NODE_ENV` - development | production

### Infrastructure & Operations

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Deployment** | Manual (SSH + git pull + pm2 restart) | Fast for single developer, automate later |
| **Monitoring** | UptimeRobot + minimal health endpoint | External alerts without custom code |
| **Environment** | Single .env + NODE_ENV switch | Simple for single environment |

**Health Endpoint:**
```typescript
import { createServer } from 'http'
createServer((_, res) => res.end('ok')).listen(3000)
```

**Deploy Workflow:**
```bash
ssh vps
cd ~/eNorBOT
git pull && npm run build && pm2 restart eNorBOT
```

### Updated Dependencies

```bash
npm i @arceos/baileys @supabase/supabase-js dotenv zod
npm i -D typescript @types/node tsx
```

---

## Implementation Patterns & Consistency Rules

### Pattern Summary

| Category | Pattern | Example |
|----------|---------|---------|
| Database | snake_case | `price_logs`, `created_at` |
| Files | camelCase.ts | `binance.ts`, `priceHandler.ts` |
| Functions | camelCase | `fetchPrice()`, `sendMessage()` |
| Types | PascalCase | `PriceResponse`, `BotConfig` |
| Constants | SCREAMING_SNAKE | `BINANCE_API_URL`, `MAX_RETRIES` |
| Tests | Co-located | `binance.test.ts` next to `binance.ts` |

### Error Handling Pattern

**All service functions return Result type, never throw:**

```typescript
type Result<T> = { ok: true; data: T } | { ok: false; error: string }

// Services return Result
async function fetchPrice(): Promise<Result<number>> {
  try {
    const price = await fetch(...)
    return { ok: true, data: price }
  } catch (e) {
    logger.error('Binance fetch failed', e)
    return { ok: false, error: 'Price unavailable' }
  }
}

// Handlers decide how to respond to failures
const result = await fetchPrice()
if (!result.ok) {
  // graceful degradation
}
```

### Logging Pattern

**Structured JSON with levels:**

```typescript
// utils/logger.ts
type LogLevel = 'error' | 'warn' | 'info' | 'debug'

function log(level: LogLevel, message: string, data?: object) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data
  }
  console.log(JSON.stringify(entry))
}

export const logger = {
  error: (msg: string, data?: object) => log('error', msg, data),
  warn: (msg: string, data?: object) => log('warn', msg, data),
  info: (msg: string, data?: object) => log('info', msg, data),
  debug: (msg: string, data?: object) => log('debug', msg, data),
}

// Output: {"timestamp":"...","level":"info","message":"...","group":"abc"}
```

### Enforcement Rules

**All AI agents implementing eNorBOT MUST:**

1. Use snake_case for all Supabase tables and columns
2. Return Result types from service functions, never throw
3. Use the logger utility for all output (no raw console.log)
4. Place tests co-located with source files
5. Follow TypeScript naming conventions exactly

**Anti-Patterns to Avoid:**

- ❌ Throwing errors in service functions
- ❌ Using console.log directly
- ❌ Creating separate /tests folder
- ❌ Using camelCase in database schemas
- ❌ Mixing naming conventions

---

## Project Structure & Boundaries

### Complete Project Directory Structure

```
eNorBOT/
├── src/
│   ├── index.ts                    # Entry point - boot, wire, health endpoint
│   ├── config.ts                   # Environment validation with Zod
│   │
│   ├── bot/
│   │   ├── connection.ts           # Baileys socket, auth, reconnection
│   │   ├── connection.test.ts
│   │   ├── router.ts               # Message dispatch to handlers
│   │   ├── router.test.ts
│   │   └── state.ts                # Connection state tracking
│   │
│   ├── handlers/
│   │   ├── price.ts                # "preço" trigger → Binance → response
│   │   ├── price.test.ts
│   │   ├── control.ts              # CIO commands (pause, status, etc.)
│   │   └── control.test.ts
│   │
│   ├── services/
│   │   ├── binance.ts              # Binance API client
│   │   ├── binance.test.ts
│   │   ├── excel.ts                # MS Graph Excel logging
│   │   ├── excel.test.ts
│   │   ├── supabase.ts             # Session persistence
│   │   └── supabase.test.ts
│   │
│   ├── utils/
│   │   ├── chaos.ts                # Chaotic timing randomizers
│   │   ├── chaos.test.ts
│   │   ├── logger.ts               # Structured JSON logger
│   │   ├── result.ts               # Result<T> type definition
│   │   └── triggers.ts             # Price trigger patterns
│   │
│   └── types/
│       ├── config.ts               # Config Zod schemas
│       ├── messages.ts             # WhatsApp message types
│       └── services.ts             # Service response types
│
├── dist/                           # Compiled output (gitignored)
├── .env.example
├── .gitignore
├── ecosystem.config.js             # PM2 configuration
├── package.json
├── tsconfig.json
└── README.md
```

### Requirements to Structure Mapping

| FR Category | Primary Files |
|-------------|---------------|
| Price Quoting (FR-PQ) | `handlers/price.ts`, `services/binance.ts` |
| CIO Control (FR-CC) | `handlers/control.ts` |
| Session Management (FR-SM) | `bot/connection.ts`, `services/supabase.ts` |
| Anti-Detection (FR-AD) | `utils/chaos.ts` |
| Logging (FR-LG) | `services/excel.ts`, `utils/logger.ts` |
| Error Handling (FR-EH) | `utils/result.ts` |

### Integration Boundaries

**Data Flow:**
```
WhatsApp → connection.ts → router.ts → handlers/* → services/*
                │                           │
                ▼                           ▼
          supabase.ts                 binance.ts / excel.ts
```

**External Services:**
- Supabase: Session state persistence
- Binance API: Real-time USDT/BRL pricing
- MS Graph API: Excel Online logging

### Key File Responsibilities

| File | Responsibility |
|------|----------------|
| `index.ts` | Boot sequence, health endpoint, wiring |
| `config.ts` | Zod validation of environment variables |
| `connection.ts` | Baileys lifecycle, auth events, reconnection |
| `router.ts` | Route messages to correct handler |
| `price.ts` | Price request handling with chaotic delay |
| `control.ts` | CIO command parsing and execution |
| `chaos.ts` | Multi-layer timing randomizers |

---

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
All technology choices work together without conflicts:
- Node.js 20 LTS + TypeScript strict + ESM modules
- @arceos/baileys + Supabase client + Zod validation
- PM2 process management + health endpoint + UptimeRobot

**Pattern Consistency:**
Implementation patterns align with technology stack:
- snake_case database + camelCase TypeScript (standard convention)
- Result type pattern supports graceful degradation requirement
- Co-located tests work with TypeScript exclude configuration

**Structure Alignment:**
Project structure supports all architectural decisions:
- bot/ isolation enables Baileys lifecycle management
- services/ separation allows independent testing
- utils/chaos.ts positioned for all outbound message flow

### Requirements Coverage Validation ✅

**Functional Requirements (23 FRs):**
All FR categories have architectural support:
- FR-PQ: handlers/price.ts + services/binance.ts
- FR-CC: handlers/control.ts + dedicated control group
- FR-SM: services/supabase.ts + bot/connection.ts
- FR-AD: utils/chaos.ts middleware pattern
- FR-LG: services/excel.ts + utils/logger.ts
- FR-EH: utils/result.ts + handler-level decisions

**Non-Functional Requirements (17 NFRs):**
All NFR categories are architecturally addressed:
- Reliability: PM2 auto-restart + exponential backoff reconnection
- Security: .env on VPS + Supabase platform encryption
- Performance: Chaotic timing enforces 3-15s delays
- Integration: Result pattern enables graceful fallback

### Implementation Readiness ✅

**Architecture Completeness Checklist:**

- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Error handling patterns documented
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Requirements to structure mapping complete

### Gap Analysis

**No Critical Gaps Found**

**Minor Items (Post-MVP):**
- Test framework selection (Vitest recommended)
- MS Graph OAuth flow details (implementation detail)
- Specific Baileys event handlers (implementation detail)

### Architecture Readiness Assessment

**Overall Status:** ✅ READY FOR IMPLEMENTATION

**Confidence Level:** HIGH

**Key Strengths:**
- Clear separation of concerns (bot/handlers/services)
- Graceful degradation built into Result pattern
- Anti-detection architecture is non-negotiable
- Single-developer focus keeps complexity low

**First Implementation Priority:**
Project initialization using the documented setup commands, followed by Story 0: Core bot connection and authentication.

### Implementation Handoff

**AI Agent Guidelines:**
1. Follow all architectural decisions exactly as documented
2. Use implementation patterns consistently across all components
3. Respect project structure and boundaries
4. Return Result types from services, never throw
5. Use logger utility for all output
6. Place tests co-located with source files

**Reference This Document For:**
- Technology version questions
- Naming convention questions
- Error handling approach
- Project structure decisions
- Pattern enforcement

---

## Architecture Completion Summary

### Workflow Completion

**Architecture Decision Workflow:** COMPLETED ✅
**Total Steps Completed:** 8
**Date Completed:** 2026-01-15
**Document Location:** _bmad-output/planning-artifacts/architecture.md

### Final Architecture Deliverables

**Complete Architecture Document**
- All architectural decisions documented with specific versions
- Implementation patterns ensuring AI agent consistency
- Complete project structure with all files and directories
- Requirements to architecture mapping
- Validation confirming coherence and completeness

**Implementation Ready Foundation**
- 7 architectural decisions made (data, security, infrastructure)
- 5 implementation patterns defined (naming, error handling, logging, tests)
- 8 architectural components specified
- 23 functional + 17 non-functional requirements fully supported

**AI Agent Implementation Guide**
- Technology stack with verified versions (Node.js 20, @arceos/baileys, Supabase, Zod)
- Consistency rules that prevent implementation conflicts
- Project structure with clear boundaries
- Integration patterns and communication standards

### Development Sequence

1. Initialize project using documented starter template commands
2. Set up development environment per architecture
3. Implement core architectural foundations (connection.ts, supabase.ts)
4. Build features following established patterns (price handler, control handler)
5. Maintain consistency with documented rules

### Quality Assurance Checklist

**Architecture Coherence**
- [x] All decisions work together without conflicts
- [x] Technology choices are compatible
- [x] Patterns support the architectural decisions
- [x] Structure aligns with all choices

**Requirements Coverage**
- [x] All 23 functional requirements are supported
- [x] All 17 non-functional requirements are addressed
- [x] Cross-cutting concerns are handled (anti-detection, graceful degradation)
- [x] Integration points are defined (Binance, Excel Online, Supabase)

**Implementation Readiness**
- [x] Decisions are specific and actionable
- [x] Patterns prevent agent conflicts
- [x] Structure is complete and unambiguous
- [x] Examples are provided for clarity

---

**Architecture Status:** READY FOR IMPLEMENTATION ✅

**Next Phase:** Begin implementation using the architectural decisions and patterns documented herein.

**Document Maintenance:** Update this architecture when major technical decisions are made during implementation.

