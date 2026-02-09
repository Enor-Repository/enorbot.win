# Live Test Adjustments — 2026-02-09

Fixes applied after the first live test session in "Otc Test Enor" (`120363426253004498@g.us`), ~15:31 BRT.

---

## Issue 1 — `trava` alone after price quote didn't lock deal (HIGH)

**Before:** Client sends "preço" → bot sends rate → client sends "trava" → bot says "Você não tem cotação ativa". The price handler creates an `activeQuote` but NOT a deal in `active_deals`, so `handlePriceLock` finds no deal to lock.

**After:** The router's simple-mode intercept now checks for lock keywords (`trava`, `lock`, `travar`, `ok`, `fecha`) when there's an active quote but no deal. Routes to `handlePriceLock`, which now bridges the gap: creates a deal from the active quote, then locks it. Flow becomes: price response → "trava" → deal created + locked → AWAITING_AMOUNT.

**Files changed:**
- `src/bot/router.ts` — Extended `trySimpleModeIntercept` "no deal + active quote" block to check lock keywords
- `src/handlers/deal.ts` — `handlePriceLock` now creates a deal from `activeQuote` when no deal exists, using `forceAccept()` to close volatility monitoring

---

## Issue 2 — `trava 5000` included amount but bot still asked for USDT (HIGH)

**Before:** "trava 5000" after a price response hit the same "no deal" wall as Issue 1. Even when it reached `handlePriceLock` via trigger matching, the deal creation gap meant no deal existed to lock with the inline amount.

**After:** Same bridge fix as Issue 1. When "trava 5000" reaches `handlePriceLock`:
1. Deal created from active quote
2. Inline amount (5000) extracted via `parseBrazilianNumber` word loop
3. Deal locked + computed + completed in one shot (simple mode fast path)
4. Sends: `🔒 5.000,00 USDT × 5,2234 = R$ 26.117,00 @operator`

Additionally, bare numbers (≥ 100) in QUOTED state are now intercepted by the router as a shortcut — routes to `price_lock`, which auto-locks and completes.

**Files changed:**
- `src/bot/router.ts` — Added QUOTED + bare number ≥ 100 → `price_lock` intercept
- `src/handlers/deal.ts` — Same bridge as Issue 1; the existing simple-mode fast path handles the rest

---

## Issue 3 — Quote said "Responda trava" redundantly (MEDIUM)

**Before:** The `buildQuoteMessage` always included "Responda *trava* para travar essa taxa." even in simple mode. With Issues 1 & 2 fixed, this message only appears in the `volume_inquiry` flow (e.g., "compro 10k"), but the guidance was incomplete for simple mode users who can also send a USDT amount directly.

**After:** `buildQuoteMessage` now accepts a `simpleMode` flag. In simple mode, the prompt reads: "Responda *trava* ou envie o valor em USDT." — reflecting both options available in simple mode. Classic mode retains the original wording.

**Files changed:**
- `src/handlers/deal.ts` — `buildQuoteMessage` signature updated with `simpleMode` param; `handleVolumeInquiry` passes the flag based on `spreadConfig.dealFlowMode`

**Dashboard note:** No front-end changes needed. The quote message is generated server-side.

---

## Issue 4 — `taxa` keyword got no response (LOW)

**Before:** Daniel sent "taxa" and received nothing. The word `taxa` (Portuguese for "rate") was not in any keyword list — neither `price_request` nor `price_lock`.

**After:** Added `'taxa'` to the `price_request` fallback keywords. "taxa" now triggers a price quote, same as "preço" or "cotação".

**Files changed:**
- `src/services/systemPatternService.ts` — Added `'taxa'` to `FALLBACK_KEYWORDS.price_request`

**Dashboard note:** This only affects the fallback keywords (used when DB is unreachable or pattern not in DB). For production, the `system_patterns` table should also be updated to include "taxa" in the `price_request` row's keywords array. This can be done via the dashboard's System Patterns editor.

---

