# US-468: UIKit ListBox — virtualized list primitive

## Goal

Build a UIKit `ListBox` component — a virtualized, accessible, single-select list of items that screen migrations can use under [Rule 7](../../../src/renderer/uikit/CLAUDE.md). Per the [US-438 naming table](../../../src/renderer/uikit/CLAUDE.md), `List → ListBox`. The component lives at `src/renderer/uikit/ListBox/`.

`ListBox` is the V1 of a Phase-4 infrastructure primitive (sibling to [US-466 Popover](../US-466-uikit-popover/README.md) and [US-467 Tooltip](../US-467-uikit-tooltip/README.md)). It will unblock multiple Phase-4 screen migrations whose first need is "render a list of items in a popover": [US-464 UrlSuggestionsDropdown](../US-464-url-suggestions-dropdown-migration/README.md) is the **first concrete consumer and is blocked on this task**. Future consumers include MarkdownSearchBar/FindBar (US-460/US-461), command-palette features, and the eventual UIKit `Select`/`MultiSelect` (which will be built on top of `ListBox`).

This task **builds the component only**. Existing `List` consumers ([ComboSelect](../../../src/renderer/components/form/ComboSelect.tsx), [ListMultiselect](../../../src/renderer/components/form/ListMultiselect.tsx), [MenuBar](../../../src/renderer/ui/sidebar/MenuBar.tsx), [OpenTabsList](../../../src/renderer/ui/sidebar/OpenTabsList.tsx), [PopupMenu](../../../src/renderer/components/overlay/PopupMenu.tsx), [FileList](../../../src/renderer/ui/sidebar/FileList.tsx)) are **not migrated here**. They keep using legacy `List` until their parent screens reach Phase 4 and adopt the UIKit replacement.

## Background

### EPIC-025 Phase 4 context

[EPIC-025](../../epics/EPIC-025.md) Phase 4 is per-screen migration, but that loop assumes the UIKit catalog has the primitives each screen needs. When several upcoming screens share a missing primitive (here: a virtualized list), it is cheaper to build the primitive once than to inline a one-off list per screen and replace each later. The same reasoning produced US-466 Popover and US-467 Tooltip.

The original plan for [US-464](../US-464-url-suggestions-dropdown-migration/README.md) inlined a small `ListItem` UIKit primitive plus a screen-local highlighted-text helper. That works for one screen, but the next list-bearing screen would either re-inline another `ListItem` or extract one — both worse than building the real `ListBox` once. **Decision: build `ListBox` first; US-464 consumes it.**

### Phasing within this task

The component's full surface (matching the legacy `List` plus UIKit conventions) is non-trivial. This task delivers a **V1** sized to unblock US-464 and similar screen migrations. Out-of-scope features that the legacy `List` exposes and that some future consumers will need are listed under "Deferred to V2" — they become small follow-up tasks once a concrete consumer needs them. We do **not** carve those into US-468a/US-468b — explicit follow-up tasks are tracked when triggered.

### Audit of legacy `List`

[`src/renderer/components/form/List.tsx`](../../../src/renderer/components/form/List.tsx) — 395 lines.

Built on top of [`RenderGrid`](../../../src/renderer/components/virtualization/RenderGrid/RenderGrid.tsx) (`columnCount=1, rowCount=items.length`). `RenderGrid` itself stays untouched — UIKit `ListBox` reuses it as the virtualization engine.

#### Legacy feature inventory

