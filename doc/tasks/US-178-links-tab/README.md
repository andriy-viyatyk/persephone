# US-178: Detail Panel — Links Tab (AVGrid)

**Epic:** EPIC-006 (Force Graph Editor)
**Status:** Done

## Goal

Add a "Links" tab to the graph detail panel that shows all nodes connected to the selected node in an AVGrid. The grid supports batch editing with an **Apply** button — users can edit properties, add new linked nodes (including paste from Excel), and remove links, then commit all changes at once.

## Background

### Existing panel structure

`GraphDetailPanel.tsx` has a tab shell with three tabs: Info (active), Links (disabled), Properties (disabled). The body renders inside a resizable overlay with fixed width/height.

### AVGrid capabilities (relevant subset)

- **Column type** (`avGridTypes.ts`): `Column<R>` with `key`, `name`, `width`, `resizible`, `options`, `dataType`
- **Combobox editor**: Triggered when `column.options` is defined. Uses `ComboSelect` component automatically via `DefaultEditFormater.tsx`. No built-in validation — `editRow` callback must handle invalid values.
- **Cell editing**: `editRow(columnKey, rowKey, value)` callback per cell.
- **Add rows**: `onAddRows(count, insertIndex?) => R[]` — must return new row objects. Shows "+ add {entity}" button at bottom.
- **Delete rows**: `onDeleteRows(rowKeys[])` — called on Ctrl+Delete or context menu.
- **Paste from clipboard**: `CopyPasteModel` parses tab-separated data from Excel. Creates new rows via `onAddRows` if pasting beyond grid bounds. Calls `editRow` per cell.
- **Entity label**: `entity="link"` changes "+ add row" to "+ add link".
- **Row height**: `rowHeight` prop, default ~28px.
- **No built-in batch mode** — we manage local state in the component.

### GraphNode custom properties

`GraphNode` has known keys: `id`, `title`, `level`, `shape`, plus runtime `_$showIndex`, `_$hiddenCount` and D3 simulation keys (`x`, `y`, `vx`, `vy`, `fx`, `fy`, `index`). Any other key is a "custom property" (user-defined).

### ViewModel link access

- `getNeighborIdsFromSource(nodeId)` — returns IDs of all connected nodes (private)
- `sourceData.nodes` — full node list (private)
- Editing: `updateNodeProps(nodeId, props)` works for any node
- Links: `addLink(sourceId, targetId)`, `deleteLink(sourceId, targetId)`

### Edit pattern

All edits go through: mutate `sourceData` → `rebuildAndRender()` → `serializeToHost()` → `refreshSelectedNode()`.

## Key Design: Batch Editing with Apply

The Links tab operates on a **local copy** of linked nodes data. User edits modify local state only. Changes are committed when the user clicks **Apply**.

### Why batch mode?

The primary use case is **bulk graph creation via Excel paste**:
1. User creates a root node via "Add Node"
2. Selects the root, opens Links tab
3. Pastes children from Excel (id column, or id + title + properties)
4. Clicks Apply — all nodes and links are created at once
5. Selects next node, pastes its children, Apply, repeat...

Live editing would be problematic: each pasted cell triggers `editRow`, and creating nodes mid-paste would cause cascading rebuilds.

### Apply diff logic

When user clicks Apply, compare local rows vs original linked nodes:

1. **Deleted rows** (in original, not in local): remove link; if the linked node has no other connections after removal, delete the node too (prevents orphans)
2. **New rows** (in local, not in original): if node with that ID exists → add link; if not → create new node + add link
3. **Modified rows** (same ID, different properties): update node properties (title, level, shape, custom props)
4. **ID is a link reference**: the `id` column in this grid represents which node is linked. We do NOT rename nodes from here — if user changes an ID cell, it means "unlink old, link new" (or create new if not exists).

## Implementation Plan

### Step 1: Add linked nodes to GraphViewState

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

Add `linkedNodes` to state:

```typescript
const defaultGraphViewState = {
    // ... existing fields
    linkedNodes: [] as GraphNode[],
};
```

