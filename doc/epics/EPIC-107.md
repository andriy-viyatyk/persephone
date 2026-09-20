# EPIC-107: Open providers, ranged streaming and the stream-host

## Status

**Status:** Completed
**Created:** 2026-09-20
**Completed:** 2026-09-20
**Roadmap phase:** [Platform roadmap](../platform-roadmap.md) — **Phase C, Open providers with
ranged streaming**

## Overview

Phase A ([EPIC-105](EPIC-105.md)) built the pipeline registries with the built-ins as their only
registrants. Phase B ([EPIC-106](EPIC-106.md)) built the module service process — a Node process
the platform owns, reachable from the renderer with no board page open.

Phase C is where those two meet: **a board becomes a data source.** After this epic a trusted
board can declare a content provider, the pipeline can build a pipe on it, a page opened on it
restores across a restart, and the board's own `<audio>` / `<video>` / `<img>` can read the page's
pipe as an origin-local URL with `Range` support and nothing written to disk.

Nothing in this epic needs a visible board page, which is the point. The torrent flow of roadmap
§3.8 is the shape being built for: a `torrent://` link opens in Monaco while the torrent board's
page is closed, and an `.mp3` plays while it is still downloading.

## Why this now

Every remaining phase is blocked on it in a different way. Phase D's capability bus assumes the
in-memory transport that this epic's credit-based stream frames establish. Phase E (the torrent
board and audio player) is *entirely* this epic's surface — it adds no platform code at all.
Phase F needs none of it, which is precisely why it is last.

More immediately: EPIC-105 D2 deliberately left `createProviderFromDescriptor` throwing on an
unknown provider type, and assigned the *provider missing* placeholder and `PendingProvider` to
this phase. That is a real defect today — uninstall a board with a persisted pipe and the page
restores broken — and it is this epic's to fix.

## What already exists

Verified against the source on 2026-09-20, not taken from the roadmap.

- **The ranged-read contract already exists and has no consumer.**
  `IProvider.createReadStream?(range?: { start, end }): NodeJS.ReadableStream` is declared at
  `src/renderer/api/types/io.provider.d.ts:48` and implemented by `FileProvider.ts:29` and
  `HttpProvider.ts:80`. `grep` finds **no caller anywhere in `src/`**. `IContentPipe`
  (`io.pipe.d.ts`) does **not** expose it, so the pipe cannot stream at all. This epic is the
  first consumer of a seam that has been dormant since it was written.
- **Range serving is already implemented once, in main.** `src/main/video-stream-server.ts` has a
  complete `parseRangeHeader` / 206 / 416 / `Content-Range` / `Accept-Ranges` implementation over
  an `http.ServerResponse` (`:180-225`), plus a virtual-layout variant. It is an HTTP server, not
  a `protocol.handle`, so the code is a model rather than a library — but the header arithmetic is
  written and correct, and should be extracted rather than re-derived.
- **The `board://` handler cannot see request headers.** `initBoardProtocol` registers
  `ses.protocol.handle("board", (request) => serveBoardFile(request.url))`
  (`src/main/board-protocol-service.ts:302`) — it passes the **URL only** and discards the
  `Request`. `serveBoardFile` never sets `Accept-Ranges` and always returns 200. So Range support
  is a change to the handler's signature and contract, not a new branch inside it.
- **The board CSP already permits this.** `BOARD_CSP` carries `media-src 'self' blob:` and
  `img-src 'self' data: blob:` (`board-protocol-service.ts:65-83`), and `board://<host>/__pipe/…`
  is same-origin `'self'`. No CSP change is needed, which is why the `__pipe` design was chosen
  over a `127.0.0.1` URL in the first place (roadmap §3.4).
- **The provider registry already carries `origin`.** `content/registry.ts` defines
  `RegistrationOrigin = "platform" | "script" | (string & {})` and `RegistrationOptions`, reports
  duplicates through `ui.notify` rather than replacing, and validates a script provider's runtime
  shape once per type (`validateProviderShape`, `wrapScriptProviderFactory`). Phase A's annotation
  in the roadmap says this is what Phase C's board-ownership rule should hang from, and it is.
