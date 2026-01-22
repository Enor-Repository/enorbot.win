---
stepsCompleted: [step-01-init, step-02-discovery, step-03-success, step-04-journeys, step-05-domain, step-06-innovation, step-07-project-type, step-08-scoping, step-09-functional, step-10-nonfunctional, step-11-polish, step-12-complete]
workflowStatus: complete
inputDocuments:
  - product-brief-eNorBOT-2026-01-15.md
  - technical-baileys-stability-research-2026-01-15.md
  - project-context.md
  - brainstorming-session-2026-01-15.md
workflowType: 'prd'
documentCounts:
  briefs: 1
  research: 1
  projectDocs: 1
  brainstorming: 1
classification:
  projectType: background-service
  domain: fintech
  complexity: high
  projectContext: greenfield
---

# Product Requirements Document - eNorBOT

**Author:** Boss
**Date:** 2026-01-15

---

## Executive Summary

eNorBOT is a WhatsApp automation bot that responds to USDT/BRL price inquiries with real-time Binance rates. It enables Daniel (CIO) to handle overnight requests automatically while maintaining human-like behavior to avoid platform detection. The bot is controlled entirely through a dedicated WhatsApp group.

**Core Value:** Daniel sleeps while the bot works. Clients get instant quotes. No wrong prices ever.

---

## Success Criteria

### User Success (Daniel)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Overnight handling | 10+ requests handled while Daniel sleeps | Morning status check |
| Focus time | Daniel completes negotiations without interruption | Qualitative feedback |
| Trust threshold | Daniel stops manually checking groups | Behavioral observation |
| "Aha!" moment | First morning with overnight activity logged | Day 1 in production |

**Daniel knows it's working when:** He wakes up, checks his phone, sees the bot handled requests while he slept - and the spreadsheet is already updated.

### Business Success

| Timeframe | Milestone | Success Indicator |
|-----------|-----------|-------------------|
| Jan 31, 2026 | MVP Live | Bot running in 1 production group |
| Week 2 | Stability proven | No ban, no wrong prices |
| Month 2 | Scale | Expanded to all 10+ groups |
| Month 3 | Trust | Daniel ignores routine requests |

### Technical Success

| Metric | Target | Criticality |
|--------|--------|-------------|
| Price accuracy | 100% | **ABSOLUTE** - one wrong price = failure |
| Uptime awareness | Bot down noticed within 1 hour | HIGH |
| No ban | 30+ days operation | HIGH |
| Messages/day | <100 | MEDIUM (safety margin) |

### Failure Conditions

| Failure | Severity | Response |
|---------|----------|----------|
| Wrong price sent | **CRITICAL** | Immediate halt, root cause, never repeat |
| Bot down unnoticed >1 hour | HIGH | Improve monitoring, add alerts |
| WhatsApp ban <7 days | HIGH | Review anti-detection, new number strategy |

---

## Product Scope

### MVP - Must Ship (Jan 31)

**Non-negotiable 4:**
1. **Price Response** - Respond to triggers with accurate Binance rate
2. **Pause/Resume** - CIO can stop/start bot from control group
3. **Session Persistence** - Survives VPS restarts (Supabase auth)
4. **Chaotic Timing** - Anti-detection randomized delays and typing simulation

**Should have (Jan 31):**
- Status command
- Spreadsheet logging
- Graceful degradation
- Auto-reconnect
- Control group isolation

### Growth Features (Post-MVP)

- Watchdog system (manual monitoring OK initially)
- Client tagging
- Daily digest
- Human-in-the-loop escalation
- Natural language status

### Vision (Future)

- Memory callbacks
- Idle presence
- Weekly wrapped reports
- Multi-CIO support

---

## User Journeys

### Journey 1: Daniel's Daily Life with eNorBOT (Success Path)

**The Story:**

Daniel wakes up at 7am. Before eNorBOT, he'd groggily check WhatsApp and find a backlog of unanswered "preço" messages from overnight. His stomach would tighten knowing competitors might have already responded.

**Now:**

