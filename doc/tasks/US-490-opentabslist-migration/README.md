# US-490: OpenTabsList — UIKit migration

## Goal

Migrate [`src/renderer/ui/sidebar/OpenTabsList.tsx`](../../../src/renderer/ui/sidebar/OpenTabsList.tsx)
from the legacy [`components/form/List`](../../../src/renderer/components/form/List.tsx)
to UIKit [`ListBox`](../../../src/renderer/uikit/ListBox/ListBox.tsx). Window-header
rows become non-interactive section rows inside the same virtualized list. The
"current page" indicator is delivered via the `isSelected` predicate (the row is
selected when `item.page?.id === activePageId`), not via the default
`value`/`onChange` identity check.

After this task, `OpenTabsList.tsx` contains zero imports from `components/form/`
and uses UIKit primitives only. The mixed window-header + tab-row layout stays
identical visually; the file shrinks and the styled wrapper around `<List>`
(`OpenTabsListRoot`) is removed entirely.

## Background

### Current implementation

[`src/renderer/ui/sidebar/OpenTabsList.tsx`](../../../src/renderer/ui/sidebar/OpenTabsList.tsx)
renders a single virtualized list whose items are interleaved:

```
{ windowIndex: 0 }                                  ← window header (no page)
{ windowIndex: 0, page: { id: "p1", title: …, … } } ← tab row
{ windowIndex: 0, page: { id: "p2", title: …, … } }
{ windowIndex: 1 }                                  ← window header
{ windowIndex: 1, page: { id: "p3", title: …, … } }
…
```

The component uses legacy `<List>` with these accessors and props:

| Accessor / prop                          | Purpose                                                   |
|------------------------------------------|-----------------------------------------------------------|
| `getLabel(item)`                         | `item.page?.title ?? \`window-${item.windowIndex}\``      |
| `getIcon(item)`                          | `<LanguageIcon language=…>` for tabs, `<EmptyIcon/>` else |
| `getSelected(item)`                      | `item.page?.id === activePageId`                          |
| `getOptionClass(item)`                   | `"page-item"` or `"window-item"` (header)                 |
| `selectedIcon={<span/>}`                 | suppress default check icon on selection                  |
| `rowHeight={22}`                         | row height                                                |
| `onClick(item)`                          | open page in current window or via `api.showWindowPage`   |
| `getTooltip(item)`                       | `item.page?.filePath`                                     |

The `OpenTabsListRoot` styled wrapper around `<List>` adds:

- `& svg { width: 16, height: 16 }` — icon sizing
- `&:hover { backgroundColor: color.background.default }` — hover background
- `&.selected { backgroundColor: color.background.default }` — selected
  background (same color as hover; effectively no distinct selection signal)
- `&.window-item { textAlign: center; cursor: default; &:hover { background: transparent } }` —
  presentation-only behavior for window header rows

There is **no per-row context menu**, **no Ctrl+F search bar**, and **no
keyboard navigation** in OpenTabsList today. The list is opened transiently via
the menu-bar slide-out and dismissed on tab click.

### What UIKit `ListBox` already provides (US-484 — done)

[`src/renderer/uikit/ListBox/ListBox.tsx`](../../../src/renderer/uikit/ListBox/ListBox.tsx) +
[`types.ts`](../../../src/renderer/uikit/ListBox/types.ts) +
[`SectionItem.tsx`](../../../src/renderer/uikit/ListBox/SectionItem.tsx) +
[`ListItem.tsx`](../../../src/renderer/uikit/ListBox/ListItem.tsx) already expose every
feature this migration needs:

- `IListBoxItem.section?: boolean` — non-interactive header rendered through `<SectionItem>`,
  skipped by hover/click/keyboard nav/selection styling.
- `isSelected(source, index)` — predicate-driven selection (overrides `value`-based identity).
- `getTooltip(source, index)` — per-row tooltip, forwarded to the default `<ListItem>`.
- `variant: "select" | "browse"` — soft hover background for sidebar-style lists (matches
  the `FileList` migration completed in [US-479](../US-479-filelist-migration/README.md)).
- `LIST_ITEM_KEY` trait — `value` / `label` / `icon` / `section` accessors plug an arbitrary
  source type into `ListBox` without per-call accessor props.

### Reference: FileList migration

[`src/renderer/ui/sidebar/FileList.tsx`](../../../src/renderer/ui/sidebar/FileList.tsx)
(completed in [US-479](../US-479-filelist-migration/README.md)) is the canonical
pattern to follow:

- Module-level `TraitSet` adding a `LIST_ITEM_KEY` accessor.
- Internal `useState<number | null>(null)` for `activeIndex` (controlled hover highlight).
- Items wrapped via `traited(items, traitSet)` inside a `useMemo`.
- `<ListBox<T>>` consumed with `variant="browse"`, `rowHeight={22}`, `getTooltip`,
  `activeIndex`, `onActiveChange`, `onChange`.
- Rule 7 chrome exception applies — local Emotion is fine on plain `<div>`s, but `<ListBox>`
  itself must not receive `style=` / `className=`.

OpenTabsList is structurally simpler than FileList (no search bar, no context menu) so the
end result is shorter.

### Consumer / chrome

[`src/renderer/ui/sidebar/MenuBar.tsx`](../../../src/renderer/ui/sidebar/MenuBar.tsx)
mounts `<OpenTabsList onClose={props.onClose} open={props.open}/>` inside `.menu-bar-right`
(line 477). The `MenuBarRoot` styled block targets `.menu-bar-left` and a `.list-item`
selector scoped under that left rail (lines 88–125) — none of its rules reach into
`.menu-bar-right`. So **MenuBar.tsx requires no changes** for this migration. Verified
by inspection.

### Files involved

| File | Role | Change |
|------|------|--------|
| [`src/renderer/ui/sidebar/OpenTabsList.tsx`](../../../src/renderer/ui/sidebar/OpenTabsList.tsx) | Component | **Rewrite** — drop `OpenTabsListRoot` styled wrapper, replace `<List>` with `<ListBox>`, add module-level `LIST_ITEM_KEY` traits, add `activeIndex` state |
| [`doc/active-work.md`](../../active-work.md) | Dashboard | **Modify** — convert the US-490 line to a link to this README; promote from "blocked on US-484" wording (US-484 is implemented) |

### Files NOT changed

- [`src/renderer/ui/sidebar/MenuBar.tsx`](../../../src/renderer/ui/sidebar/MenuBar.tsx) —
  no styling overlap with OpenTabsList rows; the `.list-item` selectors are scoped to
  `.menu-bar-left`. The mount site (`<OpenTabsList ... />`) keeps the same prop signature.
- [`src/renderer/ui/sidebar/index.ts`](../../../src/renderer/ui/sidebar/index.ts) — public
  export of `OpenTabsList` is preserved.
- [`src/renderer/uikit/ListBox/*`](../../../src/renderer/uikit/ListBox) — every needed
  feature is already in place from US-484.
- [`src/renderer/api/pages/*`](../../../src/renderer/api/pages) — page model APIs
  (`pagesModel.activePage`, `pagesModel.showPage`, `api.getWindowPages`,
  `api.showWindowPage`) are unchanged.
- [`src/shared/types.ts`](../../../src/shared/types.ts) — `WindowPages` /
  `PageDescriptor` shapes are unchanged.
- [`src/renderer/components/form/List.tsx`](../../../src/renderer/components/form/List.tsx) —
  legacy stays. Removed at the end of EPIC-025 once all consumers migrate (tracked by
  [US-492](../US-492-sidebar-integration-testing/README.md)).

## Implementation plan

### Step 1 — Replace imports

In [`src/renderer/ui/sidebar/OpenTabsList.tsx`](../../../src/renderer/ui/sidebar/OpenTabsList.tsx),
replace the file's import block. The new imports cover the UIKit primitive, traits,
and the icon used for tab rows. Remove `styled` (no longer needed — the wrapper is
deleted in Step 2), `color` (no theme rules in this file after the rewrite), and the
legacy `List` import.

```ts
// before
import styled from "@emotion/styled";
import { useCallback, useEffect, useMemo, useState } from "react";
import { List } from "../../components/form/List";
import { api } from "../../../ipc/renderer/api";
import { pagesModel } from "../../api/pages";
import { appWindow } from "../../api/window";
import { IEditorState, WindowPages } from "../../../shared/types";
import color from "../../theme/color";
import { EmptyIcon } from "../../theme/icons";
import { LanguageIcon } from "../../components/icons/LanguageIcon";

// after
import { useCallback, useEffect, useMemo, useState } from "react";
import { ListBox, LIST_ITEM_KEY } from "../../uikit";
import { TraitSet, traited } from "../../core/traits/traits";
import { api } from "../../../ipc/renderer/api";
import { pagesModel } from "../../api/pages";
import { appWindow } from "../../api/window";
import { IEditorState, WindowPages } from "../../../shared/types";
import { LanguageIcon } from "../../components/icons/LanguageIcon";
```

