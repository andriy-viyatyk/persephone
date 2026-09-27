# EPIC-114: The torrent board — a module contributes below the UI

## Status

**Status:** Completed
**Created:** 2026-09-26
**Completed:** 2026-09-27

## Overview

Phase E part 2 of the [platform roadmap](../platform-roadmap.md). [EPIC-113](EPIC-113.md) built
every seam this needs and proved each one against a synthetic fixture; EPIC-114 is the **first real
consumer** of them, and the first time a module outside the core contributes below the UI rather
than beside it.

The shape, in the user's terms: open a magnet link or a `.torrent` file, see the torrent's files
listed, double-click one, and *Persephone* opens it — Monaco for a `.txt`, the image viewer for a
`.jpg`, the built-in media player for an `.mp4` — with the bytes pulled out of the swarm on demand
by the board's provider. No download completes first. Nothing is written to disk.

The user asked for this to be built to my own judgement — *"I do not have clear vision how that
board should look"* — with a review and an adjustment pass afterwards. So this document commits to
a concrete design rather than listing options, and **§UI design** exists to be argued with.

### What EPIC-113 already gives this epic

Nothing in the list below is invented here; all of it shipped and was measured:

| Need | Shipped as |
|---|---|
| A board-scheme link opens the *right* editor, not always Monaco | US-1517 |
| A provider serves a `Range` without reading its whole resource | US-1474 |
| A read that takes minutes completes instead of timing out at ~10 s | US-1518 |
| The media player plays from a pipe, in-page **and** in VLC | US-1519 |
| `persephone.content.open(link)` → a ranged URL, for the board's own UI | US-1521 |

The practical consequence: this epic writes a board, not a platform. If it finds itself needing a
platform change, that is a finding worth recording — EPIC-113's own value came mostly from the
three decisions it proved wrong.

## Feasibility spike — run before this document was written, 2026-09-26

The roadmap's Phase E step 1 says "port av-player's main-process code (~500 lines)". Four
assumptions inside that sentence were tested before planning, in plain Node against the
public-domain **Sintel** magnet that WebTorrent itself publishes as its example torrent.

**Result: the full provider contract works end to end.**

```
METADATA OK: Sintel  files: 11
   129241752  Sintel\Sintel.mp4
   …
RANGE OK: 65536 bytes; head: 000000206674797069736f6d      ← "ftypisom", a real MP4 header
```

Metadata resolved from the swarm, every file deselected, one file selected, a bounded 64 KiB range
pulled and byte-checked — which is precisely what `readRange` has to do. Both unbundled and from a
1.74 MB single-file bundle.

Four findings, each of which would otherwise have been met cold during implementation:

1. **av-player's WebTorrent 2.8.4 no longer works at all.** With today's `parse-torrent` 11.0.24,
   `webtorrent@2.8.5` throws `ERR_INVALID_ARG_TYPE` inside `Torrent._onTorrentId` —
   `arr2hex(parsedTorrent.infoHash)` receives `undefined` — before any network activity. The same
   magnet resolves fine on `webtorrent@3.0.21`. See **D2**.
2. **WebTorrent 3 changed the chunk-store contract.** av-player passes `store` as a *factory
   function*; v3 calls `new this._store(...)` and throws `this._store is not a constructor`. Pass
   the class itself. This is a silent break in code that looks copy-pasteable.
3. **Bundling needs a `createRequire` banner.** Without it the bundle dies on
   `Dynamic require of "fs" is not supported` (from `is-file`, reached via `parse-torrent`). Met
   cold, this reads as "WebTorrent does not work in Electron", which is false.
4. **No native module is needed.** `bufferutil`, `utf-8-validate`, `node-datachannel` and
   `utp-native` all stay unbuilt; WebTorrent logs `uTP not supported` and proceeds over TCP. See
   **D7**.

## Goals

1. A magnet link or a `.torrent` file opens a **torrent board page** listing the torrent's files,
   with sizes, having downloaded nothing but metadata.
2. Double-clicking a file opens it in **Persephone's own editor for that file type**, streaming
   from the swarm — the §3.8 worked flow, observed on a real magnet.
3. Seeking in the media player re-prioritises pieces, and the bytes between are never fetched.
4. Closing the page stops the stream; the torrent keeps running only if the board says so.
5. A restored page on a cold start re-establishes its stream without the board page being open.
6. Nothing is written to disk, and nothing is seeded as a feature.

## Non-goals

- **A torrent client.** No download queue, no seeding UI, no ratio tracking, no scheduler. See D1.
- **WebRTC / browser peers.** The pilot is a plain TCP BitTorrent peer (D7).
- **A pipe-level loading indicator.** Deferred by user decision on 2026-09-26 and confirmed out of
  scope for this epic in the roadmap — the editor should open as soon as the link resolves, which
  is a separate refactor.
- **Tor / proxy routing.** av-player carries `tor.ts` and `network-proxy.ts`; neither ports here.
- **Bundling the board.** It is a catalog download (EPIC-113 D1).

## Decisions

**D1 — The board is a VIEWER, not a torrent client.**

*(User decision, recorded in the roadmap.)* Resolving a torrent fetches **metadata only** and
deselects every file. Bytes move only when a provider range asks for them. Nothing is written to
disk; nothing is seeded as a feature. "Download this file" exists as one explicit per-file request,
not as the default mode.

This is the product rule, and it is also what makes the epic tractable: a viewer needs no download
manager, no disk layout, no resume, no ratio policy.

**D2 — WebTorrent 3.0.21, not the 2.8.x av-player ships.**

*(Spike finding 1.)* The roadmap says "port av-player's main-process code". That code is pinned to
`webtorrent@^2.8.4`, which today resolves to a combination that **cannot parse a magnet link at
all**. Rather than pin a stale transitive tree to keep a port literal, the board takes
`webtorrent@3.0.21`, which the spike verified against a live swarm.

The cost is that the port stops being a copy: v3 moved the chunk-store contract (spike finding 2)
and the API differs in places. Given D4 already discards the larger half of av-player's code, this
is a small additional cost for a dependency that is maintained.

