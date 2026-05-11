# US-514: Video / Audio Player editor — UIKit migration

## Status

**Plan ready** — blocked on
[US-520](../US-520-uikit-video-editor-precursors/README.md) precursors
(Slider.showProgress + IconButton.variant="chip"). Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration.

## Goal

Migrate the Video / Audio Player editor (video player chrome, audio player
chrome, transport controls, canvas visualizer with effect switcher) to UIKit
primitives. After this task, no file under `src/renderer/editors/video/` imports
from `components/basic|form|layout|overlay/`, and `@emotion/styled` survives
only in **one** documented Rule-7 exception (`styled(Panel)` wrapper around
`VPlayer` for video.js descendant-CSS pass-through).

## Background

### Files in scope (5)

| File | Current chrome | Notes |
|---|---|---|
| `src/renderer/editors/video/VideoPlayerEditor.tsx` | `styled.div VideoEditorRoot` with `.video-area`, `.state-badge`, `.placeholder-text`, `.vlc-button` selectors; `styled(TextAreaField) UrlInputArea` wrapper; `Button type="icon"` for navigator toggle; `<button className="vlc-button">` chip | Top-level editor — routes to `<VPlayer>` for media, manages URL input + state badge + VLC fallback chip. |
| `src/renderer/editors/video/VPlayer.tsx` | `styled.div VideoRoot` with **descendant selectors targeting video.js library DOM** (`[data-vjs-player]`, `.video-js`, `&.src-empty .vjs-modal-dialog-content`, `video.native`) | Routes to `<HlsPlayer>` / `<NativePlayer>` / `<AudioPlayer>` based on format. Raw `<video>` / `<audio>` elements stay as native HTML. |
| `src/renderer/editors/video/AudioPlayer.tsx` | `styled.div AudioPlayerRoot` with `.visualizer-area`, `.controls-overlay`, descendant-selector reveal-on-hover (`.controls-overlay:hover input[type="range"]`, `.controls-overlay:hover .idle-hide`) | Audio player chrome. Hover on `.controls-overlay` reveals `<AudioControls>` buttons + seek-bar opacity transition. |
| `src/renderer/editors/video/AudioControls.tsx` | `styled.div AudioControlsRoot` with `.control-button`, `.time-label`, `.seek-bar` (input[type=range] with played-portion gradient via inline `background`) | 4 transport buttons (play/pause, next, mute, shuffle), 2 time labels, 1 seek bar. Shuffle button uses inline `style={{ color: color.misc.blue }}` for active state. |
| `src/renderer/editors/video/AudioVisualizer.tsx` | `styled.div VisualizerRoot` (reveal effect-switcher on root hover), `styled.canvas VisualizerCanvas`, `styled.div EffectSwitcher`, `styled.button EffectButton` (with `$active` prop — bordered+backgrounded chip) | Canvas-based FFT visualizer + 3-button effect switcher chip. Track-info overlay shown when effect = "none". |

### Files NOT changed

- `src/renderer/editors/video/video-types.ts` — pure types/utilities, no
  rendering.
- `src/renderer/editors/video/NodeFetchHlsLoader.ts` — hls.js loader, no
  rendering.
- `src/renderer/editors/video/effects/*` — canvas-drawing effects, imperative
  only.
- `src/main/video-stream-server.ts`, `src/main/vlc-launcher.ts` — main-process
  streaming / VLC handoff.
- Editor module registration (`registry.ts`).

### Canonical references

- **Graph editor migration** (`US-513`, commit `2caf342`) — established
  inline-style chrome migration pattern; demonstrated `styled(Panel)` wrapper
  for third-party CSS pass-through (`GraphDetailPanel` → AVGrid cell classes);
  showed `revealChildrenOnHover` + `hideUntilParentHover` IconButton pattern
  on toolbars; introduced UIKit Slider primitive (US-519).
- **Notebook editor migration** (`US-512`, commit `c2c554b`) — canonical
  template for inline-style chrome with absolute-positioned overlays and
  badge-style status indicators.

### Precursor (US-520)

This task depends on US-520 landing first. After US-520:
- UIKit `Slider` exposes `showProgress?: boolean` for played-portion fill.
- UIKit `IconButton` exposes `variant?: "default" | "chip"` for bordered+backgrounded
  chip toggle buttons.

