# US-2189: Named test windows for `--attach --window`

**Epic:** [EPIC-210](../../epics/EPIC-210.md) — item 1  
**Status:** Planned

## Goal

An attached run can select its window by a stable **name** that the runner or an agent gives the
window. Two cases must work:

- the user opens a window, signs in to the app under test there, and every later run reuses that
  window;
- the user keeps the same app open in the main window, and selection still never picks it.

## Background

- `src/main/mcp/ai-vision/test-window-operations.ts` `selectTestWindow()` accepts a decimal record
  index or a case-insensitive OS-title substring; it returns an identity or `{ count }`. The normal
  title starts as `Persephone` (`index.html`), but `MainPageView` can append a profile name. Titles
  are not reliably unique. Page titles were rejected by user review on 2026-11-24: the same app
  can also be open in the main window.
- `src/main/open-windows.ts` `saveState()` saves indices in `openWindows.json`;
  `validateOpenWindows()` currently strips other properties. `restoreState()` loads records but
  `ensureNormalWindow()` opens only one, and can renumber a sole record to 0. A closed record can
  remain when it has retained pages; others are removed. New windows get increasing indices during
  a process; Electron `windowId` identifies a live instance only.
- `TestWindowOperations.createTestWindow()` tracks created identities and waits for renderer
  readiness; `disposeTestWindow()` only disposes tracked identities. `TestWindowOwner` scopes
  calls and checks identity at explicit lifecycle checkpoints, not before every call. Selected
  windows have narrower cleanup than anonymous created windows.

## Implementation plan

1. **Names and persistence — owner: new `src/main/window-names.ts` collaborator**, composed by
   `src/main/open-windows.ts`. Reuse `findWindowDataByIndex()`, `allWindowData()`, the existing
   `JsonFileStore` and `createWindow(index)`; do not add a protocol. The collaborator owns
   normalization, uniqueness, lookup and title projection; `OpenWindows` owns records and saving.
   Extend `OpenWindowData` and `PersistedOpenWindow` with `name?: string`; adjust
   `validateOpenWindows()` to preserve valid names without invalidating the whole legacy store for
   a bad name, and `saveState()` to write them. Deterministically keep the first valid unique name
   on malformed/duplicate persisted entries, clear later invalid names. Names are unique among
   live and restored-pending normal records; explicitly closed windows lose their name even if
   their existing record remains for pages. Attach a close-lifecycle listener in the collaborator
   to clear the name and save any surviving record after an actual individual close; preserve
   names in the existing startup snapshot during application shutdown. Leave `windowOnClose()`
   and its record-retention rules unchanged; hiding a window is not a close. Trim, require 1–64
   ASCII characters from `[A-Za-z0-9 ._-]`, compare with `toLowerCase()`, preserve spelling;
   `null` clears a name. Reject non-strings, blank strings, board or missing records, and assigning
   a name to an explicitly closed record. Rename of the same record is allowed. Save immediately
   after a successful set/clear.

   ```ts
   // Before: validateOpenWindows / saveState discard names
   return raw.map((window) => ({ index: (window as PersistedOpenWindow).index }));
   // After: preserve each valid, unique name using the collaborator
   return normalizePersistedWindowNames(raw); // returns { index, name? }[]
   // saveState: ({ index: w.index }) -> ({ index: w.index, ...(w.name ? { name: w.name } : {}) })
   ```

   Apply the current name when `createWindow()` binds an existing or new record. The collaborator
   maintains the renderer-supplied base title separately, listens to `page-title-updated` on the
   normal `BrowserWindow`, seeds the base from `getTitle()`, prevents Electron's default title update and sets `${base} — ${name}`
   (or `base` when cleared); update immediately on rename. This preserves profile suffixes and
   avoids accumulating suffixes on reload. Board titles remain under their existing owner. Reuse
   the `page-title-updated` / `preventDefault()` pattern in `src/main/browser/popup-policy.ts`.

