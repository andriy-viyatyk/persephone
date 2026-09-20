# EPIC-108: The capability bus and the in-memory intent channel

## Status

**Status:** Active
**Created:** 2026-09-20
**Roadmap phase:** [Platform roadmap](../platform-roadmap.md) — **Phase D, Capability bus and the
in-memory data channel**

## Overview

Phases A–C built the pipeline half of the platform: registries with the built-ins as their only
registrants (EPIC-105), a Node process the platform owns (EPIC-106), and a board that can be a
data source (EPIC-107). Everything so far moves **content** — a link resolves to bytes, and the
platform picks an editor by file name.

Phase D is the editor half. After this epic a module can ask the platform for **work** rather than
hand it a link: *"edit this image"*, *"render this diagram"*, *"greet this person"* — a named
request with a payload, a result, a deadline and a typed failure, resolved to whichever registered
handler wins on priority. The caller never names a handler. That is the difference between a
bundle of editors and a registry.

This is the **last infrastructure phase**. When it closes, both proofs — Phase E's torrent board
and Phase F's Excalidraw extraction — run against a finished architecture, which was the user's
explicit sequencing decision of 2026-09-19.

## Why this now, and what it unblocks

- **Phase F cannot start without it.** Excalidraw-as-a-board is reached by `image.edit` and
  `diagram.edit` from the image viewer, SVG, Mermaid and the snip tool. Phase A already rewrote
  those call sites to `capabilities.invoke()`, but the registry behind `invoke()` is closed to
  boards, so the board could never win the call. This epic is precisely the missing half.
- **Phase E uses it for `media.play`.** The torrent flow's steps 4–5 are ordinary link
  resolution and need nothing from here (roadmap §3.8); `media.play` matters only when a caller
  has bytes rather than a link, and the audio-player board declares it through this epic's
  manifest axis.
- **Phase A left one question explicitly open for this phase** — whether an `ILinkData.target` may
  name a capability. D2 below answers it.

## What already exists

Verified against the source on 2026-09-20, not taken from the roadmap.

- **`app.capabilities` exists and is closed on every axis.** `src/renderer/api/capabilities.ts`
  is a module-level `Map<string, CapabilityHandler>` seeded once at import from
  `editorRegistry.getAll()`. `CapabilityId` is a **closed union of four ids**
  (`api/types/capabilities.d.ts:2`); there is **no `list()`, no `handlers()`, no priority, no
  version, no origin, no unregister**; `invoke()` is a set of typed overloads and throws a bare
  `Error("Unknown capability: …")` with no failure taxonomy. There is no request id, no deadline
  and no cancellation. So this epic *widens* a service that exists rather than inventing one —
  but almost every property Phase D needs is absent, not merely unpopulated.
- **`app.capabilities` is not agent-reachable.** `scripting/ai-vision/namespaces/index.ts:33-51`
  registers eighteen namespaces and `capabilities` is not among them, so
  `mcp__persephone__call` cannot see it and there is no `namespaces/capabilities.ts`. Roadmap
  §3.1 names agent discovery as a purpose of `list()` ("so an agent or a board can find out what
  the installed set can do"), so the namespace is **in scope here**, not a nicety — and without it
  this epic's own exit criteria would only be reachable through `script.execute`.
- **Nothing in the tree carries a cancel, a call chain or a re-entrancy depth.** The three
  correlation mechanisms that exist — the shim's per-frame numeric ids (`board-shim.ts:246-249`,
  and `rpc()` has **no timeout at all**), the supervisor's `crypto.randomUUID()` request ids
  (timeout but no cancel delivered to the callee), and `renderer-bridge.ts`'s `mcp_<n>_<ts>`
  (timeout, no cancel) — all reject the *caller* locally and abandon the callee. So "a deadline
  delivers `cancel`" is genuinely new protocol, not a wiring job.
