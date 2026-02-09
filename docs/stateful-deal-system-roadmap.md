# eNorBOT Stateful Deal System Roadmap

> **Document Purpose**: Living roadmap for transforming eNorBOT into Daniel's automated CIO desk with full control via dashboard.
>
> **Last Updated**: 2026-02-09
> **Status**: Sprints 1-8.5 Complete + Deployed | Sprint 9 CODE COMPLETE — Pending migration + e2e verification
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
| **6** | Demo Hardening & Production Readiness | ✅ COMPLETE | ✅ Approved |
| **7A** | Editable System Keywords | ✅ COMPLETE | ✅ Approved (13 findings, 11 fixed) |
| **7B** | Trigger Engine Consolidation | ✅ COMPLETE | ✅ Approved |
| **8** | Volatility Protection | ✅ COMPLETE | ✅ Deployed to production |
| **8.5** | Data Lake (Medallion Architecture) | ✅ DEPLOYED | ✅ Production verified, 60+ code review fixes |
| **9** | Daniel's Live Trade Flow | ✅ CODE COMPLETE | ⏳ Pending migration + deploy + e2e |
| **10** | Unified Quote Visibility | 📋 PLANNED | — |

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

## 11. Sprint 6: Demo Hardening & Production Readiness ✅ COMPLETE

### Goal
Prepare eNorBOT for Daniel Hon (CIO) demo presentation. Ensure the dashboard looks polished, has realistic demo data, handles edge cases gracefully, and can be confidently demonstrated without embarrassment.

**Critical Constraint**: Daniel is the first non-developer user. Every rough edge he encounters is a trust loss. This sprint prioritizes _perceived_ quality — what Daniel sees and clicks — over internal technical quality (which Sprints 1-5 already ensured).

### Deployment Baseline
- All 5 sprints deployed to VPS (verified 2026-02-03)
- All Supabase tables created and indexed
- Dashboard serving at http://181.215.135.75:3004/
- Bot connected to WhatsApp, processing messages
- 1,537 tests passing, 55 code review issues resolved across sprints

### Components Delivered

| Component | File | Description |
|-----------|------|-------------|
| Router cutover | `src/bot/router.ts` | `group_triggers` as sole source of truth, removed shadow mode dependency |
| Accordion sections | `dashboard/src/pages/GroupsAndRulesPage.tsx` | 5 collapsible sections with icons, counts, localStorage persistence |
| Confirm dialog | `dashboard/src/components/ui/confirm-dialog.tsx` | Reusable confirmation dialog with double-click protection |
| System pattern service | `src/services/systemPatternService.ts` | DB-backed editable keywords with cache + fallback |
| System pattern tests | `src/services/systemPatternService.test.ts` | 15 service tests |
| System patterns API | `src/dashboard/api/systemPatterns.ts` | GET/PUT endpoints for system keyword management |
| System patterns API tests | `src/dashboard/api/systemPatterns.test.ts` | 20 route-level tests (validation, error handling, edge cases) |
| System patterns migration | `supabase/migrations/20260207_001_system_patterns.sql` | Table + seed data + RLS policies |
| Dead code removal | 6 deleted files | PatternsPage, TriggerPatterns, TriggerPatternCreationModal, TriggerPatternViewEditModal, rulesService, triggerMigration |

### Code Review (Post-Implementation)
- Adversarial code review found 10 issues (2 HIGH, 5 MEDIUM, 3 LOW):
  - H1: Dynamic Tailwind classes invisible to JIT → static class strings in `ACTION_TYPE_CONFIG`
  - H2: No auth middleware on dashboard API → deferred (systemic architectural issue)
  - M1: ConfirmDialog double-click vulnerability → internal `processing` state gates clicks
  - M2: Router redundant DB query on paused/learning → `isPriceTriggerSync` for non-active
  - M3: GroupDealsView silent error swallowing → `fetchError` state + retry button
  - M4: `onCountChange` unstable refs → `useRef` callback cache pattern
  - M5: RLS policy too permissive → restricted to `authenticated` role
  - L1-L3: Dead `_vars`, missing count badge, stale comments (deferred)

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
- [x] Dashboard sidebar shows exactly 3 pages: Overview, Groups & Rules, Costs
- [x] No "Trigger Patterns" tab or page exists
- [x] No "Response Rules" section in expanded group view
- [x] Bot router uses `group_triggers` table as authoritative (shadow mode removed)
- [x] At least one group has realistic demo data (3 rules, 8+ triggers, spread config)
- [x] Active rule badge shows correctly for current time of day
- [x] Trigger tester returns expected results with rule context
- [x] No single-click destructive actions (delete, cancel)
- [x] Visual feedback on all save/delete operations
- [x] Empty states are helpful, not confusing
- [x] At least one group in "active" mode with bot responding to WhatsApp messages
- [x] All external API failures show graceful fallbacks
- [x] Browser smoke test passed with no HIGH/MEDIUM bugs remaining

### Sprint 6 Retrospective Lessons (Carry Forward)
From Sprints 1-5:
1. VALIDATE AT API BOUNDARY — all POST/PUT/DELETE endpoints validate input
2. NO DESCOPING — implement every item listed
3. TEST IN PRODUCTION ENVIRONMENT — curl verification on VPS, not just local
4. SEED DATA THROUGH THE UI — validates the user flow, not just the database
5. CONSOLIDATE BEFORE DEMO — remove legacy overlap before showing to stakeholders

---

## 12. Sprint 7A: Editable System Keywords (COMPLETE)

### Goal
Give Daniel the ability to edit the global system pattern keywords that control how the bot detects deal flow messages, price requests, and transaction links — **without touching the router or risking live group behavior.** This is the highest-value, lowest-risk improvement we can ship.

### Background
Sprint 6 delivered:
- `system_patterns` table in Supabase (4 pattern categories seeded)
- `systemPatternService.ts` with 1-minute cache, hardcoded fallback, sync+async reads
- Dashboard API: `GET /api/system-patterns` + `PUT /api/system-patterns/:key` (20 route tests)
- Read-only System Patterns accordion panel in the dashboard

The router already reads keywords from `systemPatternService` for deal detection (`isDealCancellation`, `isPriceLockMessage`, `isConfirmationMessage`) and price triggers (`isPriceTrigger`). **Editing keywords in the `system_patterns` table already changes bot behavior** — the cache refreshes every 60 seconds. Sprint 7A makes this accessible to Daniel through the dashboard.

### Design Decisions (Party Mode — John, Sally, Winston, Bob)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Keep system patterns as a separate global layer** | System patterns apply to ALL groups. `group_triggers` is per-group. Merging them creates scope mismatch and data duplication (7 patterns x N groups). |
| 2 | **Editable panel, not unified trigger list (yet)** | Simplest path to Daniel value. Replace the read-only gray cards with editable keyword chips. No schema changes, no router changes. |
| 3 | **API auth ships first (Task 7A.0)** | Unauthenticated keyword editing is unacceptable. Shared secret auth on all write endpoints before anything else. |
| 4 | **Inline pattern tester** | Daniel adds a keyword, types a test message, sees which pattern matches. Instant confidence without needing to test via WhatsApp. |
| 5 | **Two-phase approach** | 7A ships fast and safe (editable keywords + auth). 7B ships carefully (full router consolidation). Daniel gets value without risk. |

### Prerequisites
- Sprint 6 complete (demo with Daniel done, feedback incorporated) ✅
- `system_patterns` table seeded and operational ✅
- System patterns API tested (20 route tests) ✅

### Tasks

#### 7A.0 Dashboard API Authentication (BLOCKER)
**Objective**: Protect all dashboard write endpoints with basic authentication. Daniel's bot configuration must not be publicly writable.

**Why this is first**: Sprint 6 retro flagged this as HIGH debt. Sprint 7A adds editable global keywords — anyone who discovers the URL could change what the bot responds to. This must be fixed before shipping 7A to production.

- [ ] Choose auth strategy: shared secret header (`X-Dashboard-Key`) — simplest, sufficient for single-user internal tool
- [ ] Create auth middleware: `src/dashboard/middleware/auth.ts`
  - Check `X-Dashboard-Key` header against `DASHBOARD_SECRET` env var
  - Apply to all `PUT`, `POST`, `DELETE` routes
  - `GET` routes remain open (read-only data is not sensitive)
  - Return 401 with clear error message on failure
- [ ] Add `DASHBOARD_SECRET` to `.env` on VPS
- [ ] Update dashboard frontend `api.ts` to include the secret header in all write requests
  - Secret stored in environment variable (`VITE_DASHBOARD_KEY`) or hardcoded for internal tool
- [ ] Add auth middleware tests (valid key, missing key, wrong key, GET bypass)
- [ ] Verify all existing CRUD operations still work with auth header

**Files affected**: New `src/dashboard/middleware/auth.ts`, `src/dashboard/server.ts`, `dashboard/src/lib/api.ts`, VPS `.env`

**>> REVIEW GATE: All write endpoints require auth, all read endpoints still open, existing tests updated**

#### 7A.1 Editable System Patterns Panel
**Objective**: Transform the read-only System Patterns accordion into an editable keyword manager. Daniel can add, remove, and modify keywords for each pattern category.

**Daniel's experience**: Opens a group → expands System Patterns → sees 4 categories (Price Request, Deal Cancellation, Price Lock, Deal Confirmation) → each shows editable keyword chips → clicks a chip to remove it → types a new keyword and presses Enter → chip appears → clicks "Save" → green flash confirmation → toast: "Bot now responds to 'confirmar' in all groups"

- [ ] Replace static `SYSTEM_PATTERNS` data in `GroupsAndRulesPage.tsx` with live data from `GET /api/system-patterns`
- [ ] Create `SystemPatternEditor` component (or extend existing panel):
  - Each pattern category as an editable card
  - Keywords displayed as removable chips (click X to remove)
  - Text input to add new keywords (Enter to add, comma-separated supported)
  - "Save" button per category (or auto-save with debounce)
  - Handler badge color-coded: green=PRICE_HANDLER, blue=DEAL_HANDLER, purple=TRONSCAN_HANDLER
  - Pattern type badge (contains/regex) — read-only, not editable by Daniel
  - Description text explaining what this pattern does (from DB)
  - `SYSTEM` badge + subtle lock icon on non-editable fields (handler, pattern_type)
- [ ] On save: call `PUT /api/system-patterns/:key` with updated keywords array
  - Optimistic UI: show green flash immediately
  - Toast: "Bot now responds to '{keyword}' for {category}" (include specific keyword if one was added)
  - Error toast with retry option if save fails
