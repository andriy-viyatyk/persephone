# US-314: Secondary Editor Registry

**Status:** Planned
**Epic:** EPIC-016 (Phase 1.2)
**Created:** 2026-04-01
**Depends on:** US-313 (Secondary editor lifecycle)

## Goal

Create a lightweight registry that maps `secondaryEditor` string values to React sidebar components. Add `secondaryEditor` getter/setter to PageModel that manages the model's membership in `NavigationData.secondaryModels[]`. Add `beforeNavigateAway()` lifecycle hook for navigation survival. Add `restoreSecondaryModels()` to NavigationData for app restart / multi-window transfer.

## Background

### Revised design (from architectural discussion)

The secondary editor is **not a separate model** — it's a React component that receives the current PageModel. The PageModel itself holds all the state the secondary editor needs.

```
SecondaryEditorRegistry: "zip-tree"       → ZipSecondaryEditor component
                         "link-category"  → LinksCategoryEditor component
                         "regex-tool"     → RegexToolEditor component

PageNavigator renders:
  <Explorer />
  <Search />
  {navigationData.secondaryModels.map(m => {
      const Component = resolveSecondaryEditor(m.secondaryEditor);
      return <Component model={m} />;
  })}
```

### How `secondaryEditor` works

`secondaryEditor` is a new field on `IPageState` (similar to `editor`). The active editor on a page decides when to set/clear it:

| Page | Active Editor | secondaryEditor |
|---|---|---|
| .zip file | zip-view | `"zip-tree"` |
| .link.json | link-view | `"link-category"` |
| .link.json | monaco (user switched) | `undefined` (removed) |
| any text | monaco | `"regex-tool"` (optional) |
| JSON file | grid-json | `undefined` |

The getter/setter on PageModel handles the NavigationData integration:
- **Set:** adds `this` to `navigationData.secondaryModels[]`
- **Clear:** removes `this` from `navigationData.secondaryModels[]`

### Survival across navigation

1. ZipPageModel sets `secondaryEditor = "zip-tree"` → added to `secondaryModels[]`
2. User clicks file **inside** the zip tree → `navigatePageTo()` creates new page with `sourceLink.metadata.sourceId === zipModel.id`
3. `oldModel.beforeNavigateAway(newModel)` — ZipPageModel checks `newModel.sourceLink` → matches its own ID → **keeps** `secondaryEditor` → stays in `secondaryModels[]`
4. NavigationData transferred. Zip tree panel still renders alongside the new file.

Contrast with navigating to an **unrelated** file:
1. User opens a different file (not from zip tree) → new page's `sourceLink` has no matching `sourceId`
2. `oldModel.beforeNavigateAway(newModel)` — ZipPageModel checks → no match → **clears** `secondaryEditor` → removed from `secondaryModels[]`, model disposed
3. Zip tree panel disappears.

### Existing restore flow

The existing `PagesLifecycleModel.newPageModelFromState()` already handles `state.type` → editor → module → model creation. For secondary model restore, we reuse this same chain.

### Key code locations

| What | File |
|---|---|
| Editor registry | `src/renderer/editors/registry.ts` |
| EditorModule factories | `src/renderer/editors/types.ts` |
| newPageModelFromState (private) | `src/renderer/api/pages/PagesLifecycleModel.ts:70-86` |
| PagesPersistenceModel.restoreModel | `src/renderer/api/pages/PagesPersistenceModel.ts:39-54` |
| NavigationData.pendingSecondaryDescriptors | `src/renderer/ui/navigation/NavigationData.ts` |
| NavigationData.secondaryModels[] | `src/renderer/ui/navigation/NavigationData.ts` |
| PageModel.confirmRelease | `src/renderer/editors/base/PageModel.ts:61-70` |
| IPageState | `src/shared/types.ts` |

## Implementation Plan

### Step 1: Add `secondaryEditor` field to IPageState

**File:** `src/shared/types.ts`

```typescript
export interface IPageState {
    // ... existing fields ...
    /** Active secondary editor panel ID (e.g., "zip-tree", "link-category"). */
    secondaryEditor?: string;
}
```

This is persisted — survives app restart and multi-window transfer.

### Step 2: Add `secondaryEditor` getter/setter and `beforeNavigateAway()` to PageModel

