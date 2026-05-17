# US-523: LinkEditor — UIKit migration

## Status

**Plan ready for review** — Phase 4 per-screen migration under [EPIC-025](../../epics/EPIC-025.md).

## Goal

Migrate the LinkEditor (link-list browser tab) and all its sub-views to
UIKit primitives. After this task, no file under
`src/renderer/editors/link-editor/` imports from
`components/basic|form|layout|overlay/` and no `@emotion/styled` blocks
remain (the editor is not chrome — Rule-7 chrome exception does NOT
apply here).

The `EditLinkDialog.tsx` is **already migrated** (done opportunistically
during US-522). This task covers the surrounding list / tile / panel /
tooltip surfaces.

## Background

### Files in scope (confirmed via grep for legacy imports)

| File | Legacy imports | Emotion `styled` |
|------|----------------|------------------|
| `LinkEditor.tsx` | `Breadcrumb`, `Button`, `TextField`, `HighlightedTextProvider`, `CollapsiblePanel`/`CollapsiblePanelStack`, `Splitter` | `LinkEditorRoot`, `SearchField` |
| `LinksList.tsx` | `highlightText`, `Button` | `LinksListRoot` (styled `RenderGrid`) |
| `LinksTiles.tsx` | *(none banned)* | `LinksTilesRoot` (styled `RenderGrid`) |
| `LinkItemList.tsx` | `useHighlightedText` | – |
| `LinkItemTiles.tsx` | *(none banned)* | – |
| `PinnedLinksPanel.tsx` | *(none banned)* | `PinnedLinksPanelRoot` |
| `LinkTooltip.tsx` | `Tooltip` (legacy, anchor-mode) | `LinkTooltipContent` |
| `panels/LinkCategoryPanel.tsx` | `highlightText`, `Tooltip` (legacy, anchor-mode + `render`) | `LinkCategoryPanelRoot` |
| `panels/LinkCategorySecondaryEditor.tsx` | `Button` | – |
| `panels/LinkHostnamesPanel.tsx` | `TagsList` | `LinkHostnamesPanelRoot` |
| `panels/LinkHostnamesSecondaryEditor.tsx` | *(none banned)* | – |
| `panels/LinkTagsPanel.tsx` | `TagsList` | `LinkTagsPanelRoot` |
| `panels/LinkTagsSecondaryEditor.tsx` | `Splitter` | `NavigationPanelRoot` |
| `LinkViewModel.ts` | `MenuItem` (type-only) from `components/overlay/PopupMenu` | – |

### Files NOT in scope (verified)

- `link-editor/EditLinkDialog.tsx` — already migrated (US-522 rollout).
- `linkTypes.ts`, `linkTraits.ts`, `LinkTreeProvider.ts` — pure model /
  type files; no JSX and no legacy primitive imports.
- `LinkViewModel.ts` carries one type-only legacy import (`MenuItem`
  from `components/overlay/PopupMenu`). UIKit's `Menu` re-exports the
  same `MenuItem` type from `api/types/events` — see step 0 below.

### Legacy → UIKit primitive map

| Legacy | UIKit replacement | API delta to watch |
|--------|-------------------|--------------------|
| `components/basic/Breadcrumb` | `uikit/Breadcrumb` | `className` prop removed (no styled wrap; replace `SearchField` colour via Input variant). |
| `components/basic/Button` (`type="raised"`/`"flat"`/`"icon"`, `size="small"`) | `uikit/Button` + `uikit/IconButton` | `type="raised"` → `variant="link"` (bordered); `type="flat"` → `variant="ghost"`; `type="icon"` → switch to `IconButton`; `size="small"` → `size="sm"`; `style={{borderColor}}` (raised Add Link) drops (link variant already shows blue border). |
| `components/basic/TextField` (with `endButtons` + `width`) | `uikit/Input` (with `endSlot` + `width` + new `tone="accent"`) | `endButtons` (array) → `endSlot` (ReactNode); the legacy custom blue input colour is preserved via a new `tone="accent"` prop on UIKit Input (see step 1.5). |
| `components/basic/useHighlightedText` (`highlightText`, `HighlightedTextProvider`, `useHighlightedText`) | `uikit/shared/highlight` (`highlight`, `HighlightedTextProvider`, `useHighlightedText`) | **Function rename + arg-order swap**: `highlightText(substring, text)` → `highlight(text, searchText)`. Context provider/consumer names match. |
| `components/layout/CollapsiblePanelStack` / `CollapsiblePanel` | `uikit/CollapsiblePanelStack` / `CollapsiblePanel` | Drop `className`; replace `style={{ width }}` with the `width` prop. Adopt `name?` debug attribute. |
| `components/layout/Splitter` | `uikit/Splitter` | `type="vertical"` → `orientation="vertical"`; `initialWidth`/`initialHeight` + `onChangeWidth`/`onChangeHeight` → controlled `value` + `onChange`; `borderSized="right"` → `border="after"`; `borderSized="left"` → `border="before"` with `side="after"`. **The legacy splitter is uncontrolled** — UIKit splitter is controlled, so we pass `pageState.leftPanelWidth` / `pinnedPanelWidth` / `bottomHeight` as `value` and the existing `setX` callbacks as `onChange`. Behaviour is identical because the legacy splitter already round-tripped its initial size through the same callback. |
| `components/basic/Tooltip` (global, `id` + `data-tooltip-id` anchors, `render({ activeAnchor })`) | `uikit/Tooltip` (per-trigger wrapper, `content` ReactNode) | **API model change** — UIKit Tooltip wraps a single trigger child; it does NOT support the legacy "one tooltip, many anchors via id" pattern. Migrate by inlining: every consumer wraps its trigger with `<Tooltip content={…}>…</Tooltip>`. `LinkTooltip` becomes a `<LinkTooltipContent>` ReactNode helper consumed by the wrap (id portal removed). The virtualized Tree mounts one Tooltip per visible row; floating-ui is lazy so the per-row cost is minimal. |
| `components/basic/TagsList` | **NEW** `uikit/CategoryList` *(see UIKit work section below)* | API kept compatible: `tags`/`items` list, controlled `value`/`onChange`, `getCount?`, `separator?`, `rootLabel?`. |
| `components/overlay/PopupMenu` `MenuItem` (type-only) | `uikit/Menu` `MenuItem` (type-only re-export) | Both alias the same source (`api/types/events`); pure import-path swap. |