- **In-flight board-bridge traffic is not settled on untrust.** The supervisor settles *service*
  requests (`rejectRequests`, `module-service-supervisor.ts:847-853`, reached from `stopRecord`,
  the exit path and quit — EPIC-106's claim verified true), but nothing settles in-flight
  `{kind:"rpc"}` or `{kind:"call"}` board-bridge traffic. The intent bus must bring its own
  settlement rather than inherit one (D9).
- **The built-in registrations are a `capabilities` column on `EditorRow`**
  (`editors/register-editors.ts:140` and rows at `:162-173`), copied onto the registry definition
  at `:231`. Five rows declare eight entries: `text.open → monaco`, `image.edit`/`diagram.edit`
  → `draw-view`, and five `content.view` rows dispatching on `representation`. This is the
  "built-ins are modules too" seam and it stays exactly as it is.
- **`custom-editor-registry.ts` is where a board's declarations become platform registrations,
  and it already does everything this epic needs to copy.** `refresh()` (`:200-300`) re-reads
  every trusted manifest, is guarded by a generation counter against out-of-order overwrites,
  commits registry maps and reactive state **synchronously as one rebuild**, and — critically —
  calls `unregisterBoardProviders(roots)` / `unregisterBoardSchemes(roots)` over the *board-origin*
  set rather than the trusted set. That last detail is EPIC-107's fix for the third
  revocation-shaped defect in three epics; capability registration must hang from the same call,
  not invent a second release path.
- **Untrust already drives that refresh live.** The constructor subscribes
  `boardTrust.subscribePaths(() => void this.refresh())` (`:183-187`), an in-memory reactive
  subscription, not a filesystem watcher. So "untrust frees the registration" is a property of
  joining this rebuild, and "untrust settles in-flight requests" is the part this epic must add.
- **Refusal diagnostics have a home already.** `CustomEditorRegistrationIssue`
  (`custom-editor-registry.ts:104`) carries `{ boardRoot, kind: "provider" | "scheme", name,
  reason, owner? }` and surfaces in Board Info. Adding `"capability"` to that union is the whole
  of this epic's diagnostics work.
- **There are two board channels, and the intent bus belongs on the second one.** The board↔**main**
  `MessagePort` carries `BoardToMain` / `MainToBoard` (`src/ipc/board-bridge-channels.ts:214-229`)
  — rpc, call, fire, runner. The board↔**host renderer** channel is `window.postMessage` with
  `__persephone:` envelopes handled in `BoardWebview.onMessage`, and it is what carries
  `host:content`, shared state, `board:aiVision` and the request/reply pairs that need a `reqId`
  (`board:var`, `board:filePath`, `board:openContent`). A capability handler dispatch is
  renderer→frame and its result is frame→renderer, so it is the host-frame channel's shape, not
  main's.
- **`BoardPortInitMsg`** (`board-bridge-channels.ts:232-256`) is constructed in exactly one place,
  `BoardWebview.transferPort()` (`:264-284`), and already carries seven optional per-open fields
  (`pageId`, `filePath`, `contentHost`, `materialize`, …). The roadmap's `intent` field is an
  eighth of the same kind — this is the extension `content/persephone-board-link.ts:5-9` reserved.
- **The service supervisor is the model for the request lifecycle, and it is a good one.**
  `module-service-supervisor.ts` has typed codes on a `ServiceError` (`:37`), a `requestId`, a
  per-request `deadlineMs` falling back to `SERVICE_REQUEST_DEADLINE_MS`, a
  `MAX_OUTSTANDING_REQUESTS_PER_SERVICE` cap, and untrust settling in-flight requests as
  `untrusted` (`:339`, `:467`, `:475`). `src/ipc/module-service-channels.ts` is the wire-contract
  style to follow: constants, a state union, a code union, message unions, no implementation
  imports. The capability bus gets its own equivalent module.
- **Bridge version is `1.7.0`** (`src/shared/board-bridge-version.ts:2`), and the demo board
  declares `minBridgeVersion: "1.7.0"`, `permissions: ["service", "contentProviders"]`,
  `editorKind: "stream-host"`. Compatibility is enforced at registration
  (`custom-editor-registry.ts:217`), so a board declaring `1.8.0` on an older app registers
  nothing at all rather than half-working.
- **`assets/editor-types/` is a hand-maintained flat copy** with `capabilities.d.ts` already
  listed in `_imports.txt`. Every type change here lands in both trees.
- **Scaffolded boards are auto-trusted by provenance** (`board-scaffold.ts:69-71`, EPIC-035 C5).
  This is what makes the two-board proof reachable without anyone clicking **Trust Board** — see
  D10.

## Goals

- A trusted board declares `capabilities` in its manifest and serves them at runtime; any other
  board, script or agent invokes them **by id**, never by handler.
- The id space is open: a board may declare an id nobody has heard of, or compete for a built-in
  id on priority, and the platform resolves without knowing what the id means.
- Every invocation has a request id, a deadline, and a **typed** outcome. There is no failure mode
  whose observable behaviour is a hung page.
- Discovery never activates: `list()` and `handlers()` answer from the manifest index with no
  handler open.
- Untrust, page close, service crash, cancel, timeout and cycle each settle in-flight requests
  with a distinguishable reason, and free what they held. **This is a first-class design goal, not
  an afterthought** — three of the last three epics shipped a revocation-shaped defect.
- Payloads travelling between modules stay in memory at every hop, and the platform writes nothing
  for the exchange.

## Decisions

**D1 — The capability index is *derived*, not authoritative, so it stays renderer-local; main owns
nothing in this epic. This diverges from roadmap §3.6, and the divergence is argued rather than
convenient.**

Roadmap §3.6 says the capability and scheme registries "must be main-owned with a renderer cache",
reasoning that per-window state makes a trust change in one window invisible in another. That
reasoning is sound for *mutable* state. It does not apply here, because the capability index is a
**pure function of two inputs that are already process-wide**: the built-in `EditorRow` table,
which is identical bytes in every renderer, and the trusted boards' manifests, which every
renderer already re-reads on every trust change through the same `boardTrust.subscribePaths`
subscription (`custom-editor-registry.ts:183`). Two windows therefore compute the *same* index
from the *same* inputs without any broadcast at all, and an untrust in window 1 already updates
window 2's resolution today — that is how EPIC-107's provider registrations behave.

Making main the owner would mean porting `board-manifest.ts` (636 lines of renderer-side parsing
and normalization) into main or duplicating it, to produce an answer both renderers can already
compute. That is the largest single cost in the phase and it buys nothing observable.

What this gives up, stated plainly: **there is no cross-window routing.** An invocation is
resolved and served in the *caller's window* (D3). If a future phase genuinely needs a request in
window 1 answered by a live handler page in window 2 — the only case this design cannot express —
the change is a main-side routing table keyed by `(boardRoot, windowIndex)` plus a forwarding
envelope; the registry itself still needs no migration, because the index is derived either way.
Recorded so that choice is available rather than foreclosed.

`registryChanged(kind)` (§3.6) is therefore **not built** in this epic. It remains new work for
whichever phase first owns state that is genuinely main-resident.

**D2 — A link may not name a capability. `ILinkData.target` stays the pipeline's seam.**

This is the question EPIC-105 explicitly deferred to Phase D ("whether a link may name a
capability is a Phase D question"), and the answer is no.

A link resolves to **content**: it has a URL, a pipe and an editor chosen by name or mime, and the
open either happens or fails. A capability is a **request**: it has a typed payload, a result value
travelling back to the caller, a request id, a deadline, a cancellation path and a re-entrancy
depth. A link has nowhere to put any of those, and nowhere to receive a result. Letting `target`
carry a capability id would create two resolution orders for one open — editor-by-mask and
handler-by-priority — with no rule for which wins, and it would make the 15 existing `target`
call sites (which EPIC-105 deliberately left alone) silently ambiguous.

The two stay adjacent and composable instead: a capability handler that wants to open content
calls the pipeline, and the pipeline that wants a result calls a capability. Where they genuinely
meet is the built-in `text.open` / `content.view` handlers, which already do exactly this.

**D3 — A request is resolved and served in the caller's window; the platform prefers an open
handler page in that window and otherwise opens one there.**

Roadmap §3.1 says handlers "are process-wide; the request is routed by main, so caller and handler
may live in different windows", and separately that a UI capability opens "in the caller's window".
Those two sentences conflict once a handler page is already open elsewhere. Resolved in favour of
the caller's window, for three reasons: an intent that opens a UI is something the user is about to
look at, and stealing focus to another window is a worse outcome than a second page; boards already
support multiple pages, so a second page is a normal state, not a workaround; and it is the only
rule that needs no main-side handler table, which is what D1 rests on.

Concretely, `invoke()` resolves in this order: (1) the winning handler already has a page open in
the caller's window → dispatch to it and activate it; (2) otherwise open a page for the winning
handler in the caller's window, carrying the request as `intent` on `BoardPortInitMsg`, and await
its `resolve`/`reject`; (3) a *headless* handler — a board whose winning declaration sets
`"headless": true` — is **out of scope** here and rejects with `no-handler`, because a headless
handler is a service request and EPIC-106 already routes those; wiring the two together is Phase E
work at the earliest.

**D4 — Registration rules, stated once so every later phase can rely on them.**

- **Resolution is strict numeric priority, built-ins win ties** — the same rule EPIC-103 D3 set
  for file masks and EPIC-107 inherited. Default priority is 50 for a board declaration and 50
  for a built-in; on an exact tie a `platform` origin outranks a `board` origin, and two boards
  tied resolve in trusted-list (registration) order, which is `custom-editor-registry`'s existing
  `entries` order. Every losing candidate stays visible in `handlers(id)`.
- **Coexistence, not collision.** Two boards may declare the same id; they compete on priority and
  both appear in `handlers()`. This is deliberately *unlike* EPIC-107 D2's one-owner rule for
  schemes and provider types, and the difference is principled: a scheme is a **namespace** —
  two owners of `torrent://` means one link has two meanings — whereas a capability is a
  **service** and "two image editors" is the feature, not the bug.
- **A board re-declaring its own id replaces its own entry only**, which falls out of the full
  rebuild in `refresh()`.
- **Built-in ids cannot be removed by a board, only outranked.** Nothing in the rebuild touches
  the `platform`-origin entries, so this needs no check — it is a property of seeding built-ins
  from a separate source.
- **Versioned ids.** Each declaration carries an optional `version` (a major integer, default 1).
  A caller may pin with `invoke("image.edit@1", …)`; an unpinned call matches any version, highest
  priority first. A handler declaring `@2` does not satisfy a `@1` call. The `@` suffix is parsed
  at the bus boundary and is **not** part of the stored id, so `list()` reports `id` and `version`
  as separate fields.
- **The registry validates nothing about the id but its shape** (non-empty, no whitespace, no
  `@`). Built-in ids use bare `noun.verb`; the authoring guide *recommends* a vendor prefix for
  board-defined ids and the platform does not enforce it, per roadmap §3.1.
- **Refusals are readable.** A malformed declaration is refused with a reason through the existing
  `CustomEditorRegistrationIssue` path, extended with `kind: "capability"`, and shows in Board
  Info — not only as a toast.

**D5 — The failure taxonomy is closed, and every reason is reachable by an observable action.**

`CapabilityErrorCode` is a closed union, mirrored from `ServiceError`'s shape:

| Code | Raised when |
|---|---|
| `no-handler` | No registered declaration matches the id (and version, and `accepts` filter) |
| `untrusted` | The winning handler's board was untrusted — at resolution, or in flight |
| `handler-closed` | The handler page was closed or its frame disposed before resolving |
| `crashed` | The handler frame errored or its board was reloaded mid-request |
| `cancelled` | The caller called `cancel()`, or the caller's page closed |
| `timeout` | The deadline elapsed; a `cancel` is delivered to the handler regardless |
| `cycle` | The resolved handler already appears in the request chain, or depth exceeded |
| `payload-too-large` | The payload exceeds `MAX_INTENT_PAYLOAD_BYTES` (see D7) |
| `rejected` | The handler itself called `intent.reject(…)`; carries the handler's message |

A code with no observable trigger is a code nobody can test, so each one is an exit criterion
below. `timeout` in particular **does not pretend the work stopped**: the platform stops waiting,
delivers `cancel` to the handler, and says so in the authoring guide, because an agent will retry
(roadmap §3.1).

**D6 — Re-entrancy is bounded by the *chain*, not only by a depth number, and the chain is
page-scoped.**

Each request carries `chain: string[]` — the handler keys it has already passed through — and
`depth`. Resolution rejects with `cycle` if the winning handler is already in the chain, or if
`depth >= MAX_INTENT_DEPTH` (8). Carrying the chain is strictly better than a depth limit alone:
A → B → A is caught on the *first* re-entry with an accurate reason, rather than after eight
bounces.

The chain is attached to the **page**, not to an async continuation: a page's current chain is
that of its most recent **unsettled** inbound intent, and any `invoke()` from that page inherits
`chain + [handler]`, `depth + 1`. A page with no unsettled inbound intent invokes at depth 0. This
is observable and has no false negatives for the cycle case. Its one imprecision is recorded
rather than hidden: a handler that invokes something *unrelated* while its own request is still
open inherits the chain, so a genuinely unrelated call could be refused as `cycle` if it happened
to land back on the same board. The alternative — per-continuation tracking through
`postMessage` — is not expressible without an async-context mechanism the frame does not have.

**D7 — Payloads travel inline by structured clone with a hard cap; the `DataHandle` store is
deferred to Phase F with a stated trigger. This is this epic's pre-committed abort boundary and it
is being declared before any code is written.**

Roadmap §3.1a has two halves. The **inline** half — "small and medium payloads travel inline …
structured-clone the payload from the caller's port into main, then into the handler's port" — is
built here, and D1 makes it *better* than the roadmap describes: because the bus is renderer-local,
a board-to-board payload is one structured clone each way **inside a single renderer process** and
never enters main at all. Fewer hops, same promise, and the "no disk" property is a broker policy
stated honestly (it is not an OS guarantee — memory can be paged; the authoring guide says so).

The **large-payload** half — a `DataHandle` id for bytes held in main-process memory,
`persephone.data.{read, stream, forward}`, reference-counted forwarding, credit-based chunking,
per-request/per-board/global caps and store size in `boards.list()` — is **not** built. It is a
second protocol of roughly US-1474's size, its threshold is explicitly "to be measured, not the
8 MB guess a first draft carried", and **it has no consumer in this epic**: nothing that ships here
moves more than a diagram source or an image data URL.

Instead of leaving the gap silent, the inline path is **capped and typed**:
`MAX_INTENT_PAYLOAD_BYTES` (8 MiB, matching the order of magnitude the provider path already
uses for `MAX_BUFFERED_PIPE_BYTES`) with a `payload-too-large` rejection naming the limit. A
future handle store then *raises* a documented ceiling rather than fixing a silent truncation.

**Deferral trigger, so it is not forgotten:** Phase F is the first real consumer — Excalidraw's
`image.edit` carries a data URL whose size is bounded by the user's canvas, and the snip-tool
integration hands it a screenshot. If Phase F measures a single `image.edit` payload above the cap
in ordinary use, or measures a clone cost above ~50 ms at the 95th percentile, the handle store
becomes a task in that epic. Until then it is unbuilt, not assumed — and EPIC-107 D9 already said
in terms that its credit-based provider frames are *not* this channel and must not be inherited by
assumption.

**D8 — `capabilities` is a manifest axis disclosed in `permissions`, with the functional trigger
being the array. This holds EPIC-107 D3's line exactly, and deliberately does not extend
EPIC-106 D1.**

EPIC-106 D1 reversed the roadmap's framing of `permissions` (disclosure and lifecycle hygiene, not
a security boundary) and that reversal **is still unreviewed by the user**. EPIC-107 D3 chose not
to compound it: `contentProviders` is listed in `permissions` and shown in the trust dialog, but
the platform acts on the manifest *array*, not on the permission string — so whichever way the user
decides, the change is one conditional.

This epic holds that line without variation. `"capabilities"` appears in `permissions`, in the
trust dialog and in Board Info; the platform registers a board's handlers because the
`capabilities` **array** is present. One declaration, one meaning, no way to half-declare, and
nothing here becomes load-bearing on a provisional decision. If the trust-model merge (roadmap §5)
makes `permissions` a real boundary, the check is one conditional at the registration site in
`custom-editor-registry.refresh()`.

**D9 — Revocation and teardown are designed first, not patched later.**

Three consecutive epics shipped a revocation-shaped defect — B's trust-snapshot generation resetting
on renderer reload, C's name release keyed on the trusted list (which by definition excludes an
untrusted board), and both were caught only by live testing. So the settlement rules are part of
the contract, each with its own exit criterion:

- **Untrust.** `boardTrust.subscribePaths` fires → `refresh()` rebuilds → capability entries are
  dropped over the **board-origin set**, never the trusted set (the exact shape of EPIC-107's fix)
  → every in-flight request whose handler belongs to that board settles `untrusted` → its page's
  pending intent is released. A board untrusted mid-request must settle it, not merely stop
  answering.
- **Handler page closed / frame disposed.** Settles `handler-closed`. The page-scoped chain of D6
  is released with it.
- **Caller page closed.** Settles `cancelled` and delivers `cancel` to the handler, because the
  result now has nowhere to go.
- **Deadline.** Settles `timeout` *and* delivers `cancel`.
- **At-most-once.** The platform never re-delivers a request. A handler needing idempotency keys
  on the request id, and the authoring guide says so.
- **No pending map outlives its owner.** The pending-request table is keyed by request id and
  swept on every one of the above; a request that settles twice is a no-op, never a double
  resolve.

**D10 — Verification is live through MCP, and no exit criterion requires granting trust.**

Nineteen defects across EPIC-105/106/107 passed typecheck, lint and `build-prod`. Every criterion
below is written as an observation an agent can make against the running app.

The shipped fixture is `assets/demo-board`, which this epic extends. **The user's installed copy
at `.persephone/boards/Demo` is not touched at all**, which is a change from EPIC-106/107 practice
and strictly safer: that folder turns out to be a *stale scaffold* of an older `assets/demo-board`
(verified — it has no `scripts/`, no `contentProviders`, and a manifest predating Phase B), so
modifying it would have meant editing the user's board to make it resemble a template it no longer
matches. Its checksums are recorded before the run and re-checked after, as proof of
non-interference rather than as a backup.

Every board needed *live* is instead **scaffolded at verification time** from the updated
template, which is auto-trusted by provenance (`board-scaffold.ts:69-71`, EPIC-035 C5 — Persephone
trusts boards it *created*, and `boards.createDemoBoard` scaffolds from `assets/demo-board`), used,
then untrusted and deleted. This covers both the handler fixture and the second board the
board-to-board criterion needs. It is not an agent granting trust on the user's behalf; it is the
one auto-trust path the platform already has, it exercises the *shipped* template bytes rather than
a hand-edited copy, and it leaves nothing behind. The roadmap's proposal to *ship* a second fixture
board is rejected for the same reason it was here: a shipped board the user has never trusted
proves nothing an agent can observe.

## Scope: what this epic does NOT do

| Deferred | To | Why |
|---|---|---|
| `DataHandle` store, `persephone.data.{read,stream,forward}`, ref-counted forwarding, credit-based `stream()` | **Phase F**, on a measured trigger | D7 — no consumer here; the inline path is capped and typed instead |
| Cross-window routing of a request by main; `registryChanged(kind)` | Whichever phase first owns genuinely main-resident state | D1 — the index is derived, so both windows already agree |
| Catalog indexing of capability ids; the "install a board that provides this" entry for `no-handler` | Phase E / the storefront | No published board declares a capability until Phase E; indexing an empty set is untestable |
| `payloadSchema` **validation** | The handler, permanently | Roadmap §6 — the platform stores and surfaces the schema; enforcement stays with the handler |
| Headless (service-backed) capability handlers | Phase E at the earliest | D3 — EPIC-106 already routes service requests; joining the two needs a consumer |
| A built-in `media.play → video-view` registration | Phase E | Phase E's audio-player board declares it; a built-in registration would be guessing at a payload contract with no caller |
| Granted-permission record, *changed grant* re-prompt | The trust-model merge (roadmap §5) | Inherited from EPIC-106 D1; D8 deliberately does not extend it |
| US-1474 (ranged streaming into a board provider), US-1478 (download routing) | Phase E | Already on the dashboard under Planned; neither belongs to the bus |

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1479 | `capabilities` manifest axis, the widened registry, board-origin registration, and the `capabilities` AiVision namespace | Planned |
| US-1480 | Request lifecycle: ids, deadlines, typed rejections, cycle detection, revocation settling | Planned |
| US-1481 | Bridge: `intent` on `BoardPortInitMsg`, `persephone.intent.*` and `persephone.capabilities.*` | Planned |
| US-1482 | Demo-board fixture, authoring guide and architecture documentation | Planned |

Order, chosen so parallel sessions never touch one file:

- **Wave 1** — US-1479 alone. It owns **every** manifest change in the epic
  (`board-manifest.ts`), the registry widening (`api/capabilities.ts` types and the index), the
  board-origin registration and release in `custom-editor-registry.ts`, the Board Info / trust
  dialog disclosure, and the new `capabilities` AiVision namespace that makes every later
  criterion observable over MCP. It also lands the **transport interface** that US-1481
  implements, so wave 2 can run in parallel.
- **Wave 2** — US-1480 (the lifecycle module + `invoke()`, renderer-side only) and US-1481 (the
  bridge, shim and `boards.openBoard`) in parallel. They meet only at the interface US-1479
  defined.
- **Wave 3** — US-1482 (fixture + docs), which exercises all of the above.

### The seam between US-1480 and US-1481, pinned here so both can be written at once

US-1479 defines, in `src/ipc/capability-bus-channels.ts` (wire-contract style, no implementation
imports — modelled on `module-service-channels.ts`):

- the constants `MAX_INTENT_PAYLOAD_BYTES`, `MAX_INTENT_DEPTH`, `INTENT_DEADLINE_MS`,
  `MAX_OUTSTANDING_INTENTS_PER_HANDLER`;
- `CapabilityErrorCode` (the D5 union), `CapabilityOrigin = "platform" | "board" | "script"`;
- `CapabilityDeclaration { id, version, priority, accepts?, payloadSchema?, title?, headless? }`;
- `CapabilityRegistration` = declaration + `{ handlerKey, origin, boardRoot? }`;
- `IntentRequest { requestId, id, version?, payload, chain, depth, deadlineAt }` and
  `IntentSettlement { requestId, result? , error?: { code, message } }`.

US-1480 owns the bus (`src/renderer/api/capabilities.ts` + a new
`src/renderer/api/capability-bus.ts`) and consumes a `CapabilityTransport` it does **not**
implement:

```ts
interface CapabilityTransport {
    /** Dispatch to a board handler; resolves when the board settles, rejects with a typed code. */
    dispatch(registration: CapabilityRegistration, request: IntentRequest): Promise<unknown>;
    /** Best-effort cancel for a request already dispatched. Never throws. */
    cancel(registration: CapabilityRegistration, requestId: string): void;
    /** The chain/depth currently in force for a page, for D6. 0-length when idle. */
    chainForPage(pageId: string | undefined): { chain: readonly string[]; depth: number };
}
```

US-1481 registers the board implementation of `CapabilityTransport` at startup. The built-in
(`platform`-origin) handlers keep their current direct-call shape and do not go through the
transport at all.

## Exit criteria

Each is an observation, per D10.

1. A board declaring `capabilities: [{ "id": "demo.greet", "version": 1, "priority": 60 }]` has
   that registration visible in `app.capabilities.list()` **with no board page open**, and
   `handlers("demo.greet")` names it — discovery without activation.
2. `invoke("demo.greet", { name: "…" })` from a **script** opens the handler board's page, the
   board's `persephone.intent.onRequest` receives the payload structurally (an object, not a JSON
   string), calls `resolve(value)`, and the caller receives `{ pageId, result }` with `value`
   intact including a `Uint8Array` field.