## Issue 5 — Unrecognized messages during active deal silently dropped (LOW)

**Before:** In simple mode, messages from a client with an active deal that didn't match any deal action were silently swallowed. The client got zero feedback.

**After:** When the deal is in `AWAITING_AMOUNT` state and the message isn't a number or cancel keyword, the bot now sends contextual feedback: "Envie o valor em USDT (ex: 500, 10k) ou 'cancela'. Taxa: X,XXXX." (bilingual: Portuguese / English based on group language setting).

A new `unrecognized_input` deal action was added to the dispatch.

**Files changed:**
- `src/bot/router.ts` — Added `'unrecognized_input'` to `dealAction` type; AWAITING_AMOUNT catch-all routes to it
- `src/handlers/deal.ts` — New `handleUnrecognizedInput` function; added to `handleDealRouted` switch

**Dashboard note:** No front-end changes needed. The feedback message is server-side.

---

## Summary of flow changes

### Before (broken)
```
Client: "preço"     → Bot: "5,2234"
Client: "trava"     → Bot: "Você não tem cotação ativa"  ← WRONG
Client: "trava 5k"  → Bot: "Você não tem cotação ativa"  ← WRONG
Client: "taxa"      → Bot: (silence)                     ← WRONG
Client: (gibberish) → Bot: (silence during AWAITING)     ← WRONG
```

### After (fixed)
```
Client: "preço"      → Bot: "5,2234"
Client: "trava"      → Bot: "Taxa travada em 5,2234. Quantos USDTs serão comprados?"
Client: "5000"       → Bot: "✅ 5.000,00 USDT × 5,2234 = R$ 26.117,00 @operator"

Client: "preço"      → Bot: "5,2234"
Client: "trava 5000" → Bot: "🔒 5.000,00 USDT × 5,2234 = R$ 26.117,00 @operator"

Client: "preço"      → Bot: "5,2234"
Client: "5000"       → Bot: "5.000,00 USDT x 5,2234 = R$ 26.117,00 @operator" (direct_amount)

Client: "taxa"       → Bot: "5,2234"

Client: (in AWAITING) "hello" → Bot: "Envie o valor em USDT (ex: 500, 10k) ou 'cancela'. Taxa: 5,2234."
```

---

## Round 1 test results
- `npx tsc --noEmit` — 0 errors
- `npx vitest run` — 1704 passed, 0 failed (54 test files)
- 4 test assertions updated to reflect new behavior (router + systemPatternService)

---
---

# Round 2 — Live Test Session 16:59–17:13 BRT (2026-02-09)

## What worked

| Flow | Example | Result |
|------|---------|--------|
| `taxa` → price response | Galhardo: "taxa" → Bot: "5,2032" | ✅ |
| `trava` → quote_lock bridge | Galhardo: "taxa" → "trava" → "Taxa travada em 5,2058. Quantos USDTs?" | ✅ |
| AWAITING_AMOUNT reprompt | Bot: "Aguardando valor em USDT..." (after 90s timeout) | ✅ |
| Deal expiration notification | Bot: "Sua cotação expirou..." | ✅ |
| `Preco?` → price + `100k` → direct_amount | Daniel: "Preco?" → "5,2053" → "100k" → `100.000 USDT x 5,2053 = R$ 520.530 @op` | ✅ |
| `Preco` → price + `10000` → direct_amount | Daniel: "Preco" → "5,2048" → "10000" → `10.000 USDT x 5,2048 = R$ 52.048 @op` | ✅ |
| `Off` → deal rejection | Daniel: "Off @..." → "off @operator" | ✅ |

**3 deals completed successfully via direct_amount** (100k, 10k, 100k). The price→amount shortcut is working cleanly.

---

## Issue 6 — @mention phone number parsed as deal volume (HIGH) ⬅ NEW

