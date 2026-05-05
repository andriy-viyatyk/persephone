# US-489: UIKit Tree extensions — lazy children loading

## Goal

Extend UIKit `Tree` (V1 from [US-485](../US-485-uikit-tree/README.md)) with on-demand
children loading. A row may declare "I have children" without those children being
materialized; expanding it triggers an async consumer-supplied loader and the chevron
shows a spinner until the load resolves.

After this task, consumers whose data is fetched on-demand (`TreeProviderView` for
file-system / archive / link-provider trees) gain an idiomatic API and can migrate to UIKit
`Tree` without rolling their own "loaded?" tracking.

## Background

### V1 surface (already in place — `src/renderer/uikit/Tree/`)

- `TreeProps<T>`:
  - `items: T[] | Traited<unknown[]>`
  - `getChildren?: (source: T) => T[] | undefined` — when omitted, model reads `item.items`
  - `defaultExpandAll?: boolean` / `defaultExpandedValues?: Record<…, boolean>` / `onExpandChange?`
  - `revealItem` (sync) / `expandItem` / `toggleItem` / `expandAll` / `collapseAll`
- `TreeState`:
  - `expanded: Record<value, boolean>` — per-node user expansion
  - `revision: number` — currently declared but never bumped
  - `draggingValue` / `dragOverValue` — DnD V2 (US-488)
- `rows` memo (`TreeModel.ts:144-190`) walks via `getChildren ?? item.items`. When the
  walk yields `undefined`, `hasChildren` is false and the chevron is suppressed.
- `state.use()` in `Tree.tsx:135` is a no-arg subscription — the View already re-renders
  on every state slice (so `loading` will surface automatically).
- `init()` effect (`TreeModel.ts:692-740`) drives `gridRef.update({ all: true })` whenever
  any rendering input changes. New state slices need to land in the deps array of THIS
  effect (not in `rows.deps`).
- `TreeRow<T>` is a "shape" record (item + source + level + expanded + hasChildren + value).
  Per-render flags like `dragging` / `dropActive` are NOT in TreeRow — they are derived at
  render time via `model.isDraggingAt(idx)`. Lazy-loading state will follow the same pattern.
- `revealItem(value, align)` is sync (`TreeModel.ts:667-688`): walks `findAncestorChain`,
  flips `expanded[a] = true` for each ancestor inside one `state.update`, then `setTimeout(0)`
  before `gridRef.scrollToRow`.

### V1 + DnD V2 (US-488) patterns this task will reuse

- **`queueMicrotask` + `if (!this.isLive) return`** — every state.update from a handler is
  deferred past the render phase to avoid React's "setState during render" warning, and
  re-checked for liveness inside the microtask. Pattern: `TreeModel.ts:419-424` (drag start).
- **`dispose()`** — already present (`TreeModel.ts:743-746`); we'll extend it to abort any
  inflight load tracking and clear loading state.
- **Combined state writes** — `onDragStart` writes `draggingValue` in one update, `onDrop`
  clears both drag fields atomically (`TreeModel.ts:494-499`). Same pattern for
  `expanded[v] = true` + `loading[v] = true` in this task.

### Legacy reference (kept until Phase 7 cleanup)

- **`TreeView.model.ts:80-81`** — `getHasChildren?: (item: T) => boolean` predicate. Used in
  `TreeView.tsx:215`: chevron renders when `item.items?.length || getHasChildren?.(item.item)`.
- **`TreeProviderViewModel.tsx:206-235`** — `loadChildrenIfNeeded(href)`:
  1. Find node in source tree.
  2. Skip if `node.items !== undefined` (already loaded; `[]` counts as loaded-empty).
  3. Call `provider.list(listPath)` and await items.
  4. On success: `updateNodeChildren(tree, href, items.map(toNode))` → state.update with new tree.
  5. On error: silently mark as `[]` (loaded-empty). No inline error row.
- **`TreeProviderViewModel.tsx:299-304`** — `onExpandChange(id, expanded)` triggers
  `loadChildrenIfNeeded` only when expanding (not collapsing).
- **`TreeProviderViewModel.tsx:406-437`** — `revealItem(href)` async flow:
  1. Compute ancestor paths via `fpDirname` (string parsing).
  2. `loadChildrenForPaths(allPaths)` — sequential awaits (sorted shortest path first).
  3. `await new Promise(r => setTimeout(r, 0))` — let React re-render.
  4. `treeViewRef.expandItem(p)` for each ancestor — sync now that data is loaded.
  5. Another `setTimeout(0)` — let TreeView re-render expanded rows.
  6. `treeViewRef.scrollToItem(href)`.

The legacy split is "TreeView is dumb about loading; consumer wraps it." V2 inverts that:
the model owns loading state, and the consumer just supplies a `loadChildren` callback. This
mirrors how DnD moved from "consumer rolls its own" (component-level useState) to
"model-owned state."

## Implementation plan