**D3 — Vendor a built bundle in `lib/`, not `node_modules/`.**

Every board in `persephone-boards` vendors into `lib/`, and the repo's `.gitignore` excludes
`node_modules/`. An unbundled WebTorrent is **45 MB across 172 packages**; the esbuild bundle is
**1.74 MB in one file** — comfortably under `pdf-viewer`'s 11 MB, today's largest board.

```
esbuild entry.mjs --bundle --platform=node --format=esm --outfile=lib/webtorrent.bundle.mjs \
  --external:bufferutil --external:utf-8-validate --external:node-datachannel --external:utp-native \
  --banner:js='import{createRequire as __cr}from"node:module";const require=__cr(import.meta.url);'
```

The banner is load-bearing (spike finding 3). The four externals are the optional native modules
(D7). A `scripts/build-webtorrent.mjs` in the board folder regenerates it, so the vendored artifact
is reproducible rather than mysterious — the same reason the repo keeps other boards' build steps.

**D4 — av-player's streaming server and protocol handler do NOT port.**

`streaming-server.ts` (70 lines) and `registerTorrentProtocol()` plus `handleVideoRequest()` (~110
lines of `torrent-proxy.ts`) exist to turn a torrent file into an **HTTP resource with `Range`
support**, because av-player had a `<video>` tag and nothing else. Persephone's provider contract is
a **bounded pull**: `readRange(config, { start, end })` returns bytes, and the platform owns the
`Range` plumbing, the URL, and the response.

So roughly 180 of av-player's ~370 relevant lines are deleted rather than ported, and the piece that
survives — `file.createReadStream({ start, end })`, buffered to the reply — is about fifteen lines.
This is the clearest evidence that EPIC-113 built the right seam.

What *does* port, in substance: client construction, metadata resolution with a timeout, the
deselect-everything rule, `findTorrentByInfoHash`, the select/deselect prioritisation around a read,
and teardown.

**D5 — The link is self-contained: it carries the magnet.**

The roadmap specifies `torrent://<infohash>/<path>`. That is not restorable. A pipe descriptor
persists the **full href** and nothing else (it is what reaches the provider as `config.url`), and a
provider can be asked for bytes on a cold start with **no board page open** — the service is started
by the provider, not by the UI. An infohash alone cannot re-add a torrent: there are no trackers and
no peers in it.

So the link is:

```
torrent://<infohash>/<url-encoded path inside the torrent>?magnet=<url-encoded magnet URI>
```

The board also keeps its own registry of added torrents for the list UI, but **the provider never
depends on it**. Restore works because the link is complete, not because the board remembered.

*This corrects the roadmap's §3.8 step 5 and Phase E step 1; the correction goes back into
`platform-roadmap.md` at epic close.*

**D6 — `memory-chunk-store`, with the growth risk recorded.**

D1 says nothing is written to disk, so the store is in memory. `memory-chunk-store` has **no
eviction**: every piece downloaded stays resident, so a long watch of a large file grows RAM roughly
with the bytes streamed. The pilot's bound is behavioural — one file selected at a time, everything
else deselected — not structural.

This is accepted for the pilot and **measured at acceptance** (item 8). If it proves unacceptable,
the fix is a small eviction store, not a disk store, because the disk rule is a product decision.

**D7 — No native modules; TCP peers only.**

`bufferutil` / `utf-8-validate` are `ws` accelerators, disabled the way av-player does it
(`WS_NO_BUFFER_UTIL=1`, `WS_NO_UTF_8_VALIDATE=1` set before import). `node-datachannel` is WebRTC —
i.e. browser peers — and `utp-native` is µTP. All four are external to the bundle and absent at
runtime; WebTorrent degrades to TCP and says so. The roadmap already scoped the pilot this way
("no WebRTC/native addon in the pilot"); the spike confirms nothing else breaks.

Consequence worth stating: the board cannot reach WebRTC-only swarms, and some magnets will find
fewer peers than a desktop client would.

**D8 — Metadata resolution has a deadline; a content read does not.**

These are different operations and EPIC-113 settled the second one. Resolving a magnet is a
**control** operation: it is bounded work with a definite answer, and it keeps av-player's 30 s
timeout so a dead magnet reports a failure instead of a spinner. A `readRange` is a **content**
operation and is governed by US-1518 — no deadline, released by the page closing.

`UNBOUNDED_OPERATIONS` in `module-service-host.mjs` already encodes exactly this split, so the board
gets the behaviour by using the right operation for each job.

**D9 — Piece prioritisation is the read's job.**

`readRange` selects the file being read and deselects the rest, then streams the bounded range. The
roadmap calls demand-driven prioritisation "how a torrent client learns which pieces to prioritise",
and with a bounded-pull provider it falls out for free: a seek issues a range near the new position,
and that range is what re-points the swarm.

**D10 — `.torrent` files and magnet links are two entry points, and only one is free.**

A magnet link reaches the board through `registerScheme("magnet")`. A `.torrent` file reaches it
through `fileMasks: ["*.torrent"]`. But a `.torrent` **downloaded in the Browser** reaches neither:
`will-download` in `src/main/download-service.ts` takes it and opens it with `shell.openPath`, so it
never enters the content pipeline. That is the pre-existing **US-1478**, which moves under this epic
because this is the epic that gives it a reason to exist.

US-1478 needed a product decision, and it has one: **D12** settles both the declaration (a board's
own `browserUrlMasks`, never `fileMasks`) and the behaviour (cancel before the save dialog, hand the
source URL to `openRawLink`, write nothing). It stays scheduled late so the rest of the epic is not
blocked behind it.

**D11 — A board-claimed link with NO file name opens the claiming board.**

