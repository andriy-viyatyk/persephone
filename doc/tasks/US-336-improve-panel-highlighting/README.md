# US-336: Improve Explorer and Archive panel highlighting

**Status:** Planned
**Epic:** [EPIC-019](../../epics/EPIC-019.md) — Explorer as Secondary Editor + Multi-Panel Support

## Goal

Fix the Explorer highlighting bug (selection clears when navigating from CategoryView) and add smart auto-expand: when the active panel is "explorer" or "zip-tree", auto-reveal the selected file by expanding its parent folders and scrolling to it. When the panel is not active (e.g., Search is expanded), only highlight without revealing — so switching back to the tree panel doesn't show a jarring cascade of folder expansions.

## Issues

### Issue 1: Explorer selection clears when navigating from CategoryView

**Repro:** Open Explorer → click folder → CategoryView opens → click file in CategoryView → file highlights momentarily in Explorer → highlighting disappears.

**Root cause:** [CategoryEditor.tsx:36](../../src/renderer/editors/category/CategoryEditor.tsx) sends `RawLinkEvent` with `{ pageId }` but no `sourceId: "explorer"`. When navigation completes, [ExplorerEditorModel.onMainEditorChanged():123](../../src/renderer/editors/explorer/ExplorerEditorModel.ts) checks `sourceId !== "explorer"` and clears selection.

**Fix:** CategoryEditor should include `sourceId: "explorer"` in its metadata, since CategoryView is the Explorer's folder view — navigation from it is logically "from Explorer".

### Issue 2: Auto-expand selected file in Explorer (only when panel is active)

**Desired behavior:**
- When "explorer" panel is the active (expanded) panel → on `selectedHref` change, call `revealItem()` to expand parent folders and scroll to the file
- When "explorer" panel is NOT active (e.g., "search" is expanded) → only update `selectedHref` for highlight, do NOT call `revealItem()` — no folder expansion

**Current behavior:** [ExplorerSecondaryEditor.tsx:45-49](../../src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx) always calls `revealItem()` when `selectedHref` changes, regardless of which panel is active.

**Why:** If user searches for files and clicks results (which navigates), they don't want Explorer tree expanding for each click. But when they switch to Explorer panel, the current file should be highlighted (already done by `selectedHref`).

**Implementation:** The component needs to know if its panel is currently active. It can check `model.page?.activePanel === "explorer"`. Only call `revealItem()` when the panel is active.

### Issue 3: Auto-expand in Archive panel (same logic)

**Same as Issue 2 but for ZipSecondaryEditor.** When the "zip-tree" panel is active, auto-reveal the selected archive entry. When not active, only highlight.

**Current behavior:** [ZipSecondaryEditor.tsx](../../src/renderer/editors/zip/ZipSecondaryEditor.tsx) does NOT call `revealItem()` at all — it only passes `selectedHref`.

## Key files

- **ExplorerEditorModel:** [src/renderer/editors/explorer/ExplorerEditorModel.ts](../../src/renderer/editors/explorer/ExplorerEditorModel.ts) — `onMainEditorChanged()` clearing logic
- **ExplorerSecondaryEditor:** [src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx](../../src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx) — `revealItem` call in useEffect
- **ZipSecondaryEditor:** [src/renderer/editors/zip/ZipSecondaryEditor.tsx](../../src/renderer/editors/zip/ZipSecondaryEditor.tsx) — needs `revealItem` added
- **CategoryEditor:** [src/renderer/editors/category/CategoryEditor.tsx](../../src/renderer/editors/category/CategoryEditor.tsx) — missing `sourceId: "explorer"`
- **PageModel:** [src/renderer/api/pages/PageModel.ts](../../src/renderer/api/pages/PageModel.ts) — `activePanel` accessible via `page.activePanel`

## Implementation Plan

### Step 1: Fix CategoryEditor sourceId

**File:** [src/renderer/editors/category/CategoryEditor.tsx:36](../../src/renderer/editors/category/CategoryEditor.tsx)

```typescript
// Before:
app.events.openRawLink.sendAsync(new RawLinkEvent(url, undefined, { pageId }));

// After:
app.events.openRawLink.sendAsync(new RawLinkEvent(url, undefined, { pageId, sourceId: "explorer" }));
```

