# US-455: MermaidView — UIKit migration

## Goal

Migrate the Mermaid diagram preview screen ([src/renderer/editors/mermaid/MermaidView.tsx](../../../src/renderer/editors/mermaid/MermaidView.tsx)) from app-side `styled.div` definitions, app-side `Button`, `CircularProgress`, and `EditorError` to UIKit primitives — the second per-screen migration of [EPIC-025](../../epics/EPIC-025.md) Phase 4.

This task introduces **one new UIKit component** (`Spinner`) and a small set of supporting prop extensions (`position` / `inset` / `zIndex` / `background="overlay"` on `Panel`; `preWrap` on `Text`) needed to express the screen's layout in pure UIKit. After the migration, `MermaidView.tsx` contains zero `styled.*` calls, zero `style={...}`, zero `className={...}`, and imports only UIKit components for rendering (UIKit Rule 7).

## Background

### EPIC-025 Phase 4 context

Per-screen migration loop (from [EPIC-025](../../epics/EPIC-025.md) Phase 4):

1. Pick a screen
2. Audit which UIKit components are needed and which are missing
3. Build missing components / prop extensions in Storybook first
4. Rewrite the screen with UIKit
5. Smoke-test the screen

The first per-screen migration was [US-452 (About page)](../US-452-about-screen-migration/README.md), which followed the same pattern: extend `Panel` with the missing props, then rewrite the screen.

### Why MermaidView

- **Self-contained** — one editor view, one ViewModel, one entry in [register-editors.ts](../../../src/renderer/editors/register-editors.ts). No cross-screen coupling.
- **Realistic state** — has loading / error / loaded states and a 3-button portal toolbar; exercises overlay layout, conditional rendering, and `IconButton` interactions.
- **High-leverage UIKit gap** — the missing primitive (`Spinner`) is used app-wide (Progress overlay, REST client, image loading, MCP inspector, notebook cells, etc.). Building it here unblocks future migrations.
- **No `Dialog` dependency** — `Dialog` (US-432) is still planned, ruling out all dialog-based screens.

### Audit results

| Mermaid element (current) | UIKit replacement | Gap |
|---|---|---|
| `MermaidViewRoot` — `styled.div` flex column, `flex: 1 1 auto`, overflow hidden, **`position: relative`** | `<Panel direction="column" flex overflow="hidden" position="relative">` | **`position` missing on Panel** |
| `.mermaid-loading` — flex centered, full-flex, `bg.default` | `<Panel flex align="center" justify="center" background="default">` | none |
| `.mermaid-loading-overlay` — `position: absolute`, `inset: 0`, flex centered, **`bg.overlay`**, **`zIndex: 1`** | `<Panel position="absolute" inset={0} zIndex={1} align="center" justify="center" background="overlay">` | **`position` / `inset` / `zIndex` / `background="overlay"` missing on Panel** |
| `<Button type="icon" size="small" title="…" onClick={…} disabled={…}>` (×3 in portal) | `<IconButton size="sm" title="…" onClick={…} disabled={…} icon={…} />` | none — `IconButton size="sm"` already produces `24×24` button + `16×16` icon, matching old `Button type="icon" size="small"` |
| `<CircularProgress />` (size 32 default + small variant) | `<Spinner />` (default 32) and `<Spinner size={18}>` if needed | **`Spinner` missing in UIKit** |
| `<EditorError>{error}</EditorError>` — styled.div, pre-wrap, yellow text, centered via `margin: auto` | `<Panel flex align="center" justify="center" padding="xxxl"><Text color="warning" preWrap>{error}</Text></Panel>` | **`preWrap` missing on Text** |
| `<BaseImageView>` (Phase 5 component — kept in place) | unchanged | none |

The `createPortal` toolbar pattern (using `model.editorToolbarRefLast`) is preserved — per [US-450](../US-450-uikit-toolbar/README.md), per-editor `PageToolbar` migration is deferred. Only the buttons inside the portal change.

