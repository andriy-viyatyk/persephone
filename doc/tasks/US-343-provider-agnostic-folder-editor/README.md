# US-343: Make Folder Editor Provider-Agnostic

**Epic:** EPIC-018 (Phase 3, Task 3.1)
**Status:** Planned

## Goal

Make `ExplorerFolderEditor` work with any `ITreeProvider` — not just Explorer's FileTreeProvider. When a user clicks a subfolder in the Explorer panel, Archive panel, or future Link Categories panel, the same editor resolves the correct provider and shows the folder contents.

## Background

### Current problem

`ExplorerFolderEditor.tsx` (line 29-30) hardcodes the provider source:

```typescript
const explorer = page?.findExplorer() as ExplorerEditorModel | undefined;
const provider = explorer?.treeProvider ?? null;
```

When clicking a subfolder in the Archive panel, a `tree-category://` link with `type: "zip"` is generated. The folder editor opens but shows "Empty folder" because it looks at the Explorer (FileTreeProvider) instead of the Archive (ZipTreeProvider).

### The tree-category:// link

`ITreeProviderLink` (in `tree-provider-link.ts`) encodes:
- `type: string` — provider type: `"file"`, `"zip"`, future `"link"`
- `url: string` — provider's `sourceUrl` (root path for file, archive path for zip)
- `category: string` — the subfolder/category path to display

### Both editors share the same pattern

| Property | ExplorerEditorModel | ZipEditorModel |
|----------|-------------------|----------------|
| `treeProvider` | `ITreeProvider \| null` (line 27) | `ZipTreeProvider \| null` (line 26) |
| `selectionState` | `TOneState<NavigationState>` (line 33) | `TOneState<NavigationState>` (line 30) |

The folder editor uses only these two properties from the secondary editor. Both models expose them identically.

### Provider resolution approach

Scan `page.secondaryEditors` to find the secondary editor whose `treeProvider` matches the link's `type` and `url`:

```typescript
const link = model.decodedLink; // { type: "zip", url: "D:\archive.zip", category: "images" }
const host = page.secondaryEditors.find(e => {
    const tp = (e as any).treeProvider as ITreeProvider | null;
    return tp && tp.type === link.type && tp.sourceUrl === link.url;
});
```

This avoids polluting the EditorModel base class. Instead, define a local interface for type safety.

## Implementation Plan

### Step 1: Define ITreeProviderHost interface

**File:** `src/renderer/editors/category/ExplorerFolderEditor.tsx`

Add a local interface (not exported — this is a duck-type check, not a contract on EditorModel):

```typescript
import type { ITreeProvider } from "../../api/types/io.tree";
import type { TOneState } from "../../core/state/state";
import type { NavigationState } from "../../api/pages/PageModel";

/** Duck-type interface for secondary editors that expose a tree provider. */
interface ITreeProviderHost {
    treeProvider: ITreeProvider | null;
    selectionState: TOneState<NavigationState>;
}
```

### Step 2: Add provider resolution helper

**File:** `src/renderer/editors/category/ExplorerFolderEditor.tsx`

Replace the hardcoded Explorer lookup:

```typescript
// Before:
const explorer = page?.findExplorer() as ExplorerEditorModel | undefined;
const provider = explorer?.treeProvider ?? null;

// After:
const host = findTreeProviderHost(page, model.decodedLink);
const provider = host?.treeProvider ?? null;
```

Helper function:
```typescript
function findTreeProviderHost(
    page: PageModel | null,
    link: ITreeProviderLink | null,
): ITreeProviderHost | null {
    if (!page || !link) return null;
    for (const editor of page.secondaryEditors) {
        const tp = (editor as unknown as ITreeProviderHost).treeProvider;
        if (tp && tp.type === link.type && tp.sourceUrl === link.url) {
            return editor as unknown as ITreeProviderHost;
        }
    }
    return null;
}
```

### Step 3: Update selection state usage

**File:** `src/renderer/editors/category/ExplorerFolderEditor.tsx`

Replace all `explorer?.selectionState` references with `host?.selectionState`:

