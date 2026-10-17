# EPIC-128: Audio Player board

## Status

**Status:** Active
**Created:** 2026-10-11

## Overview

Persephone plays audio in its built-in Video Player: one track at a time, a bars/circular
visualizer, and next/shuffle across the Explorer folder or the link-editor category or tag the
track was opened from. That is enough to listen to a `.link.json` tag, but not to use Persephone
as a music player.

This epic builds an **Audio Player** catalog board (in `persephone-boards`) with the same
visualizer and the features of a desktop player such as WinAmp: a play queue, volume, an
equalizer and crossfade, and above all its own **music catalog**: links to audio files on disk,
organized by category, with tags, ratings and play counts. Tracks get into the catalog one by
one (an Explorer-opened file that is not in it yet is one click away from being added, with a
category and tags) or in bulk ("Add tracks from folder" scans a folder and adds every audio file,
without a category or tag). The board also keeps playing a folder or a link-editor category/tag
in order, as the Video Player does today.

The board claims audio files with a priority above the Video Player, so it becomes the default
player once installed. After the board is published, the Video Player's audio features
(visualizer, next/shuffle, the audio controls) are removed; an audio file opened without the
board still plays there with the native media controls, and the editor switch offers to install
the Audio Player.

The board needs a few things the board bridge does not offer yet. Those are built in Persephone
first, as general bridge features rather than player-specific ones.

## Goals

- Opening an audio file (Explorer, link editor, Open dialog, drag-and-drop) plays it in one
  Audio Player page and adds it to the queue, instead of opening a page per track.
- A track opened from a folder or a link-editor category/tag brings that list with it, so the
  board can play the rest of it in order or shuffled, as the Video Player does now.
- The board keeps a music catalog in a file the user owns: tracks are links to files, with a
  category, tags, a rating and play statistics. "Add tracks from folder" scans a folder the user
  picked and adds its audio files, uncategorized. None of this needs the `service` permission
  (Node code).
- A track opened from Explorer shows whether it is in the catalog; if not, it can be added in
  one step, choosing its category and tags.
- The player has volume and an equalizer (the Video Player has neither).
- An agent can see and edit the catalog through ai-vision: find tracks without a category,
  artist or year, and fill them in bulk.
- Playback continues when the Audio Player page is not the active tab, and the keyboard media
  keys control it.
- After the board ships, the Video Player is video-first: its audio-only features move to the
  board, and audio without the board falls back to plain playback plus an install offer.

## Decisions

Proposals; the user may change them.

- **A1 — The board lives in `persephone-boards`**, like the other catalog boards. Persephone
  tasks use `US-` ids here; board tasks use that repo's `BT-` ids and its own dashboard. Only
  the board has player features; Persephone gets general bridge features.
- **A2 — `stream-host` + `singleInstance`.** The board uses `editorKind: "stream-host"` (no
  download to a cache file, so http links and torrent files stream), `singleInstance: true`
  (one player page per window), and `source.onOpen` to queue later opens. Audio bytes come from
  `persephone.content.open(link)`: an origin-local `board://` URL with Range support, so seeking
  works and the Web Audio analyser is not blocked by CORS.
- **A3 — Source context travels with the open.** The list of sibling tracks is captured when
  the track is opened, not looked up later: with `singleInstance` the open lands on the existing
  player page, whose sidebar is not the one the user clicked in. The capture logic moves out of
  `VideoEditor` (`findSourceProvider` / `getSiblingTracks`) into a shared platform helper; the
  Video Player uses the same helper, so its behavior does not change.
- **A4 — Folder listing, scoped to granted folders.** A new bridge method lists a folder
  (optionally recursive, filtered by masks) only inside folders the user picked with
  `openFolderDialog`. Picked folders are today remembered in memory only
  (`pickedPathsByRoot` in `src/main/board-file-access.ts`). The board may ask for a folder
  grant to persist; persisted grants are listed on the board's info page and can be revoked
  there. This keeps the board at `fileSystem: "board"` with no `service`.
