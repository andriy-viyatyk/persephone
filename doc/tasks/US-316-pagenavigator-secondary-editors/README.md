# US-316: Refactor PageNavigator for Secondary Editor Models

**Status:** Done
**Epic:** EPIC-016 (Phase 1.4)
**Created:** 2026-04-01
**Depends on:** US-314 (Secondary editor registry + PageModel integration)

## Goal

Make PageNavigator render secondary editor panels from `NavigationData.secondaryModels[]` using the secondary editor registry. Each model's `secondaryEditor` string resolves to a sidebar React component via the registry. Panel headers show the registry label + close button (for non-active models). Keep the old `secondaryDescriptor`/`secondaryProvider` system functional until task 1.5 (ZipPageModel) replaces it.

## Background

### Current PageNavigator panels

PageNavigator renders three panel types inside a `CollapsiblePanelStack`:

1. **Explorer** (`id="explorer"`) — always present. `TreeProviderView` with `FileTreeProvider`.
2. **Search** (`id="search"`) — conditional on `searchVisible`. `FileSearch` component.
3. **Secondary** (`id="secondary"`) — conditional on `secondaryDescriptor`. Lazily created `ZipTreeProvider` rendered in `TreeProviderView`.

The secondary panel is the old system (EPIC-015). It uses `NavigationData.secondaryDescriptor` (type/sourceUrl/label) and `NavigationData.secondaryProvider` (lazy `ZipTreeProvider`). This will be replaced by the secondary editor model system in task 1.5 (ZipPageModel).

### What this task adds

After the Explorer/Search/Secondary panels, render additional panels from `secondaryModels[]`:

```
CollapsiblePanelStack
  ├── Explorer (always)
  ├── Search (if active)
  ├── Secondary (old system, if secondaryDescriptor set)  ← kept for now
  └── {secondaryModels.map(m => <SecondaryEditorPanel />)}  ← NEW
```

Each secondary model has `secondaryEditor: string` (e.g., `"zip-tree"`, `"link-category"`). The secondary editor registry maps this to a React component loaded via dynamic import.

### Key code locations

| What | File |
|---|---|
| PageNavigator | `src/renderer/ui/navigation/PageNavigator.tsx` |
| CollapsiblePanelStack | `src/renderer/components/layout/CollapsiblePanelStack.tsx` |
| NavigationData | `src/renderer/ui/navigation/NavigationData.ts` |
| Secondary editor registry | `src/renderer/ui/navigation/secondary-editor-registry.ts` |
| PageNavigator mounting | `src/renderer/ui/app/Pages.tsx` (NavigationWrapper → NavigationContent) |
| PageModel.secondaryEditor | `src/renderer/editors/base/PageModel.ts` |

## Implementation Plan

### Step 1: Make `secondaryModels` reactive

**File:** `src/renderer/ui/navigation/NavigationData.ts`

**Problem:** `secondaryModels` is a plain `PageModel[]` array. When models are added/removed, PageNavigator doesn't re-render — there's no reactive subscription.

**Solution:** Keep the plain array for all imperative code, add a reactive version counter alongside. PageNavigator subscribes to the counter via `.use()` — when it changes, React re-renders and reads the current array.

```typescript
// In NavigationData class:
/** Reactive version counter — incremented on secondaryModels changes.
 *  PageNavigator subscribes via .use() for re-render on add/remove. */
readonly secondaryModelsVersion = new TOneState({ version: 0 });

private _bumpSecondaryVersion(): void {
    this.secondaryModelsVersion.update((s) => { s.version++; });
}
```

Call `_bumpSecondaryVersion()` in:
- `addSecondaryModel()` — after push
- `removeSecondaryModel()` — after splice
- `removeSecondaryModelWithoutDispose()` — after splice
- `restoreSecondaryModels()` — once at end, after all models are added

In PageNavigator:
```typescript
// Subscribe to reactive version counter — triggers re-render on change
navigationData.secondaryModelsVersion.use();
// Read the plain array (re-render already triggered by version change)
const secondaryModels = navigationData.secondaryModels;
```

**Why a version counter instead of putting PageModel[] in TOneState:** PageModel instances are complex class objects with methods. Storing them inside TOneState risks future misuse — if someone calls `.update()` (which uses Immer), Immer proxies would silently corrupt the class instances. A simple numeric counter in TOneState is safe and sufficient.

**Import needed:** `TOneState` is already imported in NavigationData.ts (used for `selectionState`).

### Step 2: Create `LazySecondaryEditor` wrapper component

**File:** `src/renderer/ui/navigation/LazySecondaryEditor.tsx` (new)

A Suspense-friendly wrapper that loads the secondary editor component from the registry and renders it.

