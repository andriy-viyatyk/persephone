# US-1757: Upgrade Castlabs Electron (recurring)

> **Recurring task.** This document is reused for every upgrade round. Do **not** delete this folder
> when a round completes, and do not move the task to `completed.md` as finished. Record each round
> in the **Round log** below and in `doc/tasks/completed.md` as a dated row
> (`US-1757 (round YYYY-MM-DD)`).

## Goal

Keep Persephone on a supported Castlabs Electron release, so it keeps receiving Chromium security
fixes and stays a few months behind current Chrome rather than a year behind.

## Background

- Persephone pins Castlabs ECS (Electron with Widevine) in `package.json`:
  `"electron": "github:castlabs/electron-releases#vXX.Y.Z+wvcus"`. The current version is whatever
  that line says; `node -p "require('electron/package.json').version"` shows the installed one.
- Electron ships a major release about every 8 weeks and backports security fixes to the **latest
  three majors** only. Chromium ships a major release every 4 weeks. Upgrading **every second
  Electron major** keeps Persephone inside the support window. Patch releases within the current
  major are also worth taking: they carry the Chromium security fixes.
- Available versions: `gh api 'repos/castlabs/electron-releases/releases?per_page=100' --jq '.[].tag_name'`.
  Pick the newest **stable** (not `-alpha`/`-beta`) `+wvcus` tag of the target major.
- The previous round (US-1756, Electron 43 → 44.9.3, 2026-11-03) is recorded in
  `doc/tasks/completed.md`. Lessons from it are built into the steps below.

## Implementation Plan

### 0. Keep the schedule going (do this first, when the round is picked up)

- [ ] Move this round's entry from **Scheduled** to **Active** in `doc/active-work.md`.
- [ ] Add a **new** Scheduled entry for the next round, about **3 months** later (two Electron
      majors), sorted by date:
      `- [ ] **YYYY-MM-DD** — [US-1757: Upgrade Castlabs Electron (recurring)](tasks/US-1757-castlabs-electron-upgrade/README.md) — next round; see the doc for the procedure`

### 1. Plan the round

- [ ] Find the target version (see Background). If the newest stable major is only one ahead and
      the current major is still supported, the round may take just the latest patch of the current
      major instead; record which and why.
- [ ] Audit breaking changes for every major crossed: `docs/breaking-changes.md` at the target tag
      (`gh api -H "Accept: application/vnd.github.raw" "repos/electron/electron/contents/docs/breaking-changes.md?ref=vNN.0.0"`)
      and the release notes. For each change, grep `src/`, `scripts/`, `.github/`,
      `electron-builder.yml` and record whether Persephone is affected, with file:line.
- [ ] If the audit finds code changes, write them into the **Round log** entry as a short plan
      (normal task-document rules: exact files, before → after), and have the user review it
      before implementing. A patch-only round with no breaking changes can go straight to step 2.

### 2. Upgrade

- [ ] **Stop dev Persephone first** (`npm start` processes and its `electron.exe`): npm cannot
      replace a running Electron, and `build-prod` must never run while dev is running.
- [ ] Install by name — a plain `npm install` after editing `package.json` kept the old git-pinned
      Electron in US-1756 and skipped its binary download:
      ```bash
      npm install --save-dev "electron@github:castlabs/electron-releases#vNN.Y.Z+wvcus"
      node node_modules/electron/install.js   # downloads electron.exe if missing
      node -p "require('electron/package.json').version"
      ```
- [ ] Update the version in `doc/agents-common.md` (Tech Stack), the stale example in
      `electron-builder.yml` (mirror comment), and any developer doc that names the major.
- [ ] Apply the code changes from step 1. Then `npm run typecheck`, `npm run lint`,
      `npm run build-prod`.

### 3. Verify

- [ ] Cold `npm start`; confirm `process.versions.electron` / `chrome` / `node` from a renderer
      script, the window renders, and a browser tab loads.
- [ ] Clipboard-history check (EPIC-104 D6): a main-process clipboard write must not carry the
      `CanIncludeInClipboardHistory` format, or copies vanish from Win+V. Check by enumerating Win32
      clipboard formats after a write (a small PowerShell `EnumClipboardFormats` script, as in
      US-1756), and check Persephone's own clipboard history captures and restores text and images.
- [ ] Local packaged build with dev stopped: `npm run dist` → `release/persephone-setup-X.Y.Z.exe`
      and the zip. It is Authenticode-signed but **not VMP-signed** (no EVS locally), so DRM won't
      play. The user installs and smoke-tests: clipboard, Explorer file copy, voice insertion,
      board clipboard, browser normal/incognito/Tor and media, startup, update check, boards.
- [ ] DRM: VMP-signed playback needs the CI test build (`workflow_dispatch` draft, see
      `doc/standards/release-process.md` → Test Build), or is confirmed at the next release.

### 4. Complete the round

- [ ] Run `/review`, `/document`, `/userdoc` (delegated to Codex). What's New: one line under the
      upcoming version, e.g. "Persephone now uses Electron NN and Chromium NNN."
- [ ] Add a dated row to `doc/tasks/completed.md` and a line to the Round log below.
- [ ] Remove this round's entry from **Active**. The next round's Scheduled entry (step 0) stays.
- [ ] Keep this folder.

## Concerns

- A major can break APIs Persephone uses (US-1756: the renderer lost `clipboard`, and the main
  clipboard became async). The step 1 audit is where that is caught; never skip it on a major.
- `nodeIntegration: true` / `contextIsolation: false` renderers are the most exposed to removals of
  renderer-side Electron modules; grep `require("electron")` in `src/renderer`.

## Acceptance Criteria (per round)

- [ ] `package.json` and `package-lock.json` pin the chosen Castlabs version, and it is installed.
- [ ] Breaking changes audited and handled; typecheck, lint, `build-prod` pass.
- [ ] Live dev check, clipboard-history check and the user's packaged smoke test pass.
- [ ] The next round is on the Scheduled list.

## Round log

| Round | From → to | Notes |
|-------|-----------|-------|
| 2026-11-03 (US-1756) | 43.0.0 → 44.9.3 | Clipboard API migration; client-certificate handler; see `completed.md`. |

## Files Changed Summary

| File | Change per round |
|------|------------------|
| `package.json`, `package-lock.json` | New Castlabs pin |
| `doc/agents-common.md`, `electron-builder.yml` (comment) | Version mentions |
| Code named by the step 1 audit | Breaking-change fixes |
| `assets/guides/whats-new.md` | One-line runtime note |
| `doc/active-work.md`, `doc/tasks/completed.md`, this file | Schedule and round log |
