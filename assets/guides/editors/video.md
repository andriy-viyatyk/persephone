---
title: "Video Player"
audience: both
summary: "Video and audio playback with streams, native controls, and VLC fallback."
editorId: "video-view"
---

# Video Player

Video Player handles local media, URLs, HLS streams, and audio. Audio files use the same native
HTML media controls as video for play/pause, seeking, and volume.

## How to Open

Open `.mp4`, `.webm`, `.avi`, `.mkv`, `.mov`, `.m3u8`, `.m3u`, `.mp3`, `.wav`, `.aac`, `.flac`,
`.m4a`, `.wma`, `.ogg`, or `.opus`. Media entries inside supported archives play too when opened
from the Archive panel. It is also available from the **+** menu, where a path, HTTPS URL, HLS
stream, or cURL/fetch command can be submitted. Agents open a file with `app.pages.openFile(path)`.

The URL field stays one line, ending in an ellipsis for a long link such as a `torrent://` address.
Click into it and it expands downward over the player to show the whole value (scrolling when very
long); it collapses again when it loses focus. Press **Enter** to play.

## Layout

```
+---------------------------------------------------------------------+
| [Video URL]                                   [Save as...] [Discard]  |  Save and discard appear only for an unsaved recording
+---------------------------------------------------------------------+
| [Player]                                                            |  native video/audio controls
| [Open in VLC]                                                       |  fallback action below the player when available
+---------------------------------------------------------------------+
```

### User-facing label ? `elements` name

- Video URL ? `video-url-input`
- Save as... / Discard map to `video-recording-save` and `video-recording-discard` (temporary recordings only)
- Open in VLC ? `video-open-vlc`
- Native media and video.js controls ? no entry: media-internal controls

### When VLC fallback is available

```
+---------------------------------------------------------------------+
| [Video player] [Open in VLC]                                        |  player with VLC fallback below it when available
+---------------------------------------------------------------------+
```

## Playback

Audio plays in the dark media area through the browser's native controls for play/pause, seek, and
volume. Video playback keeps its native controls, and `.m3u8` sources use HLS playback when
supported.
Local and archive-hosted media use the streaming server where needed, so seeking does not require
loading the entire source first. If Chromium cannot decode a file, **Open in VLC** appears when VLC
is configured in Settings.

Recordings opened in Video Player are temporary until saved. Use **Save as...** to choose a permanent
location, or **Discard** to delete the recording and close its page. Closing an unsaved recording's
player page also deletes it. Closing Persephone, closing its window, or moving the page to another
window keeps it available when the page is restored; unsaved recordings are removed automatically
after seven days.

## Agent API

After narrowing `page.editor.id` to `video-view`, the `VideoEditor` facade exposes source and
playback state, live media values, and `submitUrl`, `play`, `pause`, `seek`, `toggleMute`, and
`openInVlc`. Its curated elements are `video-url-input` and `video-open-vlc`; native media controls
are managed by the media element.

## Errors and limits

Unsupported codecs may require VLC. Network streams can fail independently of the editor, and custom
headers should be supplied through a cURL/fetch command when the source requires them. If media from
an archive or content provider fails to open, reopen its source link to retry playback in the same
page. A video backed by a board content provider also retries automatically if that provider becomes
available while the page is open.