- [ ] Validation feedback:
  - Duplicate keyword detection (visual warning before save)
  - Empty keyword prevention (trim + reject whitespace-only)
  - Max 20 keywords per pattern (visual counter: "3/20 keywords")
  - Max 50 chars per keyword (truncate input)
- [ ] Loading state: skeleton cards while fetching from API
- [ ] Error state: "Unable to load system patterns — tap to retry" (reuse Sprint 6 pattern)

**Files affected**: `dashboard/src/pages/GroupsAndRulesPage.tsx`, potentially new `dashboard/src/components/groups/SystemPatternEditor.tsx`

**>> REVIEW GATE: Daniel can edit keywords, save persists to DB, bot behavior changes within 60 seconds (cache TTL)**

#### 7A.2 Inline Pattern Tester
**Objective**: Let Daniel type a test message and see which system pattern (if any) matches. Builds confidence that keyword changes work without needing to test via WhatsApp.

**Daniel's experience**: Below the system patterns cards, there's a "Test a message" input. Daniel types "confirmar" → sees: "Match: Deal Confirmation — this message would trigger deal confirmation." Types "hello" → sees: "No match — this message won't trigger any system pattern." Types "preço do usdt" → sees: "Match: Price Request — this message would trigger a price quote."

- [ ] Create test endpoint: `POST /api/system-patterns/test`
  - Body: `{ message: string }`
  - Response: `{ matched: boolean, patternKey?: string, category?: string, handler?: string, matchedKeyword?: string }`
  - Logic: load all patterns from `systemPatternService`, check each pattern's keywords against the message using the pattern's `patternType` (contains vs regex)
  - Return first match (highest priority) or `{ matched: false }`
- [ ] Add route tests for test endpoint (match, no match, empty message, multiple matches returns first)
- [ ] Create inline tester UI component:
  - Text input with placeholder "Type a message to test..."
  - Results shown inline below input (no modal)
  - Match: green card with pattern name, handler, matched keyword highlighted
  - No match: gray card with "No system pattern match"
  - Debounced (300ms) — tests as Daniel types
  - Clear button to reset
- [ ] Tester uses the **saved** keywords (from DB), not unsaved edits — so Daniel must save first, then test

**Files affected**: `src/dashboard/api/systemPatterns.ts`, new UI component

**>> REVIEW GATE: Tester accurately reflects saved keywords, debounced, clear match/no-match feedback**

#### 7A.3 Deploy & Verify
**Objective**: Ship Sprint 7A to production and verify Daniel's experience end-to-end.

- [ ] Build + test locally (all tests pass, TypeScript clean)
- [ ] Deploy to VPS (rsync + PM2 restart)
- [ ] Verify auth middleware blocks unauthenticated writes (`curl -X PUT` without header → 401)
- [ ] Verify auth middleware allows authenticated writes (`curl -X PUT -H "X-Dashboard-Key: ..."` → 200)
- [ ] Verify dashboard frontend sends auth header on save operations
- [ ] Edit a keyword via dashboard → verify bot behavior changes within 60 seconds
- [ ] Test inline pattern tester with known keywords
- [ ] Verify no regression on existing trigger CRUD, rule CRUD, deal operations

**>> REVIEW GATE: Production verified, auth working, keyword editing working, no regressions**

### Task Dependencies

```
7A.0 Dashboard API Auth (FIRST — blocker)
 ├── 7A.1 Editable System Patterns Panel (needs auth for saves)
 │    └── 7A.2 Inline Pattern Tester (needs editable panel as context)
 └── 7A.3 Deploy & Verify (LAST — needs everything done)
```

### Acceptance Criteria
- [ ] All dashboard write endpoints require `X-Dashboard-Key` header
- [ ] Read endpoints remain open (no auth required)
- [ ] Daniel can add, remove, and edit keywords for all 4 system pattern categories
- [ ] Changes persist to Supabase and take effect within 60 seconds (cache TTL)
- [ ] Visual feedback on save (green flash + descriptive toast)
- [ ] Inline pattern tester shows match/no-match as Daniel types
- [ ] Validation prevents empty keywords, duplicates, exceeding limits
- [ ] Error states with retry for API failures
- [ ] All existing tests pass + new tests for auth + tester endpoint
- [ ] Production deployed and verified

### Sprint 7A Acceptance Criteria Status
- [x] Dashboard auth blocks unauthenticated writes (401)
- [x] Auth allows reads without header (GET → 200)
- [x] Pattern tester matches same keywords as bot (shared regex)
- [x] Debounced UI with color-coded results
- [x] All 14 frontend write calls send X-Dashboard-Key
- [x] Dev mode works when DASHBOARD_SECRET not set
- [x] Production deployed and verified on VPS

### Sprint 7A Retrospective
**What went well:**
- Party-mode planning prevented scope creep — 4 tasks, clear dependencies
- Existing systemPatternService + API from Sprint 6 made 7A.2 fast
- Adversarial review caught real issues (timing attack, CORS, trim inconsistency)

**What to improve:**
- Deployment target was `/root/eNorBOT/` but PM2 runs from `/opt/enorbot/` — lost time debugging
- Backend TypeScript must be compiled with `npx tsc` (not just `--noEmit`) before deploying dist/

**Deferred to Sprint 7B (from adversarial review):**
- F4: Add rate limiting (requires `express-rate-limit` dependency)
- F11: Add security headers via `helmet` middleware
- F2: VITE_DASHBOARD_SECRET is visible in JS bundle — replace with session-based auth

**Carry-forward lessons from Sprints 1-6:**
1. API ROUTE TESTS ARE MANDATORY — ship with code, not as follow-up
2. VALIDATE AT API BOUNDARY — all POST/PUT/DELETE endpoints validate input
3. STATIC TAILWIND CLASSES ONLY — no dynamic template literals
4. AUTH BEFORE FEATURES — don't ship writable endpoints without protection
5. TEST IN PRODUCTION — curl verification on VPS, not just local
6. DEPLOY TO CORRECT PATH — verify PM2 `exec_cwd` matches rsync target

---

## 13. Sprint 7B: Full Trigger Engine Consolidation (PLANNED)

### Goal
Migrate all hardcoded bot pattern detection (deal flow, tronscan) into the database-driven `group_triggers` system, creating a single routing layer. This is the high-risk architectural refactor that eliminates dual-layer routing. Ship only after 7A is stable and Daniel is comfortable with keyword editing.

### Background
After Sprint 7A, Daniel can edit system keywords and the bot respects them. But routing still uses two layers:
1. **System patterns** (global, read from `systemPatternService`) for deal/price/tronscan detection
2. **Group triggers** (per-group, read from `triggerService`) for user-configured triggers

Sprint 7B collapses these into one routing path through `group_triggers`, with system patterns seeded as `is_system: true` rows.

### Prerequisites
- Sprint 7A complete and stable in production
- Daniel comfortable with keyword editing (no support issues)
- Auth middleware operational on all write endpoints

### Tasks

#### 7B.1 New Action Types
**Objective**: Extend the `group_triggers` action type vocabulary to support deal flow, tronscan, and receipt routing.

- [ ] Add new action types to `group_triggers` schema CHECK constraint:
  - `deal_lock` — Locks the quoted rate for the client's deal
  - `deal_cancel` — Cancels the client's active deal
  - `deal_confirm` — Confirms and completes the locked deal
  - `deal_volume` — Extracts volume amount and initiates a deal quote
  - `tronscan_process` — Extracts transaction hash and updates Excel log
  - `receipt_process` — Processes PDF/image receipt attachment
- [ ] Create migration: `ALTER TABLE group_triggers DROP CONSTRAINT ... ADD CONSTRAINT ... CHECK (action_type IN (...))`
- [ ] Update `triggerService.ts` action type validation
- [ ] Update `actionExecutor.ts` with execution logic for each new action type
- [ ] Add tests for new action types (service + API route tests)

**>> REVIEW GATE: Schema and executor logic reviewed, all tests pass**

#### 7B.2 System Triggers in group_triggers
**Objective**: Seed system patterns as `is_system` rows in `group_triggers` for each active group. These are non-deletable but keyword/priority editable.

**Architectural note**: This creates per-group copies of global patterns. The `system_patterns` table (Sprint 6/7A) remains as the **global source of truth** for default keywords. The `group_triggers` `is_system` rows are per-group overrides. When Daniel edits via the System Patterns panel, it updates the global defaults. Per-group customization is a future capability.

- [ ] Add `is_system BOOLEAN DEFAULT false` column to `group_triggers`
- [ ] Create seed migration: for each active group, insert system triggers:
  - Price keywords from `system_patterns` → `price_quote` action (contains, P100, is_system=true)
  - Deal cancellation keywords → `deal_cancel` action (regex, P90, is_system=true)
  - Price lock keywords → `deal_lock` action (regex, P90, is_system=true)
  - Deal confirmation keywords → `deal_confirm` action (regex, P90, is_system=true)
  - Volume pattern → `deal_volume` action (regex, P80, is_system=true)
  - Tronscan URL pattern → `tronscan_process` action (regex, P95, is_system=true)
- [ ] Receipt detection remains code-level (MIME type, not text pattern)
- [ ] API protection: `DELETE` on `is_system` triggers returns 403 "System triggers cannot be deleted"
- [ ] API allows `PUT` on `is_system` triggers for keyword/priority editing
- [ ] Add tests for is_system protection (delete blocked, update allowed)

**>> REVIEW GATE: System triggers seeded per group, delete protection verified**

#### 7B.3 Router Refactor (Gradual Cutover)
**Objective**: Migrate routing from hardcoded detection functions to database triggers. Done gradually — one action type at a time — with validation at each step.

**Cutover order** (safest first):
1. **Price triggers first** — already partially routed via `group_triggers` from Sprint 3. Remove `isPriceTrigger()` fallback.
2. **Deal flow second** — `isDealCancellation`, `isPriceLockMessage`, `isConfirmationMessage`, `hasVolumeInfo`. Replace with database trigger matches for `deal_*` action types.
3. **Tronscan third** — `hasTronscanLink`. Replace with database trigger match for `tronscan_process`.

For each step:
- [ ] Update `routeMessage()` to check database triggers for that action type
- [ ] Remove the corresponding hardcoded detection function call
- [ ] Run full router test suite — all must pass
- [ ] Deploy to VPS and verify behavior in production
- [ ] Monitor logs for 1 hour before proceeding to next step