### Reference migrations

- **US-512 Notebook editor** — closest analogue (Breadcrumb +
  CollapsiblePanelStack + Tree + list/tile views in a single editor
  surface). Heavy on portal patterns and per-row templates.
- **US-499 TodoEditor** — list + per-row template pattern using
  `Panel revealChildrenOnHover` + `hideUntilParentHover` for the
  hover-reveal action affordance. Hover background per row is **not**
  applied in TodoEditor; for LinkEditor we get it via UIKit
  `ListItem variant="browse"` (see step 4 below).
- **US-498 Settings page** — similar left-rail-with-categories layout.

### UIKit primitive availability

| Primitive | Status |
|-----------|--------|
| `Breadcrumb` (US-516) | landed |
| `CollapsiblePanelStack` / `CollapsiblePanel` (US-517) | landed |
| `Splitter` (US-486) | landed (controlled `value`/`onChange`) |
| `Tooltip` (US-467) | landed (per-trigger wrapper only) |
| `Button` / `IconButton` (Phase 4 baseline) | landed |
| `Input` (`endSlot`, `width`) (Phase 4 baseline) | landed |
| `Input` `tone="default" \| "accent"` prop | **NEW — to add in this task** |
| `Panel` (`revealChildrenOnHover`, `border*`, etc.) | landed |
| `Text` (Phase 4 baseline) | landed |
| `ListItem` (`variant="browse"`, `selected`, `tooltip`, `trailing`) | landed |
| `name?: string` debug prop (US-521) | landed everywhere |
| `Menu` `MenuItem` type | landed |
| **`CategoryList`** — drill-in filter list with separator semantics | **NEW — to author in this task** |

### Risk surface

- LinkEditor is the user-facing browser tab for `.link.json` collections.
  Regressions affect every link collection, the Browser editor's
  Bookmarks sidebar (which mounts the same panels via the secondary
  editor wrappers), and every consumer of `LinkCategoryPanel`
  (Video player track list, etc., via duck-typed `treeProvider` /
  `selectByHref`).
- The category panel renders inside the virtualized Tree (UIKit `Tree`
  + `TreeProviderView`). Inline-tooltip migration must NOT break
  search highlighting nor the data flow that powers the existing
  `data-tooltip-*` attrs on tree cells.
- `LinkTagsSecondaryEditor` hosts a Splitter whose height initialises
  from a `ResizeObserver` measurement (50 % of the expand-animation
  final size). The migrated Splitter must remain controlled and respect
  the same callback contract.
- The pinned panel implements per-row HTML5 drag/drop reorder with
  drop-position indicators (top/bottom 2 px line). Migrated rows must
  preserve the module-level `draggingPinIndex` tracking and the
  `drop-above` / `drop-below` visual cues.

## UIKit primitives — new work in this task

### 1. New primitive: `uikit/CategoryList`

The legacy `components/basic/TagsList` is a self-contained navigable
filter list with separator-based drill-in (e.g. `release:1.0.1`) and
counts. It is used by `LinkTagsPanel`, `LinkHostnamesPanel`, and is a
reasonable shape for any future "categorised filter list".

**Location:** `src/renderer/uikit/CategoryList/`
- `CategoryList.tsx`
- `CategoryList.story.tsx`
- `index.ts`
- Export from `uikit/index.ts`.

**Shape (close to the legacy `TagsList`, but UIKit-conformant):**

```ts
export interface CategoryListProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "onChange"> {
    /** Optional debug label emitted as `data-name`. */
    name?: string;
    /** All values shown by the list. */
    items: string[];
    /** Current selected value ("" = root / "All"). Controlled. */
    value: string;
    /** Called when the user clicks a row. */
    onChange: (value: string) => void;
    /** Per-entry count display. Receives full value, parent-with-separator, or "" for root. */
    getCount?: (value: string) => number | undefined;
    /** Separator that triggers drill-in. Use "\0" to disable drill-in entirely. Default ":". */
    separator?: string;
    /** Label for the root pseudo-item. Default "All". */
    rootLabel?: React.ReactNode;
}
```

**Conventions to apply during the move:**

- `data-type="category-list"` on the root; `data-selected` on the
  currently selected row; `data-state="open" | "closed"` for the
  drilled-in section header. No `clsx` / class-name state — replace
  the legacy `.selected` / `.tag-item` classes with `data-*` attrs and
  Emotion attribute selectors inside the `styled` block.
- Internal expand state (`expandedCategory`) stays local — derived from
  `value` via the existing `useEffect`. This is Rule-2-compliant
  (primary value is `value`; expand is transient view state).
- Replace the legacy `getCount` JSDoc with the same callback signature
  but emphasise that it must accept root (`""`) and parent
  (`name + separator`).

