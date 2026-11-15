# US-2019: Dependency refresh (recurring)

> **Recurring task.** This document is reused for every refresh round. Do **not** delete this folder
> when a round completes, and do not move the task to `completed.md` as finished. Record each round
> in the **Round log** below and in `doc/tasks/completed.md` as a dated row
> (`US-2019 (round YYYY-MM-DD)`).

## Goal

Keep every npm dependency on its current release, so upgrades stay small and routine. The user's
policy is to stay current rather than let packages age until an upgrade becomes a migration project.

## Background

- The first full refresh was [EPIC-179](../../epics/EPIC-179.md) (2026-11-15). Its task rows record
  what each major upgrade needed. The lessons are built into the steps below.
- **Electron is not part of this task.** The Castlabs Electron pin has its own recurring task,
  [US-1757](../US-1757-castlabs-electron-upgrade/README.md).
- `@types/node` follows **Electron's Node major** (Electron 44 → Node 24 → `@types/node ^24`), not the
  npm latest. Move it only when US-1757 moves Electron to a new Node major.
- Packages that look unused but are build inputs: `react`/`react-dom`, `@excalidraw/*` (vendored into
  the Excalidraw board by `npm run build-board-lib`); `@codemirror/*`, `@lezer/highlight` (the REST
  Client board's CodeMirror bundle, `npm run build-rest-client-lib`). The three `@codemirror/*`
  packages are **pinned exactly**, so they move together and only on purpose.
- `patches/` holds `patch-package` patches named after the patched version. A version bump means
  re-creating the patch for the new version (or deleting it when upstream fixed the problem).
- **Codex has no network.** It cannot `npm install`, and esbuild child processes fail with `spawn
  EPERM` in its sandbox, so Claude runs the installs and the board-library rebuilds. Codex can do
  code changes against packages that are already installed.

## Watch list (open items from earlier rounds)

| Item | Status | What to check this round |
|---|---|---|
| **TypeScript 7** (former US-2017) | Blocked, checked 2026-11-15: TypeScript 7.0.2 is released, but typescript-eslint 8.72.2 requires `typescript >=4.8.4 <6.1.0`. We are on **6.0.3** since US-2021 (the bridge release; its deprecations are already handled). | `npm view typescript-eslint peerDependencies`. When 7 is allowed: 7 is the Go-native compiler, so first establish whether a JS compiler API package exists for `scripts/typecheck-strict.mjs` (it uses the compiler API) and how `monaco-project-intellisense` is affected (it runs Monaco's bundled TS, not ours). Make it its own task with a task document. |
| `eslint-plugin-import` | Replaced by `eslint-plugin-import-x` in US-2016 (ESLint 10). | Nothing; do not switch back. |
| `video.js` | Removed in US-2018: HLS uses native controls over our own hls.js. | Nothing. |
| `BrowserWebviewModel.restoreClaimedNavigation` | Ignores its `reportedCanGoBack` argument (found by ESLint 10, US-2016); behavior left unchanged. | Not a dependency item; listed so it is not lost. Ask the user whether it should be the fallback when `webview.canGoBack()` throws. |

## Implementation Plan

### 0. Keep the schedule going (do this first, when the round is picked up)

- [ ] Move this round's entry from **Scheduled** to **Active** in `doc/active-work.md`.
- [ ] Add a **new** Scheduled entry for the next round, about **3 months** later, sorted by date:
      `- [ ] **YYYY-MM-DD** — [US-2019: Dependency refresh (recurring)](tasks/US-2019-dependency-refresh/README.md) — next round; see the doc for the procedure`

### 1. Survey

- [ ] `npm outdated` — split the result into in-range updates and major upgrades.
- [ ] Check for unused packages: for each dependency, grep `src/`, `scripts/` and the configs for its
      import. Remember the build inputs listed in Background.
- [ ] Go through the **Watch list** above.
- [ ] Write the round's plan into the **Round log** entry: the in-range batch, then one line per major.
      If the round has several majors, the user may prefer an epic (as EPIC-179) with a task per major.

### 2. In-range updates (one batch)

- [ ] `npm update` (or targeted installs), then re-create any patch whose package moved and rerun the
      board-library builds if their inputs moved.
- [ ] `npm run typecheck`, `npm run lint`, `npm run build-prod`, and a cold `npm start` smoke check.

### 3. Major upgrades (one per commit)

For each major:

- [ ] Read the release notes and migration guide for every major crossed, and grep our usage of the
      package (file:line). EPIC-179 showed the breaks are often semantic, not compile errors:
      simple-git 4 threw on our `GIT_*` environment variables; jschardet 4 changed its confidence
      scale, which silently disabled our threshold; ESLint 10 added recommended rules.
- [ ] When behavior is uncertain, probe it in an isolated folder under `%TEMP%` (install the old and
      new versions side by side with npm aliases, e.g. `pkg3@npm:pkg@3`) and compare on real inputs.
- [ ] If the new major is a different product or a rewrite (video.js 10), stop and ask the user:
      migrate, stay on the old line (record why and until when it is supported), or drop the package.
- [ ] Upgrade, fix, run typecheck / lint / build-prod, and verify live in a cold-started Persephone
      (the editor or service the package serves). After a lockfile change, stop Persephone and the
      dev server, delete `node_modules/.vite`, and `npm start` again; the user then reconnects MCP.
- [ ] A blocked major (the ecosystem is not ready) is not forced: add it to the Watch list with the
      date checked and the blocker.

### 4. Complete the round

- [ ] Run `/review`, `/document`, `/userdoc` (delegated to Codex on Luna). Translate new UI text, if
      any, per `doc/agents-common.md`.
- [ ] Add a dated row to `doc/tasks/completed.md` and a line to the Round log below. Update the
      Watch list.
- [ ] Remove this round's entry from **Active**. The next round's Scheduled entry (step 0) stays.
- [ ] Keep this folder.

## Concerns

- A green build proves little for a runtime library. Each major needs a live check of what it serves.
- Vendored board libraries are committed output: forgetting the rebuild leaves the board on the old
  package even though `package.json` moved.

## Acceptance Criteria (per round)

- [ ] `npm outdated` shows only packages on the Watch list, each with a recorded reason.
- [ ] No unused packages.
- [ ] Patches apply; vendored board libraries rebuilt where their inputs moved.
- [ ] Typecheck, lint, `build-prod` pass; live checks done for every major.
- [ ] The next round is on the Scheduled list.

## Round log

| Round | Scope | Notes |
|-------|-------|-------|
| 2026-11-15 (EPIC-179) | In-range batch; d3 removed; Monaco 0.57, Mermaid 12, electron-store 12, simple-git 4, jschardet 4, ESLint 10 (import-x); TypeScript 6; video.js removed | TypeScript 7 blocked (Watch list). Details in the EPIC-179 task table. |

## Files Changed Summary

| File | Change per round |
|------|------------------|
| `package.json`, `package-lock.json` | Version bumps and removals |
| `patches/*.patch` | Re-created for new versions or deleted |
| `assets/boards/excalidraw/lib/**`, `assets/boards/rest-client/lib/codemirror.js` | Rebuilt when their inputs move |
| Code named by the step 3 audits | Breaking-change fixes |
| `doc/active-work.md`, `doc/tasks/completed.md`, this file | Schedule, round log, watch list |
