# US-2135: Torrent Viewer offline metadata mode

Epic: [EPIC-201: Board data and network isolation](../../epics/EPIC-201.md)

## Goal

Opening a local `.torrent` shows its embedded name, files, and sizes without joining or contacting the swarm. Swarm access starts only when a user opens or downloads a file. Magnet links still need network access to fetch metadata.

## Background

EPIC-201's settled Decisions section says `network: false` applies only to the frame's `persephone.fetch()` and that the board service remains an ordinary Node process. Its decision is to give Torrent Viewer offline inspection; this task follows that decision without reopening it or changing host APIs.

The current `scripts/service.mjs` path sends local torrent paths and `.torrent` bytes through WebTorrent `client.add()` with `deselect: true`. The vendored WebTorrent 3.0.21 source calls `_startDiscovery()` from `_onStore()`, and the direct client uses default DHT, tracker, LSD, peer, web-seed, and listener behavior. File deselection prevents content selection; it does not stop discovery.

The board is self-contained and publishes no `node_modules/`. Its committed `lib/webtorrent.bundle.mjs` already bundles WebTorrent 3.0.21 and its `parse-torrent` 11.0.24 dependency. The package's existing `parseTorrent(Uint8Array)` parses locally and returns `infoHash`, `name`, and `files`; `toMagnetURI` supports the existing file link. For an offline row, Save `.torrent` must use the exact original input bytes held in the offline record, so the saved file is byte-identical to the file the user opened.

The board has no AiVision model or separate agent guide. The host guide [AI Vision](../../../assets/guides/agents/ai-vision.md) documents `P.aiVision.expose(root)` and its explicit member allow-list. The board's existing `app.js` reconciles `getServiceSnapshot()` into `serviceTorrents`; this will be the renderer source for an agent-visible mode.

The integration-test guidance prohibits opening a torrent when it starts discovery. Both the UI-test skill and integration-test standard contain that sentence. The published PDF Viewer test generates a synthetic sample in test code, writes it beneath `ctx.fixture()`, opens it with `openPublishedSample()`, and closes/unregisters it in `finally`; this is the pattern for the planned trackerless sample.

## Implementation Plan

