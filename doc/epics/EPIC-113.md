# EPIC-113: A board provider can feed Persephone's own editors

## Status

**Status:** Active
**Created:** 2026-09-26
**Completed:** —

## Overview

Phase E of the [platform roadmap](../platform-roadmap.md), **split in two** the way Phase F was,
and re-scoped by a user decision on 2026-09-26 (D2).

This epic built the platform half: **a link handed to `openRawLink` by a board resolves to
whichever built-in editor its file name deserves — Monaco for `.txt`, the Image viewer for
`.jpeg`, the media player for `.mp3` — and that editor's pipe then pulls its bytes back out of the
board, on demand, a range at a time.** The board is the data source; Persephone picks the editor
and owns the pipe. No board is written in this epic. EPIC-114 adds the torrent board as the first
consumer.

Most of the §3.8 flow is already built. Measured against the source, not assumed:

- **Step 1 is already done.** `browser-service.ts:306-309` preventDefaults any navigation whose
  protocol is not in `CHROMIUM_NAVIGATION_PROTOCOLS` and sends the URL to
  `EventEndpoint.eOpenPipelineCandidate`. `magnet:` is not in that list, so a magnet link clicked
  in the Browser reaches the content pipeline **today**. The roadmap flagged this "to verify"; it
  is verified.
- **Steps 2 and 5 are already done.** A trusted board's `contentProviders` declaration registers
  both the provider type and its schemes (`custom-editor-registry.ts:421-446`), and
  `createBoardSchemeHooks` (`:175-199`) builds the pipe descriptor
  `{ provider: { type, config: { url } }, transformers: [] }` from the href.
  `open-url-validation.ts:1,90-92` admits the scheme once it is registered.
- **Step 6 is already done** for boards that host their own stream:
  `persephone.host.streamUrl()` (`board-shim.ts:1627-1636`) returns `board://<host>/__pipe/<pageId>`
  and `board-protocol-service.ts:388-395` serves it with `Range`.

Three things were **not** done when this epic was scoped, and they were its whole content.
**All three shipped**; the diagnosis is kept because it is the cited evidence the epic was
built on, and EPIC-114 inherits the same seams. What closed each is named inline.

**1. A board-scheme link always opened in Monaco, whatever the file name.** *(Closed by
US-1517.)*
`createBoardSchemeHooks` sets `data.target ||= "monaco"` (`custom-editor-registry.ts:184`) before
delegating to `openContent`. Registered schemes run **before** the file fallback
(`resolvers.ts:75-79`), and every downstream resolver assigns the target with `||` / `??`
(`resolvers.ts:67-69`, `builtin-schemes.ts:234,247`) — so once the board hook has written
`"monaco"`, nothing can take it back, and the file resolver that would have called
`resolveEditorIdForFile()` is never reached. Double-clicking `photo.jpeg` inside a board's scheme
opens its bytes as text. This is the single thing standing between the platform and the stated
requirement, and it is roughly a one-line fix.

**2. A range never reached a board's provider.** *(Closed by US-1474; a provider without
`readRange` still takes the buffered path and its 256 MB ceiling, by design — D5.)* `board-pipe-handler.ts:84-87` will push a range
straight into a provider — but only when `pipe.provider.createReadStream` exists. `ProxyProvider`
does not implement it, and `ProviderOperation` (`ipc/module-service-channels.ts:84-89`) has no
streaming member at all. So a range against a board provider falls back to `readBuffered()` — a
whole-resource `readBinary()` capped at `MAX_BUFFERED_PIPE_BYTES` (256 MB), held in renderer
memory. `assets/guides/boards.md:965-968` says so outright: *"a board provider currently serves
whole-resource reads… Seeking-provider support is not implemented yet."*

That is not a performance detail. Under `readBinary()`, opening one `.mp3` from a torrent
downloads **the entire file** before a byte plays, and anything over 256 MB cannot be opened at
all. "Nothing is fetched until something asks for a piece" is unimplementable without this.

**3. The built-in media player did not read from a pipe at all.** *(Closed by US-1519, which
also made archive-hosted media playable for the first time.)* `VideoEditor.resolveStreamUrl`
(`editors/video/VideoEditor.ts:106-124`) builds a `VideoStreamSessionConfig` that is either
`{ filePath }` or `{ url }` (`ipc/api-param-types.ts:166-180`) and hands it to
`video-stream-server.ts`, which opens a local file with `fs` or proxies HTTP. There is no third
option — `getNavigatorTarget()` returns `{ pipe: null, filePath }` (`VideoEditor.ts:432-433`),
which is the editor stating plainly that it never holds a pipe. A `torrent://…/track.mp3` would
fall into the `filePath` branch, fail to open, and the `catch` would hand the raw URL to the
`<video>` element, which cannot load it either. **`.mp3 → built-in player` therefore needs new
work**, and it is the one file type of the user's examples that does. Monaco and the Image viewer
are both already pipe-backed (`ImageEditor.ts:135` reads `pipe.readBinary()` into a blob URL).

1. Board-scheme links resolve by their effective file name, while an explicit target still wins.
2. A provider that implements board-side `readRange` receives bounded ranged pulls over the
   module service; providers without it retain the buffered `readBinary()` fallback and its
   256 MB ceiling.
3. The built-in media player now has a pipe-backed video-stream session, including the shared
   HTTP session used by the in-page player and Open in VLC.

A fourth thing was added during the epic rather than found in scoping: US-1521 exposes
`persephone.content.open(link)` to **simple** boards — an origin-local ranged URL for any
supported link, without opening a page or materializing a cache file. It is the migration path
off `getFilePath()` for the five published viewer boards (D9, D12).

## Goals

- A link a board hands to `openRawLink`, with **no target**, opens in the editor Persephone would
  pick for that file name — Monaco, Image, media player, grid, or an installed board — and only
  falls back to Monaco when nothing matches.
- `IProvider.createReadStream(range)` reaches a **board-implemented** provider over the module
  service with the range intact, closing US-1474 and the documented gap at `boards.md:965-968`.
- A provider read waits as long as the content takes — no deadline — and is released promptly when
  the page that wanted it closes, or when the user deletes the source in the board.
- The built-in media player plays and seeks a file whose bytes come from a pipe, with no
  materialized cache file.
- A resource larger than 256 MB opens and seeks through the ranged provider path.
- The board-authoring guide stops documenting seeking as unimplemented.

## Non-goals