```typescript
import { useEffect, useState, type ComponentType } from "react";
import { secondaryEditorRegistry, type SecondaryEditorProps } from "./secondary-editor-registry";

interface LazySecondaryEditorProps {
    model: PageModel;
    editorId: string;
}

export function LazySecondaryEditor({ model, editorId }: LazySecondaryEditorProps) {
    const [Component, setComponent] = useState<ComponentType<SecondaryEditorProps> | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const def = secondaryEditorRegistry.get(editorId);
        if (!def) {
            setError(`Unknown secondary editor: "${editorId}"`);
            return;
        }
        let cancelled = false;
        def.loadComponent().then((mod) => {
            if (!cancelled) setComponent(() => mod.default);
        }).catch((err) => {
            if (!cancelled) setError(String(err));
        });
        return () => { cancelled = true; };
    }, [editorId]);

    if (error) return <div style={{ padding: 8 }}>{error}</div>;
    if (!Component) return null; // Loading — panel header still visible
    return <Component model={model} />;
}
```

**Why not React.lazy:** `React.lazy` requires a module-level factory call and cannot receive runtime parameters (editorId). The manual loading pattern gives us control over the loading state and error handling.

### Step 3: Render secondary model panels in PageNavigator

**File:** `src/renderer/ui/navigation/PageNavigator.tsx`

After the existing panels (Explorer, Search, Secondary), render panels for each secondary model:

```typescript
import { LazySecondaryEditor } from "./LazySecondaryEditor";
import { secondaryEditorRegistry } from "./secondary-editor-registry";

// In render, after the existing {secondaryDescriptor && ...} block:
{secondaryModels.map((model) => {
    const editorId = model.state.get().secondaryEditor;
    if (!editorId) return null;
    const def = secondaryEditorRegistry.get(editorId);
    if (!def) return null;

    // Active page's own secondary panel has no close button
    const isActivePagePanel = model.id === pageId;
    const panelButtons = isActivePagePanel ? null : (
        <>
            <Button type="icon" size="small" title="Close"
                onClick={(e) => {
                    e.stopPropagation();
                    navigationData.removeSecondaryModel(model);
                }}>
                <CloseIcon width={14} height={14} />
            </Button>
        </>
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
```

**Close button rule** (from EPIC-016 design decisions):
- The active page's own secondary panel has **no close button** — it's controlled by the `secondaryEditor` field.
- Panels from other models (survived navigation via `beforeNavigateAway`) show a close button. Clicking disposes the model.

### Step 4: Update `handleSetActivePanel` for secondary model IDs

**File:** `src/renderer/ui/navigation/PageNavigator.tsx`

The current `handleSetActivePanel` has special handling for `"secondary"` (lazy provider creation) and `"search"`. When a secondary model panel is clicked, we need minimal handling — just set the active panel ID.

```typescript
const handleSetActivePanel = useCallback(async (panelId: string) => {
    const previousPanel = activePanel;
    if (panelId === previousPanel) return;

    if (panelId === "secondary") {
        // Old system: lazy create provider
        // ... existing code ...
    }

    navigationData.setActivePanel(panelId);
    setActivePanelLocal(panelId);

    if (panelId === "search") return;

    // Switching from Search to Explorer — reveal only
    if (panelId === "explorer" && previousPanel === "search") {
        // ... existing code ...
        return;
    }

    // For secondary model panels, no automatic navigation needed
    // (the panel content is self-contained — it's a React component, not a tree)
    if (navigationData.findSecondaryModel(panelId)) {
        return;
    }

    // Navigate to the active panel's selection (explorer/secondary)
    // ... existing code ...
}, [navigationData, pageId, activePanel]);
```

### Step 5: Restore activePanel for secondary model IDs

**File:** `src/renderer/ui/navigation/NavigationData.ts`

Currently, `restore()` falls back secondary model panel IDs to `"explorer"` (line 394-396) because models aren't restored yet at that point. After `restoreSecondaryModels()` runs (in `PageModel.restore()`), the active panel should be set to the persisted ID if the model exists.

```typescript
// In restoreSecondaryModels(), after all models are restored:
async restoreSecondaryModels(ownerModel: PageModel): Promise<void> {
    // ... existing restore logic ...

    // Now that secondary models are restored, re-check the persisted activePanel
    if (this._pendingActivePanel) {
        const modelExists = this.secondaryModels.some(m => m.id === this._pendingActivePanel);
        if (modelExists) {
            this.activePanel = this._pendingActivePanel;
        }
        this._pendingActivePanel = undefined;
    }

    this._bumpSecondaryVersion();
}
```

In `restore()`, save the deferred panel ID:
```typescript
// Instead of falling back immediately:
} else if (restoredPanel !== "explorer" && restoredPanel !== "search" && restoredPanel !== "secondary") {
    // Secondary model panel ID — defer until models are restored
    this.activePanel = "explorer";
    this._pendingActivePanel = restoredPanel;
}
```

