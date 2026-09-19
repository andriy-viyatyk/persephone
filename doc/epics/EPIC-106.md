# EPIC-106: Bridge contract and the module service process

## Status

**Status:** Active
**Created:** 2026-09-20
**Roadmap phase:** [Platform roadmap](../platform-roadmap.md) — **Phase B, Bridge contract and the
module service process**

## Overview

Phase A ([EPIC-105](EPIC-105.md)) built the registries with the built-ins as their only
registrants. Phase B builds the two things every later phase assumes exist:

1. **A way for a board to say what it needs** — a declaration surface on the manifest, disclosed
   to the user at trust time and visible in Board Info, plus a bridge version a board can require.
2. **A place for a board's Node code to run under platform control** — an Electron
   `utilityProcess` the platform starts, supervises, restarts within a budget and stops on
   untrust, reachable from the renderer without any board page being open.

The second is the load-bearing one. Phase C's `ProxyProvider` talks to a service port directly,
which is the entire reason a `torrent://` link can open in Monaco with the torrent board's page
closed. Nothing in Phase C can be written until a service process exists and has a lifecycle.

## Why the service process is the spine

Today a board's only route to Node is `persephone.executeNode(script, args)`, which is a child
process tied to a live board **frame** (`src/main/board-bridge.ts:321-347` — `RunnerChannel.start`
with `node: true` re-spawns `process.execPath` under `ELECTRON_RUN_AS_NODE` with
`cwd = board root`). That covers "this board's page wants to run a script". It cannot cover
"the platform needs bytes from this board while none of its pages are open", which is the shape
of every pipeline contribution in Phase C.

The gap is not capability — it is **ownership of the lifecycle**. `executeNode` jobs are started
by the board and die with its frame. A service is started by the *platform*, on trust, and the
platform is answerable for its health.

## What already exists

Verified against the source on 2026-09-20.

- **The manifest is a single flat interface** with 20 optional fields
  (`src/renderer/editors/board/board-manifest.ts:39-180`), every capability-bearing one carrying
  the same comment: *"Honored only when the board is TRUSTED."* New axes follow that pattern
  exactly — a new optional field plus a normalizer, which is how EPIC-100 and EPIC-103 added
  theirs.
- **`minAppVersion` already exists** (`board-manifest.ts:64`, EPIC-045) as a per-version
  app-compatibility gate, with the catalog update comparison built around it. A bridge-version
  gate reuses that machinery rather than inventing a second one (D2).
- **Trust is a line-delimited list of bare absolute paths** at
  `<userData>/data/trustedBoards.txt` (the module's own header comment says
  `<userData>/persephone/data/…` and is wrong; `fs.ts:33` joins `userData` + `data`) (`src/renderer/api/board-trust.ts:1-131`).
  There is no per-board record of anything — no grant, no timestamp, no manifest hash. Trust is
  also **ancestor-inherited** (`pathCovers`, EPIC-036): a board is trusted when it *or any
  ancestor folder* is registered, so a board nested under a trusted project folder has never had
  a dialog shown for it at all. This shapes D1 decisively.
- **Trust already implies arbitrary code execution.** `persephone.execute()` is RCE by the
  trust gate's own documentation (`board-trust.ts:2-4`), and `executeNode` spawns Node from the
  board folder with no declaration of any kind. Nothing a `permissions` axis could gate is a
  privilege the board does not already hold the moment it is trusted.
- **`utilityProcess` is not used anywhere in the tree.** `grep -rn "utilityProcess" src/` is
  empty, so the Electron API is greenfield — but *supervision* is not:
  `src/main/sidecar-process.ts` (350 lines) already runs `tor.exe` and `mneme.exe` with start
  dedupe, readiness timeout, stale-child guard and restart. The supervisor follows it (D4).
- **The main-owned key/value store is main-owned but not broadcast.**
  `src/main/ui-preferences.ts` is 75 lines and is the roadmap's named model for per-board storage;
  its renderer half snapshots once and never hears another window's write
  (`src/renderer/api/ui-preferences.ts:41-47`). Broadcast, where needed, comes from
  `openWindows.send()` (`src/main/clipboard-service.ts:161-171`) and is new work (D6).