> Each step is self-contained — file paths, exact symbols to add, before → after snippets.
> Steps land in this order; lint and build after step 6.

### Step 1 — Extend `TreeState` and `TreeProps<T>` (`src/renderer/uikit/Tree/types.ts` + `TreeModel.ts`)

**1a. `TreeModel.ts:23-43`** — add `loading` to `TreeState`:

```ts
// before
export interface TreeState {
    expanded: Record<string | number, boolean>;
    revision: number;
    draggingValue: string | number | null;
    dragOverValue: string | number | null;
}

export const defaultTreeState: TreeState = {
    expanded: {},
    revision: 0,
    draggingValue: null,
    dragOverValue: null,
};

// after
export interface TreeState {
    expanded: Record<string | number, boolean>;
    /**
     * Per-source-value loading flag. Set true when `loadChildren` begins, cleared on
     * resolve OR reject. Affects the chevron (replaced by spinner) and `data-loading`
     * on the row; does NOT alter the rows-memo output (a loading row is still in `rows`,
     * just with a spinner where its chevron normally is).
     */
    loading: Record<string | number, boolean>;
    /**
     * Bumped after every successful `loadChildren` resolution to force `rows` memo to
     * re-walk even when the consumer mutated the source tree in place (i.e., `props.items`
     * reference is stable). Also bumped by external `bumpRevision()` if anyone needs it.
     */
    revision: number;
    draggingValue: string | number | null;
    dragOverValue: string | number | null;
}

export const defaultTreeState: TreeState = {
    expanded: {},
    loading: {},
    revision: 0,
    draggingValue: null,
    dragOverValue: null,
};
```

**1b. `types.ts:107-234`** — add lazy-loading props to `TreeProps<T>` (place right after the
existing `keyboardNav` prop, before the DnD section):

```ts
// ── Lazy children loading (US-489) ──────────────────────────────────────────

/**
 * Predicate: "does this row have children, even if `getChildren` would currently return
 * undefined / empty?". When true, the chevron renders, and expanding the row triggers
 * `loadChildren` (when supplied) instead of treating the row as a leaf.
 *
 * Receives the SOURCE item (pre-trait), so consumers can type the predicate against
 * their own shape. When omitted, the row's chevron visibility is decided solely by
 * the children walk.
 */
getHasChildren?: (item: T) => boolean;

/**
 * Async children loader. Called when the user expands a row whose source children are
 * currently unresolved (`getChildren(source)` returns undefined OR an empty array AND
 * `getHasChildren?.(source)` returned true).
 *
 * Contract:
 *   • Resolve after the consumer has updated their source tree to include the children.
 *     The model bumps `state.revision` after the await, forcing the rows memo to re-walk.
 *     Either pass a fresh `items` reference OR mutate the existing tree in place — both
 *     work, because revision is in the rows-memo deps.
 *   • Reject to signal load failure. The model collapses the row, clears the loading
 *     flag, and invokes `onLoadError`. The model does NOT cache failures — re-expand
 *     re-invokes `loadChildren`. Consumers that want to suppress retry must cache or
 *     resolve with an empty children array.
 */
loadChildren?: (source: T) => Promise<void>;

/**
 * Called when `loadChildren` rejects. Default behavior (always applied): the row
 * collapses, `state.loading[value]` clears. This callback only adds consumer-side
 * reaction (e.g. show a notification). Receives the original source `value` (not T)
 * so consumers can correlate against their own data without holding a row reference.
 */
onLoadError?: (value: string | number, error: unknown) => void;

/**
 * Optional async resolver for `revealItem` to walk to a value that is NOT yet present
 * in the loaded source tree. Returns the chain of ancestor values from root to the
 * row's parent (NOT including the target itself), in root → parent order.
 *
 * When `loadChildren` is set:
 *   • If `value` is already loaded — `revealItem` walks the loaded tree, ignores this prop.
 *   • If `value` is NOT loaded AND this prop is set — `revealItem` calls it, then
 *     sequentially expands each returned ancestor (awaiting `loadChildren` per node),
 *     then walks the loaded tree to find `value` and scroll.
 *   • If `value` is NOT loaded AND this prop is unset — `revealItem` no-ops silently
 *     (same as V1 not-found behavior). Consumers that need cross-window deep reveal
 *     are expected to supply this.
 */
getAncestorValues?: (value: string | number) => Promise<(string | number)[]>;
```

**1c. `types.ts:45-70`** (`TreeItemRenderContext<T>`) — add a `loading` flag:

```ts
// after `dropActive?: boolean` line — same convention as dragging/dropActive
/** True when `loadChildren` is currently in flight for this row. Default false. */
loading?: boolean;
```

**1d. `types.ts:76-101`** (`TreeRef`) — change `revealItem` signature to async:

