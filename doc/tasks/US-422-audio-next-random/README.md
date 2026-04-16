# US-422: Audio Player — Next Track & Shuffle Mode

## Goal

Add "next track" auto-play and shuffle mode to the audio player so that when a track ends, the player automatically plays the next (or a random) track from the same source that opened the current file — either the Explorer panel (filesystem folder) or the Links panel (link collection category).

## Background

### Current player architecture

The video/audio player is `VideoEditorModel` ([VideoPlayerEditor.tsx](../../../src/renderer/editors/video/VideoPlayerEditor.tsx)), which acts as the main editor in a page. It uses `VPlayer` → `AudioPlayer` → `AudioControls` + `AudioVisualizer` for audio playback.

**Key facts:**
- `VideoEditorModel` extends `EditorModel` and has `this.page` (PageModel) access
- `AudioPlayer` ([AudioPlayer.tsx](../../../src/renderer/editors/video/AudioPlayer.tsx)) currently listens for `loadstart`, `playing`, `pause`, `volumechange`, `error` events — but **NOT `ended`**
- `AudioControls` ([AudioControls.tsx](../../../src/renderer/editors/video/AudioControls.tsx)) renders Play/Pause, seek bar, time labels, and Volume/Mute — no next/shuffle buttons exist
- `VideoEditorModel.submitUrl(text)` handles loading a new track: resolves streaming server URL, updates state, triggers playback
- Audio-compatible extensions are defined in `AUDIO_EXTENSIONS` in [video-types.ts](../../../src/renderer/editors/video/video-types.ts): `.mp3`, `.wav`, `.aac`, `.flac`, `.m4a`, `.wma`, `.ogg`, `.opus`

### Source tracking via `sourceLink`