- **The torrent board — EPIC-114.** Nothing here imports WebTorrent or knows what a torrent is.
- **An audio player board.** Dropped by user decision (D2). Phase E's roadmap text, EPIC-107's
  decision table and EPIC-108's deferral table all assume one; those notes are superseded and
  US-1520 corrects them.
- **`media.play` as a capability invocation.** It was Phase E's only planned caller and existed to
  route bytes to an audio *board*. With the built-in player as the target, steps 4-5 are ordinary
  link resolution, which roadmap §3.8 already says needs nothing from the bus. EPIC-108's bus is
  unaffected and still has no built-in registration; this epic does not add one.
- **US-1478** (routing a downloaded `.torrent` into `openRawLink`). Needs a product decision and
  download-manager lifecycle work; its only consumer is EPIC-114. Stays in Planned.
- **Replacing `video-stream-server.ts`** or moving local-file and HTTP playback onto pipes. US-1519
  adds a third session source beside the two that exist; it does not reroute them.
- **Credit-based push frames.** See D5 — what shipped is a bounded *pull*, and this epic keeps it.
- **Migrating the published boards off `getFilePath()`.** D9's API ships here; rewriting
  `pdf-viewer`, `word-viewer`, `powerpoint-viewer`, `excel-viewer` and `sqlite-viewer` to use it is
  work in `persephone-boards`, after a board has proven the API.
- **The board's own metadata-resolution timeout.** Distinct from D6's platform deadline: it is how
  long a board waits for a magnet link to produce a file list, it lives entirely in the board's
  service code, and it never reaches `withDeadline()`. av-player allowed 30 s
  (`torrent-proxy.ts:136-142`). **EPIC-114**, as a board setting with a 30 s default *(user
  decision, 2026-09-26)*.
- **A pipe-level loading indicator.** `IContentPipe` has no loading state and no editor shows one
  while a pipe reads. With D6 removing the read deadline this becomes more visible, but whether it
  is worth building is a judgement to make **after** testing the torrent board against real magnet
  links *(user decision, 2026-09-26)*. Recorded under the roadmap's "After the roadmap" section.
  D6's requirement that a board can *know* a read is outstanding still stands — that is the half
  that cannot be retrofitted.
- **Ranged writes.** Out of scope, but the wire shape must not make them impossible to add later.

## Decisions

**D1 — Both Phase E boards live in `persephone-boards`, not in `assets/boards/`.**

*(User decision, 2026-09-26, confirming roadmap §4 Phase E.)* Excalidraw was bundled because it
**replaced a built-in editor** being deleted in the same programme — something had to be in the box
on a fresh install with no network (EPIC-109 D1/D2). The torrent board replaces nothing. It is an
opt-in catalog download, which is also the honest test of the published-board path: it will be the
catalog's first board with a declared `service` and its first with `contentProviders`, and bundling
it would skip exactly the install, trust and update mechanics it is meant to exercise.

**D2 — The board supplies bytes; Persephone picks the editor and owns the pipe.**

*(User decision, 2026-09-26.)* In the user's terms: double-clicking a file in the board builds a
link, the board hands it to Persephone, **Persephone** resolves it to the dedicated editor for that
file type, and when that editor's pipe starts pulling, the board serves the data. The board never
chooses, wraps, or embeds an editor.

This replaces the roadmap's audio-player board with the built-in player, and it generalises the
flow from one file type to all of them. It makes the epic *smaller* in board work and *larger* in
platform work, and it moves the centre of gravity to two seams — target resolution (finding 1) and
pipe-backed media (finding 3) — that the board-based design would have stepped around rather than
fixed.

It also means the platform gets the benefit permanently: every future provider board, not just the
torrent one, gets the right editor for free.

**D9 — One link, two resolutions, and a public API for the second one.**

*(User design proposal, 2026-09-26. Accepted.)* A link is resolved **twice, independently**: once
to decide *which editor opens it*, once to build *the pipe that feeds that editor*. Both answers
come from the same link, and any consumer — a built-in editor, a content-host board, a simple
board, or Persephone itself — should get its bytes through the second one rather than reading a
path directly.

Most of this already exists and is not being invented here:

- Editor resolution by link is already the standalone `resolveEditorIdForFile(url, effectivePath)`
  (`custom-editor-registry.ts`), already used that way at `builtin-schemes.ts:234`.
- Pipe resolution by link is already `resolveUrlToPipeDescriptor(url, data)` (`link-utils.ts:83`)
  for built-in shapes plus `resolveRegisteredSourcePath(path)` for registered schemes, combined by
  `pipeFromSourcePath(path)` (`rebuild-pipe.ts`).

What is missing is that the two are **conflated at one call site** (US-1517), that
`pipeFromSourcePath` is documented as a guessy *fallback* rather than the canonical route, and that
**neither is exposed to a board at all** — a board frame gets `readFile(path)` and `getFilePath()`
and nothing else.

**The API returns a URL, not a pipe object.** A pipe has methods and lives in the renderer;
structured-clone RPC cannot carry them across the frame boundary — which is precisely why
`persephone.providers.register()` always throws in a board frame (`board-api.d.ts:285-304`).
So the board-facing form is a ranged, origin-local URL — the same `board://<host>/__pipe/<id>`
mechanism `persephone.host.streamUrl()` already serves, **generalised from "the pipe of the page I
am" to "a pipe for any link I name"**. It reuses proven machinery, carries `Range` for free, and
drops into `<img src>`, `<video src>`, `fetch()` and pdf.js's range transport with no adapter.

Rejected: an opaque pipe **handle** with `read(range)` / `stat()` RPCs against it. It is a second
protocol for something the `__pipe` route already does, and it needs a new object lifecycle.

**This subsumes US-1519.** "Give the built-in media player a ranged URL for a pipe" and "give a
board a ranged URL for a link" are the same mechanism with two callers. The tasks stay separate
because the media player also needs its session plumbing changed, but they share one seam and
US-1521 should land first.

**Why it matters for D3, concretely.** Every published board today is `editorKind: "simple"` and
reads a path. Three of them — `pdf-viewer`, `word-viewer`, `powerpoint-viewer` — declare
`editorSources: "any"`, which makes Persephone **materialize the pipe into a cache file on disk**
so `getFilePath()` still works (`BoardEditorModel.ts:98-106`, `board-manifest.ts:188`). Against a
torrent that downloads the whole file **and writes it to disk**, breaking both of D3's rules at
once; `excel-viewer` and `sqlite-viewer`, which declare no `editorSources`, would instead lose the
file to the built-in editor entirely. This API is the migration path off `getFilePath()`.

