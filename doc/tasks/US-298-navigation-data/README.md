# US-298: Introduce NavigationData Class

**Status:** Complete
**Epic:** EPIC-015 (Phase 3, new prerequisite task before 3.3)

## Goal

Create a `NavigationData` class that wraps the page navigation context — PageNavigator model, ITreeProvider, and a stable `renderId`. This class survives page navigation (transferred between page models) and provides a stable browsing context for both PageNavigator (sidebar) and CategoryEditor (content area).

This replaces the current pattern where `navPanel` is stored directly on `PageModel` and transferred manually during `navigatePageTo`.

## Background

### Current architecture

```
PageModel
├── navPanel: NavPanelModel | null    ← transferred during navigatePageTo
├── state.id                          ← changes on each navigation (new PageModel)
```

During `navigatePageTo`:
1. Save `oldModel.navPanel` reference
2. Set `oldModel.navPanel = null` (prevent disposal)
3. Dispose old model, create new model
4. Assign `newModel.navPanel = navPanel`

**Problems:**
- `navPanel` is transferred manually — fragile
- No place to store shared `ITreeProvider` (needed by both sidebar and editor)
- Page wrapper re-renders on navigation (page ID changes) → PageNavigator remounts → scroll loss, tree rebuild

### New architecture

```
PageModel
├── navigationData: NavigationData | null  ← transferred during navigatePageTo
│   ├── model: PageNavigatorModel          ← manages sidebar state (open, width, rootPath, treeState)
│   ├── treeProvider: ITreeProvider | null  ← lazy, shared between sidebar and editor
│   └── renderId: string                   ← stable React key, generated once
│
├── state.id                               ← changes on each navigation
```

**`renderId`:** A unique ID generated once when NavigationData is created. Used as React key for the page wrapper component that renders PageNavigator + editor container. Since `renderId` doesn't change on navigation:
- PageNavigator stays mounted (no scroll loss, no tree rebuild)
- Editor inside uses `page.id` as key → recreates correctly on navigation

**`treeProvider`:** Lazy-loaded on first access. Created by PageNavigator or CategoryEditor (whoever needs it first). Both read the same instance from NavigationData.

## Implementation Plan

### Step 1: Create NavigationData class

File: `src/renderer/ui/navigation/NavigationData.ts`

```typescript
import type { ITreeProvider } from "../../api/types/io.tree";
import { PageNavigatorModel } from "./PageNavigatorModel";

export class NavigationData {
    /** Stable ID for React key — survives navigation. */
    readonly renderId: string;
    /** Shared tree provider. Owned by NavigationData, accessed by PageNavigator and CategoryEditor. */
    treeProvider: ITreeProvider | null = null;
    /** Sidebar model, lazy-created on first "open navigator" action. */
    pageNavigatorModel: PageNavigatorModel | null = null;

    constructor(rootPath: string) {
        this.renderId = crypto.randomUUID();
        // Store rootPath for lazy PageNavigatorModel creation
        this._rootPath = rootPath;
    }
    private _rootPath: string;

    /** Lazy-create PageNavigatorModel on first access. */
    ensurePageNavigator(): PageNavigatorModel {
        if (!this.pageNavigatorModel) {
            this.pageNavigatorModel = new PageNavigatorModel(this._rootPath);
        }
        return this.pageNavigatorModel;
    }

    /** Restore from cache (on app restart). */
    async restore(pageId: string): Promise<void> {
        // Only restore if PageNavigatorModel was previously saved
        // (detected by cache file presence)
        const model = this.ensurePageNavigator();
        await model.restore(pageId);
    }

    /** Update page ID after navigation transfer. */
    updateId(newPageId: string): void {
        this.pageNavigatorModel?.updateId(newPageId);
    }

    dispose(): void {
        this.treeProvider?.dispose?.();
        this.treeProvider = null;
        this.pageNavigatorModel?.dispose();
    }
}
```

