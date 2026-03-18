# I Built a Daemon That Runs My AI Coding Agent Overnight While I Sleep

**One-line pitch:** Queue goals in plain text. The daemon runs Cursor's agent through them, survives crashes, and pings you when something finishes. You get a coding coworker that works while you're offline.

---

## The problem

Cursor's agent is great for "do this next" — but the moment you close the laptop or it goes to sleep, everything stops. There's no "run these five tasks and tell me when you're done." So you either babysit the machine or leave work on the table.

## What I built

A small daemon that:

- **Reads a goal queue** — a simple `goals.md` file. One goal per line. No API, no dashboard required to start.
- **Runs Cursor's agent for you** — it invokes the headless agent, feeds it the right GSD commands (plan this phase, execute this plan), and monitors progress via your project's `.planning/STATE.md`.
- **Keeps going** — if the agent crashes or times out, the daemon logs it, marks the session, and can resume from the last good phase/plan on the next run.
- **Pings you** — optional Twilio SMS: "Goal started," "Goal complete," "Goal crashed." So you can queue four hours of work, close the laptop, and get a tap on the wrist when it's done.

That's the "async coworker" idea: you delegate a chunk of work, you walk away, and you get notified when it finishes or breaks.

## Try it in 2 minutes

```bash
git clone https://github.com/0jrm/gsd-unsupervised
cd gsd-unsupervised && npm install
cd your-project && ./setup.sh
echo "- [ ] Add auth to my app" >> goals.md
./run
```

That's it. The daemon reads goals, invokes your agent, and SMSes you when done (if Twilio is configured).

## What's working right now

- **Multi-agent support** — Cursor, Claude Code, Continue (cn), Gemini CLI, Codex
- **SMS notifications** via Twilio (goal started / complete / crashed)
- **Crash recovery** — resumes from last known-good plan on restart
- **Status server** at localhost:3000
- **Configurable** via goals.md (plain text queue) and .planning/config.json

## Don't want to run a process 24/7?

If you want a hosted version where goals keep running even when your laptop sleeps, reply to this post or open an issue — I'm gauging interest.

## Why it matters

The bottleneck isn't "one more AI feature" — it's **continuity**. The daemon is the thing that keeps your goals running when you're not there. That's the shift from "tool" to "teammate."

---

*Ready for HN / dev.to*
