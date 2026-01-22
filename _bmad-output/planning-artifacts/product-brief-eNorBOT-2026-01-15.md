---
stepsCompleted: [1, 2, 3, 4, 5]
inputDocuments:
  - brainstorming-session-2026-01-15.md
  - technical-baileys-stability-research-2026-01-15.md
date: 2026-01-15
author: Boss
---

# Product Brief: eNorBOT

## Executive Summary

**eNorBOT** brings automation to a market that's still in the stone age.

While competitors manually check prices and type responses, eNorBOT answers USDT/BRL quote requests instantly - 24/7, across 10+ WhatsApp groups. It frees eNor's CIO from grunt work so he can focus on deals that actually need his expertise.

The bot responds to price triggers ("preço", "cotação", "quanto") with real-time Binance rates, logs all interactions to Google Sheets, and looks human enough to avoid WhatsApp's ban systems. The CIO controls everything from his phone through natural language: "pause", "status", "tell me about João."

**The pitch:** "While our competitors are still typing, we've already responded."

---

## Core Vision

### Problem Statement

eNor's CIO monitors 10+ WhatsApp groups, fielding 12+ price requests daily. This is necessary work - but work that shouldn't occupy a CIO's time. When he's busy or offline, opportunities evaporate. Competitors who respond faster win deals.

The entire OTC crypto market in Brazil is still manual. The fastest human wins.

### Problem Impact

- **Lost revenue:** Unanswered requests = lost deals to faster competitors
- **CIO bottleneck:** High-value executive stuck on low-value tasks
- **Zero coverage:** No responses outside CIO's active hours
- **No institutional memory:** Client patterns live only in the CIO's head

### Why Existing Solutions Fall Short

- **Manual process:** Doesn't scale, creates single point of failure
- **Generic chatbots:** Get banned by WhatsApp within hours
- **More staff:** Expensive, still human-speed limited
- **Off-the-shelf tools:** Don't integrate with Binance/Sheets workflow

### Proposed Solution

eNorBOT gives the CIO superpowers:

1. **Instant Response:** Answers price requests in seconds, 24/7
2. **Human-Like Behavior:** Chaotic timing that looks human to WhatsApp
3. **Control via Chat:** Natural language commands in a dedicated WhatsApp group
4. **Client Intelligence:** Tracks interactions, tags clients, surfaces patterns
5. **Graceful Failures:** Self-healing, watchdog alerts, never fails silently

### Key Differentiators

| What We Say | What It Means |
|-------------|---------------|
| First-mover automation | Only automated player in a 100% manual market |
| Built to last | Survives where other bots get banned in hours |
| CIO superpowers | Manage everything via WhatsApp - no apps, no dashboards |
| Client intelligence | Bot remembers what you'd forget |
| Human-in-the-loop | You stay in control of deals that matter |

---

## Target Users

### Primary User: Daniel (CIO)

**Profile:**
- **Role:** Chief Investment Officer at eNor
- **Experience:** 5 years in OTC crypto markets
- **Peak Hours:** 9am-5pm BRT (Brazilian business hours)

**Current Reality:**
Daniel is trapped. Every time someone types "preço" in one of his 10+ WhatsApp groups, he stops what he's doing, checks Binance, calculates the rate, and responds. This happens 12+ times per day. He's always answering price requests whenever they come - it's become a reflex that fragments his attention.

He maintains the Google Sheets manually, tracking deals and client interactions. He knows his clients' behaviors by memory - who accepts wider spreads, who needs firm prices. But this institutional knowledge lives only in his head.

**What He Should Be Doing:**
- Closing larger deals that require negotiation
- Building relationships with high-value clients
- Strategic planning and market analysis
- Actually being a CIO, not a quote machine

**Success Vision:**
Daniel checks his phone and sees the bot handled 15 price requests overnight. He asks "status" and gets a summary. A whale appears in the Binance group asking for 50k USDT - the bot pings him for escalation. He closes the deal while the bot continues handling routine requests. At 5pm, he gets a daily digest. His clients get faster service, and he finally has time to think.

**"Aha!" Moment:**
The first morning Daniel wakes up, checks his phone, and sees the bot handled requests while he slept - and no one complained, no deals were lost, and the spreadsheet is already updated.

---

### Secondary Users

#### Institutional Clients

**Profile:**
All clients are institutional (B2B) - no retail. They operate in WhatsApp groups to request USDT/BRL quotes for OTC trades.

**Two Behavioral Segments:**

| Segment | Behavior | Bot Approach |
|---------|----------|--------------|
| **Firm Price Clients** | Only accept exact quotes, no negotiation | Standard response, escalate if they push back |
| **Flexible Clients** | Accept spreads, don't mind extra bps | Can receive slightly adjusted quotes |

**Client Intelligence:**
Daniel can fill a behavioral report for each client, tagging them with notes like "firm prices only" or "accepts wider spreads." The bot uses this to inform responses and escalation decisions.

**Client Experience:**
- **Before:** Wait for Daniel to be available, responses vary by his workload
- **After:** Instant quotes 24/7, consistent response quality, same "person" always available

---

#### Tech Team (System Maintainer)

**Profile:** The developer who builds and maintains eNorBOT.

**Responsibilities:**
- Initial setup and deployment
- Monitoring via watchdog system
- Troubleshooting and updates
- Adding new features per CIO requests

**Interaction:** Primarily through code, logs, and watchdog alerts - not through the WhatsApp interface.

---

#### CEO (Stakeholder)

**Profile:** eNor's CEO - cares that this works, but not a direct user.

**Success Metric:** Hears from Daniel that the bot is working, sees faster client response times, no complaints about missed quotes.

---

### User Journey: Daniel's Day with eNorBOT

