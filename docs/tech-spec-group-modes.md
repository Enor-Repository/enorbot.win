# Tech Spec: Per-Group Learning & Configuration System

## Overview

This spec defines a **learning-focused mode system** that transforms eNorBOT from a single-configuration bot into a multi-group learning platform. The goal is to observe multiple OTC groups with unique behaviors, learn their patterns over weeks, and deploy tailored configurations per group.

### The Learning Vision

```
OBSERVE (weeks) → LEARN (analyze) → DEPLOY (per-group rules)
```

**Why this matters:**
- Each OTC group has unique triggers, player roles, and communication patterns
- AI calls are expensive; learned rules reduce costs dramatically
- Groups evolve over time; the system must adapt
- New groups start in observation mode; proven patterns get deployed

### Mode Lifecycle

| Mode | Behavior | Purpose |
|------|----------|---------|
| `learning` | Watch everything, log everything, respond to NOTHING | Default for new groups. Observe patterns, build dataset. |
| `assisted` | Bot suggests responses in control group, human approves | (Future phase) Validate learned patterns before full deployment. |
| `active` | Bot responds based on learned rules + AI fallback | Production mode with group-specific configuration. |
| `paused` | Completely ignored | Group disabled, no logging, no responses. |

**Mode transitions:**
- New group → `learning` (observe for 2-4 weeks minimum)
- After pattern analysis → `assisted` (human validates suggestions)
- After confidence builds → `active` (automated with AI fallback)
- Group inactive/problematic → `paused`

## Current State

### `src/bot/state.ts`
- `trainingMode: boolean` - Global flag, in-memory only, resets to `false` on restart
- `pausedGroups: Set<string>` - Per-group pause, in-memory only
- `globalPause: boolean` - All groups paused, in-memory only
- Functions: `isTrainingMode()`, `setTrainingMode()`, `isGroupPaused()`, `pauseGroup()`, `resumeGroup()`

### `src/bot/router.ts`
- Checks `isTrainingMode()` to route to `OBSERVE_ONLY` destination
- Priority: Control group > Training mode > Price triggers > Receipts > Ignore
- No per-group mode awareness

### `src/handlers/control.ts`
- Commands: `pause [group]`, `resume [group]`, `status`, `training on|off`
- Uses `knownGroups: Map<string, string>` for fuzzy matching (groupId -> groupName)
- `registerKnownGroup()` called when messages received

### Database
- `sessions` table exists for auth state
- `log_queue` table exists for Excel sync queue
- `message_history` table exists for message logging
- No table for group modes or configuration

## Database Schema

### New Table: `group_config`

This is the **brain** of the learning system. Each group gets its own row with learned patterns, custom triggers, and player role mappings.

```sql
CREATE TABLE group_config (
  -- Identity
  group_jid TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,

  -- Mode (the learning lifecycle stage)
  mode TEXT NOT NULL DEFAULT 'learning'
    CHECK (mode IN ('learning', 'assisted', 'active', 'paused')),

  -- Custom trigger patterns learned/configured for this group
  -- Example: ["compro usdt", "vendo btc", "cotacao"]
  trigger_patterns JSONB DEFAULT '[]'::jsonb,

  -- Response templates mapped to triggers
  -- Example: {"compro usdt": "USDT/BRL: {price}", "default": "Cotacao: {pair} {price}"}
  response_templates JSONB DEFAULT '{}'::jsonb,

  -- Player role mappings (learned from observation)
  -- Example: {"5511999999999@s.whatsapp.net": "operator", "5521888888888@s.whatsapp.net": "client"}
  player_roles JSONB DEFAULT '{}'::jsonb,

  -- AI usage threshold (0-100)
  -- 0 = never use AI (rules only)
  -- 50 = use AI when rules don't match (default)
  -- 100 = always use AI (expensive but flexible)
  ai_threshold INTEGER NOT NULL DEFAULT 50
    CHECK (ai_threshold >= 0 AND ai_threshold <= 100),

  -- Learning timestamps
  learning_started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  activated_at TIMESTAMP WITH TIME ZONE, -- NULL until mode='active'

  -- Audit
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT -- sender JID who last changed config
);

-- Indexes for common queries
CREATE INDEX idx_group_config_mode ON group_config(mode);
CREATE INDEX idx_group_config_updated ON group_config(updated_at);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_group_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER group_config_timestamp
  BEFORE UPDATE ON group_config
  FOR EACH ROW
  EXECUTE FUNCTION update_group_config_timestamp();
```