### Files involved

| File | Role | Change |
|------|------|--------|
| [src/renderer/uikit/Spinner/Spinner.tsx](../../../src/renderer/uikit/Spinner/Spinner.tsx) | **NEW** — rotating progress indicator | Create |
| [src/renderer/uikit/Spinner/Spinner.story.tsx](../../../src/renderer/uikit/Spinner/Spinner.story.tsx) | **NEW** — Storybook entry | Create |
| [src/renderer/uikit/Spinner/index.ts](../../../src/renderer/uikit/Spinner/index.ts) | **NEW** — barrel | Create |
| [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) | UIKit barrel | Add `Spinner` export |
| [src/renderer/uikit/Panel/Panel.tsx](../../../src/renderer/uikit/Panel/Panel.tsx) | Layout primitive | Add `position` / `inset` / `zIndex` props; add `"overlay"` to `background` enum |
| [src/renderer/uikit/Panel/Panel.story.tsx](../../../src/renderer/uikit/Panel/Panel.story.tsx) | Panel story | Add new prop entries |
| [src/renderer/uikit/Text/Text.tsx](../../../src/renderer/uikit/Text/Text.tsx) | Text primitive | Add `preWrap?: boolean` prop |
| [src/renderer/uikit/Text/Text.story.tsx](../../../src/renderer/uikit/Text/Text.story.tsx) | Text story | Add `preWrap` entry |
| [src/renderer/editors/storybook/storyRegistry.ts](../../../src/renderer/editors/storybook/storyRegistry.ts) | Story registry | Register `spinnerStory` |
| [src/renderer/editors/mermaid/MermaidView.tsx](../../../src/renderer/editors/mermaid/MermaidView.tsx) | Mermaid editor view | Rewrite — drop `styled`, `color`, `Button`, `CircularProgress`, `EditorError`; use UIKit |

### Theme tokens used

- `color.background.overlay` (CSS var `--color-bg-overlay`) — already exists in [color.ts](../../../src/renderer/theme/color.ts) at `background.overlay`. The new Panel `background="overlay"` value maps to this.
- All new Spinner / Panel positioning props use plain CSS values (no new theme tokens needed).

## Implementation Plan

The work splits into two phases. Phase 1 lands the UIKit additions in isolation (with Storybook coverage); Phase 2 rewrites the screen against them.

| Phase | Scope | Risk |
|-------|-------|------|
| **Phase 1** — UIKit additions (Steps 1–6) | New `Spinner` component, Panel positioning props + `"overlay"` background, Text `preWrap` prop, Storybook entries | Low — pure additive UIKit work, no consumers affected |
| **Phase 2** — MermaidView migration (Steps 7–9) | Rewrite [MermaidView.tsx](../../../src/renderer/editors/mermaid/MermaidView.tsx) using the Phase 1 primitives | Medium — visible behavior change; smoke test required |

Phase 1 is shippable on its own — the new primitives and props become available across the codebase and can be exercised in Storybook before any screen consumes them.

---

## Phase 1 — UIKit additions

### Step 1 — Build `Spinner` UIKit component

Create [src/renderer/uikit/Spinner/Spinner.tsx](../../../src/renderer/uikit/Spinner/Spinner.tsx):

```tsx
import React from "react";
import styled from "@emotion/styled";
import { keyframes } from "@emotion/react";
import { ProgressIcon } from "../../theme/icons";

// --- Types ---

export interface SpinnerProps
    extends Omit<React.HTMLAttributes<HTMLSpanElement>, "style" | "className"> {
    /** Outer size in px. Default: 32. */
    size?: number;
}

// --- Styled ---

const spin = keyframes({
    from: { transform: "rotate(0deg)" },
    to:   { transform: "rotate(360deg)" },
});

const Root = styled.span<{ $size: number }>(
    ({ $size }) => ({
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: $size,
        height: $size,
        flexShrink: 0,
        "& svg": {
            width: $size,
            height: $size,
            animation: `${spin} 1.5s steps(10) infinite`,
        },
    }),
    { label: "Spinner" },
);

// --- Component ---

export function Spinner({ size = 32, ...rest }: SpinnerProps) {
    return (
        <Root
            data-type="spinner"
            role="status"
            aria-live="polite"
            aria-label="Loading"
            $size={size}
            {...rest}
        >
            <ProgressIcon />
        </Root>
    );
}
```