**Ownership pattern:** NavigationData owns `treeProvider`. PageNavigator accesses it via the NavigationData reference:

```typescript
class PageNavigator {
    constructor(private navigationData: NavigationData) {}

    get treeProvider(): ITreeProvider | null {
        return this.navigationData.treeProvider;
    }
    set treeProvider(value: ITreeProvider | null) {
        this.navigationData.treeProvider = value;
    }

    // When rootPath changes (navigate up, make root):
    handleRootChange(newRoot: string) {
        this.treeProvider?.dispose?.();
        this.treeProvider = new FileTreeProvider(newRoot);
    }
}
```

CategoryEditor reads the same `treeProvider` from NavigationData — always gets the current instance.
```

### Step 2: Replace navPanel with navigationData on PageModel

File: `src/renderer/editors/base/PageModel.ts`

```diff
- navPanel: NavPanelModel | null = null;
+ navigationData: NavigationData | null = null;
```

Update `hasNavigator` state flag → `hasNavigation` (or keep same name for minimal changes).

### Step 3: Update navigatePageTo to transfer NavigationData

File: `src/renderer/api/pages/PagesLifecycleModel.ts`

```diff
- const navPanel = oldModel.navPanel;
- oldModel.navPanel = null;
+ const navigationData = oldModel.navigationData;
+ oldModel.navigationData = null;

  // ... create new model ...

