# US-464: UrlSuggestionsDropdown — UIKit migration

## Goal

Migrate the browser address-bar suggestions dropdown to a pure UIKit composition. After this task, [src/renderer/editors/browser/UrlSuggestionsDropdown.tsx](../../../src/renderer/editors/browser/UrlSuggestionsDropdown.tsx) imports no `@emotion/styled`, sets no `style=`/`className=` on UIKit components, and expresses its layout entirely through `Popover` + `Panel` + `Text` + `Button` + the UIKit `ListBox` (from [US-468](../US-468-uikit-listbox/README.md)) for the suggestion rows.

The component **keeps its current external interface** (`UrlSuggestionsDropdown` JSX with `anchorEl`/`open`/`items`/`mode`/`searchText`/`hoveredIndex`/`onHoveredIndexChange`/`onSelect`/`onClearVisible` props). Unlike US-463 (BrowserDownloadsPopup), this dropdown is **not** restructured into an imperative `showSomething()` module — the open/close lifecycle is reactively driven by the URL input's focus/blur and the URL bar model's state, so a parent-controlled JSX component stays the right shape. See concern #1.

One small Popover addition lands with this task — reusable beyond this screen:

1. **`Popover.matchAnchorWidth?: boolean`** — when true, the size middleware sets the floating element's `width` to the anchor's width. Reusable by combobox / autocomplete / any anchor-matched dropdown.

Row infrastructure (virtualization, default `<ListItem>`, `searchText` highlighting via [`uikit/shared/highlight`](../../../src/renderer/uikit/shared/highlight.ts)) is supplied by US-468's `ListBox` and consumed here directly — no screen-local `ListItem` primitive is created.