```typescript
// Before:
const selectedHref = explorer?.selectionState.use()?.selectedHref ?? null;
explorer?.selectionState.update((s: any) => { s.selectedHref = item.href; });

// After:
const selectedHref = host?.selectionState.use()?.selectedHref ?? null;
host?.selectionState.update((s: any) => { s.selectedHref = item.href; });
```

### Step 4: Remove ExplorerEditorModel import

The `findExplorer()` call and the `ExplorerEditorModel` type cast are no longer needed. Remove:
```typescript
// Remove this line:
const explorer = page?.findExplorer() as import("../explorer/ExplorerEditorModel").ExplorerEditorModel | undefined;
```

### Step 5: Rename back to CategoryEditor

Revert the US-341 rename. Full mapping:

| What | Current (US-341) | Rename back to |
|------|-----------------|----------------|
| EditorType | `"explorerFolder"` | `"categoryPage"` |
| EditorView (registry ID) | `"folder-view"` | `"category-view"` |
| Model class | `ExplorerFolderEditorModel` | `CategoryEditorModel` |
| State interface | `ExplorerFolderEditorModelState` | `CategoryEditorModelState` |
| Component | `ExplorerFolderEditor` | `CategoryEditor` |
| File names | `ExplorerFolderEditor.tsx`, `ExplorerFolderEditorModel.ts` | `CategoryEditor.tsx`, `CategoryEditorModel.ts` |

Files that need the rename:
- `src/shared/types.ts` — EditorType and EditorView
- `src/renderer/api/types/common.d.ts` — EditorView
- `assets/editor-types/common.d.ts` — EditorView (mirror)
- `src/renderer/editors/register-editors.ts` — registry ID, editorType, import path
- `src/renderer/content/parsers.ts` — `"folder-view"` → `"category-view"`
- `src/renderer/editors/category/ExplorerFolderEditor.tsx` → `CategoryEditor.tsx`
- `src/renderer/editors/category/ExplorerFolderEditorModel.ts` → `CategoryEditorModel.ts`
- `docs/whats-new.md`, `docs/api/page.md`, `assets/mcp-res-pages.md` — EditorView values
- `doc/architecture/editors.md`, `doc/architecture/folder-structure.md`, `doc/architecture/diagrams/3-rendering-architecture.mmd`

### Step 6: Add PageModel notification

**File:** `src/renderer/api/pages/PageModel.ts`

In `addSecondaryEditor()` and `removeSecondaryEditor()` (and `removeSecondaryEditorWithoutDispose()`), after modifying the array, notify the main editor if it's a CategoryEditor:

```typescript
// After bumping secondaryEditorsVersion:
if (this._mainEditor && 'onSecondaryEditorsChanged' in this._mainEditor) {
    (this._mainEditor as any).onSecondaryEditorsChanged();
}
```

**File:** `src/renderer/editors/category/CategoryEditorModel.ts`

Add a method + observable counter:

```typescript
private _providerVersion = 0;
get providerVersion(): number { return this._providerVersion; }

onSecondaryEditorsChanged(): void {
    this._providerVersion++;
    this.state.update((s) => s); // trigger re-render
}
```

### Step 7: Update resolvers.ts comment

**File:** `src/renderer/content/resolvers.ts`

```typescript
// Before:
// Create a placeholder file pipe — ExplorerFolderEditor uses the explorer's treeProvider, not the pipe.
// After:
// Create a placeholder file pipe — CategoryEditor resolves its treeProvider from secondary editors, not the pipe.
```

### Step 7: Update architecture documentation

**File:** `doc/architecture/secondary-editors.md`

Add a new section (after "10. Existing Secondary Editors") documenting the FolderEditor / CategoryEditor pattern:

**Section: "12. FolderEditor — Provider-Agnostic Category Viewer"** (or similar)

Content should cover:
- FolderEditor's role: main content area editor that renders CategoryView for any ITreeProvider
- How it resolves its provider: scans `page.secondaryEditors` matching `treeProvider.type` + `treeProvider.sourceUrl` against the `tree-category://` link
- The `ITreeProviderHost` duck-type pattern (secondary editors expose `treeProvider` + `selectionState`)
- Which secondary editors currently act as hosts: ExplorerEditorModel (FileTreeProvider), ZipEditorModel (ZipTreeProvider)
- Lifecycle: provider may not be available during restore → fallback empty state
- Diagram showing the relationship:

