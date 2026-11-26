# EPIC-213: Linux core parity (multiplatform phase 1)

## Status

**Status:** Active
**Created:** 2026-11-26

## Overview

This is phase 1 of the [multiplatform roadmap](../reviews/multiplatform-roadmap.md). Phase 0
([EPIC-212](EPIC-212.md)) made the dev build start in WSL, added the platform layer, and recorded the
[runtime findings](../reviews/multiplatform-2026-11/runtime-findings.md). This epic fixes the Windows assumptions left
in shared code (paths, file-access grants, board and module environments, encoding, fonts, keyboard) and makes the
UI integration suite run on Linux, locally in WSL and in GitHub Actions.

The suite is the measure. The first task runs all of it in WSL and records what fails, so the later tasks are sized
from real failures rather than from the inventory alone. Nothing in this epic is released to users.

Already done in Phase 0, so not repeated here: POSIX paths and `file:///` URLs (WIN-22, 23), the data folder
(WIN-26), the native-dialog tracker (R-2), the board shortcut gate (R-3), and launching the app from the test host
(R-1).

## Goals

- `npm run test:ui` runs on Linux under Xvfb, and every test without `requires: ["windows"]` passes. This is the
  roadmap's Phase 1 exit.
- A GitHub Actions job builds on `ubuntu-latest` and runs the suite (development only; it publishes nothing).
- Paths keep POSIX semantics: a backslash is a filename character, and comparisons are case-sensitive where the file
  system is.
- Browser file-access grants, board data, the board test sandbox and the module-service environment work with Linux
  paths and variables.
- Shortcuts go through one keymap with a primary modifier, and their labels come from it.

## Linked Tasks

| Task | Title | Owner | Status |
|------|-------|-------|--------|
| [US-2204](../tasks/US-2204-linux-suite-runner/README.md) | **Suite on Linux: runner and baseline.** The runner finds the Linux app binary (WIN-35); tests that need Windows declare `requires: ["windows"]` and report "skipped" on Linux (WIN-36); then a full `test:ui` run in WSL under Xvfb and in WSLg, with every failure recorded against the task that owns it (or a new task) | Codex (plan + implement), Claude runs the suite | Implemented (2026-11-26) |
| [US-2205](../tasks/US-2205-linux-path-semantics/README.md) | **Path semantics.** Backslash as a separator only on Windows in `file-path.ts`, `fpNormalizeForCompare`, `comparePathKey` and `FileTreeProvider` (WIN-24, R-8); case-sensitive path equality in the clipboard service and anywhere else that lowercases unconditionally (WIN-16, first half). Reuse the existing case-preserving helpers listed in the inventory | Codex (plan + implement), Claude live check | Implemented (2026-11-26) |
| [US-2206](../tasks/US-2206-linux-file-access-grants/README.md) | **Browser file-system grants on Linux.** `file-system-access-policy.ts` accepts POSIX absolute paths and uses the native `path` module; sensitive folders get a home/XDG list beside the Windows one (WIN-25) | Codex (plan + implement), Claude live check | Implemented (2026-11-26) |
| [US-2207](../tasks/US-2207-linux-board-module-env/README.md) | **Board and module environments.** Board data folder from Electron or XDG instead of `LOCALAPPDATA`, keeping profile isolation (WIN-12); the board test sandbox and the module-service process environment use HOME/XDG, a POSIX `node` and Linux variables (WIN-13, R-9) | Codex (plan + implement), Claude live check | Implemented (2026-11-26) |
| [US-2208](../tasks/US-2208-keymap-primary-modifier/README.md) | **Keymap with a primary modifier.** One keymap owns application shortcuts and their labels; the primary modifier is Ctrl on Windows and Linux with a `darwin` slot (WIN-28, decision 7). Note which shortcuts GNOME takes for itself; the GNOME check itself is Phase 2 (VM) | Codex (plan + implement), Claude reviews the plan | Implemented (2026-11-26) |
| [US-2209](../tasks/US-2209-linux-encoding-fonts/README.md) | **Encoding fallback and fonts.** Locale-aware encoding fallback, UTF-8 by default off Windows, Windows-1251 behaviour on Windows unchanged (WIN-27, R-10); Linux font alternatives in the font stacks and an emoji/icon glyph check (WIN-29, R-4) | Codex (plan + implement), Claude live check | Implemented (2026-11-26) |
| [US-2210](../tasks/US-2210-linux-ci-job/README.md) | **Linux CI job.** A GitHub Actions workflow on `ubuntu-latest`: install, typecheck, lint, build, and `test:ui` under Xvfb; skipped tests listed in the job summary. Not part of the release workflow | Codex (plan + implement), Claude checks the first run | Implemented (2026-11-26) |