Outer-height capping is delegated to `ListBox.growToHeight={400}` — the popover sizes to content (header + listbox), and the Popover's existing `size` middleware still enforces `availableHeight - 20` as a viewport-edge guard. No `Popover.maxHeight` is passed. See concern #3.

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
| `useFloating` + `ReactDOM.createPortal` + `DropdownRoot` styled.div with `backgroundColor: color.background.default`, `border: 1px solid color.border.default`, `borderRadius: 6`, `boxShadow: color.shadow.default`, `overflowY: auto`, `zIndex: 1000` | UIKit `<Popover open elementRef={anchorEl} placement="bottom-start" offset={[0, 2]} matchAnchorWidth onMouseDown={(e) => e.preventDefault()}>` | **`Popover.matchAnchorWidth` missing.** Add it as a `size`-middleware option. The Popover Root already matches every visual property (`backgroundColor`, `border`, `borderRadius: radius.lg = 6`, `boxShadow: shadow.default`, `overflow: auto`, `zIndex: 1000`) — no styling drift. Outer height capping is delegated to `ListBox.growToHeight={400}` instead of `Popover.maxHeight` (see concern #3). |
| `onMouseDown={(e) => e.preventDefault()}` on dropdown root | Same — passed via `Popover`'s `...rest` HTMLAttributes passthrough to its inner Root | none. Verified: `PopoverProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" \| "className">`, so `onMouseDown` is in the prop surface and forwarded. |
| Header — `<div className="suggestions-header">` flex row, padding 4/8, fontSize 11, color light, userSelect none | `<Panel direction="row" align="center" paddingY="sm" paddingX="md" gap="md">` | `paddingY="sm"`=4 (matches), `paddingX="md"`=8 (matches), `gap="md"`=6 (drift: legacy header uses `flex: 1` on the label rather than gap; gap is for the label-Spacer-button arrangement). |
| Header label `<span className="header-label">`, flex 1, "Search History" / "Navigation History" | `<Text size="xs" color="light">{label}</Text>` followed by `<Spacer />` to push Clear right | `size="xs"`=12 (drift: legacy 11 → 12, +1px). Acceptable. |
| `<span className="clear-btn">` cursor pointer, padding 0/4, borderRadius 3, hover `color.text.default` + `color.background.light` | `<Button size="sm" variant="ghost" onClick={onClearVisible}>Clear</Button>` | UIKit ghost button matches the flat-hover pattern. Drift: 12px font (UIKit Button size="sm") vs 11px legacy. Acceptable — same pattern accepted in US-463. |
| `<div className="suggestion-item">` repeated for each item — padding 4/8, fontSize 13, lineHeight 20px, ellipsis, hover sim via JS-driven `.hovered` class → `color.background.selection` bg + `color.text.selection` text | `<ListBox items={...} activeIndex={hoveredIndex} onActiveChange={onHoveredIndexChange} onChange={(v) => onSelect(v as string)} searchText={...} keyboardNav={false} growToHeight={400} />` | UIKit `ListBox` ([US-468](../US-468-uikit-listbox/README.md)) supplies row infrastructure: virtualized `RenderGrid`, default `<ListItem>` per row with `data-active` styling and ellipsis, plus `searchText` forwarding to [`uikit/shared/highlight`](../../../src/renderer/uikit/shared/highlight.ts). Drift: row height 24 (ListBox default) vs 28 legacy (4px padding + 20px line + 4px padding) — acceptable. |
| `<span className="highlighted-text">` for matched substrings, parent rule `& .highlighted-text { fontWeight: 600 }` | `<ListBox searchText={...}>` forwards to default `<ListItem>`, which calls `highlight()` from `uikit/shared/highlight` to emit `<strong>` around matched parts | `<strong>` renders bold by browser default (font-weight: 700) — visually equivalent to legacy 600. Semantic improvement. No screen-local helper needed. Concern #5. |
| Returning `null` when `!open \|\| !anchorEl \|\| items.length === 0` | `<Popover open={open && anchorEl != null && items.length > 0} ...>`. Popover already returns `null` when `open=false` or its position is unresolved. | none |
| `useEffect` to scroll the hovered item into view | `useEffect(() => listBoxRef.current?.scrollToIndex(hoveredIndex), [hoveredIndex])` — `ListBox` exposes `ListBoxRef.scrollToIndex(idx, align?)` via its forwarded ref. | Replaces legacy `querySelectorAll('[data-type="list-item"]')` lookup. RenderGrid's `scrollToRow` handles virtualized cases correctly. |

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

Extend the existing `size` middleware to write `width` when `matchAnchorWidth` is true; the existing `maxHeight: availableHeight - 20` write stays unchanged:

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
        const styles: Record<string, string> = {
            maxHeight: `${Math.max(100, availableHeight - 20)}px`,
        };
        if (matchAnchorWidth) {
            styles.width = `${rects.reference.width}px`;
        }
        Object.assign(elements.floating.style, styles);
    },
}),
```

The `useMemo` dependency for `middleware` extends to `[offset, matchAnchorWidth]`. The `maxHeight` inline-style override at `<Root>` is left untouched — that path still serves any caller passing `Popover.maxHeight`.

#### 2. ListBox usage (no new UIKit primitive)

Row rendering is delegated to UIKit `ListBox` (US-468). `ListBox` already:

- Wraps each row in [`ListItem`](../../../src/renderer/uikit/ListBox/ListItem.tsx) with `data-type="list-item"`, `role="option"`, ellipsis, and `&[data-active]` styling that maps to `color.background.selection` / `color.text.selection`.
- Forwards `searchText` into `highlight()` from [`uikit/shared/highlight`](../../../src/renderer/uikit/shared/highlight.ts), wrapping matched substrings in `<strong>`.
- Virtualizes via `RenderGrid` — only visible rows are mounted (matters for navigation-history mode, which can have 100s of entries).
- Exposes `ListBoxRef.scrollToIndex(idx, align?)` for the existing scroll-into-view-on-hover behavior.
- Honors `keyboardNav={false}` so the URL input retains keyboard ownership while the ListBox itself stays passive (no `tabIndex={0}`, no key handlers).

The dropdown uses `ListBox` directly with the default row renderer — no `renderItem` callback needed.

### Rule 7 boundary recap

[uikit/CLAUDE.md Rule 7](../../../src/renderer/uikit/CLAUDE.md) forbids in app code:

1. `import styled from "@emotion/styled"` (absolute)
2. `import { css } from "@emotion/css"` (absolute)
3. `style={…}` on a UIKit component
4. `className={…}` on a UIKit component

It does **not** forbid:

- `style={…}` on raw HTML elements (the migrated file has none — it uses Panel/Text/Button/ListBox/Popover throughout)
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
| [src/renderer/uikit/Popover/Popover.tsx](../../../src/renderer/uikit/Popover/Popover.tsx) | Popover overlay primitive | Add `matchAnchorWidth?: boolean`. Extend `size` middleware to also write anchor-matched `width` when set. Existing `maxHeight` write and inline-style override left unchanged. |
| [src/renderer/uikit/Popover/Popover.story.tsx](../../../src/renderer/uikit/Popover/Popover.story.tsx) | Popover story | Add `matchAnchorWidth` prop entry. |
| [src/renderer/editors/browser/UrlSuggestionsDropdown.tsx](../../../src/renderer/editors/browser/UrlSuggestionsDropdown.tsx) | URL suggestions dropdown | **Rewrite** — same external prop interface, internals use `Popover` + `Panel` + `Text` + `Button` + `Spacer` + `ListBox`. Drop `@emotion/styled`, `useFloating`, `createPortal`, `useMergeRefs`, `clsx`, `color` import, `highlightText`. |
| [doc/active-work.md](../../active-work.md) | Dashboard | Already linked at task-doc creation time. No further change. |

### Files NOT changed

- [src/renderer/uikit/ListBox/ListBox.tsx](../../../src/renderer/uikit/ListBox/ListBox.tsx) — already supplies all row infrastructure needed (US-468). Consumed as-is.
- [src/renderer/uikit/ListBox/ListItem.tsx](../../../src/renderer/uikit/ListBox/ListItem.tsx) — default per-row renderer used by `ListBox`. No changes.
- [src/renderer/uikit/shared/highlight.ts](../../../src/renderer/uikit/shared/highlight.ts) — already correct for `searchText` highlighting. No changes.
- [src/renderer/editors/browser/BrowserEditorView.tsx](../../../src/renderer/editors/browser/BrowserEditorView.tsx) — caller of `UrlSuggestionsDropdown`. The external prop interface is unchanged, so the JSX render at lines 780-790 is untouched. The `urlBar.urlInputRef?.closest('.url-bar') ?? null` anchor lookup stays — `.url-bar` is still a className on the legacy `<TextField>` until the URL bar itself is migrated to UIKit (separate future task).
- [src/renderer/editors/browser/BrowserUrlBarModel.ts](../../../src/renderer/editors/browser/BrowserUrlBarModel.ts) — owns `suggestionsOpen` / `hoveredIndex` / `urlInputRef` and all open/close transitions. No changes needed.
- [src/renderer/components/basic/useHighlightedText.tsx](../../../src/renderer/components/basic/useHighlightedText.tsx) — `highlightText` is consumed by 40+ other files. The migrated dropdown stops using it (replaced by `searchText` flowing into `ListBox`'s default ListItem). Don't touch.
- [src/renderer/components/overlay/Popper.tsx](../../../src/renderer/components/overlay/Popper.tsx) — legacy `Popper` is not used by `UrlSuggestionsDropdown` (the legacy file uses `useFloating` directly). No reference change needed.
- All theme files, tokens, icons, browser editor model — unchanged.

## Implementation plan

### Step 1 — Extend `Popover` with `matchAnchorWidth`

Edit [src/renderer/uikit/Popover/Popover.tsx](../../../src/renderer/uikit/Popover/Popover.tsx):

- Add `matchAnchorWidth?: boolean` to `PopoverProps`.
- Destructure it in the component body.
- Extend the existing `size` middleware body to also write `width` when `matchAnchorWidth` is set; keep the existing `maxHeight` write:

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
          const styles: Record<string, string> = {
              maxHeight: `${Math.max(100, availableHeight - 20)}px`,
          };
          if (matchAnchorWidth) {
              styles.width = `${rects.reference.width}px`;
          }
          Object.assign(elements.floating.style, styles);
      },
  }),
  ```