2. **AiVision and selection — owners: `src/main/mcp/ai-vision/main-root.ts` and
   `src/main/mcp/ai-vision/test-window-operations.ts`.** Add `name` to `WINDOW_MEMBER_NAMES` and
   `WINDOW_MEMBERS` with `writable: true`; `WindowNode` getter/setter delegates to the name owner.
   Include it in `summarize()` and help. AiVision assignments use the existing `ai:set` boundary.
   Expose `WindowsNode.createOrSelectNamedTestWindow(name)` in `WINDOWS_MEMBERS`; delegate to
   `TestWindowOperations` and reuse `waitForWindow`, `assertLive`, `identityOf`, and the existing
   tracked-creation cleanup on failure. Reserve/name a new record synchronously before awaiting
   readiness so simultaneous requests cannot create duplicates; if setup fails remove the new
   record via existing disposal. Select only a live match; never reopen a closed or
   restored-pending record. If a restored-pending record already owns the requested name, report
   a conflict and direct the user to open or rename that record rather than create a duplicate.
   On success remove a
   newly created identity from `created` so teardown cannot dispose it. Return `{ index, windowId,
   name, created }`; if an existing window is still starting, await its `whenReady` as well.

   In `selectTestWindow`, parse `name:` before numeric/title branches and use exact normalized
   lookup restricted to live normal windows; missing name returns `{ count: 0 }`. Reject malformed
   names. Preserve legacy numeric and title behavior, including the existing numeric branch's ability
   to select a board window; names themselves cannot be assigned to boards. Add name to returned
   live identities when present. Bare title matching still uses `getTitle()`.

   ```ts
   // Before
   { name: "windowId", kind: "property", summary: "Live Electron window identity; absent when this window is closed." },
   // After (alongside windowId)
   { name: "name", kind: "property", writable: true, summary: "Persistent normal-window name; set null to clear." },
   // selectTestWindow: numeric/title only -> first handle selector.startsWith("name:")
   ```

3. **CLI and ownership — owners: `src/main/test-mode/arguments.ts`,
   `src/main/test-mode/controller.ts`, `src/test-host/launcher.ts`,
   `src/test-host/test-window.ts`.** Add `windowName?: string` through `TestControllerArguments`,
   `startTestController()` configuration and `HostConfiguration`. Extend
   `hasTestControllerArguments()` and `parseTestControllerArguments()` for both `--window-name X`
   and `--window-name=X`, duplicate/missing values, require `--attach`, and reject combination with
   `--window`. Validate the name on the main-process owner as well as reporting CLI errors. Existing
   JSON configuration transport and AiVision calls are sufficient.

   ```ts
   // Before: TestWindowOwner.start(client, attach, selector?)
   if (selector === undefined) return /* createTestWindow; attached-created */;
   // After: start(client, attach, selector?, windowName?)
   if (windowName !== undefined) return /* createOrSelectNamedTestWindow; attached-selected */;
   if (selector === undefined) return /* existing anonymous creation */;
   ```

   Use `attached-selected` for both named creation and reuse: `browser-helpers.ts`,
   `test-attempt.ts`, and `test-file-run.ts` already implement its conservative cleanup, and
   `runner.ts` already leaves it open. This avoids a new mode and accidental cleanup of an adopted
   signed-in page. Keep `assertIdentity` behavior. Return a clear missing-name error for `name:`;
   preserve count errors for other selectors. Fetch the actual `windows[i].name` for owned windows
   as well, so reporting covers every mode.

4. **Run identity — owners: `src/test-host/runner.ts` and
   `src/test-host/json-lines-reporter.ts`.** Expose the selected identity read-only from
   `TestWindowOwner`. Move `reporter.runStart()` until after `TestWindowOwner.start()` and before
   test events; add optional `testWindow: { index, windowId, name? }`. Keep the `finally` fallback
   run-start without identity on setup failure, before synthetic test events (move the fallback
   ahead of that loop). Human output after selection: `Test window: [7] "app-tests" (windowId 12)`;
   omit the quoted name when absent. JSON mode must write only JSON to stdout; use the existing
   redirected console for human diagnostics and the reporter's `write()` for the structured event.
   Update run-start schema descriptions in `assets/guides/agents/web-app-tests/run-options.md` and
   `doc/standards/integration-tests.md`.

   ```ts
   // Before
   reporter?.runStart(started, discoveredFileCount, selectedTestCount);
   // After, once selection succeeds
   reporter?.runStart(started, discoveredFileCount, selectedTestCount, testWindow.identity);
   ```

