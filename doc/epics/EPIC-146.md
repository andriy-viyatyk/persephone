# EPIC-146: Refactoring Phase 4.1 and 4.2 — the frame protocol and the board editor runtime split

## Status

**Status:** Completed 2026-11-11
**Created:** 2026-11-11
**Completed:** 2026-11-11

## Overview

The sixth epic of the [refactoring roadmap](../refactoring-roadmap.md), and the first part of Phase 4 (board bridge
and runtime decomposition). It covers the renderer side of the board↔host frame bridge: the message contract both ends
share, and the two god classes that serve it.

- **4.1, BND-2 and BRD-11: the frame protocol.** About 40 hand-paired message types with no direction typing become
  `req`/`res`/`evt` envelopes with per-direction method maps. The shim gets one `HostFrameChannel` and the renderer one
  `BoardFrameEndpoint`, so request/reply pairing is written once on each side. `board-bridge-channels.ts` (862 lines,
  four unrelated contracts) splits into `src/ipc/board-bridge/`.
- **4.2, BRD-1: `BoardWebview` (1,691 lines)** splits into a `BoardFrameSession` with one `retire(reason)` teardown, a
  `BoardHostRouter` with feature handler modules, and a thin view.
- **4.2, BRD-2, BRD-4 and BRD-5: `BoardEditorModel` (1,476 lines)** keeps the editor façade and composes collaborators:
  `BoardFrameRegistry` first, then `BoardFrameChrome`, `BoardAiVisionChannel`, `BoardSourceInbox`,
  `BoardPageStateStore` and `BoardContentResources`.

The main-side split (4.3, `board-bridge.ts` and the port RPC), the shim split (4.4), the module-service host (4.5) and
`ContentHostSlot` (4.6) are later epics. This one changes the shim only where the frame protocol requires it, and it
gives 4.4 a `HostFrameChannel` to build on.

Already done in earlier epics, so not in scope: page-state validation is shared (`src/shared/board/page-state-validation.ts`),
the board-editor factory and `findByRoot` (BRD-3, EPIC-144), and the capability frame dispatcher
(`api/capabilities/BoardCapabilityDispatcher.ts`, EPIC-145).

## Goals

- One frame message contract with direction typing. A host→board message cannot be passed where a board→host one is
  expected, and the reply type of a request is derived from one map, not written at each call site.