He checks his phone and sees the control group chat: "Handled 12 requests overnight. Binance group most active." He smiles. The spreadsheet shows every interaction logged - timestamps, clients, quotes given. No complaints in any group.

At 9am, he opens WhatsApp at his desk. "Status" he types. The bot responds: "Active in 10 groups. 5 quotes sent today. All systems normal." He puts the phone down and focuses on a negotiation email.

11am - meeting. His phone buzzes once. He ignores it. The bot handled 3 more requests while he was presenting.

1pm - lunch. Actually eats without interruption.

3pm - a big negotiation. He types "pause Binance group for 30 mins" so he can handle this one personally. After closing the deal, "resume Binance group." The bot picks back up seamlessly.

5pm - "status" one more time. "47 quotes today across all groups. Spreadsheet updated. No issues."

He heads home. The bot keeps working.

**Journey reveals:**
- Status command (activity summary)
- Pause/Resume per group
- Control group isolation
- Spreadsheet auto-logging
- 24/7 operation

---

### Journey 2: Daniel Handles a Bot Error (Edge Case)

**The Story:**

Tuesday, 2:14pm. Daniel's phone buzzes with a control group message:

"⚠️ ERROR: Failed to fetch Binance price. Sent fallback message to Binance group: 'Checking prices, one moment...'"

Daniel checks the Binance group. A client asked "preço" and the bot replied with a human-like stall. No wrong price sent. Good.

30 seconds later, control group: "✅ Recovered. Binance API back. Sent quote: R$5.82"

Daniel exhales. The bot handled it. If it hadn't recovered, he would have jumped in manually. But it did.

**Alternative scenario - Critical failure:**

"🚨 CRITICAL: Unable to recover price source. Bot paused automatically. Manual intervention required."

Daniel immediately types in the Binance group himself: "R$5.82 - sorry for the delay, checking something." He then investigates with the tech team.

**Journey reveals:**
- Graceful degradation (stall message, not wrong price)
- Auto-recovery with retry
- Error notifications to control group
- Auto-pause on critical failure
- Clear escalation path

---

### Journey 3: Whale Appears (Human-in-the-Loop - Post-MVP)

**The Story (Future Tier 2):**

A message appears in the Binance group: "Need quote for 50k USDT"

The bot recognizes this is above the threshold. Control group notification:

"🐋 WHALE ALERT: João in Binance group asking for 50k USDT. Awaiting your response."

Daniel sees it, types directly in Binance group: "João, for that volume let me get you a better rate. Give me 2 minutes."

He handles the negotiation personally, closes the deal. The bot logs the interaction but didn't respond automatically.

**Journey reveals (Post-MVP):**
- Volume threshold detection
- Whale alerts to CIO
- Human-in-the-loop escalation
- Bot stays silent on flagged requests

---

### Journey 4: Tech Team Deployment & Monitoring

**The Story:**

I (the developer) have finished the MVP code. Time to deploy.

**Deployment:**
1. SSH into VPS
2. Pull latest code from repo
3. Run `npm install`
4. Configure environment variables (Supabase URL/Key, Microsoft Graph credentials, Binance API)
5. Start the bot: `npm start`
6. Scan QR code on my phone to authenticate WhatsApp
7. Bot connects, control group receives: "🟢 eNorBOT online"

**Daily Monitoring:**
- Check control group periodically for any error messages
- Glance at VPS process status (pm2 or similar)
- Review spreadsheet for any anomalies
- No news = good news

**Incident Handling:**
- Control group shows: "🔴 Disconnected from WhatsApp"
- I SSH in, check logs
- Bot auto-reconnected? Great. If not:
- Restart process, re-authenticate if needed
- Control group shows: "🟢 Reconnected"
- Post-mortem: why did it disconnect? Improve resilience.

**Journey reveals:**
- Simple deployment process
- QR code authentication
- Status messages to control group
- Log access for debugging
- Auto-reconnect with manual fallback

---

### Journey Requirements Summary