Add helper to compute clean linked nodes (strips `_$*` and D3 simulation keys):

```typescript
/** Keys added by D3 simulation — not part of user data. */
const SIM_KEYS = new Set(["x", "y", "vx", "vy", "fx", "fy", "index"]);

/** Strip _$ runtime and D3 simulation properties, return clean copy. */
private cleanNode(node: GraphNode): GraphNode {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
        if (!key.startsWith(SYS_PREFIX) && !SIM_KEYS.has(key)) {
            clean[key] = value;
        }
    }
    return clean as GraphNode;
}

private computeLinkedNodes(nodeId: string): GraphNode[] {
    if (!this.sourceData || !nodeId) return [];
    const neighborIds = new Set(this.getNeighborIdsFromSource(nodeId));
    return this.sourceData.nodes
        .filter((n) => neighborIds.has(n.id))
        .map((n) => this.cleanNode(n));
}
```

Update `handleSelectionChanged` — add `linkedNodes` alongside `selectedNode`:
```typescript
private handleSelectionChanged(nodeId: string): void {
    this.state.update((s) => {
        if (!nodeId) {
            s.selectedNode = null;
            s.linkedNodes = [];
        } else {
            const node = this.sourceData?.nodes.find((n) => n.id === nodeId);
            s.selectedNode = node ? { ...node } : null;
            s.linkedNodes = this.computeLinkedNodes(nodeId);
        }
    });
}
```

Update `refreshSelectedNode` — also recompute `linkedNodes`:
```typescript
private refreshSelectedNode(): void {
    const selectedId = this.renderer.selectedId;
    if (!selectedId) return;
    this.state.update((s) => {
        const node = this.sourceData?.nodes.find((n) => n.id === selectedId);
        s.selectedNode = node ? { ...node } : null;
        s.linkedNodes = this.computeLinkedNodes(selectedId);
    });
}
```

Import `SYS_PREFIX` from `./types`.

### Step 2: Add batch apply method to ViewModel

**File:** `src/renderer/editors/graph/GraphViewModel.ts`

```typescript
/**
 * Apply batch changes from the Links tab grid.
 * @param selectedNodeId — the currently selected node (parent)
 * @param rows — grid rows after user edits (each has at least `id`)
 * @param originalIds — set of IDs that were in the grid when it was loaded
 */
applyLinkedNodesUpdate(
    selectedNodeId: string,
    rows: Record<string, unknown>[],
    originalIds: Set<string>,
): void {
    if (!this.sourceData) return;

    const currentIds = new Set(rows.map((r) => r.id as string).filter(Boolean));

    // 1. Removed rows: in original but not in current
    for (const oldId of originalIds) {
        if (!currentIds.has(oldId)) {
            this.removeLinkSmart(selectedNodeId, oldId);
        }
    }

    // 2. New + modified rows
    for (const row of rows) {
        const id = (row.id as string)?.trim();
        if (!id) continue;

        if (!originalIds.has(id)) {
            // New row — create node if needed, add link
            if (!this.sourceData.nodes.some((n) => n.id === id)) {
                this.sourceData.nodes.push({ id });
            }
            if (!this.linkExists(selectedNodeId, id) && selectedNodeId !== id) {
                this.sourceData.links.push({ source: selectedNodeId, target: id });
            }
        }

        // Update properties (for both new and existing)
        const node = this.sourceData.nodes.find((n) => n.id === id);
        if (node) {
            this.applyRowPropsToNode(node, row);
        }
    }

    // 3. Rebuild
    this.rebuildAndRender();
    this.serializeToHost();
    this.refreshSelectedNode();
}

/**
 * Smart link removal:
 * - Always removes the link between aId and bId
 * - If bId has no other links after removal, also deletes the node
 */
private removeLinkSmart(aId: string, bId: string): void {
    if (!this.sourceData) return;

    // Remove the link
    this.sourceData.links = this.sourceData.links.filter((link) => {
        const { source, target } = linkIds(link);
        return !(
            (source === aId && target === bId) ||
            (source === bId && target === aId)
        );
    });

    // Check if bId has any remaining links
    const hasOtherLinks = this.sourceData.links.some((link) => {
        const { source, target } = linkIds(link);
        return source === bId || target === bId;
    });

    // If orphaned, delete the node too
    if (!hasOtherLinks) {
        this.sourceData.nodes = this.sourceData.nodes.filter((n) => n.id !== bId);
    }
}

/** Apply row properties to a node, skipping 'id' and empty values. */
private applyRowPropsToNode(node: GraphNode, row: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(row)) {
        if (key === "id") continue;
        if (value === undefined || value === null || value === "") {
            delete (node as any)[key];
        } else {
            (node as any)[key] = value;
        }
    }
}
```