**Migrating those boards is NOT this epic** — see Non-goals. The API ships here and proves itself
against one consumer; rewriting five published boards in the other repo follows later, behind a
board that has actually exercised it.

**D3 — The torrent board is a VIEWER, not a torrent client. Recorded here because it constrains
this epic's seams.**

*(User decision, 2026-09-26.)* Resolving a `.torrent` or `magnet:` fetches **metadata only**, with
every file deselected on arrival — av-player's
`torrent.files.forEach(f => f.deselect())` (`C:/projects/av-player/src/main/torrent-proxy.ts:105-107`).
Bytes move **only** when a pipe's range asks for them. Everything stays in memory; nothing is
written to disk as a side effect of viewing; nothing is seeded as a feature. "Download this file"
exists as one explicit per-file request, not a mode the board sits in.

This is why US-1474 is a blocker rather than an optimisation, and why US-1518 is in scope: a
demand-driven read is *defined* by being slow at the moment it is first asked for.

**D4 — Phase E splits into EPIC-113 (this) and EPIC-114 (the torrent board).**

The split point is chosen so **both halves stand on their own**: this epic ends with any board
provider able to feed any built-in editor, including ranged media — worth having whether or not a
torrent board ever exists, and immediately useful to the existing published boards. EPIC-114 then
adds a consumer to a proven seam instead of debugging WebTorrent and a new platform protocol
simultaneously. Mirrors the EPIC-109 / EPIC-110 split and its stated reason.

**D5 — Streaming is a new provider wire operation, and keeps the bounded pull.**

`ProviderOperation` gains a ranged read; the service-host provider contract
(`assets/module-service-host.mjs:150-163`) gains an optional `createReadStream(config, range)`
beside the existing optional `writeBinary` / `stat` / `watch`. A provider that does not implement
it keeps working exactly as today — `hasDirectStream()` (`board-pipe-handler.ts:84-88`) already
requires the method to be a function, so absence *is* the buffered path and needs no flag.

Rejected: overloading `readBinary` with an optional range. It would silently change what every
existing board provider returns, and `MAX_BUFFERED_PIPE_BYTES` is asserted against `readBinary`
results in three places (`ProxyProvider.ts`, `module-service-host.mjs`, `board-pipe-handler.ts`) on
the assumption that they are whole resources.

Roadmap §3.8 step 7 describes "credit-based frames", and EPIC-107's overview calls them
established. They were **not** built — `grep -ri credit src` returns nothing. What EPIC-107 shipped
is a bounded *pull*: `MAX_BOARD_PIPE_CHUNK_BYTES` (1 MB) per reply, the handler requesting
continuation ranges until the response completes (`board-protocol-service.ts:360-380`,
`board-pipe-channels.ts`). That is backpressure by construction — the next chunk is not requested
until the previous is consumed. The new operation follows the same shape rather than introducing a
second transport, and **the roadmap text is corrected in place** (US-1520).

**D6 — A content read has no deadline; cancellation is the only release, and is already half-built.**

`module-service-host.mjs`'s `withDeadline()` races every provider operation against a single
`deadlineMs` from argv, which the supervisor sets to `SERVICE_REQUEST_DEADLINE_MS` = 10 s
(`module-service-supervisor.ts:574-578`). A first range against a cold swarm routinely exceeds
that; av-player allowed **30 s for metadata alone** (`torrent-proxy.ts:136-142`).

- *Cancellation exists.* `invalidateBoardPipePage(pageId)` (`board-pipe-handler.ts`) already marks
  pending reads cancelled and drops the memo when a page goes away. It cannot tell the **service**
  to stop, because there is nothing on the wire to say it with.
- *A longer deadline does not exist*, and "raise the constant" is the wrong fix: it would lengthen
  every board's every provider call and let one wedged service hold a request slot
  (`MAX_OUTSTANDING_REQUESTS_PER_SERVICE` = 32) for minutes.

**A content read has NO deadline. It waits until the user closes the page or deletes the source**
*(user decision, 2026-09-26, superseding the idle-timeout shape decided earlier the same day)*.

The reasoning that settles it: a demand-driven read has no meaningful deadline, because what it
waits on **is the user's own intent**. Monaco asked for those bytes because the user asked for
them; nobody else is harmed by the wait. Any number chosen here — total or idle — is arbitrary
policy dressed as safety, and the honest cancel signals are the ones the user named: close the
page, or explicitly delete the source in the board.

Most of those signals already exist and already reject pending requests:

| Release path | Status today |
|---|---|
| Page close | `PagesModel.ts:117` calls `invalidateBoardPipePage(pageId)`, which marks pending reads cancelled — but cannot tell the **service** to stop |
| Renderer reload / lease lost | `loseLease()` rejects every pending request |
| Service crash, untrust, app quit | Already reject pending |
| Explicit delete in the board | The board destroys its own resource; the read fails naturally |

So what US-1518 must build is the **cancel message** (the missing half of page-close) and one thing
the earlier framing did not surface:

**CORRECTED 2026-09-26, during US-1518's investigation.** The paragraph that stood here claimed
the board's own control requests — status, metadata and *delete this torrent* — share the 32-slot
`client.pending` map with waiting provider reads, so enough stalled reads would block the very
escape hatch meant to release them. **That is wrong, and the source says so explicitly.**
`app.boards.requestService()` and the board frame's `persephone.service.request()` are routed
through **main**, not over the renderer MessagePort lease — `boards.ts:411-419` carries a comment
saying exactly that, and gives the reason: a service is not obliged to implement the lease port at
all, so routing script and agent requests over it made every such call fail. They land in the
supervisor's `record.requests` (`module-service-supervisor.ts:328`) — a different map, in a
different process, over a different transport from the renderer's `client.pending`
(`module-service.ts:290`). The host confirms it from the other end: its `parentPort` handler
answers only `attach-renderer` and `drop-renderer`, so a service request over that channel is
answered by the board's own service module, never by the pooled lease path.

**The real risk is narrower, and survives.** Both pools are capped at
`MAX_OUTSTANDING_REQUESTS_PER_SERVICE` = 32, and the renderer pool genuinely can be exhausted by
stalled reads — at which point `stat()` or a read for a *different file of the same board* fails
`service-busy`. That is still worth fixing, and the same accounting split fixes it; it simply is
not the dramatic "the board goes blind at the moment the user needs to control it" failure that
was recorded here. So the requirement US-1518 carries forward is narrower too: **waiting reads
must not consume the budget ordinary provider operations need.**

