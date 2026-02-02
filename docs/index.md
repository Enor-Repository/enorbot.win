# eNorBOT Documentation Index

## Project Overview

| Property | Value |
|----------|-------|
| **Name** | eNorBOT |
| **Type** | WhatsApp Bot Service + Management Dashboard |
| **Language** | TypeScript 5.9+ |
| **Runtime** | Node.js 20+ / Browser |
| **Architecture** | Event-driven message router + React SPA |
| **Repository** | Multi-part (Bot Backend + Dashboard Frontend) |

**Purpose**: Real-time USDT/BRL OTC price quotes via WhatsApp groups with CIO control interface, Excel logging, receipt processing, and web-based management dashboard.

## Quick Reference

**Bot Backend:**

| Item | Details |
|------|---------|
| **Entry Point** | `src/index.ts` |
| **Tech Stack** | TypeScript, Baileys, Supabase, Zod, Vitest |
| **WhatsApp Auth** | Pairing code (not QR) |
| **Price Source** | Binance API |
| **Trigger Words** | "preço", "cotação" (+ custom patterns) |
| **Control Commands** | pause, resume, status, mode, training |
| **Deploy Path** | `/opt/enorbot/` |
| **Health Endpoint** | `:3000` |

**Dashboard Frontend:**

| Item | Details |
|------|---------|
| **Entry Point** | `dashboard/src/main.tsx` |
| **Tech Stack** | React 18, Vite 6, Tailwind CSS, Radix UI |
| **Dev Server** | `http://localhost:3003` (Express backend) |
| **Build Tool** | Vite with TypeScript |
| **Pages** | Overview, Groups & Rules, Trigger Patterns, Costs |

## Documentation

| Document | Description |
|----------|-------------|
| [README](../README.md) | Project overview, quick start, deployment |
| **[Project Status](./project-status.md)** | **Current state, recent changes, what's next** ⭐ |
| [Architecture](./architecture.md) | System design, data flows, integrations |
| [Source Tree Analysis](./source-tree-analysis.md) | File structure and purposes |
| [Development Guide](./development-guide.md) | Setup, scripts, testing, deployment |
| [Project Context](./project-context.md) | AI agent context rules |
| [Code Review Checklist](./code-review-checklist.md) | Review guidelines |

**Tech Specs:**
- [Dashboard Technical Spec](./tech-spec-dashboard.md)
- [Group Modes Technical Spec](./tech-spec-group-modes.md)
- [Message Logging Technical Spec](./tech-spec-full-message-logging.md)

**Progress Tracking:**
- [Dashboard Progress](./progress-dashboard.md)
- [Group Modes Progress](./progress-group-modes.md)
- [Message Logging Progress](./progress-message-logging.md)

## Architecture Summary

```
WhatsApp ──► Baileys ──► Router ──► Handlers ──► Services
                           │
                           ├── CONTROL → pause/resume/status/training
                           ├── PRICE → Binance → R$X,XX
                           ├── TRONSCAN → Update Excel tx hash
                           └── RECEIPT → OpenRouter OCR → Supabase
```

## Key Features

**Bot Features:**

| Feature | Description |
|---------|-------------|
| **Price Quotes** | Real-time USDT/BRL from Binance (2s timeout) |
| **Trigger Patterns** | Modular action system (text, quotes, AI prompts) |
| **CIO Control** | pause/resume/status/mode/training commands |
| **Group Modes** | Per-group learning, production, monitor, disabled modes |
| **Excel Logging** | Quote logging via MS Graph API with offline queue |
| **Receipt Processing** | PIX receipt OCR and validation |
| **AI Classification** | OpenRouter-powered message classification |
| **Error Resilience** | Auto-pause after 3 failures, auto-recovery in 5 min |

**Dashboard Features:**

| Feature | Description |
|---------|-------------|
| **Group Management** | View all groups, set modes, assign player roles |
| **Trigger Patterns** | Create, edit, delete custom trigger patterns |
| **Analytics** | Message volumes, pattern discovery, active patterns |
| **Real-time Status** | Bot health, queue status, classification metrics |

## Key Integrations

| Service | Purpose | Endpoint |
|---------|---------|----------|
| Binance | Price quotes | `api.binance.com/api/v3/ticker/price` |
| Supabase | Session persistence | `{project}.supabase.co` |
| MS Graph | Excel logging | `graph.microsoft.com/v1.0/...` |
| OpenRouter | Receipt OCR | `openrouter.ai/api/v1/...` |

## Control Commands Reference

Send in control group (name must contain `CONTROLE`):

| Command | Action |
|---------|--------|
| `pause` | Pause all OTC groups |
| `pause <group>` | Pause specific group (fuzzy match) |
| `resume` | Resume all + clear error state |
| `resume <group>` | Resume specific group |
| `status` | Show bot status dashboard |
| `training on` | Enable observe-only mode |
| `training off` | Resume normal operations |

## Development Commands

```bash
npm run dev        # Development with hot-reload
npm run build      # Compile TypeScript
npm start          # Production run
npm test           # Run tests once
npm run test:watch # Run tests in watch mode
```

## PM2 Commands (VPS)

```bash
pm2 start ecosystem.config.cjs --env production  # Start
pm2 restart enorbot         # Restart
pm2 stop enorbot            # Stop
pm2 logs enorbot            # View logs
pm2 logs enorbot --lines 100  # Last 100 lines
```

## Error Handling Strategy

1. **Transient errors**: Retry with 2s delay (up to 2 retries)
2. **Consecutive failures** (3): Auto-pause + notify control group
3. **High frequency errors** (10 in 60s): Auto-pause + notify
4. **Auto-recovery**: Resumes after 5 minutes
5. **Manual recovery**: Send "resume" in control group

## Database Schema (Supabase)

| Table | Purpose |
|-------|---------|
| `sessions` | WhatsApp auth state persistence |
| `log_queue` | Offline Excel logging queue with retry |
| `receipts` | Validated PIX receipt data |
| `group_config` | Per-group modes and player roles |
| `observation_queue` | Analytical observation logging |
| `message_history` | Comprehensive message logging |
| `rules` | Trigger patterns with modular actions |
| `messages` | Analytics data for pattern discovery |
| `groups` | Group metadata |
| `players` | Player role assignments |

## Feature Epics

| Epic | Status | Description |
|------|--------|-------------|
| Epic 1 | ✅ Complete | Connection & Authentication |
| Epic 2 | ✅ Complete | Price Quotes |
| Epic 3 | ✅ Complete | Error Handling & Auto-pause |
| Epic 4 | ✅ Complete | CIO Control Interface |
| Epic 5 | ✅ Complete | Excel Logging |
| Epic 6 | ✅ Complete | Receipt Processing |
| Epic 7 | ✅ Complete | Message History & Training Mode |

---

*Documentation generated: 2026-01-30*
*Scan level: Deep*
*Workflow: document-project v1.2.0*
*Project Type: Multi-part (Bot Backend + Dashboard Frontend)*
