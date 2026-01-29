# Tech Spec: eNorBOT Insights & Rule Builder Dashboard

## 1. Overview

### Purpose

The eNorBOT dashboard is an **Insights Discovery and Rule Builder** interface - NOT a simple status monitor. Its primary goals:

1. **Pattern Discovery**: Visualize group behavior patterns to understand when, how, and who triggers conversations
2. **Rule Creation**: Enable the CIO to define response rules WITHOUT touching code
3. **Cost Optimization**: Track AI usage and help shift from AI-generated responses to rule-based responses
4. **Per-Group Configuration**: Tailor bot behavior for each OTC group based on observed patterns

### Core Philosophy

The bot operates in a learning-first model:
- **Learning Mode**: Observe messages, collect patterns, discover triggers
- **Assisted Mode**: AI suggests responses, human approves
- **Active Mode**: Bot responds based on rules first, AI as fallback
- **Paused Mode**: Complete silence

The dashboard transforms raw observation data into actionable insights, then lets the CIO codify those insights into rules that replace expensive AI calls.

### Key Metrics

| Metric | Description | Goal |
|--------|-------------|------|
| Rules vs AI Ratio | Percentage of responses handled by rules vs AI | > 80% rules |
| Cost per Group | Daily AI cost estimate per group | Minimize |
| Pattern Coverage | % of common triggers covered by rules | > 90% |
| Response Accuracy | Rule matches vs false positives | > 95% accuracy |

---

## 2. AlphaLabProd Components to Reuse

Copy and adapt these components from `/Users/joaogalhardo/Desktop/AlphaLabProd`:

### Core UI Components

| Component | Source Path | Usage |
|-----------|-------------|-------|
| Card, CardHeader, CardContent, CardFooter | `components/ui/card.tsx` | Section containers |
| Badge | `components/ui/badge.tsx` | Status indicators (mode badges, player roles) |
| Button | `components/ui/button.tsx` | Actions with variants (primary, destructive, outline) |
| Tabs, TabsList, TabsTrigger, TabsContent | `components/ui/tabs.tsx` | Dashboard navigation |
| Dialog, DialogContent, DialogHeader | `components/ui/dialog.tsx` | Rule editor modal, test results |
| DropdownMenu | `components/ui/dropdown-menu.tsx` | Mode selector, action menus |
| Tooltip, InfoTooltip | `components/ui/tooltip.tsx` | Help text for rule syntax |

### Data Display Components

| Component | Source Path | Usage |
|-----------|-------------|-------|
| StatsBar | `components/shared/StatsBar.tsx` | Overview metrics row |
| MetricCard | `components/alphavision/MetricCard.tsx` | Individual stat cards with trends |
| MiniSparkline | `components/charts/MiniSparkline.tsx` | Activity trend lines |
| LoadingSkeleton, SkeletonGrid | `components/shared/LoadingSkeleton.tsx` | Loading states |
| EmptyState | `components/shared/EmptyState.tsx` | No data states |

### Advanced Components

| Component | Source Path | Adaptation |
|-----------|-------------|------------|
| FlowsTable | `components/alphahub/v2/FlowsTable.tsx` | Adapt for player leaderboard (sortable columns) |
| Widget, WidgetBody, WidgetList | `components/alphahub/v2/Widget.tsx` | Analytics widget containers |
| BiasGauge | `components/alphavision/charts/BiasGauge.tsx` | Adapt for AI threshold slider visualization |
| ConfidenceGauge | `components/markets/ConfidenceGauge.tsx` | Rule confidence/coverage gauge |
| ConnectionStatus | `components/ui/ConnectionStatus.tsx` | WhatsApp connection indicator |

### New Components to Create

| Component | Purpose |
|-----------|---------|
| HeatmapGrid | Activity heatmap (hour x day matrix) |
| RuleBuilder | Visual rule editor with conditions |
| PatternCard | Discovered trigger pattern display |
| RuleTestPanel | Test rules against historical data |
| CostChart | AI cost trend visualization |

**Note:** Strip Next.js/App Router dependencies; use vanilla React with Vite for simpler bundling.

---

## 3. Architecture

### Backend (TypeScript/Node)

