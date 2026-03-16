# Phase 3: Cursor Agent Integration - Research

**Researched:** 2026-03-16
**Domain:** Cursor Agent CLI — headless invocation, process orchestration, output parsing
**Confidence:** HIGH

<research_summary>
## Summary

Researched the Cursor Agent CLI ecosystem for building a Node.js orchestrator that spawns cursor-agent headlessly, pipes GSD commands, captures structured output, and manages process lifecycle. Two integration paths exist: **Print Mode** (one-shot headless invocations with stream-json output) and **ACP Mode** (bidirectional JSON-RPC over stdio for persistent sessions).

The #1 unknown from the roadmap — "how cursor-agent handles interactive prompts mid-execution" — is fully resolved: the `--force` flag bypasses all file modification confirmations, `--trust` skips workspace trust prompts, and `--approve-mcps` auto-approves MCP servers. Combined with `-p` (print mode), the agent runs to completion without any interactive prompts.

A third-party SDK (`@nothumanwork/cursor-agents-sdk`) exists that wraps the CLI with typed Node.js helpers, but at 113 weekly downloads and v0.7.0, it's immature. The recommendation is to build a thin wrapper directly using `child_process.spawn` + NDJSON parsing for v1, keeping the SDK as a reference implementation.

**Primary recommendation:** Use print mode (`agent -p --force --trust --approve-mcps --workspace <dir> --output-format stream-json "<GSD command>"`) for v1. Each GSD command is a separate invocation. Parse stream-json NDJSON for progress tracking. Use `--resume` for crash recovery.
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| cursor-agent (binary) | latest via `curl cursor.com/install` | Headless AI agent CLI | The execution engine — official Cursor tool |
| node:child_process | Node.js built-in | Process spawning | `spawn()` for long-running CLI with streaming stdout |
| node:readline | Node.js built-in | Line-by-line NDJSON parsing | Parse stream-json output line by line |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ndjson | 2.0.0 | Transform stream for NDJSON | Alternative to readline if you prefer stream piping |
| zod | ^3 | Schema validation for stream events | Validate NDJSON events match expected shapes |
| tree-kill | latest | Kill process trees | Ensure child processes are fully terminated on abort |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Print mode (one-shot) | ACP mode (JSON-RPC) | ACP is richer (multi-turn, permission handling) but far more complex; overkill for v1 where each GSD command is self-contained |
| Direct child_process | @nothumanwork/cursor-agents-sdk | SDK wraps CLI nicely but only v0.7.0, 113 downloads/week — immature for production orchestrator |
| readline NDJSON | ndjson npm package | ndjson adds stream transform convenience; readline is zero-dependency and sufficient |

**Installation:**
```bash
# Install cursor-agent binary
curl https://cursor.com/install -fsS | bash

# Node.js dependencies (orchestrator)
npm install zod tree-kill
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Integration Architecture
```
Orchestrator (Node.js)
├── AgentRunner           # Spawns cursor-agent, manages process lifecycle
│   ├── spawn()           # child_process.spawn with args
│   ├── parseStream()     # NDJSON line parser → typed events
│   └── kill()            # Graceful shutdown with tree-kill
├── CommandSequencer      # Sequences GSD commands for a goal
│   ├── buildCommand()    # Construct full agent CLI args
│   └── executeStep()     # Run one GSD command, wait for result event
└── OutputParser          # Parse stream-json events
    ├── onAssistant()     # Track agent reasoning
    ├── onToolCall()      # Track file reads/writes/shell commands
    └── onResult()        # Detect completion, extract duration
```

### Pattern 1: Print Mode One-Shot Invocation
**What:** Each GSD command is a separate `agent -p` invocation that runs to completion
**When to use:** v1 orchestrator — GSD commands are self-contained, reading state from `.planning/` files
**Example:**
```javascript
const { spawn } = require('node:child_process');
const readline = require('node:readline');

