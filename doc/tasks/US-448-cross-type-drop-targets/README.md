# US-448: Cross-type drop targets

## Goal

Enable cross-type drag-and-drop between editors: files/folders → link editor import (with recursive folder scanning and confirmation), links → REST client request creation, and links → notebook note creation. This is the first task where different editor types communicate through the trait system's LINK trait.

## Background

### Current state after US-447

All editors use native HTML5 drag-and-drop with trait-based serialization (`TraitTypeId` + `setTraitDragData`/`getTraitDragData`). However, all current drops are **same-type only**: notes onto note categories, REST requests onto REST collections, browser tabs onto other tabs, etc. No cross-editor drops exist.

### The LINK trait as universal adapter

The LINK trait (`src/renderer/editors/link-editor/linkTraits.ts`) is the key to cross-type drops. It provides a `getItems(data): ILink[]` accessor that extracts link items from any payload. Currently only `TraitTypeId.ILink` has this trait registered. Any type that registers a LINK trait becomes droppable on **all existing LINK-accepting drop targets** automatically.

### LINK-accepting drop targets already in place

`TreeProviderView` (`src/renderer/components/tree-provider/TreeProviderView.tsx:184-202`) already uses `resolveTraits(payload.typeId)` → `traits.get(LINK)` to accept any LINK-capable drop. This means the link editor's category panel (`LinkCategoryPanel` wraps `TreeProviderView`) automatically accepts any LINK-capable drops.

### Key APIs

| API | File | Purpose |
|-----|------|---------|
| `LINK` trait key | `src/renderer/editors/link-editor/linkTraits.ts:15` | `TraitKey<LinkTrait>` |
| `LinkTrait.getItems(data)` | `linkTraits.ts:9` | Extract `ILink[]` from payload data |
| `LinkTrait.getSourceId?(data)` | `linkTraits.ts:11` | Optional source ID for same-source detection |
| `LinkDragData` | `linkTraits.ts:20-23` | `{ items: ILink[], sourceId?: string }` |
| `resolveTraits(typeId)` | `src/renderer/core/traits/dnd.ts:44` | Look up TraitSet from registry |
| `traitRegistry.register()` | `src/renderer/core/traits/TraitRegistry.ts:26` | Register TraitSet for a type ID |
| `vm.addLink(partial)` | `src/renderer/editors/link-editor/LinkViewModel.ts:489` | Add one link to collection |
| `vm.addRequest(name?, collection?)` | `src/renderer/editors/rest-client/RestClientViewModel.ts:301` | Create default request |
| `vm.updateRequest(id, updates)` | `RestClientViewModel.ts:284` | Update request fields |
| `app.fs.listDirWithTypes(path)` | `src/renderer/api/fs.ts:397` | List directory: `IDirEntry[]` with `{ name, isDirectory }` |
| `ui.confirm(msg, opts)` | Used in `LinkViewModel.ts:552` | Confirmation dialog, returns button label string |

## Implementation Plan

### Step 1: Add drop zone to Link Editor center panel

**Modify** `src/renderer/editors/link-editor/LinkEditor.tsx`:

Add native HTML5 drop handlers on the `div.center-panel` element. The drop handler uses the LINK trait to extract items from any compatible source.

Add imports:
```typescript
import { hasTraitDragData, getTraitDragData, resolveTraits } from "../../core/traits";
import { LINK } from "./linkTraits";
```

Add `useRef` to React imports if not already present.

Add state and handlers inside `LinkEditor` function (before the return):
```typescript
const [centerDragOver, setCenterDragOver] = useState(false);
const centerDragCount = useRef(0);

const handleCenterDragEnter = useCallback((e: React.DragEvent) => {
    centerDragCount.current++;
    if (hasTraitDragData(e.dataTransfer)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setCenterDragOver(true);
    }
}, []);

const handleCenterDragOver = useCallback((e: React.DragEvent) => {
    if (hasTraitDragData(e.dataTransfer)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    }
}, []);

const handleCenterDragLeave = useCallback(() => {
    centerDragCount.current--;
    if (centerDragCount.current <= 0) {
        centerDragCount.current = 0;
        setCenterDragOver(false);
    }
}, []);

const handleCenterDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    centerDragCount.current = 0;
    setCenterDragOver(false);
    const payload = getTraitDragData(e.dataTransfer);
    if (!payload) return;
    const traits = resolveTraits(payload.typeId);
    const linkTrait = traits?.get(LINK);
    if (!linkTrait) return;
    const items = linkTrait.getItems(payload.data);
    if (items.length) {
        vm.importLinks(items);
    }
}, [vm]);
```