- **`boards.list()` reports `root`, `name`, `description`, `trusted`, `installed`,
  `openPageIds`** (observed live over MCP, 2026-09-20). A `service` status is a new field on that
  same entry.

## Goals

- A board declares a Node **service** in its manifest; the platform starts it in a
  `utilityProcess` when the board is trusted, supervises it, and stops it on untrust.
- Service health is **observable**: every state the supervisor can be in is reported by
  `boards.list()` and shown in Board Info, including *why* a stopped service stopped.
- A crash loop is bounded by a restart budget and reported, not retried forever.
- The renderer can send a request to a service and get a reply **with no board page open**.
- A board declares what it needs (`permissions`) and what bridge surface it requires
  (`minBridgeVersion`); both are disclosed to the user before trust and listed in Board Info.
- A board — and its service — has somewhere to keep state that is not page state.
- Every existing board keeps working untouched. No manifest field added here is required, and
  no existing trust record is invalidated.

## Decisions

**D1 — `permissions` is a disclosure and lifecycle axis, not a security boundary, and it carries
no grant record in this epic.**

This is the epic's central scope decision and it reverses the roadmap's framing, so the reasoning
is recorded in full.

The roadmap (§3.7) proposes that the manifest declare `permissions`, that the trust dialog grant
them *together with* trust, and that a later version adding a permission be shown as a *changed
grant* on update rather than inherited. That reads as a security model. It cannot be one here,
for two independent reasons:

1. **Trust already grants strictly more than any permission in the list.** A trusted board runs
   arbitrary renderer code (`persephone.execute()`) and spawns arbitrary Node from its own folder
   (`executeNode`, `board-bridge.ts:333`). A board that wanted a background Node process without
   declaring `service` can start one today and keep it alive with `setBoardBusy()`. Gating
   `service` behind a permission therefore stops nothing; presenting it to the user as though it
   does is security theater, and worse than nothing because it teaches the dialog is meaningful.
2. **There is nowhere to record a grant, and inherited trust means there may be no board to
   record it against.** The trust file is a list of bare paths, and trust is ancestor-inherited.
   A grant record therefore needs either a format change to a deliberately human-readable file or
   a sidecar keyed on a path that, for a nested board, was never the subject of a dialog. Both are
   trust-model redesigns. The roadmap already has the right home for that work: §5's *"merge board
   and toolset trust models — two files, two semantics (ancestor vs exact) for one user decision"*.

So in this epic `permissions` is honest about what it is:

- **Disclosure.** The trust dialog lists what the manifest declares, so the user sees "this board
  runs a background service" *before* trusting. Today the dialog shows the board **path and
  nothing else** (`src/renderer/ui/dialogs/TrustBoardDialogView.ts:26-40`; its props are
  `{ boardPath }` alone) — it reads no manifest at all. So this is not a field added to an
  existing list; it is the first manifest content the dialog has ever shown, and it needs the
  manifest threaded into three trust call sites.
- **Lifecycle hygiene.** The platform refuses to start a service for a board that did not declare
  `"service"` in `permissions`. This is not a security gate — it is the same kind of rule as
  `editorSources` being default-closed: an undeclared board gets the clean fallback rather than a
  surprising behavior.
- **A forward contract.** Phase C's `contentProviders` and Phase D's `capabilities` declare
  themselves through the same axis, so those phases add a value to a list rather than a mechanism.

**Deferred to the trust-model merge, and recorded in the roadmap:** the granted-permission record,
the *changed grant* re-prompt on catalog update, and per-board consent under inherited trust. A
phase that wants `permissions` to be a boundary must first make trust per-board and recorded; that
is a prerequisite, not a detail.

**D2 — `minBridgeVersion` is a distinct axis but reuses `minAppVersion`'s incompatible-listing
machinery.**