Notes:
- `data-type="spinner"` per UIKit Rule 1.
- `role="status"` + `aria-label="Loading"` for screen readers.
- CSS `steps(10)` animation reproduces the exact 10-step / 1.5 s cadence of the legacy [CircularProgress](../../../src/renderer/components/basic/CircularProgress.tsx) — but runs entirely on the GPU compositor with no React re-renders, no `setInterval`, no `useState`, no cleanup. Pauses automatically when the tab is hidden.

Create [src/renderer/uikit/Spinner/index.ts](../../../src/renderer/uikit/Spinner/index.ts):

```ts
export { Spinner } from "./Spinner";
export type { SpinnerProps } from "./Spinner";
```

Create [src/renderer/uikit/Spinner/Spinner.story.tsx](../../../src/renderer/uikit/Spinner/Spinner.story.tsx):

```tsx
import { Spinner } from "./Spinner";
import { Story } from "../../editors/storybook/storyTypes";

export const spinnerStory: Story = {
    id: "spinner",
    name: "Spinner",
    section: "Bootstrap",
    component: Spinner as any,
    props: [
        { name: "size", type: "number", default: 32, min: 12, max: 96, step: 2 },
    ],
};
```

### Step 2 — Register Spinner in UIKit barrel and storyRegistry

Update [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts):

```ts
// Append after the existing Bootstrap exports:
export { Spinner } from "./Spinner";
export type { SpinnerProps } from "./Spinner";
```

Update [src/renderer/editors/storybook/storyRegistry.ts](../../../src/renderer/editors/storybook/storyRegistry.ts):

1. Add import: `import { spinnerStory } from "../../uikit/Spinner/Spinner.story";`
2. Append `spinnerStory` to `ALL_STORIES` (in the Bootstrap line).

### Step 3 — Extend `Panel` with positioning + `"overlay"` background

In [src/renderer/uikit/Panel/Panel.tsx](../../../src/renderer/uikit/Panel/Panel.tsx):

**3a.** Add three positioning props to `PanelProps` (after the existing `overflow` group, before `border`):

```ts
/** CSS position. Default: undefined (static). Use "relative" on parents of absolutely-positioned children. */
position?: "relative" | "absolute" | "fixed";
/** CSS `inset` shorthand — number → px, string passes through (e.g. "0", "8px 0"). Sets all four sides at once. */
inset?: number | string;
/** Stack order. Use sparingly — overlays / popovers only. */
zIndex?: number;
```

**3b.** Extend the `background` prop type to include `"overlay"`:

```ts
/** Background fill. Maps to color.background.{default,light,dark,overlay}. */
background?: "default" | "light" | "dark" | "overlay";
```

**3c.** In the `Root` styled component, add the `"overlay"` rule next to the existing `data-bg` rules:

```ts
'&[data-bg="overlay"]': { backgroundColor: color.background.overlay },
```

**3d.** Destructure `position`, `inset`, `zIndex` in `Panel(props)` and add them to `inlineStyle`:

```ts
position,
inset,
zIndex,
```

(Pass directly to `inlineStyle` — same shape as `width` / `height` / `maxWidth`. CSSProperties accepts all three natively.)

### Step 4 — Update Panel story

In [src/renderer/uikit/Panel/Panel.story.tsx](../../../src/renderer/uikit/Panel/Panel.story.tsx):