### Schema Field Details

| Field | Type | Purpose |
|-------|------|---------|
| `group_jid` | TEXT (PK) | WhatsApp group identifier |
| `group_name` | TEXT | Human-readable name (auto-updated) |
| `mode` | TEXT | Current lifecycle stage |
| `trigger_patterns` | JSONB | Array of custom trigger strings for this group |
| `response_templates` | JSONB | Map of trigger → response template |
| `player_roles` | JSONB | Map of player JID → role (operator/client/cio) |
| `ai_threshold` | INTEGER | When to use AI vs rules (0-100) |
| `learning_started_at` | TIMESTAMP | When observation began |
| `activated_at` | TIMESTAMP | When moved to active mode |
| `updated_at` | TIMESTAMP | Last modification time |
| `updated_by` | TEXT | Who made last change |

## Changes Required

### 1. New Config Variable

Add to `src/types/config.ts`:
```typescript
DEFAULT_GROUP_MODE: z.enum(['learning', 'assisted', 'active', 'paused']).default('learning')
```

### 2. `src/services/groupConfig.ts` (New File)

```typescript
export type GroupMode = 'learning' | 'assisted' | 'active' | 'paused'
export type PlayerRole = 'operator' | 'client' | 'cio'

export interface GroupConfig {
  groupJid: string
  groupName: string
  mode: GroupMode
  triggerPatterns: string[]
  responseTemplates: Record<string, string>
  playerRoles: Record<string, PlayerRole>
  aiThreshold: number
  learningStartedAt: Date
  activatedAt: Date | null
  updatedAt: Date
  updatedBy: string | null
}

// In-memory cache (sync'd from Supabase on startup)
const configCache: Map<string, GroupConfig> = new Map()

// Core functions
export async function initGroupConfigs(): Promise<void>
export async function getGroupConfig(groupJid: string): Promise<GroupConfig>
export async function setGroupMode(groupJid: string, mode: GroupMode, updatedBy: string): Promise<Result<void>>
export async function getAllGroupConfigs(): Promise<Map<string, GroupConfig>>

// Sync functions for hot path (router) - no async
export function getGroupModeSync(groupJid: string): GroupMode
export function getGroupConfigSync(groupJid: string): GroupConfig | null

// Configuration functions
export async function addTriggerPattern(groupJid: string, pattern: string, updatedBy: string): Promise<Result<void>>
export async function removeTriggerPattern(groupJid: string, pattern: string, updatedBy: string): Promise<Result<void>>
export async function setPlayerRole(groupJid: string, playerJid: string, role: PlayerRole, updatedBy: string): Promise<Result<void>>
export async function setAiThreshold(groupJid: string, threshold: number, updatedBy: string): Promise<Result<void>>
export async function setResponseTemplate(groupJid: string, trigger: string, template: string, updatedBy: string): Promise<Result<void>>

// Auto-registration (called when new group messages arrive)
export async function ensureGroupRegistered(groupJid: string, groupName: string): Promise<void>
```

### 3. `src/bot/state.ts` Changes

**Remove:**
- `trainingMode: boolean`
- `pausedGroups: Set<string>`
- `globalPause: boolean`
- `isTrainingMode()`, `setTrainingMode()`, `resetTrainingMode()`
- `pauseGroup()`, `resumeGroup()`, `pauseAllGroups()`, `resumeAllGroups()`
- `isGroupPaused()`, `getPausedGroups()`, `isGlobalPauseActive()`

**Keep:**
- Connection state, operational status, activity tracking, auth state tracking

### 4. `src/bot/router.ts` Changes

Replace global training mode check with per-group mode routing:

```typescript
import { getGroupModeSync, getGroupConfigSync } from '../services/groupConfig.js'

export function routeMessage(
  context: RouterContext,
  baileysMessage?: BaileysMessage
): RouteResult {
  // ... existing trigger detection ...

  const enrichedContext: RouterContext = {
    ...context,
    hasTrigger,
    hasTronscan,
    isReceipt,
    receiptType,
  }

  // Priority 1: Control group ALWAYS works (even for paused groups)
  if (context.isControlGroup) {
    if (hasTrigger) {
      return { destination: 'PRICE_HANDLER', context: enrichedContext }
    }
    if (hasTronscan) {
      return { destination: 'TRONSCAN_HANDLER', context: enrichedContext }
    }
    return { destination: 'CONTROL_HANDLER', context: enrichedContext }
  }

  // Priority 2: Check per-group mode
  const groupMode = getGroupModeSync(context.groupId)

  // PAUSED: Completely ignore (no logging, no response)
  if (groupMode === 'paused') {
    return { destination: 'IGNORE', context: enrichedContext }
  }

  // LEARNING: Log everything, respond to nothing
  if (groupMode === 'learning') {
    return { destination: 'OBSERVE_ONLY', context: enrichedContext }
  }

  // ASSISTED: Route to assisted handler (suggests to control group)
  // Future phase - for now, treat as learning
  if (groupMode === 'assisted') {
    return { destination: 'OBSERVE_ONLY', context: enrichedContext }
  }

  // ACTIVE: Normal routing with group-specific config
  // Check group-specific triggers first, then global triggers
  const groupConfig = getGroupConfigSync(context.groupId)
  const hasGroupTrigger = groupConfig?.triggerPatterns.some(
    pattern => context.message.toLowerCase().includes(pattern.toLowerCase())
  )

  if (hasTrigger || hasGroupTrigger) {
    return { destination: 'PRICE_HANDLER', context: enrichedContext }
  }

  if (hasTronscan) {
    return { destination: 'TRONSCAN_HANDLER', context: enrichedContext }
  }

  if (isReceipt) {
    return { destination: 'RECEIPT_HANDLER', context: enrichedContext }
  }

  return { destination: 'IGNORE', context: enrichedContext }
}
```

### 5. `src/handlers/control.ts` Changes

**New command types:**
```typescript
export type ControlCommandType =
  | 'mode'      // mode <group> learning|assisted|active|paused
  | 'modes'     // List all groups with modes
  | 'config'    // config <group> - show group config
  | 'trigger'   // trigger add|remove <group> <pattern>
  | 'role'      // role <group> <player> operator|client|cio
  | 'pause'     // Legacy: maps to mode <group> paused
  | 'resume'    // Legacy: maps to mode <group> active
  | 'training'  // Legacy: maps to mode all learning|active
  | 'status'
  | 'unknown'
```

**New command parser patterns:**
```typescript
// "mode OTC learning" or "mode 'OTC Brasil' active"
if (lower.startsWith('mode ')) {
  const rest = message.replace(/^mode\s+/i, '').trim()
  const parts = parseQuotedArgs(rest)
  const modeArg = parts.pop() // last word is mode
  const groupSearch = parts.join(' ')
  return { type: 'mode', args: [groupSearch, modeArg] }
}

// "modes" - list all group modes
if (lower === 'modes') {
  return { type: 'modes', args: [] }
}

// "config OTC" - show group config
if (lower.startsWith('config ')) {
  const groupSearch = message.replace(/^config\s+/i, '').trim()
  return { type: 'config', args: [groupSearch] }
}

// "trigger add OTC compro usdt"
if (lower.startsWith('trigger ')) {
  const parts = parseQuotedArgs(message.replace(/^trigger\s+/i, ''))
  return { type: 'trigger', args: parts }
}

// "role OTC 5511999999999 operator"
if (lower.startsWith('role ')) {
  const parts = parseQuotedArgs(message.replace(/^role\s+/i, ''))
  return { type: 'role', args: parts }
}
```