**Migration tactic for the data:** The legacy `TagsList` already has
the shape we want — copy `TagsList.tsx` to `uikit/CategoryList/CategoryList.tsx`,
strip `className`, rename to `CategoryList`, swap class names for
`data-*` attrs, add the `name?` prop. Delete the legacy file at the
end (no other consumers — verified by grep: only
`LinkTagsPanel.tsx` + `LinkHostnamesPanel.tsx` import it).

### 2. Enhancement: `uikit/Input` — `tone` prop

Add a `tone?: "default" | "accent"` prop to `uikit/Input/Input.tsx`.
When `tone="accent"`, the input text colour becomes
`color.misc.blue`. The prop also surfaces as `data-tone="accent"` on
the wrapper so other primitives can react to it later if needed.

This preserves the legacy "search slot has blue text" affordance that
signals an active filter — without it, the search Input is hard to
spot when unfocused.

**Shape:**

```ts
export interface InputProps extends … {
    …
    /**
     * Text tone. `"default"` uses the theme text colour. `"accent"` paints the
     * input text in `color.misc.blue` — use for inputs whose value carries
     * "filter is active" semantics (search boxes, etc.).
     * Default: `"default"`.
     */
    tone?: "default" | "accent";
}
```

**Implementation:** one block in the existing `Field` styled
declaration:

```ts
'&[data-tone="accent"]': { color: color.misc.blue },
```

Wrapper renders `data-tone={tone}`; Field renders `data-tone={tone}`.

### 3. Enhancement: `uikit/ListItem` — `showSelectionIcon` prop

Add `showSelectionIcon?: boolean` (default `true`) to
`uikit/ListBox/ListItem.tsx`. When `false`, the default trailing
selection marker (check or chevron-right per `selectionStyle`) is
suppressed even when `selected` is true. Callers can still keep the
`selectionStyle="accent"` background fill but opt out of the chevron
for pure-selection feedback (rows that don't navigate into a detail
pane).

Used by LinksList and PinnedLinksPanel — both have selected-row
visual feedback but no associated right pane, so the chevron is
out of place.

**Implementation:** destructure the new prop; gate `defaultTrailing`:

```tsx
const defaultTrailing = selected && showSelectionIcon
    ? selectionStyle === "accent" ? <ChevronRightIcon /> : <CheckIcon />
    : null;
```

### 4. No enhancement needed elsewhere

- **`Tooltip`** — anchor-mode (one tooltip with many anchors via
  `data-tooltip-id`) is intentionally not supported in UIKit. The
  migration handles every call site via inline per-trigger wrapping
  (see step 6 below). No new primitive or prop.
- **`ListItem`** — `variant="browse"` already provides the row-hover
  background. Hover-reveal of trailing IconButtons is achieved by
  wrapping each row in `<Panel revealChildrenOnHover>` and tagging
  the action `IconButton`s with `hideUntilParentHover`. Folder-row
  bold + highlight is composed at the call site via a pre-built
  ReactNode label (see step 4 / concern 6).
- **`Splitter`** — controlled API is fine for our persisted-width
  contract; legacy `borderSized` translates to `border` + `side`.

## Implementation plan

> Steps are ordered so each commit can be eyeballed in isolation.
> All `Panel` / `Input` / `Button` / `IconButton` instances must carry
> a meaningful `name?` debug attribute (US-521).

### Step 0 — Type-only fixes (LinkViewModel + linkTraits)

- `LinkViewModel.ts`:
  - `import { MenuItem } from "../../components/overlay/PopupMenu";` → `import { MenuItem } from "../../uikit/Menu/types";`
- `linkTraits.ts`, `linkTypes.ts`, `LinkTreeProvider.ts`: no change
  expected — verify with one grep at the start of implementation.

### Step 1 — Land `uikit/CategoryList`

Create the primitive with the shape described above and a basic story
(All / drill-in / selected states). Update `uikit/index.ts` to export
it. **Do not delete the legacy `TagsList` yet** — deletion happens after
step 5 verifies no other consumer remains.

Acceptance: `npm run lint` + `npx tsc --noEmit` baseline-relative
unchanged; story renders.

### Step 1.5 — Add `tone` prop to `uikit/Input`

- Extend `InputProps` with `tone?: "default" | "accent"` (default
  `"default"`).
- Destructure `tone` in the component, emit `data-tone={tone}` on the
  `Wrapper` AND on the `Field`.
- In `Field` styled block, add `'&[data-tone="accent"]': { color: color.misc.blue }`.
- Extend `Input.story.tsx` with an `accent`-tone example.

Acceptance: `npm run lint` + `npx tsc --noEmit` baseline-relative
unchanged; story renders both tones.

### Step 2 — `LinkEditor.tsx` root chrome

Replace:

```tsx
<LinkEditorRoot ref={…} tabIndex={-1} className={clsx({ "swap-layout": swapLayout })}>
    {!showPanelsInSidebar && (<>
        <CollapsiblePanelStack className="left-panel" style={{ width }} …>…</CollapsiblePanelStack>
        <Splitter type="vertical" initialWidth={…} onChangeWidth={vm.setLeftPanelWidth} borderSized="right" />
    </>)}
    <HighlightedTextProvider value={pageState.searchText}>
        <div className={clsx("center-panel", centerDragOver && "drag-over")} …>…</div>
    </HighlightedTextProvider>
    …
</LinkEditorRoot>
```

with:

```tsx
<Panel
    name="link-editor-root"
    ref={(el) => { vm.containerElement = el; }}
    tabIndex={-1}
    direction={swapLayout ? "row-reverse" : "row"}
    overflow="hidden"
    flex={1}
>
    {!showPanelsInSidebar && (<>
        <CollapsiblePanelStack
            name="link-editor-left-panels"
            width={pageState.leftPanelWidth}
            minWidth={100}
            maxWidth="80%"
            activePanel={pageState.expandedPanel}
            setActivePanel={vm.setExpandedPanel}
        >
            <CollapsiblePanel id="categories" name="categories" title="Categories">
                <LinkCategoryPanel vm={vm} useOpenRawLink={false} />
            </CollapsiblePanel>
            <CollapsiblePanel id="tags" name="tags" title="Tags">
                <LinkTagsPanel vm={vm} />
            </CollapsiblePanel>
            <CollapsiblePanel id="hostnames" name="hostnames" title="Hostnames">
                <LinkHostnamesPanel vm={vm} />
            </CollapsiblePanel>
        </CollapsiblePanelStack>
        <Splitter
            name="link-editor-left-splitter"
            orientation="vertical"
            value={pageState.leftPanelWidth}
            onChange={vm.setLeftPanelWidth}
            border={swapLayout ? "before" : "after"}
            side={swapLayout ? "after" : "before"}
        />
    </>)}
    <HighlightedTextProvider value={pageState.searchText}>
        <Panel
            name="link-editor-center"
            direction="column"
            flex={1}
            overflow="hidden"
            position="relative"
            border={centerDragOver || undefined}
            borderColor={centerDragOver ? "active" : undefined}
            onDragEnter={handleCenterDragEnter}
            onDragOver={handleCenterDragOver}
            onDragLeave={handleCenterDragLeave}
            onDrop={handleCenterDrop}
        >
            {allLinks.length === 0
                ? <EmptyState title="Links" subtitle="No links yet" hint='Click "Add Link" to create your first link' />
                : links.length === 0
                    ? <EmptyState subtitle="No links match the current filter" />
                    : viewMode === "list"
                        ? <LinkItemList … />
                        : <LinkItemTiles … />}
        </Panel>
    </HighlightedTextProvider>
    {pinnedLinks.length > 0 && (<>
        <Splitter
            name="link-editor-pinned-splitter"
            orientation="vertical"
            value={pinnedPanelWidth}
            onChange={vm.setPinnedPanelWidth}
            border={swapLayout ? "after" : "before"}
            side={swapLayout ? "before" : "after"}
        />
        <PinnedLinksPanel … width={pinnedPanelWidth} />
    </>)}
</Panel>
```

`EmptyState` is a tiny local function (or a Panel + Text composition
inline) — UIKit Panel + Text covers it; no need for a styled.div.

Replace `SearchField` (`styled(TextField)` with blue input colour) with
`<Input variant="default" tone="accent" name="link-editor-search" width={180} value={…} onChange={…} placeholder="Search..." endSlot={searchText ? <IconButton size="sm" name="link-editor-search-clear" title="Clear search" icon={<CloseIcon />} onClick={vm.clearSearch} /> : undefined} />`.
The misc-blue tint of the legacy `SearchField` is preserved via the
new `tone="accent"` prop (step 1.5) so an active search remains
visually obvious when unfocused.

Toolbar portals: the Add Link / View Mode / search Input cluster
becomes a `<>` fragment of UIKit `Button` / `IconButton` / `Input` —
no Panel wrapper required (the legacy code emits the same flat
fragment into `toolbarLast`).

### Step 3 — `panels/LinkCategoryPanel.tsx`

- Drop `LinkCategoryPanelRoot` styled.div; wrap children in
  `<Panel name="link-category-panel" direction="column" flex={1} overflow="hidden">`.
- Replace `import { highlightText } from "../../../components/basic/useHighlightedText"` with
  `import { highlight } from "../../../uikit/shared/highlight"`. Update
  call: `searchText ? highlight(item.title, searchText) : (item.title || "All")`.
- Replace the legacy `Tooltip` rendered after `<TreeProviderView />`
  (the `render({ activeAnchor })` form) with **per-row inline
  tooltips inside `getLabel`**:

    ```tsx
    const getTreeItemLabel = useCallback(
        (item: ILink, searchText: string) => {
            const label = searchText ? highlight(item.title, searchText) : (item.title || "All");
            if (item.isDirectory) {
                return (<>
                    <span className="category-label-name">{label}</span>
                    {item.size !== undefined && <span className="category-label-size">{item.size}</span>}
                </>);
            }
            return (
                <Tooltip content={<LinkTooltipContent link={item} />}>
                    <span className="category-label-name">{label}</span>
                </Tooltip>
            );
        },
        [],
    );
    ```

  The Tree is virtualized so only visible rows mount a Tooltip; floating-ui
  is lazy so the resource cost is negligible. The legacy "Copy link as JSON"
  affordance moves into `LinkTooltipContent` so it remains available.

- The `className="category-label-name"` etc. become plain HTML class
  hooks (still used by the Tree CSS); they are NOT Emotion. Tree's
  `getLabel` slot accepts arbitrary JSX, so plain `<span>` with class
  names tied to TreeProviderView's renderer is fine.

  *(Note: TreeProviderView itself already uses UIKit primitives — no
  changes needed there. The local class-name hooks `.category-label-name`
  / `.category-label-size` / `.tree-cell` are not tied to LinkCategoryPanel's
  emotion block any more; they live inside `TreeProviderItem` Item label
  span. **Reality check:** the legacy LinkCategoryPanel styled block scopes
  `.category-label-*` to its root. After migration, those class names
  become orphaned. Inline-style the size span or drop the wrapping class
  entirely.)*

  **Resolution:** the category-label-name `flex: 1 1 auto` is needed to
  let the size badge sit at the row's trailing edge. Solve via inline
  style on the span: `style={{ flex: "1 1 auto" }}` for the label,
  `style={{ margin: "0 4px", fontSize: 12 }}` for the size — plain HTML
  with inline styles is allowed by Rule 7.