**File:** `src/renderer/editors/base/PageModel.ts`

```typescript
/** Active secondary editor panel ID. Setting adds this model to
 *  NavigationData.secondaryModels[]; clearing removes it. */
get secondaryEditor(): string | undefined {
    return this.state.get().secondaryEditor;
}

set secondaryEditor(value: string | undefined) {
    const prev = this.state.get().secondaryEditor;
    if (prev === value) return;
    this.state.update((s) => { s.secondaryEditor = value; });
    if (value) {
        this.navigationData?.addSecondaryModel(this);
    } else {
        this.navigationData?.removeSecondaryModelWithoutDispose(this);
    }
}

/**
 * Called before the page is replaced during navigation (navigatePageTo).
 * @param newModel — the model that is replacing this page. Inspect
 *   newModel.sourceLink to decide whether to keep secondaryEditor set.
 *
 * Base implementation clears secondaryEditor (model removed from sidebar).
 * Subclasses override to conditionally keep:
 *   - ZipPageModel: keeps if newModel.sourceLink?.metadata?.sourceId === this.id
 *   - LinksPageModel: keeps if newModel was opened from this link collection
 */
beforeNavigateAway(newModel: PageModel): void {
    this.secondaryEditor = undefined;
}
```

### Step 3: Update NavigationData.removeSecondaryModel

**File:** `src/renderer/ui/navigation/NavigationData.ts`

The current `removeSecondaryModel()` calls `model.dispose()`. But the setter needs a version that removes WITHOUT disposing (the model may still be alive as a primary page). Split into two methods:

```typescript
/** Remove a secondary editor model and dispose it (panel closed by user). */
removeSecondaryModel(model: PageModel): void {
    const idx = this.secondaryModels.indexOf(model);
    if (idx < 0) return;
    this.secondaryModels.splice(idx, 1);
    if (this.activePanel === model.id) {
        this.activePanel = "explorer";
    }
    model.dispose();
    this._saveStateDebounced();
}

/** Remove a secondary editor model WITHOUT disposing (model cleared its secondaryEditor). */
removeSecondaryModelWithoutDispose(model: PageModel): void {
    const idx = this.secondaryModels.indexOf(model);
    if (idx < 0) return;
    this.secondaryModels.splice(idx, 1);
    if (this.activePanel === model.id) {
        this.activePanel = "explorer";
    }
    this._saveStateDebounced();
}
```

### Step 4: Wire `beforeNavigateAway()` into `navigatePageTo()`

**File:** `src/renderer/api/pages/PagesLifecycleModel.ts`

Call `beforeNavigateAway(newModel)` on the old model **after** the new model is created but **before** detaching NavigationData. The old model receives the new model so it can inspect `newModel.sourceLink` to decide whether to keep itself in `secondaryModels[]`.

```typescript
navigatePageTo = async (pageId, newFilePath, options?) => {
    const oldModel = this.model.query.findPage(pageId);
    if (!oldModel) return false;

    const released = await oldModel.confirmRelease();
    if (!released) return false;

    const wasPinned = oldModel.state.get().pinned;
    const navigationData = oldModel.navigationData;

    // Create new model BEFORE beforeNavigateAway so old model can inspect it
    let newModel: PageModel;
    // ... existing newModel creation logic (file existence check, createPageFromFile, etc.) ...

    // Give old model a chance to keep/clear its secondary editor status
    oldModel.beforeNavigateAway(newModel);

    // If oldModel kept itself in secondaryModels[], detach it from the page
    // collection WITHOUT disposing (it lives on in NavigationData).
    // If oldModel cleared its secondaryEditor, dispose normally.
    const survivesAsSecondary = navigationData?.secondaryModels.includes(oldModel);
    oldModel.navigationData = null;
    if (!survivesAsSecondary) {
        await oldModel.dispose();
    }
    this.model.detachPage(oldModel);
    // ... rest of navigation (create newModel if not yet, attach, transfer navigationData) ...
```

**Why newModel is passed:** The old model needs to know WHERE the user is navigating to decide whether to stay as a secondary editor. For example:
- ZipPageModel checks `newModel.sourceLink?.metadata?.sourceId === this.id` — if the user clicked a file inside this archive, keep the zip tree; otherwise remove it.
- Base PageModel ignores newModel and always clears `secondaryEditor`.