- Extend the `background` enum options to `["default", "light", "dark", "overlay"]`.
- Add three new prop entries (next to `width` / `height`):
  ```ts
  { name: "position", type: "enum", options: ["", "relative", "absolute", "fixed"], default: "" },
  { name: "inset",    type: "string", default: "" },
  { name: "zIndex",   type: "number", default: 0 },
  ```

### Step 5 — Extend `Text` with `preWrap`

In [src/renderer/uikit/Text/Text.tsx](../../../src/renderer/uikit/Text/Text.tsx):

**5a.** Add to `TextStyleProps` (after `nowrap`):

```ts
/** Preserve newlines and wrap on word boundaries (white-space: pre-wrap). Mutually exclusive with `nowrap`. */
preWrap?: boolean;
```

**5b.** Add the styled-component rule next to `data-nowrap`:

```ts
"&[data-pre-wrap]": { whiteSpace: "pre-wrap" },
```

**5c.** Destructure `preWrap` and forward to `data-pre-wrap`:

```ts
data-pre-wrap={preWrap || undefined}
```

### Step 6 — Update Text story

In [src/renderer/uikit/Text/Text.story.tsx](../../../src/renderer/uikit/Text/Text.story.tsx) — add a `preWrap` entry next to `nowrap`:

```ts
{ name: "preWrap", type: "boolean", default: false },
```

---

## Phase 2 — MermaidView migration

### Step 7 — Rewrite `MermaidView.tsx`

Full new content of [src/renderer/editors/mermaid/MermaidView.tsx](../../../src/renderer/editors/mermaid/MermaidView.tsx):

```tsx
import { useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { BaseImageView } from "../image";
import type { BaseImageViewRef } from "../image";
import { TextFileModel } from "../text/TextEditorModel";
import { CopyIcon, SunIcon, MoonIcon } from "../../theme/icons";
import { DrawIcon } from "../../theme/language-icons";
import { pagesModel } from "../../api/pages";
import { buildExcalidrawJsonWithImage, getImageDimensions } from "../draw/drawExport";
import { useContentViewModel } from "../base/useContentViewModel";
import { Panel, Text, IconButton, Spinner } from "../../uikit";
import { MermaidViewModel, MermaidViewState, defaultMermaidViewState } from "./MermaidViewModel";

// ============================================================================
// MermaidView Component - content-view for Mermaid diagrams
// ============================================================================

interface MermaidViewProps {
    model: TextFileModel;
}

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultMermaidViewState;

function MermaidView({ model }: MermaidViewProps) {
    const vm = useContentViewModel<MermaidViewModel>(model, "mermaid-view");
    const imageRef = useRef<BaseImageViewRef>(null);

    // Subscribe to VM state (unconditional — Rules of Hooks)
    const pageState: MermaidViewState = useSyncExternalStore(
        vm ? (cb) => vm.state.subscribe(cb) : noopUnsubscribe,
        vm ? () => vm.state.get() : getDefaultState,
    );

    if (!vm) return null;

    const { svgUrl, error, loading, lightMode } = pageState;

    return (
        <Panel direction="column" flex overflow="hidden" position="relative">
            {Boolean(model.editorToolbarRefLast) &&
                createPortal(
                    <>
                        <IconButton
                            size="sm"
                            title={lightMode ? "Switch to Dark Theme" : "Switch to Light Theme"}
                            onClick={vm.toggleLightMode}
                            icon={lightMode ? <MoonIcon /> : <SunIcon />}
                        />
                        <IconButton
                            size="sm"
                            title="Open in Drawing Editor"
                            disabled={!svgUrl}
                            onClick={async () => {
                                if (!svgUrl) return;
                                // svgUrl is data:image/svg+xml,<percent-encoded> — decode to raw SVG, re-encode as base64
                                const svgText = decodeURIComponent(svgUrl.replace("data:image/svg+xml,", ""));
                                const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgText, "utf-8").toString("base64")}`;
                                const dims = await getImageDimensions(dataUrl);
                                const json = buildExcalidrawJsonWithImage(dataUrl, "image/svg+xml", dims.width, dims.height);
                                const title = model.state.get().title.replace(/\.\w+$/, "") + ".excalidraw";
                                pagesModel.addEditorPage("draw-view", "json", title, json);
                            }}
                            icon={<DrawIcon />}
                        />
                        <IconButton
                            size="sm"
                            title="Copy Image to Clipboard (Ctrl+C)"
                            onClick={() => imageRef.current?.copyToClipboard()}
                            disabled={!svgUrl}
                            icon={<CopyIcon />}
                        />
                    </>,
                    model.editorToolbarRefLast!
                )}
            {error && (
                <Panel flex align="center" justify="center" padding="xxxl">
                    <Text color="warning" preWrap>{error}</Text>
                </Panel>
            )}
            {loading && svgUrl && (
                <Panel
                    position="absolute"
                    inset={0}
                    zIndex={1}
                    align="center"
                    justify="center"
                    background="overlay"
                >
                    <Spinner />
                </Panel>
            )}
            {loading && !svgUrl ? (
                <Panel flex align="center" justify="center" background="default">
                    <Spinner />
                </Panel>
            ) : svgUrl ? (
                <BaseImageView
                    ref={imageRef}
                    src={svgUrl}
                    alt="Mermaid Diagram"
                />
            ) : null}
        </Panel>
    );
}

