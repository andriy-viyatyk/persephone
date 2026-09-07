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
