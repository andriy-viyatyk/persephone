# US-2201: Linux runtime discovery pass

**Epic:** [EPIC-212](../../epics/EPIC-212.md) · **Owner:** Claude (live) · **Started:** 2026-11-25

## Goal

Walk through every editor and main feature of the development build in WSL Ubuntu 26.04 and record what breaks in
[`runtime-findings.md`](../../reviews/multiplatform-2026-11/runtime-findings.md). Then update roadmap phases 1–4 and
the parity table from it.

## Background

- The environment is the one from [US-2198](../US-2198-linux-dev-environment/README.md): the `dev` user, `~/persephone`
  synced by rsync, MCP on port 7875.
- [US-2200](../US-2200-linux-startup-blockers/README.md) made files open, edit and save, and moved the pipe to a Unix
  socket.
- The static evidence is the [inventory](../../reviews/multiplatform-2026-11/inventory.md) (`WIN-n`). The target
  outcomes are roadmap §3.

## Method

1. **UI suite.** Run `npm run test:ui` in WSL, area by area. This is the widest check, and it measures how far
   Phase 1's exit ("the suite runs on Linux") is.
2. **Manual walk over MCP.** Open each editor with a sample file and exercise the main features. Read the renderer and
   main logs after each step.
3. **Record.** Each finding gets an ID (`R-n`), the inventory item it confirms or contradicts, and the phase it
   belongs to.

Findings only: nothing is fixed here unless it blocks the walk itself.

## Acceptance criteria

- [x] UI suite tried in WSL. The first blocker is recorded as R-1: the test host can't launch the app, so no area
  ran.
- [x] Every editor and main feature in roadmap §3 checked or explicitly marked "not checked, why".
- [x] `runtime-findings.md` written (R-1 … R-10).
- [x] Roadmap phases 0–2 and the parity table updated from it. Phases 3–4 needed no change: nothing in this pass
  touched helpers or packaging.
- [x] Findings from earlier tasks carried in: US-2198 F9 → R-7, F10 → R-5, and the US-2200 path-identity note → R-8.

## Files changed

| File | Change |
|------|--------|
| `doc/reviews/multiplatform-2026-11/runtime-findings.md` | New: the findings |
| `doc/reviews/multiplatform-roadmap.md` | Phases 1–4 and §3 updated |
| `doc/epics/EPIC-212.md`, `doc/active-work.md` | Task link and status |