Apply handlers to center panel div (around line 344):

Before:
```tsx
<div className="center-panel">
```

After:
```tsx
<div
    className={clsx("center-panel", centerDragOver && "drag-over")}
    onDragEnter={handleCenterDragEnter}
    onDragOver={handleCenterDragOver}
    onDragLeave={handleCenterDragLeave}
    onDrop={handleCenterDrop}
>
```

Add `.drag-over` style to `LinkEditorRoot` styled component (after `"& .center-panel"` block, around line 55):
```typescript
"& .center-panel.drag-over": {
    outline: `2px dashed ${color.border.active}`,
    outlineOffset: -2,
},
```

### Step 2: Add importLinks with async recursive folder scanning to LinkViewModel

**Modify** `src/renderer/editors/link-editor/LinkViewModel.ts`:

Add the `importLinks` method after `addLink` (after line 528). This method:
- Accepts an array of `ILink` items
- For non-directory items: adds them directly (skipping duplicates)
- For directory items: recursively scans the folder tree
- Uses a **100-file threshold**: if the initial scan finds ≥100 files, it shows a confirmation dialog asking the user whether to import all. If declined, the entire operation is cancelled.
- Deduplicates by href (case-insensitive) against existing links

```typescript
/**
 * Import one or more ILink items into the collection.
 * Directories are scanned recursively; if the scan exceeds 100 files,
 * a confirmation dialog asks the user before proceeding.
 * Duplicate hrefs (already in collection) are skipped.
 */
importLinks = async (items: ILink[]) => {
    const fp = await import("../../core/utils/file-path");
    const existingHrefs = new Set(
        this.state.get().data.links.map((l) => l.href.toLowerCase()),
    );

    // Collect non-directory items immediately
    const directLinks: Partial<LinkItem>[] = [];
    const foldersToScan: ILink[] = [];

    for (const item of items) {
        if (item.isDirectory) {
            foldersToScan.push(item);
        } else {
            if (existingHrefs.has(item.href.toLowerCase())) continue;
            existingHrefs.add(item.href.toLowerCase());
            directLinks.push({
                title: item.title,
                href: item.href,
                category: item.category || "",
                tags: item.tags?.length ? item.tags : undefined,
                imgSrc: item.imgSrc,
            });
        }
    }

    // Scan folders recursively with a 100-file limit for the first pass
    const SCAN_LIMIT = 100;
    let folderLinks: Partial<LinkItem>[] = [];

    if (foldersToScan.length) {
        const { app } = await import("../../api/app");
        const scanned = await this.scanFolders(
            foldersToScan, existingHrefs, fp, SCAN_LIMIT,
        );

        if (scanned.limitReached) {
            // First pass hit the limit — ask user
            const choice = await ui.confirm(
                `The folder contains more than ${SCAN_LIMIT} files. Import all files?`,
                { title: "Import Folder", buttons: ["Import All", "Cancel"] },
            );
            if (choice !== "Import All") return; // Cancel entire operation

            // Re-scan without limit
            const existingHrefs2 = new Set(
                this.state.get().data.links.map((l) => l.href.toLowerCase()),
            );
            // Re-add directLinks hrefs to dedup set
            for (const dl of directLinks) {
                if (dl.href) existingHrefs2.add(dl.href.toLowerCase());
            }
            const fullScan = await this.scanFolders(
                foldersToScan, existingHrefs2, fp, 0,
            );
            folderLinks = fullScan.links;
        } else {
            folderLinks = scanned.links;
        }
    }

    const allLinks = [...directLinks, ...folderLinks];

    if (!allLinks.length) {
        const { app } = await import("../../api/app");
        app.ui.notify("All items already exist in this collection", "info");
        return;
    }

    for (const link of allLinks) {
        this.addLink(link);
    }

    if (allLinks.length > 1) {
        const { app } = await import("../../api/app");
        app.ui.notify(`Imported ${allLinks.length} links`, "info");
    }
};

/**
 * Recursively scan folders and collect file links.
 * @param folders - ILink items with isDirectory=true to scan
 * @param existingHrefs - Set of existing hrefs (lowercase) for dedup
 * @param fp - file-path module
 * @param limit - max files to collect (0 = unlimited)
 * @returns collected links and whether the limit was reached
 */
private scanFolders = async (
    folders: ILink[],
    existingHrefs: Set<string>,
    fp: typeof import("../../core/utils/file-path"),
    limit: number,
): Promise<{ links: Partial<LinkItem>[]; limitReached: boolean }> => {
    const { app } = await import("../../api/app");
    const links: Partial<LinkItem>[] = [];
    const queue = [...folders];

    while (queue.length > 0) {
        const folder = queue.shift()!;
        let entries: { name: string; isDirectory: boolean }[];
        try {
            entries = await app.fs.listDirWithTypes(folder.href);
        } catch {
            continue; // Skip inaccessible folders
        }

        for (const entry of entries) {
            const fullPath = fp.join(folder.href, entry.name);
            if (entry.isDirectory) {
                queue.push({
                    title: entry.name,
                    href: fullPath,
                    category: folder.category || "",
                    tags: [],
                    isDirectory: true,
                });
                continue;
            }
            if (existingHrefs.has(fullPath.toLowerCase())) continue;
            existingHrefs.add(fullPath.toLowerCase());
            links.push({
                title: entry.name,
                href: fullPath,
                category: folder.category || "",
            });
            if (limit > 0 && links.length >= limit) {
                return { links, limitReached: true };
            }
        }
    }

    return { links, limitReached: false };
};
```

