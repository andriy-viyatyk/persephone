# Persephone as a platform — roadmap

> Status: **proposal, 2026-09-19.** Nothing here is scheduled. Each phase below is sized to become
> one epic; numbers are assigned when a phase moves to
> [active-work.md](active-work.md). Findings are source-verified against the tree at commit
> `09d0a8a2`; file references are the seams a task document should start from.
> Reviewed adversarially by Codex on 2026-09-19 — see
> [reviews/platform-roadmap-critique.md](reviews/platform-roadmap-critique.md); accepted findings are
> folded in below and §9 lists what was declined and why.

## 1. Vision

Persephone becomes a **host and registry** rather than a bundle of editors:

- **Boards** (and later other module kinds) carry functionality. The core keeps only the
  *common* editors — Monaco, Markdown, Browser, the grids — plus the shell, pipeline, pages and
  the agent surface.
- Persephone is the **registry** where modules declare what they can do, and the **bus** through
  which they ask each other for it. "Edit this image" is a request to the platform, not a call
  to a hardcoded editor id; the platform picks the registered handler with the highest priority.
- Modules can contribute below the UI too: a *torrent module* provides a board that lists
  active torrents **and** a content provider, so Monaco can open a text file from a torrent link
  through an ordinary pipe.
- Near-term: move the heavy built-ins out — **Excalidraw, REST client, video/audio** — as boards
  shipped with (or alongside) the release, the way the PDF viewer, Todo and Force Graph already
  went (EPIC-047, EPIC-098, EPIC-100).

Three principles fall out of the existing decisions and should govern every phase:

1. **A module is a board.** Do not invent a second package format. A board folder with
   `board-manifest.json` already has identity, trust, versioning, catalog install and update
   (EPIC-035/045). New abilities are new **manifest axes**, added the way EPIC-103 added folder
   editing (its decisions D1–D4 — distinct axis, merge beside the existing registry, strict
   priority with built-ins winning ties, one generic scheme — are the template).
2. **Built-ins are modules too.** Every registry introduced here is populated by the built-in
   editors first, so the core has to dogfood the abstraction before any board uses it. A
   migration then becomes "unregister the built-in row, install the board".
3. **Trust gates every capability.** Nothing declared in a manifest is honored until the user
   trusts the board (anti self-trust, EPIC-035 C2). A capability handler, a provider, or a
   network permission is a *widening* of what a board can do and inherits the same gate.

## 2. Where we are — the extension seams today

The codebase is further along than it looks. What exists, and whether it is open to a module:

| Axis | Today | Open to boards? | Evidence |
|---|---|---|---|
| File editor | `fileMasks` + `editorPriority` decide which editor **opens** a file; `contentMasks` only adds a **switch option** for a matching page and never opens anything | **Yes** (EPIC-042/100) | `editors/board/custom-editor-registry.ts:68-69,177-189`, `editors/base/editor-switch-options.ts:72-79` |
| Folder editor | `folderEditorMasks` + `folderEditorPriority` | **Yes** (EPIC-103) | same |
| Content host (board gets text via the shared host) | `editorKind: "content-host"` | **Yes** (EPIC-043) | `board-manifest.ts:134-148`, `persephone.host.*` |
| Sidebar panels | `secondaryViews` in manifest; prefix registration `board-secondary:*` | **Yes** (EPIC-044) | `editors/register-editors.ts:111` |
| Documentation | manifest `guides` folder mounted at `installed-boards/<id>/…` | **Yes** | `board-manifest.ts:164-177` |
| Agent-visible model | `persephone.aiVision.expose()` mounted at `pages[i].editor.app` | **Yes**, page-scoped (EPIC-097/098) | `board-shim.ts:875` |
| Calling the platform | `persephone.call(path)` resolves against the **renderer** AiVision root (`pages`, `boards`, `tools`, `fs`, …) in the hosting page's context when trusted; main-side members (`windows`, `main`, `guides`) are not reachable | **Yes**, renderer-rooted | `api/mcp/board-call-command.ts:10-63`, `architecture/overview.md:78-84` |
| Calling another board | only as `call("pages[i].editor.app.<fn>")` — needs the page index, target must be open | **Accidental** | no discovery, no activation |
| Open with a payload | `persephone-board://` is identity-only *by design*; per-open data "rides as `ILinkData` metadata" | **No**, seam named | `content/persephone-board-link.ts:5-9`, `BoardPortInitMsg` |
| Capability / intent ("edit image") | none; a first audit found **at least nine** call sites that name a concrete editor id (image → draw, svg/mermaid → draw or image, markdown code block, four log-view output views). The exact inventory is a Phase A deliverable, not a settled number | **No** | `image/ImageEditor.ts:295-301`, `svg/SvgEditor.ts:66-73`, `mermaid/MermaidEditor.ts:205-237`, `html/HtmlEditor.ts:115-135`, `markdown/CodeBlock.ts`, `log-view/items/{Text,Mermaid,Markdown,Grid}OutputView.ts` |
| Content provider factory | `registerProvider(type, factory)` **exists, is open and exported**, but has no caller outside its own file and is not on the script `io` surface; duplicate registration silently replaces (`Map.set`) | **No** | `content/registry.ts:17-25` |
| URL scheme (parse / resolve) | two closed subscriber lists plus a closed allow-list | **No** | `content/parsers.ts:44-232`, `resolvers.ts:110-392`, `api/pages/open-url-validation.ts:1-10` |
| Pipe rebuild from a bare path | shape-guessing, no registry lookup | **No** | `content/rebuild-pipe.ts` |
| Tree provider | instances constructed by their owning editor; no registry | **No** | `io.tree.d.ts`, `ExplorerSecondaryView.ts:236` |
| Subscribing to app events | scripts yes; boards **send only** (`openRawLink`, `notify`) | **No** | `api/internal/RendererEventsService.ts:41`, `board-bridge-channels.ts:163` |
| Commands / shortcuts / menu items | no registry; DOM bubbling and a closed `ContextMenuTargetKind` union | **No** | `core/events/context-menu.ts:24-41`, `api/internal/KeyboardService.ts` |
| Agent tools | separate manifest + separate exact-path trust file; a board cannot contribute a tool | **No** | `api/tools/tools-manifest.ts`, `tools-trust.ts` |
| Settings | `AppSettingsKey` is a closed union; `ui-preferences` is an open key space | **Half** | `api/settings.ts:23-56`, `api/ui-preferences.ts` |
| Network from a board | CSP `connect-src 'self'` — **no fetch at all**, not even localhost | **No** | `main/board-protocol-service.ts:65-84` |
| Node from a board | `executeNode()` runs board scripts out of process with Persephone's binary as Node | **Yes**, child process only | `main/board-bridge.ts:325-335`, `board-shim.ts:925` |
| Process-wide state | trust lists, the install registry and agent-tool trust are userData files each window loads on its own; the published-boards catalog and `ui-preferences` are already main-owned and broadcast | **Partly** | `main/published-boards-service.ts:215-249`, `main/ui-preferences.ts`, `main/open-windows.ts:27-31` |

Two numbers frame the cost of *not* doing this. Adding one URL scheme touches 3–5 core files.
Integrating Mneme — the only real "external module" so far — touched **~45 core files** across
pipeline, traits, editors, page state, IPC and main. A torrent module built the same way would
cost the same again, and could not ship as a board at all.

## 3. Target architecture

### 3.1 Capability registry ("intents")

A capability is a named request with a payload contract, e.g. `image.edit`, `image.view`,
`media.play`, `url.open`, `text.diff`. Handlers declare which capabilities they serve and at what
priority; callers ask the platform, never a handler.

**The id space is open.** Persephone seeds the registry with the ids its built-in editors serve,
but it does not own the list. Any trusted board can declare a capability nobody has heard of —
`torrent.add`, `diagram.render`, `acme.invoice.preview` — and any other board (or script, or
agent) can invoke it by name. Persephone's job is only to *resolve* the id to the best registered
handler and open that board with the payload; it never needs to know what the id means. A
capability id is therefore a contract **between modules**, published in the declaring board's
guide, and the platform is the directory and the switchboard.