- if (navPanel) {
-     newModel.navPanel = navPanel;
+ if (navigationData) {
+     newModel.navigationData = navigationData;
      newModel.state.update((s) => {
-         s.hasNavigator = true;
+         s.hasNavigation = true;
      });
-     navPanel.setCurrentFilePath(newFilePath);
-     navPanel.updateId(newModel.id);
+     navigationData.updateId(newModel.id);
  }
```

### Step 4: Update all NavPanelModel creation sites

Replace `new NavPanelModel(rootPath)` with `new NavigationData(rootPath)`:

| File | Current | New |
|---|---|---|
| `TextToolbar.tsx` | `new NavPanelModel(dir, file)` | `new NavigationData(dir)` |
| `TextFileActionsModel.ts` | `new NavPanelModel(dir, file)` | `new NavigationData(dir)` |
| `ImageViewer.tsx` | `new NavPanelModel(dir, file)` | `new NavigationData(dir)` |
| `PdfViewer.tsx` | `new NavPanelModel(dir, file)` | `new NavigationData(dir)` |
| `ScriptPanel.tsx` | `new NavPanelModel(dir, file)` | `new NavigationData(dir)` |
| `PagesLifecycleModel.ts` | `new NavPanelModel(folderPath)` | `new NavigationData(folderPath)` |
| `PageModel.ts` (restore) | `new NavPanelModel("")` | `new NavigationData("")` |

### Step 5: Update Pages.tsx wrapper to use renderId

File: `src/renderer/ui/app/Pages.tsx`

```diff
- function NavPanelWrapper({ model }: { model: PageModel }) {
-     const hasNavigator = model.state.use((s) => s.hasNavigator);
-     const panel = hasNavigator ? model.navPanel : null;
+ function NavigationWrapper({ model }: { model: PageModel }) {
+     const hasNavigation = model.state.use((s) => s.hasNavigation);
+     const navData = hasNavigation ? model.navigationData : null;
```

Use `renderId` as React key for the wrapper:
```typescript
// PageContent renders with navData.renderId as key for the outer wrapper
// and page.id as key for the editor — so navigator stays mounted while editor recreates
<div key={navData?.renderId ?? page.id}>
    {navData && <PageNavigator navigationData={navData} pageId={page.id} />}
    <div key={page.id}>
        <RenderEditor model={page} />
    </div>
</div>
```

### Step 6: Update PageNavigator to use NavigationData

File: `src/renderer/ui/navigation/PageNavigator.tsx`

```diff
- interface PageNavigatorProps {
-     model: NavPanelModel;
-     pageId: string;
- }
+ interface PageNavigatorProps {
+     navigationData: NavigationData;
+     pageId: string;
+ }

- export function PageNavigator({ model, pageId }: PageNavigatorProps) {
-     const { rootFilePath } = model.state.use();
+ export function PageNavigator({ navigationData, pageId }: PageNavigatorProps) {
+     const { rootPath } = navigationData.model.state.use();
```

PageNavigator creates/accesses the treeProvider via NavigationData:
```typescript
const provider = useMemo(() => {
    if (!navigationData.treeProvider) {
        navigationData.treeProvider = new FileTreeProvider(rootPath);
    }
    return navigationData.treeProvider;
}, [rootPath]);
```

## Files Changed

| File | Change |
|---|---|
| `src/renderer/ui/navigation/NavigationData.ts` | **NEW** — NavigationData class |
| `src/renderer/editors/base/PageModel.ts` | Replace `navPanel` with `navigationData` |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Transfer `navigationData` instead of `navPanel` |
| `src/renderer/ui/app/Pages.tsx` | Use `renderId` as wrapper key, pass `navigationData` to PageNavigator |
| `src/renderer/ui/navigation/PageNavigator.tsx` | Accept `NavigationData` instead of `NavPanelModel` |
| `src/renderer/editors/text/TextToolbar.tsx` | Create `NavigationData` instead of `NavPanelModel` |
| `src/renderer/editors/text/TextFileActionsModel.ts` | Create `NavigationData` instead of `NavPanelModel` |
| `src/renderer/editors/image/ImageViewer.tsx` | Create `NavigationData` instead of `NavPanelModel` |
| `src/renderer/editors/pdf/PdfViewer.tsx` | Create `NavigationData` instead of `NavPanelModel` |
| `src/renderer/editors/text/ScriptPanel.tsx` | Create `NavigationData` instead of `NavPanelModel` |

## Files NOT Changed

- `src/renderer/ui/navigation/nav-panel-store.ts` — NavPanelModel stays (used internally by NavigationData/PageNavigatorModel for persistence format compat)
- `src/renderer/ui/navigation/NavigationPanel.tsx` — legacy, kept as reference
- `src/renderer/components/tree-provider/` — no changes

## Concerns

1. **Backward compatibility for page restore:** Saved page state has `hasNavigator: true` and NavPanel cache files. NavigationData.restore() needs to read the old NavPanel cache format. **Resolution: PageNavigatorModel already handles this (reads old NavPanelModel format). NavigationData delegates to PageNavigatorModel.restore().**

2. **renderId stability:** `renderId` is generated on NavigationData creation and transferred during navigation. It's NOT persisted to disk — on app restart, a new `renderId` is generated during restore. This is fine — the point is stability during a session, not across restarts. **Not blocking.**

3. **~~treeProvider recreation on rootPath change~~** — **Resolved.** PageNavigator accesses `treeProvider` via getter/setter on NavigationData. When rootPath changes, PageNavigator disposes the old provider and sets a new one: `this.treeProvider = new FileTreeProvider(newRoot)`. Writes through to NavigationData. CategoryEditor always reads the current instance.

4. **~~State flag naming~~** — **Resolved: rename to `hasNavigator`.** `hasNavigator` → `hasNavigator` on PageModel state.

## Acceptance Criteria

- [ ] `NavigationData` class exists with `model`, `treeProvider`, `renderId`
- [ ] `PageModel.navigationData` replaces `PageModel.navPanel`
- [ ] `navigatePageTo` transfers `navigationData` (not `navPanel`)
- [ ] All NavPanelModel creation sites updated to create NavigationData
- [ ] Pages.tsx uses `renderId` as wrapper key — PageNavigator stays mounted on navigation
- [ ] PageNavigator accepts `NavigationData`
- [ ] treeProvider lazy-loaded and shared via NavigationData
- [ ] App restart: old cache format restored correctly
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
