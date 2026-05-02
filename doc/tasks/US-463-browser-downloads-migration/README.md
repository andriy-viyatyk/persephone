# US-463: BrowserDownloadsPopup + DownloadButton — UIKit migration

## Goal

Migrate the browser's download UI to a pure UIKit composition AND restructure the popup as an **encapsulated single-module imperative API** following the [`showPopupMenu` pattern](../../../src/renderer/ui/dialogs/poppers/showPopupMenu.tsx).

Two files in scope:

- [src/renderer/editors/browser/DownloadButton.tsx](../../../src/renderer/editors/browser/DownloadButton.tsx) — toolbar button with circular progress ring. After: exports `DownloadButton` (no props — fully self-contained); on click, calls the imperative show function from the popup module.
- [src/renderer/editors/browser/BrowserDownloadsPopup.tsx](../../../src/renderer/editors/browser/BrowserDownloadsPopup.tsx) — the popup. After: exports **only** `showDownloadsPopup(anchor): Promise<void>` and `closeDownloadsPopup(): void`. Internal: `DownloadsPopupModel` (extends [`TPopperModel`](../../../src/renderer/ui/dialogs/poppers/types.ts)), the popup view (uses UIKit `Popover` from US-466), the `Views.registerView` call. No JSX component is exported — the popup is mounted by the global [`<Poppers/>`](../../../src/renderer/ui/dialogs/poppers/Poppers.tsx) registry when `showDownloadsPopup` is called.

After this task:

- Neither file imports `@emotion/styled`; neither uses `style=` or `className=` on UIKit components.
- Both express layout entirely through `Panel` / `Text` / `Button` / `IconButton` / `Spacer` plus the new UIKit `Popover` (from US-466).
- Two small UIKit extensions added: `IconButton.active` and `Text.truncate` — both reusable.
- [`BrowserEditorView.tsx`](../../../src/renderer/editors/browser/BrowserEditorView.tsx) loses the `downloadsAnchor` state, the `handleDownloadClick` / `handleDownloadsClose` handlers, and the `<BrowserDownloadsPopup …/>` JSX render. It just renders `<DownloadButton/>` in the toolbar; the rest is encapsulated.
- Two raw-element exceptions remain (raw `<svg>` for the progress ring, raw `<div>` for the 3px progress bar) — leaf decorative content, allowed by Rule 7 (which restricts only UIKit-component composition, not raw HTML/SVG).

This task is **blocked on US-466** (UIKit Popover) — the popup view uses UIKit `Popover` directly.

## Background

### EPIC-025 Phase 4 context

Per-screen migration loop (from [EPIC-025](../../epics/EPIC-025.md) Phase 4):

1. Pick a screen
2. Audit which UIKit components are needed and which are missing
3. Build missing components / prop extensions in Storybook first
4. Rewrite the screen with UIKit
5. Smoke-test the screen

Recent precedents:

- [US-462 TorStatusOverlay](../US-462-tor-status-overlay-migration/README.md) — added `Spinner.color` and `Panel.whiteSpace` / `Panel.wordBreak` / `Panel.alignSelf`, rewrote the overlay to a pure Panel composition. Also established the precedent of using a UIKit IconButton's native `title="..."` attribute for tooltips instead of importing the legacy react-tooltip-based `Tooltip` for a single button.
- [US-461 Shared FindBar](../US-461-shared-findbar-consolidation/README.md), [US-460 MarkdownSearchBar](../US-460-markdown-search-bar-migration/README.md) — added `top` / `right` / `bottom` / `left` to Panel; rewrote floating search bars.
- [US-455 MermaidView](../US-455-mermaid-view-migration/README.md) — added `position` / `inset` / `zIndex` to Panel.

### Why this pair of files together

`DownloadButton` and `BrowserDownloadsPopup` are the two halves of a single feature — the toolbar entry point and the popover it opens. They share a single state source ([downloads.ts](../../../src/renderer/api/downloads.ts)), the same icons, and parallel button/text patterns. Migrating them together keeps the rewrite consistent and lets one set of UIKit extensions cover both.

### Encapsulation pattern (the architectural change)

The migration is not just a styling rewrite — it also restructures the popup's lifecycle ownership. **Before**: `BrowserEditorView` owned `downloadsAnchor` state, supplied open/close handlers, and rendered `<BrowserDownloadsPopup anchorEl={…} onClose={…}/>` conditionally in JSX. **After**: nothing about the popup leaks to the caller. The popup mounts itself via the global `<Poppers/>` registry when `showDownloadsPopup(anchor)` is called.

This mirrors the established Persephone pattern (see [`showPopupMenu.tsx`](../../../src/renderer/ui/dialogs/poppers/showPopupMenu.tsx)):

1. **Model** — a class extending `TPopperModel<TState, TResult>` carries the popup's state and resolution type. `TPopperModel.position` is `PopperPosition`, which is structurally compatible with UIKit `PopoverPosition` (see [US-466 concern #10](../US-466-uikit-popover/README.md) — same field names: `elementRef`, `x`, `y`, `placement`, `offset`).
2. **View** — a React component that consumes the model and renders the popup body wrapped in a `<Popover>`. The `<Popover>` is positioned via `{...model.position}` spread.
3. **Registration** — `Views.registerView(viewId, ViewComponent)` registers the view at module load, once. The global `<Poppers/>` component (mounted in [index.tsx](../../../src/renderer/index.tsx)) renders any registered view whose model has been pushed to the popper state.
4. **Imperative API** — the module exports `showDownloadsPopup(anchor): Promise<void>` (and `closeDownloadsPopup(): void`). The show function builds the model, sets `model.position.elementRef = anchor`, calls `showPopper({ viewId, model })`, and returns the promise that resolves when the model closes (click-outside, Escape, or explicit close).

Why this is worth doing now (rather than as a separate refactor):

- **Same scope as the styling migration anyway.** Once the popup body is wrapped in `<Popover>`, putting that component inside a `TPopperModel`-driven view costs <30 extra lines.
- **Removes ambient state from `BrowserEditorView`.** That file is already 800+ lines; not having to manage `downloadsAnchor` state is a real simplification, not a cosmetic one.
- **Carries forward to other browser-toolbar popups** (URL suggestions, page menu, bookmarks dropdown) when their migrations land — the pattern is reusable.
- **Documents the position-shape compatibility from US-466 in real code.** Until a UIKit consumer uses `model.position` against a `<Popover>`, that compatibility is theoretical.

### Current implementation (file bodies)

#### `DownloadButton.tsx` — 125 lines

Renders a 24×24 button with a 16×16 download icon. When at least one download is active, a 22×22 circular progress ring is drawn over the icon (two SVG circles — gray track + accent fill driven by `strokeDashoffset`). The button's `.active` className darkens the icon to `color.icon.active` while downloading. A tooltip ("Downloads") is attached via react-tooltip's `data-tooltip-id` mechanism.