```
src/
  dashboard/
    server.ts           # Express server on port 3001, serves static + API
    api/
      status.ts         # Connection and operational status
      groups.ts         # Group management and configuration
      analytics.ts      # Activity heatmaps, leaderboards, patterns
      rules.ts          # Rule CRUD operations
      costs.ts          # AI usage and cost tracking
    types.ts            # Response types
    middleware.ts       # Request logging, error handling
```

**Server Setup:**
- Express server on `DASHBOARD_PORT` (default 3001)
- Serves `dist/dashboard/` static files
- CORS enabled for development
- No authentication (internal network only)

### Frontend (React/Vite)

```
dashboard/
  src/
    App.tsx                   # Main layout with sidebar navigation
    pages/
      OverviewPage.tsx        # System health + quick stats
      GroupPage.tsx           # Per-group analytics + config
      RulesPage.tsx           # Global rule management
      CostsPage.tsx           # Cost tracking and optimization
    components/
      overview/
        ConnectionCard.tsx    # WhatsApp status
        QuickStats.tsx        # Messages, AI calls, uptime
        GroupsList.tsx        # All groups summary
      analytics/
        ActivityHeatmap.tsx   # Hour x day activity matrix
        PlayerLeaderboard.tsx # Most active participants
        TriggerPatterns.tsx   # Common phrases discovered
        ConversationFlow.tsx  # What follows what
        LearningProgress.tsx  # Days in mode, messages collected
      config/
        ModeSelector.tsx      # learning/assisted/active/paused
        TriggerEditor.tsx     # Add/remove/test patterns
        TemplateEditor.tsx    # Response templates
        PlayerRoles.tsx       # Role assignment table
        AIThreshold.tsx       # Confidence slider
      rules/
        RuleBuilder.tsx       # Visual rule creator
        RuleList.tsx          # All rules with status
        RuleTestPanel.tsx     # Test against history
        ImportExport.tsx      # Share rules between groups
      costs/
        CostByGroup.tsx       # Bar chart of AI usage
        CostTrend.tsx         # Cost over time
        RulesRatio.tsx        # Rules vs AI pie chart
      shared/
        GroupSelector.tsx     # Dropdown for group context
        ConfirmDialog.tsx     # Destructive action confirmation
    hooks/
      usePolling.ts           # Auto-refresh hook (5s interval)
      useAnalytics.ts         # Analytics data fetching
      useRules.ts             # Rule CRUD operations
      useCosts.ts             # Cost data fetching
    api.ts                    # Fetch wrappers
    types.ts                  # Frontend types
  index.html
  vite.config.ts              # Build to ../dist/dashboard
```

### Data Flow

```
# Status & Control
Browser -> GET /api/status -> state.ts (connection, operational)
Browser -> GET /api/groups -> state.ts + control.ts (known groups)
Browser -> POST /api/groups/:id/mode -> Update group mode

# Analytics (new)
Browser -> GET /api/groups/:id/analytics/heatmap -> Aggregate from message_history
Browser -> GET /api/groups/:id/analytics/players -> Top senders from history
Browser -> GET /api/groups/:id/analytics/patterns -> Trigger phrase frequency
Browser -> GET /api/groups/:id/analytics/flows -> Conversation sequence analysis
Browser -> GET /api/groups/:id/learning -> Learning mode stats

# Rules (new)
Browser -> GET /api/rules -> All rules (global + per-group)
Browser -> POST /api/rules -> Create rule
Browser -> PUT /api/rules/:id -> Update rule
Browser -> DELETE /api/rules/:id -> Delete rule
Browser -> POST /api/rules/:id/test -> Test rule against history

# Costs (new)
Browser -> GET /api/costs/summary -> Total AI calls, estimated cost
Browser -> GET /api/costs/by-group -> Per-group breakdown
Browser -> GET /api/costs/trend -> Historical cost data
```

---

## 4. API Endpoints

### Status APIs

#### GET /api/status
Returns full bot status snapshot.

**Response:**
```typescript
{
  connection: 'connected' | 'connecting' | 'disconnected',
  operational: 'running' | 'paused',
  trainingMode: boolean,
  globalPause: boolean,
  uptime: number,              // ms since start
  messagesSentToday: number,
  aiCallsToday: number,
  estimatedCostToday: number,  // USD
  lastActivityAt: string | null,
  pauseInfo: {
    reason: string | null,
    pausedAt: string | null
  }
}
```