- Update the `middleware` `useMemo` dependency array from `[offset]` to `[offset, matchAnchorWidth]`.
- The inline `style={{ ...floatingStyles, zIndex: 1000, ...(maxHeight ? { maxHeight } : {}) }}` on `<Root>` is left unchanged. The `Popover.maxHeight` race documented in concern #3 is real but does not affect this task — `UrlSuggestionsDropdown` does not pass `maxHeight` to Popover.

### Step 2 — Update `Popover` story

[src/renderer/uikit/Popover/Popover.story.tsx](../../../src/renderer/uikit/Popover/Popover.story.tsx) — add a `matchAnchorWidth` boolean prop entry. Verify in Storybook that toggling it widens the floating element to the anchor's width.

### Step 3 — Rewrite `UrlSuggestionsDropdown.tsx`

Replace the entire file body. Same external prop interface; UIKit internals — `Popover` + `Panel` + `Text` + `Button` + `Spacer` + `ListBox`.

```tsx
import React, { useEffect, useMemo, useRef } from "react";
import { Popover, Panel, Text, Button, Spacer, ListBox } from "../../uikit";
import type { IListBoxItem, ListBoxRef } from "../../uikit";

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
    const listBoxRef = useRef<ListBoxRef | null>(null);

    const listItems = useMemo<IListBoxItem[]>(
        () => items.map((s) => ({ value: s, label: s })),
        [items],
    );

    useEffect(() => {
        if (hoveredIndex < 0) return;
        listBoxRef.current?.scrollToIndex(hoveredIndex);
    }, [hoveredIndex]);

    const isOpen = open && anchorEl != null && items.length > 0;
    const showClear = mode === "search" && onClearVisible != null;
    const headerLabel = mode === "search" ? "Search History" : "Navigation History";

    return (
        <Popover
            open={isOpen}
            elementRef={anchorEl}
            placement="bottom-start"
            offset={[0, 2]}
            matchAnchorWidth
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
            <ListBox
                ref={listBoxRef}
                items={listItems}
                activeIndex={hoveredIndex}
                onActiveChange={onHoveredIndexChange}
                onChange={(value) => onSelect(value as string)}
                searchText={mode === "search" ? searchText : undefined}
                keyboardNav={false}
                growToHeight={400}
            />
        </Popover>
    );
}
```