Key shape:

```tsx
const DownloadButtonRoot = styled.button({
    display: "flex", alignItems: "center", justifyContent: "center",
    position: "relative",
    width: 24, height: 24,
    padding: 0, border: "none", borderRadius: 6,
    backgroundColor: "transparent", cursor: "pointer", outline: "none",
    "& svg.download-icon": { width: 16, height: 16, color: color.icon.light },
    "&:hover svg.download-icon":  { color: color.icon.default },
    "&:active svg.download-icon": { color: color.icon.dark },
    "&.active svg.download-icon": { color: color.icon.active },
    "& .progress-ring":     { position: "absolute", top: 1, left: 1, width: 22, height: 22, pointerEvents: "none" },
    "& .progress-ring-bg":  { fill: "none", stroke: color.border.light,  strokeWidth: 1.5 },
    "& .progress-ring-fg":  { fill: "none", stroke: color.border.active, strokeWidth: 1.5,
                              strokeLinecap: "round", transform: "rotate(-90deg)", transformOrigin: "center",
                              transition: "stroke-dashoffset 0.3s ease" },
});
```

#### `BrowserDownloadsPopup.tsx` — 224 lines

Floating popup anchored to the toolbar's download button. A 320px-wide column with three regions:

1. **Header** — title "Downloads" + (when any non-active downloads exist) a "Clear" button. 1px bottom border.
2. **List** — scrollable area, max-height 400; each item shows filename (truncated), status text (bytes/state), an inline 3px progress bar while downloading, an error message on failure, and per-status action buttons (Cancel / Open / Show in Folder / Dismiss).
3. **Empty state** — "No downloads" centered when the list is empty.

Key shape:

```tsx
const PopupContent = styled.div({
    width: 320, display: "flex", flexDirection: "column",
    "& .downloads-header":        { display: "flex", alignItems: "center", padding: "8px 12px",
                                    borderBottom: `1px solid ${color.border.light}`,
                                    "& .downloads-title": { flex: 1, fontSize: 13, fontWeight: 600, color: color.text.default } },
    "& .downloads-list":          { overflow: "auto", maxHeight: 400 },
    "& .download-item":           { display: "flex", flexDirection: "column", padding: "8px 12px", gap: 4,
                                    borderBottom: `1px solid ${color.border.light}`,
                                    "&:last-child": { borderBottom: "none" } },
    "& .download-row":            { display: "flex", alignItems: "center", gap: 8 },
    "& .download-filename":       { flex: 1, fontSize: 13, color: color.text.default,
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    "& .download-status":         { fontSize: 12, color: color.text.light, whiteSpace: "nowrap" },
    "& .download-progress-bar":   { height: 3, borderRadius: 2, backgroundColor: color.border.light, overflow: "hidden",
                                    "& .download-progress-fill": { height: "100%", borderRadius: 2,
                                                                   backgroundColor: color.border.active,
                                                                   transition: "width 0.3s ease" } },
    "& .download-actions":        { display: "flex", gap: 4, "& button": { fontSize: 12, padding: "1px 6px" } },
    "& .download-error":          { fontSize: 12, color: color.error.text },
    "& .downloads-empty":         { padding: "24px 12px", textAlign: "center", fontSize: 13, color: color.text.light },
});
```

The popup is rendered inside the legacy [Popper](../../../src/renderer/components/overlay/Popper.tsx) — floating-ui–driven anchored overlay with click-outside dismissal — and uses the legacy [Button](../../../src/renderer/components/basic/Button.tsx) for all action buttons.

### Audit results

#### `DownloadButton.tsx` — element by element

| Old element | UIKit replacement | Gap |
|---|---|---|
| `DownloadButtonRoot` `<button>` 24×24, transparent bg, padding 0, borderRadius 6 | UIKit `IconButton size="sm"` (24×24 wrapper, 16×16 icon, transparent bg, borderRadius 3) | borderRadius drift 6 → 3 (mild). |
| Hover/active CSS → icon color cycles `light` / `default` / `dark` | Built into IconButton's styled rules | none |
| `.active` class → icon color `color.icon.active` while downloading | **No `active` prop on IconButton today** | **Add `IconButton.active?: boolean` → `data-active` → `color.icon.active`.** |
| Outer wrapper for ring + button | UIKit `<Panel position="relative">` containing IconButton + raw `<svg>` overlay | none |
| Tooltip "Downloads" via react-tooltip `data-tooltip-id` | UIKit IconButton's native `title="Downloads"` (HTML title attribute) | Same drift as US-462 close button. Different hover delay, no styled bubble. Acceptable — the toolbar will be migrated holistically later. |
| `<svg className="progress-ring">` with two `<circle>`s | Raw `<svg>` child inside the wrapping Panel; positioning via inline `style` (allowed on raw SVG, not a UIKit component) | none — Rule 7 only forbids `style=` on UIKit components. |
| `useRef<HTMLButtonElement>` to capture the anchor for the popup | `useRef<HTMLButtonElement>` forwarded into IconButton (already supports `ref` via `forwardRef`) | none |

#### `BrowserDownloadsPopup.tsx` — element by element

