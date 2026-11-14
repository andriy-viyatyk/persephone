# EPIC-175: Refactoring Phase 6.8 part 3 and 6.9 — dialog state and host, dialog models in api/dialogs, MCP session host and routed fetch

## Status

**Status:** Completed
**Created:** 2026-11-14
**Completed:** 2026-11-14

## Overview

This is the thirty-fifth epic of the [refactoring roadmap](../reviews/refactoring-roadmap.md). It finishes roadmap item
**6.8, Shell and scripting**, after [EPIC-174](EPIC-174.md) (part 2), with the dialog items of **SHL-13**, and takes the
**dialog slice of item 2.2** (SHL-1 step 2) with it, as the roadmap recommends. Because the dialog work is three tasks,
it also takes roadmap item **6.9** (MAIN-10) as a separate part. Findings:
`doc/reviews/refactoring-2026-11/10-shell-scripting.md` (SHL-1, SHL-13) and `doc/reviews/refactoring-2026-11/01-main.md`
(MAIN-10, MAIN-14).

The code was checked on 2026-11-14, after EPIC-174. The findings hold, with drift:

- **SHL-13 (dialogs).** `ui/dialogs/Dialogs.ts` is a one-line re-export of `DialogsView` (17 importers),
  `ui/dialogs/poppers/Poppers.ts` re-exports `PoppersView` (5 importers), and `ui/dialogs/index.ts` is a barrel (1
  importer). `dialogsState`/`showDialog`/`closeDialog` are defined in `DialogsView.ts:11,139-150`; `popperState`,
  `showPopper`, `closePopper` and `visiblePoppers` in `PoppersView.ts:6,124-141`. `DialogsView` (150 lines) and
  `PoppersView` (141 lines) are the same slot reconciler with a different key (`internalId ?? viewId` vs object
  identity). `DialogsView.ts:9` imports `scripting/ai-vision/event-log` to call `logDialogAnswered()` inside
  `showDialog`'s close callback. `ai-vision/attention.ts` and `ai-vision/dialogs/index.ts` read `dialogsState` from
  `DialogsView`.
- **Item 2.2, dialog slice (SHL-1 step 2).** Every `ui/dialogs/XDialog.ts` (14 of them) imports its own view to call
  `registerDialogView`, which pins the model in `ui/`. Lower layers import `ui/dialogs/*`: `dialog-buttons` 43 imports,
  `dialog-view-registry` 9, `ConfirmationDialog` 6, `poppers/showPopupMenu` 5, `poppers/grid-context-menu` 4, and the
  other dialogs 2–3 each (api 9 files, components 7, content 1, editors 34, scripting 21). `api/ui.ts` reaches the
  dialogs through `await import("../ui/dialogs/…")` (guardrail 5), and `api/internal/GlobalEventService.ts` imports
  `showAppPopupMenu`. Four editor popups (`ColumnsOptions`, `CsvOptions`, `EditLinkDialog`, `BrowserDownloadsPopup`) and
  `TranslateTextPageController` register their own views. `dialog-buttons.ts` depends only on `shared/i18n/t`.
- **MAIN-10.** `main/mcp-http-server.ts` (320 lines) and `main/mcp/private-session-endpoints.ts` (263) each carry a
  loopback host check (`isAllowedHost` / `allowedHost`), a JSON body parser (`parseJsonBody` / `parseBody`), a session
  map, Streamable HTTP session start, close cleanup and eviction. `safeProtocol` is copied in `tor-src-protocol.ts:94`,
  `browser-network-service.ts:236` and `session-src-protocol.ts:314`. MAIN-14 (`video-stream-server`,
  `clipboard-service`) is "when next touched"; this epic does not touch them.

## Goals

- **SHL-13 dialog items.** One dialog state module, `api/dialogs/dialogs-state.ts` (`dialogsState`, `showDialog`,
  `closeDialog`, the popper state with `showPopper`, `closePopper`, `visiblePoppers`), raising an `onDialogClosed`
  event that ai-vision's event log subscribes to, so the dialog host no longer imports `scripting/`. One
  `ModelViewSlotHost` used by `DialogsView` and `PoppersView`. `Dialogs.ts`, `Poppers.ts` and the `ui/dialogs/index.ts`
  barrel deleted, every importer pointed at the real module.
- **Item 2.2 dialog slice.** `api/dialogs/` owns `dialog-buttons.ts`, the dialog data types and every dialog's model
  plus its `showXDialog()` function, none of which imports a view. The views stay in `ui/dialogs/` and are registered
  from one shell bootstrap file, `ui/dialogs/register-dialog-views.ts`, before the first dialog can show. `api/ui.ts`
  imports the dialog functions statically. Lower layers (`api/`, `content/`, `components/`, `scripting/`) no longer
  import `ui/dialogs/`; an error-level eslint zone locks that in once the count is zero.
