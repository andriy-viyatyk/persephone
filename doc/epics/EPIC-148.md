# EPIC-148: Refactoring Phase 4.4 — the board shim split

## Status

**Status:** Completed 2026-11-11
**Created:** 2026-11-11

## Overview

The eighth epic of the [refactoring roadmap](../refactoring-roadmap.md), and the third part of Phase 4 (board bridge
and runtime decomposition). EPIC-146 typed the frame protocol and EPIC-147 typed the main port. This epic splits the
code that runs inside the board frame: `src/board-shim.ts`, which builds `window.persephone`.

- **4.4, BND-1: `board-shim.ts` (2,270 lines).** One flat script whose features all share module-level state:
  - **35 module-level `let`s** (`port`, `currentTheme`, `busyState`, `filePathSettled`/`filePathValue`,
    `sourceUrlSettled`, `hostContentSettled`, `sharedStateSettled`/`sharedStateSeq`, `aiVisionRemote`,
    `activeIntent`, `idCounter`, `watchIdCounter`, `saveHandlerId`, …) and about 20 module-level `Set`/`Map`/array
    collections (`pageVisibilityCbs`, `sourceOpenCallbacks`, `watchCallbacks`, `channelPortWaiters`,
    `earlyChannelPorts`, `activeServiceChannels`, `runnerHandlers`, `saveHandlers`, `fetchStreams`, `fileIconCache`,
    `toolbarActionCbs`, …).
  - **"Settle once, await any time" is written out five times:** busy, file path, source URL, host content and
    shared state, each with its own resolver array. `whenHandshake()` piggybacks on `filePathResolvers`, so the
    handshake gate is coupled to the file-path feature.
  - **"Callback set + try/catch + `console.error` fan-out" is written out about 14 times**, some with a `Set`, some
    with an array and `indexOf`/`splice` (`themeCbs`).
  - **The port side** (`post`, `rpc`, `call`, `fire`, `onPortMessage`, `attachPort`, the service-channel port waiters,
    the runner and watch routing) is loose functions over the module-level `port`.
  - **The `window.persephone` object literal is about 780 lines** (from `(window as …).persephone = {` to the end of
    the file), with feature logic written inline in it. It also carries a version-history comment that is stale
    (it stops at 1.39.0; the constant is 1.56.0).
  - **The generic capability proxy special-cases one capability:** the audio `muteApp` release handshake.
- **What is already done.** These are not in scope:
  - BND-2 and BND-3: the shim's `HostFrameChannel` (`src/board-shim/board-host-frame-channel.ts`, EPIC-146) and the typed
    `rpc<M>` over `BoardPortMethods` (EPIC-147).
  - BND-12: the shim uses the shared `formatMessage` (`shared/i18n/format-message.ts`) and the
    `BOARD_HOST_TEXT_CATALOG` in `shared/board/host-text.ts`, from which `BoardHostTextId` is derived.
  - The service channel is the shared `createServiceChannel` (BND-4), and the context menu and console mirror are
    already their own modules.

The module-service host (4.5) and `ContentHostSlot` (4.6) are later epics.

## Goals

- **`src/board-shim/` is a folder of browser-only modules**, and `src/board-shim.ts` is a thin composition root that
  builds `window.persephone` from them. The build entry (`src/board-shim.ts` in `scripts/build-prod.mjs` and
  `scripts/dev.mjs`) does not change; the IIFE bundler already inlines imports.
- **The existing shim modules live in the folder:** `board-host-frame-channel.ts`, `board-context-menu.ts` and
  `board-console-mirror.ts` (move-only, imports updated).
- **Two primitives replace the copies.** `src/board-shim/primitives.ts` gets:
  - `SettledValue<T>`: `settle(v)`, `get(): Promise<T>`, `peek()`, `isSettled`;
  - `Listeners<T>`: `add(cb): () => void`, `emit(v, label)` with the try/catch and logging in one place, and an
    option to replay the current value on `add` (theme, visibility, voice-typing auto-stop).

  All five settle-once copies and every callback fan-out use them. The handshake gets its own `SettledValue`, not the
  file path's.