Final router structure:
```
1. Mode check (paused → IGNORE, learning/assisted → OBSERVE_ONLY)
2. Match trigger from database (all types — system + user)
3. Route based on trigger's action_type:
   - price_quote/volume_quote/text_response/ai_prompt → PRICE_HANDLER
   - deal_lock/deal_cancel/deal_confirm/deal_volume → DEAL_HANDLER
   - tronscan_process → TRONSCAN_HANDLER
4. Receipt detection (MIME check) → RECEIPT_HANDLER
5. No match → IGNORE
```

- [ ] Keep `detectReceiptType()` in router (MIME-based, not text pattern)
- [ ] Update all router tests for new routing structure
- [ ] Remove dead detection function imports after all cutovers verified

**>> REVIEW GATE: Router uses single trigger path for each action type, all tests pass, production verified at each step**

#### 7B.4 Unified Trigger List in Dashboard
**Objective**: Replace the read-only System Patterns panel with system triggers displayed inline in the existing Triggers section. Daniel sees one unified list: system triggers (non-deletable, SYSTEM badge) at the top, user triggers below.

- [ ] Remove `systemPatterns` accordion section from `GroupsAndRulesPage.tsx`
- [ ] Remove static `SYSTEM_PATTERNS` const
- [ ] Update `GroupTriggersEditor.tsx` to fetch both user and system triggers
- [ ] System triggers displayed with:
  - `SYSTEM` badge (teal/slate color scheme)
  - Lock icon on non-editable fields (action type, handler)
  - Editable keywords and priority
  - No delete button
- [ ] User triggers displayed normally (full CRUD)
- [ ] Sort: system triggers first (by priority DESC), then user triggers
- [ ] Add new action type options to trigger creation modal (deal_lock, deal_cancel, etc.) for power users
- [ ] Inline pattern tester updated to test both system and user triggers

**>> REVIEW GATE: Unified trigger list, system triggers non-deletable, user triggers fully editable**

#### 7B.5 Dead Code Cleanup
**Objective**: Remove all hardcoded detection functions that are now replaced by database triggers.

- [ ] Remove `isPriceTrigger()` and `isPriceTriggerSync()` from `src/utils/triggers.ts`
- [ ] Remove `isDealCancellation()`, `isPriceLockMessage()`, `isConfirmationMessage()` from `src/handlers/deal.ts`
- [ ] Remove `hasVolumeInfo()` from `src/handlers/deal.ts`
- [ ] Remove `hasTronscanLink()` from `src/utils/triggers.ts`
- [ ] Remove `systemPatternService.ts` imports from detection functions (if no longer needed)
- [ ] Update all test files that reference removed functions
- [ ] Verify no orphaned imports or dead code remain

**Note**: Keep `systemPatternService.ts` itself alive — it's still used by Sprint 7A's editable panel and as the global keyword source.

**>> REVIEW GATE: No dead detection functions, all tests pass, no orphaned imports**

### Task Dependencies

```
7B.1 New Action Types (FIRST — schema foundation)
 ├── 7B.2 System Triggers in group_triggers (needs action types)
 │    └── 7B.3 Router Refactor — Gradual Cutover (needs system triggers seeded)
 │         └── 7B.4 Unified Trigger List (needs router using triggers)
 │              └── 7B.5 Dead Code Cleanup (LAST — after everything verified)
```

### Risk Mitigation
- **Gradual cutover**: One action type at a time (price → deal → tronscan). Deploy and verify at each step.
- **Rollback**: If a cutover breaks production, revert the router change and restore the hardcoded function. System triggers in DB don't cause harm if unused.
- **Receipt stays in code**: MIME-type detection is inherently different from text pattern matching. No benefit to database storage.
- **Production monitoring**: 1-hour observation window after each cutover step before proceeding.
- **Dual-layer safety net**: During cutover, both database triggers and hardcoded functions exist. Only remove hardcoded functions in 7B.5 after all cutovers are stable.

### Acceptance Criteria
- [x] All message routing decisions made via database triggers (except receipt MIME detection)
- [x] No hardcoded pattern detection functions in router (after 7B.5)
- [x] Daniel sees unified trigger list with system + user triggers
- [x] System triggers marked as non-deletable (SYSTEM badge, no delete button, 403 on API)
- [x] Deal flow works identically before and after migration (verified at each cutover step)
- [x] Gradual cutover completed: price → deal → tronscan
- [x] All existing tests pass + new tests for action types + is_system protection
- [x] Production stable for 1+ hours after each cutover step

---

## 14. Sprint 8: Volatility Protection ✅ COMPLETE

### Goal
Protect eNor from price movements between quote delivery and customer acceptance. Real-time USDT/BRL monitoring with automatic repricing when volatility thresholds are breached.

### Problem Statement
When the bot sends a price quote to a customer, there's a dangerous window between quote delivery and customer acceptance. If USD/BRL moves significantly during this time and the customer then accepts the old quote, eNor absorbs the loss from the price movement.

**Current State:**
- Daniel manually monitors prices while managing customer conversations
- Manual cancellation and re-quoting when volatility strikes
- Sometimes forced to absorb losses when he can't react fast enough
- On volatile days, this affects EVERY negotiation

### Solution
A real-time volatility protection system that:
1. Tracks USDT/BRL continuously via Binance WebSocket (free tier, true real-time)
2. Monitors the spread between quoted price and current market price for active quotes
3. Allows Daniel to configure the maximum acceptable deviation threshold per group
4. Automatically triggers re-pricing when threshold is breached: send "off" → fetch new price → send new quote
5. Escalates to Daniel after 3 reprices (control group alert + dashboard banner)

### Components Delivered

| Component | File | Description |
|-----------|------|-------------|
| Migration | `supabase/migrations/20260205_002_volatility_protection.sql` | `group_volatility_config` + `volatility_escalations` tables |
| Migration (rollback) | `supabase/migrations/20260205_002_volatility_protection_down.sql` | Rollback script |
| WebSocket service | `src/services/binanceWebSocket.ts` | Real-time USDT/BRL streaming with auto-reconnect + REST fallback |
| WebSocket tests | `src/services/binanceWebSocket.test.ts` | 12 tests |
| Active quotes service | `src/services/activeQuotes.ts` | Quote lifecycle state machine (pending → repricing → accepted/expired) |
| Active quotes tests | `src/services/activeQuotes.test.ts` | State machine tests |
| Volatility monitor | `src/services/volatilityMonitor.ts` | Core engine: threshold detection, reprice triggering, escalation |
| Volatility monitor tests | `src/services/volatilityMonitor.test.ts` | 15 tests |
| Volatility API | `src/dashboard/api/volatility.ts` | GET/PUT/POST endpoints for per-group config |
| Escalations API | `src/dashboard/api/escalations.ts` | GET escalations, POST dismiss |
| Price SSE endpoint | `src/dashboard/api/prices.ts` | Server-Sent Events for live price streaming (throttled 5/sec, max 10 connections) |
| Dashboard widget | `dashboard/src/components/groups/GroupSpreadEditor.tsx` | Real-time chart + threshold config + escalation banner |
| Boot integration | `src/index.ts` | WebSocket + monitoring startup/shutdown |
| Router integration | `src/bot/router.ts` | `forceAccept()` on deal confirmation |
| Price handler integration | `src/handlers/price.ts` | `createQuote()` on successful price send |

### Tasks

#### 8.1 Database Migration ✅
- [x] Create `group_volatility_config` table (enabled, threshold_bps, max_reprices)
- [x] Create `volatility_escalations` table (for dashboard banner persistence)
- [x] Add indexes and constraints (threshold 1-1000 bps, max reprices 1-10)
- [x] Create rollback migration

**Deliverables**: `supabase/migrations/20260205_002_volatility_protection.sql`

#### 8.2 Binance WebSocket Service ✅
- [x] Create `src/services/binanceWebSocket.ts`
- [x] WebSocket connection to Binance USDT/BRL trade stream
- [x] Auto-reconnect with exponential backoff (max 10s)
- [x] REST fallback polling during reconnection (2s interval, 2s overlap after reconnect)
- [x] Price callback system for monitoring service
- [x] Graceful shutdown on process exit
- [x] Connection status tracking (connected/connecting/disconnected)

**Deliverables**: `src/services/binanceWebSocket.ts`, `src/services/binanceWebSocket.test.ts` (12 tests)

#### 8.3 Active Quotes Service ✅
- [x] Create `src/services/activeQuotes.ts`
- [x] Formal state machine: `pending` → `repricing` → `pending`/`accepted`/`expired`
- [x] `tryLockForReprice()` - prevents concurrent reprices
- [x] `forceAccept()` - always wins, even during repricing (customer acceptance priority)
- [x] Auto-expire after configurable TTL (default 5 min)
- [x] One active quote per group at a time

**Deliverables**: `src/services/activeQuotes.ts`, `src/services/activeQuotes.test.ts`

#### 8.4 Volatility Monitor Service ✅
- [x] Create `src/services/volatilityMonitor.ts`
- [x] Subscribe to price updates from WebSocket
- [x] Threshold breach detection (deviation >= threshold_bps)
- [x] Reprice flow: send "off" → fetch fresh price → apply spread → send new quote
- [x] Escalation after max reprices (persist to DB + control group notification)
- [x] Per-group config loading with 1-minute cache
- [x] Group pausing after escalation

**Deliverables**: `src/services/volatilityMonitor.ts`, `src/services/volatilityMonitor.test.ts` (15 tests)

#### 8.5 Price Handler Integration ✅
- [x] Import activeQuotes service in `src/handlers/price.ts`
- [x] Call `createQuote(groupJid, finalPrice)` after successful price send
- [x] Quote lifecycle starts on price send, ends on deal acceptance

**Deliverables**: Updates to `src/handlers/price.ts`

#### 8.6 Router Integration ✅
- [x] Import activeQuotes in `src/bot/router.ts`
- [x] On `deal_confirm` trigger, call `forceAccept(groupJid)`
- [x] Acceptance always wins, even during active reprice

**Deliverables**: Updates to `src/bot/router.ts`

#### 8.7 Volatility Config API ✅
- [x] Create `src/dashboard/api/volatility.ts`
- [x] `GET /api/groups/:groupJid/volatility` - Get config (returns defaults if none)
- [x] `PUT /api/groups/:groupJid/volatility` - Update config (upsert)
- [x] `POST /api/groups/:groupJid/volatility` - Create config with defaults
- [x] Input validation via Zod
- [x] Register routes in `server.ts`

