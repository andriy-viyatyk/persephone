# US-413: Video Playback Component (video.js + hls.js)

## Goal

Create the `VPlayer` React component backed by video.js + hls.js, create the `NodeFetchHlsLoader` for header-authenticated HLS streams, and integrate them into the existing `VideoPlayerEditor` shell (replacing the `{/* US-413: VPlayer component will be inserted here */}` placeholder).

---

## Background

### What exists after US-412

`src/renderer/editors/video/VideoPlayerEditor.tsx` has the full editor shell:
- `VideoEditorState` with `url`, `format`, `playerState`, `muted`, `parsedRequest` fields
- `VideoEditorModel` with callbacks `onPlayerStateChange(playerState, error?)` and `onMutedChange(muted)`
- React component with `PageToolbar` (URL input) and `VideoArea` (placeholder div)
- Placeholder comment at line 183: `{/* US-413: VPlayer component will be inserted here */}`

`src/renderer/editors/video/video-types.ts` has `VideoFormat`, `PlayerState`, `detectVideoFormat()` — no changes needed.

### Reference implementation

av-player VPlayer lives at `D:/projects/av-player/src/renderer/controls/VPlayer.tsx`.

Key aspects to **port**:
- `videojs(ref, { controls: true, autoplay: true, preload: "auto", muted })` — player init
- `player.on("loadstart"|"playing"|"pause"|"volumechange"|"error", ...)` — event listeners
- `Hls.isSupported()` guard + `hls.loadSource(src); hls.attachMedia(video)` — HLS attach
- `getPicture()` — capture current frame to JPEG data URL via canvas

Key aspects to **adapt**:
- av-player uses `TComponentModel` (a class pattern) — Persephone VPlayer should be a plain functional component with `useRef` for mutable refs (`playerRef`, `hlsRef`)
- av-player VPlayer accepts `videoFormat` prop — Persephone VPlayer accepts `format` prop (already used in VideoEditorState)
- av-player has no `parsedRequest` prop — add it for NodeFetchHlsLoader integration
- av-player uses `clsx` — not available in Persephone; use plain ternary/template literal

Key aspects to **skip**:
- `forwardRef` / `useImperativeHandle` — not needed; model callbacks are sufficient
- Torrent/magnet support — out of scope for Persephone

### NodeFetchHlsLoader

EPIC-024 has the complete implementation (see EPIC-024.md Architecture section). It:
- Is a class factory `createNodeFetchLoaderClass(headers)` returning a `class` compatible with `HlsConfig.loader`
- Replaces hls.js's XHR loader when `parsedRequest` has headers — bypasses Chromium's forbidden header restrictions
- Imports `nodeFetch` dynamically from `../../api/node-fetch`
- Captures cURL headers in closure; used for every playlist + segment request
- Only activated when `parsedRequest?.headers` is non-empty; plain M3U8 uses default loader

### VideoArea styling

Current `VideoArea` (in VideoPlayerEditor.tsx):
```typescript
const VideoArea = styled.div`
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
`;
```

When VPlayer renders, its root must fill VideoArea. `align-items: center` + `justify-content: center` centers flex children, which is correct for the placeholder text but not for VPlayer. The VPlayer root will use `width: 100%; height: 100%` which overrides the centering.

### npm packages

Persephone currently has NO video.js or hls.js. Versions from av-player: `video.js@^8.23.4`, `hls.js@^1.6.13`. These must be installed before running `npm start`.

### CSS concern

`video.js/dist/video-js.css` is a global stylesheet. It may conflict with Persephone's theme. Accepted risk (EPIC-024 C2) — test during implementation and fix conflicts if any appear.

---

## Implementation Plan

### Step 1 — Install npm packages

Run:
```bash
npm install video.js@^8.23.4 hls.js@^1.6.13
```

No TypeScript type packages needed — both ship their own types.

### Step 2 — Create `NodeFetchHlsLoader.ts`

**File:** `src/renderer/editors/video/NodeFetchHlsLoader.ts` (new file)