1. **Own offline parsing in the board service.** In `C:\projects\persephone-boards\boards\torrent-viewer\scripts\webtorrent-entry.mjs`, export the existing `parse-torrent` default parser and its `toMagnetURI` helper. The current build already bundles this package through WebTorrent, so no new runtime package or node_modules import is needed. In `scripts/service.mjs`, classify local `.torrent` paths and `.torrent` bytes separately from magnet/info-hash strings. Read a local path to bytes and use `parseTorrent()` to make a lightweight metadata record keyed by info hash. Keep the original `.torrent` bytes in that offline record; the offline Save `.torrent` action must write those original bytes unchanged, not re-encode parsed metadata. Reuse `metadataProjection()`'s path normalization and include offline records in `getServiceSnapshot()` with `mode: "offline-inspecting"`. This branch must not call `getClient()`, `client.add()`, or construct WebTorrent discovery/listening resources. Removing an offline row must release its parser metadata and original byte buffer without stopping unrelated active torrents.
2. **Retain the later network transition.** Keep magnet and info-hash metadata resolution in existing `startResolver()`. Keep provider reads in `torrentFileForLink()`: it already calls `resolveTorrent(link.magnet)` before reading the file. When Open or Download uses the existing self-contained `torrent://` link, this creates the network-backed torrent and replaces the offline inventory record without reloading the board. Derive a network-backed row's mode from the existing client/torrent state (`joining-swarm` while peer discovery has started, `connected` when peers exist). Preserve existing network validation, SOCKS5 fail-closed handling, request bounds, removal, and job timers. Do not mutate discovery options on an existing client or add a service operation/message.
3. **Expose mode to agents.** In `app.js`, add a guarded AiVision model and publish it once after DOM wiring using `P.aiVision.expose(appModel)`. Allow-list read-only `mode`, `online`, and `peerCount`. `mode` describes the selected torrent (`offline-inspecting`, `joining-swarm`, or `connected`); `online` reflects whether the service snapshot has a WebTorrent client, not whether Direct/SOCKS5 is configured; `peerCount` comes from the selected row's service snapshot. Include concise help defining each state. Reuse the reconciled `serviceTorrents` and snapshot; no change to `window.persephone` or Persephone host protocol is needed.
4. **Update board UI and user documentation.** Put new English UI messages in `boards/torrent-viewer/lang/en.json`; label local metadata as offline inspection and state that opening/downloading joins the swarm. Keep offline Save `.torrent` byte-identical to the original input bytes stored by the service. Update `board-manifest.json` description and the existing `README.md` to state exactly: local `.torrent` metadata is parsed offline; Open/Download joins the swarm; magnets use the network to fetch metadata; and an HTTP(S) `.torrent` URL uses the network to fetch the torrent file before local parsing. The two board author guides contain no rule requiring every language pack to change, so leave the other 17 packs unchanged. Update `WHATS-NEW.md` with one terse release line.
5. **Add focused integration coverage.** Add `integration-test/tests/published-boards/torrent-viewer/torrent-viewer.test.mjs`. Generate a minimal synthetic bencoded trackerless torrent in the test module using `node:fs/promises`, `mkdir(dirname(file), { recursive: true })`, and `writeFile(ctx.fixture(sampleRel), buffer)`, then open it through `openPublishedSample(ctx, "torrent-viewer", sampleRel)` from `integration-test/tests/published-boards/helpers.mjs`. Assert the known torrent name, file path and size through `editor.app`, `mode === "offline-inspecting"`, `online === false`, and `peerCount === 0`. Declare `requires: ["launch", "published-board-checkout"]`; always close/unregister with `closePublishedSample()` in `finally`. Keep the sample synthetic and free of personal data. Revise only the discovery-specific sentence in `.claude/skills/ui-tests/SKILL.md` and `doc/standards/integration-tests.md` to permit opening a path whose offline behavior is verified; retain their no-external-network rule.
6. **Verify the completed implementation.** Codex runs only `node --check` on edited `.mjs` files and board checks; it must not launch Persephone or run any integration test runner. Do not run `npm install`: `boards/torrent-viewer/node_modules` contains the pinned WebTorrent 3.0.21, parse-torrent 11.0.24, and esbuild 0.28.1. From `C:\projects\persephone-boards\boards\torrent-viewer`, run `npm run build`, add `parse-torrent 11.0.24` to `lib/VERSION.txt`, and report the output of `git diff --stat -- lib/webtorrent.bundle.mjs`. The bundle diff must be limited to the added parser exports; if rebuilding rewrites the bundle unexpectedly, stop and report instead of committing to that output. For the clean-copy check, copy `boards/torrent-viewer` to `C:\data\epic201\tv-check` excluding `node_modules`; from `C:\data\epic201` (outside that copy), run Node with an absolute `file:///C:/data/epic201/tv-check/lib/webtorrent.bundle.mjs` import, call the exported parser on a synthetic bencoded buffer, and print the parsed name and file count. Delete only `C:\data\epic201\tv-check` afterward. Claude runs the published-board integration test after implementation. Add no tests or harnesses outside `integration-test/`.

### Verified findings