- **`createProviderFromDescriptor` throws.** `registry.ts` — `Unknown provider type: "<type>"`.
  That throw is what EPIC-105 D2 left standing, and it is the placeholder's insertion point.
- **The scheme registry is a façade over the event channels** (EPIC-105 D1), already carries
  `origin` on each registration (`scheme-registry.ts:24-27`) and already separates platform from
  script registrations with different duplicate rules. **`PIPELINE_SCHEMES` no longer exists as a
  symbol** — EPIC-105 replaced it with `isSchemeRegistered()`, consumed at
  `api/pages/open-url-validation.ts:61`. Documents that still name the constant are describing the
  shape, not a live identifier.
- **Transformers are buffer-in / buffer-out.** `ITransformer.read(Buffer)` has no streaming form,
  so a *streamed* pipe read cannot traverse transformers. The pipe-level stream must therefore
  either be restricted to a transformer-free pipe or fall back to a buffered read when
  transformers are present. The task document must choose and say which; silently streaming past a
  transformer would corrupt an archive entry or a decrypted file.
- **`assets/editor-types/` is byte-identical to `src/renderer/api/types/`** (verified by `diff`),
  and there is no build step behind it. Every type change in this epic lands in both trees or
  script IntelliSense silently breaks.
- **The board frame's `persephone.service.request` does not use the MessagePort.** It is an
  ordinary bridge RPC (`board-shim.ts:962-968` → `board-bridge.ts:259-264`), exactly as EPIC-106 D3
  decided. The `MessagePort` lease is the **renderer's** path
  (`api/module-service.ts`, `module-service-supervisor.ts:380-415`) and is the one this epic's
  `ProxyProvider` uses.
- **`editorKind` accepts two values, and has about twelve mirrors.** `board-manifest.ts:152`
  declares `"simple" | "content-host"`, `:473` repeats it on `BoardEditorAssociation`, and `:515`
  is the single coercion point that normalizes anything else to `"simple"` — so an unknown kind
  degrades silently today. The value is then mirrored in `src/ipc/api-param-types.ts:107`,
  `main/published-boards-service.ts:103-126`, `custom-editor-registry.ts:74,158,266`,
  `api/pages/PagesLifecycleModel.ts:148`, `editors/base/editor-switch.ts:167`, `api/boards.ts:447`,
  two scripting facades and three `.d.ts` files with their `assets/editor-types/` copies. Adding a
  third value is a wide, shallow edit, which is why one task owns all of it.
- **There are TWO non-local gates, not one.** The roadmap and a first reading name only
  `editors/base/editor-switch-options.ts:84-86` (board matches filtered to `content-host` on a
  non-local source) and `:93` (the same for catalog matches). But the **open/resolve** path has its
  own, independent gate at `custom-editor-registry.ts:266`:
  `if (!local && b.editorKind !== "content-host" && b.editorSources !== "any") continue;`
  Lifting only the switch-options pair would make a stream-host board *offerable* but never
  *chosen*. Both must move.
- **`editorSources: "any"` already exists, and it is the copy-based answer to the same problem.**
  `board-manifest.ts:167` lets a simple board claim non-local sources, and the comment at
  `custom-editor-registry.ts:261-264` says exactly why it works: the board "still gets a readable
  local path out of `getFilePath()` because Persephone materializes the pipe into a cache file for
  it." So `stream-host` is not a new capability so much as the **no-copy** alternative to an axis
  that already ships — which is the cleanest possible statement of what this epic is for. Note the
  existing inconsistency it inherits: `editorSources` is consulted by the open gate and **ignored**
  by the switch-options gate.
- **Materialization to disk is real and memoized.** `BoardEditorModel.ensureContentPath()`
  (`:511-548`) short-circuits for a plain local `file` pipe with no transformers, and otherwise
  does `readBinary()` → `appFs.writeBinary(<cache>/<editorId>/<basename>)` and records
  `contentCached`. This is exactly the behaviour `stream-host` must not have.
- **The service surface from Phase B:** `src/main/module-service-supervisor.ts` (918 lines),
  `src/renderer/api/module-service.ts` (298), `src/ipc/module-service-channels.ts` (89),
  `assets/module-service-host.mjs` (64), and the shipped fixture `assets/demo-board/` with
  `scripts/service.mjs` and a manifest declaring `minBridgeVersion: "1.6.0"`,
  `permissions: ["service"]`, `service: "scripts/service.mjs"`.

