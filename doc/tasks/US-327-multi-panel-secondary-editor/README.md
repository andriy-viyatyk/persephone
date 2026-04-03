# US-327: Multi-panel secondaryEditor

**Status:** Planned
**Epic:** [EPIC-019](../../epics/EPIC-019.md) — Explorer as Secondary Editor + Multi-Panel Support (Phase 1, Task 1.1)

## Goal

Change `EditorModel.secondaryEditor` from `string | undefined` to `string[] | undefined` so one editor model can register multiple sidebar panels (e.g., Explorer + Search from a future ExplorerEditorModel). Update all consumers: type definition, getter/setter, PageModel management, PageNavigator rendering, persistence, and existing secondary editors (ZipEditorModel).

## Background

Currently each `EditorModel` can register at most one sidebar panel via `secondaryEditor: string`. EPIC-019 requires ExplorerEditorModel to register both `"explorer"` and `"search"` panels from a single model. The array format also means the rendering loop must nest: outer loop over models in `secondaryEditors[]`, inner loop over each model's panel IDs.

### Key existing code

- **Type definition:** [src/shared/types.ts:27](../../src/shared/types.ts) — `secondaryEditor?: string`
- **Getter/setter:** [src/renderer/editors/base/EditorModel.ts:73-86](../../src/renderer/editors/base/EditorModel.ts) — reads/writes state, calls `page.addSecondaryEditor()` or `page.removeSecondaryEditorWithoutDispose()`
- **PageModel secondary management:** [src/renderer/api/pages/PageModel.ts:353-432](../../src/renderer/api/pages/PageModel.ts) — `addSecondaryEditor()`, `removeSecondaryEditor()`, `removeSecondaryEditorWithoutDispose()`, `notifyMainEditorChanged()`, `setMainEditor()`
- **PageNavigator rendering:** [src/renderer/ui/navigation/PageNavigator.tsx:320-354](../../src/renderer/ui/navigation/PageNavigator.tsx) — maps `secondaryEditors` to panels
- **ZipEditorModel:** [src/renderer/editors/zip/ZipEditorModel.ts](../../src/renderer/editors/zip/ZipEditorModel.ts) — sets `"zip-tree"`, clears to `undefined`
- **SecondaryEditorRegistry:** [src/renderer/ui/navigation/secondary-editor-registry.ts](../../src/renderer/ui/navigation/secondary-editor-registry.ts) — maps panel ID → component (no changes needed)
- **LazySecondaryEditor:** [src/renderer/ui/navigation/LazySecondaryEditor.tsx](../../src/renderer/ui/navigation/LazySecondaryEditor.tsx) — receives single `editorId` (no changes needed)
- **expandSecondaryPanel event:** [src/renderer/core/state/events.ts:60](../../src/renderer/core/state/events.ts) — sends model ID, PageModel subscribes at [PageModel.ts:112-117](../../src/renderer/api/pages/PageModel.ts)
- **activePanel:** [PageModel.ts:85](../../src/renderer/api/pages/PageModel.ts) — `activePanel: string = "explorer"` — stores panel ID or model ID
- **CollapsiblePanelStack activePanel:** [PageNavigator.tsx:285](../../src/renderer/ui/navigation/PageNavigator.tsx) — panel IDs must match what's passed to `CollapsiblePanel id=`

### How activePanel works today

`activePanel` stores a string — either `"explorer"`, `"search"`, or a secondary editor's **model ID**. The `CollapsiblePanelStack` expands whichever panel has `id === activePanel`. Currently secondary panels use `model.id` as their `CollapsiblePanel id`. After this change, secondary panels will use the **panel ID** (e.g., `"zip-tree"`) as their `CollapsiblePanel id`. This means:

1. `expandSecondaryPanel.send(this.id)` sends model ID → PageModel must translate model ID to the model's first panel ID (or keep using model ID and add logic to resolve).
2. Fallback on removal: currently `this.activePanel = "explorer"` — stays the same for now (EPIC-019 Phase 4 will address smarter fallback).

