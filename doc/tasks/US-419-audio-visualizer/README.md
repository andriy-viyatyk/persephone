# US-419: Audio Visualizer for Audio-Only Files in Video Player

## Goal

When the Video Player opens an audio-only file (`.mp3`, `.wav`, `.aac`, `.flac`, `.m4a`), replace the black empty video area with an animated spectrum analyzer (equalizer bars) that reacts to the playing audio.

---

## Background

### Current state
- The Video Player (`VPlayer.tsx`) has two rendering paths:
  - **HLS** (`format === "m3u8"`): uses `HlsPlayer` (video.js + hls.js)
  - **Native** (everything else, including "mp4"): uses `NativePlayer` — a plain `<video>` HTML element
- Audio-only files are registered in `register-editors.ts` as of US-419 prep (`.mp3`, `.wav`, `.aac`, `.flac`, `.m4a` added to `acceptFile`)
- `detectVideoFormat()` in `video-types.ts` currently returns only `"mp4"` or `"m3u8"` — audio files fall through as `"mp4"` (black screen, audio plays)
- `VideoFormat` type is `"mp4" | "m3u8"`

### How audio visualization works (Web Audio API)
```
<audio> element
    → AudioContext.createMediaElementSource(audioEl)
    → AnalyserNode (FFT)
    → requestAnimationFrame loop
    → analyser.getByteFrequencyData(dataArray)
    → draw bars on <canvas>
```
`createMediaElementSource()` may only be called **once per media element** — the `AudioContext` and source node must live in a ref.

The `AudioContext` requires user gesture to start (autoplay policy), but since audio starts playing on user submit/open, it is safe to create the `AudioContext` in a `"canplay"` or `"playing"` event handler or lazily on first frame draw.

### Streaming server compatibility
The streaming server (`video-stream-server.ts`) proxies both file paths and HTTP URLs, returning a `streamingUrl`. Audio files should be treated identically to MP4 — proxied through the streaming server for HTTP range request support. No changes needed there.

### Related files
- `src/renderer/editors/video/video-types.ts` — `VideoFormat` type, `detectVideoFormat()`
- `src/renderer/editors/video/VPlayer.tsx` — `NativePlayer`, `HlsPlayer`, `VPlayer` component
- `src/renderer/editors/video/VideoPlayerEditor.tsx` — model, `resolveStreamUrl()`, `submitUrl()`
- `src/renderer/editors/register-editors.ts` — `acceptFile` with audio extensions (already added)
- `src/renderer/theme/color.ts` — color tokens (CSS variables, cannot use hex directly in canvas)

### Canvas color constraint
`color.ts` exports CSS variable strings like `"var(--color-misc-blue)"`. Canvas `fillStyle` does **not** resolve CSS variables. For the visualizer canvas, raw color values must be used (hard-coded or resolved via `getComputedStyle`). The approach: resolve via `getComputedStyle(document.body).getPropertyValue("--color-misc-orange")` — but since this color doesn't exist yet, we'll hard-code warm amber/orange hex values inside the visualizer (acceptable exception for canvas drawing only, same pattern used in graph/draw editors if any).

---

## Implementation Plan

### Phase 1 — US-419: Core audio detection + spectrum visualizer

#### Step 1: Extend `VideoFormat` in `video-types.ts`

File: `src/renderer/editors/video/video-types.ts`

Add `"audio"` to the union and detect audio extensions:

```typescript
// Before
export type VideoFormat = "mp4" | "m3u8";

export function detectVideoFormat(src: string): VideoFormat {
    if (src.includes(".m3u8") || src.includes("media-hls.")) return "m3u8";
    return "mp4";
}

// After
export type VideoFormat = "mp4" | "m3u8" | "audio";

const AUDIO_EXTENSIONS = [".mp3", ".wav", ".aac", ".flac", ".m4a"];

export function detectVideoFormat(src: string): VideoFormat {
    if (src.includes(".m3u8") || src.includes("media-hls.")) return "m3u8";
    const lower = src.toLowerCase();
    if (AUDIO_EXTENSIONS.some((ext) => lower.includes(ext))) return "audio";
    return "mp4";
}
```

