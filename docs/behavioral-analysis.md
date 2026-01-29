# OTC Conversation Behavioral Analysis

**Analysis Date:** 2026-01-29
**Data Source:** 256 observations from 6 OTC groups over 2-3 days
**Purpose:** Identify conversation patterns and bot intervention scenarios

---

## Executive Summary

Analysis of 256 message observations reveals a structured OTC transaction ecosystem with predictable conversation flows. The current classifier categorizes 86.3% of messages as "general" due to missing key patterns specific to Brazilian OTC trading.

### Key Findings

1. **"Trava" (Price Lock)** is the primary transaction initiation signal - 14 occurrences undetected
2. **Another bot (Assistente Liqd)** handles purchase registration and balance tracking
3. **English price requests** ("price?", "Tx pls") are not being captured
4. **Operator calculation patterns** follow a consistent format
5. **Multi-group behaviors vary significantly** - one size does not fit all

---

## Ecosystem Players

### Bots Identified

| Bot Name | Function | Commands |
|----------|----------|----------|
| **Assistente Liqd Finance** | Purchase registration, balance tracking | `/compra`, `/saldo`, `/saldof` |
| **eNorBOT** | Price quotes (Binance rate) | Price trigger keywords |

### Player Roles

| Role | Behavior Pattern | Example Players |
|------|------------------|-----------------|
| **Operator** | Sends calculations, rates, tronscan links | OTC eNor/Davi, Daniel Hon, B2T - Renato |
| **Client** | Sends "trava" requests, `/compra` commands | Henequim, Acessoria Digital |
| **Bot** | Automated responses (confirmations, balances) | Assistente Liqd Finance |

---

## Group Behavior Profiles

### 1. OTC Liqd > eNor (143 messages)

**Profile:** High-volume, full-lifecycle transactions

| Pattern | Count | Significance |
|---------|-------|--------------|
| trava | 13 | Price lock requests |
| /compra | 13 | Purchase registrations |
| calculations | 13 | Rate confirmations |
| tronscan | 13 | Transfer confirmations |
| price inquiries | 4 | Rate checks |

**Typical Flow:**
```
Client:   "trava 5000"           → Price lock request
Operator: "5000 * 5.230 = 26,150.00 BRL"  → Rate calculation
Client:   "/compra"              → Register purchase (to Assistente Liqd)
Bot:      "Compra Registrada..." → Confirmation
Operator: [tronscan link]        → USDT transfer proof
```

### 2. OTC enor <> Lumina/max/tms/tmoura/acc (12 messages)

**Profile:** English-speaking clients, price-focused

| Pattern | Count | Notes |
|---------|-------|-------|
| price? | 4 | English price inquiry |

**Typical Flow:**
```
Client:   "price？"    → Price inquiry (English)
Operator: "5199"       → Current rate
Client:   [decision]   → Proceed or wait
```

### 3. OTC enor <> B2T (44 messages)

**Profile:** Complex multi-operation calculations, larger volumes

| Pattern | Count | Notes |
|---------|-------|-------|
| calculations | 5 | Complex multi-line |
| tronscan | 3 | Transfer confirmations |
| confirmations | 4 | Deal closings |

**Typical Flow:**
```
Operator: "145.895,66*5,2145= 760.772,91
           149.081,28*5,1922= 774.059,82
           = 1.534.832,73"
Client:   "Ok"
Operator: [tronscan link]
```

### 4. OTC enor <> Dut Gestão (26 messages)

**Profile:** Balance inquiries, rate-focused

| Pattern | Count | Notes |
|---------|-------|-------|
| calculations | 2 | Rate calculations |
| tronscan | 2 | Transfers |
| price inquiries | 2 | "Tx pls" pattern |

### 5. OTC eNor <> Speeddway (24 messages)

**Profile:** EUR operations, different currency pair

| Pattern | Count | Notes |
|---------|-------|-------|
| confirmations | 4 | Deal closings |
| calculations | 2 | EUR-based |

**Note:** This group deals with EUR→BRL, not USDT→BRL

---

## Missing Classifier Patterns

### High Priority (Must Add)

