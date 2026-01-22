# Project Context: eNorBOT

> **This is the narrative bible for eNorBOT. All BMAD agents must read and internalize this document before any planning or implementation work.**

---

## The Story

### The Problem We're Solving

eNor's CIO is stuck doing work that's necessary but beneath his role. Every day, he monitors 10+ WhatsApp groups, fielding a dozen price requests for USDT/BRL OTC trades. When someone types "preço", he manually checks Binance, calculates the rate, and responds.

**This is madness.**

When he's in a meeting, opportunities evaporate. When he's asleep, competitors win. When he's focused on a big negotiation, routine requests pile up unanswered.

The entire OTC crypto market in Brazil is still manual. Competitors respond when they can. The fastest human wins.

### The Solution

**eNorBOT changes the game.**

It's a WhatsApp bot that responds instantly to price requests - 24/7, faster than any human, with human-like behavior that doesn't get banned. The CIO controls everything through natural language in a dedicated WhatsApp group. He gains superpowers: instant response, client intelligence, and the freedom to focus on deals that actually need his expertise.

### Why Now

- WhatsApp is where OTC crypto happens in Brazil - no changing that
- Baileys library has matured enough to build reliable bots
- Competitors are still 100% manual - massive first-mover advantage
- The CIO hired someone (you) to finally solve this

---

## The Narrative Hooks

### Primary Hook: First-Mover Automation

> *"While competitors type, eNor closes."*

The entire market is manual. Being first with working automation isn't an incremental improvement - it's a category shift. This is blue ocean territory.

### Secondary Hook: CIO Superpowers

> *"Free the CIO from grunt work so he can close bigger deals."*

The bot doesn't replace the CIO - it amplifies him. He stays in control of negotiations, client relationships, and strategy. The bot handles the repetitive requests that shouldn't occupy a CIO's time.

### Technical Hook: Actually Works

> *"Built to last, not a toy that breaks in a week."*

Most WhatsApp bots get banned within hours. eNorBOT is architected for survival: chaotic timing randomizers, human-like behavior patterns, conservative message volumes, and production-grade session management.

---

## Voice & Tone

### When Talking About eNorBOT

- **Confident but not arrogant** - We know this works, but we're not overselling
- **Practical over flashy** - "Path of least friction" is our mantra
- **Human-centered** - The CIO is the hero, the bot is his tool
- **Results-focused** - Speed, reliability, control - not technical jargon

### Words We Use

| Use This | Not This |
|----------|----------|
| Instant response | AI-powered |
| Human-like | Intelligent |
| CIO superpowers | Automation platform |
| Actually works | Enterprise-grade |
| First-mover | Disruptive |
| Control | Dashboard |

### The 30-Second Pitch

> "eNorBOT answers price requests in our WhatsApp groups instantly, 24/7. It looks human, doesn't get banned, and I control everything from my phone. While our competitors are still typing, we've already responded."

---

## Key Differentiators

| Differentiator | Business Translation |
|----------------|---------------------|
| Anti-ban architecture | Built to last, not a toy that breaks in a week |
| Chaotic randomizers | Looks human to WhatsApp's detection systems |
| CIO control interface | Manage everything via WhatsApp chat - no apps, no dashboards |
| Client intelligence | The bot remembers what you'd forget - patterns, history, preferences |
| Human-in-the-loop | You stay in control of the deals that matter |
| First-mover | Automation in a market that's 100% manual |

---

## Non-Negotiables

### Must Always Be True

1. **Never gets the CIO banned** - Anti-detection is foundational, not optional
2. **Never sends wrong prices** - Binance API is source of truth, graceful degradation if unavailable
3. **CIO stays in control** - Pause, resume, override at any time
4. **Fails gracefully** - Never silent failures, always human-like error messages
5. **Path of least friction** - Simple > clever, working > perfect

### Must Never Do

1. **Over-engineer** - If it works, ship it
2. **Break WhatsApp ToS egregiously** - We're a support bot, not a spam bot
3. **Expose the CIO to risk** - Bot issues are bot issues, never client-facing disasters
4. **Require complex setup** - If the CIO can't control it from WhatsApp, it's too complex
5. **Ignore the warm-up** - 30-day number warm-up is non-negotiable for production