3. A **second, scaffolded board** invokes `demo.greet` on the demo board through
   `persephone.capabilities.invoke` from its own frame, and gets the same result — the board-to-board
   hop, which is what the bus exists for.
4. The same invocation made from a **second window** (`openNewWindow`) resolves, opening the
   handler page **in that window** (D3), while the first window's pages are untouched.
5. Each failure code of D5 is produced by an observable action and carries the right code:
   `no-handler` (unknown id, and a pinned `@2` against a `@1` handler), `timeout` (a handler that
   never resolves — and the handler observes the delivered `cancel`), `cancelled` (caller cancels),
   `handler-closed` (handler page closed mid-request), `untrusted` (handler's board untrusted
   mid-request), `cycle` (A → B → A), `payload-too-large` (a payload over the cap),
   `rejected` (handler calls `reject`).
6. **Untrust settles, not just stops.** With a request in flight, untrusting the handler board
   settles that request as `untrusted` *and* removes its registrations from `list()` in **both**
   windows, and re-trusting restores them without an app restart.
7. Priority resolves as D4 states: a board declaring `image.edit` at a priority above the built-in
   `draw-view` is chosen by the image viewer's **Edit** action, at a priority below it is not, and
   in both cases the loser is still listed in `handlers("image.edit")`.
8. A malformed declaration (empty id, an id containing `@`, a non-integer version) is refused with
   a readable reason visible in Board Info as `kind: "capability"`, and the board's **other**
   declarations still register — the failure is per-declaration, not per-board.