**Decision:** Change `expandSecondaryPanel` to send the **panel ID** instead of model ID. This keeps the `activePanel` system clean — everything is panel IDs. ZipEditorModel sends `expandSecondaryPanel.send("zip-tree")` instead of `expandSecondaryPanel.send(this.id)`. PageModel's subscription checks if the panel ID exists in any secondary editor's `secondaryEditor[]` array.

### How the `removeSecondaryEditor*` activePanel fallback works

Both `removeSecondaryEditor()` and `removeSecondaryEditorWithoutDispose()` check `if (this.activePanel === model.id)` and fall back to `"explorer"`. With panel IDs, we should check if `activePanel` is in the removed model's `secondaryEditor[]` array. If so, fall back to `"explorer"`.

## Implementation Plan

### Step 1: Change type definition

**File:** [src/shared/types.ts:27](../../src/shared/types.ts)

```typescript
// Before:
secondaryEditor?: string,

// After:
secondaryEditor?: string[],
```

### Step 2: Update EditorModel getter/setter

**File:** [src/renderer/editors/base/EditorModel.ts:71-86](../../src/renderer/editors/base/EditorModel.ts)

```typescript
// Before:
get secondaryEditor(): string | undefined {
    return this.state.get().secondaryEditor;
}

set secondaryEditor(value: string | undefined) {
    const prev = this.state.get().secondaryEditor;
    if (prev === value) return;
    this.state.update((s) => { s.secondaryEditor = value; });
    if (value) {
        this.page?.addSecondaryEditor(this);
    } else {
        this.page?.removeSecondaryEditorWithoutDispose(this);
    }
}

// After:
get secondaryEditor(): string[] | undefined {
    return this.state.get().secondaryEditor;
}

set secondaryEditor(value: string[] | undefined) {
    this.state.update((s) => { s.secondaryEditor = value; });
    if (value?.length) {
        this.page?.addSecondaryEditor(this);
    } else {
        this.page?.removeSecondaryEditorWithoutDispose(this);
    }
}
```

Note: The equality check `prev === value` is removed — array identity comparison isn't useful. The setter always updates state. `addSecondaryEditor` is idempotent (checks `includes(model)` already).

### Step 3: Update EditorModel.applyRestoreData()

**File:** [src/renderer/editors/base/EditorModel.ts:150](../../src/renderer/editors/base/EditorModel.ts)

```typescript
// Before:
if ((data as any).secondaryEditor) s.secondaryEditor = (data as any).secondaryEditor;

// After — handle both old string format and new array format for migration:
if ((data as any).secondaryEditor) {
    const se = (data as any).secondaryEditor;
    s.secondaryEditor = typeof se === "string" ? [se] : se;
}
```

This handles deserialization of old cache data where `secondaryEditor` was a string.

### Step 4: Update ZipEditorModel

**File:** [src/renderer/editors/zip/ZipEditorModel.ts](../../src/renderer/editors/zip/ZipEditorModel.ts)

```typescript
// Line 63 (restore):
// Before:
this.secondaryEditor = "zip-tree";
// After:
this.secondaryEditor = ["zip-tree"];

// Line 70-71 (setPage):
// Before:
if (page && this.treeProvider && !this.secondaryEditor) {
    this.secondaryEditor = "zip-tree";
}
// After:
if (page && this.treeProvider && !this.secondaryEditor?.length) {
    this.secondaryEditor = ["zip-tree"];
}

// Lines 81, 93 (beforeNavigateAway, onMainEditorChanged) — unchanged:
this.secondaryEditor = undefined;  // stays the same

// Line 91 (expandSecondaryPanel event):
// Before:
setTimeout(() => expandSecondaryPanel.send(this.id), 0);
// After:
setTimeout(() => expandSecondaryPanel.send("zip-tree"), 0);
```

### Step 5: Update PageModel.setMainEditor()

**File:** [src/renderer/api/pages/PageModel.ts:172-176](../../src/renderer/api/pages/PageModel.ts)