```jsonc
// board-manifest.json — new axis, honored only when trusted
"capabilities": [
  { "id": "image.edit", "priority": 50, "accepts": ["image/png", "image/jpeg", "image/svg+xml"] }
]
```

```ts
// renderer — one service, populated by built-ins first
app.capabilities.register({ id: "image.edit", handler: "draw-view", priority: 50, accepts: [...] });
app.capabilities.list();                                    // every id anyone registered, with handlers
app.capabilities.handlers("image.edit", { mime });          // ordered candidates for one id
const result = await app.capabilities.invoke("image.edit", { path, mime, title });
```

```js
// inside a board — declare in the manifest, serve at runtime, and call anyone else's
persephone.intent.onRequest(({ id, payload, resolve, reject }) => { /* handle "torrent.add" */ });
const { pageId, result } = await persephone.capabilities.invoke("diagram.render", { source });
```

Design decisions to take into the epic:

- **Resolution mirrors EPIC-103 D3:** strict numeric priority, built-ins win ties, and every
  other candidate stays available as an "open with…" choice. A capability with no handler
  rejects with a typed error, which the caller turns into the existing "install from catalog"
  entry (`editor-switch-options.ts` already does this for file masks).
- **Payload travels on the existing seam, in memory only.** For boards, the request rides as
  `ILinkData` metadata into `BoardPortInitMsg` (a new `intent: { id, payload, requestId }`
  field) — exactly the extension `persephone-board-link.ts` reserved. The payload is never
  written to disk by the platform; see 3.1a. Saving is always an explicit user action inside
  the receiving board.
- **Result channel:** `invoke()` resolves with `{ pageId, result? }`. A handler that wants to
  return data calls `persephone.intent.resolve(value)`; most "open" intents just resolve with
  the page. This gives board-to-board calls a proper address (a capability id) instead of a
  page index.
- **Discovery never activates.** `list()` and `handlers()` answer from the manifest index; only
  `invoke()` opens a page. If the winning handler is a board with no open page, the platform
  opens it (visible, for UI capabilities) **in the caller's window**; headless handlers run in
  the module service process (3.5, Phase B). Handlers are process-wide; the request is routed by main,
  so caller and handler may live in different windows.
- **Request lifecycle is part of the contract, not an implementation detail.** Every `invoke()`
  carries a request id and a deadline. A timeout **stops waiting and sends `cancel` to the
  handler**; it does not pretend the work stopped, and the guide says so, because an agent
  will retry. Typed rejections distinguish *no handler*, *handler untrusted*, *handler page
  closed*, *handler crashed*, *cancelled*, *timeout*. Untrusting a board settles its in-flight
  requests as *untrusted* and frees their handles. Re-entrancy (A → B → A) is allowed to a
  fixed depth carried on the request; beyond it the platform rejects with *cycle*. Intents are
  at-most-once: the platform never re-delivers, so a handler that needs idempotency must key
  on the request id.
- **Registration rules.** Two boards may declare the same id; they coexist and compete on
  priority. A board re-declaring its own id replaces its own entry only. Built-in ids cannot be
  removed by a board, only outranked. Each declaration carries a `version` (major only); a
  caller may pin `image.edit@1`, and a handler declaring `@2` does not satisfy a `@1` call.
- **Naming.** Built-in ids use the bare `noun.verb` form (`image.edit`). Board-defined ids are
  free-form, but the authoring guide recommends a vendor or board prefix (`acme.invoice.preview`)
  so two unrelated boards do not collide by accident; a board that *intends* to serve an existing
  id (a second image editor) simply declares the same id and competes on priority. The registry
  does not validate ids against any list.
- **Discovery.** `app.capabilities.list()` (and the `boards` AiVision namespace) enumerates every
  registered id with its handlers, so an agent or a board can find out what the installed set
  can do. The published-boards catalog indexes each board's declared ids, so `invoke()` of an
  id with no local handler can offer "install a board that provides this" instead of failing.
- **Built-in registrations on day one:** `image.view → image-view`, `image.edit → draw-view`,
  `media.play → video-view`, `url.open → browser-view`, `text.open → monaco`. The nine
  hardcoded call sites listed in §2 are rewritten to `invoke()` **before** any board registers,
  so the refactor is verifiable with zero behavior change.

### 3.1a In-memory data channel between boards

**Decision:** data exchanged through the capability bus stays in memory at every hop. Personal or
secret content travelling from one board to another must not leave a copy under `userData`, and
the platform must not be the party that decides otherwise. This rules out the pattern
`ensureContentPath()` uses today for file-backed boards (materialize the pipe into a cache file
and hand over a path).

The transport already exists. Every board frame holds a dedicated `MessagePort` minted in the
**main process** (`MessageChannelMain`, `board-bridge-channels.ts`), and `postMessage` over it does
**structured clone** of objects and binary buffers — no serialization to text, no disk. Because
the port terminates in main, a board-to-board hop is board → main → board and crosses a process
boundary, so binary is copied once rather than moved; that is still memory-only. The channel is
built on that:

- **Small and medium payloads travel inline.** `invoke(id, payload)` structured-clones the
  payload (objects, strings, `Uint8Array`, `Blob`) from the caller's port into main, then into
  the handler's port. Results come back the same way through `intent.resolve(value)`.
- **Large payloads travel as a memory handle.** Above a threshold (to be measured, not the 8 MB
  guess a first draft carried), the caller
  gets a `DataHandle` — an opaque id for bytes the platform holds in **main-process memory** for
  the lifetime of the request (main already owns both ports, so no extra hop). The handler reads it with `persephone.data.read(handle)` (whole) or
  `persephone.data.stream(handle)` (chunked over the port), and may `persephone.data.forward(handle)`
  it into a further `invoke()` without copying. The platform frees the buffer when the request
  settles or the receiving page closes, whichever is first; a **forwarded** handle is
  reference-counted, so the second request keeps it alive. Handles are never persisted and are
  meaningless after a restart. `stream()` is credit-based: the reader grants N chunks, the
  sender never posts beyond the grant, and both sides have close/error frames — the shim's
  current unbounded pre-connection queue (`board-shim.ts:227-233`) is not a model to copy.
  Hard caps per request, per board and for the whole store are configuration, with the store
  size visible in `boards.list()` status.
- **Nothing in the payload enters page state.** `restorableKeys` and the host cache are for
  content the board *chose* to keep. The intent payload is delivered once, on open, and a
  restored page does not receive it again; a board that wants persistence asks the user (its
  own *Save*, or `persephone.saveFileDialog()`).
- **The same channel serves board → platform → board results**, so a capability can be a
  pure function (`diagram.render` returning PNG bytes) with no page and no file involved. This
  is also what makes headless service boards (3.4) useful.
- **What "no disk" promises.** It is a *broker policy*: the platform writes nothing for this
  exchange. It is not an OS guarantee — memory can be paged, and Chromium keeps its own caches.
  The document says exactly that, and the authoring guide repeats it, so nobody sells the
  channel as more than it is. Encryption is not the broker's concern: it is the same
  application's main process, already trusted with everything.

Related, but a separate decision the user may want to revisit later: content-host pages already
auto-save their text to `<userData>/cache/<pageId>.txt` through `CacheFileProvider`, and
file-backed boards receive their input as a materialized cache path. Neither is part of the
capability bus, but a "sensitive page" mode that disables the cache pipe would complete the
picture.

### 3.2 Open pipeline registration

The provider/transformer registry is already keyed by type and open; the scheme layers are not.
Make the three registrations one API and export it:

```ts
// content/registry.ts (extended) — replaces the closed lists in parsers.ts / resolvers.ts
registerScheme("torrent", {
    parse(data)   { /* Layer 1: set data.url, data.target ??= "monaco" */ },
    resolve(data) { /* Layer 2: return an IPipeDescriptor */ },
});
registerProvider("torrent", (config) => new ProxyProvider(config));   // existing, now exported
```

