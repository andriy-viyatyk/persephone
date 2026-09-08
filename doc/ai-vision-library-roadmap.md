# AiVision Library Roadmap — one engine, published; boards and web pages join the `call` tree

**Date:** 2026-09-08
**Builds on:** the AiVision programme (EPIC-083 … EPIC-091, [epics/completed.md](epics/completed.md))
— `call` is the only MCP tool and every built-in surface has a descriptor — and the board subsystem
(EPIC-034 … EPIC-047), whose bridge already lets a board call *into* the tree with `persephone.call()`.
**Tracking:** each epic below gets its own `doc/epics/EPIC-XXX.md` when it starts and appears on
[active-work.md](active-work.md) only while active. This document is the sequence and the rules;
it is not a dashboard. Numbers quoted here are a snapshot of 2026-09-08 — re-derive, never quote.

## The goal

Two outcomes, one mechanism.

1. **The AiVision engine becomes a published, MIT-licensed library** in its own repository, so that
   any application — Persephone first — can give an agent the same self-correcting `call` surface:
   descriptors, path resolution, hints, `helpSearch`, argument validation, `elements` and `highlight`.
   Persephone consumes the library and deletes the internal copy.
2. **A board or a web page can expose its own object model to Persephone's `call` tree.** An agent
   driving Persephone drives the board the way it drives a built-in editor: structured state, named
   actions, `$help`, `helpSearch`, `elements`, `highlight`. Today the inside of a board is reachable
   only as accessibility-snapshot text plus opaque refs — right for a web page, wrong for an editor
   Persephone used to ship itself. The proving board is `persephone-boards/boards/todo`, a former
   built-in rebuilt as a content-host board; other built-ins are planned to follow the same route.

The remote party hands Persephone a **data contract**, never an engine. Persephone already injects its
own code into every board frame and already drives every browser page over CDP; the engine stays in
one place and runs once, on the host.

## Principles

1. **One engine.** The library is the only implementation. Persephone imports the package and has
   deleted its former `src/shared/ai-vision/`, `src/renderer/scripting/ai-vision/elements.ts` and
   `assets/agent/ui-highlight.js` copies. No fork, no vendored copy.
2. **Shape crosses boundaries; engines do not.** A board or page publishes its descriptor tree as
   serializable data plus leaf handlers. The host runs its own resolver over a proxy built from that
   shape. Hint paths are therefore correct by construction; nothing string-rewrites them.
3. **Additive contract, versioned like the manifest.** The remote data contract carries a
   `schemaVersion`; within a major, changes are additive only and an older host ignores unknown fields.
   A breaking change bumps the major and the host keeps an adapter for the previous major for a stated
   window. `board-manifest.json` already works this way.
4. **A board that does not participate looks exactly as it does today.** So does a web page. Every
   step is additive to the existing `snapshot()`/refs surface.
5. **Retire nothing until the replacement passes the same gate.** The internal engine is deleted only
   after the library-backed build passes the AiVision QA surfaces; the todo board's snapshot-only
   driving stays available throughout.
6. **Trust is the user's, and the node says whose content it is.** Boards are trusted by the user; a web
   page is not. Page-contributed results are labelled as page-origin in the hint and confined to their
   own subtree.

## What exists today

**Hosting and bridge.** A board is a cross-origin `board://<hash>` iframe
(`src/renderer/editors/board/BoardWebview.ts`). The protocol handler
(`src/main/board-protocol-service.ts`) inlines `src/board-shim.ts` into the served HTML before any
board script, so `window.persephone` is always the host's own version — shim and host cannot drift.
The shim talks to main over a `MessagePort` (`src/main/board-bridge.ts`) and to the host renderer over
`postMessage`; wire types live in `src/ipc/board-bridge-channels.ts`. Bridge version `1.2.0`.

**Inbound direction exists.** `persephone.call(path, options)` (`board-shim.ts`, `runBoardCall` in
`board-bridge.ts`, `src/renderer/api/mcp/board-call-command.ts`) resolves against the hosting page's
tree, re-checks trust per call, times out at `BOARD_CALL_TIMEOUT_MS` (30 s) and forces results through
`jsonSafe`. Everything the outbound direction needs — trust gate, JSON boundary, timeout, per-board
message kind — exists once already, pointing the other way.

