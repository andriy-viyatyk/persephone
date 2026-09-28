# EPIC-115: Platform roadmap clean-up — fix what the adjustment rounds left behind

## Status

**Status:** Planned
**Created:** 2026-09-27

## Overview

The [platform roadmap](../platform-roadmap.md) (EPIC-105 to EPIC-114) was built in ten epics over
eight days, and each epic adjusted what the one before it built, often from a live finding. The
code works, but the adjustments piled up: the same contract is written by hand in several places,
several copies have drifted apart, some code can never run, and in a few places a later change
quietly broke an earlier feature.

This epic records what a post-roadmap review found. The review covered five areas: content
pipeline, module service, capability bus, board runtime, and media/page lifecycle. Findings are
grouped into stories. **Defects come first** (Phase 1); the rest is refactoring whose value is
fewer places for the next change to go wrong.

Every finding was checked against the source at `693f3358`. Items marked *code-verified* are certain
from reading the code; items marked *needs live repro* follow from the code but were not observed
in the running app, and should be reproduced over MCP before they are fixed.

## Goals

- Fix the defects that later epics introduced into earlier ones (Phase 1).
- Give each cross-process contract one typed definition instead of copies kept in step by hand
  (the root cause of the roadmap's "Needs user verification" item 12).
- Delete code that can no longer run.
- No user-visible behaviour change outside Phase 1, except where a story says so.

## Standing rules for every story

- **`BOARD_BRIDGE_VERSION`:** any story that changes what a board sees (the shape of a result, a
  new `persephone.*` member, or the service protocol) must bump it in
  `src/shared/board-bridge-version.ts`. Delegated plans habitually leave this out, so check each plan
  for it.
- **Invoke every changed message path twice, live.** Four roadmap epics shipped defects that
  typecheck, lint and `build-prod` all passed. What found them was sending a request a second time
  to an already-open page.
- **Cross-repo:** US-1543 changes the board service protocol, so the torrent viewer and
  `_test/range-provider-test` in `persephone-boards` must move with it (or rely on a transition
  window).

## Linked Tasks

| Task | Title | Phase | Size | Status |
|------|-------|-------|------|--------|
| US-1534 | [Capability handler pages open for any trusted board, not only bundled ones](../tasks/US-1534-capability-handler-open/README.md) | 1 — defect | S | Done |
| US-1535 | [One service renderer lease per window, not per service](../tasks/US-1535-service-lease-per-window/README.md) | 1 — defect | M | Done |
| US-1536 | [Board `ui.log`: one main-owned writer; no truncation; bundled boards log to userData](../tasks/US-1536-board-log-writer/README.md) | 1 — defect | S–M | Done |
| US-1537 | [Launch arguments parsed once; a cold-start URL takes the same route as a running-instance URL](../tasks/US-1537-launch-arguments/README.md) | 1 — defect | S | Done |
| US-1538 | [Main owns the board trust and URL-mask snapshots](../tasks/US-1538-main-owned-trust-snapshot/README.md) | 1 — defect | M | Done |
| US-1547 | [Remove the unreachable board-provider acquire path; a recovered pipe regains ranged reads](../tasks/US-1547-board-provider-acquire/README.md) | 1 — defect | M | Done |
| US-1539 | [Capability contract single-sourced: error codes, intent envelope, outcome shape](../tasks/US-1539-capability-contract/README.md) | 2 — contracts | M | Done |
| US-1540 | [One owner for a capability request's lifecycle](../tasks/US-1540-capability-request-lifecycle/README.md) | 2 — contracts | L | Done |
| US-1541 | [Built-in capability resolution runs the handler it resolved; one image-edit helper](../tasks/US-1541-builtin-capability-resolution/README.md) | 2 — contracts | S | Done |
| US-1542 | [Host-frame request/reply channel: one table on each side, typed message union](../tasks/US-1542-host-frame-channel/README.md) | 2 — contracts | L | Done |
| US-1543 | [The service host owns the service lifecycle protocol](../tasks/US-1543-service-lifecycle-protocol/README.md) | 2 — contracts | L | Done |
| US-1544 | [One provider-operation policy table (deadline, cap)](../tasks/US-1544-provider-operation-policy/README.md) | 2 — contracts | S | Done |
| US-1545 | [Split the module-service supervisor; one state-transition helper](../tasks/US-1545-supervisor-split/README.md) | 3 — structure | L | Done |
| US-1546 | [One `__pipe` range reader in main; one MIME table](../tasks/US-1546-pipe-range-reader/README.md) | 3 — structure | M | Done |
| US-1548 | [One ownership registry for providers, schemes, capabilities and URL masks](../tasks/US-1548-ownership-registry/README.md) | 3 — structure | M | Done |
| US-1549 | [Board manifest parsed once into a normalized model](../tasks/US-1549-normalized-board-manifest/README.md) | 3 — structure | M | Done |
| US-1550 | [Scheme hooks: a `handoff()` helper and shared URL helpers](../tasks/US-1550-scheme-hooks-handoff/README.md) | 3 — structure | S | Done |
| US-1551 | Single-instance board routing in one place; a typed open-context hook | 3 — structure | S | Planned |
| US-1552 | Video pipe sessions use the `resource` pipe kind; delete the page-owner waiters | 3 — structure | L | Planned |
| US-1553 | VideoEditor's source flow in one place; one provider-recovery helper for all editors | 3 — structure | M | Planned |
| US-1554 | Board trust granting, bundled-board creation and Board Info each have one path | 3 — structure | S | Planned |
| US-1555 | Small dead code, stale comments and a torrent-specific notice in core | 3 — structure | S | Planned |

Suggested order: all of Phase 1, then US-1544 (small, and the drift it removes has already caused
one shipped bug), then the rest. US-1552 and US-1553 both touch `VideoEditor.ts`, so do them in
sequence. US-1548 and US-1549 both touch `custom-editor-registry.refresh()`, so do those in
sequence too.

---

## Phase 1 — defects

### US-1534: Capability handler pages open for any trusted board, not only bundled ones

*Code-verified.* **High value.**

- **What is broken:** when a capability is invoked and no handler page is open, the transport can
  only open a new page through `pagesModel.addBundledBoardPage(...)`
  (`api/board-capability-transport.ts:219-224`). That function throws unless the board is
  `origin: "bundled"` and `content-host` (`PagesLifecycleModel.ts:315-316`).
- **Who it affects:** the Demo board declares `demo.greet` but is a non-bundled `stream-host`
  board (`assets/demo-board/board-manifest.json`), so every `demo.greet` call made with no demo
  page open is rejected. The same is true of any capability declared by a user or catalog board.
  EPIC-108's board-to-board bus now works only for Excalidraw.
- **How it arose:** EPIC-109 (`8cec7474`) replaced EPIC-108's generic
  `boards.openBoard(root, { intent })` with the bundled-only opener, to fit Excalidraw.
- **Reuse check:** reuse is restricted to `pages.find(isContentHostBoardPage)`
  (`board-capability-transport.ts:192-194`), so an already-open `stream-host` or `simple` handler
  page is never reused either.
- **Direction:** choose how to open the handler page from the handler's registration:
  - bundled `content-host` → `addBundledBoardPage`;
  - any other trusted board → the generic board open that EPIC-108 used.

  Better still, give the transport one per-kind "open handler page" hook, so it has no `if` on the
  board's kind.
- **Open question — the public `boards.openBoard({ intent })` route** (`api/boards.ts:282-293`,
  plumbed through `ILinkData.intent` → open-handler → `PageNavigator`). The transport no longer uses
  it, but it is still public (`types/boards.d.ts:164`). It lets a caller choose the `requestId` and
  bypasses deadline, trust ordering, the cycle check and the result: `BoardWebview`'s capability
  handler drops the board's reply because nothing is pending for it. Either remove it, or make it
  call `app.capabilities.invoke`. This is a public API change, so it needs a user decision.
- **Acceptance:**
  - With no Demo page open, `app.capabilities.invoke("demo.greet", …)` opens the Demo board in the
    caller's window and resolves.
  - A second invoke reuses that page.
  - Excalidraw `image.edit` is unchanged.

### US-1535: One service renderer lease per window, not per service

*Needs live repro (two windows).* **High value if confirmed.** **Confirmed and fixed** — live, the
evicted window did not ping-pong: it wedged, because its `lease-lost` never arrived and every later
read hung. See the [task document](../tasks/US-1535-service-lease-per-window/README.md).

- **What is broken:** a service holds exactly one renderer lease.
  - `ServiceRecord.lease` is a single lease (`main/module-service-supervisor.ts:79`).
  - `transferRendererPort` always fails the existing lease as `superseded` and sends
    `drop-renderer` (`:364-376`), whichever `WebContents` owns it.
  - The host keeps one `rendererLease`, and `attachRenderer` closes the previous one
    (`assets/module-service-host.mjs:434`). That rejects every pending read and disposes every
    watch subscription.
  - The losing window rejects its own pending requests and re-acquires on its next request, which
    evicts the other window in turn.
- **Why it matters now:** EPIC-114 D14 makes multi-window torrent use a supported case. Two
  `ProxyProvider` pages of one board in two windows would take turns killing each other's reads.
- **Direction:**
  - Key leases by `webContents.id` in the supervisor.
  - In the host, replace the single `rendererLease` with `Map<leaseNonce, lease>`.
  - Supersede only when the same `WebContents` re-acquires (a reload).
- **Acceptance:**
  - Two windows each stream a different file from one torrent at the same time.
  - Neither read is rejected as `renderer-reloaded` or `superseded`.
  - A renderer reload still supersedes only its own lease.

### US-1536: Board `ui.log` — one main-owned writer; no truncation; bundled boards log to userData

*Code-verified.*

- **What is broken:**
  - `BoardWebview.ts:236` uses `fs.write(... "board loaded")`, which truncates `ui.log` on every
    main-frame load. That wipes whatever the service logged while no page was open, which is
    exactly the case where a board author needs the log.
  - There are five other writers, each with its own path and line format:
    - `BoardWebview.ts:1247`;
    - `BoardEditorModel.ts:1086`;
    - `main/board-bridge.ts:353,458`;
    - `main/board-protocol-service.ts:281`;
    - the supervisor's `BoundedServiceLog` (`module-service-supervisor.ts:121-176`).
  - `BoundedServiceLog` rewrites the whole 256 KB tail on every chunk, so it can lose lines the other
    writers append. A new instance is created on every restart attempt (`:590`), so two instances
    can flush at the same time.
  - A bundled board's root is the install folder: `assets/boards/excalidraw/ui.log` exists in the dev
    tree. In a non-writable install, the write fails silently (`.catch(() => {})`), and an update
    wipes the log.
- **Direction:**
  - Add one main-owned `board-log.ts` with `append(root, level, line)`, one size bound and one
    serialised queue.
  - Add `boardLogPath(root)`, which sends bundled roots to a userData folder.
  - The renderer writes over IPC and marks a page load with a separator line instead of truncating.
  - Update the authoring guides that name `ui.log`'s location.
- **Acceptance:**
  - Service lines written with no page open survive opening the page.
  - A bundled board's log lives under userData.
  - Only one module writes the file.

### US-1537: Launch arguments parsed once; a cold-start URL takes the same route as a running-instance URL

*Code-verified (routing); the argv index needs live check.*

- **What is broken:**
  - A cold-start URL goes through `PagesLifecycleModel.handleExternalUrl` → `sendOpenRawLink(url)`
    (`PagesLifecycleModel.ts:900`) **without** `browserMode: "internal"`.
  - The running-instance route (`RendererEventsService.handleExternalUrl`) sets that flag,
    specifically to stop a `shell.openExternal` loop when Persephone is the OS default browser.
  - So with the default link-open behaviour, launching Persephone *with* a URL can bounce it to the
    default browser, which is Persephone.
- **Three launch-argument parsers, and they disagree:** each entry point has its own `isUrl` and its
  own file/URL classification:
  - cold start: `ipc/main/window-handlers.ts:6-19`;
  - second instance: `main/main-setup.ts:201-240`;
  - launcher pipe: `main/pipe-server.ts:11-30`.

  They disagree on the argv index (`argv[isPackaged ? 1 : 2]` against a fixed `commandLine[2]`),
  on how a relative path is resolved, and on `diff` support. Which index is correct for a packaged
  second instance was not verified.
- **Direction:**
  - Add one `parseLaunchArgument(arg, cwd) → { kind: "file" | "url" | "diff" }` in `main/utils.ts`,
    used by all three entry points.
  - In the renderer, make `openStartupInputs` call the same handler as `eOpenExternalUrl`, and delete
    `lifecycle.handleExternalUrl`.
  - Move `openStartupInputs` out of `PagesPersistenceModel`: it is not persistence.
- **Acceptance:**
  - A cold-start `https://` argument opens inside Persephone when it is the default browser.
  - File, URL and diff arguments behave the same from all three entry points.

### US-1538: Main owns the board trust and URL-mask snapshots

*Needs live repro (two windows).*

- **What is broken:** every renderer pushes its own trust snapshot and URL-mask snapshot to main.
  - Main keeps whichever snapshot has the highest generation (`module-service-supervisor.ts:185`,
    `download-service.ts:55`).
  - Generations are seeded from `Date.now()` so they survive a renderer reload
    (`board-trust-sync.ts:91-101`; the same trick is copied at `custom-editor-registry.ts:275`).
  - `boardTrust` has no file watcher and no cross-window broadcast (`board-trust.ts:88-94`).
- **The failure:** if window A untrusts a board and window B later re-snapshots from stale state (for
  example on B's `bundledBoardRegistry.subscribe` trigger), B's newer snapshot re-trusts the board in
  main. The failure is silent.
- **Direction:**
  - The trust file is plain data, so main should read it, or be told "trust changed, re-read", and
    own the snapshot. The mask snapshot follows the same shape.
  - Delete the clock-seeded generations.
  - `board-trust-sync.ts:112-114` calls `normalizePermissions(...)` and discards the result; delete
    that dead line.
- **Acceptance:**
  - Untrusting in one window stops the service and releases providers, and that holds after the
    other window re-snapshots.
  - No generation counter is seeded from the clock.
- **Live finding (US-1536, 2026-09-28):** on a cold `npm start`, a restored page reading a board
  provider (`mem://` from a scratch Demo copy) failed with `ServiceError trust-not-ready` from
  `transferRendererPort → start → requireRecord`, and toasted "Provider … is unavailable". Main
  had not yet received the trust snapshot. Check whether main owning the snapshot fixes it.

### US-1547: Remove the unreachable board-provider acquire path; a recovered pipe regains ranged reads

*Code-verified.*

- **Dead code:**
  - `content/board-provider-factory.ts` installs the real `ProxyProvider` factory unconditionally
    when the module loads (`:49-51`). Its throwing default, `BoardProviderUnavailableError`, and the
    install/subscribe indirection therefore never take effect.
  - `custom-editor-registry.refresh()` registers every trusted provider declaration in the same
    synchronous commit, so a trusted type always has a factory. `ProxyProvider` already acquires
    the service lazily (`module-service.ts:364`).
  - That makes all of the following unreachable in `content/registry.ts`: `withDeadline`,
    `waitForProviderAvailability`, `acquireBoardProvider`, `boardProviderAttempts` (`:405-478`), the
    `pending` branch of `MissingProvider.readOnce` (`:528-539`), and the
    `BoardProviderUnavailableError` catches (`:293-305`, `:535`).
  - `MissingProvider.state` is written and never read.
  - `withDeadline` throws two different error types.
- **Real degradation:** `MissingProvider` forwards only `readBinary()`, and builds a new delegate on
  every read.
  - A page restored while its board was untrusted, and then trusted, never regains `stat`,
    `createReadStream`, `writable` or `watch`.
  - `board-pipe-handler` then buffers the whole resource (up to 256 MB) instead of serving ranges,
    which is the opposite of EPIC-113 D3/D8.
- **Direction:**
  - Delete the machinery listed above.
  - `MissingProvider` = wait for declarations, then `tryCreateRegisteredProvider`, or throw the
    typed Missing/Unavailable error.
  - Cache the delegate and forward its optional members.
  - Fold `board-provider-factory.ts` into one function.
- **Acceptance:**
  - Restore a torrent video page while the board is untrusted, then trust the board: the video
    seeks by range, and main does not buffer the whole file.
  - About 150 lines are removed.

---

## Phase 2 — contracts with one definition

### US-1539: Capability contract single-sourced — error codes, intent envelope, outcome shape

*Code-verified.* Bridge bump required (the board-visible result shape changes).

- **Six copies of the D5 error-code list:**
  - `capability-bus-channels.ts:6-16`;
  - `capability-bus.ts:19-30`;
  - `board-capability-transport.ts:115-118`;
  - `BoardWebview.ts:1301-1306`;
  - `board-shim.ts:751-756`;
  - `board-bridge-channels.ts:589-600`.

  Bridge replies type the code as a bare `string` (`board-bridge-channels.ts:623,641`).
- **Three error classes and four converters between them:** the classes are `CapabilityError`,
  `BoardCapabilityTransportError` and the shim's `BoardCapabilityError`.
- **The intent shape `{id, version?, requestId, payload}` is written four times:** `IBoardIntent`,
  inline on `BoardPortInitMsg.intent`, the shim's `BoardIntentInit`, and inline in `boards.ts:282`.
- **The result is reshaped at four hops:**
  1. the transport wraps it as `{pageId, result}`;
  2. `capabilities.ts:236-246` flattens it, and the envelope's `pageId` overwrites any `pageId` the
     handler returned;
  3. `BoardWebview.ts:976-993` re-nests it;
  4. `board-shim.ts:1206-1215` rebuilds it.

  The result: scripts get flat results and boards get nested ones.
- **Excalidraw knowledge sits in the generic transport:** the `"untitled.excalidraw"` title, the
  `isPageProducingEditCapability` list, `isDiagramConversionFailure`, and closing the page on
  `conversion-failed` (`board-capability-transport.ts:99-109,293,310-312`).
- **Direction:**
  - Export `CAPABILITY_ERROR_CODES`, `isCapabilityErrorCode`, `IntentEnvelope` and
    `CapabilityOutcome { pageId?, result?, discardPage? }` from the import-free
    `capability-bus-channels.ts`.
  - Fold the transport error class into `CapabilityError`.
  - Pass the outcome through untouched, and flatten at most once, at the script surface.
  - "Always opens a new page" becomes a declaration field instead of an id list.
  - A handler asks for its page to be discarded, instead of the transport knowing
    `status: "conversion-failed"`.
  - Delete the dead leftovers: the `image.edit`/`diagram.edit` arms of `EditorCapabilityDeclaration`,
    `DiagramEditResult` in the built-in `CapabilityResult`, the unreachable headless branch
    (`board-capability-transport.ts:202-208`), the never-set `CapabilityRegistrationResult.owner`,
    and the ignored `_activeBoardRoots` parameter.

### US-1540: One owner for a capability request's lifecycle

*Code-verified.* Large. Do it after US-1539.

- **Three pending tables track the same request:**
  - `CapabilityBus.pending`;
  - `BoardCapabilityTransport.pending`;
  - `BoardWebview.pendingCapability`.
- **Duties repeated across the layers:**
  - two deadline timers;
  - three trust subscriptions that settle `untrusted`;
  - four trust checks on the dispatch path;
  - two "dispatched twice" guards.

  This arose because EPIC-108 built the bus and the bridge in parallel, and each side made itself
  fully defensive.
- **Initial-intent handoff:**
  - It uses duck-typed `setInitialIntent` and `clearInitialIntent` casts (`PagesLifecycleModel.ts:52-58`,
    `PageNavigator.ts:257`, `board-capability-transport.ts:77-91`).
  - Every settle sweeps every page of the board root, because the transport does not know which page
    holds the intent.
  - `BoardWebview.initialIntentIds` blocks a second post.
- **Concurrency mismatch:** the shim answers `busy` to any second concurrent intent
  (`board-shim.ts:1153-1157`), but the renderer allows 32 per handler, and the transport's
  per-request chain map exists for concurrency the frame refuses.
- **Found in US-1534:** a `capabilities:intent` message that reaches a frame before its init
  handshake makes the shim ignore the page's initial intent. The cause is the
  `if (!activeIntent && data.intent …)` check in the init handler of `board-shim.ts`, and the
  initial intent's request then hangs until its deadline. US-1534 works around this in the
  transport: `openingPages` makes requests that arrive during a cold open wait until the opening
  request settles. When the transport starts holding the initial intent per page, it should also
  queue non-initial dispatch until the handshake, and the `openingPages` wait can then go.
- **Found in US-1539:** a board caller that times out gets one of two messages, "Capability
  invocation deadline elapsed." (the bus) or "The capability request deadline elapsed."
  (`BoardWebview`/shim). Which one it gets depends on which timer fires first. The code is
  `timeout` either way. With one deadline owner, one message remains. US-1539 also added
  `invokeCapabilityOutcome` in `capabilities.ts`: this is the single resolution path, and it
  returns the unflattened `CapabilityOutcome` that board callers receive.
- **`boards.openBoard({ intent })`:** US-1534 kept this route and marked `intent` `@deprecated`,
  pointing callers to `app.capabilities.invoke`. This story is where to remove it or turn it into
  an adapter. That is a public API change, so it is a user decision.
- **Direction:**
  - The bus alone owns deadline, trust, cancellation and at-most-once delivery.
  - The transport only routes and keeps the page-scoped chain.
  - The frame only handles the wire.
  - The transport holds the initial intent per page, and the frame takes it at handshake
    (`takeInitialIntent(pageId)`). That deletes the model field, the casts, the sweep and
    `initialIntentIds`.
  - Pick one concurrency model: either the frame is single-slot and the bus queues per page, or the
    shim keeps a map of contexts.
  - Prune the shim's `deliveredIntentIds`.
- **Acceptance:** every D9 settlement case from EPIC-108 is re-observed live, each invoked twice.

### US-1541: Built-in capability resolution runs the handler it resolved; one image-edit helper

*Code-verified.*

- **Resolution picks one handler and runs another:** `capabilities.invoke` resolves a registration,
  then runs `builtinHandlers.get(capabilityKey(id, representation))`, ignoring
  `registration.handlerKey` (`capabilities.ts:309-317`).
  - Platform candidates carry no `representation` (`:130-136`), so a board's `content.view` above
    priority 50 wins for every representation, including ones it cannot render.
  - The representation re-check in `createPageHandler` can never fail.
  - `seedPlatformCandidates()` is called lazily from six entry points.
- **Six copies of the image-edit handoff.** Each builds a data URL, calls `getImageDimensions`,
  appends `.excalidraw` to the title and wraps the same try/catch:
  - `ImageEditor.ts:311-321`;
  - `SvgEditor.ts:66-79`;
  - `MermaidEditor.ts:201-230`;
  - `PagesLifecycleModel.addDrawPage`;
  - `HtmlEditor.ts:137-141`;
  - `builtin-schemes.ts:213-224`.

  The warning/error notify step is copied three more times. Appending `.excalidraw` means callers
  still know the handler's file format, which is what EPIC-105 D5 set out to stop.
- **Direction:**
  - Key built-in handlers by `handlerKey`.
  - Store `representation` on the registration and filter on it in `orderedCandidates`.
  - Seed once, explicitly, after the editors register.
  - Add one `openImageForEdit({ dataUrl, mimeType?, title })` and one
    `notifyEditCapabilityFailure(...)` next to `getMissingEditCapabilityMessage`.

### US-1542: Host-frame request/reply channel — one table on each side, typed message union

*Code-verified.* Large. This is the structural fix for the roadmap's item 12.

- **Shim side:** `board-shim.ts` keeps about ten pending maps, each with its own id counter (var,
  settings, filePath, contentOpen, fileIcons, openContent, navigationReturnUrls, capabilityCalls,
  rpc, calls). Each `*Rpc()` function repeats the same promise/post/catch body, and about 20
  `onHostMessage` listeners each settle their own map.
- **Renderer side:** `BoardWebview.ts` has nine `resolve*` handlers, and their "frame still current"
  checks have drifted.
  - Capability and navigation skip the generation check.
  - Only settings and content-open also check `model.frames.get(tabId)`.
  - Four handlers post with no try/catch.
  - The main-frame gate is copied seven times (lines 561, 570, 582, 667, 687, 724, 793).
  - *After US-1540:* `BoardWebview.pendingCapability` is now only a wire-reply correlation map (no
    timer, no trust or settlement policy; the bus owns those), so folding it into the one table is
    mechanical. Line numbers above have moved.
- **Types:** `BoardToHostMsg` (`board-bridge-channels.ts:379-447`) is one flat type with every field
  optional, so `handleMessage` casts to a hand-written `legacy` type. `controls` and `names` are not
  in the type at all.
- **Direction:** mirror the main-side port channel, which already has the right shape
  (`main/board-bridge.ts:261-275`: a method table behind one shim `rpc()`).
  - Shim: one `hostRequest(type, payload)` with one pending map.
  - Webview: a `Record<type, handler>` table plus one `replyToFrame(frame, generation, msg)` that
    owns the currency check and the try/catch.
  - `BoardToHostMsg` becomes a typed-per-message union.
- **Bridge version:** the board-visible API does not change, so no bump is needed unless the plan
  changes a message.

### US-1543: The service host owns the service lifecycle protocol

*Code-verified.* Large; cross-repo. Bridge bump required.

- **What board authors must do today:**
  - The host (`assets/module-service-host.mjs`) handles only `storage-response`, `attach-renderer`
    and `drop-renderer`.
  - Every board service answers `init→ready`, `probe→probe-ack`, `request→response` and `shutdown`
    itself. There are three near-identical copies: the demo board (with a queue-until-ready shim),
    the torrent viewer, and `_test/range-provider-test`.
  - None of this is in `assets/guides` or the board template, so authors learn the wire protocol by
    copying the demo board.
  - The probe round trip exists only to check that the board wired its own listener.
- **Direction:**
  - The host owns `init`, `probe` and `shutdown`, and exposes `persephone.service.onRequest(handler)`
    and `persephone.service.onShutdown(fn)`.
  - It sends `ready` after the entry's top-level import settles, which replaces the demo board's
    queue shim.
  - Carry the host's hand-mirrored constants (`MAX_BUFFERED_PIPE_BYTES`,
    `MAX_BOARD_PIPE_CHUNK_BYTES`, and the deadline and cap that now arrive via argv) in `init`.
  - Accept the raw protocol for a transition period, so published boards keep working.
  - Serialise service errors as `{ code, message }` instead of the renderer recovering the code with
    `message.split(":")` plus an allow-list (`module-service.ts:62-93`).
  - Document the resulting API in the service authoring guide.
- **After US-1535:** the host keeps a `Map` of renderer leases (by lease nonce) and is now the only
  side that sends `lease-lost` to a renderer (main's copy went through an already-transferred port
  and never arrived). `drop-renderer` carries a `reason`. Keep both when the host takes over the
  lifecycle protocol.
- **After US-1544:** the host no longer times out provider operations (the renderer owns the one
  deadline, from `PROVIDER_OPERATION_POLICY` in `module-service-channels.ts`, and sends `cancel` on
  timeout). The host's only mirror is `CONTENT_READ_OPERATIONS` (the `requestClass` column); carry
  that in `init` too. The argv deadline is now used only for storage and renderer-port attach timers.

### US-1544: One provider-operation policy table (deadline, cap)

*Code-verified.* Small; do it early.

- **The same policy is decided in four places:**
  - `ProxyProvider.ts:141,211,226` passes `Infinity`;
  - `module-service.ts:299-303` has `isContentReadOperation`;
  - `module-service.ts:327-335` special-cases `Infinity`;
  - the host has `CONTENT_READ_OPERATIONS` and `UNBOUNDED_OPERATIONS`
    (`module-service-host.mjs:225-237`).
- **This drift has already shipped a bug:** `stat` stayed bounded in the host after the renderer
  and main unbounded it (`d07ed826`).
- **Two 10 s timers race on every control operation**, one in the renderer and one in the host.
- **Stale and dead bits:** the `ProxyProvider.ts:139-140` comment has been stale since `stat` was
  added; `unavailableError.serviceCode` is never read; and `providerDeclaration()` fabricates a
  declaration without `boardName`.
- **Direction:**
  - Add a `PROVIDER_OPERATION_POLICY` table in `ipc/module-service-channels.ts`.
  - `module-service.request` looks up the deadline from the operation.
  - The host mirrors the table, with a pointer comment; after US-1543 it receives it in `init`.
  - Keep one timer.

---

## Phase 3 — structure

### US-1545: Split the module-service supervisor; one state-transition helper

*Code-verified.* Large; each piece can be done on its own.

- **Done (US-1545):** supervisor split into `module-service-record.ts` (record/lease types, `ServiceError`), `module-service-leases.ts`, `module-service-handshake.ts` (`Handshake`, `routeProcessMessage`) and `module-service-restart-budget.ts` (`RestartBudget`); one `transition()` helper; typed `STOP_REASON_CODE` / `LEASE_LOST_CODE` / `STOP_REASON_LEASE_REASON` tables in `module-service-channels.ts`. Observable changes: an explicit stop during a start stays `explicit` (no interim `stopped/quit`), and a `stopping` status is now published. The lease-lost `renderer-port-attach-failed` code stays `service-exited` for pending requests (unchanged, so no bridge bump). `request()` keeps its `requestId` (it is live); only `deadlineMs` was dropped.

- **After US-1543:** line numbers above have moved. `init` now carries a `ServiceHostConfig` (limits + provider request classes; argv holds only the entry), the steady-state `response` branch decodes structured `{ code, message }` errors into `ServiceError`, and `requestModuleServicePort` resolves a result union instead of throwing. The renderer no longer parses codes from messages, so any reason→code unification here should produce codes, not strings to parse.

- **Mixed responsibilities:** `main/module-service-supervisor.ts` is 922 lines.
  - Steady-state message routing lives inside the `startOneAttempt` closure (`:625-690`). That
    placement already caused one defect: every reply after the handshake was dropped.
  - There are 14 `record.state =` assignments and 16 `emit` calls.
- **Reason→code mapping:**
  - `record.reason === "untrusted" ? "untrusted" : "quit"` is repeated five times.
  - The effect: an explicit stop during a start rejects waiters with `quit`, and `:537-539`
    overwrites the `explicit` reason.
  - Four hand-written reason→code maps disagree. For example, `renderer-port-attach-failed` maps to
    itself in main but to `service-exited` in the renderer.
- **Unreachable branch:** `handleUnexpectedExit`'s `:764-769` cannot run, and if it did, it would
  test a reason it had just overwritten.
- **Restart budget:** the literal `3` appears three times, and `statusOf()` mutates `restartCount`
  without the clamp.
- **Dead parameters and types:**
  - `request(boardRoot, requestId, message, deadlineMs)`: every caller passes a fresh id and the
    default deadline.
  - `ModuleServiceSupervisorApi` and `RendererLeaseState` are unused.
  - `watchKey()` is an identity function.
  - Both branches of `leaseLossCode` return the same value.
- **Stale comments:** two stacked JSDoc blocks, and `boards.ts:414-419` still says the lease "could
  never attach".
- **Direction:**
  - Add `routeProcessMessage(record, msg)` plus a small `Handshake` object.
  - Add one `transition(record, state, reason)` helper.
  - Put one shared reason→code table in `module-service-channels.ts`.
  - US-1535 added a third reason carrier: the host now settles a closed lease's pending requests with
    `error: <lease-lost reason>` (it used to send `service-exited`). The renderer rejects those
    requests first on `lease-lost`, so the value is not observed today, but the shared table should
    cover it. Leases are now `Map<webContents.id, lease>` with per-lease WebContents lifecycle
    listeners (`listenForLeaseLifecycle`), which belongs with the lease code when the file is split.
  - Add a `RestartBudget` class.
  - ~~Move `BoundedServiceLog` out of the supervisor~~ — done by US-1536: the class and its
    constants are gone; the supervisor now splits each stdout/stderr chunk into lines and calls
    `board-log.append(root, "stdout" | "stderr", line)` (a small closure in `startOneAttempt`).
  - Delete the dead items above.

### US-1546: One `__pipe` range reader in main; one MIME table

*Code-verified.*

- **The pull loop is duplicated:** `board-protocol-service.ts:316-392` and
  `video-stream-server.ts:680-755` implement the same algorithm, copied when US-1519 generalised the
  channel:
  1. first read;
  2. range resolution;
  3. the 416 and empty-body branches;
  4. a 6-clause reply validation (three copies);
  5. a `MAX_BOARD_PIPE_CHUNK_BYTES` continuation loop.

  EPIC-107's notes asked for the range code to be extracted, not rewritten.
- **Video file handlers:** `handleFileRequest` and `handleFaststartRequest` are near-identical and
  hand-build `Content-Range` instead of using the `range-utils` helpers.
- **Latent hang:** `streamVirtualRange` waits on `drain` only (`:319`), so a response that closes
  mid-drain never resolves.
- **Three MIME tables disagree:** `board-pipe-utils.ts`, `board-protocol-service.ts` and
  `video-stream-server.ts`. For example, `.ogg` is `audio/ogg` in two of them and `video/ogg` in the
  third.
- **Direction:**
  - `readPipeRange(kind, id, host, rangeHeader, signal)` in main returns the status and headers plus
    an async iterable of validated chunks. The protocol handler wraps it in a `ReadableStream`, and
    the video server writes it to `res`.
  - One `serveRange(totalSize, contentType, writeRange)` for the file paths.
  - One MIME table in `src/shared/`.
  - Handle `close` as well as `drain`.

### US-1548: One ownership registry for providers, schemes, capabilities and URL masks

*Code-verified.* Do before US-1549.

- **Duplicated refusal handling:** `content/registry.ts:146-227,367-376` and
  `content/scheme-registry.ts:56-138,181-188` carry identical `refusalToastKey`,
  `shouldReportBoardRefusal`, `reportDuplicate`, `reportReplacement`, `reportRejected` and
  `duplicateResult`, each with its own dedupe map.
- **Two channels for one refusal:** refusals also go to `registrationIssues` for Board Info
  (`custom-editor-registry.ts:243-257`). Each registry keeps its own state only to suppress repeat
  toasts caused by `refresh()` re-registering everything.
- **Duplicated checks and dead state:**
  - The provider-type namespace check is duplicated with an identical message
    (`custom-editor-registry.ts:375-385`, `registry.ts:245-248`).
  - `ProviderDeclaration.source` is never read.
  - The registry's `incompatibilities` state has no consumer (Board Info recomputes it).
- **`refresh()`** is a ~235-line function (`custom-editor-registry.ts:312-546`) that decides
  URL-mask ownership inline and repeats the bridge-compatibility check for untrusted boards.
- **Direction:**
  - Add one `OwnershipRegistry<T>`: first owner wins, clear by board origin, and board refusals are
    returned rather than toasted.
  - `refresh()` becomes: collect normalized sources, then run per-axis `{ collect, commit }` steps,
    and toast only issues that are new against the previous generation.
  - Delete the dead state listed above.

### US-1549: Board manifest parsed once into a normalized model

*Code-verified.* Fixes one visible defect: the script facade drops newer manifest fields.

- **Visible defect:** `BoardEditorFacade.copyManifest` (`scripting/api-wrapper/BoardEditorFacade.ts:553-615`)
  hand-copies the manifest and silently drops `browserUrlMasks`, `contentMasks`, `singleInstance`,
  `settings` and `guides`. `IBoardManifest` in `api/types/board-editor.d.ts` does not declare them
  either.
- **Repeated code in `board-manifest.ts`:**
  - The same "array → strings → trim → dedupe → cap" loop is written eight times.
  - Three normalizers are pass-through wrappers.
- **Missing shared types and helpers:**
  - The `editorKind` union is written out about 14 times.
  - The "host owns the pipe" test is reinvented five times (`board-manifest.ts:756`,
    `custom-editor-registry.ts:666`, `editor-switch-options.ts:87,97`, `BoardEditorModel.ts:656`,
    `BoardEditorFacade.ts:601`).
  - `CustomEditorMatch` repeats `BoardEditorAssociation` field for field.
- **Direction:**
  - Add `normalizeStringList(raw, { map, max, accept })`.
  - Export a `BoardEditorKind` type and a `hostOwnsPipe(kind)` helper.
  - Add one `parseBoardManifest(raw) → NormalizedBoardManifest`, computed once per source in the
    registry, and read by the registry, Board Info, the facade and the trust dialog. The facade then
    becomes a projection that cannot drift.
  - This does not reopen EPIC-106 D1 (`permissions` stays disclosure).
- **After US-1548:** `custom-editor-registry.refresh()` now reads every source's manifest up front
  into one `BoardRefreshSource[]` (trusted, bundled, installed) and passes it to per-axis
  collect/commit functions, each re-deriving the board name and calling the `board-manifest.ts`
  normalizers itself. `parseBoardManifest` belongs at that single read point, replacing
  `BoardRefreshSource.manifest`. The `incompatibilities` state is gone; Board Info computes bridge
  compatibility itself.

### US-1550: Scheme hooks — a `handoff()` helper and shared URL helpers

*Code-verified.* Includes one small bug.

- **Hand-rolled delegate protocol:** `data.handled = false; await context.delegate(); data.handled = true;`
  appears about 12 times in `builtin-schemes.ts` and twice in `createBoardSchemeHooks`, often behind
  a redundant `phase === "source-path"` guard (the source-path phase already passes a no-op
  delegate).
- **Duplicates:**
  - `parseHttp` and `parseData` are identical.
  - Six resolvers are one-line aliases of `resolveVirtual`.
  - `resolvers.ts:53-63` re-implements the virtual placeholder descriptor.
- **Scattered URL helpers:**
  - `extractEffectivePath` has three copies (`builtin-schemes.ts:117`, `resolvers.ts:9`, and
    `schemeEffectivePath` in `custom-editor-registry.ts:190`).
  - `splitUrlFragment` has two copies.
  - A scheme-extraction regex appears in six places.
- **The bug:** `scheme-registry.ts:52` extracts the scheme case-sensitively, while
  `isSchemeRegistered` normalises case. So `TORRENT://…` passes the pipeline-candidate gate, misses
  dispatch, and ends in an "Invalid file path" toast.
- **Direction:**
  - `SchemeHookContext.handoff()`, which does the toggling and is a no-op in source-path.
  - Register `resolveVirtual` directly.
  - Export `schemeOf(value)` from `scheme-registry.ts`.
  - Move `effectivePathOf` and `splitUrlFragment` into `link-utils.ts`.

### US-1551: Single-instance board routing in one place; a typed open-context hook

*Code-verified.*

- **Duplicated routing:**
  - `open-handler.ts:12-17` (`resolveBoardRoot`) is a verbatim copy of
    `PagesLifecycleModel.resolveBoardRootForOpen`.
  - `open-handler.ts:45-63` re-implements `openSingleInstanceBoard` and `enqueueBoardSource` for the
    `pageId` branch, and the two copies already disagree on where the source URL comes from.
- **Duck-typed casts:** generic `openFile` casts to three board-only methods: `setInitialBoardIntent`,
  `enqueueSourceUrl` and `registerSourceSessionHandle`.
- **Direction:**
  - Make `navigatePageTo` route singletons through the one `openSingleInstanceBoard`, and delete the
    open-handler copy.
  - Replace the casts with one optional typed `EditorModel` hook, for example
    `acceptOpenContext?({ sourceUrl, sessionHandle })`, next to the existing `onReopen` and
    `revealFragment`. If US-1540 has landed, the intent part is already gone.
- **After US-1549:** the single-instance reads (`open-handler.ts`, `PagesLifecycleModel.ts`) still
  call `isBoardSingleInstance` on a raw `readBoardManifest`. `readNormalizedBoardManifest(root)`
  now exists, and its `singleInstance` field is the normalized value; use it at the one routing point.

### US-1552: Video pipe sessions use the `resource` pipe kind; delete the page-owner waiters

*Code-verified.* Large. Do before US-1553.

- **After US-1546:** the video server no longer has its own pull loop. `servePipeRequest` calls
  `readPipeRange("page", pageId, undefined, rangeHeader, signal)` in `src/main/board-pipe-range-reader.ts`,
  so switching to the `resource` kind means changing that call and how the session registers its
  resource id. The range and validation code does not need to change.

- **Why the waiters exist:** EPIC-113 reused the board `page` pipe kind for the video server, so a
  video session can exist only once main knows the page. During restore, editors run before
  `attachPage()`, and US-1528 covered that ordering with a waiter queue.
- **What the waiters cost:**
  - `PageModel.ts:94-138` has the registrar, the registration and the waiters.
  - `IPageHost.ensurePipeOwner` exists for them.
  - `PagesModel.ts:70,117` installs and clears the registrar.
  - `VideoEditor` makes a second staleness check after the await.
  - `board-pipe-handler.ts:141-158` duck-types `mainEditorInstance.pipe`.
- **Latent conflict:** two registrars write the same owner record, one without a host (the page) and
  one with a host (`BoardWebview.ts:377`). `board-pipe-service.read()` requires `owner.host === host`,
  so board `__pipe` reads work only because attach happens before the frame's port transfer.
- **Direction:**
  - The video editor registers its own pipe as a `resource` under an opaque id when it creates the
    session, and invalidates it in `dispose()`. `createVideoStreamSession({ pipeResourceId })` does
    both in one step, so ownership is atomic with creation. Main's `registerResource` must accept a
    host-less resource.
  - Delete the waiter machinery, `IPageHost.ensurePipeOwner`, the host-less page registrar and the
    duck-typed fallback.
  - A video that is not the page's main editor also becomes streamable.
- **Acceptance:**
  - Restore a window with a torrent video page: it plays with no retry.
  - Board `__pipe` reads are unaffected.

### US-1553: VideoEditor's source flow in one place; one provider-recovery helper for all editors

*Code-verified.*

- **Four copies of one flow in `VideoEditor.ts`:**
  - The "is pipe source" predicate is repeated four times (`:105, 133, 197, 280`).
  - The "bump `sourceRequestId`, resolve the stream URL, commit if still current" block is repeated
    in `setPage`, `onReopen`, `submitUrl` and `restore`. US-1528 added the fourth copy.
  - `restore()` infers "board gone" by re-parsing the scheme, because `pipeFromLink` throws an
    untyped `Error`.
- **Other VideoEditor issues:**
  - `dispose()` sweeps sessions for the whole page, which the old editor's deferred dispose can do
    to the new editor on next-track navigation.
  - A doc comment sits on the wrong function (`:166-172`).
- **`onReopen` wastes a pipe:** `PagesLifecycleModel.ts:543-545` disposes the fresh pipe the pipeline
  just built, and then the editor rebuilds its own.
- **Provider recovery differs per editor:**
  - text: dedupe toast plus `pipe.watch` (`TextFileIOModel.ts:41-48`);
  - image: re-run `restore()` on `available` (`ImageEditor.ts:126-130`);
  - `pipe-image-src.ts:93-96`: another variant;
  - video: no availability watch at all, so a late board provider recovers text and images but not
    video.
- **"Rebuild pipe from persisted state"** is re-implemented in `BoardEditorModel` (twice),
  `TextEditorModel` and `VideoEditor`.
- **Direction:**
  - In `VideoEditor`, add `sourceKind(url, format)` and one `startSource(...)`.
  - Add a typed `UnresolvableLinkError { scheme, registered }` from `pipeFromLink`.
  - Change the hook to `onReopen(pipe?) → boolean`: the editor adopts the fresh pipe or declines it.
  - Add a shared `watchSourceRecovery(pipe, onAvailable)` and `reportProviderError(error)`.
  - Add `pipeFromPersistedSource(sourceLink, fallbackPath)` in `rebuild-pipe.ts`.
  - Drop the page-wide sweep from `dispose()`.
- **Finding from US-1547 (live):** a stream-host page restored while its board was untrusted came
  back with `state.boardRoot` in backslash form, while the registry and trust list use forward
  slashes. `BoardEditorModel.editorKind` compares roots with `===` (`BoardEditorModel.ts:650`), so
  after re-trust the page stays `simple` and `persephone.host.streamUrl()` is refused until the root
  matches. Compare board roots with `fpNormalizeForCompare` here and at the other exact comparisons
  (`PagesLifecycleModel.ts:201, 316, 353`, `custom-editor-registry.ts:199`), and find where the
  backslash form is introduced on restore.

### US-1554: Board trust granting, bundled-board creation and Board Info each have one path

*Code-verified.*

- **Trust granting:** the read manifest → build disclosure → show dialog → namespace-collision check →
  `boardTrust.trust` sequence is copied three times (`api/boards.ts:301-323`,
  `BoardEditorView.ts:276-286`, `BoardInfoEditorModel.ts:645-657`). `boards.ts` already fails to pass
  `capabilities`, which `TrustBoardDialog.ts:24-25` covers by re-reading the manifest. Add one
  `requestBoardTrust(boardRoot)` next to `board-access.ts`, and make the dialog's `capabilities` prop
  required.
- **Hard-coded Excalidraw:** `tools-editors-registry.ts:224-229` creates **every** bundled
  content-host board as `"json"` / `"untitled.excalidraw"`. Derive the name and language from the
  manifest's first `fileMasks` entry, or add an optional manifest field. The
  `disabled-bundled-boards` setting is also read in three places, where EPIC-109 D4 says two.
- **Board Info:** `open-board-info.ts:22-45` re-implements `BoardInfoEditorModel.switchFrom`'s path
  capture, and the switch path skips the `confirmRelease` veto. Make one path.
- **Roadmap correction:** "Needs user verification" item 10 is not a code defect. Properties mode is
  reachable from an open board through the board menu's **Board properties** item
  (`BoardToolbar.ts:185-208`); the verification attempt used an editor switch, which lands in install
  mode by design. Update that roadmap note when this story closes.
- **After US-1549:** the trust *disclosure* is already single-sourced: `boardTrustDisclosure(manifest)`
  in `board-manifest.ts` is used by `BoardEditorView.trustBoard`, `BoardInfoEditorModel.register` and
  `boards.registerBoard`. The three trust-granting flows themselves are still separate.

### US-1555: Small dead code, stale comments and a torrent-specific notice in core

*Code-verified.* Small.

- **Torrent wording in core:** `main/download-service.ts:135-140` tells **every** board's
  private-session claimed download that "the swarm connection is not anonymous", which is
  torrent-specific wording in core (EPIC-114: core must not know which board claims `torrent:`).
  Pass the private-session flag through `eOpenClaimedBrowserDownload` and let the board say it.
- **`board-pipe-handler.ts`:**
  - Collapse the two `resolveTotalSize` branches, which both `stat()` because
    `ProxyProvider.createReadStream` is a getter whose answer changes when capabilities arrive.
  - Drop `PendingRead.cancelled`, which duplicates `signal.aborted`.
  - Write the cancel loop once instead of three times.
- **Dead code:**
  - `PagesModel.resubscribeEditor` is a no-op with no callers and a broken comment.
  - The empty untracked `src/renderer/editors/draw/` folder.
  - `bundled-board-registry.ts:89-101` hand-rolls case folding although it imports
    `fpNormalizeForCompare`.
  - The board identity `author/name` is built twice (`custom-editor-registry.ts:406`,
    `board-namespace.ts:29-32`).
  - `app-service-registry.ts` repeats `initialize: undefined as undefined` twelve times; a
    `defineService()` helper would remove it.
- **Stale comments:**
  - `board-shim.ts:1693`: the storage comment sits on the `service` block.
  - `board-storage.ts:33`: "future service adapter (US-1468)".
  - `app.ts:178`: "handles CLI arguments".
- **Stale backlog entry:** `doc/tasks/backlog.md` still lists the platform roadmap as an unscheduled
  proposal under "Recorded Epics".
- **Found live in US-1542 (pre-existing, not yet investigated):** a board `toolbar.update([{ id, title }])`
  patch does not change the rendered host button's `aria-label`. Excalidraw's theme button keeps
  "Switch to Light Theme" after toggling. HEAD shows the same result. Look at
  `BoardToolbarControls.updateCatalog` → `record.updateDescriptor`.

---

## Checked and found clean

So that nobody re-reviews these areas:

- The frame/renderer message types are imported from one place (`board-bridge-channels.ts`), so the
  EPIC-108 split-contract defect itself is fixed; what remains is US-1539 and US-1542.
- `BOARD_BRIDGE_VERSION` has one source.
- The main-side service and storage RPC is a clean method table.
- `board-storage.ts`, `module-service-storage.ts`, `session-src-protocol.ts`, `board-file-icons.ts`
  and `board-navigation-return.ts` are all clean.
- The EPIC-105 service descriptor table is sound (apart from the noise noted in US-1555).
- US-1463's bootstrap ordering is correct (only its URL route is wrong; see US-1537).
- No new direct `require("fs"/"path")` in the renderer; `errMessage()`/`guard()` is used throughout.
- No Excalidraw/draw leftovers beyond the intended EPIC-110 migrations.
- Deferred features (the DataHandle store, cross-window routing, credit frames and the pipe loading
  state) have no messy stand-ins in the code.
