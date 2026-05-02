# US-459: BaseImageView — UIKit Adoption (Phase 5 — adopt-in-place)

## Goal

Bring [`BaseImageView`](../../../src/renderer/editors/image/BaseImageView.tsx) in line with UIKit conventions **without rewriting it**, and relocate the file to a folder that reflects what it actually is: a reusable, multi-editor presentational primitive.

Two parallel changes:

1. **Adopt-in-place edits** — add `data-type` and `data-*` state attributes to the root, replace the CSS-class state pattern (`.dragging` / `.can-drag`) with data-attribute state (`data-dragging`), convert the only structural class (`.zoom-indicator`) to `data-part="zoom-indicator"` matching the IconButton/Checkbox precedent, and replace hardcoded pixel values in the styled root with [`uikit/tokens`](../../../src/renderer/uikit/tokens.ts) constants.
2. **Relocation** — move the file from `src/renderer/editors/image/BaseImageView.tsx` to `src/renderer/editors/shared/BaseImageView.tsx` (alongside [`ColorizedCode.tsx`](../../../src/renderer/editors/shared/ColorizedCode.tsx) and [`link-open-menu.tsx`](../../../src/renderer/editors/shared/link-open-menu.tsx) — the existing home for shared editor presentational components/helpers). Public API (`BaseImageViewRef`, `BaseImageViewProps`), render structure, ref shape, and runtime behavior stay identical.

This is the first per-component task under [EPIC-025](../../epics/EPIC-025.md) **Phase 5 (Complex Component Adoption)**. The four prior per-screen tasks ([US-452 About](../US-452-about-screen-migration/README.md), [US-455 MermaidView](../US-455-mermaid-view-migration/README.md), [US-456 SvgView](../US-456-svg-view-migration/README.md), [US-457 HtmlView](../US-457-html-view-migration/README.md), [US-458 ImageViewer](../US-458-image-viewer-migration/README.md)) were Phase 4 *per-screen migrations*. US-459 is a different shape: BaseImageView is a complex component shared by three editors (ImageViewer, SvgView, MermaidView), with significant internal state (zoom, pan, drag) and custom DOM event handling (wheel, mouse drag, keyboard). Phase 5 explicitly preserves such components in place and adopts only the conventions that don't require a rewrite.

## Background

### Phase 5 scope (from [EPIC-025](../../epics/EPIC-025.md), Phase Plan)

> **Phase 5 — Complex Component Adoption** (AVGrid, List, ComboSelect)
> These virtualized and internally complex components are too risky to rewrite from scratch. Instead, adopt new patterns in place:
> - Add `data-type` and `data-*` state attributes
> - Apply roving tabindex where missing (List, AVGrid header)
> - Apply trait integration (`Traited<V>`) at the data prop level
>
> No full rewrite — incremental improvement only.

EPIC-025 lists AVGrid / List / ComboSelect as canonical Phase 5 candidates. BaseImageView fits the same shape: shared across three editors, internally stateful, custom DOM event handling. A rewrite would multiply regression risk across all three call sites.

### Source file

Currently at [`src/renderer/editors/image/BaseImageView.tsx`](../../../src/renderer/editors/image/BaseImageView.tsx) (~398 lines). Will move to `src/renderer/editors/shared/BaseImageView.tsx` as part of this task — see Concern §6 for the rationale. Two exports relevant to this task:

- **`BaseImageViewRoot`** — `styled.div` with `flex: 1 1 auto`, fill behavior, and three nested style blocks: `& img`, `& .zoom-indicator` (and its `:hover`), `&.dragging` / `&.can-drag` (cursor states).
- **`BaseImageView`** — `forwardRef<BaseImageViewRef, BaseImageViewProps>` rendering `<BaseImageViewRoot>` with an `<img>` child and a `<div className="zoom-indicator">` overlay.

### Current state-as-className (lines 369–371)

```tsx
<BaseImageViewRoot
    ref={viewModel.setContainerRef}
    className={`${state.isDragging ? "dragging" : ""} can-drag`}
    ...
>
```

