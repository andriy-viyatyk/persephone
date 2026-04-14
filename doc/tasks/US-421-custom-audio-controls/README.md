# US-421: Custom Audio Controls Bar

## Goal

Replace the native `<audio controls>` bar with a custom-styled control panel for audio-only playback, while keeping native controls on the video player. The custom bar must be easy to extend with new buttons (repeat, shuffle, etc.) in the future.

---

## Background

### Current state

`src/renderer/editors/video/AudioPlayer.tsx` renders:
```tsx
<AudioPlayerRoot>
    <div className="visualizer-area" onClick={togglePlayPause}>
        <AudioVisualizer ... />
    </div>
    <audio ref={audioRef} className="audio-native" src={src} controls autoPlay muted={muted}
        style={{ colorScheme: ... }} />
</AudioPlayerRoot>
```

The `controls` attribute on `<audio>` renders the native Chromium control bar (~40px tall). We want to remove it and draw our own.

Video path (`NativePlayer` in `VPlayer.tsx`) keeps native `<video controls>` — no change there.

### Available icons in `src/renderer/theme/icons.tsx`
- `VolumeIcon` (line 1157) — speaker with sound waves
- `VolumeMutedIcon` (line 1165) — speaker muted
- No `PlayIcon` / `PauseIcon` — will add inline SVGs in `AudioControls.tsx` (same pattern as `BarsIcon`, `CircularIcon` in `AudioVisualizer.tsx`)

### Seek bar pattern
`GraphTuningSliders.tsx` shows the Emotion `<input type="range">` styling pattern:
```css
appearance: none;
height: 4px;
background: color.border.default;
border-radius: 2px;
&::-webkit-slider-thumb {
    appearance: none;
    width: 12px; height: 12px;
    border-radius: 50%;
    background: color.graph.nodeHighlight; /* we'll use color.border.active */
}
```
For a seek bar we also need a progress fill — achieved via inline `background` style:
```css
background: linear-gradient(to right, activeColor ${pct}%, trackColor ${pct}%)
```

### Color tokens (from `color.ts`)
All colors come from `import color from "../../theme/color"`. No hex/rgb directly.

---

## Implementation Plan

### Step 1 — Add icons to `icons.tsx`

File: `src/renderer/theme/icons.tsx`

Add after `StopIcon` (line ~1135):
```tsx
export const PlayIcon = createIcon(24)(
    <path d="M8 5v14l11-7L8 5z" fill="currentColor" />
);

export const PauseIcon = createIcon(24)(
    <g fill="currentColor">
        <rect x="6" y="5" width="4" height="14" rx="1" />
        <rect x="14" y="5" width="4" height="14" rx="1" />
    </g>
);
```

### Step 2 — Create `AudioControls.tsx`

New file: `src/renderer/editors/video/AudioControls.tsx`

Layout (left → right, height 44px):
```
[Play/Pause] [0:42] [════════════════seek bar════════════════] [4:00] [Volume/Mute]
```

**Props:**
```typescript
export interface AudioControlsProps {
    audioRef: React.RefObject<HTMLAudioElement>;
    playing: boolean;
}
```

**State:**
- `currentTime: number` — updated from `timeupdate` event
- `duration: number` — updated from `loadedmetadata` / `durationchange`
- `muted: boolean` — updated from `volumechange` event
- `isSeeking: boolean` (ref, not state) — suppresses `timeupdate` during drag

**Audio events (all attached in one `useEffect([audioRef])`):**
- `timeupdate` → if not seeking: `setCurrentTime(audio.currentTime)`
- `loadedmetadata` / `durationchange` → `setDuration(audio.duration || 0)`
- `volumechange` → `setMuted(audio.muted)`

**Handlers:**
```typescript
const togglePlay = () => playing ? audio.pause() : audio.play();
const toggleMute = () => { audio.muted = !audio.muted; };
const onSeekChange = (e) => {
    audio.currentTime = Number(e.target.value);
    setCurrentTime(Number(e.target.value));
};
```