Two version axes look redundant and the temptation is to fold the bridge into `minAppVersion`.
They are not the same thing: the app version says nothing about the API surface, and the shim
version (`persephone.version`, `"1.5.0"`) is precisely the number boards already feature-detect
on. A board that needs `persephone.storage` needs *a bridge that has it*, not an app version it
would have to look up. Keeping them separate also lets the bridge number move slowly and
meaningfully while the app version moves on every release.

What is **not** duplicated is the machinery. EPIC-045 already compares `minAppVersion` and marks a
board incompatible; `minBridgeVersion` becomes a second comparison feeding the same *incompatible*
state and the same listing, not a parallel path. An incompatible board is listed with the reason
and does not register its editors — it is not silently half-working.

The bridge version moves to **`1.6.0`** in this epic, because the epic adds members
(`persephone.storage`, `persephone.service`) and adds nothing breaking.

**D3 — The service gets a port to the renderer, not to the board frame. The frame talks to its
service through an ordinary bridge call.**

The roadmap (§3.5 option B) says the platform hands the service *two* `MessagePort`s: one to the
renderer and one to the board's frame(s). The frame port is dropped from this epic, deliberately:

- The frame port cannot be direct anyway. The roadmap itself notes it "still has to hop through
  the host renderer, as the bridge does today (`board-bridge.ts:467-502`)". So it buys no hop.
- It buys no transport either. §3.1a establishes that a board-to-board hop is board → main →
  board and crosses a process boundary regardless; structured clone through main is the intended
  shape, not a compromise.
- It costs a second port-transfer path, a second lifecycle to tear down on frame dispose, and a
  second place for a leak, for a board page talking to its own service — which is the *least*
  important direction, because the whole point of a service is that it works with no page open.

The frame therefore gets `persephone.service.request(message)` — a request/response bridge call
routed through main to the service, on the channel that already exists. The renderer gets the
real port, because that is the one Phase C needs.

**D4 — The supervisor owns restart; the service never restarts itself.**

Electron provides `utilityProcess.fork`, port transfer, and *nothing else* — no quotas, no
restart, no supervision (roadmap §3.5). All of it is ours — but not from scratch:
`src/main/sidecar-process.ts` (350 lines) already supervises `tor.exe` and `mneme.exe` with
in-flight start dedupe, a readiness timeout, a stale-child guard on `close`, unexpected-death
notification and stop-before-restart. It is the closest existing analogue and the supervisor
should follow its shape rather than invent a second one. The rules:

- **Start** on trust, or on first use if the board was already trusted at launch. **No service
  starts at launch merely because a board is installed** — §6's startup-cost constraint. A board
  declaring `service` starts its service lazily, on the first request or on explicit start.
- **Handshake with a deadline.** The service must post a `ready` frame within a timeout or it is
  killed and treated as a failed start. This mirrors the frame handshake watchdog the bridge
  already runs (`board-bridge.ts`, `entry.watchdog`).
- **Restart budget:** three failures within sixty seconds stops the service in a terminal
  `failed` state with the reason retained. Not a silent give-up, and not an infinite loop. A user
  or agent action restarts it explicitly and resets the budget.
- **Stop on untrust, immediately**, along with every in-flight request rejected as *untrusted*.
  Untrust is the revocation mechanism the trust gate promises and it must actually revoke.
- **Concurrency cap** on outstanding requests per service; beyond it, requests reject rather than
  queue unboundedly. The shim's existing unbounded pre-connection queue
  (`board-shim.ts:227-233`) is explicitly not the model (§3.1a).

**D5 — Service failure is a first-class, readable state, not a log line.**

The phase's exit criterion is that each lifecycle state is *visible in `boards.list()`*. So the
status is a structured value — state plus reason plus restart count — not a boolean. This is what
makes the epic verifiable by an agent over MCP rather than by watching a terminal, and it is the
same reasoning that made `app.ui.alerts` worth building in US-1464.

**D6 — `persephone.storage` is per board root, and the service shares it with the frame.**

