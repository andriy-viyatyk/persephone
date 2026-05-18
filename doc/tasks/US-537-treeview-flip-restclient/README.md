# US-537: RestClient `TreeView` → UIKit `Tree` flip

## Status

**Implemented — awaiting user testing + epic-close review.** Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 — single-file cleanup that
empties the legacy `components/TreeView/` folder.

Deferred-review model: this task does NOT run `/review`, `/document`,
or `/userdoc` — those run at epic close (US-532).

### Implementation summary

Single-file flip in `src/renderer/editors/rest-client/RestClientEditor.tsx`:

- Imports flipped: `components/TreeView` → `uikit` (`Tree`, `TreeItem`,
  `TREE_ITEM_KEY`, `TreeItemRenderContext`) + `core/traits/traits`
  (`TraitSet`, `traited`, `Traited`).
- `RequestTreeItem` dropped `extends TreeItem`; added explicit
  `items?: RequestTreeItem[]`.
- Added module-level `requestTreeItemTraits` (maps `id` → `value`,
  produces a label string for trait-shape completeness — unused by
  the custom `renderItem`) and `getRequestTreeChildren`.
- `RestClientEditor` parent: `rootItem` and `tItems` (`traited([rootItem], …)`)
  hoisted into `useMemo` above conditional returns; `<RequestTree>`
  prop renamed `root` → `items`.
- `RequestTree` inner component rewritten: callbacks renamed
  (`getSelected` → `isSelected`, `onItemClick` → `onChange`,
  `onItemContextMenu` → `handleItemContextMenu`); custom `renderItem`
  covers all three row shapes (root header + Add button via
  `hideChevron`, collection text, request METHOD badge + name); drag-drop
  props directly mapped to UIKit Tree signature; `refreshKey` dropped
  (selection re-renders via `model.state.use()` + per-row
  `isSelected`).
- Context menu kept as direct `showAppPopupMenu` call wired through
  `<TreeItem onContextMenu={…}>` (matches `TreeProviderView` pattern)
  with both `preventDefault` and `stopPropagation` on the event so
  the native menu is suppressed and the outer Tree handler does not
  re-fire.

`tsc` + `lint` baselines unchanged: 20 errors / 20 lint errors + 896
warnings (no new findings in `rest-client/`). Grep
`from "[^"]*components/TreeView"` returns matches only inside
`src/renderer/components/TreeView/` itself.

## Goal

Migrate the single remaining caller of legacy `components/TreeView/`
to UIKit `Tree`. After this task,
`src/renderer/components/TreeView/` has zero external callers and the
folder can be deleted by US-532.

## Background

### Single caller

`src/renderer/editors/rest-client/RestClientEditor.tsx:2`:

```ts
import { TreeView, TreeItem } from "../../components/TreeView";
```

The migration was carried forward through
[US-501](../US-501-rest-client-migration/README.md) — the RestClient
collection tree was non-trivial enough to defer once US-501's body
was already large.

Grep confirms it is the **only** external caller of
`components/TreeView/`:

```
src/renderer/editors/rest-client/RestClientEditor.tsx:2
```

### `components/TreeView/` inventory

The legacy folder contains four files:

- `TreeView.tsx` — view (uses `uikit/RenderGrid`)
- `TreeView.model.ts` — `TComponentModel` subclass owning rows /
  expand state / drag-drop wiring
- `CategoryTree.tsx` — different tree variant; **only re-exported
  from `index.ts`, no other consumers** (grep confirms — see
  Concern C)
- `index.ts` — barrel

After US-537, every export in the barrel becomes dead. US-532 deletes
the whole folder.

### UIKit `Tree` destination

`src/renderer/uikit/Tree/` (US-485). Public surface:

| Concept | Legacy `TreeView` | UIKit `Tree` |
|---|---|---|
| Items input | `root: T` (single root, walks `.items`) | `items: T[] \| Traited<unknown[]>` + `getChildren?: (src) => src[]` (default `(s) => s.items`) |
| Stable id | `getId: (item) => string` | source field `value: string\|number` OR `TREE_ITEM_KEY` trait accessor |
| Label | `getLabel: (item) => ReactNode` | `label` field on ITreeItem OR trait accessor (default render only) |
| Selection | `getSelected?: (item) => boolean` | `isSelected?: (item, level) => boolean` (or `value?: T`) |
| Click | `onItemClick?: (item) => void` | `onChange?: (item) => void` |
| Context menu | `onItemContextMenu?: (item, e) => void` (consumer calls `showAppPopupMenu` itself) | `getContextMenu?: (item, level) => MenuItem[]` (Tree dispatches via `ContextMenuEvent.fromNativeEvent`, global handler renders) — **OR** custom `renderItem` + per-row `<TreeItem onContextMenu={...}>` for direct dispatch |
| Default expand all | `defaultExpandAll?: boolean` | `defaultExpandAll?: boolean` — same |
| Initial expand map | `initialExpandMap?: Record<string, boolean>` | `defaultExpandedValues?: Record<string\|number, boolean>` |
| External refresh hint | `refreshKey?: string\|number` | **none needed** — selection / state re-renders flow via `model.state.use()` |
| Root collapsibility | `rootCollapsible?: boolean` (default false) | none — handle via `hideChevron` in `renderItem` |
| Custom row | `getLabel` returns ReactNode → wrapped in chrome | full-row `renderItem?: (ctx) => ReactNode` |
| DnD: trait id | `traitTypeId?: TraitTypeId` | `traitTypeId?: TraitTypeId` — same |
| DnD: drag data | `getDragData?: (item) => unknown \| null` | `getDragData?: (src, level) => unknown \| null` |
| DnD: accept | `acceptsDrop?: boolean` | `acceptsDrop?: boolean` — same |
| DnD: drop pred | `canTraitDrop?: (drop, payload) => boolean` | `canTraitDrop?: (target, payload, level) => boolean` |
| DnD: drop handler | `onTraitDrop?: (drop, payload) => void` | `onTraitDrop?: (target, payload, level) => void` |

### Reference implementation

`src/renderer/components/tree-provider/TreeProviderView.tsx` is the
closest reference — it uses `Tree` with:

- a `TraitSet` mapping a custom source shape to ITreeItem accessors
  (`tpvNodeTraits`, lines 36–42 of TreeProviderView.tsx)
- `getChildren` walking a custom field (`getNodeChildren`,
  line 44)
- a custom `renderItem` rendering `<TreeItem hideChevron={level===0} ... onContextMenu={(e) => model.onItemContextMenu(node, e)}>`
  (lines 222–254)
- DnD via `traitTypeId` / `getDragData` / `acceptsDrop` /
  `canTraitDrop` / `onTraitDrop` (lines 287–306)

RestClient's tree maps onto the same pattern almost line-for-line.

### `RestClientViewModel` callbacks the tree uses

All read-only references — no view-model changes needed:

| Method | Signature | Used for |
|---|---|---|
| `vm.selectRequest(id: string)` | `RestClientViewModel.ts:288` | row click + before context menu |
| `vm.addRequest(name?, collection?)` | `RestClientViewModel.ts:301` | root "+" button + "Add Request" submenu |
| `vm.deleteRequest(id: string)` | `RestClientViewModel.ts:321` | "Delete" submenu |
| `vm.deleteCollection(name: string)` | `RestClientViewModel.ts:362` | "Delete Collection" submenu |
| `vm.moveRequest(fromId, toId, newColl?)` | `RestClientViewModel.ts:384` | trait drop handler |
| `vm.updateRequest(id, changes)` | `RestClientViewModel.ts:408` | "Duplicate" submenu, link-drop create |

## Implementation plan

All work is inside
`src/renderer/editors/rest-client/RestClientEditor.tsx`. No other
files change in production code — only this file and its imports flip
off `components/TreeView/`.

### Step 1 — Imports

