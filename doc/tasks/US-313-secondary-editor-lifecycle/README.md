# US-313: Design Secondary Editor Lifecycle

**Status:** Planned
**Epic:** EPIC-016 (Phase 1.1)
**Created:** 2026-03-31
**Depends on:** US-312 (Source link persistence)

## Goal

Extend NavigationData to hold an array of secondary editor models (`secondaryModels[]`). Define the lifecycle rules: how page models become secondary editors (survive navigation), how they're owned and disposed, and how tab close handles secondary editors with unsaved changes.

This task establishes the **data model and lifecycle** only. The **registry** (1.2), **PageModel.isSecondaryEditor** (1.3), and **PageNavigator UI rendering** (1.5) are separate tasks.

## Background

### Current secondary provider design

NavigationData currently supports ONE secondary provider (for zip archives) via a simple descriptor pattern:

```
NavigationData
  ├── treeProvider            // FileTreeProvider (Explorer panel)
  ├── secondaryDescriptor     // { type: "zip", sourceUrl, label }
  ├── secondaryProvider       // Lazily created ZipTreeProvider
  ├── secondarySelectionState // TOneState<NavigationState>
  ├── secondaryTreeState      // TreeProviderViewSavedState
  └── activePanel             // "explorer" | "search" | "secondary"
```

**Limitations:**
- Only ONE secondary provider (no array)
- Provider is a standalone `ITreeProvider`, not a full `PageModel`
- No unsaved-changes handling (ZipTreeProvider is read-only)
- No lifecycle hooks (no "survive navigation" mechanism)
- Descriptor is a simple object, not a page model

### What secondary editors need

EPIC-016 replaces this with full PageModel instances as secondary editors:
- **ZipPageModel** — archive browsing (replaces standalone ZipTreeProvider)
- **LinksPageModel** — `.link.json` browsing with encryption support
- **DOMSecondaryEditor** — HTML DOM resource tree
- **Future:** RegexSecondaryEditor, outline view, etc.

Each is a full PageModel with state, dispose, save/restore, and potentially unsaved changes.

### Multi-window page transfer (tab drag between windows)

The transfer flow does NOT dispose the page — it detaches and preserves cache:
1. **Source:** `movePageOut()` → `page.saveState()` (flush caches) → `detachPage()` (no dispose, cache survives)
2. **Main process:** Routes `Partial<IPageState>` from source to target via IPC
3. **Target:** `movePageIn()` → creates new PageModel → `applyRestoreData()` → `restore()` → reconstructs NavigationData from cache files using same page ID

**Key files:** `PagesLifecycleModel.ts:513-563`, `open-windows.ts:207-235`, `RendererEventsService.ts:59-73`

Secondary models must follow the same pattern: their state is saved as part of NavigationData's cache, and their individual cache files survive because `dispose()` is never called during transfer.

### Key code locations

| What | File | Lines |
|---|---|---|
| NavigationData class | `src/renderer/ui/navigation/NavigationData.ts` | 59-388 |
| SecondaryDescriptor | `NavigationData.ts` | 17-25 |
| setSecondaryDescriptor() | `NavigationData.ts` | 146-158 |
| createSecondaryProvider() | `NavigationData.ts` | 165-183 |
| NavigationData.dispose() | `NavigationData.ts` | 378-387 |
| NavigationSavedState | `NavigationData.ts` | 27-45 |
| PageNavigator panel rendering | `PageNavigator.tsx` | 376-437 |
| navigatePageTo() | `PagesLifecycleModel.ts` | 363-469 |
| NavigationData transfer | `PagesLifecycleModel.ts` | 379-385, 461-465 |
| PageModel.dispose() | `PageModel.ts` | 65-71 |
| PageModel.confirmRelease() | `PageModel.ts` | 61-63 |
| PagesModel.attachPage() onClose | `PagesModel.ts` | 59-70 |
| CollapsiblePanelStack | `components/layout/CollapsiblePanelStack.tsx` | full |