#### Step 2: Update `resolveStreamUrl` in `VideoPlayerEditor.tsx`

File: `src/renderer/editors/video/VideoPlayerEditor.tsx` — `resolveStreamUrl` method (line ~81)

Currently skips streaming for `m3u8` only. Update to treat `"audio"` like `"mp4"` (already handled by the else branch — no change needed since `"audio"` is not `"m3u8"`).

Also check `submitUrl` (line ~103): the condition `if (format !== "m3u8")` already covers "audio" correctly.

**No code change needed in `VideoPlayerEditor.tsx`** — both `"audio"` and `"mp4"` are handled by the same branch.

#### Step 3: Create `AudioVisualizer.tsx`

New file: `src/renderer/editors/video/AudioVisualizer.tsx`

Full component — canvas-based spectrum analyzer:

```typescript
import { useEffect, useRef } from "react";
import styled from "@emotion/styled";

const CanvasRoot = styled.canvas`
    width: 100%;
    height: 100%;
    display: block;
`;

interface AudioVisualizerProps {
    mediaRef: React.RefObject<HTMLMediaElement>;
    playing: boolean;
}

const FFT_SIZE = 128;         // 64 frequency bins
const BAR_COUNT = 48;
const BAR_GAP = 3;
// Warm amber→yellow gradient — acceptable canvas hard-code (CSS vars don't work in canvas)
const COLOR_BOTTOM = "#e67e00";  // amber
const COLOR_TOP = "#ffe066";     // yellow

export function AudioVisualizer({ mediaRef, playing }: AudioVisualizerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
    const rafRef = useRef<number>(0);

    // Set up AudioContext lazily on first play
    useEffect(() => {
        if (!playing) return;
        const media = mediaRef.current;
        if (!media || audioCtxRef.current) return;

        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = 0.8;

        const source = ctx.createMediaElementSource(media);
        source.connect(analyser);
        analyser.connect(ctx.destination);

        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        sourceRef.current = source;
    }, [playing, mediaRef]);

    // Resume AudioContext on play (browser autoplay policy may suspend it)
    useEffect(() => {
        if (playing && audioCtxRef.current?.state === "suspended") {
            audioCtxRef.current.resume();
        }
    }, [playing]);

    // Animation loop
    useEffect(() => {
        const canvas = canvasRef.current;
        const analyser = analyserRef.current;
        if (!canvas || !analyser) return;

        const ctx2d = canvas.getContext("2d")!;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const draw = () => {
            rafRef.current = requestAnimationFrame(draw);

            const W = canvas.offsetWidth;
            const H = canvas.offsetHeight;
            if (canvas.width !== W) canvas.width = W;
            if (canvas.height !== H) canvas.height = H;

            analyser.getByteFrequencyData(dataArray);

            ctx2d.clearRect(0, 0, W, H);

            const barWidth = (W - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT;

            for (let i = 0; i < BAR_COUNT; i++) {
                // Map bar index to frequency bin — logarithmic-ish distribution
                const binIndex = Math.round(
                    Math.pow(i / BAR_COUNT, 1.5) * (dataArray.length - 1)
                );
                const value = dataArray[binIndex] / 255;
                const barH = Math.max(2, value * H * 0.9);
                const x = i * (barWidth + BAR_GAP);
                const y = H - barH;

                const grad = ctx2d.createLinearGradient(x, H, x, y);
                grad.addColorStop(0, COLOR_BOTTOM);
                grad.addColorStop(1, COLOR_TOP);

                ctx2d.fillStyle = grad;
                ctx2d.beginPath();
                ctx2d.roundRect(x, y, barWidth, barH, [2, 2, 0, 0]);
                ctx2d.fill();
            }
        };

        rafRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(rafRef.current);
    }, [playing]); // restart loop when playing state changes

    // Cleanup AudioContext on unmount
    useEffect(() => {
        return () => {
            cancelAnimationFrame(rafRef.current);
            audioCtxRef.current?.close();
        };
    }, []);

    return <CanvasRoot ref={canvasRef} />;
}
```