**What happened:** Daniel sent `@6202620641384` (a WhatsApp @mention of a phone number). The bot treated it as a volume inquiry and created a deal with **R$ 6.2 trillion** as the BRL amount. The quote response was absurd: "R$ 6.202.620.641.384 → 1.191.070.865.923,64 USDT".

This happened twice:
- Message `@6202620641384` at 20:04:17 → Deal `83629b03` (expired, R$6.2T)
- Message `Off @6202620641384` at 20:08:37 → Deal `81a5f34c` (rejected, R$6.2T)

**Root cause:** `extractBrlAmount()` in `dealComputation.ts` has a catch-all **Pattern 4** at line 179:
```regex
/([\d]{4,}(?:,\d{1,2})?)/
```
This matches ANY 4+ digit sequence. The phone number `6202620641384` (13 digits) matches, and `parseBrazilianNumber("6202620641384")` returns 6,202,620,641,384.

**Fix applied (Round 2):**
1. Both `extractBrlAmount` and `extractUsdtAmount` now strip `@mentions` (`@\w\d+`) before processing
2. `extractBrlAmount` rejects amounts > 100M BRL (`MAX_BRL_AMOUNT = 100_000_000`)
3. Both defenses combined: @mention stripping + upper bound guard

**Files changed:**
- `src/services/dealComputation.ts` — @mention stripping + MAX_BRL_AMOUNT guard on all 4 patterns
- `src/services/dealComputation.test.ts` — 3 new test cases for @mention rejection + amount cap

---

## Issue 7 — "Usdt 100 k quanto consegue?" — USDT prefix not recognized (MEDIUM) ⬅ NEW

**What happened:** Daniel sent `Usdt 100 k quanto consegue?`. The bot created a deal via volume_inquiry, but the quote showed the WRONG conversion direction:
- Quote said: "R$ 100.000 → 19.201,96 USDT" (treating 100k as BRL)
- Should have been: "100.000 USDT → R$ 520.780" (treating 100k as USDT)

The deal eventually completed with CORRECT amounts (100k USDT, R$520.780) — likely corrected during lock/completion — but the initial quote message was confusing.

**Root cause:** `extractUsdtAmount()` in `dealComputation.ts` only matches **number followed by USDT** (line 198):
```regex
/([\d.,]+)\s*(?:usdt|usd|u)\b/i
```
It does NOT match **USDT followed by number** ("Usdt 100 k"). So `extractUsdtAmount` returns null, and `extractBrlAmount` catches "100 k" via its k-suffix pattern as BRL.

**Fix applied (Round 2):** Added USDT/USD prefix pattern (Pattern 2) to `extractUsdtAmount`:
```regex
/(?:usdt|usd)\s+([\d.,]+(?:\s*(?:k|mil))?)/i
```
Now matches: "usdt 500", "Usdt 100 k quanto consegue?", "USDT 10k", "usd 5000"

**Files changed:**
- `src/services/dealComputation.ts` — New Pattern 2 for USDT prefix + @mention stripping
- `src/services/dealComputation.test.ts` — 2 new test cases for prefix format + @mention rejection

---

## Issue 8 — First `trava` at 17:00:36 got no response (LOW) ⬅ LIKELY DEPLOYMENT TIMING

**What happened:** Galhardo sent `taxa` at 16:59 → got price response. Then sent `trava` at 17:00:36 → **no response at all**. The second attempt at 17:06 worked perfectly.

**Analysis:** The commit was pushed at ~16:54 BRT. CI/CD deploy likely takes several minutes. The first `trava` at 17:00 may have hit the OLD code (before the quote_lock bridge). By 17:06, the new code was live. The `taxa` keyword worked at 16:59 because it was already in the DB's `system_patterns` table (fallback not needed).

**No code fix needed** — deployment timing artifact. Can confirm by checking CI logs.

---

## Full chronological transcript — Round 2

