# US-456: SvgView — UIKit migration

## Goal

Migrate [SvgView.tsx](../../../src/renderer/editors/svg/SvgView.tsx) from the app-side `Button` (`src/renderer/components/basic/Button`) to UIKit's `IconButton`. After the migration the file imports zero non-UIKit components for rendering — only `BaseImageView`, which is Phase 5 adopt-in-place per [EPIC-025](../../epics/EPIC-025.md).

This is the third per-screen migration of EPIC-025 Phase 4. Unlike the prior migrations ([US-452 About](../US-452-about-screen-migration/README.md), [US-455 MermaidView](../US-455-mermaid-view-migration/README.md)), this task introduces **zero new UIKit components and zero new prop extensions** — every primitive needed already exists in the UIKit barrel.

## Background

### Why SvgView next

- **Smallest screen** — 85 lines, 0 styled components, 0 inline styles, 2 buttons.
- **Same toolbar pattern as MermaidView** — `createPortal(…, model.editorToolbarRefLast)` with a small set of `IconButton`s. Reuses exactly the pattern validated in [US-455](../US-455-mermaid-view-migration/README.md).
- **Zero UIKit additions** — `IconButton size="sm"` with `icon={<Icon />}` already replicates the legacy `Button type="icon" size="small"` (24×24 button + 16×16 icon — verified in US-455).
- **No state primitives needed** — no Spinner, no error overlay, no light/dark toggle, no Panel positioning. The component returns a `<>` Fragment containing the portal + `BaseImageView`.

### Audit results

| SvgView element (current) | UIKit replacement | Gap |
|---|---|---|
| `<Button type="icon" size="small" title="…" onClick={…}>{icon}</Button>` (×2 in portal) | `<IconButton size="sm" title="…" onClick={…} icon={…} />` | none |
| `<BaseImageView ref={imageRef} src={src} alt="SVG Preview" />` | unchanged (Phase 5 adopt-in-place) | none |
| `<>` Fragment root | unchanged (no styled wrapper exists) | none |

There is no `MermaidViewRoot`-style wrapper to migrate — the Fragment relies on the parent (the editor page layout) for sizing. No `<Panel>` wrapper is needed because there is no overflow/overlay layout to constrain.

### Files involved

| File | Role | Change |
|------|------|--------|
| [src/renderer/editors/svg/SvgView.tsx](../../../src/renderer/editors/svg/SvgView.tsx) | SVG editor view | Replace 2 × `Button` with 2 × `IconButton`; drop `Button` import; add `IconButton` import from `../../uikit` |

That's the entire change set — one file, one import swap, two button rewrites.

## Implementation Plan

Single phase. No UIKit additions. The whole task is rewriting one file.

### Step 1 — Rewrite [SvgView.tsx](../../../src/renderer/editors/svg/SvgView.tsx)

Full new content of the file:

```tsx
import { useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { BaseImageView } from "../image";
import type { BaseImageViewRef } from "../image";
import { TextFileModel } from "../text/TextEditorModel";
import { CopyIcon } from "../../theme/icons";
import { DrawIcon } from "../../theme/language-icons";
import { pagesModel } from "../../api/pages";
import { buildExcalidrawJsonWithImage, getImageDimensions } from "../draw/drawExport";
import { useContentViewModel } from "../base/useContentViewModel";
import { IconButton } from "../../uikit";
import { SvgViewModel, defaultSvgViewState } from "./SvgViewModel";

// ============================================================================
// SvgView Component - content-view for SVG files
// ============================================================================

interface SvgViewProps {
    model: TextFileModel;
}

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultSvgViewState;

/**
 * SVG Preview component that renders SVG content as an image.
 * Uses BaseImageView for zoom/pan functionality.
 * Reads from page.content (not file) so it shows unsaved changes.
 */
function SvgView({ model }: SvgViewProps) {
    const vm = useContentViewModel<SvgViewModel>(model, "svg-view");
    const content = model.state.use((s) => s.content);
    const imageRef = useRef<BaseImageViewRef>(null);

    useSyncExternalStore(
        vm ? (cb) => vm.state.subscribe(cb) : noopUnsubscribe,
        vm ? () => vm.state.get() : getDefaultState,
    );

    if (!vm) return null;

    const src = `data:image/svg+xml,${encodeURIComponent(content)}`;

    return (
        <>
            {Boolean(model.editorToolbarRefLast) &&
                createPortal(
                    <>
                        <IconButton
                            size="sm"
                            title="Open in Drawing Editor"
                            onClick={async () => {
                                const svgContent = model.state.get().content;
                                if (!svgContent.trim()) return;
                                const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgContent, "utf-8").toString("base64")}`;
                                const dims = await getImageDimensions(dataUrl);
                                const json = buildExcalidrawJsonWithImage(dataUrl, "image/svg+xml", dims.width, dims.height);
                                const title = model.state.get().title.replace(/\.svg$/i, "") + ".excalidraw";
                                pagesModel.addEditorPage("draw-view", "json", title, json);
                            }}
                            icon={<DrawIcon />}
                        />
                        <IconButton
                            size="sm"
                            title="Copy Image to Clipboard (Ctrl+C)"
                            onClick={() => imageRef.current?.copyToClipboard()}
                            icon={<CopyIcon />}
                        />
                    </>,
                    model.editorToolbarRefLast!
                )}
            <BaseImageView ref={imageRef} src={src} alt="SVG Preview" />
        </>
    );
}

