# EPIC-097: Persephone adopts the library and mounts remote trees

## Status

**Status:** Completed
**Created:** 2026-09-08
**Completed:** 2026-09-08

Epic 2 of 3 in the [AiVision library roadmap](../ai-vision-library-roadmap.md). It depends on
[EPIC-096](EPIC-096.md) (`ai-vision` published on npm) and is the precondition for EPIC-098
(the todo board exposes its model).

## Overview

Two outcomes, one mechanism.

1. **Persephone stops shipping its own AiVision engine.** `src/shared/ai-vision/`,
   `src/renderer/scripting/ai-vision/elements.ts` and `assets/agent/ui-highlight.js` are replaced by
   imports from the published `ai-vision` package and deleted. One engine, no vendored copy
   (roadmap principle 1).
2. **A board or a browser page can mount its own object model into the `call` tree** at
   `pages[id].editor.app`. The remote party publishes a serializable *shape*; Persephone runs the
   one engine over a proxy built from that shape by the package's `createRemoteProxy`. Shape crosses
   the boundary; the engine does not (roadmap principle 2).

Everything is additive: a board or page that does not register a shape has no `.app` node and looks
exactly as it does today (roadmap principle 4).

## Goals

- `ai-vision` a normal npm dependency; no internal copy of the engine, the elements helper, or the
  highlight overlay left in the repository.
- `board:aiVision` registration plus an `ai:*` request/reply pair on the board bridge, bridge
  version `1.3.0`, `persephone.aiVision.expose(root)` available to every trusted board.
- `.app` on `BoardEditorFacade` and `BrowserEditorFacade`, gated by the existing trust and
  private-page refusals, with `$help`, `helpSearch`, writable properties, methods, `elements` and
  `highlight` all working through it.
- A four-level timeout policy whose errors name the level that applied and the path.
- Guides and `board-api.d.ts` telling a board author how to expose a model.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1389 | Adopt the `ai-vision` package and delete the internal copies | Done |
| US-1390 | Board bridge: `board:aiVision`, `ai:*`, the `.app` proxy, and the timeout policy | Done |
| US-1391 | In-frame elements and highlight, with `view` routing to secondary frames | Done |
| US-1392 | Browser-page proxy: probe `window.__aiVision` over CDP and mount `.app` | Done |
| US-1393 | Guides, What's New, and `board-api.d.ts` | Done |

Steps 1–5 of the roadmap map onto US-1389…US-1391; steps 6–8 onto US-1392…US-1393. The roadmap
permits splitting the epic after step 5; the intent here is to complete all eight in one epic and
split only if review size forces it.

## Scope in detail

### US-1389 — Adoption (roadmap step 1)

- `npm install ai-vision` (a normal semver dependency, **never** `file:`).
- Every importer of `src/shared/ai-vision/*` (83 files at the time of writing — re-derive) imports
  from `ai-vision` instead. Nothing is renamed: EPIC-096 decision 6 kept every `IAi*` name, so this
  is an import-path change only.
- `src/renderer/scripting/ai-vision/elements.ts` is replaced by `createElements` from `ai-vision/dom`.
  Persephone's `IHighlightOptions` / `IHighlightResult` / `IHighlightRevealRequest` are structurally
  the package's `IAiHighlightOptions` / `IAiHighlightResult` / `IAiElementRevealRequest`; the
  highlight function stays injected, exactly as today.
- `assets/agent/ui-highlight.js` is deleted. `src/renderer/api/ui.ts` stops fetching
  `app-asset://agent/ui-highlight.js` and imports `installHighlightOverlay` from `ai-vision/dom`
  instead (decision 4 below), which also removes the `ui-highlight.js: HTTP …` failure mode.
- The overlay's global becomes `window.__aiVisionHighlight` (EPIC-096 decision 4): update the
  `IHighlightApi` declaration in `ui.ts` and its call sites.
- Docs: `doc/architecture/key-files.md` (the overlay row and the `src/shared/ai-vision` rows),
  `doc/architecture/scripting.md`, `doc/architecture/folder-structure.md` (the `assets/agent/` line),
  and the two "Persephone does not consume it yet" pointers EPIC-096 left behind.
  `doc/standards/coding-style.md` has a documented exception for `assets/agent/ui-highlight.js`
  that must go with the file.

