# US-341: Rename CategoryEditor → ExplorerFolderEditor + View Mode Integration

**Epic:** EPIC-018 (Phase 0, Task 0.5)
**Status:** Planned

## Goal

1. Rename `CategoryEditor` to `ExplorerFolderEditor` — classes, files, editorType, and registry ID — to clarify that this editor is dedicated to the Explorer panel's folder view, not a generic category viewer.
2. Integrate view mode state: pass `viewMode` and `onViewModeChange` to CategoryView. Persist per-folder view mode in a user data file.

## Background

### Why rename

`CategoryEditor` is confusingly named because `CategoryView` is a reusable component used by multiple editors (LinkEditor, ZipEditor, and this editor). The name "CategoryEditor" suggests it owns the CategoryView concept, but it's actually a narrow wrapper that:
- Reads `ExplorerEditorModel.treeProvider` from the page
- Decodes `tree-category://` links for folder navigation
- Provides a toolbar with navigator toggle button

The new name `ExplorerFolderEditor` makes its role clear: it's the Explorer panel's dedicated folder content viewer.

### Full rename mapping

| What | Old value | New value | Breaking? |
|------|-----------|-----------|-----------|
| EditorType | `"categoryPage"` | `"explorerFolder"` | Yes (v2.0.5 not released yet) |
| EditorView (registry ID) | `"category-view"` | `"folder-view"` | Yes (v2.0.5 not released yet) |
| Model class | `CategoryEditorModel` | `ExplorerFolderEditorModel` | No (internal) |
| Component | `CategoryEditor` | `ExplorerFolderEditor` | No (internal) |
| File names | `CategoryEditor.tsx`, `CategoryEditorModel.ts` | `ExplorerFolderEditor.tsx`, `ExplorerFolderEditorModel.ts` | No (internal) |

Since v2.0.5 is not yet released, the `"categoryPage"` and `"category-view"` values have no external consumers. Update whats-new.md breaking changes to reflect the new values.

### What stays the same

- `tree-category://` link format — **no change** (internal URL scheme)
- Folder name `editors/category/` — **no change** (keep folder, rename files inside)
- `CategoryView` / `CategoryViewMode` — **no change** (reusable component, correct name)

### View mode persistence

EPIC-018 Decision C: per-folder view mode stored in a user data file. When the user sets tile mode for an image folder, it's remembered across navigations and restarts.

File: `<persephone-user-folder>/data/folderViewMode.json`
Format: `{ [folderPath: string]: CategoryViewMode }` — simple JSON object.

Use `app.fs.cacheMiscFilePath("folderViewMode.json")` for the file path (same pattern as favicon-cache).

## Implementation Plan

### Part A: Rename

#### Step A1: Rename EditorType and EditorView

**File:** `src/shared/types.ts` (line 1-2)

```typescript
// EditorType: "categoryPage" → "explorerFolder"
// EditorView: "category-view" → "folder-view"
```

**File:** `src/renderer/api/types/common.d.ts` (line 48)
```typescript
// "category-view" → "folder-view"
```

**File:** `assets/editor-types/common.d.ts` (line 48)
```typescript
// "category-view" → "folder-view" (mirror)
```

#### Step A2: Update registry

**File:** `src/renderer/editors/register-editors.ts` (line 584-595)

```typescript
// Before:
id: "category-view",
// After:
id: "folder-view",

// Before:
const module = await import("./category/CategoryEditor");
// After:
const module = await import("./category/ExplorerFolderEditor");
```

#### Step A3: Update parser

**File:** `src/renderer/content/parsers.ts` (line 57)

```typescript
// Before:
new OpenLinkEvent(event.raw, event.target ?? "category-view", event.metadata),
// After:
new OpenLinkEvent(event.raw, event.target ?? "folder-view", event.metadata),
```

#### Step A4: Rename model class and types

**File:** `src/renderer/editors/category/CategoryEditorModel.ts` → **rename to** `ExplorerFolderEditorModel.ts`

| Old name | New name |
|----------|----------|
| `CategoryEditorModelState` | `ExplorerFolderEditorModelState` |
| `getDefaultCategoryEditorModelState()` | `getDefaultExplorerFolderEditorModelState()` |
| `CategoryEditorModel` | `ExplorerFolderEditorModel` |
| `type: "categoryPage"` | `type: "explorerFolder"` |

#### Step A5: Rename editor component and module

**File:** `src/renderer/editors/category/CategoryEditor.tsx` → **rename to** `ExplorerFolderEditor.tsx`

