# US-412: Video Player Standalone Editor — Model, Registration, UI Shell

## Goal

Create the skeleton of the Video Player editor: `VideoEditorState` + `VideoEditorModel`, editor registration in `register-editors.ts`, UI shell with a URL input (TextAreaField, max 3 lines), placeholder video area, and state badge. Add `PlayerIcon` to the icons file and register the editor in the Tools & Editors sidebar. No playback logic yet — that comes in US-413/US-414.

## Background

EPIC-024 adds a standalone video player editor to Persephone. The design mirrors existing standalone editors (`image-view`, `mcp-view`, `browser-view`):

- **Pattern:** `EditorModel<State, void>` subclass + React component + `EditorModule` factory
- **Reference:** `src/renderer/editors/image/ImageViewer.tsx` — closest analog (standalone, no text content, `noLanguage = true`)
- **Editor ID:** `video-view`
- **EditorType string:** `"videoPage"` — must be added to `EditorType` union in `src/shared/types.ts`
- **EditorView string:** `"video-view"` — must be added to `EditorView` union in `src/shared/types.ts`
- **File location:** `src/renderer/editors/video/` (new directory)

### Files that need NO changes in this task
- `src/renderer/core/utils/curl-parser.ts` — used in US-414
- `src/renderer/api/node-fetch.ts` — used in US-413+
- `src/renderer/content/providers/FileProvider.ts` — used in US-415
- `src/renderer/content/providers/HttpProvider.ts` — used in US-415
- `src/renderer/api/settings.ts` — vlc-path added in US-417
- `src/main/` — no changes this task

### Key existing patterns

**EditorModule structure** (`src/renderer/editors/image/ImageViewer.tsx:302-331`):
```typescript
const imageEditorModule: EditorModule = {
    Editor: ImageViewer,
    newEditorModel: async (filePath?) => { ... },
    newEmptyEditorModel: async (editorType) => { ... },
    newEditorModelFromState: async (state) => { ... },
};
export default imageEditorModule;
```

**EditorModel base** (`src/renderer/editors/base/EditorModel.ts`):
- Constructor: `new SomeModel(new TComponentState(initialState))`
- Key properties: `noLanguage`, `skipSave`, `getIcon?`
- Lifecycle: `restore()`, `dispose()`, `getRestoreData()`, `applyRestoreData()`

**EditorType / EditorView** (`src/shared/types.ts:1-2`):
```typescript
// Current line 1:
export type EditorType = "textFile" | "pdfFile" | "imageFile" | "aboutPage" | "settingsPage" | "browserPage" | "mcpInspectorPage" | "categoryPage" | "archiveFile" | "fileExplorer";
// Current line 2:
export type EditorView = "monaco" | "grid-json" | "grid-csv" | "grid-jsonl" | "md-view" | "pdf-view" | "image-view" | "svg-view" | "about-view" | "notebook-view" | "mermaid-view" | "html-view" | "settings-view" | "todo-view" | "link-view" | "log-view" | "browser-view" | "graph-view" | "draw-view" | "mcp-view" | "rest-client" | "category-view" | "archive-view";
```

**TextAreaField** (`src/renderer/components/basic/TextAreaField.tsx`):
- `contentEditable` div with auto-grow, controlled via `value` + `onChange`
- Props: `value`, `onChange(text)`, `singleLine?`, `placeholder?`, `...divProps` (includes `onKeyDown`)
- `onKeyDown` passed via `divProps` overrides the internal handler — must handle both Enter submission and any other custom logic
- Default multiline mode — plain Enter adds newlines; intercept with `onKeyDown` to call `submitUrl`

**Tools & Editors registry** (`src/renderer/ui/sidebar/tools-editors-registry.ts`):
```typescript
// Pattern from existing entry:
{
    id: "browser",
    label: "Browser",
    icon: React.createElement(GlobeIcon, { color: DEFAULT_BROWSER_COLOR }),
    create: () => { pagesModel.showBrowserPage(); },
    category: "tool",
},
```
`DEFAULT_BROWSER_COLOR = "#4DD0E1"` is defined in `src/renderer/theme/palette-colors.ts` — use this same cyan for the PlayerIcon.

## Implementation Plan

### Step 1 — Add `PlayerIcon` to `src/renderer/theme/icons.tsx`