The `dragging` class toggles when `state.isDragging` flips. The `can-drag` class is **always** present (it is appended unconditionally), so its only effect is to set `cursor: grab` as the baseline. Conversion: drop `can-drag` (move `cursor: grab` into the base styled rule), and replace the `dragging` class with `data-dragging` boolean state.

### Current `.zoom-indicator` usage (lines 388–393)

```tsx
<div
    className="zoom-indicator"
    onClick={viewModel.resetView}
    title="Reset Zoom"
>
    {zoomPercent}%
</div>
```

`.zoom-indicator` is a *structural* class (identifies a part of the component) — not a state. The matching pattern in UIKit is `data-part="…"` (used by [`IconButton`](../../../src/renderer/uikit/IconButton/IconButton.tsx) for `data-part="icon"` and [`Checkbox`](../../../src/renderer/uikit/Checkbox/Checkbox.tsx) for `data-part="icon"`). Convert to `data-part="zoom-indicator"` and switch the selector accordingly.

### Hardcoded pixels in `BaseImageViewRoot` (lines 11–48)

| Property                | Current        | UIKit token        | Match? |
|-------------------------|----------------|--------------------|--------|
| `bottom` (zoom indic.)  | `12`           | `spacing.lg` (12)  | exact  |
| `right` (zoom indic.)   | `12`           | `spacing.lg` (12)  | exact  |
| `padding` (zoom indic.) | `"4px 8px"`    | `spacing.sm` (4) / `spacing.md` (8) | exact |
| `borderRadius`          | `4`            | `radius.md` (4)    | exact  |
| `fontSize`              | `12`           | `fontSize.sm` (12) | exact  |

Every hardcoded value has an exact-match token. No visual change.

### What does NOT apply from Phase 5