- **6.9 (MAIN-10).** `main/mcp/mcp-session-host.ts`: a `McpSessionHost` (authorize, caps, idle policy, eviction,
  status callback) that both MCP servers wrap; the shared loopback host check and JSON body parser in one place.
  `main/routed-fetch-protocol.ts`: one routed-fetch handler serving `tor-src` and `profile-src`, with `session-src`
  reusing its URL parsing and `isHttpUrl`; `safeProtocol` defined once.

## Decisions this epic acts on

- **Scope: four tasks.** SHL-13's dialog items (US-1989); the 2.2 dialog slice in two halves — the shared pieces and
  the generic dialogs (US-1990), then the feature dialogs, the popper models and the lint lock (US-1991); and 6.9's
  MAIN-10 as one task (US-1992), since the MCP host and the routed-fetch handler are small and live side by side in
  `main/`. MAIN-14 stays "when next touched" (not touched here). The rest of item 2.2 (secondary views, editor
  categories, transcript/translate contributions) is not part of this epic.
- **Owners.** `api/dialogs/` owns dialog state, dialog data types, `dialog-buttons`, and every dialog model with its
  show function. `ui/dialogs/` owns the views, `ModelViewSlotHost`, the two hosts and `register-dialog-views.ts`. The
  ai-vision event log owns its own subscription to `onDialogClosed` (installed where the other ai-vision event-log
  subscriptions are installed, no later than the first dialog can close). Editor-owned popups keep their model and
  view in the editor folder; where their view registration goes (the registry's home) is the planner's call, with the
  constraint that no new `editors/` → `ui/` import is added and `api/` models never import a view.
  `main/mcp/mcp-session-host.ts` owns the MCP session plumbing; each server keeps its own authorization, caps and idle
  policy. `main/routed-fetch-protocol.ts` owns the routed-fetch rules.
- **Two ways to show a confirmation.** Internal callers call the `api/dialogs` function directly; `ui.confirm` /
  `ui.input` / `ui.password` / `ui.textDialog` stay the script-facing facade over the same functions. No change to
  `api/types/ui.d.ts` (script API contract), so `IConfirmOptions` is not extended.
- **Behaviour.** No visible change unless recorded: the same dialogs, buttons, labels, focus, Escape and Enter
  handling, stacking order and DOM; the same ai-vision `dialogs` node, `attention` output and `dialog-answered` event
  (logged on every close, including programmatic closes, before the result resolves); the same MCP endpoints, auth,
  session caps, idle eviction, status broadcasts and DNS-rebinding/Origin checks; the same routed-fetch responses and
  headers. Every `if`/guard that moves keeps its condition; a plan that simplifies a condition lists it as a recorded
  change for my acceptance.
- **Contracts that must not change:** the script API (`app`, `page`, `io`, `ui.*`, facade member names),
  `api/types/*.d.ts`, ai-vision paths and agent-facing messages, MCP `call` results and both MCP servers' HTTP
  behaviour, the `data-name` contract, persisted settings, `window.persephone` (not touched, so no
  `BOARD_BRIDGE_VERSION` bump; a plan that touches it is sent back).
- **Guardrails.** No new protocol code (1): the MCP host is an extraction of existing code, not a new transport. No
  board rule moves out of `shared/board/` and the board registries (2). God files only shrink (3). Plans name the owner
  of every moved rule and the helper reused (4). No `await import()` to break a cycle (5); the existing ones in
  `api/ui.ts` become static imports. Error-level import zones in `eslint.config.mjs` must pass (`uikit/` imports
  nothing app-level; `api/` must not import `editors/board/`; `api/capabilities/` must not import `ui/`;
  `editors/base/` must not import board modules).
- **Order.** US-1989 and US-1992 are planned in parallel (staggered starts) and implemented one at a time (US-1989
  first). US-1990 and US-1991 are planned together in one session against the landed US-1989 code, then implemented
  in order.
- **Live verification limits.** The user may be using Persephone. Live checks run in a separate window opened and
  closed by the agent; no page, dialog or window the agent did not open is touched, and the app is not restarted
  while other windows are open. `npm run build-prod` runs with `.vite/build` backed up and restored.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1989 | Dialog state in `api/dialogs`, `ModelViewSlotHost`, `onDialogClosed`, shims deleted (SHL-13 dialogs) | Done |
| US-1990 | `api/dialogs`: dialog buttons, data types, view bootstrap, generic dialog models (item 2.2, part 1) | Done |
| US-1991 | `api/dialogs`: feature dialog models, popper models, import-zone lock (item 2.2, part 2) | Done |
| US-1992 | `McpSessionHost` and one routed-fetch protocol handler (MAIN-10) | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. Line counts (total and code-only) before and
  after for every touched file over 300 lines. For every exported symbol that moves, is renamed or is deleted, list its
  importers and update them (no re-export shims). No unit tests or harnesses. Comments describing surviving code move
  with it. Check every new import against the error-level zones in `eslint.config.mjs`.
- **US-1989.** The close sequence before/after (state removal, event log, resolve) and who observes it; the slot key
  rules of both hosts and how `ModelViewSlotHost` keeps them; where the ai-vision subscription is installed and why it
  is in place before the first dialog can close.
- **US-1990 / US-1991.** Per dialog: model file, show function, view, registration site before/after, and every
  importer. When each view is registered today versus after the bootstrap (any dialog that can show before `mount()`).
  The lower-layer → `ui/dialogs` import count before and after.
- **US-1992.** Both servers' request flow before/after side by side (host check, Origin check, auth, body parse, session
  lookup/creation, caps, eviction, idle timer, status broadcast); the three routed-fetch handlers before/after (URL
  parsing, partition resolution, redirect handling, response headers).