`EmptyIcon` is dropped because window-header rows render through `<SectionItem>`, which has
no icon slot. The legacy `<EmptyIcon/>` was a placeholder to keep label alignment consistent
with tab rows; `<SectionItem>` is centered and dim, no alignment problem.

### Step 2 — Delete `OpenTabsListRoot` styled wrapper

Remove the `OpenTabsListRoot = styled(List)({…})` block (lines 12–32 of the current file).
Each rule it carried is now covered by UIKit:

| Legacy rule | Replacement |
|---|---|
| `& svg { width: 16, height: 16 }` | `<ListItem>`'s built-in icon size (`height.iconMd === 16`) |
| `&:hover { background: color.background.default }` | `variant="browse"` on `<ListBox>` (soft hover via `color.background.message`) — matches FileList per US-479 |
| `&.selected { background: color.background.default }` | dropped — see Concern #1 |
| `&.window-item` (textAlign: center, no hover) | `<SectionItem>`'s built-in styles (`role="presentation"`, centered, dim, no cursor) |

### Step 3 — Add module-level `LIST_ITEM_KEY` traits

Just below the `ListItem` interface (preserve the `ListItem` name — it's the local data
type, not the UIKit `ListItem` component which is not imported in this file), add a
`TraitSet` describing how a `ListItem` projects onto `IListBoxItem`:

```ts
interface ListItem {
    windowIndex: number;
    page?: Partial<IEditorState>;
}

const openTabsListTraits = new TraitSet().add(LIST_ITEM_KEY, {
    value: (item: unknown) => {
        const it = item as ListItem;
        return it.page?.id ?? `window-${it.windowIndex}`;
    },
    label: (item: unknown) => {
        const it = item as ListItem;
        return it.page ? (it.page.title ?? "") : `window-${it.windowIndex}`;
    },
    icon: (item: unknown) => {
        const it = item as ListItem;
        return it.page ? <LanguageIcon language={it.page.language} /> : undefined;
    },
    section: (item: unknown) => !(item as ListItem).page,
});
```

Notes:
- `value` for window headers uses `"window-${windowIndex}"`. Page IDs are UUIDs, so
  collision is impossible.
- `label` for window headers stays as `"window-${windowIndex}"` to preserve current
  behavior. A friendlier label ("This Window" / "Window N") is out of scope — see
  Concern #4.
- `icon` returns `undefined` for section rows. `<SectionItem>` has no icon slot anyway
  but returning `undefined` keeps the trait shape clean.
- `section: true` on header rows is what makes `<ListBox>` route them through
  `<SectionItem>` and skip click/hover/selection.

### Step 4 — Component body — add `activeIndex` state, traited items

Inside the `OpenTabsList` function body, keep the existing data-loading logic
(`useState`, two `useEffect`s, `useMemo` for `items`, the duplicate-id detection
side-effect). Add an `activeIndex` slot mirroring FileList:

```tsx
export function OpenTabsList(props: OpenTabsListProps) {
    const [allWindowsPages, setAllWindowsPages] = useState<WindowPages[]>([]);
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const state = pagesModel.state.use();
    const currentWindowIndex = appWindow.windowIndex;

    // … existing loadWindowPages, useEffects, activePageId, items logic stays …

    const tItems = useMemo(
        () => traited(items, openTabsListTraits),
        [items],
    );

    // … existing onClick stays …

    const isSelected = useCallback(
        (item: ListItem) => item.page?.id === activePageId,
        [activePageId],
    );

    // (drop getSelected, getOptionClass, getPageLabel, getPageIcon helpers — replaced by traits)
```

The legacy `getSelected` becomes `isSelected` (matches the UIKit prop name). `useCallback`
keeps a stable identity so `<ListBox>`'s "force re-render on prop change" effect doesn't
fire every render.

### Step 5 — Replace `<OpenTabsListRoot>` with `<ListBox>`

```tsx
return (
    <ListBox<ListItem>
        items={tItems}
        rowHeight={22}
        activeIndex={activeIndex}
        onActiveChange={setActiveIndex}
        onChange={onClick}
        isSelected={isSelected}
        getTooltip={(item) => item.page?.filePath}
        emptyMessage="no tabs"
        variant="browse"
    />
);
```