- **Roving tabindex** — `BaseImageViewRoot` has `tabIndex={0}` so the viewport receives keyboard events for zoom shortcuts (`+ / - / 0 / Ctrl+C`). It has no focusable children: the zoom indicator is a plain `<div>`, not a button. There is no internal list/composite to roving-navigate. Skip per [`uikit/CLAUDE.md`](../../../src/renderer/uikit/CLAUDE.md#rule-4) Rule 4 ("Do not apply to simple lists that are not keyboard-navigable widgets").
- **Trait-based data binding** — the only data prop is `src: string` (a scalar URL). [`uikit/CLAUDE.md`](../../../src/renderer/uikit/CLAUDE.md#rule-3) Rule 3 explicitly excludes scalar-value components: "applies only to list/collection props".

### Consumers (import paths updated by the move; usage unchanged)

| File | JSX usage | Current import | New import |
|------|-----------|----------------|------------|
| [`src/renderer/editors/image/ImageViewer.tsx`](../../../src/renderer/editors/image/ImageViewer.tsx) | `<BaseImageView ref={model.setImageRef} src={src} alt={alt} />` | `from "./BaseImageView"` (×2 lines + 2 vestigial re-exports at file bottom) | `from "../shared/BaseImageView"` (re-exports removed — see Step 6) |
| [`src/renderer/editors/svg/SvgView.tsx`](../../../src/renderer/editors/svg/SvgView.tsx) | `<BaseImageView ref={imageRef} src={src} alt="SVG Preview" />` | `from "../image"` (barrel) | `from "../shared/BaseImageView"` (direct, matches `ColorizedCode` precedent) |
| [`src/renderer/editors/mermaid/MermaidView.tsx`](../../../src/renderer/editors/mermaid/MermaidView.tsx) | `<BaseImageView ref={imageRef} ...>` | `from "../image"` (barrel) | `from "../shared/BaseImageView"` |
| [`src/renderer/editors/image/index.ts`](../../../src/renderer/editors/image/index.ts) | n/a — barrel that re-exports | `from "./BaseImageView"` (lines 6–7) | re-exports removed — see Step 6 |

JSX usage and the runtime ref/prop contract stay identical — only import paths shift. `editors/shared/` has no `index.ts` barrel by convention (consumers of `ColorizedCode` and `link-open-menu` import the file directly), so no new barrel is added.

## Implementation Plan

Steps 1–4 edit the `BaseImageView` source content. Step 5 moves the file to `editors/shared/`. Step 6 updates consumer imports and removes vestigial re-exports. Step 7 is verification. The move is safe to do at any point in the sequence — internal imports inside `BaseImageView.tsx` (`../../core/state/model`, `../../theme/color`, `../../uikit/tokens`) all resolve from `editors/shared/` with the same `../../` depth as from `editors/image/`, so the file content does not need to change just because of the move.

### Step 1 — Add `tokens` import

After the existing `color` import (line 5):

**Before:**
```tsx
import color from "../../theme/color";
```

**After:**
```tsx
import color from "../../theme/color";
import { spacing, radius, fontSize } from "../../uikit/tokens";
```

### Step 2 — Rewrite `BaseImageViewRoot` styled rule

Replace the current rule (lines 11–48) with one that:
- moves `cursor: grab` into the base block (replaces unconditional `.can-drag` class)
- replaces `&.dragging` selector with `&[data-dragging]`
- replaces `& .zoom-indicator` selector with `& [data-part="zoom-indicator"]`
- replaces hardcoded pixel values with `spacing.lg`, `spacing.sm`, `spacing.md`, `radius.md`, `fontSize.sm`
- adds `{ label: "BaseImageViewRoot" }` (Emotion DevTools — UIKit convention; not currently set)

**Before:**
```tsx
export const BaseImageViewRoot = styled.div({
    flex: "1 1 auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    overflow: "hidden",
    position: "relative",
    backgroundColor: color.background.default,
    outline: "none",
    "& img": {
        transformOrigin: "center center",
        userSelect: "none",
        maxWidth: "none", // Allow scaling beyond container
        maxHeight: "none",
    },
    "& .zoom-indicator": {
        position: "absolute",
        bottom: 12,
        right: 12,
        padding: "4px 8px",
        backgroundColor: color.background.overlay,
        color: color.text.default,
        borderRadius: 4,
        fontSize: 12,
        fontFamily: "monospace",
        cursor: "pointer",
        "&:hover": {
            backgroundColor: color.background.overlayHover,
        },
    },
    "&.dragging": {
        cursor: "grabbing",
    },
    "&.can-drag": {
        cursor: "grab",
    },
});
```

**After:**
```tsx
export const BaseImageViewRoot = styled.div(
    {
        flex: "1 1 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        overflow: "hidden",
        position: "relative",
        backgroundColor: color.background.default,
        outline: "none",
        cursor: "grab",
        "& img": {
            transformOrigin: "center center",
            userSelect: "none",
            maxWidth: "none", // Allow scaling beyond container
            maxHeight: "none",
        },
        "& [data-part='zoom-indicator']": {
            position: "absolute",
            bottom: spacing.lg,
            right: spacing.lg,
            padding: `${spacing.sm}px ${spacing.md}px`,
            backgroundColor: color.background.overlay,
            color: color.text.default,
            borderRadius: radius.md,
            fontSize: fontSize.sm,
            fontFamily: "monospace",
            cursor: "pointer",
            "&:hover": {
                backgroundColor: color.background.overlayHover,
            },
        },
        "&[data-dragging]": {
            cursor: "grabbing",
        },
    },
    { label: "BaseImageViewRoot" },
);
```

### Step 3 — Update root element attributes

Replace `className={…}` with `data-type="image-view"` + `data-dragging`. Lines 369–371:

**Before:**
```tsx
<BaseImageViewRoot
    ref={viewModel.setContainerRef}
    className={`${state.isDragging ? "dragging" : ""} can-drag`}
    onMouseDown={viewModel.handleMouseDown}
    ...
```

**After:**
```tsx
<BaseImageViewRoot
    ref={viewModel.setContainerRef}
    data-type="image-view"
    data-dragging={state.isDragging || undefined}
    onMouseDown={viewModel.handleMouseDown}
    ...
```

The other root props (`onMouseMove`, `onMouseUp`, `onMouseLeave`, `onDoubleClick`, `onKeyDown`, `tabIndex={0}`) stay as-is.

### Step 4 — Update zoom-indicator div attributes

Replace `className="zoom-indicator"` with `data-part="zoom-indicator"`. Lines 388–393:

**Before:**
```tsx
<div
    className="zoom-indicator"
    onClick={viewModel.resetView}
    title="Reset Zoom"
>
    {zoomPercent}%
</div>
```

**After:**
```tsx
<div
    data-part="zoom-indicator"
    onClick={viewModel.resetView}
    title="Reset Zoom"
>
    {zoomPercent}%
</div>
```

### Step 5 — Move the file

Rename `src/renderer/editors/image/BaseImageView.tsx` → `src/renderer/editors/shared/BaseImageView.tsx`. Use `git mv` so history is preserved:

```sh
git mv src/renderer/editors/image/BaseImageView.tsx src/renderer/editors/shared/BaseImageView.tsx
```

No content changes inside the file are caused by the move. Internal imports (`../../core/state/model`, `../../theme/color`, `../../uikit/tokens`) all use `../../` which resolves to `src/renderer/` from either folder.

Do not create `src/renderer/editors/shared/index.ts`. The folder convention is direct file imports — consumers reference `editors/shared/<file>` without a barrel, matching the existing `ColorizedCode` and `link-open-menu` precedent.

### Step 6 — Update consumer imports and remove vestigial re-exports

#### 6a. [`src/renderer/editors/image/ImageViewer.tsx`](../../../src/renderer/editors/image/ImageViewer.tsx)

**Lines 13–14 — replace local import:**

Before:
```tsx
import { BaseImageView } from "./BaseImageView";
import type { BaseImageViewRef } from "./BaseImageView";
```

After:
```tsx
import { BaseImageView } from "../shared/BaseImageView";
import type { BaseImageViewRef } from "../shared/BaseImageView";
```

**Lines 342–343 — remove vestigial re-exports:**

Before:
```tsx
// Re-export base components for reuse
export { BaseImageView, ImageViewModel, defaultImageViewState } from "./BaseImageView";
export type { BaseImageViewProps, ImageViewState } from "./BaseImageView";
```

After: *(deleted — `BaseImageView` is no longer in this folder; the comment line above them is also removed)*

#### 6b. [`src/renderer/editors/image/index.ts`](../../../src/renderer/editors/image/index.ts)

**Lines 5–7 — remove the BaseImageView re-exports:**

Before:
```ts
// Re-export base components for reuse by other viewers (e.g., SvgView)
export { BaseImageView, ImageViewModel, defaultImageViewState } from "./BaseImageView";
export type { BaseImageViewRef, BaseImageViewProps, ImageViewState } from "./BaseImageView";
```

After: *(deleted)*

The file ends after the `ImageEditorModel` / `ImageViewerProps` re-exports at lines 1–3. SvgView and MermaidView no longer go through this barrel for `BaseImageView`.

#### 6c. [`src/renderer/editors/svg/SvgView.tsx`](../../../src/renderer/editors/svg/SvgView.tsx)

**Lines 3–4 — repoint imports:**

Before:
```tsx
import { BaseImageView } from "../image";
import type { BaseImageViewRef } from "../image";
```

After:
```tsx
import { BaseImageView } from "../shared/BaseImageView";
import type { BaseImageViewRef } from "../shared/BaseImageView";
```

#### 6d. [`src/renderer/editors/mermaid/MermaidView.tsx`](../../../src/renderer/editors/mermaid/MermaidView.tsx)

**Lines 3–4 — same change as 6c:**

Before:
```tsx
import { BaseImageView } from "../image";
import type { BaseImageViewRef } from "../image";
```

After:
```tsx
import { BaseImageView } from "../shared/BaseImageView";
import type { BaseImageViewRef } from "../shared/BaseImageView";
```

### Step 7 — Verification

1. **TypeScript** — `npx tsc --noEmit` and filter for `BaseImageView` / `editors/image` / `editors/svg` / `editors/mermaid` / `editors/shared`. Expect zero new errors. Pre-existing repo-wide errors are out of scope (same noise floor as US-455–US-458).
2. **Repo-wide grep** — `Grep "BaseImageView"` across `src/` should return references only to `editors/shared/BaseImageView` (definition + 3 consumers). No `editors/image/BaseImageView` references should remain.
3. **Manual smoke test (in-browser via `npm start`):**
   - **ImageViewer** — open an image file. Cursor is grab in the viewport; click-and-hold flips to grabbing; release flips back to grab. Mouse wheel zooms toward cursor. `+ / - / 0` keys work. `Ctrl+C` copies. Zoom indicator at bottom-right shows percentage; hover changes its background; click resets view.
   - **SvgView** — open an `.svg` file (via the SvgView editor route, not the SVG-as-text editor). Same cursor / zoom / pan / indicator behavior.
   - **MermaidView** — open a `.mermaid` or `.mmd` file. Same behavior.
4. **DevTools spot-check** — Elements panel shows `<div data-type="image-view">` on the viewport root, `<div data-part="zoom-indicator">` on the overlay; `data-dragging` toggles in real time during drag.
5. **Visual diff** — zoom indicator position and look unchanged (12px from bottom/right, `4px 8px` padding, `4px` radius, 12px monospace font).

## Concerns / Open Questions

### 1. Phase 5 scope fit — BaseImageView vs. AVGrid/List/ComboSelect

**Concern:** EPIC-025 Phase 5 names AVGrid, List, and ComboSelect as the canonical adopt-in-place candidates. BaseImageView is a viewport, not a virtualized data widget. Does the same phase apply?

**Resolution:** Yes. EPIC-025's Note from 2026-04-26 reframed Phase 5 as "a rule applied during Phase 4: when a screen contains AVGrid / List / ComboSelect, those components are adopted in place, while the rest of the screen migrates to UIKit." The general principle is: *complex / internally-stateful components are adopted in place rather than rewritten*. BaseImageView qualifies on every dimension that motivates that rule:

- **Internal state.** `ImageViewModel` owns `scale`, `translateX/Y`, `isDragging`, `dragStartX/Y`, `imageWidth/Height`, `fitScale` — nine fields with non-trivial coupling.
- **Custom DOM event handling.** Native non-passive `wheel` listener, mouse drag protocol, container-relative coordinate math for zoom-toward-cursor, window resize handling, visibility-tracked re-fit.
- **Multiple consumers.** ImageViewer, SvgView, MermaidView each rely on the exact ref API and visual behavior. A rewrite multiplies regression risk across three editors.
- **Recently audited** — refactor was non-trivial (see commit history); a redo is unnecessary.

The applicable Phase 5 patterns are exactly the two that fit: `data-type` + `data-*` state attributes (yes — directly applicable), and (secondarily) token adoption (low-risk consistency win since every value is an exact match). Roving tabindex and trait integration do not apply (no focusable children, no list prop) and are correctly skipped.

### 2. CSS-class state → data-attribute state — naming choice (`data-dragging` vs. `data-state="dragging"`)

**Concern:** The UIKit `data-*` table in [`uikit/CLAUDE.md`](../../../src/renderer/uikit/CLAUDE.md#standard-state-attributes) lists `data-state="open"|"closed"` as a multi-value pattern. Should drag state use `data-state="dragging"|"idle"`?

**Resolution:** Use `data-dragging` (boolean, present/absent). The `data-state` pattern fits **finite enum** state with three or more meaningful values (e.g. open/closed/loading). Drag is a **two-state boolean** — present-or-absent attribute is the cleaner shape, matches `data-disabled` / `data-selected` / `data-active` precedent in the same table, and is what the existing `cursor: grab` baseline + `cursor: grabbing` override already implies. Pass `state.isDragging || undefined` (per Rule 1: "Pass `undefined` (not `false`) when a boolean attribute is inactive — `data-disabled='false'` still matches `[data-disabled]`").

### 3. Removing the `can-drag` class — behavior preservation

**Concern:** Today `className={\`${state.isDragging ? "dragging" : ""} can-drag\`}` always appends `can-drag`. Removing it without setting `cursor: grab` somewhere else would break the cursor.

**Resolution:** Move `cursor: grab` into the base styled-rule block. The `&[data-dragging]` selector then overrides it to `cursor: grabbing` exactly when dragging — same end-state as before. No conditional className needed.

### 4. `data-part="zoom-indicator"` vs. keeping `.zoom-indicator` className

**Concern:** Is this conversion required, or just a stylistic preference?

**Resolution:** Required for consistency with UIKit precedent. [`IconButton`](../../../src/renderer/uikit/IconButton/IconButton.tsx) uses `<span data-part="icon">` and selector `& [data-part='icon']`; [`Checkbox`](../../../src/renderer/uikit/Checkbox/Checkbox.tsx) does the same. The `data-part` convention is part of the UIKit pattern even though it isn't called out as a *rule* (Rule 1 calls out `data-type` for the root and `data-*` for state). Adopting it here keeps BaseImageView legible to the same DevTools / scripting patterns the UIKit components use, with zero behavior change.

### 5. Tokens — out of explicit Phase 5 scope?

**Concern:** Phase 5's bullet list mentions data attributes, roving tabindex, traits — not tokens. Should token adoption wait?

**Resolution:** Bundle it. Three reasons:
- **Exact-match values.** All five hardcoded pixels (12, 4, 8, 4, 12) match tokens exactly. Zero visual risk.
- **Proximity.** All token replacements live in the same `BaseImageViewRoot` rule we're already rewriting for the `&[data-dragging]` / `[data-part='zoom-indicator']` selector swap. Splitting them into a follow-up task means re-touching the same lines twice.
- **EPIC consistency goal.** EPIC-025's stated goal is "Consistent styling across the entire application through shared design tokens and layout primitives". Leaving the only-non-UIKit file in the image stack with hardcoded pixels works against that goal for no benefit.

If the user prefers a stricter Phase-5 reading (data attributes only, defer tokens), the Step 1 + token replacements in Step 2 can be omitted and the rest of the plan still stands.

### 6. Where should `BaseImageView` live — `uikit/`, `editors/image/`, `editors/base/`, or `editors/shared/`?

**Concern:** The file is currently at `editors/image/BaseImageView.tsx`, but it is shared by three editors (ImageViewer, SvgView, MermaidView). The image-editor folder is no longer the right home semantically. Possible alternatives:

- **`src/renderer/uikit/`** — UIKit primitive
- **`src/renderer/editors/base/`** — editor framework primitive
- **`src/renderer/editors/shared/`** — shared editor presentational helper
- **Leave at `editors/image/`** — status quo

**Resolution:** Move to **`src/renderer/editors/shared/`**.

- **Not `uikit/`.** Phase 5 explicitly says "**adopt in place — no rewrite**". Moving into `uikit/` triggers Rule 7 (no Emotion / `style=` / `className=` in app code) on the three consumers and on the file's own internals — that scope of change is rewrite-shaped, not adoption-shaped. UIKit also implies eventual integration with the ComponentSet / descriptor pattern, which has no use case for a single-purpose image viewport. The right time to consider this move (if at all) is after EPIC-025 Phase 4 finishes and screens are settled.
- **Not `editors/base/`.** The `editors/base/` folder holds **architectural primitives** that editors *extend* or that *constitute the editor framework* — `EditorModel` (base class), `ContentViewModel` (base class), `ContentViewModelHost` (host machinery), `EditorToolbar` (legacy toolbar primitive used by every editor's chrome), `EditorConfigContext` / `EditorStateStorageContext` (DI/context plumbing), `IContentHost` (interface), `useContentViewModel` (hook). `BaseImageView` is none of these — no editor extends it; it is composed via JSX and exposes a ref.
- **Not `editors/image/`.** Status quo is incorrect: `editors/image/` is the namespace for the binary-image editor type. SvgView and MermaidView importing through `from "../image"` is a leaky path — it implies dependency on the image-editor bundle, when in reality they need only a self-contained presentational helper.
- **Yes — `editors/shared/`.** Existing inhabitants of this folder are [`ColorizedCode.tsx`](../../../src/renderer/editors/shared/ColorizedCode.tsx) (a Monaco-colorization React component composed by `markdown/CodeBlock`, `log-view/items/McpRequestView`, etc.) and [`link-open-menu.tsx`](../../../src/renderer/editors/shared/link-open-menu.tsx) (a menu-item helper composed by `link-editor/PinnedLinksPanel`, `markdown/MarkdownBlock`, `content/tree-context-menus`). Both are *self-contained, framework-neutral, multi-editor presentational helpers* — exactly the shape `BaseImageView` has. Direct file imports (no barrel) is the established convention; this task follows it.

The relocation is folded into the scope of this task because: (a) the data-attribute / token edits already require a content rewrite of `BaseImageView.tsx`, so handling the move at the same time is one focused pass; (b) the Files Changed surface (3 consumer imports + 1 barrel cleanup + 2 vestigial re-export deletions) is small and mechanical; (c) leaving the move for later means SvgView/MermaidView keep their leaky `from "../image"` imports until then.

### 7. Replacing the zoom indicator with a UIKit Button/IconButton?

**Concern:** The zoom indicator is a clickable element. Should it become a UIKit primitive?

**Resolution:** No. (a) It displays a numeric label (`100%`), not an icon — wrong fit for `IconButton`. (b) It uses absolute positioning relative to the viewport — UIKit `Button` has its own intrinsic layout. (c) The current implementation has custom `monospace` font, custom overlay background, custom hover behavior — replacing it requires either prop-extending Button or accepting a visual change. Neither is justified for an adopt-in-place task. Switching to `data-part="zoom-indicator"` + tokens is the correct adopt-in-place treatment.

### 8. Side-effect on `BaseImageViewRoot` external consumers

**Concern:** `BaseImageViewRoot` is exported (line 11). Could anyone outside this file rely on the `.dragging` / `.can-drag` / `.zoom-indicator` class names?

**Resolution:** No external consumers. Verified by grep across `src/`:
- `BaseImageViewRoot` is referenced only inside `BaseImageView.tsx` itself.
- The `.dragging` / `.can-drag` / `.zoom-indicator` class strings appear nowhere else in the codebase.

The export remains in place (no API removal) but the internal class-based state pattern is private and safe to convert.

## Acceptance Criteria

1. The file lives at [`src/renderer/editors/shared/BaseImageView.tsx`](../../../src/renderer/editors/shared/BaseImageView.tsx). The old path `src/renderer/editors/image/BaseImageView.tsx` no longer exists. `git log --follow` on the new path shows the prior history.
2. No `index.ts` is added to `editors/shared/` — direct file imports remain the convention.
3. `<BaseImageViewRoot>` root element renders with `data-type="image-view"`.
4. `data-dragging` attribute is present iff `state.isDragging === true` (toggles in real time).
5. The `className` prop on `<BaseImageViewRoot>` is removed; no `dragging` / `can-drag` strings remain anywhere in the file.
6. The zoom-indicator `<div>` has `data-part="zoom-indicator"` and no `className`. The styled selector targets `[data-part='zoom-indicator']`.
7. `BaseImageViewRoot` styled rule uses `spacing.lg`, `spacing.sm`, `spacing.md`, `radius.md`, `fontSize.sm` for the formerly hardcoded `12 / 4 / 8 / 4 / 12` values. No raw `12` / `4` / `8` literals remain in the styled object.
8. `BaseImageViewRoot` styled rule includes `{ label: "BaseImageViewRoot" }` as the second argument.
9. `BaseImageView` JSX render structure is unchanged: same `<BaseImageViewRoot>` → `<img>` + `<div data-part="zoom-indicator">` shape.
10. `BaseImageViewRef`, `BaseImageViewProps`, `ImageViewModel`, `defaultImageViewState`, `ImageViewState` exports unchanged in shape and types.
11. [`editors/image/ImageViewer.tsx`](../../../src/renderer/editors/image/ImageViewer.tsx) imports `BaseImageView` and `BaseImageViewRef` from `../shared/BaseImageView`. The vestigial bottom-of-file re-exports (`export { BaseImageView, ImageViewModel, … } from "./BaseImageView"`) are removed. JSX usage and runtime behavior unchanged.
12. [`editors/image/index.ts`](../../../src/renderer/editors/image/index.ts) no longer re-exports `BaseImageView` / `ImageViewModel` / `defaultImageViewState` / `BaseImageViewRef` / `BaseImageViewProps` / `ImageViewState`.
13. [`editors/svg/SvgView.tsx`](../../../src/renderer/editors/svg/SvgView.tsx) and [`editors/mermaid/MermaidView.tsx`](../../../src/renderer/editors/mermaid/MermaidView.tsx) import from `../shared/BaseImageView`, not from `../image`.
14. `Grep "BaseImageView"` across `src/` returns only references to `editors/shared/BaseImageView` (definition + 3 consumers). No `editors/image/BaseImageView` or `from "../image"` (for BaseImageView) references remain.
15. `npx tsc --noEmit` shows no new errors filtered to `BaseImageView` / `editors/image` / `editors/svg` / `editors/mermaid` / `editors/shared`.
16. Visual smoke (ImageViewer / SvgView / MermaidView): cursor = grab idle / grabbing during drag; zoom indicator at bottom-right shows percent, hover background change, click resets; mouse wheel zoom-toward-cursor; `+ / - / 0` keys; `Ctrl+C` copies the image; double-click resets the view.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/image/BaseImageView.tsx` → `src/renderer/editors/shared/BaseImageView.tsx` | **Move** (`git mv`). Then in the new location: add `tokens` import; rewrite `BaseImageViewRoot` styled rule (cursor base, `&[data-dragging]`, `[data-part='zoom-indicator']`, tokens, label); add `data-type` + `data-dragging` to root; replace `className="zoom-indicator"` with `data-part="zoom-indicator"`. |
| [`src/renderer/editors/image/ImageViewer.tsx`](../../../src/renderer/editors/image/ImageViewer.tsx) | Repoint two imports (lines 13–14) from `./BaseImageView` to `../shared/BaseImageView`. Remove vestigial bottom-of-file re-exports (lines 342–343 + leading comment). JSX unchanged. |
| [`src/renderer/editors/image/index.ts`](../../../src/renderer/editors/image/index.ts) | Remove the BaseImageView re-export block (lines 5–7). Remaining exports for `ImageViewer` / `ImageEditorModel` / types unchanged. |
| [`src/renderer/editors/svg/SvgView.tsx`](../../../src/renderer/editors/svg/SvgView.tsx) | Repoint two imports (lines 3–4) from `../image` to `../shared/BaseImageView`. JSX unchanged. |
| [`src/renderer/editors/mermaid/MermaidView.tsx`](../../../src/renderer/editors/mermaid/MermaidView.tsx) | Same two-line import repoint as SvgView. JSX unchanged. |

## Files NOT Changed

- [`src/renderer/uikit/tokens.ts`](../../../src/renderer/uikit/tokens.ts) — already has every value used; no additions.
- [`src/renderer/uikit/CLAUDE.md`](../../../src/renderer/uikit/CLAUDE.md) — `BaseImageView` lives outside `uikit/`; CLAUDE.md is informative reference, not edited.
- [`src/renderer/editors/base/index.ts`](../../../src/renderer/editors/base/index.ts) — `BaseImageView` does not belong in `editors/base/` (see Concern §6); no changes here.
- No new `src/renderer/editors/shared/index.ts` is created — folder convention is direct file imports.