- **One `MainPortChannel` class** owns the port: queue-then-flush, `rpc`, `call`, `fire`, the routing tables for
  runner, watch and theme pushes, the service-channel port waiters, and `replace(port)` (today's `attachPort`).
- **One feature module per public namespace.** Each exports a `createXApi(deps)` factory in the style of
  `installBoardContextMenu({ fire, rpc, hostText })`, and owns its state in the closure or a class instance. No
  feature module has module-level mutable state.
- **Capability-specific code leaves the generic proxy.** The audio `muteApp` release handshake moves into a
  per-capability client adapter table that the capability module owns.
- **The ordering guarantees are written in the composition root**, not implied by file order: listeners are
  installed before author code runs, early `source:opened` events and early channel ports are buffered, and the
  handshake gates the calls that wait on it.
- **`board-shim.ts` shrinks** to the composition root. The last task's plan states the real number.

## Decisions this epic acts on

- **`window.persephone` does not change.** The surface stays byte-identical, so `BOARD_BRIDGE_VERSION` does not move.
  Every task diffs the public surface before and after: recursive `Object.keys`, plus `typeof` for each leaf, plus the
  getters (`theme`) staying getters. The diff is run by hand against a live board, or with a throwaway script that is
  not committed. No test harness is added.
- **Roadmap §8:** the private wires (frame messages and the port) ship together with the shim and may change without
  a bridge bump. This epic should not need to change them; any task that does says why.
- **The stale version-history comment** in the object literal is deleted, not moved. The history of record is wherever
  guardrail 6 already puts it; the first task's plan confirms where that is and that nothing is lost.
- **D7:** no new top-level layer. The folder is `src/board-shim/`, next to the existing `src/board-shim.ts` entry, as
  the roadmap names it.
- **The i18n lint exclusion** (`eslint.config.mjs`, `isExcludedI18nFile`) today matches `src/board-shim.ts` only. It
  extends to `src/board-shim/` for the same reason (English boot fallbacks and runtime errors; visible menu text is
  host-resolved). It does not widen to anything else.

## Linked Tasks

Task documents are written per task when it is picked up. The finding IDs point at the area reports in
[`doc/reviews/refactoring-2026-11/`](../reviews/refactoring-2026-11/): BND-1 and BND-12 are in `02-boundary.md`. Line
numbers in the report have drifted a long way (the shim was 2,822 lines then), so search by symbol.

| Task | Title | Scope (roadmap) | Status |
|------|-------|-----------------|--------|
| [US-1857](../tasks/US-1857-board-shim-primitives/README.md) | `src/board-shim/` and the shim primitives | 4.4, part 1: BND-1 steps 1–2 | Done |
| [US-1858](../tasks/US-1858-main-port-channel/README.md) | `MainPortChannel`: one owner for the board's port | 4.4, part 2: BND-1 step 3 | Done |
| [US-1859](../tasks/US-1859-board-shim-host-features/README.md) | Host-side feature modules | 4.4, part 3: BND-1 step 4 (host frame) | Done |
| [US-1860](../tasks/US-1860-board-shim-port-features/README.md) | Port-side feature modules and the thin composition root | 4.4, part 4: BND-1 step 4 (port) | Done |

### Task scopes

**US-1857: `src/board-shim/` and the shim primitives.**
- **The folder.** `src/board-shim/` holds `board-host-frame-channel.ts`, `board-context-menu.ts` and
  `board-console-mirror.ts`, moved without behavioral edits; all importers use the new paths. Extend the
  i18n lint exclusion to the folder.
- **The primitives.** Add `src/board-shim/primitives.ts` with `SettledValue<T>` and `Listeners<T>` as described in
  the goals.
- **Replace the copies in place.** Inside `board-shim.ts`, the five settle-once copies (busy, file path, source URL,
  host content, shared state) and every callback fan-out (`themeCbs`, `pageVisibilityCbs`,
  `voiceTypingAutoStopCbs`, `sourceOpenCallbacks`, `settingsChangeCbs`, `discardHandlers`, `toolbarActionCbs`,
  `statusBarActionCbs`, `muteToggleCbs`, and the rest the inventory finds) use the primitives. **Before any code
  moves,** the plan writes the inventory: each copy, its error label, whether it replays on add, whether it is a `Set`
  or an array, and whether removal is by identity. Each difference is kept with a reason or removed as a bug. Removal
  semantics must not change for a callback registered twice.
- **The handshake.** `whenHandshake()` gets its own `SettledValue<void>`, settled where the handshake lands, and stops
  reading `filePathResolvers`.
- **Out of this task:** no code moves to feature modules yet. The shim gets smaller only by the deleted copies.

**US-1858: `MainPortChannel`: one owner for the board's port.**
- **The class.** `src/board-shim/main-port-channel.ts` takes over `port`, the outgoing queue and its flush,
  `pendingRpc` (the existing `PendingRequests`), `post`, `rpc<M>`, `call`, `fire`, `onPortMessage`, `attachPort`
  (becoming `replace(port)`), `channelPortWaiters`/`earlyChannelPorts`, and the routing of runner messages
  (`runnerHandlers`), watch batches (`watchCallbacks`) and theme pushes. Features register their routes with it; the
  channel does not import feature modules.
- **Teardown.** **Before any code moves,** the plan writes what `attachPort` and the `pagehide` handler clear today
  (pending RPCs, fetch streams, capability requests, service channels, port waiters) and shows each in the new
  `replace`/`dispose` path. A difference is kept with a reason or removed as a bug.
- **No new protocol code.** It reuses `PendingRequests`, `fromWireError` and the `BoardPortMethods` types; it adds no
  correlator and no envelope.

**US-1859: Host-side feature modules.**
- **The modules.** One `createXApi(deps)` per namespace that talks to the host frame through `HostFrameChannel`:
  - `page-api`: `page`, visibility, `voiceTyping`, modified, mute, save/discard requests, busy/working;
  - `source-api`: file path, source URL, `source`, `content`, materialization, the `onOpen` buffer;
  - `host-content-api` (`host`) and `shared-state-api` (`state`, `var`);
  - `chrome-api`: `toolbar`, `statusBar`, `setStatusText`, `setSecondaryViews`, `navigation`;
  - `settings-api`, `themes-api` (`themes`, `theme`, `getTheme`, `tokens`, `onThemeChange`, the graph palette) and
    `i18n`;
  - `dialogs` (the sync-XHR `alert`/`confirm`/`prompt`) and `frame-behaviours` (the keyboard forwarding, link
    routing, overlay dismissal, context-menu and diagnostics install).
- **The plan's grouping is a starting point.** The plan may merge or split these, and says why. It may not leave a
  namespace's logic inline in the object literal.
- **The surface diff** is run before and after.

**US-1860: Port-side feature modules and the thin composition root.**
- **The modules.** One `createXApi(deps)` per namespace that talks to main through `MainPortChannel`:
  - `files-api`: read, write, trash, file access, `listFolder`, `watch`, the remember prompts, TS projects, dialogs,
    `openBoard`;
  - `service-api`: `service`, `services`, `providers`;
  - `capability-api`: `intent`, `capabilities`, `getCapability`, and the per-capability adapter table that takes the
    audio `muteApp` release handshake out of the generic proxy;
  - `fetch-api`, `ai-vision-api` (expose, the element registry, `aiVision`), `storage-api` (`storage`, `pageState`,
    `clipboard`), `execute-api` (`execute`, `executeNode`), `icons`, and `openRawLink`/`openContent`/`call`/`notify`.
- **The composition root.** `src/board-shim.ts` reads the boot context, builds the two channels and the features in a
  written order, and assigns `window.persephone`. The plan states its final line count and everything it still owns.
- **The surface diff** is run before and after.

### Order

1. **US-1857 first.** It creates the folder and the primitives every later module uses.
2. **US-1858, then US-1859 and US-1860.** The port-side features depend on `MainPortChannel`; the host-side features
   do not, but running the tasks one at a time keeps each shim diff reviewable. US-1859 and US-1860 both edit the
   object literal, so they never run in parallel.

## Rules for every task in this epic

- **The roadmap guardrails apply** ([§7](../refactoring-roadmap.md#7-guardrails-against-the-drift-coming-back), also
  in `doc/agents-common.md`). Every plan names the module that owns each rule it touches and the existing helper it
  reuses: `HostFrameChannel`, `PendingRequests`, the wire error, `BoardPortMethods`, `createServiceChannel`,
  `createCapabilityProxy`, `createExecuteHandle`, `formatMessage` and `BOARD_HOST_TEXT_CATALOG`.
- **No new protocol code.** No new correlator, envelope or message type.
- **Each copy is replaced, not wrapped.** A task is done when the old copy is gone from `board-shim.ts`.
- **No module-level mutable state in the new modules.** State lives in a class instance or a factory closure created
  by the composition root.
- **God files only shrink.** `board-shim.ts` ends each task smaller than it started it.
- **Browser-only.** The shim modules import nothing from `src/main/`, `src/renderer/` or Node. Type-only imports from
  `src/ipc/` and `src/shared/` stay as they are; the plan checks that nothing new pulls Node code into the IIFE
  (inspect the built `board-shim.js` size before and after).
- **Behaviour to keep, and to check in every plan that touches it:**
  - listeners are installed before the author script runs, so `window.persephone` exists synchronously;
  - early `source:opened` events and early service-channel ports are buffered until a consumer subscribes;
  - the post-after-document-load policy of `HostFrameChannel`;
  - the AiVision expose and element registry, and its generation counter;
  - `persephone.call()` timeouts and the fetch abort and stream behaviour;
  - the dialog sync-XHR path and its size limit.
- **Contracts that must not change** ([roadmap §8](../refactoring-roadmap.md#8-execution-notes)): `window.persephone.*`
  (the surface diff above), board-visible error codes and messages, board storage keys, and AiVision and MCP `call`
  behaviour for board frames.
- **Verification:** run `npm run typecheck`, `npm run lint`, `npm run build-prod`, `npm run i18n:check` and
  `npm run check:contracts` after every task, plus the surface diff and the live flows each task names. No unit tests.
- **Completion:** the deferred review model. `/review`, `/document` and `/userdoc` run once at epic close. `/document`
  updates `overview.md`, which still calls the shim "a small in-board shim", and the key-files and folder-structure
  entries.

## Live checks the user runs at close

- Open, reload and close a board. `window.persephone` matches the pre-epic surface (the diff from US-1857).
- A board with a file path and one opened from a source URL; `source.onOpen` with a source opened before the board
  subscribed (US-1859).
- Host content and shared state: `host.getContent`, `state.get`/`set`/`onChange` across two views of one board
  (US-1859).
- Theme change and custom-theme calls while a board is open; `i18n.t` in a board with a language pack (US-1859).
- Toolbar and status-bar actions, the mute toggle, save and discard requests on a plain page, busy/working
  (US-1859).
- `alert`/`confirm`/`prompt` from a board, Ctrl+S, a link click, and the board context menu (US-1859).
- File IO, a folder watch, a service channel round trip, an Excalidraw capability invoke and cancel, an intent from
  one board to another, and the audio `muteApp` capability (US-1860).
- `persephone.fetch` with a streamed body and an abort; `persephone.call` with a timeout; a node runner job with stdin
  and kill; board storage, page state and the clipboard (US-1860).
- AiVision over MCP on a board, including declared board elements (US-1860).

## Notes

### 2026-11-11
- Created after EPIC-147 closed. Checked against the code on 2026-11-11:
  - `src/board-shim.ts` is 2,270 lines with 35 module-level `let`s and the collections named above.
  - The five settle-once copies and `whenHandshake()` reading `filePathResolvers` are still there.
  - The `window.persephone` literal starts at about line 1492 and runs to the end of the file; its version-history
    comment stops at 1.39.0 while `BOARD_BRIDGE_VERSION` is 1.56.0.
  - `src/board-host-frame-channel.ts` (182 lines), `src/board-context-menu.ts` (446) and
    `src/board-console-mirror.ts` (41) sit in `src/` next to the entry.
  - BND-12 is already done: the shim imports `formatMessage` and `ENGLISH_BOARD_HOST_TEXT`.
  - `src/board-shim/` does not exist.
- Out of scope, recorded for later: the module-service host and supervisor split (4.5) and `ContentHostSlot` (4.6).
- Implemented 2026-11-11 (US-1857 to US-1860, unreviewed). `src/board-shim.ts` 2,270 -> 125 lines (`wc -l`), a
  composition root over 25 modules in `src/board-shim/`; the built `board-shim.js` went from 204,045 to 197,798 bytes.
  Smoke check: the Demo board opened and reloaded with no console errors, and its top-level `window.persephone` keys
  match the pre-epic literal; `theme`, `page.visible`, `voiceTyping.autoStopSilenceMs` and the two `source` getters
  are still getters.
- Behaviour changes (all console- or timing-level; no board-visible result changes):
  - every callback list dedupes a callback registered twice and emits over a snapshot; callback errors log the raw
    error (US-1857);
  - busy, host content and shared state waiters resolve the current value after the first update (US-1857);
  - on `pagehide`, pending port RPCs reject with "The board page closed or navigated away." and the main port closes;
    calls after that drop (`notify`) or reject, and never throw (US-1858);
  - the top-level key order of `window.persephone` may differ; keys and types do not (US-1859).
- Plan corrections from review: the primitives have one behaviour instead of preserving Set-vs-array differences
  (US-1857); service-port buffering is its own `ServicePortInbox`, not part of `MainPortChannel` (US-1858); the
  handshake stays with the root, and `composeApi` builds `window.persephone` from fragments (US-1859).
- Completed 2026-11-11: `/review` removed the `getBoardBusy()` non-null assertion while preserving its latest-state
  behavior; `/document` updated the overview, key-files and folder-structure; `/userdoc` documented callback
  deduplication and rejection of pending main-port requests after page close/navigation. No English catalog messages
  changed.