**Before** (RestClientEditor.tsx:2):
```ts
import { TreeView, TreeItem } from "../../components/TreeView";
```

**After**:
```ts
import {
    Tree,
    TreeItem,
    TREE_ITEM_KEY,
    type TreeItemRenderContext,
} from "../../uikit";
import { TraitSet, traited } from "../../core/traits/traits";
```

Notes:
- `Tree` + `TreeItem` + `TREE_ITEM_KEY` are already exported from
  `uikit/index.ts` (verified via grep).
- The legacy `TreeItem` type (`{ items?: T[] }`) is no longer used —
  see Step 2.
- `TraitSet` / `traited` come from `core/traits/traits`; same module
  TreeProviderView imports from.

### Step 2 — Restructure `RequestTreeItem`

**Before** (RestClientEditor.tsx:27–33):
```ts
interface RequestTreeItem extends TreeItem {
    id: string;
    request?: RestRequest;
    isRoot?: boolean;
    isCollection?: boolean;
    collectionName?: string;
}
```

**After** — drop the `extends TreeItem` (the legacy type is gone),
add explicit `items?` field (default `getChildren` walks `.items`):
```ts
interface RequestTreeItem {
    id: string;
    items?: RequestTreeItem[];
    request?: RestRequest;
    isRoot?: boolean;
    isCollection?: boolean;
    collectionName?: string;
}
```

### Step 3 — Trait set bridging source to ITreeItem

Add at module scope (just below `EMPTY_LABEL`):

```ts
// Trait set translates a RequestTreeItem into the UIKit Tree's ITreeItem accessors.
// `value` is the row's stable id (request.id for leaf rows, "__col__{name}" for
// collection rows, "__root__" for the synthetic root). `label` is required by the
// trait shape but unused — the custom `renderItem` owns all visible chrome.
const requestTreeItemTraits = new TraitSet().add(TREE_ITEM_KEY, {
    value: (item: unknown) => (item as RequestTreeItem).id,
    label: (item: unknown) => {
        const r = item as RequestTreeItem;
        if (r.isRoot) return "";
        if (r.isCollection) return r.collectionName ?? "";
        return r.request?.name ?? "";
    },
});

const getRequestTreeChildren = (item: RequestTreeItem) => item.items;
```

### Step 4 — Rewrite the `RequestTree` component

The component currently constructs callbacks (`getLabel`, `getId`,
`getSelected`, `onItemClick`, `onItemContextMenu`, `getDragData`,
`canTraitDrop`, `onTraitDrop`) and passes them to `<TreeView>`.
Keep the **logic** of each callback — change only the prop names,
signatures, and the render path.

#### 4a. Build `tItems` via `traited`

Replace the current `rootItem` allocation (RestClientEditor.tsx:84–88)
with a `useMemo` wrapped traited array. The new shape:

```ts
const tItems = useMemo(
    () => traited([rootItem], requestTreeItemTraits),
    [rootItem],
);
```

Where `rootItem` is still:
```ts
const rootItem: RequestTreeItem = {
    id: "__root__",
    isRoot: true,
    items: buildGroupedTree(state.data.requests),
};
```

Wrap the `rootItem` literal in `useMemo` keyed on
`state.data.requests` so the traited array identity is stable across
non-data renders.

#### 4b. Convert callbacks

**`getId` → drop.** UIKit Tree reads stable id from the trait accessor.

**`getLabel` → drop.** Custom `renderItem` owns row rendering.

**`getSelected` → `isSelected`:**
```ts
const isSelected = useCallback(
    (item: RequestTreeItem) => item.id === selectedId,
    [selectedId],
);
```

**`onItemClick` → `onChange`** (legacy gated on `item.request`):
```ts
const onChange = useCallback(
    (item: RequestTreeItem) => {
        if (item.request) vm.selectRequest(item.id);
    },
    [vm],
);
```

