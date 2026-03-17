---
phase: 3
plan: 1
subsystem: stream-events
tags: [tdd, parser, ndjson, zod, cursor-agent]
requires: [zod]
provides: [parseEvent, extractSessionId, extractResult, CursorStreamEvent]
affects: [cursor-agent-integration, stream-processing]
tech-stack: [typescript, zod, vitest]
key-files: [src/stream-events.ts, src/stream-events.test.ts, vitest.config.ts]
key-decisions:
  - Zod discriminatedUnion on 'type' field for event dispatch
  - passthrough on all schemas to tolerate unknown fields
  - parseEvent returns null on any failure (no exceptions)
duration: ~8 minutes
completed: 2026-03-16
---

# 03-01 SUMMARY: NDJSON Stream Event Parser

## Performance

- **Duration:** ~8 minutes
- **Start:** 2026-03-16T20:26:00Z
- **End:** 2026-03-16T20:28:30Z
- **Tasks:** 3 (RED, GREEN, REFACTOR — refactor was no-op)
- **Files modified:** 4 (stream-events.ts, stream-events.test.ts, vitest.config.ts, package.json)

## RED Phase

### Tests Written (15 total)

**parseEvent — 5 event types:**
1. SystemInitEvent — parses init with session_id, model, cwd, apiKeySource, permissionMode
2. AssistantEvent — parses message with role and content blocks
3. ToolCallEvent (started) — parses with subtype, call_id, tool_call name
4. ToolCallEvent (completed) — parses completed subtype variant
5. ResultEvent — parses with duration_ms, duration_api_ms, is_error, result

**parseEvent — 4 edge cases:**
6. Malformed JSON → returns null
7. Empty string → returns null
8. Unknown event type → returns null
9. Extra unknown fields → passes through successfully

**extractSessionId — 3 cases:**
10. Returns session_id from first SystemInitEvent
11. Returns null when no SystemInitEvent exists
12. Returns null for empty array

**extractResult — 3 cases:**
13. Returns ResultEvent from events array
14. Returns null when no ResultEvent exists
15. Returns null for empty array

### Why They Failed
Module `./stream-events.js` did not exist — ERR_MODULE_NOT_FOUND.

## GREEN Phase

### Implementation
- Defined Zod schemas with `.passthrough()` for all 4 event types
- Used `z.discriminatedUnion('type', [...])` for the top-level union
- `parseEvent` wraps `JSON.parse` + `safeParse` — returns null on any failure
- `extractSessionId` finds first SystemInitEvent by type+subtype
- `extractResult` finds first ResultEvent by type
- All types inferred from Zod schemas and exported

### Result
All 15 tests passed. TypeScript compiles cleanly with `--noEmit`.

## REFACTOR Phase

No refactoring needed — implementation is clean and minimal. No commit.

## Task Commits

| Phase | Hash | Message |
|-------|------|---------|
| RED | `77f9a3c` | `test(03-01): add failing tests for NDJSON stream event parser` |
| GREEN | `e8c16b0` | `feat(03-01): implement NDJSON stream event parser` |
| REFACTOR | — | No changes needed |

## Files Created/Modified

| File | Action |
|------|--------|
| `src/stream-events.ts` | Created — Zod schemas, parseEvent, helpers |
| `src/stream-events.test.ts` | Created — 15 tests across 5 describe blocks |
| `vitest.config.ts` | Created — vitest config with globals |
| `package.json` | Modified — added test script, vitest devDep |
| `package-lock.json` | Modified — lockfile update |

## Decisions Made

1. **Zod `discriminatedUnion` on `type`** — cleanly dispatches to correct schema without manual switching
2. **`.passthrough()` on all schemas** — future-proofs against new fields from cursor-agent
3. **Null return pattern** — no exceptions from parseEvent; callers skip nulls
4. **Vitest with globals** — `describe`/`it`/`expect` available without imports (though we import explicitly for clarity)

## Deviations from Plan

None. Plan followed exactly.

## Issues Encountered

None.

## Next Phase Readiness

- `parseEvent` is ready for use by the stream consumer (03-02: Agent Process Runner)
- Types are exported for downstream consumers
- Vitest infrastructure is in place for subsequent TDD plans
