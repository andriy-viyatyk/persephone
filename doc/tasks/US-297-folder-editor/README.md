# US-297: CategoryEditor + Tree Provider Registry + Category Link Resolution

**Status:** Planned — depends on US-298 (NavigationData)
**Epic:** EPIC-015 (Phase 3, Task 3.3)

## Goal

Create a `CategoryEditor` that wraps `CategoryView` for displaying folder/category contents. Introduce a `TreeProviderRegistry` with reference-counted provider lifecycle. Define a `tree-category://` link format that the pipeline resolves to CategoryEditor. This makes folders, archive directories, and link categories all navigable through the same `openRawLink` pipeline.

## Background

### The problem

When a user clicks a folder in PageNavigator, the page needs to display CategoryView with that folder's contents. But CategoryView needs an `ITreeProvider` — and the provider type depends on context:
- FileTreeProvider for local directories
- ZipTreeProvider for archive paths
- LinkTreeProvider for `.link.json` categories (future)

The Layer 2 resolver can't reliably detect what a path is — `"bookmarks/dev"` looks like a file path but is actually a LinkTreeProvider category. We need an unambiguous link format.

### The solution: `tree-category://` links

A new link format that carries all metadata needed to find or create the right provider:

```
tree-category://<base64 encoded ITreeProviderLink JSON>
```

### Key design: reference-counted provider registry

The `ITreeProvider` lives in a global registry with consumer counting. Multiple components can share the same provider instance:
- PageNavigator is one consumer
- CategoryEditor is another consumer
- "Open in New Tab" creates a third consumer on the same provider

When all consumers release, the provider is disposed.

## Design

### ITreeProviderLink

```typescript
interface ITreeProviderLink {
    /** Existing provider ID from registry. Undefined = create new. */
    id?: string;
    /** Provider type: "file", "zip", "link", etc. */
    type: string;
    /** Category path to display in CategoryView. */
    category: string;
    /** Source URL to create provider if id is missing or stale.
     *  File path for FileTreeProvider, archive path for ZipTreeProvider,
     *  .link.json path for LinkTreeProvider. */
    url: string;
}
```

### TreeProviderRegistry

```typescript
class TreeProviderRegistry {
    private providers = new Map<string, {
        provider: ITreeProvider;
        refCount: number;
    }>();

    /** Get existing or create new provider. Increments refCount. Returns { id, provider }. */
    acquire(link: ITreeProviderLink): { id: string; provider: ITreeProvider };

    /** Decrement refCount. Disposes provider when refCount reaches 0. */
    release(id: string): void;

    /** Get provider by id without incrementing refCount (for read-only access). */
    get(id: string): ITreeProvider | undefined;
}
```

Factory for creating providers from link metadata:
```typescript
function createProviderFromLink(link: ITreeProviderLink): ITreeProvider {
    switch (link.type) {
        case "file": return new FileTreeProvider(link.url);
        case "zip": return new ZipTreeProvider(link.url);
        // case "link": return new LinkTreeProvider(link.url);
        default: throw new Error(`Unknown provider type: ${link.type}`);
    }
}
```

### Link flow

```
User clicks folder in PageNavigator
    ↓
PageNavigator constructs tree-category:// link:
    { id: "42", type: "file", category: "src/utils", url: "C:\\projects" }
    ↓
openRawLink("tree-category://eyJpZC...") with { pageId }
    ↓
Layer 1 parser: detects "tree-category://" prefix → openLink
    ↓
Layer 2 resolver: decodes link → target = "category-view"
    ↓
Layer 3 open handler: navigatePageTo → CategoryEditor
    ↓
CategoryEditor: registry.acquire(link) → gets provider → renders CategoryView
```

### Consumer scenarios

**Scenario 1: Page with PageNavigator → click folder**
1. PageNavigator creates FileTreeProvider → `registry.acquire()` → refCount=1, id="1"
2. User clicks folder → `openRawLink("tree-category://...?id=1&category=src/utils")`
3. CategoryEditor → `registry.acquire({ id: "1", ... })` → refCount=2, same provider
4. Page closes → both release → refCount=0 → dispose

**Scenario 2: Open folder directly (no PageNavigator yet)**
1. `openRawLink("tree-category://{ type: 'file', url: 'C:\\projects\\src', category: '...' }")`
2. CategoryEditor → `registry.acquire({ type: "file", url: "..." })` → creates new, refCount=1, id="2"
3. User opens PageNavigator → acquires same provider by id → refCount=2
4. Both share same provider instance