**Plumbing.** `deadlineMs` is already a parameter on both `request()` functions, but
`Number.isFinite(deadlineMs) && deadlineMs > 0` means `Infinity` **and** `0` both fall back to the
10 s default — "no deadline" needs an explicit sentinel, not a large number. Three places carry a
timeout and all three change: `module-service.ts:289-297`, `module-service-supervisor.ts:341-346`,
and `withDeadline()` in `assets/module-service-host.mjs`.

**What replaces the timeout is visibility, not a number.** A deadline was also how a user learned
something was wrong; without one, a page spins with no explanation. The replacement is the board
showing *"waiting for peers"* against the file and the page showing it is still loading. That is
strictly better — informative rather than arbitrary, and it leaves the decision to cancel with the
person who has the context. The UI is EPIC-114's, but **US-1518 must make sure a board can know a
read is outstanding.**

*(The earlier idle-timeout decision is withdrawn. With no deadline there is nothing for an idle
timer to do, which also releases the constraint it placed on US-1474's wire shape — though the
streaming form remains preferable for the progress signal the visibility work needs.)*

**D7 — Per-page selection, not av-player's global one.**

av-player's `handleVideoRequest` deselects **every other file** before selecting the requested one
(`torrent-proxy.ts:203-208`). Correct for a single-player app, wrong for Persephone, where two
pages can stream two files from one source at once — the second open would silently starve the
first. The platform seam must not assume one live range per provider: config identifies the
*resource* (`{ url }` from `createBoardSchemeHooks`), and concurrent ranged reads against different
configs of the same provider type must both work. The board's own refcounting is EPIC-114's
problem; **not foreclosing it** is this epic's.

**D8 — Memory bounds are the board's policy, but only a ranged read makes them possible.**

A memory-backed board store keeps every fetched byte for the resource's lifetime; combined with
D3's "everything in memory", a long video grows without limit. That policy is EPIC-114's to set,
but it depends on something here: if the platform only ever asks for whole resources, the board has
no signal about what is still wanted and can evict nothing. A ranged read **is** that signal.
Recorded so the dependency is not rediscovered later.

**D10 — US-1519 serves pipe-backed media over `video-stream-server`'s HTTP surface, NOT the
`board://__pipe` route. An external player settles it.**

*(User scenario, 2026-09-26.)* The scenario asked for: open a video whose format Chromium cannot
decode, and use the built-in player's **Open in VLC** to watch it — including when the bytes come
from a torrent.

That decides the open question, because **VLC is an external process**. `board://<host>/__pipe/…`
is a custom protocol handler registered on an Electron session (`board-protocol-service.ts`),
reachable only from inside Persephone; VLC cannot fetch it. Reusing the `__pipe` route would have
worked for the in-page `<video>` and failed at the first click of Open in VLC.

`video-stream-server.ts` already serves what an external player needs: a real HTTP endpoint,
`http://127.0.0.1:<port>/video-stream/<sessionId>`, bound to 127.0.0.1, with `Range`
(`ensureServerRunning`, `handleRequest`). So US-1519 adds a **third `VideoStreamSessionConfig`
source — a pipe — beside `filePath` and `url`** (`ipc/api-param-types.ts:166-180`), and both
consumers are served by one session.

**The VLC flow itself needs no work.** `VideoEditor.openInVlc` (`:401-425`), the **Open in VLC**
button (`VideoView.ts:90-95`) and `vlc-launcher.ts` are all built, and the button's gate —
`playerState` not in `loading`/`playing`/`stopped` (`VideoView.ts:204-206`) — already surfaces it
exactly when the built-in player has failed to decode. It needs a source that works, which is the
same third session type.

**Mechanism.** `video-stream-server` runs in **main**; a pipe lives in the **renderer**.
`board-pipe-channels.ts` already bridges precisely that gap — main asks the renderer for a bounded
chunk of a page's pipe and the renderer answers. US-1519 generalises that channel beyond board
pages rather than inventing a second one.

**Three consequences, named so they are deliberate:**

- **Closing the Persephone page stops VLC playback.** `deleteSessionsByPage(pageId)` already does
  this for today's sessions, and D6 makes page-close the cancel signal for pipe reads, so the two
  agree. Still worth knowing: a user watching in a separate window may not expect it.
- **`SESSION_EXPIRY_MS` is 30 minutes idle.** Pausing VLC longer than that loses the session.
  Tolerable today; likelier to bite on a long film.
- **A 127.0.0.1 HTTP server is reachable by any local process**, with the session UUID as the only
  capability. Already the model for local files, so torrent bytes are no worse — stated once rather
  than discovered.

**This does not change D9.** A board fetching its own content in-frame keeps the origin-local
`board://…/__pipe/…` URL — same-origin, no port, no CORS. The HTTP surface is for consumers
*outside* the frame. Whether US-1521 should also be able to hand out an HTTP URL for an external
consumer is a question for its task document, not an assumption here.

**D11 — A trusted board is a user application. The trust dialog is the only gate, and no task in
this epic adds another.**

*(User decision, 2026-09-26, resolving a concern raised against D9's API and standing for the epic
as a whole.)* In the user's terms: a board is like an app the user built in Visual Studio with
Windows Forms. They trust it; what it does is by design. A Windows Forms app can do anything, and
so can a board.

This is not a new policy — it is the architecture that already shipped, and the D9 concern was
inconsistent with it:

- A declared service is `utilityProcess.fork`ed on the board's own ESM entry with full Node —
  filesystem, network, child processes (`module-service-supervisor.ts:574-581`).
- `persephone.readFile(path)` / `writeFile(path, data)` take **any** path
  (`board-shim.ts:1548-1563`).
- `executeNode()` runs arbitrary Node on the user's machine.

So `buildPipe(link)` grants nothing a trusted board did not already have, and the question "does
this widen what a board can reach?" presupposes a bounded reach that does not exist. **Reach is
unbounded by design, from the moment the user trusts the board.**

The consequences to hold to in every task document here:

- Do not design per-API permission gates, path allow-lists, or scheme restrictions for **trusted**
  boards. The existing `permissions` manifest field is *disclosure* — it tells the user what a
  board will do before they trust it — not enforcement, and it stays that way.
