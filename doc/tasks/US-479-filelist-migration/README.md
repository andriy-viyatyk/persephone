# US-479: FileList + RecentFileList — UIKit migration

## Status

**Active** — full plan and investigation complete; ready for implementation.

Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration. Originally
the "Sidebar lists" bundled task; split into four tasks (US-479, US-490, US-491,
US-492) so each piece is independently testable and the largest change (FileList)
is reviewed in isolation.

## Goal

Migrate `src/renderer/ui/sidebar/FileList.tsx` and its thin wrapper
`src/renderer/ui/sidebar/RecentFileList.tsx` from the legacy
`components/form/List` + `components/basic/{TextField, Button}` stack to UIKit
`ListBox` + `Input` + `IconButton`. Preserve every existing behavior the sidebar
Recent Files panel relies on:

- Search bar with substring highlighting.
- Imperative `FileListRef` (`showSearch` / `hideSearch`) used by `MenuBar`'s Ctrl+F
  handler ([`MenuBar.tsx:248`](../../../src/renderer/ui/sidebar/MenuBar.tsx)).
- Per-row context menu and full-path hover tooltip.
- File / folder icon resolution via existing `FileIcon` / `FolderIcon`.
- Empty message ("no files").

After this task, both files contain zero imports from `components/form/`,
`components/basic/Button`, `components/basic/TextField`, or
`components/overlay/PopupMenu`. They may continue to use `@emotion/styled` on
local chrome `<div>` elements per the `src/renderer/ui/` exception in
[`uikit/CLAUDE.md`](../../../src/renderer/uikit/CLAUDE.md) Rule 7. They MUST NOT
pass `style=` or `className=` to UIKit components (TypeScript-enforced).

## Background

### What `FileList` does today

[`src/renderer/ui/sidebar/FileList.tsx`](../../../src/renderer/ui/sidebar/FileList.tsx)
is a generic list + searchbar wrapper. Public surface:

```ts
export interface FileListItem { filePath: string; title: string; isFolder?: boolean; }
export interface FileListRef  { showSearch: () => void; hideSearch: () => void; }
interface FileListProps {
    items: FileListItem[];
    onClick: (item: FileListItem) => void;
    getContextMenu?: (item: FileListItem) => MenuItem[] | undefined;
    onContextMenu?: (e: React.MouseEvent) => void;
    searchable?: boolean;          // never read in current source — see Concerns
}
```

Render structure:

```tsx
<FileListWrapper tabIndex={0} onKeyDown=...>
  {searchVisible && (
    <div className="file-list-search">
      <TextField value=searchText onChange=... endButtons=[<Button type="icon"/>]/>
    </div>
  )}
  <HighlightedTextProvider value={searchText}>
    <FileListStyled
      options={filteredItems}
      getLabel=... getIcon=... getTooltip=...
      getContextMenu=... onContextMenu=...
      selectedIcon={<span/>}    // suppress check icon
      rowHeight={22}
      emptyMessage="no files"
    />
  </HighlightedTextProvider>
</FileListWrapper>
```

Verified facts (from reading the source):

- **No selection state.** `getSelected` is never passed; `selectedIcon={<span/>}` is a
  hack to hide the default check icon. `value` / `onChange` selection is not used —
  the consumer only receives `onClick`.
- **Imperative ref API.** `showSearch()` sets `searchVisible=true` and focuses the
  input via `setTimeout(...0)`; `hideSearch()` clears `searchText` and hides the bar.
  `MenuBar` calls `showSearch()` from a Ctrl+F keydown handler.
