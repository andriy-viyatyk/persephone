# US-179: Detail Panel — Properties Tab (AVGrid)

**Epic:** EPIC-006 (Force Graph Editor)
**Status:** Done

## Goal

Add a "Properties" tab to the graph detail panel that shows all **custom** (non-core) properties of the selected node in a key-value AVGrid. The grid supports inline editing, add/delete rows, copy/paste from spreadsheet, and uses an **Apply/Cancel** batch workflow (consistent with the Links tab).

## Background

### What are "custom properties"?

GraphNode has three tiers of properties:

| Tier | Keys | Edited in |
|------|-------|-----------|
| **Core** | `id` | Info tab (with rename logic) |
| **Presentation** | `title`, `level`, `shape` | Info tab |
| **Runtime** (D3 sim) | `x`, `y`, `vx`, `vy`, `fx`, `fy`, `index` | Not editable |
| **System** | `_$showIndex`, `_$hiddenCount` | Not editable |
| **Custom** | everything else | **Properties tab** (this task) |

Examples of custom properties: `description`, `version`, `owner`, `category`, `url`.

### Existing patterns to follow

**Links tab** (`GraphDetailPanel.tsx:LinksTab`, lines ~521-857) — The Properties tab will mirror this pattern closely:

- Local `rows` + `columns` state
- `_rowKey` stable internal keys for AVGrid
- `dirty` state with `Apply/Cancel` buttons
- `onDirtyChange` callback → blocks panel collapse when dirty
- `entity="property"` for add-row label
- `disableFiltering`, `disableSorting`, compact `rowHeight={24}`
- `editRow`, `onAddRows`, `onDeleteRows` callbacks
- Reset rows from node props on selection change

**`onUpdateProps`** (`GraphViewModel.ts:340-357`) — Handles property updates:
- Deletes keys where value is `undefined`, `""`, or `null`
- Skips `id` key (use `renameNode` instead)
- Calls `rebuildAndRender()` + `serializeToHost()` + `refreshSelectedNode()`

**`cleanNode`** (`GraphViewModel.ts:582-590`) — Strips `_$*` and D3 sim keys. Used for `linkedNodes` but NOT for `selectedNode`. The Properties tab must do its own filtering.

### Data flow

```
selectedNode (raw, with D3/system props)
    ↓ filter out EXCLUDED_KEYS + _$ prefix
    ↓ convert to rows: { _rowKey, key, value }
    ↓ user edits in AVGrid
    ↓ Apply clicked
    ↓ convert rows back to props object
    ↓ compute diff: added/changed/removed keys
    ↓ call onApplyProperties(nodeId, propsToSet, keysToRemove)
    ↓ GraphViewModel updates sourceData, rebuilds, serializes
```

## Implementation Plan

### Step 1: Add `PropertiesTab` component in `GraphDetailPanel.tsx`

Create a `PropertiesTab` function component (same file as `LinksTab`, following the same pattern).

**Row type:**
```typescript
type PropertyRow = { _rowKey: string; key: string; value: string };
```

**Excluded keys constant:**
```typescript
const PROPERTY_EXCLUDED_KEYS = new Set([
    "id", "title", "level", "shape",                           // core + presentation
    "x", "y", "vx", "vy", "fx", "fy", "index",               // D3 simulation
]);
// Also exclude any key starting with "_$" (system/runtime)
```

**Props:**
```typescript
interface PropertiesTabProps {
    node: GraphNode;
    onApply: (nodeId: string, propsToSet: Record<string, unknown>, keysToRemove: string[]) => void;
    onDirtyChange: (dirty: boolean) => void;
}
```

**State:**
- `rows: PropertyRow[]` — local editable rows
- `columns: Column<PropertyRow>[]` — two columns: `key` (property name) and `value`
- `dirty: boolean`
- `focus: CellFocus<PropertyRow> | undefined`
- `originalKeys: Set<string>` — ref tracking original property keys (for diff on Apply)
- `rowCounterRef` — for generating stable `_rowKey`

**Initialization (useEffect on `node.id`):**
1. Extract custom properties from `node`: iterate `Object.entries(node)`, exclude `PROPERTY_EXCLUDED_KEYS` and `_$*` prefix keys
2. Map to `PropertyRow[]`: `{ _rowKey: "prop-N", key: propName, value: String(propValue) }`
3. Set `dirty = false`, reset `originalKeys`

**Columns (static, defined once):**
```typescript
const PROPERTY_COLUMNS: Column<PropertyRow>[] = [
    { key: "key", name: "Name", width: 120, resizible: true },
    { key: "value", name: "Value", width: 200, resizible: true },
];
```

**editRow callback:**
- Update the matching row's `key` or `value` field
- Mark dirty

**onAddRows callback:**
- Create new rows with empty key/value: `{ _rowKey: "prop-N", key: "", value: "" }`
- Mark dirty

**onDeleteRows callback:**
- Remove rows by `_rowKey`
- Mark dirty

