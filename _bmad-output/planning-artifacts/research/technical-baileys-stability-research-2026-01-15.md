# Technical Research: Baileys/WhatsApp Bot Stability

**Research Date:** 2026-01-15
**Project:** enorBOT
**Priority:** #1 Risk - Critical Path

---

## Executive Summary

**Risk Level: HIGH but MANAGEABLE**

WhatsApp's spam detection has become increasingly aggressive, with 6.8 million accounts banned in the first 6 months of 2025. However, structured bots for support/orders/tracking remain explicitly allowed under WhatsApp's policy. The key to survival is:

1. **Proper number warm-up** (10-30 days before production)
2. **Human-like behavior patterns** (chaotic timing, natural message flow)
3. **Conservative message volumes** (<100/day target)
4. **Production-grade session management** (database, not files)

enorBOT's use case (responding to price requests in existing groups) is lower risk than mass outbound messaging, but careful implementation is essential.

---

## Research Findings

### 1. WhatsApp Ban Rates & Detection (Critical)

#### Current Statistics
- **6.8 million accounts** banned in first 6 months of 2025
- **87% of new accounts** get restricted within first 72 hours
- Users report bans **within 2 hours** of improper Baileys usage
- WhatsApp's detection system operates with "military-level scrutiny"

#### What WhatsApp Detects
- Identical message patterns across accounts
- Same device fingerprints
- One-sided conversations (no replies)
- Sudden volume spikes
- Automated timing patterns (regular intervals)
- Mass group joining
- Immediate automation on new numbers

#### Policy Update (January 15, 2026)
WhatsApp is banning **general-purpose AI chatbots**, BUT structured bots for:
- Customer support
- Order management
- Tracking/notifications

**Remain explicitly allowed.** enorBOT falls into the "order management/support" category.