Note: `ui` is already imported at the top of `LinkViewModel.ts` (it uses `ui.confirm` in `deleteLink` and `moveCategory`). `app` is imported dynamically (lazy) to avoid circular deps — this follows the existing pattern (see `openLink` at line 746).

### Step 3: REST Client accepts ILink drops

**Modify** `src/renderer/editors/rest-client/RestClientEditor.tsx`:

Update imports to include trait resolution:
```typescript
import { TraitTypeId, TraitDragPayload, resolveTraits } from "../../core/traits";
import { LINK } from "../link-editor/linkTraits";
```

Update the `onTraitDrop` callback (lines 692-703):

Before:
```typescript
const onTraitDrop = useCallback(
    (dropItem: RequestTreeItem, payload: TraitDragPayload) => {
        if (dropItem.isRoot) return;
        const data = payload.data as { id: string };
        if (dropItem.isCollection) {
            vm.moveRequest(data.id, dropItem.id, dropItem.collectionName ?? "");
        } else {
            vm.moveRequest(data.id, dropItem.id, dropItem.request?.collection);
        }
    },
    [vm],
);
```

After:
```typescript
const onTraitDrop = useCallback(
    (dropItem: RequestTreeItem, payload: TraitDragPayload) => {
        if (dropItem.isRoot) return;

        if (payload.typeId === TraitTypeId.RestRequest) {
            // Same-type: reorder requests
            const data = payload.data as { id: string };
            if (dropItem.isCollection) {
                vm.moveRequest(data.id, dropItem.id, dropItem.collectionName ?? "");
            } else {
                vm.moveRequest(data.id, dropItem.id, dropItem.request?.collection);
            }
            return;
        }

        // Cross-type: check for LINK trait
        const traits = resolveTraits(payload.typeId);
        const linkTrait = traits?.get(LINK);
        if (!linkTrait) return;
        const items = linkTrait.getItems(payload.data);
        const collection = dropItem.isCollection
            ? (dropItem.collectionName ?? "")
            : (dropItem.request?.collection ?? "");
        for (const item of items) {
            if (!item.href) continue;
            const req = vm.addRequest(item.title || item.href, collection);
            vm.updateRequest(req.id, { url: item.href });
        }
    },
    [vm],
);
```