### NavigationData transfer during navigation (critical pattern)

In `navigatePageTo()`:
1. `navigationData = oldModel.navigationData` — extract reference
2. `oldModel.navigationData = null` — detach (prevents dispose)
3. `oldModel.dispose()` — disposes page model but NOT navigation data
4. Create new page model
5. `newModel.navigationData = navigationData` — transfer
6. `navigationData.updateId(newModel.id)` — update cache key

**This pattern is the foundation** — secondary models in NavigationData survive navigation the same way NavigationData itself does.

## Implementation Plan

### Step 1: Add `secondaryModels[]` to NavigationData

**File:** `src/renderer/ui/navigation/NavigationData.ts`

Add a new array alongside the existing secondary provider fields:

```typescript
// ── Secondary editor models ─────────────────────────────────────
/** Page models that act as secondary editors (survive navigation). */
secondaryModels: PageModel[] = [];
```

**Design:** The array holds full PageModel instances. Each model:
- Has its own `state` (IPageState with title, modified, etc.)
- Has its own `pipe` (for content I/O — e.g., encrypted `.link.json`)
- Can have unsaved changes (`state.get().modified`)
- Has `confirmRelease()` for save prompts
- Has `dispose()` for cleanup

### Step 2: Add secondary model management methods

**File:** `src/renderer/ui/navigation/NavigationData.ts`

```typescript
/** Add a page model as a secondary editor. */
addSecondaryModel(model: PageModel): void {
    if (this.secondaryModels.includes(model)) return;
    this.secondaryModels.push(model);
    this._saveStateDebounced();
}

/** Remove and dispose a secondary editor model. */
removeSecondaryModel(model: PageModel): void {
    const idx = this.secondaryModels.indexOf(model);
    if (idx < 0) return;
    this.secondaryModels.splice(idx, 1);
    model.dispose();
    // If active panel was showing this model, fall back
    if (this.activePanel === model.id) {
        this.activePanel = "explorer";
    }
    this._saveStateDebounced();
}

/** Find a secondary model by its page ID. */
findSecondaryModel(pageId: string): PageModel | undefined {
    return this.secondaryModels.find((m) => m.state.get().id === pageId);
}
```

### Step 3: activePanel type expansion

**File:** `src/renderer/ui/navigation/NavigationData.ts`

Currently `activePanel` is `"explorer" | "search" | "secondary"`. With multiple secondary models, each needs its own panel identity.

```typescript
/** Which panel is currently active/expanded. */
activePanel: string = "explorer";
// Values: "explorer", "search", or a secondary model's page ID
```

The `"secondary"` literal is replaced by the model's `id` string. This naturally supports multiple secondary panels — each identified by its PageModel ID.

**Migration:** On restore, if `activePanel === "secondary"` (old format), map it to the first secondary model's ID or fall back to "explorer".

### Step 4: Dispose secondary models on NavigationData.dispose()

**File:** `src/renderer/ui/navigation/NavigationData.ts`

Update the existing `dispose()` method:

```typescript
dispose(): void {
    this._unsubscribe?.();
    this._unsubscribe = undefined;
    this.treeProvider?.dispose?.();
    this.treeProvider = null;
    this.secondaryProvider?.dispose?.();
    this.secondaryProvider = null;
    // Dispose all secondary editor models
    for (const model of this.secondaryModels) {
        model.dispose();
    }
    this.secondaryModels = [];
    this.pageNavigatorModel?.dispose();
    this.pageNavigatorModel = null;
}
```

### Step 5: Tab close with secondary editors — save prompts

**File:** `src/renderer/api/pages/PagesLifecycleModel.ts` (or nearby)

When a tab closes, the flow is: `page.close()` → `onClose()` → `detachPage()` → `removePage()` → `page.dispose()`.

`page.dispose()` calls `navigationData.dispose()` which will dispose all secondary models. But we need to **prompt for unsaved changes first**.

Modify the close flow to check secondary models before proceeding:

```typescript
// In the close logic (before disposing the page):
async confirmSecondaryRelease(navigationData: NavigationData): Promise<boolean> {
    for (const model of navigationData.secondaryModels) {
        if (!model.state.get().modified) continue;
        const released = await model.confirmRelease();
        if (!released) return false; // User cancelled — abort tab close
    }
    return true;
}
```

**Where to hook this in:** The `canClose` callback set by `attachPage()`. Currently it calls `page.confirmRelease()`. We extend it to also call `confirmSecondaryRelease()` for the page's NavigationData.

### Step 6: Persist secondary model state

**File:** `src/renderer/ui/navigation/NavigationData.ts`

Add secondary model descriptors to `NavigationSavedState`:

```typescript
interface NavigationSavedState {
    // ... existing fields ...
    /** Descriptors for secondary editor models (for restore). */
    secondaryModelDescriptors?: SecondaryModelDescriptor[];
}

interface SecondaryModelDescriptor {
    /** Serialized page state (from model.getRestoreData()). */
    pageState: Partial<IPageState>;
}
```

In `_saveState()`:
```typescript
saved.secondaryModelDescriptors = this.secondaryModels.map((m) => ({
    pageState: m.getRestoreData(),
}));
```

In `restore()`:
```typescript
if (parsed.secondaryModelDescriptors?.length) {
    // Defer actual model creation to a separate async step
    // (models need dynamic imports based on editor type)
    this._pendingSecondaryDescriptors = parsed.secondaryModelDescriptors;
}
```

**Concern:** Restoring secondary models requires knowing which PageModel subclass to create (ZipPageModel, LinksPageModel, etc.). This depends on the **secondary editor registry** (task 1.2). For now, store the descriptors and add a `restoreSecondaryModels()` method that task 1.2 will implement.

### Step 7: Multi-window page transfer (tab drag between windows)

**Understanding the current flow:**

When a tab is dragged outside its window:

1. **Source window** — `movePageOut(pageId)` (`PagesLifecycleModel.ts:543-563`):
   - Calls `page.saveState()` — flushes NavigationData cache to disk
   - Sets `page.skipSave = true`
   - Calls `detachPage()` (NOT `dispose()`) — unsubscribes but preserves cache files
   - Calls `removePage()` — removes from arrays
   - **No cache cleanup** — cache files survive on disk

2. **Main process** — `movePageToWindow()` (`open-windows.ts:207-235`):
   - Sends `eMovePageOut` to source (just page ID)
   - Creates target window if needed
   - Awaits `whenReady` on target
   - Sends `eMovePageIn` with `{ page: Partial<IPageState> }` to target

3. **Target window** — `movePageIn(data)` (`PagesLifecycleModel.ts:513-541`):
   - Creates new PageModel via `newPageModelFromState(data.page)`
   - Calls `applyRestoreData()` — reconstructs pipe from descriptor
   - Calls `restore()` — sees `hasNavigator=true`, creates NavigationData, restores from cache files using page ID

**Key insight:** NavigationData survives transfer because:
- `saveState()` writes to disk before move
- `detachPage()` does NOT delete cache files (no `dispose()`)
- Target window restores NavigationData from the same cache files using the same page ID

**What secondaryModels[] needs:**

Secondary models must follow the same pattern. During `saveState()` (Step 6 above), secondary model descriptors are already saved as part of NavigationData's cache. But each secondary model may also have its **own cache files** (e.g., unsaved content in a LinksPageModel).

Add a `saveState()` method to secondary models in the save flow:

```typescript
// In NavigationData._saveState():
// Flush secondary model caches BEFORE saving their descriptors
for (const model of this.secondaryModels) {
    await model.saveState?.();
}
saved.secondaryModelDescriptors = this.secondaryModels.map((m) => ({
    pageState: m.getRestoreData(),
}));
```