This is why Phase 0 (US-312, sourceLink persistence) was a prerequisite — it provides the identity metadata that `beforeNavigateAway()` inspects.

### Step 5: Create secondary editor registry

**File:** `src/renderer/ui/navigation/secondary-editor-registry.ts` (new file)

```typescript
import type React from "react";
import type { PageModel } from "../../editors/base";

/** Props passed to secondary editor sidebar components. */
export interface SecondaryEditorProps {
    model: PageModel;
}

/** Registration for a secondary editor type. */
interface SecondaryEditorDefinition {
    /** Unique ID matching IPageState.secondaryEditor values. */
    id: string;
    /** Display label for the panel header. */
    label: string;
    /** Dynamic import of the sidebar component. */
    loadComponent: () => Promise<React.ComponentType<SecondaryEditorProps>>;
}

class SecondaryEditorRegistry {
    private editors = new Map<string, SecondaryEditorDefinition>();

    register(definition: SecondaryEditorDefinition): void {
        this.editors.set(definition.id, definition);
    }

    get(id: string): SecondaryEditorDefinition | undefined {
        return this.editors.get(id);
    }

    has(id: string): boolean {
        return this.editors.has(id);
    }
}

export const secondaryEditorRegistry = new SecondaryEditorRegistry();
```

### Step 6: Add `restoreSecondaryModels()` to NavigationData

**File:** `src/renderer/ui/navigation/NavigationData.ts`

The method receives the `ownerModel` — the primary page that owns this NavigationData. This is needed to deduplicate: when the primary page is also a secondary editor (e.g., ZipPageModel is both the active page and in `secondaryModels[]`), the same model instance appears in both `WindowState.pages[]` and `NavigationData.secondaryModelDescriptors[]`. On restore, the primary page is created first by `PagesPersistenceModel`; we must reuse that instance instead of creating a duplicate.

```typescript
/** Restore secondary editor models from pending descriptors.
 *  @param ownerModel — the primary page that owns this NavigationData.
 *    If a descriptor has the same ID as ownerModel, reuse it (no duplicate). */
async restoreSecondaryModels(ownerModel: PageModel): Promise<void> {
    const descriptors = this.pendingSecondaryDescriptors;
    if (!descriptors?.length) return;
    this.pendingSecondaryDescriptors = undefined;

    const { pagesModel } = await import("../../api/pages");

    for (const desc of descriptors) {
        // Deduplicate: if this descriptor matches the owner page, reuse it
        if (desc.pageState.id === ownerModel.id) {
            this.secondaryModels.push(ownerModel);
            continue;
        }

        try {
            const model = await pagesModel.lifecycle.newPageModelFromState(desc.pageState);
            model.applyRestoreData(desc.pageState);
            await model.restore();
            this.secondaryModels.push(model);
        } catch (err) {
            console.warn("[NavigationData] Failed to restore secondary model:", err);
        }
    }
}
```

Called from `PageModel.restore()` after NavigationData is ready, passing `this` as ownerModel:

```typescript
// In PageModel.restore():
async restore(): Promise<void> {
    if (this.needsNavigatorRestore || ...) {
        // ... existing NavigationData restore ...
        const navData = new NavigationData("");
        await navData.restore(this.id);
        this.navigationData = navData;

        // Restore secondary models — pass this as owner for deduplication
        await navData.restoreSecondaryModels(this);

        this.state.update((s) => { s.hasNavigator = true; });
    }
}
```

### Step 7: Make `newPageModelFromState` public

**File:** `src/renderer/api/pages/PagesLifecycleModel.ts`

```typescript
// Change from:
private newPageModelFromState = async (...)
// To:
newPageModelFromState = async (...)
```

### Step 8: Restore `secondaryEditor` in `applyRestoreData()`

**File:** `src/renderer/editors/base/PageModel.ts`

Add to the existing `applyRestoreData()`:

```typescript
if ((data as any).secondaryEditor) s.secondaryEditor = (data as any).secondaryEditor;
```