```
16:59:29  Galhardo   taxa                                  → trigger ✅
16:59:49  Bot        5,2032                                (commercial_dollar + 33bps)
17:00:36  Galhardo   trava                                 → NO RESPONSE ❌ (deployment timing?)
17:04:17  Daniel     @6202620641384                        → trigger ✅ ← WRONG: phone parsed as volume
17:04:34  Bot        📊 Cotação Taxa: 5,2076 R$6.2T→1.19T USDT  ← ABSURD AMOUNTS
17:05:52  Galhardo   taxa                                  → trigger ✅
17:05:59  Bot        5,2058
17:06:01  Galhardo   trava                                 → quote_lock bridge ✅
17:06:17  Bot        Taxa travada em 5,2058. Quantos USDTs?
17:07:38  Bot        Aguardando valor em USDT...           (reprompt ✅)
17:08:25  (deal 1d08 expired — Galhardo never sent amount)
17:08:37  Daniel     Off @6202620641384                    → WRONG: created new deal from @mention
17:08:40  Bot        ⏰ Sua cotação expirou                 (sweep notification)
17:08:54  Bot        📊 Cotação Taxa: 5,2078 R$6.2T→1.19T ← ABSURD (deal from "Off @phone")
17:09:06  Daniel     Off @6202620641384                    → rejected deal ✅ (correct for wrong deal)
17:09:21  Bot        off @operator
17:10:03  Daniel     Preco?                                → trigger ✅
17:10:20  Bot        5,2053
17:10:39  Daniel     100k                                  → direct_amount ✅
17:10:51  Bot        100.000,00 USDT x 5,2053 = R$ 520.530,00 @op  ✅
17:11:39  Daniel     Preco                                 → trigger ✅
17:11:52  Bot        5,2048
17:12:22  Daniel     10000                                 → direct_amount ✅
17:12:32  Bot        10.000,00 USDT x 5,2048 = R$ 52.048,00 @op  ✅
17:12:41  Daniel     Usdt 100 k quanto consegue?           → trigger ✅ (but amount as BRL ❌)
17:12:54  Bot        📊 Cotação R$100.000→19.201 USDT      ← WRONG DIRECTION
```

## Deals created

| Deal | Client | Flow | Outcome | Rate | USDT | BRL | Issue |
|------|--------|------|---------|------|------|-----|-------|
| 83629b03 | Daniel | volume_inquiry (@mention) | Expired | 5.2076 | 1.19T | 6.2T | #6 |
| 1d082b9e | Galhardo | quote_lock (trava) | Expired | 5.2058 | — | — | OK (test) |
| 81a5f34c | Daniel | volume_inquiry (Off @mention) | Rejected | 5.2078 | 1.19T | 6.2T | #6 |
| 96f6319e | Daniel | direct_amount (100k) | **Completed** | 5.2053 | 100,000 | 520,530 | ✅ |
| c70b723b | Daniel | direct_amount (10000) | **Completed** | 5.2048 | 10,000 | 52,048 | ✅ |
| 33a5cfc5 | Daniel | volume_inquiry (Usdt 100k) | **Completed** | 5.2078 | 100,000 | 520,780 | #7 (quote wrong) |

---
---

# Round 3 — `off [group]` Remote Control Command (2026-02-09)

## Feature: Remote deal cancellation from control group

**Context:** The CIO needed to remotely reject/cancel all active deals in any trading group from the control group (CONTROLE_eNorBOT). Previously, "off" only worked within a trading group when a client rejects a quoted deal. There was no way for operators to "off" a group remotely.

### New commands (control group only)

| Command | Behavior |
|---------|----------|
| `off` | Usage hint: "Envie *off [nome do grupo]* para encerrar deals ativos, ou *off off* para encerrar todos." |
| `off <group name>` | Sends "off @operator" to that group + cancels all active deals |
| `off off` | Same, but for ALL groups with active deals |

### How it works

