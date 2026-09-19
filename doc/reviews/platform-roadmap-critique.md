# Adversarial review: platform roadmap

This is a proposal review, not an implementation plan. The roadmap has several useful
seams to build on, but it currently treats a collection of renderer-local conveniences as
if they were platform contracts. That is the dangerous part: the missing contracts are
exactly where compatibility, security, and recovery bugs will live.

## Factual errors

There are **9 factual errors or materially misleading source claims**.

1. **`contentMasks` is described as part of editor resolution.** The extension table says
   `fileMasks`, `editorPriority`, and `contentMasks` are merged into editor resolution
   (`doc/platform-roadmap.md:45`). `contentMasks` is explicitly switch-option-only: it never
   selects the opening editor and `editorPriority` does not apply to it
   (`src/renderer/editors/board/board-manifest.ts:99-118`). The resolver separately compares
   file claims and priorities (`src/renderer/editors/board/custom-editor-registry.ts:177-189,
   202-245`). This is not a wording nit; a platform registry built on this premise would
   steal or fail to open files incorrectly.

2. **`persephone.call(path)` does not reach the full AiVision root.** The table claims that
   a trusted board can call the “full AiVision root” (`doc/platform-roadmap.md:51`). The
   implementation resolves the call with a page/editor context and a restricted trust
   check (`src/renderer/api/mcp/board-call-command.ts:10-63`), while the architecture says
   board calls are renderer-rooted and `main.*` is unavailable
   (`doc/architecture/overview.md:78-84`). The current board surface is page-scoped, not a
   root escape hatch.

3. **`registerProvider` is already exported.** The table says the registry exists but is not
   exported anywhere (`doc/platform-roadmap.md:55`). `registerProvider` is an exported
   function in `src/renderer/content/registry.ts:17-25`. It is not yet a public board `io`
   capability, which is the real limitation; the roadmap states that limitation incorrectly.

4. **The “nine hardcoded call sites” evidence is not reliable.** The roadmap points to
   stale or wrong locations (`doc/platform-roadmap.md:111-138`): the image handoff is at
   `src/renderer/editors/image/ImageEditor.ts:295-301`, not line 275; SVG is at
   `src/renderer/editors/svg/SvgEditor.ts:66-73`, not line 64; Mermaid has two handoffs at
   `src/renderer/editors/mermaid/MermaidEditor.ts:205-212,230-237`; and the cited HTML line
   opens the image viewer rather than naming a concrete editor id
   (`src/renderer/editors/html/HtmlEditor.ts:115-135`). The log views also contain several
   separate hardcoded editor targets (`src/renderer/editors/log-view/items/TextOutputView.ts:134-136`,
   `MermaidOutputView.ts:121-124`, `MarkdownOutputView.ts:36-39`,
   `GridOutputView.ts:112-115`). The number may accidentally be close for one hand-picked
   subset, but the supplied audit trail does not prove “nine” and is not a safe migration
   inventory.

5. **A board cannot currently play the proposed localhost media URL under the board CSP.**
   The roadmap proposes exposing the existing stream URL to a video board and says the
   player already works with `http://127.0.0.1` (`doc/platform-roadmap.md:231-233,249-253`).
   Board pages are served with `media-src 'self' blob:` and `connect-src 'self'`
   (`src/main/board-protocol-service.ts:63-76`), which excludes an HTTP localhost media
   origin. The built-in renderer video editor can use the main-side session
   (`src/renderer/editors/video/VideoEditor.ts:112-121`); that does not establish that a
   cross-origin board frame can use the same URL.

6. **The REST-client assessment understates its coupling.** The roadmap calls it roughly
   3.8k lines with no core coupling beyond `.rest.json` (`doc/platform-roadmap.md:337`). Its
   code imports the app API and core/UI types (`src/renderer/editors/rest-client/RestClientShared.ts:15-23`),
   is registered as a built-in editor (`src/renderer/editors/register-editors.ts:162-175`),
   and directly uses the application `nodeFetch` path (`src/renderer/editors/rest-client/RestClientEditor.ts:670-678`).
   The file format is only one boundary; editor registration, app pages, Monaco/UI, and
   network access are additional boundaries.