The icon is ported from `D:\projects\av-player\src\renderer\theme\icons.tsx:389-404`. Add it at the end of the file (or alongside other editor icons). The icon file uses private `createIcon` / `createIconWithViewBox` helpers — open the file, find those helpers near the top, and use the same pattern.

```typescript
// Add to src/renderer/theme/icons.tsx:
export const PlayerIcon = createIcon(32)(
    <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeMiterlimit="10"
    >
        <path d="M26,22H6c-2.2,0-4-1.8-4-4V8c0-2.2,1.8-4,4-4h20c2.2,0,4,1.8,4,4v10C30,20.2,28.2,22,26,22z" />
        <line x1="3" y1="27" x2="7" y2="27" />
        <line x1="11" y1="27" x2="29" y2="27" />
        <circle cx="9" cy="27" r="2" />
        <path d="M13,10V16c0,0.7,0.9,1.2,1.5,0.8l5-3c0.6-0.4,0.6-1.2,0-1.6l-5-3C13.9,8.7,13,9.2,13,10z" />
    </g>
);
```

If `createIcon` is not available (check the top of `icons.tsx`), use:
```typescript
export const PlayerIcon = createIconWithViewBox("0 0 32 32")(/* same children */);
```

### Step 2 — Add types to `src/shared/types.ts`

Lines 1-2, append the new values:

```typescript
// Line 1 — after:
export type EditorType = "textFile" | "pdfFile" | "imageFile" | "aboutPage" | "settingsPage" | "browserPage" | "mcpInspectorPage" | "categoryPage" | "archiveFile" | "fileExplorer" | "videoPage";
// Line 2 — after:
export type EditorView = "monaco" | "grid-json" | "grid-csv" | "grid-jsonl" | "md-view" | "pdf-view" | "image-view" | "svg-view" | "about-view" | "notebook-view" | "mermaid-view" | "html-view" | "settings-view" | "todo-view" | "link-view" | "log-view" | "browser-view" | "graph-view" | "draw-view" | "mcp-view" | "rest-client" | "category-view" | "archive-view" | "video-view";
```

### Step 3 — Create `src/renderer/editors/video/video-types.ts`

New file. Ported from av-player `VPlayer-types.ts`, minus torrent/magnet support.

```typescript
// src/renderer/editors/video/video-types.ts

/** Supported video source formats. */
export type VideoFormat = "mp4" | "m3u8";

/** Player lifecycle states. */
export type PlayerState =
    | "stopped"
    | "loading"
    | "playing"
    | "paused"
    | "unsupported format"
    | "error";

/**
 * Infer video format from URL.
 * Returns "m3u8" if the URL contains ".m3u8" or "media-hls." — otherwise "mp4".
 */
export function detectVideoFormat(src: string): VideoFormat {
    if (src.includes(".m3u8") || src.includes("media-hls.")) return "m3u8";
    return "mp4";
}
```

### Step 4 — Create `src/renderer/editors/video/VideoPlayerEditor.tsx`

New file. Full implementation:

```typescript
import styled from "@emotion/styled";
import { IEditorState, EditorType } from "../../../shared/types";
import { getDefaultEditorModelState, EditorModel } from "../base";
import { PageToolbar } from "../base/EditorToolbar";
import { TComponentState } from "../../core/state/state";
import { EditorModule } from "../types";
import { TextAreaField } from "../../components/basic/TextAreaField";
import color from "../../theme/color";
import type { ParsedHttpRequest } from "../../core/utils/curl-parser";
import { detectVideoFormat } from "./video-types";
import type { VideoFormat, PlayerState } from "./video-types";

// ── State ────────────────────────────────────────────────────────────────────

export interface VideoEditorState extends IEditorState {
    /** Resolved video URL (ready to play). Empty string when no video loaded. */
    url: string;
    /** Raw text as typed by user (may be a cURL command). */
    inputText: string;
    /** Detected video format based on URL. */
    format: VideoFormat;
    /** Current player lifecycle state. */
    playerState: PlayerState;
    /** Whether the player is muted. */
    muted: boolean;
    /** Parsed HTTP request from cURL input. Null for plain URLs. Set in US-414. */
    parsedRequest: ParsedHttpRequest | null;
}

const getDefaultVideoEditorState = (): VideoEditorState => ({
    ...getDefaultEditorModelState(),
    type: "videoPage" as const,
    url: "",
    inputText: "",
    format: "mp4",
    playerState: "stopped",
    muted: false,
    parsedRequest: null,
});

// ── Model ────────────────────────────────────────────────────────────────────

export class VideoEditorModel extends EditorModel<VideoEditorState, void> {
    noLanguage = true;
    skipSave = true;

    /** Update raw input text as user types. */
    setInputText = (text: string) => {
        this.state.update((s) => { s.inputText = text; });
    };

    /**
     * Submit the current input text as a video URL.
     * US-414 will extend this to call parseHttpRequest() for cURL commands.
     */
    submitUrl = (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        this.state.update((s) => {
            s.inputText = trimmed;
            s.url = trimmed;
            s.format = detectVideoFormat(trimmed);
            s.parsedRequest = null;
            s.playerState = "loading";
        });
    };

    /** Called by VPlayer (US-413) when player state changes. */
    onPlayerStateChange = (playerState: PlayerState, _error?: unknown) => {
        this.state.update((s) => { s.playerState = playerState; });
    };

    /** Called by VPlayer (US-413) when muted state changes. */
    onMutedChange = (muted: boolean) => {
        this.state.update((s) => { s.muted = muted; });
    };

    applyRestoreData(data: Partial<VideoEditorState>): void {
        super.applyRestoreData(data);
        const fields: (keyof VideoEditorState)[] = [
            "url", "inputText", "format", "playerState", "muted", "parsedRequest",
        ];
        this.state.update((s) => {
            for (const key of fields) {
                if (key in data) {
                    (s as Record<string, unknown>)[key] = data[key as keyof VideoEditorState];
                }
            }
            // Don't restore transient states — reset to stopped
            if (s.playerState === "loading" || s.playerState === "playing") {
                s.playerState = "stopped";
            }
        });
    }
}

// ── Styled components ────────────────────────────────────────────────────────

const VideoEditorRoot = styled.div`
    display: flex;
    flex-direction: column;
    height: 100%;
    background: ${color.background.default};
    overflow: hidden;
`;

const VideoArea = styled.div`
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
`;

// TextAreaField wrapper — auto-grow, max 3 lines visible
const UrlInputArea = styled(TextAreaField)`
    flex: 1;
    min-height: 28px;
    max-height: 72px;
    overflow-y: auto;
    font-size: 12px;
    line-height: 20px;
    resize: none;
`;

const StateBadge = styled.div`
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 12px;
    border-radius: 4px;
    background: ${color.background.light};
    color: ${color.text.light};
    font-size: 12px;
    pointer-events: none;
`;

const PlaceholderText = styled.div`
    color: ${color.text.light};
    font-size: 13px;
`;

// ── Component ────────────────────────────────────────────────────────────────

interface VideoPlayerEditorProps {
    model: VideoEditorModel;
}

function VideoPlayerEditor({ model }: VideoPlayerEditorProps) {
    const url = model.state.use((s) => s.url);
    const inputText = model.state.use((s) => s.inputText);
    const playerState = model.state.use((s) => s.playerState);
    const showBadge = playerState !== "playing" && playerState !== "paused" && playerState !== "stopped";

    return (
        <VideoEditorRoot>
            <PageToolbar borderBottom>
                <UrlInputArea
                    value={inputText}
                    onChange={model.setInputText}
                    placeholder="Enter video URL or paste cURL command... (Enter to play, Shift+Enter for new line)"
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            model.submitUrl(inputText);
                        }
                    }}
                />
            </PageToolbar>
            <VideoArea>
                {/* US-413: VPlayer component will be inserted here */}
                {!url && (
                    <PlaceholderText>Enter a video URL above to start playing</PlaceholderText>
                )}
                {showBadge && (
                    <StateBadge>{playerState}</StateBadge>
                )}
            </VideoArea>
        </VideoEditorRoot>
    );
}

// ── Editor Module ────────────────────────────────────────────────────────────

const videoEditorModule: EditorModule = {
    Editor: VideoPlayerEditor,
    newEditorModel: async (_filePath?: string) => {
        return new VideoEditorModel(
            new TComponentState(getDefaultVideoEditorState()),
        );
    },
    newEmptyEditorModel: async (editorType: EditorType) => {
        if (editorType === "videoPage") {
            return new VideoEditorModel(
                new TComponentState(getDefaultVideoEditorState()),
            );
        }
        return null;
    },
    newEditorModelFromState: async (state: Partial<IEditorState>) => {
        const initialState: VideoEditorState = {
            ...getDefaultVideoEditorState(),
            ...state,
        };
        return new VideoEditorModel(new TComponentState(initialState));
    },
};

export default videoEditorModule;
export { VideoPlayerEditor };
export type { VideoPlayerEditorProps };
```

