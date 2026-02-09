#!/usr/bin/env bash
#
# eNorBOT Production Deployment Script
# Builds locally, syncs to VPS, restarts PM2 with correct cwd.
#
# Usage:
#   ./deploy.sh          # Full deploy (bot + dashboard)
#   ./deploy.sh bot      # Bot only (skip dashboard build)
#   ./deploy.sh dash     # Dashboard only (skip bot build)
#
set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================
VPS_HOST="root@181.215.135.75"
VPS_PATH="/opt/enorbot"
SSH_KEY="$HOME/.ssh/hostinger_vps"
PM2_NAME="enorbot"
HEALTH_URL="http://localhost:3000/api/status"
SSH="ssh -i $SSH_KEY -o ConnectTimeout=10"
RSYNC="rsync -az --delete -e \"ssh -i $SSH_KEY\""

LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-full}"

# ============================================================================
# Helpers
# ============================================================================
info()  { echo -e "\033[1;34m[deploy]\033[0m $1"; }
ok()    { echo -e "\033[1;32m[deploy]\033[0m $1"; }
fail()  { echo -e "\033[1;31m[deploy]\033[0m $1"; exit 1; }

# ============================================================================
# Step 1: Pre-flight checks
# ============================================================================
info "Pre-flight checks..."

# Verify SSH connectivity
$SSH $VPS_HOST "echo ok" >/dev/null 2>&1 || fail "Cannot reach VPS — check SSH key and host"

# Verify local project
[[ -f "$LOCAL_DIR/package.json" ]] || fail "Not in eNorBOT project root"
[[ -f "$LOCAL_DIR/tsconfig.json" ]] || fail "Missing tsconfig.json"

ok "Pre-flight passed"

# ============================================================================
# Step 2: Run tests
# ============================================================================
info "Running tests..."
cd "$LOCAL_DIR"
npx vitest run --reporter=dot 2>&1 | tail -5
if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
  fail "Tests failed — aborting deploy"
fi
ok "All tests passed"

# ============================================================================
# Step 3: Build bot (TypeScript → dist/)
# ============================================================================
if [[ "$MODE" == "full" || "$MODE" == "bot" ]]; then
  info "Building bot (tsc)..."
  npx tsc || fail "TypeScript compilation failed"
  ok "Bot build complete"
fi

# ============================================================================
# Step 4: Build dashboard (Vite → dist/dashboard/)
# ============================================================================
if [[ "$MODE" == "full" || "$MODE" == "dash" ]]; then
  info "Building dashboard (vite)..."
  # Source backend .env to get DASHBOARD_SECRET for the Vite build
  if [[ -f "$LOCAL_DIR/.env" ]]; then
    DASH_SECRET=$(grep '^DASHBOARD_SECRET=' "$LOCAL_DIR/.env" | cut -d= -f2-)
    if [[ -n "$DASH_SECRET" ]]; then
      export VITE_DASHBOARD_SECRET="$DASH_SECRET"
      info "Injected VITE_DASHBOARD_SECRET from .env"
    else
      fail "DASHBOARD_SECRET not set in .env — dashboard auth will fail in production"
    fi
  else
    fail ".env file not found — cannot inject DASHBOARD_SECRET"
  fi
  cd "$LOCAL_DIR/dashboard"
  npx vite build --outDir ../dist/dashboard 2>&1 | tail -3
  if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
    fail "Dashboard build failed"
  fi
  cd "$LOCAL_DIR"
  ok "Dashboard build complete"
fi

# ============================================================================
# Step 5: Sync dist/ to VPS
# ============================================================================
info "Syncing dist/ to VPS..."
# Always sync backend code (includes dist/dashboard/*.js — Express server files)
# Only exclude Vite frontend assets when in bot-only mode
if [[ "$MODE" == "bot" ]]; then
  eval $RSYNC \
    --exclude='dashboard/assets' \
    --exclude='dashboard/index.html' \
    "$LOCAL_DIR/dist/" \
    "$VPS_HOST:$VPS_PATH/dist/" 2>&1 | tail -3
elif [[ "$MODE" == "dash" ]]; then
  eval $RSYNC \
    "$LOCAL_DIR/dist/dashboard/" \
    "$VPS_HOST:$VPS_PATH/dist/dashboard/" 2>&1 | tail -3
else
  eval $RSYNC \
    "$LOCAL_DIR/dist/" \
    "$VPS_HOST:$VPS_PATH/dist/" 2>&1 | tail -3
fi

# Sync package.json, package-lock.json, ecosystem.config.cjs
eval $RSYNC \
  "$LOCAL_DIR/package.json" \
  "$LOCAL_DIR/package-lock.json" \
  "$LOCAL_DIR/ecosystem.config.cjs" \
  "$VPS_HOST:$VPS_PATH/" 2>&1 | tail -3

ok "Sync complete"

# ============================================================================
# Step 6: Install dependencies on VPS (if package.json changed)
# ============================================================================
info "Installing VPS dependencies..."
$SSH $VPS_HOST "cd $VPS_PATH && npm ci --omit=dev --ignore-scripts" || fail "npm ci failed on VPS — node_modules may be wiped. Check git SSH access."
ok "Dependencies up to date"

# ============================================================================
# Step 7: Restart PM2 with explicit cwd
# ============================================================================
info "Restarting PM2..."
$SSH $VPS_HOST "
  pm2 delete $PM2_NAME 2>/dev/null || true
  cd $VPS_PATH && pm2 start dist/index.js --name $PM2_NAME --cwd $VPS_PATH
  pm2 save
" 2>&1 | grep -E 'Done|online|saved'
ok "PM2 restarted"

# ============================================================================
# Step 8: Health check (wait up to 15 seconds)
# ============================================================================
info "Waiting for health check..."
for i in $(seq 1 15); do
  RESULT=$($SSH $VPS_HOST "curl -sf $HEALTH_URL 2>/dev/null" || true)
  if echo "$RESULT" | grep -q '"status":"ok"'; then
    ok "Health check passed (${i}s)"
    break
  fi
  if [[ $i -eq 15 ]]; then
    fail "Health check failed after 15s — check logs: ssh $VPS_HOST 'pm2 logs $PM2_NAME --lines 30 --nostream'"
  fi
  sleep 1
done

# ============================================================================
# Step 9: Verify PM2 stability (no restart loops)
# ============================================================================
info "Verifying PM2 stability..."
sleep 3
RESTARTS=$($SSH $VPS_HOST "pm2 jlist 2>/dev/null | python3 -c \"import sys,json; procs=json.load(sys.stdin); print(next((p['pm2_env']['restart_time'] for p in procs if p['name']=='$PM2_NAME'), -1))\"" 2>/dev/null || echo "-1")
if [[ "$RESTARTS" -gt 0 ]]; then
  fail "Bot restarted ${RESTARTS} times — possible crash loop. Check: ssh $VPS_HOST 'pm2 logs $PM2_NAME --lines 50 --nostream'"
fi
ok "PM2 stable (0 restarts)"

# ============================================================================
# Done
# ============================================================================
echo ""
ok "Deploy complete! Bot running at $VPS_HOST:$VPS_PATH"
echo "  Dashboard: https://enorbot.win"
echo "  Logs:      ssh -i $SSH_KEY $VPS_HOST 'pm2 logs $PM2_NAME --lines 30 --nostream'"