## Goals

- A trusted board declares a content provider in its manifest, implements it in its **service**,
  and the pipeline builds pipes on it with no board page open.
- A persisted pipe whose provider type is not registered opens a **placeholder** naming what is
  missing, instead of throwing or restoring silently empty.
- A persisted pipe whose provider type belongs to a trusted board that has not started yet
  **starts that board's service on demand** and resolves.
- A board scheme cannot shadow a platform scheme, and two boards claiming one scheme resolve by a
  stated one-owner rule rather than by `Map.set`.
- A board can read a page's pipe as `board://<host>/__pipe/<pageId>` with working `Range` requests
  and seeking, and **nothing is written under `userData`** for that page.
- Ranged reads reach a board-implemented provider over credit-based frames, with backpressure and
  explicit close/error — not the shim's unbounded queue.
- An unknown scheme typed or clicked in the Browser reaches `openRawLink` rather than being
  swallowed.

## Decisions

**D1 — Board provider `type` strings are namespaced by the author, not derived by the platform.**

A provider `type` becomes a persisted contract the moment it lands in `IEditorState.pipe`
(roadmap §6, "Descriptor stability"). The roadmap proposes deriving the namespace as
`board:<manifest name>/<type>`. Rejected: `name` is optional, author-controlled, mutable and
non-unique (`board-manifest.ts` treats it as a display string), so a rename would orphan every
persisted page. Deriving it from the board **root** instead — the key EPIC-106 D6 chose for
storage — fails differently: it changes when the board is reinstalled to another folder, which for
a catalog board is routine.

Decided: **a board-declared provider type must itself contain a `/`** (`acme/torrent`,
`persephone-boards/mem`), and the platform registers it verbatim. Un-namespaced types are
**reserved for the platform** — which is exactly the six that exist (`file`, `cache`, `http`,
`data`, `mneme`, `guide`) — so the rule needs no list to maintain and cannot drift. The persisted
string is then chosen by the author, stable across renames and reinstalls, and collisions are the
authoring guide's problem, enforced by the one-owner rule in D2 rather than by silent replacement.

**D2 — One owner per scheme and per provider type; the first trusted registration wins and the
loser is reported, never silently replaced.**

The registry already reports duplicates instead of replacing (`reportDuplicate` in `registry.ts`),
and already knows `origin`. This epic adds `origin: "board"` and two rules on top:

- **Reserved.** A `board` origin may not claim a scheme registered by a `platform` origin, nor any
  of the hard-reserved names `http`, `https`, `file`, `data`, `blob`, `mneme`, and any
  `persephone-*` — the hard list exists because a platform scheme may not have registered yet at
  the moment a board tries, so "already registered" is not a sufficient test on its own.
- **First trusted wins.** Two boards claiming one scheme or one provider type: the first keeps it,
  the second is refused and the refusal is **readable in Board Info** rather than only toasted.
  A toast is missed; Board Info is where a user goes to ask why a board is not working.

A board unregisters on untrust and on uninstall, which frees the name.

**D3 — `contentProviders` is a manifest axis; it is disclosed in `permissions`, but the functional
gate is the axis itself. This deliberately differs from `service`, and the difference is recorded
because EPIC-106's D1 is still provisional.**

EPIC-106 D1 reversed the roadmap: `permissions` is disclosure and lifecycle hygiene, not a
security boundary, and the grant record is deferred to the trust-model merge. It anticipated that
"Phase C's `contentProviders` … declare themselves through the same axis, so those phases add a
value to a list rather than a mechanism", and it gave `service` a *functional* hygiene gate — the
platform refuses to start a service unless `"service"` is in `permissions`.

**That reversal has not been reviewed by the user.** Following it all the way here would mean a
second functional gate depending on a provisional decision, and two declarations
(`permissions: ["contentProviders"]` and the `contentProviders` array) that must agree or the
board half-works. So:

- `"contentProviders"` **is** listed in `permissions` and **is** shown in the trust dialog and
  Board Info. The disclosure value of EPIC-106 D1 is kept in full.
