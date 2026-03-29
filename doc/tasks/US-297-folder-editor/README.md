# US-297: CategoryEditor + tree-category:// Link Resolution

**Status:** Complete
**Epic:** EPIC-015 (Phase 3, Task 3.3)
**Depends on:** US-298 (NavigationData) — completed

## Goal

Create a `CategoryEditor` that wraps `CategoryView` for displaying folder/category contents. Define a `tree-category://` link format that the pipeline resolves to CategoryEditor. Folder clicks in PageNavigator go through the `openRawLink` pipeline — no special folder handling.

## Background

### NavigationData (US-298 — completed)

`NavigationData` survives page navigation and holds:
- `treeProvider: ITreeProvider | null` — shared between PageNavigator and CategoryEditor
- `pageNavigatorModel` — sidebar state
- `renderId` — stable React key (keeps PageNavigator mounted)

The `treeProvider` is the key: both PageNavigator (sidebar) and CategoryEditor (content area) read the same provider instance from `NavigationData`. No global registry needed.

### The problem

When a user clicks a folder in PageNavigator, the page needs to display CategoryView. But `navigatePageTo` creates a new page model via `editorRegistry.resolve(filePath)`. For directories:
- FileTreeProvider folders are real OS directories — `statSync` can detect them
- ZipTreeProvider categories are inner archive paths — not real paths
- LinkTreeProvider categories are virtual — not paths at all

The resolver can't reliably detect what a category path is. We need an unambiguous link format.

### The solution

Two-part approach:
1. **`tree-category://` link format** — unambiguous, carries metadata for any provider type
2. **CategoryEditor** gets the `treeProvider` from `NavigationData` on the page model — no need to create a new provider from the link

### Flow

```
User clicks folder in PageNavigator
    ↓
PageNavigator calls: provider.getNavigationUrl(item) → "tree-category://<encoded>"
    sends: openRawLink("tree-category://<encoded>", { pageId })
    ↓
Layer 1 parser: detects "tree-category://" prefix → openLink with target="category-view"
    ↓
Layer 2 resolver: passes through (target already set)
    ↓
Layer 3 open handler: navigatePageTo → transfers NavigationData → creates CategoryPageModel
    ↓
CategoryEditor reads navigationData.treeProvider → renders CategoryView(provider, category)
```

The `tree-category://` link is only used for routing — the actual provider instance comes from `NavigationData`.

## Design

### ITreeProvider.getNavigationUrl(item)

New method on `ITreeProvider` — returns a raw link string for navigating to any item:

```typescript
interface ITreeProvider {
    // ... existing methods ...

    /** Return a raw link for opening an item via openRawLink pipeline.
     *  For files: returns item.href (file path, HTTP URL, etc.).
     *  For directories: returns a tree-category:// link. */
    getNavigationUrl(item: ITreeProviderItem): string;
}
```

**Why on the provider?** The provider owns the link format. FileTreeProvider knows how to encode `{ type: "file", url, category }`. ZipTreeProvider encodes `{ type: "zip", url, category }`. The UI layer never constructs category links — it just calls `provider.getNavigationUrl(item)` and passes the result to `openRawLink`.

FileTreeProvider implementation:
```typescript
getNavigationUrl(item: ITreeProviderItem): string {
    if (!item.isDirectory) return item.href;
    return encodeCategoryLink({
        type: this.type,
        url: this.sourceUrl,
        category: item.href,  // for FileTreeProvider, href = absolute path
    });
}
```

### ITreeProviderLink