- **A5 — Media keys and background playback are checked before they are built.** Board pages
  stay mounted while inactive, so playback probably continues; `navigator.mediaSession` in the
  board frame probably receives the hardware media keys. US-1688 checks both in a running app.
  A platform task is added only for what fails.
- **A6 — The catalog is a link-editor file** (user decision 2026-10-11), so it can also be
  opened and reviewed in the Link Editor. Not `persephone.storage`: its whole store is capped at
  1 MB (`MAX_BOARD_STORAGE_BYTES`, `src/main/board-storage.ts`). Not the board folder: that
  belongs to the installed board version.
  - **Format:** the Link Editor's `LinkEditorData`
    (`src/renderer/editors/link-editor/linkTypes.ts`): `{ "type": "link-editor", links, state }`.
    Each track is a `LinkItem`: `id`, `title`, `href` (file path or URL), `category` (the
    category tree), `tags`, `imgSrc` (cover art, when there is a picture file for it).
  - **Player fields live on each link:** `artist` (singer or band), `year`, `album`,
    `rating` (0–5), `playCount`, `lastPlayed`, `addedAt`, `duration`. Artist and year are
    editable in the board next to category and tags, and are filled from the file's own tags
    when it has them. The Link Editor keeps unknown fields on a link:
    `loadData` keeps the parsed objects and `updateLink` changes only the fields it knows. It
    does **not** keep unknown top-level keys (`syncToHost` writes `{ type, ...data }` with
    `data = { links, state }`), so board-wide settings go under `state.audioPlayer`, which
    is kept as a whole.
  - **Which file:** any `.link.json` can be the catalog ("Open catalog…" in the board, and the
    path is remembered). The board also claims `*.music.link.json` with a priority above the
    Link Editor, so such a file opens in the player by default. The editor switch still offers
    the Link Editor for review. An existing `music.link.json` works as it is; renaming it to
    `<name>.music.link.json` makes it open in the player.
  - Reading and writing it after a restart needs the persisted grant of A4, extended to a picked
    **file**.
  - Tags and cover art from the audio file itself are read in the board (a browser tag parser
    over the `board://` URL with Range requests) and fill `artist`, `year`, `album` and
    `duration` when they are empty; the user's edits win over the file's tags.
- **A9 — Two play modes** (user decision 2026-10-11).
  - **Source mode:** the queue is the list the track was opened from: an Explorer folder, or a
    link-editor category or tag (the context of A3). A new open from a different folder or tag
    replaces the queue with that list. Each track shows whether it is in the catalog and can be
    added from there (A6).
  - **Catalog mode:** the queue comes from the board's own catalog: a category, a tag, an artist,
    a year or decade, a search, or a smart list (top rated, most played, recently added).
  The board shows which mode it is in and switches with one control. Switching mode does not
  stop the current track; the new queue starts after it. Each mode remembers its last queue and
  position, so switching back resumes it. Opening a file from Explorer or the link editor
  switches to source mode.
- **A10 — An ai-vision model for agents** (user decision 2026-10-11). The board exposes its
  model with `persephone.aiVision.expose()`, as the chess, drawio, excel, force-graph and pdf
  boards do, so an agent can help organize the catalog:
  - read: tracks with their fields, the category tree, tags, artists, which tracks miss a
    category, artist or year, and what is playing;
  - write: set category, tags, artist, year, album and rating on one or many tracks; create,
    rename and move categories; add tracks from a folder;
  - control: play, pause, next, choose the mode and queue.
  Writes go through the same catalog code as the UI (A6 merge rules), and bulk edits are one
  undoable step. Agents fill missing artists and years from their own knowledge or a web
  search; the board does not call online services itself.
- **A7 — Playlist files.** The board claims `*.m3u` and `*.pls` for import. It does **not**
  claim `*.m3u8`: the Video Player opens `.m3u8` as an HLS stream.