| Journey | Key Capabilities Required |
|---------|--------------------------|
| Daniel Daily | Status, Pause/Resume, Spreadsheet logging, 24/7 operation |
| Bot Error | Graceful degradation, Error notifications, Auto-recovery, Auto-pause on critical |
| Whale (Post-MVP) | Volume detection, Alerts, Human-in-the-loop |
| Tech Team | Simple deploy, QR auth, Status notifications, Logs, Auto-reconnect |

---

## Domain-Specific Requirements

### Platform Compliance (Primary Concern)

**WhatsApp Terms of Service:**
- Bot must appear human-like to avoid detection
- <100 messages/day conservative limit
- No mass messaging, no spam patterns
- Operating in existing groups only (no group joining)
- 30-day number warm-up before production

**Binance API:**
- Public API, no authentication required for spot prices
- Rate limits: 1200 requests/minute (well above our needs)
- No commercial restrictions for price data display

**Excel Online (Microsoft Graph API):**
- OAuth2 app authentication via Azure AD
- No sensitive financial data stored
- Logging only: timestamps, group names, quotes given

### Technical Constraints

| Constraint | Requirement | Rationale |
|------------|-------------|-----------|
| Anti-detection | Chaotic multi-layer randomizers | WhatsApp ban prevention |
| Session security | Supabase auth state, not file-based | Production reliability |
| Price accuracy | Single source (Binance), no caching | Never send wrong price |
| VPS security | Standard hardening, SSH key auth | Protect session credentials |

### Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| WhatsApp ban | Medium | Critical | Anti-detection architecture, warm-up, <100 msgs/day |
| Wrong price sent | Low | Critical | No caching, graceful degradation, auto-pause on API failure |
| Session hijack | Low | High | Secure VPS, Supabase auth, no file-based storage |

---

## Technical Architecture

### System Overview

eNorBOT is a background service that connects to WhatsApp via Baileys, responds to price triggers with live Binance rates, and logs all interactions to Excel Online. The CIO controls everything through a dedicated WhatsApp control group.

### Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Runtime | Node.js 20 LTS | Baileys native support |
| WhatsApp | @arceos/baileys | Lighter fork, better stability |
| Pricing | Binance Public API | USDT/BRL spot price |
| Logging | Excel Online (Microsoft Graph) | Interaction logging |
| State | Supabase (PostgreSQL) | Auth state, config, bot state |
| Hosting | VPS (Hostinger/IONOS) | Always-on, affordable |
| Process | PM2 | Auto-restart, logs |

### Configuration Schema