#### GET /api/groups
Returns all known groups with configuration.

**Response:**
```typescript
{
  groups: Array<{
    id: string,
    name: string,
    mode: 'learning' | 'assisted' | 'active' | 'paused',
    isControlGroup: boolean,
    learningDays: number,
    messagesCollected: number,
    rulesActive: number,
    lastActivity: string | null
  }>
}
```

#### PUT /api/groups/:groupId/mode
Update group operational mode.

**Request:**
```typescript
{
  mode: 'learning' | 'assisted' | 'active' | 'paused'
}
```

**Response:** `{ success: true, mode: string }`

### Analytics APIs

#### GET /api/groups/:groupId/analytics/heatmap
Returns activity heatmap data (messages by hour and day).

**Query Params:** `?days=30` (default 30)

**Response:**
```typescript
{
  heatmap: Array<{
    dayOfWeek: 0-6,        // 0 = Sunday
    hour: 0-23,
    messageCount: number,
    triggerCount: number
  }>,
  peakHour: number,
  peakDay: number,
  totalMessages: number
}
```

#### GET /api/groups/:groupId/analytics/players
Returns top active participants.

**Query Params:** `?limit=20` (default 20)

**Response:**
```typescript
{
  players: Array<{
    phoneHash: string,     // Anonymized identifier
    displayName: string,   // If known
    messageCount: number,
    triggerCount: number,
    lastActive: string,
    role: 'admin' | 'trader' | 'observer' | null
  }>
}
```

#### GET /api/groups/:groupId/analytics/patterns
Returns discovered trigger patterns.

**Query Params:** `?minOccurrences=5` (default 5)

**Response:**
```typescript
{
  patterns: Array<{
    phrase: string,
    occurrences: number,
    lastSeen: string,
    hasRule: boolean,      // Already covered by a rule
    suggestedResponse: string | null
  }>
}
```

#### GET /api/groups/:groupId/analytics/flows
Returns conversation flow analysis.

**Response:**
```typescript
{
  flows: Array<{
    trigger: string,
    followedBy: Array<{
      response: string,
      count: number,
      percentage: number
    }>
  }>
}
```

#### GET /api/groups/:groupId/learning
Returns learning mode progress.

**Response:**
```typescript
{
  mode: 'learning' | 'assisted' | 'active' | 'paused',
  startedAt: string,
  daysInMode: number,
  messagesCollected: number,
  uniqueTriggers: number,
  patternsCovered: number,   // Patterns with rules
  patternsDiscovered: number,
  readinessScore: number     // 0-100, suggests when to go active
}
```

### Rules APIs

#### GET /api/rules
Returns all rules.

**Query Params:** `?groupId=xxx` (optional, filter by group)

**Response:**
```typescript
{
  rules: Array<{
    id: string,
    groupId: string | null,  // null = global rule
    name: string,
    trigger: {
      type: 'exact' | 'contains' | 'regex' | 'starts_with',
      pattern: string,
      caseSensitive: boolean
    },
    conditions: Array<{
      type: 'player_role' | 'time_range' | 'day_of_week',
      value: string
    }>,
    response: {
      type: 'template' | 'ai_enhanced',
      template: string,
      variables: string[]    // e.g., ['{{amount}}', '{{currency}}']
    },
    priority: number,
    enabled: boolean,
    stats: {
      timesMatched: number,
      lastMatched: string | null
    },
    createdAt: string,
    updatedAt: string
  }>
}
```

#### POST /api/rules
Create a new rule.

**Request:**
```typescript
{
  groupId: string | null,
  name: string,
  trigger: { type: string, pattern: string, caseSensitive: boolean },
  conditions: Array<{ type: string, value: string }>,
  response: { type: string, template: string },
  priority: number
}
```

**Response:** `{ success: true, rule: Rule }`

#### POST /api/rules/:ruleId/test
Test a rule against historical messages.

**Request:**
```typescript
{
  groupId: string,
  daysBack: number  // Test against last N days
}
```

**Response:**
```typescript
{
  matches: Array<{
    messageId: string,
    timestamp: string,
    content: string,
    sender: string,
    wouldRespond: string  // The response that would be sent
  }>,
  totalMatches: number,
  falsePositiveEstimate: number  // Based on context analysis
}
```

### Cost APIs

#### GET /api/costs/summary
Returns cost summary.