function runGsdCommand(workspace, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('agent', [
      '-p',
      '--force',
      '--trust',
      '--approve-mcps',
      '--workspace', workspace,
      '--output-format', 'stream-json',
      prompt
    ], {
      env: { ...process.env, CURSOR_API_KEY: process.env.CURSOR_API_KEY }
    });

    const rl = readline.createInterface({ input: child.stdout });
    let lastResult = null;

    rl.on('line', (line) => {
      try {
        const event = JSON.parse(line);
        if (event.type === 'tool_call' && event.subtype === 'completed') {
          // Track file modifications for progress
        }
        if (event.type === 'result') {
          lastResult = event;
        }
      } catch (e) { /* skip malformed lines */ }
    });

    child.on('close', (code) => {
      if (code === 0 && lastResult) resolve(lastResult);
      else reject(new Error(`agent exited with code ${code}`));
    });

    child.stderr.on('data', (data) => {
      // Log stderr for debugging
    });
  });
}
```

### Pattern 2: ACP Mode Persistent Session (v2 consideration)
**What:** Bidirectional JSON-RPC over stdio for multi-turn conversations
**When to use:** If orchestrator needs to send follow-up prompts, handle permission requests, or maintain conversation context across GSD commands
**Example:**
```javascript
const { spawn } = require('node:child_process');
const readline = require('node:readline');

function createAcpSession(workspace) {
  const agent = spawn('agent', ['acp'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, CURSOR_API_KEY: process.env.CURSOR_API_KEY }
  });

  let nextId = 1;
  const pending = new Map();

  function send(method, params) {
    const id = nextId++;
    agent.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
    );
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  }

  const rl = readline.createInterface({ input: agent.stdout });
  rl.on('line', (line) => {
    const msg = JSON.parse(line);
    if (msg.id && (msg.result || msg.error)) {
      const waiter = pending.get(msg.id);
      if (waiter) {
        pending.delete(msg.id);
        msg.error ? waiter.reject(msg.error) : waiter.resolve(msg.result);
      }
    }
    if (msg.method === 'session/request_permission') {
      // Auto-approve in YOLO mode
      agent.stdin.write(JSON.stringify({
        jsonrpc: '2.0', id: msg.id,
        result: { outcome: { outcome: 'selected', optionId: 'allow-always' } }
      }) + '\n');
    }
  });

  return { send, kill: () => { agent.stdin.end(); agent.kill(); } };
}
```

### Pattern 3: Session Resume for Crash Recovery
**What:** Use `--resume <sessionId>` to continue from a crashed session
**When to use:** When crash recovery detects an incomplete GSD command
**Example:**
```javascript
function resumeSession(workspace, sessionId) {
  return new Promise((resolve, reject) => {
    const child = spawn('agent', [
      '-p', '--force', '--trust',
      '--workspace', workspace,
      '--output-format', 'stream-json',
      '--resume', sessionId
    ]);
    // ... same NDJSON parsing as Pattern 1
  });
}
```

### Anti-Patterns to Avoid
- **Sending multiple prompts in a single print-mode invocation:** Print mode is one-shot. Use `--resume` or ACP for multi-turn.
- **Ignoring stderr:** Cursor agent writes error messages and logs to stderr. Always capture and log it.
- **Not setting --workspace:** Without it, the agent uses CWD. GSD rules in `.cursor/rules/` won't load if CWD is wrong.
- **Spawning unlimited concurrent agents:** Cursor enforces concurrency limits per account — `resource_exhausted` errors occur with too many parallel Claude/GPT sessions.
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| NDJSON parsing | Custom string splitting + JSON.parse | readline interface or ndjson package | Handles partial lines, buffer boundaries, encoding edge cases |
| Process tree killing | child.kill() alone | tree-kill package | child.kill() only kills the direct child, not grandchildren; cursor-agent may spawn subprocesses |
| Stream event validation | Manual type checks | Zod schemas (see SDK reference) | Cursor may add new event types/fields; Zod handles unknown fields gracefully |
| CLI argument construction | String concatenation | Array of args to spawn() | Avoids shell injection, handles spaces in paths, no quoting issues |
| Output format parsing | Regex on text output | stream-json format | Text format is lossy (final message only, no tool calls); stream-json gives full execution trace |

**Key insight:** The cursor-agent CLI is well-designed for automation. Its stream-json output format is a structured protocol — treat it as an API, not as text to be scraped. The official output format docs define exact event schemas with versioning guarantees ("consumers should ignore unknown fields").
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Concurrency Limits (resource_exhausted)
**What goes wrong:** Running multiple cursor-agent sessions simultaneously causes `ConnectError: [resource_exhausted]` errors
**Why it happens:** Cursor enforces per-account concurrency limits for Claude and GPT models
**How to avoid:** Implement a concurrency limiter in the orchestrator. Start with max 1-2 concurrent sessions. For `--parallel` mode, use a semaphore/queue pattern with exponential backoff on 429/resource_exhausted errors.
**Warning signs:** Agents fail immediately after spawning, especially the 2nd or 3rd concurrent agent

### Pitfall 2: Missing CURSOR_API_KEY in Headless Mode
**What goes wrong:** Agent fails to authenticate, exits with error
**Why it happens:** Headless mode (no TTY) can't use browser-based auth flow
**How to avoid:** Always set `CURSOR_API_KEY` environment variable. Generate key from Cursor Dashboard → Cloud Agents → User API Keys. Validate key exists before spawning agent.
**Warning signs:** Auth errors on first invocation, works fine in interactive terminal

### Pitfall 3: --workspace Not Set → GSD Rules Not Loaded
**What goes wrong:** Agent starts but doesn't know GSD commands, behaves like vanilla Claude
**Why it happens:** Without `--workspace`, agent uses CWD which may not contain `.cursor/rules/`
**How to avoid:** Always pass `--workspace <project-dir>` pointing to the directory containing `.cursor/rules/` with GSD rules
**Warning signs:** Agent responds "I don't know what /gsd/ commands are" or ignores GSD formatting

### Pitfall 4: Not Capturing session_id for Crash Recovery
**What goes wrong:** Agent crashes mid-execution, can't resume from where it left off
**Why it happens:** session_id is emitted in the `system.init` event but not captured
**How to avoid:** Parse the first NDJSON event (system.init), extract session_id, persist it. Use `--resume <session_id>` if agent needs restarting.
**Warning signs:** After crash, restarting the same command repeats all work from scratch

### Pitfall 5: Buffering Deadlock with child_process
**What goes wrong:** Agent appears to hang, no output received
**Why it happens:** stdout buffering when not connected to TTY; or NDJSON parser waiting for newline that never comes
**How to avoid:** Use `spawn()` not `exec()` — spawn streams output in real-time. Set `{ stdio: ['pipe', 'pipe', 'pipe'] }` explicitly. Ensure you read both stdout and stderr.
**Warning signs:** Agent runs (CPU usage visible) but event handler never fires

### Pitfall 6: Ignoring Non-Zero Exit Codes
**What goes wrong:** Orchestrator thinks command succeeded when agent actually failed
**Why it happens:** Agent can exit non-zero without emitting a result event (especially on auth/network errors)
**How to avoid:** Always check exit code AND presence of result event. A zero exit code with no result event is also suspicious.
**Warning signs:** Stale STATE.md, no file modifications despite "successful" run
</common_pitfalls>

<code_examples>
## Code Examples

### Complete Headless Invocation with stream-json Parsing
```javascript
// Source: Cursor official docs (cursor.com/docs/cli/reference/output-format)
// Pattern: Full stream-json parsing with all event types