9. A `<userData>` watcher records **no new file** across criteria 2–5 — the payload never touches
   disk (D7).
10. `app.ui.alerts.list()` is empty at the end of the run; every scaffolded board is untrusted and
    deleted; `.persephone/boards/Demo` matches its recorded checksums exactly (D10 — it is never
    modified); every test page and the second window are closed; the user's three pinned pages are
    untouched.
11. `npm run typecheck`, `npm run lint` and `npm run build-prod` pass.

## Concerns

- **US-1481 is the task most likely to overrun.** The host-frame channel is request/reply in one
  direction today (`board:var`, `board:openContent` — frame asks, renderer answers). An intent
  dispatch is the *reverse*: renderer asks, frame answers. That direction exists only for
  fire-and-forget messages (`host:content`, state sync), so the correlated reverse call is new
  protocol. If the epic has to stop early it stops after wave 2's US-1480, with the bus, the
  registry and the built-in handlers complete and board handlers deferred — a coherent slice,
  because Phase A's four built-in ids already flow through `invoke()`.
- **The page-scoped chain of D6 is the design's weakest joint** and is recorded as such. Its
  failure mode is a false `cycle`, which is loud and recoverable, rather than an undetected loop,
  which is not. That asymmetry is why it was chosen.
- **`invoke()` changing shape is a breaking change to a shipped surface.** Phase A's `invoke()`
  has typed overloads over a closed union and eight internal callers. Widening `CapabilityId` to
  `string` must keep those eight call sites type-safe — the overloads stay and a general
  `(id: string, payload: unknown, opts?)` signature is added beneath them, not instead of them.
- **The trust dialog is the one surface an agent cannot fully verify**, since clicking **Trust
  Board** is the user's decision. Its new `capabilities` rows are confirmed through the AiVision
  facade, as EPIC-106 did for `permissions`, and anything left unproven goes to *Needs user
  verification*.
- **The demo board is the user's, not a scratch fixture.** D10 handles this by never touching the
  installed copy and scaffolding throwaways from the template instead. Any board a delegated
  session creates behind our back is ours to find and remove too — EPIC-107 found one.

## Notes

### 2026-09-20

- Epic created as Phase D of the platform roadmap, taken as a **slice** rather than whole. The
  slice boundary is D7 (the `DataHandle` store), argued in the document **before any code was
  written**, copying what EPIC-107 did well with its D11.
- **Four decisions diverge from the roadmap** and each says why in full: D1 (no main-owned
  registry), D2 (a link may not name a capability — the question Phase A left open), D3 (caller's
  window, resolving a conflict inside §3.1), and D7 (the handle store deferred). D8 is the one
  that deliberately changes *nothing*: it holds EPIC-107 D3's line so that EPIC-106's unreviewed
  D1 reversal is not compounded for a third epic running.