Notes:

- `<Popover open={isOpen} ...>` — when `isOpen` is false, the Popover renders nothing (existing behavior). No need for an outer early-return.
- `onClose` is intentionally not passed. Click-outside / Escape are owned by the URL input (focus loss → blur, Escape → keydown handler in `BrowserUrlBarModel`). The Popover's internal listeners no-op without `onClose`.
- `onMouseDown={(e) => e.preventDefault()}` is forwarded via `Popover`'s HTMLAttributes passthrough to the inner `Root` div. Prevents focus loss on URL input when the user clicks inside the dropdown.
- The Clear button uses `onClick` (not `onMouseDown` like the legacy). The dropdown root's `preventDefault` already prevents focus loss; the click then fires `onClearVisible`. No `stopPropagation` needed — there's no outer listener that would be problematic.
- `listItems` is a `useMemo`-wrapped projection of `items: string[]` to `IListBoxItem[]` (`{ value, label }`). Stable across re-renders when `items` is unchanged, so ListBox's internal `RenderGrid` does not re-mount.
- `searchText` is passed to `ListBox` only in `search` mode. Default `<ListItem>` calls [`uikit/shared/highlight`](../../../src/renderer/uikit/shared/highlight.ts) which wraps matched substrings in `<strong>`. Multi-token matching (`"foo bar"`) is preserved.
- `keyboardNav={false}` — URL input continues to drive `hoveredIndex` from outside via its own `onKeyDown`. ListBox stays passive (no `tabIndex={0}`).
- `growToHeight={400}` — ListBox grows to fit content up to 400px. Few items → short dropdown; many items → ListBox virtualizes inside its 400px window. The popover sizes naturally to (header + listbox) — no `Popover.maxHeight` is passed; the popover's existing `size` middleware still enforces `availableHeight - 20` as a viewport-edge guard.
- `listBoxRef.current?.scrollToIndex(hoveredIndex)` replaces the legacy `querySelectorAll('[data-type="list-item"]')` lookup. Works correctly with virtualization (RenderGrid handles off-screen rows).