- The checks that do remain are **correctness and ownership**, not permission: a provider type
  must be owned by the board that declared it, a scheme must not be hijacked from another board,
  a range must be validated as well-formed. Those protect boards from each other and the platform
  from malformed input, which is a different thing from restricting what a trusted board may do.
- The untrusted path is unchanged: an untrusted board's `contentProviders`, `service`, capability
  and custom-editor declarations are all inert until trusted, which is where the single gate lives.

**D12 — The API is `persephone.content.open(link)` → `{ url, size, contentType }`.
`host.streamUrl()` is left alone.**

*(User decision, 2026-09-26.)* `buildPipe` leaked an internal noun — from a board author's view the
API is "give me a readable URL for this link", not "construct a pipe object".

**Overloading `persephone.host.streamUrl(link?)` was rejected on a hard constraint, not taste.**
`streamUrl()` is gated by `pipeUrlEnabled`, which is true only for `content-host` and `stream-host`
boards (`BoardEditorModel.ts:571`; `board-shim.ts:1629-1631` throws otherwise). Every published
board today is `editorKind: "simple"` — and those are precisely the callers this API exists for
(D9). Overloading would either exclude them, defeating the purpose, or widen `host` to plain
boards, where "the content host for **this page**" is meaningless. `host` is the page's own pipe;
a link→pipe API is a different scope and belongs in a different namespace.

**The return shape carries metadata because every caller needs it anyway.** pdf.js requires the
resource length up front for its range transport, and a viewer needs the content type to know what
it is holding. Returning `{ url, size, contentType }` with the URL saves a round trip that
otherwise every caller makes; `contentTypeForPipe()` (`board-pipe-handler.ts:33-62`) already
computes the type, and `pipe.stat()` already yields the size.

**Residual risk to handle in the guide, not the API.** `persephone.content.open()` sits next to the
top-level `persephone.openRawLink()`, which opens a **page**. One returns bytes, the other opens a
tab. The namespace carries the distinction (`content.` = the bytes behind a link), but US-1521's
guide text must state it outright rather than leave an author to infer it.

**D13 — US-1474 ships a fixture board under `persephone-boards/_test/`, and it is what makes this
epic verifiable on its own.**

*(User decision, 2026-09-26.)* No board in either repo implements a ranged provider, so without a
fixture every acceptance item here would wait on EPIC-114 — defeating the split (D4). US-1474
builds one: a trivial board with a declared service whose provider serves a large synthetic
resource, with deliberately controllable behaviour — **slow first byte**, configurable delay, and
the ability to stall indefinitely so D6's "waits forever until the page closes" is actually
exercised rather than asserted.

That fixture is what turns the acceptance list from a plan into a test. It also exercises the
paths a real torrent will hit *without* a swarm's variables: a cold start that is slow by
construction rather than by luck, a stall that is reproducible, and a resource larger than
`MAX_BUFFERED_PIPE_BYTES` (256 MB) generated rather than downloaded.

**Two facts about `_test/`, checked rather than assumed:**

- It currently holds **test fixture *files*** — `sample.pdf`, `excel-viewer-test.xlsx`,
  `sample.db`, `sample.docx`, `decks.zip` and so on — and **no boards**. This fixture will be the
  first board there and establishes the convention (a `_test/<name>/` subfolder with its own
  `board-manifest.json`). An earlier note in this epic called `_test/` an existing home for test
  boards; that was wrong.
- **It can never be published.** `scripts/publish-board.mjs` scans only `boards/`
  (`:30`, `:151`), so a board under `_test/` is excluded from the catalog by construction, not by
  discipline. Nothing needs adding to the publish script or the workflow to keep it out.

Leave the existing fixture files alone — they are the user's, and other boards' QA depends on them.

**D14 — The range bound is enforced on both sides of the wire, mirroring `readBinary`. This is a
correctness check, not a permission check.**

Today one process does everything, so both guards live in the renderer: `board-pipe-handler.ts`
clamps a requested range to `MAX_BOARD_PIPE_CHUNK_BYTES` (1 MB) **before** calling the provider
(`:176-179`), and `collectChunk` counts bytes **as they arrive** and destroys the stream if the
provider overshoots anyway (`:126-136`). A `Range: bytes=0-1073741823` never reaches a provider as
a gigabyte request — the protocol handler pulls 1 MB at a time (D5).

US-1474 moves the provider into the board's service process, so the clamp and the code acting on
it are no longer in the same place. Two questions follow, neither of which existed before:

- Does the service re-check the range it is handed, or pass it straight to the board's provider?
- Does anything check what the provider returns? A provider asked for 1 MB could return 500 MB —
  an off-by-one on `end`, or a provider that ignores the range and returns the whole resource.
  Structured clone copies that across the process boundary, so it is real memory in **both**
  processes.

**Resolution: both sides, exactly as `readBinary` already does it.** The service validates that the
incoming range is well-formed and within the chunk bound and caps what the provider produces;
`ProxyProvider` re-checks the returned size on arrival. Neither side trusts the other's arithmetic.
The precedent is established and should simply be followed: `module-service-host.mjs` returns
`providerFailure("provider-payload-too-large", …)` when `readBinary` overruns
`MAX_BUFFERED_PIPE_BYTES`, and `ProxyProvider.readBinary` throws the same check again on receipt.

**Why this survives D11.** Nothing here defends against a *malicious* board — D11 settles that a
trusted board may do anything. It defends against a **buggy** one: the failure mode of an
unchecked overrun is an out-of-memory crash of the service process or the renderer, and the
failure mode of a checked one is a typed `provider-payload-too-large` naming the board. That is
the line D11 draws — permission gates go, correctness and ownership checks stay.

**D15 — US-1517 changes the OPEN phase only. The `source-path` phase is a different caller and
must come out byte-identical.**

`createBoardSchemeHooks.resolve` (`custom-editor-registry.ts:183-197`) serves two callers through
one function:

- **`phase: "open"`** — the user followed a link. The pipeline needs a target *and* a pipe, then
  opens a page. This is the phase whose `data.target ||= "monaco"` is the defect.
- **`phase: "source-path"`** — `pipeFromSourcePath()` is rebuilding a pipe for a page that
  **already exists**: a restored page after restart, a cross-window move, an editor constructed
  from a path alone. Nothing is opened, and the hook returns early before delegating.