export { MermaidView };
export type { MermaidViewProps };
```

Key changes vs. original:
- Removed: `import styled from "@emotion/styled"`, `import { Button } from "../../components/basic/Button"`, `import { CircularProgress } from "../../components/basic/CircularProgress"`, `import { EditorError } from "../base/EditorError"`, `import color from "../../theme/color"`, the `MermaidViewRoot` styled.div block.
- Added: `import { Panel, Text, IconButton, Spinner } from "../../uikit"`.
- The conditional rendering structure (error / loading-overlay / loading-empty / svg) is preserved; only the wrappers change.
- `MermaidViewModel`, `defaultMermaidViewState`, and `MermaidViewState` imports are unchanged.

### Step 8 — TypeScript verification

Run `npx tsc --noEmit`. The mermaid editor and any code that imports `Panel` / `Text` / `Spinner` must produce no new errors. Pre-existing errors elsewhere in the repo are unrelated.

### Step 9 — Manual smoke test

Open a `.mmd` file (or any mermaid-editor-bound test file) and verify:

1. **Initial render** — full-screen spinner appears while mermaid renders the first diagram.
2. **Loaded state** — diagram displays via `BaseImageView` (zoom / pan still works via mouse + scroll).
3. **Re-render on edit** — edit the source `.mmd` file in the linked text editor; the overlay spinner appears centered with a dim background while re-rendering.
4. **Toggle light mode** — top-right toolbar `IconButton` switches between sun/moon icons; diagram re-renders with the appropriate theme.
5. **Open in Drawing Editor** — `IconButton` opens a new draw editor with the SVG embedded; disabled when `svgUrl` is empty.
6. **Copy to Clipboard** — `IconButton` copies the rendered image; disabled when `svgUrl` is empty.
7. **Error state** — feed it invalid mermaid syntax (e.g. `graph TD\n    A -->`); error message appears centered, in warning color, with line breaks preserved (`preWrap`).
8. **Theme switching** — switch app theme (default-dark, light-modern, monokai); the view stays readable.
9. **Storybook** — open the Storybook editor, navigate to Bootstrap → Spinner, verify the size prop slider; navigate to Layout → Panel, verify the new position / inset / zIndex / background="overlay" props.

## Concerns / Open Questions

### Resolved

1. **Why include `Spinner` in this task instead of a separate task?** Phase 4 of EPIC-025 explicitly says "Build missing components in Storybook first … then rewrite the screen … in one focused pass." Spinner is the only new primitive needed; bundling it keeps the work atomic. This matches the [US-452 (About) precedent](../US-452-about-screen-migration/README.md), which extended `Panel` with `maxWidth` in the same task as the screen rewrite.

2. **Why three new positioning props on `Panel` instead of a separate `Overlay` primitive?** `position` / `inset` / `zIndex` are general layout knobs that will be needed by many future migrations (Dialog, Popover, Toast, modal overlays). Adding them to `Panel` keeps the primitive count down and matches the existing pattern of width / height / maxWidth — generic CSS-passthrough props on the layout primitive. A specialized `Overlay` component can still be introduced later if a recurring blocking-overlay pattern emerges.

3. **Why `"overlay"` on `Panel.background` rather than passing the color via `style`?** Per Rule 7, the answer to "this layout needs a value not in props" is "extend the prop". `color.background.overlay` is already a theme token, used in 8 places across the app — exposing it through the existing `background` enum is cheap and keeps consumers Emotion-free.

4. **Why `preWrap` on `Text` rather than keep the `EditorError` import?** `EditorError` is an app-side `styled.div` (uses Emotion). Importing it from a migrated screen leaves a non-UIKit island and contradicts the Phase 4 acceptance criterion ("imports only UIKit components for rendering"). `preWrap` is a one-line addition to `Text` and unblocks any future migration that needs to display multi-line text (errors, output panels, log views).

5. **Should `EditorError` itself be migrated?** Not in this task. `EditorError` is shared with `GridEditor`, `GraphView`, `DrawView`, `LinkEditor`, `LogViewEditor`, `NotebookEditor`, `RestClientEditor`, `TodoEditor`, and `AsyncEditor`. Migrating it would couple eight other screens to this task. Each editor's per-screen task replaces its `EditorError` usage as part of that screen's migration — exactly as `MermaidView` does here.

6. **Toolbar portal pattern preserved.** Per [US-450](../US-450-uikit-toolbar/README.md), per-editor `PageToolbar` migration is deferred. The `createPortal(…, model.editorToolbarRefLast)` wrapper stays; only the inner buttons change from `<Button type="icon" size="small">` to `<IconButton size="sm">`. Both produce a 24×24 button with a 16×16 icon (verified in [Button.tsx:53-60](../../../src/renderer/components/basic/Button.tsx#L53-L60) vs. [IconButton.tsx:38-53](../../../src/renderer/uikit/IconButton/IconButton.tsx#L38-L53)).

7. **Spinner cadence matches `CircularProgress`.** Both rotate 360° in 10 steps at 150 ms intervals (~1.5 s per revolution). Visual continuity is preserved.

8. **`BaseImageView` stays as-is.** Per Phase 5 of EPIC-025, virtualized / image-pan components are adopted in place rather than rewritten. `BaseImageView` continues to be imported from `editors/image`.

### None open.

## Acceptance Criteria

- [ ] `Spinner` component exists at [src/renderer/uikit/Spinner/Spinner.tsx](../../../src/renderer/uikit/Spinner/Spinner.tsx) with `data-type="spinner"`, `size?: number` (default 32), `role="status"`, and `aria-label="Loading"`
- [ ] `Spinner` exported from [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) and registered in [storyRegistry.ts](../../../src/renderer/editors/storybook/storyRegistry.ts)
- [ ] `Panel` accepts `position` (`"relative" | "absolute" | "fixed"`), `inset` (`number | string`), and `zIndex` (`number`) props — all forwarded to `inlineStyle`
- [ ] `Panel` `background` enum includes `"overlay"` — maps to `color.background.overlay`
- [ ] `Text` accepts `preWrap?: boolean` prop — applies `white-space: pre-wrap` on the root span
- [ ] `Panel.story.tsx` and `Text.story.tsx` expose all new props in the property editor
- [ ] [MermaidView.tsx](../../../src/renderer/editors/mermaid/MermaidView.tsx) contains zero `styled.*` calls, zero `style={...}`, zero `className={...}`
- [ ] `MermaidView.tsx` imports zero app-side styled components for rendering — no `Button`, `CircularProgress`, `EditorError`, no `color`, no `@emotion/styled`
- [ ] `MermaidViewModel`, `defaultMermaidViewState`, `MermaidViewState`, [render-mermaid.ts](../../../src/renderer/editors/mermaid/render-mermaid.ts), and [mermaid/index.ts](../../../src/renderer/editors/mermaid/index.ts) are unchanged
- [ ] Mermaid view renders correctly in dark and light themes; toggle light-mode button works
- [ ] Loading spinner shows on initial render; overlay spinner shows during re-render with dim background
- [ ] Error message displays multi-line errors with line breaks preserved; centered; warning color
- [ ] Open in Drawing Editor and Copy Image to Clipboard buttons work; disabled when `svgUrl` is empty
- [ ] No new TypeScript errors

## Files Changed

| File | Change |
|------|--------|
| [src/renderer/uikit/Spinner/Spinner.tsx](../../../src/renderer/uikit/Spinner/Spinner.tsx) | **NEW** — rotating progress indicator |
| [src/renderer/uikit/Spinner/Spinner.story.tsx](../../../src/renderer/uikit/Spinner/Spinner.story.tsx) | **NEW** — Storybook entry |
| [src/renderer/uikit/Spinner/index.ts](../../../src/renderer/uikit/Spinner/index.ts) | **NEW** — barrel |
| [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) | Add `Spinner` export |
| [src/renderer/uikit/Panel/Panel.tsx](../../../src/renderer/uikit/Panel/Panel.tsx) | Add `position` / `inset` / `zIndex` props; add `"overlay"` to `background` enum + matching styled rule |
| [src/renderer/uikit/Panel/Panel.story.tsx](../../../src/renderer/uikit/Panel/Panel.story.tsx) | Add `position` / `inset` / `zIndex` story entries; extend `background` enum |
| [src/renderer/uikit/Text/Text.tsx](../../../src/renderer/uikit/Text/Text.tsx) | Add `preWrap?: boolean` prop + matching styled rule |
| [src/renderer/uikit/Text/Text.story.tsx](../../../src/renderer/uikit/Text/Text.story.tsx) | Add `preWrap` story entry |
| [src/renderer/editors/storybook/storyRegistry.ts](../../../src/renderer/editors/storybook/storyRegistry.ts) | Register `spinnerStory` |
| [src/renderer/editors/mermaid/MermaidView.tsx](../../../src/renderer/editors/mermaid/MermaidView.tsx) | Replace styled.div root + overlay + `Button` + `CircularProgress` + `EditorError` with `Panel` / `IconButton` / `Spinner` / `Text` composition |

## Files NOT Changed

- [src/renderer/editors/mermaid/MermaidViewModel.ts](../../../src/renderer/editors/mermaid/MermaidViewModel.ts) — ViewModel logic unchanged
- [src/renderer/editors/mermaid/render-mermaid.ts](../../../src/renderer/editors/mermaid/render-mermaid.ts) — render utilities unchanged
- [src/renderer/editors/mermaid/index.ts](../../../src/renderer/editors/mermaid/index.ts) — re-exports unchanged
- [src/renderer/editors/register-editors.ts](../../../src/renderer/editors/register-editors.ts) — module registration unchanged
- [src/renderer/editors/base/EditorError.tsx](../../../src/renderer/editors/base/EditorError.tsx) — kept as-is; replaced inline at each editor's per-screen migration (still used by 8+ other editors)
- [src/renderer/editors/image/BaseImageView.tsx](../../../src/renderer/editors/image/BaseImageView.tsx) — Phase 5 component, adopted in place
- [src/renderer/components/basic/CircularProgress.tsx](../../../src/renderer/components/basic/CircularProgress.tsx) — kept as-is; still used by 18+ files (will be removed once all consumers migrate to `Spinner` in their respective per-screen tasks)
- All theme files — no token changes