---

## Technical Context

### Stack Decisions (Locked)

| Component | Choice | Why |
|-----------|--------|-----|
| Runtime | Node.js 20 LTS | Baileys native, stable |
| Language | TypeScript (strict mode) | Type safety for complex event handling |
| Module System | ESM (NodeNext) | Modern Node.js standard |
| WhatsApp | @arceos/baileys | Lighter, cleaner than main fork |
| Pricing | Binance Public API | eNor standard, all systems use Binance |
| Logging | Excel Online via MS Graph API | CIO can view in real-time |
| Hosting | VPS (Hostinger/IONOS) | Always-on, affordable |
| State | Supabase (PostgreSQL JSONB) | Session persistence, platform encryption |
| Validation | Zod | Runtime type safety for API responses |
| Process Manager | PM2 | Auto-restart, crash recovery |
| Monitoring | UptimeRobot + health endpoint | External alerts without custom code |

### Critical Constraints

- **<100 messages/day** - Conservative limit to minimize ban risk
- **30-day warm-up** - New numbers must be warmed before production
- **Database auth state** - Never use file-based session storage in production
- **Existing groups only** - Bot joins no new groups, operates in established relationships

### Risk Awareness

| Risk | Severity | Mitigation |
|------|----------|------------|
| WhatsApp ban | HIGH | Chaotic randomizers, <100 msgs/day, typing cadence, warm-up |
| Wrong price | HIGH | Binance API reliability, graceful degradation via Result pattern |
| Bot down unnoticed | MEDIUM | PM2 auto-restart + UptimeRobot external monitoring |
| Session loss | MEDIUM | Supabase JSONB auth state + exponential backoff reconnection |

### Implementation Patterns (AI Agent Rules)

**Error Handling - Result Type Pattern:**
```typescript
type Result<T> = { ok: true; data: T } | { ok: false; error: string }

// Services return Result, NEVER throw
async function fetchPrice(): Promise<Result<number>> {
  try {
    const price = await fetch(...)
    return { ok: true, data: price }
  } catch (e) {
    logger.error('Binance fetch failed', e)
    return { ok: false, error: 'Price unavailable' }
  }
}
```

**Logging - Structured JSON:**
```typescript
// Use logger utility for ALL output, never console.log
logger.info('Price quoted', { group: groupId, price, latency })
logger.error('Binance timeout', { attempt: 2, timeout: 2000 })
```

**Naming Conventions:**

| Context | Convention | Example |
|---------|------------|---------|
| Database tables/columns | snake_case | `auth_state`, `updated_at` |
| TypeScript files | camelCase.ts | `priceHandler.ts`, `binance.ts` |
| Functions/variables | camelCase | `fetchPrice()`, `groupId` |
| Types/interfaces | PascalCase | `PriceResponse`, `BotConfig` |
| Constants | SCREAMING_SNAKE | `BINANCE_API_URL`, `MAX_RETRIES` |

**Test Organization:**
- Tests are co-located with source files: `binance.ts` → `binance.test.ts`
- NO separate `/tests` folder

**Anti-Patterns to Avoid:**
- ❌ Throwing errors in service functions (use Result type)
- ❌ Using `console.log` directly (use logger)
- ❌ Creating separate /tests folder (co-locate)
- ❌ Using camelCase in database schemas (use snake_case)

---

## Learned Patterns (From Implementation)

> **These patterns were discovered during Epic 1-3 implementation. They are now project standards.**

### ESM Testing Patterns

**Mock Setup with vi.hoisted():**
```typescript
// Use vi.hoisted() to define mocks before imports are processed
const mockFetchPrice = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('./binance.js', () => ({ fetchPrice: mockFetchPrice }))
vi.mock('../utils/logger.js', () => ({ logger: mockLogger }))
```

**Async Timer Testing:**
```typescript
// For testing setTimeout/setInterval with async operations
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

it('schedules recovery after delay', async () => {
  scheduleAutoRecovery('Test reason')

  // Use advanceTimersByTimeAsync for async timer callbacks
  await vi.advanceTimersByTimeAsync(AUTO_RECOVERY_DELAY_MS + 100)

  expect(mockFetchPrice).toHaveBeenCalled()
})
```