export { SvgView };
export type { SvgViewProps };
```

Key changes vs. original ([SvgView.tsx](../../../src/renderer/editors/svg/SvgView.tsx)):

- **Removed** — `import { Button } from "../../components/basic/Button"`
- **Added** — `import { IconButton } from "../../uikit"`
- **Replaced** — both `<Button type="icon" size="small" title="…" onClick={…}>{icon}</Button>` blocks become `<IconButton size="sm" title="…" onClick={…} icon={icon} />` (children → `icon` prop, `type`/`size` collapsed into the new shape).
- All other lines (model state subscription, `content` and `src` derivation, toolbar portal logic, `BaseImageView` usage) are unchanged.

### Step 2 — TypeScript verification

Run `npx tsc --noEmit`. The svg editor must produce no new errors. Pre-existing errors elsewhere in the repo (automation, video, link-editor, worker, PageTab) are unrelated.

### Step 3 — Manual smoke test

Open a `.svg` file and verify:

1. **Initial render** — SVG displays via `BaseImageView`; mouse zoom and pan still work.
2. **Open in Drawing Editor** — top-right toolbar `IconButton` opens a new draw editor with the SVG embedded; new page title is `<source>.excalidraw`.
3. **Copy to Clipboard** — toolbar `IconButton` copies the rendered image; verify by pasting in another app (or via Ctrl+C inside the SVG view).
4. **Edit-and-preview** — edit the source `.svg` content in the linked text editor; the preview updates immediately.
5. **Empty content** — when the SVG file is empty, the Open-in-Drawing-Editor button is a no-op (early return on `!svgContent.trim()`).
6. **Theme switching** — switch app theme (default-dark, light-modern, monokai); IconButton hover/active states match the migrated MermaidView toolbar buttons.

## Concerns / Open Questions

### Resolved

1. **Why no `<Panel>` wrapper?** The current `SvgView` returns a `<>` Fragment — there is no `styled.div` root to migrate. The parent (the editor page layout) provides sizing constraints to `BaseImageView`. Adding a `Panel` wrapper would be unnecessary scope creep with no behavior change. (MermaidView needed `<Panel direction="column" flex overflow="hidden" position="relative" height={0}>` because of the loading-overlay layout; SvgView has no overlay state.)

2. **Why no Spinner?** SvgView has no async loading state — the SVG is a synchronous data URL built from the editor's content string. The component renders or it doesn't.

3. **`BaseImageView` stays as-is.** Per Phase 5 of EPIC-025, image-pan/zoom components are adopted in place rather than rewritten. Same as MermaidView ([US-455](../US-455-mermaid-view-migration/README.md)).

4. **No `disabled` state on toolbar buttons.** The original `SvgView` never disables either button — the Open-in-Drawing-Editor handler does an early return inside `onClick` if `content.trim()` is empty, and Copy is always available. That behavior is preserved (no `disabled` prop). This is a behavior preservation, not a UX redesign.

5. **`SvgViewModel` is intentionally minimal.** Its `defaultSvgViewState` is `{}`, and `useSyncExternalStore` is called only to keep the hook order stable (`if (!vm) return null` after the call). The migration does not touch this — same hook-order discipline applies regardless of which button library is used.

### None open.

## Acceptance Criteria

- [ ] [SvgView.tsx](../../../src/renderer/editors/svg/SvgView.tsx) imports `IconButton` from `../../uikit`; the import for `Button` from `../../components/basic/Button` is removed.
- [ ] Both portal toolbar buttons use `<IconButton size="sm" title="…" onClick={…} icon={…} />` — no children, no `type` prop.
- [ ] No `styled.*`, `style={…}`, or `className={…}` anywhere in the file (was already true; remains so after migration).
- [ ] `SvgViewModel`, `defaultSvgViewState`, `SvgViewProps`, and the `SvgView` external API are unchanged.
- [ ] SVG view renders correctly across themes; both toolbar buttons work; zoom/pan via `BaseImageView` unchanged.
- [ ] No new TypeScript errors.

## Files Changed

| File | Change |
|------|--------|
| [src/renderer/editors/svg/SvgView.tsx](../../../src/renderer/editors/svg/SvgView.tsx) | Replace `Button` (legacy) with `IconButton` (UIKit) — drop `Button` import, add `IconButton` import, rewrite both portal toolbar buttons |

## Files NOT Changed

- [src/renderer/editors/svg/SvgViewModel.ts](../../../src/renderer/editors/svg/SvgViewModel.ts) — ViewModel unchanged
- [src/renderer/editors/svg/index.ts](../../../src/renderer/editors/svg/index.ts) — re-exports unchanged
- [src/renderer/editors/register-editors.ts](../../../src/renderer/editors/register-editors.ts) — module registration unchanged
- [src/renderer/editors/image/BaseImageView.tsx](../../../src/renderer/editors/image/BaseImageView.tsx) — Phase 5 component, adopted in place
- [src/renderer/components/basic/Button.tsx](../../../src/renderer/components/basic/Button.tsx) — legacy component kept (still used by other pre-migration screens)
- All UIKit files — no additions, no changes
- All theme files — no token changes