### Step 3: Create LinksTab component

**File:** `src/renderer/editors/graph/GraphDetailPanel.tsx` (add inside same file)

**New imports needed at top of file:**
```typescript
import { AVGrid } from "../../components/data-grid/AVGrid/AVGrid";
import type { Column } from "../../components/data-grid/AVGrid/avGridTypes";
```

**LinksTab props:**

```typescript
interface LinksTabProps {
    linkedNodes: GraphNode[];
    selectedNodeId: string;
    onApply: (selectedNodeId: string, rows: Record<string, unknown>[], originalIds: Set<string>) => void;
}
```

**Row type:**

```typescript
type LinkRow = Record<string, unknown> & { id: string; _rowKey: string };
```

The `_rowKey` is a stable internal key for AVGrid's `getRowKey`. We need this because `id` is editable — if user changes the id value, the row key must remain stable. Generate with a counter: `link-1`, `link-2`, etc.

**Local state:**

```typescript
const [rows, setRows] = useState<LinkRow[]>([]);
const [columns, setColumns] = useState<Column<LinkRow>[]>([]);
const [activePreset, setActivePreset] = useState<"default" | "view" | "custom">("default");
const [dirty, setDirty] = useState(false);
const originalIdsRef = useRef<Set<string>>(new Set());
const rowCounterRef = useRef(0);
```

Initialize from `linkedNodes` prop:
```typescript
useEffect(() => {
    const mapped = linkedNodes.map((n) => ({
        ...n,
        _rowKey: `link-${++rowCounterRef.current}`,
    }));
    setRows(mapped);
    setDirty(false);
    originalIdsRef.current = new Set(linkedNodes.map((n) => n.id));
}, [linkedNodes]); // resets when selection changes or after Apply
```

**AVGrid callbacks:**

```typescript
const editRow = useCallback((columnKey: string, rowKey: string, value: any) => {
    // Validate level and shape
    if (columnKey === "level") {
        const num = Number(value);
        value = (num >= 1 && num <= 5) ? num : 5;
    }
    if (columnKey === "shape") {
        const shapes = ["circle", "square", "diamond", "triangle", "star", "hexagon"];
        if (!shapes.includes(value)) value = "circle";
    }

    setRows((prev) => prev.map((r) =>
        r._rowKey === rowKey ? { ...r, [columnKey]: value } : r
    ));
    setDirty(true);
}, []);

const onAddRows = useCallback((count: number, insertIndex?: number) => {
    const newRows: LinkRow[] = Array.from({ length: count }, () => ({
        id: "",
        _rowKey: `link-${++rowCounterRef.current}`,
    }));
    setRows((prev) => {
        if (insertIndex !== undefined) {
            const copy = [...prev];
            copy.splice(insertIndex, 0, ...newRows);
            return copy;
        }
        return [...prev, ...newRows];
    });
    setDirty(true);
    return newRows;
}, []);

const onDeleteRows = useCallback((rowKeys: string[]) => {
    const keySet = new Set(rowKeys);
    setRows((prev) => prev.filter((r) => !keySet.has(r._rowKey)));
    setDirty(true);
}, []);

const getRowKey = useCallback((r: LinkRow) => r._rowKey, []);
```

**Apply handler:**