**Test Isolation:**
```typescript
beforeEach(() => {
  vi.clearAllMocks()
  resetModuleState() // Always reset module-level state between tests
})
```

### Input Validation Patterns

**External API Data Validation:**
```typescript
// Always validate external API responses with Zod
import { z } from 'zod'

const BinanceResponseSchema = z.object({
  symbol: z.string(),
  price: z.string().transform(Number),
})

// Validate before using
const parsed = BinanceResponseSchema.safeParse(apiResponse)
if (!parsed.success) {
  return { ok: false, error: 'Invalid API response' }
}
```

**Numeric Edge Cases:**
```typescript
// Always handle NaN/Infinity for numeric values
function formatPrice(price: number): string {
  if (!Number.isFinite(price) || price < 0) {
    throw new Error('Invalid price value')
  }
  return `R$${price.toFixed(2).replace('.', ',')}`
}
```

**Undefined/Null Status Codes:**
```typescript
// Handle undefined statusCode from HTTP errors
function classifyError(error: unknown): ErrorClassification {
  const statusCode = (error as { statusCode?: number })?.statusCode

  // statusCode may be undefined - handle explicitly
  if (statusCode === undefined) {
    return 'transient' // Network errors without status are transient
  }

  if (statusCode >= 500) return 'transient'
  if (statusCode === 401 || statusCode === 403) return 'critical'
  return 'transient'
}
```

### Logging Assertion Patterns

**Test All Log Events:**
```typescript
// Every new log event MUST have a test asserting it fires
it('logs error classification', () => {
  classifyBinanceError('timeout')

  expect(mockLogger.warn).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      event: 'binance_error_classified',
      classification: 'transient',
      source: 'binance',
    })
  )
})
```

**Structured Log Format:**
```typescript
// All logs must include event name for filtering
logger.info('Operation completed', {
  event: 'price_quoted',           // REQUIRED: event name for filtering
  source: 'binance',               // Context: which service
  price: 5.82,                     // Data: relevant values
  latencyMs: 142,                  // Metrics: timing data
  timestamp: new Date().toISOString(), // When it happened
})
```

### Error Handling Patterns (Epic 3)

**Error Classification System:**
```typescript
// Classify errors as transient (retry) or critical (pause)
type ErrorClassification = 'transient' | 'critical'
type ErrorSource = 'binance' | 'whatsapp'

// Transient: timeouts, 5xx errors, network hiccups
// Critical: auth failures, bans, persistent failures
```

**Consecutive Failure Tracking:**
```typescript
// Track consecutive failures per source
const failureTracker: Record<ErrorSource, number> = {
  binance: 0,
  whatsapp: 0,
}

const ESCALATION_THRESHOLD = 3 // 3+ consecutive = escalate

function recordFailure(source: ErrorSource): { shouldEscalate: boolean } {
  failureTracker[source]++
  return { shouldEscalate: failureTracker[source] >= ESCALATION_THRESHOLD }
}

function recordSuccess(source: ErrorSource): void {
  failureTracker[source] = 0 // Reset on success
}
```

**Sliding Window for Transient Errors:**
```typescript
// Track transient errors in a time window, not just consecutive
const TRANSIENT_WINDOW_MS = 60 * 1000 // 60 seconds
const TRANSIENT_THRESHOLD = 3 // 3+ in window = escalate

interface TransientErrorEntry {
  source: ErrorSource
  timestamp: Date
}

const transientWindow: TransientErrorEntry[] = []

function recordTransientError(source: ErrorSource): { shouldEscalate: boolean } {
  const now = new Date()
  transientWindow.push({ source, timestamp: now })

  // Filter to recent errors for this source
  const cutoff = now.getTime() - TRANSIENT_WINDOW_MS
  const recent = transientWindow.filter(
    e => e.source === source && e.timestamp.getTime() > cutoff
  )

  return { shouldEscalate: recent.length >= TRANSIENT_THRESHOLD }
}
```