7. **Phase A cannot be “zero behavior change.”** It includes graceful unknown-provider
   restoration and rewrites live editor handoffs (`doc/platform-roadmap.md:283-295`), but
   current descriptor creation throws immediately for an unknown provider or transformer
   (`src/renderer/content/registry.ts:28-47`). Changing that to a pending state changes
   restore failure, UI state, and retry behavior. Replacing direct page opens with a
   capability broker also changes addressing and error timing, even if built-in handlers
   initially delegate to the old functions.

8. **The registry state description is too broad and false as written.** The roadmap says
   every registry is per-window and only UI preferences are main-owned
   (`doc/platform-roadmap.md:65`). The published-board catalog is fetched, cached, and
   broadcast by a main-process service (`src/main/published-boards-service.ts:13-18,215-249`),
   with renderer models pulling the initial catalog and subscribing to main broadcasts
   (`src/renderer/api/published-boards.ts:1-8`). Trust and install state are renderer-side,
   but the roadmap cannot use “every registry” as the multi-window design assumption.

9. **The current auto-trust precedent is narrower than the bundled-board option implies.**
   The roadmap treats a bundled board that is “auto-trusted” as an existing scaffold path
   (`doc/platform-roadmap.md:410-413`). Current code auto-trusts boards Persephone creates
   from a template, but explicitly requires user consent for catalog installation
   (`src/renderer/api/boards.ts:38-57`; `src/renderer/api/board-trust.ts:8-11`). That does
   not answer whether app-shipped assets, independently updated assets, and catalog copies
   share identity, signatures, or trust state.

The MessagePort claims are narrower than the roadmap suggests but not wholly fabricated:
the current bridge does mint a `MessageChannelMain` port and transfer one end to the host
renderer (`src/main/board-bridge.ts:467-502`; `src/ipc/board-bridge-channels.ts:3-17`), and
Electron exposes structured-message posting and transfer hooks
(`node_modules/electron/electron.d.ts:9817-9864`). The unsupported parts are the proposed
semantics—bounded buffering, zero-copy behavior, cross-window routing, and durable
lifecycle—not the existence of the primitive.

## Design weaknesses

### 1. Capability registry with an open id space

An open string namespace is not a registry contract. “Use reverse-DNS-style prefixes” is
not collision prevention, ownership, or version negotiation (`doc/platform-roadmap.md:80-134,
387-391`). The proposal needs an authority model for IDs, immutable payload schemas, result
schemas, deprecation rules, and a discovery response that tells a caller which versions are
actually live. A handler board registering `x.foo` after another board has already registered
it must not silently replace the first handler; today’s provider map does exactly that with
`Map.set` (`src/renderer/content/registry.ts:17-22`).

The failure model is absent. What does the caller receive if the handler is untrusted,
uninstalled, closes its page, or crashes after accepting the request? What if a board is
untrusted while a request is in flight? The existing call path only has a page-scoped
resolution and a timeout-oriented bridge (`src/board-shim.ts:425-457`); it is not a broker
with cancellation, leases, or crash semantics. A timeout must cancel work or explicitly say
that it only stops waiting. Otherwise an agent can retry and create duplicate effects.

Re-entrancy is also unspecified. A→B→A needs a request id, call-depth or cycle policy, and
separate deadlines for nested work. Otherwise a pair of boards can deadlock the renderer or
consume all pending-call slots. Discovery must be available before opening the handler page,
or “invoke” is secretly an `openBoard` operation with UI side effects. Finally, the roadmap
must state whether an intent is synchronous, queued, idempotent, or at-most-once; “result” is
not enough for side-effecting capabilities.

### 2. In-memory data channel

The main process is a convenient rendezvous point, not automatically the right owner of
large data. The roadmap puts buffers there and only proposes a risk note for memory growth
(`doc/platform-roadmap.md:140-180,400-402`). It needs hard limits per request, board, window,
and application; accounting for forwarded handles; eviction behavior; and a policy for a
consumer that never reads. A handle that is forwarded into a second request cannot be freed
when the first request settles.

