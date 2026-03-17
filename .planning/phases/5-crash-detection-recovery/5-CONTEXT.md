# Phase 5: Crash Detection & Recovery - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning

<vision>
## How This Should Work

Recovery is visible but hands-off. When cursor-agent dies mid-phase, the orchestrator detects it, parses STATE.md (and session-log) for the last known position, and automatically resumes from exactly that point — no manual steps. The user can see that a recovery happened: a clear log line, an artifact they can check today (e.g. STATE.md update or recovery log), and later when the dashboard exists, a visible note or badge (e.g. "Last run recovered from crash"). Reliability is the priority: no lost work, resume from the right place every time.

A toggleable option allows the orchestrator to auto-start when the shell initializes if a process check finds it isn't already running — so after a crash or reboot, opening a shell can bring the daemon back without the user having to run the command manually.
</vision>

<essential>
## What Must Be Nailed

- **Reliability** — Resume from the exact failure point every time; no lost work. Correctness of resume is non-negotiable.
- **Visibility** — User always knows when a recovery happened: logs + an artifact now (e.g. STATE.md or recovery.log) + dashboard visibility when Phase 6 exists.
- **Toggleable auto-start on shell init** — When the shell initializes, optionally check if the orchestrator process is running; if not, auto-start it. This option must be toggleable (e.g. config or flag).
</essential>

<boundaries>
## What's Out of Scope

- **Dashboard UI build** — Dashboard display of recovery status is Phase 6; this phase only ensures the data/signals exist (logs + artifact) and that the dashboard can show them later.
- **Multi-machine / remote recovery** — Local only; no cross-machine process checks or remote resume.
- **Complex retry/backoff** — Resume once from last known position; no exponential backoff, retry limits, or fancier failure policies in this phase.
</boundaries>

<specifics>
## Specific Ideas

- Recovery should be **documented**: log line plus an artifact the user can check today (STATE.md update or dedicated recovery log).
- **Auto-start when shell initializes** after a process check fails — user opens shell, orchestrator isn't running → optionally start it. This must be toggleable (e.g. in config or via a flag).
</specifics>

<notes>
## Additional Context

User chose "visible but hands-off" (option 2) and wanted both logs+dashboard and logs+artifact now (option 2 and 3), with recovery documented. Essential is reliability; auto-start on shell init is a requested feature with a toggle.
</notes>

---

*Phase: 5-crash-detection-recovery*
*Context gathered: 2026-03-16*