- **A8 — The Video Player loses its audio features after the board ships** (user decision
  2026-10-11). US-1692, after BT-042: remove `AudioPlayer.ts`, `AudioControls.ts`,
  `AudioVisualizer.ts`, `effects/`, the next/shuffle code and their settings and script-facade
  members. Audio files still open in the Video Player (otherwise nothing built in would claim
  them) and play with the native `<audio>` controls; the editor switch's install offer points to
  the Audio Player. Until then the Video Player uses the shared helper of A3 and behaves as
  today.

- **A11 — Full player and light pages** (user decision 2026-10-18; replaces "every open lands
  on one player page" from A2 and the Goals).
  - **Full player (singleton):** opening the board itself (Boards panel, launcher,
    `persephone-board://` link) or a file matching the manifest's new `singleInstanceMasks`
    (`*.music.link.json`, `*.m3u`, `*.pls`) still routes to the one full player page and queues
    there through `source.onOpen`.
  - **Light page:** any other audio file (Explorer click, link editor, Open dialog, drag-and-drop)
    opens in place on the page it was opened from, like every other viewer. It shows the
    visualizer, the transport and the track title with the add/edit button only — no catalog
    panel, catalog list, double-click playing list, toolbar search, Import or catalog button.
    Previous/next play the rest of the captured source context (folder or link category/tag)
    within the light page, and the title follows the playing track. Play counts are recorded
    in the catalog. Light pages expose no ai-vision model. With no catalog yet (a freshly
    installed board), the add/edit button stays hidden and the file still plays; a light page
    never offers to open or create a catalog (today's `catalog-view.js` already hides
    `#add-current` when `!doc` — keep it).
  - **Mode** is chosen by the board at startup: an audio-file source is a light page; a catalog,
    a playlist or no source is the full player.
  - **Platform:** `openSingleInstanceBoard` routes only board opens and `singleInstanceMasks`
    matches; `findPageByBoardRoot` (used for routing) matches only a page opened without an
    audio file, so a light page never captures a board launch. A manifest without
    `singleInstanceMasks` keeps today's route-everything behavior. Link Editor panel clicks
    (category tree, tags list; `LinkEditor.openLinkFromPanel`) dispatch with the page's
    `pageId` and reach the same `navigatePageToWithSingletonRouting` as Explorer clicks, so a
    track clicked in e.g. `music.link.json` plays in place on the Link Editor's page (as the
    Video Player did), with previous/next over the clicked category or tag. Acceptance checks
    both the Explorer and the Link Editor click. The manifest field is a
    board-facing contract change: **bump `BOARD_BRIDGE_VERSION`**, and the board's
    `minBridgeVersion` follows.
  - **Light-page source navigation** (user decision 2026-10-18): expose
    `persephone.source.navigate(href)` so a light-page board can navigate its hosting page only to
    hrefs in its initial Explorer or Link Editor category/tag source snapshot, preserving the
    source panel selection and using the same page-local navigation path as Video Player Next.
  - **Page visibility** (user decision 2026-10-18): expose `persephone.page.visible` and
    `persephone.page.onVisibilityChange(callback)`; a page is visible when active or grouped
    beside the active page, independent of whether the window is minimized.
  - **Catalog sync:** the full player watches its catalog with `persephone.watch()` (EPIC-129)
    instead of the 4-second visible-only poll, so a track added from a light page appears at
    once. Writes stay merge-safe through the catalog store.
  - Two pages playing at the same time is expected (as with two browser tabs); there is no
    cross-page pause. Pages restored from an older session that were opened from a file come
    back as light pages.

## Linked Tasks

### Persephone (this repo)

