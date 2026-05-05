# US-484: UIKit ListBox extensions — row tooltip, context menu, predicate selection, section rows

## Goal

Extend UIKit `ListBox` (built in [US-468](../US-468-uikit-listbox/README.md)) with the four
features the sidebar-list migration ([US-479](../US-479-sidebar-lists-migration/README.md))
needs. Before adding the new features, migrate the existing `ListBox` to the model-view
architecture ([Rule 8](../../../src/renderer/uikit/CLAUDE.md), see also the standard at
[`/doc/standards/model-view-pattern.md`](../../standards/model-view-pattern.md)) — the
component already has 4 `useCallback`s, a `useImperativeHandle`, two `useEffect`s, two
`useMemo`s, plus `useId` and `useRef`, which is past the threshold for the plain-hooks
style. Adding four more features on top of that surface would worsen the tangle; refactoring
first keeps each feature additive on the model instead of cumulative on the function body.

The four features:

1. **Per-row tooltip** — `getTooltip(item, index) => React.ReactNode | undefined`. The default
   `<ListItem>` renderer wraps each row in UIKit `<Tooltip>` when a non-empty value is returned.
2. **Per-row + container context menu** — `getContextMenu(item, index) => MenuItem[] | undefined`
   for rows, plus a container-level `onContextMenu` for clicks on empty space. Items dispatch via
   `ContextMenuEvent.fromNativeEvent(e, "generic")` (same legacy bridge that `FileList`,
   `FolderItem`, `PageTab`, etc. already use), keeping the script API extension hook
   (`ContextMenuEvent.items.push(...)`) intact.
3. **Predicate selection** — `isSelected(item, index) => boolean` overriding the default
   `value`-based identity comparison. When supplied, `value` is ignored. Replaces the legacy
   `getSelected(o)` accessor without introducing multi-select semantics — `MultiSelect` remains
   a separate UIKit component per US-438.
4. **Section rows** — `IListBoxItem.section?: boolean` marks a row as a non-interactive header
   inside the same virtualized list. Section rows are skipped by hover, click, keyboard nav,
   and selection styling, and render through a small dedicated styled element rather than
   `<ListItem>`. Used by `OpenTabsList` for window headers.

After this task:

- `ListBox` is implemented in the model-view style (`ListBoxModel.ts` + `ListBox.tsx`).
- The legacy `List` features that US-468 deferred to V2 (rows 47–48 of the US-468 audit
  table) are available on UIKit `ListBox`, unblocking US-479.

## Background

### Why this task exists

US-468 explicitly deferred per-row tooltips, per-row context menus, predicate-based selection,
and section/group-style rows because no V1 consumer (URL suggestions, US-464) needed them. The
sidebar lists do — see the audit below.

### Why migrate to model-view first

`ListBox.tsx` today has — across the function body of `ListBoxInner`:

| Hook | Count |
|------|-------|
| `useId` | 1 |
| `useRef` | 1 (`gridRef`) |
| `useMemo` | 2 (`{ resolved, sources }`, `selectedKey`) |
| `useEffect` | 2 (force-update grid on display inputs, scroll active row into view) |
| `useImperativeHandle` | 1 |
| `useCallback` | 4 (`resolveSingleValue`, `itemId`, `onItemClick`, `onItemMouseEnter`, `renderCell`, `onKeyDown` — actually 6) |