| Old name | New name |
|----------|----------|
| `CategoryEditorRoot` (styled) | `ExplorerFolderEditorRoot` |
| `CategoryEditor` (component) | `ExplorerFolderEditor` |
| `categoryEditorModule` | `explorerFolderEditorModule` |
| `editorType !== "categoryPage"` | `editorType !== "explorerFolder"` |
| Import `CategoryEditorModel` | Import `ExplorerFolderEditorModel` |

#### Step A6: Update resolvers.ts comment

**File:** `src/renderer/content/resolvers.ts` (line 57)

```typescript
// Before:
// Create a placeholder file pipe — CategoryEditor uses navigationData.treeProvider, not the pipe.
// After:
// Create a placeholder file pipe — ExplorerFolderEditor uses the explorer's treeProvider, not the pipe.
```

#### Step A7: Update user docs and MCP docs

**File:** `docs/whats-new.md` — update the EditorView list (replace `"category-view"` with `"folder-view"`)
**File:** `docs/api/page.md` — update EditorView list
**File:** `assets/mcp-res-pages.md` — update EditorView list

### Part B: FolderViewModeService

#### Step B1: Create FolderViewModeService

**File:** `src/renderer/editors/category/FolderViewModeService.ts` (new)

A singleton service that manages per-folder view mode with hierarchical inheritance.

**Core concept:** A folder inherits the view mode of its nearest ancestor that has a saved mode. Only explicit overrides are stored. When a folder's mode is set to the same as its inherited mode from the parent, the entry is removed (redundant).

**No cascading cleanup on parent change** — only the target folder's entry is cleaned. Reason: user may set `d:\data\images` to portrait, then temporarily change `d:\data` to portrait and revert to list. Cascading would unexpectedly reset `d:\data\images`.

```typescript
import type { CategoryViewMode } from "../../components/tree-provider/CategoryViewModel";
import { fs } from "../../api/fs";

const FILE_NAME = "folderViewMode.json";

class FolderViewModeService {
    private modes: Record<string, CategoryViewMode> | null = null;

    /** Get the effective view mode for a folder (walks up ancestors). */
    async getViewMode(folderPath: string): Promise<CategoryViewMode> {
        const modes = await this.load();
        return this.resolveViewMode(modes, folderPath);
    }

    /** Get the effective view mode synchronously (from cache). Returns "list" if not loaded. */
    getViewModeSync(folderPath: string): CategoryViewMode {
        if (!this.modes) return "list";
        return this.resolveViewMode(this.modes, folderPath);
    }

    /** Set view mode for a folder. Removes entry if same as inherited from parent. */
    async setViewMode(folderPath: string, mode: CategoryViewMode): Promise<void> {
        const modes = await this.load();
        const inheritedMode = this.resolveViewMode(modes, getParentPath(folderPath));
        if (mode === inheritedMode) {
            delete modes[folderPath];
        } else {
            modes[folderPath] = mode;
        }
        await this.save();
    }

    /** Resolve view mode by walking up the path hierarchy. */
    private resolveViewMode(modes: Record<string, CategoryViewMode>, folderPath: string): CategoryViewMode {
        let current = normalizePath(folderPath);
        while (current) {
            const mode = modes[current];
            if (mode) return mode;
            const parent = getParentPath(current);
            if (parent === current) break; // root
            current = parent;
        }
        return "list";
    }

    private async load(): Promise<Record<string, CategoryViewMode>> {
        if (this.modes) return this.modes;
        try {
            const filePath = await fs.cacheMiscFilePath(FILE_NAME);
            const content = fs.readFileSync(filePath);
            this.modes = JSON.parse(content);
        } catch {
            this.modes = {};
        }
        return this.modes!;
    }

    private async save(): Promise<void> {
        const filePath = await fs.cacheMiscFilePath(FILE_NAME);
        fs.writeFileSync(filePath, JSON.stringify(this.modes, null, 2));
    }
}

/** Normalize path separators to forward slashes and lowercase for consistent lookup. */
function normalizePath(p: string): string {
    return p.replace(/\\/g, "/").toLowerCase();
}

/** Get parent path. Returns same path for root (e.g., "d:/"). */
function getParentPath(p: string): string {
    const normalized = normalizePath(p);
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash <= 0) return normalized;
    // Handle "d:/" root
    if (normalized[lastSlash - 1] === ":") return normalized.slice(0, lastSlash + 1);
    return normalized.slice(0, lastSlash);
}

export const folderViewModeService = new FolderViewModeService();
```