The asymmetry that makes this worth writing down: `resolveRegisteredSourcePath`
(`scheme-registry.ts:250-255`) reads **only the pipe** — `data.pipe`, else
`createPipeFromDescriptor(data.pipeDescriptor)`. It never looks at `data.target`, and its
`delegate` is a no-op (`:237`). The phase exists to answer one question: *what pipe feeds this
path?*

So the concern is blast radius, not correctness. A target computed in `source-path` is simply
discarded — wasted, not wrong. The real risk is that editing a shared function to fix the open
phase perturbs what `source-path` produces, and `source-path` is what rebuilds pipes for
**restored pages**. Getting it wrong silently empties every board-scheme page on restart — the
same class of defect EPIC-110 hit, where a restored page carried the right editor id and content
but rendered the not-found view because `restore()` failed to re-derive one field.

**Therefore:** compute the target inside the open branch only; leave the pipe construction, the
descriptor shape and the early return untouched; and verify a restored board-scheme page still
rebuilds its pipe after a restart.

**The fix is smaller than it looks.** `resolveEditorIdForFile` is exported from
`custom-editor-registry.ts` — the same file `createBoardSchemeHooks` lives in — so this is a direct
local call. `builtin-schemes.ts:233` needs `await import()` for it; here nothing new is imported
and no async plumbing is added.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| [US-1517](../tasks/US-1517-board-scheme-editor-resolution/README.md) | A board-scheme link resolves to the editor its file name deserves, not always Monaco | Implemented |
| US-1474 | Ranged reads pushed into a board-implemented provider (`createReadStream` over the module service), plus the `_test/` fixture board that makes it verifiable (D13) | Planned |
| US-1518 | Long-running provider operations: per-operation deadline and wire-level cancellation | Planned |
| US-1519 | The built-in media player plays from a pipe — a third `video-stream-server` source, so the in-page `<video>` **and** Open in VLC both work (D10) | Planned |
| US-1521 | `persephone.content.open(link)` → `{ url, size, contentType }`: a ranged origin-local URL for any link, for boards and built-ins alike (D9, D12) | Planned |
| US-1520 | Close the documented gaps: `boards.md` seeking note, roadmap §3.8 and Phase E corrections, guides | Planned |

US-1474 is the pre-committed deferral from EPIC-107 D11 and moves under this epic from
*(no epic)* in [active-work.md](../active-work.md).

**Suggested order:** US-1517 first — it is small, it is the user-visible requirement, and it makes
every later task observable with a real editor on screen. Then US-1474, then US-1518 (which US-1474
will make necessary in practice), then **US-1521 before US-1519** — they share one seam (D9) and the
media player is simply its first built-in caller. US-1520 last.

## Acceptance

Verified in the running app, not only built:

1. `openRawLink("<board-scheme>://…/notes.md")` with no target opens the Markdown editor,
   `…/photo.jpeg` opens the Image viewer, `…/track.mp3` opens the media player, and an extension
   nothing claims still opens Monaco.
2. A board provider registered from a module service serves a `Range` request without its whole
   resource ever being read — observable as the provider's own byte counter and as a
   `Content-Range` that is not the full length.
3. A resource larger than `MAX_BUFFERED_PIPE_BYTES` (256 MB) opens and seeks.
4. Seeking near the end of a large file issues a range near the end and returns promptly, with no
   read of the bytes in between.
5. The built-in media player plays, pauses and seeks a file served by a board provider, with no
   cache file created (checked against the `userData` watcher, as Phase D's exit did).
6. A provider read taking minutes completes rather than timing out; closing the page mid-read
   releases it promptly, and the service's request slot with it.
7. With several reads outstanding and waiting, the board's own control requests — status, and the
   action that deletes the source — still get through rather than failing `service-busy`.
8. A video whose format Chromium cannot decode, served by a board provider, opens in **VLC**
   through the local streaming server and seeks there — the scenario that decided D10.
9. A provider that does **not** implement the streaming operation behaves exactly as before, and
   local-file and HTTP media playback are unchanged.

### Acceptance results — all nine verified in the running app, 2026-09-26

Measured, not asserted. Items 2-9 used the `range-provider-test` fixture board (D13); item 5 also
needed a second fixture, `content-open-test-fixture`, because the first is `stream-host` and could
not prove the `simple`-board case US-1521 exists for.

| # | Result |
|---|---|
| 1 | `notes.md` -> `md-view`, `photo.png` -> `image-view`, `track.mp3` -> `video-view`, `archive.zzz` -> `monaco` |
| 2 | Provider counters after playing a 4.48 MB file: `readBinary: 0`, `readRange: 5` |
| 3 | 300 MB resource opened and seeked; the no-range provider correctly refused it at the 256 MB ceiling |
| 4 | Last 64 bytes of the 300 MB resource returned in ~2 ms, byte-verified against `genByte(offset)` |
| 5 | Board-provider `.mp3` played in the built-in player: `readyState 4`, true 185.5 s duration, **no cache file written** |
| 6 | A 20 s read completed at 20 074 ms instead of failing at ~10 s; after closing a page holding 6 stalled reads, 40/40 control ops succeeded in 12 ms |
| 7 | A control request answered in **1 ms** while 6 provider reads were stalled indefinitely |
| 8 | **VLC launched with the exact session id the in-page `<audio>` was using** (`772b1b39-...`), and `readRange` went 5 -> 10 while `readBinary` stayed 0 — an external process streaming bounded ranges from a board provider. Confirmed audible by the user. Works with `vlc-path` empty: `vlc-launcher.ts`'s `resolveVlcPath()` already probes both Program Files locations |
| 9 | `test/norange` behaviour unchanged; local-file and HTTP playback unchanged |

Item 8 is the scenario that decided D10, and the matching session id is the part worth keeping:
it proves *one* session serves both consumers, which is what stops a torrent being downloaded
twice to watch it once. `openInVlc()` originally created a second session — see US-1519.

## Concerns / open questions

*(None open. Every question raised during scoping was resolved into a decision above — D6, D9,
D10, D11, D12, D13, D14 and D15 each began as one. What remains for the task documents is
implementation detail, not design.)*

## Notes

### 2026-09-26
- Epic created, then re-scoped the same day by user decision (D2): no audio player board; the board
  supplies bytes and Persephone resolves the link to its own dedicated editor. US-1517 and US-1519
  are the two tasks that decision added; the audio player board task it removed.
- Roadmap step 1 ("to verify": where an unknown scheme enters the pipeline) resolved against
  `browser-service.ts:306-309` — no work needed.
- Roadmap §3.8 step 7's "credit-based frames" found to be unbuilt and superseded by the bounded
  pull EPIC-107 shipped (D5); correction folded into US-1520.
- `data.target ||= "monaco"` in `createBoardSchemeHooks` (`custom-editor-registry.ts:184`) found to
  defeat file-name editor resolution for every board scheme. Previously carried as an open question
  to verify at runtime; the resolver chain (`resolvers.ts:67-79`, `builtin-schemes.ts:234,247`)
  makes it a defect on inspection, so it is now US-1517 rather than a question.
- User proposed separating editor resolution from pipe resolution, with a public link→pipe API so
  boards and built-in editors stop reading paths directly (D9). Accepted, with one correction: the
  API returns a ranged URL rather than a pipe object, because RPC cannot carry a pipe's methods
  across the board frame. Added as US-1521; it subsumes the mechanism half of US-1519.
- Found while evaluating it: all five published boards are `editorKind: "simple"`, and three of
  them declare `editorSources: "any"` — which materializes a **cache file on disk** for a non-local
  source. That breaks both of D3's rules, and is the concrete argument for the API.
- ~~Deadline shape settled (D6): an **idle** timeout, board-declared, 30 s default.~~ *(Superseded later the same day — see the next entry.)* The user's
  proposal to make it a board setting is what decided it — "stop waiting if nothing arrives for N
  seconds" is a number a user can answer, while "total time for a range read" is not. Consequence
  recorded against US-1474: only the streaming wire form makes an idle timeout observable, so the
  buffered form would forfeit the decision.
- The 30 s the user remembered from av-player is the **metadata** timeout, not this one. Different
  owner, different channel; moved to Non-goals and carried to EPIC-114.
- Deadline reversed the same day by user decision: **no timeout on a content read at all.** It
  waits until the page closes or the user deletes the source. The idle-timeout decision above is
  withdrawn; D6 now records the reasoning and the trap it exposed — waiting reads share the 32-slot
  budget with the board's own control requests, including the delete that is meant to cancel them.
- The board's metadata timeout (30 s, board setting) is unaffected: different channel, different
  owner, still EPIC-114.
- US-1519's session shape settled (D10) by a user scenario: playing a Chromium-undecodable video
  from a torrent in **VLC**. An external process cannot fetch `board://…/__pipe/…`, so the media
  path must go through `video-stream-server`'s 127.0.0.1 HTTP surface. This reverses the leaning
  toward reusing the `__pipe` route, which would have worked for `<video>` and failed at the first
  click of Open in VLC.
- D9's "does this widen what a board can reach?" concern withdrawn and replaced by D11 *(user
  decision)*: a trusted board is a user application and the trust dialog is the only gate. The
  concern was inconsistent with the shipped architecture — a board service already runs full Node
  and `readFile` already takes any path — so `buildPipe(link)` grants nothing new.