| Pattern | Current | Should Be | Impact |
|---------|---------|-----------|--------|
| `trava [amount]` | general | **price_lock** (new) | 14 missed |
| `price?` / `Tx pls` | general | **price_request** | 8 missed |
| `[amount] * [rate] = [total]` | general | **quote_calculation** (new) | 22 missed |
| `/compra` | general | **bot_command** (new) | 15 missed |

### Medium Priority (Consider Adding)

| Pattern | Current | Should Be | Impact |
|---------|---------|-----------|--------|
| `Compra Registrada` | general | **bot_response** (new) | ~15 |
| `Saldo Atual` | general | **balance_report** (new) | ~8 |
| `[wallet address]` | general | **wallet_address** (new) | ~5 |
| `fecha` / `Fecha?` | general | confirmation | 3 missed |

---

## Bot Intervention Scenarios

### Scenario 1: Auto-Price Lock Response

**Trigger:** Client sends "trava [amount]" (e.g., "trava 5000")
**Current:** No response (classified as general)
**Proposed:** Bot responds with live calculation

```
Client:   "trava 5000"
eNorBOT:  "5000 × 5.230 = R$ 26,150.00"
```

**Value:** Instant response, no need to wait for human operator

### Scenario 2: Multi-Language Price Request

**Trigger:** Client sends "price?", "price", "tx pls", "taxa"
**Current:** Not detected (English not in triggers)
**Proposed:** Extend trigger patterns

```
Client:   "price？"
eNorBOT:  "USDT/BRL: 5.230 | Compra: 5.180 | Venda: 5.280"
```

### Scenario 3: Thread-Aware Transaction Tracking

**Trigger:** "trava" → calculation → confirmation sequence
**Current:** Thread times out at 5 minutes
**Proposed:** Keep thread open until tronscan or explicit close

**Value:** Complete transaction visibility in observations

### Scenario 4: Balance Integration (Future)

**Trigger:** Integration with Assistente Liqd
**Current:** Separate bots, no coordination
**Proposed:** eNorBOT could read balance updates

### Scenario 5: Group-Specific Behavior

**Trigger:** Different groups have different needs
**Current:** One-size-fits-all
**Proposed:** Per-group configuration

| Group Pattern | Behavior |
|---------------|----------|
| `Lumina/max` | English responses, simple rate |
| `Liqd` | Full calculation format |
| `B2T` | Multi-line calculation support |
| `Speeddway` | EUR mode (disable USDT) |

---

---

## AI-Assisted Classification System

### Architecture

The classification system now uses a hybrid approach:

```
Message → Rules-Based Classification → [If low confidence] → AI Classification → Final Result
```

### Components

| Component | File | Purpose |
|-----------|------|---------|
| **Message Classifier** | `messageClassifier.ts` | Rules-based classification (13 types) |
| **AI Classifier** | `aiClassifier.ts` | OpenRouter Haiku fallback |
| **Classification Engine** | `classificationEngine.ts` | Orchestrates rules + AI |
| **Guardrails Config** | `classificationGuardrails.ts` | Rate limits, cost controls |

### Guardrails

| Guardrail | Value | Purpose |
|-----------|-------|---------|
| Max AI calls/group/min | 10 | Prevent single group abuse |
| Max AI calls/hour global | 100 | Hard cost cap |
| Message max length | 500 chars | Limit token usage |
| Cache TTL | 5 minutes | Avoid redundant calls |
| Confidence threshold | 'low' | Only invoke AI when uncertain |

### Sensitive Data Protection

The following patterns are **NEVER** sent to AI:
- CPF/CNPJ (Brazilian IDs)
- PIX keys (email, phone)
- Passwords/tokens
- Bank account details

### AI Invocation Rules

AI is invoked when:
1. Rules confidence is 'low'
2. Message classified as 'general' BUT has OTC keywords or extracted volume
3. Not a bot message
4. Message length ≥ 3 characters
5. Not emoji-only

AI is **NOT** invoked when:
1. Rules confidence is 'high' or 'medium'
2. Message is from a known bot
3. Contains sensitive data
4. Rate limits exceeded
5. Message type is: receipt, tronscan, bot_command, bot_confirmation