The roadmap leaves open whether a service inherits the UI board's storage ("Services do not
inherit the UI board's storage or permissions by default; the manifest grants them separately").
Decided: **they share it.** A service and its board are one module with one identity and one trust
decision; a separate storage grant would be a boundary between two halves of the same thing, and
D1 has already established that such boundaries are not real while trust implies RCE. The
simplicity is worth more than a separation that nothing enforces.

Storage is a folder under `<userData>/data/board-storage/<board-key>/` plus a JSON key/value store
built on `src/main/ui-preferences.ts`'s pattern. **That pattern is main-owned but it is *not*
broadcast** — each window snapshots once in `src/renderer/api/ui-preferences.ts:41-47` and never
learns of another window's write. The roadmap calls `ui-preferences` the model for §3.6's
broadcast registries, which overstates it. Cross-window broadcast therefore has to come from the
`openWindows.send()` pattern (`src/main/clipboard-service.ts:161-171`) and is **new work, not
copied work** — budget it as such, or scope the store to last-write-wins within a window and say
so. The board key is derived
from the board root, not from the manifest `name`, because `name` is author-controlled, optional
and mutable, and two boards may share one.

**D7 — No in-flight *capability* settling here.** The roadmap's "untrust settles in-flight work"
is about capability-bus requests, which do not exist until Phase D. What this epic settles on
untrust is the service's own outstanding requests (D4). Recorded so Phase D does not assume the
work was done.

**D8 — Verification is live, through MCP, not a green build.** EPIC-105 closed with two defects
that typecheck, lint and build all passed. Every exit criterion below is written as an observation
an agent can make against the running app.

## Scope: what this epic does NOT do

Stated plainly so the roadmap stays honest:

| Deferred | To | Why |
|---|---|---|
| Granted-permission record; *changed grant* re-prompt on update; per-board consent under inherited trust | The trust-model merge (roadmap §5) | D1 — needs trust to be per-board and recorded first |
| Direct `MessagePort` from service to board frame | Not planned; revisit only if a measurement demands it | D3 — no hop and no transport saved |
| In-flight capability-request settling on untrust | Phase D | D7 — no capability bus yet |
| `ProxyProvider`, `contentProviders` behavior, ranged streaming | Phase C | The `permissions` value is declarable here; nothing consumes it |
| `network` permission / `persephone.fetch` | After the roadmap | Declarable, inert |

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1466 | `permissions` and `minBridgeVersion` manifest axes, disclosed at trust and in Board Info | Planned |
| US-1467 | Module service process: `utilityProcess` host, handshake, restart budget, untrust shutdown | Planned |
| US-1468 | Service surface: status in `boards.list()`, renderer port, `persephone.service.request` | Planned |
| US-1469 | `persephone.storage` — per-board folder and key/value store | Planned |
| US-1470 | Demo board service fixture and the authoring-guide documentation for every new axis | Planned |

Order: US-1466 and US-1469 are independent of the service work and of each other, so they run in
parallel with US-1467. US-1468 depends on US-1467 (there is no status without a supervisor) and on
US-1466 (the `service` permission gate). US-1470 is last by construction — it documents and
exercises what the other four built.

## Exit criteria

Each is an observation, per D8.

1. The demo board declares a `service`; trusting it and issuing one request starts the service,
   and `boards.list()` reports it `running` with a pid and a start time.
2. The service answers a request issued from the renderer **with no board page open**.
3. Reloading the renderer leaves the service running — it is owned by main, not by a window —
   and the reloaded renderer can still reach it.
4. Untrusting the board stops the service within the shutdown timeout, `boards.list()` reports it
   `stopped` with reason `untrusted`, and an in-flight request rejects as *untrusted* rather than
   hanging.
5. A service that exits on purpose is restarted; doing it three times inside a minute leaves it in
   `failed` with the restart count and the last reason readable from `boards.list()`.
6. A service that never posts its `ready` frame is killed at the handshake deadline and reported
   as a failed start, not left occupying a slot.