**Scenario 3: "Open in New Tab" from context menu**
1. Page 1 has provider id="1", refCount=2 (PageNavigator + CategoryEditor)
2. Context menu "Open in New Tab" → `openRawLink("tree-category://...?id=1&category=subfolder")`
3. New page's CategoryEditor → `registry.acquire({ id: "1" })` → refCount=3
4. Close page 1 → refCount=1 (page 2 still active)

### CategoryEditor

A `"page-editor"` registered in the editor registry:

```typescript
function CategoryEditor({ model }: { model: CategoryPageModel }) {
    // model.categoryLink contains the decoded ITreeProviderLink
    const { providerId, provider } = useTreeProvider(model.categoryLink);
    // Release provider on unmount
    useEffect(() => () => registry.release(providerId), [providerId]);

    return (
        <CategoryView
            provider={provider}
            category={model.categoryLink.category}
            onItemClick={handleItemClick}
            onFolderClick={handleFolderClick}
        />
    );
}
```

When a file is clicked in CategoryView → `openRawLink(item.href, { pageId })` → navigates to file editor.
When a folder is clicked in CategoryView → constructs `tree-category://` link → navigates to CategoryEditor for that subfolder.

### PageNavigator changes

PageNavigator distinguishes file vs folder clicks:

```typescript
const handleItemClick = useCallback((item: ITreeProviderItem) => {
    if (item.isDirectory) {
        const link: ITreeProviderLink = {
            id: providerId,
            type: provider.type,
            category: /* category path for this folder */,
            url: provider.sourceUrl,
        };
        app.events.openRawLink.sendAsync(new RawLinkEvent(
            encodeCategoryLink(link),
            undefined,
            { pageId },
        ));
    } else {
        app.events.openRawLink.sendAsync(new RawLinkEvent(
            item.href,
            undefined,
            { pageId },
        ));
    }
}, [pageId, providerId, provider]);
```

## Implementation Plan

### Step 1: Create TreeProviderRegistry
File: `src/renderer/content/tree-providers/tree-provider-registry.ts`

### Step 2: Define ITreeProviderLink type and encode/decode helpers
File: `src/renderer/content/tree-providers/tree-provider-link.ts`

### Step 3: Register tree-category:// Layer 1 parser
Add to `parsers.ts` or create separate `tree-category-parser.ts`

### Step 4: Register tree-category:// Layer 2 resolver
Add folder/category resolver to `resolvers.ts`

### Step 5: Create CategoryEditor + CategoryPageModel
Files: `src/renderer/editors/category/CategoryEditor.tsx`, `CategoryPageModel.ts`

### Step 6: Register CategoryEditor in editor registry
File: `src/renderer/editors/register-editors.ts`

### Step 7: Update PageNavigator
- Register provider in registry on create
- Construct tree-category:// links for folder clicks
- Release provider on dispose

### Step 8: Update TreeProviderView
- Single-click folder = open (not toggle expand) — sends event to parent
- Remove `onFolderDoubleClick` prop (single click replaces it)

## Files Changed

| File | Change |
|---|---|
| `src/renderer/content/tree-providers/tree-provider-registry.ts` | **NEW** — ref-counted provider registry |
| `src/renderer/content/tree-providers/tree-provider-link.ts` | **NEW** — ITreeProviderLink type, encode/decode |
| `src/renderer/content/parsers.ts` | Add tree-category:// parser |
| `src/renderer/content/resolvers.ts` | Add category resolver |
| `src/renderer/editors/category/CategoryEditor.tsx` | **NEW** — page editor wrapping CategoryView |
| `src/renderer/editors/category/CategoryPageModel.ts` | **NEW** — page model for category viewing |
| `src/renderer/editors/register-editors.ts` | Register category-view editor |
| `src/renderer/ui/navigation/PageNavigator.tsx` | Use registry, construct category links for folders |

## Concerns

1. **Link encoding format:** Base64 JSON is simple but not human-readable in logs/debugging. URL-encoded query params are more readable but more complex to parse. **Decision needed.**

2. **Provider ID stability:** If the app restores a page from cache with a `tree-category://` link containing an old provider ID, the registry won't have it. The link's `url` and `type` fields allow creating a new provider as fallback. **Not blocking — fallback handles it.**

3. **Single-click folder behavior change:** Currently clicking a folder in TreeProviderView toggles expand/collapse. New behavior: clicking opens in CategoryEditor. Expanding folders still works via the chevron arrow. **Need to verify TreeView supports click-on-label vs click-on-chevron distinction.**

4. **CategoryEditor page model lifecycle:** `navigatePageTo` calls `createPageFromFile(filePath)` which uses `editorRegistry.resolve(filePath)`. For `tree-category://` links, the "filePath" is the encoded link. The editor's `acceptFile()` needs to detect the `tree-category://` prefix. **Not blocking — same pattern as other editors.**