Adding the four new extensions (`isSelected`, `getTooltip`, `getContextMenu`,
`onContextMenu`) introduces ≥1 new `useCallback` (the row context-menu handler), expands
the dep arrays of `renderCell` and the force-update `useEffect`, and adds a section-skipping
helper that itself wants to be `useCallback`-wrapped to be stable in dep arrays. That
crosses the [model-view threshold](../../standards/model-view-pattern.md#when-to-use)
clearly: more than 4–5 `useState`/`useCallback`/`useMemo` slots, several `useEffect`s, and
overlapping deps that get harder to keep correct as features stack.

Migrating now (Step 0 below) means each of the four feature steps that follow is a small,
focused method on the model — not another closure squeezed into a growing function body.

### Audit of the four sidebar consumers (informs the API surface)

| Consumer | Tooltip | Context menu | Selection model | Section rows |
|---|---|---|---|---|
| [`ui/sidebar/FileList.tsx`](../../../src/renderer/ui/sidebar/FileList.tsx) | `getTooltip(item) => item.filePath` (full path) | per-row + container `onContextMenu` | none in this base list | no |
| [`ui/sidebar/RecentFileList.tsx`](../../../src/renderer/ui/sidebar/RecentFileList.tsx) | inherited via `FileList` | per-row (`getItemContextMenu`) | none | no |
| [`ui/sidebar/OpenTabsList.tsx`](../../../src/renderer/ui/sidebar/OpenTabsList.tsx) | `getTooltip(item) => filePath` | none today | predicate (`item.page?.id === activePageId`) | yes — window header rows mixed with tab rows |
| [`ui/sidebar/FolderItem.tsx`](../../../src/renderer/ui/sidebar/FolderItem.tsx) | `getTooltip(folder)` (custom row already) | per-row | controlled externally | no |

Every entry in this table maps to one of the four extensions. There is nothing else the
sidebar migration needs from `ListBox` (drag-drop is FolderItem-internal and lives in the
custom `renderItem`, not in ListBox).

### Legacy reference — what we are matching feature-parity to

[`components/form/List.tsx`](../../../src/renderer/components/form/List.tsx):

- `getTooltip(value, index?) => string | undefined` — wraps `OverflowTooltipText` with
  legacy `<Tooltip id={…} delayShow={1500}>` (lines 165–168, 214–218).
- `getContextMenu(value, index?) => MenuItem[] | undefined` — `onContextMenu` handler at
  row level builds `ContextMenuEvent.fromNativeEvent(e, "generic")` and pushes items (lines
  178–187).
- `onContextMenu(e)` — passed through to `RenderGrid.contentProps` so right-click on the
  empty list area can build its own ContextMenuEvent (lines 119, 387).
- `getSelected(value) => boolean` — predicate-driven selection class on each row (lines 103,
  300–302).
- *(no section row equivalent — legacy callers fake it via `getOptionClass`)*.

### Why dispatch ContextMenuEvent rather than open UIKit `Menu` directly

Two design constraints:

- The script API exposes a `ContextMenuEvent` hook — scripts call
  `ContextMenuEvent.items.push(...)` from event handlers to extend menus. Bypassing the event
  in `ListBox` would silently break that hook for any consumer using UIKit ListBox.
- The global handler that turns `ContextMenuEvent` into a visible menu lives in
  [`ui/dialogs/poppers/showPopupMenu.tsx`](../../../src/renderer/ui/dialogs/poppers/showPopupMenu.tsx)
  + the `Poppers` system. **US-482** (planned) refactors that handler to compose UIKit `Menu`
  internally. Once it lands, `ListBox` consumers automatically get UIKit-rendered menus
  without any code change here. Until then, the legacy `Popper` renders the menu — visually
  matching the rest of the app.

So `ListBox` does not import UIKit `Menu` for context menus. It dispatches the event the same
way every other list/tab/page surface in the app already does.

### Section row behavior — concrete shape from `OpenTabsList`

`OpenTabsList` builds an interleaved item array:

```
{ windowIndex: 0 }                                  ← section header (no page)
{ windowIndex: 0, page: { id: "p1", title: …, … } } ← tab item
{ windowIndex: 0, page: { id: "p2", title: …, … } }
{ windowIndex: 1 }                                  ← section header
{ windowIndex: 1, page: { id: "p3", title: …, … } }
…
```

Trait integration: each window-header item maps to `IListBoxItem` with `section: true`,
`value` set to a stable id (`"window-${windowIndex}"`), `label` e.g. `"window-${i}"` or
`"This Window"`, and no `icon`. Each tab item resolves to a normal `IListBoxItem`. The
component handles the rest.

### Files involved

| File | Role | Change |
|------|------|--------|
| `src/renderer/uikit/ListBox/ListBox.tsx` | UIKit ListBox component (View) | **Rewrite** — pure render function over the new `ListBoxModel`; add the four feature props on the View signature |
| `src/renderer/uikit/ListBox/ListBoxModel.ts` | Model class (logic, state, refs, handlers) | **New** — `TComponentModel<ListBoxState, ListBoxProps<T>>` subclass containing what is currently inside `ListBoxInner` plus the four new feature handlers |
| `src/renderer/uikit/ListBox/ListItem.tsx` | Default per-item renderer | **Modify** — accept and apply `tooltip` (wrap with UIKit Tooltip) |
| `src/renderer/uikit/ListBox/SectionItem.tsx` | New section-row renderer | **New** — small styled component for section rows |
| `src/renderer/uikit/ListBox/index.ts` | Folder barrel export | **Modify** — export `SectionItem`, `SectionItemProps` |
| `src/renderer/uikit/ListBox/ListBox.story.tsx` | Storybook story | **Modify** — add tooltip / context menu / predicate / sections demos |
| [`src/renderer/uikit/index.ts`](../../../src/renderer/uikit/index.ts) | UIKit public exports | **Modify** — add `SectionItem`, `SectionItemProps` exports |
| [`doc/active-work.md`](../../active-work.md) | Dashboard | **Modify** — when this task moves from Planned to Active |

### Files NOT changed

- `src/renderer/components/form/List.tsx` — legacy stays. Removed at the end of EPIC-025 once all consumers migrate.
- `src/renderer/components/virtualization/RenderGrid/*` — unchanged. The new section/predicate logic is all inside `ListBox`.
- `src/renderer/api/events/events.ts` — `ContextMenuEvent` and `MenuItem` are imported, not modified.
- `src/renderer/uikit/Tooltip/Tooltip.tsx`, `src/renderer/uikit/Menu/*` — composed as-is.
- `src/renderer/ui/sidebar/*` — sidebar consumers are migrated in **US-479**, not here.
- `src/renderer/uikit/CLAUDE.md` — no rule changes; the new props follow Rule 1 / Rule 3 already established by US-468.
- `src/renderer/uikit/shared/highlight.ts` — unchanged.

## Implementation plan

### Step 0 — Migrate `ListBox` to model-view

**Reference:** [`/doc/standards/model-view-pattern.md`](../../standards/model-view-pattern.md),
[Rule 8 in `uikit/CLAUDE.md`](../../../src/renderer/uikit/CLAUDE.md). This step performs ONLY
the refactor — no new features yet. The component's external behavior must be byte-for-byte
identical after Step 0; the four new props (Steps 1–6) are added on top of the migrated
shape.

#### 0a. Create `ListBoxModel.ts`

Path: `src/renderer/uikit/ListBox/ListBoxModel.ts`. New file. Defines the state shape, the
model class, and exports the default state.

State shape — exactly the transient bits that today live in refs / derived `useMemo`s:

```ts
import { TComponentModel } from "../../core/state/model";
import { TComponentState } from "../../core/state/state";
import RenderGridModel from "../../components/virtualization/RenderGrid/RenderGridModel";
import {
    isTraited,
    resolveTraited,
    TraitType,
} from "../../core/traits/traits";
import { ContextMenuEvent } from "../../api/events/events";
import type { MenuItem } from "../Menu";
import { LIST_ITEM_KEY, IListBoxItem, ListBoxProps } from "./ListBox";

export interface ListBoxState {
    /**
     * Bumped whenever the model needs the View to re-read derived data (e.g. resolved
     * items, selected key). The View subscribes to this slice; the actual derived values
     * come from model getters/memos. Keeping the slice tiny avoids re-render churn.
     */
    revision: number;
}

export const defaultListBoxState: ListBoxState = { revision: 0 };

export class ListBoxModel<T = IListBoxItem> extends TComponentModel<
    ListBoxState,
    ListBoxProps<T>
> {
    // --- refs ---
    gridRef: RenderGridModel | null = null;
    setGridRef = (ref: RenderGridModel | null) => { this.gridRef = ref; };

    // --- ids ---
    private _rootId: string | null = null;
    rootId(reactId: string): string {
        // Caller passes the View's useId() value once; we stash it for stable item ids.
        if (this._rootId == null) this._rootId = this.props.id ?? `lb-${reactId}`;
        return this._rootId;
    }

    // --- memoized derivations ---
    resolved = this.memo<{ resolved: IListBoxItem[]; sources: T[] }>(
        () => {
            const items = this.props.items;
            if (isTraited<unknown[]>(items)) {
                const r = resolveTraited<IListBoxItem>(items, LIST_ITEM_KEY);
                return { resolved: r, sources: items.target as T[] };
            }
            const arr = items as T[];
            return { resolved: arr as unknown as IListBoxItem[], sources: arr };
        },
        () => [this.props.items],
    );

    selectedKey = this.memo<string | number | null>(
        () => {
            if (this.props.value == null) return null;
            return this.resolveSingleValue(this.props.value).value;
        },
        () => [this.props.value],
    );

    // --- helpers ---
    private resolveSingleValue(v: T | { traits: { get(k: typeof LIST_ITEM_KEY): TraitType<IListBoxItem> | undefined }; target: T }): IListBoxItem {
        if (isTraited<T>(v)) {
            const acc = v.traits.get(LIST_ITEM_KEY);
            if (acc) {
                return Object.fromEntries(
                    (Object.keys(acc) as (keyof TraitType<IListBoxItem>)[]).map((k) => [k, acc[k](v.target)]),
                ) as IListBoxItem;
            }
            return v.target as unknown as IListBoxItem;
        }
        return v as unknown as IListBoxItem;
    }

    itemId = (idx: number): string => {
        const { resolved } = this.resolved.value;
        return `${this._rootId}-item-${resolved[idx].value}`;
    };

    isSelectedAt = (idx: number): boolean => {
        const { resolved } = this.resolved.value;
        const item = resolved[idx];
        if (!item) return false;
        const key = this.selectedKey.value;
        if (key == null) return false;
        return item.value === key;
    };

    // --- handlers ---
    onItemClick = (idx: number) => {
        const { resolved, sources } = this.resolved.value;
        const item = resolved[idx];
        if (!item || item.disabled) return;
        this.props.onChange?.(sources[idx]);
    };

    onItemMouseEnter = (idx: number) => {
        const { resolved } = this.resolved.value;
        const item = resolved[idx];
        if (!item || item.disabled) return;
        if (idx !== this.props.activeIndex) this.props.onActiveChange?.(idx);
    };

    onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (!this.props.keyboardNav) return;
        const { resolved } = this.resolved.value;
        const n = resolved.length;
        if (n === 0) return;
        const cur = this.props.activeIndex ?? -1;
        const set = (next: number) => {
            this.props.onActiveChange?.(next);
            this.gridRef?.scrollToRow(next);
        };
        switch (e.key) {
            case "ArrowDown": e.preventDefault(); set(Math.min(n - 1, cur + 1)); break;
            case "ArrowUp":   e.preventDefault(); set(Math.max(0, cur - 1));     break;
            case "PageDown": {
                e.preventDefault();
                const page = Math.max(1, this.gridRef?.visibleRowCount ?? 1);
                set(Math.min(n - 1, (cur < 0 ? 0 : cur) + page));
                break;
            }
            case "PageUp": {
                e.preventDefault();
                const page = Math.max(1, this.gridRef?.visibleRowCount ?? 1);
                set(Math.max(0, (cur < 0 ? 0 : cur) - page));
                break;
            }
            case "Home":  e.preventDefault(); set(0);     break;
            case "End":   e.preventDefault(); set(n - 1); break;
            case "Enter":
                if (cur >= 0) { e.preventDefault(); this.onItemClick(cur); }
                break;
        }
    };

    // --- imperative ref API ---
    scrollToIndex = (i: number, align?: Parameters<RenderGridModel["scrollToRow"]>[1]) => {
        this.gridRef?.scrollToRow(i, align);
    };

    // --- lifecycle ---
    init = () => {
        // Force RenderGrid to re-render cells whenever any of the display inputs change.
        // RenderGrid does not re-render its cells when its renderCell identity changes
        // unless told — preserve the legacy useEffect's exact behavior.
        this.effect(
            () => { this.gridRef?.update({ all: true }); },
            () => [
                this.resolved.value.resolved,
                this.selectedKey.value,
                this.props.activeIndex,
                this.props.searchText,
                this.props.renderItem,
                this.props.rowHeight,
            ],
        );

        // Keep the active row visible whenever activeIndex changes — covers external
        // drivers (Select keyboard handler, etc.) that update activeIndex without going
        // through the keyboardNav path.
        this.effect(
            () => {
                const ai = this.props.activeIndex;
                if (ai != null && ai >= 0) this.gridRef?.scrollToRow(ai);
            },
            () => [this.props.activeIndex],
        );
    };
}
```

Key migration moves (mapping today's hooks to model members):

| Today (`ListBox.tsx`) | After (`ListBoxModel.ts`) |
|---|---|
| `const reactId = useId(); const rootId = idProp ?? \`lb-${reactId}\`;` | View calls `useId()` once; passes value to `model.rootId(reactId)` for stable storage |
| `const gridRef = useRef<RenderGridModel | null>(null);` | `gridRef` instance property + `setGridRef` method |
| `const { resolved, sources } = useMemo(…, [items])` | `this.resolved = this.memo(…, () => [this.props.items])` |
| `const selectedKey = useMemo(…, [value, resolveSingleValue])` | `this.selectedKey = this.memo(…, () => [this.props.value])` |
| `useEffect(() => gridRef.current?.update({ all: true }), […])` | `this.effect(…, () => [resolved, selectedKey, activeIndex, …])` registered in `init()` |
| `useEffect(() => gridRef.current?.scrollToRow(activeIndex), [activeIndex])` | second `this.effect(…)` registered in `init()` |
| `useImperativeHandle(ref, …)` | View calls `useImperativeHandle(ref, () => ({ scrollToIndex: model.scrollToIndex }))` — see 0b |
| `useCallback(itemId, …)` | `itemId = (idx) => …` arrow method |
| `useCallback(onItemClick, …)` | `onItemClick = (idx) => …` arrow method |
| `useCallback(onItemMouseEnter, …)` | `onItemMouseEnter = (idx) => …` arrow method |
| `useCallback(renderCell, …)` | View defines `renderCell` inline (one closure, no `useCallback` — RenderGrid's update-deps already invalidate it) — alternatively wrap in `useCallback` if RenderGrid identity-checks `renderCell`. Verify during implementation. |
| `useCallback(onKeyDown, …)` | `onKeyDown = (e) => …` arrow method |

#### 0b. Rewrite `ListBox.tsx` as a pure View

The View becomes a thin function over `useComponentModel`:

```tsx
import React, { forwardRef, useId, useImperativeHandle } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { spacing } from "../tokens";
import { useComponentModel } from "../../core/state/model";
import RenderGrid from "../../components/virtualization/RenderGrid/RenderGrid";
import {
    ElementLength,
    Percent,
    RenderCellFunc,
    RowAlign,
} from "../../components/virtualization/RenderGrid/types";
import { Spinner } from "../Spinner/Spinner";
import { ListItem } from "./ListItem";
import { ListBoxModel, defaultListBoxState } from "./ListBoxModel";

// types (IListBoxItem, LIST_ITEM_KEY, ListItemRenderContext, ListBoxRef, ListBoxProps)
// stay declared in this file as before — they are the public types of the component
// and ListBoxModel imports them back. Co-locating types with the View is fine; the model
// file imports them via `from "./ListBox"`.

// styled (Root, EmptyRoot) stay unchanged

const columnWidth: ElementLength = (() => "100%" as Percent) as ElementLength;
const defaultRowHeight = 24;

function ListBoxView<T = IListBoxItem>(
    props: ListBoxProps<T>,
    ref: React.ForwardedRef<ListBoxRef>,
) {
    const reactId = useId();
    const model = useComponentModel(props, ListBoxModel<T>, defaultListBoxState);
    const rootId = model.rootId(reactId);

    useImperativeHandle(
        ref,
        () => ({ scrollToIndex: model.scrollToIndex }),
        [model],
    );

    const {
        loading,
        emptyMessage,
        searchText,
        renderItem,
        keyboardNav = false,
        rowHeight = defaultRowHeight,
        growToHeight,
        whiteSpaceY,
        activeIndex,
        ...rest
    } = props;

    // The View subscribes to the revision slot only — model.memo() handles the
    // actual computation invalidation behind the scenes.
    model.state.use((s) => s.revision);

    const { resolved, sources } = model.resolved.value;

    const renderCell: RenderCellFunc = ({ row: idx, key, style }) => {
        const item = resolved[idx];
        if (!item) return null;
        const selected = model.isSelectedAt(idx);
        const active = idx === activeIndex;
        const id = model.itemId(idx);

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
                onClick={() => model.onItemClick(idx)}
                onMouseEnter={() => model.onItemMouseEnter(idx)}
            >
                {content}
            </div>
        );
    };

    if (loading) {
        return (
            <Root id={rootId} data-type="list-box" data-loading="" {...rest}>
                <EmptyRoot>
                    <Spinner size={16} /> loading…
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

    const activeId =
        activeIndex != null && activeIndex >= 0 && activeIndex < resolved.length
            ? model.itemId(activeIndex)
            : undefined;

    return (
        <Root
            id={rootId}
            data-type="list-box"
            role="listbox"
            tabIndex={keyboardNav ? 0 : -1}
            aria-activedescendant={activeId}
            onKeyDown={model.onKeyDown}
            {...rest}
        >
            <RenderGrid
                ref={model.setGridRef}
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

export const ListBox = forwardRef(ListBoxView) as <T = IListBoxItem>(
    props: ListBoxProps<T> & { ref?: React.Ref<ListBoxRef> },
) => React.ReactElement | null;
```

Notes:
- `useComponentModel` is the single React hook the View uses. `init()` and `dispose()` run
  automatically.
- `useImperativeHandle` is fine in the View per the standard doc (Anti-pattern #2: hooks
  only in component function). It's the bridge between the React ref forwarded by the
  parent and the model's stable `scrollToIndex`.
- The View's render path stays the same — no behavioral changes in Step 0.

#### 0c. Verify the refactor before any feature work

Before starting Step 1, run:

- `npx tsc --noEmit` — same baseline error count as before Step 0.
- Open Storybook → ListBox. Smoke-test all V1 behaviors documented in US-468 step 11
  (selection, hover, keyboard nav, searchText, loading, empty, themes, ARIA, traited items).
  Behavior must be byte-for-byte identical.

If any deviation is observed, fix before proceeding. The four feature steps assume a
working baseline.

### Step 1 — Extend `IListBoxItem` with `section`

`src/renderer/uikit/ListBox/ListBox.tsx` (top of file, types section):

```ts
export interface IListBoxItem {
    /** Stable identifier — what `value` / `onChange` refer to. */
    value: string | number;
    /** Display label. Strings are eligible for `searchText` highlighting. */
    label: React.ReactNode;
    /** Leading icon. */
    icon?: React.ReactNode;
    /** Disables this item without affecting siblings. */
    disabled?: boolean;
    /**
     * When true, the row renders as a non-interactive section header. Hover, click, active
     * highlight, selection styling, and keyboard navigation all skip the row. Visually it
     * appears as a centered, dim label without an icon or selection check. Used to inline
     * group separators inside an otherwise normal list (e.g. window headers in the open-tabs
     * sidebar).
     */
    section?: boolean;
}
```

The trait `LIST_ITEM_KEY` already typed by `TraitType<IListBoxItem>` automatically picks up
the new optional field — consumers of `Traited<unknown[]>` just add a `section: () => boolean`
accessor when needed. No `LIST_ITEM_KEY` rebuild.

### Step 2 — Create `SectionItem.tsx`

Path: `src/renderer/uikit/ListBox/SectionItem.tsx`. Tiny presentational component, ~40 lines.

```tsx
import React, { forwardRef } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { spacing } from "../tokens";

// --- Types ---

export interface SectionItemProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    /** Stable id (forwarded so callers using aria can wire labelling). */
    id?: string;
    /** Section label. */
    label: React.ReactNode;
}

// --- Styled ---

const Root = styled.div(
    {
        display: "flex",
        width: "100%",
        boxSizing: "border-box",
        alignItems: "center",
        justifyContent: "center",
        paddingLeft: spacing.sm,
        paddingRight: spacing.sm,
        color: color.text.light,
        cursor: "default",
        userSelect: "none",
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
    },
    { label: "ListBoxSection" },
);

// --- Component ---

export const SectionItem = forwardRef<HTMLDivElement, SectionItemProps>(function SectionItem(
    { id, label, ...rest },
    ref,
) {
    return (
        <Root
            ref={ref}
            id={id}
            data-type="list-section"
            role="presentation"
            {...rest}
        >
            {label}
        </Root>
    );
});
```

Notes:
- `role="presentation"` — section rows are not selectable options. Keeping `role="listbox"` /
  `role="option"` semantics intact for assistive tech requires that non-options inside the
  listbox container declare presentation, otherwise screen readers report a malformed
  listbox.
- No hover / active / selected states — section rows are always inert.
- `data-type="list-section"` — distinct from `list-item` so DevTools queries and CSS selectors
  can target them separately if needed.

### Step 3 — Add `tooltip` prop to `ListItem`

Modify `src/renderer/uikit/ListBox/ListItem.tsx`:

1. Add `tooltip?: React.ReactNode` to `ListItemProps` (just before `trailing`).
2. Import `Tooltip` from `../Tooltip`.
3. Wrap the rendered row in `<Tooltip>` when `tooltip != null && tooltip !== false`.

```tsx
// add imports
import { Tooltip } from "../Tooltip";

// extend props
export interface ListItemProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    // ... existing fields ...
    /**
     * Tooltip body shown after the standard hover delay. When `null`, `undefined`, or
     * `false`, no tooltip is rendered (the row is returned unwrapped).
     */
    tooltip?: React.ReactNode;
    trailing?: React.ReactNode;
}
```

In the body, build the row JSX (already present) and conditionally wrap:

```tsx
const row = (
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

if (tooltip == null || tooltip === false) return row;
return <Tooltip content={tooltip}>{row}</Tooltip>;
```

Notes:
- UIKit `Tooltip` accepts a single `React.ReactElement` child whose ref forwards — `Root`
  already forwards `ref` via `forwardRef`, so the wrap is a no-op for everything except
  pointer events.
- Default delays (`delayShow=600`, `delayHide=100`) match the UIKit Tooltip baseline. Per-row
  override is not required by any current consumer; if one surfaces, expose `tooltipDelay` on
  `ListItem` later as a non-breaking addition.
- `tooltip` accepts `React.ReactNode` (string, JSX, or falsy). Mirrors the legacy `getTooltip`
  return type loosely while allowing rich content.

### Step 4 — Wire the four new props on `ListBox`

After Step 0, the structure is `ListBox.tsx` (View) + `ListBoxModel.ts` (Model). Each
sub-step below specifies which file to touch.

#### 4a. Imports

In `ListBoxModel.ts`, the `ContextMenuEvent` and `MenuItem` imports are already added in
Step 0 (they're listed in the model file's import block). In `ListBox.tsx` (View) add:

```ts
import { SectionItem } from "./SectionItem";
```

#### 4b. Extend `ListBoxProps` (in `ListBox.tsx`)

Add four optional props after `searchText`:

```ts
export interface ListBoxProps<T = IListBoxItem>
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "onChange"> {
    // ... existing fields up to `searchText` ...

    /**
     * Predicate that overrides the default `value`-based selection check. When supplied,
     * `value` is ignored — each row's selected flag comes from `isSelected(source, index)`.
     * Used when selection state is derived externally (e.g. "the active page id matches this
     * tab's page id"). Does NOT introduce multi-select semantics — only one row should
     * typically return `true`. For multi-select use UIKit `MultiSelect`.
     */
    isSelected?: (item: T, index: number) => boolean;

    /**
     * Per-row tooltip. Returning `null`, `undefined`, `false`, or an empty string suppresses
     * the tooltip on that row. Receives the source `T` (matches the `items` shape).
     * Forwarded to the default `<ListItem>` via the `tooltip` prop. When a custom
     * `renderItem` is supplied, the caller is responsible for wiring the tooltip themselves
     * — `getTooltip` is not invoked by `ListBox` in that path.
     */
    getTooltip?: (item: T, index: number) => React.ReactNode;

    /**
     * Per-row context menu items. Returning `undefined` or an empty array suppresses the
     * menu for that row. Items are dispatched via `ContextMenuEvent.fromNativeEvent(e,
     * "generic")` — they bubble to the global handler which renders the actual menu.
     */
    getContextMenu?: (item: T, index: number) => MenuItem[] | undefined;

    /**
     * Container-level context menu handler — invoked when the user right-clicks on the empty
     * area of the list (no row hit). Use this to add list-background actions ("New file",
     * "Refresh", etc.). Per-row right-clicks DO NOT invoke this handler; they go through
     * `getContextMenu` instead.
     */
    onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;

    // ... existing remaining fields (renderItem, keyboardNav, loading, …) ...
}
```

#### 4c. Resolve selection — predicate vs identity (in `ListBoxModel.ts`)

Replace `isSelectedAt` (added in Step 0) with predicate-aware logic:

```ts
isSelectedAt = (idx: number): boolean => {
    const { resolved, sources } = this.resolved.value;
    const item = resolved[idx];
    if (!item || item.section) return false;
    if (this.props.isSelected) return this.props.isSelected(sources[idx], idx);
    const key = this.selectedKey.value;
    if (key == null) return false;
    return item.value === key;
};
```

Section rows always return `false`. When `isSelected` is provided, it wins over `value`
identity (see Concern #3).

Add `isSelected`, `getTooltip`, and `getContextMenu` to the deps factory of the
"force-update RenderGrid" effect inside `init()`:

```ts
this.effect(
    () => { this.gridRef?.update({ all: true }); },
    () => [
        this.resolved.value.resolved,
        this.selectedKey.value,
        this.props.activeIndex,
        this.props.searchText,
        this.props.renderItem,
        this.props.rowHeight,
        this.props.isSelected,
        this.props.getTooltip,
        this.props.getContextMenu,
    ],
);
```

RenderGrid does not re-render cells when prop functions change identity unless told.

#### 4d. Skip section rows in interaction handlers (in `ListBoxModel.ts`)

Update the model methods added in Step 0:

```ts
onItemClick = (idx: number) => {
    const { resolved, sources } = this.resolved.value;
    const item = resolved[idx];
    if (!item || item.disabled || item.section) return;
    this.props.onChange?.(sources[idx]);
};

onItemMouseEnter = (idx: number) => {
    const { resolved } = this.resolved.value;
    const item = resolved[idx];
    if (!item || item.disabled || item.section) return;
    if (idx !== this.props.activeIndex) this.props.onActiveChange?.(idx);
};
```

Add a "skip sections" helper as a model method:

```ts
findNextSelectable = (start: number, dir: 1 | -1): number => {
    const { resolved } = this.resolved.value;
    let i = start;
    while (i >= 0 && i < resolved.length) {
        const it = resolved[i];
        if (it && !it.section && !it.disabled) return i;
        i += dir;
    }
    return -1;
};
```

Rewrite `onKeyDown` so each direction-changing branch normalizes through
`findNextSelectable`:

```ts
onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!this.props.keyboardNav) return;
    const { resolved } = this.resolved.value;
    const n = resolved.length;
    if (n === 0) return;
    const cur = this.props.activeIndex ?? -1;
    const apply = (target: number) => {
        if (target < 0) return;
        this.props.onActiveChange?.(target);
        this.gridRef?.scrollToRow(target);
    };
    switch (e.key) {
        case "ArrowDown":
            e.preventDefault();
            apply(this.findNextSelectable(Math.min(n - 1, cur + 1), 1));
            break;
        case "ArrowUp":
            e.preventDefault();
            apply(this.findNextSelectable(Math.max(0, cur - 1), -1));
            break;
        case "Home":
            e.preventDefault();
            apply(this.findNextSelectable(0, 1));
            break;
        case "End":
            e.preventDefault();
            apply(this.findNextSelectable(n - 1, -1));
            break;
        case "PageDown": {
            e.preventDefault();
            const page = Math.max(1, this.gridRef?.visibleRowCount ?? 1);
            const start = (cur < 0 ? 0 : cur) + page;
            const target = this.findNextSelectable(Math.min(n - 1, start), 1);
            apply(target >= 0 ? target : this.findNextSelectable(n - 1, -1));
            break;
        }
        case "PageUp": {
            e.preventDefault();
            const page = Math.max(1, this.gridRef?.visibleRowCount ?? 1);
            const start = (cur < 0 ? 0 : cur) - page;
            const target = this.findNextSelectable(Math.max(0, start), -1);
            apply(target >= 0 ? target : this.findNextSelectable(0, 1));
            break;
        }
        case "Enter":
            if (cur >= 0) {
                e.preventDefault();
                this.onItemClick(cur);
            }
            break;
    }
};
```

`Enter` early-returns when `cur < 0`, and `onItemClick` early-returns on section, so no
extra check is needed there.

#### 4e. Render section rows differently in the View's `renderCell`

In `ListBox.tsx`, update the View's inline `renderCell` (introduced in Step 0b) to branch on
`item.section` BEFORE the click/hover wrapper:

```tsx
const renderCell: RenderCellFunc = ({ row: idx, key, style }) => {
    const item = resolved[idx];
    if (!item) return null;

    if (item.section) {
        return (
            <div key={key} style={style}>
                <SectionItem id={model.itemId(idx)} label={item.label} />
            </div>
        );
    }

    const selected = model.isSelectedAt(idx);
    const active = idx === activeIndex;
    const id = model.itemId(idx);
    const tooltip = props.getTooltip?.(sources[idx], idx);

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
                tooltip={tooltip}
            />
        );

    return (
        <div
            key={key}
            style={style}
            onClick={() => model.onItemClick(idx)}
            onMouseEnter={() => model.onItemMouseEnter(idx)}
            onContextMenu={(e) => model.onItemContextMenu(e, idx)}
        >
            {content}
        </div>
    );
};
```

The View reads `props.getTooltip` directly because the tooltip value is computed during
render and there is no caching benefit to moving it into the model.

#### 4f. Per-row context menu handler (in `ListBoxModel.ts`)

Add as a model arrow method:

```ts
onItemContextMenu = (e: React.MouseEvent<HTMLDivElement>, idx: number) => {
    const { resolved, sources } = this.resolved.value;
    const item = resolved[idx];
    if (!item || item.section) return;
    const items = this.props.getContextMenu?.(sources[idx], idx);
    if (!items || items.length === 0) return;
    const ctxEvent = ContextMenuEvent.fromNativeEvent(e, "generic");
    ctxEvent.items.push(...items);
};
```

Notes:
- We do NOT call `e.preventDefault()` or `e.stopPropagation()`. The legacy pattern relies on
  the browser's native `contextmenu` event continuing to bubble to the global handler that
  reads `e.nativeEvent.contextMenuEvent`. Stopping propagation breaks the menu from rendering.
- When `getContextMenu` returns nothing, the method is a no-op — letting the container-level
  `onContextMenu` (4g) fire as if there were no row, and thus no row-specific menu.
  Alternative: still create an empty `ContextMenuEvent` to mark the click as "row was the
  target". Decision: keep the method a strict no-op when the row has no menu, so the
  container's `onContextMenu` can take over for empty-row right-clicks. See Concern #2 for
  the reasoning.
- Section rows skip the method entirely.

#### 4g. Container-level context menu (Model + View)

Add a model method that guards against the row having already populated the event:

```ts
// in ListBoxModel.ts
onRootContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    // Per-row handler may have already populated the ContextMenuEvent. If so, the row's
    // menu wins — skip the container handler.
    if (e.nativeEvent.contextMenuEvent?.items.length) return;
    this.props.onContextMenu?.(e);
};
```

In `ListBox.tsx` (View), destructure `onContextMenu` out of `props` so it never lands in
`...rest` and is never forwarded directly to `<Root>` (which would bypass the model's guard):

```tsx
const {
    loading,
    emptyMessage,
    searchText,
    renderItem,
    keyboardNav = false,
    rowHeight = defaultRowHeight,
    growToHeight,
    whiteSpaceY,
    activeIndex,
    onContextMenu: _onContextMenu,   // captured, not forwarded
    getContextMenu: _getContextMenu, // captured, not forwarded — model already reads from props
    getTooltip: _getTooltip,         // captured, not forwarded — used in renderCell directly
    isSelected: _isSelected,         // captured, not forwarded
    ...rest
} = props;
```

Attach `model.onRootContextMenu` to all three `<Root>` returns (loading, empty, primary):

```tsx
<Root
    id={rootId}
    data-type="list-box"
    role="listbox"
    tabIndex={keyboardNav ? 0 : -1}
    aria-activedescendant={activeId}
    onKeyDown={model.onKeyDown}
    onContextMenu={model.onRootContextMenu}
    {...rest}
>
```

The empty-state `<Root>` also receives `onContextMenu={model.onRootContextMenu}`. The legacy
`List` matches this — the empty container forwards `onContextMenu` (line 368 of List.tsx).

#### 4h. ARIA — sections inside listbox

Sections render with `role="presentation"`, which is the canonical way to mark
"non-interactive child of listbox" without breaking the assistive-tech contract.
`aria-activedescendant` continues to point at the active option (never at a section), and the
container keeps `role="listbox"`. No additional ARIA changes.

### Step 5 — Update barrel exports

`src/renderer/uikit/ListBox/index.ts`:

```ts
export { ListBox, LIST_ITEM_KEY } from "./ListBox";
export type {
    ListBoxProps,
    ListBoxRef,
    IListBoxItem,
    ListItemRenderContext,
} from "./ListBox";
export { ListItem } from "./ListItem";
export type { ListItemProps } from "./ListItem";
export { SectionItem } from "./SectionItem";
export type { SectionItemProps } from "./SectionItem";
```

`src/renderer/uikit/index.ts` — extend the existing "Lists" block:

```ts
// Lists
export { ListBox, LIST_ITEM_KEY } from "./ListBox";
export type {
    ListBoxProps,
    ListBoxRef,
    IListBoxItem,
    ListItemRenderContext,
} from "./ListBox";
export { ListItem, SectionItem } from "./ListBox";
export type { ListItemProps, SectionItemProps } from "./ListBox";
```

### Step 6 — Update Storybook story

Modify `src/renderer/uikit/ListBox/ListBox.story.tsx`. Add four toggleable props (or a
single `variant` enum) to demonstrate the new features. Recommended additions:

- `tooltip: boolean` — when `true`, set `getTooltip={(it) => `tooltip for ${it.label}`}`.
- `contextMenu: boolean` — when `true`, set `getContextMenu` returning a small static
  `MenuItem[]` (e.g. "Copy", "Remove from list") and a container-level `onContextMenu` that
  pushes `{ label: "List background action" }` via `ContextMenuEvent.fromNativeEvent`.
- `predicateSelection: boolean` — when `true`, replace `value` + `onChange` with
  `isSelected={(it) => it.value % 5 === 0}` so every fifth row appears selected.
- `sections: boolean` — when `true`, generate items as 4 sections × 15 rows each, with each
  section header having `section: true`, `value: "section-${n}"`, `label: "Group ${n}"`.

Concrete additions (relative to the existing story):

```ts
const SECTIONED_ITEMS: IListBoxItem[] = (() => {
    const out: IListBoxItem[] = [];
    for (let g = 0; g < 4; g++) {
        out.push({ value: `section-${g}`, label: `Group ${g + 1}`, section: true });
        for (let i = 0; i < 15; i++) {
            out.push({
                value: `g${g}-i${i}`,
                label: `Item ${g + 1}.${i + 1}`,
                icon: resolveIconPreset("globe"),
            });
        }
    }
    return out;
})();
```

In the demo component, branch `items` on `props.sections`:

```tsx
const baseItems = props.sections ? SECTIONED_ITEMS : ITEMS.filter(/* removed-set as before */);
```

Wire the new handlers:

```tsx
const getTooltip = props.tooltip
    ? (it: IListBoxItem) => (typeof it.label === "string" ? `Tooltip: ${it.label}` : null)
    : undefined;

const getContextMenu = props.contextMenu
    ? (it: IListBoxItem): MenuItem[] => [
        { label: `Copy "${it.label}"`, onClick: () => {} },
        { label: "Remove", onClick: () => {} },
    ]
    : undefined;

const onContextMenu = props.contextMenu
    ? (e: React.MouseEvent) => {
        const ctx = ContextMenuEvent.fromNativeEvent(e, "generic");
        ctx.items.push({ label: "List background action", onClick: () => {} });
    }
    : undefined;
```

Add to the `ListBox` props:

```tsx
isSelected={props.predicateSelection ? ((it: IListBoxItem) => Number(it.value) % 5 === 0) : undefined}
getTooltip={getTooltip}
getContextMenu={getContextMenu}
onContextMenu={onContextMenu}
```

Add to the story's `props` array:

```ts
{ name: "tooltip",            type: "boolean", default: true  },
{ name: "contextMenu",        type: "boolean", default: false },
{ name: "predicateSelection", type: "boolean", default: false },
{ name: "sections",           type: "boolean", default: false },
```

Imports to add at the top of the story file:

```ts
import { MenuItem } from "../Menu";
import { ContextMenuEvent } from "../../api/events/events";
```

### Step 7 — Dashboard update

In [`doc/active-work.md`](../../active-work.md):

1. Replace the existing line:
   ```
   - [ ] US-484: UIKit ListBox extensions — row tooltip, context menu, predicate selection, section rows *(Phase 4 — list infrastructure; blocks US-479)*
   ```
   with a link to this README:
   ```
   - [ ] [US-484: UIKit ListBox extensions — row tooltip, context menu, predicate selection, section rows](tasks/US-484-uikit-listbox-extensions/README.md) *(Phase 4 — list infrastructure; blocks US-479)*
   ```
   *Status remains "Active" / unchecked — implementation begins after the user reviews this
   document.*

2. The US-479 line already declares `blocked on US-484`; no change needed.

### Step 8 — TypeScript check

`npx tsc --noEmit` — no new errors introduced by the changes (baseline at task start should
match baseline at task end; verify before commit).

### Step 9 — Manual smoke test (Storybook)

Run `npm start`, open Storybook editor, navigate to "ListBox" under "Lists":

- **Tooltip:** with `tooltip: true`, hover a row → after ~600ms, a tooltip appears showing
  `"Tooltip: Suggestion N — apple banana cherry"`. Move cursor away → tooltip disappears.
  Toggle `tooltip: false` → no tooltip shows.
- **Per-row context menu:** with `contextMenu: true`, right-click a row → the global popup
  menu opens with "Copy …" and "Remove" entries. Click outside to dismiss.
- **Container context menu:** with `contextMenu: true`, right-click on the empty area below
  the rows (or load a small enough item set so empty space is visible) → the menu opens with
  the single "List background action" entry.
- **Predicate selection:** with `predicateSelection: true`, every fifth row (indices 0, 5,
  10, …) shows the selection background. Clicking a row does NOT change which rows are
  selected (because `value`/`onChange` are no-ops in this branch). Hover still flips the
  active row independently.
- **Section rows:** with `sections: true`, four "Group 1…4" headers render, dim and centered.
  Hovering a section does not change `activeIndex`. Clicking a section does nothing. Arrow
  keys skip section rows when navigating from one group's last item to the next group's
  first item. Section rows show no selection check even when their index would otherwise
  match the active value.
- **Combined:** enable `tooltip` + `contextMenu` + `sections` together → tooltips fire only on
  non-section rows; section rows have no context menu (right-click on a section falls through
  to the container handler if defined).
- **Theme cycling:** themes (`default-dark`, `light-modern`, `monokai`) — section row dim
  color, tooltip background, and selection styling all follow the theme.
- **DevTools:** section rows have `data-type="list-section"` and `role="presentation"`. Tab
  rows continue to have `data-type="list-item"`, `role="option"`, etc.

## Concerns / Open questions

All resolved before implementation.

### 1. `isSelected` predicate vs full multi-select API — RESOLVED: predicate only

V1 ListBox is single-select per US-468 Concern #2. Multi-select arrives via UIKit
`MultiSelect`, a separate component. `isSelected` here is purely a render-time predicate that
overrides the default `value`-identity check — it does not change selection semantics
(selection state is still owned by the consumer; `onChange` still emits one item at a time).
Naming: `isSelected` mirrors React's predicate-prop convention (e.g. `getRowId`,
`isItemSelected` — common React-table API).

### 2. Empty-row right-click vs row right-click — RESOLVED: row wins when its menu is non-empty

When the user right-clicks ON a row, ListBox first invokes `getContextMenu(item, idx)`. If
the result is non-empty, items are pushed to the `ContextMenuEvent`; the container handler
short-circuits (it sees `e.nativeEvent.contextMenuEvent?.items.length > 0`).

When the row returns no menu, the per-row handler does nothing — the event bubbles to the
container `onContextMenu`, which fires normally. Same when the click misses all rows
entirely (e.g. empty area below the last row, or the `EmptyRoot` rendered when `items` is
empty).

Section rows always skip per-row dispatch. Right-clicking a section row falls through to the
container handler.

### 3. Predicate selection + `value` set simultaneously — RESOLVED: predicate wins

If both `value` and `isSelected` are passed, `isSelected` is used and `value` is ignored. The
runtime does not warn — passing both is occasionally useful during refactors when a consumer
gradually migrates from `value` to `isSelected`. TypeScript does not enforce mutual
exclusion (would require an awkward XOR type that hurts ergonomics elsewhere).

A short JSDoc note on `isSelected` explains this. No log message — UIKit components don't
emit `console.warn` per existing convention.

### 4. Section rows and `activeIndex` from outside the component — RESOLVED: clamp at render time

External drivers (Select keyboard handlers, the URL bar) pass `activeIndex` directly. If a
caller passes an index pointing at a section row, the row should NOT show the active
highlight. This is handled naturally because `active = idx === activeIndex` is computed
inside `renderCell`, and `SectionItem` does not consume the `active` flag at all — the
section row renders identically regardless of the value.

The keyboard handler inside `ListBox` is the only path that `ListBox` itself controls, and it
uses `findNextSelectable` to skip sections. External drivers should also skip section rows on
their side (they have access to the items array). No defensive renormalization in
`onActiveChange` — that would mask bugs in the external driver.

### 5. Tooltip on custom `renderItem` — RESOLVED: caller responsibility

When the consumer passes `renderItem`, the default `<ListItem>` is bypassed entirely, so the
`tooltip` prop has no place to plug into. `ListBox` does NOT call `getTooltip` and forward
the result to `renderItem` — the caller can read `getTooltip` from props and do whatever
they want.

Reasoning: custom rows often have multiple parts that each may want their own tooltip (e.g.
the URL suggestions row has a label, an icon, and a remove button — each could have its own
tooltip). A blanket `tooltip` prop wrapping the entire row would constrain that. Custom
rows already wrap themselves in `<Tooltip>` when they need one. JSDoc on `getTooltip` calls
out this constraint explicitly.

### 6. `onContextMenu` typing on `ListBoxProps` — RESOLVED: explicit prop, removed from `...rest`

`React.HTMLAttributes<HTMLDivElement>` already declares `onContextMenu`. Re-declaring it on
`ListBoxProps` is a TypeScript widening (the declared type matches), but doing so
matters because we destructure it explicitly and add custom guard logic. Without explicit
destructuring, `onContextMenu` lands in `...rest` and is spread onto `<Root>`, bypassing our
guard.

The cleanest fix: declare `onContextMenu` on `ListBoxProps` (same signature as
HTMLAttributes), destructure it in the function body, and never put it in `rest`. That keeps
the public type identical and gives us a single attachment point.

### 7. `getContextMenu` returning empty array — RESOLVED: no-op

If `getContextMenu(item)` returns `[]`, no items are pushed; the per-row handler is
effectively a no-op. The container-level `onContextMenu` fires next. This matches the
intuitive expectation: "I don't have a menu for this row, but maybe the container does".

### 8. `ContextMenuEvent` target kind — RESOLVED: `"generic"`

Per the [context-menu.md](../../architecture/context-menu.md) target-kinds table, `"generic"`
is the catch-all for list/component sources whose target shape is unspecified. Legacy `List`
uses `"generic"` (line 183 of `List.tsx`). UIKit `ListBox` matches.

When a sidebar consumer needs a more specific target kind (e.g. `"sidebar-folder"` for
`FolderItem`), the consumer can use a custom `renderItem` and dispatch its own
`ContextMenuEvent` with the right kind — not something `ListBox` exposes as a prop. Less than
1% of consumers care, and exposing a `contextTargetKind` prop pollutes the API for everyone
else.

### 9. Section row rendering — separate component vs branch in `<ListItem>` — RESOLVED: separate

A `section: true` row has fundamentally different behavior (no hover, no click, no selection
check, no icon, no active highlight, no tooltip, role=presentation). Cramming both modes
into `<ListItem>` would mean ~half its existing logic is gated on `!section`. A 40-line
`SectionItem` is far easier to reason about than a forked `ListItem` — and exposing
`SectionItem` as a public UIKit element lets custom `renderItem` callers reuse it in their
own renderers if they roll their own section logic.

### 10. Tooltip JSX child requirements — RESOLVED: works with current `<Root>`

UIKit `Tooltip` requires a single React element child whose ref forwards to a DOM node.
`ListItem`'s `Root` is `forwardRef<HTMLDivElement, …>`, so wrapping in `<Tooltip>` works
without additional plumbing. Verified by inspection of `Tooltip.tsx` lines 124–161.

### 11. Tooltip delay configurability — RESOLVED: defaults only in V2.1

Default `delayShow=600 / delayHide=100` matches every existing UIKit Tooltip site. None of
the four sidebar lists override this. If a future consumer needs a different delay, expose
`tooltipDelay?: [number, number]` on `ListItem` and forward to `<Tooltip>`. Out of scope for
this task. (Note: legacy List used `delayShow={1500}`; we deliberately move to 600 to align
with UIKit Tooltip defaults — see Concern #12.)

### 12. Tooltip delay regression vs legacy — RESOLVED: align with UIKit default

Legacy `List` used `delayShow={1500}`. UIKit Tooltip default is 600. Moving to 600 makes the
sidebar feel more responsive and matches the rest of UIKit. Sidebar items show full file
paths — useful info, worth showing sooner. If users report it as too eager, a per-call
override (Concern #11) handles that without needing to special-case sidebar lists.

### 13. Section row height — RESOLVED: same as item height

V1 uses a single `rowHeight` for both item and section rows. Distinct heights would require
RenderGrid's variable-row-height path or a second array — both nontrivial and unmotivated by
the consumers. If a future caller needs taller section headers, expose
`sectionRowHeight?: number` later.

### 14. PageDown / PageUp landing on a section — RESOLVED: skip then fall back

`PageDown` from inside a group might land its computed target right on a section row. The
keyboard handler runs `findNextSelectable(target, +1)` to skip forward; if that fails (e.g.
the last group's section is the last row), it falls back to `findNextSelectable(n - 1, -1)`
to walk backwards from the end. Same logic mirrored for `PageUp` walking forward from 0.

This guarantees Page-Down / Page-Up always land on a real item when one exists, never on a
section.

### 15. Generic `T` + `useComponentModel` — RESOLVED: model is generic over T

`useComponentModel<T, P, M extends TComponentModel<T, P>>` infers `T` (state) and `P`
(props) from the arguments. `ListBoxModel<T>` is generic over the source item type, so the
inferred `P` becomes `ListBoxProps<T>` automatically. The View uses
`useComponentModel(props, ListBoxModel<T>, defaultListBoxState)`.

The forwardRef cast at the bottom of the View file (`as <T = IListBoxItem>(props: …) => …`)
is unchanged from the current code — it's the documented TypeScript workaround for losing
the generic in `forwardRef`, used elsewhere in the repo (`List`, `ListMultiselect`).

### 16. Why a `revision` slot if the model uses `memo()` — RESOLVED: it is the View's
re-render trigger

`TComponentModel.memo()` caches a value, but it does NOT itself trigger React re-renders
when deps change — that's the View's job. The View calls `model.state.use(s => s.revision)`
once to subscribe; whenever the View needs to force a re-render (rare in this component, but
needed for things like `gridRef.update({ all: true })` not being enough on its own),
`this.state.update(s => { s.revision += 1; })` from the model.

For ListBox, the `revision` field is mostly defensive — most state changes that should
invalidate the View come through `props` updates (handled by `setPropsInternal`) or
`gridRef.update()` (handled inside RenderGrid). Keeping the slot reserved means future
features can bump it without re-plumbing state shape.

If during implementation we find that no model code actually bumps `revision`, drop it and
the `model.state.use(...)` line — the model still functions correctly without any state
slice. Decision deferred to implementation: keep if anything bumps it, drop if nothing does.

## Acceptance criteria

1. **Model-view migration:** `src/renderer/uikit/ListBox/ListBoxModel.ts` exists and exports
   `ListBoxModel`, `ListBoxState`, `defaultListBoxState`. `ListBox.tsx` is a thin View that
   uses `useComponentModel(props, ListBoxModel, defaultListBoxState)` and contains zero
   `useState`, zero `useCallback`, and at most one `useImperativeHandle` + one `useId`.
   `useEffect` only appears via `useComponentModel`'s internal init/dispose plumbing — none
   directly in the View.
2. **Migration smoke test:** after Step 0 and BEFORE any feature work, Storybook → ListBox
   exhibits identical V1 behavior (selection, hover, keyboard nav, searchText, loading,
   empty, themes, ARIA, traited items per US-468 step 11).
3. `IListBoxItem.section?: boolean` exists in `ListBox.tsx`.
4. `SectionItem` component exists at `src/renderer/uikit/ListBox/SectionItem.tsx`, exports
   `SectionItem` and `SectionItemProps`, and is re-exported from
   `src/renderer/uikit/ListBox/index.ts` and `src/renderer/uikit/index.ts`.
5. `ListItemProps.tooltip?: React.ReactNode` exists and `<ListItem>` wraps the row in UIKit
   `<Tooltip>` when truthy.
6. `ListBoxProps` exposes `isSelected`, `getTooltip`, `getContextMenu`, and `onContextMenu`
   with the documented types.
7. With `isSelected`, `value` is ignored and per-row selected flag comes from the predicate.
8. `getContextMenu` causes a right-click on a row to populate
   `ContextMenuEvent.fromNativeEvent(e, "generic")` with the returned items.
9. `onContextMenu` (container-level) fires only when a right-click does NOT already hit a row
   that produced a non-empty menu.
10. Section rows render through `SectionItem` (`data-type="list-section"`,
    `role="presentation"`) and skip hover, click, selection, and the `active` highlight.
11. Keyboard navigation (`ArrowUp`/`ArrowDown`/`PageUp`/`PageDown`/`Home`/`End`) skips section
    rows and lands on the next selectable item.
12. `npx tsc --noEmit` reports no new errors.
13. `npm run lint` reports no new ESLint errors.
14. **Smoke test — tooltip:** Storybook → ListBox with `tooltip: true`, hovering a row shows
    a UIKit Tooltip with the expected content.
15. **Smoke test — context menu:** Storybook → ListBox with `contextMenu: true`, right-click
    a row opens the menu via the global popper system (legacy `showAppPopupMenu`); right-click
    empty area opens the container's "List background action" menu.
16. **Smoke test — predicate selection:** Storybook → ListBox with `predicateSelection: true`,
    every fifth row shows the selection background.
17. **Smoke test — sections:** Storybook → ListBox with `sections: true`, four group headers
    render dim and centered. Hover skips them. Arrow-key nav across groups skips them. No
    section row receives `data-active` or `data-selected`.
18. **Smoke test — themes:** All three themes (`default-dark`, `light-modern`, `monokai`)
    render section rows, tooltip, and selection consistently.
19. **Dashboard updated:** US-484 entry in [`doc/active-work.md`](../../active-work.md)
    becomes a markdown link to this README; status remains unchecked.

## Files Changed summary

| File | Action | Notes |
|------|--------|-------|
| `src/renderer/uikit/ListBox/ListBox.tsx` | Modify | Add `section` to `IListBoxItem`; add `isSelected`, `getTooltip`, `getContextMenu`, `onContextMenu` props; section-aware rendering, keyboard skip, container-vs-row context menu guard |
| `src/renderer/uikit/ListBox/ListItem.tsx` | Modify | Add `tooltip?: React.ReactNode`; wrap with UIKit `<Tooltip>` when set |
| `src/renderer/uikit/ListBox/SectionItem.tsx` | Create | Section-row presentation component, ~40 lines |
| `src/renderer/uikit/ListBox/index.ts` | Modify | Export `SectionItem`, `SectionItemProps` |
| `src/renderer/uikit/ListBox/ListBox.story.tsx` | Modify | Add `tooltip` / `contextMenu` / `predicateSelection` / `sections` props and demos |
| [`src/renderer/uikit/index.ts`](../../../src/renderer/uikit/index.ts) | Modify | Re-export `SectionItem`, `SectionItemProps` |
| [`doc/active-work.md`](../../active-work.md) | Modify | Convert the US-484 line to a link to this README |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md) — Phase 4 list infrastructure follow-up
- Built on: [US-468](../US-468-uikit-listbox/README.md) — UIKit ListBox V1
- Composes: [US-467](../US-467-uikit-tooltip/README.md) — UIKit Tooltip; [US-481](../US-481-uikit-menu-with-menu/README.md) — `MenuItem` re-export only (no UIKit Menu rendering yet, see Concern in Background)
- Blocks: [US-479](../US-479-sidebar-lists-migration/README.md) — sidebar lists migration
- Related future task: **US-482** — `showAppPopupMenu` refactor will swap the legacy popper for UIKit `Menu`; ListBox consumers automatically benefit with no code change.