**Seek bar fill** (inline style updated each render):
```typescript
const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
// applied as: style={{ background: `linear-gradient(to right, ${color.border.active} ${pct}%, ${color.border.default} ${pct}%)` }}
```

**Time format helper:**
```typescript
function formatTime(sec: number): string {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}
```

**Styled components:**
```typescript
const ControlsRoot = styled.div`
    height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    background: ${color.background.dark};
    border-top: 1px solid ${color.border.default};
`;

const ControlButton = styled.button`
    width: 32px; height: 32px;
    border: none; background: none;
    color: ${color.icon.light};
    cursor: pointer; border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    &:hover { color: ${color.icon.default}; background: ${color.background.light}; }
`;

const TimeLabel = styled.span`
    font-size: 11px;
    color: ${color.text.muted};
    min-width: 34px;
    white-space: nowrap;
`;

const SeekBar = styled.input`
    flex: 1;
    height: 4px;
    appearance: none;
    border-radius: 2px;
    outline: none;
    cursor: pointer;
    &::-webkit-slider-thumb {
        appearance: none;
        width: 12px; height: 12px;
        border-radius: 50%;
        background: ${color.border.active};
        margin-top: -4px;
    }
    &::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; }
`;
```

### Step 3 — Update `AudioPlayer.tsx`

File: `src/renderer/editors/video/AudioPlayer.tsx`

Changes:
1. Import `AudioControls` from `./AudioControls`
2. Remove `controls` attribute and `style={{ colorScheme }}` from `<audio>`
3. Set `<audio>` height to 0 / hidden (keep it in DOM for playback, just invisible)
4. Replace the `<audio className="audio-native">` area with `<AudioControls audioRef={audioRef} playing={playing} />`

Before:
```tsx
<audio ref={audioRef} className="audio-native" src={src} controls autoPlay muted={muted}
    style={{ colorScheme: isCurrentThemeDark() ? "dark" : "light" }} />
```

After:
```tsx
<audio ref={audioRef} src={src} autoPlay muted={muted} style={{ display: "none" }} />
<AudioControls audioRef={audioRef} playing={playing} />
```

Also remove the `audio-native` CSS class rule from `AudioPlayerRoot` (it's no longer needed).

---

## Concerns / Open Questions

1. **`audio.play()` returns a Promise** — should be `.catch(() => {})` to suppress uncaught rejection if play is blocked by autoplay policy. Low risk since user already interacted.

2. **Seek bar during fast drag** — `audio.currentTime` assignment on every `onChange` fires many times. The audio element handles this fine (it seeks to latest value), but we should debounce the visual `currentTime` state update during drag via an `isSeeking` ref to avoid React re-render storm. Pattern: `onMouseDown` → `isSeekingRef.current = true`, `onMouseUp` → `isSeekingRef.current = false`.

3. **`duration` is `NaN` before metadata loads** — guard with `isFinite(duration)`.

4. **Future buttons (repeat, shuffle)** — `ControlsRoot` uses flexbox, so new `ControlButton` elements drop in naturally on either side.

---

## Acceptance Criteria

- [ ] Native audio control bar is no longer visible for audio files
- [ ] Custom bar shows: play/pause, current time, seek bar, total duration, mute toggle
- [ ] Clicking play/pause works
- [ ] Dragging seek bar scrubs audio position
- [ ] Mute button toggles mute, icon changes accordingly
- [ ] Time labels update in real time during playback
- [ ] Video player (NativePlayer / HlsPlayer) is unaffected — still shows native controls
- [ ] Dark and light themes both look correct

---

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/theme/icons.tsx` | Add `PlayIcon`, `PauseIcon` |
| `src/renderer/editors/video/AudioControls.tsx` | **New file** — custom control bar component |
| `src/renderer/editors/video/AudioPlayer.tsx` | Remove `controls` from `<audio>`, add `<AudioControls>` |