- API named (D12): `persephone.content.open(link)` → `{ url, size, contentType }`. Settling it
  ruled out the `host.streamUrl(link?)` candidate on a constraint rather than taste — `streamUrl`
  is gated to content-host/stream-host boards, and every published board is `simple`, so the very
  callers the API is for cannot reach `host.*`.
- Fixture board confirmed for `persephone-boards/_test/` (D13). Correcting an earlier note in this
  epic: `_test/` holds test fixture *files*, not boards — this will be the first board there. It
  cannot reach the catalog, since `publish-board.mjs` scans only `boards/`.
- Range enforcement settled (D14) after the user asked what the concern meant: both sides of the
  wire, mirroring the `readBinary` precedent. Reframed explicitly as correctness rather than
  permission, so it is not mistaken for a gate D11 rules out — it guards against a buggy provider
  causing an OOM, not against a hostile one.
- `source-path` concern settled (D15) after the user asked what it meant: it is a blast-radius
  note, not a correctness one. The phase reads only the pipe and discards the target, so the risk
  is perturbing pipe rebuilding for restored pages while fixing the open phase. Also found while
  explaining it: `resolveEditorIdForFile` lives in the same file, so US-1517 adds no import.
- Concerns list now empty. Every scoping question became a decision.
- US-1517 implemented. **End-to-end verification is deferred to US-1474**, and this is a structural
  gap rather than an oversight: no board in either repo declares `contentProviders`, so no board
  scheme is registered at runtime and there is no link that exercises `createBoardSchemeHooks` in
  the open phase. Acceptance item 1 becomes testable the moment D13's `_test/` fixture board exists.
  What *was* verified in the running app: the renderer survives the change, and the new
  `schemeEffectivePath()` returns the right file name for eight URL shapes — nested path, `%20`
  escape, query string, fragment, trailing slash, host-only, non-URL, and a malformed `%ZZ` escape
  (which throws `URIError` and is caught, falling back to the full url exactly as
  `builtin-schemes.ts:234` does).
- Recorded against US-1517 for EPIC-114: once a board scheme resolves by file name, a board-scheme
  link to a type an `editorSources: "any"` board claims (`pdf-viewer`, `word-viewer`,
  `powerpoint-viewer`) will make Persephone materialize the pipe into a **cache file on disk**
  (`BoardEditorModel.ts:98-106`) — a whole-file download for a torrent source, breaking D3. Kept
  deliberately: it is exactly what `http://…/x.pdf` does today, and diverging would make board
  schemes an undiscoverable special case. The fix is D9's `getFilePath()` migration, already
  deferred in Non-goals.
- US-1474 implemented, and the `_test/range-provider-test` fixture board (D13) built in
  `persephone-boards`. The fixture is what turned the acceptance list from a plan into a test, and
  it did so immediately — **acceptance items 1, 2, 3, 4 and 9 are now verified in the running app**:
  - **Item 1 (US-1517, verified for the first time).** Four board-scheme links, one board, four
    different editors: `rangetest://fixture/notes.md` → `md-view`, `…/photo.png` → `image-view`,
    `…/track.mp3` → `video-view`, `…/archive.zzz` → `monaco`. Before US-1517 every one of these
    opened in Monaco. `.mp3` resolves to the player but cannot yet *play* — that is US-1519.
  - **Items 2-4.** A 300 MB resource opened and seeked to its last 64 bytes in ~2 ms, byte-verified
    against the fixture's deterministic generator, with the provider's `readBinary` counter still
    at zero — so no whole-resource read happened at any point.
  - **Item 9.** The fixture's second provider (`test/norange`, no `readRange`) behaved exactly as
    before: buffered reads, and a 300 MB request correctly refused, so the 256 MB ceiling still
    holds where it should.