```typescript
// Before:
if (newEditor) {
    const se = newEditor.state.get().secondaryEditor;
    if (se) {
        this.addSecondaryEditor(newEditor);
    }
}

// After:
if (newEditor) {
    const se = newEditor.state.get().secondaryEditor;
    if (se?.length) {
        this.addSecondaryEditor(newEditor);
    }
}
```

### Step 6: Update PageModel.notifyMainEditorChanged()

**File:** [src/renderer/api/pages/PageModel.ts:420-427](../../src/renderer/api/pages/PageModel.ts)

```typescript
// Before:
const removed = this.secondaryEditors.filter((m) => !m.secondaryEditor);
// ...
if (this.activePanel === m.id) {
    this.activePanel = "explorer";
}

// After:
const removed = this.secondaryEditors.filter((m) => !m.secondaryEditor?.length);
// ...
if (m.secondaryEditor?.includes(this.activePanel) || this.activePanel === m.id) {
    this.activePanel = "explorer";
}
```

The `m.id` fallback check is kept for safety — if somehow activePanel still holds a model ID.

### Step 7: Update PageModel.removeSecondaryEditor() and removeSecondaryEditorWithoutDispose()

**File:** [src/renderer/api/pages/PageModel.ts:367-369, 381-382](../../src/renderer/api/pages/PageModel.ts)

```typescript
// Before (both methods):
if (this.activePanel === model.id) {
    this.activePanel = "explorer";
}

// After (both methods):
if (model.secondaryEditor?.includes(this.activePanel) || this.activePanel === model.id) {
    this.activePanel = "explorer";
}
```

### Step 8: Update PageModel expandSecondaryPanel subscription

**File:** [src/renderer/api/pages/PageModel.ts:112-117](../../src/renderer/api/pages/PageModel.ts)

```typescript
// Before:
this._expandSub = expandSecondaryPanel.subscribe((modelId) => {
    if (modelId && this.secondaryEditors.some((m) => m.id === modelId)) {
        this.setActivePanel(modelId);
        this.secondaryEditorsVersion.update((s) => { s.version++; });
    }
});

// After — panelId instead of modelId:
this._expandSub = expandSecondaryPanel.subscribe((panelId) => {
    if (panelId && this.secondaryEditors.some((m) => m.secondaryEditor?.includes(panelId))) {
        this.setActivePanel(panelId);
        this.secondaryEditorsVersion.update((s) => { s.version++; });
    }
});
```

### Step 9: Update PageNavigator rendering

**File:** [src/renderer/ui/navigation/PageNavigator.tsx:320-354](../../src/renderer/ui/navigation/PageNavigator.tsx)

```tsx
// Before:
{secondaryEditors.map((model) => {
    const editorId = model.state.get().secondaryEditor;
    if (!editorId) return null;
    const def = secondaryEditorRegistry.get(editorId);
    if (!def) return null;
    const isActivePagePanel = model === page.mainEditor;
    const panelButtons = isActivePagePanel ? (<></>) : (
        <Button ...>
            <CloseIcon width={14} height={14} />
        </Button>
    );
    return (
        <CollapsiblePanel
            key={model.id}
            id={model.id}
            title={def.label}
            buttons={panelButtons}
        >
            <LazySecondaryEditor model={model} editorId={editorId} />
        </CollapsiblePanel>
    );
})}

// After:
{secondaryEditors.flatMap((model) => {
    const panelIds = model.state.get().secondaryEditor;
    if (!panelIds?.length) return [];
    const isActivePagePanel = model === page.mainEditor;
    return panelIds.map((panelId) => {
        const def = secondaryEditorRegistry.get(panelId);
        if (!def) return null;
        const panelButtons = isActivePagePanel ? (<></>) : (
            <Button
                type="icon"
                size="small"
                title="Close"
                onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    page.removeSecondaryEditor(model);
                }}
            >
                <CloseIcon width={14} height={14} />
            </Button>
        );
        return (
            <CollapsiblePanel
                key={`${model.id}-${panelId}`}
                id={panelId}
                title={def.label}
                buttons={panelButtons}
            >
                <LazySecondaryEditor model={model} editorId={panelId} />
            </CollapsiblePanel>
        );
    });
})}
```