Add `canTraitDrop` after `getDragData` (around line 690) to reject types that are neither RestRequest nor LINK-capable:

```typescript
const canTraitDrop = useCallback(
    (dropItem: RequestTreeItem, payload: TraitDragPayload) => {
        if (dropItem.isRoot) return false;
        if (payload.typeId === TraitTypeId.RestRequest) return true;
        const traits = resolveTraits(payload.typeId);
        return !!traits?.get(LINK);
    },
    [],
);
```

Pass it to TreeView (around line 716):
```tsx
<TreeView<RequestTreeItem>
    ...
    canTraitDrop={canTraitDrop}
    ...
/>
```

### Step 4: Notebook category tree accepts ILink drops

**Modify** `src/renderer/editors/notebook/NotebookViewModel.ts`:

Add imports at top of file:
```typescript
import { resolveTraits } from "../../core/traits";
import { LINK } from "../link-editor/linkTraits";
import type { ILink } from "../../api/types/io.tree";
```

Update `categoryTraitDrop` (line 636-644) to handle ILink drops:

Before:
```typescript
categoryTraitDrop = (dropItem: CategoryTreeItem, payload: TraitDragPayload) => {
    if (payload.typeId === TraitTypeId.Note) {
        const data = payload.data as { noteId: string };
        this.updateNoteCategory(data.noteId, dropItem.category);
    } else if (payload.typeId === TraitTypeId.NotebookCategory) {
        const data = payload.data as { category: string };
        this.moveCategory(data.category, dropItem.category);
    }
};
```

After:
```typescript
categoryTraitDrop = (dropItem: CategoryTreeItem, payload: TraitDragPayload) => {
    if (payload.typeId === TraitTypeId.Note) {
        const data = payload.data as { noteId: string };
        this.updateNoteCategory(data.noteId, dropItem.category);
    } else if (payload.typeId === TraitTypeId.NotebookCategory) {
        const data = payload.data as { category: string };
        this.moveCategory(data.category, dropItem.category);
    } else {
        // Cross-type: check for LINK trait
        const traits = resolveTraits(payload.typeId);
        const linkTrait = traits?.get(LINK);
        if (!linkTrait) return;
        const items = linkTrait.getItems(payload.data);
        for (const item of items) {
            this.createNoteFromLink(item, dropItem.category);
        }
    }
};
```

Add helper method `createNoteFromLink` (after `categoryTraitDrop`):
```typescript
/**
 * Create a new note from a dropped ILink item.
 */
private createNoteFromLink = (link: ILink, category: string) => {
    const now = new Date().toISOString();
    const note: NoteItem = {
        id: crypto.randomUUID(),
        title: link.title || link.href,
        category,
        tags: [],
        content: {
            language: "plaintext",
            content: link.href,
        },
        createdDate: now,
        updatedDate: now,
    };
    this.state.update((s) => {
        s.data.notes.unshift(note);
    });
    this.loadCategories();
    this.applyFilters();
};
```

**Modify** `src/renderer/editors/notebook/NotebookEditor.tsx`:

Add `canTraitDrop` to filter acceptable drops (otherwise any trait drag shows a drop indicator).

Add imports:
```typescript
import { resolveTraits } from "../../core/traits";
import { LINK } from "../link-editor/linkTraits";
```

Add `TraitDragPayload` to the existing traits import:
```typescript
import { TraitTypeId, TraitDragPayload } from "../../core/traits";
```

(Merge with the existing import — `TraitTypeId` is already imported.)

Add callback:
```typescript
const canCategoryTraitDrop = useCallback(
    (_dropItem: CategoryTreeItem, payload: TraitDragPayload) => {
        if (payload.typeId === TraitTypeId.Note) return true;
        if (payload.typeId === TraitTypeId.NotebookCategory) return true;
        const traits = resolveTraits(payload.typeId);
        return !!traits?.get(LINK);
    },
    [],
);
```