`MessagePortMain.postMessage` exposes message posting and transfer, not a flow-control
protocol (`node_modules/electron/electron.d.ts:9856-9864`). The current shim queues messages
until connection and flushes the entire queue with no bound or backpressure
(`src/board-shim.ts:227-233,412-415,596-601`). A proposed `stream()` therefore needs explicit
credits, cancellation, close/error frames, and a bounded queue. “Structured clone” is not a
size limit, copy-count guarantee, or backpressure mechanism; the roadmap’s 8 MB threshold and
“copied once” assertion need measurement and a transport decision.

“No disk” is only a broker policy. Existing content-host code writes cache files under the
user cache directory and marks them restorable (`src/renderer/content/providers/CacheFileProvider.ts:7-18,28-35`);
board file-backed content is also materialized into cache paths
(`src/renderer/editors/board/BoardEditorModel.ts:535-546`). The proposal must distinguish
“this payload is not intentionally persisted by the broker” from “the application guarantees
that bytes never reach disk.” Chromium/OS paging and renderer/network caches make the latter
an impossible promise without a separately defined threat model.

Multi-window routing is missing. The current port entry is tied to one host renderer and its
board/page ownership (`src/main/board-bridge.ts:65-89`), while board calls resolve pages in a
renderer context (`src/renderer/api/mcp/board-call-command.ts:10-63`). The roadmap must say
whether a board in window 1 can invoke or stream to a board in window 2, how that target is
addressed, and who owns cleanup when either window closes.

### 3. Open scheme/provider registry

The proposal conflates three different mechanisms: provider factories, URL parsers, and
resolver subscribers. Parsers and resolvers are LIFO and short-circuiting
(`src/renderer/content/parsers.ts:34-44`; `src/renderer/content/resolvers.ts:100-110`),
whereas provider factories are a keyed map (`src/renderer/content/registry.ts:17-47`). A
board-registered scheme must have a deterministic precedence rule relative to built-ins,
including ties, unloads, and duplicate registration. “Registry-aware rebuild” is not that
rule (`doc/platform-roadmap.md:187-207`).

Allowing a board to claim `http`, `https`, `file`, or another built-in scheme is a security
and compatibility decision, not an implementation detail. The current URL admission path
uses a closed allow-list (`src/renderer/api/pages/open-url-validation.ts:1-10,68-76`). The
roadmap needs reserved names, per-board ownership, trust/permission checks, and a way to
prevent a newly installed board from changing the meaning of existing persisted links.

`PendingProvider` is underspecified. Today unknown descriptors throw
(`src/renderer/content/registry.ts:28-47`). A pending object needs an observable state,
failure and retry semantics, a timeout, a way to wake pages when a provider registers, and a
clear UI for an uninstalled provider. “Resolve once registered” can otherwise leave restored
pages waiting forever. Persisted descriptors also need migration or quarantine when a board
is uninstalled; retaining a type string is not enough to recreate its transformer chain.

### 4. Module service process in `utilityProcess`

Electron supplies the low-level pieces, not the proposed module host. `utilityProcess.fork`
takes a module path and options (`node_modules/electron/electron.d.ts:15686-15699`), can post
messages with transferred `MessagePortMain` objects (`node_modules/electron/electron.d.ts:15861-15872`),
and `WebContents.postMessage` can transfer a port into a renderer
(`node_modules/electron/electron.d.ts:18332-18341`). That proves feasibility of a port hop;
it does not prove a direct, safe port path into an arbitrary cross-origin board iframe. The
current implementation still hands the port through the host renderer
(`src/main/board-bridge.ts:467-502`).

The roadmap leaves the hard runtime questions to the implementer: ESM entry semantics,
module resolution relative to a board’s `node_modules`, package exports, source maps,
environment sanitization, protocol/origin identity, and whether a service may import Electron
or Node built-ins. `ForkOptions` has cwd/env/stdout/stderr controls but no CPU, memory, file,
or network quota (`node_modules/electron/electron.d.ts:21584-21622`). `kill()` is not crash
restart, supervision, or state recovery. There is no policy for restart storms, orphaned
requests, service shutdown on untrust, or how many utility processes can run concurrently.

