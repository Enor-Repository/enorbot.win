# eNorBOT Stateful Deal System Roadmap

> **Document Purpose**: Living roadmap for transforming eNorBOT into Daniel's automated CIO desk with full control via dashboard.
>
> **Last Updated**: 2026-02-03
> **Status**: Sprint 1-5 Complete, Sprint 6 (Hardening) In Progress
> **Architecture**: Triggers + Rules (separated concerns)

---

## 1. Vision & Problem Statement

### The Problem

**Current State**: eNorBOT operates with global triggers that behave the same regardless of time or group context.

```
Message "preço" → Always returns USDT/BRL quote
                  (No awareness of business hours vs after hours)
```

**Daniel's Actual Workflow**: Time-aware, context-dependent responses.

```
9am-6pm:  "preço" → Commercial dollar rate (banking hours)
6pm-9am:  "preço" → USDT/BRL + spread (crypto hours)
Weekend:  "preço" → USDT/BRL + wider spread (higher risk)
```

The bot cannot replace Daniel because:
- No time-based rule switching
- No per-group configuration
- No easy way for Daniel to control behavior via dashboard
- Triggers and pricing behavior are coupled

### The Vision

**Daniel's Automated Clone**: A system where Daniel has full dashboard control over:

1. **Group Triggers** - Configure trigger phrases once per group (e.g., "preço", "cotação", "price")
2. **Group Rules** - Time-based behavior rules that govern HOW triggers respond
3. **Rule-Aware Actions** - Triggers automatically respect the active rule's pricing config
4. **Deal Flow Management** - Stateful quote → lock → compute → confirm

**The Key Insight**:
- **Triggers** define WHAT phrases activate responses
- **Rules** define HOW to respond (pricing source, spreads) based on time
- Triggers are configured once; they automatically respect whatever rule is active

**End Goal**: Daniel configures triggers once per group, sets up time-based rules, and the bot automatically uses the right pricing at the right time.

---

## 2. Key Decisions (User-Approved)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Supabase for state persistence** | Already integrated, proven reliable |
| 2 | **Fit into existing dashboard** | Daniel uses UI, not Supabase Studio |
| 3 | **Incremental migration** | Don't break what works |
| 4 | **Triggers + Rules separation** | Clean architecture, no trigger duplication |
| 5 | **Triggers at group level** | Configure once, respects all rules automatically |
| 6 | **Rules as time-based modifiers** | Control pricing behavior by schedule |

**Critical Constraint**: Daniel is not a developer. Every backend feature MUST ship with dashboard UI.

---

## 3. Architecture: Triggers + Rules

### Conceptual Model

```
┌─────────────────────────────────────────────────────────────────┐
│                       GROUP: "Liqd OTC"                          │
│                       Mode: Active                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TRIGGERS (configured once per group):                           │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ "preço"     → action: price_quote                          │ │
│  │ "cotação"   → action: price_quote                          │ │
│  │ "price"     → action: price_quote                          │ │
│  │ "compro X"  → action: volume_quote (extracts amount)       │ │
│  │ "ajuda"     → action: text_response ("Como posso ajudar?") │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  RULES (time-based behavior - triggers respect active rule):     │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ RULE: "Business Hours"                        [ACTIVE NOW] │ │
│  │   Schedule: Mon-Fri 09:00-18:00 (America/Sao_Paulo)        │ │
│  │   Pricing Source: Commercial Dollar                         │ │
│  │   Spread: None (market rate)                                │ │
│  │   Priority: 10                                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ RULE: "After Hours"                                        │ │
│  │   Schedule: Mon-Fri 18:01-08:59 + Sat-Sun all day          │ │
│  │   Pricing Source: USDT/BRL (Binance)                        │ │
│  │   Spread: +50 bps (buy) / -30 bps (sell)                   │ │
│  │   Priority: 5                                               │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ RULE: "Weekend Premium"                                    │ │
│  │   Schedule: Sat-Sun 00:00-23:59                            │ │
│  │   Pricing Source: USDT/BRL (Binance)                        │ │
│  │   Spread: +80 bps (buy) / -50 bps (sell)                   │ │
│  │   Priority: 15 (higher than After Hours, wins on weekends) │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Message Processing Flow

```
Message "preço" arrives at 10:30am Monday
                ↓
[1] TRIGGER MATCH: Find trigger in group
    → Match: "preço" → action: price_quote
                ↓
[2] RULE LOOKUP: Which rule is active at 10:30am Monday?
    → "Business Hours" (Mon-Fri 09:00-18:00, priority 10)
                ↓
[3] EXECUTE ACTION with rule context:
    → price_quote + commercial_dollar source + no spread
                ↓
[4] RESPONSE: "Dólar comercial: R$ 5,23"
```

```
Message "preço" arrives at 8:00pm Saturday
                ↓
[1] TRIGGER MATCH: Find trigger in group
    → Match: "preço" → action: price_quote
                ↓
[2] RULE LOOKUP: Which rule is active at 8:00pm Saturday?
    → "Weekend Premium" (Sat-Sun, priority 15) beats "After Hours" (priority 5)
                ↓
[3] EXECUTE ACTION with rule context:
    → price_quote + usdt_binance source + 80 bps spread
                ↓
[4] RESPONSE: "USDT/BRL: R$ 5,31 (Binance + spread)"
```

### Action Types

| Action Type | Description | Rule-Aware? |
|-------------|-------------|-------------|
| `price_quote` | Returns current price | **YES** - rule determines source + spread |
| `volume_quote` | Calculates amount × price | **YES** - rule determines source + spread |
| `text_response` | Returns static text | NO - same regardless of rule |
| `ai_prompt` | AI generates response | OPTIONAL - can use rule context |

### Database Schema

```sql
-- Triggers belong to GROUPS (configured once, respect active rule)
CREATE TABLE group_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid TEXT NOT NULL,

  -- Trigger configuration
  trigger_phrase TEXT NOT NULL,
  pattern_type TEXT NOT NULL DEFAULT 'contains',  -- 'exact' | 'contains' | 'regex'

  -- Action configuration
  action_type TEXT NOT NULL,              -- 'price_quote' | 'volume_quote' | 'text_response' | 'ai_prompt'
  action_params JSONB NOT NULL DEFAULT '{}',  -- static params (e.g., response text for text_response)

  -- Metadata
  priority INTEGER NOT NULL DEFAULT 0,    -- higher priority triggers match first
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(group_jid, trigger_phrase)
);