When a file is opened from a panel, `sourceLink` (type `ILinkData`) is persisted on `IEditorState`:
- **Explorer panel** sets `sourceId: "explorer"` ([ExplorerSecondaryEditor.tsx:60](../../../src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx#L60))
- **Links panel** does **NOT** set `sourceId` currently ([LinkCategoryPanel.tsx:71](../../../src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx#L71))
- `sourceId` is NOT in `EPHEMERAL_FIELDS` ([link-data.ts:7-17](../../../src/shared/link-data.ts#L7-L17)), so it is persisted in `sourceLink`

### Tree provider discovery pattern

CategoryEditor already implements provider discovery via duck-typing ([secondary-editors.md section 12](../../architecture/secondary-editors.md)):
- Scans `page.secondaryEditors[]` for models exposing `treeProvider` + `selectionState`
- Matches by `treeProvider.type` + `treeProvider.sourceUrl`

Both secondary editor models expose `treeProvider`:
- `ExplorerEditorModel.treeProvider: ITreeProvider | null` — class property, always available ([ExplorerEditorModel.ts:27](../../../src/renderer/editors/explorer/ExplorerEditorModel.ts#L27))
- `LinkCategorySecondaryEditor` — sets `model.treeProvider` via duck-typing in a React `useEffect`

### ITreeProvider enumeration

`ITreeProvider.list(path)` ([io.tree.d.ts:23](../../../src/renderer/api/types/io.tree.d.ts#L23)) returns `ILink[]` — a flat array of direct children at a directory/category path. Items include `href`, `title`, `isDirectory`, `tags[]`. FileTreeProvider sorts files alphabetically by extension then name.

### No existing icons for Next/Shuffle

[icons.tsx](../../../src/renderer/theme/icons.tsx) has `PlayIcon`, `PauseIcon`, `VolumeIcon`, `VolumeMutedIcon` but no Next/Skip/Shuffle icons. New SVG icons need to be created.

## Implementation Plan

### Step 1: Add `sourceId` to Links panel

**File:** [LinkCategoryPanel.tsx](../../../src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx)

In the `handleItemClick` callback (line 67-79), when `useOpenRawLink` is true, add `sourceId: "link-category"` to the `createLinkData` call:

```typescript
// Before:
app.events.openRawLink.sendAsync(
    createLinkData(navUrl, {
        target: item.target || undefined,
        ...(pageId ? { pageId, fallbackTarget: "monaco", title: item.title } : undefined),
    }),
);

// After:
app.events.openRawLink.sendAsync(
    createLinkData(navUrl, {
        target: item.target || undefined,
        sourceId: "link-category",
        ...(pageId ? { pageId, fallbackTarget: "monaco", title: item.title } : undefined),
    }),
);
```

### Step 2: Export `AUDIO_EXTENSIONS` and add helper

**File:** [video-types.ts](../../../src/renderer/editors/video/video-types.ts)

- Export the existing `AUDIO_EXTENSIONS` array (currently `const`, needs `export const`)
- Add a helper: `isAudioFile(href: string): boolean` that checks if a filename ends with any audio extension

```typescript
export const AUDIO_EXTENSIONS = [".mp3", ".wav", ".aac", ".flac", ".m4a", ".wma", ".ogg", ".opus"];

export function isAudioFile(href: string): boolean {
    const lower = href.toLowerCase();
    return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
```

### Step 3: Add Next/Shuffle icons

**File:** [icons.tsx](../../../src/renderer/theme/icons.tsx)

Add two new icons near the existing `PlayIcon`/`PauseIcon` (around line 1136):

- `NextTrackIcon` — standard media "skip forward" icon (right-pointing triangle + vertical bar)
- `ShuffleIcon` — standard shuffle icon (two crossing arrows)

### Step 4: Add `shuffle` state and track navigation to `VideoEditorModel`

**File:** [VideoPlayerEditor.tsx](../../../src/renderer/editors/video/VideoPlayerEditor.tsx)

**4a. Shuffle via `app.settings`:**

No changes to `VideoEditorState`. Shuffle is stored in `app.settings` (global, persists across restarts).

Add to [settings.ts](../../../src/renderer/api/settings.ts):
- Add `"audio-shuffle"` to the `SettingsKey` union type (line ~43)
- Add description: `"audio-shuffle": "Whether shuffle mode is enabled for audio playback."` (line ~73)
- Add default: `"audio-shuffle": false` (line ~98)

In `VideoEditorModel`, read/write shuffle via:
```typescript
get shuffle(): boolean {
    return settings.get("audio-shuffle") === true;
}

toggleShuffle = () => {
    settings.set("audio-shuffle", !this.shuffle);
};
```

**4b. Add tree provider discovery method:**

```typescript
/**
 * Find the ITreeProvider that provided the currently playing track.
 * Scans page.secondaryEditors[] matching sourceLink.sourceId.
 */
private findSourceProvider(): ITreeProvider | null {
    const page = this.page;
    if (!page) return null;
    const sourceId = this.state.get().sourceLink?.sourceId;
    if (!sourceId) return null;

    for (const editor of page.secondaryEditors) {
        if (sourceId === "explorer" && "treeProvider" in editor) {
            const tp = (editor as any).treeProvider as ITreeProvider | null;
            if (tp?.type === "file") return tp;
        }
        if (sourceId === "link-category" && "treeProvider" in editor) {
            const tp = (editor as any).treeProvider as ITreeProvider | null;
            if (tp?.type === "link") return tp;
        }
    }
    return null;
}
```

**4c. Add method to get playable sibling tracks:**

```typescript
/**
 * List audio files in the same directory/category as the current track.
 * Returns the list and the index of the current track within it.
 */
private async getSiblingTracks(): Promise<{ items: ILink[]; currentIndex: number } | null> {
    const provider = this.findSourceProvider();
    if (!provider) return null;

    const { sourceLink, url } = this.state.get();
    // Determine the parent path to list
    let parentPath: string;
    if (provider.type === "file") {
        parentPath = fpDirname(url || sourceLink?.href || "");
    } else {
        // Links provider: use sourceLink.category
        parentPath = sourceLink?.category || provider.rootPath;
    }
    if (!parentPath) return null;

    const allItems = await provider.list(parentPath);
    const audioItems = allItems.filter((item) => !item.isDirectory && isAudioFile(item.href));
    if (audioItems.length === 0) return null;

    const currentHref = (url || sourceLink?.href || "").toLowerCase();
    const currentIndex = audioItems.findIndex((item) => item.href.toLowerCase() === currentHref);

    return { items: audioItems, currentIndex };
}
```

**4d. Add `playNext()` method:**

Uses the full `openRawLink` pipeline instead of direct `submitUrl()`. This ensures:
- All link types are handled correctly (file paths, HTTP URLs, cURL commands from Links)
- `sourceLink` is created properly via `cleanForStorage()` in the open handler
- Pipe descriptors are resolved by the content pipeline
- The old VideoEditorModel is disposed (cleans up streaming sessions automatically)
- A new VideoEditorModel is created with correct state
- Secondary editors (Explorer, Links) survive — ExplorerEditorModel never clears on navigation, Links standalone never clears via base `onMainEditorChanged`

```typescript
/** Play the next (or random) track from the source provider. */
async playNext(): Promise<void> {
    const result = await this.getSiblingTracks();
    if (!result || result.items.length <= 1) return;

    const { items, currentIndex } = result;
    let nextIndex: number;

    if (this.shuffle) {
        nextIndex = this.getShuffleBagNext(items, currentIndex);
    } else {
        // Sequential: next in list, wrap around
        nextIndex = currentIndex >= 0 ? (currentIndex + 1) % items.length : 0;
    }

    const nextItem = items[nextIndex];
    await this.navigateToTrack(nextItem);
}
```

**4e. Add `navigateToTrack()` helper:**

Navigate via `openRawLink` — the same pipeline used when the user clicks an item in the panel. Pass `pageId` so the new editor opens in the same tab, and preserve `sourceId` so the new player knows its source.

```typescript
/** Navigate to a new track via the openRawLink pipeline. */
private async navigateToTrack(item: ILink): Promise<void> {
    const provider = this.findSourceProvider();
    if (!provider) return;

    const sourceId = this.state.get().sourceLink?.sourceId;
    const pageId = this.page?.id;
    const navUrl = provider.getNavigationUrl(item);

    app.events.openRawLink.sendAsync(
        createLinkData(navUrl, {
            pageId,
            sourceId,
            target: item.target || undefined,
            title: item.title,
        }),
    );
}
```

**Navigation lifecycle flow:**
1. `openRawLink` → parsers → resolvers → open handler
2. Open handler calls `navigatePageTo()` → `page.setMainEditor(newVideoEditor)`
3. Old VideoEditorModel: `beforeNavigateAway()` → base behavior clears `secondaryEditor` (no-op, video player never sets it)
4. Old VideoEditorModel: `dispose()` → deletes streaming sessions for this pageId
5. New VideoEditorModel: `setPage(page)`, `restore()` → resolves new streaming URL
6. `notifyMainEditorChanged()` → ExplorerEditorModel updates highlight; Links panel is no-op — **both survive**

**4f. Add `canPlayNext` getter and `getShuffleBagNext()` method:**

```typescript
/** Whether the player can potentially play a next track (has a source provider). */
get canPlayNext(): boolean {
    const sourceId = this.state.get().sourceLink?.sourceId;
    return sourceId === "explorer" || sourceId === "link-category";
}

/**
 * Pick the next index from a shuffle bag stored in page transient state.
 * The bag is a shuffled array of indices. When exhausted, it reshuffles.
 */
private getShuffleBagNext(items: ILink[], currentIndex: number): number {
    const page = this.page;
    if (!page) return 0;

    const key = "audio-shuffle-bag";
    let bag = page.getTransient<number[]>(key);

    // Invalidate bag if track count changed
    if (bag && bag.length !== items.length) bag = null;

    if (!bag || bag.length === 0) {
        // Create new shuffled bag: all indices except current, Fisher-Yates shuffle
        bag = Array.from({ length: items.length }, (_, i) => i)
            .filter((i) => i !== currentIndex);
        for (let i = bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [bag[i], bag[j]] = [bag[j], bag[i]];
        }
    }

    const nextIndex = bag.shift()!;
    page.setTransient(key, bag);
    return nextIndex;
}
```

**Shuffle state:** Store in `app.settings` as `"audio-shuffle"` (boolean, default `false`). This persists across app restarts, matching the `"visualizer-effect"` pattern already used for audio settings ([AudioVisualizer.tsx:176](../../../src/renderer/editors/video/AudioVisualizer.tsx#L176)). Read via `settings.get("audio-shuffle")`, toggle via `settings.set("audio-shuffle", !current)`.

**Shuffle bag state:** Store in transient page state (see Step 8 below) — the bag only needs to live while the page is open. A new bag is created when the user opens a new page or restarts the app.

### Step 5: Wire `ended` event through the component chain

**5a. File: [AudioPlayer.tsx](../../../src/renderer/editors/video/AudioPlayer.tsx)**

Add `onEndedRef` prop and listen for the `ended` event on the `<audio>` element:

```typescript
export interface AudioPlayerProps {
    // ... existing props ...
    onEndedRef: React.RefObject<(() => void) | undefined>;
}
```

In the `useEffect` (line 67-98), add:
```typescript
const onEnded = () => onEndedRef.current?.();
audio.addEventListener("ended", onEnded);
// ... and remove in cleanup
```

**5b. File: [VPlayer.tsx](../../../src/renderer/editors/video/VPlayer.tsx)**

Add `onEnded` prop to `VPlayerProps` and thread it through the ref pattern to `AudioPlayer`:

```typescript
export interface VPlayerProps {
    // ... existing props ...
    onEnded?: () => void;
}
```

Create `onEndedRef` like the other refs, pass to `AudioPlayer`.

**5c. File: [VideoPlayerEditor.tsx](../../../src/renderer/editors/video/VideoPlayerEditor.tsx) (component)**

In the `VideoPlayerEditor` function component, add the `onEnded` callback that calls `model.playNext()`:

```typescript
<VPlayer
    src={streamUrl}
    format={format}
    muted={muted}
    parsedRequest={parsedRequest}
    sourceUrl={url}
    onStateChange={model.onPlayerStateChange}
    onMutedChange={model.onMutedChange}
    onEnded={() => model.playNext()}
/>
```

### Step 6: Add Next and Shuffle buttons to AudioControls

**File:** [AudioControls.tsx](../../../src/renderer/editors/video/AudioControls.tsx)

Add new props:

```typescript
export interface AudioControlsProps {
    audioRef: React.RefObject<HTMLAudioElement>;
    playing: boolean;
    /** Whether next track is available. */
    hasNext?: boolean;
    /** Whether shuffle mode is on. */
    shuffle?: boolean;
    onNext?: () => void;
    onToggleShuffle?: () => void;
}
```

Add two buttons after the Volume/Mute button (right side of controls bar):

```tsx
{hasNext && (
    <button className="control-button idle-hide" onClick={onToggleShuffle}
        title={shuffle ? "Shuffle: On" : "Shuffle: Off"}
        style={shuffle ? { color: color.misc.blue } : undefined}>
        <ShuffleIcon />
    </button>
)}
{hasNext && (
    <button className="control-button idle-hide" onClick={onNext} title="Next Track">
        <NextTrackIcon />
    </button>
)}
```

### Step 7: Thread new props from VideoPlayerEditor through VPlayer to AudioControls

**File:** [VPlayer.tsx](../../../src/renderer/editors/video/VPlayer.tsx)

Add props: `hasNext`, `shuffle`, `onNext`, `onToggleShuffle` and pass them through to `AudioPlayer`.

**File:** [AudioPlayer.tsx](../../../src/renderer/editors/video/AudioPlayer.tsx)

Accept the same props and forward to `AudioControls`.

**File:** [VideoPlayerEditor.tsx](../../../src/renderer/editors/video/VideoPlayerEditor.tsx) (component)

Read shuffle from settings (reactive), canPlayNext from model, pass to VPlayer:

```tsx
const shuffle = settings.use("audio-shuffle") === true;
const canPlayNext = model.canPlayNext;

<VPlayer
    // ... existing props ...
    hasNext={canPlayNext}
    shuffle={shuffle}
    onNext={() => model.playNext()}
    onToggleShuffle={model.toggleShuffle}
/>
```

### Step 8: Add transient state to PageModel

**File:** [PageModel.ts](../../../src/renderer/api/pages/PageModel.ts)

Add a generic transient key-value store to PageModel. This is NOT persisted — it lives only while the page (tab) is open and is cleared on app restart. Useful for any runtime-only state that needs to survive editor navigation within a page (shuffle bag, playback history, etc.).

```typescript
// In PageModel class body, after secondaryEditors section:

// ── Transient state (not persisted) ──────────────────────────────

/** Runtime-only key-value store. Survives editor navigation, cleared on page close / app restart. */
private _transient = new Map<string, unknown>();

/** Get a transient value by key. Returns undefined if not set. */
getTransient<T>(key: string): T | undefined {
    return this._transient.get(key) as T | undefined;
}

/** Set a transient value. Pass undefined to delete. */
setTransient(key: string, value: unknown): void {
    if (value === undefined) {
        this._transient.delete(key);
    } else {
        this._transient.set(key, value);
    }
}
```

The `Map` is cleared naturally when the page is disposed (garbage collected). No explicit cleanup needed in `dispose()`.

## Files Changed Summary

| File | Change |
|------|--------|
| [video-types.ts](../../../src/renderer/editors/video/video-types.ts) | Export `AUDIO_EXTENSIONS`, add `isAudioFile()` helper |
| [icons.tsx](../../../src/renderer/theme/icons.tsx) | Add `NextTrackIcon`, `ShuffleIcon` |
| [settings.ts](../../../src/renderer/api/settings.ts) | Add `"audio-shuffle"` setting (boolean, default `false`) |
| [PageModel.ts](../../../src/renderer/api/pages/PageModel.ts) | Add `_transient` Map + `getTransient()` / `setTransient()` methods |
| [VideoPlayerEditor.tsx](../../../src/renderer/editors/video/VideoPlayerEditor.tsx) | Add `findSourceProvider()`, `getSiblingTracks()`, `playNext()`, `navigateToTrack()` (via `openRawLink`), `getShuffleBagNext()`, `shuffle` getter, `toggleShuffle()`, `canPlayNext`; wire `onEnded` in component |
| [VPlayer.tsx](../../../src/renderer/editors/video/VPlayer.tsx) | Add `onEnded`, `hasNext`, `shuffle`, `onNext`, `onToggleShuffle` props; thread to AudioPlayer |
| [AudioPlayer.tsx](../../../src/renderer/editors/video/AudioPlayer.tsx) | Add `onEndedRef` prop; listen for `ended` event; forward next/shuffle props to AudioControls |
| [AudioControls.tsx](../../../src/renderer/editors/video/AudioControls.tsx) | Add Next and Shuffle buttons with `hasNext`, `shuffle`, `onNext`, `onToggleShuffle` props |
| [LinkCategoryPanel.tsx](../../../src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx) | Add `sourceId: "link-category"` to `createLinkData` call |

**Files that need NO changes:** `AudioVisualizer.tsx`, `EditorModel.ts`, `ExplorerEditorModel.ts`, `ExplorerSecondaryEditor.tsx`, `link-data.ts`, `open-handler.ts`, `io.tree.d.ts`

## Resolved Decisions

- **Shuffle state persistence:** Stored in `app.settings` as `"audio-shuffle"` — persists across app restarts.
- **Shuffle quality:** Shuffle bag (Fisher-Yates) stored in `page.getTransient()` — plays all tracks before repeating. Bag resets when page closes or app restarts.
- **Video files:** Audio-only for v1 — video has no custom controls component for the buttons.
- **No secondary editor on page:** Buttons are simply hidden. No notification needed.

## Concerns

All concerns resolved. Links panel `treeProvider` timing — accepted as-is; if `treeProvider` is null, playback simply stops. Will address if testing reveals issues.

## Acceptance Criteria

1. When an audio track ends and was opened from the Explorer panel, the next audio file in the same folder plays automatically (alphabetical order)
2. When an audio track ends and was opened from the Links panel, the next audio link in the same category plays automatically
3. Shuffle toggle button is visible in AudioControls when next-track is available
4. When shuffle is on, tracks are picked using a shuffle bag (all tracks play before any repeats)
5. Next Track button is visible in AudioControls and manually skips to the next track
6. The player title and file path update to reflect the new track (handled by openRawLink pipeline)
7. If no source provider is available (direct URL input, no panel), Next/Shuffle buttons are hidden
8. Shuffle setting persists across app restarts (stored in `app.settings`)
9. Shuffle bag resets when the page tab closes or app restarts (transient page state)