### Step 4 — `LinksList.tsx`

The biggest substructural change. Replace the legacy
`styled(RenderGrid)` block + `<div className="link-row">` row template
with:

- Keep `RenderGrid` as-is (it lives in `components/virtualization/` — not
  banned).
- Inside the `renderCell`, render a plain `<div style={{ padding: '0 4px', boxSizing: 'border-box', display: 'flex', alignItems: 'stretch', width: '100%', height: '100%' }}>` containing one `Panel revealChildrenOnHover position="relative" flex={1} minWidth={0}` per row.
- Inside the Panel, render `<ListItem variant="browse" name="link-row" icon={<TreeProviderItemIcon item={link} />} label={…} tooltip={<LinkTooltipContent link={link} allTags={allTags} onToggleTag={onToggleTag} />} selected={isSelected} trailing={<… edit/delete IconButtons …>} … forwards drag handlers via {...rest} />`. ListItem accepts `...rest`, so `draggable`, `onDragStart`, `onDragEnd`, `onClick`, `onDoubleClick`, `onContextMenu` pass through to the row root.
- Label content: `ListItem` accepts `searchText` and runs `highlight` itself when `label` is a string. **For non-folder rows** pass `label={link.title || "Untitled"} searchText={searchText}` and let ListItem do it. **For folder rows** (`link.isDirectory`), build the label as a pre-highlighted ReactNode wrapped in a bold span (folders ARE search targets per `LinkViewModel.applyFilters` — see concern 6):

    ```tsx
    const labelText = link.title || "Untitled";
    const label = link.isDirectory ? (
        <span style={{ fontWeight: 500 }}>
            {searchText ? highlight(labelText, searchText) : labelText}
        </span>
    ) : labelText;

    <ListItem
        label={label}
        searchText={link.isDirectory ? undefined : searchText}
        …
    />
    ```

  The `searchText` prop is passed `undefined` for folders because the pre-built span has already run `highlight`; otherwise ListItem would try to highlight a ReactNode (no-op) or re-run on a string after we promoted it to JSX. Plain HTML `<span>` with inline style is allowed by Rule 7 (inline styles on non-UIKit elements are fine).
- `additionalIcon` (pin indicator) sits in `trailing` alongside the action buttons. The trailing slot is one ReactNode — wrap edit/delete/pin into a `<span style={{ display: 'flex', gap: 2, alignItems: 'center' }}>`.
- Edit / delete `Button` → `IconButton size="sm" name="link-row-edit" title="Edit" hideUntilParentHover icon={<RenameIcon />} onClick={…}` (and similarly for delete).
- Drop the `LinksListRoot` styled wrap and inline the per-grid cell padding into the renderCell wrapper div.
- Replace `highlightText` import; remove `useHighlightedText` from `LinkItemList.tsx` and import the UIKit equivalent.

### Step 5 — `LinksTiles.tsx`

Tiles are non-list cards; `ListItem` doesn't fit. Replace the styled
`RenderGrid` block by:

- Keep `RenderGrid` itself.
- Replace `LinksTileCell` chrome with `<Panel revealChildrenOnHover direction="column" border={true} borderColor={isSelected ? "active" : "subtle"} rounded="md" overflow="hidden" position="relative" width="100%" height="100%" …>`.
- Tile image + title sections remain plain `<div style={{…}}>` blocks
  with inline styles (no `:hover` semantics needed inside them — the
  hover lift sits on the outer Panel via `revealChildrenOnHover`).
- The action button row becomes `<Panel position="absolute" top={4} right={4} gap="xs" data-visibility="parent-hover">` with `IconButton hideUntilParentHover` inside. Move the legacy `tile-actions` inline-style block (the bordered chip look) to a one-off Panel `background="overlay" border={true} rounded="md"`. (For exact pixel parity, fall back to inline-styled spans wrapping `IconButton`s if Panel's chrome doesn't match — flagged in concerns.)
- Selection tint: an absolutely-positioned `<div style={{ position: 'absolute', inset: 0, backgroundColor: color.background.selection, opacity: 0.3, pointerEvents: 'none' }} />` only rendered when `isSelected` — replaces the legacy `&.selected::before` overlay.
- Each `<button>` (raw HTML) action becomes `<IconButton …>`.

### Step 6 — `LinkTooltip.tsx`

Convert from an id-anchored Tooltip wrapper into a **content
ReactNode component**:

```tsx
// before
export function LinkTooltip({ id, link, allTags, onToggleTag }: …) {
    return <Tooltip id={id} place="bottom" delayShow={800}><LinkTooltipContent>…</LinkTooltipContent></Tooltip>;
}

// after
export function LinkTooltipContent({ link, allTags, onToggleTag }: Omit<LinkTooltipProps, "id">) {
    return (
        <Panel name="link-tooltip-body" direction="column" gap="xs" maxWidth={360}>
            <Text … weight="600" wordBreak="break-word">{link.title || "Untitled"}</Text>
            {link.href && <Text size="xs" color="light" wordBreak="break-all">{link.href}</Text>}
            {link.imgSrc && <img style={{ marginTop: 4, maxWidth: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 4, border: `1px solid ${color.border.default}` }} src={link.imgSrc} alt="" />}
            {showTags && (
                <Panel direction="column" gap="xs" paddingTop="sm" borderTop>
                    <Panel direction="row" wrap gap="xs" maxHeight={120} overflowY="auto">
                        {sortedTags.map((tag) => (
                            <Tag key={tag} label={tag} size="sm" variant="outlined" selected={linkTags.includes(tag)} onClick={() => onToggleTag?.(link, tag)} />
                        ))}
                        <Input name="link-tooltip-new-tag" size="sm" variant="ghost" minWidth={60} maxWidth={120} placeholder="+ tag (Enter)" value={newTag} onChange={setNewTag} onKeyDown={handleKeyDown} />
                    </Panel>
                </Panel>
            )}
        </Panel>
    );
}
```

- Drop `id` prop entirely. Drop the `styled` block — every visual is
  expressible via Panel/Text/Input/Tag.
- The new-tag pill uses UIKit `Input variant="ghost"` (inline-edit
  style). The legacy custom `.tag-new-input input` block disappears.
- Tag pills use `uikit/Tag` (size="sm", variant="outlined") with
  `selected` to fill on hover-active.

Callers (LinksListRow, PinnedItem, LinkCategoryPanel) now pass
`<LinkTooltipContent link={link} … />` as the `content` prop of UIKit
Tooltip wrapping each trigger.

### Step 7 — `PinnedLinksPanel.tsx`

- Drop `PinnedLinksPanelRoot` styled block.
- Outer container: `<Panel name="pinned-links-panel" direction="column" overflow="hidden" minWidth={100} maxWidth="40%" width={pinnedPanelWidth}>`.
- Header: `<Panel name="pinned-links-header" align="center" gap="xs" paddingX="md" paddingY="sm" borderBottom><PinFilledIcon style={{ width: 14, height: 14, color: color.misc.blue }} /><Text size="sm" color="light">Pinned</Text></Panel>`.
- List body: `<Panel direction="column" overflowY="auto" overflowX="hidden" paddingY="xs" flex={1}>` containing the array of pinned rows.
- Each row (`PinnedItem`): convert from styled `.pinned-item` div to a plain `<div>` with `draggable`, drag handlers, and inline `style` based on `isDragging` / `isOver` / `isSelected`. Inside the row:
  - `<Panel revealChildrenOnHover position="relative" align="center" gap="xs" paddingX="md" height={28} rounded="md" alignSelf="stretch" …>` — gives us the hover-reveal hook for any future action affordances.
  - Drop indicators (top/bottom 2 px blue line) — absolute-positioned plain `<div style={{ position: 'absolute', top: 0, left: 4, right: 4, height: 2, backgroundColor: color.misc.blue, borderRadius: 1 }} />` rendered when `dropPosition === "above"`, and a similarly positioned `bottom: 0` div when `"below"`. Plain inline style — no Emotion.
  - Selection tint: same absolutely-positioned `<div style={{ inset: 0, backgroundColor: color.background.selection, opacity: 0.3, pointerEvents: 'none', borderRadius: 'inherit' }} />` as in tiles.
  - Icon: `<TreeProviderItemIcon item={link} />` unchanged.
  - Title: `<Tooltip content={<LinkTooltipContent link={link} />}><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: color.text.strong, minWidth: 0 }}>{link.title || "Untitled"}</span></Tooltip>`.
- Module-level `draggingPinIndex` and the `dragEnterCount` ref logic are unchanged.

### Step 8 — `panels/LinkCategorySecondaryEditor.tsx`

- `import { Button } from "../../../components/basic/Button"` → `import { IconButton } from "../../../uikit/IconButton/IconButton"`.
- Save button: `<Button type="icon" size="small" title="Save"><SaveIcon width={14} height={14} /></Button>` → `<IconButton name="link-category-save" size="sm" title="Save" icon={<SaveIcon width={14} height={14} />} onClick={handleSave} />`.
- Swap button: `<Button type="icon" size="small" title="…"><SwapIcon …/></Button>` → `<IconButton name="link-category-toggle-main" size="sm" title={…} icon={<SwapIcon width={14} height={14} />} onClick={handleToggleMainEditor} />`.

### Step 9 — `panels/LinkHostnamesPanel.tsx` & `panels/LinkTagsPanel.tsx`

- Drop the styled wrapper (`LinkHostnamesPanelRoot` / `LinkTagsPanelRoot`).
- Replace `<TagsList tags={…} value={…} onChange={…} getCount={…} … />`
  with `<CategoryList name="link-hostnames" items={pageState.hostnames} value={pageState.selectedHostname} onChange={vm.setSelectedHostname} getCount={vm.getHostnameCount} separator={"\0"} rootLabel="All" />`. (Tags variant uses default `separator=":"` and no `rootLabel`.)
- Outer wrap: `<Panel name="link-tags-panel" direction="row" flex={1} overflow="hidden" width="100%">…</Panel>`.

### Step 10 — `panels/LinkTagsSecondaryEditor.tsx`

- Drop `NavigationPanelRoot` styled.div; use Panels.
- Replace legacy `<Splitter type="horizontal" initialHeight={…} onChangeHeight={…} borderSized="top" />` with `<Splitter name="link-tags-bottom-splitter" orientation="horizontal" value={bottomHeight ?? 150} onChange={handleChangeHeight} border="before" side="after" />`.
- LinksList component (used inside the navigation panel) is migrated as
  part of step 4, so this consumer is automatic.