-- Rules are time-based behavior modifiers
CREATE TABLE group_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid TEXT NOT NULL,
  name TEXT NOT NULL,                     -- "Business Hours", "After Hours", "Weekend Premium"
  description TEXT,                       -- Optional notes for Daniel

  -- Schedule configuration
  schedule_start_time TIME NOT NULL,      -- 09:00
  schedule_end_time TIME NOT NULL,        -- 18:00
  schedule_days TEXT[] NOT NULL,          -- ['mon','tue','wed','thu','fri']
  schedule_timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',

  -- Priority (higher wins when schedules overlap)
  priority INTEGER NOT NULL DEFAULT 0,

  -- Pricing configuration (used by rule-aware actions)
  pricing_source TEXT NOT NULL DEFAULT 'usdt_binance',  -- 'commercial_dollar' | 'usdt_binance'
  spread_mode TEXT NOT NULL DEFAULT 'bps',              -- 'bps' | 'abs_brl' | 'flat'
  sell_spread NUMERIC NOT NULL DEFAULT 0,               -- applied when client BUYS
  buy_spread NUMERIC NOT NULL DEFAULT 0,                -- applied when client SELLS

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(group_jid, name),
  CONSTRAINT valid_pricing_source CHECK (pricing_source IN ('commercial_dollar', 'usdt_binance')),
  CONSTRAINT valid_spread_mode CHECK (spread_mode IN ('bps', 'abs_brl', 'flat'))
);

