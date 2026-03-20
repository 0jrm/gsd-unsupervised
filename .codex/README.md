# Codex Integration Notes

This repository supports Codex as a first-class runtime agent (`--agent codex`).

## Runtime

- Binary path resolution:
  - `GSD_CODEX_BIN` environment override
  - `codexCliPath` in config
  - fallback: `codex`
- Required unattended auth: `OPENAI_API_KEY`

## Rules/Skills Parity

- Global behavior and command contract are defined in `AGENTS.md`.
- Skill-style guidance for GSD commands is mirrored in:
  - `.agents/skills/gsd-commands/SKILL.md`
- Canonical GSD workflows remain in:
  - `.gsd-framework/workflows/`
  - `.gsd-framework/references/`
  - `.gsd-framework/templates/`
