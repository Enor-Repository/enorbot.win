# eNorBOT Development Guide

## Prerequisites

- **Node.js**: v20.0.0 or higher
- **npm**: v9+ (comes with Node.js)
- **Supabase account**: For session persistence
- **WhatsApp account**: Phone number for pairing

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd eNorBOT
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# REQUIRED - Supabase (session persistence)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=eyJhbGci...  # Use service_role key, NOT anon

# REQUIRED - Bot config
PHONE_NUMBER=5511999999999  # Your WhatsApp number (country + area + number)
CONTROL_GROUP_PATTERN=CONTROLE  # Pattern to identify control group

# Optional - MS Graph (Excel logging)
MS_GRAPH_CLIENT_ID=uuid
MS_GRAPH_CLIENT_SECRET=secret
MS_GRAPH_TENANT_ID=uuid
EXCEL_SITE_ID=contoso.sharepoint.com,guid,guid
EXCEL_DRIVE_ID=drive-id
EXCEL_FILE_ID=file-id

# Optional - OpenRouter (Receipt OCR)
OPENROUTER_API_KEY=sk-or-v1-...
```

### 3. Set Up Supabase

Apply migrations in order via Supabase SQL Editor:

```sql
-- 1. Sessions table (required)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY DEFAULT 'default',
  auth_state JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Log queue table (optional - for Excel offline queue)
CREATE TABLE log_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL,
  group_name TEXT NOT NULL,
  group_id TEXT NOT NULL,
  client_identifier TEXT NOT NULL,
  volume_brl NUMERIC(12, 2),
  quote NUMERIC(12, 4),
  acquired_usdt NUMERIC(12, 2),
  onchain_tx TEXT,
  status TEXT DEFAULT 'pending',
  attempts INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Receipts table (optional - for receipt processing)
CREATE TABLE receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  end_to_end_id VARCHAR(100) UNIQUE NOT NULL,
  valor BIGINT NOT NULL,
  data_hora TIMESTAMPTZ NOT NULL,
  tipo VARCHAR(100),
  recebedor JSONB NOT NULL,
  pagador JSONB NOT NULL,
  raw_file_url VARCHAR(500),
  source_type VARCHAR(10) NOT NULL,
  group_jid VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

See `supabase/migrations/README.md` for detailed instructions.

### 4. Run Development Server

```bash
npm run dev
```

On first run, you'll see a pairing code in the console:

```
{"level":"info","event":"pairing_code","code":"XXXX-XXXX","instructions":"Enter this code in WhatsApp > Linked Devices > Link a Device"}
```

Enter this code in your WhatsApp app to authenticate.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot-reload (tsx watch) |
| `npm run build` | Compile TypeScript to dist/ |
| `npm start` | Run compiled code (production) |
| `npm test` | Run tests once |
| `npm run test:watch` | Run tests in watch mode |

## Development Workflow

### Making Changes

1. **Edit source files** in `src/`
2. **tsx watch** automatically recompiles on save
3. **Write tests** in `*.test.ts` co-located with source
4. **Run tests** with `npm test` before committing

### Code Patterns

#### Result Type (Error Handling)

All services return `Result<T>` instead of throwing:

```typescript
import { ok, err, type Result } from './utils/result.js'

async function doSomething(): Promise<Result<Data>> {
  try {
    const data = await fetch(...)
    return ok(data)
  } catch (e) {
    return err('Operation failed')
  }
}

// Usage
const result = await doSomething()
if (result.ok) {
  console.log(result.data)  // Data
} else {
  console.log(result.error) // string
}
```

#### Structured Logging

Use the logger with event-based format:

```typescript
import { logger } from './utils/logger.js'

logger.info('Operation completed', {
  event: 'operation_completed',
  groupId: '...',
  duration: 123,
})
```

#### State Management

Use the state module for in-memory state:

```typescript
import { getState, setPaused, setRunning, isTrainingMode, setTrainingMode } from './bot/state.js'

// Read state
const state = getState()

// Modify state
setPaused('Binance API failures')
setRunning()

// Training mode
if (isTrainingMode()) {
  // Observe only, don't respond
}
setTrainingMode(true)  // Enable
setTrainingMode(false) // Disable
```

### Adding New Features

#### New Handler

1. Create handler in `src/handlers/newhandler.ts`
2. Add route destination in `src/bot/router.ts`
3. Wire up dispatch in `src/bot/connection.ts`
4. Add tests in `src/handlers/newhandler.test.ts`

#### New Service

1. Create service in `src/services/newservice.ts`
2. Return `Result<T>` types, never throw
3. Add tests in `src/services/newservice.test.ts`
4. Import and use in handlers

#### New Trigger Word

Edit `src/utils/triggers.ts`:

```typescript
export const PRICE_TRIGGER_KEYWORDS = ['preço', 'cotação', 'newtrigger'] as const
```