### Old → UIKit primitive mapping

| Old | New |
|---|---|
| `@emotion/styled` for chrome (`VideoEditorRoot`, `AudioPlayerRoot`, `AudioControlsRoot`, `VisualizerRoot`, `EffectSwitcher`) | UIKit `Panel` (with `revealChildrenOnHover` where needed) |
| `@emotion/styled` for media containers with **video.js descendant selectors** (`VideoRoot` in VPlayer.tsx) | `styled(Panel)` wrapper — **documented Rule-7 exception** for third-party DOM CSS pass-through (precedent: `GraphDetailPanel` for AVGrid) |
| `styled.canvas VisualizerCanvas` | Plain `<canvas>` with inline `style` (canvas is raw HTML, no UIKit wrapper) |
| `components/basic/Button type="icon" size="small"` (NavPanelIcon) | UIKit `IconButton size="sm"` |
| `components/basic/TextAreaField` + `styled(TextAreaField)` wrapper (URL input) | UIKit `Textarea` (with `minHeight`, `maxHeight`, `singleLine={false}`, no wrapper) |
| `.control-button` (raw `<button>` × 4) | UIKit `IconButton size="sm"` with `hideUntilParentHover` and `active` (for shuffle toggle) |
| `.time-label` (raw `<span>`) | Plain `<span>` with inline style + `data-visibility="parent-hover"` |
| `.seek-bar` (raw `<input type="range">` with played-portion gradient) | UIKit `Slider` with `showProgress` (US-520 Phase 1) |
| `EffectButton` styled.button with `$active` chip look | UIKit `IconButton variant="chip"` with `active` (US-520 Phase 2) |
| `.vlc-button` (raw `<button>` chip with icon + label) | UIKit `Button variant="link" icon={<VlcIcon />}>Open in VLC</Button>` (bordered chip with blue text — Button.tsx:111-121) |
| `.placeholder-text` (raw `<span>`) | UIKit `Text size="md" color="light"` |
| `.track-title`, `.track-artist` (single-line ellipsis) | Plain inline-style `<div>` (Text doesn't expose `maxWidth: "80%"` directly — inline style cleaner) |
| `.state-badge` (absolute-positioned status pill) | Plain inline-style `<div>` (badge is one-off chrome, Notebook precedent) |
| Reveal-on-hover via descendant CSS selectors (`.controls-overlay:hover .idle-hide`) | UIKit `Panel revealChildrenOnHover` + child `IconButton hideUntilParentHover` / plain elements with `data-visibility="parent-hover"` |
| `style={{ color: color.misc.blue }}` on shuffle button | UIKit `IconButton active={shuffle}` (uses `color.icon.active`; minor visual delta — accepted) |
| Played-portion gradient on seek-bar (was inline `background`) | UIKit `Slider showProgress` (no inline-style or injected `<style>` tag needed) |
| Seek-bar thumb hover-scale animation | **Removed** — visual flourish, not load-bearing. |

## Implementation plan

Six steps. Each step is independent; do not start a later step until the
previous one is reviewed in `npm start`.

### Step 1 — `VideoPlayerEditor.tsx`

- Drop `@emotion/styled` import; drop `VideoEditorRoot` and `UrlInputArea`
  styled definitions.
- Drop imports of `TextAreaField`, `Button` from `components/basic`. Keep
  `theme/color` for inline-style state-badge constant.
- Add UIKit imports: `Panel`, `Textarea`, `IconButton`, `Button`, `Text` from `../../uikit`.
- Root: `<Panel direction="column" flex={1} background="dark" overflow="hidden">`.
- Inside `<PageToolbar borderBottom>`:
  - Replace `Button type="icon" size="small"` → `<IconButton size="sm" icon={<NavPanelIcon />} title="File Explorer" onClick={…} />`.
  - Replace `UrlInputArea` → `<Textarea value={inputText} onChange={model.setInputText} placeholder="…" minHeight={28} maxHeight={72} size="sm" onKeyDown={…} />`.
  - **Concern:** `Textarea` may not natively flex inside `PageToolbar`'s
    `flex-grow` slot. If layout breaks, wrap the Textarea in a
    `<Panel flex={1}>`. Verify in `npm start` before committing.
- `.video-area` → `<Panel direction="column" flex={1} align="center" justify="center" position="relative" overflow="hidden">`.
- `.placeholder-text` (empty-state) → `<Text size="md" color="light">Enter a video URL above to start playing</Text>`.
- `.state-badge` → plain `<div style={stateBadgeStyle}>{playerState}</div>`
  with inline-style constant defined at module top:
  ```ts
  const stateBadgeStyle: React.CSSProperties = {
      position: "absolute",
      bottom: 24,
      left: "50%",
      transform: "translateX(-50%)",
      padding: "4px 12px",
      borderRadius: 4,
      background: color.background.light,
      color: color.text.light,
      fontSize: 12,
      pointerEvents: "none",
  };
  ```
- `.vlc-button` → UIKit `Button variant="link" icon={<VlcIcon />} onClick={model.openInVlc}>Open in VLC</Button>`,
  wrapped in an inline-style positioning `<div>` for the
  `position: absolute; bottom: 60; left: 50%; transform: translateX(-50%)` placement
  (UIKit Button does not own its absolute positioning):
  ```tsx
  <div style={{ position: "absolute", bottom: 60, left: "50%", transform: "translateX(-50%)" }}>
      <Button variant="link" icon={<VlcIcon />} onClick={model.openInVlc}>Open in VLC</Button>
  </div>
  ```
  **Visual delta:** the original VLC icon was tinted `color.misc.vlc` (orange).
  UIKit Button's `link` variant uses `color.misc.blue` for icon + text.
  Acceptable trade-off for the more idiomatic primitive use.
- Keep `<VPlayer …>` consumption unchanged — only its internal chrome migrates.

### Step 2 — `VPlayer.tsx`

- Replace `styled.div VideoRoot` with `styled(Panel)` wrapper (Rule-7
  exception for video.js library descendant CSS):
  ```tsx
  const VideoRoot = styled(Panel)({
      position: "absolute",
      inset: 0,
      "[data-vjs-player], .video-js": {
          width: "100%",
          height: "100%",
      },
      "&[data-empty] .vjs-modal-dialog-content": {
          display: "none",
      },
      "& video.native": {
          width: "100%",
          height: "100%",
          outline: "none",
      },
  });
  ```
- Replace `className={src ? "vplayer" : "vplayer src-empty"}` with
  `data-empty={src ? undefined : ""}` (data-attribute, no className on UIKit
  components).
- Keep `<video>` / `<audio>` elements raw HTML — no UIKit wrapper around media
  elements per Rule-7 carve-out.
- Document the `styled(Panel)` use in a single-line comment above the
  definition: `// styled(Panel) wrapper — Rule 7 exception for video.js library descendant CSS (.video-js, .vjs-*, [data-vjs-player])`.

### Step 3 — `AudioControls.tsx`

- Drop `@emotion/styled`, drop `AudioControlsRoot`.
- Drop direct imports of `theme/color` for chrome styling (keep only for the
  time-label color override).
- Add UIKit imports: `Panel`, `IconButton`, `Slider` from `../../uikit`.
- Root: `<Panel height={44} shrink={false} align="center" gap="xs" paddingX="sm">`.
- Map buttons:
  - Play/Pause: `<IconButton size="sm" icon={playing ? <PauseIcon /> : <PlayIcon />} title={playing ? "Pause" : "Play"} hideUntilParentHover onClick={togglePlay} />`.
  - Next (conditional): `<IconButton size="sm" icon={<NextTrackIcon />} title="Next Track" hideUntilParentHover onClick={onNext} />`.
  - Mute toggle: `<IconButton size="sm" icon={muted ? <VolumeMutedIcon /> : <VolumeIcon />} title={muted ? "Unmute" : "Mute"} hideUntilParentHover onClick={toggleMute} />`.
  - Shuffle (conditional): `<IconButton size="sm" icon={<ShuffleIcon />} title={shuffle ? "Shuffle: On" : "Shuffle: Off"} active={shuffle} hideUntilParentHover onClick={onToggleShuffle} />`. **Visual delta:** existing inline `color.misc.blue` swaps to `color.icon.active` (theme blue tint) — acceptable.
- Time labels: plain `<span style={timeLabelStyle} data-visibility="parent-hover">{formatTime(...)}</span>` with `timeLabelStyle = { fontSize: 11, color: color.text.light, minWidth: 34, whiteSpace: "nowrap", textAlign: "center", flexShrink: 0 }`. (Replaces broken `color.text.muted` reference.)
- Seek bar → UIKit Slider with `showProgress`:
  ```tsx
  <Slider
      value={currentTime}
      onChange={(v) => {
          setCurrentTime(v);
          const audio = audioRef.current;
          if (audio) audio.currentTime = v;
      }}
      min={0}
      max={duration || 0}
      step={0.1}
      size="sm"
      showProgress
      onMouseDown={onSeekMouseDown}
      onMouseUp={onSeekMouseUp}
      data-visibility="parent-hover"
  />
  ```
  - `onMouseDown` / `onMouseUp` are accepted via `...rest` spread on
    Slider's root input (Slider extends `Omit<InputHTMLAttributes, ...>`).
  - **`data-visibility="parent-hover"`** on the Slider triggers the parent
    Panel's reveal-on-hover. **Visual delta:** the seek-bar at rest changes
    from `opacity: 0.4` (always partially visible) to `opacity: 0` (fully
    hidden, like the buttons). Cleaner UX consistent with the rest of the
    overlay. The original "0.4 → 1" half-shown pattern was a special-case;
    removing it aligns with the standard reveal pattern and drops the
    custom `<style>` tag entirely.
- Remove the `:hover::-webkit-slider-thumb { transform: scale(1.3); }`
  animation — not load-bearing, not worth replicating.

### Step 4 — `AudioPlayer.tsx`

- Drop `@emotion/styled`, drop `AudioPlayerRoot`.
- Drop `theme/color` import (only `color.background.dark` was used; move to
  inline style in the visualizer-area).
- Add UIKit imports: `Panel`.
- Root: `<Panel position="absolute" inset={0}>` (wraps everything; full-area).
- Visualizer area (clickable region wrapping the `<AudioVisualizer>`): plain
  `<div style={visualizerAreaStyle} onClick={togglePlayOnClick}>` —
  `cursor: pointer` and absolute positioning are inline-style:
  ```ts
  const visualizerAreaStyle: React.CSSProperties = {
      position: "absolute",
      inset: 0,
      overflow: "hidden",
      background: color.background.dark,
      cursor: "pointer",
  };
  ```
- Controls overlay (absolute-positioned, hover-reveals children, hover-fades
  its background): `<Panel revealChildrenOnHover position="absolute" bottom={20} rounded="md" overflow="hidden">`. **Problem:** Panel does not expose
  `transform: translateX(-50%)`, `left: "50%"`, `width: "33%"`,
  `min-width: fit-content`, or the hover-driven background-color transition.
  Some of these are Panel-expressible (`left="50%"`, `width="33%"`,
  `minWidth="fit-content"`), but `transform` and `transition` are not.
  - **Resolution:** wrap the Panel in a plain `<div style={…}>` for absolute
    positioning + transform; the inner Panel handles the
    `revealChildrenOnHover` semantics and its own background fade via
    a `:hover` rule that Panel doesn't natively expose.
  - Actually simpler: use plain `<div>` for both the positioning AND set
    `data-reveal-on-hover=""` on it manually so child UIKit
    `IconButton.hideUntilParentHover` instances respond. Panel's selector
    `[data-reveal-on-hover] [data-visibility="parent-hover"]` is keyed off
    the attribute, not Panel's `data-type`. **Verify** in implementation
    that the selector matches plain `<div>` ancestors.
  - **Fallback if the bare attribute doesn't work:** inject a tiny one-time
    `<style>` tag with the same rules, scoped by a unique attribute like
    `[data-audio-overlay]`. See US-514 C5 — this is the option-A path the
    user already approved.
  - Implementation (option A, plain div + injected `<style>`):
    ```tsx
    // Module top — runs once
    const overlayCss = `
      [data-audio-overlay] [data-visibility="parent-hover"] {
          opacity: 0; pointer-events: none; transition: opacity 0.15s;
      }
      [data-audio-overlay]:hover [data-visibility="parent-hover"],
      [data-audio-overlay]:focus-within [data-visibility="parent-hover"] {
          opacity: 1; pointer-events: auto;
      }
      [data-audio-overlay] { background: transparent; transition: background 0.2s; }
      [data-audio-overlay]:hover { background: ${color.background.dark}; }
    `;
    useEffect(() => {
        const id = "audio-overlay-styles";
        if (document.getElementById(id)) return;
        const el = document.createElement("style");
        el.id = id; el.textContent = overlayCss;
        document.head.appendChild(el);
    }, []);
    // ...
    const overlayStyle: React.CSSProperties = {
        position: "absolute",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        width: "33%",
        minWidth: "fit-content",
        borderRadius: 8,
        overflow: "hidden",
        pointerEvents: "auto",
    };
    return (
        <Panel position="absolute" inset={0}>
            <div style={visualizerAreaStyle} onClick={togglePlayOnClick}>
                <AudioVisualizer mediaRef={audioRef} playing={playing} sourceUrl={sourceUrl} />
            </div>
            <audio ref={audioRef} src={src} autoPlay muted={muted} style={{ display: "none" }} />
            <div data-audio-overlay="" style={overlayStyle}>
                <AudioControls audioRef={audioRef} playing={playing} hasNext={hasNext} shuffle={shuffle} onNext={onNext} onToggleShuffle={onToggleShuffle} />
            </div>
        </Panel>
    );
    ```

### Step 5 — `AudioVisualizer.tsx`

- Drop `@emotion/styled`, drop all 4 styled definitions.
- Drop wide `theme/color` imports for chrome; keep only what's needed for
  inline-style constants (track-title color is `color.text.default`,
  track-artist is `color.text.light` — replaces broken `text.normal`/`text.muted`).
- Add UIKit imports: `Panel`, `IconButton` from `../../uikit`.
- Root: `<Panel position="relative" width="100%" height="100%" revealChildrenOnHover>`.
- Canvas: plain `<canvas ref={canvasRef} style={canvasStyle} />` with
  `canvasStyle = { width: "100%", height: "100%", display: "block" }`.
- Track-info overlay: plain `<div style={trackInfoOverlayStyle}>` with
  inline-style constant; child `<div style={trackTitleStyle}>{trackInfo.title}</div>`
  and `<div style={trackArtistStyle}>{trackInfo.artist}</div>`. Single-line
  ellipsis preserved via `whiteSpace: "nowrap"`, `overflow: "hidden"`,
  `textOverflow: "ellipsis"`.
- Effect switcher: plain `<div style={effectSwitcherStyle} data-visibility="parent-hover">` (so the parent Panel's reveal-on-hover hides it at rest):
  ```ts
  const effectSwitcherStyle: React.CSSProperties = {
      position: "absolute", top: 8, right: 8,
      display: "flex", gap: 4,
  };
  ```
- Effect buttons → UIKit `IconButton variant="chip" size="sm" active={selectedEffect === type} title={label} icon={icon}` × 3 (US-520 Phase 2).
  Click handler retains `e.stopPropagation()` so the toggle doesn't trigger
  the parent visualizer-area's play/pause:
  ```tsx
  <IconButton
      key={type}
      variant="chip"
      size="sm"
      active={selectedEffect === type}
      title={label}
      icon={icon}
      onClick={(e) => { e.stopPropagation(); settings.set("visualizer-effect", type); }}
  />
  ```

### Step 6 — Smoke verify and lint

- Run `npm run lint`. Pre-existing 928 problems (20 errors, 908 warnings) baseline.
  No new errors, no new warnings expected from any in-scope file.
- Run `npx tsc --noEmit`. Pre-existing errors elsewhere (automation, scripting/worker,
  link-editor, ui/tabs) are NOT this task's concern. Verify no new errors in
  `src/renderer/editors/video/*`.
- Manual UI smoke (see Test surface below).
- Grep verification:
  ```bash
  # Must return ONE match: VPlayer.tsx documented styled(Panel) Rule-7 exception
  grep -r "@emotion/styled" src/renderer/editors/video/

  # Must return ZERO matches
  grep -rE "components/(basic|form|layout|overlay)" src/renderer/editors/video/
  ```

## Concerns / Open questions

All resolved with user direction.

### C1 — Seek-bar progress-fill gradient — RESOLVED

**Resolution:** Extend UIKit Slider with `showProgress?: boolean` (US-520
Phase 1). Audio seek-bar consumes the new prop.

### C2 — AudioVisualizer EffectButton chip look — RESOLVED

**Resolution:** Extend UIKit IconButton with `variant="chip"` (US-520
Phase 2). Effect switcher consumes the new variant + `active`.

### C3 — VLC fallback button — RESOLVED

**Resolution:** UIKit `<Button variant="link" icon={<VlcIcon />}>Open in VLC</Button>`
wrapped in an inline-style positioning div. Button's `link` variant renders
as a bordered chip with `color.misc.blue` text (Button.tsx:111-121). Original
`color.misc.vlc` icon tint becomes `color.misc.blue` — minor visual delta,
accepted.

### C4 — `styled(Panel)` wrapper for VPlayer — RESOLVED

**Resolution:** `styled(Panel)` wrapper (Rule-7 exception), precedent
`GraphDetailPanel`. Documented inline.

### C5 — Reveal-on-hover for AudioPlayer controls overlay — RESOLVED

**Resolution:** Option A — plain `<div data-audio-overlay style={…}>` for the
overlay positioning + a one-time injected `<style>` tag for the
hover-driven reveal and background fade. No `@emotion/styled` in
`AudioPlayer.tsx`.

The original seek-bar `0.4 → 1` opacity behavior is dropped — the seek-bar
now follows the standard `0 → 1` reveal pattern like the buttons (via
`data-visibility="parent-hover"` on the UIKit Slider). Simpler, consistent.

### C6 — Broken color-token references — RESOLVED

**Resolution:** `color.text.muted` → `color.text.light`; `color.text.normal`
→ `color.text.default`. Done during migration.

### C7 — Seek-bar thumb hover-scale animation — RESOLVED

**Resolution:** Remove the animation. Not load-bearing.

### C8 — Raw `<video>` and `<audio>` elements — RESOLVED

**Resolution:** Stay native HTML. No UIKit wrapper for media elements.

## Test surface (manual smoke)

After implementation, in `npm start`:

**Video playback (MP4):**
- Open a local `.mp4` file. Video plays with video.js controls overlay.
- Toolbar URL input shows the file path; typing a new URL + Enter loads it.
- File Explorer toggle button (NavPanelIcon) opens / closes side panel
  when applicable.
- Player state badge appears for non-`playing/paused/stopped` states (e.g.
  `loading`, `error`, `unsupported format`).
- VLC fallback button (bordered blue chip with VLC icon + "Open in VLC")
  appears in error/unsupported states; clicking opens VLC.
- Switching tabs preserves playback state.

**HLS playback (M3U8):**
- Open or paste an `.m3u8` URL. hls.js wires up; video plays.
- cURL-with-headers paste in URL textarea is parsed; headers forwarded to
  hls.js via `NodeFetchHlsLoader`.

**Audio playback (MP3/WAV/etc.):**
- Open a local `.mp3` file. Audio player chrome renders.
- Effect switcher (top-right of visualizer) is **hidden by default**; reveals
  on visualizer hover. Three IconButton chips: Bars, Circular, None. Active
  chip has yellow icon + light-background chip look; hover any inactive chip
  changes border to active blue + icon to yellow. Setting persists.
- When effect = "none", track title + artist render in centered overlay
  (parsed from filename if MediaSession metadata absent).
- Controls overlay at bottom-center is **hidden by default**; reveals on
  hover. Buttons (play/pause, mute, optionally next, optionally shuffle)
  appear; time-labels appear; seek bar appears with played-portion gradient.
  Overlay background fades in on hover.
- Shuffle toggle button shows active tint when shuffle-on.
- Seek bar drag scrubs playback; played portion fills with active blue.
- Next track button (when `hasNext`) skips to next sibling track.
- On track end, `playNext()` is invoked.

**URL input textarea:**
- Single-line URL → Enter submits. Shift+Enter inserts newline.
- Long cURL paste expands to max 72px tall, then scrolls.

**Side effects:**
- Switching tabs preserves audio playback (in background).
- Closing the tab disposes streaming sessions.
- Mute state persists across player instances in the session.

## Acceptance criteria

- [ ] `grep -r "@emotion/styled" src/renderer/editors/video/` returns
      **only one match**: `VPlayer.tsx`'s documented `styled(Panel)` wrapper.
- [ ] `grep -rE "components/(basic|form|layout|overlay)" src/renderer/editors/video/`
      returns **zero matches**.
- [ ] No `style=` / `className=` props passed to any UIKit component (TS
      enforces this at type level).
- [ ] `npm run lint` reports the pre-existing baseline (928 problems,
      20 errors, 908 warnings) — no new errors or warnings from in-scope
      files.
- [ ] `npx tsc --noEmit` reports no new errors in
      `src/renderer/editors/video/*`.
- [ ] Manual smoke (above) passes — no visible regressions vs. pre-migration
      (except the intentional visual deltas listed in the Concerns section:
      VLC icon color, shuffle active tint, seek-bar hidden-at-rest).

This task does NOT run `/review`, `/document`, or `/userdoc` — those run at
EPIC-025 close per the epic's deferred review model.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/editors/video/VideoPlayerEditor.tsx` | Drop `@emotion/styled`, `VideoEditorRoot`, `UrlInputArea`. Drop `components/basic/{Button,TextAreaField}` imports. Add UIKit `Panel`, `Textarea`, `IconButton`, `Button`, `Text`. Inline-style constants for `.state-badge`. VLC chip → `<Button variant="link" icon={<VlcIcon />}>` in an absolute-positioning div. |
| `src/renderer/editors/video/VPlayer.tsx` | Replace `styled.div VideoRoot` with **documented `styled(Panel)` Rule-7 exception** for video.js descendant CSS. Replace `className="src-empty"` with `data-empty=""`. |
| `src/renderer/editors/video/AudioPlayer.tsx` | Drop `@emotion/styled`, `AudioPlayerRoot`. Add UIKit `Panel`. Visualizer-area and controls-overlay become plain `<div>`s with inline styles. Inject one-time `<style>` tag scoped via `[data-audio-overlay]` for reveal-on-hover + background fade. `<audio>` stays raw with `style={{display:"none"}}`. |
| `src/renderer/editors/video/AudioControls.tsx` | Drop `@emotion/styled`, `AudioControlsRoot`. Add UIKit `Panel`, `IconButton`, `Slider`. All 4 transport buttons → IconButton with `hideUntilParentHover` and `active` (shuffle). Time labels → `<span>` with inline style + `data-visibility="parent-hover"`. Seek bar → UIKit Slider with `showProgress` + `data-visibility="parent-hover"`. Fix broken `color.text.muted` → `color.text.light`. Drop thumb hover-scale animation. |
| `src/renderer/editors/video/AudioVisualizer.tsx` | Drop `@emotion/styled`, all 4 styled definitions. Add UIKit `Panel` (`revealChildrenOnHover`), `IconButton`. Canvas → plain `<canvas>` with inline style. Track-info-overlay → inline-style divs (single-line ellipsis). Effect-switcher → inline-style div with `data-visibility="parent-hover"`. Effect buttons → UIKit `IconButton variant="chip"` × 3. Fix broken `color.text.normal` → `color.text.default` and `color.text.muted` → `color.text.light`. |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- **Blocked on:** [US-520: UIKit primitive additions](../US-520-uikit-video-editor-precursors/README.md) (Slider.showProgress + IconButton.variant="chip")
- References:
  - [US-513 Graph editor migration](../US-513-graph-editor-migration/README.md) — inline-style chrome pattern, `styled(Panel)` Rule-7 exception precedent
  - [US-512 Notebook migration](../US-512-notebook-editor-migration/README.md) — canonical badge/overlay inline-style template
  - [US-519 UIKit Graph editor precursors](../US-519-uikit-graph-editor-precursors/README.md) — same precursor-bundle pattern (Slider primitive, IconButton.strikethrough, Text link variant)