**`onItemContextMenu` → keep the legacy logic in a local helper, wire
it via `renderItem` → `<TreeItem onContextMenu={...}>`.** Tree's own
`getContextMenu` API exists but the legacy code uses
`showAppPopupMenu` directly and selects the row before opening — same
pattern TreeProviderView uses for its per-row context menu. Keep the
direct call.

Rename the existing legacy `onItemContextMenu` (RestClientEditor.tsx:492–573)
to `handleItemContextMenu`, drop the `if (item.isRoot) return;` early
exit (the renderItem won't wire onContextMenu on root — see Step 4c)
and the existing `e.preventDefault();` line. Signature unchanged —
`(item: RequestTreeItem, e: React.MouseEvent) => void`. The body is
otherwise identical (selects on right-click, branches on
`isCollection` vs leaf, calls `showContextMenu(e, items)`).

**`getDragData` (legacy returns `null` for root + collection):**
UIKit signature is `(source, level) => unknown | null`. Logic is
identical:
```ts
const getDragData = useCallback(
    (item: RequestTreeItem) => {
        if (item.isRoot || item.isCollection) return null;
        return { id: item.id };
    },
    [],
);
```
The unused `level` second arg is fine — JS ignores extra args.

**`canTraitDrop` (legacy excludes root):**
```ts
const canTraitDrop = useCallback(
    (dropItem: RequestTreeItem, payload: TraitDragPayload) => {
        if (dropItem.isRoot) return false;
        if (payload.typeId === TraitTypeId.RestRequest) return true;
        const traits = resolveTraits(payload.typeId);
        return !!traits?.get(LINK);
    },
    [],
);
```

**`onTraitDrop`** — identical body to legacy (RestClientEditor.tsx:594–621):
```ts
const onTraitDrop = useCallback(
    (dropItem: RequestTreeItem, payload: TraitDragPayload) => {
        if (dropItem.isRoot) return;

        if (payload.typeId === TraitTypeId.RestRequest) {
            const data = payload.data as { id: string };
            if (dropItem.isCollection) {
                vm.moveRequest(data.id, dropItem.id, dropItem.collectionName ?? "");
            } else {
                vm.moveRequest(data.id, dropItem.id, dropItem.request?.collection);
            }
            return;
        }

        const traits = resolveTraits(payload.typeId);
        const linkTrait = traits?.get(LINK);
        if (!linkTrait) return;
        const items = linkTrait.getItems(payload.data);
        const collection = dropItem.isCollection
            ? (dropItem.collectionName ?? "")
            : (dropItem.request?.collection ?? "");
        for (const item of items) {
            if (!item.href) continue;
            const req = vm.addRequest(item.title || item.href, collection);
            vm.updateRequest(req.id, { url: item.href });
        }
    },
    [vm],
);
```

#### 4c. `renderItem`

Replicate the three branches the legacy `getLabel` produced (root /
collection / request), wrapping each in a `<TreeItem>`:

```ts
const renderItem = useCallback(
    (ctx: TreeItemRenderContext<RequestTreeItem>) => {
        const item = ctx.source;

        // Root row — "Requests" header + Add button. No chevron, no
        // selection / drag affordance (model already filters via
        // isSelected / getDragData / canTraitDrop).
        if (item.isRoot) {
            return (
                <TreeItem
                    id={ctx.id}
                    level={ctx.level}
                    expanded={ctx.expanded}
                    hasChildren={ctx.hasChildren}
                    hideChevron
                    selected={false}
                    active={ctx.active}
                    label={
                        <Panel
                            name="rest-tree-root-label"
                            direction="row"
                            align="center"
                            flex={1}
                            paddingLeft="sm"
                            gap="xs"
                        >
                            <Text size="xs" variant="uppercased" color="light" bold>
                                Requests
                            </Text>
                            <Spacer />
                            <IconButton
                                name="rest-tree-add"
                                size="sm"
                                icon={<PlusIcon />}
                                title="Add request"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    vm.addRequest();
                                }}
                            />
                        </Panel>
                    }
                />
            );
        }

        // Collection / request branches both use the row's standard
        // chrome — chevron when children exist, selection styling,
        // drag handles. Wire context menu via TreeItem's onContextMenu.
        const labelNode = item.isCollection
            ? (
                <Text
                    size="md"
                    bold={!!item.collectionName}
                    italic={!item.collectionName}
                    color={item.collectionName ? "default" : "light"}
                >
                    {item.collectionName || EMPTY_LABEL}
                </Text>
            )
            : (() => {
                const req = item.request!;
                const badgeColor = METHOD_COLORS[req.method];
                return (
                    <Panel direction="row" align="center" gap="sm">
                        <Panel minWidth={32} justify="center">
                            <Text size="xs" bold color={badgeColor} align="center">
                                {req.method}
                            </Text>
                        </Panel>
                        <Text
                            size="md"
                            truncate
                            italic={!req.name}
                            color={req.name ? "default" : "light"}
                        >
                            {req.name || EMPTY_LABEL}
                        </Text>
                    </Panel>
                );
            })();

        return (
            <TreeItem
                id={ctx.id}
                level={ctx.level}
                expanded={ctx.expanded}
                hasChildren={ctx.hasChildren}
                label={labelNode}
                selected={ctx.selected}
                active={ctx.active}
                dragging={ctx.dragging}
                dropActive={ctx.dropActive}
                onChevronClick={(e) => {
                    e.stopPropagation();
                    ctx.toggleExpanded();
                }}
                onContextMenu={(e) => handleItemContextMenu(item, e)}
            />
        );
    },
    [vm, handleItemContextMenu],
);
```

The `onChevronClick` handler stops propagation so the row's outer
`onClick` (Tree's `onItemClick → onChange`) does not fire when the
user clicks the chevron — mirrors the TreeProviderView pattern
(TreeProviderView.tsx:248).

#### 4d. JSX swap

**Before** (RestClientEditor.tsx:623–639):
```tsx
<TreeView<RequestTreeItem>
    root={root}
    getLabel={getLabel}
    getId={getId}
    getSelected={getSelected}
    onItemClick={onItemClick}
    onItemContextMenu={onItemContextMenu}
    traitTypeId={TraitTypeId.RestRequest}
    getDragData={getDragData}
    acceptsDrop
    canTraitDrop={canTraitDrop}
    onTraitDrop={onTraitDrop}
    defaultExpandAll
    refreshKey={selectedId}
/>
```

**After**:
```tsx
<Tree<RequestTreeItem>
    name="rest-client-tree"
    items={tItems}
    getChildren={getRequestTreeChildren}
    isSelected={isSelected}
    onChange={onChange}
    renderItem={renderItem}
    traitTypeId={TraitTypeId.RestRequest}
    getDragData={getDragData}
    acceptsDrop
    canTraitDrop={canTraitDrop}
    onTraitDrop={onTraitDrop}
    defaultExpandAll
/>
```

Notes:
- `name="rest-client-tree"` follows the
  [feedback_uikit_debug_naming](../../../doc/) rollout (US-521 /
  US-522).
- `refreshKey={selectedId}` is dropped — UIKit Tree subscribes to
  `model.state.use()` and `isSelected` runs on every flat-row render,
  so changing `selectedId` re-renders affected rows without an
  external trigger. TreeProviderView uses no equivalent.

### Step 5 — Verify the legacy folder has no remaining callers

After Step 4, run from the repo root:
```bash
grep -rE "from \"[^\"]*components/TreeView" src/renderer
```

Expected output:
```
src/renderer/components/TreeView/index.ts:2:export { CategoryTree } from "./CategoryTree";
src/renderer/components/TreeView/CategoryTree.tsx:3:import { TreeView } from "./TreeView";
src/renderer/components/TreeView/CategoryTree.tsx:4:import { TreeItem, TreeViewProps } from "./TreeView.model";
```

i.e. only intra-folder references. US-532 then deletes the folder.

### Step 6 — Baseline checks

- `npx tsc --noEmit` — no new errors compared to baseline.
- `npm run lint` — no new warnings compared to baseline.

## Concerns / open questions

### A. Drag-and-drop in RestClient tree — **resolved**

Legacy tree IS drag-enabled (verified at RestClientEditor.tsx:631–635):
both row dragging (`traitTypeId={TraitTypeId.RestRequest}` +
`getDragData`) and row accepting drops (`acceptsDrop` +
`canTraitDrop` accepts both `RestRequest` and any `LINK`-trait
payload). UIKit Tree's DnD (US-488) supports the same shape — see
TreeProviderView.tsx:287–306 for an in-tree reference.

### B. Selection / context menu parity — **resolved**

- **Selection** — Legacy `getSelected: (item) => item.id === selectedId`
  ports 1-to-1 to UIKit Tree's `isSelected` predicate.
- **Context menu** — Legacy code calls `showAppPopupMenu` directly
  inside an `onItemContextMenu` closure. We preserve that path via
  `renderItem` → `<TreeItem onContextMenu={handleItemContextMenu}>`
  rather than UIKit Tree's higher-level `getContextMenu`, because:
  1. The legacy code performs a side effect (`vm.selectRequest`)
     **before** opening the menu — easier to keep in one callback.
  2. TreeProviderView already uses the same `onContextMenu` pattern,
     so this is a known idiom in the codebase.

### C. CategoryTree.tsx — **verified zero external callers**

`grep -rE "CategoryTree" src/renderer` returns matches **only** in:
- `components/TreeView/CategoryTree.tsx` (definition)
- `components/TreeView/index.ts` (re-export)

No file outside `components/TreeView/` imports `CategoryTree`. The
file is dead code; US-532 deletes it with the folder.

### D. `refreshKey` removal — **acceptable**

Legacy passed `refreshKey={selectedId}` to force a grid-cell refresh
when the externally-tracked selection changed. UIKit Tree drives the
View through `model.state.use()` and reads `isSelected` per-row
during `renderCell`. TreeProviderView wires selection through
`isSelected` without a refresh hint and works correctly, so dropping
`refreshKey` should be a no-op. If a regression appears (stale
selection styling), the fallback is to add a `key={selectedId}` on
`<Tree>` — but that would reset expansion state, so we prefer to
trust the `isSelected`/`state.use()` re-render path first.

### E. Root row's "+" button click does not select the root row — **handled**

Currently the legacy code uses `e.stopPropagation()` on the
PlusIcon's onClick to prevent the row from receiving the click. The
same `e.stopPropagation()` survives in the new `renderItem` body.
UIKit Tree's outer wrapper binds `onClick → model.onItemClick →
onChange`; stopping propagation on the IconButton prevents the
unwanted `onChange` call. (Even if it bubbled, the `onChange` handler
in Step 4b guards `if (item.request)`, so the root row never selects
anything — defense in depth.)

### F. `onChevronClick` propagation on collection rows — **handled**

When the user clicks the chevron on a collection row, we want to
toggle expansion but **not** select the row. The renderItem wires
`onChevronClick={(e) => { e.stopPropagation(); ctx.toggleExpanded(); }}`
on the `<TreeItem>` — same pattern as TreeProviderView.tsx:247–250.
Without `e.stopPropagation()`, the click would bubble to the outer
row's `onClick` and (because collection rows have no `request`)
become a no-op via the `if (item.request)` guard. Stopping is the
safer default.

### G. Items identity stability — **handled via useMemo**

`buildGroupedTree(state.data.requests)` returns a new array on every
render of `RestClientEditor`. Passing this fresh array into
`traited([rootItem], requestTreeItemTraits)` would build a new
Traited wrapper every render. UIKit Tree's TreeModel memoizes its
flat-row walk on the items identity (verified in TreeModel — it
keeps `rows` as a `model.rows.value` memo). Wrap the `rootItem`
allocation in `useMemo` keyed on `state.data.requests`:

```ts
const rootItem = useMemo<RequestTreeItem>(
    () => ({
        id: "__root__",
        isRoot: true,
        items: buildGroupedTree(state.data.requests),
    }),
    [state.data.requests],
);

const tItems = useMemo(
    () => traited([rootItem], requestTreeItemTraits),
    [rootItem],
);
```

## Acceptance criteria

- [ ] `src/renderer/editors/rest-client/RestClientEditor.tsx` has zero
      imports from `components/TreeView/`.
- [ ] Repo-wide grep
      `grep -rE "from \"[^\"]*components/TreeView" src/renderer`
      returns matches **only** inside
      `src/renderer/components/TreeView/` itself.
- [ ] RestClient tree behaviour preserved (manual smoke list below):
      expand/collapse, selection, item click, item add/remove,
      context menus, drag-and-drop.
- [ ] `npm run lint` clean against baseline; `npx tsc --noEmit`
      reports no new errors.

## Test surface (manual smoke)

After implementation, exercise each path:

- Open a `.rest.json` file: collection tree renders in left panel.
- Root row shows "Requests" header + "+" button; clicking "+" adds a
  request (in the default collection).
- Click a request: opens in detail editor on the right.
- Right-click a collection: `Add Request` / `Open in New Editor` /
  `Delete Collection` menu appears.
- Right-click a request: `Duplicate` / `Open in New Editor` /
  `Delete` menu appears.
- Drag a request between collections: collection assignment updates;
  `RestClientViewModel.moveRequest` fires.
- Drag a request onto another request inside the same collection:
  re-ordering works.
- Drag an external Link (e.g. from LinkEditor) onto a collection or
  a request: a new RestRequest is created with the link's URL.
- Expand/collapse a collection (chevron click): expansion toggles;
  row selection does NOT change.
- Click "+" button on the root row: a new request is added; root row
  selection state is unchanged.
- Reload the page: previously-expanded collections stay expanded
  (`defaultExpandAll` preserves the default; explicit toggles persist
  via the model's own expand map across re-renders within the same
  mount — full session persistence is out of scope and matches
  legacy behavior).

## Files Changed (planned)

| File | Change |
|---|---|
| `src/renderer/editors/rest-client/RestClientEditor.tsx` | Imports flipped; `RequestTreeItem` restructured; `requestTreeItemTraits` + `getRequestTreeChildren` added; `RequestTree` rewritten (callbacks renamed, `renderItem` added, `tItems` traited via `useMemo`); `<TreeView>` JSX replaced with `<Tree>`. |

### Files explicitly NOT changed

| File | Reason |
|---|---|
| `src/renderer/components/TreeView/*` | Folder stays in place; US-532 deletes it once every legacy `components/` consumer is gone. |
| `src/renderer/editors/rest-client/RestClientViewModel.ts` | No public method signature changes — all view-model calls (`selectRequest`, `addRequest`, `deleteRequest`, `deleteCollection`, `moveRequest`, `updateRequest`, `updateRequestCollection`, `renameRequest`, `setLeftPanelWidth`) are used unchanged. |
| `src/renderer/uikit/Tree/*` | Destination primitive is already in place (US-485 / US-488). No new UIKit primitives or extensions are needed for this flip. |
| `src/renderer/editors/rest-client/{RequestBuilder,ResponseViewer,httpConstants,serializeRequest,restClientTypes}.{ts,tsx}` | None of these touch the tree. |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration cleanup
- Depends on: [US-485](../US-485-uikit-tree/README.md) (UIKit Tree),
  [US-488](../US-488-uikit-tree-dnd/README.md) (UIKit Tree DnD)
- Related: [US-501](../US-501-rest-client-migration/README.md)
  deferred this caller flip
- Unblocks: [US-532](../US-532-legacy-components-removal/README.md)
  deletion of `components/TreeView/`
- Reference impl: `src/renderer/components/tree-provider/TreeProviderView.tsx`