Notes:
- `items={tItems}` — the traited array. `<ListBox>` resolves `LIST_ITEM_KEY` accessors
  internally and forwards the original `ListItem` to `onChange`, `isSelected`, `getTooltip`.
- `activeIndex` + `onActiveChange` — controlled hover highlight. `<ListBox>` skips section
  rows automatically when computing the active row (per US-484 Concern #4).
- `getTooltip` — `item.page?.filePath` returns `undefined` for window-header rows
  (they have no `page`), and `<ListBox>` does not call `getTooltip` on section rows
  anyway. Either path produces no tooltip on headers, which matches legacy behavior.
- `variant="browse"` — soft hover, matching FileList. See Concern #2 for color rationale.
- `emptyMessage="no tabs"` — defensive. In practice the list always contains at least the
  current-window header, so the empty path never renders.

### Step 6 — Remove the legacy helper constants

Drop these top-of-file constants — their roles move into traits:

```ts
// REMOVE:
const getPageLabel = (item: ListItem) => …;
const getPageIcon = (item: ListItem) => …;
const getTooltip = (item: ListItem) => (item.page as any)?.filePath;
```

`getTooltip` becomes an inline arrow on the `<ListBox>` props (Step 5). The `as any`
cast disappears because `IEditorState.filePath` is already typed as `string | undefined`.

### Step 7 — Dashboard update

In [`doc/active-work.md`](../../active-work.md), replace:

```
- [ ] [US-490: OpenTabsList — UIKit migration](tasks/US-490-opentabslist-migration/README.md) *(Phase 4 — per-screen migration; blocked on US-484)*
```

with:

```
- [ ] [US-490: OpenTabsList — UIKit migration](tasks/US-490-opentabslist-migration/README.md) *(Phase 4 — per-screen migration)*
```

US-484 is implemented (sections, predicate selection, tooltip, variant all live in
`uikit/ListBox/*`); the "blocked on" annotation is stale.

### Step 8 — TypeScript + lint check

- `npx tsc --noEmit` — no new errors.
- `npm run lint` — no new errors.

### Step 9 — Manual smoke test

Run `npm start`, open the menu bar (Ctrl+M / hamburger), select **Open Tabs**:

- **Tabs render:** all tabs from the current window appear under a `window-0`
  (or whichever index) section header; tabs from other windows appear under
  their own headers.
- **Hover:** moving the pointer over a tab row shows a soft background
  (`variant="browse"`). Moving over a section header shows no hover.
- **Tooltip:** hovering a tab with a saved file path (e.g. `D:\foo\bar.txt`)
  shows the path after ~600ms. Hovering an unsaved tab (no `filePath`) shows
  no tooltip. Hovering a section header shows no tooltip.
- **Active page highlight:** the current page is the only row whose
  `isSelected` returns `true`. The default `<ListItem>` trailing slot renders
  `<CheckIcon />` on that one row (no background change with `variant="browse"`,
  but the check icon is the indicator — see Concern #1). Section rows never
  show a check icon.
- **Click — same window:** clicking a tab from the current window invokes
  `pagesModel.showPage(id)` and dismisses the menu bar (existing behavior).
- **Click — other window:** clicking a tab from another window invokes
  `api.showWindowPage(windowIndex, pageId)` and dismisses the menu bar.
- **Click — section header:** clicking a section header does nothing
  (the row is non-interactive).
- **Empty other windows:** open a second window, close all its tabs, refresh
  the open-tabs panel — the second window's section header still renders with
  no tab rows under it.
- **Theme cycling:** in default-dark, light-modern, monokai — section header
  color (dim text), tooltip background, and hover background all follow the
  theme.
- **DevTools:** section rows have `data-type="list-section"` and
  `role="presentation"`. Tab rows have `data-type="list-item"`,
  `role="option"`. The container has `data-type="list-box"`.

## Concerns / open questions

All resolved before implementation.

### 1. Active page indicator — RESOLVED: use default check icon

Legacy `OpenTabsList` set `selectedIcon={<span/>}` to **suppress** the default
check icon, leaving only a near-invisible same-as-hover background as the
"current page" signal. UIKit `<ListItem>` already renders `<CheckIcon />` as the
default trailing slot when `selected={true}` (see
[`ListItem.tsx:122`](../../../src/renderer/uikit/ListBox/ListItem.tsx) —
`{trailing ?? (selected ? <CheckIcon /> : null)}`). We simply do not suppress
it: pass no `selectedIcon`-equivalent, no `trailing` override, no custom
`renderItem`. The `isSelected` predicate already returns `true` only for the
active page, so the check appears on exactly that one row.

Section rows are unaffected — the model's `isSelectedAt` short-circuits to
`false` for `item.section === true` (per US-484 Concern #4), so window headers
never receive `selected={true}` and never render a check icon.

End-state: the active page row shows a clear check icon on the right. Net
improvement over legacy.

### 2. Hover background color drift — RESOLVED: align with FileList

Legacy hover used `color.background.default`; UIKit `variant="browse"` uses
`color.background.message`. The user accepted this drift for `FileList` in
US-479 ("hover background colors look fine"). OpenTabsList lives in the same
sidebar surface; consistency wins. No new variant, no override.

### 3. `getOptionClass` / `.window-item` removal — RESOLVED: replaced by `section: true`

The legacy `getOptionClass(item) => item.page ? "page-item" : "window-item"`
served only to flip the cursor and remove hover for header rows. `<SectionItem>`
bakes in `cursor: default`, no hover, centered text, dim color. Drop the helper.

### 4. Window-header label — RESOLVED: preserve `"window-N"`

Legacy label is `"window-${windowIndex}"`. We could improve to "This Window" /
"Window 2" / etc., but that's a UX change, not a migration. Keep the label
exactly as-is; raise as a separate task if the user wants better labels.

### 5. Duplicate-id detection (lines 100–109 of legacy) — RESOLVED: keep verbatim

When a tab is moved between windows, both windows briefly report it (race between
the source window's `state.pages` update and the IPC `getWindowPages` refetch).
Legacy code detects this and re-fetches after 50ms. Keep this logic unchanged —
it's IPC plumbing, not UI.

### 6. `OpenTabsListProps` shape — RESOLVED: unchanged

```ts
interface OpenTabsListProps {
    onClose?: () => void;
    open?: boolean;
}
```

The mount site in MenuBar passes both. Preserving the prop shape means
MenuBar.tsx requires no changes.

### 7. `useCallback` dep stability — RESOLVED: keep `useCallback` on `isSelected`

`<ListBox>`'s internal effect lists `isSelected` in its force-re-render deps
(per US-484 Step 4c). A non-stable handler (defined inline each render) would
trigger unnecessary `RenderGrid.update({ all: true })` calls every parent
render. Wrap in `useCallback([activePageId])` to keep identity stable across
renders that don't change `activePageId`.

The traited items go through `useMemo([items])`, so traited identity is also
stable across `state.pages` no-ops.

### 8. `getTooltip` inline vs `useCallback` — RESOLVED: inline

`getTooltip={(item) => item.page?.filePath}` is defined inline in JSX. It's
a simple projection with no closure deps. The cost of identity churn is one
extra `RenderGrid.update({ all: true })` per render — already happening when
`tItems` or `isSelected` change, which dominates.

If profiling shows this matters, hoist to `useCallback([])`. Not premature.

### 9. `<ListBox<ListItem>>` generic vs default — RESOLVED: explicit

Using `<ListBox<ListItem> ...>` makes `onChange` / `isSelected` / `getTooltip`
all type as `(item: ListItem) => …`, matching the source-shape behavior of
`LIST_ITEM_KEY` resolution. Without the generic, the inferred T would be
`unknown[]` (from the `Traited<unknown[]>` branch of `items`), losing the
narrowing. Identical to FileList's pattern (`<ListBox<FileListItem>>`).

### 10. `pagesModel.activePage` reactivity — RESOLVED: already covered

`activePageId = useMemo(() => pagesModel.activePage?.id, [state])` already
depends on `state` (from `pagesModel.state.use()`), so it updates whenever
the active page changes. No new subscription needed.

### 11. Trait re-creation cost — RESOLVED: module-level

`openTabsListTraits` is a module-level `const`, not recreated per render.
Matches FileList's `fileListTraits`. The `traited(items, openTabsListTraits)`
call inside `useMemo([items])` only re-runs when `items` changes, not on every
render.

### 12. Removing `EmptyIcon` import — RESOLVED: SectionItem renders no icon

Window-header rows no longer need a placeholder icon — `<SectionItem>` is
centered, no icon slot. Drop the import.

### 13. `as any` cast on `filePath` — RESOLVED: type narrows on `IEditorState`

Legacy: `(item.page as any)?.filePath`. New: `item.page?.filePath`. Works
because `item.page` is `Partial<IEditorState>` and `IEditorState.filePath` is
already `string | undefined`. The legacy cast was defensive against a stale
type; current types support the access cleanly.

### 14. UIKit Rule 7 compliance — RESOLVED: chrome exception applies

`OpenTabsList.tsx` sits under `src/renderer/ui/sidebar/`, which is the
"application chrome" zone. Local Emotion is permitted. After this rewrite the
file uses zero Emotion (no styled wrapper, no inline styles), so even the strict
form of Rule 7 is satisfied. UIKit components receive no `style=` / `className=`
props (would be a TS error anyway).

### 15. Behavior of `isSelected` when `value` is not passed — RESOLVED: predicate wins

US-484 Concern #3 documents: when both `value` and `isSelected` are passed,
`isSelected` wins. We pass only `isSelected`; `value` defaults to `null`/unused.
No ambiguity.

## Acceptance criteria

1. `src/renderer/ui/sidebar/OpenTabsList.tsx` contains zero imports from
   `components/form/`. The legacy `List` is no longer referenced.
2. The file imports `ListBox`, `LIST_ITEM_KEY` from `../../uikit`, and
   `TraitSet`, `traited` from `../../core/traits/traits`.
3. The `OpenTabsListRoot` styled wrapper is removed; the file imports zero from
   `@emotion/styled` and zero from `../../theme/color`.
4. A module-level `openTabsListTraits = new TraitSet().add(LIST_ITEM_KEY, {…})`
   provides `value` / `label` / `icon` / `section` accessors. `section` returns
   `true` when `item.page` is undefined.
5. The component renders `<ListBox<ListItem>>` with `items={tItems}`,
   `rowHeight={22}`, `activeIndex` / `onActiveChange` controlled by an internal
   `useState`, `onChange={onClick}`, `isSelected={isSelected}`,
   `getTooltip={(item) => item.page?.filePath}`, `emptyMessage="no tabs"`,
   `variant="browse"`.
6. `<ListBox>` receives no `style` / `className` props.
7. The component's `OpenTabsListProps` shape is unchanged (`onClose?`, `open?`).
   `MenuBar.tsx` is not modified.
8. Window-header rows render through `<SectionItem>` (verified in DevTools:
   `data-type="list-section"`, `role="presentation"`).
9. Tab rows render through `<ListItem>` with `variant="browse"`
   (`data-type="list-item"`, `data-variant="browse"`).
10. Clicking a tab from the current window opens it via
    `pagesModel.showPage(id)` and dismisses the menu bar.
11. Clicking a tab from another window opens it via
    `api.showWindowPage(windowIndex, pageId)` and dismisses the menu bar.
12. Clicking or hovering a window-header row does nothing.
13. The duplicate-id detection logic (legacy lines 100–109) is preserved
    verbatim.
14. `npx tsc --noEmit` — no new errors.
15. `npm run lint` — no new errors.
16. Manual smoke test (Step 9 above) passes.
17. The dashboard entry in [`doc/active-work.md`](../../active-work.md) drops
    the stale "blocked on US-484" suffix; the link to this README is preserved.

## Files Changed summary

| File | Action | Notes |
|------|--------|-------|
| [`src/renderer/ui/sidebar/OpenTabsList.tsx`](../../../src/renderer/ui/sidebar/OpenTabsList.tsx) | Rewrite | Drop legacy `List` + `OpenTabsListRoot` styled wrapper; add module-level `LIST_ITEM_KEY` traits; render `<ListBox>` with `variant="browse"`, `isSelected` predicate, controlled `activeIndex` |
| [`doc/active-work.md`](../../active-work.md) | Modify | Drop stale "blocked on US-484" annotation on the US-490 line |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md) — Phase 4 per-screen migration
- Built on: [US-468](../US-468-uikit-listbox/README.md) (UIKit ListBox V1) +
  [US-484](../US-484-uikit-listbox-extensions/README.md) (sections, predicate
  selection, tooltip, variant) — both implemented
- Reference migration: [US-479](../US-479-filelist-migration/README.md) —
  FileList + RecentFileList (canonical pattern)
- Sibling tasks (US-479 split):
  - [US-491](../US-491-folderitem-migration/README.md) — FolderItem + MenuBar left list
  - [US-492](../US-492-sidebar-integration-testing/README.md) — Final sidebar integration testing
