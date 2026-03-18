# Opportunity Map (by leverage)

Ordered ruthlessly by leverage. Use this to decide what to do next.

---

## Do immediately (low effort, high impact)

### 1. npm publish (today)
Already in goals.md. Zero-leverage sitting on the shelf. Publishing `gsd-unsupervised` makes it:
- Installable in one command
- Discoverable via search
- Signals legitimacy — the difference between a tool and a project.

### 2. Push notifications (already half-built)
- **Current:** Twilio SMS in `notifier.ts`; orchestrator already calls `sendSms()` on goal complete in several code paths.
- **Gap:** Wire **all** session log events to SMS/WhatsApp: **goal started**, **goal complete**, **goal crashed**. Same events, consistent notifications.
- **Value:** "Walk away" value prop. Delegation → tap on the wrist when done. Agent as async coworker.
- **WhatsApp:** Architecture in goals.md (Twilio Sandbox or Baileys); extend to receive commands later.

### 3. Cost tracking per goal
- **Current:** Session log has `durationMs`; `cursor-agent` writes it; result event has `duration_ms`. Status server has `tokens` / `cost` placeholders and dashboard UI for them.
- **Gap:** Add token count (parse from result event stream if available, else estimate from duration/model) and rough cost estimate. Persist per-session or aggregate in session log or state. Surface in `/api/status` and dashboard.
- **Value:** Users see ROI; key metric for a paid tier: "your goals this month cost $X in API calls."

---

## Core differentiators (medium effort, very high impact)

### 4. Goal dependency graph
- **Current:** Goals are a flat queue.
- **Add:** `dependsOn: ["goal-A"]` in goal format. Scheduler respects it; run independent goals in parallel.
- **Value:** Multiplies throughput for backlogs of unrelated tasks. Technical foundation for "teams" (multiple repos, one coordinator).

### 5. Expose as MCP server
- **Idea:** Daemon itself as an MCP tool. Other agents (Claude Code, Cursor) call e.g. `gsd.enqueue_goal("build the auth system")` and get a job ID to poll.
- **Value:** Turns the project from a standalone tool into infrastructure any AI-powered workflow can delegate to. API surface for enterprise.

---

## Monetization

**Core constraint:** The daemon dies when your laptop sleeps.

**Product:** "Your goals keep running while you sleep."

| Tier | Price | What |
|------|--------|------|
| **Free** | $0 | Open source, self-hosted. Everything on npm. Full feature set. Run on your machine. |
| **Pro** | $20–40/mo | Managed cloud execution. Push goals via CLI/dashboard; run on your VPS; notified when done. Wrap daemon in REST API, auth, run on a server. Value: agent works while you're in meetings, asleep, or on vacation. |
| **Team** | $100–200/mo | Multiple repos, shared goal queue, team notifications, audit log. Status server + session log are ~80% of this. |

**Distribution:** Publish to npm (free tier) → one strong blog post (e.g. "I built a daemon that runs my AI coding agent overnight while I sleep") → link to paid tier. Self-hosting moat is weak; convenience moat for "I don't want to set up a VPS" is enough for $20/mo.

---

## Highest-leverage 48-hour move

1. **Ship npm** — publish `gsd-unsupervised`.
2. **Wire SMS notifications** — goal started, goal complete, goal crashed (full coverage from session events).
3. **Write the blog post** — title like above, link to npm and paid tier.

Everything else follows from whether people actually use it.

---

*Last updated: 2026-03-17*