```typescript
const handleApply = useCallback(() => {
    // Strip _rowKey before sending to ViewModel
    const cleanRows = rows.map((r) => {
        const { _rowKey, ...rest } = r;
        return rest;
    });
    onApply(selectedNodeId, cleanRows, originalIdsRef.current);
}, [rows, selectedNodeId, onApply]);
```

**Column presets:**

```typescript
const KNOWN_KEYS = new Set(["id", "title", "level", "shape"]);

function makeColumns(preset: string, rows: LinkRow[]): Column<LinkRow>[] {
    const cols: Column<LinkRow>[] = [
        { key: "id", name: "ID", width: 80, resizible: true },
        { key: "title", name: "Title", width: 120, resizible: true },
    ];

    if (preset === "view" || preset === "custom") {
        cols.push(
            { key: "level", name: "Level", width: 50, resizible: true,
              options: [1, 2, 3, 4, 5] },
            { key: "shape", name: "Shape", width: 70, resizible: true,
              options: ["circle", "square", "diamond", "triangle", "star", "hexagon"] },
        );
    }

    if (preset === "custom") {
        const customKeys = new Set<string>();
        for (const row of rows) {
            for (const key of Object.keys(row)) {
                if (key !== "_rowKey" && !KNOWN_KEYS.has(key) && !key.startsWith("_$")) {
                    customKeys.add(key);
                }
            }
        }
        for (const key of [...customKeys].sort()) {
            cols.push({
                key,
                name: key,
                width: Math.max(60, Math.min(140, key.length * 10)),
                resizible: true,
            });
        }
    }

    return cols;
}
```

Recompute columns on preset switch and on initial data load (NOT on every cell edit — too frequent):
```typescript
// Recompute columns when preset changes
useEffect(() => {
    setColumns(makeColumns(activePreset, rows));
}, [activePreset]); // eslint-disable-line — reads rows but only triggers on preset change

// Also recompute when linkedNodes prop changes (initial load / after Apply / external edit)
useEffect(() => {
    setColumns(makeColumns(activePreset, rows));
}, [linkedNodes]); // eslint-disable-line — reset columns when source data changes
```

**JSX structure:**

```tsx
<div className="links-tab">
    <div className="preset-tabs">
        {(["default", "view", "custom"] as const).map((p) => (
            <button
                key={p}
                className={`preset-tab${activePreset === p ? " active" : ""}`}
                onClick={() => setActivePreset(p)}
            >
                {p === "default" ? "Default" : p === "view" ? "View" : "Custom"}
            </button>
        ))}
    </div>
    <div className="links-grid">
        <AVGrid
            columns={columns}
            rows={rows}
            getRowKey={getRowKey}
            setColumns={setColumns}
            editRow={editRow}
            onAddRows={onAddRows}
            onDeleteRows={onDeleteRows}
            entity="link"
            disableFiltering
            disableSorting
            rowHeight={24}
            fitToWidth
        />
    </div>
    {dirty && (
        <div className="links-apply-row">
            <button className="links-apply-btn" onClick={handleApply}>
                Apply
            </button>
        </div>
    )}
</div>
```

**Important:** We pass `setColumns` to AVGrid so it can update column widths during resize. But we don't pass `onAddColumns` or `onDeleteColumns` — no column add/delete.

### Step 4: Update GraphDetailPanel props and wiring

**File:** `src/renderer/editors/graph/GraphDetailPanel.tsx`

Updated props:
```typescript
interface GraphDetailPanelProps {
    node: GraphNode | null;
    linkedNodes: GraphNode[];                     // NEW
    onUpdateProps: (nodeId: string, props: Partial<GraphNode>) => void;
    onRenameNode: (oldId: string, newId: string) => boolean;
    onApplyLinks: (selectedNodeId: string,        // NEW
        rows: Record<string, unknown>[],
        originalIds: Set<string>) => void;
    containerRef?: React.RefObject<HTMLElement | null>;
    expandRequest?: number;
}
```

Enable Links tab:
```typescript
<button
    className={`panel-tab ${activeTab === "links" ? "active" : ""}`}
    onClick={() => setActiveTab("links")}
>
    Links
</button>
```

