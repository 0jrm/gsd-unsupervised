# I Built a Daemon That Runs My AI Coding Agent Overnight While I Sleep

**One-line pitch:** Queue goals in plain text. The daemon runs Cursor’s agent through them, survives crashes, and pings you when something finishes. You get a coding coworker that works while you’re offline.

---

## The problem

Cursor’s agent is great for “do this next” — but the moment you close the laptop or it goes to sleep, everything stops. There’s no “run these five tasks and tell me when you’re done.” So you either babysit the machine or leave work on the table.

## What I built

A small daemon that:

- **Reads a goal queue** — a simple `goals.md` file. One goal per line. No API, no dashboard required to start.
- **Runs Cursor’s agent for you** — it invokes the headless agent, feeds it the right GSD commands (plan this phase, execute this plan), and monitors progress via your project’s `.planning/STATE.md`.
- **Keeps going** — if the agent crashes or times out, the daemon logs it, marks the session, and can resume from the last good phase/plan on the next run.
- **Pings you** — optional Twilio SMS (or later WhatsApp): “Goal started,” “Goal complete,” “Goal crashed.” So you can queue four hours of work, close the laptop, and get a tap on the wrist when it’s done.

That’s the “async coworker” idea: you delegate a chunk of work, you walk away, and you get notified when it finishes or breaks.

## How it works (short)

You run the daemon (e.g. `./run` or `npx gsd-unsupervised start`). It reads your goals, picks the next one, and runs the Cursor agent through the GSD lifecycle (roadmap → plan phase → execute plan). It watches `STATE.md` for progress, writes a session log for crash recovery, and optionally runs a small status server (and ngrok) so you can peek at the dashboard from your phone. If Twilio is configured, you get SMS for started/complete/crashed.

## Try it

- **Self-hosted (free):** Install from npm and run it on your own machine.  
  `npm install -g gsd-unsupervised` then `npx gsd-unsupervised init` in your repo.  
  [npm package](https://www.npmjs.com/package/gsd-unsupervised) · [GitHub](https://github.com/0jrm/gsd-unsupervised)

- **Don’t want to run a process 24/7?** I’m working on a **Pro** tier: push goals via CLI or a small dashboard, they run on a managed runner, and you get the same notifications when things finish. Your agent keeps working while you’re in meetings, asleep, or on vacation. If that’s interesting, [link to your waitlist or paid tier].

## Why it matters

The bottleneck isn’t “one more AI feature” — it’s **continuity**. The daemon is the thing that keeps your goals running when you’re not there. That’s the shift from “tool” to “teammate.”

---

*Draft for HN/Dev Twitter/your blog. Replace the Pro tier link with your actual signup or landing page when you have it.*
