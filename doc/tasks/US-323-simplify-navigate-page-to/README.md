# US-323: Simplify navigatePageTo

**Epic:** [EPIC-017](../../epics/EPIC-017.md) Phase 3.1
**Status:** Planned
**Created:** 2026-04-03

## Goal

Simplify `navigatePageTo` and clean up remaining Phase 2 leftovers: remove the unused `getStableKey` prop from `AppPageManager`, and make `addEmptyPageWithNavPanel` natural (page with `mainEditor = null`).

## Background

After US-322 (Wire PagesModel to PageModel), `navigatePageTo` is already much simpler — it does a mainEditor swap instead of a 10-step NavigationData transfer. However, there are still improvements to make:

1. **`navigatePageTo`** still has steps that could be consolidated into a `PageModel.setMainEditor()` helper
2. **`getStableKey`** prop on `AppPageManager` is vestigial — nobody passes it (since `page.id` is now stable). Can be removed.
3. **`addEmptyPageWithNavPanel`** creates a fake `TextFileModel("")` as a stub. With PageModel, an empty page (`mainEditor = null`) should be natural.
4. **`movePageIn`** still uses old-format heuristics (`hasNavigator`, `hasNavPanel`) for sidebar detection, and creates a temporary PageModel with editor ID as cache key — this should use the new PageDescriptor format.

## Implementation Plan

### Step 1: Add `PageModel.setMainEditor()` helper

**File:** [src/renderer/api/pages/PageModel.ts](../../../src/renderer/api/pages/PageModel.ts)

Add a method that consolidates the editor swap logic currently spread across `navigatePageTo`:

```typescript
/**
 * Replace the main editor. Handles lifecycle:
 * - Calls beforeNavigateAway on old editor
 * - Disposes old editor (unless it survived as secondary)
 * - Sets new editor's page reference
 * - Notifies secondary editors
 * - Registers new editor's secondary panel if any
 */
setMainEditor(newEditor: EditorModel | null): void {
    const oldEditor = this._mainEditor;

    if (oldEditor && newEditor) {
        oldEditor.beforeNavigateAway(newEditor);
        const survivesAsSecondary = this.secondaryEditors.includes(oldEditor);
        if (!survivesAsSecondary) {
            oldEditor.setPage(null);
            oldEditor.dispose();
        }
    } else if (oldEditor) {
        oldEditor.setPage(null);
        oldEditor.dispose();
    }

    this._mainEditor = newEditor;
    if (newEditor) {
        newEditor.setPage(this);
    }
    this.state.update((s) => { s.version++; });

    // Notify secondary editors of the change
    this.notifyMainEditorChanged();

    // Register new editor's secondary panel
    if (newEditor) {
        const se = newEditor.state.get().secondaryEditor;
        if (se) {
            this.addSecondaryEditor(newEditor);
        }
    }
}
```

Keep the raw `mainEditor` setter for low-level use (persistence restore, `addPage`) but make `setMainEditor()` the high-level method for navigation.

### Step 2: Simplify `navigatePageTo`