Render LinksTab:
```typescript
{activeTab === "links" && (
    <LinksTab
        linkedNodes={linkedNodes}
        selectedNodeId={node.id}
        onApply={onApplyLinks}
    />
)}
```

Panel content class for grid tabs:
```tsx
<div className={`panel-content${activeTab !== "info" ? " no-pad" : ""}`}>
```

### Step 5: Update GraphView.tsx

**File:** `src/renderer/editors/graph/GraphView.tsx`

Destructure `linkedNodes` from state and pass new props:
```tsx
const { error, loading, searchQuery, searchInfo, tooltip, selectedNode, linkedNodes } = pageState;
// ...
<GraphDetailPanel
    node={selectedNode}
    linkedNodes={linkedNodes}
    onUpdateProps={(nodeId, props) => vm.updateNodeProps(nodeId, props)}
    onRenameNode={(oldId, newId) => vm.renameNode(oldId, newId)}
    onApplyLinks={(nodeId, rows, origIds) => vm.applyLinkedNodesUpdate(nodeId, rows, origIds)}
    containerRef={containerRef}
    expandRequest={expandRequest}
/>
```

### Step 6: Add styles

**File:** `src/renderer/editors/graph/GraphDetailPanel.tsx`

Add to `GraphDetailPanelRoot`:

```typescript
// Links tab layout
"& .links-tab": {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    overflow: "hidden",
},
"& .preset-tabs": {
    display: "flex",
    gap: 0,
    borderBottom: `1px solid ${color.border.default}`,
    flexShrink: 0,
},
"& .preset-tab": {
    padding: "2px 8px",
    fontSize: 10,
    border: "none",
    background: "none",
    cursor: "pointer",
    color: color.text.light,
    borderBottom: "2px solid transparent",
    "&:hover": {
        color: color.text.default,
    },
},
"& .preset-tab.active": {
    color: color.text.default,
    borderBottomColor: color.border.active,
},
"& .links-grid": {
    flex: 1,
    overflow: "hidden",
},
"& .links-apply-row": {
    display: "flex",
    justifyContent: "flex-end",
    padding: "4px 6px",
    borderTop: `1px solid ${color.border.default}`,
    flexShrink: 0,
},
"& .links-apply-btn": {
    padding: "2px 12px",
    fontSize: 11,
    cursor: "pointer",
    border: `1px solid ${color.border.active}`,
    borderRadius: 3,
    backgroundColor: color.border.active,
    color: color.background.default,
    "&:hover": {
        opacity: 0.9,
    },
},
// No-padding mode for grid tabs
"& .panel-content.no-pad": {
    padding: 0,
    overflow: "hidden",
},
```

## Concerns / Open Questions

### 1. Local state reset on external graph changes

If the user adds/deletes a link via context menu or Alt+Click while the Links tab is open with unsaved edits, the `linkedNodes` prop will change (from state refresh), which resets local state and loses edits.

**Resolution:** This is acceptable. Context menu edits commit immediately to the graph. The Links tab local state should reset to reflect the new reality. We could show a warning, but for now reset is the simpler and safer behavior. The Apply button makes it clear that local changes haven't been committed yet.

### 2. Validation in editRow

AVGrid has no built-in validation. The `editRow` callback must handle:
- **level**: validate `1 ≤ value ≤ 5`, default to 5 if invalid
- **shape**: validate against known shapes, default to "circle" if invalid
- **id**: trim whitespace; empty id rows are ignored during Apply
- **other columns**: accept any string value

**Resolution:** Validate in the `editRow` callback as shown in Step 3.

### 3. ID column semantics

In this grid, `id` means "which node is this linked to?" — it's a **link reference**, not a rename operation. When Apply runs:
- Changed ID = unlink old + link new (or create new)
- Empty ID = row is skipped (ignored)
- Duplicate IDs in the grid = only the first is processed (or merge?)

**Resolution:** During Apply, skip rows with empty IDs. For duplicates, process each row independently (last write wins for properties). This handles paste scenarios where user might accidentally paste duplicates.