**Note:** `ctx2d.roundRect()` is available in Chromium (Electron). No polyfill needed.

#### Step 4: Create `AudioPlayer.tsx`

New file: `src/renderer/editors/video/AudioPlayer.tsx`

Self-contained module — owns the `<audio>` element, layout, and wires up the visualizer. Designed as a standalone component so it can grow independently with future visual enhancements.

Props interface mirrors the pattern used by `NativePlayer` in `VPlayer.tsx` (state change refs instead of callbacks to avoid stale closure issues):

```typescript
import { useEffect, useRef, useState } from "react";
import styled from "@emotion/styled";
import { AudioVisualizer } from "./AudioVisualizer";
import type { PlayerState } from "./video-types";

export interface AudioPlayerProps {
    src: string;
    muted?: boolean;
    onStateChangeRef: React.RefObject<((state: PlayerState, error?: unknown) => void) | undefined>;
    onMutedChangeRef: React.RefObject<((muted: boolean) => void) | undefined>;
}

const AudioPlayerRoot = styled.div`
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;

    & .visualizer-area {
        flex: 1;
        position: relative;
        overflow: hidden;
    }

    & audio.audio-native {
        width: 100%;
        height: 40px;
        flex-shrink: 0;
        outline: none;
        background: #000;
    }
`;

export function AudioPlayer({ src, muted, onStateChangeRef, onMutedChangeRef }: AudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const onLoadStart = () => onStateChangeRef.current?.("loading");
        const onPlaying = () => { onStateChangeRef.current?.("playing"); setPlaying(true); };
        const onPause = () => { onStateChangeRef.current?.("paused"); setPlaying(false); };
        const onVolumeChange = () => onMutedChangeRef.current?.(audio.muted);
        const onError = () => {
            setPlaying(false);
            const err = audio.error;
            if (err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
                onStateChangeRef.current?.("unsupported format", err);
            } else {
                onStateChangeRef.current?.("error", err ?? undefined);
            }
        };

        audio.addEventListener("loadstart", onLoadStart);
        audio.addEventListener("playing", onPlaying);
        audio.addEventListener("pause", onPause);
        audio.addEventListener("volumechange", onVolumeChange);
        audio.addEventListener("error", onError);

        return () => {
            audio.removeEventListener("loadstart", onLoadStart);
            audio.removeEventListener("playing", onPlaying);
            audio.removeEventListener("pause", onPause);
            audio.removeEventListener("volumechange", onVolumeChange);
            audio.removeEventListener("error", onError);
        };
    }, [onStateChangeRef, onMutedChangeRef]);

    useEffect(() => {
        if (audioRef.current) audioRef.current.muted = muted ?? false;
    }, [muted]);

    return (
        <AudioPlayerRoot>
            <div className="visualizer-area">
                <AudioVisualizer mediaRef={audioRef} playing={playing} />
            </div>
            <audio
                ref={audioRef}
                className="audio-native"
                src={src}
                controls
                autoPlay
                muted={muted}
            />
        </AudioPlayerRoot>
    );
}
```

`AudioPlayer` does not need `parsedRequest` — audio files are always local files or plain HTTP URLs (no cURL use case).

#### Step 5: Update `VPlayer.tsx` to import and use `AudioPlayer`

File: `src/renderer/editors/video/VPlayer.tsx`

Add import and add the audio branch in the render. No new components or styled components added here — `VPlayer.tsx` stays thin.