-- Indexes for fast lookups
CREATE INDEX idx_group_triggers_group ON group_triggers(group_jid);
CREATE INDEX idx_group_rules_group ON group_rules(group_jid);
CREATE INDEX idx_group_rules_schedule ON group_rules(group_jid, is_active, priority DESC);
```

### Fallback Behavior

When no rule matches the current time:
1. Check `group_spreads` table (Sprint 1) for default pricing config
2. If no group_spreads config, use system defaults (USDT/BRL, no spread)

This ensures the bot always has a valid pricing configuration.

---

## 4. UI Component Reuse Strategy

| Existing Component | Reuse Strategy |
|-------------------|----------------|
| `GroupSpreadEditor` | Embed pricing fields within Rule editor |
| `TriggerPatternCreationModal` | Adapt for group-level triggers (remove profile context) |
| `ActionSelector` | Reuse as-is, add `price_quote` and `volume_quote` options |
| `ModeSelector` | Keep for group-level mode |
| `RuleTester` | Adapt to show "with rule X active, this would return..." |

**New Components Needed**:
- `RuleCard` - Displays rule summary with active indicator
- `RuleEditor` - Create/edit rules (schedule + pricing)
- `RuleSchedulePicker` - Visual time range + day selector
- `ActiveRuleBadge` - Shows which rule is currently active
- `GroupTriggerList` - Manage triggers for a group
- `TriggerCard` - Displays trigger with action type

**Estimated**: 55% reuse, 45% new code

---

## 5. Sprint Overview

| Sprint | Focus | Status | Review Gate |
|--------|-------|--------|-------------|
| **1** | Group Pricing Control | ✅ COMPLETE | ✅ Approved |
| **2** | Group Rules (Time-Based Pricing) | ✅ COMPLETE | ✅ Approved |
| **3** | Group Triggers | ✅ COMPLETE | ✅ Approved |
| **4** | Deal Flow Engine | ✅ COMPLETE | ✅ Approved |
| **5** | Message Lookback & Polish | ✅ COMPLETE | ✅ Approved |
| **6** | Demo Hardening & Production Readiness | 🟡 IN PROGRESS | Pending |

---

## 6. Sprint 1: Group Pricing Control ✅ COMPLETE

### Goal
Enable Daniel to configure per-group default pricing spreads via dashboard.

### Components Delivered

| Component | File | Description |
|-----------|------|-------------|
| Migration | `supabase/migrations/20260202_003_group_spreads.sql` | `group_spreads` table |
| Service | `src/services/groupSpreadService.ts` | CRUD + caching + quote calculation |
| API | `src/dashboard/api/spreads.ts` | REST endpoints |
| UI | `dashboard/src/components/groups/GroupSpreadEditor.tsx` | Config editor with live preview |

### Status
- [x] Migration created and applied to Supabase
- [x] Service with 5-minute cache TTL
- [x] API endpoints with validation
- [x] UI component with live rate preview
- [x] TypeScript builds passing
- [x] Deployed to production (VPS + Supabase migration applied 2026-02-03)

### Role in New Architecture
The `group_spreads` table becomes the **fallback default** when no time-based rule matches. Rules override this default when active.

---

## 7. Sprint 2: Group Rules (Time-Based Pricing) ✅ COMPLETE

### Goal
Enable Daniel to create time-based rules per group that control pricing behavior. Triggers (Sprint 3) will respect these rules.

### Components Delivered

| Component | File | Description |
|-----------|------|-------------|
| Migration | `supabase/migrations/20260203_001_group_rules.sql` | `group_rules` table with schedule, pricing, constraints |
| Service | `src/services/ruleService.ts` | CRUD + schedule matching + timezone + caching (1-min TTL) |
| Service Tests | `src/services/ruleService.test.ts` | 44 tests covering validation, timezone, schedule matching |
| API | `src/dashboard/api/groupRules.ts` | REST endpoints with input validation + auth boundary checks |
| UI | `dashboard/src/components/groups/GroupTimeRulesEditor.tsx` | Rule list + add/edit modal with schedule picker |
| Integration | `src/handlers/price.ts` | Active rule overrides default spread in price handler |
| Integration Tests | `src/handlers/price.test.ts` | 4 new tests for active rule override scenarios |

### Tasks

#### 2.1 Database Schema
- [x] Create `group_rules` migration
- [x] Add indexes for fast rule lookup by group + time
- [x] Create trigger for `updated_at` maintenance
- [x] Add CHECK constraints for valid values

**Deliverables**: `supabase/migrations/20260203_001_group_rules.sql`

**>> REVIEW GATE: ✅ Schema reviewed and approved**

#### 2.2 Rule Service
- [x] Create `src/services/ruleService.ts`
- [x] `getActiveRule(groupJid, currentTime)` - Returns currently active rule (highest priority match)
- [x] `getRulesForGroup(groupJid)` - List all rules for a group
- [x] `createRule(...)` / `updateRule(...)` / `deleteRule(...)`
- [x] Schedule matching logic (time + day + timezone via native `Intl.DateTimeFormat`)
- [x] Priority handling for overlapping schedules (sorted DESC, first match wins)
- [x] Caching with appropriate TTL (1 minute with staleness documentation)
- [x] Overnight rule handling (Window A/B logic for cross-midnight schedules)

**Deliverables**: `src/services/ruleService.ts`, `src/services/ruleService.test.ts` (44 tests)

**>> REVIEW GATE: ✅ Service logic reviewed and approved**

#### 2.3 API Endpoints
- [x] `GET /api/groups/:groupJid/rules` - List all rules
- [x] `POST /api/groups/:groupJid/rules` - Create rule (with full input validation)
- [x] `GET /api/groups/:groupJid/rules/:ruleId` - Get rule details (with group auth boundary)
- [x] `PUT /api/groups/:groupJid/rules/:ruleId` - Update rule (with full input validation)
- [x] `DELETE /api/groups/:groupJid/rules/:ruleId` - Delete rule (with existence verification)
- [x] `GET /api/groups/:groupJid/rules/active` - Get currently active rule

**Deliverables**: `src/dashboard/api/groupRules.ts`

**>> REVIEW GATE: ✅ API design reviewed and approved**

#### 2.4 Dashboard UI - Rule List
- [x] Add "Time-Based Rules" section to GroupsAndRulesPage (within expanded group)
- [x] Rule cards showing name, schedule, pricing source, priority badge
- [x] Active rule indicator (green glow + Zap icon + "ACTIVE" badge)
- [x] Add/Edit/Delete buttons per rule
- [x] Empty state with helpful prompt to create first rule

**Deliverables**: `dashboard/src/components/groups/GroupTimeRulesEditor.tsx`

**>> REVIEW GATE: ✅ UI implementation reviewed and approved**

#### 2.5 Dashboard UI - Rule Editor
- [x] Add/Edit modal component within GroupTimeRulesEditor
- [x] Rule name (max 100 chars) and description inputs
- [x] Schedule picker: time range inputs, 7-day toggle buttons, quick-select (Weekdays/All), timezone dropdown
- [x] Priority input (0-100) with explanation
- [x] Pricing source selector (USDT Binance / Commercial Dollar)
- [x] Spread configuration (mode selector + sell/buy spread inputs)
- [x] Escape key + backdrop click dismiss, toast notifications
- [x] Live preview: "This rule will be active: Mon-Fri 09:00-18:00 (Sao Paulo)"
- [x] Overlap warning: "Overlaps with 'After Hours' (P5)" with priority reminder

**Deliverables**: Combined into `dashboard/src/components/groups/GroupTimeRulesEditor.tsx`

**>> REVIEW GATE: ✅ UI/UX reviewed and approved**

#### 2.6 Integration (Active Rule Override)
- [x] Price handler checks `getActiveRule()` after getting default spread config
- [x] If active rule exists, overrides spreadMode/sellSpread/buySpread from rule
- [x] If no active rule, falls back to `group_spreads` default (Sprint 1)
- [x] Logging: "Active time rule overriding spread config" with rule details
- [x] Graceful fallback if rule lookup fails
- [x] `activeRuleName` propagated to handler result and logBotMessage metadata

**Deliverables**: Updates to `src/handlers/price.ts`, `src/types/handlers.ts`

**>> REVIEW GATE: ✅ Integration logic reviewed and approved**

### Code Review (Post-Implementation)
- Adversarial code review found 9 issues (3 HIGH, 4 MEDIUM, 2 LOW)
- All 9 issues fixed and verified:
  - H1: `deleteRule` now verifies row existed before reporting success
  - H2: `GET /:ruleId` now enforces group authorization boundary
  - H3: Full API input validation for all typed fields in POST/PUT
  - M1: `activeRuleName` propagated to metadata and handler result
  - M2: Cache efficiency documented (1-min TTL handles repeated calls)
  - M3: Rule name length limit (100 chars) enforced frontend + backend
  - M4: Cache staleness window documented in JSDoc
  - L1: Removed unused `JS_DAY_TO_ABBREV` fallback, replaced with explicit error
  - L2: Added clarifying comment for intentional frontend type duplication

### Acceptance Criteria
- [x] Daniel can create multiple rules per group via dashboard
- [x] Each rule has schedule (time range + days + timezone) and pricing config
- [x] Dashboard shows which rule is currently active
- [x] Rules with higher priority win when schedules overlap
- [x] System falls back to `group_spreads` when no rule matches
- [x] All CRUD operations work via API and UI
- [x] Code review passed with all issues resolved

---

## 8. Sprint 3: Group Triggers

### Goal
Enable Daniel to configure triggers at the group level. Triggers automatically respect the active rule's pricing configuration.

### Tasks

#### 3.1 Database Schema
- [x] Create `group_triggers` migration
- [x] Add indexes for fast trigger lookup
- [x] Unique constraint on (group_jid, trigger_phrase)

**Deliverables**: `supabase/migrations/20260204_001_group_triggers.sql`

**>> REVIEW GATE: ✅ Schema reviewed and approved**

#### 3.2 Trigger Service
- [x] Create `src/services/triggerService.ts`
- [x] `getTriggersForGroup(groupJid)` - List triggers
- [x] `matchTrigger(message, groupJid)` - Find matching trigger (respects priority)
- [x] `createTrigger(...)` / `updateTrigger(...)` / `deleteTrigger(...)`
- [x] Pattern matching (exact, contains, regex)
- [x] Amount extraction for `volume_quote` action

**Deliverables**: `src/services/triggerService.ts`, `src/services/triggerService.test.ts` (60 tests)

**>> REVIEW GATE: ✅ Service logic reviewed and approved**

#### 3.3 Action Executor
- [x] Create `src/services/actionExecutor.ts`
- [x] `executeAction(trigger, activeRule, message)` - Execute trigger's action with rule context
- [x] `price_quote` action: fetch price using rule's pricing source, apply rule's spread
- [x] `volume_quote` action: extract amount, calculate total using rule's pricing
- [x] `text_response` action: return static text (rule-agnostic)
- [x] `ai_prompt` action: pass to AI with optional rule context

**Deliverables**: `src/services/actionExecutor.ts`, `src/services/actionExecutor.test.ts` (21 tests)

**>> REVIEW GATE: ✅ Action execution logic reviewed and approved**

#### 3.4 Update ActionSelector Component
- [x] Add `price_quote` action type (rule-aware price)
- [x] Add `volume_quote` action type (rule-aware volume calculation)
- [x] Update descriptions to explain rule-awareness
- [x] Keep existing `usdt_quote` and `commercial_dollar_quote` for backward compatibility (deprecated)

**Deliverables**: Updates to `dashboard/src/components/actions/ActionSelector.tsx`, `dashboard/src/types/actions.ts`

**>> REVIEW GATE: ✅ UI changes reviewed and approved**

#### 3.5 API Endpoints
- [x] `GET /api/groups/:groupJid/triggers` - List triggers
- [x] `POST /api/groups/:groupJid/triggers` - Create trigger
- [x] `PUT /api/groups/:groupJid/triggers/:triggerId` - Update trigger
- [x] `DELETE /api/groups/:groupJid/triggers/:triggerId` - Delete trigger
- [x] `POST /api/groups/:groupJid/triggers/test` - Test message against triggers (shows which rule would be used)

**Deliverables**: `src/dashboard/api/triggers.ts`

**>> REVIEW GATE: ✅ API design reviewed and approved**

#### 3.6 Dashboard UI - Trigger Management
- [x] Add "Triggers" section to GroupsAndRulesPage
- [x] `TriggerCard` component showing phrase → action mapping
- [x] Quick enable/disable toggle
- [x] Add/Edit/Delete functionality
- [x] Adapt `TriggerPatternCreationModal` for group context (not profile)
- [x] `TriggerTester` showing: "With current rule 'X', this returns: ..."

**Deliverables**: `dashboard/src/components/groups/GroupTriggersEditor.tsx`, updates to ActionSelector

**>> REVIEW GATE: ✅ UI implementation reviewed and approved**

#### 3.7 Migration from Old System
- [x] Audit existing `rules` table entries
- [x] Create migration script: old rules → group_triggers
- [x] Handle global scope rules (create in each active group or create "default triggers" concept)
- [x] Shadow mode: log old vs new matching for validation
- [x] Deprecation plan for old `rules` table

**Deliverables**: Migration script, shadow mode logging, `src/services/triggerMigration.ts` (23 tests)

**>> REVIEW GATE: ✅ Migration plan approved + shadow mode validated**

#### 3.8 Full Bot Integration
- [x] Update message handler to use new trigger system
- [x] Flow: match trigger → get active rule → execute action with rule context
- [x] Comprehensive logging for debugging
- [x] Fallback if no trigger matches (existing AI classification)

**Deliverables**: Updates to `src/bot/router.ts`, `src/bot/router.test.ts`

**>> REVIEW GATE: ✅ Integration tested and approved**

### Code Review (Post-Implementation)
- Adversarial code review found 19 issues (9 HIGH, 10 MEDIUM) -- all resolved:
  - H1: Race condition fix -- snapshot `currentMode` at `shadowMatch()` entry
  - H2: Try-catch around `matchTrigger()` in shadow mode
  - H3: `newError` field added to distinguish error from no-match
  - H4: Replaced `as string` casts with `typeof` guards in actionExecutor
  - H5: Division-by-zero guard in `executeVolumeQuote()`
  - H6: Try-catch in router around `shadowMatch()` calls
  - H7: `initTriggerMode()` reads from `TRIGGER_SHADOW_MODE` env var
  - H8: `sanitizeLogValue()` strips control characters from log values
  - H9: ReDoS protection -- 100-char limit on user regex patterns
  - M1-M10: API validation, error message safety, migration pre-flight, test coverage

### Acceptance Criteria
- [x] Daniel can add/edit/delete triggers per group via dashboard
- [x] Triggers configured once, automatically respect active rule
- [x] `price_quote` action uses active rule's pricing source + spread
- [x] Trigger tester shows results with rule context
- [x] Old rules successfully migrated
- [x] No regression in bot responses
- [x] Shadow mode validates parity before cutover
- [x] Code review passed with all issues resolved

---

## 9. Sprint 4: Deal Flow Engine ✅ COMPLETE

### Goal
Implement stateful deal tracking: quote → lock → compute → confirm.

### Components Delivered

| Component | File | Description |
|-----------|------|-------------|
| Migration | `supabase/migrations/20260205_001_active_deals.sql` | active_deals + deal_history tables |
| Service | `src/services/dealFlowService.ts` | State machine, CRUD, TTL sweep, archival (1,022 lines) |
| Computation | `src/services/dealComputation.ts` | Brazilian number parsing, deal math (364 lines) |
| Handler | `src/handlers/deal.ts` | WhatsApp integration, state-aware handling (811 lines) |
| Handler Tests | `src/handlers/deal.test.ts` | 35 tests |
| API | `src/dashboard/api/deals.ts` | 7 REST endpoints for deal management |
| API Tests | `src/dashboard/api/deals.test.ts` | 39 tests |
| UI | `dashboard/src/components/groups/GroupDealsView.tsx` | Active deals, history, manual controls |
| Integration | `src/bot/router.ts` | Deal flow routing (+120 lines) |
| Integration | `src/bot/notifications.ts` | Expiration notifications (+73 lines) |
| Integration | `src/index.ts` | Sweep timer boot + shutdown |

### Tasks

#### 4.1 Database Schema
- [x] Create `active_deals` table
- [x] Fields: deal_id, group_jid, client_jid, state, quoted_rate, locked_rate, locked_at, ttl_expires_at, amount_brl, amount_usdt, side, rule_id_used, metadata
- [x] Create `deal_history` table for completed/expired deals

**>> REVIEW GATE: ✅ Schema reviewed and approved**

#### 4.2 State Machine Service
- [x] Create `src/services/dealFlowService.ts`
- [x] States: QUOTED → LOCKED → COMPUTING → COMPLETED / EXPIRED / CANCELLED
- [x] Transitions with validation + optimistic concurrency
- [x] TTL expiration handling with periodic sweep timer
- [x] Lock the rule at deal start (don't switch rules mid-deal)

**>> REVIEW GATE: ✅ State machine design reviewed and approved**

#### 4.3 Deal Computation
- [x] Daniel-style math: `R$ 4.479.100 / 5,25 = 853.161,90 USDT`
- [x] Amount extraction from Brazilian formats
- [x] Locale-aware formatting (pt-BR)

**>> REVIEW GATE: ✅ Computation logic reviewed and approved**

#### 4.4 WhatsApp Integration
- [x] State-aware message handling
- [x] Lock confirmation messages
- [x] Expiration notifications

**>> REVIEW GATE: ✅ Integration reviewed and approved**

#### 4.5 Dashboard UI
- [x] Active deals view
- [x] Deal history
- [x] Manual controls (cancel, extend TTL)

**>> REVIEW GATE: ✅ UI/UX reviewed and approved**

### Code Review (Post-Implementation)
- Adversarial code review found 10 issues (3 HIGH, 4 MEDIUM, 3 LOW) -- all HIGH and MEDIUM resolved:
  - H1: Metadata merge -- JSONB overwrite fixed with merge semantics
  - H2: TOCTOU race -- optimistic concurrency `.eq('state', deal.state)` guard added
  - H3: Confirmation regex -- removed overly broad "ok"/"vamos", kept explicit confirms only
  - M1: Dead ternary in pricing_source simplified
  - M2: 39 API tests added for all 7 endpoints
  - M3: Unused `groupName` prop removed
  - M4: Sweep timer lifecycle (start on boot, stop on shutdown)

### Acceptance Criteria
- [x] Complete deal flow: quote → lock → compute → confirm
- [x] TTL expiration handled correctly
- [x] Daniel can monitor and intervene via dashboard
- [x] Deal history for audit
- [x] Code review passed with all HIGH/MEDIUM issues resolved

---

## 10. Sprint 5: Message Lookback & Polish ✅ COMPLETE

### Goal
Context awareness from message history, plus production refinements.

### Components Delivered

| Component | File | Lines | Description |
|-----------|------|-------|-------------|
| Lookback indexes | `supabase/migrations/20260206_001_message_lookback_indexes.sql` | 29 | Composite indexes for sender + bot lookback |
| Message lookback | `src/services/messageHistory.ts` | +167 | `getRecentSenderMessages`, `getRecentGroupMessages`, `buildSenderContext` |
| Lookback tests | `src/services/messageHistory.test.ts` | +284 | 19 new tests |
| Suppression service | `src/services/responseSuppression.ts` | 261 | 3-check suppression: cooldown, bot-responded, operator-answered |
| Suppression tests | `src/services/responseSuppression.test.ts` | 290 | 19 tests |
| Date range filter | `src/services/dealFlowService.ts` | +14 | L3 tech debt: `from`/`to` date params for `getDealHistory` |
| API date filter | `src/dashboard/api/deals.ts` | +14 | Date range query params for history endpoint |
| API date tests | `src/dashboard/api/deals.test.ts` | +45 | 5 new date range tests |

### Tasks

#### 5.1 Message Lookback
- [x] Fetch last N messages from same sender (`getRecentSenderMessages`)
- [x] Context extraction (`buildSenderContext` - amounts, ongoing conversation)
- [x] Performance optimization (composite indexes, limit caps, performance monitoring)

**>> REVIEW GATE: Performance benchmarks ✅**

#### 5.2 Smart Response Suppression
- [x] Don't repeat answers (bot `price_response` check in 5-min window)
- [x] Detect if operator already answered (non-bot, non-sender message after trigger)
- [x] Cooldown periods (10s default, per-group, in-memory)

**>> REVIEW GATE: Logic review ✅**

#### 5.3 Polish
- [x] L3 tech debt: Deal history date range filter (from/to params)
- [x] API tests for new date range filter (5 tests)
- [x] Error handling improvements (conservative suppression - DB errors = don't suppress)

**>> REVIEW GATE: Production readiness ✅**

### Code Review
- Adversarial code review found 7 issues (1 HIGH, 3 MEDIUM, 3 LOW) -- all resolved:
  - H1: Sprint 5 services not wired into router pipeline → `shouldSuppressResponse` + `recordBotResponse` integrated (phased: `skipOperatorCheck: true`)
  - M1: Unbounded in-memory cooldown Map → eviction at 500 entries / 10-min max age
  - M2: Query filter ordering → reordered to apply filters before `.order().limit()`
  - M3: Tests didn't verify lookback window parameters → 2 new lookback window tests
  - L1: Dead imports removed (`buildSenderContext`, `Message`, `SenderContext`)
  - L2: Array.find() ordering edge case documented (newest-first, acceptable for 3-min window)
  - L3: `archived_at` NOT NULL constraint verified and documented

### Deployment
- [x] All Sprint 1-5 code committed to Azure DevOps (51 files, 17,150+ lines)
- [x] Supabase migrations applied: `group_rules`, `group_triggers`, `active_deals`, `deal_history`, message lookback indexes
- [x] VPS deployment: dist synced, PM2 restarted, all API endpoints verified 200
- [x] CRUD operations verified: create/read/delete rules and triggers working
- [x] Bot startup clean: Supabase init, 10 groups loaded, deal sweep timer running, WhatsApp connected
- [x] Dashboard accessible at http://181.215.135.75:3004/

---

## 11. Sprint 6: Demo Hardening & Production Readiness

### Goal
Prepare eNorBOT for Daniel Hon (CIO) demo presentation. Ensure the dashboard looks polished, has realistic demo data, handles edge cases gracefully, and can be confidently demonstrated without embarrassment.

**Critical Constraint**: Daniel is the first non-developer user. Every rough edge he encounters is a trust loss. This sprint prioritizes _perceived_ quality — what Daniel sees and clicks — over internal technical quality (which Sprints 1-5 already ensured).

### Deployment Baseline
- All 5 sprints deployed to VPS (verified 2026-02-03)
- All Supabase tables created and indexed
- Dashboard serving at http://181.215.135.75:3004/
- Bot connected to WhatsApp, processing messages
- 1,537 tests passing, 55 code review issues resolved across sprints

### Tasks

#### 6.1 Trigger System Consolidation (BLOCKER — must complete first)
**Objective**: Eliminate the confusing three-system trigger overlap. Cut over to the new `group_triggers` system as the single source of truth, remove the legacy Trigger Patterns tab, and clean up the old Response Rules section.

**Background**: Currently three features manage trigger-like data:
1. **Response Rules** (old `rules` table) — CRUD inside Groups & Rules expanded view
2. **Trigger Patterns tab** (old `rules` table + analytics) — separate `/patterns` page
3. **Group Triggers** (new `group_triggers` table, Sprint 3) — inside Groups & Rules expanded view

The bot router runs in **shadow mode** (`TRIGGER_SHADOW_MODE`), comparing both old and new systems but using the OLD `rules` table for actual routing decisions. Demo triggers seeded into `group_triggers` won't work until the router cuts over.

**Phase A — Router Cutover:**
- [ ] Check shadow mode logs on VPS for old-vs-new matching discrepancies:
  ```
  grep "shadow_match" /opt/enorbot/logs/out.log | tail -50
  ```
  If zero discrepancies → safe to cut over. If discrepancies exist → analyze and fix before proceeding.
- [ ] Migrate any remaining production rules from `rules` table to `group_triggers` via `triggerMigration.ts` (Sprint 3 built this)
- [ ] Set `TRIGGER_SHADOW_MODE=new` in the VPS `.env` file
- [ ] Restart PM2 and verify bot responds using new trigger system
- [ ] Monitor logs for 10 minutes to confirm no errors

**Phase B — Dashboard UI Cleanup:**
- [ ] Remove Trigger Patterns tab from sidebar navigation (`Layout.tsx` — remove navItem with `to: '/patterns'`)
- [ ] Remove `/patterns` route from `App.tsx` (remove import of `PatternsPage` and its `<Route>`)
- [ ] Remove or redirect any `/rules` legacy routes in `App.tsx`
- [ ] Remove the old "Response Rules" section from `GroupsAndRulesPage.tsx`:
  - Remove the `groupRules` state, `addingRuleForGroup`, `newRuleForm`, `savingRule`, `editingRule` state
  - Remove the `fetchRules()`, `handleSaveRule()`, `handleDeleteRule()` functions
  - Remove the rules rendering block (trigger_phrase → response_template CRUD form)
  - Keep the Player Roles section if it serves a current purpose (operator identification)
- [ ] Reorder expanded group sections (top to bottom):
  1. **⚡ Triggers** (Sprint 3 — primary interaction, what Daniel configures most)
  2. **⏰ Time-Based Rules** (Sprint 2 — schedule + pricing rules)
  3. **📊 Pricing Configuration** (Sprint 1 — default spread fallback)
  4. **🤝 Active Deals** (Sprint 4 — deal monitoring)
  5. **👥 Player Roles** (if kept — operator identification utility)

**Phase C — Dead Code Removal:**
- [ ] Delete `dashboard/src/pages/PatternsPage.tsx`
- [ ] Delete `dashboard/src/components/analytics/TriggerPatterns.tsx`
- [ ] Delete `dashboard/src/components/rules/TriggerPatternCreationModal.tsx` (if not imported elsewhere)
- [ ] Delete `dashboard/src/components/rules/TriggerPatternViewEditModal.tsx` (if not imported elsewhere)
- [ ] Keep `src/dashboard/api/rules.ts` alive (API safety net for rollback, not exposed in UI)
- [ ] Keep `src/services/rulesService.ts` alive (router fallback if `TRIGGER_SHADOW_MODE` reverted)

**Files affected**: `App.tsx`, `Layout.tsx`, `GroupsAndRulesPage.tsx`, `PatternsPage.tsx` (delete), `TriggerPatterns.tsx` (delete), `TriggerPatternCreationModal.tsx` (delete), `TriggerPatternViewEditModal.tsx` (delete), VPS `.env`

**Why this is first**: All subsequent tasks (demo data seeding, UI organization, smoke testing) depend on having a single, canonical trigger system. Seeding triggers into `group_triggers` while the router reads `rules` would make the demo non-functional.

**>> REVIEW GATE: Router uses new system, Trigger Patterns tab removed, old Response Rules section gone, sidebar shows 3 clean pages**

#### 6.2 Seed Demo Data
**Objective**: When Daniel opens the dashboard, he should see a realistic, populated system — not empty tables.

**Prerequisite**: Task 6.1 complete (router cut over, triggers are the single system).

- [ ] Create 3 time-based rules for the primary demo group:
  - **Business Hours**: Mon-Fri 09:00-18:00 (America/Sao_Paulo), pricing_source=commercial_dollar, no spread, priority=10
  - **After Hours**: Mon-Fri 18:01-08:59, pricing_source=usdt_binance, sell_spread=50 bps, buy_spread=30 bps, priority=5
  - **Weekend Premium**: Sat-Sun all day, pricing_source=usdt_binance, sell_spread=80 bps, buy_spread=50 bps, priority=15
- [ ] Create 8-10 trigger patterns for the demo group:
  - `preço` → price_quote (contains, P10) — primary Portuguese price trigger
  - `cotação` → price_quote (contains, P10) — alternate Portuguese price word
  - `price` → price_quote (contains, P10) — English groups
  - `quanto tá` → price_quote (contains, P8) — informal price request
  - `compro` → volume_quote (contains, P5) — volume inquiry
  - `vendo` → volume_quote (contains, P5) — volume inquiry (sell side)
  - `ajuda` → text_response (contains, P1, text: "Olá! Envie 'preço' para cotação USDT/BRL.") — help text
  - `help` → text_response (contains, P1, text: "Send 'price' for USDT/BRL quote.") — English help
- [ ] Configure default spread for the demo group via GroupSpreadEditor (spread_mode=bps, sell_spread=30, buy_spread=20, quote_ttl=300)
- [ ] Verify the active rule badge shows correctly for current time
- [ ] Verify trigger tester returns expected results with active rule context

**Deliverables**: Supabase data seeded via dashboard UI (not raw SQL — validates the UI flow)

**>> REVIEW GATE: Demo data looks realistic and complete**

#### 6.3 Destructive Action Protection
**Objective**: Prevent Daniel from accidentally deleting or cancelling something during the demo.

- [ ] Add confirmation dialog before deleting a time-based rule
  - Dialog text: "Delete rule '{name}'? This cannot be undone. If this rule is currently active, pricing will fall back to the default spread."
  - Buttons: "Cancel" (secondary) / "Delete" (red, destructive)
- [ ] Add confirmation dialog before deleting a trigger
  - Dialog text: "Delete trigger '{phrase}'? The bot will no longer respond to this phrase in this group."
  - Buttons: "Cancel" (secondary) / "Delete" (red, destructive)
- [ ] Add confirmation dialog before cancelling a deal
  - Dialog text: "Cancel deal with {clientName}? The client will be notified that the deal was cancelled."
  - Buttons: "Keep Deal" (secondary) / "Cancel Deal" (red, destructive)
- [ ] Ensure all delete/cancel buttons require a second click (no single-click destructive actions)

**Files affected**: `GroupTimeRulesEditor.tsx`, `GroupTriggersEditor.tsx`, `GroupDealsView.tsx`

**>> REVIEW GATE: No single-click destructive actions remain**

#### 6.4 UI Polish & Visual Feedback
**Objective**: When Daniel clicks "Save" or "Delete", the result should be immediately obvious — not inferred from a tiny toast.

- [ ] Add brief green flash/highlight animation on rule/trigger cards after successful save
- [ ] Add brief fade-out animation on cards after successful delete
- [ ] Improve toast messages with action-specific text:
  - Save: "Rule '{name}' saved successfully" (not generic "Rule saved")
  - Delete: "Rule '{name}' deleted" (not generic "Deleted")
  - Toggle: "Trigger '{phrase}' {enabled/disabled}"
- [ ] Add loading skeleton placeholders while sections load (instead of plain "Loading..." text)
- [ ] Ensure the "ACTIVE" badge on time rules updates when a new rule is saved that should become active
- [ ] Add tooltip on priority badges explaining "Higher priority wins when schedules overlap"
- [ ] Commercial Dollar card: Add Portuguese/English labels ("Compra/Bid", "Venda/Ask")

**Files affected**: `GroupTimeRulesEditor.tsx`, `GroupTriggersEditor.tsx`, `GroupDealsView.tsx`, `PriceTracker.tsx`

**>> REVIEW GATE: Visual feedback feels responsive and clear**

#### 6.5 Section Organization & Readability
**Objective**: After 6.1 removed the old clutter, ensure the remaining sections are well-organized with collapsible headers and summary counts.

**Prerequisite**: Task 6.1 complete (old sections removed, new order established).

- [ ] Add collapsible section headers for each feature area with icons and counts:
  - ⚡ Triggers (8) — starts expanded (primary interaction)
  - ⏰ Time-Based Rules (3) — starts collapsed
  - 📊 Pricing Configuration — starts collapsed
  - 🤝 Active Deals (0) — starts expanded only if deals exist
  - 👥 Player Roles — starts collapsed (utility)
- [ ] Each section header clickable to expand/collapse with smooth animation
- [ ] Persist expand/collapse state in localStorage per group (so Daniel doesn't have to re-expand every visit)
- [ ] Ensure section counts update after CRUD operations without full page reload

**Files affected**: `GroupsAndRulesPage.tsx`

**>> REVIEW GATE: Expanded group view is clean, navigable, and remembers state**

#### 6.6 Demo Group Activation
**Objective**: At least one group must be in "active" mode for the demo so the bot actually responds to WhatsApp messages using the new trigger+rules system.

**Prerequisite**: Tasks 6.1 (router cutover) and 6.2 (demo data seeded) complete.

- [ ] Identify the best demo group (criteria: low traffic, non-critical, Daniel is a member so he can test)
- [ ] Switch the demo group from "learning" to "active" mode via the dashboard mode selector
- [ ] Verify the bot processes messages in the active group:
  - Send "preço" → should return USDT/BRL quote (or commercial dollar, depending on active rule)
  - Send "ajuda" → should return help text
  - Send random text → should NOT trigger a response
- [ ] Verify response suppression is working: send "preço" twice in 10 seconds → second should be suppressed
- [ ] Verify deal flow triggers: send a volume inquiry ("compro 5000") → should create a QUOTED deal

**Important**: This task requires coordination with Daniel or a test group. If no safe test group exists, create a test group with only the bot and one operator.

**>> REVIEW GATE: Bot responds correctly in active group via WhatsApp**

#### 6.7 Error State Handling
**Objective**: When external services fail during the demo, the dashboard should degrade gracefully rather than show blank screens or cryptic errors.

- [ ] Price API failure: PriceTracker should show last cached value with "Last updated X minutes ago" instead of blank
- [ ] Supabase timeout: All sections should show "Unable to load — tap to retry" instead of hanging spinner
- [ ] AwesomeAPI rate limit (429): Commercial dollar should show fallback values (already implemented R$ 5.26/5.27) with visual indicator that it's a fallback
- [ ] Bot disconnection: If WhatsApp disconnects during demo, the dashboard status page should reflect this clearly
- [ ] Empty states should be helpful:
  - No deals: "No active deals. Deals are created when clients request quotes via WhatsApp."
  - No triggers: "No triggers configured. Add triggers to define which messages the bot responds to."
  - No rules: "No time-based rules. Without rules, the bot uses the default pricing configuration above."

**Files affected**: `PriceTracker.tsx`, `GroupTimeRulesEditor.tsx`, `GroupTriggersEditor.tsx`, `GroupDealsView.tsx`

**>> REVIEW GATE: Dashboard handles failures gracefully**

#### 6.8 Sprint 1 Deployment Gap Closure
**Objective**: Sprint 1's roadmap noted "Pending: Deploy to production." Verify it's fully operational.

- [ ] Verify `group_spreads` table has data for the demo group (seeded in 6.2)
- [ ] Verify GroupSpreadEditor loads and saves correctly on VPS
- [ ] Verify live preview calculation works (fetches Binance rate, applies spread)
- [ ] Confirm Sprint 1 status in roadmap updated to deployed (already done 2026-02-03)

**>> REVIEW GATE: Sprint 1 fully deployed and verified**

#### 6.9 End-to-End Browser Smoke Test
**Objective**: Walk through every dashboard interaction Daniel might attempt. This is the final gate.

**Prerequisite**: All other tasks complete.

- [ ] Navigate to http://181.215.135.75:3004/
- [ ] Verify page loads without console errors
- [ ] Verify sidebar shows exactly 3 pages: Overview, Groups & Rules, Costs (no Trigger Patterns)
- [ ] Click each group to expand — verify sections render in correct order (Triggers, Rules, Pricing, Deals)
- [ ] Test full CRUD cycle for Time-Based Rules:
  - Add a rule → verify it appears in list → edit it → verify changes saved → delete it (with confirmation dialog) → verify removed
- [ ] Test full CRUD cycle for Triggers:
  - Add a trigger → test it with Trigger Tester → toggle it off/on → edit it → delete it (with confirmation dialog)
- [ ] Test Spread Editor:
  - Change spread values → verify live preview updates → save → reload page → verify persisted
- [ ] Test Deals View:
  - Verify empty state message is helpful
  - If deals exist: verify extend TTL and cancel (with confirmation) buttons work
- [ ] Test PriceTracker:
  - Verify USDT/BRL and Commercial Dollar rates display
  - Click Refresh → verify rates update
- [ ] Test navigation between remaining pages (Overview, Groups & Rules, Costs)
- [ ] Verify no references to "Trigger Patterns" remain in the UI
- [ ] Test on mobile viewport (Daniel may check on phone)

**Deliverables**: Bug list with severity ratings. All HIGH/MEDIUM bugs fixed before demo.

**>> REVIEW GATE: All HIGH/MEDIUM bugs from smoke test fixed**

### Task Dependencies

```
6.1 Trigger Consolidation (FIRST — blocker)
 ├── 6.2 Seed Demo Data (needs new system active)
 │    └── 6.6 Demo Group Activation (needs data + cutover)
 ├── 6.5 Section Organization (needs old sections removed)
 ├── 6.3 Destructive Action Protection (independent)
 ├── 6.4 UI Polish (independent)
 ├── 6.7 Error State Handling (independent)
 └── 6.8 Sprint 1 Verification (independent)
      └── 6.9 Smoke Test (LAST — needs everything done)