7. A board declaring `service` but **not** listing `"service"` in `permissions` does not get a
   service started, and the reason is reported (D1's hygiene rule).
8. The trust dialog for a board declaring `permissions` lists them; Board Info lists them plus the
   declared `minBridgeVersion` and the service status.
9. A board declaring `minBridgeVersion` above the shipped bridge version is listed *incompatible*
   with that reason and registers no editors; one at or below it behaves exactly as today.
10. `persephone.storage` round-trips a value from the board frame and reads the **same** value
    from its service (D6), and the file lands under
    `<userData>/data/board-storage/<board-key>/`.
11. **No existing board changes behavior.** Every currently-trusted board in the user's install
    still opens its files, and no manifest in the tree needed editing.
12. `npm run typecheck`, `npm run lint` and `npm run build-prod` pass.

## Concerns

- **`utilityProcess` is greenfield in this tree.** No existing supervision pattern, and its
  failure modes (a fork that never readies, a process that exits 0 immediately, a port that is
  transferred but never listened on) are exactly the ones a green build cannot show. US-1467 is
  the epic's risk and should be verified live before US-1468 is started against it.
- **Windows process lifetime.** A `utilityProcess` that is not explicitly killed can outlive the
  app. Shutdown on app quit must be as deliberate as shutdown on untrust, or the user accumulates
  orphaned Persephone processes — which is worse than a feature not shipping.
- **The user's install has ~25 trusted boards.** Anything touching trust storage risks
  invalidating all of them at once. D1 removes that risk by not touching the trust file at all;
  any task that finds itself editing `trustedBoards.txt` has left this epic's scope.
- **`boards.list()` is an agent surface.** Adding a `service` field changes a payload agents read.
  It is additive, but the field must be **absent** for boards with no service rather than present
  and null, so existing consumers see nothing new.
- **Storage keyed by board root.** A board that moves folders loses its storage. Accepted: it is
  the same identity the trust list uses, and the alternative (manifest `name`) is worse.
- **`untrust()` is exact-match while `isTrusted()` is ancestor-aware.** `board-trust.ts:120-128`
  removes only an exact path, so untrusting a board that is trusted *through an ancestor folder*
  is a no-op and the board stays trusted. Exit criterion 4 must therefore be observed on a board
  trusted in its own right; a service that keeps running after an inherited-trust "untrust" is
  correct behavior, not a defect, and US-1467 must not paper over it.
- **A service-only board is invisible to the registry that enumerates boards.**
  `custom-editor-registry.ts:115-145` drops any board whose manifest yields no editor association
  (`getBoardEditorAssociation` returns `null` when `fileMasks`, `contentMasks` and
  `folderEditorMasks` are all empty). A board that declares *only* a `service` would never be
  enumerated there, so the service supervisor needs its own enumeration over
  `boardTrust.listPaths()` rather than a filter relaxation in an editor registry.
- **`boards.list()` has a synchronous path that never reads a manifest.**
  `boards.ts:221-231` (`currentBoardListings`, used by AiVision) passes `manifest: undefined`, so
  a `service` status derived from the manifest would always be omitted there. Status must come
  from the live supervisor registry, which is also what makes it truthful.

## Notes

### 2026-09-20

- Epic created as Phase B of the platform roadmap.
- **D1 is a reversal of the roadmap's framing** and is the scope decision this epic turns on.
  Discovering that `executeNode` already spawns unrestricted Node for any trusted board
  (`board-bridge.ts:333`) — with no declaration — made the proposed permission *grant* model
  indefensible as a boundary. The axis is kept for disclosure and lifecycle, the grant record is
  deferred to the trust-model merge, and the roadmap is annotated accordingly.
- **D3 drops the frame↔service port**, which the roadmap listed but which saves neither a process
  hop nor a serialization step by the roadmap's own §3.1a reasoning.
- The phase is otherwise taken whole: the service process, the declaration axes and per-board
  storage all land, because Phase C cannot begin without the first and would have to invent the
  other two.