### Step 11 — `LinkItemList.tsx` & `LinkItemTiles.tsx`

- `LinkItemList.tsx`: `import { useHighlightedText } from "../../components/basic/useHighlightedText"` → `import { useHighlightedText } from "../../uikit/shared/highlight"`.
- `LinkItemTiles.tsx`: no legacy import — verify with grep at the start
  of implementation.

### Step 12 — Delete legacy `components/basic/TagsList.tsx`

After steps 1-10 land, grep confirms no remaining consumers — delete
the file. (Verified: legacy TagsList is only consumed by the two
link-editor panels above.) **Do not delete `useHighlightedText.tsx`**
yet — TodoEditor and other migrated editors still import from it
during the EPIC-025 transition; that file's removal is owned by the
final epic-close sweep.

### Step 13 — Baselines + smoke

- `npm run lint` — counts unchanged.
- `npx tsc --noEmit` — counts unchanged.
- Manual smoke:
  - Open a `.link.json` collection — list view loads and renders.
  - Switch view modes (list → landscape → portrait variants); per-mode
    persistence works.
  - Browse via Categories tree; drill-in updates the Breadcrumb and
    filters the right pane.
  - Open Tags panel; drill into a categorised tag (`release:1.0.1`);
    Breadcrumb shows `release: > 1.0.1`.
  - Open Hostnames panel; counts render; "All" clears the filter.
  - Search via the toolbar Input; matches highlight inside list rows
    and inside tree-cell labels; clear-X button resets.
  - Hover a list row — action buttons (edit / delete) fade in;
    hover off — they hide.
  - Hover a tile — action chips fade in.
  - Right-click a row / tile / pinned row — context menus open with
    every item present (Edit / Copy URL / Pin / Delete / `Open …` for
    HTTP, image-context items for image links).
  - Pin a link; reorder pinned by drag — drop indicators (blue line)
    show correctly.
  - Resize both splitters (left panel + pinned panel); state persists
    across page reload.
  - Hover a list-row title — tooltip shows title / href / image /
    sorted-tag chips. Click a chip — tag toggles on the link.
  - Hover a tree-cell category leaf — tooltip shows the same metadata.
  - Drag a link out of the list onto an external drop target
    (e.g. another link collection's center pane) — drop succeeds.
  - Drag an external link onto the center pane — drop indicator
    (blue outline / border) shows; drop imports the link.

## Concerns / Open questions

1. **Tile-action chip exact-pixel parity.** The legacy `.tile-actions
   button` chip has a 1 px border, 6 px radius, 2 px gap, and
   `color.background.overlay` background — UIKit `IconButton` has its
   own padding and no border by default. To match, either (a) wrap each
   action `IconButton` in a `<Panel background="overlay" border rounded="md">`,
   or (b) accept the visual drift (cleaner UIKit look, slightly less
   prominent chip).
   **Proposed default:** option (b) — drop the chip chrome; accept the
   minor visual change. Confirm during user testing.

2. **Center-panel drag-over visual.** Legacy used `outline: 2px dashed
   color.border.active` with `outlineOffset: -2`. UIKit Panel doesn't
   expose `outline`; the closest equivalent is `border + borderColor="active"`
   (1 px solid line). Visually distinguishable but slightly weaker
   affordance.
   **Proposed default:** use Panel's `border` + `borderColor="active"`.
   Alternative if user finds it too subtle: add a small `outline`
   prop to UIKit Panel (deferred until requested).

3. **Search-Input blue text colour.** Legacy `SearchField` overrides
   the input text colour to `color.misc.blue` to signal that a search
   filter is active — without it the unfocused search input looks
   identical to any other field, and the user can miss the fact that
   items are being filtered out.
   **Resolution:** add a `tone?: "default" | "accent"` prop to
   `uikit/Input` (step 1.5). LinkEditor's search Input renders with
   `tone="accent"`. The accent value is also surfaced as
   `data-tone="accent"` for future cross-primitive use.

4. **`LinkCategoryPanel` per-row tooltip cost.** The legacy code uses a
   single shared `Tooltip` portal with `render({ activeAnchor })`; the
   migration mounts one Tooltip per visible tree row. Floating-ui is
   lazy (the floating element only mounts when the tooltip opens), so
   the per-row cost is one extra hook + one cloneElement per render.
   Acceptable for a virtualized tree with ~30 visible rows. **No
   action; monitor during smoke.**

5. **`LinkViewModel.ts` `MenuItem` type import.** **Resolved.**
   Verified both ends re-export from the same source:
   `src/renderer/components/overlay/PopupMenu.tsx:18-19` →
   `export type { MenuItem } from "../../api/types/events";` and
   `src/renderer/uikit/Menu/types.ts:1` →
   `export type { MenuItem } from "../../api/types/events";`.
   They are aliases of the same type. Step 0's swap to
   `uikit/Menu/types` is the only required change — no plan delta.

6. **Folder rows under search.** **Investigated and fixed in plan.**
   Folders ARE search targets:
   - `LinkViewModel.applyFilters` (LinkViewModel.ts:427-438) filters by
     `title`/`href`/`category`/`tags` with no `isDirectory` exclusion —
     folders whose title matches the query stay visible; folders that
     don't match are filtered out.
   - Legacy `LinksList.tsx:161` runs `highlightText` for BOTH folder
     and non-folder rows. The only folder-specific bit is the CSS
     class (`link-title-folder` → `fontWeight: 500`).

   The migration must therefore highlight matched text on folder rows
   AND keep them bold. Step 4 now builds the folder label as a
   pre-highlighted ReactNode wrapped in `<span style={{ fontWeight: 500 }}>`,
   and passes `searchText={undefined}` to ListItem for folder rows so
   it doesn't try to re-highlight the ReactNode. Non-folder rows pass
   `label={string} searchText={searchText}` and let ListItem run
   `highlight` internally.

## Acceptance criteria

- No imports from `components/basic|form|layout|overlay/` in any file
  under `src/renderer/editors/link-editor/`. (Type-only `MenuItem`
  import switched to `uikit/Menu/types`.)
- No `@emotion/styled` blocks remaining in any file under
  `src/renderer/editors/link-editor/` (Rule 7 — chrome exception does
  not apply; LinkEditor is an editor surface, not chrome).
- `uikit/CategoryList` added with story + index export; legacy
  `components/basic/TagsList.tsx` deleted.
- `uikit/Input` gains `tone="default" | "accent"` prop; LinkEditor's
  search Input uses `tone="accent"` (preserves the legacy
  active-filter signal).
- All migrated UIKit primitives carry meaningful `name` debug
  attributes per US-521 conventions (call-site names listed in steps
  above are normative).
- Controlled `Splitter` instances persist width / height through
  `LinkViewModel` callbacks identically to the legacy uncontrolled
  splitter.
- `PinnedLinksPanel` reorder drag-and-drop preserves drop-position
  indicators and module-level `draggingPinIndex` tracking.
- Search highlighting (`highlight`) renders inside both list rows and
  tree-cell category labels — and for folder rows the bold weight is
  preserved alongside the highlight.
- `LinkTooltip` content renders for list rows, tile rows, pinned rows,
  and tree-cell category leaves; the inline-edit tag-add input remains
  Enter-committed.
- `npm run lint` baseline unchanged.
- `npx tsc --noEmit` baseline unchanged.
- Full manual smoke (step 13 list).

This task does NOT run `/review`, `/document`, or `/userdoc` — those
run at EPIC-025 close per the deferred-review model.

## Files Changed

| Path | Change |
|------|--------|
| `src/renderer/uikit/CategoryList/CategoryList.tsx` | **new** — UIKit primitive |
| `src/renderer/uikit/CategoryList/CategoryList.story.tsx` | **new** — story |
| `src/renderer/uikit/CategoryList/index.ts` | **new** — barrel |
| `src/renderer/uikit/index.ts` | export `CategoryList`, `CategoryListProps` |
| `src/renderer/uikit/Input/Input.tsx` | add `tone?: "default" \| "accent"` prop |
| `src/renderer/uikit/Input/Input.story.tsx` | add accent-tone example |
| `src/renderer/uikit/ListBox/ListItem.tsx` | add `showSelectionIcon?: boolean` prop (default true) — suppresses the default trailing check/chevron icon while keeping the `selectionStyle="accent"` background fill |
| `src/renderer/editors/link-editor/LinkEditor.tsx` | replace styled root + toolbar primitives + Splitters |
| `src/renderer/editors/link-editor/LinksList.tsx` | drop styled `RenderGrid`; rewrite row via UIKit `ListItem` + `IconButton` |
| `src/renderer/editors/link-editor/LinksTiles.tsx` | drop styled `RenderGrid`; rewrite tile via UIKit `Panel` + `IconButton` |
| `src/renderer/editors/link-editor/LinkItemList.tsx` | swap `useHighlightedText` import path |
| `src/renderer/editors/link-editor/LinkItemTiles.tsx` | no banned imports — verify only |
| `src/renderer/editors/link-editor/PinnedLinksPanel.tsx` | drop styled root; rewrite via UIKit `Panel` + plain HTML rows |
| `src/renderer/editors/link-editor/LinkTooltip.tsx` | rename to `LinkTooltipContent`; drop `id`; return ReactNode body only |
| `src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx` | drop styled root; inline per-row `Tooltip`; swap `highlight` import |
| `src/renderer/editors/link-editor/panels/LinkCategorySecondaryEditor.tsx` | `Button type="icon"` → UIKit `IconButton` |
| `src/renderer/editors/link-editor/panels/LinkHostnamesPanel.tsx` | drop styled root; swap `TagsList` → `CategoryList` |
| `src/renderer/editors/link-editor/panels/LinkHostnamesSecondaryEditor.tsx` | no banned imports — verify only |
| `src/renderer/editors/link-editor/panels/LinkTagsPanel.tsx` | drop styled root; swap `TagsList` → `CategoryList` |
| `src/renderer/editors/link-editor/panels/LinkTagsSecondaryEditor.tsx` | drop styled root; swap legacy `Splitter` → UIKit `Splitter` |
| `src/renderer/editors/link-editor/LinkViewModel.ts` | swap `MenuItem` import path (`components/overlay/PopupMenu` → `uikit/Menu/types`) |
| `src/renderer/components/basic/TagsList.tsx` | **delete** — no remaining consumers |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Related primitives: US-516 Breadcrumb, US-517 CollapsiblePanelStack,
  US-475 Tag/TagsInput, US-486 Splitter, US-467 Tooltip, US-521 name
  debug prop
- New primitive landed here: `uikit/CategoryList`
- Related screens: US-512 Notebook, US-498 Settings, US-499 TodoEditor
- Note: this task touches the LinkEditor rendering layer only.
  EPIC-022 (LinkEditor Embedded Scripts) is feature work and stays
  independent.
