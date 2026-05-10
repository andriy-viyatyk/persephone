# US-514: Video / Audio Player editor — UIKit migration

## Status

**Placeholder** — not yet planned. Part of [EPIC-025](../../epics/EPIC-025.md)
Phase 4 per-screen migration.

## Goal

Migrate the Video / Audio Player editor (video player, audio player,
audio controls bar, audio visualizer) to UIKit primitives. After this
task, no file under `src/renderer/editors/video/` imports from
`components/basic|form|layout|overlay/` and no `@emotion/styled`
definitions remain.

## Scope

Five rendering files:

- `src/renderer/editors/video/VideoPlayerEditor.tsx` — top-level editor;
  routes to video or audio player based on file type; metadata textarea.
- `src/renderer/editors/video/VPlayer.tsx` — video playback with custom
  control overlay.
- `src/renderer/editors/video/AudioPlayer.tsx` — audio playback host.
- `src/renderer/editors/video/AudioControls.tsx` — transport controls
  (play / pause / seek / volume).
- `src/renderer/editors/video/AudioVisualizer.tsx` — canvas-based
  waveform / frequency visualizer with surrounding chrome.

## Files NOT changed

- Stream-server and codec plumbing (`/src/main/video-stream-server.ts`,
  `/src/main/vlc-launcher.ts`).
- Editor module registration.

## Old → UIKit primitives

| Old | New |
|---|---|
| `styled.div` / `styled.video` / `styled.canvas` roots and chrome | UIKit `Panel` for chrome; keep raw `<video>` / `<canvas>` for media (no UIKit replacement, allowed under raw-HTML rule) |
| `components/basic/Button` (transport, fullscreen, etc.) | UIKit `IconButton` / `Button` |
| `components/basic/TextAreaField` (metadata) | UIKit `Textarea` |
| `theme/color` (chrome backgrounds, text) | dropped — Panel tokens / Text colors |

Confirmed import inventory (current):
- `VideoPlayerEditor.tsx`: `@emotion/styled`, `components/basic/{Button,TextAreaField}`, `theme/color`.
- `VPlayer.tsx`: `@emotion/styled`.
- `AudioPlayer.tsx`: `@emotion/styled`, `theme/color`.
- `AudioControls.tsx`: `@emotion/styled`, `theme/color`.
- `AudioVisualizer.tsx`: `@emotion/styled`, `theme/color`.

## Notes

- Raw `<video>` and `<canvas>` elements stay as native HTML — UIKit
  doesn't wrap media. UIKit `Panel` wraps them for layout / chrome.
- Transport-control sliders (seek, volume) likely use native
  `<input type="range">` — keep raw HTML inside UIKit `Panel`.
- Color tokens used for visualizer fill (canvas `fillStyle`) read from
  `theme/color` — those reads are inside imperative canvas code, not
  styled components. Decide whether to keep the `color` import for
  imperative drawing or migrate to CSS-variable reads. Flag in plan.
- VLC launcher / external-player handoff is unaffected.

## Test surface (manual smoke)

- Open `.mp4`: video plays with custom controls overlay; play / pause /
  seek / volume / fullscreen work.
- Open `.mp3` / `.wav`: audio player renders with transport controls
  and live visualizer.
- Metadata textarea: edits persist.
- Switch tab away and back: playback state preserves.
- Subtitles / captions (if applicable) render.
- VLC launcher button (if present) hands off to external VLC.

## Acceptance criteria

- [ ] No `@emotion/styled` import in any in-scope file.
- [ ] No imports from `components/basic|form|layout|overlay/` in any
      in-scope file.
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Manual smoke (above) passes.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Reference: [US-505 Archive editor](../US-505-archive-editor-migration/README.md)
