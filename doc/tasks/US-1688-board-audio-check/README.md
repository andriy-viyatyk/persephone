# US-1688: Check background playback and media keys in a board frame

Epic: [EPIC-128](../../epics/EPIC-128.md) (decision A5)

## Goal

Find out, in a running Persephone, whether a board page can be a music player as the bridge
stands today: playback that survives tab switches, the keyboard media keys, and a Web Audio
analyser on a `content.open()` URL. The result decides whether US-1691 (platform support) is
needed.

## Background

- Board pages are `<webview>` guests (`src/renderer/editors/board/BoardWebview.ts`). Inactive
  pages stay mounted but hidden, so a playing `<audio>` element should keep playing; hidden
  pages throttle `requestAnimationFrame`, which only pauses the visualizer.
- The built-in player stops on purpose when its page is inactive
  (`AudioPlayerView.syncSourceAndMute`, `src/renderer/editors/video/AudioPlayer.ts`), so the
  built-in player tells us nothing about boards.
- Chromium routes the hardware media keys to the active media session. Whether a guest
  WebContents inside Persephone gets them (with the window focused, and unfocused) has not been
  tested.
- `persephone.content.open(link)` returns an origin-local `board://` URL with Range support
  (`board-api.d.ts`, `PersephoneContentOpenResult`). `createMediaElementSource` needs
  same-origin media to see samples instead of silence.

## Implementation plan

A throwaway test board in `C:\projects\test-boards\audio-check\` (never committed to this repo):

- [x] Manifest: `fileMasks: ["*.mp3", "*.flac", "*.ogg"]`, `editorKind: "stream-host"`,
      `editorPriority: 150`, `singleInstance: true`, `fileSystem: "board"`.
- [x] Page: `<audio>` with `src` from `content.open(sourceUrl)`; an `AnalyserNode` that logs
      the peak level each second; `navigator.mediaSession` handlers for play, pause,
      nexttrack and previoustrack that log; `source.onOpen` logging each queued open.
- [x] Register and trust the board, then open a local test audio file (a generated tone, not
      the user's music).

Checks:

1. [x] Playback continues when another tab is active. (Minimized window: not tested.)
2. [x] The analyser reports non-zero levels (no CORS silence).
3. [x] Seeking works (Range requests through `content.open`).
4. [x] Media keys reach the handlers with the Persephone window focused, and with another app
       focused.
5. [x] Opening a second file goes to the same page through `source.onOpen`.
6. [x] Opening the file from Explorer picks the board (priority 150 beats the video player).
       From a `.link.json` tag: not tested here; BT-038's live check covers it.

## Results (2026-10-11, dev build with US-1689, bridge 1.37.0)

Probe board `C:\projects\test-boards\audio-check` (stream-host, singleInstance, priority 150,
`fileSystem: "board"`), three generated 20 s tones plus a `notes.txt` in one folder.

1. **Background playback: works.** With another tab active, playback continued, playing time
   advanced, and the analyser still saw the signal. `document.hidden` stays `false` in the
   inactive board frame. The tab's `soundIndicator` stays `false` for board audio (cosmetic,
   not needed).
2. **Analyser: works** on `persephone.host.streamUrl()` (peak 32 for an 8000-amplitude tone):
   no CORS silence.
3. **Seeking: works** (currentTime 15.5 on the stream URL).
4. **Media keys: work** with Persephone **not** focused and the board page inactive: real
   OS `VK_MEDIA_PLAY_PAUSE` / `VK_MEDIA_NEXT_TRACK` events reached
   `navigator.mediaSession` handlers (`pause`, `nexttrack`). **US-1691 is not needed.**
5. **Second open: works.** It went to the same page through `source.onOpen`, with its own
   folder context (US-1689).
6. **Explorer open → board: works**, priority 150 beats the Video Player, and the initial
   context listed the three tones in folder order with `notes.txt` filtered out by the board's
   masks. Link-editor category/tag context was not exercised here; BT-038's live check covers it.

**Gap found:** a board with `fileSystem: "board"` cannot read the files it is handed.
`content.open()` of the opened file, of a sibling from the context, and of a runtime
`onOpen` URL all fail with `permission-denied: "fileSystem"` (they go through
`authorizeBoardFilePath` → `resolveAuthorizedPath`, read intent). A stream-host board reads its
own initial source through `host.streamUrl()`, but nothing else. Fixed by the **source read
grants** added to US-1690.

Two gotchas for board authors, found on the way:
- A manifest with `permissions` flags but no `minBridgeVersion` is silently incompatible
  (`custom-editor-registry.ts`, `requiresMinBridgeVersion`), so its file masks never claim.
- After editing a trusted board's manifest, unregister and register it again for the registry
  to reread it.

## Concerns

- Media keys while another app is focused may depend on Windows' media overlay (SMTC) and on
  Chromium flags. If they don't work, US-1691 adds a main-process route (`globalShortcut` for
  `MediaPlayPause` / `MediaNextTrack` / `MediaPreviousTrack` / `MediaStop`, sent to the board
  page that owns the active media session).
- Background throttling of hidden webviews might also delay `ended` events, which would put
  gaps between tracks. Note the gap measured at a track change while the page is hidden.

## Acceptance criteria

- Each check above has a recorded result in this document.
- US-1691 in EPIC-128 is either scoped (with what failed) or removed.
- The test board stays out of every repository.

## Files changed

| File | Change |
|------|--------|
| `doc/tasks/US-1688-board-audio-check/README.md` | Results |
| `doc/epics/EPIC-128.md` | US-1691 scoped or removed |

No source files change.