5. **Documentation and verification.** Update
   `assets/guides/agents/web-app-tests/attached-runs-and-results.md`,
   `assets/guides/agents/web-app-tests/run-options.md`, `doc/standards/integration-tests.md`, and
   `assets/guides/whats-new.md`: name once/create-or-reuse, sign in with a normal browser profile,
   `ctx.usePage` session adoption, selector forms, restart and close behavior, cleanup and reporting.
   Extend `integration-test/tests/core/mcp/mcp.test.mjs` for writable names, validation, duplicate
   and board rejection, selection, title and lifecycle; extend
   `integration-test/tests/core/session/session.test.mjs` with a `launch` restart case using
   `ctx.restartApp()`. Exercise CLI create/reuse, selector compatibility, conflict errors, JSON
   ordering and session preservation using the existing UI integration runner and a local fixture;
   no unit tests or new harness. Run relevant integration cases, `npm run typecheck`, `npm run lint`
   and `npm run guides:check` during implementation.

## Concerns

- **Restart and close:** only names in the existing startup snapshot survive an application restart;
  explicit window close drops the name. A restored-pending record reserves its name under the
  existing lifecycle, but is not automatically opened. Persisting the name does not itself persist
  a browser page: pin the signed-in page under the existing session rules and use a normal profile.
- **Concurrency:** reserve before the first await; concurrent callers share the same readiness
  promise, and failure cleanup must not dispose an existing record. Rename/close during a run does
  not retarget it; identity checkpoints detect close or replacement.
- **Title:** the base may include a profile name, so retain it rather than hardcoding `Persephone`.
  Exact `name:` is the reliable selector; title substring remains compatible and can be ambiguous.
- **Bridge:** this uses the existing AiVision tree and does not change `window.persephone`; no
  `BOARD_BRIDGE_VERSION` bump is needed. No board rule, new protocol, import-zone bypass or roadmap
  §2.3 god-file growth is planned.

## Acceptance criteria

- [ ] An agent can set, read, rename and clear `windows[i].name`; invalid and duplicate names and
      board names fail; the title updates, explicit close drops the name, and it survives restart
      for a window in the existing startup snapshot.
- [ ] `--attach --window name:app-tests` selects the exact named live window even with the same app
      in another window, and reports a clear error when absent.
- [ ] `--attach --window-name app-tests` creates and reuses a live named window and leaves it open;
      its signed-in session can be adopted and survives cleanup. A restored-pending name reports a
      conflict without reopening or creating a duplicate.
- [ ] Human and JSON-lines output identify the selected window before tests; setup failures still
      produce correctly ordered JSON events.
- [ ] Numeric and bare-title selection and anonymous attached cleanup retain their behavior;
      CLI conflicts and naming races are covered by UI integration verification.

## Files changed

| File | Change |
|---|---|
| `src/main/window-names.ts` (new) | Name, uniqueness, persisted-name normalization and title rules |
| `src/main/open-windows.ts` | Record persistence and collaborator lifecycle |
| `src/main/mcp/ai-vision/main-root.ts` | Writable property and named operation descriptors |
| `src/main/mcp/ai-vision/test-window-operations.ts` | Named selection, reservation, readiness and lifetime |
| `src/main/test-mode/arguments.ts`, `src/main/test-mode/controller.ts`, `src/test-host/launcher.ts` | Parse and forward option |
| `src/test-host/test-window.ts`, `src/test-host/runner.ts`, `src/test-host/json-lines-reporter.ts` | Selected ownership and identity reporting |
| `integration-test/tests/core/mcp/mcp.test.mjs`, `integration-test/tests/core/session/session.test.mjs` | UI integration coverage |
| `assets/guides/agents/web-app-tests/attached-runs-and-results.md`, `assets/guides/agents/web-app-tests/run-options.md`, `assets/guides/whats-new.md`, `doc/standards/integration-tests.md` | Workflow and output documentation |

**No changes:** `src/ipc/test-host-protocol.ts` (existing configuration transport),
`src/test-host/browser-helpers.ts`, `src/test-host/test-attempt.ts`,
`src/test-host/test-file-run.ts`, `src/test-host/failure-bundle.ts` (existing selected-mode policy),
`src/main/open-window.ts` (normal-window title listener attaches to its `BrowserWindow`), browser
automation and site-model bridge, and the board bridge.
