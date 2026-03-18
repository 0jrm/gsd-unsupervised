---
created: 2026-03-17T20:15:00Z
completed: 2026-03-17
title: P0: Test SMS system (no messages since adding Twilio info)
area: ops
files: []
priority: 1
---

## Problem

Twilio credentials and phone numbers have been configured, but no SMS messages have been received (e.g. goal started / goal complete / goal crashed). Need to verify end-to-end: env vars (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, TWILIO_TO), Twilio API reachability, and that the daemon actually calls sendSms when goals start/complete/fail.

## Solution (implemented)

1. **Env for daemon:** `./run` now sources `.env` inside the tmux daemon pane (`set -a; [ -f .env ] && . ./.env; set +a`) before starting `npx gsd-unsupervised run`, so TWILIO_* are always available to the daemon.
2. **Test SMS command:** `npx gsd-unsupervised test-sms` (or `npm run test:sms` after build) sends a single test SMS. Run from project root so `.env` is loaded by dotenv. Use this to confirm delivery.
3. **Verification:** Run `npm run build && npm run test:sms` from repo root; if you receive the message, notifications are working. If not, check Twilio console (logs, FROM/TO, errors) and that TWILIO_FROM is a valid Twilio number or approved sender.

## If still no messages

Check Twilio console (logs, from/to numbers, errors), verify TWILIO_FROM is a Twilio number or approved sender, and check for rate limits or account restrictions.