**Example behavior:**
```
Stored: { "d:/images": "tiles-portrait" }

getViewMode("d:/images")           → "tiles-portrait"  (direct match)
getViewMode("d:/images/cats")      → "tiles-portrait"  (inherited from d:/images)
getViewMode("d:/images/cats/cute") → "tiles-portrait"  (inherited from d:/images)
getViewMode("d:/code")             → "list"            (no ancestor match)

setViewMode("d:/images/dogs", "tiles-landscape")
  → saves: inherited from parent is "tiles-portrait", different → store override
  Stored: { "d:/images": "tiles-portrait", "d:/images/dogs": "tiles-landscape" }

setViewMode("d:/images/dogs", "tiles-portrait")
  → removes: inherited from parent is "tiles-portrait", same → delete redundant entry
  Stored: { "d:/images": "tiles-portrait" }
```

#### Step B2: Use service in ExplorerFolderEditor

**File:** `src/renderer/editors/category/ExplorerFolderEditor.tsx`

```typescript
import { folderViewModeService } from "./FolderViewModeService";
import type { CategoryViewMode } from "../../components/tree-provider/CategoryView";

// In the component:
const [viewMode, setViewMode] = useState<CategoryViewMode>("list");

// Load persisted view mode for this folder (with inheritance)
useEffect(() => {
    folderViewModeService.getViewMode(categoryPath).then(setViewMode);
}, [categoryPath]);

const handleViewModeChange = useCallback((mode: CategoryViewMode) => {
    setViewMode(mode);
    folderViewModeService.setViewMode(categoryPath, mode);
}, [categoryPath]);
```

#### Step B3: Pass view mode to CategoryView

**File:** `src/renderer/editors/category/ExplorerFolderEditor.tsx`

```tsx
<CategoryView
    provider={provider}
    category={categoryPath}
    viewMode={viewMode}
    onViewModeChange={handleViewModeChange}
    onItemClick={handleNavigate}
    onFolderClick={handleNavigate}
    toolbarPortalRef={searchPortal}
/>
```

### No changes needed

| File | Reason |
|------|--------|
| `src/renderer/components/tree-provider/CategoryView.tsx` | Already accepts `viewMode` + `onViewModeChange` (US-340) |
| `src/renderer/components/tree-provider/CategoryViewModel.tsx` | `CategoryViewMode` stays — it's the reusable component's type |
| `tree-category://` links | Internal URL scheme, not affected by editor rename |

## Files Changed

| File | Change |
|------|--------|
| `src/shared/types.ts` | `"categoryPage"` → `"explorerFolder"`, `"category-view"` → `"folder-view"` |
| `src/renderer/api/types/common.d.ts` | `"category-view"` → `"folder-view"` |
| `assets/editor-types/common.d.ts` | `"category-view"` → `"folder-view"` (mirror) |
| `src/renderer/editors/register-editors.ts` | Update registry ID + import path |
| `src/renderer/content/parsers.ts` | `"category-view"` → `"folder-view"` |
| `src/renderer/content/resolvers.ts` | Update comment |
| `editors/category/CategoryEditorModel.ts` | **Renamed** → `ExplorerFolderEditorModel.ts`, rename classes, `"categoryPage"` → `"explorerFolder"` |
| `editors/category/CategoryEditor.tsx` | **Renamed** → `ExplorerFolderEditor.tsx`, rename component/module, add view mode usage |
| `editors/category/FolderViewModeService.ts` | **New** — hierarchical view mode persistence service |
| `doc/architecture/folder-structure.md` | Update file listing |
| `doc/architecture/editors.md` | Update editor table entry |
| `docs/whats-new.md` | Update EditorView list |
| `docs/api/page.md` | Update EditorView list |
| `assets/mcp-res-pages.md` | Update EditorView list |

## Concerns

None — the hierarchical inheritance design keeps the data file compact (only explicit overrides stored), and redundant entries are auto-cleaned on set.

## Acceptance Criteria

- [ ] `"categoryPage"` → `"explorerFolder"` in EditorType
- [ ] `"category-view"` → `"folder-view"` in EditorView / registry
- [ ] `CategoryEditor` → `ExplorerFolderEditor` rename complete (classes, files, imports)
- [ ] View mode toggle works in ExplorerFolderEditor
- [ ] Per-folder view mode persisted in `folderViewMode.json`
- [ ] Defaults to "list" for folders without saved preference
- [ ] Saves on change, loads on folder navigation
- [ ] Switching back to "list" removes the entry (clean default)
- [ ] User docs and MCP docs updated with new `"folder-view"` value