**Query Params:** `?period=day|week|month` (default day)

**Response:**
```typescript
{
  period: string,
  totalAICalls: number,
  totalTokensUsed: number,
  estimatedCost: number,        // USD
  ruleMatchCount: number,
  rulesVsAIRatio: number,       // 0-100 percentage
  costPerMessage: number,
  projectedMonthlyCost: number
}
```

#### GET /api/costs/by-group
Returns per-group cost breakdown.

**Response:**
```typescript
{
  groups: Array<{
    groupId: string,
    groupName: string,
    aiCalls: number,
    estimatedCost: number,
    ruleMatches: number,
    rulesRatio: number
  }>
}
```

#### GET /api/costs/trend
Returns cost trend over time.

**Query Params:** `?days=30` (default 30)

**Response:**
```typescript
{
  trend: Array<{
    date: string,
    aiCalls: number,
    estimatedCost: number,
    ruleMatches: number
  }>
}
```

---

## 5. Key Features Detail

### 5.1 Rule Builder (Core Feature)

The rule builder is the heart of the dashboard. It allows creating response rules visually:

**Rule Structure:**
```
WHEN [trigger pattern]
  FROM [player role] (optional)
  DURING [time window] (optional)
RESPOND WITH [template]
```

**Trigger Types:**
- **Exact Match**: `"compro 100k"` matches exactly
- **Contains**: `"compro"` matches any message containing the word
- **Starts With**: `"quanto"` matches messages starting with
- **Regex**: `compro\s+\d+k?` for complex patterns

**Response Templates:**
Support variables extracted from trigger:
```
Trigger: "compro {{amount}} {{currency}}"
Response: "Para {{amount}} de {{currency}}, a cotacao atual e..."
```

**Testing Workflow:**
1. Create rule in visual editor
2. Click "Test Against History"
3. See all messages that would match
4. Review for false positives
5. Adjust pattern if needed
6. Enable rule

### 5.2 Activity Heatmap

Visual 7x24 grid showing message activity:
- X-axis: Hours (0-23)
- Y-axis: Days (Sun-Sat)
- Cell color: Intensity based on message count
- Hover: Show exact count and top trigger

**Use Case:** Identify peak trading hours to prioritize rule coverage for those times.

### 5.3 Player Leaderboard

Sortable table showing:
- Player identifier (phone hash or name if known)
- Message count
- Trigger frequency (% of messages that are triggers)
- Role assignment (drag-drop to assign)
- Last active timestamp

**Use Case:** Identify key traders whose patterns should be prioritized for rules.

### 5.4 Pattern Discovery

Automatically surfaces common phrases:
- Phrase text
- Occurrence count
- "Has Rule" badge if covered
- "Create Rule" quick action

**Use Case:** Find common triggers that don't have rules yet.

### 5.5 Cost Optimization View

Dashboard showing:
- **Bar Chart:** AI calls per group
- **Line Chart:** Cost trend over time
- **Pie Chart:** Rules vs AI ratio
- **Metric Cards:**
  - Today's cost
  - Projected monthly
  - Cost per message
  - Savings from rules

**Goal:** Visible progress toward reducing AI dependency.

---

## 6. Database Schema Additions

### rules table

```sql
CREATE TABLE rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id TEXT REFERENCES groups(jid),  -- NULL for global rules
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,            -- exact, contains, regex, starts_with
  trigger_pattern TEXT NOT NULL,
  trigger_case_sensitive BOOLEAN DEFAULT false,
  conditions JSONB DEFAULT '[]',
  response_type TEXT DEFAULT 'template', -- template, ai_enhanced
  response_template TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  enabled BOOLEAN DEFAULT true,
  times_matched INTEGER DEFAULT 0,
  last_matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_rules_group ON rules(group_id);
CREATE INDEX idx_rules_enabled ON rules(enabled) WHERE enabled = true;
```

### ai_usage table

```sql
CREATE TABLE ai_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT now(),
  tokens_input INTEGER,
  tokens_output INTEGER,
  model TEXT,
  estimated_cost DECIMAL(10,6),
  trigger_message TEXT,
  response_generated TEXT
);

CREATE INDEX idx_ai_usage_group ON ai_usage(group_id);
CREATE INDEX idx_ai_usage_timestamp ON ai_usage(timestamp);
```