- **D6's premise confirmed by measurement.** The fixture's `stall=1` scenario failed at ~10 005 ms,
  not indefinitely — `SERVICE_REQUEST_DEADLINE_MS`. That is exactly the deadline US-1518 removes,
  and it is now reproducible on demand rather than argued from the source.
- Two cosmetic defects noticed while verifying, neither in scope here, both worth a look later: a
  board-scheme tab is titled with the query string included (`notes.md?size=200`), and the media
  player titles its tab `Video Player` rather than the file name. Recorded, not fixed.
- US-1518 implemented and **verified by measurement**: the fixture's `delay=20000` scenario now
  completes in 20 074 ms with no error, where before this task every provider read failed at
  ~10 005 ms (`SERVICE_REQUEST_DEADLINE_MS`). D6's "a content read waits as long as the content
  takes" is now true in the running app rather than on paper.
- **D6's correction, recorded above in place.** The claim that waiting reads could block the board's
  own *delete* action was wrong: `app.boards.requestService()` and the board frame's
  `persephone.service.request()` route through main (`boards.ts:411-419` says so explicitly, with
  the reason), landing in `record.requests` (`module-service-supervisor.ts:328`) — a different map,
  process and transport from the renderer's `client.pending` (`module-service.ts:290`). The real
  risk is narrower and still addressed. Found during US-1518's investigation.
- A **fourth** deadline site was found that no earlier reading of this epic had named:
  `handleRendererRequest()` in `module-service-host.mjs` runs its own `setTimeout(…, deadlineMs)`
  independent of `withDeadline()`. Removing only the three sites D6 listed would have left the fix
  silently incomplete.

### 2026-09-26 — US-1518's no-deadline rule had a hole, found by US-1521's first measurement

**`stat` kept a deadline while `readBinary`/`readRange` lost theirs, so `content.open()` without
`timeoutMs` failed at 10 007 ms** despite D6 promising it waits. Measured against the fixture, not
reasoned about.

The cause is worth recording because it is not where it looks. The renderer and main both already
sent `stat` the `Infinity` sentinel — `ProxyProvider.stat()` passes it. But
`assets/module-service-host.mjs` does not receive a per-request deadline at all: its `deadlineMs`
is a **process-level constant from argv**, and US-1518 expressed "no deadline" there as a hardcoded
operation list, `CONTENT_READ_OPERATIONS = {readBinary, readRange}`. `stat` was not in it, so the
host's outer timer — and `withDeadline()`'s race — still bounded it. This was the fourth deadline
site doing exactly what US-1518's own note warned a missed site would do: degrade silently to 10 s
rather than hang.

**Fixed by splitting one predicate into the two questions it was conflating**, which US-1518 could
not distinguish because it only had two operations:

- *Released by cancellation rather than a deadline?* — now `UNBOUNDED_OPERATIONS`, which adds
  `stat`. `content.open()` sizes eagerly, so its `stat()` is on the same critical path as the reads
  that follow and must wait the same way.
- *Exempt from the 32-slot control-request cap, and counted as an outstanding content read?* —
  still `CONTENT_READ_OPERATIONS`, and `stat` is deliberately **not** in it. That budget is what
  guarantees a board's own `delete` gets through while reads are outstanding (D6). Exempting a
  metadata call would erode the very escape hatch D6 depends on.

`stat` now also receives the `AbortSignal`, because with no timer cancellation is its only release.

Verified both directions after the change: no `timeoutMs` → **still pending at 16 013 ms**;
`timeoutMs: 2500` → **rejected at 2502 ms**. The fixture's `stat()` had to be taught to honour its
own `delay`/`stall` controls first — it did not, which is why US-1521's first pass reported this
scenario as passing when it was never exercised.

### 2026-09-26 — a consequence of D6 the user should decide on

**A source that stalls on its FIRST read now opens no page at all, and there is nothing to close.**
Measured, not inferred: `pages.openUrl()` resolves only *after* the first read completes — the
20 s scenario returned at 20 074 ms and the tab appeared only then. The content pipeline creates
the page after resolving content, so while the first read is outstanding there is no tab, no
spinner and no error.

This is **pre-existing pipeline behaviour, not something US-1518 introduced** — but US-1518 removes
the bound that was hiding it. Before, a dead source failed at 10 s with a visible error. Now it
waits forever, and D6's stated escape hatch ("the user closes the page") does not exist for this
case, because no page was ever created. Clicking a file in a torrent whose swarm has no seeders
would look exactly like clicking nothing at all.

The follow-up already deferred by user decision — *a pipe-level loading indicator*, recorded in the
roadmap's "After the roadmap" section — is what closes this, and this measurement makes it concrete
rather than speculative.

**RESOLVED 2026-09-26 (user decision).** The indicator stays **out of scope for EPIC-113 and
EPIC-114**, to be implemented later. Raised as possibly in-scope for EPIC-114 given the measurement
above; the user chose to keep it out and ship the torrent board without it.

**The user's reasoning, which is what makes it a later task rather than a smaller one**
*(2026-09-26)*: the editor should open **instantly**, as soon as the editor for the link is
resolved. Building the pipe happens after that, or in parallel, and the progress indicator appears
**immediately** — not when the first bytes arrive. Under that model the stalled-first-read case
stops being special: there is always a tab, and it always shows that it is working.

That is a restructuring of the open path, not an addition to it. The ordering today, verified:
`PagesLifecycleModel.openFile()` (`:456`) awaits `createEditorFromFile()`, which ends in
`await editor.restore()` (`:233`) — the first read — and only then calls `this.addPage(adapter)`
(`:519`). The page is therefore a *consequence* of a completed read. Inverting that means a page
and its editor must be able to exist against a pipe that has produced nothing yet, and every
editor's `restore()` must tolerate running against an already-mounted view.

**Half the groundwork is already done, by US-1517 in this epic.** Which editor a link deserves is
now resolved from the link alone — `resolveEditorIdForFile(url, effectivePath)` needs no bytes —
so "open the editor first" has the answer it requires before any read starts. What remains is the
page-creation ordering and the indicator itself.

Until then, a torrent file whose swarm has no seeders presents as a click that did nothing.

Deliberately NOT worked around by keeping a deadline on the first read: that would reinstate the
arbitrary number D6 removed, and it would fire exactly where the user said waiting is correct.