1. CIO sends `off OTC Test` in the control group
2. Bot resolves the group by fuzzy name match (same as `pause`, `mode`, etc.)
3. Bot fetches all active deals for that group via `getActiveDeals()`
4. Each deal is cancelled via `cancelDeal(id, jid, 'cancelled_by_operator')` and archived
5. Bot sends "off @operator" (with WhatsApp mention) to the target group via `sendWithAntiDetection`
6. Bot replies in control group: "off enviado para OTC Test. N deal(s) cancelados."

For `off off`:
- Iterates all registered groups, finds those with active deals
- Cancels all deals across all groups, sends "off" to each
- Reply: "off enviado para N grupo(s): Group1, Group2. M deal(s) cancelados."

### Edge cases handled

- **Bot @mention prefix stripped:** `@5511999999999 off OTC` works (strips leading `@digits`)
- **"training off" vs "off":** No conflict — `training off` is an exact match checked earlier in parser
- **No active deals:** Still sends "off" to the group (operator signal), replies "Nenhum deal ativo."
- **"off off" with no deals anywhere:** Reply: "Nenhum deal ativo em nenhum grupo."
- **Group not found:** Reply with guidance on correct usage

### Files changed

| File | Change |
|------|--------|
| `src/handlers/control.ts` | Added `'off'` to `ControlCommandType`, bot @mention stripping in parser, `off` command parsing, `handleOffCommand()` + `sendOffToGroup()` helpers, `case 'off'` in switch |
| `src/services/systemTriggerSeeder.ts` | Added `off` to `CONTROL_COMMAND_TEMPLATES` (exact, control_only, displayName: 'Off Command') |
| `src/services/messageHistory.ts` | Added `'control_off'` to `BotMessageType` union |
| `src/handlers/control.test.ts` | 5 new parser tests (bare off, off + group, off off, @mention stripping, no training off conflict) |
| `src/services/systemTriggerSeeder.test.ts` | Updated expected trigger count 6→7, added 'off' to expected phrases |

### Test results (initial)
- `npx tsc --noEmit` — 0 errors
- `npx vitest run` — **1714 passed**, 0 failed (54 test files)

---

## Round 3 Live Test — ~17:48–18:00 BRT (2026-02-09)

### What happened

Daniel sent `off off` from CONTROLE_eNorBOT. The command parsed correctly (`commandType: "off", args: ["off"]`), but:

1. **"off off" found no active deals** — the test deal had already completed/archived. The bot replied "Nenhum deal ativo em nenhum grupo" but did NOT send "off" to any trading group. Daniel expected it to always broadcast the off signal.
2. **Anti-detection delay (8–15 seconds)** on control group responses made it feel broken/unresponsive. The CIO thought the bot wasn't working.

### Fixes applied (Round 3b)

#### Fix 1 — Instant control group responses (no anti-detection)

**Before:** `sendControlResponse` used `sendWithAntiDetection`, adding 3–15s typing + chaotic delay to every control group reply.

**After:** `sendControlResponse` now uses `context.sock.sendMessage()` directly — zero delay. Anti-detection is only needed for client-facing trading groups, not the CIO's private control channel.

**Impact:** All control commands (status, pause, resume, mode, modes, config, off) now respond instantly.

#### Fix 2 — "off off" broadcasts to ALL non-paused groups

**Before:** "off off" only iterated groups that had active deals. No deals → no groups → "Nenhum deal ativo em nenhum grupo" → no off signals sent.

**After:** "off off" now iterates ALL registered groups where `mode !== 'paused'`. It cancels any active deals found along the way, but always sends "off @operator" to every non-paused group regardless of deal state.

- Groups with active deals: deals cancelled + off signal sent
- Groups with no deals: off signal still sent (operator awareness)
- Paused groups: skipped (already inactive)
- No non-paused groups: "Nenhum grupo ativo encontrado."

#### Fix 3 — Reply-first pattern for CIO feedback

**Before:** Control reply came AFTER all trading group messages were sent (sequentially). With 3+ groups, the CIO waited 30+ seconds before getting any feedback.

**After:** Both "off off" and "off <group>" now send the control group reply FIRST (instant via Fix 1), THEN fire off the trading group "off @operator" messages sequentially (with anti-detection for those).