### Step 4 — Verify caller in `BrowserEditorView.tsx`

[src/renderer/editors/browser/BrowserEditorView.tsx](../../../src/renderer/editors/browser/BrowserEditorView.tsx) at lines 780-790 — confirm the JSX render matches the unchanged prop interface. No code change expected. Verify by inspection that:

- `anchorEl={urlBar.urlInputRef?.closest('.url-bar') ?? null}` still resolves to the URL bar container (the `.url-bar` className is still on the legacy `<TextField>` at line 578).
- `open`, `items`, `mode`, `searchText`, `hoveredIndex`, `onHoveredIndexChange`, `onSelect`, `onClearVisible` are all wired through unchanged.

### Step 5 — TypeScript check

Run `npx tsc --noEmit` and confirm no new errors on:

- `src/renderer/uikit/Popover/Popover.tsx`
- `src/renderer/editors/browser/UrlSuggestionsDropdown.tsx`

Specific things to verify:

- `<Popover ref=... matchAnchorWidth ...>` typechecks (after the new prop is added).
- `onMouseDown={(e) => e.preventDefault()}` on `<Popover>` typechecks (HTMLAttributes passthrough).
- `<ListBox ref={listBoxRef} items={listItems} ... />` typechecks. `listBoxRef` typed as `useRef<ListBoxRef | null>(null)`. `listItems` typed as `IListBoxItem[]`.
- `onChange={(value) => onSelect(value as string)}` is needed because `IListBoxItem.value` is `string | number`; the cast is safe because all `value`s come from `items: string[]`.
- `BrowserEditorView` still imports `UrlSuggestionsDropdown` and renders it without prop errors.

### Step 6 — Manual smoke test (user)

User performs the smoke checks listed in Acceptance Criteria below.

## Concerns / Open questions

All resolved before implementation.

### 1. Why not refactor as imperative `showUrlSuggestions(...)` like US-463? — RESOLVED: stays as JSX component

US-463 inverted lifecycle ownership for `BrowserDownloadsPopup` because the popup's open state was managed externally by `BrowserEditorView` for no good reason. UrlSuggestionsDropdown is the opposite: `suggestionsOpen` lives on `BrowserEditorModel` for genuine reasons — it is reactively coupled to URL-input focus, the URL bar's keydown handler (Escape, Enter, arrow nav with `hoveredIndex`), `syncFromUrl`, and `handleNavigate`. Pulling that state into a private model inside the dropdown would either duplicate the coupling or break the reactive linkage. Stays as a JSX component. See "Why this is a parent-controlled JSX component, not an imperative module" above.

### 2. The dropdown has no `onClose` — does Popover work that way? — RESOLVED: yes

`Popover`'s click-outside / Escape listeners attach when `open=true` and call `onClose?.()`. When `onClose` is `undefined`, the calls no-op — the listeners exist but do nothing. This is acceptable for parent-controlled overlays. (A future micro-optimization would skip attaching the listeners when `onClose` is missing; out of scope here — irrelevant to behavior.) The URL input's `onBlur` and `handleUrlKeyDown` own all close transitions.