**New handlers:**
- `handleModeCommand()` - Set mode for specific group
- `handleModesCommand()` - List all groups with modes and stats
- `handleConfigCommand()` - Show group's current configuration
- `handleTriggerCommand()` - Add/remove custom triggers
- `handleRoleCommand()` - Assign player roles

### 6. `src/index.ts` Changes

Add to startup sequence:
```typescript
import { initGroupConfigs, ensureGroupRegistered } from './services/groupConfig.js'

// After Supabase init, before connection
await initGroupConfigs()

// In message handler, auto-register groups
await ensureGroupRegistered(groupJid, groupName)
```

### 7. Status Command Update

Update `buildStatusMessage()` to show learning system stats:

```
📊 eNorBOT Status

Connection: 🟢 Connected
Uptime: 3d 14h 22m

📚 Learning System
• 5 groups in learning mode (observing)
• 2 groups active (responding)
• 1 group paused

📈 Today's Activity
• 47 quotes sent
• 8 groups monitored
• Last activity: 2 minutes ago

📂 Groups by Mode
• OTC Brasil - 🔵 learning (14 days)
• OTC Europe - 🟢 active
• OTC Asia - 🟡 assisted
• Test Group - ⏸️ paused
```

## Migration Path

1. Deploy `group_config` table to Supabase
2. On first startup:
   - All existing `knownGroups` get registered with mode `learning`
   - Groups previously in `pausedGroups` get mode `paused`
   - Global `trainingMode` state is lost (acceptable - in-memory)
3. Legacy commands continue working via mapping:
   - `pause [group]` → `mode [group] paused`
   - `resume [group]` → `mode [group] active`
   - `training on` → sets ALL groups to `learning`
   - `training off` → sets ALL groups to `active`
4. New commands available immediately

## Implementation Stories

### Story 1: Database Schema & Service Layer Foundation

**Files:** `group_config` table, `src/services/groupConfig.ts`, `src/types/config.ts`

**Tasks:**
1. Create `group_config` table in Supabase with all fields
2. Add `DEFAULT_GROUP_MODE` to config schema
3. Implement `groupConfig.ts` with:
   - In-memory cache synchronized from Supabase
   - `initGroupConfigs()` - load all configs on startup
   - `getGroupConfig()` / `getGroupConfigSync()` - read config
   - `setGroupMode()` - change mode with audit
   - `ensureGroupRegistered()` - auto-register new groups
4. Add `initGroupConfigs()` to startup in `src/index.ts`

**Acceptance Criteria:**
- [ ] Table created with proper constraints and indexes
- [ ] `getGroupConfig()` returns default config for unknown groups
- [ ] `setGroupMode()` persists to Supabase and updates cache
- [ ] `getAllGroupConfigs()` returns all configured groups
- [ ] Cache is populated on startup from Supabase
- [ ] New groups auto-register with `learning` mode

### Story 2: Router Integration with Per-Group Modes

**Files:** `src/bot/router.ts`, `src/bot/state.ts`

**Tasks:**
1. Add `getGroupModeSync()` call to router
2. Route `paused` groups to `IGNORE`
3. Route `learning` groups to `OBSERVE_ONLY`
4. Route `assisted` groups to `OBSERVE_ONLY` (future: suggestion system)
5. Route `active` groups with group-specific trigger check
6. Remove `isTrainingMode()` check from router

**Acceptance Criteria:**
- [ ] `paused` groups receive no response AND no logging
- [ ] `learning` groups log messages but don't respond
- [ ] `active` groups respond to both global AND group-specific triggers
- [ ] Control group ALWAYS processes commands regardless of group mode
- [ ] Group-specific trigger patterns are checked for active groups

### Story 3: New Control Commands - Mode Management

**Files:** `src/handlers/control.ts`

**Tasks:**
1. Add `mode <group> <learning|assisted|active|paused>` command
2. Add `modes` command to list all groups with modes and learning stats
3. Add `config <group>` command to show group's current configuration
4. Update command parser for new commands
5. Add handlers with proper logging and audit trail