**Deliverables**: `src/dashboard/api/volatility.ts`

#### 8.8 Dashboard Price Stream (SSE) ✅
- [x] Add SSE endpoint `GET /api/prices/stream` in `src/dashboard/api/prices.ts`
- [x] Rate limiting: max 10 concurrent connections
- [x] Throttle broadcasts to 5/second (200ms interval)
- [x] Connection cleanup on client disconnect

**Deliverables**: Updates to `src/dashboard/api/prices.ts`

#### 8.9 Dashboard Widget ✅
- [x] Replace "COMING SOON" placeholder in `GroupSpreadEditor.tsx`
- [x] Real-time line chart using Recharts with EventSource for SSE
- [x] Settings panel: enable/disable toggle, threshold input (1-1000 bps), max reprices input (1-10)
- [x] Threshold line overlay on chart
- [x] Escalation alert banner (red, dismissible)
- [x] Input validation (clamp to valid ranges)

**Deliverables**: Rewritten `dashboard/src/components/groups/GroupSpreadEditor.tsx`

#### 8.10 Escalation API ✅
- [x] Create `src/dashboard/api/escalations.ts`
- [x] `GET /api/groups/:groupJid/escalations` - List escalations (optional `?active=true`)
- [x] `POST /api/groups/:groupJid/escalations/:id/dismiss` - Dismiss escalation + unpause group
- [x] Register routes in `server.ts`

**Deliverables**: `src/dashboard/api/escalations.ts`

#### 8.11 Boot Sequence Integration ✅
- [x] Start Binance WebSocket IMMEDIATELY on process start (not gated by WhatsApp)
- [x] Start monitoring service after WebSocket
- [x] Periodic quote cleanup interval (every 60s)
- [x] Initialize socket reference when WhatsApp connects
- [x] Graceful shutdown: stop monitoring, clear intervals, close WebSocket

**Deliverables**: Updates to `src/index.ts`, `src/bot/connection.ts`

### Remaining Tasks

#### 8.12 Deploy & Verify
- [ ] Apply Supabase migration to production
- [ ] Build + deploy to VPS (rsync + PM2 restart)
- [ ] Verify WebSocket connects to Binance
- [ ] Verify dashboard widget loads and shows live prices
- [ ] Test threshold configuration save/load
- [ ] Test reprice flow end-to-end (may need volatile market or test with low threshold)
- [ ] Verify escalation banner appears and can be dismissed

#### 8.13 Code Review ✅
- [x] Adversarial code review per project standards
- [x] Fix all HIGH/MEDIUM issues before marking complete

**Code Review Findings (7 fixed):**
- **SSE Connection Leak** (HIGH): Only `close` event handled, not `error` → Added error handler with shared cleanup function
- **Escalation Race Condition** (HIGH): Group paused before DB persist could fail → Reordered: persist first, pause only on success
- **forceAccept During Repricing** (MEDIUM): Only checked `pending` status → Now accepts both `pending` and `repricing`
- **Overly Sensitive Threshold** (MEDIUM): Zod min(1) bps would trigger on every tick → Changed to min(10) bps
- **Quote ID Not Crash-Safe** (MEDIUM): Simple counter reset on restart → Changed to timestamp + counter format
- **False Positives Identified**: WebSocket backoff (already had exponential backoff), SSE heartbeat timer (already cleared per-client)
- **New Integration Tests**: Full reprice cycle, escalation after max reprices, race condition fix (DB failure = group NOT paused)

### Technical Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Binance WebSocket over REST polling** | True real-time updates, free tier, lower latency |
| 2 | **REST fallback during reconnection** | 2s overlap period avoids blind spots |
| 3 | **In-memory active quotes store** | Speed critical; quotes are short-lived |
| 4 | **Per-group threshold config in Supabase** | Configurable via dashboard, survives restarts |
| 5 | **"off" + new price messaging** | Industry standard in OTC |
| 6 | **3-reprice limit before escalation** | Prevents infinite loops on extreme volatility |
| 7 | **Formal state machine for quotes** | Explicit states with locked transitions prevent race conditions |
| 8 | **SSE over WebSocket for dashboard** | Simpler, works over HTTP, dashboard only receives |

### Acceptance Criteria
- [x] Binance WebSocket streams USDT/BRL prices continuously
- [x] Active quotes tracked from price send to acceptance/expiry
- [x] Threshold breach triggers automatic reprice (send "off" + new quote)
- [x] Max 3 reprices before escalation to control group
- [x] Dashboard shows real-time price chart with SSE
- [x] Daniel can configure threshold per group (1-1000 bps)
- [x] Escalation banner persists across page refreshes
- [x] All tests pass (1601 tests)
- [x] TypeScript compiles cleanly
- [ ] Deployed to production and verified
- [x] Code review passed (7 issues fixed)

---

## 14b. Sprint 8.5: Data Lake — Medallion Architecture ✅ COMPLETE

### Goal
Build an analytical data foundation (Bronze → Silver → Gold) so price ticks are captured, deal state transitions are recorded as events, and dashboard analytics read from pre-aggregated tables instead of scanning 10k+ raw messages per request. Required before Sprint 9 (live trading) for trade desk analytics, slippage analysis, and operator response metrics.

### Architecture

```
BRONZE (raw capture)          SILVER (enriched)              GOLD (business-ready)
─────────────────────         ─────────────────              ───────────────────
bronze_price_ticks      →     silver_price_ohlc_1m     →     gold_daily_trade_volume
bronze_deal_events      →     silver_deal_lifecycle    →     gold_spread_effectiveness
messages (existing)     →     silver_player_stats      →     gold_operator_response_times
                              silver_group_activity    →     gold_group_summary
                                                       →     gold_cost_daily
```

### Components Delivered

| Component | File | Description |
|-----------|------|-------------|
| Bronze migration | `supabase/migrations/20260210_003_bronze_layer.sql` | `bronze_price_ticks` + `bronze_deal_events` tables + indexes + retention cleanup function |
| Silver migration | `supabase/migrations/20260210_004_silver_layer.sql` | 3 Silver tables + `silver_deal_lifecycle` view + 3 refresh functions |
| Gold migration | `supabase/migrations/20260210_005_gold_layer.sql` | 5 Gold tables + master `refresh_gold_layer()` PL/pgSQL function |
| Data Lake service | `src/services/dataLake.ts` | Emit functions, refresh orchestration, lifecycle management |
| Data Lake tests | `src/services/dataLake.test.ts` | 16 tests covering emit, throttle, refresh, lifecycle |
| Binance WS hook | `src/services/binanceWebSocket.ts` | `emitPriceTick('binance_ws', ...)` in `notifyPriceUpdate()` |
| AwesomeAPI hook | `src/services/awesomeapi.ts` | `emitPriceTick('awesomeapi', ...)` after fetch |
| TradingView hook | `src/services/tradingViewScraper.ts` | `emitPriceTick('tradingview', ...)` after title parse |
| Deal event hooks | `src/services/dealFlowService.ts` | `emitDealEvent()` in `createDeal()`, `transitionDeal()`, `archiveDeal()` |
| Boot integration | `src/index.ts` | `startDataLakeRefresh()` / `stopDataLakeRefresh()` in lifecycle |
| Analytics API | `src/dashboard/api/analytics.ts` | Heatmap + players endpoints switched to Silver reads |
| Costs API | `src/dashboard/api/costs.ts` | Summary/by-group/trend endpoints try Gold first, fall back to raw |
| Prices API | `src/dashboard/api/prices.ts` | New `/ohlc` + `/trade-desk` endpoints from Silver/Gold |

### Tasks

#### 8.5A — Bronze Layer (raw event capture)
- [x] Create `bronze_price_ticks` table (source, symbol, price, bid, ask, captured_at) with indexes
- [x] Create `bronze_deal_events` table (deal_id, group_jid, client_jid, from_state, to_state, event_type, market_price, deal_snapshot, metadata)
- [x] Create `bronze_retention_cleanup()` function (90-day TTL for ticks, deal events kept indefinitely)
- [x] Create `src/services/dataLake.ts` with `emitPriceTick()` (fire-and-forget, 5s throttle for Binance WS) and `emitDealEvent()`
- [x] Hook price tick emission into Binance WS, AwesomeAPI, and TradingView scraper
- [x] Hook deal event emission into `createDeal()`, `transitionDeal()`, `archiveDeal()`

#### 8.5B — Silver Layer (enriched aggregates)
- [x] Create `silver_price_ohlc_1m` table (1-minute OHLC candles, composite PK on symbol+bucket+source)
- [x] Create `silver_deal_lifecycle` view over `deal_history` + `bronze_deal_events` (timing, slippage enrichment)
- [x] Create `silver_player_stats` table (incremental upsert from messages)
- [x] Create `silver_group_activity` table (hour×day heatmap, replaces 10k-message JS aggregation)
- [x] Create 3 refresh functions: `refresh_silver_ohlc()`, `refresh_silver_player_stats()`, `refresh_silver_group_activity()`
- [x] Add Silver refresh to dataLake service (every 60 seconds via `setInterval`)

#### 8.5C — Gold Layer (business-ready metrics)
- [x] Create `gold_daily_trade_volume`, `gold_spread_effectiveness`, `gold_operator_response_times` tables
- [x] Create `gold_group_summary` table (replaces expensive `/api/groups` aggregation)
- [x] Create `gold_cost_daily` table (replaces full `ai_usage` scans)
- [x] Create master `refresh_gold_layer()` PL/pgSQL function (refreshes last 7 days on each run)
- [x] Add Gold refresh to dataLake service (every 5 minutes via `setInterval`)
- [x] Add Bronze retention cleanup (daily via `setInterval`)

#### 8.5D — Dashboard Integration
- [x] Switch heatmap endpoint to read from `silver_group_activity` (graceful fallback if table missing)
- [x] Switch players endpoint to read from `silver_player_stats` + contacts join
- [x] Switch cost summary/by-group/trend to try `gold_cost_daily` first, fall back to raw `ai_usage`
- [x] Add `GET /api/prices/ohlc` — OHLC candles from Silver layer (symbol, source, hours params)
- [x] Add `GET /api/prices/trade-desk` — trade volume + spread + response time from Gold layer
- [x] Add `startDataLakeRefresh()` / `stopDataLakeRefresh()` to bot lifecycle in `src/index.ts`