```ts
// before
revealItem: (value: string | number, align?: RowAlign) => void;

// after
/**
 * Expand every ancestor of `value` (awaiting `loadChildren` for any unresolved
 * ancestor when supplied), then scroll the row into view. Returns when the row
 * is visible (or the value is unreachable).
 *
 * Returning Promise — sync callers may ignore the promise. The internal
 * implementation collapses to a fully-sync path when no `loadChildren`/`getAncestorValues`
 * are supplied, so V1 behavior is unchanged for V1 consumers.
 *
 * Reaches not-yet-loaded values only when `getAncestorValues` is provided. Without
 * it, behaves like V1 for already-loaded values and no-ops for unknown values.
 */
revealItem: (value: string | number, align?: RowAlign) => Promise<void>;
```

`TreeRow<T>` is **NOT** extended — `loading` is per-render state, not row shape. Reasoning:
adding it to TreeRow would force `rows` memo to re-walk on every loading toggle, defeating
the point of keeping loading off the rows-deps array.

### Step 2 — Add lazy-load model methods (`TreeModel.ts`)

**2a.** Add a `needsLazyLoad` helper and a private `runLoadAndExpand` method. Place between
the DnD section (ending at the `// --- imperative API ---` comment, around line 535) and
the existing imperative API:

```ts
// --- lazy children loading ---

/**
 * True when the row at `idx` has unresolved children that should be fetched on expand.
 * The condition is: `getChildren(source)` returns undefined / [] AND `getHasChildren?.(source)`
 * is true AND `loadChildren` is set.
 */
private needsLazyLoad = (rowIndex: number): boolean => {
    if (!this.props.loadChildren) return false;
    const r = this.rows.value[rowIndex];
    if (!r) return false;
    if (r.hasChildren) return false; // children already walked
    return !!this.props.getHasChildren?.(r.source);
};

isLoadingAt = (rowIndex: number): boolean => {
    const r = this.rows.value[rowIndex];
    return !!r && !!this.state.get().loading[r.value];
};

/**
 * Run `loadChildren` for a row. Sets expanded=true + loading=true atomically before
 * the await; on resolve clears loading + bumps revision; on reject clears loading +
 * sets expanded=false + invokes `onLoadError`.
 *
 * Re-checks `isLive` at every awaited boundary so an unmount mid-load is safe.
 */
private runLoadAndExpand = async (r: TreeRow<T>): Promise<void> => {
    const loader = this.props.loadChildren;
    if (!loader) return;
    const v = r.value;

    queueMicrotask(() => {
        if (!this.isLive) return;
        this.state.update((s) => {
            s.expanded[v] = true;
            s.loading[v] = true;
        });
        this.props.onExpandChange?.(v, true);
        this.gridRef?.update({ all: true });
    });

    try {
        await loader(r.source);
    } catch (err) {
        if (!this.isLive) return;
        queueMicrotask(() => {
            if (!this.isLive) return;
            this.state.update((s) => {
                s.loading[v] = false;
                s.expanded[v] = false;
            });
            this.props.onExpandChange?.(v, false);
            this.gridRef?.update({ all: true });
        });
        this.props.onLoadError?.(v, err);
        return;
    }
    if (!this.isLive) return;
    queueMicrotask(() => {
        if (!this.isLive) return;
        this.state.update((s) => {
            s.loading[v] = false;
            s.revision += 1;
        });
        this.gridRef?.update({ all: true });
    });
};
```

**2b. Extend `toggleAt`** (`TreeModel.ts:537-554`) to dispatch lazy load when needed:

```ts
// before
toggleAt = (rowIndex: number) => {
    const r = this.rows.value[rowIndex];
    if (!r || !r.hasChildren) return;
    const next = !r.expanded;
    queueMicrotask(() => {
        if (!this.isLive) return;
        this.state.update((s) => {
            s.expanded[r.value] = next;
        });
        this.props.onExpandChange?.(r.value, next);
        this.gridRef?.update({ all: true });
    });
};

// after
toggleAt = (rowIndex: number) => {
    const r = this.rows.value[rowIndex];
    if (!r) return;
    const lazyExpand = !r.hasChildren && this.needsLazyLoad(rowIndex);
    if (!r.hasChildren && !lazyExpand) return;

    // Already loading? Ignore re-toggles during an inflight load — the user must wait
    // for resolution before collapsing. Avoids a race where collapse-then-resolve
    // expands a row the user explicitly closed.
    if (this.state.get().loading[r.value]) return;

    if (lazyExpand && !r.expanded) {
        // Lazy expand path — sets expanded=true atomically with loading=true.
        void this.runLoadAndExpand(r);
        return;
    }

    const next = !r.expanded;
    queueMicrotask(() => {
        if (!this.isLive) return;
        this.state.update((s) => {
            s.expanded[r.value] = next;
        });
        this.props.onExpandChange?.(r.value, next);
        this.gridRef?.update({ all: true });
    });
};
```

**2c. `expandItem`** (`TreeModel.ts:556-562`) — already calls `toggleAt`; works as-is.