**handleApply:**
1. Build `propsToSet: Record<string, unknown>` from current rows (skip rows with empty key)
2. Build `keysToRemove: string[]` — keys in `originalKeys` that are not in current rows
3. Call `onApply(node.id, propsToSet, keysToRemove)`
4. Set `dirty = false`

**handleCancel:**
- Re-initialize rows from current `node` props (same as initial load)
- Set `dirty = false`

**Validation:**
- Duplicate keys: last row wins silently on Apply (no blocking)
- Reserved keys (`id`, `title`, `level`, `shape`) and system keys (`_$*`): highlight cell with red text via `onCellClass`, disable Apply button
- Use `onCellClass` callback on the "key" column to return an error class when value is reserved/system

### Step 2: Wire PropertiesTab into GraphDetailPanel

**In `GraphDetailPanel` component:**

1. Enable the Properties tab button (remove `disabled` class, add `onClick` handler)
2. Add `activeTab === "properties"` conditional rendering
3. Track `propertiesDirty` state (separate from `linksDirty`)
4. Combine dirty states: block collapse when `linksDirty || propertiesDirty`
5. Block tab switching when any tab is dirty (prevent losing unsaved changes)

**Props changes:**
- Add `onApplyProperties` callback to `GraphDetailPanelProps`
- Pass it through to `PropertiesTab`

**Panel content class:**
- Properties tab should use `no-pad` class (same as Links tab) for full-width grid

### Step 3: Add `applyPropertiesUpdate` to `GraphViewModel`

```typescript
applyPropertiesUpdate(
    nodeId: string,
    propsToSet: Record<string, unknown>,
    keysToRemove: string[],
): void {
    if (!this.sourceData) return;
    const node = this.sourceData.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    // Remove deleted properties
    for (const key of keysToRemove) {
        delete (node as any)[key];
    }

    // Set/update properties
    for (const [key, value] of Object.entries(propsToSet)) {
        if (CORE_KEYS.has(key)) continue; // Safety: skip core keys
        if (value === undefined || value === "" || value === null) {
            delete (node as any)[key];
        } else {
            (node as any)[key] = value;
        }
    }

    this.rebuildAndRender();
    this.serializeToHost();
    this.refreshSelectedNode();
}
```

### Step 4: Wire callback in GraphView.tsx

```typescript
onApplyProperties={(nodeId, propsToSet, keysToRemove) =>
    vm.applyPropertiesUpdate(nodeId, propsToSet, keysToRemove)}
```

### Step 5: Styling

Add to `GraphDetailPanelRoot` styled component:
- `.properties-tab` — flex column layout (same structure as `.links-tab`)
- `.properties-grid` — flex: 1 container for AVGrid
- `.properties-action-row` — Apply/Cancel buttons (reuse `.links-action-row` styles, or share a common class)

**Consider**: The Apply/Cancel button styling is identical between Links and Properties. Rename `.links-action-row` → `.tab-action-row` and share. Similarly `.links-tab` → share structure with `.properties-tab` if identical.

### Step 6: Update tooltip

The tooltip (`ForceGraphRenderer.ts`) currently shows custom properties. After editing properties in the Properties tab, the tooltip should reflect the changes. This already works because `rebuildAndRender()` + `refreshSelectedNode()` updates the data. Just verify.

## Resolved Decisions

1. **Batch vs Immediate** — Use Apply/Cancel batch workflow for consistency with Links tab.
2. **Duplicate key handling** — Last row wins silently on Apply.
3. **Reserved key prevention** — Block reserved keys (`id`, `title`, `level`, `shape`) and system keys (`_$*`). Use `onCellClass` to highlight invalid key cells with red text. Disable Apply button when invalid keys exist.
4. **Value type preservation** — All edited values saved as strings. Type-aware editing deferred to future.
5. **Dirty state blocking** — Same as Links tab: prevent tab switching, panel collapse, and node selection/deselection when dirty.
6. **Empty key rows** — Skip silently on Apply.

## Acceptance Criteria

- [ ] Properties tab is enabled and clickable in the detail panel
- [ ] Tab shows a 2-column AVGrid: "Name" (key) and "Value"
- [ ] Grid displays all custom properties (excludes id, title, level, shape, D3 sim, _$ system)
- [ ] Inline editing: double-click cell to edit key or value
- [ ] Add new property row (Ctrl+Insert or context menu)
- [ ] Delete property rows (Ctrl+Delete or context menu)
- [ ] Copy/paste from Excel/spreadsheet works (key-value pairs)
- [ ] Apply button appears when changes exist; commits all changes at once
- [ ] Cancel button discards unsaved edits
- [ ] Apply: new keys are added to node, removed rows delete keys, modified rows update values
- [ ] Duplicate keys are highlighted and Apply is blocked (or last-wins with warning)
- [ ] Reserved keys (id, title, level, shape) cannot be added through Properties tab
- [ ] Grid row height is compact (24px)
- [ ] `entity="property"` for add-row label
- [ ] When dirty: panel collapse is blocked, tab switching is blocked
- [ ] Grid updates after Apply (reloads from refreshed node state)
- [ ] Tooltip reflects property changes after Apply
- [ ] Column resizing works