Key changes:
- `map()` → `flatMap()` with inner `panelIds.map()`
- `CollapsiblePanel key` = `${model.id}-${panelId}` (composite for uniqueness)
- `CollapsiblePanel id` = `panelId` (not `model.id`) — so `activePanel` matches
- Close button still removes the whole model (not individual panels) — this is correct since panel lifecycle is owned by the model

### Step 10: Script API types — NO CHANGES NEEDED

`secondaryEditor` is not exposed in `assets/editor-types/page.d.ts` or `io.d.ts`. No script API changes required.

## Concerns

### 1. Old cache migration — RESOLVED: Handle in applyRestoreData

Old persisted data has `secondaryEditor: "zip-tree"` (string). `applyRestoreData()` wraps strings in an array: `typeof se === "string" ? [se] : se`. This is a one-time migration — next save writes the array format.

### 2. Close button removes entire model, not individual panels

When a multi-panel model has a close button (non-mainEditor panels), clicking Close removes the entire model and all its panels. This is correct — the model owns the panels. Individual panel removal (e.g., closing just "search" but keeping "explorer") would be done by the model itself (ExplorerEditorModel would remove "search" from its array).

### 3. `beforeNavigateAway` base implementation

The base `beforeNavigateAway()` sets `this.secondaryEditor = undefined` — this clears the entire array. This is correct — when clearing, you clear all panels.

## Acceptance Criteria

- [ ] `IEditorState.secondaryEditor` type is `string[] | undefined`
- [ ] `EditorModel.secondaryEditor` getter returns `string[] | undefined`
- [ ] `EditorModel.secondaryEditor` setter accepts `string[] | undefined`
- [ ] ZipEditorModel sets `["zip-tree"]` array format
- [ ] Opening a .zip file shows the Archive panel in the sidebar
- [ ] Navigating between files inside an archive keeps the Archive panel
- [ ] Navigating to a non-archive file removes the Archive panel
- [ ] `expandSecondaryPanel` sends panel ID, PageModel resolves it
- [ ] Secondary panels render correctly with `panelId` as `CollapsiblePanel id`
- [ ] Restore from cache works (both new array format and old string format)
- [ ] No TypeScript compilation errors

## Files Changed

| File | Change |
|------|--------|
| `src/shared/types.ts` | `secondaryEditor?: string` → `string[]` |
| `src/renderer/editors/base/EditorModel.ts` | Getter/setter types, applyRestoreData migration |
| `src/renderer/editors/zip/ZipEditorModel.ts` | `"zip-tree"` → `["zip-tree"]`, expandSecondaryPanel sends panelId |
| `src/renderer/api/pages/PageModel.ts` | setMainEditor, notifyMainEditorChanged, removeSecondaryEditor*, expandSecondaryPanel subscription — all check `?.length` and panel-based activePanel |
| `src/renderer/ui/navigation/PageNavigator.tsx` | flatMap rendering, panelId as CollapsiblePanel id |
| `assets/editor-types/page.d.ts` | Not exposed — no changes needed |

## Files That Need NO Changes

| File | Reason |
|------|--------|
| `src/renderer/ui/navigation/secondary-editor-registry.ts` | Maps panel ID → component, unchanged |
| `src/renderer/ui/navigation/LazySecondaryEditor.tsx` | Already receives single `editorId` per call |
| `src/renderer/editors/register-editors.ts` | Registration of "zip-tree" unchanged |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Lifecycle orchestration doesn't depend on secondaryEditor type |
| `src/renderer/api/pages/PagesQueryModel.ts` | findPage checks `secondaryEditors` array membership, not panel IDs |
| `src/renderer/core/state/events.ts` | `expandSecondaryPanel` is `Subscription<string>` — still sends string |