**2d. `expandAll`** (`TreeModel.ts:569-593`) — keep current behavior (walks the source tree
and only expands nodes whose `children.length > 0`). Lazy nodes are skipped — same as legacy
`TreeProviderViewModel`'s expand-all-loaded behavior. Document this in the JSDoc:

```ts
/**
 * Expand every node that currently has loaded children. Lazy/unloaded nodes are NOT
 * traversed — `loadChildren` is fired-and-awaited only via user expansion or via
 * `revealItem`. Consumers that want to fully unfold a lazy tree must walk and
 * `revealItem` each leaf themselves.
 */
expandAll = () => { /* existing body unchanged */ };
```

### Step 3 — Async `revealItem` (`TreeModel.ts:667-688`)

Replace the sync body with an async one that sequentially expands ancestors, awaiting
`loadChildren` where applicable, then scrolls. Falls back to V1 sync behavior when no
loader is configured:

```ts
revealItem = async (value: string | number, align?: RowAlign): Promise<void> => {
    // Fast path 1 — already-visible value: just scroll. Saves the rest of the work
    // when the row is already in the loaded + expanded set.
    if (this.indexByValue.value.has(value) && this.findAncestorChain(value)?.every(
        (a) => this.state.get().expanded[a],
    )) {
        const idx = this.indexByValue.value.get(value);
        if (idx != null) this.gridRef?.scrollToRow(idx, align ?? "nearest");
        return;
    }

    // Fast path 2 — value loaded but ancestors collapsed: sync expand all + scroll.
    let chain = this.findAncestorChain(value);
    if (chain != null) {
        await this.expandAncestorsThenScroll(chain, value, align);
        return;
    }

    // Slow path — value not yet loaded. Defer to consumer-supplied resolver.
    const resolver = this.props.getAncestorValues;
    if (!resolver) return; // legacy not-found semantics: silent no-op.

    let ancestors: (string | number)[];
    try {
        ancestors = await resolver(value);
    } catch {
        return;
    }
    if (!this.isLive) return;

    // Sequentially expand each ancestor — for any that is unloaded, runLoadAndExpand
    // resolves only after children land. Then walk the next.
    for (const a of ancestors) {
        const idx = this.indexByValue.value.get(a);
        if (idx == null) return; // chain is broken — bail.
        const row = this.rows.value[idx];
        if (!row) return;
        if (row.expanded) continue;

        if (this.needsLazyLoad(idx)) {
            await this.runLoadAndExpand(row);
        } else if (row.hasChildren) {
            this.toggleAt(idx);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        if (!this.isLive) return;
    }

    // Final ancestor pass + scroll, now that loaded + expanded.
    chain = this.findAncestorChain(value);
    if (chain == null) return;
    await this.expandAncestorsThenScroll(chain, value, align);
};

/**
 * Internal: ensure all ancestors in `chain` are expanded, then scroll to `value`.
 * Used by both fast paths in revealItem; collapses to one queued state update
 * for the "all already loaded" case, mirroring V1.
 */
private expandAncestorsThenScroll = async (
    chain: (string | number)[],
    value: string | number,
    align?: RowAlign,
): Promise<void> => {
    if (chain.length > 0) {
        const expanded = this.state.get().expanded;
        const needsExpand = chain.some((a) => !expanded[a]);
        if (needsExpand) {
            await new Promise<void>((resolve) => {
                queueMicrotask(() => {
                    if (!this.isLive) return resolve();
                    this.state.update((s) => {
                        for (const a of chain) s.expanded[a] = true;
                    });
                    this.gridRef?.update({ all: true });
                    setTimeout(resolve, 0);
                });
            });
        }
    }
    if (!this.isLive) return;
    const idx = this.indexByValue.value.get(value);
    if (idx != null) this.gridRef?.scrollToRow(idx, align ?? "nearest");
};
```

### Step 4 — `rows` memo deps + `init()` effect deps (`TreeModel.ts:144-190` and `692-712`)

**4a.** Add `state.revision` to the `rows` memo's deps factory so re-walks fire after
`runLoadAndExpand` bumps revision (covers consumers that mutate the source tree in place):

```ts
// rows memo deps factory — before
() => [
    this.props.items,
    this.props.getChildren,
    this.props.defaultExpandAll,
    this.props.defaultExpandedValues,
    this.state.get().expanded,
],

// after
() => [
    this.props.items,
    this.props.getChildren,
    this.props.defaultExpandAll,
    this.props.defaultExpandedValues,
    this.state.get().expanded,
    this.state.get().revision,
],
```

**4b.** Add `state.loading` to the `init()` effect deps array (the one ending around line
712, which already includes `draggingValue` / `dragOverValue`):

```ts
// after dragOverValue line — same shape as the DnD entries
this.state.get().loading,
```

This ensures the View re-runs `gridRef.update({ all: true })` when any row's loading flag
flips, so the chevron-vs-spinner swap is visible immediately.

### Step 5 — Default row chevron-to-spinner swap (`TreeItem.tsx`)

