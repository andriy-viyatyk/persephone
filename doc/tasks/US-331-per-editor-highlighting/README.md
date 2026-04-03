# US-331: Per-editor highlighting

**Status:** Planned
**Epic:** [EPIC-019](../../epics/EPIC-019.md) — Explorer as Secondary Editor + Multi-Panel Support (Phase 3, Task 3.1)

## Goal

Add per-editor highlighting to ZipEditorModel so the Archive panel highlights the currently viewed entry. ExplorerEditorModel already has this (implemented in US-328). After this task, every secondary editor independently manages its own highlighting via `onMainEditorChanged()`.

## Background

### Current state

**ExplorerEditorModel** — fully working:
- Has `selectionState: TOneState<NavigationState>` with `selectedHref`
- `ExplorerSecondaryEditor` subscribes to `selectionState` and passes `selectedHref` to `TreeProviderView`
- `onMainEditorChanged()` clears selection when the new editor wasn't opened from Explorer (`sourceId !== "explorer"`)
- `setSelectedHref()` updates selection on item click

**ZipEditorModel** — missing highlighting:
- Has NO `selectionState`
- `ZipSecondaryEditor` does NOT pass `selectedHref` to `TreeProviderView` ([ZipSecondaryEditor.tsx:48](../../src/renderer/editors/zip/ZipSecondaryEditor.tsx))
- `onMainEditorChanged()` only expands the panel or removes itself — no selection tracking
- Result: clicking an archive entry navigates correctly, but the tree never highlights the current item

### How TreeProviderView uses selectedHref

[TreeProviderView.tsx:154-157](../../src/renderer/components/tree-provider/TreeProviderView.tsx) — `getSelected` callback compares `node.data.href` with `selectedHref` (case-insensitive). When matched, the tree row gets a selected/highlighted style.

### How Zip navigation works

1. User clicks tree item → `handleItemClick` in `ZipSecondaryEditor` → sends `RawLinkEvent` with `{ pageId, sourceId: zipModel.id }`
2. File opens → `page.setMainEditor(newEditor)` → `notifyMainEditorChanged()`
3. `ZipEditorModel.onMainEditorChanged(newMainEditor)` checks `sourceLink.metadata.sourceId === this.id`
4. If match → fires `expandSecondaryPanel.send("zip-tree")`
5. If no match → clears `secondaryEditor` (removes panel)

The entry path is available from the new editor's `sourceLink.url` — this is the archive inner path (e.g., `D:\files\archive.zip!/content/chapter1.xhtml`).

### Key files

- **ZipEditorModel:** [src/renderer/editors/zip/ZipEditorModel.ts](../../src/renderer/editors/zip/ZipEditorModel.ts) — needs selectionState + onMainEditorChanged update
- **ZipSecondaryEditor:** [src/renderer/editors/zip/ZipSecondaryEditor.tsx](../../src/renderer/editors/zip/ZipSecondaryEditor.tsx) — needs selectedHref prop
- **ExplorerEditorModel:** [src/renderer/editors/explorer/ExplorerEditorModel.ts](../../src/renderer/editors/explorer/ExplorerEditorModel.ts) — reference pattern
- **ExplorerSecondaryEditor:** [src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx](../../src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx) — reference pattern

## Implementation Plan

### Step 1: Add selectionState to ZipEditorModel

**File:** [src/renderer/editors/zip/ZipEditorModel.ts](../../src/renderer/editors/zip/ZipEditorModel.ts)

```typescript
import { TOneState } from "../../core/state/state";
import type { NavigationState } from "../../api/pages/PageModel";

export class ZipEditorModel extends EditorModel<ZipEditorModelState> {
    treeProvider: ZipTreeProvider | null = null;

    /** Selection state — highlights current entry in the archive tree. */
    readonly selectionState = new TOneState<NavigationState>({ selectedHref: null });

    // ... existing code ...
}
```

### Step 2: Update onMainEditorChanged to set selection

**File:** [src/renderer/editors/zip/ZipEditorModel.ts:88-95](../../src/renderer/editors/zip/ZipEditorModel.ts)