**Outbound direction is generic automation only.** For a board page `pages[id].editor` is
`BoardEditorFacade` (`src/renderer/scripting/api-wrapper/BoardEditorFacade.ts`): the shared
`BROWSER_AUTOMATION_MEMBERS`, frame selection through `tabs` / `switchTab("board-secondary:<viewId>")`,
board metadata and five *chrome* elements. Its help states the rule: iframe content is reachable only
through `snapshot()` and never appears in `elements`. `BrowserEditorFacade` is the same shape.

**The engine is already portable.** `src/shared/ai-vision/` (eight files, about 1400 lines) is
process-neutral by rule; its only import from outside the folder is `errMessage` from
`src/shared/utils.ts`. The extension point is one interface:

```ts
// src/shared/ai-vision/types.ts
export interface IAiVisionDescriptor {
    readonly kind: string;
    readonly summary: string;
    readonly members: readonly IAiMember[];
    readonly help?: string | (() => string);
    readonly identity?: () => string | undefined;
    children?(): readonly IAiChild[] | Promise<readonly IAiChild[]>;
    restricted?(): string | undefined;
    index?(key: string | number): unknown;
    provide?(name: string): { value: unknown } | undefined;
    readonly elements?: readonly IAiElementDeclaration[];
    summarize?(): unknown | Promise<unknown>;
}
```

Two resolver properties (`src/shared/ai-vision/resolver.ts`) decide the design: **every hop is
awaited**, so remote *values* are free; **`members`, `index`, `provide` and `restricted` are
synchronous**, so a remote *shape* must be cached before the node is described. Foreign objects join
the tree through `registerAiVisionFor(instance, factory)`; `PageWrapper.editor` already dispatches
dynamically for `board-editor:<root>` ids and publishes whatever `kind` the facade reports.

**The DOM half is portable too.** `elements.ts` depends on types plus a highlight function passed in.
`assets/agent/ui-highlight.js` is dependency-free by design and its header already names "a board
frame or a browser page" as places it runs.

**Cross-boundary precedent and its tax.** Main forwards `windows[i].…` remainders to a renderer and
string-rewrites the returned hints to restore the prefix (`prefixHintPaths` in
`src/main/mcp/tools/call-tools.ts`). Running the resolver on the far side of a boundary pays this tax;
principle 2 avoids it.

**The todo board.** One closed IIFE (`app.js`, 968 lines), content-host kind, no build step, no
programmatic surface, no `data-name`. Model and actions are cleanly separated — `addItem`,
`toggleItem`, `updateItemTitle`, `setItemComment`, `setItemTag`, `deleteItem`, `addList` /
`renameList` / `deleteList`, `addTag` / `renameTag` / `setTagColor` / `deleteTag` — and selection
state (`selectedList`, `selectedTag`, `searchText`) already lives in `persephone.state`. Controls have
stable element ids. Exposing it is a lift, not a rewrite.

## The design

### Options considered

- **Host-side engine, remote data contract — chosen.** The remote party registers a shape; the host
  mounts a proxy node and runs the one engine over it. Leaf operations are small messages.
- **Engine on both sides, forward a path remainder — rejected for the host integration.** A second live
  engine per board with its own version skew, and the hint-rewriting tax. Rejecting this is separate
  from packaging the engine as a library, which is done (Epic 1).
- **No protocol change, discover through CDP `evaluate` — a spike only.** Every call is a CDP attach,
  secondary frames answer only while mounted, no shape until attached. Acceptable to validate the todo
  surface in an afternoon; not the shipped design.

### The remote contract

The remote party calls the library's `expose(root)`, where `root` is a plain object whose nodes carry
`aiVision` descriptors. The library serializes the **shape only** — `kind`, `summary`, `members`,
`help`, element declarations, and the nested shape of every `node: true` member — and answers leaf
requests:

| Resolver action on the proxy | Request | Remote side does |
|---|---|---|
| read property | `ai:get { path }` | walk segments, return value |
| assign writable property | `ai:set { path, value }` | walk, assign |
| invoke method | `ai:invoke { path, args }` | walk, call, await, return |
| index hop `items[3]` | part of `path` | index an array, a Map, or the node's `index()` |
| `children()` | `ai:children { path }` | call the node's `children()` |
| `elements` / `highlight` | `ai:elements` / `ai:highlight { view, name, message }` | visibility and overlay in the remote DOM |

Results are shaped for size on the remote side (`shapeResult`, `maxLength`) before they cross, then
shaped again on the host. A serialized member may be marked `indexable`; a method may carry
`timeoutMs`.

Two transports, one proxy:

- **Board:** the shim posts `board:aiVision { schemaVersion, shape }` after its load signal;
  `BoardWebview` validates and stores it on `BoardEditorModel`; leaf requests travel over the existing
  `postMessage` path. `reload()` clears the shape; the reloaded frame re-registers. Secondary frames do
  not register — one board, one root, shared through `persephone.state`.
- **Browser page:** the page's `expose` publishes `window.__aiVision` (`schemaVersion`, `describe()`,
  leaf handlers). After each completed navigation `BrowserWebviewModel` probes for it over CDP, caches
  the shape on the browser model, and mounts the same proxy. Leaf requests are CDP `evaluate` calls.
  A page without the global costs one `evaluate` per navigation and looks as it does today.

### Placement and discovery

`pages[id].editor.app` in both cases — one name so the guide text is shared. Not merged into `editor`,
which would collide with `snapshot`, `tabs`, `reload` and make `$help` unreadable. The facade's help
gains one line pointing at `.app` when a shape is registered. Because the proxy is an ordinary node,
`helpSearch` indexes its members and element purposes with no extra work.

### Elements and highlight

The host cannot query inside a cross-origin frame or a web page, so visibility and the overlay run
remotely. The library's `dom` entry supplies the overlay that Persephone installs in its own renderer
contexts, using the same `offsetParent !== null` visibility rule. An element declaration may name a
`view` (`"main"` or a secondary view
id); the host routes `ai:highlight` to that frame and auto-mounts its panel through the existing
`BoardTargetModel.ensureReady` path. Remote controls adopt `data-name`, matching
[architecture/ui-element-contract.md](architecture/ui-element-contract.md).

### Trust and safety

- Registration and every leaf request are refused while a board is untrusted, through the same
  `restricted()` the facade uses today.
- The existing private-page refusal (`agentMayAccessBrowserPage`) runs before any browser-page probe.
- A page-contributed tree is a prompt-injection surface richer than snapshot text because it carries
  help prose: its results and hints are labelled page-origin, and its shape can populate only its own
  `.app` subtree — nothing it declares can shadow the facade, the page or the root.
- The rule that no path accepts or reveals a secret carries over; a board that exposes credentials in
  its own state exposes what it already shows on screen, and the guide says so.

### Timeouts

A leaf request that never answers must fail, and the agent must be able to lengthen the limit for an
operation it knows is slow. Four levels, most specific wins:

1. **Per-call option.** `call` already carries `maxLength`; add `timeoutMs`, forwarded with the leaf
   request. `call pages[id].editor.app.rebuildIndex() { timeoutMs: 120000 }`.
2. **Remote-declared.** A method in the shape may carry `timeoutMs`; surfaced in its hint line.
3. **Runtime knob, in memory.** A writable property `boards.callTimeoutMs`, set through
   `call boards.callTimeoutMs { value: 60000 }`. Renderer memory only; resets on restart or reload, so a
   session's tuning leaves nothing behind. Deliberately not a `settings.json` key.
4. **Built-in default.** 30 s, the same as the inbound `BOARD_CALL_TIMEOUT_MS`; the inbound direction
   reads the same runtime value so both agree.

A timeout error names the level that applied and the path, and leaves the remote frame running — a
slow board is not a broken board. The limit is enforced on the host side.

### Versioning

- **Library:** semver on the npm package. Two applications running different builds is fine because a
  host only ever consumes another application's shape.
- **Remote contract:** `schemaVersion` in the shape, additive within a major, unknown fields ignored
  with one `ui.log` line. The library publishes the version it speaks so a remote party can
  feature-detect and register a smaller surface. A board that needs a newer host declares
  `minAppVersion`, already enforced at open time. A breaking change bumps the major; the host keeps an
  adapter for the previous major for a stated window, announced in What's New.