### Cost Estimation

| Scenario | Est. Daily Calls | Est. Daily Cost |
|----------|-----------------|-----------------|
| Low volume | 50 | $0.025 |
| Medium volume | 200 | $0.10 |
| High volume | 500 | $0.25 |

---

## Recommended Implementation Phases

### Phase 1: Classifier Enhancement (Priority: HIGH) ✅ COMPLETE

**New Message Types:**

```typescript
type OTCMessageType =
  // Existing
  | 'price_request'    // "cotação", "preço?"
  | 'price_response'   // Bot's price quote
  | 'volume_inquiry'   // "compro 10k"
  | 'negotiation'      // Counter-offers
  | 'confirmation'     // "fechado", "ok"
  | 'receipt'          // PDF/image
  | 'tronscan'         // Transaction link
  | 'general'          // Unclassified
  // NEW
  | 'price_lock'       // "trava 5000"
  | 'quote_calculation' // "5000 * 5.23 = 26150"
  | 'bot_command'      // "/compra", "/saldo"
  | 'bot_response'     // "Compra Registrada"
  | 'balance_report'   // "Saldo Atual"
  | 'wallet_address'   // TRX/ETH addresses
```

**New Trigger Patterns:**

```typescript
// Price requests (add English)
const PRICE_TRIGGER_KEYWORDS = [
  'preço', 'cotação', 'cotacao', 'quanto tá', 'quanto ta',
  'taxa', 'rate',
  'price', 'price?', 'tx pls', 'tx please'  // NEW: English
]

// Price lock (NEW)
const PRICE_LOCK_PATTERNS = [
  /trava\s*(\d+[.,]?\d*)/i,
  /lock\s*(\d+[.,]?\d*)/i
]

// Confirmation (add "fecha")
const CONFIRMATION_KEYWORDS = [
  'fechado', 'ok', 'vamos', 'feito', 'pode ser', 'beleza',
  'fecha', 'Fecha?', 'fechar agora'  // NEW
]
```

### Phase 2: Auto-Response to Trava (Priority: MEDIUM)

When a "trava [amount]" message is detected:
1. Fetch live Binance rate
2. Calculate BRL total
3. Respond with formatted calculation
4. Track in conversation thread

### Phase 3: Group-Specific Configuration (Priority: LOW)

Add `group_configs` support for:
- Language preference (PT/EN)
- Response format (simple rate vs calculation)
- Currency pair (USDT/BRL, EUR/BRL, etc.)
- Auto-response enabled/disabled

---

## Metrics to Track

### Current Observation Metrics

| Metric | Value | Notes |
|--------|-------|-------|
| Total observations | 256 | 2-3 days |
| Unique groups | 6 | Active OTC groups |
| Price requests detected | 5 | 2% of total |
| General (unclassified) | 221 | 86.3% - too high |

### Target After Enhancement

| Metric | Current | Target |
|--------|---------|--------|
| General (unclassified) | 86.3% | < 40% |
| Price requests | 2.0% | > 5% |
| Price locks | 0% | > 5% |
| Bot commands | 0% | > 5% |

---

## Next Steps

1. **Immediate:** Update `messageClassifier.ts` with new patterns
2. **Short-term:** Add "price_lock" message type with auto-response
3. **Medium-term:** Implement group-specific configuration
4. **Long-term:** Integration with Assistente Liqd bot (if feasible)

---

## Appendix: Sample Conversation Transcript

**Group:** OTC Liqd > eNor
**Date:** 2026-01-27

```
[17:45] Henequim:       trava 7831
[17:45] OTC eNor/Davi:  opa
[17:46] OTC eNor/Davi:  7831 * 5.232 = 40,971.79 BRL
[17:46] Henequim:       trava
[17:46] Henequim:       e manda pf
[17:47] Henequim:       /compra
[17:47] Assistente Liqd: Compra Registrada
                        7831 USDT> 5.2320 > R$40971.79 BRL
[17:47] Assistente Liqd: Saldo Atual
                        60917.25 BRL
[17:48] OTC eNor/Davi:  [tronscan link]
```

---

*Generated by behavioral analysis pipeline - 2026-01-29*