On restoration in the target window, `NavigationData.restore()` reads the descriptors. Task 1.2 (registry) provides the factory to recreate the correct PageModel subclass. Each recreated model calls its own `restore()` which loads its individual cache files.

**Critical rule:** `removeSecondaryModel()` must call `model.dispose()` (which deletes cache files). But during `movePageOut()`, secondary models are NOT disposed — they're just detached. The cache files persist for the target window.

### Step 8: Keep existing secondary provider pattern (backward compatibility)

The current `secondaryDescriptor` / `secondaryProvider` / `createSecondaryProvider()` pattern for zip archives stays **as-is** for now. Task 1.4 (ZipPageModel) will migrate it to use `secondaryModels[]` instead. This avoids breaking the working archive panel.

## Files Changed Summary

| File | Change |
|---|---|
| `src/renderer/ui/navigation/NavigationData.ts` | Add `secondaryModels[]`, management methods, dispose integration, persistence, multi-window save support |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Add `confirmSecondaryRelease()` check in tab close flow |
| `doc/architecture/pages-architecture.md` | Expand close flow, detach path, multi-window transfer detail; add NavigationData lifecycle section and secondary models section |

## Files NOT Changed

| File | Why |
|---|---|
| `PageNavigator.tsx` | UI rendering of secondary panels is task 1.5 |
| `PageModel.ts` | `isSecondaryEditor` property is task 1.3 |
| `registry.ts` | Secondary editor registry is task 1.2 |
| `navigatePageTo()` | "Page removing" lifecycle hook is part of 1.3 (when models can declare themselves as secondary editors) |
| `movePageOut()` / `movePageIn()` | Already call `saveState()` and `restore()` which handle NavigationData — secondary models are part of that flow via NavigationData cache |

## Concerns

### 1. activePanel: string vs union type — Resolved

Changing `activePanel` from `"explorer" | "search" | "secondary"` to `string` loses type safety. However, with dynamic secondary model IDs, a fixed union is impractical.

**Mitigation:** Keep well-known values as constants (`PANEL_EXPLORER = "explorer"`, `PANEL_SEARCH = "search"`) and document that other values are secondary model IDs. The CollapsiblePanelStack already accepts string IDs.

### 2. Secondary model restore — Resolved

Restoring secondary models requires: `pageDescriptor` → determine correct PageModel subclass → dynamic import → `applyRestoreData()` + `restore()`.

**Approach:** Consider extracting this into a reusable `restoreModel(pageDescriptor)` function (potentially a page model service). Check whether existing page restore logic in `PagesPersistenceModel` / `PagesLifecycleModel.newPageModelFromState()` already does this and can be consolidated. If the logic is specific to secondary models only, implement it here but still consolidate into a single async `restoreModel(pageDescriptor)` function. The secondary editor registry (task 1.2) provides the model factories; this task stores pending descriptors and provides the `restoreSecondaryModels()` method signature.

### 3. Tab close confirmation UX — Deferred

The idea of expanding/highlighting the secondary panel before the save dialog is a future UI polish. For now, `confirmSecondaryRelease()` just iterates models and calls `confirmRelease()`. Visual feedback belongs in task 1.5.

### 4. Interaction with existing secondary provider — Resolved

Both `secondaryModels[]` (new) and `secondaryProvider` (old) coexist temporarily. No conflict — they use separate fields and separate panel IDs (`"secondary"` for old, model ID for new). Task 1.4 migrates zip to the new system.

### 5. Secondary models and page deduplication — Deferred

Secondary models are NOT in the pages collection (they live in NavigationData), so no conflict with `openFile()` deduplication. Activating an existing secondary panel when the user opens a file that's already a secondary model is a polishing concern for a later phase.

### 6. Multi-window transfer — Not a concern for this task

Secondary model restore requires the secondary editor registry (task 1.2) to recreate the correct PageModel subclass. Without the registry, secondary models cannot be created at all, so nothing is testable or reproducible without it. This task provides the data structures and persistence; end-to-end testing happens after task 1.4 (ZipPageModel reimplementation).

