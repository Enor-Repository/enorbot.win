# eNorBOT

A WhatsApp bot for real-time USDT/BRL OTC price quotes with CIO control interface, Excel logging, and receipt processing.

## Features

- **Real-time Price Quotes**: Fetches USDT/BRL prices from Binance API on trigger words ("preço", "cotação")
- **Per-Group Learning System**: Each group has its own mode (learning, assisted, active, paused) with custom triggers and player roles
- **CIO Control Interface**: Mode management, pause, resume, and status commands via dedicated control group
- **Excel Logging**: Logs all quotes to Microsoft Excel via MS Graph API with offline queue support
- **Receipt Processing**: OCR-based receipt parsing using OpenRouter (Claude Haiku Vision)
- **Session Persistence**: WhatsApp auth state persisted in Supabase for seamless restarts
- **Error Handling**: Transient error retry with backoff, auto-pause on consecutive failures, auto-recovery
- **Graceful Shutdown**: Clean PM2 integration with proper signal handling

## Tech Stack

| Category | Technology | Version |
|----------|------------|---------|
| Runtime | Node.js | ≥20.0.0 |
| Language | TypeScript | 5.9+ |
| WhatsApp SDK | @whiskeysockets/baileys | 7.0.0-rc.9 |
| Database | Supabase (PostgreSQL) | 2.90.1 |
| Validation | Zod | 4.3+ |
| MS Graph Auth | @azure/msal-node | 3.8+ |
| Testing | Vitest | 4.0+ |
| Process Manager | PM2 | - |

## Prerequisites

- Node.js 20.0.0 or higher
- npm or yarn
- Supabase project (for session persistence)
- WhatsApp account for bot number
- Microsoft Azure app registration (for Excel logging)
- OpenRouter API key (for receipt OCR)

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd eNorBOT
npm install
```

### 2. Configure Environment

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your values (see [Configuration](#configuration) below).

### 3. Set Up Database

Apply Supabase migrations in order. See [supabase/migrations/README.md](./supabase/migrations/README.md) for detailed instructions.

```sql
-- Apply in Supabase SQL Editor:
-- 1. 20260115_001_create_sessions_table.sql
-- 2. 20260116_001_create_log_queue_table.sql
-- 3. 20260119_001_create_receipts_table.sql
-- 4. 20260123_001_update_log_queue_schema.sql
-- 5. 20260127_001_create_group_config_table.sql
```

Or use Supabase CLI:
```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

### 4. Run Development Server

```bash
npm run dev
```

On first run, you'll see a pairing code in the console. Enter this code in WhatsApp > Linked Devices > Link a Device.

### 5. Build for Production