**Color token notes:**
- `color.background.default` — exists (used throughout)
- `color.background.light` — exists (used in sidebar hover)
- `color.text.light` — exists (used in sidebar labels)
- No custom tokens needed — all tokens above already exist in the theme.

### Step 5 — Register the editor in `src/renderer/editors/register-editors.ts`

Add after the `image-view` registration block (around line 268):

```typescript
// Video player (standalone page editor)
editorRegistry.register({
    id: "video-view",
    name: "Video Player",
    editorType: "videoPage",
    category: "standalone",
    acceptFile: (fileName) => {
        const videoExtensions = [".mp4", ".webm", ".ogg", ".m3u8", ".m3u"];
        if (matchesExtension(fileName, videoExtensions)) return 100;
        return -1;
    },
    loadModule: async () => {
        const module = await import("./video/VideoPlayerEditor");
        return module.default;
    },
});
```

### Step 6 — Add "Video Player" to Tools & Editors sidebar

File: `src/renderer/ui/sidebar/tools-editors-registry.ts`

**Import addition** (add `PlayerIcon` to the icons import on line 8):
```typescript
// Before:
import { GlobeIcon, McpIcon } from "../../theme/icons";
// After:
import { GlobeIcon, McpIcon, PlayerIcon } from "../../theme/icons";
```

**Add entry to `staticItems` array** (after the `mcp-inspector` entry, around line 138):
```typescript
{
    id: "video-view",
    label: "Video Player",
    icon: React.createElement(PlayerIcon, { color: DEFAULT_BROWSER_COLOR }),
    create: () => pagesModel.addEditorPage("video-view", "", "Video Player"),
    category: "tool" as const,
},
```

`DEFAULT_BROWSER_COLOR = "#4DD0E1"` (cyan) is already imported from `../../theme/palette-colors` — same color used for the Browser icon.

`pagesModel.addEditorPage("video-view", "", "Video Player")` opens a new tab with the video editor. The empty string for `language` is intentional — the video editor ignores language.

## Acceptance Criteria

- [ ] `PlayerIcon` added to `src/renderer/theme/icons.tsx` (32×32 SVG, uses `currentColor`)
- [ ] `"videoPage"` added to `EditorType` union, `"video-view"` added to `EditorView` union in `src/shared/types.ts`
- [ ] `video-types.ts` created with `VideoFormat`, `PlayerState`, `detectVideoFormat`
- [ ] `VideoEditorModel` created, extends `EditorModel<VideoEditorState, void>`, compiles without errors
- [ ] Editor registered in `register-editors.ts` under id `"video-view"`, category `"standalone"`
- [ ] Opening a `.mp4` / `.m3u8` / `.webm` file opens the Video Player editor
- [ ] "Video Player" entry appears in Tools & Editors sidebar with cyan icon
- [ ] Clicking "Video Player" in sidebar opens a blank Video Player tab
- [ ] URL TextAreaField renders, accepts multi-line text, auto-grows up to ~3 lines then scrolls
- [ ] Pressing Enter (without Shift) submits the URL and updates model state
- [ ] Pressing Shift+Enter adds a newline (for multi-line cURL paste)
- [ ] State badge shows for non-stopped/playing/paused states (loading, error, etc.)
- [ ] `npm run lint` passes with no TypeScript errors

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/theme/icons.tsx` | Add `PlayerIcon` export (32×32 SVG ported from av-player) |
| `src/shared/types.ts` | Add `"videoPage"` to `EditorType`, `"video-view"` to `EditorView` |
| `src/renderer/editors/video/video-types.ts` | **New** — `VideoFormat`, `PlayerState`, `detectVideoFormat` |
| `src/renderer/editors/video/VideoPlayerEditor.tsx` | **New** — `VideoEditorModel`, `VideoPlayerEditor`, `videoEditorModule` |
| `src/renderer/editors/register-editors.ts` | Add `video-view` registration block after `image-view` |
| `src/renderer/ui/sidebar/tools-editors-registry.ts` | Import `PlayerIcon`, add `video-view` entry to `staticItems` |