The service also changes the trust boundary: a trusted UI board and a trusted headless service
must not automatically share all permissions or storage. The roadmap needs a manifest version,
service identity, handshake, health state, restart budget, and a test matrix across Windows,
macOS, and Linux before claiming that `utilityProcess` is the platform runtime.

### 5. Migrations

Excalidraw is a poor first proof if the goal is platform validation rather than dependency
relocation. It has an imperative editor API and app-owned integration points: the island takes
an imperative API and change callback (`src/renderer/editors/draw/ExcalidrawIsland.tsx:46-77`),
the facade mutates the scene through Excalidraw (`src/renderer/scripting/api-wrapper/DrawEditorFacade.ts:66-99`),
and the toolbar owns export and screen-snip behavior (`src/renderer/editors/draw/index.ts:44-72,162-170`).
Moving the surface into a board does not preserve undo integration, the facade contract, the
snip tool, toolbar export, or the local font packaging automatically. The font path is an
explicit app asset today (`src/renderer/editors/draw/ExcalidrawIsland.tsx:40-43`).

The claimed dependency prize is also less clean than the roadmap says. The project’s own
completion record says React and React DOM remain installed because Excalidraw declares them as
peer dependencies, and that moving Excalidraw into boards was outside the de-React programme
(`doc/epics/completed.md:1630-1642,1714-1723`). A board migration may reduce the core renderer
bundle, but it will not make the dependency disappear unless the board build and packaging
strategy are separately specified.

Video is not a simple “expose streamUrl” migration. The stream URL is transient and explicitly
cleared from persisted state (`src/renderer/editors/video/VideoEditor.ts:43-48,155-166,455-471`),
so the board must recreate sessions on restore and release them on page/window/service failure.
REST is even less isolated than the roadmap claims: its views depend on app/UI/Monaco and its
editor is wired into the built-in editor registry (`src/renderer/editors/rest-client/RestClientShared.ts:15-23`,
`src/renderer/editors/register-editors.ts:162-175`). The migration order should be selected by
the smallest complete contract, not by the most impressive folder deletion.

Bundling also conflicts with the trust/catalog story as currently written. A release-bundled
board needs signed provenance and an update identity; a catalog-installed board needs explicit
consent and hash/version handling. Treating both as “auto-trusted” creates a path for an update
to inherit trust without answering whether the new bytes are trusted.

### 6. Phasing

Phase A mixes infrastructure, behavior changes, public API publication, and nine call-site
rewrites. It cannot be a compatibility-preserving foundation while also changing unknown
provider restoration and routing. Its exit criterion (“identical behavior”) is not testable
until the proposal defines what counts as identical: page selection, editor priority, error
messages, focus, undo history, timing, and trust prompts.

Phase B secretly depends on work the phases do not explicitly deliver: a process-wide discovery
registry, cross-window target addressing, handler activation, and lifecycle state. The existing
board call path is page-scoped; “open target board, invoke, return result” is not a small field
addition to `BoardPortInitMsg` (`src/ipc/board-bridge-channels.ts:219-243`). It is a routing and
ownership protocol.

The smallest end-to-end proof is two trusted boards in different renderer windows: board A
discovers a board-defined capability from B, sends a small structured payload, receives a result,
and exercises timeout, cancellation, handler close, and untrust during the call. That is smaller
than all of Phase B and more probative than a built-in alias. A separate vertical slice should
then prove one provider descriptor surviving reload, uninstallation, and reinstallation.

### 7. Other design gaps that belong in the roadmap

The current bridge exposes version `1.5.0` (`src/board-shim.ts:868-875`), but the roadmap does
not define a negotiated bridge version, minimum version in `board-manifest.json`, feature
discovery, or behavior for an old board after new capability/data methods are added. Existing
boards must continue to render when new fields are absent.

The capability and provider registries also need an explicit permission model. “Trusted board”
currently gates arbitrary code execution and is stored outside the manifest
(`src/renderer/api/board-trust.ts:1-18`); it does not by itself express “may claim `http`,”
“may receive sensitive buffers,” or “may expose an agent tool.” Trust changes must revoke future
requests and settle in-flight work deterministically.