## Files Changed Summary

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `secondaryEditor?: string` to `IPageState` |
| `src/renderer/editors/base/PageModel.ts` | Add `secondaryEditor` getter/setter, `beforeNavigateAway()`, restore `secondaryEditor` in `applyRestoreData()` |
| `src/renderer/ui/navigation/NavigationData.ts` | Split `removeSecondaryModel` into dispose/no-dispose variants, add `restoreSecondaryModels()`, call from `restore()` |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Make `newPageModelFromState` public, call `beforeNavigateAway()` in `navigatePageTo()` |
| `src/renderer/ui/navigation/secondary-editor-registry.ts` | **New file** — SecondaryEditorRegistry, SecondaryEditorProps, singleton |

## Files NOT Changed

| File | Why |
|---|---|
| `PageNavigator.tsx` | UI rendering of secondary panels is task 1.5 |
| `register-editors.ts` | No secondary editor registrations yet (tasks 1.4, 2.1) |

## Concerns

### 1. Circular import: NavigationData → pagesModel — Resolved

`restoreSecondaryModels()` uses dynamic `await import("../../api/pages")` — no circular dependency at module load time.

### 2. Deduplication: primary page is also a secondary editor — Resolved

When a ZipPageModel is the active page, it's both in `WindowState.pages[]` and in `NavigationData.secondaryModels[]` — same instance. On persist, both paths serialize the model's state. On restore:

1. `PagesPersistenceModel.restoreState()` creates ZipPageModel (id: "abc-123") as primary page
2. `PageModel.restore()` → `NavigationData.restore()` → loads `secondaryModelDescriptors[]` including id "abc-123"
3. `restoreSecondaryModels(ownerModel)` receives the primary page as `ownerModel`
4. Descriptor id "abc-123" matches `ownerModel.id` → **reuses existing instance** (no duplicate)

Result: same model instance in both primary page and `secondaryModels[]`, exactly like before close.

### 3. Setter side effects during restore

When `applyRestoreData()` sets `secondaryEditor` in state, the getter/setter on PageModel would try to call `navigationData.addSecondaryModel(this)`. But during restore, `navigationData` may not be attached yet.

**Mitigation:** `applyRestoreData()` sets state directly (via `state.update()`), not via the setter. The setter is a property defined with `get`/`set` on the class — `state.update(s => { s.secondaryEditor = value })` writes to the Immer draft, not through the setter. So no side effect. The `restoreSecondaryModels()` method adds models directly to the array (bypassing the setter).

### 4. Registry lives in `ui/navigation/` not `editors/`

The secondary editor registry is placed in `ui/navigation/` because it's tightly coupled with NavigationData and PageNavigator. The existing editor registry in `editors/` handles content-area editors, not sidebar panels.

### 5. Merging tasks 1.2 and 1.3

The original epic had task 1.2 (registry) and 1.3 (add `isSecondaryEditor` to PageModel) as separate. With the new design, they naturally merge into a single task: the registry, the `secondaryEditor` property, and `beforeNavigateAway()` are all tightly coupled. Task 1.3 in the epic should be removed or marked as absorbed by 1.2.

## Acceptance Criteria

- [ ] `secondaryEditor?: string` field added to `IPageState`
- [ ] `secondaryEditor` getter/setter on PageModel manages `secondaryModels[]` membership
- [ ] `beforeNavigateAway(newModel)` on PageModel clears `secondaryEditor` (base) — overridable by subclasses
- [ ] `beforeNavigateAway(newModel)` called in `navigatePageTo()` after new model creation, before NavigationData transfer
- [ ] `removeSecondaryModelWithoutDispose()` added to NavigationData
- [ ] `SecondaryEditorRegistry` class with `register()`, `get()`, `has()` and `label` support
- [ ] `restoreSecondaryModels(ownerModel)` on NavigationData processes pending descriptors
- [ ] Deduplication: when descriptor ID matches ownerModel ID, reuses existing instance (no duplicate)
- [ ] `restoreSecondaryModels()` called from `PageModel.restore()` after NavigationData is ready
- [ ] `PagesLifecycleModel.newPageModelFromState` is public
- [ ] `secondaryEditor` restored in `applyRestoreData()`
- [ ] `navigatePageTo` skips dispose for models that survive as secondary (kept `secondaryEditor`)
- [ ] TypeScript compiles cleanly
