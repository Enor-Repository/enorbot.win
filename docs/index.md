# eNorBOT Documentation Index

## Project Overview

| Property | Value |
|----------|-------|
| **Name** | eNorBOT |
| **Type** | WhatsApp Bot Service |
| **Language** | TypeScript 5.9+ |
| **Runtime** | Node.js 20+ |
| **Architecture** | Event-driven message router |
| **Repository** | Monolith |

**Purpose**: Real-time USDT/BRL OTC price quotes via WhatsApp groups with CIO control interface, Excel logging, and receipt processing.

## Quick Reference

| Item | Details |
|------|---------|
| **Entry Point** | `src/index.ts` |
| **Tech Stack** | TypeScript, Baileys, Supabase, Zod, Vitest |
| **WhatsApp Auth** | Pairing code (not QR) |
| **Price Source** | Binance API |
| **Trigger Words** | "preço", "cotação" |
| **Control Commands** | pause, resume, status, training |
| **Deploy Path** | `/opt/enorbot/` |
| **Health Endpoint** | `:3000` |

## Documentation

| Document | Description |
|----------|-------------|
| [README](../README.md) | Project overview, quick start, deployment |
| [Architecture](./architecture.md) | System design, data flows, integrations |
| [Source Tree Analysis](./source-tree-analysis.md) | File structure and purposes |
| [Development Guide](./development-guide.md) | Setup, scripts, testing, deployment |
| [Project Context](./project-context.md) | AI agent context rules |
| [Code Review Checklist](./code-review-checklist.md) | Review guidelines |

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

| Feature | Description |
|---------|-------------|
| **Price Quotes** | Real-time USDT/BRL from Binance (2s timeout) |
| **CIO Control** | pause/resume/status/training commands |
| **Excel Logging** | Quote logging via MS Graph API with offline queue |
| **Receipt Processing** | PIX receipt OCR and validation |
| **Training Mode** | Observe-only mode for data collection |
| **Error Resilience** | Auto-pause after 3 failures, auto-recovery in 5 min |

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

## Database Schema

| Table | Purpose |
|-------|---------|
| `sessions` | WhatsApp auth state persistence |
| `log_queue` | Offline Excel logging queue |
| `receipts` | Validated PIX receipt data |

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

*Documentation generated: 2026-01-27*
*Scan level: Deep*
*Workflow: document-project v1.2.0*
