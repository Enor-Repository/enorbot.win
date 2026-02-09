# Tech Spec: Dashboard Rules Integration with WhatsApp Bot

**Date**: 2026-02-02
**Status**: Ready for Implementation
**Author**: Claude (BMAD Quick-Spec)

---

## 1. Problem Statement

The dashboard UI creates rules in the `rules` table, but the WhatsApp bot reads trigger patterns from `group_config.trigger_patterns`. These two systems are **completely disconnected**. Changes made in the dashboard have no effect on bot behavior.

### Current Architecture (Broken)

```
Dashboard UI
     ↓ POST /api/rules
┌─────────────────┐
│   rules table   │  ← Dashboard writes here
│  - trigger_phrase
│  - response_template
│  - action_type
│  - priority
└─────────────────┘

WhatsApp Bot
     ↓ getGroupConfigSync()
┌─────────────────────────┐
│   group_config table    │  ← Bot reads from here
│  - trigger_patterns[]   │
│  - response_templates{} │
└─────────────────────────┘
```

**Result**: Rules created via dashboard are stored but never used by the bot.

---

## 2. Proposed Solution

**Approach**: Make the bot read from the `rules` table instead of `group_config.trigger_patterns`.

### Why this approach?

1. The `rules` table is more feature-rich:
   - `action_type` (text_response, usdt_quote, commercial_dollar_quote, ai_prompt)
   - `priority` ordering
   - `conditions` for advanced matching
   - `is_active` toggle

2. The `group_config` approach is simpler but limited to string arrays

3. We keep `group_config` for group-level settings (mode, ai_threshold, player_roles) but delegate trigger/response logic to `rules`

### Target Architecture

```
Dashboard UI
     ↓ POST /api/rules
┌─────────────────┐
│   rules table   │  ← Single source of truth
│  - trigger_phrase
│  - response_template
│  - action_type
│  - priority
└─────────────────┘
     ↑
     │ rulesService.getActiveRulesForGroup()
     │
WhatsApp Bot (router.ts)
     │
     ↓ Execute action based on action_type
```

---

## 3. Implementation Plan

### 3.1 Create Rules Service (`src/services/rulesService.ts`)

New service to manage rules with in-memory caching:

```typescript
interface Rule {
  id: string
  groupJid: string
  triggerPhrase: string
  responseTemplate: string
  actionType: 'text_response' | 'usdt_quote' | 'commercial_dollar_quote' | 'ai_prompt' | 'custom'
  actionParams: Record<string, unknown>
  isActive: boolean
  priority: number
  conditions: Record<string, unknown>
}

// In-memory cache (grouped by groupJid)
const rulesCache: Map<string, Rule[]> = new Map()

// Initialize - load all active rules
export async function initRulesService(config: EnvConfig): Promise<Result<void>>

// Get rules for a group (from cache, sorted by priority desc)
export function getActiveRulesForGroup(groupJid: string): Rule[]

// Find matching rule for a message
export function findMatchingRule(groupJid: string, message: string): Rule | null

// Refresh cache for a group (called after CRUD operations)
export async function refreshRulesCache(groupJid?: string): Promise<Result<void>>
```

### 3.2 Update Router (`src/bot/router.ts`)

Replace `groupConfig.triggerPatterns` check with `rulesService.findMatchingRule()`:

```typescript
// BEFORE (line 184-187):
const groupConfig = getGroupConfigSync(context.groupId)
const hasGroupTrigger = groupConfig?.triggerPatterns.some(
  pattern => context.message.toLowerCase().includes(pattern.toLowerCase())
) ?? false

// AFTER:
import { findMatchingRule } from '../services/rulesService.js'
const matchedRule = findMatchingRule(context.groupId, context.message)
```

### 3.3 Update Price Handler (`src/handlers/price.ts`)

Add action type execution:

```typescript
// If matchedRule.actionType === 'usdt_quote' → fetch USDT/BRL price
// If matchedRule.actionType === 'commercial_dollar_quote' → fetch USD/BRL
// If matchedRule.actionType === 'text_response' → use responseTemplate
// If matchedRule.actionType === 'ai_prompt' → call AI with actionParams.prompt
```

### 3.4 Update Dashboard API (`src/dashboard/api/rules.ts`)

After each CRUD operation, refresh the bot's cache:

```typescript
import { refreshRulesCache } from '../../services/rulesService.js'

// In POST /api/rules (after insert):
await refreshRulesCache(groupJid)

// In PUT /api/rules/:id (after update):
await refreshRulesCache(rule.group_jid)

// In DELETE /api/rules/:id (after delete):
await refreshRulesCache(groupJid)
```

### 3.5 Update Bot Initialization (`src/index.ts`)

Initialize rules service on startup:

```typescript
import { initRulesService } from './services/rulesService.js'

// In startBot(), after initGroupConfigs:
const rulesResult = await initRulesService(config)
if (!rulesResult.ok) {
  logger.error('Failed to initialize rules service', { error: rulesResult.error })
  process.exit(1)
}
```

---

## 4. Migration Notes

### Keep group_config for:
- Group mode (learning/assisted/active/paused)
- AI threshold
- Player roles
- Group name/metadata

### Deprecate in group_config:
- `trigger_patterns` - replaced by `rules.trigger_phrase`
- `response_templates` - replaced by `rules.response_template`

### Backward Compatibility:
- Existing `group_config.trigger_patterns` will be ignored once rules service is active
- No migration of existing patterns needed (they were mostly empty anyway)

---

## 5. Testing Plan

1. **Unit Tests** (`src/services/rulesService.test.ts`):
   - Test cache initialization
   - Test findMatchingRule with priority ordering
   - Test rule matching (case-insensitive substring)
   - Test action type resolution

2. **Integration Tests**:
   - Create rule via dashboard API → verify bot responds
   - Update rule → verify bot uses new response
   - Delete rule → verify bot stops responding
   - Disable rule (is_active=false) → verify bot ignores it

3. **Manual Testing**:
   - Dashboard: Create "compro usdt" → "USDT/BRL: {price}" rule
   - WhatsApp: Send "compro usdt" in group
   - Verify: Bot responds with price quote

---

## 6. Files to Modify

| File | Changes |
|------|---------|
| `src/services/rulesService.ts` | **NEW** - Rules caching and matching |
| `src/bot/router.ts` | Use rulesService instead of groupConfig triggers |
| `src/handlers/price.ts` | Execute based on action_type |
| `src/dashboard/api/rules.ts` | Call refreshRulesCache after CRUD |
| `src/index.ts` | Initialize rules service on startup |

---

## 7. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Cache gets stale | Always refresh after CRUD; add TTL-based refresh as backup |
| Rule matching too slow | Cache is in-memory, O(n) per group is acceptable |
| Action type not supported | Fallback to text_response |
| Multiple rules match | Use highest priority; if tied, use most recently created |

---

## 8. Success Criteria

- [ ] Rules created in dashboard immediately affect bot behavior
- [ ] Rules updated in dashboard immediately change bot responses
- [ ] Rules deleted in dashboard immediately stop bot from responding
- [ ] Priority ordering works (higher priority rules win)
- [ ] Action types execute correctly (text_response, usdt_quote, etc.)
- [ ] Bot survives restart with rules still working (persisted in Supabase)
