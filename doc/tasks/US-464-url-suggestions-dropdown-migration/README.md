# US-464: UrlSuggestionsDropdown — UIKit migration

> **Status: blocked on [US-468](../US-468-uikit-listbox/README.md).** The original plan in this doc introduced a screen-local `ListItem` primitive plus inlined virtualization. After investigation we are building UIKit `ListBox` (US-468) first; US-464 will consume it. The `ListItem` plan and inline highlight-helper sections of this document will be revised once `ListBox`'s API is final. The Popover-related changes (`matchAnchorWidth`, middleware-respected `maxHeight`) still apply and stay in scope here.

## Goal

Migrate the browser address-bar suggestions dropdown to a pure UIKit composition. After this task, [src/renderer/editors/browser/UrlSuggestionsDropdown.tsx](../../../src/renderer/editors/browser/UrlSuggestionsDropdown.tsx) imports no `@emotion/styled`, sets no `style=`/`className=` on UIKit components, and expresses its layout entirely through `Popover` + `Panel` + `Text` + `Button` + the UIKit `ListBox` (US-468) for the suggestion rows.

The component **keeps its current external interface** (`UrlSuggestionsDropdown` JSX with `anchorEl`/`open`/`items`/`mode`/`searchText`/`hoveredIndex`/`onHoveredIndexChange`/`onSelect`/`onClearVisible` props). Unlike US-463 (BrowserDownloadsPopup), this dropdown is **not** restructured into an imperative `showSomething()` module — the open/close lifecycle is reactively driven by the URL input's focus/blur and the URL bar model's state, so a parent-controlled JSX component stays the right shape. See concern #1.

Two small Popover additions land with this task — both reusable beyond this screen:

1. **`Popover.matchAnchorWidth?: boolean`** — when true, the size middleware sets the floating element's `width` to the anchor's width. Reusable by combobox / autocomplete / any anchor-matched dropdown.
2. **`Popover.maxHeight` becomes middleware-respected** — when a numeric `maxHeight` is passed, the `size` middleware clamps to `min(userMax, availableHeight - 20)` instead of letting the inline-style override race the middleware on `autoUpdate`. Today the prop is wired but oscillates with viewport-driven middleware writes (see concern #3).

The third addition originally planned here — a screen-local `ListItem` primitive — is **dropped from this task**. UIKit `ListBox` (US-468) supplies the row infrastructure and exports a reusable `ListItem` for `renderItem` callers. The detailed implementation steps below that build on the local `ListItem` will be revised once US-468 lands.

## Background

### EPIC-025 Phase 4 context

Per-screen migration loop (from [EPIC-025](../../epics/EPIC-025.md) Phase 4):

1. Pick a screen
2. Audit which UIKit components are needed and which are missing
3. Build missing components / prop extensions in Storybook first
4. Rewrite the screen with UIKit
5. Smoke-test the screen

Recent precedents using the same UIKit `Popover`:

- [US-463 BrowserDownloadsPopup](../US-463-browser-downloads-migration/README.md) — first concrete `Popover` consumer; established the position-shape compatibility with `TPopperModel` and the `outsideClickIgnoreSelector` toggle handshake. Also added `IconButton.active` and `Text.truncate`.

Recent precedents adding small UIKit extensions during a per-screen rewrite:

- [US-462 TorStatusOverlay](../US-462-tor-status-overlay-migration/README.md) — added `Spinner.color`, `Panel.whiteSpace`, `Panel.wordBreak`, `Panel.alignSelf`.
- [US-460 MarkdownSearchBar](../US-460-markdown-search-bar-migration/README.md) / [US-461 Shared FindBar](../US-461-shared-findbar-consolidation/README.md) — added `top`/`right`/`bottom`/`left` to Panel.

### Why this is a parent-controlled JSX component, not an imperative module

US-463 made BrowserDownloadsPopup imperative (`showDownloadsPopup(anchor)`) because:

- The popup's state was self-contained (downloads service feed-through).
- Open/close was triggered by exactly one button and resolved by click-outside / Escape.
- Externalizing the anchor + open state onto `BrowserEditorView` was overhead.

UrlSuggestionsDropdown is the opposite shape:

- Its `open` state (`suggestionsOpen`) lives on `BrowserEditorModel` and is mutated from many places: URL input focus (`handleUrlFocus`), URL input blur (`handleUrlBlur`), Enter / Escape / suggestion-select inside `handleUrlKeyDown`, `syncFromUrl` on navigation, and `handleNavigate` on the Go button. See [BrowserUrlBarModel.ts](../../../src/renderer/editors/browser/BrowserUrlBarModel.ts).
- `hoveredIndex` is shared with keyboard arrow navigation in the URL input — the suggestions UI is a *projection of* URL-bar state, not an isolated transient overlay.
- The dropdown re-renders reactively whenever `urlInput`, `searchEntries`, or `tabs[active].navHistory` change (filtering happens in `suggestionsItems` getter, not inside the dropdown).
- There is no opener button — the URL input itself is the trigger, and click-outside dismissal is implemented via `onBlur` on the input (not via a click-outside listener on the dropdown).

A `showUrlSuggestions(...)` imperative API would have to either re-implement the reactive state coupling or pull state out of `BrowserEditorModel`. Either is more work for less benefit. The component stays as a JSX child of `BrowserEditorView`, fed by the URL bar model's state.

### Current implementation

[src/renderer/editors/browser/UrlSuggestionsDropdown.tsx](../../../src/renderer/editors/browser/UrlSuggestionsDropdown.tsx) — 173 lines. Renders a portal-mounted floating dropdown anchored to the URL bar element (the `.url-bar` parent of the URL input). Uses `useFloating` directly with `offset(2)` + `flip()` + a `size` middleware that sets both `maxHeight` (`Math.min(400, Math.max(100, availableHeight - 10))`) and `width` (`rects.reference.width`). Three regions:

1. **Header** — "Search History" / "Navigation History" label on the left; "Clear" button on the right (only in `search` mode and when `onClearVisible` is provided). 4px / 8px padding, 11px font, light text color.
2. **Items** — list of suggestion strings. Each row: 4px / 8px padding, 13px font, 20px line-height, ellipsis overflow. The row matching `hoveredIndex` gets `.hovered` class → `color.background.selection` background + `color.text.selection` text. In `search` mode, matched substrings of `searchText` render with `font-weight: 600` via `highlightText`.
3. **Empty state** — none rendered; the dropdown returns `null` when `items.length === 0`.

Two key event behaviors:

- **`onMouseDown={(e) => e.preventDefault()}` on the dropdown root** — prevents the URL input from losing focus when the user clicks anywhere inside the dropdown. Without it, the click would blur the URL input → `handleUrlBlur` fires → `suggestionsOpen` set to `false` → dropdown unmounts before the click event reaches a row.
- **Clear button** — uses `onMouseDown` (not `onClick`) with its own `preventDefault()` + `stopPropagation()` to fire `onClearVisible` immediately, before any blur. The `stopPropagation` exists only to prevent the outer `onMouseDown` from re-firing — preserving the same effect (preventing blur), which is redundant but harmless.

The dropdown has **no internal click-outside handler and no Escape handler** — both are owned by the URL input (focus loss → blur → close; Escape inside the input → keydown handler → close). This is a deliberate parent-controlled design.

### Audit results — element by element

| Old element | UIKit replacement | Gap |
|---|---|---|
| `useFloating` + `ReactDOM.createPortal` + `DropdownRoot` styled.div with `backgroundColor: color.background.default`, `border: 1px solid color.border.default`, `borderRadius: 6`, `boxShadow: color.shadow.default`, `overflowY: auto`, `zIndex: 1000` | UIKit `<Popover open elementRef={anchorEl} placement="bottom-start" offset={[0, 2]} matchAnchorWidth maxHeight={400} onMouseDown={(e) => e.preventDefault()}>` | **`Popover.matchAnchorWidth` missing.** Add it as a `size`-middleware option. **`Popover.maxHeight` is partially wired** — prop exists but inline-style override loses to floating-ui's `autoUpdate` (concern #3); fix the middleware to respect numeric `maxHeight`. The Popover Root already matches every visual property (`backgroundColor`, `border`, `borderRadius: radius.lg = 6`, `boxShadow: shadow.default`, `overflow: auto`, `zIndex: 1000`) — no styling drift. |
| `onMouseDown={(e) => e.preventDefault()}` on dropdown root | Same — passed via `Popover`'s `...rest` HTMLAttributes passthrough to its inner Root | none. Verified: `PopoverProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" \| "className">`, so `onMouseDown` is in the prop surface and forwarded. |
| Header — `<div className="suggestions-header">` flex row, padding 4/8, fontSize 11, color light, userSelect none | `<Panel direction="row" align="center" paddingY="sm" paddingX="md" gap="md">` | `paddingY="sm"`=4 (matches), `paddingX="md"`=8 (matches), `gap="md"`=6 (drift: legacy header uses `flex: 1` on the label rather than gap; gap is for the label-Spacer-button arrangement). |
| Header label `<span className="header-label">`, flex 1, "Search History" / "Navigation History" | `<Text size="xs" color="light">{label}</Text>` followed by `<Spacer />` to push Clear right | `size="xs"`=12 (drift: legacy 11 → 12, +1px). Acceptable. |
| `<span className="clear-btn">` cursor pointer, padding 0/4, borderRadius 3, hover `color.text.default` + `color.background.light` | `<Button size="sm" variant="ghost" onClick={onClearVisible}>Clear</Button>` | UIKit ghost button matches the flat-hover pattern. Drift: 12px font (UIKit Button size="sm") vs 11px legacy. Acceptable — same pattern accepted in US-463. |
| `<div className="suggestion-item">` padding 4/8, fontSize 13, lineHeight 20px, ellipsis, hover sim via JS-driven `.hovered` class → `color.background.selection` bg + `color.text.selection` text | `<ListItem active={i === hoveredIndex \|\| undefined} onMouseEnter={() => onHoveredIndexChange(i)} onClick={() => onSelect(item)}>` | **`ListItem` UIKit primitive missing.** Add it: padding 4/8, fontSize 13 (`md`), lineHeight 20px, ellipsis, `&[data-active]` rule for selection-bg/selection-text. Reusable for autocomplete, Menu items, future ListBox rows. |
| `<span className="highlighted-text">` for matched substrings, parent rule `& .highlighted-text { fontWeight: 600 }` | Local helper that walks the same regex split and emits `<Text bold>` for matched parts, plain string for non-matched parts. Inline at the screen — does not bloat UIKit. | `highlightText` (in [components/basic/useHighlightedText.tsx](../../../src/renderer/components/basic/useHighlightedText.tsx)) returns nodes with `className="highlighted-text"`, but we cannot keep that className-driven rule in app code (Rule 7). Concern #5. |
| Returning `null` when `!open \|\| !anchorEl \|\| items.length === 0` | Same — `<Popover open={open && anchorEl != null && items.length > 0} ...>` plus an internal early-return guard. Popover already returns `null` when `open=false` or its position is unresolved. | none |
| `useEffect` to scroll the hovered item into view | Same — kept inside the migrated component; uses a ref captured by `Popover` (forwardRef-supported, see [Popover.tsx:68](../../../src/renderer/uikit/Popover/Popover.tsx#L68)) and `querySelectorAll('[data-type="list-item"]')` instead of `.suggestion-item` className | none — `data-type` selector is the UIKit pattern (see uikit/CLAUDE.md Rule 1). |

### UIKit extensions added in this task

#### 1. `Popover.matchAnchorWidth?: boolean`

Add to [src/renderer/uikit/Popover/Popover.tsx](../../../src/renderer/uikit/Popover/Popover.tsx):

```tsx
export interface PopoverProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className">,
        PopoverPosition {
    open: boolean;
    onClose?: () => void;
    maxHeight?: number | string;
    outsideClickIgnoreSelector?: string;
    /**
     * Match the floating element's width to the anchor's width. Useful for
     * combobox / autocomplete / suggestions dropdowns. The width updates
     * automatically on `autoUpdate` (resize, scroll). Default: false.
     */
    matchAnchorWidth?: boolean;
    children?: React.ReactNode;
}
```

The `size` middleware writes the width when set:

```tsx
size({
    apply({
        availableHeight,
        rects,
        elements,
    }: {
        availableHeight: number;
        rects: { reference: { width: number } };
        elements: { floating: HTMLElement };
    }) {
        const numericMax = typeof maxHeight === "number" ? maxHeight : Infinity;
        const finalMaxH = Math.min(numericMax, Math.max(100, availableHeight - 20));
        const styles: Record<string, string> = {
            maxHeight: `${finalMaxH}px`,
        };
        if (matchAnchorWidth) {
            styles.width = `${rects.reference.width}px`;
        }
        Object.assign(elements.floating.style, styles);
    },
}),
```

Drop the `...(maxHeight ? { maxHeight } : {})` from the inline `style` on `<Root>` (concern #3) — middleware now owns the maxHeight write.

The `useMemo` dependency for `middleware` extends to `[offset, maxHeight, matchAnchorWidth]`.

#### 2. `Popover.maxHeight` middleware-respected

Same edit as above. Behavior change:

- **Before**: `<Popover maxHeight={400}>` set `maxHeight: 400` on the floating element via inline style. The `size` middleware then wrote `maxHeight = availableHeight - 20` on every `autoUpdate` cycle, racing the inline style.
- **After**: numeric `maxHeight` is honored as a strict upper cap. Middleware writes `min(400, availableHeight - 20)` consistently. No oscillation.
- **String `maxHeight` (e.g. `"50vh"`)**: continues to flow through inline style — middleware can't compute against a string. To preserve this path, keep the inline override only when `maxHeight` is a string:

```tsx
style={{ ...floatingStyles, zIndex: 1000, ...(typeof maxHeight === "string" ? { maxHeight } : {}) }}
```

#### 3. New UIKit primitive: `ListItem`

Create [src/renderer/uikit/ListItem/ListItem.tsx](../../../src/renderer/uikit/ListItem/ListItem.tsx):

```tsx
import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize, spacing } from "../tokens";

export interface ListItemProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    /** Highlighted/selected state. Driven by JS (e.g. arrow-key navigation) — overrides hover. */
    active?: boolean;
    /** Disabled state — dimmed and non-interactive. */
    disabled?: boolean;
    children?: React.ReactNode;
}

const Root = styled.div(
    {
        padding: `${spacing.sm}px ${spacing.md}px`,
        fontSize: fontSize.md,
        lineHeight: "20px",
        cursor: "pointer",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        userSelect: "none",

        "&[data-active]": {
            backgroundColor: color.background.selection,
            color: color.text.selection,
        },
        "&[data-disabled]": {
            opacity: 0.4,
            pointerEvents: "none",
        },
    },
    { label: "ListItem" },
);

export const ListItem = React.forwardRef<HTMLDivElement, ListItemProps>(
    function ListItem({ active, disabled, children, ...rest }, ref) {
        return (
            <Root
                ref={ref}
                data-type="list-item"
                data-active={active || undefined}
                data-disabled={disabled || undefined}
                role="option"
                aria-selected={active || undefined}
                {...rest}
            >
                {children}
            </Root>
        );
    },
);
```

Plus [src/renderer/uikit/ListItem/index.ts](../../../src/renderer/uikit/ListItem/index.ts):

```ts
export { ListItem } from "./ListItem";
export type { ListItemProps } from "./ListItem";
```

And export from [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts):

```ts
export { ListItem } from "./ListItem";
export type { ListItemProps } from "./ListItem";
```

`role="option"` + `aria-selected` is appropriate even though there's no enclosing `role="listbox"` here — the URL input owns keyboard nav, not the dropdown. When a future `ListBox` UIKit component lands, it can be wrapped around `ListItem` rows without changing them.

The styling intentionally has **no `:hover` rule** — `active` is the only highlighted state, and it is driven externally by `hoveredIndex` from JS (which is also updated by `onMouseEnter`). This matches the suggestions dropdown's "hover and arrow keys produce the same visual" semantic. Future consumers that want true mouse-hover styling can add it inside their parent (or a dedicated `MenuItem` primitive can be derived from `ListItem` with a `:hover` rule).

### Rule 7 boundary recap

[uikit/CLAUDE.md Rule 7](../../../src/renderer/uikit/CLAUDE.md) forbids in app code:

1. `import styled from "@emotion/styled"` (absolute)
2. `import { css } from "@emotion/css"` (absolute)
3. `style={…}` on a UIKit component
4. `className={…}` on a UIKit component

It does **not** forbid:

- `style={…}` on raw HTML elements (the migrated file has none — it uses Panel/Text/Button/ListItem/Popover throughout)
- importing `color` from `theme/color.ts` (still required only if raw elements appear; this migration removes them)

After migration, `UrlSuggestionsDropdown.tsx` contains zero Emotion imports, zero `style=`/`className=` on UIKit components, and zero `color` imports (no raw elements need theme tokens).

### Visual drift accepted in the migration

| Drift | Old | New | Reason |
|---|---|---|---|
| Header label font size | 11px | 12px (`Text size="xs"`) | UIKit `fontSize.xs` is 12 (per [tokens.ts](../../../src/renderer/uikit/tokens.ts) — note `xs` and `sm` are intentionally both 12; 11px is hard to read in monospace). |
| Clear button font size | 11px | 12px (`Button size="sm"`) | UIKit standard for `size="sm"`. Same drift as US-463's "Clear" button. |
| Header gap | flex-1 on label + nothing | flex Spacer between label and Clear button | Same visual result. |
| Floating element offset | `[2]` (mainAxis 2) | `[0, 2]` (skidding 0, distance 2) | `Popover.offset` is `[skidding, distance]`. Distance 2 matches legacy. |
| Viewport edge gap | 10px | 20px (`availableHeight - 20`) | Popover-built-in. Matches US-463 / US-462 / US-461. 10px more breathing room — visually neutral. |

### Files involved

| File | Role | Change |
|------|------|--------|
| [src/renderer/uikit/Popover/Popover.tsx](../../../src/renderer/uikit/Popover/Popover.tsx) | Popover overlay primitive | Add `matchAnchorWidth?: boolean`. Refactor `size` middleware to respect numeric `maxHeight` and to apply width matching. Drop numeric branch from inline `maxHeight` override. |
| [src/renderer/uikit/Popover/Popover.story.tsx](../../../src/renderer/uikit/Popover/Popover.story.tsx) | Popover story | Add `matchAnchorWidth` prop entry. |
| [src/renderer/uikit/ListItem/ListItem.tsx](../../../src/renderer/uikit/ListItem/ListItem.tsx) | New UIKit primitive | Create. Selectable row with `data-active` styling, `role="option"`, `forwardRef`. |
| [src/renderer/uikit/ListItem/index.ts](../../../src/renderer/uikit/ListItem/index.ts) | New UIKit barrel | Create — re-export `ListItem` and `ListItemProps`. |
| [src/renderer/uikit/ListItem/ListItem.story.tsx](../../../src/renderer/uikit/ListItem/ListItem.story.tsx) | New UIKit story | Create — props: `active`, `disabled`, `children` (text sample). |
| [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) | UIKit public exports | Add `ListItem` + `ListItemProps`. |
| [src/renderer/editors/browser/UrlSuggestionsDropdown.tsx](../../../src/renderer/editors/browser/UrlSuggestionsDropdown.tsx) | URL suggestions dropdown | **Rewrite** — same external prop interface, internals use `Popover` + `Panel` + `Text` + `Button` + `Spacer` + `ListItem`. Drop `@emotion/styled`, `useFloating`, `createPortal`, `useMergeRefs`, `clsx`, `color` import, `highlightText` (inline equivalent renders matched parts as `<Text bold>`). |
| [doc/active-work.md](../../active-work.md) | Dashboard | Convert US-464 line to a markdown link to this README. |

### Files NOT changed

- [src/renderer/editors/browser/BrowserEditorView.tsx](../../../src/renderer/editors/browser/BrowserEditorView.tsx) — caller of `UrlSuggestionsDropdown`. The external prop interface is unchanged, so the JSX render at lines 780-790 is untouched. The `urlBar.urlInputRef?.closest('.url-bar') ?? null` anchor lookup stays — `.url-bar` is still a className on the legacy `<TextField>` until the URL bar itself is migrated to UIKit (separate future task).
- [src/renderer/editors/browser/BrowserUrlBarModel.ts](../../../src/renderer/editors/browser/BrowserUrlBarModel.ts) — owns `suggestionsOpen` / `hoveredIndex` / `urlInputRef` and all open/close transitions. No changes needed.
- [src/renderer/components/basic/useHighlightedText.tsx](../../../src/renderer/components/basic/useHighlightedText.tsx) — `highlightText` is consumed by 40+ other files. Don't touch. The migrated file inlines its own equivalent (concern #5).
- [src/renderer/components/overlay/Popper.tsx](../../../src/renderer/components/overlay/Popper.tsx) — legacy `Popper` is not used by `UrlSuggestionsDropdown` (the legacy file uses `useFloating` directly). No reference change needed.
- All theme files, tokens, icons, browser editor model — unchanged.

## Implementation plan

### Step 1 — Extend `Popover` with `matchAnchorWidth` and middleware-respected `maxHeight`

Edit [src/renderer/uikit/Popover/Popover.tsx](../../../src/renderer/uikit/Popover/Popover.tsx):

- Add `matchAnchorWidth?: boolean` to `PopoverProps`.
- Destructure it in the component body alongside `maxHeight`.
- Replace the `size` middleware body with:

  ```tsx
  size({
      apply({
          availableHeight,
          rects,
          elements,
      }: {
          availableHeight: number;
          rects: { reference: { width: number } };
          elements: { floating: HTMLElement };
      }) {
          const numericMax = typeof maxHeight === "number" ? maxHeight : Infinity;
          const finalMaxH = Math.min(numericMax, Math.max(100, availableHeight - 20));
          const styles: Record<string, string> = {
              maxHeight: `${finalMaxH}px`,
          };
          if (matchAnchorWidth) {
              styles.width = `${rects.reference.width}px`;
          }
          Object.assign(elements.floating.style, styles);
      },
  }),
  ```

- Update the `middleware` `useMemo` dependency array to `[offset, maxHeight, matchAnchorWidth]`.
- Update the inline style on `<Root>`:

  ```tsx
  style={{
      ...floatingStyles,
      zIndex: 1000,
      ...(typeof maxHeight === "string" ? { maxHeight } : {}),
  }}
  ```

  (Numeric `maxHeight` is now owned by the middleware; string `maxHeight` continues to flow through inline style for `vh`/`%`/`auto` use cases.)

### Step 2 — Update `Popover` story

[src/renderer/uikit/Popover/Popover.story.tsx](../../../src/renderer/uikit/Popover/Popover.story.tsx) — add a `matchAnchorWidth` boolean prop entry. Verify in Storybook that toggling it widens the floating element to the anchor's width.

### Step 3 — Create `ListItem` UIKit primitive

Create [src/renderer/uikit/ListItem/ListItem.tsx](../../../src/renderer/uikit/ListItem/ListItem.tsx) with the body shown in [UIKit extensions added in this task → 3](#3-new-uikit-primitive-listitem). Create [src/renderer/uikit/ListItem/index.ts](../../../src/renderer/uikit/ListItem/index.ts) re-exporting `ListItem` and `ListItemProps`.

### Step 4 — Add `ListItem` to UIKit public exports

Edit [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) — add:

```ts
export { ListItem } from "./ListItem";
export type { ListItemProps } from "./ListItem";
```

Place under "Bootstrap components" alongside `Text` (or under a new "List" section if preferred — to be decided when `ListBox` lands).

### Step 5 — Create `ListItem` story

Create [src/renderer/uikit/ListItem/ListItem.story.tsx](../../../src/renderer/uikit/ListItem/ListItem.story.tsx) — props: `active` (boolean), `disabled` (boolean), child content (string). Verify in Storybook that `active` flips the row to selection colors and `disabled` dims and disables interaction.

### Step 6 — Rewrite `UrlSuggestionsDropdown.tsx`

Replace the entire file body. Same external prop interface; UIKit internals.

```tsx
import React, { useEffect, useRef } from "react";
import { Popover, Panel, Text, Button, Spacer, ListItem } from "../../uikit";

export type SuggestionsMode = "search" | "navigation";

export interface UrlSuggestionsDropdownProps {
    anchorEl: Element | null;
    open: boolean;
    items: string[];
    mode: SuggestionsMode;
    searchText?: string;
    hoveredIndex: number;
    onHoveredIndexChange: (index: number) => void;
    onSelect: (value: string) => void;
    onClearVisible?: () => void;
}

export function UrlSuggestionsDropdown({
    anchorEl,
    open,
    items,
    mode,
    searchText,
    hoveredIndex,
    onHoveredIndexChange,
    onSelect,
    onClearVisible,
}: UrlSuggestionsDropdownProps) {
    const popoverRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (hoveredIndex < 0 || !popoverRef.current) return;
        const itemEls = popoverRef.current.querySelectorAll('[data-type="list-item"]');
        itemEls[hoveredIndex]?.scrollIntoView({ block: "nearest" });
    }, [hoveredIndex]);

    const isOpen = open && anchorEl != null && items.length > 0;
    const showClear = mode === "search" && onClearVisible != null;
    const headerLabel = mode === "search" ? "Search History" : "Navigation History";

    return (
        <Popover
            ref={popoverRef}
            open={isOpen}
            elementRef={anchorEl}
            placement="bottom-start"
            offset={[0, 2]}
            matchAnchorWidth
            maxHeight={400}
            onMouseDown={(e) => e.preventDefault()}
        >
            <Panel direction="row" align="center" paddingY="sm" paddingX="md">
                <Text size="xs" color="light">{headerLabel}</Text>
                <Spacer />
                {showClear && (
                    <Button size="sm" variant="ghost" onClick={onClearVisible}>
                        Clear
                    </Button>
                )}
            </Panel>
            {items.map((item, index) => (
                <ListItem
                    key={item}
                    active={index === hoveredIndex || undefined}
                    onClick={() => onSelect(item)}
                    onMouseEnter={() => onHoveredIndexChange(index)}
                >
                    {mode === "search" && searchText
                        ? renderHighlighted(item, searchText)
                        : item}
                </ListItem>
            ))}
        </Popover>
    );
}

// --- Highlighted-text renderer (per-screen helper, replaces highlightText) ---

function renderHighlighted(text: string, searchText: string): React.ReactNode {
    const tokens = searchText.split(" ").map((s) => s.trim()).filter((s) => s);
    if (tokens.length === 0) return text;
    return renderHighlightedRecursive(text, tokens);
}

function renderHighlightedRecursive(text: string, tokens: string[]): React.ReactNode {
    if (tokens.length === 0) return text;
    const [head, ...rest] = tokens;
    const escaped = head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(`(${escaped})`, "gi");
    return text.split(expression).map((part, i) => {
        if (part.match(expression)) {
            return <Text key={i} bold size="md">{part}</Text>;
        }
        return (
            <React.Fragment key={i}>
                {renderHighlightedRecursive(part, rest)}
            </React.Fragment>
        );
    });
}
```

Notes:

- `<Popover open={isOpen} ...>` — when `isOpen` is false, the Popover renders nothing (existing behavior). No need for an outer early-return.
- `onClose` is intentionally not passed. Click-outside / Escape are owned by the URL input (focus loss → blur, Escape → keydown handler in `BrowserUrlBarModel`). The Popover's internal listeners no-op without `onClose`.
- `onMouseDown={(e) => e.preventDefault()}` is forwarded via `Popover`'s HTMLAttributes passthrough to the inner `Root` div. Prevents focus loss on URL input when the user clicks inside the dropdown.
- The Clear button uses `onClick` (not `onMouseDown` like the legacy). The dropdown root's `preventDefault` already prevents focus loss; the click then fires `onClearVisible`. No `stopPropagation` needed — there's no outer listener that would be problematic.
- `renderHighlighted` is a local helper (~15 lines). Returns `<Text bold size="md">` for matched parts. Plain string fragments render through `ListItem`'s default font sizing. Nested-token recursion preserves `highlightText`'s multi-token behavior (the legacy supports `"foo bar"` → highlight both `foo` and `bar`).
- `useEffect` for `scrollIntoView` queries `[data-type="list-item"]` instead of `.suggestion-item` — UIKit pattern (uikit/CLAUDE.md Rule 1).
- `popoverRef` is forwarded into `Popover` — verified that `Popover` is `forwardRef<HTMLDivElement>` ([Popover.tsx:68](../../../src/renderer/uikit/Popover/Popover.tsx#L68)) so the ref reaches the inner `Root` for `querySelectorAll`.

### Step 7 — Verify caller in `BrowserEditorView.tsx`

[src/renderer/editors/browser/BrowserEditorView.tsx](../../../src/renderer/editors/browser/BrowserEditorView.tsx) at lines 780-790 — confirm the JSX render matches the unchanged prop interface. No code change expected. Verify by inspection that:

- `anchorEl={urlBar.urlInputRef?.closest('.url-bar') ?? null}` still resolves to the URL bar container (the `.url-bar` className is still on the legacy `<TextField>` at line 578).
- `open`, `items`, `mode`, `searchText`, `hoveredIndex`, `onHoveredIndexChange`, `onSelect`, `onClearVisible` are all wired through unchanged.

### Step 8 — TypeScript check

Run `npx tsc --noEmit` and confirm no new errors on:

- `src/renderer/uikit/Popover/Popover.tsx`
- `src/renderer/uikit/ListItem/ListItem.tsx`
- `src/renderer/uikit/index.ts`
- `src/renderer/editors/browser/UrlSuggestionsDropdown.tsx`

Specific things to verify:

- `<Popover ref={popoverRef} ...>` typechecks (Popover is `forwardRef<HTMLDivElement, PopoverProps>`).
- `onMouseDown={(e) => e.preventDefault()}` on `<Popover>` typechecks (HTMLAttributes passthrough).
- `<ListItem onMouseEnter={...} onClick={...} active={... || undefined}>` typechecks.
- `BrowserEditorView` still imports `UrlSuggestionsDropdown` and renders it without prop errors.

### Step 9 — Manual smoke test (user)

User performs the smoke checks listed in Acceptance Criteria below.

### Step 10 — Update dashboard

Edit [doc/active-work.md](../../active-work.md):

- Change line 34 from plain text `- [ ] US-464: UrlSuggestionsDropdown — UIKit migration *(Phase 4 — per-screen migration)*` to a markdown link to this README:

  ```markdown
  - [ ] [US-464: UrlSuggestionsDropdown — UIKit migration](tasks/US-464-url-suggestions-dropdown-migration/README.md) *(Phase 4 — per-screen migration)*
  ```

(This step happens at task-doc creation time per CLAUDE.md, so it's already part of step 0.)

## Concerns / Open questions

All resolved before implementation.

### 1. Why not refactor as imperative `showUrlSuggestions(...)` like US-463? — RESOLVED: stays as JSX component

US-463 inverted lifecycle ownership for `BrowserDownloadsPopup` because the popup's open state was managed externally by `BrowserEditorView` for no good reason. UrlSuggestionsDropdown is the opposite: `suggestionsOpen` lives on `BrowserEditorModel` for genuine reasons — it is reactively coupled to URL-input focus, the URL bar's keydown handler (Escape, Enter, arrow nav with `hoveredIndex`), `syncFromUrl`, and `handleNavigate`. Pulling that state into a private model inside the dropdown would either duplicate the coupling or break the reactive linkage. Stays as a JSX component. See "Why this is a parent-controlled JSX component, not an imperative module" above.

### 2. The dropdown has no `onClose` — does Popover work that way? — RESOLVED: yes

`Popover`'s click-outside / Escape listeners attach when `open=true` and call `onClose?.()`. When `onClose` is `undefined`, the calls no-op — the listeners exist but do nothing. This is acceptable for parent-controlled overlays. (A future micro-optimization would skip attaching the listeners when `onClose` is missing; out of scope here — irrelevant to behavior.) The URL input's `onBlur` and `handleUrlKeyDown` own all close transitions.

### 3. `Popover.maxHeight` is already a prop — why does it need a fix? — RESOLVED: middleware vs inline style race

Today, `maxHeight` is applied as an inline style on `<Root>`. The `size` middleware separately writes `maxHeight: ${availableHeight - 20}px` on every `autoUpdate` tick. After a React re-render, the user's value wins; on the next floating-ui update, the middleware overwrites it. The result is a race that, for the BrowserDownloadsPopup, happens to look fine because the popup doesn't pass numeric `maxHeight` directly to the Popover (it uses an inner `Panel maxHeight={400}` for the list area). For `UrlSuggestionsDropdown`, the dropdown itself must cap at 400 — relying on inline-style alone is unstable. The fix is one-line in the existing middleware: clamp at `min(userMax, availableHeight - 20)`. This is also the cleaner shape going forward.

### 4. Should `ListItem` have a real `:hover` rule? — RESOLVED: no, JS-driven only here

The suggestions dropdown's hover state is fully driven by `hoveredIndex` from JS — including from arrow-key navigation in the URL input (where there is no real mouse hover). Adding a CSS `:hover` rule would create two competing styles when the cursor is over a row but `hoveredIndex` is on a different row (e.g. user moves the cursor while typing, but arrow keys haven't fired yet). The legacy implementation made the same call — only `.hovered` (JS-driven) styles. Keep `ListItem` minimal: only `data-active` styling. A future `MenuItem` primitive (for menus where mouse hover *is* the source of truth) can add a `:hover` rule.

### 5. Should `highlightText` be moved into UIKit? — RESOLVED: no, inline a per-screen helper

`highlightText` (in [components/basic/useHighlightedText.tsx](../../../src/renderer/components/basic/useHighlightedText.tsx)) is consumed by ~40 files outside this screen. Migrating it would be a separate cross-cutting task (and would need to decide on a `<Text>`-based output vs the existing `<span className="highlighted-text">` shape). For US-464, inline a 15-line per-screen helper that emits `<Text bold size="md">` for matched parts. Doesn't bloat UIKit. Future cross-cutting migration of `highlightText` can absorb this helper.

### 6. The Clear button's `onMouseDown` + `stopPropagation` legacy quirk — preserve? — RESOLVED: drop, use plain `onClick`

The legacy `<span className="clear-btn" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onClearVisible(); }}>` does three things:

1. `preventDefault()` — prevents focus loss on URL input. **Already covered** by the dropdown root's `onMouseDown={(e) => e.preventDefault()}`.
2. `stopPropagation()` — prevents the dropdown root's outer mousedown handler from re-firing. The outer handler does the same thing (preventDefault), so stopPropagation here is redundant.
3. `onClearVisible()` — fires the action on mousedown. With the outer preventDefault still doing its job, the click event also fires correctly (mousedown's preventDefault doesn't suppress the click event itself, only the focus shift). Calling `onClearVisible` from `onClick` is equivalent.

So: the migrated Clear button uses plain `<Button onClick={onClearVisible}>` — simpler and correct. Manually verified the legacy sequence.

### 7. `popoverRef` for `scrollIntoView` — does Popover forward refs correctly? — RESOLVED: yes

[Popover.tsx:68](../../../src/renderer/uikit/Popover/Popover.tsx#L68) declares `forwardRef<HTMLDivElement, PopoverProps>`. The `useMergeRefs([refs.setFloating, ref, internalRef])` at line 134 correctly merges the user's ref with floating-ui's ref and the internal ref. Passing `ref={popoverRef}` from `UrlSuggestionsDropdown` reaches the inner `<Root>` div, on which `popoverRef.current.querySelectorAll('[data-type="list-item"]')` works.

### 8. The `.url-bar` className anchor — what happens when URL bar migrates? — RESOLVED: no change needed now

`urlBar.urlInputRef?.closest('.url-bar') ?? null` resolves the anchor by walking up to the parent with `.url-bar`. The class is still set on the legacy `<TextField>` at [BrowserEditorView.tsx:578](../../../src/renderer/editors/browser/BrowserEditorView.tsx#L578). When the URL bar itself migrates to UIKit `<Input>` (separate future task), that task will need to either preserve the `.url-bar` anchor handle (e.g. via a wrapping `<Panel data-url-bar>` and updating the `closest()` selector to `[data-url-bar]`) or restructure the anchor lookup to use a model-owned ref. Out of scope here.

### 9. ListItem under "Bootstrap components" or new "List" section in `index.ts`? — RESOLVED: under "Bootstrap components" for now

Place `ListItem` next to `Text` and `Divider`. When `ListBox` is later added, both can move under a new `// List` section together. Avoid premature reorganization.

### 10. Storybook story files — `.tsx` or `.ts` extension? — RESOLVED: match neighbors

Looking at the existing story files: `.story.tsx` for components that render JSX in their stories (Panel, IconButton, Tooltip, Popover, Spacer, Divider, Toolbar, SegmentedControl, Spinner, Button) and `.story.ts` for trivial primitives (Text, Input, Label, Checkbox). `ListItem` renders children — use `.story.tsx`.

## Acceptance criteria

1. `UrlSuggestionsDropdown.tsx` contains zero `@emotion/styled` imports, zero `useFloating` / `createPortal` / `useMergeRefs` / `clsx` / `color`-import / `highlightText` references. Its only React imports are `useEffect`, `useRef`, and (via JSX) UIKit components.
2. `UrlSuggestionsDropdown.tsx` exports `UrlSuggestionsDropdownProps` and `UrlSuggestionsDropdown` with the same external prop signature as today (`anchorEl`, `open`, `items`, `mode`, `searchText`, `hoveredIndex`, `onHoveredIndexChange`, `onSelect`, `onClearVisible`).
3. `Popover.tsx` exposes a `matchAnchorWidth?: boolean` prop. When true, the floating element's width matches the anchor element's width and updates on `autoUpdate`.
4. `Popover.tsx` `size` middleware respects numeric `maxHeight` as a strict upper cap (`min(maxHeight, availableHeight - 20)`). String `maxHeight` continues to flow through inline style.
5. UIKit exports `ListItem` (`data-type="list-item"`) with `active?: boolean` and `disabled?: boolean` props. Setting `active` switches background to `color.background.selection` and text to `color.text.selection`.
6. `BrowserEditorView.tsx` is unchanged — same JSX render of `UrlSuggestionsDropdown` at lines 780-790 still typechecks and runs.
7. `npx tsc --noEmit` reports no new errors on `Popover.tsx`, `ListItem.tsx`, `index.ts`, `UrlSuggestionsDropdown.tsx`, or `BrowserEditorView.tsx`.
8. **Smoke — open on focus**: Click into the URL bar (or press Ctrl+L). Suggestions dropdown opens beneath the URL bar, anchored bottom-start, 2px below the bar. Width matches the URL bar's width exactly. List shows up to 400px tall (or `availableHeight - 20`, whichever is smaller).
9. **Smoke — navigation history mode**: With an empty input on a tab that has navigation history, the header reads "Navigation History" and the items are the tab's nav history.
10. **Smoke — search history mode**: Start typing in the URL bar. The header switches to "Search History"; items are filtered search-history entries containing all typed words. The "Clear" button appears on the right of the header.
11. **Smoke — highlighted matches**: In search mode with a non-empty `searchText`, matching substrings of the query render bold inside each row (via `<Text bold>`); non-matching parts render in default weight.
12. **Smoke — JS-driven hover**: Move the mouse over a row — that row gets the selection background/text color. Move arrow keys in the URL input — `hoveredIndex` updates and the corresponding row highlights with no mouse movement. Both produce the same visual result.
13. **Smoke — scrollIntoView on keyboard nav**: Arrow-down past the visible window — the highlighted row scrolls into view. Arrow-up past the top — same behavior in reverse.
14. **Smoke — focus preserved on click inside dropdown**: With the URL bar focused and dropdown open, click anywhere inside the dropdown (header label, between rows, on a row, on the Clear button). The URL input retains focus (caret remains visible). Verifiable: `document.activeElement === urlInput` throughout.
15. **Smoke — click selects suggestion**: Click a row. `onSelect` fires with the row's value, which navigates to the URL and closes the dropdown via `handleSuggestionSelect`.
16. **Smoke — click Clear**: With the Clear button visible (search mode + items present + `onClearVisible` provided), click it. `handleClearVisible` runs — search history items shown in the dropdown are removed; the dropdown re-renders with the remaining items (which may be the empty list, in which case the dropdown unmounts because `items.length === 0`).
17. **Smoke — close on URL input blur**: Click anywhere outside the URL bar **and** outside the dropdown (e.g. into the page content or a different toolbar button). The URL input blurs → `handleUrlBlur` sets `suggestionsOpen=false` → dropdown unmounts.
18. **Smoke — close on Escape**: With dropdown open and URL input focused, press Escape. `handleUrlKeyDown` sets `suggestionsOpen=false` → dropdown unmounts. (Popover does not handle Escape itself — verify that the URL input handler runs.)
19. **Smoke — DevTools**: Inspect the dropdown. Root has `data-type="popover"` portaled to `<body>`. Header is a `data-type="panel"` row. Header label is `<Text data-type="text" data-size="xs" data-color="light">`. Clear button is `<Button data-type="button" data-variant="ghost" data-size="sm">`. Each row is `data-type="list-item"`. The active row has `data-active`. The dropdown's outer width attribute (in inline style) equals the URL bar's width.
20. **Smoke — themes**: Cycle `default-dark`, `light-modern`, `monokai`. Selection background/text, header label, Clear button, dropdown border, and shadow all update with theme.

## Files Changed summary

| File | Action | Notes |
|------|--------|-------|
| [src/renderer/uikit/Popover/Popover.tsx](../../../src/renderer/uikit/Popover/Popover.tsx) | Modify | Add `matchAnchorWidth?: boolean`. Refactor `size` middleware to respect numeric `maxHeight` and to apply width matching. Drop numeric branch from inline `maxHeight` override. |
| [src/renderer/uikit/Popover/Popover.story.tsx](../../../src/renderer/uikit/Popover/Popover.story.tsx) | Modify | Add `matchAnchorWidth` prop entry. |
| [src/renderer/uikit/ListItem/ListItem.tsx](../../../src/renderer/uikit/ListItem/ListItem.tsx) | Create | New UIKit primitive: selectable row with `data-active` styling, `role="option"`, `forwardRef`. |
| [src/renderer/uikit/ListItem/index.ts](../../../src/renderer/uikit/ListItem/index.ts) | Create | Re-export `ListItem` and `ListItemProps`. |
| [src/renderer/uikit/ListItem/ListItem.story.tsx](../../../src/renderer/uikit/ListItem/ListItem.story.tsx) | Create | Storybook entry for `ListItem` (props: `active`, `disabled`, child content). |
| [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) | Modify | Export `ListItem` and `ListItemProps`. |
| [src/renderer/editors/browser/UrlSuggestionsDropdown.tsx](../../../src/renderer/editors/browser/UrlSuggestionsDropdown.tsx) | Rewrite | Same external prop interface; UIKit composition (Popover + Panel + Text + Button + Spacer + ListItem). Inline `renderHighlighted` helper replaces `highlightText`. |
| [doc/active-work.md](../../active-work.md) | Modify | Convert US-464 line to a markdown link to this README. |
