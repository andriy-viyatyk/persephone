# US-458: ImageViewer — UIKit migration

## Goal

Migrate the page-level ImageViewer view ([src/renderer/editors/image/ImageViewer.tsx](../../../src/renderer/editors/image/ImageViewer.tsx)) from app-side toolbar primitives (`PageToolbar`, legacy `Button`, `FlexSpace`) to UIKit's `Toolbar`, `IconButton`, and `Spacer`. After the migration the view imports zero legacy layout/control primitives — only `BaseImageView` remains as a non-UIKit dependency, which is the explicit Phase 5 adopt-in-place target ([US-459](../US-459-base-image-view-adoption/README.md), not yet authored).

This is the fifth per-screen migration of [EPIC-025](../../epics/EPIC-025.md) Phase 4. Like prior migrations ([US-452 About](../US-452-about-screen-migration/README.md), [US-455 MermaidView](../US-455-mermaid-view-migration/README.md), [US-456 SvgView](../US-456-svg-view-migration/README.md), [US-457 HtmlView](../US-457-html-view-migration/README.md)), it introduces **zero new UIKit components and zero new prop extensions** — every primitive needed already exists in the UIKit barrel.

## Background

### EPIC-025 Phase 4 context

Per-screen migration loop:

1. Pick a screen
2. Audit which UIKit components are needed and which are missing
3. Build missing components / prop extensions in Storybook first
4. Rewrite the screen with UIKit
5. Smoke-test the screen

### Why ImageViewer next

- **First screen with an inline `PageToolbar`.** Prior content-view migrations (MermaidView/SvgView/HtmlView) either used `createPortal(…, model.editorToolbarRefLast)` or had no toolbar at all. ImageViewer renders `<PageToolbar borderBottom>` directly inside the view because it is a **page-level editor** (its model is `ImageEditorModel extends EditorModel`, not a content-view backed by `TextFileModel`). The inline `PageToolbar` is the natural fit for UIKit's `Toolbar` component — a 1:1 swap.
- **Exercises three UIKit primitives in one file.** `Toolbar`, `IconButton`, `Spacer`. All three are already shipping; this is the first per-screen migration that uses all three together.
- **Unblocks US-459 (BaseImageView adoption).** Once the wrapper view is on UIKit, the only remaining non-UIKit element in the image stack is `BaseImageView` itself — the Phase 5 candidate.
- **Self-contained.** Single file, no cross-file coupling beyond the existing `BaseImageView` import (kept as-is) and the `FileIcon` used in `model.getIcon` (kept — see Concerns §3).

### Audit results

| ImageViewer element (current) | UIKit replacement | Gap |
|---|---|---|
| `<PageToolbar borderBottom>` from `../base/EditorToolbar` | `<Toolbar borderBottom>` from `../../uikit` | none |
| `<FlexSpace />` from `../../components/layout/Elements` | `<Spacer />` from `../../uikit` | none |
| `<Button type="icon" size="small" title="…" onClick={…}>{icon}</Button>` (×4 — NavPanel, Save, Draw, Copy) | `<IconButton size="sm" title="…" onClick={…} icon={…} />` | none — same 24×24 button + 16×16 icon size as established in [US-455](../US-455-mermaid-view-migration/README.md)/[US-456](../US-456-svg-view-migration/README.md) |
| `<BaseImageView ref={imageRef} src={src} alt={alt} />` | unchanged (Phase 5 adopt-in-place) | none |
| `<>` Fragment root | unchanged (no styled wrapper exists) | none |
| `<FileIcon …>` inside `model.getIcon` | unchanged — domain icon, not a UIKit primitive | out of scope |

The conditional rendering structure inside the toolbar (NavPanel button gated on `model.page?.canOpenNavigator(...) || filePath`; Save button gated on `!filePath && url`) is preserved verbatim — UIKit's `Toolbar` accepts conditional children as plainly as the legacy `PageToolbar` did. Roving tabindex (Toolbar Rule 4) handles dynamic child sets correctly: when buttons mount/unmount, the next render's `collectStops()` recomputes the focusable set.

### Files involved

| File | Role | Change |
|------|------|--------|
| [src/renderer/editors/image/ImageViewer.tsx](../../../src/renderer/editors/image/ImageViewer.tsx) | Image editor (page model + view) | View-only: drop `PageToolbar`, legacy `Button`, `FlexSpace` imports; add `Toolbar`, `IconButton`, `Spacer` from `../../uikit`; rewrite the toolbar JSX inside `ImageViewer()` |