| Task | Title | Status |
|------|-------|--------|
| [US-1688](../tasks/US-1688-board-audio-check/README.md) | Check: background playback and media keys in a board frame | Done |
| [US-1689](../tasks/US-1689-board-source-context/README.md) | Source context for board opens (sibling tracks from folder / link category / tag) | Implemented (unreviewed) |
| [US-1690](../tasks/US-1690-board-folder-listing/README.md) | Board folder listing, persisted folder and file grants, and source read grants | Implemented, verified live (native-dialog flows: user check) |
| ~~US-1691~~ | ~~Media-key or background-playback support for boards~~ | Dropped: US-1688 found both already work |
| [US-1700](../tasks/US-1700-single-instance-masks/README.md) | Single-instance routing by mask: full player for board/catalog/playlist opens, in-place light pages for audio files (A11) | Planned |
| US-1692 | Remove the audio features from the Video Player (after BT-042) | Planned |

### persephone-boards

| Task | Title | Status |
|------|-------|--------|
| BT-038 | Audio Player: player, queue, volume, visualizer, source mode (folder / link category / tag) | Implemented, verified live |
| BT-039 | Audio Player: music catalog and catalog mode (link-editor format, `*.music.link.json`, categories, tags, ratings, add-on-open, add tracks from folder, search, file tags and cover art, mode switch) | Implemented, verified live |
| BT-040 | Audio Player: play counts, smart and saved playlists, M3U/PLS | Implemented, verified live |
| BT-041 | Audio Player: equalizer, crossfade, gapless | Implemented, verified live |
| BT-043 | Audio Player: ai-vision model (read, bulk edit, playback control) | Implemented, verified live |
| BT-044 | Audio Player: light mode (A11), `singleInstanceMasks`, watch-based catalog refresh | Planned |
| BT-042 | Publish Audio Player; site page and demo video | Planned |

Order: US-1688 → US-1689 → BT-038 → US-1690 → BT-039 → BT-040 → BT-043 → BT-041 → US-1700 →
BT-044 → BT-042 → US-1692.
US-1689 bumps `BOARD_BRIDGE_VERSION` from 1.36.0 to 1.37.0; US-1690 then bumps it to 1.38.0; US-1700 bumps it to 1.40.0.
The board's `minBridgeVersion` / `minAppVersion` follow the release that ships each feature.

## Notes

### 2026-10-11
- Investigation: the visualizer (`src/renderer/editors/video/AudioVisualizer.ts`,
  `effects/BarsEffect.ts`, `effects/CircularEffect.ts`, ~850 lines) depends only on Web Audio
  and canvas, so it ports to the board almost as is.
- `content.open` is gated only by board trust, not by `fileSystem`, so the board can play any
  track it is given.
- Chromium does not decode `.wma`; the board lists such files but marks them unsupported.
- User requirements (2026-10-11): play the rest of an Explorer folder or link-editor tag after
  the opened track; a static catalog of file links with categories, tags and ratings; show
  whether an Explorer-opened file is in the catalog and add it in one step; "Add tracks from
  folder" adds a folder's audio files uncategorized; an equalizer and volume; remove audio from
  the Video Player.
- Open concern for BT-039: the catalog may be open in the Link Editor and in the player at the
  same time. Both write the whole file, so the last write wins. The board must reload the file
  when it changes on disk and write only after merging its own changes onto the newest content
  (play counts change on every track).

- US-1688 (2026-10-11): background playback, the analyser, seeking, hardware media keys (with
  Persephone unfocused) and single-instance queuing all work in a board frame. It also found that
  a `fileSystem: "board"` board cannot read the files it is handed (sibling tracks, later opens);
  US-1690 now adds **source read grants**: files Persephone delivers to a board are readable by
  it for the session (exact files, read-only).

- Autonomous run (2026-10-11): US-1689, US-1690 (plus source read grants, `getFileAccess`,
  repeat-remember without a prompt, manifest name in the confirmations) and BT-038/039/040/043/041
  are implemented, staged, and checked live in a dev build with generated tone fixtures
  (`C:\projects	est-boardsixtures`). Not committed. BT-042 (publish) and US-1692 (remove audio
  from the Video Player) wait for the user's go-ahead.