| Old element | UIKit replacement | Gap |
|---|---|---|
| `Popper open … placement="bottom-end" offset={[0,4]} onClose` | UIKit `<Popover open elementRef={…} placement="bottom-end" offset={[0,4]} onClose={…}>` (from US-466). Inside a `DownloadsPopupView` that consumes `model.position`. | none — depends on US-466 landing first. |
| `PopupContent` styled.div — width 320, flex column | `<Panel direction="column" width={320}>` | none |
| `.downloads-header` — flex row, align center, padding 8px/12px, borderBottom | `<Panel direction="row" align="center" paddingX="lg" paddingY="md" borderBottom>` | `paddingX="lg"` = 12 (matches), `paddingY="md"` = 8 (matches). `borderBottom` defaults to subtle (`color.border.light`) — matches. |
| `.downloads-title` — flex 1, fontSize 13, fontWeight 600 + Spacer-like effect | `<Text size="md" bold>Downloads</Text>` then `<Spacer />` to push Clear right | `size="md"` = 13 (matches), `bold` = font-weight 600 (matches). |
| `<Button size="small" type="flat">Clear</Button>` | `<Button size="sm" variant="ghost">Clear</Button>` | UIKit ghost button matches "flat" — transparent bg, hover `color.background.light`. Drift in hover behavior is mild and consistent with US-462. |
| `.downloads-list` — overflow auto, maxHeight 400 | `<Panel direction="column" overflowY="auto" maxHeight={400}>` | none |
| `.download-item` — column, padding 8/12, gap 4, borderBottom (none on last) | `<Panel direction="column" paddingY="md" paddingX="lg" gap="sm" borderBottom={!isLast} title={...}>` | `gap="sm"` = 4 (matches). Last-item border handled by passing `borderBottom={index < list.length - 1}` from parent loop. |
| `.download-row` — flex row, align center, gap 8 | `<Panel direction="row" align="center" gap="md">` | `gap="md"` = 6 (drift: 8 → 6, acceptable). |
| `.download-filename` — flex 1, fontSize 13, overflow hidden, text-overflow ellipsis, white-space nowrap | `<Panel flex overflow="hidden"><Text truncate size="md">{filename}</Text></Panel>` | **`Text.truncate?: boolean` missing today.** Add it: `display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0`. Reusable wherever a Text inside a flex child needs ellipsis. |
| `.download-status` — fontSize 12, color light, whiteSpace nowrap | `<Text size="sm" color="light" nowrap>{statusText}</Text>` | `size="sm"` = 12 (matches). |
| `.download-progress-bar` — 3px track, radius 2, color.border.light bg, overflow hidden, with inner fill (height 100%, radius 2, color.border.active bg, transition width 0.3s) | Raw `<div style={{...}}>` track + `<div style={{...}}>` fill (leaf decorative element, not UIKit composition) | Pragmatic exception. UIKit Panel can't carry an arbitrary background color (only `default/light/dark/overlay`); promoting a 3px progress bar to UIKit `ProgressBar` is meaningful but out of scope here. Documented and accepted. |
| `.download-error` — fontSize 12, color error | `<Text size="sm" color="error">{error}</Text>` | none |
| `.download-actions` — flex row, gap 4, button fontSize 12, padding 1/6 | `<Panel direction="row" gap="sm">` containing `<Button size="sm" variant="ghost">…</Button>` and `<IconButton size="sm" title="…" icon={…}/>` | `gap="sm"` = 4 (matches). UIKit Button size="sm" fontSize 12 (matches). Padding drift on the buttons is mild — UIKit Button has `padding: 0 4px`, legacy was `1px 6px`. |
| `.downloads-empty` — padding 24/12, textAlign center, fontSize 13, color light | `<Panel paddingY="xxl" paddingX="lg" align="center" justify="center"><Text size="md" color="light">No downloads</Text></Panel>` | `paddingY="xxl"` = 24 (matches), `paddingX="lg"` = 12 (matches). Centering via flex (no `text-align`). |

### UIKit extensions added in this task

Two minimal additions, both reusable beyond this screen.

#### 1. `IconButton.active?: boolean`

Add an optional highlighted-state flag to [IconButton.tsx](../../../src/renderer/uikit/IconButton/IconButton.tsx). Implementation:

```tsx
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    icon: React.ReactNode;
    size?: "sm" | "md";
    /** Highlighted/toggled state. When true, icon stroke uses `color.icon.active` (overrides hover/press feedback). */
    active?: boolean;
}

const Root = styled.button(
    {
        // …existing rules…
        "&:hover":  { color: color.icon.default },
        "&:active": { color: color.icon.dark },
        '&[data-size="sm"]': { /*…*/ },
        '&[data-size="md"]': { /*…*/ },
        "&[data-active]":   { color: color.icon.active },
        "&[data-disabled]": { color: color.icon.disabled, pointerEvents: "none" },
    },
    { label: "IconButton" },
);

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
    function IconButton({ icon, size = "md", active, disabled, ...rest }, ref) {
        return (
            <Root
                ref={ref}
                data-type="icon-button"
                data-size={size}
                data-active={active || undefined}
                data-disabled={disabled || undefined}
                disabled={disabled}
                type="button"
                {...rest}
            >
                <span data-part="icon">{icon}</span>
            </Root>
        );
    },
);
```

CSS rule order matters: `&[data-active]` is declared **after** `&:hover` and `&:active` so that — when the button is highlighted (`data-active`) — that color wins over the hover/press feedback. This matches legacy behavior where `.active` overrode hover/active. `&[data-disabled]` is declared last so disabled wins over everything.

The `data-active` attribute also matches the UIKit data-attribute convention (see uikit/CLAUDE.md: `data-active` = "item is focused / highlighted"). Distinct from CSS `:active` (mouse-pressed pseudo-class).

Why a dedicated prop and not an explicit `iconColor`: a single boolean models the toggle/highlighted concept cleanly and matches legacy semantics. A future toolbar toggle button (e.g. "Wrap" word-wrap on/off) can use the same prop.

#### 2. `Text.truncate?: boolean`

Add an optional ellipsis-truncation flag to [Text.tsx](../../../src/renderer/uikit/Text/Text.tsx). Implementation:

```tsx
export interface TextStyleProps {
    // …existing fields…
    /** Truncate with ellipsis. Sets `display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0`. Wrap in a flex parent (e.g. `<Panel flex overflow="hidden">`) to make the ellipsis kick in. */
    truncate?: boolean;
}

const Root = styled.span(
    {
        // …existing rules…
        "&[data-truncate]": {
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
        },
    },
    { label: "Text" },
);

export function Text({ /* …existing… */, truncate, ... }: TextProps) {
    return (
        <Root
            // …existing data-* …
            data-truncate={truncate || undefined}
            {...rest}
        >
            {children}
        </Root>
    );
}
```

`min-width: 0` is the magic detail: without it, a flex child has `min-width: auto` (= content size), which prevents the parent's `overflow: hidden` from clipping. Setting `min-width: 0` on the truncated Text lets it shrink and produce the ellipsis.

Why a `truncate` prop on Text and not a separate `TruncatedText` component (per the US-438 naming table): `TruncatedText` (formerly `OverflowTooltipText`) is intended to also show a tooltip when the text is actually truncated. That requires width measurement and ResizeObserver — meaningful complexity. A simple ellipsis prop on Text covers 80% of cases without the tooltip layer. When `TruncatedText` is built later, it can wrap or compose `Text truncate` internally.

### Popover — UIKit (from US-466), Tooltip — legacy dropped

`Popper` is replaced by the UIKit `Popover` built in [US-466](../US-466-uikit-popover/README.md). `BrowserDownloadsPopup.tsx` now imports `Popover` from `../../uikit` and the legacy `components/overlay/Popper.tsx` is no longer referenced from this file.

`Tooltip` (react-tooltip wrapper at [components/basic/Tooltip.tsx](../../../src/renderer/components/basic/Tooltip.tsx)) is dropped from `DownloadButton.tsx` entirely — replaced by `IconButton title="Downloads"` (native HTML tooltip), matching the [US-462 close button](../US-462-tor-status-overlay-migration/README.md) precedent. UIKit Tooltip is a future task ([US-467 placeholder](../../active-work.md)) that will normalize tooltip styling toolbar-wide.

### Rule 7 boundary recap

[uikit/CLAUDE.md Rule 7](../../../src/renderer/uikit/CLAUDE.md) forbids in app code:

1. `import styled from "@emotion/styled"` (absolute)
2. `import { css } from "@emotion/css"` (absolute)
3. `style={…}` on a UIKit component
4. `className={…}` on a UIKit component

It does **not** forbid:

- `style={…}` on raw HTML elements (`<div style={{…}}>`)
- `style={…}` on raw SVG elements (`<svg style={{…}}>`, `<circle style={{…}}>`)
- importing `color` from `theme/color.ts` (still required for raw elements)

Both files after migration contain no Emotion imports and no `style=`/`className=` on UIKit components. They contain a small amount of `style=` on raw `<svg>` (DownloadButton's progress ring) and raw `<div>` (BrowserDownloadsPopup's 3px progress bar) — both compliant with Rule 7.

### Visual drift accepted in the migration

| Drift | Old | New | Reason |
|---|---|---|---|
| DownloadButton borderRadius | 6 | 3 (`radius.sm` via IconButton) | UIKit IconButton standard. 3px difference is barely visible at 24×24. |
| DownloadButton tooltip | react-tooltip with delay/styling | native HTML `title` attribute | Same drift as US-462 close button. Toolbar will be migrated wholesale later. |
| Popup row gap | 8px | 6px (`gap="md"`) | Closest token. 2px tighter — visually neutral. |
| Action-button padding | `1px 6px` | UIKit Button `0 4px` | UIKit standard for `size="sm"`. |
| Action-button hover background | legacy flat hover | UIKit ghost variant hover (`color.background.light`) | Variant matches behaviorally; subtle background tint on hover. |
| Empty-state alignment | `text-align: center` | flex `align="center" justify="center"` | Same visual result. |
| Last-item border | suppressed via `:last-child` | suppressed via `borderBottom={!isLast}` from parent loop | Same visual result, JSX-driven. |

### Files involved

| File | Role | Change |
|------|------|--------|
| [src/renderer/uikit/IconButton/IconButton.tsx](../../../src/renderer/uikit/IconButton/IconButton.tsx) | IconButton primitive | Add optional `active?: boolean` prop |
| [src/renderer/uikit/IconButton/IconButton.story.tsx](../../../src/renderer/uikit/IconButton/IconButton.story.tsx) | IconButton story | Add an `active` prop entry |
| [src/renderer/uikit/Text/Text.tsx](../../../src/renderer/uikit/Text/Text.tsx) | Text primitive | Add optional `truncate?: boolean` prop |
| [src/renderer/uikit/Text/Text.story.tsx](../../../src/renderer/uikit/Text/Text.story.tsx) | Text story (if it exists; create if not) | Add a `truncate` prop entry |
| [src/renderer/editors/browser/DownloadButton.tsx](../../../src/renderer/editors/browser/DownloadButton.tsx) | Toolbar button with progress ring | **Rewrite** — drop `@emotion/styled`, drop legacy `Tooltip`, **drop the `onClick` prop** (button is now self-contained: clicks call `showDownloadsPopup` internally and toggle on repeat click); use Panel + IconButton (with `active`) + raw `<svg>` ring |
| [src/renderer/editors/browser/BrowserDownloadsPopup.tsx](../../../src/renderer/editors/browser/BrowserDownloadsPopup.tsx) | Encapsulated downloads popup module | **Rewrite as imperative API** — exports only `showDownloadsPopup(anchor): Promise<void>` and `closeDownloadsPopup(): void`. Internal: `DownloadsPopupModel` (extends `TPopperModel`), `DownloadsPopupView` (UIKit composition wrapped in `<Popover>`), `Views.registerView(downloadsPopupId, …)`. No JSX component exported. |
| [src/renderer/editors/browser/BrowserEditorView.tsx](../../../src/renderer/editors/browser/BrowserEditorView.tsx) | Browser editor host | Remove `downloadsAnchor` state, `handleDownloadClick`, `handleDownloadsClose`, the `<BrowserDownloadsPopup …/>` JSX render, and the `BrowserDownloadsPopup` import. Change `<DownloadButton onClick={…}/>` to `<DownloadButton/>`. |
| [doc/active-work.md](../../active-work.md) | Dashboard | Convert US-463 line to a markdown link to this README |

### Files NOT changed