That's the entire change set — one file, three import swaps, one toolbar rewrite. The `ImageEditorModel` class, `imageEditorModule`, and all exports are unchanged.

## Implementation Plan

Single phase. No UIKit additions. The whole task is rewriting one render block inside one file.

### Step 1 — Edit [ImageViewer.tsx](../../../src/renderer/editors/image/ImageViewer.tsx)

#### 1a. Update imports

**Remove these three lines:**

```tsx
import { PageToolbar } from "../base/EditorToolbar";
import { Button } from "../../components/basic/Button";
import { FlexSpace } from "../../components/layout/Elements";
```

**Add this line** (place adjacent to the other UI imports, e.g. just below the `FileIcon` import):

```tsx
import { Toolbar, IconButton, Spacer } from "../../uikit";
```

All other imports (`useRef`, `IEditorState`, `EditorType`, `getDefaultEditorModelState`, `EditorModel`, `TComponentState`, `EditorModule`, `FileIcon`, `CopyIcon`/`NavPanelIcon`/`SaveIcon`, `DrawIcon`, `fs`, `ui`, `pagesModel`, `BaseImageView`/`BaseImageViewRef`, `fpBasename`/`fpExtname`, `buildExcalidrawJsonWithImage`/`getImageDimensions`/`extToMime`, `ContentPipe`, `FileProvider`, `ArchiveTransformer`) are unchanged.

#### 1b. Rewrite the `ImageViewer` function

**Before** (lines 221–296 of the current file):

```tsx
function ImageViewer({ model }: ImageViewerProps) {
    const filePath = model.state.use((s) => s.filePath);
    const url = model.state.use((s) => s.url);
    const imageRef = useRef<BaseImageViewRef>(null);
    const src = url || "";
    const alt = filePath ? fpBasename(filePath) : "Image";

    return (
        <>
            <PageToolbar borderBottom>
                {(model.page?.canOpenNavigator(model.pipe, filePath) || filePath) && (
                    <Button
                        type="icon"
                        size="small"
                        title="File Explorer"
                        onClick={() => {
                            model.page?.toggleNavigator(model.pipe, filePath);
                        }}
                    >
                        <NavPanelIcon />
                    </Button>
                )}
                <FlexSpace />
                {!filePath && url && (
                    <Button
                        type="icon"
                        size="small"
                        title="Save Image to File"
                        onClick={model.saveImage}
                    >
                        <SaveIcon />
                    </Button>
                )}
                <Button
                    type="icon"
                    size="small"
                    title="Open in Drawing Editor"
                    onClick={async () => {
                        const { filePath: fp, url: u } = model.state.get();
                        let dataUrl: string;
                        let mimeType: string;
                        if (model.pipe) {
                            const buffer = await model.pipe.readBinary();
                            const ext = fpExtname(fp || model.pipe.provider.sourceUrl || ".png").toLowerCase();
                            mimeType = extToMime(ext);
                            dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
                        } else if (u) {
                            const response = await fetch(u);
                            const blob = await response.blob();
                            mimeType = blob.type || "image/png";
                            const buffer = Buffer.from(await blob.arrayBuffer());
                            dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
                        } else {
                            return;
                        }
                        const dims = await getImageDimensions(dataUrl);
                        const json = buildExcalidrawJsonWithImage(dataUrl, mimeType, dims.width, dims.height);
                        const baseName = fp ? fpBasename(fp).replace(/\.\w+$/, "") : "image";
                        pagesModel.addEditorPage("draw-view", "json", baseName + ".excalidraw", json);
                    }}
                >
                    <DrawIcon />
                </Button>
                <Button
                    type="icon"
                    size="small"
                    title="Copy Image to Clipboard (Ctrl+C)"
                    onClick={() => imageRef.current?.copyToClipboard()}
                >
                    <CopyIcon />
                </Button>
            </PageToolbar>
            <BaseImageView ref={imageRef} src={src} alt={alt} />
        </>
    );
}
```

**After:**