### 3. The `Popover.maxHeight` middleware-vs-inline-style race — fix it here? — RESOLVED: deferred, doesn't affect this task

There is a real race in `Popover.tsx`: numeric `maxHeight` is written via inline style on `<Root>`, and the `size` middleware separately writes `maxHeight: ${availableHeight - 20}px` on every `autoUpdate` tick. After a React re-render, the user's value wins; on the next floating-ui update, the middleware overwrites it.

This bug does not affect any current consumer:

- `BrowserDownloadsPopup` caps via an inner `Panel.maxHeight={400}` rather than `Popover.maxHeight`.
- `UrlSuggestionsDropdown` (this task) caps via `ListBox.growToHeight={400}` and does not pass `Popover.maxHeight` at all.

So fixing the race adds no observable behavior change for either consumer. We leave it as cleanup for a future Popover refactor task. If a third consumer ever needs `Popover.maxHeight` to be a strict cap, the fix is a one-liner in the middleware (`Math.min(numericMax, availableHeight - 20)`).

### 4. Should `ListItem` have a real `:hover` rule? — RESOLVED in US-468: no

Settled while building UIKit `ListItem`. The default ListItem has no `:hover` rule — only `&[data-active]`. The dropdown's mouse-hover effect comes from `ListBox`'s `onActiveChange` firing on `mouseEnter` (which updates `hoveredIndex`), not from CSS `:hover`. This is exactly the "hover and arrow keys produce the same visual" semantic this dropdown needs.

### 5. Should `highlight` be moved into UIKit? — RESOLVED in US-468: yes, lives at `uikit/shared/highlight`

Resolved during US-468. The helper is at [src/renderer/uikit/shared/highlight.ts](../../../src/renderer/uikit/shared/highlight.ts) and is wired into the default `<ListItem>` via the `searchText` prop. The migrated dropdown stops importing `highlightText` from `components/basic/useHighlightedText.tsx` — `searchText` flows into `ListBox` and the wrapping happens automatically. Drift vs legacy: matched parts render in `<strong>` (browser default font-weight: 700) instead of `<span className="highlighted-text"> { font-weight: 600 }`. Visually equivalent in monospace; semantically improved.

### 6. The Clear button's `onMouseDown` + `stopPropagation` legacy quirk — preserve? — RESOLVED: drop, use plain `onClick`

The legacy `<span className="clear-btn" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onClearVisible(); }}>` does three things:

1. `preventDefault()` — prevents focus loss on URL input. **Already covered** by the dropdown root's `onMouseDown={(e) => e.preventDefault()}`.
2. `stopPropagation()` — prevents the dropdown root's outer mousedown handler from re-firing. The outer handler does the same thing (preventDefault), so stopPropagation here is redundant.
3. `onClearVisible()` — fires the action on mousedown. With the outer preventDefault still doing its job, the click event also fires correctly (mousedown's preventDefault doesn't suppress the click event itself, only the focus shift). Calling `onClearVisible` from `onClick` is equivalent.

So: the migrated Clear button uses plain `<Button onClick={onClearVisible}>` — simpler and correct. Manually verified the legacy sequence.

### 7. ListBox ref forwarding for `scrollToIndex` — does it work? — RESOLVED in US-468: yes

`ListBox` is exported via [`forwardRef(ListBoxInner) as <T>(...) => ReactElement | null`](../../../src/renderer/uikit/ListBox/ListBox.tsx) and uses `useImperativeHandle` to expose `scrollToIndex(index, align?)`. Passing `ref={listBoxRef}` with `useRef<ListBoxRef | null>(null)` typechecks and the call reaches the underlying `RenderGridModel.scrollToRow`. Verified in the US-468 storybook.