```

### Acceptance Criteria
- [ ] Dashboard sidebar shows exactly 3 pages: Overview, Groups & Rules, Costs
- [ ] No "Trigger Patterns" tab or page exists
- [ ] No "Response Rules" section in expanded group view
- [ ] Bot router uses `TRIGGER_SHADOW_MODE=new` (new `group_triggers` table is authoritative)
- [ ] At least one group has realistic demo data (3 rules, 8+ triggers, spread config)
- [ ] Active rule badge shows correctly for current time of day
- [ ] Trigger tester returns expected results with rule context
- [ ] No single-click destructive actions (delete, cancel)
- [ ] Visual feedback on all save/delete operations
- [ ] Empty states are helpful, not confusing
- [ ] At least one group in "active" mode with bot responding to WhatsApp messages
- [ ] All external API failures show graceful fallbacks
- [ ] Browser smoke test passed with no HIGH/MEDIUM bugs remaining

### Sprint 6 Retrospective Lessons (Carry Forward)
From Sprints 1-5:
1. VALIDATE AT API BOUNDARY — all POST/PUT/DELETE endpoints validate input
2. NO DESCOPING — implement every item listed
3. TEST IN PRODUCTION ENVIRONMENT — curl verification on VPS, not just local
4. SEED DATA THROUGH THE UI — validates the user flow, not just the database
5. CONSOLIDATE BEFORE DEMO — remove legacy overlap before showing to stakeholders

---

## 12. Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Schedule overlap confusion | Medium | Priority system, UI shows overlap warnings |
| Timezone edge cases (DST) | High | Using native `Intl.DateTimeFormat` (no deps), tested in ruleService.test.ts |
| Migration breaks existing triggers | High | Shadow mode comparison before cutover |
| Rule switching mid-deal | Medium | Lock rule at deal start |
| UI complexity | High | User testing with Daniel before sprint completion |
| Demo data looks fake | Medium | Seed through dashboard UI using realistic OTC scenarios |
| Accidental deletion during demo | High | Confirmation dialogs on all destructive actions (Sprint 6.2) |
| External API failure during demo | Medium | Fallback values + clear error states (Sprint 6.6) |
| Bot doesn't respond in demo group | High | Pre-test in active mode with known trigger phrases (Sprint 6.5) |
| Dashboard unresponsive on mobile | Low | Smoke test on mobile viewport (Sprint 6.8) |

---

## 13. Review Process

Each sprint has multiple review gates marked with `>> REVIEW GATE`.

**Review Workflow**:
1. Developer completes task group
2. Code pushed to feature branch
3. Boss reviews (code review or manual inspection)
4. Approval required before proceeding
5. Sprint sign-off requires all gates passed

---

## 14. Glossary

| Term | Definition |
|------|------------|
| **Trigger** | A phrase pattern that activates a bot response (belongs to group) |
| **Rule** | A time-based configuration that controls pricing behavior |
| **Active Rule** | The rule whose schedule matches current time (highest priority wins) |
| **Pricing Source** | Where to get exchange rate: Commercial Dollar or USDT/BRL Binance |
| **Spread** | Markup/markdown on base rate (basis points or absolute BRL) |
| **Rule-Aware Action** | Action type that uses active rule's config (e.g., `price_quote`) |
| **Deal Flow** | Stateful process: quote → lock → compute → confirm |

---

## 15. Changelog

| Date | Change | By |
|------|--------|-----|
| 2026-02-02 | Document created | BMAD Agents |
| 2026-02-02 | Sprint 1 marked complete | System |
| 2026-02-02 | Restructured with Triggers + Rules separation | BMAD Agents (Party Mode) |
| 2026-02-02 | Clarified: Triggers belong to groups, Rules govern behavior | BMAD Agents |
| 2026-02-02 | Added `price_quote` rule-aware action type | BMAD Agents |
| 2026-02-03 | Sprint 2 marked complete (all 6 tasks + code review) | System |
| 2026-02-03 | Sprint 2 retrospective conducted | BMAD Agents |
| 2026-02-03 | Sprint 3 marked complete (all 8 tasks + code review) | System |
| 2026-02-03 | Sprint 3 retrospective conducted | BMAD Agents |
| 2026-02-03 | Sprint 4 marked complete (all 5 tasks + code review) | System |
| 2026-02-03 | Sprint 4 retrospective conducted | BMAD Agents |
| 2026-02-03 | Sprint 5 marked complete (all 3 tasks: lookback, suppression, polish) | System |
| 2026-02-03 | L3 tech debt resolved: deal history date range filter | System |
| 2026-02-03 | Sprint 5 code review complete (7 issues found/fixed) | System |
| 2026-02-03 | Sprint 1-5 deployed to production VPS + Supabase migrations applied | System |
| 2026-02-03 | Sprint 6 created: Demo Hardening & Production Readiness (8 tasks) | System |
| 2026-02-03 | Sprint 6 restructured: Added Task 6.1 Trigger Consolidation as blocker, renumbered to 9 tasks | BMAD Agents (Party Mode) |
| 2026-02-03 | Decision: Remove Trigger Patterns tab, cut over router to new system, remove old Response Rules | BMAD Agents (John, Winston, Sally) |