- `doc/epics/EPIC-201.md` lists US-2135 as a planned task and settles that Torrent Viewer gains an offline inspect mode. It also says `network: false` governs only frame fetches, and that Torrent Viewer needs a version bump; do not repeat Wake Word's EPIC-200 bump.
- `C:\projects\persephone-boards\CLAUDE.md` says `board-manifest.json` is the publishing version source, each change needs a matching `WHATS-NEW.md` heading, `boards-manifest.json` and `versions-manifest.json` are machine-written, and boards must not depend on `node_modules`. It requires loading a vendored runtime entry from a clean checkout outside `node_modules` before release.
- `boards/torrent-viewer/CLAUDE.md` assigns resolver/service ownership to `scripts/service.mjs`, network setting validation to `scripts/network.mjs`, and identifies the proxy shims, bundle entry/build script, and committed runtime. It says automated provider checks must use a controlled fake/no-network producer and not a real torrent or swarm.
- The service currently calls `getClient().add(torrentInput, { store: MemoryChunkStore, deselect: true })` in `startResolver()`. `metadataFor()` calls `metadataProjection()`, and `getServiceSnapshot()` exposes the WebTorrent client as `client` (or `null`) plus per-torrent `peers`. Direct mode constructs WebTorrent with default discovery options.
- Runtime imports in `scripts/service.mjs` are the committed `../lib/webtorrent.bundle.mjs` and local `./network.mjs`; there is no runtime import from `node_modules`. `scripts/webtorrent-entry.mjs` currently exports WebTorrent, `MemoryChunkStore`, and the proxy setters. Installed `parse-torrent` source confirms local byte parsing and exports `toMagnetURI`; it also has a re-encoder, but offline Save must not use it because it must preserve the user's original bytes. Parsed `files[].path` uses `path.join`, so service output must normalize Windows separators.
- Vendored WebTorrent source confirms `_onStore()` calls `_startDiscovery()`. Defaults enable DHT, LSD, uTP, UPnP/NAT-PMP, uTP peer exchange, and web seeds. SOCKS mode already disables several direct channels through `proxyClientOptions()` and routes peer/fetch/UDP tracker paths through the existing shims; those files need no behavior change for local parsing.
- `torrentFileForLink()` resolves a file link's magnet through `resolveTorrent()`. `app.js`'s `openFile()` builds that link, while `downloadFile()` opens it after the save dialog. Reusing this path provides the later transition without a new API or reload.
- No AiVision model or agent guide is in the Torrent Viewer board files. `assets/guides/agents/ai-vision.md` says board models use `P.aiVision.expose(root)`, an explicit `aiVision.members` allow-list, and the host-provided shim; the board must not install another copy.
- `app.js` reconciles the service snapshot into `serviceTorrents`; `readyRow()` preserves torrent metadata and stats. The published-board `pdf-viewer.test.mjs` writes a generated sample under `ctx.fixture()` and uses `openPublishedSample()` with the `launch` and `published-board-checkout` requirements. The shared helper verifies the local board root, activates the page, waits for `frameReady`, and returns an editor handle.
- `app.js:310` initializes each torrent's selected file index to `null`. Opening a `.torrent` selects the torrent row (`app.js:1022`) but does not set a file selection or call `openFile()`. The only open path is the explicit `openFile()` action (`app.js:1094-1098`); file double-click and Enter handlers call it (`app.js:722-725`, `740-743`). Therefore there is no current auto-open or auto-select of a file on `.torrent` open; no separate stop-auto-open change is needed.
- `lib/VERSION.txt` currently lists WebTorrent 3.0.21, memory-chunk-store 1.3.5, socks 2.8.10, undici 7.30.0, fetch-socks 1.3.3, and build-time esbuild 0.28.1, but omits bundled `parse-torrent`; add `parse-torrent 11.0.24` when rebuilding. The existing ignored `node_modules` is present and contains the pinned packages, so the build needs no install step.
- Both `.claude/skills/ui-tests/SKILL.md` and `doc/standards/integration-tests.md` contain the discovery-specific restriction. Retain their blanket rule against external network access.
- The board checkout is on `develop`. Manifest version and top changelog heading are `1.10.0`; tag listing has `torrent-viewer-v1.10.0` and no `torrent-viewer-v1.11.0`.
- Neither board author guide requires updating all translated packs per UI change. `lang/en.json` is the default English catalog; other packs are left unchanged for this task.

### Before → after behavior

```js
// Before: even a local .torrent path reaches WebTorrent discovery.
getClient().add(torrentInput, { store: MemoryChunkStore, deselect: true });

// After: local bytes are parsed into metadata; the existing provider joins on file read.
const parsed = await parseTorrent(localTorrentBytes);
const magnet = toMagnetURI(parsed);
offlineRecord.originalBytes = localTorrentBytes;
// Offline Save .torrent returns originalBytes unchanged.
// torrentFileForLink() later calls resolveTorrent(magnet) for Open/Download.
```

## Concerns