This tells ExplorerEditorModel that navigation came from Explorer's folder view, so it should keep the selection.

### Step 2: Conditional revealItem in ExplorerSecondaryEditor

**File:** [src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx:45-49](../../src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx)

Subscribe to `secondaryEditorsVersion` to detect panel switches, then reveal only when "explorer" is active:

```typescript
const { version: _version } = model.page?.secondaryEditorsVersion.use() ?? { version: 0 };
const isActivePanel = model.page?.activePanel === "explorer";

useEffect(() => {
    if (selectedHref && isActivePanel) {
        treeProviderRef.current?.revealItem(selectedHref);
    }
}, [selectedHref, isActivePanel]);
```

This triggers `revealItem` in two cases:
- `selectedHref` changes while "explorer" is active (normal navigation)
- `activePanel` changes to "explorer" while `selectedHref` is set (switching from Search)

### Step 3: Add revealItem to ZipSecondaryEditor

**File:** [src/renderer/editors/zip/ZipSecondaryEditor.tsx](../../src/renderer/editors/zip/ZipSecondaryEditor.tsx)

Add a `treeProviderRef`, subscribe to version for panel switches, and conditional `revealItem`:

```typescript
const treeProviderRef = useRef<TreeProviderViewRef>(null);
const { version: _version } = zipModel.page?.secondaryEditorsVersion.use() ?? { version: 0 };
const isActivePanel = zipModel.page?.activePanel === "zip-tree";

useEffect(() => {
    if (selectedHref && isActivePanel) {
        treeProviderRef.current?.revealItem(selectedHref);
    }
}, [selectedHref, isActivePanel]);

// In TreeProviderView:
<TreeProviderView
    ref={treeProviderRef}
    ...
/>
```

## Concerns

### 1. CategoryEditor sourceId — RESOLVED: Use "explorer"

CategoryView is the Explorer's folder view. Files opened from it should be treated as "from Explorer" for selection purposes. Using `sourceId: "explorer"` is semantically correct.

### 2. revealItem when switching panels — RESOLVED: Trigger on panel activation

When user switches from Search to Explorer, the current file should be revealed. This is essential UX: search for a file, click result, expand Explorer — the file and its folder should be visible so the user can see sibling files.

Implementation: `ExplorerSecondaryEditor` needs to also trigger `revealItem` when `activePanel` changes to `"explorer"` and there's a `selectedHref`. Same for ZipSecondaryEditor when `activePanel` changes to `"zip-tree"`. Since `activePanel` is on `page` (not reactive), the component can detect it via the `secondaryEditorsVersion` bump that `expandPanel()` triggers — it already causes a re-render.

## Acceptance Criteria

- [ ] Clicking a file in CategoryView keeps the highlight in Explorer (no flash-and-clear)
- [ ] When Explorer panel is active: navigating to a file auto-expands parent folders and scrolls to it
- [ ] When Explorer panel is NOT active (e.g., Search open): selection updates but folders don't expand
- [ ] Switching from Search to Explorer reveals the current file (expands folders, scrolls)
- [ ] Archive panel: navigating between archive entries auto-reveals the selected entry when "zip-tree" is active
- [ ] Switching to Archive panel reveals the current entry
- [ ] No TypeScript compilation errors

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/category/CategoryEditor.tsx` | Add `sourceId: "explorer"` to navigation metadata |
| `src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx` | Conditional `revealItem` — only when "explorer" panel is active |
| `src/renderer/editors/zip/ZipSecondaryEditor.tsx` | Add `treeProviderRef` + conditional `revealItem` when "zip-tree" is active |

## Files That Need NO Changes

| File | Reason |
|------|--------|
| `src/renderer/editors/explorer/ExplorerEditorModel.ts` | `onMainEditorChanged` logic is correct — just needs CategoryEditor to pass the right sourceId |
| `src/renderer/api/pages/PageModel.ts` | `activePanel` already accessible |
| `src/renderer/components/tree-provider/TreeProviderView.tsx` | `revealItem` already works |
