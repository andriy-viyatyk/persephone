# EPIC-212: Linux bring-up and the platform layer (multiplatform phase 0)

## Status

**Status:** Active (started 2026-11-25; all four tasks implemented; review pending)
**Created:** 2026-11-25

## Overview

This is phase 0 of the [multiplatform roadmap](../reviews/multiplatform-roadmap.md): Persephone on Ubuntu, close to
feature parity with Windows. The epic does three things:

- makes the development build start on Linux (Ubuntu 26.04 LTS in the user's WSL);
- adds the one platform layer that every later phase uses;
- records, from real runs, what else breaks.

The evidence base is the static [inventory](../reviews/multiplatform-2026-11/inventory.md) (`WIN-1` … `WIN-38`). The
runtime findings this epic produces will change the later phases.

This epic starts with investigation. US-2198 and US-2201 are live investigation work, and US-2199 and US-2200 may be
reshaped by what US-2198 finds. Nothing in this epic is released to users.

## Goals

- `npm start` works in WSL: the main window opens, and files open, edit and save.
- Running into a Windows-only feature turns it off cleanly instead of crashing.
- `src/shared/platform.ts` and the feature-availability table (`platformFeatures`) exist. An ESLint rule stops new
  scattered `process.platform` checks.
- `multiplatform-2026-11/runtime-findings.md` lists what breaks on Linux at runtime, and the roadmap's phases 1–4 are
  updated from it.

## Linked Tasks

Task documents are created when each task starts.

| Task | Title | Owner | Status |
|------|-------|-------|--------|
| [US-2198](../tasks/US-2198-linux-dev-environment/README.md) | Linux development environment and first launch: the WSL checkout, how to sync it from Windows, Node and build dependencies, `scripts/dev.mjs` on Linux. Record every failure up to a working window | Claude (live), Codex for script changes | Implemented (2026-11-25) |
| [US-2199](../tasks/US-2199-platform-layer/README.md) | Platform layer: `src/shared/platform.ts` and `platformFeatures`, how the feature table reaches the renderer, and the ESLint rule with an allowlist of the existing `process.platform` checks | Codex (plan + implement), Claude reviews the plan | Implemented (2026-11-25) |
| [US-2200](../tasks/US-2200-linux-startup-blockers/README.md) | Startup blockers: guard `setAppUserModelId` / `setAppDetails` (WIN-38), the renderer data-folder fallback (WIN-26), a platform-aware pipe server (WIN-6), and disabling unsupported Linux helper features (mneme, snip) via static availability and main-process guards; dynamic Windows missing-helper hiding is deferred, plus what US-2198 found: POSIX file paths and `file:///` URLs (WIN-22, US-2198 F5 — no local file opens on Linux without it) | Codex (plan + implement), Claude live check | Implemented (2026-11-25) |
| [US-2201](../tasks/US-2201-linux-runtime-discovery/README.md) | Runtime discovery pass: walk through every editor and main feature in WSL; write `runtime-findings.md`; update roadmap phases 1–4 and the parity table | Claude (live) | Done (2026-11-25) |

**Order:** US-2198 → US-2199 → US-2200 → US-2201. US-2198 may find blockers that move into US-2200. If the platform
layer's shape depends on what US-2198 finds, US-2199 waits for it.

## Epic-level decisions

These come from roadmap §4 and §9. Only the ones this epic relies on are listed here.

1. **The newest Ubuntu only:** 26.04 LTS, x86_64, GNOME on Wayland. The development target is the user's WSL Ubuntu
   26.04.1 LTS, using WSL's built-in GUI support. The Hyper-V VM checks come in later phases.
2. **One platform layer, owned per concern.**
   - `src/shared/platform.ts` is pure, with no Electron imports.
   - The main-process owners (`terminal-launcher.ts`, `pipe-server.ts`, `snip-service.ts` and others) get
     per-platform collaborators beside them. No owner is replaced.
   - New `process.platform` checks are allowed only in the platform module and those collaborators. An ESLint rule
     enforces this, with an allowlist of the existing checks that only shrinks.
   - The module has a `darwin` slot from the start, though nothing is built for macOS.
3. **Feature availability is one table (`platformFeatures`), read by the UI, settings and MCP `$help`.** A feature
   that isn't available is hidden, and MCP calls to it fail with "not available on Linux".
4. **The data folder always comes from Electron's `app.getPath`**, never from `APPDATA` or `LOCALAPPDATA`.
5. **No Linux launcher.** Electron's single-instance lock and `second-instance` event do the work on Linux.
   `persephone --test` writes to the console directly, so the Windows-only `persephone-test.exe` wrapper isn't
   needed. The named pipe stays Windows-only, or becomes a Unix socket in `$XDG_RUNTIME_DIR` if US-2198 shows it's
   needed.
6. **A separate checkout inside WSL's Linux file system** (for example `~/persephone`) with its own `node_modules`.
   The Windows checkout stays the source of truth, and code changes are made there by Codex or Claude. US-2198 picks
   how the WSL copy is kept in sync, for example `rsync` that skips `node_modules`, `.vite`, `release`, `target` and
   `dist`. No commits are made just to move code into WSL.
7. **Live Linux checks are Claude's.** Codex briefs leave runtime checks out (user decision 2026-11-25).
8. **Windows behaviour must not change.** Every task is checked against the Windows build. `npm run typecheck`,
   `npm run lint` and the Windows integration suite stay green.

## Notes

- 2026-11-25: Created from the roadmap after the user answered its open questions:
  - newest Ubuntu only;
  - the parity gaps are accepted;
  - no preview, release at full parity;
  - GitHub Releases only;
  - live checks stay with Claude.
- 2026-11-25: US-2198 brought up the dev build in WSL. The bring-up needed one fix: koffi 2.9.0 → 2.16.3, because
  glibc 2.43 refuses the old binary's executable stack. Opening files needs WIN-22, which moves into US-2200.
- The user's customer project is never named in these documents.