**Auto-Recovery Timer Pattern:**
```typescript
// Schedule recovery attempt after pause from transient escalation
const AUTO_RECOVERY_DELAY_MS = 5 * 60 * 1000 // 5 minutes

let recoveryTimer: NodeJS.Timeout | null = null

function scheduleAutoRecovery(reason: string): void {
  if (recoveryTimer) clearTimeout(recoveryTimer)

  recoveryTimer = setTimeout(async () => {
    const result = await healthCheck()
    if (result.ok) {
      setRunning()
      queueControlNotification('✅ Auto-recovered')
    } else {
      queueControlNotification('⚠️ Auto-recovery failed. Manual intervention required.')
    }
  }, AUTO_RECOVERY_DELAY_MS)
}

function cancelAutoRecovery(): void {
  if (recoveryTimer) {
    clearTimeout(recoveryTimer)
    recoveryTimer = null
  }
}
```

**Notification Queue Pattern:**
```typescript
// Queue notifications for control group, don't send directly
// Actual sending happens in Epic 4 (Story 4.4)
const notificationQueue: string[] = []

function queueControlNotification(message: string): void {
  notificationQueue.push(message)
  logger.info('Notification queued', { event: 'notification_queued', message })
}

function getQueuedNotifications(): string[] {
  return [...notificationQueue]
}

function clearNotificationQueue(): void {
  notificationQueue.length = 0
}
```

**Rate-Limited Notifications:**
```typescript
// Prevent notification spam with rate limiting
const NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes
let lastNotificationTime: number | null = null

function shouldSendNotification(): boolean {
  const now = Date.now()
  if (lastNotificationTime && now - lastNotificationTime < NOTIFICATION_COOLDOWN_MS) {
    return false // Still in cooldown
  }
  lastNotificationTime = now
  return true
}
```

### Auth State Resilience Patterns (Story 5.4)

**Local File Backup for Auth State:**
```typescript
// Backup auth state to local file after Supabase save
// Provides fallback if database becomes unreachable
import { saveAuthStateToFile, loadAuthStateFromFile } from './authBackup.js'

// On successful Supabase save, also save locally
saveAuthStateToFile(state).catch((e) => {
  logger.warn('Local backup save failed', { error: e.message })
})
```

**Extended Retry with Exponential Backoff:**
```typescript
// 5-minute retry window with exponential backoff
export const AUTH_RETRY_CONFIG = {
  maxRetries: 10,
  delays: [1000, 2000, 4000, 8000, 16000, 30000, 60000, 120000, 180000, 300000],
  totalWindowMs: 5 * 60 * 1000,
}

// Retry auth state loading before giving up
for (let attempt = 0; attempt < AUTH_RETRY_CONFIG.maxRetries; attempt++) {
  const result = await loadAuthState()
  if (result.ok) return result

  const delay = AUTH_RETRY_CONFIG.delays[attempt]
  await new Promise(resolve => setTimeout(resolve, delay))
}
```

**Database Health Check Before Reconnection:**
```typescript
// Verify Supabase reachable before loading auth state
const healthResult = await checkSupabaseHealth()
if (!healthResult.ok) {
  logger.warn('Delaying reconnection - Supabase unreachable')
  scheduleReconnection(attempt + 1)
  return
}
```

**Prevent Session Conflict on Database Failure:**
```typescript
// Don't request new pairing code if we had valid auth but lost database
if (wasAuthStateEverLoaded() && !checkSupabaseHealth().ok) {
  logger.warn('Auth state unavailable - waiting for database recovery')
  queueControlNotification('Auth state lost - waiting for recovery')
  scheduleReconnection(attempt + 1)
  return // Don't request pairing code
}
```

**Database Connectivity Alerting:**
```typescript
// Track failure duration and alert after 60 seconds
const DB_ALERT_THRESHOLD_MS = 60 * 1000
const DB_ALERT_COOLDOWN_MS = 10 * 60 * 1000 // Rate limit to 1 per 10 min

function trackDatabaseFailure(): void {
  const failureDuration = Date.now() - firstFailureTime
  if (failureDuration >= DB_ALERT_THRESHOLD_MS) {
    if (!lastAlertTime || Date.now() - lastAlertTime >= DB_ALERT_COOLDOWN_MS) {
      queueControlNotification('Database unreachable for 60+ seconds')
    }
  }
}
```

---

## Success Metrics

### MVP Success