### Technical Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Fire-and-forget Bronze writes** | Bronze inserts use `Promise.resolve().then().catch()` — never block the caller, never throw. Trading performance is sacrosanct. |
| 2 | **5-second throttle for Binance WS** | Binance WS delivers hundreds of ticks/sec. 12/min is more than enough for OHLC candles. |
| 3 | **Graceful Silver/Gold fallback** | All dashboard endpoints check for PGRST205/42P01 (table not found) and fall back to raw queries. Migration can be applied incrementally. |
| 4 | **Postgres-side aggregation** | Silver/Gold refresh uses SQL functions (`refresh_silver_ohlc()`, `refresh_gold_layer()`). JS side just calls `.rpc()`. Heavy lifting stays in the database. |
| 5 | **Separate refresh cadences** | Silver=60s (near-real-time analytics), Gold=5min (business summaries), Retention=daily. Each layer serves a different freshness need. |
| 6 | **Market price snapshot in deal events** | `bronze_deal_events.market_price` captures Binance price at event time via `getCurrentPrice()`. Enables slippage analysis in Silver/Gold. |

### Refresh Cadence

| Layer | Interval | Method |
|-------|----------|--------|
| Bronze ticks | Real-time (throttled 5s for WS) | `emitPriceTick()` — fire-and-forget insert |
| Bronze events | Real-time | `emitDealEvent()` — fire-and-forget insert |
| Silver | Every 60 seconds | `refreshSilverLayer()` — calls 3 Postgres RPCs |
| Gold | Every 5 minutes | `refreshGoldLayer()` — calls master Postgres RPC |
| Retention | Every 24 hours | `runRetentionCleanup()` — deletes ticks > 90 days |

### Acceptance Criteria
- [x] Bronze tables created with indexes and retention function
- [x] Price ticks emitted from all 3 sources (Binance WS, AwesomeAPI, TradingView)
- [x] Deal events emitted on create, transition, and archive
- [x] Silver refresh functions aggregate from Bronze + messages tables
- [x] Gold refresh function produces business-ready daily summaries
- [x] Dashboard analytics endpoints read from Silver/Gold with graceful fallback
- [x] New OHLC and trade desk API endpoints functional
- [x] Data lake lifecycle integrated into bot startup/shutdown
- [x] All 1,705 tests pass (54 test files), zero TypeScript errors
- [ ] Supabase migrations applied to production
- [ ] Production verified with data flowing through all 3 layers

---

## 15. Sprint 9: Daniel's Live Trade Flow (CODE COMPLETE — Deploy + E2E)

### Goal
Implement CIO Daniel Hon's two production scenarios for live mode: the **good scenario** (price → lock → amount → calculation + @mention) and the **off scenario** (price → rejection + @mention). This is the bridge from learning mode to live trading. Per-group configurable via `deal_flow_mode`.

### Background
Daniel sent explicit instructions for how the bot should behave when switched from learning to live mode. Analysis of 256 real messages from 6 OTC groups (see `docs/behavioral-analysis.md`) confirms these are the exact patterns operators execute manually today. The bot automates what Davi currently does by hand.

**Real conversation from OTC Liqd > eNor (2026-01-27):**
```
[17:45] Henequim:       trava 7831
[17:45] OTC eNor/Davi:  opa
[17:46] OTC eNor/Davi:  7831 * 5.232 = 40,971.79 BRL
[17:46] Henequim:       trava
[17:46] Henequim:       e manda pf
[17:47] Henequim:       /compra
```

**Daniel's OFF scenario:**
```
Client asks "preço" → Bot sends price → Client sends "off" → Bot replies "off" + @mentions Daniel
```

**Daniel's GOOD scenario:**
```
Client asks "preço" → Bot sends price → Client sends trava/fecha/lock/ok →
Bot waits for USDT amount (1 min timeout, then asks) →
Client sends amount → Bot sends calculation (amount × rate = BRL) + @mentions Daniel
```

### Design Decisions (Party Mode — John, Winston, Amelia, Murat, Mary)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Per-group `deal_flow_mode`** (`classic` / `simple`) | Classic = existing 3-step (quote→lock→confirm). Simple = Daniel's 2-step. Groups choose independently. |
| 2 | **Locks are context-gated by deal state** | Lock keywords (trava/fecha/lock/ok) ONLY trigger when sender has active QUOTED deal. Prevents false positives from casual "ok" in chat. Boss directive. |
| 3 | **Deal state drives routing in simple mode** | Router intercepts by deal state BEFORE trigger matching. No new trigger action types needed. Classic mode completely bypasses this intercept. |
| 4 | **WhatsApp @mentions via Baileys native API** | `sock.sendMessage(jid, { text, mentions: [jid] })`. Optional param added to messaging utility — zero impact on existing callers. |
| 5 | **Amount extraction reuses existing math engine** | `dealComputation.ts` already handles "trava 5000", "500 usdt", "10k", Brazilian formats. No new parsing needed. |
| 6 | **Bilingual prompts based on group language** | `group_language` column (`pt`/`en`). "Quantos USDTs serão comprados?" / "How much USDT will be purchased?" |
| 7 | **Re-prompt via extended sweep** | Extend `sweepExpiredDeals()` — if `awaiting_amount` > 60s and not re-prompted, send prompt. > 120s → expire. No new timer infrastructure. |

### Prerequisites
- Sprint 8 complete (volatility protection operational) ✅
- Sprint 8.5 complete (Medallion data lake deployed to production) ✅
- Deal state machine working (Sprints 4-5) ✅
- Trigger system consolidated (Sprint 7B) ✅
- Brazilian math engine tested (dealComputation.ts) ✅

### Tasks

#### 9.1 WhatsApp Mentions Support ✅ CODE COMPLETE
**Objective**: Enable @mentioning users in WhatsApp group messages via Baileys native API.

- [x] Update `sendWithAntiDetection()` in `src/utils/messaging.ts`:
  - Add optional `mentions?: string[]` parameter
  - Pass through to Baileys' `sock.sendMessage(jid, { text, mentions })`
  - WhatsApp format: `@DisplayName` in text + `["5511...@s.whatsapp.net"]` in mentions array
- [x] Create helper: `formatMention(jid: string, displayName?: string)` → returns `{ textSegment, jid }`
- [x] Unit tests: verify payload shape with mock socket, test with/without mentions (backward compatible)
- [x] Zero impact on existing callers (parameter is optional, defaults to undefined)

**Files affected**: `src/utils/messaging.ts`, new tests

**>> REVIEW GATE: Mentions work with Baileys, existing callers unaffected**

#### 9.2 Deal Flow Mode Configuration ✅ CODE COMPLETE
**Objective**: Add per-group configuration for Daniel's simplified trade flow.

- [x] Create migration `supabase/migrations/20260210_001_deal_flow_mode.sql`:
  ```sql
  ALTER TABLE group_spreads
    ADD COLUMN IF NOT EXISTS deal_flow_mode TEXT NOT NULL DEFAULT 'classic'
      CHECK (deal_flow_mode IN ('classic', 'simple')),
    ADD COLUMN IF NOT EXISTS operator_jid TEXT,
    ADD COLUMN IF NOT EXISTS amount_timeout_seconds INTEGER NOT NULL DEFAULT 60
      CHECK (amount_timeout_seconds BETWEEN 30 AND 300),
    ADD COLUMN IF NOT EXISTS group_language TEXT NOT NULL DEFAULT 'pt'
      CHECK (group_language IN ('pt', 'en'));
  ```
- [x] Update `GroupSpreadService` to expose new columns
- [x] Update `GroupSpreadEditor.tsx` dashboard component:
  - Deal Flow Mode toggle: Classic / Simple
  - Operator JID input (with contact picker if possible, or raw JID)
  - Amount timeout slider (30-300 seconds)
  - Group language selector (PT / EN)
- [x] Update API validation (Zod schema for PUT endpoint)
- [x] Create rollback migration

**Files affected**: Migration, `src/services/groupSpreadService.ts`, `dashboard/src/components/groups/GroupSpreadEditor.tsx`, `src/dashboard/api/spreads.ts`

**>> REVIEW GATE: Config persists, dashboard UI exposes all 4 fields, defaults are safe**

#### 9.3 New Deal States ✅ CODE COMPLETE
**Objective**: Extend the deal state machine with `awaiting_amount` and `rejected` states.

- [x] Update `DealState` type in `src/services/dealFlowService.ts`:
  ```typescript
  type DealState = 'quoted' | 'locked' | 'awaiting_amount' | 'computing' | 'completed' | 'expired' | 'cancelled' | 'rejected'
  ```
- [x] Add transitions:
  - `locked → awaiting_amount` (when lock has no amount, simple mode)
  - `awaiting_amount → computing → completed` (when amount received)
  - `awaiting_amount → expired` (timeout after 2× amount_timeout_seconds)
  - `awaiting_amount → cancelled` (client cancels)
  - `quoted → rejected` (client sends "off")
- [x] Add `reprompted_at` nullable timestamp column to `active_deals`
- [x] Update `sweepExpiredDeals()` to handle `awaiting_amount`:
  - Age > `amount_timeout_seconds` and `reprompted_at` is null → send re-prompt, set `reprompted_at`
  - Age > 2× `amount_timeout_seconds` → expire normally
- [x] Update database CHECK constraint for new states
- [x] Update all state guard validations
- [x] Tests: new state transitions, sweep re-prompt logic, rejection path

**Files affected**: `src/services/dealFlowService.ts`, migration `20260210_002_deal_states_expansion.sql`

**>> REVIEW GATE: State machine extended, TTL sweep handles re-prompt, all existing transitions untouched**

#### 9.4 Deal-State Router Intercept (Simple Mode) ✅ CODE COMPLETE
**Objective**: In simple mode, route messages based on sender's deal state BEFORE trigger matching.

- [x] In `src/bot/router.ts`, add intercept after mode check, before trigger matching:
  ```
  [SIMPLE MODE ONLY] Check sender's active deal:
    QUOTED + lock keyword    → DEAL_HANDLER (dealAction: 'price_lock')
    QUOTED + "off"           → DEAL_HANDLER (dealAction: 'rejection')
    AWAITING_AMOUNT + number → DEAL_HANDLER (dealAction: 'volume_input')
    AWAITING_AMOUNT + cancel → DEAL_HANDLER (dealAction: 'cancellation')
    Otherwise                → fall through to normal trigger matching
  ```