- Every gated board request gets a reply when the gate fails. Today only the page-state, source-navigate and fetch requests do (`BoardWebview.ts`, the
  `dispatchBoardMessage` ternary); the rest wait for their own timeout (roadmap bug #12).
- One liveness check for a frame (`session.post` / `isCurrent`) instead of about 37 hand-spelled ones.
- One ordered teardown per frame (`retire(reason)`), with a written table of what each reason clears. The five drifting
  teardown lists go.
- `BoardWebview` builds the DOM and owns a session; it holds no protocol handlers and no feature logic. Target: under
  200 lines, and the plan for the last task states the real number.
- `BoardEditorModel` holds no frame maps, AiVision transports, source inbox, page-state queues, content-resource maps or
  chrome slots. `getRestoreData`, `restore` and `dispose` stop listing transient fields by hand.
- No module-level mutable state in the board editor: the notify rate limiter gets an owner.

## Decisions this epic acts on

- **Roadmap §8:** private wire protocols between the shim and the renderer ship together and may change without a
  bridge bump. `window.persephone` does not change in this epic, so `BOARD_BRIDGE_VERSION` does not move; every plan that
  touches `src/board-shim.ts` confirms it by diffing the public surface.
- **D7:** board modules stay under `editors/board/` (`frame/`, `model/`, `chrome/` subfolders) and `api/`; no new
  top-level layer.

## Linked Tasks

Task documents are written per task when it is picked up. The finding IDs point at the area reports in
[`doc/reviews/refactoring-2026-11/`](../reviews/refactoring-2026-11/) (BND-2 in `02-boundary.md`; BRD-1, BRD-2, BRD-4,
BRD-5 and BRD-11 in `05-board-editor.md`). Line numbers in the reports have drifted; search by symbol.

| Task | Title | Scope (roadmap) | Status |
|------|-------|-----------------|--------|
| US-1844 | [Split `board-bridge-channels.ts` into `src/ipc/board-bridge/`](../tasks/US-1844-board-bridge-split/README.md) | 4.1, part 1: BND-2 step 1 | Done |
| US-1845 | [`BoardFrameRegistry`: the model's frame maps get one owner](../tasks/US-1845-board-frame-registry/README.md) | 4.2, part 1: BRD-2 (a) | Done |
| US-1846 | [`BoardFrameSession`: one liveness check and one `retire(reason)`](../tasks/US-1846-board-frame-session/README.md) | 4.2, part 2: BRD-1 steps 1–2 | Done |
| US-1847 | [Frame envelopes, `HostFrameChannel` and `BoardFrameEndpoint`](../tasks/US-1847-frame-envelopes/README.md) | 4.1, part 2: BND-2 steps 2–4, BRD-11 | Done |
| US-1848 | [`BoardHostRouter` and the feature handler modules; a thin `BoardWebview`](../tasks/US-1848-board-host-router/README.md) | 4.2, part 3: BRD-1 steps 3–4 | Done |
| US-1849 | [`BoardFrameChrome` and `board-chrome-protocol.ts`](../tasks/US-1849-board-frame-chrome/README.md) | 4.2, part 4: BRD-4, BRD-2 (g–j) | Done |
| US-1850 | [`BoardAiVisionChannel`](../tasks/US-1850-board-ai-vision-channel/README.md) | 4.2, part 5: BRD-5, BRD-2 (b) | Done |
| US-1851 | [`BoardSourceInbox`, `BoardPageStateStore`, `BoardContentResources`](../tasks/US-1851-board-model-collaborators/README.md) | 4.2, part 6: BRD-2 (c–f) | Done |

### Task scopes

**US-1844: Split `board-bridge-channels.ts` into `src/ipc/board-bridge/`.**
- Pure move first, one commit's worth of staged change: `boot.ts` (`BoardBootContext`, palette, i18n context, host
  text), `port-protocol.ts` (`BoardToMain`/`MainToBoard`), `frame-protocol.ts` (today's frame messages, unchanged),
  `ui-catalog.ts` (toolbar and status-bar descriptors and patches).
- Then `origin-routes.ts`: builders and parsers for the reserved board-origin paths (`/__persephone/dialog`,
  `/__pipe/<pageId>`, `/__pipe/resource/<id>`), replacing the string literals in `board-shim.ts`,
  `main/board-protocol-service.ts` and `BoardWebview.ts`. The dialog XHR payload gets a type.
- Fix the misplaced and wrong contract comments (`BoardAiVisionNotifyMsg` direction, the stray `BoardToHostMsg` doc),
  and drop the duplicate `BoardToolbarSetMsg`/`BoardToolbarUpdateMsg` members of `BoardHostFrameMsg`.
- No barrel file: importers point at the module they need. The plan lists every importer.

**US-1845: `BoardFrameRegistry`: the model's frame maps get one owner.**
- `editors/board/model/BoardFrameRegistry.ts` owns `frames`, `loadedTabs`, `activeTabId` and the frame-load waiters
  (`waitForFrameLoad`). `BoardEditorModel` creates it and hands it to `BoardTargetModel`, which becomes the only writer
  of the active tab (today it assigns `model.activeTabId` directly).
- The facade (`BoardEditorFacade`) and `BoardTargetModel` read through it. Forwarding getters on the model are allowed
  during the move; the plan says which stay and why.
- `hasSecondaryView(id)` lives here (or on the model, delegating here), ready for US-1850.

**US-1846: `BoardFrameSession`: one liveness check and one `retire(reason)`.**
- `editors/board/frame/BoardFrameSession.ts`, not a view. It owns one frame's lifetime: board id, host, iframe, tab id,
  `isMain`, generation and the pending port. Public API: `post(msg, transfer?)` (runs the single liveness check),
  `isCurrent(generation, frame)`, `onRetire(cb)` and
  `retire(reason: "reload" | "grant-change" | "load-error" | "permission-lost" | "dispose")`.
- Board host registration, the port handshake, the CDP frame registration and grant-driven iframe replacement move into
  the session.
- **Before any code moves,** the plan writes the table of which reason clears what, built from today's five lists
  (`onDispose`, `handleLoad`, `refreshIframeGrant`, `handleFrameError` and the AiVision rejection). Each difference is
  either kept with a reason or removed as a bug. The shim's `postAfterDocumentLoad` and the `board:saveHandlerSync`
  re-announce keep their behaviour.
- The source-read grant computation (copied twice, with the magic `5000`) gets one helper.
- `onBoardPort` stays a global subscription in this task; the plan notes whether a per-board subscription in
  `ipc/renderer/api.ts` is a small add here or belongs to 4.3.

**US-1847: Frame envelopes, `HostFrameChannel` and `BoardFrameEndpoint`.**
- In `src/ipc/board-bridge/frame-protocol.ts`: three envelopes,
  `{ __persephone: "req", id, method, params }`, `{ __persephone: "res", id, ok, value | error: { code?, message } }`
  and `{ __persephone: "evt", name, payload }`, using the shared wire error (`toWireError`/`fromWireError`); two request
  maps (`BoardToHostRequests`, `HostToBoardRequests`) and two event maps, one per direction. The plan lists every
  current message and which map entry it becomes.
- The shim's `HostFrameChannel` and the renderer's `BoardFrameEndpoint` implement `request`, `handle` and `on` once,
  with `PendingRequests` for correlation. No new correlator.
- The nested mini-RPCs (`varMethod` + `varArgs`, `settingsMethod` + `settingsArgs`) become separate methods.
- Streaming `fetch` (head, chunk pull, abort) maps to one request plus `evt` pushes keyed by request id; the plan shows
  the mapping and keeps `BoardFetchBridge`'s shape.
- The 18 shim listeners stop casting `event.data`; the handshake listener uses the declared `BoardPortInitMsg`.
- **Security:** the `event.source` and origin gates on both ends stay exactly as they are. The plan quotes them before
  and after.
- The per-request result interfaces go. `window.persephone` is unchanged; the plan shows the `Object.keys` diff.

**US-1848: `BoardHostRouter` and the feature handler modules; a thin `BoardWebview`.**
- `editors/board/frame/board-host-router.ts`: a declarative table built from the existing `BoardMessageHandlers` mapped
  type (keep it; it gives compile-time exhaustiveness), with `event(name, gate, handler)` and
  `request(method, gate, async (params, ctx) => result)` entries. The router does the try/catch, the generation check
  through the session, and **a uniform "not permitted" reply for every gated request** (bug #12). Gates are all in the
  table; no handler re-checks `isPermitted`.
- The `resolve*` methods move into feature modules under `editors/board/frame/`: content host, shared state,
  content open, page state, source, settings and vars, notify, plus the existing `BoardFetchBridge`. The capability
  frame adapter and its outcome reshaping go to `api/capabilities/` next to `projectCapabilityOutcome` (the plan checks
  what `BoardCapabilityDispatcher` already holds).
- The module-level `acceptedBoardNotifyTimes` rate limiter gets an owner (one instance shared by intent, created once).
- The hard-wired voice-typing setting push becomes a generic "host settings push" list (`{ key, message }[]`).
- Main-process context-menu strings (`BoardHostText`) stop being built in the view.
- `BoardWebview` keeps the DOM, creates the session on mount and calls `session.retire("dispose")`.

**US-1849: `BoardFrameChrome` and `board-chrome-protocol.ts`.**
- Pure validators move out of the view files into `editors/board/chrome/board-chrome-protocol.ts`:
  `normalizeToolbarControl*`, `mergePatch`, `normalizeBoardStatusBar*`, one shared `normalizeBoardIcon`, `SAFE_ID` and
  `isRecord` (today duplicated between `BoardToolbarControls.ts` and `BoardStatusBarItems.ts`).
- `BoardFrameChrome`, owned by the model and held outside `BoardEditorState`: toolbar catalog, status catalog, toolbar
  text, status text, mute state and toggle, save handler and one owner generation. It has one `retireFrame(generation)`,
  registered on the session's `onRetire`. The five per-slot generation fields and their `clear…ForFrame` methods go.
- `BoardToolbarControls` and `BoardStatusBarItems` become views bound to the chrome model. The
  `onToolbarSet/Update/Clear` and `onStatusBarSet/Update/Clear` prop chains go. Focus and scroll preservation stay
  view-side.
- The facade's element declarations come from the chrome model, not pushed back from the views.
- The plan states whether status text becomes generation-owned like toolbar text, and why.

**US-1850: `BoardAiVisionChannel`.**
- `editors/board/model/BoardAiVisionChannel.ts`, owned by the model: `register(shape, frame, generation, reason)` (takes
  the shape validation from the view), `attachTransport`/`detach`, `request(req, { timeoutMs, timeoutError })` with
  route resolution, the `ai:elements` aggregation across mounted views and secondary-view readiness through
  `BoardFrameRegistry`, and the registration token and incarnation.
- The frame-side pending map moves to an `ai-vision` handler module from US-1848.
- "Is this a declared secondary view?" is answered once (`hasSecondaryView`), replacing the four copies in the view,
  model, facade and `BoardTargetModel`.
- `BoardEditorFacade` keeps only proxy caching and timeout-level resolution. The token/incarnation semantics in
  `doc/architecture/editors.md` stay intact.
- `aiVisionDisposed` stops doubling as the model's general disposed flag.

**US-1851: `BoardSourceInbox`, `BoardPageStateStore`, `BoardContentResources`.**
- `BoardSourceInbox`: the pending source queue, session handles with their 5-minute timers, `sessionBoundSources`, the
  private-session rules and the source-read grant helper from US-1846.
- `BoardPageStateStore`: the per-key promise queues and the storage-key cache, using
  `shared/board/page-state-validation.ts`.
- `BoardContentResources`: `open(link, tabId, generation, signal, policy)`, `release(id)` and
  `releaseForFrame(tabId, generation)`, the single owner of the model map, the `board-pipe-handler` registration and
  main's resource registration. It releases on the session's `onRetire`.
- `reloadBoard` folds into `runReloadAndWait`. The content-path materialization and stream pipe stay with the model or
  `BoardStreamEditorModel`; the plan says which.
- The plan ends with `BoardEditorModel`'s line count and the list of what it still owns.

### Order

1. **US-1844 first.** A pure move; every later task imports from the new files.
2. **US-1845, then US-1846.** The session reads frames from the registry, and the router needs the session.
3. **US-1847, then US-1848.** The router is the endpoint's handler table, so the envelopes come first. US-1847 touches
   both the shim and the renderer, so it runs alone.
4. **US-1849, US-1850 and US-1851 last,** one at a time. Each registers on the session's `onRetire` and moves one
   subsystem out of the model.

## Rules for every task in this epic

- **The roadmap guardrails apply** ([§7](../refactoring-roadmap.md#7-guardrails-against-the-drift-coming-back), also
  in `doc/agents-common.md`). Every plan names the module that owns each rule it touches and the existing helper it
  reuses: `PendingRequests`, the wire error, `BoardRegistry` (`isPermitted`), `BoardGrant`, the shared page-state
  validation, `BoardFetchBridge`, `BoardCapabilityDispatcher` and the board-editor factory.
- **No new protocol code** beyond the envelopes US-1847 defines, which replace the ad-hoc pairs; they are the frame
  boundary's shared primitive from then on.
- **Each copy is replaced, not wrapped.** A task is done when the old copies are gone. A forwarding getter that stays
  says why in the plan.
- **Teardown changes are explicit.** Any task that moves cleanup code lists, per retire reason, what is cleared before
  and after.
- **Security-relevant code keeps its behaviour:** the `event.source` and origin checks, the trust gates (`trusted`,
  `main`, `mainTrusted`, `mainTrustedText`), permission-loss teardown and the source-read grant scope. A plan that
  changes an authorization check says so and why it is safe.
- **God files only shrink.** `BoardWebview.ts`, `BoardEditorModel.ts`, `board-shim.ts`, `BoardToolbarControls.ts` and
  `BoardEditorFacade.ts` end smaller than they start.
- **No dynamic `import()` to dodge a cycle.** No module-level mutable state in the new modules.
- **Contracts that must not change** ([roadmap §8](../refactoring-roadmap.md#8-execution-notes)):
  `window.persephone.*` (diff `Object.keys` recursively before and after any shim change), the script API facade
  member names (`BoardEditorFacade`), AiVision paths and agent-facing messages, the `data-name` element contract, board
  storage keys and the `board://` host. The private frame wire may change, since the shim and renderer ship together.
- **Verification:** `npm run typecheck`, `npm run lint`, `npm run build-prod`, `npm run i18n:check` and
  `npm run check:contracts` after every task, plus the live flows each task names. No unit tests.
- **Completion:** the deferred review model. `/review`, `/document` and `/userdoc` run once at epic close.

## Live checks the user runs at close

- Open, reload and close a board; change its grants while open (iframe replacement); untrust it while open
  (US-1846).
- A board with secondary views: open, switch tabs from an agent, close one view (US-1845, US-1850).
- Board requests: file path and icons, `content.open`, open content, variables, settings, page state get/set/remove,
  source navigate, a return URL and a capability invoke (Excalidraw) (US-1847, US-1848).
- A board request from an untrusted board gets an immediate "not permitted" error, not a timeout (US-1848).
- Streaming `fetch` with a large body, and abort mid-stream (US-1847).
- Toolbar controls, status-bar items, toolbar and status text, the mute button and save (Ctrl+S) with a board that
  declares a save handler; reload clears them (US-1849).
- AiVision over MCP: `elements`, a click and a read on the main view and on a secondary view (US-1850).
- A content-host board (Text ↔ board switch), a stream-host board, and a source handed to a board from the file
  explorer (US-1851).
- Voice typing in a board text field still receives the setting push (US-1848).

## Notes

### 2026-11-11
- Created after EPIC-145 closed. Checked against the code on 2026-11-11:
  - `BoardWebview.ts` is 1,691 lines with 13 `resolve*` methods, about 37 liveness guards and the module-level
    `acceptedBoardNotifyTimes` limiter;
  - the gate-failure reply in `dispatchBoardMessage` still covers only page state, source navigate and fetch (bug #12 is open);
  - `BoardEditorModel.ts` is 1,476 lines; `BoardTargetModel` writes `model.activeTabId` directly; `aiVisionDisposed`
    still doubles as a disposed flag for title updates;
  - `board-bridge-channels.ts` is 862 lines and has not been split; `src/ipc/board-bridge/` does not exist;
  - page-state validation is already shared (`shared/board/page-state-validation.ts`), so BRD-11's last step is done.
- Out of scope, recorded for later: the main-side frame session and per-board `onBoardPort` subscription (cross-area
  note in `05-board-editor.md`; 4.3), the shim module split (4.4), `ContentHostSlot` (4.6) and the shared
  `TargetAutomationMembers` helper for the board and browser facades (6.2).
- Implementation started the same day (Sonnet plans reviewed by Claude, Codex Luna implementation), staged per task, not
  committed. US-1845 ran before US-1844 (independent, and US-1844's plan was not ready yet).
- Scope and behaviour changes found during planning, to check live:
  - US-1844: the dialog XHR and pipe paths come from `ipc/board-bridge/origin-routes.ts`; main's dialog authorization
    keeps its checks and order (now in `serveBoardDialog`).
  - US-1845: `BoardFrameRegistry` owns the frame maps; `currentIframe` (dead) is gone.
  - US-1846: one `BoardFrameSession` per view with a generation counter and `RETIRE_POLICY`. Fixed: closing a secondary
    view could clear the main frame's toolbar and status declarations (per-view generation counters collided); grant
    change and untrust now clear the chrome; pending AiVision requests fail at once on reload ("The board frame was
    reloaded.") instead of timing out; load error bumps the generation; the frame is removed synchronously on permission
    loss.
  - US-1847: board-visible errors from the host may now carry an optional `.code` (additive, as on the port route).
    The three host-side pending maps went into the endpoint's `PendingRequests`, so US-1850 has no frame-side pending map
    to move.
  - US-1848: every board request is gated in the router table and rejects with code `untrusted`, "This board is no longer
    trusted." (three "This board is not trusted." texts and capability's "The board is no longer trusted." changed). File
    path, icons, vars and settings gained the gate; a frame only runs while permitted, so this matters only in the race
    between untrust and retirement. Terra wrote dense code; a Luna formatting-only pass followed.
  - US-1849: chrome lives in `BoardFrameChrome` (owner `{ session, generation }`); status text now clears when its frame
    retires; `pageMuted` stays in editor state as the shared tab projection; legacy chrome keys are stripped at the
    board factory restore boundary.
- From US-1848 on, planning runs on the Codex policy pick (Terra) and implementation on Luna (user decision 2026-11-11).
- Closed 2026-11-11. The epic review (Codex Luna) removed three non-null assertions and reflowed dense code in the frame
  channel, protocol and bridge files; the developer docs and the board guides were updated. No catalog messages changed.
  Final sizes: `BoardWebview.ts` 1,691 → 98 lines, `BoardEditorModel.ts` 1,476 → 894, `board-shim.ts` 2,617 → 2,260.