**5a.** Extend `TreeItemProps` (`TreeItem.tsx:11-49`) with a `loading` prop:

```ts
// after `dropActive?: boolean` line
/** True when `loadChildren` is currently in flight for this row. Default false. */
loading?: boolean;
```

**5b.** Add an Emotion rule for `data-loading`. Keep the chevron-shaped slot but render a
Spinner instead. Add to the `Root` styled definition's selector block (after
`&[data-drop-active]`):

```ts
"&[data-loading]": {
    // No background — only the chevron swap is visually distinct. Cursor stays default
    // (pointer is fine — clicking again is a no-op via toggleAt's loading-guard).
},
```

**5c.** Destructure the new prop and project it as a `data-*` attribute. Replace the
chevron-or-stub branch with a three-way switch (loading > hasChildren > stub):

```tsx
// before — TreeItem.tsx:152-217 — the chevron branch:
{hasChildren ? (
    <Chevron
        size={indentSize}
        type="button"
        tabIndex={-1}
        aria-label={expanded ? "Collapse" : "Expand"}
        onClick={onChevronClick}
    >
        {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
    </Chevron>
) : (
    <ChevronStub size={indentSize} />
)}

// after
{loading ? (
    <ChevronStub size={indentSize} aria-label="Loading">
        <Spinner size={12} />
    </ChevronStub>
) : hasChildren ? (
    <Chevron
        size={indentSize}
        type="button"
        tabIndex={-1}
        aria-label={expanded ? "Collapse" : "Expand"}
        onClick={onChevronClick}
    >
        {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
    </Chevron>
) : (
    <ChevronStub size={indentSize} />
)}
```

