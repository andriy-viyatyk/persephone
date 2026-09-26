# EPIC-114: The torrent board — a module contributes below the UI

## Status

**Status:** Active
**Created:** 2026-09-26
**Completed:** —

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

US-1478 needs a product decision (cancel the download and open the source URL, versus save first and
hand the saved path to `openRawLink`) and is scheduled **last**, so the rest of the epic is not
blocked behind it.

**D11 — A board-claimed link with NO file name opens the claiming board.**

*(Found while reviewing US-1523's plan, 2026-09-26. This is the platform change the epic needs, and
the only one.)*

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
board-claimed `magnet:` link resolves to an empty file name, falls through to `"monaco"`, and opens
**Monaco on a torrent pipe**.

That is worse than today, where nothing routes a magnet at all. So the board must **not** claim
`magnet` until this is fixed — US-1523 declares `schemes: ["torrent"]` only, deliberately.

**The rule:** when a board-claimed link yields **no file name at all**, the target is the claiming
board's own editor rather than `"monaco"`. When it yields a file name, nothing changes.

The narrowness is the point. The fallback must trigger on an *absent* file name, **not** on an
*unrecognised extension* — otherwise `archive.zzz` would open the claiming board and break EPIC-113
acceptance item 1 ("an extension nothing claims still opens Monaco"), which was verified in the
running app. Those two cases both reach the `|| "monaco"` arm today and must be separated.

This needs no manifest field: a board that claims a scheme already declares `editorName` /
`editorKind`, which is the editor to target.

**Owned by US-1525**, the task that builds the page a magnet should open — landing the platform
change and the `magnet` declaration together, so the scheme is never claimed while it would
misroute. *This corrects roadmap §3.8 step 1's "already done and needs no work" note, which is true
of the Browser and false of the pipeline; the correction goes back into the roadmap at epic close.*

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
| US-1523 | The board skeleton: manifest, vendored WebTorrent bundle (D3), and a service that resolves a magnet to metadata (D1, D2, D8) | Planned |
| US-1524 | The `torrent` content provider: `stat` + `readRange` + `readBinary`, the self-contained link (D5), piece prioritisation (D9) | Planned |
| US-1525 | The board page: torrent list, file list, double-click → `openRawLink`, Download-this-file — **plus D11's platform change** and the `magnet` scheme declaration | Planned |
| US-1526 | Lifecycle: page close stops the stream, cold-start restore with no board page, service stop, uninstall placeholder | Planned |
| US-1478 | Route a downloaded `.torrent` (and other board-claimed downloads) into `openRawLink` (D10) | Planned |
| US-1527 | Documentation: roadmap §3.8 + Phase E corrections, `boards.md`, the board's own guides | Planned |

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
   risk.
9. Uninstalling the board shows the placeholder, and a `torrent://` restore with the board absent
   degrades cleanly rather than throwing.
10. `.torrent` opened from disk works via `fileMasks`; the Browser-download path is US-1478.

## Concerns / open questions

- **US-1478 needs a product decision** (D10) — raised when that task is planned, not now.
- **D6's memory growth** is bounded only by behaviour. Acceptance item 8 measures it; if the number
  is bad, an eviction store is the follow-up.
- **Peer availability with TCP only** (D7) may make some magnets slow or unusable. The Sintel magnet
  the spike used is the reference case for acceptance.
- **Legal/content framing.** The board is a viewer for links the user already has, and the epic's
  test corpus is the public-domain Sintel torrent WebTorrent itself publishes.

## Notes

### 2026-09-26 — the epic starts with its riskiest assumption already tested

The spike above was run before this document existed, because the roadmap's "port ~500 lines"
framing hid four failures that would each have surfaced as a confusing dead end mid-implementation —
one of them (D2) invalidating the port target entirely. The cost was one scratch folder; the return
is that every decision here rests on an observed result rather than on a plan.