- `downloads.ts` — model/state unchanged.
- `palette-colors.ts`, `language-icons.tsx` — not consumed by these files.
- `components/basic/Tooltip.tsx`, `components/overlay/Popper.tsx`, `components/basic/Button.tsx` — still used by other screens; only these two files' imports change.
- `theme/icons.tsx` (`DownloadIcon`, `CloseIcon`, `FolderOpenIcon`) — used as-is.
- `api/types/downloads.ts`, `ipc/api-param-types` (`DownloadEntry`) — unchanged.
- `ui/dialogs/poppers/Poppers.tsx`, `types.ts` — `TPopperModel`, `showPopper`, `closePopper` are reused as-is. The position prop on `TPopperModel` is `PopperPosition` which is structurally compatible with UIKit `PopoverPosition` (see [US-466 concern #10](../US-466-uikit-popover/README.md)) — no adapter layer needed.
- `core/state/state.ts` (`TComponentState`), `core/state/view.ts` (`Views`, `DefaultView`, `ViewPropsRO`) — used as-is.

## Implementation plan

### Step 1 — Extend `IconButton` with `active` prop

[src/renderer/uikit/IconButton/IconButton.tsx](../../../src/renderer/uikit/IconButton/IconButton.tsx):

- Add `active?: boolean` to `IconButtonProps`.
- Destructure in the component body (after `disabled`).
- Pass `data-active={active || undefined}` on `<Root>`.
- Add `'&[data-active]': { color: color.icon.active }` to the styled rules — placed **after** `&:hover` / `&:active` / size selectors and **before** `&[data-disabled]`.

### Step 2 — Update `IconButton.story.tsx`

Add an `active` boolean entry alongside `size`. Confirm the prop appears in Storybook editor and toggling it switches the icon color.

### Step 3 — Extend `Text` with `truncate` prop

[src/renderer/uikit/Text/Text.tsx](../../../src/renderer/uikit/Text/Text.tsx):

- Add `truncate?: boolean` to `TextStyleProps`.
- Destructure in the component body.
- Pass `data-truncate={truncate || undefined}` on `<Root>`.
- Add `'&[data-truncate]': { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }` to the styled rules.

### Step 4 — Update `Text` story

Check if `src/renderer/uikit/Text/Text.story.tsx` exists. If yes, add a `truncate` prop entry. If not, this step is a no-op (Text doesn't currently appear in Storybook — additions to other primitive stories are the bar).

### Step 5 — Rewrite `DownloadButton.tsx` (self-contained, no `onClick` prop)

Replace the entire file body with:

```tsx
import { useRef } from "react";
import { Panel, IconButton } from "../../uikit";
import { DownloadIcon } from "../../theme/icons";
import color from "../../theme/color";
import { downloads } from "../../api/downloads";
import {
    showDownloadsPopup,
    closeDownloadsPopup,
    isDownloadsPopupOpen,
} from "./BrowserDownloadsPopup";

const RING_SIZE = 22;
const RING_CENTER = RING_SIZE / 2;
const RING_RADIUS = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function DownloadButton() {
    const buttonRef = useRef<HTMLButtonElement>(null);

    const { hasActive, progress } = downloads.state.use((s) => {
        const active = s.downloads.filter((d) => d.status === "downloading");
        const hasActive = active.length > 0;
        let progress = 0;
        if (hasActive) {
            const totalBytes = active.reduce((sum, d) => sum + d.totalBytes, 0);
            const receivedBytes = active.reduce((sum, d) => sum + d.receivedBytes, 0);
            progress = totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : 0;
        }
        return { hasActive, progress };
    });

    const dashOffset = RING_CIRCUMFERENCE * (1 - progress);

    const handleClick = () => {
        if (!buttonRef.current) return;
        if (isDownloadsPopupOpen()) {
            closeDownloadsPopup();
        } else {
            showDownloadsPopup(buttonRef.current);
        }
    };

    return (
        <Panel position="relative" align="center" justify="center" data-downloads-button>
            <IconButton
                ref={buttonRef}
                size="sm"
                title="Downloads"
                active={hasActive || undefined}
                icon={<DownloadIcon />}
                onClick={handleClick}
            />
            {hasActive && (
                <svg
                    viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
                    width={RING_SIZE}
                    height={RING_SIZE}
                    style={{ position: "absolute", top: 1, left: 1, pointerEvents: "none" }}
                >
                    <circle
                        cx={RING_CENTER} cy={RING_CENTER} r={RING_RADIUS}
                        fill="none" stroke={color.border.light} strokeWidth={1.5}
                    />
                    <circle
                        cx={RING_CENTER} cy={RING_CENTER} r={RING_RADIUS}
                        fill="none" stroke={color.border.active} strokeWidth={1.5}
                        strokeLinecap="round"
                        strokeDasharray={RING_CIRCUMFERENCE}
                        strokeDashoffset={dashOffset}
                        transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
                        style={{ transition: "stroke-dashoffset 0.3s ease" }}
                    />
                </svg>
            )}
        </Panel>
    );
}
```

Notes:
- No `onClick` prop. The button is self-contained — caller renders `<DownloadButton/>` with no props.
- Toggle behavior: `isDownloadsPopupOpen()` checks the global popper registry; if open, click closes; if closed, click opens. Matches legacy UX where clicking the button while the popup is open closed it.
- `IconButton` uses `forwardRef` — `ref` flows through to the underlying `<button>`.
- The SVG uses explicit `top: 1, left: 1` to center the 22×22 ring inside the 24×24 button (legacy uses the same offsets for the same reason — flex centering does not apply to absolute-positioned children).

### Step 6 — Rewrite `BrowserDownloadsPopup.tsx` as encapsulated imperative API

Replace the entire file body with:

```tsx
import { Panel, Text, Button, IconButton, Spacer, Popover } from "../../uikit";
import { CloseIcon, FolderOpenIcon } from "../../theme/icons";
import color from "../../theme/color";
import { downloads } from "../../api/downloads";
import { DownloadEntry } from "../../../ipc/api-param-types";
import { TPopperModel } from "../../ui/dialogs/poppers/types";
import {
    closePopper,
    showPopper,
    visiblePoppers,
} from "../../ui/dialogs/poppers/Poppers";
import { TComponentState } from "../../core/state/state";
import { DefaultView, ViewPropsRO, Views } from "../../core/state/view";

// =============================================================================
// Module-private model
// =============================================================================

const defaultDownloadsPopupState = {} as Record<string, never>;
type DownloadsPopupState = typeof defaultDownloadsPopupState;

class DownloadsPopupModel extends TPopperModel<DownloadsPopupState, void> {
    // `position` is inherited from TPopperModel (PopperPosition — shape-compatible
    // with UIKit PopoverPosition, see US-466 concern #10).
}

// =============================================================================
// Module-private view (registered with the global Poppers registry)
// =============================================================================

const downloadsPopupId = Symbol("DownloadsPopup");

function DownloadsPopupView({ model }: ViewPropsRO<DownloadsPopupModel>) {
    const downloadsList = downloads.state.use((s) => s.downloads);
    const hasCompleted = downloadsList.some((d) => d.status !== "downloading");

    return (
        <Popover
            open
            {...model.position}
            outsideClickIgnoreSelector="[data-downloads-button]"
            onClose={() => model.close()}
        >
            <Panel direction="column" width={320}>
                <Panel
                    direction="row"
                    align="center"
                    paddingX="lg"
                    paddingY="md"
                    borderBottom
                >
                    <Text size="md" bold>Downloads</Text>
                    <Spacer />
                    {hasCompleted && (
                        <Button size="sm" variant="ghost" onClick={downloads.clearCompleted}>
                            Clear
                        </Button>
                    )}
                </Panel>
                <Panel direction="column" overflowY="auto" maxHeight={400}>
                    {downloadsList.length === 0 ? (
                        <Panel paddingY="xxl" paddingX="lg" align="center" justify="center">
                            <Text size="md" color="light">No downloads</Text>
                        </Panel>
                    ) : (
                        downloadsList.map((dl, i) => (
                            <DownloadItem
                                key={dl.id}
                                entry={dl}
                                showBorder={i < downloadsList.length - 1}
                            />
                        ))
                    )}
                </Panel>
            </Panel>
        </Popover>
    );
}

Views.registerView(downloadsPopupId, DownloadsPopupView as DefaultView);

// =============================================================================
// Public imperative API
// =============================================================================

const popupOffset: [number, number] = [0, 4];

/**
 * Open the downloads popup anchored to the given element. Returns a promise
 * that resolves when the popup closes (click-outside, Escape, or explicit
 * `closeDownloadsPopup()`).
 *
 * If the popup is already open, this is a no-op.
 */
export const showDownloadsPopup = async (anchor: Element): Promise<void> => {
    if (isDownloadsPopupOpen()) return;
    const state = new TComponentState(defaultDownloadsPopupState);
    const model = new DownloadsPopupModel(state);
    model.position = {
        elementRef: anchor,
        placement: "bottom-end",
        offset: popupOffset,
    };
    await showPopper<void>({ viewId: downloadsPopupId, model });
};

/** Close the downloads popup if it is currently open. */
export const closeDownloadsPopup = (): void => {
    closePopper(downloadsPopupId);
};

/** Whether the downloads popup is currently open. */
export const isDownloadsPopupOpen = (): boolean =>
    visiblePoppers().some((p) => p.viewId === downloadsPopupId);

// =============================================================================
// Module-private item view
// =============================================================================

function formatBytes(bytes: number): string {
    if (bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, i);
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

function DownloadItem({ entry, showBorder }: { entry: DownloadEntry; showBorder: boolean }) {
    const { id, filename, status, receivedBytes, totalBytes, error } = entry;
    const isDownloading = status === "downloading";
    const progress = totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : 0;

    const statusText = isDownloading
        ? `${formatBytes(receivedBytes)} / ${totalBytes > 0 ? formatBytes(totalBytes) : "?"}`
        : status === "completed"
          ? formatBytes(totalBytes)
          : status === "cancelled"
            ? "Cancelled"
            : "Failed";

    return (
        <Panel
            direction="column"
            paddingY="md"
            paddingX="lg"
            gap="sm"
            borderBottom={showBorder || undefined}
            title={entry.savePath || filename}
        >
            <Panel direction="row" align="center" gap="md">
                <Panel flex overflow="hidden">
                    <Text truncate size="md">{filename}</Text>
                </Panel>
                <Text size="sm" color="light" nowrap>{statusText}</Text>
            </Panel>
            {isDownloading && (
                <div
                    style={{
                        height: 3,
                        borderRadius: 2,
                        backgroundColor: color.border.light,
                        overflow: "hidden",
                    }}
                >
                    <div
                        style={{
                            height: "100%",
                            width: `${progress * 100}%`,
                            backgroundColor: color.border.active,
                            borderRadius: 2,
                            transition: "width 0.3s ease",
                        }}
                    />
                </div>
            )}
            {error && status === "failed" && (
                <Text size="sm" color="error">{error}</Text>
            )}
            <Panel direction="row" gap="sm">
                {isDownloading && (
                    <Button size="sm" variant="ghost" onClick={() => downloads.cancelDownload(id)}>
                        Cancel
                    </Button>
                )}
                {status === "completed" && (
                    <>
                        <Button size="sm" variant="ghost" onClick={() => downloads.openDownload(id)}>
                            Open
                        </Button>
                        <IconButton
                            size="sm"
                            title="Show in Folder"
                            icon={<FolderOpenIcon />}
                            onClick={() => downloads.showInFolder(id)}
                        />
                    </>
                )}
                {(status === "failed" || status === "cancelled") && (
                    <IconButton
                        size="sm"
                        title="Dismiss"
                        icon={<CloseIcon />}
                        onClick={() => downloads.clearCompleted()}
                    />
                )}
            </Panel>
        </Panel>
    );
}
```

Notes:
- **No JSX component is exported.** Only `showDownloadsPopup`, `closeDownloadsPopup`, `isDownloadsPopupOpen` are public.
- `model.position` is `PopperPosition` (inherited from `TPopperModel`) which is structurally compatible with UIKit `PopoverPosition` — `<Popover {...model.position}>` works directly. This is the first concrete usage of the shape-compat decision in [US-466 concern #10](../US-466-uikit-popover/README.md).
- `Views.registerView(downloadsPopupId, DownloadsPopupView as DefaultView)` runs once at module load. The view is then rendered by the global `<Poppers/>` instance (mounted from [index.tsx](../../../src/renderer/index.tsx)) whenever a model with `viewId === downloadsPopupId` is in the popper state.
- `showDownloadsPopup` returns a promise that resolves when `model.close()` is invoked (click-outside, Escape via Popover, or explicit `closeDownloadsPopup`). Callers can `await` if they need to know when the popup is dismissed; toolbar-style fire-and-forget callers (DownloadButton) can ignore the return value.
- Last-item border suppression done in the parent loop via `showBorder={i < downloadsList.length - 1}`. Same visual result as legacy `:last-child` rule.
- The 3px progress bar is two raw `<div>`s with inline styles using `color.border.light` and `color.border.active` tokens. Allowed by Rule 7 (raw HTML, not UIKit composition).

### Step 7 — Update `BrowserEditorView.tsx` to drop external popup state

Apply the following edits:

1. **Remove import** (line 45): `import { BrowserDownloadsPopup } from "./BrowserDownloadsPopup";`
2. **Remove state**: any `useState` for `downloadsAnchor` (search for `downloadsAnchor` to find the declaration).
3. **Remove handlers**: `handleDownloadClick` (calls `setDownloadsAnchor`) and `handleDownloadsClose` (calls `setDownloadsAnchor(null)`). Both become unused.
4. **Update toolbar JSX** (line 662): `<DownloadButton onClick={handleDownloadClick} />` → `<DownloadButton />`.
5. **Remove popup JSX** (lines 797-800):

   ```tsx
   <BrowserDownloadsPopup
       anchorEl={downloadsAnchor}
       onClose={handleDownloadsClose}
   />
   ```

   Delete the entire block.

After these edits, the `BrowserEditorView.tsx` file no longer references the downloads popup at all — it only renders `<DownloadButton/>` in the toolbar, and the popup mounts itself via the global `<Poppers/>` registry when the button is clicked.

### Step 8 — Run TypeScript check

`npx tsc --noEmit` — confirm no new errors on `IconButton.tsx`, `Text.tsx`, `DownloadButton.tsx`, `BrowserDownloadsPopup.tsx`, `BrowserEditorView.tsx`.

Specific things to verify:
- `model.position` (typed as `PopperPosition`) successfully spreads into `<Popover {...}>` (typed as `PopoverProps extends PopoverPosition`). If the structural compatibility from US-466 concern #10 is wrong, this is where it shows up first.
- `BrowserEditorView` has no orphaned references to `downloadsAnchor`, `handleDownloadClick`, `handleDownloadsClose`, or `BrowserDownloadsPopup` after the edits.

### Step 9 — Manual smoke test (user)

User performs the smoke checks listed in Acceptance Criteria below.

### Step 10 — Update dashboard

When this task moves Planned → Active (or stays Active under EPIC-025), upgrade its dashboard entry to a markdown link to this README. (Already handled as part of the doc-creation step.)

## Concerns / Open questions

All resolved before implementation; record kept here for future readers.

### 1. Should the progress bar (3px) be promoted to UIKit `ProgressBar`? — RESOLVED: no, raw `<div>` for now

A `ProgressBar` component is meaningful future UIKit (file uploads, AI generations, fetches, anything time-based), but it adds story/state/aria scope to a screen-migration task. The 3px decorative bar is a leaf rendering — not a layout primitive — and works with two raw `<div>`s using `color.border.*` tokens. Future task can promote to UIKit and migrate consumers.

### 2. Should the progress ring be a UIKit primitive (`RingProgress` or similar)? — RESOLVED: no, raw `<svg>`

Same reasoning as #1. The ring is one consumer (DownloadButton) drawing two `<circle>`s — raw SVG with inline styles is appropriate for leaf content. Promoting to UIKit when there's a second consumer (e.g. an AI agent progress badge somewhere) is the right cue.

### 3. Should we keep react-tooltip (`Tooltip`) for the Downloads button? — RESOLVED: no, native `title="Downloads"`

US-462 already established the precedent: a single migrated button uses the native HTML `title` attribute via `IconButton title="…"`. The toolbar will be migrated wholesale later; until then, a one-button drift in tooltip styling is acceptable. Drops the legacy Tooltip import from `DownloadButton.tsx`.

### 4. Should we replace `Popper` with a UIKit `Popover`? — RESOLVED: yes, depends on US-466

Original draft said "no, defer". Reversed — UIKit `Popover` is being built first as [US-466](../US-466-uikit-popover/README.md), and this task uses it. Legacy `Popper` is left in place for the other 6 consumers (PathInput, ComboTemplate, FilterPoper, ColumnsOptions, CsvOptions, PopupMenu) and removed only after they all migrate. US-463 is **blocked on US-466**.

### 5. The status row gap drift (8 → 6) — does it matter? — RESOLVED: no, accept

`gap="md"` = 6 is the closest token to legacy 8. `gap="lg"` = 8 would match exactly but is one step too large for this scale (the popup feels more compact at 6). Same drift category as US-455 / US-460 / US-462.

### 6. `IconButton.active` — is `data-active` the right attribute name? — RESOLVED: yes

uikit/CLAUDE.md's standard data-attribute table lists `data-active` for "item is focused / highlighted" — exactly the semantics here. The CSS pseudo-class `:active` (mouse-pressed) uses a different selector and remains usable for press-feedback visuals. Order of styled rules ensures `&[data-active]` overrides `&:hover` and `&:active` (matches legacy `.active` overriding both).

### 7. `Text.truncate` — should there be a tooltip when truncated? — RESOLVED: no, use the native `title` on the parent Panel

Legacy `<div className="download-item" title={entry.savePath || filename}>` carries a tooltip on the wrapping container, not on the truncated text itself. The new code preserves that — `<Panel … title={…}>` carries the same native tooltip. Showing a measure-aware in-text tooltip ("only when actually truncated") is the future `TruncatedText` component's job — out of scope.

### 8. Folder placement — do these files move to `editors/shared/` or to UIKit? — RESOLVED: no, stay in `editors/browser/`

Both files are browser-specific (consume `downloads` global service and the browser editor's anchor refs). No second consumer exists or is planned. They stay in `editors/browser/`. Multi-consumer move criterion mirrors US-461 (FindBar moved when a second consumer appeared).

### 9. Last-item border suppression — pass index from parent or use a different approach? — RESOLVED: pass `showBorder` from parent

A CSS `:last-child` selector targeted via UIKit Panel would require either a className on the last item (Rule 7 violation) or a styled-component selector outside UIKit (Rule 7 violation) or extending Panel with some kind of `borderBottomLast` flag (over-specific to this use case). Passing `showBorder={i < list.length - 1}` from the parent is the simplest JSX-level expression and avoids any new UIKit prop.

### 10. Why no `WithPopupMenu`-style refactor at the same time? — RESOLVED: scoped out

`WithPopupMenu` is a separate render-prop component used by the same toolbar. It also uses legacy `Button` and is a candidate for migration, but it's a separate concern — its inner `Menu` is its own subsystem. Keeping this task tightly scoped to the two download-related files matches the per-screen migration discipline.

### 11. Encapsulation: should the popup be a JSX component or an imperative `showSomething()` function? — RESOLVED: imperative

Original draft had `BrowserDownloadsPopup` as a JSX component receiving `anchorEl` / `onClose` props. Restructured to the established Persephone encapsulation pattern (see [showPopupMenu.tsx](../../../src/renderer/ui/dialogs/poppers/showPopupMenu.tsx)) — module exports only `showDownloadsPopup(anchor): Promise<void>`, `closeDownloadsPopup()`, `isDownloadsPopupOpen()`. The popup mounts itself via the global `<Poppers/>` registry; `BrowserEditorView` does not own popup state.

Why imperative wins here: the popup has no parent-managed visual state (it's not animated, it's not slot-driven), the toolbar button is its only opener, and the close trigger is purely internal (click-outside / Escape). Externalizing the open/close state into `BrowserEditorView` was overhead. Imperative also matches `showAppPopupMenu`, `showOpenUrlDialog`, and other transient overlays — consistent house style.

### 12. Toggle behavior on repeated button click — how is this preserved? — RESOLVED: `isDownloadsPopupOpen()` check

Legacy: clicking `DownloadButton` twice closes the popup (because the second click goes "outside" the popup via the click-outside listener — actually wait, the button itself was outside the popup so the first close came from click-outside; then setDownloadsAnchor was set again on the same click, briefly reopening...). The behavior was: click button → toggle open/close.

New: `DownloadButton.onClick` consults `isDownloadsPopupOpen()`. If open, `closeDownloadsPopup()`; if closed, `showDownloadsPopup(buttonRef.current)`. **However** — there is a subtle timing edge case. When the popup is open and the user clicks the button:
1. The popup's click-outside listener (mounted on `mousedown`) fires first, closes the popup, calls `model.close()`.
2. The button's `onClick` then fires (`click` follows `mousedown`). At this point `isDownloadsPopupOpen()` returns false (popup just closed). So the button immediately re-opens the popup.

That would be wrong (click → open → no toggle). Mitigation: use the `mousedown` event consistently or rely on UIKit Popover's `outsideClickIgnoreSelector` to keep the popup open when the click target is the toolbar button itself. The cleanest fix is the latter — register the button with a stable selector and pass `outsideClickIgnoreSelector`.

**Resolution**: pass `outsideClickIgnoreSelector='[data-downloads-button]'` from `showDownloadsPopup`, and add `data-downloads-button` (a non-style data-attribute) to the button root in `DownloadButton`. The popup's click-outside listener then ignores clicks on the button; the button's `onClick` fires; `isDownloadsPopupOpen()` is true; `closeDownloadsPopup()` runs. Clean toggle.

Implementation note for Step 5: add `data-downloads-button=""` (empty value, presence-based) to the IconButton — but IconButton may not forward arbitrary `data-*` attributes by default. Verify during implementation; if it doesn't, wrap the IconButton in a Panel with that attribute, or pass the attribute on the outer Panel that already wraps the IconButton + SVG ring. The outer Panel forwards HTMLAttributes via `...rest`, so `<Panel data-downloads-button>` should work.

For the imperative `showDownloadsPopup`:

```tsx
const popupOffset: [number, number] = [0, 4];
const ignoreSelector = '[data-downloads-button]';

export const showDownloadsPopup = async (anchor: Element): Promise<void> => {
    if (isDownloadsPopupOpen()) return;
    const state = new TComponentState(defaultDownloadsPopupState);
    const model = new DownloadsPopupModel(state);
    model.position = { elementRef: anchor, placement: "bottom-end", offset: popupOffset };
    await showPopper<void>({ viewId: downloadsPopupId, model });
};
```

And the view passes `outsideClickIgnoreSelector` to `Popover`:

```tsx
<Popover open {...model.position} outsideClickIgnoreSelector={ignoreSelector} onClose={() => model.close()}>
```

This makes the toggle robust.

## Acceptance criteria

1. `DownloadButton.tsx` contains zero `@emotion/styled` imports, zero `style=` on UIKit components, zero `className=` on UIKit components.
2. `BrowserDownloadsPopup.tsx` contains zero `@emotion/styled` imports, zero `style=` on UIKit components, zero `className=` on UIKit components, and **exports only** `showDownloadsPopup`, `closeDownloadsPopup`, `isDownloadsPopupOpen` (no JSX component).
3. `IconButton.tsx` exposes an `active?: boolean` prop; passing it switches the icon color to `color.icon.active` and that color overrides hover/press feedback.
4. `Text.tsx` exposes a `truncate?: boolean` prop; passing it makes a Text inside `<Panel flex overflow="hidden">` clip with an ellipsis.
5. `BrowserEditorView.tsx` no longer references `BrowserDownloadsPopup` (no import, no JSX render), no longer holds `downloadsAnchor` state, and no longer has `handleDownloadClick` / `handleDownloadsClose`.
6. `npx tsc --noEmit` reports no new errors on `IconButton.tsx`, `Text.tsx`, `DownloadButton.tsx`, `BrowserDownloadsPopup.tsx`, `BrowserEditorView.tsx`.
7. **Smoke test — idle state**: Open a browser tab. The download button (16×16 download icon in a 24×24 container) appears in the toolbar in light icon color. No progress ring. Native HTML tooltip "Downloads" appears on hover.
8. **Smoke test — active download**: Start a download. The icon turns to `color.icon.active` (orange in the default-dark theme). A circular ring appears around it; ring fill animates as bytes arrive. Hovering the button does not switch the color (active wins over hover).
9. **Smoke test — popup open**: Click the download button. Popup opens anchored bottom-end with 4px offset. 320px wide. Header reads "Downloads" in bold; "Clear" button appears on the right when at least one non-active download exists.
10. **Smoke test — toggle**: Click the download button while the popup is already open. Popup closes (the button does NOT immediately reopen it). Click again — popup reopens. This validates concern #12 (`outsideClickIgnoreSelector="[data-downloads-button]"`).
11. **Smoke test — click-outside dismissal**: Open the popup, click anywhere else in the page (not on the button). Popup closes.
12. **Smoke test — Escape dismissal**: Open the popup, press Escape. Popup closes.
13. **Smoke test — empty state**: With no downloads, popup shows "No downloads" centered in a padded area.
14. **Smoke test — active item**: While downloading, the item shows filename truncated with ellipsis if too long, status text "X.Y MB / Z.Z MB" right-aligned, a 3px progress bar fills as bytes arrive, and a "Cancel" button under the row.
15. **Smoke test — completed item**: After completion, the item shows filename + total bytes, "Open" button + folder icon-button. Clicking folder icon opens Explorer at the file. Clicking "Open" launches the file.
16. **Smoke test — failed item**: With a failure, the item shows the error text in `color.error.text`, status reads "Failed", and an X icon-button dismisses the entry.
17. **Smoke test — cancelled item**: With a cancellation, status reads "Cancelled" and an X icon-button dismisses.
18. **Smoke test — Clear button**: Clicking "Clear" removes all non-active items.
19. **Smoke test — DevTools**: Inspect the popup. The popup root has `data-type="popover"` (UIKit Popover). Inside: `data-type="panel"` for the column container; the header `data-type="panel"` with `data-border-bottom`; items `data-type="panel"`. Filename text has `data-type="text" data-truncate`. The download button wrapper has `data-downloads-button` (presence-based). The IconButton inside has `data-type="icon-button" data-size="sm"`, plus `data-active` while downloading.
20. **Smoke test — popup is portaled**: Inspect the DOM tree — the popover sits inside `<body>` (not nested in the BrowserEditor's container). Confirms US-466's portal-by-default behavior.
21. **Smoke test — themes**: Cycle `default-dark`, `light-modern`, `monokai`. Active-icon color, ring fill color, error text, and progress-bar fill all update with theme. Border tokens render correctly in each theme.

## Files Changed summary

| File | Action | Notes |
|------|--------|-------|
| [src/renderer/uikit/IconButton/IconButton.tsx](../../../src/renderer/uikit/IconButton/IconButton.tsx) | Modify | Add `active?: boolean` prop and `&[data-active]` styled rule |
| [src/renderer/uikit/IconButton/IconButton.story.tsx](../../../src/renderer/uikit/IconButton/IconButton.story.tsx) | Modify | Add `active` prop entry |
| [src/renderer/uikit/Text/Text.tsx](../../../src/renderer/uikit/Text/Text.tsx) | Modify | Add `truncate?: boolean` prop and `&[data-truncate]` styled rule |
| [src/renderer/uikit/Text/Text.story.tsx](../../../src/renderer/uikit/Text/Text.story.tsx) | Modify (if exists) | Add `truncate` prop entry |
| [src/renderer/editors/browser/DownloadButton.tsx](../../../src/renderer/editors/browser/DownloadButton.tsx) | Rewrite | Self-contained (no `onClick` prop); calls `showDownloadsPopup` / `closeDownloadsPopup` internally; outer Panel carries `data-downloads-button` for toggle handshake |
| [src/renderer/editors/browser/BrowserDownloadsPopup.tsx](../../../src/renderer/editors/browser/BrowserDownloadsPopup.tsx) | Rewrite as encapsulated module | Exports only `showDownloadsPopup`, `closeDownloadsPopup`, `isDownloadsPopupOpen`. Internal: `DownloadsPopupModel` (extends `TPopperModel`), `DownloadsPopupView` (UIKit + `<Popover>`), `Views.registerView`. Uses `outsideClickIgnoreSelector="[data-downloads-button]"` for the toggle handshake. |
| [src/renderer/editors/browser/BrowserEditorView.tsx](../../../src/renderer/editors/browser/BrowserEditorView.tsx) | Modify | Remove `BrowserDownloadsPopup` import, `downloadsAnchor` state, `handleDownloadClick`, `handleDownloadsClose`, and the `<BrowserDownloadsPopup …/>` JSX render. Change `<DownloadButton onClick={…}/>` to `<DownloadButton/>`. |
| [doc/active-work.md](../../active-work.md) | Modify | Convert US-463 line to a link to this README; mark blocked on US-466 |