Pass to CategoryTree (around line 291):
```tsx
<CategoryTree
    ...
    canTraitDrop={canCategoryTraitDrop}
    ...
/>
```

## Concerns / Open Questions

### 1. Folder scanning strategy (RESOLVED)
**Decision:** Async recursive scan of the full folder tree. First pass uses a **100-file limit**. If the limit is reached, a confirmation dialog asks "The folder contains more than 100 files. Import all files?" with "Import All" / "Cancel" buttons. If confirmed, a full unlimited re-scan runs. If cancelled, the entire operation is aborted (no partial import). This protects against accidental drops while still enabling intentional large imports.

### 2. Duplicate detection strategy (RESOLVED)
**Decision:** Skip items where `href` (case-insensitive) already exists in the link collection. Show a notification if all items were duplicates. This is simple and matches user expectations.

### 3. Drop effect: "copy" vs "move" (RESOLVED)
**Decision:** Cross-type drops use `dropEffect = "copy"` (items are added to the target without removing from source). Same-type drops within an editor continue using `dropEffect = "move"` (reorder/relocate).

### 4. BrowserTab drag to other editors (DEFERRED)
**Decision:** Not implementing browser tab drag to link editor in this task. Dragging browser tabs to external targets is not a common UX pattern. A future task could explore dragging selected text/URLs from the browser as ILink, but that is out of scope here.

## Acceptance Criteria

- [ ] Dragging a file from the explorer onto the link editor's center panel creates a link to that file
- [ ] Dragging a folder from the explorer onto the link editor's center panel recursively scans and imports files as links
- [ ] When a folder scan finds ≥100 files, a confirmation dialog appears; "Cancel" aborts the entire import
- [ ] When a folder scan finds ≥100 files and user confirms, all files are imported
- [ ] Duplicate hrefs are skipped during import (no duplicates created)
- [ ] A notification shows how many links were imported (when >1)
- [ ] Dragging a link (ILink) onto the REST client tree creates a new request with that URL
- [ ] Dropping a link on a REST collection node places the new request in that collection
- [ ] Dragging a link (ILink) onto a notebook category creates a new note with the link's title and URL as content
- [ ] Existing same-type drops still work (REST request reorder, note/category moves, browser tab reorder)
- [ ] Visual feedback (dashed outline) appears on link editor center panel during drag-over
- [ ] Cross-type drops show `dropEffect = "copy"` cursor, not "move"

## Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `src/renderer/editors/link-editor/LinkEditor.tsx` | Modify | Add drop zone on center panel with drag-over styling |
| `src/renderer/editors/link-editor/LinkViewModel.ts` | Modify | Add `importLinks()` with async recursive folder scanning, 100-file confirmation, and dedup |
| `src/renderer/editors/rest-client/RestClientEditor.tsx` | Modify | Accept ILink drops in `onTraitDrop`; add `canTraitDrop` |
| `src/renderer/editors/notebook/NotebookViewModel.ts` | Modify | Accept ILink drops in `categoryTraitDrop`; add `createNoteFromLink` |
| `src/renderer/editors/notebook/NotebookEditor.tsx` | Modify | Add `canTraitDrop` for category tree |

### Files that need NO changes
- `src/renderer/core/traits/*` — All infrastructure already in place
- `src/renderer/components/TreeView/*` — Already handles trait drops generically
- `src/renderer/components/tree-provider/TreeProviderView.tsx` — Already accepts LINK trait drops
- `src/renderer/editors/link-editor/linkTraits.ts` — LINK trait key and ILink registration unchanged
- `src/renderer/editors/link-editor/PinnedLinksPanel.tsx` — Self-contained pin reorder, no changes
- `src/renderer/editors/browser/*` — No changes in this task (deferred)
- `src/renderer/editors/todo/*` — Not in scope
- `src/renderer/editors/link-editor/linkTypes.ts` — No schema changes
- `src/renderer/editors/rest-client/restClientTypes.ts` — No schema changes
- `src/renderer/editors/notebook/notebookTypes.ts` — No schema changes