**Order matters (roadmap principle 5).** The internal copies are deleted only after the build is
green against the package and the AiVision QA surfaces behave identically.

### US-1390 — Protocol, board proxy, timeouts (roadmap steps 2–4)

**Protocol** (`src/ipc/board-bridge-channels.ts`, dependency-free by rule):

- `BoardToHostMsg.__persephone` gains `"board:aiVision"` (shape registration, board → host, fire and
  forget) and `"board:aiResult"` (the reply half of a host-initiated leaf request, carrying `reqId`).
- A new renderer → board pushed message `{ __persephone: "ai:request", reqId, request }` mirrors
  `BoardFilePathResultMsg` / `BoardVarResultMsg` in the opposite direction: today every
  request/reply pair on this channel is board-initiated, and the `.app` proxy is the first
  host-initiated one.
- Wire types for the shape and the `ai:*` request/response are **imported type-only from the
  package** (`IAiVisionShape`, `IAiRemoteRequest`, `IAiRemoteResponse`), not restated — the package
  owns the contract and `board-bridge-channels.ts` may import types from a dependency-free module.

**Shim** (`src/board-shim.ts`): imports `expose` from `ai-vision/remote`, adds
`persephone.aiVision = { expose(root), schemaVersion }`, posts `board:aiVision` with
`{ schemaVersion, shape }` after its load signal, and answers `ai:request` by calling the remote's
`handle()` and posting `board:aiResult`. `persephone.version` → `"1.3.0"`.

**Board proxy**:

- `BoardEditorModel` stores the registered shape per frame-generation, cleared by `reload()` and by
  frame teardown; `BoardWebview.handleMessage` validates and forwards `board:aiVision`, and owns the
  `ai:request` / `board:aiResult` correlation the way `resolveVariable` owns `board:var`.
- `BoardEditorFacade` gains an `app` member, present in `members` and `provide` only while a shape
  is registered, built by `createRemoteProxy(shape, send, { restricted, onWarning })`. `restricted`
  is the facade's existing `restricted()`; `onWarning` writes to the board's `ui.log`
  (the same file `BoardWebview.appendLog` writes) — this is the wiring EPIC-096 decision 5 left here.
- The facade's `help` gains one line pointing at `.app` when a shape is registered.

**Timeouts** — four levels, most specific wins, enforced host-side:

1. per-call `timeoutMs` on the `call` request (alongside the existing `maxLength`);
2. the remote-declared `timeoutMs` on a serialized method, surfaced in its hint line;
3. `boards.callTimeoutMs`, a writable property on the `boards` namespace, renderer memory only;
4. 30 s built-in default.

`resolveTimeoutMs(perCall, declared, runtime, fallback)` from the package implements the precedence
so it is not reimplemented. A timeout error names the level and the path. The inbound direction
(`runBoardCall` in `src/main/board-bridge.ts`) reads the same level-3 value.

### US-1391 — In-frame elements and highlight (roadmap step 5)

The host cannot query inside a cross-origin frame, so visibility and the overlay run remotely: the
package's `remote` entry answers `ai:elements` and `ai:highlight` using its own `dom` entry inside
the board frame. Persephone's part is routing — an element declaration may name a `view` (`"main"`
or a secondary view id), and the host must auto-mount that panel through the existing
`BoardTargetModel.ensureReady` path before posting the request to that frame. Secondary frames do
not register shapes: one board, one root, shared through `persephone.state`.

### US-1392 — Browser-page proxy (roadmap step 6)

After each completed navigation, `BrowserEditorFacade` / `BrowserEditorModel` probes for
`window.__aiVision` over the existing CDP `evaluate` path, caches the shape on the browser model per
navigation, and mounts the same proxy with a CDP-`evaluate` sender. `agentMayAccessBrowserPage`
runs **before** any probe (a private page is never probed, let alone mounted). Page-contributed
results and hints are labelled page-origin, and the shape may populate only the `.app` subtree
(decision 2 below). A page without the global costs one `evaluate` per navigation.

Test surface: the library's demo page, `C:\projects\ai-vision\examples\demo-page\index.html`, opened
from `file://` in a Persephone browser tab.

### US-1393 — Guides and `board-api.d.ts` (roadmap steps 7–8)