```
PageModel
  ├── mainEditor: FolderEditor
  │   ├── decodedLink: { type: "file", url: "D:\images", category: "D:\images\cats" }
  │   └── resolves provider from secondaryEditors[] by type + sourceUrl match
  └── secondaryEditors:
      ├── ExplorerEditorModel (treeProvider: FileTreeProvider, sourceUrl: "D:\images")  ← match
      └── ZipEditorModel (treeProvider: ZipTreeProvider, sourceUrl: "D:\archive.zip")
```

### No changes needed

| File | Reason |
|------|--------|
| `EditorModel.ts` | No base class changes — duck-type interface is local |
| `ExplorerEditorModel.ts` | Already exposes `treeProvider` and `selectionState` |
| `ZipEditorModel.ts` | Already exposes `treeProvider` and `selectionState` |
| `CategoryView.tsx` | Already provider-agnostic |
| `tree-provider-link.ts` | Link format already carries `type` and `url` |
| `FolderViewModeService.ts` | Works with any path, provider-agnostic |

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/category/ExplorerFolderEditor.tsx` | **Renamed** → `CategoryEditor.tsx`. Replace `findExplorer()` with provider scan, add `ITreeProviderHost`, restore retry |
| `src/renderer/editors/category/ExplorerFolderEditorModel.ts` | **Renamed** → `CategoryEditorModel.ts`. Add `onSecondaryEditorsChanged()` |
| `src/renderer/api/pages/PageModel.ts` | Notify mainEditor on secondary editor add/remove |
| `src/renderer/content/resolvers.ts` | Update comment |
| `src/shared/types.ts` | `"explorerFolder"` → `"categoryPage"`, `"folder-view"` → `"category-view"` |
| `src/renderer/api/types/common.d.ts` | `"folder-view"` → `"category-view"` |
| `assets/editor-types/common.d.ts` | `"folder-view"` → `"category-view"` (mirror) |
| `src/renderer/editors/register-editors.ts` | Revert registry ID, editorType, import path |
| `src/renderer/content/parsers.ts` | `"folder-view"` → `"category-view"` |
| `docs/whats-new.md` | Revert EditorView value |
| `docs/api/page.md` | Revert EditorView value |
| `assets/mcp-res-pages.md` | Revert EditorView value |
| `doc/architecture/editors.md` | Revert editor table entry |
| `doc/architecture/folder-structure.md` | Revert file listing |
| `doc/architecture/diagrams/3-rendering-architecture.mmd` | Revert diagram label |
| `doc/architecture/secondary-editors.md` | New section: CategoryEditor provider resolution pattern |

## Resolved Concerns

### 1. Restore timing
On mount, if `treeProvider` is null, do `setTimeout(() => refresh(), 50)` to retry after secondary editors are restored. Shows fallback initially, then auto-refreshes.

### 2. `selectionState.use()` hook call order
React hooks must be called unconditionally. Use a stable ref or fallback dummy state when host is null.

### 3. Reactivity — when does `host` change?
PageModel notifies CategoryEditor directly when secondary editors change. In `PageModel.addSecondaryEditor()` / `removeSecondaryEditor()`, check if `mainEditor` is a `CategoryEditorModel` and call a method like `this.mainEditor.onSecondaryEditorsChanged()`. This triggers a state update that causes re-render → provider re-scan.

### 4. Rename decision
Rename everything **back** to `CategoryEditor` / `CategoryEditorModel` / `"categoryPage"` / `"category-view"`. The US-341 rename to `ExplorerFolderEditor` was premature — this editor is general-purpose, not Explorer-specific.

## Acceptance Criteria

- [ ] Clicking a subfolder in the Archive panel opens FolderEditor with ZipTreeProvider content
- [ ] Clicking a subfolder in the Explorer panel continues to work with FileTreeProvider
- [ ] Selection highlighting works for both providers
- [ ] "Empty folder" / fallback shown when no matching provider is found
- [ ] No changes to EditorModel base class
- [ ] Existing Explorer folder navigation unchanged
- [ ] Architecture doc updated: `secondary-editors.md` has section on FolderEditor provider resolution