| Legacy feature | V1 (this task) | Notes |
|---|---|---|
| Virtualization (`RenderGrid` with `columnCount=1`) | **keep** | Same engine, same `rowHeight`/`overscanRow`/`fitToWidth` defaults. |
| Generic over `T` | **keep** | `ListBox<T>` — caller's item shape; trait-based accessors instead of `getLabel`/`getIcon` props. |
| `getLabel`, `getIcon`, `getOptionClass` accessor props | **drop** | Per Rule 3, replaced by the trait pattern (`items: T[] \| Traited<unknown[]>` + `LIST_ITEM_KEY`). |
| `getSelected(o)` accessor | **replace** with `value: T \| null` | Single-select V1. Multi-select is a separate UIKit `MultiSelect` component (built on `ListBox`) per US-438 naming table. |
| `getHovered(o)` + `onMouseHover` (JS-driven hover) | **replace** with controlled `activeIndex` + `onActiveChange` | One controlled prop for "which item is highlighted" — works identically for arrow-key nav (parent updates `activeIndex`) and mouse hover (the component fires `onActiveChange`). |
| `onClick(value, index, e)` | **rename to `onChange(value)`** | Per Rule 1's prop-name table (`onChange` for change handler). The signature drops the index/event — callers needing them can use `onItemActivate` (TBD if requested; not in V1). |
| `rowRenderer` | **keep, rename to `renderItem`** | `(ctx: ListItemRenderContext<T>) => ReactNode`. Per Rule 1's prop-name guidance (`item` not `option`). |
| Default cell rendering (icon + label + selected check, with HighlightedTextProvider context-driven highlight) | **keep, simplified** | Default `<ListItem>` renders icon + label + selected check. Highlighted text is opted in via `searchText` prop on `ListBox` — passed straight to the default item renderer. No React Context for the highlight string. |
| `selectedIcon` prop | **keep** | Trailing icon for the selected item. Default = `<CheckIcon>`. |
| `loading: boolean` + spinner empty state | **keep** | Empty state renders a UIKit `<Spinner>` + "loading…" text per Rule 1. |
| `emptyMessage: ReactNode` | **keep** | Same. |
| `whiteSpaceY: number` | **keep** | Pass-through to `RenderGrid` (top/bottom padding inside the scroll container). |
| `growToHeight: CSSProperties["height"]` | **keep** | Pass-through to `RenderGrid` so the list can size to its content up to a max height (used by `ComboSelect`-style dropdowns). |
| `itemMarginY: number` | **drop in V1** | Adds vertical padding around each item by mutating row top/height. Only one legacy consumer (`ComboSelect` doesn't use it; not load-bearing). Re-add if a concrete consumer surfaces. |
| `getTooltip(value, index)` | **deferred to V2** | Per-item tooltips integrate UIKit `<Tooltip>` (US-467). No V1 consumer needs this. |
| `getContextMenu(value, index)` + `onContextMenu` | **deferred to V2** | Per-item context menus integrate `ContextMenuEvent`. No V1 consumer needs this. |
| `OverflowTooltipText` truncation per item | **defer to V2** (or item-renderer responsibility) | The default item renderer truncates with CSS (`text-overflow: ellipsis`) but does **not** show an overflow tooltip in V1. When V1 callers need a real tooltip on truncated rows, they pass a custom `renderItem`. The legacy `OverflowTooltipText` will be reborn as UIKit `TruncatedText` in a separate task per the US-438 naming table. |
| Imperative `getGrid().scrollToRow(idx, align)` via `ListRef` | **keep, simplify** | `ListBoxRef` exposes `scrollToIndex(i: number, align?: RowAlign)` directly — no `getGrid()` indirection. |
| `className` pass-through to `RenderGrid` | **drop** | Per Rule 7, app code does not pass `className` to UIKit components. Layout needs are expressed via props (`growToHeight`, etc.). |
| `HighlightedTextProvider` (React Context) on consumer side | **drop in UIKit** | UIKit `ListBox.searchText` is forwarded straight to the default `<ListItem>`. Legacy `HighlightedTextProvider` and `useHighlightedText` stay in `components/basic/` for the ~40 legacy consumers; they are not migrated in this task. |
| `clsx`-based `.selected` / `.hovered` class names | **replace** | Items use `data-type="list-item"` + `data-selected` / `data-active` / `data-disabled` per Rule 1. No CSS classes for state. |
| `onContextMenu` on container (no rows) | **deferred to V2** | Tied to per-item context menu story. |

#### Behavior

- Single-select. `value: T \| null` + `onChange(value: T)`.
- Single-active-index for highlight: `activeIndex?: number \| null` (controlled). Set externally by a parent input (URL-bar pattern) or by ListBox's built-in keyboard handler when `keyboardNav` is enabled. The component fires `onActiveChange(index)` on mouse hover and on internal keyboard navigation.
- Items can be supplied either as `IListBoxItem[]` (canonical shape) or as a `Traited<unknown[]>` wrapper (per Rule 3) — internally normalised to `IListBoxItem[]` via `resolveTraited(items, LIST_ITEM_KEY)`.
- The default `<ListItem>` renderer reads `item.icon`, `item.label`, `item.disabled` from each `IListBoxItem`; respects `searchText` for inline highlight; renders the selected check on the right when the item matches `value`.
- A custom `renderItem` lets the caller bypass the default entirely — receives the resolved `IListBoxItem`, the original `T` source, the index, and selection/active flags. Used by URL suggestions for the icon + highlighted multi-token label + close button row.
- `keyboardNav: boolean` (default `false`). When `true`, ListBox handles ArrowUp/ArrowDown/Home/End on its container (with `tabIndex={0}` on the root), updates `activeIndex` via `onActiveChange`, and calls `onChange(value)` on Enter. When `false` (default), the parent owns keys — typical for a list inside a popover whose anchor input drives navigation.
- The container exposes a stable `id` and each item exposes a stable `id` (`<root-id>-item-<value>`) so parents using the `aria-activedescendant` pattern can wire focus management without ListBox needing to take focus.

#### ARIA

- Container: `role="listbox"`, `aria-activedescendant={<active item id>}` when an `activeIndex` is present.
- Each item: `role="option"`, `aria-selected="true" \| "false"`, `aria-disabled="true"` if disabled.
- `id` props auto-generated (caller can override the container `id` via `...rest`).
- `data-type="list-box"` on the root, `data-type="list-item"` on each row.

#### Visual

Default `<ListItem>` styling — modernised but visually equivalent to the legacy `ItemRoot`:

```ts
const Root = styled.div(
    {
        display: "inline-flex",
        alignItems: "center",
        gap: gap.md,
        paddingLeft: spacing.sm,
        paddingRight: spacing.sm,
        cursor: "pointer",
        color: color.text.default,
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",

        "&[data-disabled]": { opacity: 0.4, pointerEvents: "none" },
        "&[data-active]": {
            backgroundColor: color.background.selection,
            color: color.text.selection,
        },
        "&[data-selected]": {
            // Selection styling matches legacy: same selection bg as active.
            // Distinct visual treatment (e.g. an outline) can be added later
            // when a screen needs to show selected + non-active simultaneously.
            backgroundColor: color.background.selection,
            color: color.text.selection,
        },
    },
    { label: "ListItem" },
);
```

Highlighted text uses the same approach as the legacy `highlightText` helper — splits the label text by an escaped tokenized regex and renders matched tokens bold. No external React Context; the matching is a pure function of `(text, searchText)` passed straight from `ListBox` props. Implementation: a tiny internal helper inside `ListBox/`, ~25 lines.

### Consumers of legacy `List` (NOT migrated in this task)

| File | Status |
|------|--------|
| [components/form/ComboSelect.tsx](../../../src/renderer/components/form/ComboSelect.tsx) | Stays on legacy `List`. Migrates with UIKit `Select` (separate task per US-438). |
| [components/form/ListMultiselect.tsx](../../../src/renderer/components/form/ListMultiselect.tsx) | Stays on legacy `List`. Migrates with UIKit `MultiSelect` (separate task per US-438). |
| [components/overlay/PopupMenu.tsx](../../../src/renderer/components/overlay/PopupMenu.tsx) | Stays on legacy `List`. Migrates with UIKit `Menu` (separate task). |
| [ui/sidebar/MenuBar.tsx](../../../src/renderer/ui/sidebar/MenuBar.tsx) | Stays on legacy `List`. Migrates as part of sidebar refactor (Phase 4 — separate task). |
| [ui/sidebar/OpenTabsList.tsx](../../../src/renderer/ui/sidebar/OpenTabsList.tsx) | Same — migrates with the sidebar. |
| [ui/sidebar/FileList.tsx](../../../src/renderer/ui/sidebar/FileList.tsx) | Same — migrates with the sidebar. |

The first concrete UIKit `ListBox` consumer is **US-464 UrlSuggestionsDropdown**, migrated immediately after this task lands.

### Files involved

| File | Role | Change |
|------|------|--------|
| `src/renderer/uikit/ListBox/ListBox.tsx` | UIKit `ListBox` component | **New** |
| `src/renderer/uikit/ListBox/ListItem.tsx` | Default per-item renderer (internal default for `renderItem`) | **New** |
| `src/renderer/uikit/ListBox/highlight.ts` | Tiny pure helper for inline search-highlighting | **New** |
| `src/renderer/uikit/ListBox/ListBox.story.tsx` | Storybook story | **New** |
| `src/renderer/uikit/ListBox/index.ts` | Folder barrel export | **New** |
| [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) | UIKit public exports | Add `ListBox`, `ListBoxProps`, `ListItem`, `ListItemProps`, `IListBoxItem`, `LIST_ITEM_KEY`, `ListBoxRef` |
| [src/renderer/editors/storybook/storyRegistry.ts](../../../src/renderer/editors/storybook/storyRegistry.ts) | Storybook story registry | Import `listBoxStory`, append to `ALL_STORIES` |
| [doc/active-work.md](../../active-work.md) | Dashboard | Add **US-468** entry under EPIC-025 Phase 4 (Active); mark **US-464** as blocked on US-468 |
| [doc/tasks/US-464-url-suggestions-dropdown-migration/README.md](../US-464-url-suggestions-dropdown-migration/README.md) | US-464 task doc | Add "Blocked on US-468" notice at the top; defer the detailed `ListItem` plan until US-468 ships (small surgical edit only — full rewrite happens once `ListBox` API is final) |

### Files NOT changed

- `src/renderer/components/form/List.tsx` — legacy stays in place. Removed only after **all** consumers migrate (final step of EPIC-025 Phase 4).
- `src/renderer/components/virtualization/RenderGrid/*` — `RenderGrid` is reused as-is; no changes needed.
- `src/renderer/components/basic/useHighlightedText.tsx` — legacy stays. ~40 consumers across the app. Cross-cutting migration is a separate future task; this task builds the UIKit `searchText` shortcut for new ListBox consumers only.
- `src/renderer/components/form/ComboSelect.tsx`, `ListMultiselect.tsx`, `PopupMenu.tsx`, sidebar files — legacy consumers stay on legacy `List`.

## Implementation plan

### Step 1 — Create `highlight.ts`

Path: `src/renderer/uikit/ListBox/highlight.ts`. Pure helper that returns React nodes with matched tokens wrapped in `<strong>` (semantic, theme-agnostic — bold is the visual style most legacy `highlightText` consumers want).

```ts
import React from "react";

/**
 * Split `text` on whitespace-separated tokens of `searchText`, recursively, returning
 * a flat array of React nodes where matches are wrapped in <strong>. Pure function —
 * no Context, no state. When `searchText` is empty or null, returns the raw text.
 */
export function highlight(text: string, searchText: string | null | undefined): React.ReactNode {
    if (!searchText) return text;
    const tokens = searchText.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    if (tokens.length === 0) return text;
    return highlightRecursive(text, tokens, 0);
}

function highlightRecursive(text: string, tokens: string[], keyBase: number): React.ReactNode {
    if (tokens.length === 0) return text;
    const [head, ...rest] = tokens;
    const escaped = head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expr = new RegExp(`(${escaped})`, "gi");
    const parts = text.split(expr);
    return parts.map((part, i) => {
        const key = `${keyBase}-${i}`;
        if (expr.test(part)) {
            // Reset regex state for the next .test() call
            expr.lastIndex = 0;
            return <strong key={key}>{part}</strong>;
        }
        return <React.Fragment key={key}>{highlightRecursive(part, rest, i)}</React.Fragment>;
    });
}
```

Notes:
- `<strong>` is semantically neutral and inherits the item's foreground color — no theme-specific styling needed.
- Recursive splitting matches the legacy `highlightText` behavior of multi-token highlights.
- `escaped` regex sanitization is identical to the legacy helper.
- Pure function — no external state, no React Context. Trivially testable.

### Step 2 — Create `ListItem.tsx`

Path: `src/renderer/uikit/ListBox/ListItem.tsx`. Default per-row renderer used when `ListBox.renderItem` is omitted. Also exported from UIKit for callers that build a custom `renderItem` but want the same default visual base.

```tsx
import React, { forwardRef } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { gap, spacing } from "../tokens";
import { CheckIcon } from "../../theme/icons";
import { highlight } from "./highlight";

// --- Types ---

export interface ListItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    /** Stable id used for `aria-activedescendant` wiring. */
    id?: string;
    /** Leading icon. */
    icon?: React.ReactNode;
    /** Label content. When `searchText` is provided, plain-string labels are highlighted. */
    label: React.ReactNode;
    /** Highlight matches in the label. Only applied when `label` is a string. */
    searchText?: string;
    /** True when this item is the current `value` of its ListBox. */
    selected?: boolean;
    /** True when this item is the current `activeIndex` of its ListBox. */
    active?: boolean;
    /** True when this item should not respond to clicks. */
    disabled?: boolean;
    /** Trailing slot — defaults to a check icon when `selected`. */
    trailing?: React.ReactNode;
}

// --- Styled ---

const Root = styled.div(
    {
        display: "inline-flex",
        width: "100%",
        boxSizing: "border-box",
        alignItems: "center",
        gap: gap.md,
        paddingLeft: spacing.sm,
        paddingRight: spacing.sm,
        cursor: "pointer",
        color: color.text.default,
        overflow: "hidden",

        "&[data-disabled]": { opacity: 0.4, pointerEvents: "none" },
        "&[data-active]": {
            backgroundColor: color.background.selection,
            color: color.text.selection,
        },
        "&[data-selected]": {
            backgroundColor: color.background.selection,
            color: color.text.selection,
        },

        "& > .label": {
            flex: "1 1 auto",
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
    },
    { label: "ListItem" },
);

// --- Component ---

export const ListItem = forwardRef<HTMLDivElement, ListItemProps>(function ListItem(
    {
        id,
        icon,
        label,
        searchText,
        selected,
        active,
        disabled,
        trailing,
        ...rest
    },
    ref,
) {
    const labelNode =
        typeof label === "string" && searchText ? highlight(label, searchText) : label;
    return (
        <Root
            ref={ref}
            id={id}
            data-type="list-item"
            data-selected={selected || undefined}
            data-active={active || undefined}
            data-disabled={disabled || undefined}
            role="option"
            aria-selected={selected ? "true" : "false"}
            aria-disabled={disabled ? "true" : undefined}
            {...rest}
        >
            {icon}
            <span className="label">{labelNode}</span>
            {trailing ?? (selected ? <CheckIcon /> : null)}
        </Root>
    );
});
```

Notes:
- Uses an inner `<span className="label">` purely as an internal styled-element selector — internal layout, not exposed as an Emotion escape-hatch to consumers.
- `data-active` and `data-selected` are independent: an item can be both, only one, or neither. The CSS treats them with the same selection background — distinct visuals can be added later if needed.
- `role="option"` is fixed; it is the only correct role for a child of `role="listbox"`.
- Trailing slot defaults to a check icon for selected rows. Consumers can pass a custom node (URL suggestions: a "remove from history" button).

### Step 3 — Create `ListBox.tsx`

Path: `src/renderer/uikit/ListBox/ListBox.tsx`. Generic component, ~250 lines.

```tsx
import React, {
    forwardRef,
    useCallback,
    useEffect,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
} from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { spacing } from "../tokens";
import {
    isTraited,
    resolveTraited,
    TraitKey,
    Traited,
    TraitType,
} from "../../core/traits/traits";
import RenderGrid from "../../components/virtualization/RenderGrid/RenderGrid";
import RenderGridModel from "../../components/virtualization/RenderGrid/RenderGridModel";
import { Percent, RenderCellFunc, RowAlign } from "../../components/virtualization/RenderGrid/types";
import { Spinner } from "../Spinner/Spinner";
import { ListItem } from "./ListItem";

// --- Types ---

export interface IListBoxItem {
    /** Stable identifier — what `value` / `onChange` refer to. */
    value: string | number;
    /** Display label. Strings are eligible for `searchText` highlighting. */
    label: React.ReactNode;
    /** Leading icon. */
    icon?: React.ReactNode;
    /** Disables this item without affecting siblings. */
    disabled?: boolean;
}

export const LIST_ITEM_KEY = new TraitKey<TraitType<IListBoxItem>>("listbox-item");

export interface ListItemRenderContext<T> {
    /** Resolved item shape (post-trait). */
    item: IListBoxItem;
    /** Original source item (pre-trait). Equal to `item` when `T = IListBoxItem`. */
    source: T;
    index: number;
    selected: boolean;
    active: boolean;
    /** Stable DOM id — must be set on the rendered row when callers want `aria-activedescendant`. */
    id: string;
}

export interface ListBoxRef {
    scrollToIndex: (index: number, align?: RowAlign) => void;
}

export interface ListBoxProps<T = IListBoxItem>
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "onChange"> {
    items: T[] | Traited<unknown[]>;
    /** Currently-selected value. `null` when nothing is selected. */
    value?: IListBoxItem["value"] | null;
    /** Fires when the user selects an item (click or Enter when `keyboardNav`). */
    onChange?: (value: IListBoxItem["value"], item: IListBoxItem) => void;
    /** Index of the currently-highlighted (active) row. Controlled. */
    activeIndex?: number | null;
    /** Fires when the active row changes — mouse hover or internal keyboard nav. */
    onActiveChange?: (index: number) => void;
    /** Plain-string label highlight passed to the default `<ListItem>`. */
    searchText?: string;
    /** Custom row renderer. Receives a context with the resolved item + flags. */
    renderItem?: (ctx: ListItemRenderContext<T>) => React.ReactNode;
    /** When true, the ListBox handles ArrowUp/ArrowDown/Home/End/Enter on its root. Default: false. */
    keyboardNav?: boolean;
    /** Spinner state — replaces item rendering with a loading row. */
    loading?: boolean;
    /** Renders when `items` is empty and not `loading`. */
    emptyMessage?: React.ReactNode;
    /** Pixel height of each row. Default: 24. */
    rowHeight?: number;
    /** When set, the list grows to fit content up to this max height. */
    growToHeight?: React.CSSProperties["height"];
    /** Top/bottom whitespace padding inside the scroll container. */
    whiteSpaceY?: number;
}

// --- Styled ---

const Root = styled.div(
    {
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        outline: "none",
        "&[data-disabled]": { opacity: 0.6, pointerEvents: "none" },
    },
    { label: "ListBox" },
);

const EmptyRoot = styled.div(
    {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.sm,
        flex: "1 1 auto",
        color: color.text.light,
    },
    { label: "ListBoxEmpty" },
);

// --- Component ---

const columnWidth = () => "100%" as Percent;
const defaultRowHeight = 24;

function ListBoxInner<T = IListBoxItem>(
    {
        items,
        value,
        onChange,
        activeIndex,
        onActiveChange,
        searchText,
        renderItem,
        keyboardNav = false,
        loading,
        emptyMessage,
        rowHeight = defaultRowHeight,
        growToHeight,
        whiteSpaceY,
        id: idProp,
        ...rest
    }: ListBoxProps<T>,
    ref: React.ForwardedRef<ListBoxRef>,
) {
    const reactId = useId();
    const rootId = idProp ?? `lb-${reactId}`;
    const gridRef = useRef<RenderGridModel | null>(null);

    // Resolve traited input → IListBoxItem[] + parallel array of source `T`.
    const { resolved, sources } = useMemo(() => {
        if (isTraited<unknown[]>(items)) {
            const r = resolveTraited<IListBoxItem>(items, LIST_ITEM_KEY);
            return { resolved: r, sources: items.target as T[] };
        }
        return { resolved: items as unknown as IListBoxItem[], sources: items as T[] };
    }, [items]);

    // Force RenderGrid re-render when display inputs change.
    useEffect(() => {
        gridRef.current?.update({ all: true });
    }, [resolved, value, activeIndex, searchText, renderItem, rowHeight]);

    useImperativeHandle(
        ref,
        () => ({
            scrollToIndex: (i, align) => gridRef.current?.scrollToRow(i, align),
        }),
        [],
    );

    const itemId = useCallback(
        (idx: number) => `${rootId}-item-${resolved[idx].value}`,
        [rootId, resolved],
    );

    const onItemClick = useCallback(
        (idx: number) => {
            const item = resolved[idx];
            if (item.disabled) return;
            onChange?.(item.value, item);
        },
        [resolved, onChange],
    );

    const onItemMouseEnter = useCallback(
        (idx: number) => {
            if (resolved[idx].disabled) return;
            if (idx !== activeIndex) onActiveChange?.(idx);
        },
        [resolved, activeIndex, onActiveChange],
    );

    const renderCell = useCallback<RenderCellFunc>(
        ({ row: idx, key, style }) => {
            const item = resolved[idx];
            if (!item) return null;
            const selected = item.value === value;
            const active = idx === activeIndex;
            const id = itemId(idx);

            const content = renderItem
                ? renderItem({ item, source: sources[idx], index: idx, selected, active, id })
                : (
                    <ListItem
                        id={id}
                        icon={item.icon}
                        label={item.label}
                        searchText={searchText}
                        selected={selected}
                        active={active}
                        disabled={item.disabled}
                    />
                );

            return (
                <div
                    key={key}
                    style={style}
                    onClick={() => onItemClick(idx)}
                    onMouseEnter={() => onItemMouseEnter(idx)}
                >
                    {content}
                </div>
            );
        },
        [resolved, sources, value, activeIndex, searchText, renderItem, itemId, onItemClick, onItemMouseEnter],
    );

    const onKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (!keyboardNav) return;
            const n = resolved.length;
            if (n === 0) return;
            const cur = activeIndex ?? -1;
            switch (e.key) {
                case "ArrowDown": {
                    e.preventDefault();
                    const next = Math.min(n - 1, cur + 1);
                    onActiveChange?.(next);
                    gridRef.current?.scrollToRow(next);
                    break;
                }
                case "ArrowUp": {
                    e.preventDefault();
                    const next = Math.max(0, cur - 1);
                    onActiveChange?.(next);
                    gridRef.current?.scrollToRow(next);
                    break;
                }
                case "Home": {
                    e.preventDefault();
                    onActiveChange?.(0);
                    gridRef.current?.scrollToRow(0);
                    break;
                }
                case "End": {
                    e.preventDefault();
                    onActiveChange?.(n - 1);
                    gridRef.current?.scrollToRow(n - 1);
                    break;
                }
                case "Enter": {
                    if (cur >= 0) {
                        e.preventDefault();
                        onItemClick(cur);
                    }
                    break;
                }
            }
        },
        [keyboardNav, resolved.length, activeIndex, onActiveChange, onItemClick],
    );

    if (loading) {
        return (
            <Root id={rootId} data-type="list-box" data-loading="" {...rest}>
                <EmptyRoot>
                    <Spinner size="sm" /> loading…
                </EmptyRoot>
            </Root>
        );
    }

    if (resolved.length === 0) {
        return (
            <Root id={rootId} data-type="list-box" data-empty="" {...rest}>
                <EmptyRoot>{emptyMessage ?? "no rows"}</EmptyRoot>
            </Root>
        );
    }

    const activeId = activeIndex != null && activeIndex >= 0 && activeIndex < resolved.length
        ? itemId(activeIndex)
        : undefined;

    return (
        <Root
            id={rootId}
            data-type="list-box"
            role="listbox"
            tabIndex={keyboardNav ? 0 : -1}
            aria-activedescendant={activeId}
            onKeyDown={onKeyDown}
            {...rest}
        >
            <RenderGrid
                ref={gridRef}
                columnCount={1}
                rowCount={resolved.length}
                columnWidth={columnWidth}
                rowHeight={rowHeight}
                renderCell={renderCell}
                overscanRow={2}
                fitToWidth
                growToHeight={growToHeight}
                whiteSpaceY={whiteSpaceY}
            />
        </Root>
    );
}

export const ListBox = forwardRef(ListBoxInner) as <T = IListBoxItem>(
    props: ListBoxProps<T> & { ref?: React.Ref<ListBoxRef> },
) => React.ReactElement | null;
```

Notes:
- `ListBox` is generic over `T`. Default `T = IListBoxItem` lets the simplest call site (`<ListBox items={items} value={…} onChange={…} />`) skip the trait wrapping entirely.
- `useId()` provides a stable React-managed id for the root and items. Caller can override the root id via `id` (forwarded through `...rest`).
- The wrapper `<div>` around each row attaches `onClick`/`onMouseEnter` so the renderItem caller doesn't need to. The wrapper is purely structural — the real visual is inside `<ListItem>` or the custom node.
- Force-update on prop changes mirrors the legacy `useEffect(() => gridRef.current?.update({ all: true }), [...])` pattern, since `RenderGrid` does not re-render its cells when its `renderCell` changes shape unless told to.
- `RowAlign` is imported from `RenderGrid/types` — `"start" | "center" | "end" | "nearest"`.
- The cast at the export keeps `forwardRef` generic over `T` (TypeScript's `forwardRef` loses the generic; the cast restores it — this is the documented workaround used elsewhere in the repo, e.g. `List`, `ListMultiselect`).

### Step 4 — Create `index.ts`

Path: `src/renderer/uikit/ListBox/index.ts`:

```ts
export { ListBox, LIST_ITEM_KEY } from "./ListBox";
export type { ListBoxProps, ListBoxRef, IListBoxItem, ListItemRenderContext } from "./ListBox";
export { ListItem } from "./ListItem";
export type { ListItemProps } from "./ListItem";
```

### Step 5 — Update UIKit barrel

[`src/renderer/uikit/index.ts`](../../../src/renderer/uikit/index.ts) — add a "Lists" section after "Overlay":

```ts
// Lists
export { ListBox, LIST_ITEM_KEY } from "./ListBox";
export type { ListBoxProps, ListBoxRef, IListBoxItem, ListItemRenderContext } from "./ListBox";
export { ListItem } from "./ListBox";
export type { ListItemProps } from "./ListBox";
```

### Step 6 — Create `ListBox.story.tsx`

Path: `src/renderer/uikit/ListBox/ListBox.story.tsx`. Three demos in one story:
1. Default rendering (icon + label + selected check).
2. `searchText` highlight.
3. Custom `renderItem` with a trailing remove button (URL-suggestions pattern).

```tsx
import React, { useState } from "react";
import { ListBox, IListBoxItem } from "./ListBox";
import { ListItem } from "./ListItem";
import { IconButton } from "../IconButton/IconButton";
import { resolveIconPreset } from "../../editors/storybook/iconPresets";
import { Story } from "../../editors/storybook/storyTypes";

const ITEMS: IListBoxItem[] = Array.from({ length: 60 }, (_, i) => ({
    value: i,
    label: `Suggestion ${i} — apple banana cherry`,
    icon: resolveIconPreset("globe"),
}));

function ListBoxDemo(props: any) {
    const [value, setValue] = useState<IListBoxItem["value"] | null>(null);
    const [active, setActive] = useState<number>(0);
    const [removed, setRemoved] = useState<Set<IListBoxItem["value"]>>(new Set());
    const visible = ITEMS.filter((it) => !removed.has(it.value));

    const renderItem = props.customRow
        ? (ctx: any) => (
            <ListItem
                id={ctx.id}
                icon={ctx.item.icon}
                label={ctx.item.label}
                searchText={props.searchText}
                selected={ctx.selected}
                active={ctx.active}
                trailing={
                    <IconButton
                        icon={resolveIconPreset("close")}
                        aria-label="Remove"
                        onClick={(e) => {
                            e.stopPropagation();
                            setRemoved((s) => new Set(s).add(ctx.item.value));
                        }}
                    />
                }
            />
        )
        : undefined;

    return (
        <div style={{ width: 360, height: 240, display: "flex" }}>
            <ListBox
                items={visible}
                value={value}
                onChange={(v) => setValue(v)}
                activeIndex={active}
                onActiveChange={setActive}
                searchText={props.searchText}
                renderItem={renderItem}
                keyboardNav={props.keyboardNav}
                loading={props.loading}
                emptyMessage="no rows"
            />
        </div>
    );
}

export const listBoxStory: Story = {
    id: "list-box",
    name: "ListBox",
    section: "Lists",
    component: ListBoxDemo,
    props: [
        { name: "searchText",  type: "string",  default: "apple" },
        { name: "keyboardNav", type: "boolean", default: true },
        { name: "loading",     type: "boolean", default: false },
        { name: "customRow",   type: "boolean", default: false },
    ],
};
```

Notes:
- The demo container `<div style={{…}}>` is leaf preview content (raw HTML); fine under Rule 7's UIKit-internal scope.
- `IListBoxItem["value"]` is `string | number`; `Set` works with that union.
- The story exercises the three V1 features: highlighted search, keyboard nav, and custom renderItem with a trailing IconButton.

### Step 7 — Register the story

[`src/renderer/editors/storybook/storyRegistry.ts`](../../../src/renderer/editors/storybook/storyRegistry.ts) — add the import and append to the array:

```ts
// Lists
import { listBoxStory } from "../../uikit/ListBox/ListBox.story";

export const ALL_STORIES: Story[] = [
    panelStory, spacerStory, toolbarStory,
    buttonStory, iconButtonStory, inputStory, labelStory, checkboxStory, dividerStory, textStory,
    segmentedControlStory, spinnerStory,
    popoverStory, tooltipStory,
    listBoxStory,
];
```

### Step 8 — Update dashboard

[`doc/active-work.md`](../../active-work.md):

1. Add a new **US-468** entry under the **EPIC-025 / Active** Phase-4 section, near US-466/US-467:
   ```markdown
   - [ ] [US-468: UIKit ListBox — virtualized list primitive](tasks/US-468-uikit-listbox/README.md) *(Phase 4 — list infrastructure; blocks US-464)*
   ```
2. Edit the existing **US-464** line to note the new dependency:
   ```markdown
   - [ ] [US-464: UrlSuggestionsDropdown — UIKit migration](tasks/US-464-url-suggestions-dropdown-migration/README.md) *(Phase 4 — per-screen migration; blocked on US-468)*
   ```

### Step 9 — Update US-464 README (small edit)

Add a "Blocked on US-468" notice near the top of [`doc/tasks/US-464-url-suggestions-dropdown-migration/README.md`](../US-464-url-suggestions-dropdown-migration/README.md):

```markdown
> **Status: blocked on [US-468](../US-468-uikit-listbox/README.md).** The original plan introduced a screen-local `ListItem` primitive plus inlined virtualization. After investigation we are building UIKit `ListBox` first; US-464 will consume it. The `ListItem` and highlight-helper sections of this document will be revised once `ListBox`'s API is final.
```

Do **not** rewrite US-464's implementation plan in this task — that happens after US-468 lands and the API shape is verified.

### Step 10 — TypeScript check

`npx tsc --noEmit` — no new errors on any of the new files or the barrel.

### Step 11 — Manual smoke test (Storybook)

Run the app, open the Storybook editor, navigate to "ListBox" under the new "Lists" section. Verify:
- Default rendering: 60 rows, virtualized (DOM has only the visible window of `<div data-type="list-item">` nodes).
- Click a row → it becomes selected (`data-selected` attribute, check icon on the right).
- Hover a row → it becomes active (`data-active` attribute, selection background).
- `searchText="apple"` → matched substrings inside row labels render in `<strong>`.
- `keyboardNav: true` → focus the list, press ArrowDown / ArrowUp / Home / End / Enter; activeIndex updates and Enter selects.
- `customRow: true` → trailing remove button appears; clicking it deletes the row from the local state without selecting it.
- `loading: true` → spinner + "loading…" replaces the rows.
- Theme cycling (`default-dark`, `light-modern`, `monokai`) — selection background and text colors update with the theme.
- Inspect DevTools → root has `data-type="list-box"`, `role="listbox"`, `aria-activedescendant="lb-…-item-<n>"`. Each row has `data-type="list-item"`, `role="option"`, `aria-selected="true|false"`.

## Concerns / Open questions

All resolved before implementation.

### 1. `List` vs `ListBox` name? — RESOLVED: ListBox

The US-438 naming table explicitly maps `List → ListBox`. ARIA's `role="listbox"` is the correct semantic for a single-select list of options, which fits the V1 surface exactly. Using `List` would clash with the legacy file (kept until all consumers migrate) and obscures the ARIA mapping.

### 2. Multi-select in V1? — RESOLVED: no

Multi-select requires a different interaction model (per-row checkbox or shift/ctrl-click semantics, an array `value`, and behavior like "Select All"). The naming table reserves `MultiSelect` as a separate UIKit component. V1 stays single-select; multi-select is a future task that builds on `ListBox`.

### 3. Trait-based items — required for every consumer? — RESOLVED: no, optional

`ListBox` accepts both `IListBoxItem[]` (canonical) and `Traited<unknown[]>` (Rule 3). Default generic `T = IListBoxItem` lets simple callers skip the wrapping. Callers with a domain shape (`SuggestionItem`, `Tab`, etc.) wrap with `traited(items, new TraitSet().add(LIST_ITEM_KEY, accessors))`. Both paths produce the same internal `IListBoxItem[]`.

### 4. Why both `value` AND `activeIndex`? — RESOLVED: they are independent

`value` is the user's committed selection (persists across navigations). `activeIndex` is transient cursor position (which row is currently highlighted, e.g. the next candidate that Enter would select). They diverge often:
- URL bar: user typed "g", suggestions show 5 items, `activeIndex=0` highlights the top suggestion, but `value=null` because nothing is committed yet. Enter commits it.
- ComboBox-like flow: user re-opens the dropdown of an already-selected option — `value` matches the saved selection, `activeIndex` starts at the row of the saved value, then moves with arrow keys without losing `value` until Enter.

Single combined prop would force every caller to track both as one piece of state, which is wrong. Two props mirror the legacy `getSelected` + `getHovered` split.

### 5. Why `activeIndex: number | null` instead of `activeValue: T | null`? — RESOLVED: index is more useful

Index lets ListBox scroll to the row efficiently (`scrollToRow(idx)` is direct; `scrollToValue(v)` would require a linear search every time). Index also handles the empty-search case where the active row is "the first one" without needing to hand-pick a value. Callers convert via `items[activeIndex]?.value` when they need the value.

### 6. `keyboardNav` default — true or false? — RESOLVED: false

The most common V1 caller is a list inside a popover whose anchor input owns the keyboard (URL bar). Defaulting to `true` would have the ListBox swallow keys the parent already routes — bad behavior and a footgun. Defaulting to `false` and letting standalone widget callers opt in matches Rule 4's "applies to keyboard-navigable widgets only" carve-out.

### 7. `onChange(value, item)` signature — RESOLVED: pass both

`value` matches Rule 1's prop-name guidance. `item` is included as a second argument so callers don't need to look it up by value. No event arg in V1 (legacy passed `e?: React.MouseEvent`); future addition is non-breaking via signature widening, and the V1 demand is zero (URL suggestions doesn't need it).

### 8. Virtualization always-on, or threshold? — RESOLVED: always-on

`RenderGrid` already short-circuits to render all rows when the count is small — there is no perf win in adding a "virtualization off" branch in `ListBox`. Keeping virtualization always-on means one rendering codepath, simpler reasoning, and identical scroll behavior whether the list has 5 or 5,000 rows.

### 9. `aria-activedescendant` vs roving-tabindex within ListBox? — RESOLVED: activedescendant by default

ListBox sets `aria-activedescendant={activeId}` on the container always (even when `keyboardNav: false`), so a sibling input that owns focus can wire its own `aria-controls={listboxId}` and let assistive tech follow the active row. When `keyboardNav: true`, the ListBox container itself is focusable (`tabIndex=0`) and the `activedescendant` pattern still applies to its own focus — items don't take focus individually.

This is the right default for the URL-suggestions pattern (input has focus, list announces the active row via activedescendant). A roving-tabindex variant could be added later if a consumer needs items themselves to take focus (e.g. an inline keyboard-driven menu), but no V1 consumer does.

### 10. `searchText` on the default item — context vs prop? — RESOLVED: prop

Legacy uses `HighlightedTextProvider` + `useHighlightedText` (React Context). UIKit prefers explicit data flow — the highlight string is one short string and lives at the same level as the items, not deep in a tree. Passing it via prop on `ListBox` (and forwarded to the default `ListItem`) is simpler, type-safe, and avoids needing a UIKit-namespaced provider for a single string.

When a custom `renderItem` is used, callers pick up `searchText` from `ListBoxProps` and forward it themselves (e.g. via `<ListItem searchText={props.searchText}>` within their renderer). The story demonstrates this.

### 11. Should `ListBox` also export `ListItem`? — RESOLVED: yes

Custom `renderItem` consumers want to reuse the default visual base (selection bg, padding, ellipsis truncation) while customising trailing content (close button, badge, etc.). Re-exporting `ListItem` lets them do this without duplicating the styled rules.

### 12. Folder layout — single subfolder or split? — RESOLVED: single subfolder, three files

`uikit/ListBox/{ListBox.tsx, ListItem.tsx, highlight.ts, ListBox.story.tsx, index.ts}` keeps the component cluster discoverable. `ListItem` is half-internal (default for `renderItem`) and half-public (re-exported as a building block) — it stays in the same folder.

### 13. Deferred features — V2 list (not in this task)

| Feature | Trigger for V2 task |
|---|---|
| Per-item tooltip via UIKit `<Tooltip>` | First UIKit consumer that needs row-level tooltips beyond ellipsis truncation |
| Per-item context menu (`getContextMenu`) | First UIKit consumer that needs right-click on rows |
| Multi-select `MultiSelect` component built on `ListBox` | Migration of legacy `ListMultiselect` consumers |
| Roving tabindex variant (items take focus individually) | First UIKit consumer that needs per-item focus (e.g. inline action menu) |
| Sticky group headers | First UIKit consumer that groups items |
| Drag-drop reordering | First UIKit consumer that reorders rows |

None of these are blocking US-464 or any other in-flight Phase-4 screen migration. Adding any of them later is non-breaking — additional optional props or a sibling component.

### 14. Long-term home of `RenderGrid` — RESOLVED: stays in `components/` for this task; moves into `uikit/` at end of EPIC-025

`RenderGrid` ([src/renderer/components/virtualization/RenderGrid/](../../../src/renderer/components/virtualization/RenderGrid/)) is the virtualization engine reused by legacy `List`, AVGrid, and the new UIKit `ListBox`. It does not naturally fit every UIKit authoring rule (no `data-type`, no design tokens, no Emotion ban) — it is a low-level scroll/cell-portal engine, not a Rule-1-shaped component — but it is still a reusable component, and the project's stance is that `uikit/` is the single home for every reusable component (engines, primitives, and composites alike).

**For this task (US-468):** `RenderGrid` stays in `components/virtualization/`. UIKit `ListBox` imports it across the boundary the same way it imports from `core/traits/` and `theme/color`. No move, no copy.

**Long-term (end of EPIC-025):** `RenderGrid` moves into `src/renderer/uikit/`, together with AVGrid (post-review and pattern adjustments per Phase 5). The end state of EPIC-025 is a single `uikit/` directory containing every reusable component — including engine-level building blocks like `RenderGrid`. The legacy `components/` folder is dropped once its remaining occupants migrate. Components that don't naturally fit every UIKit authoring rule still live in `uikit/`; the deviation is documented in the component's own header comment rather than driving a folder split. The relocation itself is non-blocking — a separate cleanup task at the close of EPIC-025, not a US-468 concern.

## Acceptance criteria

1. `src/renderer/uikit/ListBox/ListBox.tsx` exists and exports `ListBox`, `ListBoxProps`, `ListBoxRef`, `IListBoxItem`, `ListItemRenderContext`, `LIST_ITEM_KEY`.
2. `src/renderer/uikit/ListBox/ListItem.tsx` exists and exports `ListItem`, `ListItemProps`.
3. `src/renderer/uikit/ListBox/highlight.ts` exists and exports `highlight(text, searchText)`.
4. `src/renderer/uikit/ListBox/ListBox.story.tsx` registers `listBoxStory` and is wired into `storyRegistry.ts`.
5. `src/renderer/uikit/index.ts` re-exports all of the above (`ListBox`, `ListItem`, `LIST_ITEM_KEY`, types).
6. `npx tsc --noEmit` reports no new errors.
7. **Smoke test — basic render:** open Storybook → "ListBox". 60 rows visible; only the in-view window has `<div data-type="list-item">` in the DOM.
8. **Smoke test — selection:** click a row. `data-selected` appears on it; the check icon shows on the right.
9. **Smoke test — active:** hover rows. `data-active` flips between rows; the selection background follows the cursor.
10. **Smoke test — controlled active:** with `keyboardNav: true`, click into the list and arrow up/down. The active row updates; the list scrolls to keep the active row visible.
11. **Smoke test — Enter selects:** with `keyboardNav: true` and an active row, press Enter. `data-selected` moves to the active row; `onChange` fires.
12. **Smoke test — searchText:** set `searchText="apple"`. Matched substrings render inside `<strong>` tags.
13. **Smoke test — custom renderItem:** toggle `customRow: true`. Trailing remove button appears on every row; clicking it removes the row without selecting it (`onChange` does not fire).
14. **Smoke test — empty:** filter the items down to zero. The empty message renders centered.
15. **Smoke test — loading:** set `loading: true`. The spinner row replaces the list.
16. **Smoke test — themes:** cycle `default-dark`, `light-modern`, `monokai`. Selection bg, text, spinner, and bold-highlight all follow the theme (no hardcoded colors).
17. **Smoke test — ARIA:** DevTools shows `role="listbox"`, `aria-activedescendant` matches the id of the active row, each row has `role="option"` + `aria-selected="true|false"` + `aria-disabled` when applicable.
18. **Smoke test — Rule 7 enforcement:** attempting `<ListBox style={…} />` or `<ListBox className="x" />` produces a TypeScript error.
19. **Smoke test — traited items:** call `<ListBox items={traited(myCustomItems, new TraitSet().add(LIST_ITEM_KEY, {…}))} … />` with a non-`IListBoxItem` source shape; rows render correctly.
20. **Dashboard updated:** US-468 added under EPIC-025 Active Phase-4 with a markdown link to this README; US-464 entry annotated "blocked on US-468".

## Files Changed summary

| File | Action | Notes |
|------|--------|-------|
| `src/renderer/uikit/ListBox/ListBox.tsx` | Create | UIKit ListBox component, ~250 lines |
| `src/renderer/uikit/ListBox/ListItem.tsx` | Create | Default per-item renderer, ~80 lines |
| `src/renderer/uikit/ListBox/highlight.ts` | Create | Pure highlight helper, ~25 lines |
| `src/renderer/uikit/ListBox/ListBox.story.tsx` | Create | Storybook story with three demos |
| `src/renderer/uikit/ListBox/index.ts` | Create | Folder barrel export |
| [src/renderer/uikit/index.ts](../../../src/renderer/uikit/index.ts) | Modify | Re-export ListBox, ListItem, types, `LIST_ITEM_KEY` |
| [src/renderer/editors/storybook/storyRegistry.ts](../../../src/renderer/editors/storybook/storyRegistry.ts) | Modify | Register `listBoxStory` |
| [doc/active-work.md](../../active-work.md) | Modify | Add US-468 under EPIC-025 Phase 4; annotate US-464 as blocked on US-468 |
| [doc/tasks/US-464-url-suggestions-dropdown-migration/README.md](../US-464-url-suggestions-dropdown-migration/README.md) | Modify | Add "Blocked on US-468" notice; defer detailed plan rewrite |