Minimal metadata encoded in the link. Used for:
- Routing (the parser detects the prefix and sets the editor target)
- Fallback provider creation (if NavigationData doesn't have a provider — e.g., opening a folder link from outside)

```typescript
interface ITreeProviderLink {
    /** Provider type: "file", "zip", "link". */
    type: string;
    /** Source URL (folder path, archive path, .link.json path). */
    url: string;
    /** Category path to display in CategoryView. */
    category: string;
}
```

Encoding: JSON stringified + base64 in the URL:
```
tree-category://<base64 JSON>
```

### CategoryEditor

A `"page-editor"` that reads the provider from `NavigationData`:

```typescript
function CategoryEditor({ model }: { model: CategoryPageModel }) {
    const navData = model.navigationData;
    const provider = navData?.treeProvider;
    const categoryPath = model.categoryPath;  // decoded from tree-category:// link

    if (!provider) {
        // Fallback: create provider from link metadata
        // (happens when opening a folder link from outside, no NavigationData yet)
    }

    // Unified handler — getNavigationUrl returns the right link for both files and folders
    const handleNavigate = useCallback((item: ITreeProviderItem) => {
        const url = provider?.getNavigationUrl(item) ?? item.href;
        app.events.openRawLink.sendAsync(new RawLinkEvent(url, undefined, { pageId }));
    }, [provider, pageId]);

    return (
        <CategoryView
            provider={provider}
            category={categoryPath}
            onItemClick={handleNavigate}
            onFolderClick={handleNavigate}
        />
    );
}
```

**Item/folder click** — unified via `provider.getNavigationUrl(item)`:
- For files, returns `item.href` → opens file editor
- For folders, returns `tree-category://` link → opens CategoryEditor for subfolder

CategoryView has separate `onItemClick`/`onFolderClick` props, but CategoryEditor passes the same handler to both.

### PageNavigator changes

PageNavigator uses `provider.getNavigationUrl(item)` for all navigation — no if/else:

```typescript
const handleItemClick = useCallback((item: ITreeProviderItem) => {
    const url = navigationData.treeProvider?.getNavigationUrl(item) ?? item.href;
    app.events.openRawLink.sendAsync(new RawLinkEvent(
        url,
        undefined,
        { pageId },
    ));
}, [pageId, navigationData]);
```

### CategoryPageModel

Extends `PageModel`. Stores:
- `categoryPath` — decoded from the `tree-category://` link
- Uses `navigationData.treeProvider` from transferred NavigationData

```typescript
class CategoryPageModel extends PageModel {
    categoryPath: string;

    constructor(link: ITreeProviderLink) {
        super();
        this.categoryPath = link.category;
        this.state.update((s) => {
            s.type = "categoryPage";  // or reuse existing type
            s.title = link.category.split("/").pop() || "Folder";
            s.filePath = encodeCategoryLink(link);  // for restore
        });
    }
}
```

### Editor registration

```typescript
editorRegistry.register({
    id: "category-view",
    name: "Folder View",
    pageType: "categoryPage",
    category: "page-editor",
    acceptFile: (fileName) => {
        if (fileName?.startsWith("tree-category://")) return 200;
        return -1;
    },
    loadModule: async () => { /* ... */ },
});
```

## Implementation Plan

### Step 1: Define ITreeProviderLink and encode/decode helpers
File: `src/renderer/content/tree-providers/tree-provider-link.ts`

### Step 2: Add `getNavigationUrl(item)` to ITreeProvider
File: `src/renderer/api/types/io.tree.d.ts` — add method to the interface.
File: `src/renderer/content/tree-providers/FileTreeProvider.ts` — implement: files return `item.href`, directories return `encodeCategoryLink(...)`.
File: `src/renderer/content/tree-providers/ZipTreeProvider.ts` — implement: files return `item.href`, directories return `encodeCategoryLink(...)`.

### Step 3: Register tree-category:// Layer 1 parser
File: `src/renderer/content/parsers.ts` — add parser that detects `tree-category://` prefix, decodes the link, fires `openLink` with `target="category-view"`.

### Step 4: Create CategoryPageModel
File: `src/renderer/editors/category/CategoryPageModel.ts`

### Step 5: Create CategoryEditor
File: `src/renderer/editors/category/CategoryEditor.tsx` — reads provider from `navigationData.treeProvider`, renders CategoryView. Item/folder clicks use `provider.getNavigationUrl(item)` → `openRawLink`.

### Step 6: Register CategoryEditor in editor registry
File: `src/renderer/editors/register-editors.ts`

### Step 7: Update PageNavigator — use `provider.getNavigationUrl(item)` for all navigation
File: `src/renderer/ui/navigation/PageNavigator.tsx` — replace file-only click handler with unified `getNavigationUrl` call.

### Step 8: Add "categoryPage" to PageType
File: `src/shared/types.ts`

## Files Changed

| File | Change |
|---|---|
| `src/renderer/content/tree-providers/tree-provider-link.ts` | **NEW** — ITreeProviderLink type, encode/decode |
| `src/renderer/api/types/io.tree.d.ts` | Add `getNavigationUrl(item)` method to ITreeProvider |
| `src/renderer/content/tree-providers/FileTreeProvider.ts` | Implement `getNavigationUrl` |
| `src/renderer/content/tree-providers/ZipTreeProvider.ts` | Implement `getNavigationUrl` |
| `src/renderer/content/parsers.ts` | Add tree-category:// parser |
| `src/renderer/editors/category/CategoryEditor.tsx` | **NEW** — page editor wrapping CategoryView |
| `src/renderer/editors/category/CategoryPageModel.ts` | **NEW** — page model for category viewing |
| `src/renderer/editors/register-editors.ts` | Register category-view editor |
| `src/renderer/ui/navigation/PageNavigator.tsx` | Use `provider.getNavigationUrl(item)` for all navigation |
| `src/shared/types.ts` | Add "categoryPage" to PageType |

## Files NOT Changed

- `src/renderer/components/tree-provider/CategoryView.tsx` — standalone, used as-is
- `src/renderer/ui/navigation/NavigationData.ts` — no changes needed
- `src/renderer/content/open-handler.ts` — existing handler works (navigatePageTo with pageId transfers NavigationData)

## Resolved Concerns

1. **~~TreeProviderRegistry~~** — **No longer needed.** NavigationData holds the treeProvider. Both PageNavigator and CategoryEditor access it from the same NavigationData instance (transferred during navigatePageTo). No ref-counting, no global state.

2. **~~Provider sharing between tabs~~** — **Not needed.** Each page has its own NavigationData with its own treeProvider. "Open in New Tab" creates a new page → new NavigationData → new provider. Simple and correct.

3. **~~Provider ID stability across restarts~~** — **Not an issue.** The `tree-category://` link carries `type` + `url` — enough to create a new provider on restore. No IDs in the link.

4. **~~Link encoding format~~** — **Decision: base64 JSON.** Simple, handles any characters. Not human-readable in logs, but category links are not shown to users. Can add logging helper if needed.

5. **~~Single-click folder behavior~~** — **Decision: keep expand/collapse on click in TreeProviderView.** Folder opening happens via double-click or context menu "Open". No change to TreeProviderView needed.

6. **~~CategoryEditor page model lifecycle~~** — **Resolved.** `editorRegistry.resolve(filePath)` detects `tree-category://` prefix via `acceptFile()`. `navigatePageTo` → `createPageFromFile` → creates `CategoryPageModel`. NavigationData transfers automatically.

## Acceptance Criteria

- [ ] `tree-category://` link format defined with encode/decode helpers
- [ ] `ITreeProvider.getNavigationUrl(item)` added — returns raw link for any item
- [ ] FileTreeProvider and ZipTreeProvider implement `getNavigationUrl`
- [ ] Layer 1 parser detects `tree-category://` prefix and routes to `category-view` editor
- [ ] CategoryEditor renders CategoryView with provider from `navigationData.treeProvider`
- [ ] CategoryPageModel stores category path, uses `tree-category://` as filePath for restore
- [ ] Clicking any item in CategoryView → `openRawLink(provider.getNavigationUrl(item))`
- [ ] Clicking any item in PageNavigator → `openRawLink(provider.getNavigationUrl(item))`
- [ ] NavigationData.treeProvider shared between PageNavigator and CategoryEditor
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