Add the field:
```typescript
/** Deferred activePanel — set during restore, applied after restoreSecondaryModels(). */
private _pendingActivePanel: string | undefined = undefined;
```

### Step 6: Initial activePanel for PageNavigator

**File:** `src/renderer/ui/navigation/PageNavigator.tsx`

PageNavigator currently initializes local `activePanel` state from `navigationData.activePanel`. After secondary models are restored, `activePanel` may change (Step 5). PageNavigator needs to re-sync:

```typescript
// Current:
const [activePanelLocal, setActivePanelLocal] = useState(navigationData.activePanel);

// The secondaryModelsVersion subscription already triggers re-render.
// But activePanelLocal may be stale. Sync it:
useEffect(() => {
    setActivePanelLocal(navigationData.activePanel);
}, [navigationData.activePanel, _secondaryVersion]);
```

Actually, we can simplify by removing local `activePanelLocal` and always reading from `navigationData.activePanel` via a reactive subscription. But that would require making `activePanel` reactive too. For now, the useEffect sync is sufficient.

## Files Changed Summary

| File | Change |
|---|---|
| `src/renderer/ui/navigation/NavigationData.ts` | Add `secondaryModelsVersion` reactive counter, `_pendingActivePanel` for deferred restore, bump version on add/remove/restore |
| `src/renderer/ui/navigation/PageNavigator.tsx` | Subscribe to `secondaryModelsVersion`, render secondary model panels via registry, update `handleSetActivePanel` for model IDs, sync `activePanelLocal` |
| `src/renderer/ui/navigation/LazySecondaryEditor.tsx` | **New** — async component loader for secondary editors |

## Files NOT Changed

| File | Why |
|---|---|
| `CollapsiblePanelStack.tsx` | Already supports arbitrary panel IDs — no changes needed |
| `secondary-editor-registry.ts` | Already complete from US-314 |
| `PageModel.ts` | `secondaryEditor` getter/setter already implemented in US-314 |
| `register-editors.ts` | No secondary editors registered yet (task 1.5 does this) |

## Concerns

### 1. Reactivity of secondaryModels — Resolved

Plain array is not reactive. Solved with a version counter (`TOneState<{ version: number }>`). PageNavigator calls `.use()` on the version state, which triggers re-render on change. The actual array is read after re-render. Keeping PageModel instances out of TOneState prevents future Immer misuse.

### 2. Close button only for non-active models — Resolved

Per EPIC-016 design: active page's secondary panel has no close button (controlled by `secondaryEditor` field). Only panels from survived models show close button. The check is `model.id === pageId` where `pageId` is the current page prop.

### 3. Coexistence with old secondary provider system

The old `secondaryDescriptor`/`secondaryProvider` system stays functional. Its panel (`id="secondary"`) renders alongside the new secondary model panels. No conflict — they use different panel IDs (`"secondary"` vs model page IDs).

Task 1.5 (ZipPageModel) will remove the old system when it replaces standalone `ZipTreeProvider` with `ZipPageModel` + `ZipSecondaryEditor`.

### 4. Panel switching for secondary models

When user clicks a secondary model panel header, no automatic navigation is needed (unlike Explorer/Secondary panels which navigate the content area). The secondary editor component is self-contained — it receives the full PageModel and renders its own UI.

The `handleSetActivePanel` check uses `navigationData.findSecondaryModel(panelId)` to detect secondary model IDs and skip navigation logic.

### 5. Restore ordering

On app restart:
1. `NavigationData.restore()` loads `secondaryModelDescriptors` and persisted `activePanel`
2. If `activePanel` is a model ID, it's deferred to `_pendingActivePanel` (models don't exist yet)
3. `PageModel.restore()` → `restoreSecondaryModels()` creates models, then applies `_pendingActivePanel`
4. Version counter bumps → PageNavigator re-renders with restored models and correct active panel

## Acceptance Criteria

- [ ] `secondaryModelsVersion` reactive counter added to NavigationData
- [ ] Version bumped on every add/remove/restore of secondary models
- [ ] `LazySecondaryEditor` component loads and renders secondary editors from registry
- [ ] PageNavigator renders `CollapsiblePanel` for each model in `secondaryModels[]`
- [ ] Panel title comes from registry `label`
- [ ] Close button shown only for non-active-page models
- [ ] Clicking close calls `removeSecondaryModel()` (disposes model)
- [ ] `handleSetActivePanel` handles secondary model IDs without navigation side-effects
- [ ] `_pendingActivePanel` defers active panel restore until models are ready
- [ ] Active panel correctly restored after `restoreSecondaryModels()` runs
- [ ] Old `secondaryDescriptor`/`secondaryProvider` system still works
- [ ] TypeScript compiles cleanly