```typescript
// Before:
onMainEditorChanged(newMainEditor: EditorModel | null): void {
    if (!newMainEditor || newMainEditor === this) return;
    if (this._isOpenedFromThisArchive(newMainEditor)) {
        setTimeout(() => expandSecondaryPanel.send("zip-tree"), 0);
    } else {
        this.secondaryEditor = undefined;
    }
}

// After:
onMainEditorChanged(newMainEditor: EditorModel | null): void {
    if (!newMainEditor || newMainEditor === this) return;
    if (this._isOpenedFromThisArchive(newMainEditor)) {
        // Highlight the opened entry in the archive tree
        const url = newMainEditor.state.get().sourceLink?.url ?? null;
        this.selectionState.update((s) => { s.selectedHref = url; });
        setTimeout(() => expandSecondaryPanel.send("zip-tree"), 0);
    } else {
        this.secondaryEditor = undefined;
    }
}
```

The `sourceLink.url` contains the full archive path (e.g., `D:\files\archive.zip!/content/chapter1.xhtml`). The tree item's `href` should match this — verify during testing.

### Step 3: Set selection on item click in ZipSecondaryEditor

**File:** [src/renderer/editors/zip/ZipSecondaryEditor.tsx:16-22](../../src/renderer/editors/zip/ZipSecondaryEditor.tsx)

```typescript
// Before:
const handleItemClick = useCallback((item: ITreeProviderItem) => {
    const url = provider?.getNavigationUrl(item) ?? item.href;
    const pageId = zipModel.page?.id;
    app.events.openRawLink.sendAsync(new RawLinkEvent(
        url, undefined, { pageId, sourceId: zipModel.id },
    ));
}, [provider, zipModel]);

// After:
const handleItemClick = useCallback((item: ITreeProviderItem) => {
    zipModel.selectionState.update((s) => { s.selectedHref = item.href; });
    const url = provider?.getNavigationUrl(item) ?? item.href;
    const pageId = zipModel.page?.id;
    app.events.openRawLink.sendAsync(new RawLinkEvent(
        url, undefined, { pageId, sourceId: zipModel.id },
    ));
}, [provider, zipModel]);
```

### Step 4: Subscribe to selectionState in ZipSecondaryEditor

**File:** [src/renderer/editors/zip/ZipSecondaryEditor.tsx](../../src/renderer/editors/zip/ZipSecondaryEditor.tsx)

Add `selectedHref` subscription and pass to TreeProviderView:

```typescript
const { selectedHref } = zipModel.selectionState.use();

// In TreeProviderView:
<TreeProviderView
    provider={provider}
    selectedHref={selectedHref ?? undefined}
    onItemClick={handleItemClick}
    onItemDoubleClick={handleItemClick}
/>
```

### Step 5: Verify href matching

The tree item `href` and `sourceLink.url` need to match for highlighting to work. Both should be the full archive path format (`archive.zip!/inner/path`). If they don't match, `onMainEditorChanged` needs to extract the inner path differently. Verify during testing.

## Concerns

### 1. href format mismatch — VERIFY DURING TESTING

Tree items from `ZipTreeProvider` have `href` set to the inner archive path. The `sourceLink.url` stored when opening a file from the archive may be in a different format (e.g., with `!` separator). If they don't match case-insensitively, the highlight won't work. Test with a real zip file and check both values.

## Acceptance Criteria

- [ ] Clicking an archive entry highlights it in the Archive tree panel
- [ ] Navigating between entries in the archive updates the highlight
- [ ] Opening a file from outside the archive (drag-drop, recent files) removes the Archive panel (existing behavior preserved)
- [ ] Explorer highlighting still works independently
- [ ] No TypeScript compilation errors

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/zip/ZipEditorModel.ts` | Add `selectionState`, update `onMainEditorChanged` to set selection |
| `src/renderer/editors/zip/ZipSecondaryEditor.tsx` | Subscribe to `selectionState`, pass `selectedHref` to TreeProviderView, set selection on click |

## Files That Need NO Changes

| File | Reason |
|------|--------|
| `src/renderer/editors/explorer/ExplorerEditorModel.ts` | Already has per-editor highlighting |
| `src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx` | Already passes selectedHref |
| `src/renderer/api/pages/PageModel.ts` | selectionState already removed (US-329) |
| `src/renderer/components/tree-provider/TreeProviderView.tsx` | Already supports selectedHref prop |