- [ ] Bot responds to "preço" with accurate Binance rate
- [ ] CIO can pause/resume from control group
- [ ] No WhatsApp ban after 30 days of operation
- [ ] All interactions logged to Excel Online

### "Impress the CIO" Success

- [ ] Natural language status reports ("How's it going?")
- [ ] Client tagging and memory ("Tell me about João")
- [ ] Human-in-the-loop escalation for big deals
- [ ] Daily digest summaries

### Ultimate Success

> The CIO shows eNorBOT to colleagues and says: "Look what my guy built."

---

## Implementation Tiers

### Tier 1: MVP

- Core price response with anti-ban protection (chaotic timing)
- CIO control group with pause/resume/status
- Excel Online logging via MS Graph API
- Graceful degradation (Result pattern)
- PM2 process management + UptimeRobot monitoring

### Tier 1.5: Hardening (Post-MVP)

- Custom watchdog process (optional)
- GitHub Actions CI/CD
- Application-level encryption (if needed)

### Tier 2: Impress

- Human-in-the-loop escalation
- Natural language status reports
- Client tagging system
- Daily digest automation

### Tier 3: Delight

- Memory callbacks ("Rate moved since you last checked")
- Idle presence (occasional emoji reactions)
- Weekly wrapped reports
- Milestone celebrations

---

## Project Structure

```
eNorBOT/
├── src/
│   ├── index.ts              # Entry point - boot, wire, health endpoint
│   ├── config.ts             # Environment validation with Zod
│   ├── bot/
│   │   ├── connection.ts     # Baileys socket, auth, reconnection + error tracking
│   │   ├── router.ts         # Message dispatch to handlers
│   │   ├── state.ts          # Connection + operational state (OperationalStatus)
│   │   └── notifications.ts  # Control group notification queue
│   ├── handlers/
│   │   ├── price.ts          # "preço" trigger → Binance → response + error handling
│   │   └── control.ts        # CIO commands (pause, status, etc.)
│   ├── services/
│   │   ├── binance.ts        # Binance API client with Zod validation
│   │   ├── errors.ts         # Error classification & consecutive failure tracking
│   │   ├── transientErrors.ts # Sliding window transient error tracking
│   │   ├── autoPause.ts      # Auto-pause orchestration on critical errors
│   │   ├── autoRecovery.ts   # Auto-recovery timer service
│   │   ├── excel.ts          # MS Graph Excel logging
│   │   └── supabase.ts       # Session persistence
│   ├── utils/
│   │   ├── chaos.ts          # Chaotic timing (NON-NEGOTIABLE)
│   │   ├── logger.ts         # Structured JSON logger
│   │   ├── result.ts         # Result<T> type definition
│   │   └── triggers.ts       # Price trigger patterns
│   └── types/
│       ├── config.ts         # Config Zod schemas
│       ├── messages.ts       # WhatsApp message types
│       └── services.ts       # Service response types
├── ecosystem.config.js       # PM2 configuration
├── package.json
├── tsconfig.json
└── .env.example
```

**Data Flow:**
```
WhatsApp → connection.ts → router.ts → handlers/* → services/*
                │                           │
                ▼                           ▼
          supabase.ts                 binance.ts / excel.ts
```

---

## For All BMAD Agents

When working on eNorBOT:

1. **Read this document first** - It's your north star
2. **Narrative matters** - How we talk about the product shapes what we build
3. **CIO is the hero** - The bot serves him, not the other way around
4. **Simple wins** - Path of least friction, always
5. **Anti-ban is foundational** - Every feature must pass the "will this get us banned?" test
6. **First-mover advantage is real** - Speed to market matters more than perfection

### AI Agent Implementation Rules

1. Follow all architectural decisions exactly as documented
2. Use implementation patterns consistently across all components
3. Respect project structure and boundaries
4. Return Result types from services, never throw
5. Use logger utility for all output (no console.log)
6. Place tests co-located with source files

**Reference Documents:**
- [Architecture Document](_bmad-output/planning-artifacts/architecture.md) - Full technical decisions
- [PRD](_bmad-output/planning-artifacts/prd.md) - Functional requirements

---

*Last updated: 2026-01-19*
*Updated during: Story 5.4 - added Auth State Resilience patterns*