### group_config table

```sql
CREATE TABLE group_config (
  group_id TEXT PRIMARY KEY,
  mode TEXT DEFAULT 'learning',          -- learning, assisted, active, paused
  ai_threshold DECIMAL(3,2) DEFAULT 0.7, -- 0-1, confidence needed for AI
  learning_started_at TIMESTAMPTZ,
  custom_triggers JSONB DEFAULT '[]',
  player_roles JSONB DEFAULT '{}',       -- {phoneHash: 'admin' | 'trader' | 'observer'}
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 7. Implementation Stories

### Phase 1: Analytics Foundation (Insights First)

#### Story D.1: Analytics Backend
**Description:** Create analytics API endpoints that aggregate data from message_history.

**Acceptance Criteria:**
- [ ] `GET /api/groups/:id/analytics/heatmap` returns activity by hour/day
- [ ] `GET /api/groups/:id/analytics/players` returns top active users
- [ ] `GET /api/groups/:id/analytics/patterns` returns common trigger phrases
- [ ] `GET /api/groups/:id/learning` returns learning mode progress
- [ ] All queries optimized with proper indexes
- [ ] Response time < 200ms for 30-day queries

**Files:** `src/dashboard/api/analytics.ts`

---

#### Story D.2: Activity Heatmap Component
**Description:** Build interactive heatmap visualization.

**Acceptance Criteria:**
- [ ] 7x24 grid renders with color intensity
- [ ] Hover shows message count and top trigger
- [ ] Click on cell filters message list to that time slot
- [ ] Legend shows color scale
- [ ] Responsive on mobile (scrollable)

**Files:** `dashboard/src/components/analytics/ActivityHeatmap.tsx`

---

#### Story D.3: Player Leaderboard
**Description:** Build sortable player table with role assignment.

**Acceptance Criteria:**
- [ ] Table shows top 20 players by message count
- [ ] Columns: Name/Hash, Messages, Triggers, Role, Last Active
- [ ] All columns sortable (adapt FlowsTable pattern)
- [ ] Role dropdown in each row
- [ ] Role changes persist to database
- [ ] Search/filter by name

**Files:** `dashboard/src/components/analytics/PlayerLeaderboard.tsx`

---

#### Story D.4: Pattern Discovery
**Description:** Build pattern discovery card showing uncovered triggers.

**Acceptance Criteria:**
- [ ] Card shows top 10 trigger phrases without rules
- [ ] Each pattern shows occurrence count
- [ ] "Create Rule" button opens rule builder pre-filled
- [ ] Patterns with rules show green checkmark
- [ ] Refresh button to reload patterns

**Files:** `dashboard/src/components/analytics/TriggerPatterns.tsx`

---

### Phase 2: Rule Builder

#### Story D.5: Rule Builder UI
**Description:** Build visual rule creation interface.

**Acceptance Criteria:**
- [ ] Trigger type selector (exact, contains, regex, starts_with)
- [ ] Pattern input with syntax highlighting for regex
- [ ] Condition builder (player role, time range)
- [ ] Response template editor with variable support
- [ ] Priority selector (1-10)
- [ ] Preview shows formatted rule

**Files:** `dashboard/src/components/rules/RuleBuilder.tsx`

---

#### Story D.6: Rule Testing
**Description:** Enable testing rules against historical data.

**Acceptance Criteria:**
- [ ] "Test Rule" button runs rule against last 7/30 days
- [ ] Results show matching messages with preview
- [ ] False positive indicator based on context
- [ ] Can adjust rule and re-test without saving
- [ ] Performance: Test completes in < 5 seconds

**Files:** `dashboard/src/components/rules/RuleTestPanel.tsx`, `src/dashboard/api/rules.ts`

---

#### Story D.7: Rules CRUD API
**Description:** Create backend for rule management.

**Acceptance Criteria:**
- [ ] `GET /api/rules` returns all rules
- [ ] `POST /api/rules` creates rule with validation
- [ ] `PUT /api/rules/:id` updates rule
- [ ] `DELETE /api/rules/:id` soft-deletes rule
- [ ] `POST /api/rules/:id/test` tests rule
- [ ] Rules persist to Supabase

**Files:** `src/dashboard/api/rules.ts`

---

#### Story D.8: Import/Export Rules
**Description:** Enable sharing rules between groups.

**Acceptance Criteria:**
- [ ] Export rules as JSON file
- [ ] Import rules from JSON
- [ ] On import, option to merge or replace
- [ ] Group-specific rules become global on export
- [ ] Validation prevents invalid rule imports

**Files:** `dashboard/src/components/rules/ImportExport.tsx`

---

### Phase 3: Cost Monitoring

#### Story D.9: AI Usage Tracking
**Description:** Track AI API calls and estimate costs.

**Acceptance Criteria:**
- [ ] Log every AI call with tokens and model
- [ ] Calculate estimated cost using OpenAI pricing
- [ ] Store in ai_usage table
- [ ] Aggregate by day and group

**Files:** `src/services/ai.ts` (extend), `src/dashboard/api/costs.ts`

---

#### Story D.10: Cost Dashboard
**Description:** Build cost monitoring interface.

**Acceptance Criteria:**
- [ ] Summary card: Today's cost, projected monthly
- [ ] Bar chart: AI calls per group
- [ ] Line chart: Cost trend over 30 days
- [ ] Rules vs AI ratio gauge
- [ ] Per-group table with cost breakdown

**Files:** `dashboard/src/pages/CostsPage.tsx`, `dashboard/src/components/costs/*`

---

### Phase 4: Group Configuration

#### Story D.11: Mode Selector
**Description:** Build group mode configuration UI.

**Acceptance Criteria:**
- [ ] Dropdown with 4 modes: learning, assisted, active, paused
- [ ] Mode change requires confirmation for "active"
- [ ] Shows current mode duration
- [ ] Warning if switching to active with low pattern coverage

**Files:** `dashboard/src/components/config/ModeSelector.tsx`

---

#### Story D.12: AI Threshold Slider
**Description:** Build confidence threshold configuration.

**Acceptance Criteria:**
- [ ] Slider from 0.5 to 1.0
- [ ] Visual gauge shows current threshold
- [ ] Tooltip explains what threshold means
- [ ] Changes persist to group_config

**Files:** `dashboard/src/components/config/AIThreshold.tsx`

---

### Phase 5: Infrastructure

#### Story D.13: Dashboard Server
**Description:** Create Express server with all API routes.

**Acceptance Criteria:**
- [ ] Server starts on port 3001
- [ ] Serves static files from dist/dashboard/
- [ ] All API routes mounted and working
- [ ] Error handling middleware
- [ ] Request logging
- [ ] Graceful shutdown

**Files:** `src/dashboard/server.ts`, `src/dashboard/middleware.ts`

---

#### Story D.14: Frontend Scaffold
**Description:** Set up React/Vite project with routing.

**Acceptance Criteria:**
- [ ] Vite project builds to dist/dashboard/
- [ ] React Router with 4 pages
- [ ] Sidebar navigation
- [ ] Tailwind CSS configured
- [ ] All AlphaLabProd components copied and adapted

**Files:** `dashboard/*`

---

## 8. Config Changes

Add to `src/types/config.ts`:

```typescript
DASHBOARD_PORT: z.string().default('3001').transform(Number).pipe(z.number().int().min(1).max(65535)),
DASHBOARD_ENABLED: z.string().default('true').transform(v => v === 'true'),
OPENAI_COST_PER_1K_INPUT: z.string().default('0.01').transform(Number),
OPENAI_COST_PER_1K_OUTPUT: z.string().default('0.03').transform(Number),
```

---

## 9. Dependencies

**Backend:**
- `express` (already exists)
- `cors` (dev only)

**Frontend:**
- `vite`
- `react`, `react-dom`
- `react-router-dom`
- `tailwindcss`, `autoprefixer`, `postcss`
- `@radix-ui/react-tabs`
- `@radix-ui/react-dialog`
- `@radix-ui/react-dropdown-menu`
- `@radix-ui/react-slider` (for AI threshold)
- `class-variance-authority`
- `lucide-react`
- `recharts` (for cost charts)

---

## 10. Security Notes

- Dashboard has no authentication - intended for internal/localhost access only
- Control actions (mode changes, rule creation) have no additional protection
- Consider adding basic auth header if exposed beyond localhost
- All state changes are logged via existing logger
- Rule patterns are sanitized to prevent regex DoS
- Export/import validates JSON schema before processing