`ChevronStub` is currently a leaf `div` (`TreeItem.tsx:139-146`). Update it to accept
children and align them centered (mirrors `Chevron`'s flex layout):

```ts
const ChevronStub = styled.div<{ size: number }>(
    ({ size }) => ({
        width: size,
        height: size,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    }),
    { label: "TreeItemChevronStub" },
);
```

**5d.** Project `data-loading` on the `Root` element, just after `data-drop-active`:

```tsx
data-loading={loading || undefined}
```

**5e.** Add the `Spinner` import at the top of `TreeItem.tsx`:

```ts
import { Spinner } from "../Spinner";
```

### Step 6 — View wiring (`Tree.tsx:142-222`)

**6a.** Compute `loading` once per cell and forward it to both branches:

```tsx
// inside renderCell, after the existing `dropActive` line:
const loading = model.isLoadingAt(idx);
```

**6b.** Pass `loading` to default `<TreeItem>`:

```tsx
// add after dropActive prop, before disabled:
loading={loading}
```

**6c.** Pass `loading` to custom `renderItem` ctx:

```tsx
// add after dropActive in the ctx object:
loading,
```

No changes to the `state.use()` call — V1 already subscribes to all state slices.

### Step 7 — Story demo (`Tree.story.tsx`)

Add a `lazy` toggle that simulates async children with a 400ms delay. Source tree starts
with directories that have `items: undefined` (unloaded); on expand, children get attached.

**7a.** Define a separate "lazy tree" data set near `REGULAR_TREE` / `SECTIONED_TREE`. Use
a closure-over-mutable structure so the same data refs survive across React renders:

```ts
// New top-level — mutable lazy tree. Children of "lazy/dirA" / "lazy/dirB" / etc. are
// initially undefined; `lazyLoad` populates them in place. Subsequent reveals re-use
// the loaded subtree (the demo does NOT re-fetch).
type LazyItem = ITreeItem & { items?: LazyItem[] };

function makeLazyTree(): LazyItem[] {
    const subFiles = (parent: string): LazyItem[] => [
        leaf(`${parent}/file1.ts`, "file1.ts"),
        leaf(`${parent}/file2.ts`, "file2.ts"),
        leaf(`${parent}/README.md`, "README.md"),
    ];
    return [
        { value: "lazy/dirA", label: "dirA", icon: <FolderIcon />, items: undefined,
          // closure: when expanded, lazyLoad attaches subFiles("lazy/dirA")
        },
        { value: "lazy/dirB", label: "dirB", icon: <FolderIcon />, items: undefined },
        { value: "lazy/dirC", label: "dirC (deeper)", icon: <FolderIcon />, items: undefined },
        leaf("lazy/standalone.txt", "standalone.txt"),
    ];
}

// Tracker for "what should dirC's children be after first load" — reuses subFiles +
// adds another lazy directory below to demo nested lazy:
const LAZY_NESTED_CHILDREN: Record<string, LazyItem[]> = {
    "lazy/dirA": [
        { value: "lazy/dirA/file1.ts", label: "file1.ts" },
        { value: "lazy/dirA/file2.ts", label: "file2.ts" },
        { value: "lazy/dirA/README.md", label: "README.md" },
    ],
    "lazy/dirB": [
        { value: "lazy/dirB/notes.md", label: "notes.md" },
    ],
    "lazy/dirC": [
        { value: "lazy/dirC/inner", label: "inner", icon: <FolderIcon />, items: undefined },
        { value: "lazy/dirC/x.ts", label: "x.ts" },
    ],
    "lazy/dirC/inner": [
        { value: "lazy/dirC/inner/deep.ts", label: "deep.ts" },
    ],
};
```

**7b.** In `TreeDemo`, when `lazy` flag is true, swap `items` to a stateful copy of the
lazy tree, define `getHasChildren` + `loadChildren` + a counter to force re-render:

```ts
const [lazyTree, setLazyTree] = useState<LazyItem[] | null>(null);
useEffect(() => {
    setLazyTree(lazy ? makeLazyTree() : null);
}, [lazy]);

const getHasChildren = lazy
    ? (it: ITreeItem) =>
        typeof it.value === "string" && LAZY_NESTED_CHILDREN[it.value] !== undefined
    : undefined;

const loadChildren = lazy
    ? async (source: ITreeItem) => {
        await new Promise((r) => setTimeout(r, 400));
        const v = source.value as string;
        const children = LAZY_NESTED_CHILDREN[v];
        if (!children) return; // no children to attach
        // Mutate IN PLACE — model bumps revision after resolve, forcing rows re-walk.
        (source as LazyItem).items = children.map((c) => ({ ...c }));
    }
    : undefined;
```

**7c.** Pass props on `<Tree>`. When `lazy`, use `lazyTree ?? []` for `items`:

```tsx
items={lazy ? (lazyTree ?? []) : items}
getHasChildren={getHasChildren}
loadChildren={loadChildren}
onLoadError={lazy ? (v, err) => console.warn("[Tree lazy demo] load error", v, err) : undefined}
```

**7d.** Add the toggle to the props array:

```ts
{ name: "lazy", type: "boolean", default: false },
```

### Step 8 — Verify lint + storybook

Run `npm run lint`. Open the storybook entry, toggle `lazy`, expand `dirA` / `dirB` / `dirC` / `dirC > inner` and verify:

- 400ms spinner replaces the chevron.
- After resolve, children render and the chevron returns (down-pointing).
- Re-collapse + re-expand fires `loadChildren` again (no caching in demo).
- Reveal a deep value (use the existing "Reveal Tree.tsx" button modified to target a
  lazy-only path when `lazy=true`) — verifies the slow-path branch resolves the chain
  via repeated lazy loads when `getAncestorValues` is supplied. (Optional in story; the
  primary smoke test is expand-collapse-expand.)

## Concerns

All concerns resolved before implementation begins.

### 1. **`getHasChildren` predicate vs `ITreeItem.hasChildren` flag**

Use the predicate (`getHasChildren?: (item: T) => boolean`). Reasons:
- Matches the legacy V1 surface (`TreeView.model.ts:80-81`) — easier migration.
- Doesn't pollute `ITreeItem` with a flag whose primary use case is "I have children but
  haven't loaded them"; that's a behavioral shape, not a data shape.
- Receives source `T` directly — works without trait wrapping.

### 2. **Loading state shape — `Set<value>` or `Record<value, boolean>`?**

`Record<string | number, boolean>`. Mirrors `expanded`, immer-friendly (Set requires
`new Set()` clones during update — Record is just a property assignment). Lookups are
O(1) via `state.loading[v]`.

### 3. **Source tree mutation contract**

Consumers MAY mutate the source tree in place during `loadChildren`. The model bumps
`state.revision` after resolve and includes it in `rows.deps`, so the memo re-walks even
when `props.items` reference is stable. Alternatively, consumers can pass a fresh `items`
prop each render — both contracts work. Documented on the `loadChildren` prop.

### 4. **Loading icon — replace chevron, overlay it, or render alongside?**

Replace the chevron entirely with a 12px Spinner inside the `ChevronStub` slot (same width
as the chevron button, no layout shift). The row stays expanded visually; the user sees
"the chevron is busy" and the children area below is empty until resolve.

Rationale: overlay would require absolute positioning + alpha blending; alongside would
shift the label rightward. Replacement keeps the layout invariant.

### 5. **Concurrent expand/collapse races during load**

Three races, all resolved:

- **User clicks chevron during load** — `toggleAt` early-returns when
  `state.loading[r.value]` is true. The user must wait for resolve before collapsing.
  This avoids "user collapses → load resolves → row pops back open."
- **Load rejects after user collapses** — guarded against by the previous rule:
  collapse can't happen during load.
- **Re-expand after rejection** — re-invokes `loadChildren`. Consumer is responsible for
  caching to suppress retry. Documented on the `loadChildren` prop.

### 6. **What `expandAll()` does on a lazy tree**

Same as legacy: walks the SOURCE tree and only adds `expanded[v] = true` for nodes whose
`getChildren(source).length > 0`. Lazy/unloaded nodes are skipped. Documented on
`expandAll`'s JSDoc.

Alternative considered: have `expandAll()` recursively trigger `loadChildren` for every
unresolved row. Rejected — would fan out unbounded async work, often N+1 calls; consumers
that want a fully-unfolded lazy tree should pre-seed their data, not coerce the model.

### 7. **`revealItem` signature change — Promise vs sync**

Change to `Promise<void>` rather than adding a parallel `revealItemAsync`. Reasons:
- Sync callers (V1) can ignore the return — `treeRef.current?.revealItem(v)` still works.
- Single API surface — no naming bikeshed (`revealItemSync` vs `revealItemAsync`).
- Aligns with how `runLoadAndExpand` and the slow-path slot in revealItem must compose.

The placeholder open-question on this is now decided: **single async signature**.

### 8. **Reveal of a not-yet-loaded value — `getAncestorValues`**

Accept the design from the placeholder + flesh it out: optional `getAncestorValues?:
(value) => Promise<(string | number)[]>` resolver. When present and the value is not yet
in the loaded tree, revealItem walks the consumer-returned chain and lazy-loads each
ancestor sequentially.

When unset and the value is unknown, revealItem no-ops silently — same as V1's missing-
value behavior. This is intentional: requiring all consumers to supply a resolver would
break V1 backwards compat.

### 9. **`onLoadError` signature — value or T?**

`(value: string | number, error: unknown) => void` — value-typed. Reasons:
- Consumers correlate loading state via value (same as `expanded` map keys).
- Avoids forcing the consumer to remember the source row mid-error-handling.
- Mirrors `onExpandChange?: (value, expanded)` shape.

### 10. **Inline error row — render or skip?**

Skip. The legacy `TreeProviderViewModel` silently marks failed loads as `[]` and shows no
inline error. Matching this keeps the model unopinionated. Consumers that want an inline
error row can mutate their source tree to insert a synthetic "error" item inside their
own `loadChildren` catch block.

### 11. **Loading state placement — `TreeRow` or derived per-render?**

Derived. `loading` is a per-render decoration like `dragging` / `dropActive`, not row
shape. Adding it to `TreeRow` would force `rows` memo to re-walk on every loading flip —
exactly what we want to avoid. Pattern matches DnD V2.

### 12. **`runLoadAndExpand` re-entrancy on rapid double-expand**

Guarded by the `state.loading[v]` early-return in `toggleAt`. Even if the user clicks the
chevron 5x in 200ms, only the first click triggers `runLoadAndExpand`; the others
short-circuit. After resolve, the row is expanded — subsequent clicks would be collapse
operations, which work normally.

### 13. **Hover-expand during DnD on a lazy folder**

The DnD `scheduleHoverExpand` (US-488) calls `toggleAt(idx)` after a 500ms hover. With
this task, that call now triggers `runLoadAndExpand` for lazy folders. Drop is always on
the visible target row — children-loaded-or-not. Consumer's `canTraitDrop`/`onTraitDrop`
decides what to do if the user drops mid-load. No special handling needed in this task.

### 14. **`state.revision` reused for lazy + future**

The `revision` field was declared but never bumped in V1. We co-opt it for lazy load
re-walks. If a future task needs another "force re-walk" trigger, it can also bump
revision — additive semantics. Documented on the field.

### 15. **`Spinner` import path inside `TreeItem.tsx`**

`import { Spinner } from "../Spinner"` — same pattern as `Tree.tsx:12`. The Spinner
component (`src/renderer/uikit/Spinner/Spinner.tsx`) accepts `size` (number, px) and
inherits color via `currentColor` — fits the chevron color slot perfectly without an
explicit color override.

### 16. **`data-loading` semantics**

Render `data-loading={loading || undefined}` on the row root, mirroring the
`data-dragging` / `data-drop-active` convention. This lets consumers select the loading
row in DevTools / agent scripts via `[data-type="tree-item"][data-loading]`. The Emotion
rules block stays empty for now (no visual change beyond the chevron swap), but the hook
is in place for a future "dim row during load" style.

### 17. **Backwards compatibility**

All new props optional. Behavior when neither `getHasChildren` nor `loadChildren` are
set: identical to V1 — no chevron for rows without children, no loading state, sync
revealItem path (revealItem still returns Promise but resolves on the same tick when no
async work is needed). V1 consumers see no change.

### 18. **Tree.story.tsx demo — independent state vs shared**

`lazyTree` is a separate `useState`-backed mutable structure (created via
`makeLazyTree()` on lazy-toggle), not a transformation of `REGULAR_TREE`. Reason:
- Lazy demo mutates the tree (attaches children); REGULAR_TREE is a module-level constant.
- Toggling `lazy` off should reset the demo to fresh unloaded folders — plain `useEffect`
  on the `lazy` flag handles this.

The non-lazy storybook flow remains unchanged when `lazy=false`.

## Acceptance criteria

- [ ] `TreeProps<T>` exposes `getHasChildren`, `loadChildren`, `onLoadError`, and
  `getAncestorValues` — all optional.
- [ ] `TreeState` carries a `loading: Record<value, boolean>` slice; `revision` bumps
  after every successful `loadChildren`.
- [ ] When `getHasChildren?.(source)` returns true on a row with no walked children, the
  chevron renders.
- [ ] Clicking the chevron of such a row triggers `loadChildren(source)`. While the
  promise is pending, the chevron is replaced by a 12px `Spinner` and the row carries
  `data-loading` on its root element.
- [ ] On resolve, the spinner is replaced by the (down-pointing) chevron, and children
  render under the row.
- [ ] On reject, the spinner is replaced by the right-pointing chevron (collapsed), and
  `onLoadError(value, err)` fires.
- [ ] Re-clicking the chevron during load is a no-op (`toggleAt` early-returns).
- [ ] `revealItem(value)` returns a Promise. For an already-loaded value behaves like V1
  (sync expand + scroll). For a not-yet-loaded value with `getAncestorValues` supplied,
  walks ancestors with sequential lazy loads, then scrolls.
- [ ] `expandAll` does NOT trigger lazy loads (only walks loaded subtrees).
- [ ] `dispose()` clears the loading map / aborts any pending state writes (via
  `isLive` checks).
- [ ] Lint passes for the changed Tree files.
- [ ] Story `lazy` toggle demos: expand a folder → 400ms spinner → children appear; nested
  lazy folder works; collapse + re-expand re-fetches.
- [ ] Existing V1 storybook flows (`searchText`, `keyboardNav`, `customRow`, `tooltip`,
  `contextMenu`, `predicateSelection`, `sections`, `defaultExpandAll`, `dnd`) unchanged.

## Files Changed

| File | Change |
|------|--------|
| `doc/tasks/US-489-uikit-tree-lazy-load/README.md` | **Rewritten** from placeholder to full task doc. |
| `src/renderer/uikit/Tree/types.ts` | Add 4 props (`getHasChildren`, `loadChildren`, `onLoadError`, `getAncestorValues`); add `loading` field to `TreeItemRenderContext`; change `TreeRef.revealItem` to async. |
| `src/renderer/uikit/Tree/TreeModel.ts` | Add `loading` to `TreeState`; add `needsLazyLoad`, `isLoadingAt`, `runLoadAndExpand`; extend `toggleAt`; rewrite `revealItem` async; add `state.revision` to rows-memo deps and `state.loading` to init-effect deps. |
| `src/renderer/uikit/Tree/TreeItem.tsx` | Add `loading` prop; render `<Spinner size={12}>` inside `ChevronStub` when loading; project `data-loading`; import Spinner; allow ChevronStub to render children. |
| `src/renderer/uikit/Tree/Tree.tsx` | Compute `loading = model.isLoadingAt(idx)` per cell; forward to default `<TreeItem>` and to `renderItem(ctx)`. |
| `src/renderer/uikit/Tree/Tree.story.tsx` | Add `lazy` boolean prop; new `makeLazyTree` + `LAZY_NESTED_CHILDREN` map; mutate-in-place async `loadChildren`; wire `getHasChildren` / `loadChildren` / `onLoadError`. |

## Files NOT changed

| File | Why |
|------|-----|
| `src/renderer/uikit/Tree/SectionItem.tsx` | Section rows never lazy-load — they're non-interactive headers. |
| `src/renderer/uikit/Tree/index.ts` | Existing re-exports cover the additive types via `export type * from "./Tree"`. |
| `src/renderer/uikit/index.ts` | Same — no new top-level exports needed. |
| `src/renderer/uikit/Spinner/*` | Component already complete (used in Tree's loading-state surface today). |
| `src/renderer/components/TreeView/*` | Legacy. Out of scope; deleted in EPIC-025 Phase 7 cleanup. |
| `src/renderer/components/tree-provider/*` | Out of scope. The TreeProviderView migration to UIKit Tree is a separate follow-up task (tracked under "Future migration tasks" below). |
| `src/renderer/core/state/model.ts` | `TComponentModel` already provides `isLive`, `dispose`, `effect`, `memo` — pattern reused as-is. |
| `src/renderer/core/traits/*` | Trait DnD already complete from US-488. |

## Dependencies

- **Blocked on:** [US-485](../US-485-uikit-tree/README.md) — UIKit Tree V1. ✅ landed.
- **Coordinates with:** [US-488](../US-488-uikit-tree-dnd/README.md) — DnD V2. ✅ landed.
  Hover-expand during drag uses `toggleAt`, which now dispatches lazy loads — handled
  transparently; no shared API surface.

## Future migration tasks (not this task)

- **TreeProviderView migration** — replace `src/renderer/components/TreeView` usage in
  `TreeProviderViewModel` with UIKit Tree, using `loadChildren` / `getHasChildren` /
  `getAncestorValues` (the consumer already computes ancestor paths via `fpDirname`).
  Covers sidebar / browser security panel / archive browser. Tracked separately when this
  task lands.