- The platform registers a board's providers because the board declared them in the
  `contentProviders` **array**, not because the permission string is present. One declaration, one
  meaning, no way to half-declare.

This is the option easiest to unwind in either direction: if the trust-model merge makes
`permissions` a real boundary, adding the check is one conditional at the registration site; if
the user rejects the `permissions` axis entirely, nothing functional here breaks. The
inconsistency with `service`'s hygiene gate is real and is called out in the authoring guide, so
nobody discovers it by surprise. **Flagged for the user in the roadmap's *Needs user
verification* section.**

**D4 — `__pipe` ranges are served through the renderer, and the direct service-port pull is
deferred as an optimisation with a stated trigger.**

Roadmap §3.4 says main serves `__pipe` ranges "from a service port directly, or from the renderer
over IPC" — two paths for one URL. This epic builds **one**: main asks the owning renderer for the
range over IPC, and the renderer satisfies it from the page's `IContentPipe`.

The reason is that the renderer path is the *general* one. A page's pipe may be a `FileProvider`,
an `HttpProvider`, an archive-transformed pipe, or a `ProxyProvider` forwarding to a service — and
only the renderer knows which. The direct-from-service path is a shortcut that applies to exactly
one of those cases and requires main to duplicate pipe composition to know when it is legal. One
code path that always works beats two where one is conditionally correct.

What it costs: a service-backed stream round-trips main → renderer → main per range. The
**deferral trigger** is stated so it is not forgotten: if Phase E measures the renderer hop
adding more than ~20 ms at the 95th percentile to a seek, or stalling playback at any bitrate the
torrent board actually achieves, the direct pull becomes a task in that epic. Until then it is
unbuilt, not assumed.

**D5 — `stream-host` is a third `editorKind`, and its defining property is that the platform does
not materialize and does not cache.**

`content-host` means "the platform owns the pipe and pushes you text". `stream-host` means "the
platform owns the pipe and hands you a URL". Concretely:

- No text host, no `persephone.host.content`, and **no `CacheFileProvider` auto-save pipe** — that
  auto-save is what writes `<userData>/cache/<pageId>.txt` today, and its absence is what the
  epic's "userData watcher is clean" criterion actually measures.
- `ensureContentPath()` is never called for a stream-host page, so nothing lands in
  `<cache>/<editorId>/<basename>` either.
- It clears **both** non-local gates alongside `content-host` — `editor-switch-options.ts:84-86`
  and `:93` for being offered, and `custom-editor-registry.ts:266` for being chosen — because
  serving a remote pipe over `__pipe` is precisely the case those gates exist to prevent when the
  board would otherwise get nothing. Lifting only the first would make a stream-host board appear
  in the switch list and then never win the open.
- `board-manifest.ts:515` normalizes an unrecognized `editorKind` to `"simple"`. That stays, so an
  old Persephone opening a `stream-host` board degrades to a plain board rather than erroring —
  and a board that needs the real behaviour says so with `minBridgeVersion`.

**D6 — `persephone.host.streamUrl()` is available to any page whose pipe the platform owns, not
only to `stream-host` pages.** A `content-host` board that wants to show an image embedded in the
file it was given has the same need and the same pipe. `editorKind` governs the *gate* and the
*caching*, not who may ask for a URL. One method, one implementation.

**D7 — A service is not obliged to have a renderer port, per EPIC-106 D3, so `ProxyProvider`
must degrade rather than hang.**

EPIC-106 D3 says in terms: "the renderer lease is therefore reserved for Phase C's high-volume
provider traffic, and a service is not obliged to implement that port at all — Phase C must not
assume one is attached." So `ProxyProvider`'s constructor may not assume a port, and every method
must settle: a provider whose board declares a type but whose service never attaches a port
rejects with a typed *provider unavailable*, surfaced through the same placeholder as D8, rather
than leaving a page spinning. The concurrency cap and request settling that EPIC-106 D4 built for
service requests apply unchanged — this epic adds no second supervisor.

**D8 — *Provider missing* and *pending* are two states of one placeholder, and the placeholder is
a provider, not an editor.**