**Sources:**
- [Quackr - WhatsApp Warm-Up Guide 2025](https://quackr.io/blog/warm-up-whatsapp-number/)
- [WhatSnap - Warmup Without Getting Banned](https://whatsnap.ai/blog/warmup-whatsapp-without-getting-banned)
- [GREEN API - Protect Number from Ban](https://green-api.com/en/docs/faq/how-to-protect-number-from-ban/)

---

### 2. Number Warm-Up Strategy (Essential)

#### Timeline
| Phase | Duration | Actions | Message Limit |
|-------|----------|---------|---------------|
| Day 1 | Critical | Profile setup only, no messages | 0 |
| Days 2-4 | Trust building | Receive messages first, then respond | 1-2/day |
| Days 5-7 | Gradual activation | Light two-way conversation | 5-10/day |
| Week 2 | Scaling | Increase engagement | 12-20/day |
| Week 3-4 | Full warm-up | Approach normal usage | 50-100/day |
| After 30 days | Production ready | Green light from WhatsApp | 100-200/day |

#### Day 1 Checklist (Critical)
- [ ] Register with **real SIM card** (not virtual)
- [ ] Set **real profile photo** (no logos/emojis)
- [ ] Use **human name** (not business name initially)
- [ ] Write simple status like "Disponivel"
- [ ] Keep app open 20-30 minutes
- [ ] **DO NOT send any messages**
- [ ] **DO NOT join any groups**

#### Warm-Up Best Practices
1. **Let messages come TO you first** - receive before sending
2. **Small messages > Big messages** - multiple short texts look human
3. **Add contacts slowly** - max 5/day in week 1
4. **Vary timing randomly** - never regular intervals
5. **Get replies** - one-sided messages = spam flag
6. **Different patterns per account** - Meta flags identical behavior

**Sources:**
- [SheetWA - Warm Up New Number Safely](https://sheetwa.com/blogs/warm-up-a-new-whatsapp-number-safely/)
- [WUSeller - Warm-Up Anti-Ban Tactics](https://www.wuseller.com/blog/warm-up-strategy-for-new-whatsapp-business-platform-accounts-anti-ban-tactics/)
- [WaDesk - WhatsApp Warm-Up 2026](https://wadesk.io/en/tutorial/automatic-warm-up-tool-of-whatsapp)

---

### 3. Safe Message Limits

#### Conservative Targets for enorBOT
| Metric | Safe Limit | enorBOT Target |
|--------|------------|----------------|
| New contacts/day (new number) | 20 | 0 (existing groups) |
| New contacts/day (warmed) | 100-200 | 0 (existing groups) |
| Messages/day (new number) | 20-50 | <20 |
| Messages/day (warmed) | 100-200 | <100 |
| Groups joined/day | 3-5 | 0 (already member) |

**enorBOT Advantage:** Operating in existing groups with established relationships significantly reduces risk compared to cold outreach.

---

### 4. Baileys Library Selection

#### @whiskeysockets/baileys vs @arceos/baileys

| Aspect | @whiskeysockets/baileys | @arceos/baileys |
|--------|------------------------|-----------------|
| Status | Community maintained | Optimized fork |
| Dependencies | Includes Jimp (heavy) | Jimp removed (lighter) |
| Stability | More issues reported | Reportedly cleaner |
| Community | Larger | Smaller |

**Recommendation:** Start with `@arceos/baileys` for lighter footprint, monitor stability.

#### Multi-Device API (Only Option)
- Legacy WhatsApp Web API **completely dropped** in Baileys v5
- Multi-device is now the **only supported connection method**
- Requires QR code or Pairing Code authentication
- Does not require Selenium/browser (direct WebSocket)

**Sources:**
- [Baileys Wiki - Connecting](https://baileys.wiki/docs/socket/connecting/)
- [NPM - baileys](https://www.npmjs.com/package/baileys)

---

### 5. Session Persistence (Production Critical)

#### Known Issues
- Sessions disconnect after ~24 hours (Status Code 428)
- Random "Bad Session" logouts reported
- WebSocket connection becomes "unhealthy"
- Reconnection loops possible

#### What NOT To Do
```javascript
// NEVER use in production - Baileys maintainers explicitly warn:
// "DONT EVER USE useMultiFileAuthState IN PROD"
const { state, saveCreds } = await useMultiFileAuthState('auth_info')
```

This function:
- Consumes excessive I/O
- Not designed for reliability
- Only for demo/development purposes

#### Production Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    RECOMMENDED STACK                     │
├─────────────────────────────────────────────────────────┤
│  Hot Cache: Redis                                        │
│  Cold Storage: MongoDB/PostgreSQL                        │
│  Auth State: Custom implementation with BufferJSON       │
│  Session Recovery: Exponential backoff + keep-alive      │
└─────────────────────────────────────────────────────────┘
```

#### Production Auth State Requirements
1. **Always save updated keys** on every message send/receive
2. **Use BufferJSON** for proper binary serialization
3. **Listen to `creds.update` events** and persist immediately
4. **Namespace sessions** for multi-connection support
5. **Implement circuit breaker** for storage failures

#### Recommended Socket Configuration
```javascript
const socketConfig = {
  keepAliveIntervalMs: 30_000,    // 30 seconds (reduced for stability)
  connectTimeoutMs: 60_000,       // 60 seconds
  defaultQueryTimeoutMs: 60_000,  // 60 seconds
  printQRInTerminal: true,
  // ... auth state from database
}
```

**Sources:**
- [Baileys Wiki - useMultiFileAuthState](https://baileys.wiki/docs/api/functions/useMultiFileAuthState/)
- [GitHub - mysql-baileys](https://github.com/bobslavtriev/mysql-baileys)
- [NPM - @luoarch/baileys-store-core](https://www.npmjs.com/package/@luoarch/baileys-store-core)

---

### 6. Reconnection Strategy

#### Handling Disconnections
```javascript
// Reconnect only if NOT logged out
const shouldReconnect =
  (lastDisconnect.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut

if (shouldReconnect) {
  // Exponential backoff: 1s, 2s, 4s, 8s... max 30s
  await delay(Math.min(reconnectAttempt * 1000, 30000))
  reconnect()
}
```

#### Recovery Checklist
- [ ] Implement exponential backoff
- [ ] Store auth state in database (not files)
- [ ] Keep-alive with presence updates every 30 seconds
- [ ] Log disconnect reasons for debugging
- [ ] Alert watchdog system on persistent failures
- [ ] Never auto-reconnect if `loggedOut` reason

**Sources:**
- [GitHub Issue #1625 - Connection Timeout](https://github.com/WhiskeySockets/Baileys/issues/1625)
- [GitHub Issue #1976 - Session Logout](https://github.com/WhiskeySockets/Baileys/issues/1976)

---

### 7. Security Warnings

#### Malicious Package Alert
A fake package called **"lotusbail"** was discovered that:
- Appears as helpful Baileys fork
- Abuses multi-device pairing
- Maintains persistence on compromised accounts
- Steals authentication credentials

**Always verify package authenticity:**
```bash
# Official packages only:
npm install @whiskeysockets/baileys
# OR
npm install @arceos/baileys
```

**Source:** [InfoWorld - WhatsApp API Security Warning](https://www.infoworld.com/article/4111071/whatsapp-api-worked-exactly-as-promised-and-stole-everything-2.html)

---

## Risk Mitigation Matrix for enorBOT

| Risk | Severity | Mitigation | Status |
|------|----------|------------|--------|
| Account ban | HIGH | Warm-up + human patterns | Planned |
| Session loss | MEDIUM | Database auth + watchdog | Planned |
| 24-hour disconnect | MEDIUM | Keep-alive + auto-reconnect | Planned |
| Detection by volume | LOW | <100 msgs/day target | Favorable |
| Detection by pattern | MEDIUM | Chaotic randomizers | Planned |
| Malicious packages | LOW | Use official packages only | Verified |

---

## Implementation Recommendations

### Phase 1: Number Preparation (Week -4 to -1)
1. Acquire dedicated SIM card for bot
2. Register WhatsApp manually on real phone
3. Set up authentic profile
4. Begin 30-day warm-up protocol
5. Have CIO engage in natural conversations from that number

### Phase 2: Development (Week 1-3)
1. Use `@arceos/baileys` as primary library
2. Implement database-backed auth state (MongoDB recommended)
3. Build chaotic timing randomizers
4. Create exponential backoff reconnection
5. Test in isolated environment first

### Phase 3: Soft Launch (Week 4)
1. Deploy to VPS with watchdog
2. Start with ONE group only
3. Monitor for 7 days before expanding
4. Keep message volume very low initially
5. Gradual rollout to additional groups

### Phase 4: Full Production (Week 5+)
1. Enable all target groups
2. Maintain <100 messages/day limit
3. Continuous monitoring via watchdog
4. Weekly log reviews
5. Immediate response to any ban warnings

---

## Conclusion

**Baileys is viable for enorBOT** with proper precautions:

1. **30-day number warm-up is non-negotiable**
2. **Database auth state is mandatory** (not file-based)
3. **Human-like patterns are essential** (chaotic timing)
4. **Conservative volumes minimize risk** (<100/day)
5. **Independent watchdog provides safety net**

The use case (responding to price requests in existing groups) is significantly lower risk than cold outreach or mass messaging. With proper implementation, enorBOT can operate reliably within WhatsApp's acceptable use policies.

---

## Research Sources

### Primary Sources
- [Baileys Official Wiki](https://baileys.wiki/docs/intro/)
- [Baileys GitHub Repository](https://github.com/WhiskeySockets/Baileys)
- [Pally Systems - Baileys Complete Guide](https://blog.pallysystems.com/2025/12/04/whatsapp-automation-using-baileys-js-a-complete-guide/)

### Warm-Up & Anti-Ban
- [Quackr - Warm Up WhatsApp Number 2025](https://quackr.io/blog/warm-up-whatsapp-number/)
- [WhatSnap - Warmup Without Getting Banned](https://whatsnap.ai/blog/warmup-whatsapp-without-getting-banned)
- [SheetWA - Warm Up New Number Safely](https://sheetwa.com/blogs/warm-up-a-new-whatsapp-number-safely/)
- [WaDesk - 5 Strategies to Avoid Ban](https://wadesk.io/en/tutorial/strategies-to-avoid-whatsapp-ban)
- [GREEN API - Protect Number from Ban](https://green-api.com/en/docs/faq/how-to-protect-number-from-ban/)

### Technical Implementation
- [Medium - Automating WhatsApp with Baileys](https://medium.com/@elvisbrazil/automating-whatsapp-with-node-js-and-baileys-send-receive-and-broadcast-messages-with-code-0656c40bd928)
- [GitHub - Baileys 2025 REST API](https://github.com/PointerSoftware/Baileys-2025-Rest-API)
- [GitHub - MySQL Baileys Auth](https://github.com/bobslavtriev/mysql-baileys)

### Alternative Consideration
- [Whapi.Cloud - Baileys Alternative](https://whapi.cloud/best-baileys-whatsapp-alternative)