*(Found while reviewing US-1523's plan, 2026-09-26. Mechanism corrected, and scope widened, while
reviewing US-1525's plan the same day — see the note at the end of this decision.)*

EPIC-114 goal 1 — a magnet link opens the torrent board — has **no mechanism today**, and the gap is
not where the roadmap assumed. The roadmap says step 1 is free because `browser-service.ts` routes
any non-Chromium protocol to the renderer. It does. The failure is one layer later.

A board that claims a scheme gets `createBoardSchemeHooks`
(`custom-editor-registry.ts:187-215`), whose `resolve` hook **always** builds a content pipe and then
picks the editor from the file name:

```ts
data.target = data.target
    || resolveEditorIdForFile(data.url, schemeEffectivePath(data.url))
    || "monaco";                                    // :207-209
```

and `schemeEffectivePath` is `new URL(url).pathname.split("/").pop()` (`:179-185`). A magnet URI is
**opaque, not hierarchical** — `new URL("magnet:?xt=urn:btih:…").pathname` is `""`. So a
board-claimed `magnet:` link resolves to an empty file name and opens **Monaco on a torrent pipe**.

**How it reaches Monaco matters, and the first version of this decision got it wrong.** It does
*not* fall through to the `|| "monaco"` arm. `resolveEditorIdForFile` opens with
`const match = matchPath || filePath` (`:578`), so an empty effective path falls back to the
**whole magnet URI** as the match string — and Monaco's matcher is `acceptFile: () => 0`
(`editor-matchers.ts:47-49`), an unconditional catch-all that beats the `-1` floor. The call
therefore *returns* `"monaco"`.

The consequence is the one that governs the fix: **the `|| "monaco"` arm is dead code for any
non-empty `data.url`.** Editing it would change nothing. The empty-name branch must be taken
*before* `resolveEditorIdForFile` is called, because after the call there is no failure signal left
to branch on — and any later "simplification" that folds the check back into the `||` chain
silently restores the bug.

That is worse than today, where nothing routes a magnet at all. So the board must **not** claim
`magnet` until this is fixed — US-1523 declares `schemes: ["torrent"]` only, deliberately.

**The rule:** when a board-claimed link yields **no file name at all**, the target is the claiming
board's own editor rather than `"monaco"`. When it yields a file name, nothing changes.

The narrowness is the point. The fallback must trigger on an *absent* file name, **not** on an
*unrecognised extension* — otherwise `archive.zzz` would open the claiming board and break EPIC-113
acceptance item 1 ("an extension nothing claims still opens Monaco"), which was verified in the
running app. Both cases resolve to Monaco today by the same call, and only the effective path
distinguishes them.

This needs no manifest field: a board that claims a scheme already declares `editorName` /
`editorKind`, which is the editor to target. `createBoardSchemeHooks` is constructed at `:459-462`
inside a loop where the owning `boardRoot` is in scope, and `boardEditorId(boardRoot)` (`:64-65`)
turns it into the id — so the claiming board's editor is available without threading anything new
through the registry.

**Scope, corrected 2026-09-26 — D11 also covers the source handoff, and that is a second platform
change.** Routing a magnet to the board is half a feature: the board page then has no way to learn
*which* magnet opened it. The handshake carries only `filePath` and `materialize`
(`board-bridge-channels.ts:270-281`; `board-shim.ts:926-942`), and `getFilePath()` is the wrong
tool because it materialises a non-local source. The raw magnet *is* already persisted — the board
provider sets `sourceUrl` from `config.url` (`content/registry.ts:483-496`) and the open handler
copies it to `sourceLink.url` (`open-handler.ts:20,29-30`) — it is simply not exposed.

So D11 grows one narrow, non-materialising accessor: `sourceUrl` on the handshake, settled once
like `filePath`, read through `persephone.getSourceUrl()`. The epic's earlier claim that D11 was
the *only* platform change is superseded rather than quietly widened; this is the second and the
last. A plain board must still settle it to `undefined` rather than hang, which is the failure mode
this pattern has already had once.

**Owned by US-1525**, the task that builds the page a magnet should open — landing the platform
change and the `magnet` declaration together, so the scheme is never claimed while it would
misroute. *This corrects roadmap §3.8 step 1's "already done and needs no work" note, which is true
of the Browser and false of the pipeline; the correction goes back into the roadmap at epic close.*

**D12 — A board claims browser URLs with its OWN declaration, separate from `fileMasks`.**

*(User decision, 2026-09-27, answering D10's open product question and widening it.)*

The user's framing: *"a board can register either a protocol or a url mask that the browser should
check — if one is registered and the browser detects it, the link goes to the board that registered
it."* And then, on being asked whether `fileMasks` could carry the URL claim: *"file mask is the
file mask and browser url is browser url. They may not be the same things. The board that intends
to handle a specific url should register it explicitly."*

That is the right cut, and it is the whole decision: **editing a file type and intercepting a URL
are two different claims, and a board makes them separately.** A board that edits `.torrent` files
is not necessarily one that wants to take over downloading them.

**The protocol half already exists and is verified working.** A board declares
`contentProviders[].schemes`; the browser cancels any navigation to a non-Chromium protocol and
emits `eOpenPipelineCandidate` (`browser-service.ts:306-308`); the renderer routes it **only if a
board claimed that scheme** — `isSchemeRegistered(scheme)` (`RendererEventsService.ts:85-90`) — and
hands it to `openRawLink`. Measured 2026-09-27: clicking a Sintel magnet link in a Browser tab
opened Torrent Viewer with 11 files listed, metadata only, 16 peers. The mechanism was dormant only
because nothing claimed a scheme the browser would ever see; US-1525's `magnet` claim and D11 lit it
up. **No work is needed for protocols.**

**The URL half does not exist, and it is a download problem, not a navigation problem.** An
`https://…/x.torrent` link is an ordinary Chromium navigation, so the scheme path never sees it;
the server marks it an attachment and it becomes a download. `will-download`
(`download-service.ts:31,86-112`) then shows a save dialog, writes the file, and lists it. No board
is ever consulted.

*(Correcting D10, which said `will-download` "takes it and opens it with `shell.openPath`". It does
not: `shell.openPath` is in `openDownload(id)` (`:49-53`), a **user** action on a completed
download. The "never enters the content pipeline" half of D10 stands; the mechanism does not — and
the difference decides where interception belongs.)*

**The declaration.** A new manifest field, `browserUrlMasks`: globs matched against the whole URL,
normalized like `fileMasks` (trimmed, lowercased, de-duplicated, bounded in count and length).
Globs rather than the regex `contentMasks` use, because these are matched against attacker-adjacent
input and a glob cannot backtrack.

```json
"browserUrlMasks": ["*://*/*.torrent", "*://*/*.torrent?*"]
```

**Both masks, and that is not redundant.** Measured against the shipped matcher 2026-09-27: a mask is
anchored at both ends, exactly like `fileMasks`, so `*://*/*.torrent` matches
`https://x.org/a.torrent` and **fails** `https://x.org/a.torrent?dl=1`. A query string is common on
precisely the pages that serve torrents, so the single-mask form this decision first showed would
have missed them, and the first board author to copy it would have inherited the gap. Anchoring is
kept — an unanchored mask would make `*` mean "contains", which is not what a glob says anywhere
else in this codebase — and the idiom is to declare the query-string form alongside. The bound of
64 masks per board leaves ample room for it.

**Scope: downloads only, deliberately.** A URL mask intercepts `will-download` and nothing else.
Navigation interception is excluded on purpose: a mask like `https://*/*` would let one trusted
board silently capture all browsing, and a download is already leaving the browser — redirecting it
is a lateral move, not a capture. Non-http protocols are already covered by the scheme path above,
which is where `magnet:` belongs.

**Behaviour on match:** cancel the download **before the save dialog** and hand the *source URL* to
`openRawLink`. Nothing is written to disk — which keeps D1 intact and means a board that wants the
bytes fetches them through its own provider, as the torrent board already does. The user is told
what happened, naming the board; a silent change to what a download does is delightful once and
alarming the first time it surprises someone.

**Trust and collisions** follow the existing rules exactly: trusted and bundled boards only, first
registration wins, and a refused claim is recorded as a `CustomEditorRegistrationIssue` like a
refused provider or scheme.

**Owned by US-1478.**

**D13 — A claimed download from a Tor or incognito page is ALLOWED, and fetched on that page's own
session.**

*(User decision, 2026-09-27, answering the defect found while verifying US-1478 live.)*

The user's call: *"let allow opening torrent links from tor and incognito mode."* So the option this
epic takes is **propagate**, not refuse — the board's fetch of a claimed URL must use the
originating page's session, rather than Persephone's default one.

That closes the leak recorded in the Notes entry for 2026-09-27: a `.torrent` claimed from a Tor tab
is fetched over the same circuit the user chose, so the request carries no clear-net identity and no
second, deanonymized copy of it is issued. It also fixes the functional symptom — `webtorrent.io` is
reachable over Tor and not over the measured clear net, and today the board fails on exactly the
hosts Tor exists to reach.

**What propagation does NOT buy, and this is the part the user must be told.** The fetch is one
request; the torrent is a swarm. Once metadata resolves, WebTorrent opens peer connections and
tracker announces **directly**, over the clear net, and every peer in that swarm learns the user's
real IP. Routing BitTorrent over Tor is a documented deanonymization path and is not something this
board will attempt. So a user who opens a torrent from a Tor tab and assumes end-to-end anonymity
gets the opposite of what they assume — which is strictly worse than today, where the fetch simply
fails and nothing happens.

**Therefore the feature ships with a sentence, not a gate.** When a claimed download is routed from
a Tor or incognito page, the board says once, plainly, that the metadata was fetched privately but
the swarm connection is not anonymous. **Not a consent dialog and not a permission prompt** — a
trusted board is a user application, and this epic does not add per-API gates. The sentence exists
because letting someone believe a false thing about their own anonymity is a harm that a working
feature does not excuse.

**Scope.** Session propagation belongs to the platform: the claimed-download event already carries
the source URL and the owning board, and must also carry enough to resolve the originating page's
session so `content.open()` reads on it. The board should not be choosing a network identity, and
core must not learn which board claims `torrent:`.

**Owned by [US-1531](../tasks/US-1531-claimed-download-session/README.md).**

**D14 — A single-instance board is single PER WINDOW; its state is shared PER APP.**

*(User decision, 2026-09-27, answering US-1530's first open question: "it should be per window, so
if I have browser in second window and click magnet link then torrent board is open in the same
window. But two torrent boards on different windows should show the same list of active torrent
files.")*

- **Page routing is per window.** A link claimed in a window opens in, or is delivered to, that
  window's board page — never focusing or pulling in a page from another window. This matches how
  well-known pages already behave.
- **State is per app.** Two windows' board pages show the same torrent list. That is already true by
  construction since US-1529: both pages render the one service's snapshot. US-1530 must not
  introduce any per-page or per-window torrent state that would break it.

Owned by [US-1530](../tasks/US-1530-single-instance-boards/README.md).

## UI design

Deliberately plain, and written to be argued with after the user sees it. Two panes in one page:

```
┌─ Torrents ──────────────┬─ Files in “Sintel” ─────────────────────────┐
│ ● Sintel                │  Sintel.mp4                    123.3 MB  ▸  │
│   12 peers · 340 KB/s   │  poster.jpg                     45.0 KB  ▸  │
│                         │  Sintel.en.srt                   1.5 KB  ▸  │
│ ○ ubuntu-24.04          │  Sintel.de.srt                   1.6 KB  ▸  │
│   metadata only         │  …                                          │
│                         │                                             │
│ [+ Add magnet or file]  │  double-click → opens in Persephone         │
└─────────────────────────┴─────────────────────────────────────────────┘
```

- **Left:** torrents added this session. Name, peer count, current rate, and a state dot — metadata
  only / streaming / stalled. Remove from the context menu.
- **Right:** the selected torrent's files, name and size, sorted by size descending so the thing
  worth opening is first. Icons come from the file name.
- **Double-click a file** → `persephone.openRawLink("torrent://…")`. No target named; Persephone
  picks the editor (D2 of EPIC-113). This is the epic's whole point in one gesture.
- **Context menu on a file** → *Open*, *Open in new tab*, *Copy link*, and **Download this file**,
  which is D1's one explicit exception: it selects the file and writes it to a path the user picks.
- **No progress bars per file.** They would imply a download queue that does not exist (D1), and the
  pipe-level indicator is explicitly deferred.

Theme via `board-base.css` and the bridge's theme tokens, like every other board.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1523 | The board skeleton: manifest, vendored WebTorrent bundle (D3), and a service that resolves a magnet to metadata (D1, D2, D8) | Completed |
| US-1524 | The `torrent` content provider: `stat` + `readRange` + `readBinary`, the self-contained link (D5), piece prioritisation (D9) | Completed |
| US-1525 | The board page: torrent list, file list, double-click → `openRawLink`, Download-this-file — **plus D11's routing fix and source handoff** and the `magnet` scheme declaration | Completed |
| US-1526 | Lifecycle: page close stops the stream, cold-start restore with no board page, service stop, uninstall placeholder | Completed |
| US-1478 | `browserUrlMasks`: a board claims browser URLs explicitly, and a matching download is routed to it instead of saved (D12) | Completed |
| [US-1527](../tasks/US-1527-torrent-board-documentation/README.md) | Documentation: roadmap §3.8 + Phase E corrections, `boards.md`, the board's own guides | Completed |
| [US-1529](../tasks/US-1529-torrent-board-service-snapshot/README.md) | The torrent list comes from the service snapshot, not page-local state | Completed |
| [US-1530](../tasks/US-1530-single-instance-boards/README.md) | Single-instance boards — one page for every link a board claims | Completed |
| [US-1531](../tasks/US-1531-claimed-download-session/README.md) | A claimed download is fetched on the originating page's session (D13) | Completed |

**Suggested order:** US-1523 → US-1524 → US-1525 are a straight line, each observable in the running
app. US-1526 needs all three. US-1478 is independent and carries a product question, so it is
scheduled late rather than early. US-1527 last.

US-1478 moves under this epic from *(no epic)* in [active-work.md](../active-work.md).

## Acceptance

Every row of the roadmap's §3.8 table, observed on a **real magnet link**, plus the failure rows.
Verified in the running app, not only built:

1. A magnet link opens the torrent board page and lists the torrent's files with correct sizes,
   having transferred metadata only — confirmed by the client's byte counters. This exercises
   D11; before it lands, the board does not claim `magnet` at all.
1b. EPIC-113 acceptance item 1 still holds after D11 — a board-scheme link to an extension
   nothing claims (`archive.zzz`) still opens **Monaco**, not the claiming board.
1c. The Demo Board is unchanged where it is exercised today, and the one place D11 *does* change it
   is checked rather than discovered: `mem://demo` has an **empty** effective path (`demo` is the
   authority, not a path segment), so opening it **as a page** now targets the Demo Board's own
   editor. Its `content.open("mem://demo")` use is unaffected, because that route resolves at
   `phase: "source-path"` and returns before the target line. Both observed.
1d. `persephone.getSourceUrl()` on a **plain** board (no scheme source) resolves to `undefined`
   promptly rather than hanging — the same settle-once guarantee `filePath` has.
2. Double-clicking a `.txt`/`.srt` inside the torrent opens **Monaco**, a `.jpg` opens the **image
   viewer**, an `.mp4` opens the **media player** — none of them named by the board.
3. The media player plays an `.mp4` from the swarm while it is still downloading, with **no cache
   file** created (`userData` watcher, as Phase D and EPIC-113 item 5 did).
4. Seeking to the last minute of a large video starts playing there promptly, and the provider's
   range log shows **no read of the bytes in between**.
5. Closing the page stops the stream — the swarm rate drops to zero — and the torrent remains
   listed if the board says so.
6. A restored media page on a **cold start** re-establishes its stream with the board page never
   opened, proving D5's self-contained link.
7. A dead magnet (no peers) reports a metadata failure within ~30 s rather than hanging (D8), while
   a *slow but live* read is not killed by any deadline (US-1518).
8. Peak RSS of the service process is recorded while streaming ≥200 MB of a file, as D6's measured
   risk. **Measured 2026-09-27 — PASSES at 440.4 MB against the 512 MiB threshold.** See the Notes
   entry for the ratio that governs it; the pass is a property of the test file's size, not headroom.
9. Removing the board degrades legibly — split into the two paths it actually has, because they
   differ **by design** *(corrected 2026-09-27, while reviewing US-1526's plan; the original
   wording assumed one path and would have licensed changing shared board behaviour)*:
   - **Untrust** → the board page shows the existing untrusted placeholder; an absent folder shows
     the not-found placeholder.
   - **Catalog uninstall** → open board pages go **empty**, which is correct and consented:
     `ensureBoardIdle` asks first and its dialog says *"The page(s) stay open and go empty"*
     (`board-updates.ts:129-135`). This is not a gap to fix, and fixing it inside this epic would
     change behaviour for every installed board.
   - In **both** cases a `torrent://` **content** page whose provider is gone stays a page with a
     legible unavailable state and a recovery notice, rather than throwing or silently vanishing.
     That is the part this epic owns.
10. `.torrent` opened from disk works via `fileMasks`; the Browser-download path is US-1478.

## Concerns / open questions

- ~~**US-1478 needs a product decision**~~ — settled by **D12** on 2026-09-27.
- **D6's memory growth** is bounded only by behaviour. Acceptance item 8 measures it; if the number
  is bad, an eviction store is the follow-up.
- **Peer availability with TCP only** (D7) may make some magnets slow or unusable. The Sintel magnet
  the spike used is the reference case for acceptance.
- **Legal/content framing.** The board is a viewer for links the user already has, and the epic's
  test corpus is the public-domain Sintel torrent WebTorrent itself publishes.

## Notes

### 2026-09-27 — US-1526 verified: restore works, and a failed page cannot be recovered

**Acceptance item 6 passes.** A `torrent://` media page streams with **no board page open**:
`playerState: playing`, `boardPages: 0`. The provider started the service itself and D5's
self-contained link carried the magnet, which is the whole reason that decision exists.

It took three attempts to establish that, and the two failures were more interesting than the pass.

**The failures were not what they looked like.** The first cold-start restore landed in `error`, and
the obvious readings were both wrong: not the missing-board branch (no notification fired, and
`torrent` was registered), and not metadata (a direct provider `stat` returned
`{exists: true, size: 129241752}`). The main-process log had the real cause:

```
Api Error: Error: The video pipe page is not owned by this renderer.
    at createVideoStreamSession
```

**The defect: reopening a `torrent://` link onto a page already in `error` does not recover it.**
`createVideoStreamSession` refuses unless `boardPipeService.ownsPage(pageId, sender)`
(`core-handlers.ts:319-321`), and a reused errored page no longer holds that ownership — it is
registered in `PagesModel.attachPage` (`:69`) and torn down in `detachPage` (`:116`). Measured:

| action | result |
|---|---|
| open the link with **no** existing page | **playing** |
| reopen it onto an existing **playing** page | stays playing |
| reopen it onto an existing **errored** page | stays `error`, ownership throw in the main log |

This matters because of the swarm's bimodality recorded above: a restore *will* sometimes fail, and
when it does the user's only natural recourse — open the link again — is exactly the path that
cannot work. US-1526 gave the *board* a manual retry and left the **content page** without one; this
is that gap, with a concrete mechanism behind it. **Not fixed here** — it needs its own task, since
the fix is in page reuse/ownership rather than anything torrent-specific.

**Still outstanding: acceptance item 8**, the D6 RSS measurement over a ≥200 MB stream against the
512 MiB threshold the plan committed to in advance. Not run.

### 2026-09-27 — `activeReaders` is the wrong signal for "a page is using this torrent"

US-1526's plan review settled the removal rule as *refuse while `activeReaders > 0`*. That was my
call, and verifying it in the app showed it does not deliver what its own message promised.

Observed: with `Sintel.mp4` **playing**, a removal of its torrent was **accepted**, and the snapshot
taken in the same call reported `activeReaders: 0`. The page kept playing from its buffer and would
have failed only when that drained — the worst shape of failure, because it arrives minutes after
the action that caused it.

The cause is that a provider read is **bounded and short**. The media player opens a `readRange`,
drains up to 1 MiB, and closes it; between reads the count is legitimately zero, which is most of
playback. So `activeReaders > 0` protects only an in-flight read — a genuine and worth-keeping
guarantee, but a far narrower one than *"this torrent is being read by an open page"*, which is
what the refusal told the user.

Fixed by asking the honest question instead: a torrent is in use while it has an active reader
**or** was read within `RECENT_READ_WINDOW_MS` (30 s). A playing page reads every few seconds, so
that covers playback; a page closed a minute ago stops protecting a torrent the user wants gone.
The refusal message now matches the mechanism ("in use by an open page — close it, wait a few
seconds, then remove").

The general lesson, and it is the same one D1 taught in US-1523: **a counter that is true at the
moment you sample it is not the same as the condition you meant.** "Is a read in flight?" and "is
something consuming this?" differ by exactly the duty cycle of the reads, and the plan — mine —
conflated them.

### 2026-09-27 — D8 measured at last, and a second timer that pre-empts it

D8's 30-second bound was inherited from av-player without measurement, and the epic has been
carrying that as a known weakness since US-1524. It is now measured: eight resolutions of the live
Sintel magnet, fresh client each time, `deselect: true` and the memory store — the same shape the
service uses — with a 60 s cap set deliberately above the bound so a slow success would still show.

| | first sample (8 runs) | later sample (3 runs) | combined |
|---|---|---|---|
| resolved | 8 / 8 | 2 / 3 | **10 / 11** |
| p50 of successes | 4 750 ms | 2 966 ms | ≈ 3 400 ms |
| min / max of successes | 2 683 / 5 200 ms | 2 591 / 2 966 ms | **2 591 / 5 200 ms** |
| failed even at a 60 s cap | 0 | **1** | 1 |

The second sample is the informative one, and it **corrects the framing of the first**. I initially
read 8/8 as "the bound has ~6× headroom over the tail". There is no tail. The distribution is
**bimodal**: a resolution either lands in **2.5–5.2 s** or does not arrive at all — the one failure
was still unresolved at **60 s**, twice D8's bound, on the same magnet that had answered in under
three seconds minutes earlier.

That makes the conclusion stronger, not weaker. **Lengthening the bound converts no failures into
successes**, because the failures are not slow — they are absent. A 60 s cap failed on exactly the
attempt a 30 s cap would have. The same shape produced the half-hour outage recorded on
2026-09-26, and two consecutive in-app resolutions that were still pending at ≈26 s during
US-1526's verification.

So the bound stays at 30 s, and the only thing that actually recovers a transient swarm is asking
again — which is why US-1526 adds a **manual** retry rather than a longer timer or an automatic
one. It also means acceptance must not treat a single failed resolution as a defect: the honest
pass condition is that failures are *legible and retryable*, not that they never happen.

**A second timer makes the first one mostly theoretical.** The service holds both:

```
const METADATA_TIMEOUT_MS = 30_000;   // service.mjs:6  — D8's bound
const NO_POLL_TIMEOUT_MS  = 15_000;   // service.mjs:8  — reaps unpolled jobs
```

The watchdog cancels any resolution whose status has not been polled within 15 s
(`service.mjs:605-608`) — **half** the bound it coexists with. So a resolution reaches D8's 30 s
only while something polls it continuously. Measured on the real product path, a dead magnet ended
at 29.7 s as `state: "cancelled"`, reason `torrent-resolution-no-status-poll` — the watchdog, not
the timeout, because the polling gap exceeded 15 s.

That is a live defect and not only a measurement nuisance: a hidden board page's frame is torn down
(`WebContents not found or destroyed` on an inactive board page), so **switching tabs mid-resolution
cancels the resolution at 15 s**, surfacing an internal token rather than a sentence. It reads as
"torrents randomly fail to load". **Owned by US-1526.**

The narrower lesson for acceptance: an elapsed time of ≈30 s does not identify *which* timer fired.
Any D8 verification must assert on the failure **reason**, not the duration.

### 2026-09-26 — US-1525 verified: the epic's headline gesture works, and two defects only the app showed

The §3.8 flow, observed end to end on the Sintel magnet. The magnet opens **Torrent Viewer** (D11),
lists 11 files largest-first, and transfers **0 bytes over 15 s with 16 peers**. Double-clicking
`poster.jpg` opens **image-view**; double-clicking `Sintel.mp4` opens **video-view** with
`playerState: playing`, streaming from the swarm. Neither editor was named by the board. Closing the
video page returns transfer to **0 bytes over 15 s with 19 peers still connected** — the torrent
stops asking without losing the swarm, which is the D1 distinction. `archive.zzz` still opens
**Monaco**, so EPIC-113 acceptance item 1 survives.

**Two defects surfaced only in the running app**, and both would have passed any out-of-app check:

1. **A board opened plainly still carries a `sourceLink.url`** — the `persephone-board://` link
   that opened the board itself. `getSourceUrl()` returned it, the board fed its own page URL to
   its resolver, and every plain open raised *"Invalid torrent identifier"*. Filtered out in
   `currentSourceUrl()`, plus a board-side guard that only resolves a source it can own. Acceptance
   item 1d passes after the fix: `(undefined)` in 0 ms.
2. **Board-scheme pages were titled with the raw percent-encoded href** — for a torrent link, the
   entire magnet inside the query string. A named link is now titled by its file (`poster.jpg`), a
   nameless one by the claiming board (`Torrent Viewer`).

Neither is exotic. The first fires on the most ordinary way to open the board — clicking it in the
board list — and it shipped through a green typecheck, lint and build.

**Acceptance item 1c could not be tested and is not passed.** It predicted that `mem://demo`, being
an empty-effective-path link, would now open the Demo Board. In this environment `mem` is **not a
registered scheme** (`isSchemeRegistered("mem")` is false), so the D11 branch never fires for it and
`mem://demo` still reaches Monaco by a different route entirely. The residual is real but currently
unreachable; it should be checked if that board's provider is ever registered, not recorded as
verified.

### 2026-09-26 — US-1524 verified, and why out-of-app verification stopped working

The provider works: a 57 MB FLAC inside a 91-file torrent streamed from a live swarm into the
built-in media player, `playerState: playing`, confirmed audible by the user. The file's path
carries spaces, commas, brackets and parentheses across two nested directories, so it exercised
D5's encoding rather than assuming it.

The measurement that matters for D1, taken after closing the page:

| | |
|---|---|
| bytes transferred over 20 s | **0** |
| active readers | 0 |
| all files deselected | true |
| peers still connected | 9 |

The last row is the point. The torrent stops *asking* while still connected, rather than merely
losing the swarm — which is the difference between D1 holding and D1 looking like it holds.

**Metadata resolution failed for a while, and the cause was transient — not the code, and not the
environment.** *(Corrected 2026-09-26, after the first explanation was tested and disproved.)*

For roughly half an hour, every new WebTorrent client timed out fetching metadata, including the
pre-epic spike in this document — same code, same magnet — which had resolved in seconds earlier in
the same session. Persephone's already-running service still had peers throughout.

The first explanation written here was that `node.exe` was firewalled and `electron.exe` was not.
**That was wrong**, and it was wrong in an instructive way: two variables were changed at once — the
magnet (2 trackers → 20) *and* the process (Node → Electron) — and the result was attributed to the
process without testing it. Checked afterwards:

| Test | Result |
|---|---|
| Firewall rules for `node.exe` / `electron.exe` | **none exist**; no block rules either |
| 20-tracker magnet from `node.exe` | metadata in **1 351 ms** |
| 2-tracker magnet from `node.exe` | metadata in **2 182 ms** |

Both magnets, both processes, seconds. The outage was a transient tracker/swarm condition that
recovered on its own.

Worth stating plainly because the board's engine model invites this confusion: a board service runs
in `utilityProcess.fork()`, which is a **plain Node environment** — V8 and libuv, no Chromium and no
browser network stack. Its sockets behave exactly as standalone Node's. Chromium governs only the
board's iframe, which is CSP-locked to `connect-src 'self'` and never reaches the swarm. There is no
"Electron networking" versus "Node networking" distinction to appeal to.

Two consequences survive the correction:

- **A delegated agent's "it timed out" is not evidence the code is wrong.** Codex reported a 30 s
  metadata timeout for US-1524 and the implementation was correct. Verification for the rest of this
  epic happens in the running app, and a green out-of-app check is a smoke test at best.
- **D8's 30-second metadata bound is more brittle than it looks**, and this episode is evidence
  *for* that rather than against it: a swarm can simply stop answering for a while, and the board's
  only response today is a hard failure at 30 s. It was inherited from av-player without
  measurement. US-1526 or acceptance should record a real distribution, and should decide whether a
  retry is warranted, before the number is treated as settled.

### 2026-09-26 — D1 needed one more line than the reference implementation has

US-1523's first live run reported every file deselected **and downloaded 82 MB in seconds** at
4.8 MB/s. Both facts were true at once, which is the whole trap.

`file.deselect()` removes that file's own selection. It does not remove the **torrent-level
selection over the whole piece range** that WebTorrent creates at metadata time unless
`opts.deselect` is set (`webtorrent/lib/torrent.js:155`, `_startAsDeselected`; the option is
documented at `:68` as "create the torrent with no pieces selected"). So a torrent added the
ordinary way downloads everything while truthfully reporting that no file is selected.

**av-player's `torrent-proxy.ts` has this bug too** (`:107-109` deselects each file and nothing
else). It was invisible there because that app is a player that downloads on purpose. Ported
literally, it would have made D1 — the epic's central product rule, and the user's own framing of
what this board is — silently false, while every observable the plan checked said it held.

Fixed by adding `deselect: true` to `client.add`. Measured after: 655 KB total, then **0 bytes over
20 seconds with 22 peers connected**.

The lesson for the remaining tasks: "is it selected?" is not the same question as "is it
downloading?", and only the second one is D1. US-1524 should assert on transferred bytes, not on
selection state.

### 2026-09-26 — a defect the out-of-app check could not have caught

US-1523's service resolved the Sintel magnet correctly from a throwaway Node script and failed in
the app with `Cannot read properties of undefined (reading 'name')`.

`startResolver` is `async` and returns `undefined` — it hands its result to `operation.resolve(…)`
and swallows failures into `operation.reject(…)`. The job wiring awaited the *function's* promise
rather than `operation.promise`, so every job completed with `torrent: undefined` and no job could
ever fail. The out-of-app check passed because it called `resolveTorrent()`, which does return
`operation.promise`; the job path only exists on the board's own request route.

Worth keeping in mind when the later tasks are verified: a check that exercises a different entry
point than the product does proves less than it appears to.

### 2026-09-26 — the epic starts with its riskiest assumption already tested

The spike above was run before this document existed, because the roadmap's "port ~500 lines"
framing hid four failures that would each have surfaced as a confusing dead end mid-implementation —
one of them (D2) invalidating the port target entirely. The cost was one scratch folder; the return
is that every decision here rests on an observed result rather than on a plan.

### 2026-09-27 — D6 measured at last, and the number is a ratio rather than a ceiling

Acceptance item 8, run on the product path: magnet → board → double-click → media player, on Big Buck
Bunny (263 MB, 634.6 s). A seek sweep drove coverage to 92% of the file, so roughly **242 MB** was
fetched — clearing the ≥200 MB bar.

Peak **working set 440.4 MB**, peak private bytes 359.9 MB, against the pre-committed **512 MiB**
(536.9 MB). **It passes, at 82% of budget.**

The samples are the point, not the peak: 206 → 220 → 274 → 305 → 349 → 381 → 432 MB, rising
monotonically with bytes fetched and never falling. That is `MemoryChunkStore` with no eviction,
exactly as D6 predicted, and it means the result is a **ratio: peak RSS ≈ 1.67 × bytes fetched.**
So the threshold is not headroom — a single file over roughly **320 MB would cross 512 MiB**. D6's
no-eviction risk is therefore confirmed as real and merely unhit at this file size; do not read this
pass as "memory is fine".

Two lifecycle behaviours fell out of the same run, both correct and both worth recording:

- **Closing the video page released nothing** (432.6 MB retained), and the board returned to
  *"metadata only"*. That is D5 (the torrent stays resident so a cold-start restore works) and D1
  (no reader, no transfer) holding simultaneously.
- **Removing the torrent stopped the service outright** — the process exited and all 440 MB
  returned to the OS. US-1526's state-based stop working, and the user's only lever against the
  ratio above.

### 2026-09-27 — US-1478 verified live, and it exposed a privacy defect in D12

The platform half works end to end. A Browser navigation to a `.torrent` URL produced **no save
dialog and no download entry** — cancelled before the dialog as D12 specifies — and opened a Torrent
Viewer page titled from the URL, which fetched the file through the board's own provider and
resolved it to 12 files. The registry reported the claim live with both masks and no collisions.

**But D12's cancel-and-re-fetch leaks a Tor user's identity, and this is not a board bug.**

Measured, with a discriminating test. `webtorrent.io` is blocked on the clear net here; archive.org
is not. From a **Tor** browser page:

- `webtorrent.io/torrents/big-buck-bunny.torrent` — the browser reached it over Tor and the
  download fired (which is *why* interception happened), then the board's own fetch of the same URL
  **failed**.
- `archive.org/.../Sintel_archive.torrent` — succeeded, 12 files, 4 peers.

The browser reached a host over Tor that the board could not reach. **The board's provider fetch
does not use the originating page's Tor circuit.** The functional symptom is a failed download; the
real defect is the case where the host *is* reachable on the clear net, because then Persephone
silently re-issues, with the user's real IP, a request they deliberately made anonymously — and
tells them nothing.

This is created by D12's design, not by the torrent board: cancelling a download and handing the URL
to a board means *something else* fetches it, and that something else inherits none of the
originating page's network identity. Any board claiming a URL from an incognito or Tor page has the
same problem.

**Not fixed here.** It needs its own task and a decision: propagate the originating page's session
to the board's fetch, or refuse to route a claimed download from a Tor/incognito page and say why.
Until then D12 is correct for ordinary pages and wrong for anonymous ones.

### 2026-09-27 — US-1529 verified live, and the correction it needed only shows with two pages

Five checks, all on the product path with two board pages open at once:

1. **Both pages list both torrents.** Each showed 2. Page 1 rendered Sintel's full 11-file list —
   and Sintel was resolved by *page 2*. That is the defect the user reported, fixed.
2. **A foreign failure is retained and explained.** Page 2 showed the failed Big Buck Bunny
   resolution — a job it never started — as a row carrying the full sentence and a Retry.
3. **One failure raises one toast.** Exactly one alert existed across both pages.
4. **A foreign torrent's links work.** Opening `Sintel.ru.srt` from page 1 built a link carrying the
   complete magnet query and returned real subtitle text. Had the magnet not reached the row through
   the snapshot the row would have looked perfect and the link would have broken silently — this is
   D5's self-contained link depending on the snapshot extension.
5. **Rendering does not start a stopped service.** With the service cleanly `stopped`
   (`reason: "explicit"`), opening a board page left it stopped and rendered "No active torrents."

**Check 2 is the one that justifies the plan review.** `readResolutionStatus` deleted the job on
first read (`service.mjs:710-711`), so under the shared-state model a resolution started by another
page would, **on failure only**, disappear from every other page with no row and no error — while
succeeding silently by luck, because the torrent still landed in `torrents[]`. Invisible with one
page open. The fix retains terminal outcomes for the existing TTL and removes the destructive read
along with the consuming `status`-without-`requestId` branch.

**A measurement method note, recorded because it wasted a cycle.** Killing the service process to
test the no-start path is **not a valid test**: the supervisor restarts a crashed service, and
`restartCount` incremented with no board page open at all. Proving "rendering does not start a
stopped service" requires a *clean* stop — reached here by adding a torrent and removing it, which
re-verified US-1526's state-based stop as a side effect.