## Documentation Updates

**File:** `doc/architecture/pages-architecture.md`

The current doc has gaps that should be addressed as part of this task (fresh context from investigation):

### Section 2 — Page Lifecycle State Machine

**Current issues:**
- State machine only shows: Created → Initialized → Active/Inactive → Disposed
- Missing the **close flow detail**: `close()` → `canClose`/`confirmRelease()` → `onClose` → `detachPage()` → `removePage()` → `dispose()`
- Missing the **multi-window transfer path**: Active/Inactive → Detached (no dispose, cache survives) → reconstructed in target window

**Update:** Add a subsection after the state machine that explains the close chain and the detach-without-dispose path.

### Section 5 — Internal Operations

**Current issue:** Lists `attachPage()` / `detachPage()` but doesn't explain their lifecycle role.

**Update:** Add brief descriptions:
- `attachPage()` — subscribes to page state changes for auto-save, sets `onClose` callback that runs the dispose chain
- `detachPage()` — unsubscribes and clears `onClose` callback WITHOUT disposing. Used by `movePageOut()` and `navigatePageTo()` to preserve page resources

### Section 7 — Multi-Window Page Transfer

**Current issue:** Very brief (3 bullet points). Doesn't explain cache file survival, NavigationData reconstruction, IPC event flow, or the drag event debouncing.

**Update:** Expand with the full flow:
1. Tab drag fires `PageDragData` events to main process (debounced 100ms in `DragModel`)
2. Main process sends `eMovePageOut` to source → source calls `page.saveState()`, `detachPage()`, `removePage()` (no dispose — cache files survive)
3. Main process sends `eMovePageIn` to target (waits for `whenReady`) → target creates PageModel, `applyRestoreData()`, `restore()`
4. `restore()` reconstructs pipe from descriptor and NavigationData from cache files using page ID

### New section — NavigationData Lifecycle

**Currently missing entirely.** Add a section covering:
- NavigationData is a stable browsing context that survives page navigation
- Created once when a page first opens with a navigator
- Transferred (not recreated) during `navigatePageTo()` — detached from old model before dispose, attached to new model after creation
- Owns: primary tree provider, secondary provider/descriptor, search state, panel state
- Persisted to cache files (`flushSave()`) — restored by page ID on app restart or multi-window transfer
- Disposed when the tab closes: `PageModel.dispose()` → `NavigationData.dispose()` → disposes tree providers, secondary providers

**Source:** [`NavigationData.ts`](../../src/renderer/ui/navigation/NavigationData.ts)

### New section — Secondary Editor Models (EPIC-016)

**Add after NavigationData section.** Brief forward reference:
- NavigationData holds `secondaryModels[]` — full PageModel instances acting as sidebar editors
- Each has its own state, pipe, and potentially unsaved changes
- Disposed when their panel is closed or when the tab closes
- Survive page navigation (same as NavigationData itself)
- Persisted as descriptors in NavigationData's cache

This section can be brief initially and expanded as EPIC-016 progresses.

## Acceptance Criteria

- [ ] `NavigationData` has a `secondaryModels: PageModel[]` array
- [ ] `addSecondaryModel()`, `removeSecondaryModel()`, `findSecondaryModel()` methods work
- [ ] `activePanel` supports secondary model IDs (not just fixed union)
- [ ] `NavigationData.dispose()` disposes all secondary models
- [ ] Tab close flow checks secondary models for unsaved changes via `confirmSecondaryRelease()`
- [ ] Secondary model state is saved to NavigationData cache (descriptors)
- [ ] Restoration stores pending descriptors (actual restore deferred to task 1.2)
- [ ] Secondary model `saveState()` called during `_saveState()` (supports multi-window transfer)
- [ ] Existing secondary provider pattern for zip archives continues to work unchanged
- [ ] `doc/architecture/pages-architecture.md` updated: close flow, detach path, NavigationData lifecycle, multi-window transfer detail, secondary models section