const { spawn } = require('node:child_process');
const readline = require('node:readline');

function runAgent(workspace, prompt, options = {}) {
  const args = [
    '-p',
    '--force',
    '--trust',
    '--approve-mcps',
    '--workspace', workspace,
    '--output-format', 'stream-json',
  ];
  if (options.model) args.push('--model', options.model);
  if (options.resumeId) args.push('--resume', options.resumeId);
  args.push(prompt);

  const child = spawn('agent', args, {
    env: { ...process.env, CURSOR_API_KEY: process.env.CURSOR_API_KEY },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const rl = readline.createInterface({ input: child.stdout });

  let sessionId = null;
  const events = [];

  rl.on('line', (line) => {
    try {
      const event = JSON.parse(line);
      events.push(event);

      switch (event.type) {
        case 'system':
          sessionId = event.session_id;
          if (options.onInit) options.onInit(event);
          break;
        case 'assistant':
          if (options.onAssistant) options.onAssistant(event);
          break;
        case 'tool_call':
          if (options.onToolCall) options.onToolCall(event);
          break;
        case 'result':
          if (options.onResult) options.onResult(event);
          break;
      }
    } catch (e) { /* skip malformed lines */ }
  });

  let stderrOutput = '';
  child.stderr.on('data', (chunk) => { stderrOutput += chunk.toString(); });

  return new Promise((resolve, reject) => {
    child.on('close', (code) => {
      const resultEvent = events.find(e => e.type === 'result');
      if (code === 0 && resultEvent) {
        resolve({ sessionId, result: resultEvent, events });
      } else {
        reject(new Error(
          `Agent exited with code ${code}. stderr: ${stderrOutput}`
        ));
      }
    });
    child.on('error', reject);
  });
}
```

### GSD Command Sequencer
```javascript
// Pattern: Sequential GSD command execution for a single goal

async function executeGsdLifecycle(workspace, goalDescription) {
  const commands = [
    `/gsd/new-project\n\n${goalDescription}`,
    '/gsd/create-roadmap',
    '/gsd/plan-phase 1',
    '/gsd/execute-plan .planning/phases/1-*/PLAN.md',
  ];

  const results = [];
  for (const cmd of commands) {
    const result = await runAgent(workspace, cmd, {
      onToolCall: (event) => {
        if (event.subtype === 'completed') {
          console.log(`  [tool] ${Object.keys(event.tool_call)[0]}`);
        }
      }
    });
    results.push(result);
    console.log(`Completed: ${cmd.split('\n')[0]} (${result.result.duration_ms}ms)`);
  }
  return results;
}
```

### stream-json Event Schema (Zod)
```typescript
// Source: Aligned with cursor.com/docs/cli/reference/output-format
// Reference: @nothumanwork/cursor-agents-sdk schemas

import { z } from 'zod';

const SystemInitEvent = z.object({
  type: z.literal('system'),
  subtype: z.literal('init'),
  apiKeySource: z.string(),
  cwd: z.string(),
  session_id: z.string(),
  model: z.string(),
  permissionMode: z.string(),
});

const UserEvent = z.object({
  type: z.literal('user'),
  message: z.object({
    role: z.literal('user'),
    content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  }),
  session_id: z.string(),
});

const AssistantEvent = z.object({
  type: z.literal('assistant'),
  message: z.object({
    role: z.literal('assistant'),
    content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  }),
  session_id: z.string(),
});

const ToolCallEvent = z.object({
  type: z.literal('tool_call'),
  subtype: z.enum(['started', 'completed']),
  call_id: z.string(),
  tool_call: z.record(z.any()),
  session_id: z.string(),
});

const ResultEvent = z.object({
  type: z.literal('result'),
  subtype: z.literal('success'),
  duration_ms: z.number(),
  duration_api_ms: z.number(),
  is_error: z.literal(false),
  result: z.string(),
  session_id: z.string(),
});

const CursorStreamEvent = z.discriminatedUnion('type', [
  SystemInitEvent, UserEvent, AssistantEvent, ToolCallEvent, ResultEvent,
]);
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| IDE-only Cursor agent | CLI `agent` binary with full headless support | 2025 | Enables script/CI/orchestration use cases |
| Text-only CLI output | stream-json NDJSON with typed events | 2025 | Programmatic progress tracking and tool call monitoring |
| No session management | `--resume [chatId]` and `--continue` | 2025 | Crash recovery by continuing previous sessions |
| Manual tool approval | `--force` + `--trust` + `--approve-mcps` | 2025 | Fully unattended headless execution |
| No programmatic API | ACP (Agent Client Protocol) over stdio | 2025-2026 | Bidirectional JSON-RPC for rich custom clients |

**New tools/patterns to consider:**
- **ACP Mode (`agent acp`):** Full JSON-RPC protocol over stdio. Supports `session/new`, `session/load`, `session/prompt`, and `session/request_permission`. Could replace print-mode one-shot invocations if multi-turn conversations are needed within a single agent process. Documented at cursor.com/docs/cli/acp.
- **Cloud Agent handoff (`-c` / `--cloud`):** Push conversation to cloud agent that continues running. Could be useful for long-running GSD execution phases.
- **`@nothumanwork/cursor-agents-sdk`:** Third-party Node.js SDK (v0.7.0) with typed CursorAgent class, Zod validators, and streaming support. Low adoption (113 downloads/week) but useful as reference implementation.

**Deprecated/outdated:**
- **Scraping text output:** The `text` output format only shows the final assistant message. Use `stream-json` for any automation that needs progress tracking.
- **Browser-based auth for scripts:** Use `CURSOR_API_KEY` for all headless/automation scenarios. Browser auth only works with TTY.
</sota_updates>

<open_questions>
## Open Questions

1. **Exact concurrency limit per account**
   - What we know: Multiple concurrent Claude/GPT sessions cause `resource_exhausted` errors. The `composer-1` and `auto` models don't hit this limit.
   - What's unclear: The exact number of concurrent sessions allowed. Whether this varies by subscription tier.
   - Recommendation: Start with max 1 concurrent agent in v1. For `--parallel` mode, implement adaptive concurrency that backs off on `resource_exhausted` errors. Test empirically.

2. **Token/cost tracking from CLI output**
   - What we know: stream-json emits `duration_ms` and `duration_api_ms` in the result event. The PROJECT.md mentions "cost/token tracking" for the dashboard.
   - What's unclear: Whether token counts are available in the stream-json output. The documented schema doesn't include token fields.
   - Recommendation: Track duration_ms per invocation. For token/cost data, may need to query Cursor Dashboard API separately or track via the Cloud Agents API.

3. **ACP stability and completeness**
   - What we know: ACP is documented, has a minimal Node.js client example, and supports sessions, permissions, and streaming.
   - What's unclear: Whether ACP is considered stable or still in development. The docs call it "advanced, hidden command."
   - Recommendation: Use print mode for v1. Keep ACP as a v2 upgrade path if richer interaction is needed.

4. **cursor-agent behavior on WSL2 specifically**
   - What we know: Install script supports Linux/WSL. The project constraint is WSL2-on-Windows.
   - What's unclear: Whether there are WSL2-specific issues with process lifecycle, file watching, or path resolution.
   - Recommendation: Test cursor-agent headless invocation on WSL2 early in implementation. Watch for path issues between Windows and Linux filesystems.

5. **Session resume scope and limitations**
   - What we know: `--resume [chatId]` continues a previous session. session_id is in every stream-json event.
   - What's unclear: How much context is retained on resume. Whether the agent picks up exactly where it left off or starts fresh with conversation history.
   - Recommendation: Test resume behavior explicitly during implementation. Capture session_id from every invocation for potential crash recovery use.
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- https://cursor.com/docs/cli/reference/parameters — Complete CLI parameter reference
- https://cursor.com/docs/cli/reference/output-format — Detailed stream-json NDJSON event schema with examples
- https://cursor.com/docs/cli/reference/authentication — API key setup for headless execution
- https://cursor.com/docs/cli/headless — Headless usage patterns and example scripts
- https://cursor.com/docs/cli/using — Interactive/non-interactive modes, rules loading, ACP, session resume
- https://cursor.com/docs/cli/acp — ACP protocol specification with Node.js client example

### Secondary (MEDIUM confidence)
- https://www.npmjs.com/package/@nothumanwork/cursor-agents-sdk — Third-party SDK (v0.7.0, verified on npm registry)
- https://forum.cursor.com/t/cursor-agent-cli-concurrent-call-limit/144782 — Concurrency limit reports from users
- https://benxhub.com/en/blog/cursor/cli/10-headless-scripts — Community blog verified against official docs
- https://nodejs.org/api/child_process.html — Node.js child_process documentation

### Tertiary (LOW confidence - needs validation)
- Exact concurrency limits — reported by users but not officially documented
- WSL2-specific behavior — no specific issues found, but not explicitly tested/documented
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: Cursor Agent CLI (headless mode, print mode, ACP)
- Ecosystem: Node.js child_process, NDJSON parsing, @nothumanwork/cursor-agents-sdk
- Patterns: One-shot invocation, session resume, ACP bidirectional protocol
- Pitfalls: Concurrency limits, auth, workspace rules, session capture, buffering

**Confidence breakdown:**
- Standard stack: HIGH — verified with official Cursor docs, all flags and output formats documented
- Architecture: HIGH — print mode pattern from official headless docs; ACP from official ACP docs with working examples
- Pitfalls: HIGH for auth/workspace/buffering (documented); MEDIUM for concurrency (user-reported)
- Code examples: HIGH — event schemas from official output-format docs, patterns from official headless guide

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (30 days — Cursor CLI is actively evolving but core headless API is stable)
</metadata>

---

*Phase: 03-cursor-agent-integration*
*Research completed: 2026-03-16*
*Ready for planning: yes*