```typescript
// Add import
import { AudioPlayer } from "./AudioPlayer";

// Update VPlayer component
// Before
const isHls = format === "m3u8" && Hls.isSupported();

return (
    <VideoRoot className={src ? "vplayer" : "vplayer src-empty"}>
        {src && isHls && <HlsPlayer ... />}
        {src && !isHls && <NativePlayer ... />}
    </VideoRoot>
);

// After
const isHls = format === "m3u8" && Hls.isSupported();
const isAudio = format === "audio";

return (
    <VideoRoot className={src ? "vplayer" : "vplayer src-empty"}>
        {src && isHls && <HlsPlayer ... />}
        {src && !isHls && !isAudio && <NativePlayer ... />}
        {src && isAudio && (
            <AudioPlayer
                src={src}
                muted={muted}
                onStateChangeRef={onStateChangeRef}
                onMutedChangeRef={onMutedChangeRef}
            />
        )}
    </VideoRoot>
);
```

No new imports needed in `VPlayer.tsx` itself (`useState` stays out — it belongs in `AudioPlayer.tsx`).

### Phase 2 — US-420: Visual enhancements (optional, future task)

Potential additions (not in scope for US-419):
- Peak hold indicators (small horizontal line at peak value, slow fall-off)
- Waveform mode (oscilloscope) as an alternative to bars
- Circular/radial bar layout
- Color theme selection (matching app theme — resolve CSS vars at component mount)
- Reflection/mirror effect below the bars

---

## Concerns / Open Questions

1. **`AudioContext` suspended state**: Browsers require user gesture before `AudioContext` can run. The audio element starts playing on user action (submitting URL or opening file), so creating the `AudioContext` in the `"playing"` event should be safe. Handled by lazy init in `useEffect([playing])`.

2. **`createMediaElementSource()` once-only constraint**: If the user enters a new audio URL, `VPlayer` unmounts and remounts `AudioPlayer` (because `src` changes, the component key changes via React reconciliation). This means a fresh `AudioContext` is created each time — correct behavior. The cleanup `useEffect` closes the old `AudioContext` on unmount.

3. **`canvas.roundRect()`**: Available in Chromium 99+ (Electron 39 uses Chromium ~128). No issue.

4. **`AudioPlayer` as separate module**: `AudioPlayer.tsx` is its own file — owns layout, styled components, and `<audio>` element lifecycle. `VPlayer.tsx` just imports and renders it, staying thin. `AudioPlayerRoot` (positioned absolute inside `VideoRoot`) matches the layout of `NativePlayer` exactly.

5. **Mute button on PageTab**: The existing mute button (`toggleMuteAll`) writes `pageMuted` state, which is passed as `muted` prop to `VPlayer` → `AudioPlayer`. `AudioPlayer` applies it to the `<audio>` element via `useEffect([muted])`. This works identically to `NativePlayer`.

---

## Acceptance Criteria

- [ ] Opening an `.mp3`, `.wav`, `.aac`, `.flac`, or `.m4a` file shows the Video Player with an animated spectrum visualizer above audio controls
- [ ] Pasting an audio URL into the player input also triggers the visualizer
- [ ] Bars animate in real-time responding to the audio frequencies while playing
- [ ] Bars are static (all at zero/minimum) when audio is paused
- [ ] Audio controls (play/pause, seek, volume) work correctly
- [ ] Mute button on the page tab mutes/unmutes the audio
- [ ] Opening a different audio URL replaces the visualizer without errors
- [ ] No `AudioContext` leak — closing the tab disposes the context
- [ ] MP4/video files are unaffected (still use `NativePlayer`)

---

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/editors/video/video-types.ts` | Add `"audio"` to `VideoFormat`, update `detectVideoFormat()` |
| `src/renderer/editors/video/VPlayer.tsx` | Import `AudioPlayer`, add audio branch to `VPlayer` render (no new components here) |
| `src/renderer/editors/video/AudioPlayer.tsx` | **New file** — `<audio>` element + layout, wires `AudioVisualizer`; self-contained module |
| `src/renderer/editors/video/AudioVisualizer.tsx` | **New file** — canvas spectrum analyzer component |
| `src/renderer/editors/video/VideoPlayerEditor.tsx` | No changes needed |
| `src/renderer/editors/register-editors.ts` | No changes needed (audio extensions already added) |