- **Highlighting** is done two ways: `HighlightedTextProvider` (context, read by
  legacy `List`'s `DefaultCell` only when label is a string) AND a per-row
  `getLabelHighlighted` accessor that returns the `highlightText()` result directly
  when `searchText` is set. After migration both go away — UIKit `ListBox`'s
  `searchText` prop drives highlighting through its default `<ListItem>`.
- **Filtering** uses `searchMatch()` from
  [`useHighlightedText.tsx`](../../../src/renderer/components/basic/useHighlightedText.tsx)
  against `[(i) => i.title]`. We keep using `searchMatch` — migrating that helper
  is out of scope.
- **Escape behavior** depends on context:
  - In the search input → `onSearchKeyDown` clears + hides + refocuses root.
  - On the FileList root with search visible → `onKeyDown` clears + hides + refocuses root.
  - On the FileList root with search hidden → handler does nothing → bubbles up; consumed by `MenuBar` to close the panel.

### What `RecentFileList` does today

[`src/renderer/ui/sidebar/RecentFileList.tsx`](../../../src/renderer/ui/sidebar/RecentFileList.tsx)
is a 86-line `forwardRef` wrapper:

- Loads `recent.useFiles()`, maps each path to `{ filePath, title: fpBasename(filePath) }`.
- Renders `<FileList ref={ref} items=... onClick=... getContextMenu=...>`.
- Builds a 4-item context menu (Open / Open in New Window / Show in File Explorer / Remove from Recent).
- Forwards `FileListRef` so `MenuBar`'s Ctrl+F still reaches `showSearch()`.

After migration `RecentFileList` does **not** change shape. The only edit is the
`MenuItem` import path (legacy → UIKit re-export).

### What MenuBar does with the ref

[`MenuBar.tsx`](../../../src/renderer/ui/sidebar/MenuBar.tsx):

- Line 187: `fileListRef: FileListRef | null = null;`
- Line 193: `setFileListRef = (ref: FileListRef | null) => { this.fileListRef = ref; };`
- Line 248: `this.fileListRef?.showSearch();` (Ctrl+F handler).
- Line 480: `<RecentFileList ref={model.setFileListRef} onClose={props.onClose} />`

`FileListRef` shape MUST stay `{ showSearch(): void; hideSearch(): void }`.

### What UIKit gives us

UIKit `ListBox` (after [US-484](../US-484-uikit-listbox-extensions/README.md)) supports
everything `FileList` needs:

| Feature | ListBox prop |
|---|---|
| Items + label/icon | `items: T[] \| Traited<T[]>` resolved against `LIST_ITEM_KEY` |
| Substring highlight | `searchText` (drives default `<ListItem>` highlighting) |
| Per-row tooltip | `getTooltip(item, index) => ReactNode` |
| Per-row context menu | `getContextMenu(item, index) => MenuItem[]` |
| Container context menu | `onContextMenu(e)` |
| Empty message | `emptyMessage` |
| Row height | `rowHeight` (default 24 — we pass 22) |

The default `<ListItem>` renders `[icon][label][selected ? <CheckIcon/> : null]`
with `searchText` highlighting. `FileList` never sets selection, so no check
ever renders — the `selectedIcon={<span/>}` hack from the legacy List goes away
without replacement.

UIKit `Input` (`uikit/Input/Input.tsx`) supports `endSlot` for the clear button.
UIKit `IconButton` replaces the legacy icon-only `Button`. Both honor Rule 1
(`data-type`, `data-*` state).

### Trait wiring (Rule 3)

`ListBox` resolves trait-wrapped items via `LIST_ITEM_KEY` (declared in
[`uikit/ListBox/types.ts:31`](../../../src/renderer/uikit/ListBox/types.ts) as
`new TraitKey<TraitType<IListBoxItem>>("listbox-item")`). The pattern (matching
how `LIST_ITEM_KEY` is consumed elsewhere) is:

```ts
const fileListTraits = new TraitSet().add(LIST_ITEM_KEY, {
    value: (item: unknown) => (item as FileListItem).filePath,
    label: (item: unknown) => (item as FileListItem).title,
    icon:  (item: unknown) => (item as FileListItem).isFolder
        ? <FolderIcon />
        : <FileIcon path={(item as FileListItem).filePath} />,
});

// inside component:
const tItems = useMemo(
    () => traited(filteredItems, fileListTraits),
    [filteredItems],
);
```

`fileListTraits` is hoisted to module level — it captures no React state. Source
identity is preserved through `onChange` (ListBox emits the original
`FileListItem`), which is what `props.onClick(item)` expects.

> Note: `uikit/CLAUDE.md` Rule 3 example shows
> `TraitRegistry.register<TraitType<IOption>>("select-option")`. That doc is out
> of date — actual UIKit code uses `new TraitKey<TraitType<...>>(...)` directly
> (see `LIST_ITEM_KEY` in `uikit/ListBox/types.ts`). Discrepancy will be cleaned
> up by `/document` at epic close; not in scope here.

### Rule 7 compliance

`src/renderer/ui/sidebar/` falls under the **application chrome exception** —
`@emotion/styled`, `style=`, `className=` are allowed on local elements (the
wrapper `<div>`s around search + ListBox). They are NOT allowed on UIKit
components. So:

- `FileListWrapper` (the outer `<div>`) — keep as `styled.div`. Chrome layout,
  not a wrapper around a UIKit component.
- `FileListStyled` (the legacy `styled(List)`) — **delete**. Its `:hover` /
  `&.selected` overrides are no longer needed; `<ListItem>` handles those via
  `[data-active]`.
- The `.file-list-search` row — keep as `styled.div` (`SearchRow`) with
  `padding: 4px`. Chrome.

## Implementation plan

### Step 1 — Rewrite `src/renderer/ui/sidebar/FileList.tsx`

Replace the entire file. Target structure:

```tsx
import styled from "@emotion/styled";
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ListBox, LIST_ITEM_KEY, Input, IconButton } from "../../uikit";
import type { MenuItem } from "../../uikit/Menu";
import { TraitSet, traited } from "../../core/traits/traits";
import { FileIcon, FolderIcon } from "../../components/icons/FileIcon";
import { searchMatch } from "../../components/basic/useHighlightedText";
import { CloseIcon } from "../../theme/icons";

export interface FileListItem {
    filePath: string;
    title: string;
    isFolder?: boolean;
}

export interface FileListRef {
    showSearch: () => void;
    hideSearch: () => void;
}

interface FileListProps {
    items: FileListItem[];
    onClick: (item: FileListItem) => void;
    getContextMenu?: (item: FileListItem) => MenuItem[] | undefined;
    onContextMenu?: (e: React.MouseEvent) => void;
    searchable?: boolean;
}

const FileListWrapper = styled.div({
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    outline: "none",
});

const SearchRow = styled.div({
    padding: 4,
});

const fileListTraits = new TraitSet().add(LIST_ITEM_KEY, {
    value: (item: unknown) => (item as FileListItem).filePath,
    label: (item: unknown) => (item as FileListItem).title,
    icon:  (item: unknown) => (item as FileListItem).isFolder
        ? <FolderIcon />
        : <FileIcon path={(item as FileListItem).filePath} />,
});

export const FileList = forwardRef<FileListRef, FileListProps>(
    function FileList(props, ref) {
        const [searchText, setSearchText] = useState("");
        const [searchVisible, setSearchVisible] = useState(false);
        const rootRef = useRef<HTMLDivElement>(null);
        const searchInputRef = useRef<HTMLInputElement>(null);

        const hideSearch = () => {
            setSearchVisible(false);
            setSearchText("");
        };
        const hideSearchAndFocus = () => {
            hideSearch();
            rootRef.current?.focus();
        };
        const onSearchBlur = () => { if (!searchText) hideSearch(); };

        useImperativeHandle(ref, () => ({
            showSearch: () => {
                setSearchVisible(true);
                setTimeout(() => searchInputRef.current?.focus(), 0);
            },
            hideSearch,
        }));

        const filteredItems = useMemo(() => {
            if (!searchText) return props.items;
            const lower = searchText.toLowerCase().split(" ").filter(Boolean);
            return props.items.filter(
                (item) => searchMatch(item, lower, [(i) => i.title]),
            );
        }, [props.items, searchText]);

        const tItems = useMemo(
            () => traited(filteredItems, fileListTraits),
            [filteredItems],
        );

        const onKeyDown = (e: React.KeyboardEvent) => {
            if (e.key === "Escape" && searchVisible) {
                e.preventDefault();
                e.stopPropagation();
                hideSearchAndFocus();
            }
        };
        const onSearchKeyDown = (e: React.KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                hideSearchAndFocus();
            }
        };

        return (
            <FileListWrapper ref={rootRef} tabIndex={0} onKeyDown={onKeyDown}>
                {searchVisible && (
                    <SearchRow>
                        <Input
                            ref={searchInputRef}
                            value={searchText}
                            onChange={setSearchText}
                            placeholder="Search..."
                            onKeyDown={onSearchKeyDown}
                            onBlur={onSearchBlur}
                            endSlot={searchText ? (
                                <IconButton
                                    icon={<CloseIcon />}
                                    title="Clear Search"
                                    size="sm"
                                    onClick={hideSearchAndFocus}
                                />
                            ) : null}
                        />
                    </SearchRow>
                )}
                <ListBox<FileListItem>
                    items={tItems}
                    searchText={searchText || undefined}
                    rowHeight={22}
                    onChange={props.onClick}
                    getTooltip={(item) => item.filePath}
                    getContextMenu={props.getContextMenu}
                    onContextMenu={props.onContextMenu}
                    emptyMessage="no files"
                />
            </FileListWrapper>
        );
    }
);
```

**Notes:**

- `traited(...)` signature is `(target, traits: TraitSet)` (verified in
  `core/traits/traits.ts:52`). The `TraitSet` accessor map uses `LIST_ITEM_KEY`
  (re-exported from `uikit/index.ts`).
- Double-check at implementation time that `Input` accepts `ref`,
  `onKeyDown`, `onBlur`, `placeholder`, and `endSlot`. (Confirmed by reading
  `uikit/Input/Input.tsx`: `ref` on the inner input, `endSlot` slot, all
  HTML attrs spread.)
- Public exports (`FileList`, `FileListItem`, `FileListRef`) keep their shape;
  `RecentFileList.tsx` and `MenuBar.tsx` need no consumer-side changes for
  imports to resolve.

### Step 2 — Update `src/renderer/ui/sidebar/RecentFileList.tsx`

One-line change: switch the `MenuItem` import to UIKit.

```diff
- import { MenuItem } from "../../components/overlay/PopupMenu";
+ import type { MenuItem } from "../../uikit/Menu";
```

Both re-export the same `MenuItem` type from `api/types/events`, so runtime is
identical. Rest of the file unchanged.

### Step 3 — `src/renderer/ui/sidebar/MenuBar.tsx`

No changes. The `FileListRef` import (`./FileList`) keeps resolving because the
rewritten `FileList.tsx` re-exports the same interface.

### Step 4 — Lint + manual smoke

- `npm run lint` clean.
- Open Persephone → click the sidebar button → "Recent Files".
- Verify: items render with icon + name; hovering shows full-path tooltip;
  click opens the file; right-click shows the 4-entry menu.
- Press Ctrl+F → search bar appears, focused.
- Type a substring → list filters; matching characters highlighted.
- Press Escape in search → bar disappears, focus returns to list root.
- Press Escape again → MenuBar closes.

## Concerns

All resolved during investigation; documented inline above. None left for
implementation time.

- `searchable?: boolean` prop is declared but never read in current source.
  Keep the prop for shape compatibility (consumers pass it; behavior
  unchanged: search is always reachable via `showSearch()`).
- Trait helper signature confirmed: `traited(target, traits)`. The
  `TraitRegistry.register(...)` example in `uikit/CLAUDE.md` Rule 3 is stale
  and not what real UIKit code uses.

## Acceptance criteria

1. `src/renderer/ui/sidebar/FileList.tsx` contains **zero imports** from
   `components/form/List`, `components/basic/Button`, `components/basic/TextField`,
   `components/basic/useHighlightedText`'s `HighlightedTextProvider`, or
   `components/overlay/PopupMenu`. (`searchMatch` import remains.)
2. `FileList`, `FileListItem`, and `FileListRef` exports are shape-compatible
   with the current API (no consumer-side compile errors).
3. Recent Files panel:
   - Renders items with icon + name.
   - Click an item → file opens.
   - Right-click → 4-item context menu (Open / Open in New Window /
     Show in File Explorer / Remove from Recent).
   - Hover → tooltip shows full file path.
4. Ctrl+F (in MenuBar with Recent Files panel active) reveals the search bar
   focused; typing filters items and highlights matches.
5. Escape:
   - In search input or root with search visible → hides search, returns focus to root.
   - On root with search hidden → bubbles up (closes MenuBar).
6. `npm run lint` passes.
7. `searchMatch` filtering behavior unchanged (multi-word AND match on `title`).

## Files Changed

| File | Change |
|---|---|
| `src/renderer/ui/sidebar/FileList.tsx` | Full rewrite — UIKit `ListBox` + `Input` + `IconButton`; trait-resolved items; drop `HighlightedTextProvider`; drop `FileListStyled` overrides. |
| `src/renderer/ui/sidebar/RecentFileList.tsx` | One-line `MenuItem` import path → `uikit/Menu`. |

### Files unchanged

- `src/renderer/ui/sidebar/MenuBar.tsx` — `FileListRef` shape preserved.
- `src/renderer/ui/sidebar/index.ts` — re-export shape preserved.
- `src/renderer/components/basic/useHighlightedText.tsx` — `searchMatch` still
  used; full removal of this helper is out of scope.
- `src/renderer/components/icons/FileIcon.tsx` — still used.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Depends on:
  - [US-468](../US-468-uikit-listbox/README.md) — UIKit ListBox
  - [US-484](../US-484-uikit-listbox-extensions/README.md) — ListBox extensions (tooltip, context menu, predicate selection, sections)
- Sibling tasks (split from original US-479 bundle):
  - [US-490](../US-490-opentabslist-migration/README.md) — OpenTabsList migration
  - [US-491](../US-491-folderitem-migration/README.md) — FolderItem + MenuBar left list migration
  - [US-492](../US-492-sidebar-integration-testing/README.md) — Final sidebar integration testing
