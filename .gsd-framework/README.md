# GSD Framework

# Auto-extracted from .cursor/rules/ — expand as needed

This directory bundles the Get Shit Done (GSD) framework workflows, templates, and references into the repository. Any developer who clones this repo can use all GSD commands without external path dependencies.

## Structure

- **workflows/** — Step-by-step process documents for GSD commands (execute-plan, plan-phase, create-roadmap, etc.)
- **templates/** — Markdown templates for PROJECT.md, ROADMAP.md, SUMMARY.md, phase prompts, and codebase mapping
- **references/** — Reference docs for plan format, checkpoints, TDD, git integration, and scope estimation

## Usage

The `.cursor/rules/*.mdc` files reference these files via repo-relative paths (e.g. `.gsd-framework/workflows/execute-plan.md`). No hardcoded user paths — the repo is self-contained.

## Origin

Originally maintained at `~/.cursor/get-shit-done/` on the author's machine. Bundled here so onboarding works for any clone.