**Acceptance Criteria:**
- [ ] `mode OTC learning` sets OTC group to learning mode
- [ ] `mode "OTC Brasil" active` works with quoted group names
- [ ] `modes` lists all groups with modes, learning duration, message counts
- [ ] `config OTC` shows full configuration for group
- [ ] Mode changes log who made them (`updated_by` field)
- [ ] Unknown group name returns helpful error with suggestions

### Story 4: Configuration Commands - Triggers & Roles

**Files:** `src/handlers/control.ts`, `src/services/groupConfig.ts`

**Tasks:**
1. Add `trigger add <group> <pattern>` command
2. Add `trigger remove <group> <pattern>` command
3. Add `role <group> <player> <operator|client|cio>` command
4. Implement corresponding service functions
5. Add validation and error handling

**Acceptance Criteria:**
- [ ] `trigger add OTC "compro usdt"` adds custom trigger
- [ ] `trigger remove OTC "compro usdt"` removes custom trigger
- [ ] Duplicate trigger patterns are rejected
- [ ] `role OTC 5511999999999 operator` assigns player role
- [ ] Invalid roles are rejected with error message
- [ ] Changes persist to Supabase and update cache

### Story 5: Backward Compatibility Layer

**Files:** `src/handlers/control.ts`

**Tasks:**
1. Map `pause [group]` to `mode [group] paused`
2. Map `resume [group]` to `mode [group] active`
3. Map `training on` to set all known groups to `learning`
4. Map `training off` to set all known groups to `active`
5. Update status command to show new mode system
6. Ensure legacy commands log deprecation warning

**Acceptance Criteria:**
- [ ] `pause OTC` sets OTC to `paused` mode
- [ ] `resume OTC` sets OTC to `active` mode
- [ ] `pause` (no arg) sets ALL groups to `paused`
- [ ] `resume` (no arg) sets ALL groups to `active`
- [ ] `training on` sets all groups to `learning`
- [ ] `training off` sets all groups to `active`
- [ ] `status` shows group modes section with learning stats
- [ ] Legacy commands log info-level deprecation notice

### Story 6: State Cleanup & Test Updates

**Files:** `src/bot/state.ts`, `src/bot/state.test.ts`, `src/handlers/control.test.ts`

**Tasks:**
1. Remove deprecated state variables from `state.ts`
2. Remove deprecated functions from `state.ts`
3. Update all tests for new mode system
4. Remove unused imports across codebase
5. Add new tests for `groupConfig.ts` service

**Acceptance Criteria:**
- [ ] `trainingMode`, `pausedGroups`, `globalPause` removed from state
- [ ] Related functions removed from state
- [ ] All existing tests pass with new implementation
- [ ] New tests cover `groupConfig.ts` service
- [ ] No dead code remains
- [ ] No unused imports

## Future Phase: Assisted Mode

The `assisted` mode is reserved for a future phase where:

1. Bot observes a trigger message in an OTC group
2. Bot sends a **suggestion** to the control group:
   ```
   💡 Suggestion for OTC Brasil:
   Trigger: "compro 1000 usdt"
   Proposed response: "USDT/BRL: 5.15 | Total: R$ 5,150"

   Reply "approve" to send, "skip" to ignore
   ```
3. CIO approves or rejects
4. If approved, bot sends response AND learns the pattern
5. Over time, confidence builds and group can move to `active`

This phase requires:
- Suggestion queue in Supabase
- Control group message parsing for approve/skip
- Confidence scoring system
- Auto-promotion logic (assisted → active)

## Open Questions

1. **Learning duration:** How long should a group observe before moving to active?
   - Recommendation: Minimum 2 weeks, configurable per group

2. **Trigger pattern format:** Should patterns support regex or just substring match?
   - Recommendation: Start with case-insensitive substring, add regex later

3. **Player role impact:** How do player roles affect behavior?
   - Recommendation: Future phase - operators get different response format, clients tracked for analytics

4. **AI threshold behavior:** What exactly does the threshold control?
   - Recommendation: `0-30` = rules only, `31-70` = AI fallback, `71-100` = AI primary

5. **Cross-group learning:** Should patterns learned in one group apply to others?
   - Recommendation: No. Each group is unique. Manual pattern sharing via commands.