The natural-looking implementation is a new editor that a page falls back to. That is wrong here:
the page must keep its identity, its title, its `sourceLink` and its pipe descriptor, so that
reinstalling the board makes it work again without the user re-opening anything. EPIC-105 D2 left
`createProviderFromDescriptor` throwing precisely so this decision could be taken here.

So `createProviderFromDescriptor` stops throwing for an **unregistered** type and returns a
`MissingProvider`: `restorable: true`, `writable: false`, a `readBinary()` that rejects with a
typed error carrying the missing type and the declaring board if one is known, and a
`toDescriptor()` that returns **the original descriptor unchanged** — so nothing is lost on the
next save of page state. `PendingProvider` is the same object in a different state: when the type
is declared by a board that is trusted but whose service is not running, the first read starts the
service (EPIC-106 D4's lazy start, unchanged) and then delegates.

A genuinely malformed descriptor — missing `type`, not an object — still throws. The placeholder
is for *absent*, not for *corrupt*.

**D9 — Credit-based stream frames are a transport for `createReadStream`, and this epic does not
build a general data channel.** Roadmap §3.1a describes `DataHandle`, `persephone.data.read/
stream/forward` and reference-counted forwarding as the capability bus's payload channel. All of
that is **Phase D**. What this epic builds is narrower and must not be mistaken for it: a
credit-based framed byte stream between one `ProxyProvider` and one service, for one ranged read,
with grant / chunk / end / error / cancel frames and a bounded in-flight window. Phase D may
generalize it; it does not inherit it by assumption.

**D10 — Verification is live through MCP, and the fixture is the already-trusted demo board.**
EPIC-105 and EPIC-106 each closed with defects that typecheck, lint and `build-prod` all passed —
ten across the two epics, one of which silently broke trust revocation. Every exit criterion below
is written as an observation an agent can make against the running app. The fixture work extends
`assets/demo-board`, which is **already trusted in the user's install**, so no exit criterion
requires clicking **Trust Board** on the user's behalf. Anything that genuinely does is recorded
under *Needs user verification* rather than granted.

## Scope: what this epic does NOT do

| Deferred | To | Why |
|---|---|---|
| `DataHandle`, `persephone.data.*`, reference-counted forwarding, inline structured-clone payloads | Phase D | D9 — that is the capability bus's channel, not the provider's |
| Direct main→service pull for `__pipe` ranges | Phase E, on a measured trigger | D4 — one general path beats two, one of which is conditionally correct |
| `ProxyTreeProvider` / `ITreeProvider` contribution | After the roadmap | Roadmap §3.3 already defers it until providers prove the bridge |
| `persephone.fetch` / `network` permission / CSP relaxation | After the roadmap | Roadmap §4; nothing here needs it |
| `media.play` as a capability invocation | Phase D | The torrent flow's steps 4-5 are ordinary link resolution (roadmap §3.8) |
| Granted-permission record, *changed grant* re-prompt | The trust-model merge (roadmap §5) | Inherited from EPIC-106 D1; D3 above deliberately does not extend it |
| Credit-based ranged streaming to a board provider (US-1474) | Phase E | D11 — the pre-committed abort boundary, taken; Phase E is its only consumer |
| A real torrent board or audio player | Phase E | This epic ships the platform and a fixture, not a product |
| Enforcing `minAppVersion` on local registration | Its own task | EPIC-106 recorded it as an untouched scope cut; unchanged here |

**D11 — US-1474 (credit-based ranged streaming to a board provider) is deferred to Phase E. This
was the pre-committed abort boundary, and it is being taken as written.**

The Concerns section below said, before any code existed: *"It is sequenced last deliberately:
criteria 1-9 and 12 are all reachable without it, so if the epic has to stop early it stops after
wave 3 with a coherent, shippable slice and US-1474 moves to Phase E, which is its only consumer."*
That is what happened, and the reason to record it as a decision rather than a slip is that the
boundary was argued in advance so the call would not be made under time pressure.

What ships without it: a board provider serves whole-resource reads (`readBinary`, `writeBinary`,
`stat`, `watch`) over the service lease, bounded by `MAX_BUFFERED_PIPE_BYTES`; and `stream-host`
serves **ranged** reads over `board://<host>/__pipe/<pageId>` from any pipe the platform owns,
including a plain `FileProvider`. What does not ship: a *range* pushed down into a
**board-implemented** provider, which is what lets a torrent client prioritise pieces. So a board
provider can back a page, and a page's pipe can be seeked — but a board provider cannot yet be
seeked.

Phase E is the only consumer: roadmap §3.8 step 7 is the first place a ranged read must reach a
board's service. The seam is in place and documented in
[US-1473](../tasks/US-1473-proxy-provider/README.md) — `IProvider.createReadStream?(range)` stays
unimplemented on `ProxyProvider`, and `ContentPipe` already falls back to a buffered read when a
provider omits it, so nothing is broken by its absence.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1471 | `contentProviders` and `stream-host` manifest axes; reserved names and the one-owner rule | Done |
| US-1472 | *Provider missing* placeholder and `PendingProvider` | Done |
| US-1473 | `ProxyProvider` and `persephone.providers.register` over the service port | Done |
| US-1474 | Credit-based ranged streaming: `createReadStream(range)` through the bridge and the pipe | **Deferred to Phase E** (D11) |
| US-1475 | `editorKind: "stream-host"` and `board://<host>/__pipe/<pageId>` Range serving | Done |
| US-1476 | Browser routing of `magnet:` and `.torrent` into `openRawLink` | Done |
| US-1477 | Demo-board provider and stream-host fixtures, and the authoring documentation | Done |

Order, chosen so parallel sessions never touch one file:

- **Wave 1** — US-1471 (manifest + both registries) and US-1476 (`browser-service.ts` only).
  US-1471 owns **every** manifest change in the epic, including `stream-host`, so US-1475 never
  opens `board-manifest.ts`.
- **Wave 2** — US-1472 (`content/`) and US-1475 (`main/` + `BoardEditorModel` + switch options +
  the shim's `host` namespace).
- **Wave 3** — US-1473 (the shim's `providers` namespace + `module-service`).
- **Wave 4** — US-1474 (streaming, on top of US-1473).
- **Wave 5** — US-1477 (fixture and docs, which exercise all of the above).

## Exit criteria

Each is an observation, per D10.

1. A board declaring `contentProviders: [{ type: "demo/mem", schemes: ["mem"] }]` has that
   provider registered when trusted, and `mem://` is accepted by `isSchemeRegistered()` at the
   `pages.openUrl` validation boundary (`open-url-validation.ts:61`) while `bogus://` is still
   rejected.
2. A page opened on a `mem://` URL gets its bytes from the board's **service** with **no board
   page open**, and `boards.list()` shows the service running.
3. That page **restores across an app restart**: the persisted descriptor names the board type,
   the board's service is started on demand by `PendingProvider`, and the content comes back.
4. Untrusting the board leaves the page showing the *provider missing* placeholder, naming the
   type and the board, and page state still carries the original descriptor unchanged — re-trusting
   makes the page work again without reopening it.
5. A board declaring a provider type with **no `/`** is refused with a readable reason, and a
   second board claiming an already-owned scheme or type is refused with the owner named in Board
   Info (D1, D2).
6. A board declaring the reserved scheme `file` or `https` is refused, and the platform scheme
   keeps working.
7. A `stream-host` board page opened on a local `.mp3` plays it from
   `board://<host>/__pipe/<pageId>`; the `<audio>` element issues a `Range` request, main answers
   **206** with a correct `Content-Range`, and seeking issues a new range and plays from there.
8. Throughout criterion 7, a watcher over `<userData>` records **no new file** — neither
   `cache/<pageId>.txt` nor `<cache>/<editorId>/<basename>`.
9. A `stream-host` board is both **offered** for a non-local source (the switch-options gate at
   `editor-switch-options.ts:84-86` / `:93`) and actually **chosen** to open it (the independent
   open gate at `custom-editor-registry.ts:266`). A `simple` board declaring neither
   `editorSources: "any"` nor `stream-host` still is not.
10. A ranged read against a **board-implemented** provider returns the right bytes for a range in
    the middle of the resource, the credit window bounds in-flight chunks (the service is never
    more than the granted number of chunks ahead), and cancelling the read delivers a cancel frame
    to the service rather than silently abandoning it.
11. A board declaring `contentProviders` whose service never attaches a renderer port fails with a
    typed *provider unavailable* and the placeholder, and does not hang a page (D7).
12. A **registered** custom scheme entered or clicked in the Browser reaches `openRawLink`
    instead of failing inside Chromium. The before-state is recorded in US-1476's document: today
    `browser-service.ts:268-288` blocks only `file:` and `app-asset:` and lets every other scheme
    fall through to Chromium, which fails the navigation — so this is a fix, not only a check.
13. `app.ui.alerts.list()` is empty at the end of the verification run, and every test page, test
    board state and demo-board modification is reverted.
14. `npm run typecheck`, `npm run lint` and `npm run build-prod` pass.

## Concerns

- **US-1474 is the task most likely to overrun.** Credit-based framing is the only genuinely new
  protocol in the epic, and it is the last wave. It is sequenced last deliberately: criteria 1-9
  and 12 are all reachable without it, so if the epic has to stop early it stops after wave 3 with
  a coherent, shippable slice and US-1474 moves to Phase E, which is its only consumer.
- **`__pipe` lifetime is a leak surface.** A range request names a `pageId`; if the page closes
  mid-stream, main must settle the in-flight response rather than wait on a renderer that will
  never answer. This is the same shape as EPIC-106 D4's in-flight settling, and it should reuse
  that reasoning rather than invent a second timeout policy.
- **`stream-host` interacts with restore.** A restored stream-host page has a descriptor but no
  live pipe until the provider resolves, and the `<audio>` element may issue its first range
  before that. The URL must be answerable lazily, or the board must be told when it becomes
  readable — the task document must pick one and say which.
- **D3 diverges from `service`'s hygiene gate on purpose**, and if the user later endorses
  EPIC-106 D1 in full, that divergence should be closed in the endorsing epic rather than left as
  an accident.
- **The demo board is the user's, not a scratch fixture.** `assets/demo-board` ships with the app
  and its installed copy at `.persephone/boards/Demo` is what the user sees. Back it up before
  modifying it for verification and restore it afterwards, matching EPIC-106's practice.

## Notes

### 2026-09-20

- Epic created as Phase C of the platform roadmap, taken **whole**: all five roadmap items are in
  scope. The argument for taking the whole phase rather than a slice is that its two halves —
  the provider side (items 1-3, 5) and the stream-host side (item 4) — are architecturally
  independent (`stream-host` serves any pipe, including a plain `FileProvider`; `ProxyProvider`
  serves any consumer) but share the manifest work, so splitting would leave `contentProviders`
  and `stream-host` half-declared in one manifest parser across two epics. The genuine overrun
  risk is isolated to US-1474 and handled by sequencing rather than by scope, per Concerns.
- **D1, D3, D4 and D8 all differ from the roadmap's proposal** and each says why in full. D3 is
  the one the user should read first: it is where EPIC-106's unreviewed reversal of the roadmap's
  `permissions` framing would otherwise have been compounded, and it is deliberately the
  unwindable option instead.
- **Finding, 2026-09-20 — the renderer MessagePort lease from Phase B has no service-side
  counterpart in the tree.** Found while reviewing US-1473. `attach-renderer` is only ever *sent*
  (`src/main/module-service-supervisor.ts:400`); the renderer *waits* for the service to post
  `hello` and replies `hello-ack` (`src/renderer/api/module-service.ts:142-160`); and `grep` across
  `src/**` and `assets/**` finds **no handler for `attach-renderer` and no sender of `hello`** —
  not in `assets/module-service-host.mjs` (whose only `parentPort` handler matches
  `storage-response`), and not in `assets/demo-board/scripts/service.mjs` (which owns the rest of
  the parent protocol itself). So `moduleService.acquire()` times out for every board shipping
  today and the lease is unexercised code.

  This is **consistent with EPIC-106 D3**, which said in terms that "a service is not obliged to
  implement that port at all" — so it is not a defect in Phase B. But EPIC-106's recorded evidence
  for a service answering "with no board page open" was the **main-routed** `requestModuleService`
  endpoint (`src/ipc/main/board-handlers.ts`), not the lease, so nothing has ever exercised the
  port. The consequence for this epic: **US-1473 must build the service side of the lease**, not
  reuse it — the host gains `attach-renderer`, the transferred port, the `hello`/`hello-ack`
  handshake and provider dispatch. That is materially more work than "install the delegate", and it
  is why US-1473 is the task most likely to slip after US-1474.

- **Live finding, 2026-09-20, before any code was written:** in a Browser tab, clicking a link to
  an **already-registered** pipeline scheme (`mneme://qa/test.md`, verified through a real
  `editor.click` so the navigation was page-initiated and therefore *not* exempt under
  `browser-service.ts:262-266`) does **nothing at all** — the tab stays on its current document,
  no page opens, and `ui.alerts.list()` stays empty. The roadmap and a code reading both predicted
  "Chromium fails the navigation"; the observable behaviour is a **silent drop** with no error
  surface whatsoever. US-1476 is therefore a fix for a live, user-visible defect, not the
  verification step the roadmap listed, and its acceptance criterion should name the silence.
- Three facts found by reading the source rather than the roadmap changed the plan: the ranged
  read contract already exists on `IProvider` with **no caller**; a complete Range implementation
  already exists in `video-stream-server.ts` and should be extracted rather than rewritten; and
  the `board://` protocol handler **discards the request**, so Range support is a signature change
  at `board-protocol-service.ts:302` rather than a new branch.

### 2026-09-20 — close-out

Six of seven tasks implemented, reviewed and landed in `e1b2e4f2`, `9a9a82bd` and `d4aec07d`.
US-1474 is deferred to Phase E per D11 — the pre-committed abort boundary, taken deliberately
rather than discovered at dawn.

**Verified live over MCP, not inferred from a green build.** The two headline criteria were
observed:

- a page opened on `mem://demo/final.txt` — a scheme and provider type declared **only** in a board
  manifest — returned bytes generated inside the board's `utilityProcess`, **with no board page
  open**, which is the entire purpose of Phase C;
- `persephone.host.streamUrl()` returned `board://<host>/__pipe/<pageId>` and a
  `Range: bytes=0-31` request answered **206** with `Content-Range: bytes 0-31/140` and the correct
  bytes, while a sweep of `<userData>` found **nothing written under `cache/`** — neither the
  `content-host` autosave nor the `ensureContentPath()` materialization.

Also observed: the browser scheme fix (a `mneme://` click that previously did nothing now opens a
page) with its regression guard (`mailto:` and an unregistered scheme raise zero alerts); a valid
board declaration registering while an un-namespaced type and a reserved `https` claim are both
refused with readable reasons; the placeholder round-tripping its original descriptor; and the
service restart budget running to a terminal `failed` state with the reason captured to the board's
`ui.log`, cleared by an explicit `startService`.

**Nine defects were found that typecheck, lint and `build-prod` all passed.** Seven at plan review
and two in live testing. The three worth remembering:

1. **Phase B's renderer `MessagePort` lease was broken, not merely unimplemented.** The supervisor
   put the `MessagePortMain` in the message body as well as the transfer list, so every attach threw
   *"object could not be cloned"*. It was invisible because no service implemented the receiving
   side. Phase C was its first consumer and therefore the first thing able to find it.
2. **US-1471's release step was keyed on the trusted list**, which by definition no longer contains
   an untrusted board — so untrust would never have freed a board's provider and scheme names. This
   is the third revocation-shaped defect in three epics.
3. **US-1476's first plan would have raised a warning alert on every `mailto:` link**, because an
   unregistered scheme forwarded into `openRawLink` reaches Layer 1's file fallback.

`/review` raised three findings at close. Two were fixed: a board losing a provider-type collision
still registered that declaration's **schemes**, which would have pointed its scheme at the winning
board's provider; and a non-null assertion inside the `__pipe` stream `start()` callback, where a
throw surfaces as a broken response body. The third — that a live `ProxyProvider` object survives
untrust — was judged **not a defect**: the supervisor rejects on the lease path
(`module-service-supervisor.ts:467`) and settles requests as `untrusted` (`:339`), so the surviving
object cannot read.

The demo board was backed up before use and restored byte-identically; all test pages, windows and
alerts were cleaned up. Task folders kept, per the standing preference.