`assets/board-template/CLAUDE.md`, `assets/guides/agents/boards.md`,
`assets/guides/agents/browser.md`, and `assets/guides/screens/*` where `.app` or the overlay asset
appears (`screens/index.md` documents `fetch("app-asset://agent/ui-highlight.js")` and the
`ui-highlight.js: HTTP …` failure, both of which US-1389 removes). A What's New entry under
`## Version 5.0.1 (Upcoming)`.

`src/renderer/editors/board/board-api.d.ts` calls itself the canonical author reference but lacks
`call`, `view`, `state.*`, `host.*`, `readFile`, `writeFile`, `getFilePath` and `setSecondaryViews`.
Bring it current — including `aiVision` — or demote its header; boards are documented by prose
(recorded preference: boards are agent-authored, so prose guides beat IntelliSense typings).

## Design decisions

**1. The proxy builder lives in core.** Inherited from [EPIC-096](EPIC-096.md) decision 1, which
closed the roadmap's first open question: `core` depends on nothing, so a host that only mounts
shapes never pulls in `window`. Persephone imports `createRemoteProxy` from `ai-vision`, not
`ai-vision/remote`.

**2. A remote party populates only its own `.app` subtree — no page-level contribution.** The
roadmap's second open question, resolved as proposed. A remote `summarize()` feeding the `pages`
overview would put remote prose in front of an agent that has not chosen to look at the page yet:
the `pages` overview is read on the way to *everything*, so a page could advertise instructions to
an agent that never intended to visit it. `.app` is opt-in by construction — an agent reaches it
only by naming it. Nothing a remote party declares can shadow the facade, the page or the root.
Residual cost: a board cannot make its state visible in the page list, so an agent must open `.app`
to see it. That is the intended asymmetry.

**3. `boards.callTimeoutMs`, not a new `runtime` root.** The roadmap's fourth open question,
resolved as proposed. One knob does not justify a root node, and `boards` is where every other
board-wide control already lives. If a second in-memory knob appears, promote both then; a root
created for one property would have to keep it forever for compatibility. It is deliberately **not**
a `settings.json` key: a session's tuning must leave nothing behind, so it lives in renderer memory
and resets on reload.

**4. The renderer imports the overlay; it no longer fetches the asset.** `assets/agent/ui-highlight.js`
exists because a *frame* needed a copy of the source it could be handed. With the package,
`ui.ts` can `import { installHighlightOverlay } from "ai-vision/dom"` and a remote party's own
`expose` bundles the overlay inside its frame, so no source string has to travel. Deleting the asset
therefore removes an `app-asset://` fetch, a failure mode (`ui-highlight.js: HTTP …`), and the
`coding-style.md` exception the file needed. `highlightOverlaySource` stays available in the package
for the day a host must inject the overlay into a frame it does not own; Persephone no longer does.

**4b. `moduleResolution` moves from `node` to `bundler`.** The package publishes its entry points
through an `exports` map, and node10 resolution cannot read one — `import … from "ai-vision/dom"`
type-resolved to nothing under the old setting. `bundler` is the honest description of this project
anyway (every entry point is bundled by Vite/rolldown), but it is not free: it also honours
`exports` for `@excalidraw/excalidraw`, whose map omits the `dist/types/**` declaration files the
draw island imports directly, so `tsconfig.json` carries one `paths` entry mapping those back.
Type-only; no runtime import changes.

**5. The shim bundles the package's `remote` entry — measured cost, accepted.** `board-shim.ts`
builds as a standalone browser IIFE inlined into every served board HTML, so a dynamic `import()`
is not available under `board://` — the code must be in the bundle. The shipped measurement is
**100,762 served bytes / 28,698 gzip**, against a 46,591-byte unwrapped pre-adoption baseline:
about **+13 kB gzip per served board document**, roughly half of it the highlight overlay US-1391
added. Every board pays it, including each secondary-view frame, whether or not it calls `expose`.
That is not the "small" cost this decision first assumed.

Accepted anyway, twice over. The alternative for the remote entry — a second `board://` path
serving it, fetched by `persephone.aiVision.expose` on first use — buys back bytes that never cross
a network (the protocol handler answers from a string already in memory) at the cost of a new served
path, a CSP question, and an async `expose` a board must await before its first registration. The
alternative for the overlay — the host injecting `highlightOverlaySource` into the board frame over
the existing CDP `evaluate` path — would keep ~13 kB out of every board document but makes highlight
depend on CDP being attached, and splits across two mechanisms what the library deliberately keeps in
one. The synchronous `persephone.*` surface is the shim's defining property and neither trade is
worth it for local decompression. Revisit if the shim gains another entry of this size.