```bash
npm run build
npm start
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Supabase service role key (not anon) |
| `PHONE_NUMBER` | Yes | Bot's WhatsApp number (e.g., 5511999999999) |
| `CONTROL_GROUP_PATTERN` | Yes | Pattern to identify control group (e.g., "CONTROLE") |
| `MS_GRAPH_CLIENT_ID` | Yes | Azure app client ID for Excel logging |
| `MS_GRAPH_CLIENT_SECRET` | Yes | Azure app client secret |
| `OPENROUTER_API_KEY` | No | OpenRouter API key for receipt OCR |
| `NODE_ENV` | No | Environment: development or production |
| `HEALTH_PORT` | No | Health endpoint port (default: 3000) |

### Control Group Setup

Create a WhatsApp group with a name containing your `CONTROL_GROUP_PATTERN` (e.g., "eNor CONTROLE"). Add the bot and authorized users to this group for administrative commands.

## Usage

### Trigger Words (Price Quotes)

Send any of these words in a monitored group to get a price quote:
- `preço`
- `cotação`

### Control Commands

Send these commands in the control group:

#### Mode Management (Per-Group)

| Command | Description |
|---------|-------------|
| `mode <group> <mode>` | Set group mode: `learning`, `assisted`, `active`, `paused` |
| `modes` | List all groups with their modes and stats |
| `config <group>` | Show group's full configuration |
| `trigger add <group> <pattern>` | Add custom trigger pattern for group |
| `trigger remove <group> <pattern>` | Remove custom trigger pattern |
| `role <group> <player> <role>` | Assign player role: `operator`, `client`, `cio` |

#### Group Modes

| Mode | Behavior |
|------|----------|
| `learning` | Watch & log messages, no responses (default for new groups) |
| `assisted` | (Future) Bot suggests, human approves |
| `active` | Respond based on rules + AI fallback |
| `paused` | Completely ignored |

#### Legacy Commands

| Command | Description |
|---------|-------------|
| `pause [group]` | Pause group (maps to `mode <group> paused`) |
| `resume [group]` | Resume group (maps to `mode <group> active`) |
| `training on` | Set all groups to learning mode |
| `training off` | Set all groups to active mode |
| `status` | Get current bot status with mode info |

## Project Structure

```
eNorBOT/
├── src/
│   ├── index.ts           # Application entry point
│   ├── config.ts          # Configuration validation
│   ├── bot/
│   │   ├── connection.ts  # WhatsApp connection management
│   │   ├── router.ts      # Message routing logic
│   │   ├── state.ts       # Bot state management
│   │   ├── authState.ts   # Auth state persistence
│   │   └── notifications.ts
│   ├── handlers/
│   │   ├── control.ts     # Control commands handler
│   │   ├── price.ts       # Price quote handler
│   │   ├── receipt.ts     # Receipt processing handler
│   │   └── tronscan.ts    # Tronscan integration
│   ├── services/
│   │   ├── binance.ts     # Binance API client
│   │   ├── supabase.ts    # Supabase client
│   │   ├── groupConfig.ts # Per-group mode & config service
│   │   ├── messageHistory.ts # Message history logging
│   │   ├── excel.ts       # Excel logging service
│   │   ├── graph.ts       # MS Graph API client
│   │   ├── openrouter.ts  # OpenRouter (OCR) client
│   │   ├── errors.ts      # Error tracking service
│   │   ├── autoPause.ts   # Auto-pause on errors
│   │   ├── autoRecovery.ts # Auto-recovery service
│   │   └── logQueue.ts    # Offline log queue
│   ├── types/             # TypeScript type definitions
│   └── utils/             # Utility functions
├── supabase/
│   └── migrations/        # Database migrations
├── dist/                  # Compiled JavaScript
├── docs/                  # Project documentation
└── ecosystem.config.js    # PM2 configuration
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with hot-reload |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run production build |
| `npm test` | Run tests once |
| `npm run test:watch` | Run tests in watch mode |

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npx vitest run src/services/binance.test.ts
```

## Deployment

### PM2 (Recommended)

The project includes PM2 configuration for production deployment:

```bash
# Build the project
npm run build

# Start with PM2
pm2 start ecosystem.config.js --env production

# View logs
pm2 logs enorbot

# Restart
pm2 restart enorbot

# Stop
pm2 stop enorbot
```

### VPS Deployment

1. SSH to your VPS
2. Clone/upload the project to `/opt/enorbot/`
3. Install dependencies: `npm install --production`
4. Build: `npm run build`
5. Start: `pm2 start ecosystem.config.js --env production`
6. Save PM2 process list: `pm2 save`
7. Enable startup: `pm2 startup`

### WhatsApp Re-authentication

If the bot gets logged out:

1. Clear the session in Supabase:
   ```sql
   DELETE FROM sessions WHERE id = 'default';
   ```
2. Restart the bot: `pm2 restart enorbot`
3. Watch logs for pairing code: `pm2 logs enorbot`
4. Enter the code in WhatsApp > Linked Devices

## Architecture

```
WhatsApp ──► Baileys ──► Router ──► Handlers ──► Services
                           │
                           ├── CONTROL → pause/resume/status
                           ├── PRICE → Binance → R$X,XX
                           └── RECEIPT → OpenRouter OCR
```

### Key Integrations

| Service | Purpose | Endpoint |
|---------|---------|----------|
| Binance | Price quotes | `api.binance.com/api/v3/ticker/price` |
| Supabase | Session persistence | `{project}.supabase.co` |
| MS Graph | Excel logging | `graph.microsoft.com/v1.0/...` |
| OpenRouter | Receipt OCR | `openrouter.ai/api/v1/...` |

### Error Handling

1. **Transient errors**: Retry with exponential backoff
2. **Consecutive failures** (3): Auto-pause + notify control group
3. **High frequency errors** (10 in 60s): Auto-pause + notify
4. **Auto-recovery**: Resumes after 5 minutes
5. **Manual recovery**: Send "resume" in control group

## Documentation

Detailed documentation is available in the [docs/](./docs/) folder:

- [Architecture](./docs/architecture.md) - System design and data flows
- [Source Tree Analysis](./docs/source-tree-analysis.md) - File structure details
- [Development Guide](./docs/development-guide.md) - Setup and development workflow
- [Credentials](./docs/credentials.md) - Credential management and regeneration
- [Group Modes Tech Spec](./docs/tech-spec-group-modes.md) - Per-group learning system design
- [Group Modes Progress](./docs/progress-group-modes.md) - Implementation status

## Contributing

1. Create a feature branch from `main`
2. Make your changes with tests
3. Run `npm test` to ensure all tests pass
4. Submit a pull request

## License

ISC