**Order:** US-2204 first: it decides what the rest must fix and may add tasks. US-2205 to US-2209 are independent of
each other and follow in any order. US-2210 is last, once the suite passes locally.

## Epic-level decisions

From roadmap §4 and §9, plus EPIC-212. Only the ones this epic relies on are listed.

1. **The newest Ubuntu only:** 26.04 LTS, x86_64. Development and local suite runs use the user's WSL Ubuntu 26.04.1
   (WSLg, and Xvfb for the suite). CI uses `ubuntu-latest`; if that is not 26.04 yet, a container or the newest
   runner image stands in, and the difference is noted in US-2210.
2. **Platform logic goes through the platform layer.** `src/shared/platform.ts` and `platformFeatures`; new
   `process.platform` checks only where the ESLint rule allows, and its allowlist only shrinks. Each OS-facing
   owner keeps its job and gets per-platform collaborators beside it (refactoring guardrails 3 and 4).
3. **Paths use Node's own semantics.** `file-path.ts` stays the single renderer path module. On POSIX a backslash is
   a legal filename character and paths compare case-sensitively. The main-process file-access policy uses the
   native `path` module, not `path.win32`.
4. **Tests that need Windows say so.** They declare `requires: ["windows"]` and report "skipped" on Linux, the same
   way `desktop` tests do on a locked screen. A test is tagged only when its subject is Windows-only; a test that
   fails on Linux because of a portable bug stays untagged and the bug gets fixed.
5. **Live Linux checks and suite runs are Claude's.** Codex briefs leave runtime checks out (user decision
   2026-11-25). Codex may write and triage tests from the output Claude gives it.
6. **Windows behaviour must not change.** Every task is checked against the Windows build: `npm run typecheck`,
   `npm run lint` and the affected `test:ui` areas on Windows stay green. The full Windows suite runs once before
   the epic closes.
7. **No user-visible Linux release.** Nothing ships to users until Phase 4. User guides change only where Windows
   behaviour or wording changes (for example shortcut labels).

## Out of scope (later phases)

- Tray and close-to-tray, window chrome, terminal, VLC/Tor, default browser, board `.desktop` shortcuts, file
  clipboard and drag-out, clipboard history on Wayland, settings wording (R-5, R-6, R-7): Phase 2.
- Snip, system audio, Mneme on Linux: Phase 3.
- Packaging, AppArmor, release CI: Phase 4.

## Notes

- 2026-11-26: Created from roadmap Phase 1, adjusted by the EPIC-212 runtime findings.
- 2026-11-26: All seven tasks implemented in one autonomous run. Local results (dev target):
  - WSL full suite: 464 passed, 0 failed, 109 skipped. Of the skips, 16 are `requires Windows` and 86 are
    published-board tests skipped only because the boards checkout was absent. With the checkout present,
    `published-boards` ran 81 passed, 4 failed: 1 is the text-to-speech board's Windows-only runtime (now tagged
    `windows`), 3 are Gem Keep (below).
  - Windows full suite: 559 passed, 1 failed, 11 skipped. The failure was the `proc` stdin fixture, fixed
    (the area then passed 6/6).
  - Typecheck and lint pass on Windows.
- **Open: WebGL on Linux test machines.** Gem Keep's three tests need WebGL. WSLg has no usable GPU process
  for Chromium (`webglAvailable: false`; once the dev app also died with "GPU process isn't usable"), and current
  Chromium no longer falls back to SwiftShader for WebGL unless started with `--enable-unsafe-swiftshader`. Xvfb on
  CI is likely the same. Choices: start test instances with that switch on Linux, add an automatic `webgl`
  requirement, or accept the failures until a GPU-backed runner. Not decided; left untagged so it stays visible.
- **Open: US-2210 first CI run.** The workflow is written but has not run, because nothing is pushed yet.
- Minimize-dependent tests (`desktop-awareness`, `minimized-page-visibility`) are tagged `windows` because WSLg and
  Xvfb ignore `minimize()`. Re-check them on GNOME in the Phase 2 VM.
- The user's customer project is never named in these documents.