Copy the complete implementation from EPIC-024.md (Architecture → HLS Custom Loader section). Key points:
- Export: `export function createNodeFetchLoaderClass(extraHeaders: Record<string, string>): { new (config: HlsConfig): Loader<LoaderContext> }`
- Imports: `import type Hls from "hls.js"` + named type imports + `import { LoadStats } from "hls.js"` (value import needed for `new LoadStats()`)
- `nodeFetch` dynamically imported: `const { nodeFetch } = await import("../../api/node-fetch")`
- Merge headers: `{ ...extraHeaders, ...context.headers }` (hls.js own headers win)
- Range header: built from `context.rangeStart` / `context.rangeEnd` when present

### Step 3 — Create `VPlayer.tsx`

**File:** `src/renderer/editors/video/VPlayer.tsx` (new file)

```typescript
import videojs from "video.js";
import Hls from "hls.js";
import "video.js/dist/video-js.css";
import type { HlsConfig } from "hls.js";
import { useEffect, useRef } from "react";
import Player from "video.js/dist/types/player";
import styled from "@emotion/styled";
import type { VideoFormat, PlayerState } from "./video-types";
import type { ParsedHttpRequest } from "../../core/utils/curl-parser";
import { createNodeFetchLoaderClass } from "./NodeFetchHlsLoader";

interface VPlayerProps {
    src?: string;
    format?: VideoFormat;
    muted?: boolean;
    parsedRequest?: ParsedHttpRequest | null;
    onStateChange?: (state: PlayerState, error?: unknown) => void;
    onMutedChange?: (muted: boolean) => void;
}

const VideoRoot = styled.div`
    position: relative;
    width: 100%;
    height: 100%;
    &.src-empty .vjs-modal-dialog-content {
        display: none;
    }
`;
```

**Component body:**
```typescript
export function VPlayer({ src, format, muted, parsedRequest, onStateChange, onMutedChange }: VPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const playerRef = useRef<Player | null>(null);
    const hlsRef = useRef<Hls | null>(null);

    // Initialize video.js once on mount
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const player = videojs(video, {
            controls: true,
            autoplay: true,
            preload: "auto",
            muted: muted ?? false,
        });
        playerRef.current = player;

        player.on("loadstart", () => {
            onStateChange?.("loading");
        });
        player.on("playing", () => {
            onStateChange?.("playing");
        });
        player.on("pause", () => {
            onStateChange?.("paused");
        });
        player.on("volumechange", () => {
            onMutedChange?.(player.muted() ?? false);
        });
        player.on("error", () => {
            const error = player.error();
            if (error?.code === 4) {
                onStateChange?.("unsupported format", error);
            } else {
                onStateChange?.("error", error ?? undefined);
            }
        });

        return () => {
            hlsRef.current?.destroy();
            hlsRef.current = null;
            player.dispose();
            playerRef.current = null;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Load source when src/format/parsedRequest changes
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        if (!src) {
            onStateChange?.("stopped");
            return;
        }

        if (format === "m3u8" && Hls.isSupported()) {
            hlsRef.current?.destroy();

            const hlsConfig: Partial<HlsConfig> = {};
            if (parsedRequest?.headers && Object.keys(parsedRequest.headers).length > 0) {
                hlsConfig.loader = createNodeFetchLoaderClass(parsedRequest.headers);
            }

            const hls = new Hls(hlsConfig);
            hlsRef.current = hls;
            hls.loadSource(src);
            hls.attachMedia(video);
        } else {
            video.src = src;
        }
    }, [src, format, parsedRequest]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <VideoRoot className={src ? "vplayer" : "vplayer src-empty"}>
            <video ref={videoRef} className="video-js" />
        </VideoRoot>
    );
}
```

**Note on `onStateChange`/`onMutedChange` in effects:** These are passed from the model and are stable (arrow methods defined on the class), so they won't cause re-runs. They're excluded from the eslint-disable comment's reasoning — the empty deps array is intentional for the init effect.

### Step 4 — Integrate VPlayer into VideoPlayerEditor.tsx

**File:** `src/renderer/editors/video/VideoPlayerEditor.tsx`

**Changes:**

1. Add import at the top:
```typescript
import { VPlayer } from "./VPlayer";
```

2. In `VideoPlayerEditor` component, read `format`, `muted`, `parsedRequest` from state:
```typescript
// Add these to existing state reads:
const format = model.state.use((s) => s.format);
const muted = model.state.use((s) => s.muted);
const parsedRequest = model.state.use((s) => s.parsedRequest);
```