### 4. `_rowKey` stability

We need stable row keys because `id` is editable. `_rowKey` is an internal field (`link-1`, `link-2`, ...) that never changes. It must be excluded from the data sent to Apply.

**Resolution:** Strip `_rowKey` in the Apply handler before passing to ViewModel.

### 5. Column recomputation for Custom preset

Custom columns are derived from row data (all unique non-standard keys). Recomputing on every cell edit is wasteful. But we need to pick up new custom keys when rows are loaded.

**Resolution:** Recompute columns only on preset switch and on initial load (when `linkedNodes` prop changes). If user pastes data with new custom keys, they need to switch away from Custom and back to see new columns. Acceptable UX trade-off.

### 6. AVGrid dynamic import

AVGrid is in `src/renderer/components/data-grid/` — it's a shared component, not editor-specific. But the graph editor is lazy-loaded. Check if AVGrid is already bundled separately or if importing it from within the graph editor will add it to the graph chunk.

**Resolution:** AVGrid is used by multiple editors (grid, log-view, etc.). It's likely already in a shared chunk. Import directly — Vite will handle code splitting.

### 7. Row height

Default AVGrid row height may be too tall. Using `rowHeight={24}` for compact display in the panel. Adjust during implementation if needed.

### 8. Apply after paste

When pasting from Excel, `onAddRows` creates empty rows, then `editRow` fills cells. Both update local state and set `dirty=true`. The Apply button appears. User reviews the pasted data and clicks Apply. This flow works naturally.

### 9. Self-link prevention

The Apply method must prevent creating a link from a node to itself (`selectedNodeId === id`). Skip those rows silently.

**Resolution:** Already handled in Step 2 — `selectedNodeId !== id` check.

### 10. Dirty state protection

If the user has unsaved edits in the Links tab, we must prevent accidental data loss:
- **Prevent panel collapse**: Clicking the header should not collapse the panel when dirty
- **Prevent node selection change**: Clicking another node (or empty area) should not change selection when dirty — the canvas click handler should be guarded
- **Cancel button**: Show alongside Apply to let user explicitly discard changes

**Implementation:**
- LinksTab calls `onDirtyChange(dirty: boolean)` callback when dirty state changes
- GraphDetailPanel tracks `linksDirty` and blocks `toggleExpanded` when dirty
- GraphDetailPanel passes `onLinksDirtyChange` up to GraphView
- GraphView stores dirty state in a ref (`linksDirtyRef`) and guards canvas `onClick`, `onContextMenu`, and `onDoubleClick` — when dirty, these handlers are no-ops (selection stays locked)
- LinksTab Cancel button resets rows to original `linkedNodes` and sets dirty=false

## Acceptance Criteria

- [ ] Links tab is enabled and clickable in the detail panel
- [ ] Links tab shows an AVGrid with linked nodes (id, title, etc.)
- [ ] Three column presets: Default (id, title), View (+ level, shape), Custom (+ all custom props)
- [ ] Mini-tab switcher above the grid to change presets
- [ ] `level` column has combobox editor with options 1-5 (invalid values default to 5)
- [ ] `shape` column has combobox editor with shape options (invalid values default to "circle")
- [ ] All columns are editable (including id and custom properties)
- [ ] Users can add new rows ("+ add link" button)
- [ ] Users can delete rows (smart: removes link; also deletes node if it becomes orphaned)
- [ ] Users can paste from Excel (creates new rows, fills cells)
- [ ] Apply button appears when changes exist; commits all changes at once
- [ ] Apply: new IDs create new nodes + links; removed rows smart-delete (link always, node if orphaned); modified rows update properties
- [ ] Column reordering is allowed (user preference)
- [ ] Column resizing works, resets on panel collapse or tab/preset switch
- [ ] Grid updates after Apply (reloads from refreshed state)
- [ ] Grid row height is compact (24px)
- [ ] `entity="link"` for add-row label
- [ ] When dirty: panel collapse is blocked, node selection changes are blocked
- [ ] Cancel button discards unsaved edits and unlocks selection