**File:** [src/renderer/api/pages/PagesLifecycleModel.ts](../../../src/renderer/api/pages/PagesLifecycleModel.ts#L376)

Current flow (13 steps):
1. Find page
2. Confirm release of old editor
3. Create new editor (file check, error handling)
4. Set sourceLink on new editor
5. Call `oldEditor.beforeNavigateAway(newEditor)`
6. Check secondary survival, dispose old if not surviving
7. `page.mainEditor = newEditor`
8. `newEditor.setPage(page)`
9. `this.model.resubscribeEditor(page)`
10. Auto-select preview editor (if textFile)
11. `page.notifyMainEditorChanged()`
12. Register new editor's secondary panel
13. Send onShow/onFocus, save state

After refactor:
1. Find page
2. Confirm release of old editor
3. Create new editor (file check, error handling)
4. Set sourceLink on new editor
5. **`page.setMainEditor(newEditor)`** ← replaces steps 5–8, 11–12
6. `this.model.resubscribeEditor(page)`
7. Auto-select preview editor (if textFile)
8. Send onShow/onFocus, save state

### Step 3: Remove `getStableKey` from AppPageManager

**File:** [src/renderer/components/page-manager/AppPageManager.tsx](../../../src/renderer/components/page-manager/AppPageManager.tsx)

- Remove `getStableKey` prop from `AppPageManagerProps` interface
- Remove `const stableKey = ...` helper — replace all `stableKey(id)` with just `id`
- Remove `findGroupKeyStable` and `findGroupKeyByStableKey` helper functions — inline the simplified logic
- Update JSDoc comments referencing "stable key"

No callers pass this prop (confirmed: only `Pages.tsx` uses `AppPageManager` and doesn't pass `getStableKey`).

### Step 4: Empty pages — make `mainEditor = null` natural

**File:** [src/renderer/api/pages/PagesLifecycleModel.ts](../../../src/renderer/api/pages/PagesLifecycleModel.ts#L144)

Refactor `addEmptyPageWithNavPanel`:
```typescript
addEmptyPageWithNavPanel = (folderPath: string): PageModel => {
    const page = new PageModel(undefined, folderPath);
    page.ensurePageNavigatorModel();
    return this.addPage(null, page);
};
```

This requires `addPage` to accept `editor: EditorModel | null`:

Current signature: `addPage(editor: EditorModel, existingPage?: PageModel): PageModel`
New signature: `addPage(editor: EditorModel | null, existingPage?: PageModel): PageModel`

**Rendering impact** — Check what happens when `page.mainEditor === null`:
- [Pages.tsx](../../../src/renderer/ui/app/Pages.tsx) `renderPage()` calls `RenderEditor` with the model. Need to handle `null` gracefully — render empty content area (just the sidebar).
- [PageTab.tsx](../../../src/renderer/ui/tabs/PageTab.tsx) reads `page.mainEditor?.state.use()` — already handles null via `?.`
- Title: `page.title` already returns `"Empty"` when `mainEditor` is null

**Files to check for `addEmptyPageWithNavPanel` callers (4 locations):**
- [MenuBar.tsx:409](../../../src/renderer/ui/sidebar/MenuBar.tsx#L409) — Script library folder
- [ScriptPanel.tsx:347](../../../src/renderer/editors/text/ScriptPanel.tsx#L347) — Script panel
- [tree-context-menus.tsx:31](../../../src/renderer/content/tree-context-menus.tsx#L31) — Folder double-click
- [PagesLifecycleModel.ts:267](../../../src/renderer/api/pages/PagesLifecycleModel.ts#L267) — `openFileAsArchive`

All callers should work unchanged (they use `addEmptyPageWithNavPanel` which returns `PageModel`).

### Step 5: Simplify `movePageIn` to use PageDescriptor format

**File:** [src/renderer/api/pages/PagesLifecycleModel.ts](../../../src/renderer/api/pages/PagesLifecycleModel.ts#L527)

Current `movePageIn` receives old-format data with `hasNavigator`/`hasNavPanel` heuristics. Update to use `PageDescriptor` format:

```typescript
movePageIn = async (data?: {
    page: PageDescriptor;  // was: Partial<IEditorState>
    targetPageId: string | undefined;
}) => {
    if (!data?.page?.editor) return;

    const editor = await this.newEditorModelFromState(data.page.editor);
    editor.applyRestoreData(data.page.editor);
    await editor.restore();

    const page = new PageModel(data.page.id);  // preserve page ID
    page.mainEditor = editor;
    editor.setPage(page);

    if (data.page.hasSidebar) {
        // Restore sidebar from cache (keyed by page ID)
        await page.restoreSidebar();
    }

    // ... rest of insertion logic
};
```

Also update `movePageOut` to serialize as `PageDescriptor`:

**File:** [src/renderer/api/pages/PagesLifecycleModel.ts](../../../src/renderer/api/pages/PagesLifecycleModel.ts#L579)

```typescript
movePageOut = async (pageId?: string) => {
    const page = this.model.query.findPage(pageId);
    if (!page) return;
    await page.saveState();
    // ... existing close/detach logic
};
```

**IPC layer:** Update the IPC message payload types.

**Files:**
- [src/main/open-windows.ts](../../../src/main/open-windows.ts) — `movePageToWindow` sends/receives PageDescriptor
- [src/renderer/api/internal/RendererEventsService.ts](../../../src/renderer/api/internal/RendererEventsService.ts) — IPC handler
- [src/ipc/](../../../src/ipc/) — message type definitions
- [src/main/drag-model.ts](../../../src/main/drag-model.ts) — drag handler

### Step 6: Clean up `addEmptyPage`

**File:** [src/renderer/api/pages/PagesLifecycleModel.ts](../../../src/renderer/api/pages/PagesLifecycleModel.ts#L138)

Current `addEmptyPage` also creates a fake TextFileModel. After Step 4, evaluate if it should also create a `null`-editor page, or if it should remain as-is (creates an actual empty text file for typing).

**Decision needed:** `addEmptyPage()` (Ctrl+N) should probably keep creating a TextFileModel — the user expects a blank text file to type in. Only `addEmptyPageWithNavPanel()` should create a truly empty page. No change needed here.

## Concerns / Open Questions

### A. `setMainEditor` vs raw setter

The raw `mainEditor` setter (Step 1) is still needed for:
- `addPage()` — setting initial editor without dispose/beforeNavigateAway semantics
- Persistence restore — setting editor without notifications
- `dispose()` — setting to null without triggering notifications

Should we keep both? **Proposed: Yes.** Raw setter for internal/lifecycle use. `setMainEditor()` for navigation use.

### B. Empty page rendering

When `mainEditor === null`, `RenderEditor` in `Pages.tsx` receives no model. Need to verify it renders gracefully — possibly just an empty area with the sidebar. This needs a code check in:
- [Pages.tsx NavigationWrapper](../../../src/renderer/ui/app/Pages.tsx)
- [RenderEditor](../../../src/renderer/ui/app/RenderEditor.tsx)

### C. `movePageIn` backward compat

The move-page IPC crosses window boundaries. If one window is old version and another is new — this is extremely unlikely (same app, same Electron process), so no backward compat needed.

### D. `addEmptyPage` behavior

Keep as-is (creates TextFileModel). This is Ctrl+N behavior — user expects a blank text document.

## Acceptance Criteria

- [ ] `PageModel.setMainEditor()` method exists and handles full lifecycle
- [ ] `navigatePageTo` uses `setMainEditor()` — fewer explicit steps
- [ ] `getStableKey` prop removed from `AppPageManager` — all references use page ID directly
- [ ] `addEmptyPageWithNavPanel` creates a page with `mainEditor = null`
- [ ] Empty pages render correctly (sidebar visible, empty content area)
- [ ] `movePageIn`/`movePageOut` use `PageDescriptor` format (page ID preserved across windows)
- [ ] All 4 callers of `addEmptyPageWithNavPanel` still work correctly
- [ ] App starts, tabs work, navigation works, multi-window transfer works

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/api/pages/PageModel.ts` | Add `setMainEditor()` method |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Simplify `navigatePageTo`, refactor `addEmptyPageWithNavPanel`, update `movePageIn`/`movePageOut` |
| `src/renderer/api/pages/PagesModel.ts` | Update `addPage` signature if needed |
| `src/renderer/components/page-manager/AppPageManager.tsx` | Remove `getStableKey` prop and helpers |
| `src/renderer/ui/app/Pages.tsx` | Handle `mainEditor === null` in render |
| `src/renderer/ui/app/RenderEditor.tsx` | Handle null model gracefully |
| `src/main/open-windows.ts` | Update to PageDescriptor format |
| `src/renderer/api/internal/RendererEventsService.ts` | Update IPC handler types |
| `src/ipc/` | Update message type definitions |
| `src/main/drag-model.ts` | Update drag payload type |