- Keep parser records distinct from WebTorrent torrent instances. `torrentFileForLink()` must resolve the magnet before any file stream/read, and removing an offline row must clear its parsed record without stopping unrelated active torrents.
- Preserve Copy magnet, Copy info hash, Save `.torrent`, and Remove for offline rows. Copy magnet uses `toMagnetURI`; Save `.torrent` must return the stored original bytes exactly, while Remove clears the offline record and bytes.
- The model must reflect client/torrent state rather than the Direct/SOCKS5 preference; a configured network does not mean the swarm has been joined.
- The source ownership, parser helpers, model API, test pattern, version, and checks are verified above; no user decision remains open before implementation.

## Acceptance Criteria

- Opening a local `.torrent` displays its embedded name and file paths/sizes without starting DHT, trackers, LSD, peer connections, web seeds, or a listener.
- The published model reports `mode: "offline-inspecting"`, `online: false`, and zero peers for a local torrent open.
- Opening or downloading a file joins the swarm through the existing provider path, without reloading the board. Magnet metadata retrieval is identified as network-dependent; HTTP(S) `.torrent` retrieval is also disclosed as a network fetch.
- Saving `.torrent` from an offline row writes the exact original input bytes, byte-for-byte; removing the row releases those bytes.
- UI copy is in `lang/en.json`; manifest description and README say what goes online and when. Board version is `1.11.0`, with a matching `## 1.11.0` changelog heading and no corresponding release tag.
- [x] Claude's published-board integration test uses a synthetic trackerless torrent and checks its metadata and offline model state. Its open path remains network-free; Codex does not run Persephone or an integration test runner.
- The discovery-specific test guidance is revised while the external-network prohibition remains. No host protocol or `window.persephone` change, generated manifest edit, or test outside `integration-test/` is included.

Files inspected and expected to need no change: `C:\projects\persephone-boards\boards\torrent-viewer\scripts\network.mjs`, `scripts\proxy-net.mjs`, `scripts\proxy-fetch.mjs`, `scripts\socks-v1-compat.mjs`, and `scripts\build-webtorrent.mjs` (the existing build entry already includes `parse-torrent`). No dedicated agent guide or committed test fixture is needed. Do not edit `boards-manifest.json`, `versions-manifest.json`, `doc/active-work.md`, or `doc/epics/EPIC-201.md`; EPIC-201 already links US-2135.

## Files Changed

| File | Planned change |
|---|---|
| `doc/tasks/US-2135-torrent-offline-inspect/README.md` | This implementation plan. |
| `C:\projects\persephone-boards\boards\torrent-viewer\scripts\service.mjs` | Own offline parse/inventory and mode; reuse parser helpers, `metadataProjection()`, `getServiceSnapshot()`, and `torrentFileForLink()`. |
| `C:\projects\persephone-boards\boards\torrent-viewer\scripts\webtorrent-entry.mjs` | Export already-bundled parser and `toMagnetURI`. |
| `C:\projects\persephone-boards\boards\torrent-viewer\lib\webtorrent.bundle.mjs` | Regenerate the self-contained bundle. |
| `C:\projects\persephone-boards\boards\torrent-viewer\lib\VERSION.txt` | Add bundled `parse-torrent 11.0.24`. |
| `C:\projects\persephone-boards\boards\torrent-viewer\app.js` | Add the AiVision mode/status model and offline UI state. |
| `C:\projects\persephone-boards\boards\torrent-viewer\lang\en.json` | Add English offline and network-timing UI copy. |
| `C:\projects\persephone-boards\boards\torrent-viewer\board-manifest.json` | Update network description and version to `1.11.0`. |
| `C:\projects\persephone-boards\boards\torrent-viewer\README.md` | Document local, magnet, HTTP(S), and file-action network behavior. |
| `C:\projects\persephone-boards\boards\torrent-viewer\WHATS-NEW.md` | Add the `1.11.0` line. |
| `integration-test/tests/published-boards/torrent-viewer/torrent-viewer.test.mjs` | Generate and open a synthetic torrent; assert metadata and offline model state. |
| `.claude/skills/ui-tests/SKILL.md` | Permit a verified offline torrent open path while retaining the no-external-network rule. |
| `doc/standards/integration-tests.md` | Permit a verified offline torrent open path while retaining the no-external-network rule. |