### 8. The `.url-bar` className anchor — what happens when URL bar migrates? — RESOLVED: no change needed now

`urlBar.urlInputRef?.closest('.url-bar') ?? null` resolves the anchor by walking up to the parent with `.url-bar`. The class is still set on the legacy `<TextField>` at [BrowserEditorView.tsx:578](../../../src/renderer/editors/browser/BrowserEditorView.tsx#L578). When the URL bar itself migrates to UIKit `<Input>` (separate future task), that task will need to either preserve the `.url-bar` anchor handle (e.g. via a wrapping `<Panel data-url-bar>` and updating the `closest()` selector to `[data-url-bar]`) or restructure the anchor lookup to use a model-owned ref. Out of scope here.

### 9. Why `growToHeight={400}` on ListBox instead of `Popover.maxHeight={400}`? — RESOLVED: simpler, ListBox already handles content measurement

ListBox's Root is `flex: 1 1 auto` — without a parent that has a defined height, flex sizing collapses and `RenderGrid` has no viewport. `growToHeight` is the property that lets the list size itself to its content (up to a cap) without needing a fixed-height parent. With only `ListBox.growToHeight={400}` and no outer `Popover.maxHeight`:

- Few items → popover height = header + listbox content (e.g. ~24 + 72 = ~96px). Natural fit.
- Many items → listbox caps at 400 with internal RenderGrid virtualization; popover height = ~24 + 400 = ~424px (~24px taller than legacy 400, visually negligible).
- Small viewport → Popover's existing `size` middleware enforces `availableHeight - 20`, clipping the popover. The ListBox's internal scroll handles overflow inside its window. (One scrollbar, on the ListBox.)

This avoids the double-cap (`Popover.maxHeight` + `ListBox.growToHeight`) and sidesteps the `Popover.maxHeight` race entirely (concern #3). One concept to reason about, one place to tune.

## Acceptance criteria

1. `UrlSuggestionsDropdown.tsx` contains zero `@emotion/styled` imports, zero `useFloating` / `createPortal` / `useMergeRefs` / `clsx` / `color`-import / `highlightText` references. Its only React imports are `useEffect`, `useMemo`, `useRef`, and (via JSX) UIKit components.
2. `UrlSuggestionsDropdown.tsx` exports `UrlSuggestionsDropdownProps` and `UrlSuggestionsDropdown` with the same external prop signature as today (`anchorEl`, `open`, `items`, `mode`, `searchText`, `hoveredIndex`, `onHoveredIndexChange`, `onSelect`, `onClearVisible`).
3. `Popover.tsx` exposes a `matchAnchorWidth?: boolean` prop. When true, the floating element's width matches the anchor element's width and updates on `autoUpdate`.
4. `BrowserEditorView.tsx` is unchanged — same JSX render of `UrlSuggestionsDropdown` at lines 780-790 still typechecks and runs.
5. `npx tsc --noEmit` reports no new errors on `Popover.tsx`, `UrlSuggestionsDropdown.tsx`, or `BrowserEditorView.tsx`.
6. **Smoke — open on focus**: Click into the URL bar (or press Ctrl+L). Suggestions dropdown opens beneath the URL bar, anchored bottom-start, 2px below the bar. Width matches the URL bar's width exactly. The list area inside the popover shows up to 400px tall (`ListBox.growToHeight`); the popover itself caps at `availableHeight - 20` via Popover's existing middleware.
7. **Smoke — navigation history mode**: With an empty input on a tab that has navigation history, the header reads "Navigation History" and the items are the tab's nav history.
8. **Smoke — search history mode**: Start typing in the URL bar. The header switches to "Search History"; items are filtered search-history entries containing all typed words. The "Clear" button appears on the right of the header.
9. **Smoke — highlighted matches**: In search mode with a non-empty `searchText`, matching substrings of the query render bold inside each row (wrapped in `<strong>` by `uikit/shared/highlight`); non-matching parts render in default weight.
10. **Smoke — JS-driven hover**: Move the mouse over a row — that row gets the selection background/text color (via ListBox's `onActiveChange` updating `hoveredIndex`). Move arrow keys in the URL input — `hoveredIndex` updates and the corresponding row highlights with no mouse movement. Both produce the same visual result.
11. **Smoke — scroll-to-index on keyboard nav**: Arrow-down past the visible window — `listBoxRef.current.scrollToIndex(hoveredIndex)` brings the highlighted row into view. Arrow-up past the top — same behavior in reverse. Works correctly with virtualization (rows beyond the rendered window scroll into view, render, and gain `data-active`).
12. **Smoke — focus preserved on click inside dropdown**: With the URL bar focused and dropdown open, click anywhere inside the dropdown (header label, between rows, on a row, on the Clear button). The URL input retains focus (caret remains visible). Verifiable: `document.activeElement === urlInput` throughout.
13. **Smoke — click selects suggestion**: Click a row. `ListBox` fires `onChange(value, item)`; the dropdown forwards `value as string` to `onSelect`, which navigates to the URL and closes the dropdown via `handleSuggestionSelect`.
14. **Smoke — click Clear**: With the Clear button visible (search mode + items present + `onClearVisible` provided), click it. `handleClearVisible` runs — search history items shown in the dropdown are removed; the dropdown re-renders with the remaining items (which may be the empty list, in which case the dropdown unmounts because `items.length === 0`).
15. **Smoke — close on URL input blur**: Click anywhere outside the URL bar **and** outside the dropdown (e.g. into the page content or a different toolbar button). The URL input blurs → `handleUrlBlur` sets `suggestionsOpen=false` → dropdown unmounts.
16. **Smoke — close on Escape**: With dropdown open and URL input focused, press Escape. `handleUrlKeyDown` sets `suggestionsOpen=false` → dropdown unmounts. (Popover does not handle Escape itself — verify that the URL input handler runs.)
17. **Smoke — DevTools**: Inspect the dropdown. Root has `data-type="popover"` portaled to `<body>`. Header is a `data-type="panel"` row. Header label is `<Text data-type="text" data-size="xs" data-color="light">`. Clear button is `<Button data-type="button" data-variant="ghost" data-size="sm">`. The list is `data-type="list-box"`; each visible row is `data-type="list-item"`. The active row has `data-active`. The dropdown's outer width attribute (in inline style) equals the URL bar's width.
18. **Smoke — virtualization**: With a long navigation history (e.g. 100+ entries), the DOM contains only ~20 mounted `[data-type="list-item"]` nodes (visible window + overscan), not 100+. Scrolling the list mounts new rows and unmounts off-screen ones.
19. **Smoke — themes**: Cycle `default-dark`, `light-modern`, `monokai`. Selection background/text, header label, Clear button, dropdown border, and shadow all update with theme.

## Files Changed summary

| File | Action | Notes |
|------|--------|-------|
| [src/renderer/uikit/Popover/Popover.tsx](../../../src/renderer/uikit/Popover/Popover.tsx) | Modify | Add `matchAnchorWidth?: boolean`. Extend `size` middleware to write anchor-matched `width` when set. Existing `maxHeight` write and inline-style override unchanged. |
| [src/renderer/uikit/Popover/Popover.story.tsx](../../../src/renderer/uikit/Popover/Popover.story.tsx) | Modify | Add `matchAnchorWidth` prop entry. |
| [src/renderer/editors/browser/UrlSuggestionsDropdown.tsx](../../../src/renderer/editors/browser/UrlSuggestionsDropdown.tsx) | Rewrite | Same external prop interface; UIKit composition (Popover + Panel + Text + Button + Spacer + ListBox) with `ListBox.growToHeight={400}` for height capping. Drops `@emotion/styled`, `useFloating`, `createPortal`, `useMergeRefs`, `clsx`, `color`, `highlightText`. |