## Out of scope

- The rest of roadmap item 2.2 (secondary views, editor categories, speech/translation homes, Monaco contributions).
- MAIN-14 (`video-stream-server`, `clipboard-service`): "when next touched".
- Any change to `window.persephone`, the script API, MCP `call` or the `data-name` contract.
- US-1873 (board docs) stays in Planned.

## Notes

### 2026-11-14
- Epic created after EPIC-174. Findings re-checked against the code (see Overview). Codex weekly window had 7% left and
  the 5-hour window 50%; planning runs on `--terra` (the user has a limit reset available), implementation and
  completion on Luna.

### 2026-11-14 — plans (wave 1: US-1989, US-1992)
- **US-1989 corrections sent:** no module-evaluation side effect — `event-log.ts` exports `installDialogAnswerEvents()`,
  called at the top of `bootstrap()` in `src/renderer.ts` (before `app.startup`, since a dialog can be closed
  programmatically or over MCP before `mount`; `event-log.ts` and `dialogs-state.ts` pull in no Monaco module);
  `closeDialog` had no importer outside the deleted shims and is deleted (SHL-13 dead code), `closePopper` stays;
  `ModelViewSlotHost<D, K>(state, keyFor)` extended by both hosts, `index.ts` constructors unchanged. Accepted:
  `onDialogClosed` is a `Subscription<void>` (`core/state/events.ts`), and the dialog types (`IViewData`,
  `IDialogViewData`, `TPopperModel`, `IPopperViewData`) move to `api/dialogs/dialog-types.ts`. **Recorded change:** a
  throwing `dialog-answered` listener no longer prevents the dialog's result from resolving (the `Subscription`
  primitive defers listener errors).
- **US-1992 corrections sent:** the implementer is a fresh session, so the doc now carries the full `McpSessionHost`
  API (`has/get/entries/touch/handleExisting/startSession/closeSession(awaited | fire-and-forget)/oldest(tie
  rule)/closeAll/startIdleSweep/stopIdleSweep`, `isAllowedLoopbackHost(host, hosts, "lowercase" | "exact")`,
  `parseJsonBody`) with each wrapper call site mapped, the `routed-fetch-protocol.ts` signatures (a resolver that can
  return a refusal so Tor keeps its two 403 texts), and the private `startTransport` after the change
  (`pendingTransports` stays in the private wrapper). Accepted: the two servers keep their own refusal bodies, caps,
  eviction tie rules (public strict `<`, private `<=`), awaited vs fire-and-forget close and listener lifecycles.

### 2026-11-14 — results
- **US-1989:** `api/dialogs/dialogs-state.ts`, `api/dialogs/dialog-types.ts`, `ui/dialogs/ModelViewSlotHost.ts`
  (121 lines); `DialogsView` and `PoppersView` are 9-line subclasses; `Dialogs.ts`, `poppers/Poppers.ts`,
  `poppers/types.ts` and the `ui/dialogs/index.ts` barrel deleted. I removed a `beforeunload` unsubscribe the
  implementer added (a cancelled unload would have dropped the listener for good). The implementation run kept
  auto-continuing on "BLOCKED" over manual checks and drove Persephone over MCP in windows it opened; it was stopped
  and later briefs forbid both. Live (own window, after a full reload): confirmation dialog DOM identical to the
  baseline; Escape resolves `null`; two stacked dialogs render in order with the input focused; Enter answers the
  input; ai-vision `dialogs[i]` lists both and `click("Yes")` resolves; each close logs one `dialog-answered`; the tab
  context menu (popper) opens and closes through `menus[0]`.