**6. Main stays the single enforcement point for the inbound direction; the shim's timer becomes a
dead-port guard.** `runBoardCall` (`src/main/board-bridge.ts`) already posts a `call-result` on both
success and timeout, so the shim's own 30 s timer at `src/board-shim.ts` is a second, *shorter*
deadline that would fire before a raised `boards.callTimeoutMs` and reject a call main was still
happy to run. The shim's constant is therefore reframed as a generous dead-port guard (the port
being replaced mid-call is the only way no reply arrives) and main's value — which reads the runtime
knob — is the policy. No new `MainToBoard` message is needed for this.

**7. Level 3 crosses to main by push, not by pull.** `boards.callTimeoutMs` is renderer memory and
`runBoardCall` runs in main, so the setter pushes the new value to main over the existing api IPC
surface and main keeps it in a module variable, defaulting to 30 s. Main never reaches into the
renderer for it, and a renderer reload resets both sides to the default.

**8. The library was patched before adoption, not forked.** EPIC-096 deliberately left one inherited
quirk in the package — `shapeValue` calling a nested node's `summarize()` without awaiting it, so an
async nested summary lands in a shaped result as a Promise and serializes to `{}`. Fixing it on one
side only would fork the engine, which is the thing this epic exists to prevent, so it was fixed in
`ai-vision` first (commit `9105ad4`, released as `v1.0.1`) and Persephone depends on `^1.0.0`, which
picks the fix up as soon as the release publishes. See "Library dependency" below.

## Library dependency

Persephone depends on **`ai-vision@^1.0.1`**, installed from npm — never `file:`. `1.0.1` carries
decision 8's fix and was released from the library repository by tagging `v1.0.1`, which the
repository's trusted-publishing workflow publishes with provenance. The first attempt at that
release failed with `E404 PUT /ai-vision` because npm had no Trusted Publisher configured for the
package yet; re-pushing the tag after the configuration landed published it.

**9. The runtime knob starts unset, so the built-in default stays reachable.** Found by the gate
run: `boardCallTimeoutMs` was initialised to `30_000` on both sides, which made level 3 apply to
every call and level 4 — the built-in fallback the whole policy rests on — unreachable. The knob is
now `number | undefined` in `src/renderer/api/boards.ts` and `src/main/board-bridge.ts`; the public
`boards.callTimeoutMs` getter still reports the *effective* value (30 000 when unset, which is what
an agent wants to know), and a separate `explicitBoardCallTimeoutMs()` supplies level 3's input. The
general lesson is worth keeping: each level was individually correct and the composed policy was
wrong, which only an end-to-end run could show.

**10. Page-authored content is labelled by prefixing the node's `kind`, not its prose.** The
alternative considered was prepending a marker to every summary, member summary and element purpose
in a page's shape. That labels everything and reads as noise on every hint line and every
`helpSearch` hit. Prefixing the remote node's kind (`DemoApp` → `page:DemoApp`) is one host-controlled
transformation that surfaces in the hint header, the member-list header, and — the leaky case —
`IHelpSearchHit.kind`, which is shown without its surrounding node. It is combined with
`createRemoteProxy`'s `originNote` (which the package appends to `help`, so `$help` carries the full
warning), a marker on the root node summary, and a page-labelled `.app` member summary on the facade.
The page's own prose is left untouched.

**11. One timeout knob, two consumers — revisit at three.** `boards.callTimeoutMs` now also bounds a
browser page's `.app` calls, which its name does not advertise; its member summary and `$help` say
so explicitly instead. Decision 3 rejected a general `runtime` root because there was one knob, and a
second *consumer* is not a second knob. A third consumer is the point at which promoting it to a
general in-memory `runtime` node earns the root member.

**12. `board-api.d.ts` was demoted, not completed.** US-1393 found it is not consumed by the board
scaffolding, by a template, or as a Monaco extra-lib — nothing loads it — so maintaining it as a
complete typing surface would be work no one reads. Its header now says what it actually is and
points at the prose guides, which are the maintained reference for a board author (boards are
agent-authored; prose beats IntelliSense typings for them). `aiVision`, `createElements` and bridge
version `1.3.0` are discoverable from it.

## Gate

The roadmap's gate, run against the dev app over MCP `call`:

1. The AiVision QA surfaces in `qa/surfaces/` are unchanged in behaviour after adoption.
2. A new `qa/surfaces/` page for `.app`, exercised on a board **and** on the library's demo page:
   - the shape registers, and `.app` appears on the facade's member list only then;
   - `$help` and `helpSearch` see the remote members and element purposes;
   - a writable property round-trips;
   - a method invokes;
   - a timeout fires at each of the four levels, and each error names its level and the path;
   - `highlight` draws inside the board frame and inside a secondary view;
   - an untrusted board refuses, and a private browser page refuses before any probe.
3. `npx tsc --noEmit` and `npm run lint` clean; a production build succeeds.
4. The run is recorded in `qa/runs/`.

Test boards: the demo-board template or a scratch board under `C:\projects\test-boards`.
`persephone-boards/boards/todo` is **not** touched here — that is EPIC-098.

## Gate results (2026-09-08)

Full record: [qa/runs/2026-09-08-epic-097-remote-app.md](../../qa/runs/2026-09-08-epic-097-remote-app.md),
against the surface [qa/surfaces/remote-app.md](../../qa/surfaces/remote-app.md).
**7 PASS, 1 PARTIAL, 0 FAIL.**

1. **Existing surfaces unchanged.** The root overview, `helpSearch`, `ui.elements`, `ui.highlight`
   and `ui.clearHighlights` all answer as before, with the engine and the overlay now coming from
   the package.
2. **Board `.app`:** an untrusted board refuses with the existing Trust-this-Board text and
   registers no shape; once trusted, the node resolves, `$help` and `helpSearch` see its members, a
   writable property round-trips, an indexed hop returns the *item's* shape, a method invokes and
   changes the board's UI, and a reload re-registers.
3. **Four timeout levels** each fire, each error naming the level and the agent-typed path —
   403 ms / 1509 ms / 1201 ms / 30014 ms for levels 1 to 4. Level 4 required decision 9's fix.
4. **In-frame highlight:** `[data-ai-vision-highlight]` exists in the main board frame *and* in the
   `board-secondary:notes` frame — one overlay per document, drawn inside the frame rather than over
   the host chrome.
5. **Browser page:** the library's demo page mounts as `page:DemoApp` with the `[Page-authored data]`
   root marker; `$help` carries the origin warning and `helpSearch` hits carry the prefixed kind. A
   page with no global has no `.app` and no error; a private page is refused before any probe.
6. `npx tsc --noEmit`, `npm run lint` and `npm run build-prod` clean.

**The one PARTIAL** is not this epic's defect: after navigating a browser tab to `about:blank`, the
shared CDP `evaluate` path still answers from the previous document (`editor.evaluate` shows it
independently of `.app`), so a stale `.app` can answer for that one navigation target. Pre-existing,
no new exposure, and logged in [tasks/backlog.md](../tasks/backlog.md) under Architecture
Improvements, because the fix belongs to the automation layer every browser tool shares. Also not
exercised by call: the unmounted-secondary-view `visible: false` note, because a board secondary
panel cannot be collapsed through the object model — verified by inspection instead.

## Notes

### 2026-09-08

- **`/review` findings, both acted on.** (1) *Must-fix:* the `.app` proxy is built from one
  registration's shape, but its `send` closure did not check that the registration was still the
  one it was built from — after a reload a proxy handed out earlier would address the new
  document's frame. `sendAiVision` now carries the registration token and refuses with a message
  telling the agent to re-read `pages[i].editor.app`. (2) The `call` tool's `timeoutMs` description
  said "a remote board leaf call", which names an internal concept and omits browser pages; it now
  says what an agent needs — which paths it affects, when to raise it, and the default.
- **Adoption incident.** The dev build broke briefly mid-US-1389: the sweep emitted deep imports
  (`ai-vision/path-parser`) that the package's `exports` map does not expose, so rolldown could not
  resolve them and the main build failed. Fixed by importing from the public entries only
  (`ai-vision`, `ai-vision/dom`) — everything Persephone uses is re-exported from the core barrel —
  and by decision 4b's resolution change, without adding subpath exports for internal modules.
- Epic opened. `ai-vision@1.0.0` is published; the epic's first act was fixing the one quirk
  EPIC-096 left in the library (decision 8) so that adoption starts from a package that needs no
  local patch.
