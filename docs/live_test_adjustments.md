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

## Test results
- `npx tsc --noEmit` — 0 errors
- `npx vitest run` — 1704 passed, 0 failed (54 test files)
- 4 test assertions updated to reflect new behavior (router + systemPatternService)