#### New Control Command

Edit `src/handlers/control.ts`:

1. Add to `ControlCommandType`
2. Add parsing in `parseControlCommand()`
3. Create handler function
4. Add case in `handleControlMessage()`

## Testing

### Run All Tests

```bash
npm test
```

### Run Specific Test

```bash
npx vitest run src/handlers/price.test.ts
```

### Watch Mode

```bash
npm run test:watch
```

### Test Patterns

- Tests are co-located with source (`*.test.ts`)
- Use Vitest `describe`, `it`, `expect`
- Mock external services (Binance, Supabase)

## Production Deployment

### Build

```bash
npm run build
```

### Deploy to VPS

**Quick deploy with rsync (recommended):**

```bash
# Sync, build, and restart in one command
sshpass -p 'OugwCu(RVUex-xbR5(@9' rsync -avz \
  --exclude 'node_modules' --exclude '.git' --exclude '.env' \
  --exclude 'auth_info_baileys' --exclude '*.log' --exclude '.claude' \
  -e ssh ./ root@181.215.135.75:/root/eNorBOT/ && \
sshpass -p 'OugwCu(RVUex-xbR5(@9' ssh root@181.215.135.75 \
  "cd /root/eNorBOT && npm install && npm run build && pm2 restart enorbot"
```

**Manual deploy:**

```bash
# Build locally
npm run build

# Copy to VPS
scp -r dist package.json package-lock.json ecosystem.config.cjs root@181.215.135.75:/root/eNorBOT/

# On VPS
cd /root/eNorBOT
npm ci --omit=dev
pm2 restart enorbot
```

**VPS Details:** See `docs/credentials.md` for host, user, and password.

### PM2 Commands

```bash
pm2 start ecosystem.config.cjs --env production  # Start
pm2 restart enorbot                               # Restart
pm2 stop enorbot                                  # Stop
pm2 logs enorbot                                  # View logs
pm2 logs enorbot --lines 100                      # Last 100 lines
pm2 save                                          # Save process list
pm2 startup                                       # Enable on boot
```

## Control Commands Reference

Send these in the control group (group name must contain `CONTROL_GROUP_PATTERN`):

| Command | Action |
|---------|--------|
| `pause` | Pause all OTC groups |
| `pause groupname` | Pause specific group (fuzzy match) |
| `resume` | Resume all groups + clear error state |
| `resume groupname` | Resume specific group |
| `status` | Show bot status dashboard |
| `training on` | Enable observe-only mode |
| `training off` | Resume normal operations |

## Troubleshooting

### Auth State Lost

If WhatsApp shows "logged out":

1. Clear Supabase session: `DELETE FROM sessions WHERE id = 'default'`
2. Restart bot: `pm2 restart enorbot`
3. Enter new pairing code when prompted

### Supabase Connection Failed

Check `.env` has correct `SUPABASE_URL` and `SUPABASE_KEY`.

The bot will retry with exponential backoff (1s, 2s, 4s, ... up to 5 minutes).

If local backup exists (`auth_state_backup.json`), it will be used as fallback.

### Binance Timeout

The bot retries up to 2 times with 2s delay. If all retries fail:

- Check Binance API status
- Bot will auto-pause after 3 consecutive failures
- Auto-recovery scheduled for 5 minutes
- Or send "resume" in control group

### PM2 Keeps Restarting

Check logs for root cause:

```bash
pm2 logs enorbot --err --lines 200
```

Common causes:
- Missing `.env` file
- Invalid environment variables
- Supabase unreachable

### Training Mode

If the bot isn't responding:
1. Send `status` in control group
2. Check if "Training Mode" is ON
3. Send `training off` to resume normal operations

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Supabase service_role key |
| `PHONE_NUMBER` | Yes | WhatsApp phone (12-15 digits) |
| `CONTROL_GROUP_PATTERN` | No | Control group name pattern (default: CONTROLE) |
| `NODE_ENV` | No | development/production/test |
| `HEALTH_PORT` | No | Health endpoint port (default: 3000) |
| `MS_GRAPH_CLIENT_ID` | No | Azure AD app client ID |
| `MS_GRAPH_CLIENT_SECRET` | No | Azure AD app secret |
| `MS_GRAPH_TENANT_ID` | No | Azure AD tenant ID |
| `EXCEL_SITE_ID` | No | SharePoint site ID |
| `EXCEL_DRIVE_ID` | No | OneDrive/SharePoint drive ID |
| `EXCEL_FILE_ID` | No | Excel file ID or path |
| `EXCEL_WORKSHEET_NAME` | No | Worksheet name (default: Quotes) |
| `EXCEL_TABLE_NAME` | No | Excel table name (default: Table1) |
| `OPENROUTER_API_KEY` | No | OpenRouter API key for OCR |

---

*Documentation generated: 2026-01-27*
*Scan level: Deep*