- **Bridge:** `persephone.version` → `1.3.0` ("descriptor registration").

## Epic sequence

Three epics. Epic 1 is independent and can start now; Epic 2 waits for a published library; Epic 3
waits for Epic 2. Numbers are provisional until each epic document is created.

### EPIC-096 — The `ai-vision` library

**Repository:** `C:\projects\ai-vision`, new, public, MIT (same license as Persephone). Package
name: **`ai-vision`** — checked free on npm 2026-09-08, including the punctuation variants npm treats as
equivalent (`aivision`, `ai_vision`, `ai.vision`) and the `@ai-vision` scope. Not reserved until first
published; a `0.0.1` placeholder with a README may claim it before the epic starts. Neighbouring names
(`@azure-rest/ai-vision-*`, `oci-aivision`) are image-analysis SDKs, so the README's first line must say
this is an agent-facing object model over an application, not computer vision.

**Scope:**

- Move `src/shared/ai-vision/*` to the package **core** entry; inline `errMessage`. No DOM, Node or
  framework dependency; ESM with type declarations.
- Move `src/renderer/scripting/ai-vision/elements.ts` (generalized: highlight function and reveal hook
  injected, Persephone types replaced by the package's own) and `assets/agent/ui-highlight.js` to the
  **dom** entry.
- New **remote** entry: `expose(root)`, `describe()` → shape, the `ai:*` handlers, `schemaVersion`,
  the `window.__aiVision` publication for pages, and a transport-neutral handler so a host shim can
  bind it to `postMessage`.
- A **host-side proxy builder**: given a shape and a `send(request) → Promise<result>` function,
  return an object carrying `aiVision` descriptors the core resolver can walk. This is the piece
  Persephone mounts in Epic 2 and is transport-neutral by construction.
- **Demo page** under `examples/`: a static page that exposes a small model (a list with filters, a
  couple of actions, a few `data-name` controls) through `expose`. It is the library's example and,
  opened in a Persephone browser tab, the browser-transport test surface for Epic 2.
- README with the descriptor contract, the remote contract, the `call` tool description a host gives
  its agent (Persephone's wording, generalized), and the versioning rules above.
- Publish `1.0.0`.

**Gate:** Persephone builds against the package with `src/shared/ai-vision` replaced by imports
and no behavioural difference on the AiVision QA surfaces (`qa/surfaces/`). The demo page's tree
resolves through the library's own resolver in a browser.

### EPIC-097 — Persephone adopts the library and mounts remote trees

**Scope, in order:**

1. **Adoption.** Replace `src/shared/ai-vision/`, `elements.ts` and the overlay asset with package
   imports; delete the internal copies (principle 5 — after the gate). Update
   `architecture/key-files.md`, `architecture/scripting.md`, `architecture/folder-structure.md`.
2. **Protocol.** New `BoardToHostMsg` kind `board:aiVision` and the `ai:*` request/response pair in
   `src/ipc/board-bridge-channels.ts`; shim imports the package's remote entry and exposes
   `persephone.aiVision.expose(root)` plus `persephone.aiVision.schemaVersion`; bridge `1.3.0`.
3. **Board proxy.** Shape storage on `BoardEditorModel`; `.app` node in `BoardEditorFacade` built by the
   package's proxy builder over a `postMessage` sender; trust gate; `reload()` re-registration.
4. **Timeouts.** `timeoutMs` call option, remote-declared `timeoutMs`, `boards.callTimeoutMs`, inbound
   `runBoardCall` reads the same value.
5. **In-frame elements and highlight**, `view` routing to secondary frames.
6. **Browser-page proxy.** Probe after navigation in `BrowserEditorFacade`, shape cache on the browser
   model, `.app` node over a CDP `evaluate` sender, page-origin labelling, private-page refusal first.
   Tested against the library's demo page in a browser tab.
7. **Guides.** `assets/board-template/CLAUDE.md`, `assets/guides/agents/boards.md`,
   `assets/guides/agents/browser.md`, `assets/guides/screens/*` where `.app` appears; What's New.
8. **Side finding.** `src/renderer/editors/board/board-api.d.ts` calls itself the canonical author
   reference but lacks `call`, `view`, `state.*`, `host.*`, `readFile`, `writeFile`, `getFilePath` and
   `setSecondaryViews`. Bring it current or demote its header; boards are documented by prose.

The epic may split at step 5 if it grows past comfortable review size; steps 1–4 are the minimum that
makes Epic 3 possible.

**Gate:** AiVision QA surfaces unchanged; a new `qa/surfaces/` page for `.app` on a board and on the
demo page: shape registers, `$help` and `helpSearch` see the members, a writable property round-trips, a
method invokes, a timeout fires at each of the four levels, `highlight` draws inside the frame and
inside a secondary view, an untrusted board and a private page refuse.

### EPIC-098 — The todo board exposes its model

**Repository:** `persephone-boards/boards/todo` (work happens there; this epic document records the
Persephone-side gate run).

**Scope:** lift the module state and action functions of `app.js` into an object; add `data-name` to
the controls; call `persephone.aiVision.expose`; bump `minAppVersion`; update the board's `CLAUDE.md`
(which also still says `editorPriority: 0`). Exposed surface, mapped onto existing functions:

| Node / member | Backing code |
|---|---|
| `lists` (`indexable`), `addList(name)`, `renameList(from, to)`, `deleteList(name)` | `addList`, `renameList`, `deleteList` |
| `tags` (`indexable`), `addTag(name)`, `renameTag`, `setTagColor`, `deleteTag` | `addTag`, `renameTag`, `setTagColor`, `deleteTag` |
| `items` (filtered, `indexable`), `addItem(title, list?)`, `toggleItem(id)`, `setItemTitle`, `setItemComment`, `setItemTag`, `deleteItem(id)` | `filteredItems`, `addItem`, `toggleItem`, `updateItemTitle`, `setItemComment`, `setItemTag`, `deleteItem` |
| `selectedList`, `selectedTag`, `searchText` (writable) | `setSelectedList`, `setSelectedTag`, `setSearchText` |
| `elements`: `quick-add-input`, `search`, `list-switch` (main); `add-list`, `add-tag`, `lists`, `tags` (view `lists`) | element ids in `index.html` |

Rendering, persistence and the shared-state wiring are untouched. The board is content-host, so an
agent could already edit the `.todo.json` text through `page.content`; the structured surface exists
so it does not have to.

**Gate:** an agent session that, from a bare `call`, finds the todo page, reads its lists, adds an item
to a named list, tags it, toggles it, highlights the quick-add input, and does all of it through
`.app` without falling back to `snapshot()`. Recorded as a `qa/runs/` entry. This is the final test
of the roadmap; when it passes, the pattern is available to the other built-in editors planned to move
to boards.

## Decisions to record in the epic documents

- ~~Whether the proxy builder lives in core or remote~~ — **decided in [EPIC-096](epics/EPIC-096.md):
  core.** `remote` may depend on `dom`; `core` depends on nothing, so a host that only mounts shapes
  never pulls in `window`.
- Whether a remote party may also register a **page-level** contribution (a `summarize()` that feeds
  the `pages` overview) or only the `.app` subtree (EPIC-097; subtree-only is proposed).
- ~~Shape validation policy~~ — **decided in [EPIC-096](epics/EPIC-096.md), one epic earlier than
  planned:** the behaviour belongs to the proxy builder, which is library code, so
  `createRemoteProxy` skips a duplicate or malformed member/element and reports it through
  `options.onWarning`. EPIC-097 only wires `ui.log` into that callback.
- Whether `boards.callTimeoutMs` should be a general `runtime` root node for future in-memory knobs
  (EPIC-097; the `boards` property is proposed as sufficient for now).

## Out of scope / recorded concerns

- Any application outside this repository that adopts the library is its own story and is not
  described here; the library's demo page is the only external consumer these epics test against.
- Boards drivable without Persephone. Not a goal; it is why the remote party never ships an engine.
- Automatic `data-name` generation for boards. Authors add names to the controls they want addressable,
  as the shell does.
- `persephone.call()` (inbound) is unchanged by this roadmap except for reading the shared timeout.