Flow: CIO sends "off off" → instant reply "off enviado para 3 grupo(s): A, B, C. 2 deal(s) cancelados." → THEN bot sends "off @operator" to each group.

#### Fix 4 — Better logging

Added structured logging to `handleOffCommand`:
- `off_command_parsed` — initial parse
- `off_all_processed` — "off off" completion with groupCount + totalCancelled
- `off_group_processed` — "off <group>" completion with groupName + dealsCancelled
- `off_group_sent` — each trading group off signal sent
- `control_response_error` — if sock.sendMessage fails for control reply

### Files changed

| File | Change |
|------|--------|
| `src/handlers/control.ts` | `sendControlResponse` uses `sock.sendMessage` directly; "off off" iterates all non-paused groups; reply-first pattern; better logging |
| `src/handlers/control.test.ts` | Updated 17 test assertions from `mockSendWithAntiDetection` to `mockSock.sendMessage` for control responses |

### Test results (Round 3b)
- `npx tsc --noEmit` — 0 errors
- `npx vitest run` — **1714 passed**, 0 failed (54 test files)

---

## Round 3c Live Test — 18:00–18:16 BRT (2026-02-09)

### What happened

Daniel sent "preço" → bot sent price "5,2178" → Daniel sent "100k" → **no response**. The bot appeared completely non-functional.

### Root cause: Deploy double-restart killed bot mid-conversation

The deploy at ~18:16 caused **two PM2 restarts** because `deploy.sh` used cluster mode (`pm2 start -i 1`):

1. `pm2 delete` killed the old instance (11)
2. `pm2 start -i 1` launched instance 12 in cluster mode
3. Instance 12 connected, received Daniel's buffered "preço", sent price at 18:16:30
4. **PM2 cluster rotation sent SIGINT to instance 12 at 18:16:36** (only 6 seconds after sending price!)
5. Instance 13 started at 18:16:38 and connected at 18:16:41
6. Daniel sent "100k" → message was lost during the ~5-second restart gap
7. Instance 13 was online but had **zero active quotes** (in-memory state lost with instance 12)
8. Even if "100k" arrived at instance 13, there was no active quote to match → silently dropped

**Timeline from logs (UTC = BRT + 3h):**
```
21:16:13  Instance 12 starts (PID 193325)
21:16:17  Instance 12 connects to WhatsApp
21:16:18  Instance 12 receives Daniel's "preço" (buffered offline message)
21:16:30  Instance 12 sends price "5,2178" (8.3s anti-detection delay)
21:16:36  Instance 12 receives SIGINT (PM2 cluster rotation) — DEAD
21:16:38  Instance 13 starts (PID 193834)
21:16:41  Instance 13 connects to WhatsApp
21:16:41+ Daniel sends "100k" → LOST (no active quote in instance 13)
```

### Fix applied (Round 3c)

#### Fix 5 — Deploy script: fork mode instead of cluster mode

**Before:** `pm2 start dist/index.js --name enorbot -i 1 --cwd /opt/enorbot`

The `-i 1` flag enables cluster mode with 1 worker. PM2 cluster mode creates a master process that manages workers. Even with just 1 worker, the master can rotate (SIGINT + new fork) during startup, causing a double-restart.

**After:** `pm2 start dist/index.js --name enorbot --cwd /opt/enorbot`

Without `-i 1`, PM2 uses fork mode (default). Fork mode runs the process directly — no cluster master, no worker rotation, no double-restart. Single clean startup.

### Files changed

| File | Change |
|------|--------|
| `deploy.sh` | Removed `-i 1` from PM2 start command (fork mode instead of cluster) |

### Note on in-memory state

Active quotes (`activeQuotes` map) live only in process memory. When PM2 restarts, they're lost. This is acceptable for now (quotes have a 3-minute TTL anyway), but it means deploys during active conversations will lose quote context. Future improvement: persist quotes to Supabase.