## Missing topics

- **Testing and QA.** The repository has no unit-test framework and the backlog explicitly calls
  for choosing one and adding smoke coverage (`doc/tasks/backlog.md:353-366`). The roadmap needs
  contract tests for clone/transfer payloads, fake-port tests for cancellation/backpressure,
  multi-window integration tests, crash/restart tests, malformed manifest tests, uninstall and
  persisted-state tests, and memory/startup benchmarks. “Works in a demo board” is not enough for
  a broker.

- **Documentation.** The manifest schema, capability contracts, provider descriptor format,
  trust prompts, service lifecycle, and compatibility policy need versioned developer docs and
  user-facing board installation docs. The existing board manifest treats metadata and behavior
  fields differently and gates them on trust (`src/renderer/editors/board/board-manifest.ts:13-23,99-118`);
  the proposal does not say where the new contract is authoritative.

- **Agent/MCP surface.** Board capabilities that become discoverable to agents need an explicit
  listing and permission surface. The current board lifecycle already distinguishes downloading
  inert code from granting trust (`src/renderer/api/boards.ts:49-57`), and the current board call
  is page-scoped (`src/renderer/api/mcp/board-call-command.ts:10-63`). The roadmap must define
  whether arbitrary board capabilities are agent-visible, how schemas and side effects are
  described, and how an agent is prevented from using a newly installed board as an implicit
  tool.

- **Multi-window semantics.** Specify global versus window-local registration, target identity,
  event ordering, and close/untrust races. The main process already broadcasts catalog changes
  to all windows (`src/main/published-boards-service.ts:241-249`), while trust state is a
  renderer-side reactive model (`src/renderer/api/board-trust.ts:47-59`); the roadmap needs to
  choose which pattern each new registry follows.

- **Startup and scale.** Trusted board discovery currently re-reads every trusted root and
  manifest on refresh (`src/renderer/editors/board/custom-editor-registry.ts:104-120`). A
  capability/scheme registry that eagerly starts many boards can make startup and page restore
  proportional to installed boards. Define lazy discovery, indexing, failure isolation, and
  measurable startup budgets.

- **Upgrade and rollback.** Add bridge/API compatibility for boards written against 1.5.0,
  manifest min/max bridge versions, atomic board updates, rollback after a bad service update,
  and migration of persisted pipe descriptors and page state. Uninstall must leave a useful
  “provider missing” object rather than a permanently throwing page.

- **Security and provenance.** Define signatures or another provenance mechanism for bundled and
  catalog boards, hash verification at activation time, package isolation, network/file scopes,
  payload confidentiality, and revocation. A board’s manifest cannot self-grant trust
  (`src/renderer/api/board-trust.ts:8-18`), but the roadmap currently has no equivalent rule for
  capabilities, schemes, or service permissions.

- **Operational limits and observability.** Specify per-board memory, queued-request, stream,
  process, and log limits; expose registration and failure diagnostics; and make leak detection
  possible. Without this, “free when request settles” is an aspiration rather than an invariant.

## Top three changes

1. **Replace the broad platform phases with one contract-first vertical slice.** Define a
   versioned capability descriptor, discovery response, request lifecycle, cancellation, error,
   and trust semantics, then prove it across two windows with a real board-defined handler. Do
   not count the slice complete until handler crash, untrust, timeout, and re-entrancy have
   observable, tested outcomes.

2. **Separate and secure the registries before opening them.** Treat capabilities, URL schemes,
   provider factories, and resolver ordering as different registries with ownership, reserved
   names, versioned schemas, and uninstall/persisted-state rules. Make “trusted” a prerequisite,
   not the whole permission model, and specify whether a board can ever override a built-in.

3. **Turn the runtime and migration promises into measurable gates.** Set buffer/process/startup
   budgets, define the actual transport/backpressure and cross-window route, and test the
   utility-process lifecycle before promising service boards. Re-rank migrations by preserved
   user behavior and complete dependency accounting; Excalidraw should not be the flagship proof
   until undo, snip, fonts, facade methods, restore, and trust/update packaging are accounted for.