| Time | Before eNorBOT | After eNorBOT |
|------|----------------|---------------|
| **7am** | Wakes up to backlog of unanswered "preço" messages | Wakes up, bot handled 3 overnight requests |
| **9am** | Starts work, immediately fielding price requests | Checks "status" - bot already active, 5 quotes sent |
| **11am** | In a meeting, misses 4 price requests | Bot handles routine quotes, pings for 50k+ whale |
| **1pm** | Lunch interrupted by "preço" notifications | Lunch in peace, bot on duty |
| **3pm** | Trying to close big deal, distracted by routine requests | Focuses on negotiation, bot handles the noise |
| **5pm** | Exhausted from context-switching all day | Gets daily digest, reviews client activity |
| **10pm** | Feels guilty about not responding to late request | Bot responded at 10:03pm, client happy |

**The Transformation:**
Daniel goes from being a quote machine to being a CIO who happens to have a quote machine working for him.

---

## Success Metrics

### Primary Success Criterion

**The system works this month.**

By January 31, 2026, eNorBOT must be:
- Responding to price requests in at least one production group
- Running stable without WhatsApp ban
- Logging interactions to Google Sheets
- Controllable by Daniel via the control group

Everything else is secondary until this is achieved.

---

### MVP Success Checklist (January 2026)

| Milestone | Target Date | Success Criteria |
|-----------|-------------|------------------|
| WhatsApp connection stable | Jan 20 | Bot stays connected 24+ hours |
| Price response working | Jan 22 | Responds to "preço" with Binance rate |
| CIO control operational | Jan 25 | Pause/resume/status commands work |
| Spreadsheet logging | Jan 28 | All interactions recorded |
| **Production launch** | Jan 31 | Running in at least 1 live group |

---

### Operational Metrics (Post-Launch)

Once live, track:

| Metric | Target | Why It Matters |
|--------|--------|----------------|
| Uptime | >95% | Bot must be reliable |
| No ban | 30+ days | Proves anti-detection works |
| Response accuracy | 100% | Never send wrong price |
| Messages/day | <100 | Stay within safe limits |

---

### Business Objectives (3-6 Month Horizon)

**After MVP is stable:**

| Timeframe | Objective |
|-----------|-----------|
| Month 2 | Expand to all 10+ groups |
| Month 3 | Daniel trusts bot enough to ignore routine requests |
| Month 6 | Tier 2 features (client tagging, daily digest) |

---

### User Success (Daniel's Perspective)

**Daniel knows it's working when:**
- He wakes up and the bot handled overnight requests
- He can focus on a negotiation without interruption
- He checks "status" and sees activity he didn't have to do
- The CEO asks "how's the bot?" and Daniel says "it just works"

---

### The Real Metric

> **"It works, and Daniel trusts it."**

Everything else follows from this.

---

## MVP Scope

### Core Features (January 31, 2026)

| Feature | Description | Success Criteria |
|---------|-------------|------------------|
| **Price Response** | Respond to "preço", "cotação", "quanto", "rate" with live Binance USDT/BRL rate | Accurate price within 30 seconds |
| **Chaotic Timing** | Multi-layer randomizers (energy level + attention span + micro-hesitation) | Looks human, no patterns |
| **Typing Cadence** | Simulate typing duration before sending | Typing indicator matches response length |
| **Control Group** | Dedicated WhatsApp group for CIO-only commands | Commands never leak to client groups |
| **Pause/Resume** | "Pause" stops all responses, "I'm back" resumes | Immediate effect |
| **Status Command** | "Status" returns activity summary | Shows requests handled, groups active |
| **Spreadsheet Logging** | Write every interaction to Google Sheets | Timestamp, group, client, quote, response |
| **Graceful Degradation** | Human-like error messages when Binance API fails | "Checking prices, one moment..." then fallback |
| **Auto-Reconnect** | Exponential backoff on WhatsApp disconnect | Reconnects without manual intervention |
| **Session Persistence** | Database-backed auth state (MongoDB) | Survives VPS restarts |

---

### Out of Scope for MVP

| Feature | Reason for Deferral | Target Tier |
|---------|---------------------|-------------|
| Watchdog system | Manual monitoring acceptable initially | Tier 1.5 |
| Client tagging | Not essential for "it works" | Tier 2 |
| Daily digest | Nice to have | Tier 2 |
| Human-in-the-loop escalation | Adds complexity | Tier 2 |
| Natural language status | Basic "status" works for MVP | Tier 2 |
| Memory callbacks | Future delight feature | Tier 3 |
| Idle presence (emoji reactions) | Future delight feature | Tier 3 |
| Weekly wrapped reports | Future delight feature | Tier 3 |

---

### MVP Success Criteria

**The MVP is successful when:**

1. Bot responds to price requests accurately in at least 1 production group
2. Daniel can pause/resume/status from control group
3. All interactions logged to Google Sheets
4. No WhatsApp ban after 7 days of operation
5. Bot auto-recovers from disconnections without manual intervention

**Go/No-Go Decision Point:**

After 7 days in production:
- If stable and Daniel trusts it → Expand to all 10+ groups
- If issues arise → Fix before expansion

---

### Future Vision

**Month 2-3: Impress Daniel**
- Human-in-the-loop escalation for large trades (50k+ USDT)
- Client tagging system with behavioral notes
- Daily digest summaries
- Independent watchdog system

**Month 4-6: Delight**
- Memory callbacks ("Rate moved since you last checked")
- Natural language status reports ("How's it going?")
- Weekly wrapped reports
- Milestone celebrations

**Long-term:**
- Multi-CIO support for other eNor team members
- Template library for different response styles
- Analytics dashboard (if requested)
- Potential licensing to other OTC desks