- [x] Lock keywords sourced from `system_patterns.price_lock` + "ok" + "fecha" (configurable)
- [x] Off keywords: "off" (hardcoded, matches Daniel's instruction)
- [x] Amount detection: reuse `parseBrazilianNumber()` — if message parses to a valid number > 0
- [x] `deal_flow_mode` fetched from group config (cached)
- [x] Classic mode: intercept completely skipped, existing behavior untouched
- [x] Tests:
  - Classic mode: verify ZERO behavior change (regression suite)
  - Simple mode: lock keywords only fire with active QUOTED deal
  - Simple mode: "ok" in casual chat (no deal) → falls through to triggers
  - Simple mode: sender A has deal, sender B says "off" → B's message doesn't affect A
  - Simple mode: amount intercept only fires in AWAITING_AMOUNT state

**Files affected**: `src/bot/router.ts`

**>> REVIEW GATE: Classic mode regression-free, simple mode intercept correct, false positive tests pass**

#### 9.5 Rejection Handler ("Off" Path) ✅ CODE COMPLETE
**Objective**: Handle the off scenario — client rejects the quoted price.

- [x] Add `handleRejection()` in `src/handlers/deal.ts`:
  1. Find sender's active deal (must be in `quoted` state)
  2. Transition deal to `rejected` state
  3. Send "off" to group (matching Daniel's instruction)
  4. @mention `operator_jid` from group config (using Task 9.1)
  5. Archive deal to `deal_history`
- [x] Log to control group: "Deal rejected by {clientName} in {groupName}"
- [x] Tests: rejection transition, mention payload, archive verification

**Files affected**: `src/handlers/deal.ts`

**>> REVIEW GATE: Off path works end-to-end, Daniel gets tagged, deal archived**

#### 9.6 Lock + Amount Flow (Simple Mode) ✅ CODE COMPLETE
**Objective**: Handle the lock step in Daniel's good scenario, with or without inline amount.

- [x] Modify `handlePriceLock()` in `src/handlers/deal.ts` for simple mode:
  - **Amount included** (e.g., "trava 5000"):
    1. Extract USDT amount via `extractUsdtAmount()` / `parseBrazilianNumber()`
    2. Lock deal at quoted rate
    3. Compute: `usdt_amount × locked_rate = brl_amount`
    4. Send formatted message: `"5.000 USDT × 5,2500 = R$ 26.250,00"`
    5. @mention `operator_jid`
    6. Transition: LOCKED → COMPUTING → COMPLETED
    7. Archive deal
  - **No amount** (e.g., "trava", "ok", "fecha"):
    1. Lock deal at quoted rate
    2. Transition: LOCKED → AWAITING_AMOUNT
    3. Send bilingual prompt:
      - PT: `"Taxa travada em {rate}. Quantos USDTs serão comprados?"`
      - EN: `"Rate locked at {rate}. How much USDT will be purchased?"`
- [x] Classic mode: existing `handlePriceLock()` behavior unchanged
- [x] Tests: both paths (with/without amount), language variants, classic mode unaffected

**Files affected**: `src/handlers/deal.ts`

**>> REVIEW GATE: Both lock paths work, classic mode untouched, bilingual prompts correct**

#### 9.7 Volume Input Handler ✅ CODE COMPLETE
**Objective**: Handle the follow-up amount message after lock (awaiting_amount state).

- [x] Add `handleVolumeInput()` in `src/handlers/deal.ts`:
  1. Parse USDT amount from message via `extractUsdtAmount()` / `parseBrazilianNumber()`
  2. If parsing fails → send gentle error: "Não entendi o valor. Envie o valor em USDT (ex: 500, 10k)." / "Couldn't understand the amount. Send USDT value (e.g., 500, 10k)."
  3. Compute: `usdt_amount × locked_rate = brl_amount` using `computeUsdtToBrl()`
  4. Send formatted message: `"500 USDT × 5,2500 = R$ 2.625,00"`
  5. @mention `operator_jid`
  6. Transition: AWAITING_AMOUNT → COMPUTING → COMPLETED
  7. Archive deal
- [x] Tests: valid amount, invalid amount (retry), Brazilian format parsing, mention payload

**Files affected**: `src/handlers/deal.ts`

**>> REVIEW GATE: Volume input parsed correctly, calculation matches dealComputation output, Daniel tagged**

#### 9.8 Re-prompt Timer ✅ CODE COMPLETE
**Objective**: After 60 seconds of waiting for amount, send a reminder. After 120 seconds, expire.

- [x] Extend `sweepExpiredDeals()` in `src/services/dealFlowService.ts`:
  - For each deal in `awaiting_amount` state:
    - If `age > amount_timeout_seconds` AND `reprompted_at IS NULL`:
      - Send bilingual prompt to group: "Aguardando valor em USDT..." / "Waiting for USDT amount..."
      - Update `reprompted_at = NOW()` in database
    - If `age > 2 × amount_timeout_seconds`:
      - Expire deal normally (transition to `expired`)
      - Send expiry message to group
- [x] Sweep already runs every 30 seconds — no new infrastructure needed
- [x] Tests: re-prompt fires at correct time, expiry after 2× timeout, reprompted_at prevents double-prompt

**Files affected**: `src/services/dealFlowService.ts`

**>> REVIEW GATE: Re-prompt fires once, expiry fires after 2× timeout, no double-prompts**

#### 9.9 Deploy & Verify ⏳ REMAINING WORK
**Objective**: Ship Sprint 9 to production and verify both scenarios end-to-end.

**This is the ONLY task remaining for Sprint 9. All code (9.1-9.8) is complete and tested.**

- [ ] Apply Sprint 9 Supabase migrations:
  - `20260210_001_deal_flow_mode.sql` (adds columns to `group_spreads`)
  - `20260210_002_deal_states_expansion.sql` (extends state CHECK, adds `reprompted_at`)
- [ ] Build + deploy to VPS (`./deploy.sh`)
- [ ] Configure one test group: `deal_flow_mode = 'simple'`, `operator_jid = Daniel's JID`
- [ ] Test OFF scenario: "preço" → get price → "off" → verify "off" + @Daniel
- [ ] Test GOOD scenario (with amount): "preço" → get price → "trava 500" → verify calculation + @Daniel
- [ ] Test GOOD scenario (without amount): "preço" → get price → "ok" → verify prompt → "500" → verify calculation + @Daniel
- [ ] Test timeout: "preço" → get price → "ok" → wait 60s → verify re-prompt → wait 60s → verify expiry
- [ ] Verify classic mode group is completely unaffected
- [ ] Verify "ok" in casual chat (no deal) doesn't trigger anything
- [ ] Verify Bronze deal events capture state transitions for new states
- [ ] Monitor logs for 30 minutes

**>> REVIEW GATE: Both scenarios work on production, classic mode zero regression**

### Task Dependencies

```
9.1 WhatsApp Mentions (FIRST — foundational)
 ├── 9.2 Deal Flow Mode Config (parallel with 9.1)
 │    └── 9.4 Router Intercept (needs config to check mode)
 ├── 9.3 New Deal States (parallel with 9.1)
 │    ├── 9.5 Rejection Handler (needs rejected state + mentions)
 │    ├── 9.6 Lock + Amount Flow (needs awaiting_amount state + mentions)
 │    │    └── 9.7 Volume Input Handler (needs lock flow + awaiting_amount)
 │    └── 9.8 Re-prompt Timer (needs awaiting_amount state)
 └── 9.9 Deploy & Verify (LAST — needs everything)
```

### Acceptance Criteria
- [ ] `deal_flow_mode` configurable per group via dashboard (`classic` / `simple`)
- [ ] Classic mode: ZERO behavior change (full regression suite)
- [ ] Simple mode OFF: price → "off" → bot sends "off" + @mentions operator
- [ ] Simple mode GOOD (with amount): price → "trava 500" → calculation + @mention
- [ ] Simple mode GOOD (without amount): price → "ok" → prompt → amount → calculation + @mention
- [ ] Lock keywords ONLY trigger when sender has active QUOTED deal
- [ ] "ok" in casual chat without deal context does NOT trigger lock
- [ ] Re-prompt after `amount_timeout_seconds` (default 60s)
- [ ] Deal expires after 2× timeout if no response
- [ ] Bilingual prompts based on `group_language` (pt/en)
- [ ] All existing tests pass + new tests for all 8 tasks
- [ ] Production deployed and both scenarios verified end-to-end

### Risk Mitigation
- **Classic mode regression**: Router intercept is gated behind `deal_flow_mode === 'simple'`. Classic mode groups never enter the intercept path.
- **False positive locks**: Lock keywords ONLY match when sender has active QUOTED deal. No deal → falls through to normal trigger matching.
- **Cross-talk**: Deal lookup is per-sender (`senderJid`). Sender B's messages cannot affect Sender A's deal.
- **Gradual rollout**: Configure one test group as simple mode first. Monitor for 24h before enabling more groups.
- **Rollback**: Set `deal_flow_mode = 'classic'` on any group to instantly revert. No code deploy needed.

---

## 16. Sprint 10: Unified Quote Visibility (PLANNED)

> **Note**: This was originally numbered Sprint 9 in the pre-8.5 roadmap.

### Goal
Unify the Active Deals dashboard view to show BOTH full deals (from `dealFlowService`) AND simple price quotes (from `activeQuotes`). Daniel sees one place with all open prices, regardless of whether they originated from a volume inquiry or a simple price request.

### Problem Statement
Currently the Active Deals tab is useless for simple price quotes:
- **Full deal flow** (volume inquiry → price lock → confirmation): tracked via `dealFlowService.ts` in Supabase `active_deals` table → visible in dashboard
- **Simple price quote** (message "preço" → bot sends price): tracked via `activeQuotes.ts` in-memory only → invisible in dashboard

This creates a blind spot for Daniel. When a customer asks "preço" and the bot responds with a quote, Daniel can't see that quote in the dashboard. He only sees deals that started with a volume inquiry.

### Solution: Dual-Write Pattern
Keep the in-memory `activeQuotes` for volatility monitoring (microsecond access needed for real-time breach detection) but ALSO persist to a new Supabase table for dashboard visibility.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Customer sends "preço" to group                                         │
│                        ↓                                                 │
│  [PRICE_HANDLER] → createQuote() executes:                               │
│     1. Store in-memory (activeQuotes.ts) → for volatility monitoring    │
│     2. Persist to Supabase (active_price_quotes) → for dashboard        │
│                        ↓                                                 │
│  [DASHBOARD] fetches from:                                               │
│     • /api/groups/:groupJid/deals → full deals (DEAL_HANDLER)           │
│     • /api/groups/:groupJid/quotes/active → simple quotes (PRICE_HANDLER)│
│                        ↓                                                 │
│  [UI] Unified view with badges:                                          │
│     • 🔵 DEAL - from volume inquiry, full state machine                 │
│     • 🟡 QUOTE - from price request, tracked for volatility             │
└─────────────────────────────────────────────────────────────────────────┘
```

### Technical Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Dual-write, not single source** | In-memory is required for microsecond volatility checks; DB is required for dashboard visibility. Both serve different purposes. |
| 2 | **New `active_price_quotes` table** | Separate from `active_deals` — different state machines, different lifecycles, different concerns. Merging would create schema complexity. |
| 3 | **Capture sender context at quote time** | `createQuote()` needs clientJid and senderName so dashboard can show who received the quote. |
| 4 | **Dashboard fetches both, merges client-side** | Simpler than a backend union query. Frontend can apply consistent sorting and filtering. |
| 5 | **Quotes auto-expire in both stores** | In-memory: existing `expireOldQuotes()` cleanup. DB: `expired_at` column with periodic sweep or query filter. |

### Prerequisites
- Sprint 8 complete (volatility protection operational)
- `activeQuotes.ts` state machine working correctly
- `createQuote()` called on price send (already done in Sprint 8)

### Tasks

#### 9.1 Enhance createQuote() with Sender Context
**Objective**: Capture clientJid and senderName when creating a quote so the dashboard can show who received the quote.

- [ ] Update `createQuote()` signature in `src/services/activeQuotes.ts`:
  ```typescript
  export function createQuote(
    groupJid: string,
    price: number,
    clientJid?: string,
    senderName?: string
  ): ActiveQuote
  ```
- [ ] Add `clientJid` and `senderName` fields to `ActiveQuote` interface
- [ ] Update price handler call site in `src/handlers/price.ts` to pass sender context:
  ```typescript
  createQuote(context.groupId, finalPrice, context.sender, context.senderName)
  ```
- [ ] Update tests for new signature

**Deliverables**: Updated `src/services/activeQuotes.ts`, `src/handlers/price.ts`

**>> REVIEW GATE: Sender context captured, tests pass**

#### 9.2 Database Migration for active_price_quotes
**Objective**: Create Supabase table for persisting price quotes alongside the in-memory store.

- [ ] Create migration `supabase/migrations/20260206_001_active_price_quotes.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS active_price_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_jid TEXT NOT NULL,
    client_jid TEXT,
    sender_name TEXT,
    quoted_price DECIMAL(10,4) NOT NULL,
    quoted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,  -- quoted_at + TTL
    status TEXT NOT NULL DEFAULT 'pending',  -- pending, accepted, expired
    reprice_count INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT valid_status CHECK (status IN ('pending', 'accepted', 'expired'))
  );

  CREATE INDEX idx_active_quotes_group ON active_price_quotes(group_jid);
  CREATE INDEX idx_active_quotes_active ON active_price_quotes(group_jid, status)
    WHERE status = 'pending';
  ```
- [ ] Create rollback migration

**Deliverables**: `supabase/migrations/20260206_001_active_price_quotes.sql`

**>> REVIEW GATE: Schema reviewed, migration tested**

#### 9.3 Dual-Write in activeQuotes Service
**Objective**: Persist quotes to Supabase on create, update on state changes.

- [ ] Add Supabase persistence in `createQuote()`:
  ```typescript
  // After in-memory store
  const supabase = getSupabase()
  if (supabase) {
    await supabase.from('active_price_quotes').insert({
      group_jid: groupJid,
      client_jid: clientJid,
      sender_name: senderName,
      quoted_price: price,
      expires_at: new Date(Date.now() + DEFAULT_QUOTE_TTL_MS).toISOString(),
      status: 'pending',
    })
  }
  ```
- [ ] Update `forceAccept()` to mark DB quote as accepted
- [ ] Update `expireOldQuotes()` to mark DB quotes as expired
- [ ] Update `unlockAfterReprice()` to update DB quote price and reprice_count
- [ ] Fire-and-forget DB writes (don't block the hot path)
- [ ] Graceful handling if DB unavailable (log warning, continue with in-memory only)

**Deliverables**: Updated `src/services/activeQuotes.ts`

**>> REVIEW GATE: Dual-write verified, no performance regression on hot path**

#### 9.4 Active Quotes API Endpoint
**Objective**: Dashboard endpoint to fetch active quotes for a group.

- [ ] Create `src/dashboard/api/quotes.ts`:
  ```typescript
  // GET /api/groups/:groupJid/quotes/active
  // Returns active (pending) quotes for the group
  ```
- [ ] Return fields: id, quotedPrice, quotedAt, clientJid, senderName, repriceCount, status
- [ ] Filter by `status = 'pending'` by default, optional `?all=true` for history
- [ ] Register routes in `server.ts`
- [ ] Add route tests

**Deliverables**: `src/dashboard/api/quotes.ts`, route tests

**>> REVIEW GATE: API returns expected data, tests pass**

#### 9.5 Dashboard Unified View
**Objective**: Merge deals and quotes in the Active Deals tab with visual distinction.

- [ ] Update `GroupDealsView.tsx` to fetch both:
  - Existing: `GET /api/groups/${groupJid}/deals`
  - New: `GET /api/groups/${groupJid}/quotes/active`
- [ ] Merge results into single list, sorted by created_at DESC
- [ ] Visual badges:
  - 🔵 **DEAL** (blue badge) — full deal flow from volume inquiry
  - 🟡 **QUOTE** (yellow/amber badge) — simple price quote
- [ ] Quote cards show:
  - Quoted price (formatted R$ X,XXXX)
  - Client name (if available) or "Unknown"
  - Time since quote
  - Reprice count (if > 0)
  - Status badge
- [ ] Empty state updated: "No active deals or quotes. Deals are created from volume inquiries, quotes from price requests."
- [ ] Tab rename consideration: "Active Deals" → "Active Prices" or keep as-is with subtitle

**Deliverables**: Updated `dashboard/src/components/groups/GroupDealsView.tsx`

**>> REVIEW GATE: Unified view shows both deals and quotes, visually distinct**

#### 9.6 Cleanup and Expiration Sync
**Objective**: Keep in-memory and DB stores in sync for expired quotes.

- [ ] Existing periodic cleanup already calls `expireOldQuotes()` for in-memory
- [ ] Add DB cleanup in same interval:
  ```typescript
  // Mark DB quotes as expired when TTL passed
  await supabase
    .from('active_price_quotes')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
  ```
- [ ] Consider: archive old quotes after 24h (move to `price_quote_history` or just delete)
- [ ] Dashboard filters out expired quotes by default

**Deliverables**: Updated cleanup logic in boot sequence

**>> REVIEW GATE: Expired quotes cleaned up consistently**

#### 9.7 Deploy & Verify
**Objective**: Ship Sprint 9 to production and verify end-to-end.

- [ ] Apply Supabase migration
- [ ] Build + deploy to VPS
- [ ] Send "preço" to a group → verify quote appears in dashboard
- [ ] Accept the quote → verify it shows as accepted
- [ ] Wait for expiry → verify it disappears or shows as expired
- [ ] Create a full deal (volume inquiry) → verify both quote and deal visible
- [ ] Verify no performance regression in volatility monitoring

**>> REVIEW GATE: Production verified, Daniel can see all open prices**

### Task Dependencies

```
9.1 Enhance createQuote (FIRST — captures context)
 ├── 9.2 Database Migration (parallel)
 │    └── 9.3 Dual-Write (needs migration)
 │         └── 9.4 API Endpoint (needs data in DB)
 │              └── 9.5 Dashboard View (needs API)
 │                   └── 9.6 Cleanup Sync (polish)
 └── 9.7 Deploy & Verify (LAST)
```

### Acceptance Criteria
- [ ] `createQuote()` captures sender context (clientJid, senderName)
- [ ] Price quotes persisted to `active_price_quotes` Supabase table
- [ ] Dashboard fetches and displays both deals and quotes
- [ ] Visual distinction: 🔵 DEAL vs 🟡 QUOTE badges
- [ ] Quote cards show price, client, time, reprice count
- [ ] Expired quotes cleaned up in both in-memory and DB
- [ ] No performance regression in volatility monitoring (dual-write is fire-and-forget)
- [ ] All existing tests pass + new tests for quote persistence
- [ ] Production deployed and verified

---

## 17. Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Schedule overlap confusion | Medium | Priority system, UI shows overlap warnings |
| Timezone edge cases (DST) | High | Using native `Intl.DateTimeFormat` (no deps), tested in ruleService.test.ts |
| Rule switching mid-deal | Medium | Lock rule at deal start |
| UI complexity | High | User testing with Daniel before sprint completion |
| Accidental deletion during demo | High | Confirmation dialogs on all destructive actions (Sprint 6) |
| External API failure during demo | Medium | Fallback values + clear error states (Sprint 6) |
| Unauthenticated API access | High | Shared secret auth middleware (Sprint 7A.0) |
| Router refactor breaks live groups | Critical | Gradual cutover with 1-hour observation per step (Sprint 7B.3) |
| System keyword edit breaks bot | Medium | 60-second cache TTL + hardcoded fallback if DB unreachable |
| Scope mismatch: global vs per-group | Medium | System patterns stay global (7A); per-group overrides in 7B |
| Daniel loses trust after regression | High | Ship 7A first (zero router risk), 7B only after 7A is stable |
| Binance WebSocket disconnects | Medium | Auto-reconnect (max 10s backoff) + REST fallback polling + 2s overlap period |
| Reprice loop on extreme volatility | High | Max 3 reprices before escalation, group paused until manual dismissal |
| Customer acceptance during reprice | Critical | `forceAccept()` always wins over repricing state (customer priority) |
| Threshold misconfiguration | Medium | Dashboard validation (1-1000 bps), defaults to 30 bps if no config |
| SSE connection exhaustion | Low | Max 10 concurrent connections, 503 if exceeded |
| Dual-write inconsistency | Medium | Fire-and-forget DB writes, in-memory is source of truth for hot path; DB failure logged but doesn't block operations |
| Dashboard merge complexity | Low | Client-side merge with clear badge distinction; no backend union query needed |
| Bronze insert blocking hot path | Critical | Fire-and-forget pattern (`Promise.resolve().then().catch()`). Bronze writes never block price delivery or deal transitions. |
| Silver/Gold table missing on new deploy | Medium | All dashboard endpoints check for PGRST205/42P01 error codes and fall back to raw table queries gracefully. |
| Bronze retention bloat | Low | `bronze_retention_cleanup()` runs daily, deletes ticks > 90 days. Deal events kept indefinitely (low volume, high value). |
| Binance WS tick flood to Bronze | Medium | 5-second throttle reduces from hundreds/sec to 12/min. Configurable via `BINANCE_WS_THROTTLE_MS`. |
| Silver/Gold refresh stalls | Low | Each refresh has try-catch with debug logging. Slow refreshes (>5s) trigger warning logs. Refresh failure doesn't affect Bronze capture. |
| False positive lock from "ok" | High | Locks context-gated: ONLY trigger when sender has active QUOTED deal. No deal = no lock. |
| Router intercept breaks classic mode | Critical | Intercept gated behind `deal_flow_mode === 'simple'`. Classic mode never enters intercept path. Full regression suite. |
| Cross-talk between senders' deals | High | Deal lookup keyed on `senderJid`. Sender B's messages cannot affect Sender A's deal. |
| Re-prompt spam | Medium | `reprompted_at` timestamp prevents double-prompts. Only one re-prompt per deal lifecycle. |
| @mention format incompatibility | Low | Baileys natively supports `mentions` array in `sendMessage()`. Test with real WhatsApp group before production rollout. |

---

## 18. Review Process

Each sprint has multiple review gates marked with `>> REVIEW GATE`.

**Review Workflow**:
1. Developer completes task group
2. Code pushed to feature branch
3. Boss reviews (code review or manual inspection)
4. Approval required before proceeding
5. Sprint sign-off requires all gates passed

---

## 19. Glossary

| Term | Definition |
|------|------------|
| **Trigger** | A phrase pattern that activates a bot response (belongs to group) |
| **System Pattern** | Global bot keyword pattern (price, deal, tronscan) — editable via dashboard (Sprint 7A), optionally migrated to per-group triggers (Sprint 7B) |
| **System Trigger** | A `group_triggers` row with `is_system: true` — non-deletable, keywords editable (Sprint 7B) |
| **Rule** | A time-based configuration that controls pricing behavior |
| **Active Rule** | The rule whose schedule matches current time (highest priority wins) |
| **Pricing Source** | Where to get exchange rate: Commercial Dollar or USDT/BRL Binance |
| **Spread** | Markup/markdown on base rate (basis points or absolute BRL) |
| **Rule-Aware Action** | Action type that uses active rule's config (e.g., `price_quote`) |
| **Deal Flow** | Stateful process: quote → lock → compute → confirm |
| **Pattern Tester** | Inline UI that tests a message against system patterns or triggers, showing what would match |
| **Volatility Protection** | Real-time monitoring of USDT/BRL to auto-reprice quotes when market moves beyond threshold |
| **Active Quote** | A quote tracked from price send until customer acceptance, expiry, or cancellation |
| **Threshold (bps)** | Maximum allowed price deviation in basis points before auto-reprice triggers (1 bps = 0.01%) |
| **Reprice** | Automatic cancellation ("off") + new quote when threshold breached |
| **Escalation** | Alert to control group after max reprices reached, automation pauses |
| **Active Price Quote** | A simple price quote (from "preço" request) tracked for volatility monitoring and visible in dashboard — distinct from a full Deal |
| **Dual-Write** | Pattern where data is written to both in-memory store (for speed) and database (for persistence/visibility) |
| **Deal Flow Mode** | Per-group setting: `classic` (3-step: quote→lock→confirm) or `simple` (2-step: price→lock+amount→done) |
| **Simple Mode** | Daniel's live trade flow: price → lock (with context-gated keywords) → amount → calculation + @mention operator |
| **Context-Gated Lock** | Lock keywords only activate when sender has an active QUOTED deal. Prevents false positives from casual chat. |
| **Rejection (Off)** | Client sends "off" after price quote. Deal transitions to `rejected` state. Operator @mentioned for awareness. |
| **@Mention** | WhatsApp native mention using Baileys' `mentions` parameter in `sendMessage()`. Tags a user with push notification. |
| **Re-prompt** | Automatic follow-up message when client hasn't provided USDT amount within `amount_timeout_seconds`. Fires once per deal. |
| **Medallion Architecture** | Data layering pattern: Bronze (raw events) → Silver (enriched aggregates) → Gold (business-ready metrics). Each layer trades freshness for query performance. |
| **Bronze Layer** | Raw event capture: `bronze_price_ticks` (throttled price snapshots from all sources) and `bronze_deal_events` (state transition log with market price snapshots). Fire-and-forget writes. |
| **Silver Layer** | Pre-aggregated tables refreshed every 60s: `silver_price_ohlc_1m` (1-min candles), `silver_player_stats`, `silver_group_activity` (heatmap), `silver_deal_lifecycle` (view with timing/slippage). |
| **Gold Layer** | Business-ready daily summaries refreshed every 5 min: trade volume, spread effectiveness, operator response times, group summary, cost rollups. Dashboard reads these instead of scanning raw tables. |
| **Data Lake Service** | `src/services/dataLake.ts` — thin orchestration layer that emits Bronze events and schedules Silver/Gold/Retention refresh timers. |

---

## 20. Changelog

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
| 2026-02-03 | Added read-only System Patterns panel to dashboard (visibility into hardcoded bot patterns) | System |
| 2026-02-03 | Sprint 7 planned: Trigger Engine Consolidation (migrate hardcoded patterns to database) — later restructured into 7A/7B | System |
| 2026-02-04 | Sprint 6 marked complete (all 9 tasks, code review 10 issues, 7 fixed) | System |
| 2026-02-04 | Sprint 6 code review complete (2 HIGH, 5 MEDIUM, 3 LOW — 7 fixed, 3 deferred) | System |
| 2026-02-04 | Sprint 6 deployed to production VPS + system_patterns migration applied | System |
| 2026-02-04 | API tests added for system patterns endpoints (20 tests, Sprint 4 retro action item) | System |
| 2026-02-04 | Sprint 6 retrospective conducted | BMAD Agents |
| 2026-02-04 | Sprint 7 restructured into 7A + 7B via party-mode consensus (John, Sally, Winston, Bob) | BMAD Agents (Party Mode) |
| 2026-02-04 | Decision: Prioritize Daniel's experience — editable keywords first (7A), router consolidation second (7B) | BMAD Agents |
| 2026-02-04 | Decision: Add dashboard API auth (shared secret) as Sprint 7A.0 blocker | BMAD Agents (Winston, John) |
| 2026-02-04 | Decision: Add inline pattern tester for confidence before saving keywords | BMAD Agents (Sally) |
| 2026-02-04 | Sprint 7A.0 complete: Dashboard auth middleware (timing-safe, IP logging, startup warning) | System |
| 2026-02-04 | Sprint 7A.1 complete: writeHeaders() wired into all 14 frontend write calls | System |
| 2026-02-04 | Sprint 7A.2 complete: POST /test endpoint + debounced UI with color-coded matches | System |
| 2026-02-04 | Sprint 7A.3 complete: Built, deployed, validated auth + tester on VPS | System |
| 2026-02-04 | Sprint 7A adversarial review: 13 findings (1C, 3H, 5M, 4L), 11 fixed, 2 deferred to 7B | System |
| 2026-02-04 | Sprint 7A marked complete — 48 test files, 1,572 tests, deployed to production | System |
| 2026-02-05 | Sprint 7B marked complete — trigger engine consolidation | System |
| 2026-02-05 | Sprint 8 started: Volatility Protection feature implementation | System |
| 2026-02-05 | Sprint 8 Tasks 8.1-8.11 complete — Binance WebSocket, active quotes, volatility monitor, dashboard widget | System |
| 2026-02-05 | All 1,598 tests passing, TypeScript compiles clean | System |
| 2026-02-05 | Sprint 8 code review: 7 issues fixed (SSE leak, escalation race condition, forceAccept during repricing, threshold minimum, quote ID crash safety) | System |
| 2026-02-05 | Sprint 9 planned: Unified Quote Visibility — dual-write pattern for Active Deals dashboard to show both deals and simple quotes | System |
| 2026-02-05 | Architecture analysis: identified gap where simple price quotes (PRICE_HANDLER) invisible in dashboard vs full deals (DEAL_HANDLER) visible | Party Mode Analysis |
| 2026-02-05 | Sprint 8 COMPLETE — Volatility Protection deployed to production (migration applied, 1601 tests passing, WebSocket+SSE verified) | System |
| 2026-02-06 | Sprint 8 staleness fix — PriceTracker.tsx: independent freshness tracking, staleness detection, visual indicators. Backend: removed fake fallback price, returns 503 on failure. | System |
| 2026-02-09 | Sprint 8.5 started: Medallion Data Architecture (Bronze → Silver → Gold) | System |
| 2026-02-09 | Bronze layer: `bronze_price_ticks` + `bronze_deal_events` tables, retention cleanup function | System |
| 2026-02-09 | Silver layer: 3 tables + `silver_deal_lifecycle` view + 3 refresh Postgres functions | System |
| 2026-02-09 | Gold layer: 5 tables + master `refresh_gold_layer()` function | System |
| 2026-02-09 | `src/services/dataLake.ts` created — emit + refresh orchestration (16 tests) | System |
| 2026-02-09 | Price tick emission hooked into Binance WS (5s throttle), AwesomeAPI, TradingView scraper | System |
| 2026-02-09 | Deal event emission hooked into `createDeal()`, `transitionDeal()`, `archiveDeal()` | System |
| 2026-02-09 | Dashboard analytics switched to Silver/Gold reads with graceful fallback | System |
| 2026-02-09 | New API endpoints: `GET /api/prices/ohlc` (Silver OHLC candles), `GET /api/prices/trade-desk` (Gold metrics) | System |
| 2026-02-09 | Sprint 8.5 COMPLETE — 1,705 tests passing (54 files), zero TypeScript errors. Pending: production migration. | System |
| 2026-02-06 | Sprint 9 planned: Daniel's Live Trade Flow — CIO's production scenarios for live mode (off path + good path with @mentions) | BMAD Agents (Party Mode) |
| 2026-02-06 | Design decision: locks context-gated by deal state (Boss directive). Lock keywords ONLY trigger when sender has active QUOTED deal. | Party Mode (Boss, John, Winston) |
| 2026-02-06 | Design decision: deal state drives routing in simple mode — router intercept before trigger matching, no new trigger action types needed | Party Mode (Winston, Amelia) |
| 2026-02-06 | Existing Sprint 9 (Unified Quote Visibility) renumbered to Sprint 10 — Daniel's flow takes priority | System |