- `PIPELINE_SCHEMES` in `open-url-validation.ts` becomes *derived* from the scheme registry.
- `pipeFromSourcePath()` consults the registry before its `http` / `zip!` / `file` guesses, so a
  restored page with a `torrent://` source no longer degrades to a broken `FileProvider`.
- **Precedence and ownership are explicit.** One owner per scheme; built-in schemes and
  `http`, `https`, `file`, `data`, `blob`, `mneme`, `persephone-*` are **reserved** and cannot
  be claimed by a board — a board extends the platform with *new* schemes, it does not
  reinterpret existing links. Two boards claiming one scheme: the first trusted one owns it and
  the second is reported in Board Info, never silently replaced (today's `Map.set` does replace).
  Board parsers run **before** built-in parsers only for their own scheme, which the registry
  can enforce because it dispatches by scheme rather than by LIFO subscription order.
- **Uninstall leaves persisted state readable.** Page state keeps the descriptor; the page opens
  with a *provider missing* placeholder naming the board and offering reinstall, instead of the
  silent pipeless restore the throw at `registry.ts:31` produces today. The fuller
  `PendingProvider` (a descriptor that resolves once its board starts) is specified and built
  in Phase C, where the service process gives it something to wait for.
- Built-in schemes (`mneme://`, `git-tree://`, `folder-editor://`, `persephone-*://`) move
  onto the new API as the dogfooding step. This is a pure refactor and shrinks `parsers.ts`.
- Expose `registerProvider` / `registerScheme` through the script `io` namespace as well
  (`scripting/api-wrapper/IoNamespace.ts`), so an autoload script can contribute a provider —
  the cheapest possible pilot before any bridge work.

### 3.3 Providers implemented outside the renderer

A board has no Node and no pipe object; providers run in the renderer. The bridge therefore
needs a **`ProxyProvider`**: a renderer-side `IProvider` whose `readBinary`, `writeBinary`,
`stat` and `watch` are request/response round trips over the board's `MessagePort`, and a
board-side registration `persephone.providers.register(type, impl)`.

- The manifest declares the intent (`"contentProviders": [{ "type": "torrent", "schemes": ["torrent", "magnet"] }]`)
  so the platform knows the type exists *before* the board runs and can restore descriptors.
- Text decoding stays in `ContentPipe` (providers only speak `Buffer`), so a board implements
  four methods and gets encoding detection, transformers, caching and save-back for free.
- **Ranged streaming is in scope**, not deferred: the proxy provider implements
  `createReadStream(range)` and `stat()` over the credit-based stream frames of 3.1a. The
  range is not an optimisation — it is how a torrent client learns which pieces to prioritise
  (WebTorrent's `file.createReadStream({ start, end })` does exactly this), so the worked flow
  in 3.8 does not exist without it.
- Tree contribution follows the same pattern later (`ProxyTreeProvider` over `ITreeProvider`),
  but `ITreeProvider` is large and mostly optional; ship it after providers prove the bridge.

### 3.4 Board runtime upgrades the migrations need

Each of these is a manifest axis plus a bridge method, gated by trust:

| Need | Who needs it | Proposal |
|---|---|---|
| Network | REST client, torrent, any API board | `"permissions": ["network"]` relaxes the served CSP `connect-src` for that origin, **or** a `persephone.fetch()` RPC proxied through `api/node-fetch` (keeps CSP tight, adds cookies/headers control). Recommend the RPC: it is auditable and needs no protocol change. |
| Large media | video/audio | expose the existing main-side `createVideoStreamSession`, but serve the stream **under the board's own origin** — `board://<host>/__stream/<session>` from the protocol handler, proxying to the session — because the board CSP is `media-src 'self' blob:` and a `http://127.0.0.1` URL is unreachable from the frame. Sessions are transient today (`VideoEditor.ts:43-48`), so the board must recreate them on restore. |
| Bundled assets | Excalidraw fonts (`app-asset://excalidraw/`) | the board ships its own fonts; `board://` already serves anything in the folder. No protocol grant needed. |
| Subscribing to app events | any handler that must react | `persephone.events.on(channel, cb)` for a **white-listed** subset (`openRawLink`, `linkContextMenu`, theme) mirrored over the port; auto-released on frame dispose like scripts |
| Headless / service boards | provider-only modules, background sync | manifest `"service": "scripts/service.mjs"` — a Node script the platform hosts in an Electron `utilityProcess` (see 3.5), not a hidden frame; `boards.list()` shows it with a status |
| Per-board storage | everything | `persephone.storage` = a folder under `<userData>/data/board-storage/<id>/` plus a JSON key/value built like the new `ui-preferences` store; today the only options are the global `.env.json` and `restorableKeys` in page state |
| Binary content for a board | audio/video/image boards, anything not text | today a board opening a non-local source must be `content-host` (text only, `editor-switch-options.ts:86-93`) or gets `ensureContentPath()`, which **materialises the whole pipe to a cache file** (`BoardEditorModel.ts:496-548`). Add `editorKind: "stream-host"`: the platform serves the page's pipe at `board://<host>/__pipe/<pageId>` with `Range` support from the protocol handler (`protocol.handle` already returns fetch `Response`s, which stream), and `persephone.host.streamUrl()` hands the board that URL. Nothing is written to disk; the board's `<audio>`/`<video>`/`<img>` reads the origin-local URL. For a service-backed provider, main pulls ranges from the service port directly; for renderer providers it asks the renderer over IPC. |
| Board-contributed tools | agent-facing modules | allow `tools-manifest.json` **inside** a trusted board root and merge it into `registered-tools`; one trust decision, two registries |

### 3.5 Node for boards

A board frame has no Node by design (`nodeIntegrationInSubFrames: false`), and giving it Node
in-process would dissolve the trust model. But a board **already has Node out of process**:
`persephone.executeNode(script, args)` runs a script from the board folder with Persephone's own
binary as Node (`ELECTRON_RUN_AS_NODE`, `main/board-bridge.ts:333`), cwd = board root, long-lived,
with stdin, streaming stdout/stderr, kill, and `setBoardBusy()` to keep jobs alive. A board can
vendor npm packages under its own `node_modules` and run a daemon. That covers most "needs Node"
cases today. What it does not cover:

| Gap | Why it matters | Resolution |
|---|---|---|
| The frame cannot reach its daemon over HTTP | CSP `connect-src 'self'`, `media-src 'self' blob:` (`board-protocol-service.ts:72-75`) | messages over stdin/stdout JSON lines for control; `media.play` with the localhost URL for playback (the video player already plays `http://127.0.0.1` stream sessions); optional `"permissions": ["localhost"]` axis later |
| A provider in a child process has no route into the pipeline | daemon → frame → platform is two hops and needs the UI frame alive | **module service process** — below |
| Native modules | a `.node` addon must match Persephone's Electron ABI | document it; the pilot avoids native deps |

**Module service process (the recommended shape, built in Phase B).** The manifest names a Node entry
(`"service": "scripts/service.mjs"`). When the board is trusted, the platform starts it in an
Electron `utilityProcess` (Node, no DOM, crash-isolated) and hands it two `MessagePort`s: one to
the renderer, one to the board's frame(s). The renderer-side `ProxyProvider` then talks to the
service **directly**, in memory, with no UI frame involved — so a `torrent://` link opens in Monaco
even if the torrent board page is closed. Lifecycle (start on trust or first use, stop on
untrust, restart on crash, status in `boards.list()`) belongs to the platform, and `execute()`
stays for one-shot scripts. Three options were weighed:

- **A — child process via `executeNode` (today).** Works now, isolated, but stdio-only, tied to a
  live frame, and every message is text.
- **B — `utilityProcess` with ports (recommended).** Structured messages, direct renderer
  channel, headless, platform-owned lifecycle. Electron provides the process
  (`utilityProcess.fork`), port transfer to the process and to a renderer
  (`WebContents.postMessage`), and nothing else: **no CPU/memory quotas, no restart, no
  supervision.** The port into a board *frame* still has to hop through the host renderer,
  as the bridge does today (`main/board-bridge.ts:467-502`). The epic must therefore specify:
  ESM entry and `node_modules` resolution relative to the board root; which Node/Electron
  built-ins a service may import; environment sanitization; a handshake with health state; a
  restart budget (e.g. three crashes in a minute stops the service and shows why in
  `boards.list()`); shutdown on untrust with in-flight requests settled as *untrusted*; and a
  concurrency cap. Services do **not** inherit the UI board's storage or permissions by
  default; the manifest grants them separately.
- **C — Node inside the frame.** Rejected: it is the boundary the whole trust model rests on.

### 3.6 Process-wide registry

`app`, `app.events`, trust lists and the install registry are all per-window today. The
capability and scheme registries must be **main-owned** with a renderer cache, following the
pattern `ui-preferences` just established and the `openWindows.send()` broadcast every status
service already uses. Add one generic `registryChanged(kind)` IPC event so a trust change in one
window updates resolution in all of them.

### 3.7 Bridge versioning and a permission model beyond "trusted"

The shim reports `persephone.version = "1.5.0"` and boards feature-detect on it; nothing else
exists. Every axis above adds bridge members, so:

- The manifest gains `minBridgeVersion`; a board declaring a newer one than the app provides
  is listed as *incompatible* rather than half-working. Old boards keep working: new manifest
  fields are optional and new bridge members are additive.
- "Trusted" stays the prerequisite for running code, but it is no longer the whole model. The
  manifest declares **permissions** the trust dialog lists and the user grants together with
  trust: `network`, `service`, `contentProviders`, `capabilities` (with their ids), `tools`.
  A later version of the same board adding a permission is shown as a *changed grant* on
  update, not inherited. Untrust revokes everything and settles in-flight work.
- Board-declared capabilities are agent-visible through `list()` because a trusted board can
  already run arbitrary code on the user's behalf; their `payloadSchema` is what the agent
  reads. This is a deliberate choice, recorded here so it is revisited if a capability ever
  grants more than the board itself could do.

### 3.8 Worked flow: a torrent link to a playing `.mp3`

The end-to-end scenario the platform must carry, used here to check that the pieces above
compose. Two boards are installed and trusted: an **audio player** (`fileMasks: ["*.mp3", …]`,
`editorKind: "stream-host"`, capability `media.play`) and a **torrent board** (`fileMasks:
["*.torrent"]`, `service: "scripts/service.mjs"`, `contentProviders: [{ type: "torrent",
schemes: ["magnet", "torrent"] }]`).

| Step | What happens | Provided by |
|---|---|---|
| 1 | The user clicks a `magnet:` or `.torrent` link in the Browser | Browser navigation handler → `openRawLink` — **to verify**: `browser-service.ts:269-290` blocks only `file:`/`app-asset:`; where an unknown scheme is routed into the pipeline must be confirmed in the task doc |
| 2 | Layer 1: the torrent board's parser recognises `magnet:`; `.torrent` matches its `fileMasks`; the torrent board page opens | `registerScheme` (3.2), custom editor registry (today) |
| 3 | The board asks its service to fetch metadata; the page lists the torrent's files | `executeNode`-style service process (3.5), board UI |
| 4 | Double-click on `track.mp3`: the board calls `persephone.openRawLink("torrent://<infohash>/track.mp3")` — no target named; the platform picks the editor for the file name | bridge `openRawLink` (today); editor resolution by name → audio board (today) |
| 5 | Layer 2: the torrent scheme's resolver returns `{ provider: { type: "torrent", config: { infoHash, path } } }`; Layer 3 opens the audio board page with that pipe | `registerScheme` resolve hook (3.2), `ProxyProvider` (3.3) |
| 6 | The audio board asks `persephone.host.streamUrl()` and sets it on `<audio>`; the element issues `Range` requests | `stream-host` (3.4) |
| 7 | The protocol handler forwards each range to the torrent service over its port; the service calls `file.createReadStream({ start, end })`, WebTorrent prioritises those pieces, bytes flow back as credit-based frames | 3.3 ranged streaming, 3.1a backpressure, main-owned service ports (3.5) |
| 8 | Playback starts before the download completes; seeking issues a new range and re-prioritises | same |
| 9 | Closing the page closes the stream; the torrent keeps downloading only if the torrent board says so | request lifecycle (3.1), service lifecycle (3.5) |

What the flow forced into the design: ranged streaming on the proxy provider (3.3), a
stream-host mode that never touches disk (3.4), and main serving `__pipe` ranges straight from
the service port so audio does not round-trip through the renderer. What it does **not** need:
the capability bus — steps 4 and 5 are ordinary link resolution, which is the point of making
the pipeline registries open. `media.play` matters only when a caller has bytes rather than a
link.

Restore: the audio page persists `{ provider: "torrent", … }`. If the torrent board is trusted,
its service is started on demand by the pending provider (Phase C) and playback resumes; if it
was uninstalled, the page shows the *provider missing* placeholder from 3.2.

## 4. Phases

> ### Needs user verification
>
> Left from **EPIC-106 (Phase B)**, 2026-09-20. Everything else in that epic was observed live
> against the running app; these three could not be, and none is known to be broken.
>
> 1. **No orphaned service process after app quit.** The quit gate is written so the app always
>    quits — a bounded race, `app.quit()` in a `finally`, and a guarded synchronous last-resort
>    kill — but proving no `utilityProcess` outlives Persephone means actually quitting the app,
>    which was in use. To check: start the demo board's service, note its pid from
>    `boards.list()`, quit Persephone, then confirm the pid is gone.
> 2. **The trust dialog's new disclosure rows, on screen.** The dialog now carries `permissions`
>    and `serviceDeclared` — confirmed present through its AiVision facade — but clicking
>    **Trust Board** is your decision, not an agent's, so it was never clicked. Registering any
>    board that declares `permissions` will show the rows.
> 3. **Criterion 9, the incompatible listing.** A board declaring a `minBridgeVersion` above the
>    shipped `1.6.0` should be listed incompatible and register no editors. Unverified because it
>    needs a throwaway board to be trusted. Note the scope cut behind it: local `minAppVersion` is
>    still **not** enforced at registration — it never was, and fixing that would have changed
>    behaviour for existing installed boards, so it is left as its own task.
>
> Added by **EPIC-107 (Phase C)**, 2026-09-20.
>
> 4. **The renderer `MessagePort` lease shipped in Phase B has no service-side counterpart, and
>    never had one.** `attach-renderer` is only ever *sent* (`main/module-service-supervisor.ts:400`),
>    the renderer waits for the service to post `hello` and replies `hello-ack`
>    (`renderer/api/module-service.ts:142-160`), and nothing in `src/**` or `assets/**` handled
>    `attach-renderer` or sent `hello`. So `moduleService.acquire()` timed out for every board that
>    shipped. This is **consistent with EPIC-106 D3** ("a service is not obliged to implement that
>    port at all") and is not a defect in Phase B — but EPIC-106's evidence for "a request with no
>    board page open" was the **main-routed** `requestModuleService` endpoint, not the lease, so the
>    port was never exercised. EPIC-107's US-1473 builds the service side of it. Worth your eye
>    because it means Phase B's lease criterion was proven by a different path than the one it names.
> 5. **EPIC-106's D1 reversal is still unreviewed, and EPIC-107 D3 deliberately did not extend it.**
>    `contentProviders` is disclosed in `permissions` but the **functional** trigger is the
>    `contentProviders` manifest array, not the permission string — unlike `service`, which has a
>    functional hygiene gate. That inconsistency is intentional, so that whichever way you decide on
>    the `permissions` axis, the change is one conditional. See EPIC-107 D3.
> 6. **Board Info's rendering of provider/scheme refusal diagnostics was not observed on screen.**
>    A board-info page is reached by *switching* an existing page to `board-info`
>    (`editors/base/editor-switch.ts:87`), not by a programmatic open, so there was no MCP route to
>    it. The refusal *reasons* were confirmed readable through the alerts surface
>    (`Rejected scheme registration: "https". Scheme "https" is reserved for the platform.`); only
>    their Board Info presentation is unconfirmed.
> 7. **A page opened while a board provider's service was down does not recover when the service
>    later starts.** Observed live: with the demo board's service in a terminal `failed` state, a
>    `mem://` page opened blank; after `startService` brought the service up, a **newly** opened page
>    got its content but the already-open page stayed blank. EPIC-107 criterion 4 covers the
>    *untrust → re-trust* cycle with a `MissingProvider`; this is the adjacent case of a
>    **registered** type whose `ProxyProvider` was unavailable at read time, and it has no recovery
>    trigger today. Needs a decision: re-read pages whose `ProxyProvider` failed when the provider
>    becomes available, or give the page an explicit retry. Not fixed in EPIC-107.
>
> Added by **EPIC-108 (Phase D)**, 2026-09-20.
>
> 8. **EPIC-106's D1 reversal is *still* unreviewed, and EPIC-108 D8 again declined to extend it.**
>    This is now the third epic in a row to route around the same undecided question, and the third
>    to leave a deliberate one-conditional seam rather than compound it. `capabilities` is disclosed
>    in `permissions` and shown in the trust dialog, but the functional trigger is the
>    `capabilities` manifest array, exactly as EPIC-107 D3 did for `contentProviders`. **The
>    infrastructure half of the roadmap is now complete with this question still open**, so it is
>    worth deciding before Phase F, which is the first phase whose board (Excalidraw) ships inside
>    the installer and therefore interacts with the bundled-board trust decision of §6.
>
>    **Update, 2026-09-20 ([EPIC-109](epics/EPIC-109.md) D8):** the collision this item predicted does
>    not arise. Because a bundled board is never subject to a trust dialog (D2), `permissions`-as-
>    disclosure has nothing to disclose to, so Phase F is not in fact the deadline. The question
>    stays open **for catalog-installed boards**, and EPIC-109 again neither extends nor entrenches
>    the reversal. This is the fourth deliberate park.
>
> 9. **The trust dialog's capability rows, on screen.** As with EPIC-106's item 2: the dialog now
>    carries declared capabilities, confirmed present through its AiVision facade, but clicking
>    **Trust Board** is your decision and was never done. Registering any board that declares
>    `capabilities` will show the rows.
>
> 10. **Board Info's capability section and capability refusal rows were not observed on screen.**
>    This extends EPIC-107's item 6 with a sharper finding: switching an *open board page* to
>    `board-info` (`editors/base/editor-switch.ts`) lands the editor in **install** mode with
>    `properties` undefined, so the properties view — where the Capabilities section and the
>    `kind: "capability"` refusal rows live — is not reachable that way either. The refusal
>    *behaviour* was confirmed live (an empty id, an id containing `@`, and a non-integer version
>    were each refused while the same board's valid declarations registered); only their Board Info
>    presentation is unconfirmed. Worth a look, because it now blocks observing two epics' worth of
>    diagnostics.
>
> 11. **Three typed rejection codes have no recorded observation: `handler-closed`, `cancelled` and
>    `busy`.** Each is implemented and reachable by construction, and the epic's other six codes were
>    each driven to a live observation, but these three were not. `payload-too-large` was
>    deliberately confirmed *not* to apply to platform handlers — capping an in-process call would
>    break opening a large file in Monaco or a full-size `image.edit` data URL — and that
>    clarification is recorded in EPIC-108 D7. A board-handler payload above the cap was not tested.
>
> 12. **The pattern behind two of EPIC-108's three live defects is worth a standing habit.** Both
>    were a message contract split across two parallel tasks where one side posted and the other
>    never received: the renderer posted `capabilities:intent` to a reused board frame and the shim
>    had no handler for it, and the renderer nested the invoke reply envelope while the shim read
>    the top-level field the contract declares. Neither side is wrong in isolation, so typecheck,
>    lint and `build-prod` all passed, and the happy path worked because the *first* request reaches
>    a board by a different route entirely. Invoking any such feature **twice** is what finds it.
>    Four consecutive epics have now shipped defects that a green build did not catch.


**Scope decision (2026-09-19):** this roadmap ends when the architecture can host an extracted
editor and has been proven twice — once on the pipeline side by the **torrent board and audio
player** (3.8), once on the editor side by **extracting Excalidraw**. Video, REST client and any
other editor extraction come *after* the roadmap as ordinary epics using what it built. One epic
is created per phase, in this order; each phase is shippable on its own and no phase depends on
a later one. **User decision (2026-09-19):** all infrastructure phases (A–D) land before either
proof, so the two proofs run against the finished architecture rather than shaping it midway.
The cost accepted with that: a pipeline-side design flaw surfaces in Phase E instead of right after
Phase C, with Phase D already built on top.

```
A  refactor seams
└─► B  bridge contract + module service process
    └─► C  open providers + ranged streaming + stream-host
        └─► D  capability bus + in-memory data channel
            ├─► E  torrent board + audio player   (proof 1: pipeline side; needs A–C, uses D for media.play)
            └─► F  Excalidraw extraction           (proof 2: editor side; needs A, B, D)
```

### Phase A — Refactor the seams (no new user-visible behavior)

> **Shipped 2026-09-20 as [EPIC-105](epics/EPIC-105.md).** Two decisions were revised during the
> epic and are recorded here because later phases depend on them. **`ILinkData.target` is the
> pipeline's seam, not a capability call** — the 15 call sites that set `target` on a link were
> left alone, so only the 23 page-creating handoffs were rewritten, and whether a link may name a
> capability is a Phase D question. **The seed set is four ids** (`text.open`, `content.view`,
> `image.edit`, `diagram.edit`), with `content.view` dispatching on a declared `representation`;
> the fifth-to-eighth ids a first pass proposed all belonged to link-target rows. Registry entries
> now carry an `origin`, which is what Phase C's board ownership rule should hang from.

Everything later plugs into registries that do not exist yet. Build them with the built-ins as the
only registrants, so the abstraction is exercised before any board touches it.

1. `registerScheme` in `content/registry.ts`; move the built-in parsers/resolvers onto it; derive
   `PIPELINE_SCHEMES`; make `pipeFromSourcePath` registry-aware. Unknown-type behavior is
   **unchanged** in this phase (it still throws); placeholder and pending provider are Phase C.
   Duplicate registration reports instead of replacing.
2. `app.capabilities` populated from a `capabilities` column on `EditorRow` in
   `register-editors.ts`; audit and rewrite every hardcoded editor handoff to `invoke()`, each
   delegating to the same function it called before. The audit list is a deliverable.
3. Export `registerProvider` / `registerScheme` through the script `io` namespace.
4. Add the `App` service in one place (`initServices()`, `IApp`, `AppWrapper`) and record the
   three-place edit as the known failure mode (`backlog.md:346-351`).

Exit, stated so it can be checked: for every scheme in the content-pipeline doc table and every
rewritten handoff site, the same input opens the same editor id on the same page with the same
title, and every restore fixture in the QA surface set restores as before. `parsers.ts` and
`resolvers.ts` shrink; one new public service.

### Phase B — Bridge contract and the module service process

> **Shipped 2026-09-20 as [EPIC-106](epics/EPIC-106.md).** Three decisions bind later phases.
> **`permissions` is disclosure and lifecycle hygiene, not a security boundary** (D1): a trusted
> board already spawns unrestricted Node through `executeNode` with no declaration, so gating
> `service` behind a permission stops nothing. The grant record, the *changed grant* re-prompt on
> update and per-board consent under inherited trust are all deferred to the trust-model merge in
> §5 — a phase that wants `permissions` to be a boundary must first make trust per-board and
> recorded. **The service gets a port to the renderer only** (D3); the frame-to-service port this
> document proposed was dropped because it saves neither a process hop nor a serialization step by
> §3.1a's own reasoning, and the frame uses an ordinary main-routed bridge call. The renderer
> lease is therefore reserved for Phase C's high-volume provider traffic, and **a service is not
> obliged to implement that port at all** — Phase C must not assume one is attached. **A service
> may use storage before it is `ready`**, because loading persisted state before declaring
> readiness is the normal startup shape. Two corrections to this document: `minAppVersion` is
> enforced on the **catalog path only** and never on local registration (so the "incompatible
> listing machinery" Phase B was meant to reuse did not exist for local boards, and only
> `minBridgeVersion` is gated), and **`ui-preferences` is main-owned but not broadcast**, so §3.6's
> `registryChanged(kind)` is entirely new work rather than a pattern to copy.

The two things every later axis assumes: a way to say what a board needs, and a place for a
board's Node code to run under platform control.

1. **3.7 first:** `minBridgeVersion` in the manifest, *incompatible* listing, the `permissions`
   axis shown in the trust dialog and re-shown as a *changed grant* on update, untrust revoking
   and settling in-flight work. Additive bridge members only; existing 1.5.0 boards unaffected.
2. **3.5 option B:** manifest `service` entry hosted in an Electron `utilityProcess` with ports
   to main and to the host renderer; handshake, health state, restart budget, shutdown on
   untrust, concurrency cap; status in `boards.list()`; ESM entry and `node_modules` resolution
   relative to the board root specified and documented in the authoring guide.
3. `persephone.storage` (3.4) — a per-board folder and key/value store — because a service with
   no page needs somewhere to keep state that is not page state.

Exit: the demo board gains a `service` that starts on trust, survives a renderer reload, is
killed on untrust, and is restarted after a forced crash until the budget stops it, with each
state visible in `boards.list()`.

### Phase C — Open providers with ranged streaming

> **Shipped 2026-09-20 as [EPIC-107](epics/EPIC-107.md), with one item deferred.** Decisions later
> phases inherit. **Board provider types are namespaced by the author, not derived by the platform**
> (D1): a board type must contain `/` and is registered verbatim, because deriving it from the
> manifest `name` would orphan persisted pages on a rename and deriving it from the board root would
> break on reinstall. Un-namespaced types are reserved for the platform, so the rule needs no list.
> **`contentProviders` is disclosed in `permissions` but the functional trigger is the manifest
> array** (D3), deliberately unlike `service`'s hygiene gate, so that EPIC-106's still-unreviewed D1
> reversal is not compounded — see *Needs user verification*. **`__pipe` ranges are served through
> the owning renderer, not pulled from the service port** (D4); the direct pull is deferred with a
> stated measurement trigger in Phase E. **`stream-host` is the no-copy alternative to the existing
> `editorSources: "any"`**, which solves the same problem by materializing the pipe to a cache file.
> **`persephone.host.streamUrl()` is available to `content-host` pages too** (D6).
>
> **Deferred to Phase E (D11): US-1474, credit-based ranged streaming into a board-implemented
> provider.** This was the epic's pre-committed abort boundary. A board provider serves
> whole-resource reads, and `stream-host` serves ranged reads from any platform-owned pipe — but a
> range is not yet pushed down into a board provider, which is what step 7 of §3.8 needs for a
> torrent client to prioritise pieces. `ProxyProvider` leaves `createReadStream` unimplemented and
> `ContentPipe` falls back to a buffered read, so nothing is broken by its absence.
>
> **Two defects in earlier phases were found by building on them.** EPIC-105 D2's throw on an
> unknown provider type is replaced by the placeholder, as planned. More seriously, **Phase B's
> renderer `MessagePort` lease was broken, not merely unimplemented**: the supervisor put the
> `MessagePortMain` in the message body as well as the transfer list, so every attach threw
> "object could not be cloned". It was never noticed because no service implemented the receiving
> side. Fixed in EPIC-107.

The pipeline side of the platform. Nothing here needs a visible board page.

1. `ProxyProvider` with `readBinary`, `writeBinary`, `stat`, `watch` **and**
   `createReadStream(range)` over credit-based frames (3.1a) to a service port;
   `contentProviders` manifest axis; namespaced provider `type` strings.
2. Reserved-scheme list and one-owner rule (3.2); board schemes dispatch by scheme, not by
   subscription order.
3. *Provider missing* placeholder and the `PendingProvider` that starts a trusted board's service
   on demand when a restored descriptor names its type.
4. `editorKind: "stream-host"` and the `board://<host>/__pipe/<pageId>` range-serving path in
   the protocol handler, pulling from a service port directly or from the renderer over IPC
   (3.4); lift the *non-local means content-host* filter for stream-host boards.
5. **Verify step 1 of 3.8:** how the Browser routes a `magnet:` navigation and a `.torrent`
   download into `openRawLink`, and fix it if it does not.

Exit: an autoload script registers a toy `mem://` provider and scheme; a page opened on it
restores across restart, shows the placeholder when the script is removed, and a stream-host
demo board plays a local `.mp3` through `__pipe` with seeking, while a `userData` watcher
confirms no cache file was written.

### Phase D — Capability bus and the in-memory data channel

> **Shipped 2026-09-20 as [EPIC-108](epics/EPIC-108.md), as a slice.** **This closes the
> infrastructure half of the roadmap**: phases A–D are all in, and both remaining phases are
> proofs that consume them rather than build new platform. Five decisions bind E and F.
>
> **The capability index is derived, not authoritative, so it stays renderer-local and main owns
> nothing** (D1) — it is a pure function of the built-in `EditorRow` table and the trusted boards'
> manifests, and every renderer already re-reads both on every trust change, so two windows compute
> the same index with no broadcast. This **reverses §3.6 for capabilities** and means
> `registryChanged(kind)` is still entirely unbuilt. What it gives up is stated so it can be
> reclaimed: **there is no cross-window routing.** A request resolves in the *caller's* window (D3,
> resolving a conflict inside §3.1 — a UI intent should open where the user is looking, and boards
> already support multiple pages). If a later phase needs window 1's request served by a live
> handler page in window 2, that is a main-side routing table keyed by `(boardRoot, windowIndex)`
> plus a forwarding envelope; the registry itself needs no migration either way.
>
> **A link may not name a capability** (D2) — the question Phase A left open. `ILinkData.target`
> stays the pipeline's seam. A link resolves to *content*; a capability is a *request* with a typed
> payload, a result, a deadline, a cancellation path and a re-entrancy depth, and a link has nowhere
> to put or receive any of those. Letting `target` carry a capability id would give one open two
> resolution orders with no rule for which wins. The two compose instead: a handler that wants to
> open content calls the pipeline, and the pipeline that wants a result calls a capability.
>
> **The `DataHandle` store is deferred to Phase F with a measured trigger** (D7) — this epic's
> pre-committed abort boundary, argued before any code was written. §3.1a's *inline* half ships and
> is better than described: because the bus is renderer-local, a board-to-board payload is one
> structured clone each way **inside a single renderer** and never enters main. The large-payload
> half — `persephone.data.{read,stream,forward}`, reference-counted forwarding, credit-based
> chunking, per-request/per-board/global caps — is unbuilt and had no consumer here. Instead of a
> silent gap the inline path is **capped and typed**: `MAX_INTENT_PAYLOAD_BYTES` (8 MiB) with a
> `payload-too-large` rejection, so a future store *raises a documented ceiling* rather than fixing
> a silent truncation. **The cap applies to board-bound invocations only** — a `platform` handler is
> an in-process call with no clone boundary, and capping it would break Monaco opening a large file
> or a full-size `image.edit` data URL. **Phase F is the trigger**: Excalidraw's `image.edit` carries
> a canvas-sized data URL, so if a single payload exceeds the cap in ordinary use, or a clone costs
> more than ~50 ms at p95, the handle store becomes a task in that epic.
>
> **`capabilities` is disclosed in `permissions` but the functional trigger is the manifest array**
> (D8) — holding EPIC-107 D3's line exactly. This is the **third** epic to route around EPIC-106's
> still-unreviewed D1 reversal rather than compound it, and each has left the change at one
> conditional. See *Needs user verification* item 8: the infrastructure is now complete with this
> question open, and Phase F is the first phase whose board ships inside the installer, so it meets
> the bundled-board trust decision of §6.
>
> **Phase E inherits a working `media.play` path but no built-in registration.** No
> `media.play → video-view` row was added: the audio-player board declares the id itself through
> this epic's manifest axis, and a built-in registration would have guessed at a payload contract
> with no caller. Phase E's steps 4–5 still need nothing from the bus, exactly as §3.8 says.
>
> **Three defects were found by live testing that typecheck, lint and `build-prod` all passed**, two
> of which made the feature useless in ordinary use: an intent dispatched to an **already-open**
> handler page was never delivered (so the bus worked exactly once per board page, then hung every
> later call to its deadline), and **every** board-originated `capabilities.invoke` failed as a
> malformed reply (so board-to-board calls, the point of the bus, did not work at all). Both were
> the same shape — a message contract split across two parallel tasks where one side posts and the
> other never receives, with neither side wrong in isolation and the happy path working because a
> board's *first* request arrives by an entirely different route. **Invoking any such feature twice
> is what finds it.** That is four consecutive epics in which a green build proved nothing about
> behaviour.

The editor side of the platform, needed by Excalidraw and by any board that wants to ask another
board for work rather than hand it a link, is now a renderer-local bus. Its shipped slice includes
the open manifest axis, derived index, priority/version resolution, discovery without activation,
request ids and deadlines, typed settlement, page-scoped cycle checks, at-most-once delivery,
caller-window routing, and board-to-board intent delivery.

The inline payload path uses structured clone with an 8 MiB cap for board-bound requests. The
`DataHandle` store, reference-counted forwarding, credit-based streaming, main-owned routing,
cross-window forwarding, capability catalog, headless service handlers, and catalog install entry
remain future work. Phase F is the measured trigger for the data store: if ordinary Excalidraw
`image.edit` payloads exceed the cap or clone cost exceeds roughly 50 ms at p95, add that protocol
there rather than silently widening the inline path.

The board surface is `intent` on `BoardPortInitMsg`, the reused-page host-frame intent channel,
`persephone.intent.{get, onRequest, resolve, reject}`, and
`persephone.capabilities.{list, invoke}`. The shipped Demo board declares `demo.greet`; live
verification scaffolds a disposable second board when a board-to-board caller is needed. Board
Info registration diagnostics and trust disclosure are present, while catalog indexing and the
missing-handler install affordance remain deferred.

Exit is the smallest slice that proves the bus: a trusted board declares a new id, discovery works
without a page open, the first request opens the handler in the caller's window, later requests
reuse that page, a second board can invoke it, and the payload remains in memory. Live checks also
cover typed no-handler/timeout/rejected/cycle outcomes, priority and loser discovery, repeated
message delivery, and untrust settlement. The remaining unverified lifecycle cases are tracked in
the epic record and do not change the Phase E/F dependency boundary.

### Phase E — Torrent board and audio player (proof 1)

The worked flow of 3.8, end to end, as two boards in the `persephone-boards` repository. Neither
needs a bundler: the audio player is a page with an `<audio>` element, and the torrent board's
UI is plain HTML with `webtorrent` vendored under its own `node_modules` for the service.

1. **Audio player board** — `fileMasks` for the audio extensions, `editorKind: "stream-host"`,
   `capabilities: [media.play]` honored by Phase D's bus. Plays from
   `persephone.host.streamUrl()`; nothing else.
2. **Torrent board** — port of av-player's main-process code (`torrent-proxy.ts`,
   `streaming-server.ts`, about 500 lines) into `scripts/service.mjs`: WebTorrent with
   `memory-chunk-store`, no WebRTC/native addon in the pilot; `contentProviders: [{ type:
   "torrent", schemes: ["magnet", "torrent"] }]`; `fileMasks: ["*.torrent"]`; a page listing
   torrents and their files from the service's status stream; double-click issues
   `persephone.openRawLink("torrent://<infohash>/<path>")`.
3. Playback while downloading, seeking re-prioritising pieces, page close stopping the stream,
   restore starting the service on demand, uninstall showing the placeholder.

Exit: every row of the 3.8 table observed on a real magnet link, including the failure rows,
with the `userData` watcher clean. This is the first time a module outside the core contributes
below the UI, and it is what the roadmap is for. Because Phase D is already in place, the audio
player's `media.play` registration is honored here too. The board handler remains page-backed in
the caller's window; a headless service-backed capability is not implied by this phase.

### Phase F — Excalidraw extraction (proof 2)

> **Superseded in part by [EPIC-109](epics/EPIC-109.md), 2026-09-20.** The user reprioritized Phase F
> ahead of Phase E (legal — F needs A, B and D, all shipped, and not C) and **split it in two**:
> EPIC-109 ships the bundled-board mechanism and the board with the built-in `draw-view` still
> present as a fallback; EPIC-110 does the removal in step 4 below. Two details of this section are
> corrected there:
>
> - **Step 2's "First run copies the board into the install dir" is dropped as unworkable** — the
>   install directory is not writable at runtime without elevation. Bundled boards are read in place
>   from `assets/boards/`, which `electron-builder.yml:15-18` already ships outside the asar. With no
>   copy, §6's hash-recording scheme is unnecessary too: the bytes cannot drift from the installer.
>   See EPIC-109 D1 and D2.
> - **Step 3's `editorPriority: 50` would lose to the editor it replaces.** The built-in `draw-view`
>   accepts `.excalidraw` at 50 (`editors/base/editor-matchers.ts:136`) and
>   `custom-editor-registry.ts:495` uses a strict `>` so built-ins win exact ties. EPIC-109 declares
>   60; 50 becomes correct again once EPIC-110 removes the built-in row. See EPIC-109 D7.


Dependency relocation on top of a proven platform. Two things the earlier phases did not need
appear here and are part of the epic, not assumed:

1. **Board build pipeline** in `persephone-boards`: a bundler step that emits a prebuilt `lib/`
   into the board folder (Excalidraw, React and its fonts), so the board stays a plain folder at
   install time.
2. **Bundled boards in the installer** and the trust decision from §6: shipped bytes are trusted
   at install-time identity with their hash recorded, and a catalog update re-prompts unless its
   hash is published by the same release channel. First run copies the board into the install
   dir; offline works.
3. **The board** — `content-host`, `fileMasks: ["*.excalidraw"]`, `editorPriority: 50`,
   `capabilities: [image.edit]`; the exposed `aiVision` model re-provides every
   `DrawEditorFacade` method; toolbar export and the screen-snip integration become
   `image.edit` intents into the board; fonts ship inside the board instead of `app-asset://`.
   Undo stays inside Excalidraw.
   The board uses the Phase D inline intent path first; measure structured-clone size and p95
   clone cost during this proof. Crossing the documented threshold is the trigger to add the
   deferred data-handle protocol here.
4. **Removal** — delete `editors/draw`, its facade, matcher row and `EditorType` member; the
   De-React programme's last exception closes. **Shipped as [EPIC-110](epics/EPIC-110.md),
   2026-09-25**, which corrected two details of this step:
   - **There is no `app-asset://excalidraw` serving left to delete.** It was gone before the epic
     began — the board's fonts already ship inside the board folder, as EPIC-109 intended.
   - **The packages cannot leave `package.json`.** `scripts/build-board-lib.mjs` regenerates the
     board's committed `lib/deps/` from `node_modules/@excalidraw/excalidraw`, bundling `react`,
     `react-dom`, `react-dom/client` and `react/jsx-runtime` into it. They moved to
     `devDependencies` instead, which is what this step's actual goal — no React in the shipped
     renderer — requires, since electron-builder ships `dependencies` only. See EPIC-110 D4.

Exit: the user-visible loss list from Phase F.3 is empty on a fresh install with no network;
every existing `.excalidraw` page restores into the board; the core bundle no longer contains
React; `image.edit` from the image viewer, SVG, Mermaid and the snip tool lands in the board.

### After the roadmap (not scheduled here)

Video and REST client extraction as ordinary epics using Phases B–D; `ProxyTreeProvider` so a
module's contents appear in Explorer; `persephone.fetch` / network permission; `persephone.events.on`;
board-contributed tools; command / shortcut / menu registry with an open `ContextMenuTargetKind`;
open settings namespace; storefront over the catalog.

## 5. Refactorings the roadmap depends on

| Refactor | Why now | Files |
|---|---|---|
| Scheme registry replacing the two subscriber lists | every new module scheme otherwise edits three core files | `content/parsers.ts`, `content/resolvers.ts`, `api/pages/open-url-validation.ts`, `content/registry.ts` |
| Registry-aware `pipeFromSourcePath` | restored pages with foreign schemes silently break | `content/rebuild-pipe.ts` and its four callers |
| Graceful unknown provider type | boards start after restore | `content/registry.ts:31`, `editors/text/TextEditorModel.ts:308` |
| Capability table on `EditorRow` | one source of truth for built-in handlers | `editors/register-editors.ts:141` |
| Handoff call sites → `invoke()` | removes hardcoded editor ids | the nine sites in §2 |
| Service-adding checklist or a tiny service registry on `App` | the three-place edit already caused a release bug | `api/app.ts:147-190`, `api/types/app.d.ts`, `scripting/api-wrapper/AppWrapper.ts` |
| Main-owned registries with broadcast | multi-window correctness | `main/ui-preferences.ts` as the model, `main/open-windows.ts` |
| Merge board and toolset trust models | two files, two semantics (ancestor vs exact) for one user decision | `api/board-trust.ts`, `api/tools/tools-trust.ts` |

## 6. Risks and open decisions

- **Open id space and payload contracts.** Because the platform does not know what a
  board-defined id means, it cannot validate payloads. The manifest may carry an optional
  `payloadSchema` (JSON Schema, like `ToolDef.inputSchema` in agent tools) so callers and
  agents can introspect the contract; the platform stores it and surfaces it in `list()`, but
  enforcement stays with the handler.
- **Priority conflicts between boards.** Two installed boards both claiming `image.edit` at 50
  fall back to registration order today for file masks. Decide: last-installed wins, or the
  Board Info page exposes an explicit ordering (the pinned-items list is a precedent for a
  user-ordered array).
- **Network permission model.** `persephone.fetch` keeps CSP intact but every board request
  passes through the renderer; relaxing CSP is simpler for library code (`fetch` just works)
  but is a real widening. Recommendation: RPC first, CSP relaxation as an opt-in axis if a
  migration proves it necessary (the REST client will be the test).
- **Memory pressure from handles.** A leaked `DataHandle` (handler never resolves, page never
  closes) pins its bytes. The store needs a cap and an idle timeout, surfaced in `boards.list()`
  status, and the authoring guide must say that `resolve`/`reject` is mandatory.
- **Streaming through the bridge** is deliberately deferred; video stays on the main-side
  stream session.
- **Descriptor stability.** A board's provider `type` string becomes a persisted contract in
  page state. Namespace it (`board:<manifest name>/<type>`) so two boards cannot collide, and
  say so in the authoring guide.
- **Trust UX.** Capabilities, providers and network are three new things a trust dialog now
  grants. The dialog should list what the manifest declares (it lists file masks today).
- **Shipping boards with the release.** Excalidraw-as-board must be present on first run.
  Options: a bundled `assets/bundled-boards/` copied into the install dir on first start, or a
  catalog install on first launch. Bundling is the offline-safe choice. **Trust is the open
  question:** the only auto-trust precedent is provenance-based — Persephone trusts boards it
  *created* (`board-scaffold.ts:69-71`, EPIC-035 C5) and requires consent for anything the
  catalog installs (`api/boards.ts:38-57`). Bytes shipped inside the signed installer arguably
  have the same provenance as a scaffold; a later *catalog update* of that board does not, and
  must not inherit the grant silently. Decide: bundled boards are trusted at install-time
  identity (hash recorded), and a catalog update re-prompts unless its hash is published by
  the same release channel.
  **Resolved differently by [EPIC-109](epics/EPIC-109.md) D1/D2, 2026-09-20:** nothing is copied at
  all. A bundled board is read in place from `assets/boards/`, is registered because it is part of
  the app, and never touches `trustedBoards.txt` — so there is no copy that could drift and no hash
  to record. A catalog-installed board of the same id lands in a user folder and prompts normally,
  because trust attaches to the location, not the board id.
- **Startup cost with many boards.** Discovery re-reads every trusted manifest on refresh
  (`custom-editor-registry.ts:104-120`). Capability and scheme indexes must come from that same
  read, cached in main, and **no board or service starts at launch** unless it declares
  `service` — so startup stays proportional to manifests read, not boards run. Set a budget and
  measure it in the QA surface set.
- **Registries must not silently replace.** `content/registry.ts` uses `Map.set`; every new
  registry rejects or reports duplicates (3.1, 3.2) instead.

## 7. Explicitly not in this roadmap

- A second package format, a plugin SDK, or a marketplace UI beyond the existing catalog.
- Moving Monaco, Markdown or the Browser out of the core.
- Renderer-side sandboxing changes (`nodeIntegration`, `contextIsolation`).
- Board-to-board *direct* messaging outside the capability bus; if two boards need a channel,
  they expose models and use `call()`.

## 8. Verification approach

This project has **no unit-test framework by decision**, and this roadmap does not reopen that.
Verification is done the way the project already verifies: the QA surface set under `qa/`
driven by the MCP test agent, plus live checks through `mcp__persephone__call`. What each phase
adds to that:

- **Living fixtures.** Two small boards in `assets/` (the `demo.greet` pair from Phase D's exit)
  ship with the app like the demo board does, so every failure case in 3.1 can be replayed by
  an agent on any build, in two windows.
- **Restore fixtures.** A saved `pages` state containing one page per scheme and one per
  provider type, restored before and after each phase, is the regression check for the pipeline
  refactor and for uninstall behavior.
- **Budgets as numbers in the QA doc.** Startup time with N trusted boards, handle-store size
  after the stream cases, service restart count — recorded per run so drift is visible.
- **Docs are part of each epic.** The board authoring guide (`assets/board-template/CLAUDE.md`
  and the `persephone://guides/boards` corpus) is the authoritative manifest and bridge
  reference by standing decision (EPIC-103 D7); every new axis lands there in the same epic,
  and `doc/architecture/content-pipeline.md` stays the contract of record for schemes.

## 9. Review outcome

Codex's adversarial review (`reviews/platform-roadmap-critique.md`) found nine factual errors;
all nine are corrected above, most materially: `contentMasks` never opens a file, `persephone.call`
is renderer-rooted rather than "full root", `registerProvider` is exported, the handoff-site
inventory is a deliverable rather than a count, a migrated video board cannot play a
`127.0.0.1` URL, Phase A cannot include the pending provider and stay behavior-neutral, the
catalog is already main-owned, and bundled auto-trust has only a provenance precedent. Its
design findings on request lifecycle, registration collisions, backpressure, reserved schemes,
`utilityProcess` limits, bridge versioning, permissions, startup cost and the two-window proof
are adopted in §3.1, 3.1a, 3.2, 3.4, 3.5, 3.7, Phase D and §6.

Declined, with reasons:

- **A unit-test framework and contract tests.** Project decision; §8 gives the equivalent in the
  project's own verification model.
- **"`persephone.call` is page-scoped".** Overstated in the other direction: it resolves the
  renderer root (`pages`, `boards`, `tools`) with the hosting page as context. §2 now says
  exactly that.
- **Dropping Excalidraw from the migration list.** Kept as the closing phase and reframed as
  dependency relocation with an explicit loss list; the platform proofs are Phases E and F.
- **Signatures for catalog boards.** Real, but it is a catalog concern that predates this
  roadmap (sha256 verification exists; signing is the code-signing backlog item). Referenced
  from §6, not designed here.

## 10. Related documents

- [architecture/content-pipeline.md](architecture/content-pipeline.md) — the three layers this
  roadmap opens up
- [epics/EPIC-035.md](epics/EPIC-035.md), [EPIC-042](epics/EPIC-042.md), [EPIC-043](epics/EPIC-043.md),
  [EPIC-045](epics/EPIC-045.md), [EPIC-103](epics/EPIC-103.md) — the board axes already shipped
- [epics/EPIC-098.md](epics/EPIC-098.md), [EPIC-100](epics/EPIC-100.md) — reference migrations
- [tasks/backlog.md](tasks/backlog.md) — EPIC-039 (`peer://` provider, pluggable transport)
  is the other recorded consumer of an open provider registry