**Environment Variables:**
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=xxx
MICROSOFT_CLIENT_ID=xxx
MICROSOFT_CLIENT_SECRET=xxx
MICROSOFT_TENANT_ID=xxx
EXCEL_FILE_ID=xxx
CONTROL_GROUP_ID=xxx
```

**Supabase Tables:**
- `auth_state` - WhatsApp session credentials (encrypted)
- `bot_config` - Active groups, triggers, pause status
- `bot_state` - Energy levels, message counts, last activity

### External Integrations

| Integration | Method | Auth | Rate Limit |
|-------------|--------|------|------------|
| WhatsApp | Baileys WebSocket | QR code session | <100 msgs/day (self-imposed) |
| Binance | REST API | None (public) | 1200 req/min |
| Excel Online | Microsoft Graph API | OAuth2 (app) | 10,000 req/10min |
| Supabase | REST/Realtime | API key | Generous |

---

## Project Scoping & Phased Development

### MVP Strategy

**Approach:** Problem-Solving MVP
**Philosophy:** Ship the minimum that lets Daniel sleep without checking WhatsApp.
**Resource:** 1 developer, 16 days (Jan 31 deadline)

### MVP Feature Set (Phase 1) - Jan 31, 2026

**Non-negotiable 4:**

| Feature | Why Non-negotiable |
|---------|-------------------|
| Price Response | Core value - why the bot exists |
| Pause/Resume | CIO control - safety mechanism |
| Session Persistence | Survives restarts - production reliability |
| Chaotic Timing | Anti-ban - survival requirement |

**Should Have (MVP stretch):**

| Feature | Risk if Missing |
|---------|-----------------|
| Status command | Daniel can't check bot health quickly |
| Excel logging | No "aha" moment, no audit trail |
| Graceful degradation | Bot might send wrong price on API error |
| Auto-reconnect | Manual intervention on disconnect |
| Control group isolation | Bot might respond in control group |

**MVP Cut Line:** If deadline pressure, cut in reverse order (isolation → reconnect → degradation → logging → status). Never cut the non-negotiable 4.

### Post-MVP Features (Phase 2)

- Watchdog/health monitoring system
- Client tagging and memory
- Daily digest summaries
- Human-in-the-loop whale escalation
- Natural language status queries

### Vision Features (Phase 3)

- Memory callbacks ("last time you asked...")
- Idle presence simulation
- Weekly wrapped reports
- Multi-CIO support

### Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Excel Online blocks MVP | Fallback to local JSON, add Excel post-MVP |
| Scope creep | Hard line at non-negotiable 4 |
| Timeline slip | Cut should-haves before deadline moves |
| WhatsApp ban early | 30-day warm-up + conservative messaging |

---

## Functional Requirements

### Price Quoting (Core Value)

- FR1: Bot can detect price trigger keywords in monitored group messages
- FR2: Bot can fetch current USDT/BRL spot price from Binance
- FR3: Bot can respond to trigger messages with formatted price quote
- FR4: Bot can format prices in Brazilian Portuguese currency style (R$X,XX)

### CIO Control Interface

- FR5: CIO can pause bot activity for a specific group via control group command
- FR6: CIO can resume bot activity for a paused group via control group command
- FR7: CIO can query bot status to see activity summary
- FR8: Bot can send status notifications to control group (online, offline, errors)
- FR9: Control group messages are never responded to with price quotes

### Session & Connection Management

- FR10: Bot can persist WhatsApp session credentials across restarts
- FR11: Bot can automatically reconnect after connection loss
- FR12: Bot can authenticate via QR code scan on initial setup
- FR13: Bot can detect disconnection state and notify control group

### Anti-Detection Behavior

- FR14: Bot can delay responses with randomized chaotic timing
- FR15: Bot can simulate typing indicator before sending messages
- FR16: Bot can vary response patterns to avoid detection signatures

### Logging & Audit Trail

- FR17: Bot can log each price quote interaction to Excel Online
- FR18: Log entries include timestamp, group name, client identifier, and quote given
- FR19: CIO can review interaction history via Excel spreadsheet

### Error Handling & Safety

- FR20: Bot can detect Binance API failures before responding
- FR21: Bot can send human-like stall message when price unavailable
- FR22: Bot can auto-pause and alert CIO on critical unrecoverable errors
- FR23: Bot can recover and resume automatically when transient errors resolve

---

## Non-Functional Requirements

### Reliability

- NFR1: Bot maintains WhatsApp connection 99%+ of the time (excluding planned restarts)
- NFR2: Session credentials persist across VPS restarts without re-authentication
- NFR3: Bot auto-recovers from transient errors within 60 seconds
- NFR4: Bot notifies control group within 30 seconds of disconnection
- NFR5: Process restarts automatically via PM2 on crash

### Security

- NFR6: WhatsApp session credentials stored encrypted in Supabase
- NFR7: VPS access restricted to SSH key authentication only
- NFR8: Environment variables never logged or exposed in error messages
- NFR9: Microsoft Graph tokens refreshed automatically before expiry

### Integration

- NFR10: Binance API requests complete within 2 seconds or trigger fallback
- NFR11: Excel Online logging tolerates temporary Graph API unavailability (queue locally)
- NFR12: Supabase operations complete within 1 second for state reads/writes
- NFR13: All external API failures logged for debugging

### Operational Performance

- NFR14: Response delay randomization between 3-15 seconds (chaotic timing)
- NFR15: Typing indicator duration between 1-4 seconds before message send
- NFR16: Message throughput capped at <100 messages/day (anti-ban)
- NFR17: Bot startup completes within 30 seconds of process start