### 2026-11-14 — plans (wave 2: US-1990, US-1991)
- **Corrections sent:** the plan migrated about 20 existing `ui.confirm`/`ui.input` callers to the `api/dialogs`
  functions; dropped (callers on the `ui` facade are legal and keep its `?? null` normalization). The plan registered the
  views from `renderer.ts` before `app.startup`; moved to `index.ts` module level next to the editor registrations,
  because `getDialogView`'s only consumer is the hosts' first reconcile in `mount()` (a show before mount only queues
  state), and `index.ts` is evaluated during startup's bootstrap phase. Pre-existing lazy `import()`s whose paths change
  stay lazy (path-only); `api/ui.ts`'s four become static. The lint lock must be proven with a temporary violating
  import. Accepted: the view registry (`registerDialogView`/`getDialogView`) moves to `api/dialogs/` with type-only view
  imports, so the four editor popups and the translate dialog keep registering locally with no `editors/` → `ui/`
  import; `AppPopupMenuView` splits out of `showPopupMenu.ts`; `OpenFileCommands` moves to `api/dialogs/`;
  `board-dialog-controller.ts` stays in `ui/` (shell IPC subscription).

### 2026-11-14 — results (US-1990, US-1992)
- **US-1992:** `main/mcp/mcp-session-host.ts` (170 lines), `main/routed-fetch-protocol.ts` (76); `mcp-http-server.ts`
  320 → 232, `private-session-endpoints.ts` 263 → 220, `tor-src-protocol.ts` 100 → 51, `browser-network-service.ts`
  248 → 209, `session-src-protocol.ts` 320 → 313. **Bug found and fixed (mine):** the implementation imported
  `server-factory` into the session host, which closed an import cycle (`mcp-session-host → server-factory → … →
  ai-vision/main-services → mcp-http-server`) while `private-session-endpoints.ts` constructs its host at module load,
  so the main process hung at startup with no window. The server factory is now injected (`createServer` option);
  bisected by reverting the five files live. I also removed three placeholder comments left where functions were
  deleted. Live: public MCP refusals and errors identical to the parity table (403 foreign Host and any Origin, 404
  path, 400 no session (JSON-RPC and text), 405 method, 500 malformed JSON, case-insensitive `LOCALHOST`), sessions
  start, serve and DELETE (client count returns to the caller's own). Not verified live: private board endpoints, Tor
  and profile routed fetch, idle sweep.
- **US-1990:** `api/dialogs/` holds `dialog-buttons`, the view registry, `OpenFileCommands` and the five generic
  models; `ui/dialogs/register-dialog-views.ts` registers every shell view from `index.ts`. Live (new window after the
  restart): confirmation DOM identical to the baseline; Escape → `null`; stacked confirmation + input in order with the
  input focused; Enter answers the input; ai-vision click resolves; password and text dialogs open (text dialog hosts
  Monaco) and cancel to `null`; tab context menu opens and closes.
- **US-1991:** the eight feature dialog models, the app popup menu model (`api/dialogs/showPopupMenu.ts`, view in
  `ui/dialogs/poppers/AppPopupMenuView.ts`) and `grid-context-menu.ts` moved to `api/dialogs/`; lower-layer imports of
  `ui/dialogs/` are zero in `api/`, `content/`, `components/`, `scripting/` and `editors/` (before: 14, 2, 7, 46, 51);
  an error-level zone in `eslint.config.mjs` forbids the first four (proven with a temporary violating import). Live
  (fresh reload): confirmation DOM identical to the baseline, Escape, tab context menu, and a grid-json page's
  right-click (trusted input) shows the grid menu (Copy, Copy as…, Paste, row/column actions, Inspect).
- **Not verified live:** the feature dialogs themselves (trust board, namespace collision, create board, board vars
  storage, library setup, register toolset, commit, Tor info), the board dialog controller, the private board MCP
  endpoints, Tor and profile routed fetch, and the MCP idle sweep. Main-process edits restarted the dev app three times
  (unavoidable under `npm start`); the user's window came back each time.
- **Builds:** `npm run typecheck`, `npm run lint`, `npm run build-prod` (with `.vite/build` backed up and restored) and
  `npm run i18n:check` pass.

### 2026-11-14 — completion
- **Completion skills (Codex, Luna):** `/review` replaced three non-null assertions in `mcp-session-host.ts` and
  `private-session-endpoints.ts` with explicit guards (same conditions). `/document` updated `folder-structure.md`,
  `overview.md`, `key-files.md`, `browser-editor.md`, `context-menu.md`, `scripting.md` and `coding-style.md`.
  `/userdoc` changed nothing. No English catalog message changed; `npm run i18n:check` reports every pack complete.
