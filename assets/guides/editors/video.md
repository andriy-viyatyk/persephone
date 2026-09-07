---
title: "Video Player"
audience: both
summary: "Video and audio playback with streams, visualizer effects, navigation, and VLC fallback."
editorId: "video-view"
---

# Video Player

Video Player handles local media, URLs, HLS streams, and audio with an optional spectrum visualizer.

## How to Open

Open `.mp4`, `.webm`, `.avi`, `.mkv`, `.mov`, `.m3u8`, `.m3u`, `.mp3`, `.wav`, `.aac`, `.flac`,
`.m4a`, `.wma`, `.ogg`, or `.opus`. It is also available from the **+** menu, where a path, HTTPS
URL, HLS stream, or cURL/fetch command can be submitted. Agents open a file with `app.pages.openFile(path)`.

## Layout

```
+---------------------------------------------------------------------+
| [Video URL]                                                         |  Video toolbar at the top of the page
+---------------------------------------------------------------------+
| [Player]                                      [Visualizer]          |  media player below the toolbar; visualizer selector at its right
| [Open in VLC]                                                       |  fallback action below the video player when available
+---------------------------------------------------------------------+
```

### User-facing label → `elements` name

- Video URL → `video-url-input`
- Open in VLC → `video-open-vlc`
- Play/Pause → `audio-play-pause`
- Next → `audio-next`
- Mute → `audio-mute`
- Shuffle → `audio-shuffle`
- Seek → `audio-seek`
- Bars → `visualizer-bars`
- Circular → `visualizer-circular`
- None → `visualizer-none`
- Native media and video.js controls → no entry: media-internal controls

### When VLC fallback is available

```
+---------------------------------------------------------------------+
| [Video player] [Open in VLC]                                        |  video player with VLC fallback below it when available
+---------------------------------------------------------------------+
```

### When the audio player is mounted

```
+---------------------------------------------------------------------+
| [Play/Pause] [Next] [Mute] [Shuffle] [Seek]                         |  audio controls in the bottom overlay of the player
+---------------------------------------------------------------------+
```

### When the audio visualizer selector is open

```
+---------------------------------------------------------------------+
| [Bars] [Circular] [None]                                            |  visualizer choices in one selector, ordered left to right
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- Native media and video.js controls — no entry: media-internal controls.

## Playback

Local media uses the streaming server where needed. Audio offers Bars, Circular, and None visualizer
effects, plus play/pause, mute, seek, and track navigation. When opened from Explorer or Links,
**Next Track** and **Shuffle** can traverse the surrounding folder, category, or tag. If Chromium
cannot decode a file, **Open in VLC** appears when VLC is configured in Settings.

## Agent API

After narrowing `page.editor.id` to `video-view`, the `VideoEditor` facade exposes playback state
and actions such as `submitUrl`, `play`, `pause`, `seek`, `toggleMute`, `playNext`, visualizer, and
VLC actions. Verified elements include `video-url-input`, `video-open-vlc`, `audio-play-pause`,
`audio-next`, `audio-mute`, `audio-shuffle`, `audio-seek`, `visualizer-bars`, `visualizer-circular`,
and `visualizer-none`.

## Errors and limits

Unsupported codecs may require VLC. Network streams can fail independently of the editor, and custom
headers should be supplied through a cURL/fetch command when the source requires them.