```tsx
function ImageViewer({ model }: ImageViewerProps) {
    const filePath = model.state.use((s) => s.filePath);
    const url = model.state.use((s) => s.url);
    const imageRef = useRef<BaseImageViewRef>(null);
    const src = url || "";
    const alt = filePath ? fpBasename(filePath) : "Image";

    return (
        <>
            <Toolbar borderBottom>
                {(model.page?.canOpenNavigator(model.pipe, filePath) || filePath) && (
                    <IconButton
                        size="sm"
                        title="File Explorer"
                        onClick={() => {
                            model.page?.toggleNavigator(model.pipe, filePath);
                        }}
                        icon={<NavPanelIcon />}
                    />
                )}
                <Spacer />
                {!filePath && url && (
                    <IconButton
                        size="sm"
                        title="Save Image to File"
                        onClick={model.saveImage}
                        icon={<SaveIcon />}
                    />
                )}
                <IconButton
                    size="sm"
                    title="Open in Drawing Editor"
                    onClick={async () => {
                        const { filePath: fp, url: u } = model.state.get();
                        let dataUrl: string;
                        let mimeType: string;
                        if (model.pipe) {
                            const buffer = await model.pipe.readBinary();
                            const ext = fpExtname(fp || model.pipe.provider.sourceUrl || ".png").toLowerCase();
                            mimeType = extToMime(ext);
                            dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
                        } else if (u) {
                            const response = await fetch(u);
                            const blob = await response.blob();
                            mimeType = blob.type || "image/png";
                            const buffer = Buffer.from(await blob.arrayBuffer());
                            dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
                        } else {
                            return;
                        }
                        const dims = await getImageDimensions(dataUrl);
                        const json = buildExcalidrawJsonWithImage(dataUrl, mimeType, dims.width, dims.height);
                        const baseName = fp ? fpBasename(fp).replace(/\.\w+$/, "") : "image";
                        pagesModel.addEditorPage("draw-view", "json", baseName + ".excalidraw", json);
                    }}
                    icon={<DrawIcon />}
                />
                <IconButton
                    size="sm"
                    title="Copy Image to Clipboard (Ctrl+C)"
                    onClick={() => imageRef.current?.copyToClipboard()}
                    icon={<CopyIcon />}
                />
            </Toolbar>
            <BaseImageView ref={imageRef} src={src} alt={alt} />
        </>
    );
}
```

#### 1c. Everything else stays untouched

These regions of [ImageViewer.tsx](../../../src/renderer/editors/image/ImageViewer.tsx) are **not** modified:

- `interface ImageEditorModelState extends IEditorState { url?: string }`
- `getDefaultImageViewerModelState()`
- `class ImageEditorModel extends EditorModel<…>` — including `getRestoreData`, `applyRestoreData`, `dispose`, `ensurePipe`, `cacheImageBuffer`, `tryRestoreFromCache`, `restore`, `cacheBlobUrl`, `getIcon` (still uses `FileIcon`), `saveImage`
- `interface ImageViewerProps { model: ImageEditorModel }`
- `imageEditorModule: EditorModule = { Editor, newEditorModel, newEmptyEditorModel, newEditorModelFromState }`
- All `export` lines (default, named, type, re-exports of `BaseImageView` / `ImageViewModel` / `defaultImageViewState`)

### Step 2 — TypeScript verification

Run `npx tsc --noEmit`. The image editor must produce no new errors. Filter with `Select-String -Pattern "ImageViewer|editors/image" -SimpleMatch` to isolate this task's surface from pre-existing repo-wide errors (automation, video, link-editor, worker, PageTab) — same noise floor as during US-455/456/457.

### Step 3 — Manual smoke test

Open a `.png` (or `.jpg`/`.gif`/`.webp`/`.bmp`/`.ico`) file and verify:

1. **Initial render** — image renders inside `BaseImageView`; toolbar is visible at the top with a 1px bottom border (matches legacy `borderBottom`).
2. **NavPanel button** — when a `filePath` is set or `model.page?.canOpenNavigator(...)` returns true, the leftmost button shows a NavPanel icon and toggles the file navigator on click. When neither condition holds (image was opened from a browser webview as a blob URL with no filePath), the button is **not rendered**.
3. **Save button** — when there is no `filePath` but there *is* a `url` (i.e., browser-sourced image not yet saved to disk), the Save button appears between the Spacer and the Draw button. Clicking it shows the save dialog, writes the file, and updates the model state to point to the saved path. After saving, the button disappears (filePath now set).
4. **Open in Drawing Editor** — Draw button is always present. Clicking it reads the image binary (via pipe or via `fetch(url)`), encodes it as a data URL, computes dimensions, builds an Excalidraw JSON wrapping the image, and opens a new draw-view page. Source filename without extension is used as the base name.
5. **Copy to Clipboard** — Copy button is always present. Clicking it (or pressing Ctrl+C while focused inside `BaseImageView`) writes a PNG to the clipboard. Verify by pasting into another app.
6. **Roving tabindex** — Tab into the toolbar; only the first available IconButton receives focus. Arrow Right/Left moves focus among IconButtons; Tab exits the toolbar entirely. (This is a behavior **gain** vs. the legacy `PageToolbar`, which had no roving tabindex.)
7. **Toolbar background and border** — Toolbar background is dark (`background="dark"` is the Toolbar default; matches legacy `EditorToolbar` which used `color.background.dark`). Bottom border uses `color.border.light` (Toolbar's `borderBottom={true}` mapping).
8. **Empty content** — open a file with the model in its initial state where `url` is empty string (`src = ""`); `BaseImageView` shows a broken image but no console error from React or UIKit. Toolbar still renders with at least Draw and Copy.
9. **Theme switching** — switch app theme (default-dark, light-modern, monokai); toolbar surface and IconButton hover/active states track the theme via `color.background.dark` and `color.icon.*` tokens.
10. **Resize** — drag the editor pane / window; the layout (toolbar fixed-height at top, BaseImageView filling remaining flex space) is unchanged from the legacy implementation.
11. **`getIcon` (page tab icon)** — open the page; the page tab shows the `FileIcon` icon (unchanged — see Concerns §3).

## Concerns / Open Questions

### Resolved

1. **Why migrate `PageToolbar` here when [US-450](../US-450-uikit-toolbar/README.md) deferred per-editor PageToolbar migration?** US-450 deferred the **wholesale `PageToolbar`-to-`Toolbar` swap across all 11 consumers** because each editor's toolbar contents (legacy `Button`, `FlexSpace`, etc.) also needed migrating, which US-450 explicitly called "substantially larger". Phase 4 of EPIC-025 *is* that "substantially larger" follow-up — per-screen migrations bundle the toolbar swap together with the toolbar **content** swap, one editor at a time. Doing the swap now in US-458 (and not separately later) avoids touching this file twice.

2. **Why `<Toolbar borderBottom>` instead of `<Toolbar borderBottom background="…">`?** The Toolbar component defaults to `background="dark"` ([Toolbar.tsx:9](../../../src/renderer/uikit/Toolbar/Toolbar.tsx) sets `background = "dark"` in the destructure), and the legacy `EditorToolbar` used `color.background.dark` ([EditorToolbar.tsx:17](../../../src/renderer/editors/base/EditorToolbar.tsx)). Defaults match — no explicit `background` prop needed.

3. **Why is `FileIcon` (used in `model.getIcon`) NOT migrated?** `FileIcon` ([src/renderer/components/icons/FileIcon.tsx](../../../src/renderer/components/icons/FileIcon.tsx)) is a domain icon that selects an SVG based on file path / extension. It is **not** a UIKit primitive (UIKit doesn't and shouldn't ship file-extension-aware icons — that's app-domain logic). Same status as `CopyIcon`/`NavPanelIcon`/`SaveIcon`/`DrawIcon` from `src/renderer/theme/icons.ts` and `src/renderer/theme/language-icons.ts` — those are SVG asset components, not UIKit components. The migration touches UI primitives, not icons.

4. **Why no `<Panel>` wrapper around the `<>` Fragment?** `ImageViewer` returns `<><Toolbar/><BaseImageView/></>`. The parent (the editor page layout) provides the flex column container; the Toolbar is `flexShrink: 0` (Panel's `shrink={false}` default for Toolbar), and `BaseImageView` already has `flex: 1 1 auto` in its own root styled element. Adding a Panel here would be a wrapping div with no behavior payoff — the same conclusion as [US-456 (SvgView)](../US-456-svg-view-migration/README.md).

5. **Why no `disabled` prop on the IconButtons?** None of the original Buttons used `disabled` — each handler does its own runtime gating (NavPanel: conditional rendering; Save: conditional rendering; Draw: early return when neither pipe nor url is set; Copy: no-op when imageRef.current is null). Behavior is preserved.

6. **Roving tabindex with conditional children.** Toolbar's `collectStops()` walks `root.children` on every layout effect ([Toolbar.tsx:64–73](../../../src/renderer/uikit/Toolbar/Toolbar.tsx)) and recomputes focus stops. When NavPanel or Save unmount/remount, the active index clamps to `Math.min(activeIdx, stops.length - 1)`. Confirmed the current Toolbar implementation already handles dynamic child sets correctly — no Toolbar changes needed.

7. **`ImageEditorModel` is a page model, not a content-view ViewModel.** Unlike `MermaidView`/`SvgView`/`HtmlView`, ImageViewer's model is a full `EditorModel` subclass (manages its own pipe, cache, restore, dispose lifecycle). There is no `useContentViewModel` / `useSyncExternalStore` hook discipline to preserve here — the view subscribes directly via `model.state.use(...)`. This is unchanged by the migration.

8. **`<Spacer />` (no `size` prop) renders `flex: 1 1 auto`** ([Spacer.tsx:22–26](../../../src/renderer/uikit/Spacer/Spacer.tsx)) — exact behavioral match for the legacy `<FlexSpace />`. The Spacer is a `<span>`, the legacy was a `<div>` — both flex-grow inside a `display: flex` row identically.

### None open.

## Acceptance Criteria

- [ ] [ImageViewer.tsx](../../../src/renderer/editors/image/ImageViewer.tsx) imports `Toolbar`, `IconButton`, `Spacer` from `../../uikit`.
- [ ] The imports for `PageToolbar` (from `../base/EditorToolbar`), `Button` (from `../../components/basic/Button`), and `FlexSpace` (from `../../components/layout/Elements`) are all removed.
- [ ] `<PageToolbar borderBottom>` is replaced by `<Toolbar borderBottom>`.
- [ ] All four `<Button type="icon" size="small">` JSX blocks become `<IconButton size="sm" … icon={…} />` — no `type` prop, no children, icon passed via `icon` prop.
- [ ] `<FlexSpace />` is replaced by `<Spacer />`.
- [ ] No `styled.*`, `style={…}`, or `className={…}` anywhere on a UIKit component in the file.
- [ ] `ImageEditorModel`, `getDefaultImageViewerModelState`, `imageEditorModule`, `ImageViewerProps`, and all default/named/type exports are unchanged.
- [ ] All four IconButtons function (NavPanel toggles file navigator; Save shows save dialog when applicable; Draw opens new draw-view page; Copy writes PNG to clipboard).
- [ ] Conditional rendering preserved: NavPanel button hides when no `filePath` and `canOpenNavigator` is false; Save button hides when `filePath` is set or `url` is empty.
- [ ] Roving tabindex works inside the Toolbar; Tab/Arrow keys behave per Toolbar Rule 4.
- [ ] No new TypeScript errors filterable by `ImageViewer|editors/image`.

## Files Changed

| File | Change |
|------|--------|
| [src/renderer/editors/image/ImageViewer.tsx](../../../src/renderer/editors/image/ImageViewer.tsx) | Replace `PageToolbar`/`Button`/`FlexSpace` (legacy) with `Toolbar`/`IconButton`/`Spacer` (UIKit). Drop three legacy imports, add one UIKit import, rewrite the `ImageViewer()` render block. |

## Files NOT Changed

- [src/renderer/editors/image/BaseImageView.tsx](../../../src/renderer/editors/image/BaseImageView.tsx) — Phase 5 component (US-459, adopted in place)
- [src/renderer/editors/image/index.ts](../../../src/renderer/editors/image/index.ts) — re-exports unchanged
- [src/renderer/editors/register-editors.ts](../../../src/renderer/editors/register-editors.ts) — module registration unchanged
- [src/renderer/editors/base/EditorToolbar.tsx](../../../src/renderer/editors/base/EditorToolbar.tsx) — legacy `EditorToolbar` / `PageToolbar` kept intact for the remaining ~10 non-migrated editors
- [src/renderer/components/basic/Button.tsx](../../../src/renderer/components/basic/Button.tsx) — legacy component kept (still used by other pre-migration screens)
- [src/renderer/components/layout/Elements.tsx](../../../src/renderer/components/layout/Elements.tsx) — `FlexSpace` legacy export kept (still used elsewhere)
- [src/renderer/components/icons/FileIcon.tsx](../../../src/renderer/components/icons/FileIcon.tsx) — domain icon, not a UIKit migration target
- [src/renderer/theme/icons.ts](../../../src/renderer/theme/icons.ts), [src/renderer/theme/language-icons.ts](../../../src/renderer/theme/language-icons.ts) — SVG asset modules, unchanged
- All UIKit files — no additions, no changes
- All theme files — no token changes