3. Replace the placeholder in `VideoArea` (current lines 183–188):
```typescript
// BEFORE:
<VideoArea>
    {/* US-413: VPlayer component will be inserted here */}
    {!url && (
        <PlaceholderText>Enter a video URL above to start playing</PlaceholderText>
    )}
    {showBadge && (
        <StateBadge>{playerState}</StateBadge>
    )}
</VideoArea>

// AFTER:
<VideoArea>
    {url && (
        <VPlayer
            src={url}
            format={format}
            muted={muted}
            parsedRequest={parsedRequest}
            onStateChange={model.onPlayerStateChange}
            onMutedChange={model.onMutedChange}
        />
    )}
    {!url && (
        <PlaceholderText>Enter a video URL above to start playing</PlaceholderText>
    )}
    {showBadge && (
        <StateBadge>{playerState}</StateBadge>
    )}
</VideoArea>
```

4. The `VideoArea` styled component centers its children — VPlayer's `VideoRoot` uses `width: 100%; height: 100%` which overrides centering. No styling changes needed; verify visually.

---

## Concerns / Open Questions

| # | Concern | Status |
|---|---------|--------|
| C1 | video.js CSS global styles conflict with Persephone theme | Accepted risk (EPIC-024 C2). Fix during implementation if issues appear. |
| C2 | `onStateChange`/`onMutedChange` callbacks in `useEffect` deps | These are arrow methods defined on `VideoEditorModel` class — stable references. Safe to exclude from deps. |
| C3 | `muted` prop passed to video.js init — won't react to external changes | Only initial muted state matters (restored from session). User changes go through `volumechange` event → `onMutedChange` → state update. Correct. |
| C4 | `video.js/dist/types/player` import path | This is the standard pattern for video.js v8 TypeScript types. Should work with `^8.23.4`. |
| C5 | HLS + NodeFetchHlsLoader tested | US-413 creates the infrastructure. Actual cURL input with headers is wired in US-414 (parsedRequest will be null for plain URL input for now, falling back to default hls.js loader). |
| C6 | VPlayer key prop — needed to force remount when URL changes to different format? | Both `src` and `format` are in the effect deps — hls.js is properly destroyed/recreated. No key prop needed. |

---

## Acceptance Criteria

- [ ] `video.js` and `hls.js` are listed in `package.json` dependencies
- [ ] `VPlayer.tsx` renders a video.js player when `src` is provided
- [ ] Entering an MP4 URL in the video editor and pressing Enter plays the video
- [ ] Entering an M3U8 URL plays the stream via hls.js
- [ ] `playerState` in the editor model updates correctly (loading → playing → paused)
- [ ] `muted` state persists across app restarts
- [ ] `NodeFetchHlsLoader.ts` exists and compiles without errors (not yet activated — parsedRequest is null for plain URLs)
- [ ] No visible CSS conflicts from video.js stylesheet (or conflicts documented for follow-up)
- [ ] TypeScript compiles with no new errors (`npm run lint` passes)

---

## Files Changed Summary

| File | Change |
|------|--------|
| `package.json` | Add `video.js@^8.23.4` and `hls.js@^1.6.13` dependencies |
| `src/renderer/editors/video/NodeFetchHlsLoader.ts` | **NEW** — custom hls.js loader using nodeFetch for forbidden headers |
| `src/renderer/editors/video/VPlayer.tsx` | **NEW** — video.js + hls.js React component |
| `src/renderer/editors/video/VideoPlayerEditor.tsx` | Replace TODO placeholder with `<VPlayer>`, add state reads for `format`/`muted`/`parsedRequest` |

## Files with NO changes needed

- `src/renderer/editors/video/video-types.ts` — types already correct
- `src/renderer/editors/register-editors.ts` — already registered
- `src/renderer/api/pages/PagesLifecycleModel.ts` — already has `showVideoPlayerPage()`
- `src/renderer/api/pages/PagesModel.ts` — already delegates
- `src/shared/types.ts` — `"videoPage"` and `"video-view"` already added
- `src/renderer/theme/icons.tsx` — `PlayerIcon` already added
- `src/renderer/ui/sidebar/tools-editors-registry.ts` — Video Player entry already added
