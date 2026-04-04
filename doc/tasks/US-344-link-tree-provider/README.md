# US-344: LinkTreeProvider

**Epic:** [EPIC-018](../../epics/EPIC-018.md) Phase 1, Task 1.1
**Status:** Planned

## Goal

Create `LinkTreeProvider` — an `ITreeProvider` implementation that wraps `LinkViewModel` internal state, exposing link collection data through the standard tree provider interface. This enables `CategoryView` (and later `CategoryEditor`) to render link collections the same way it renders filesystem folders and archive entries.

## Background

### ITreeProvider pattern

Existing providers (`FileTreeProvider`, `ZipTreeProvider`) implement the `ITreeProvider` interface from `src/renderer/api/types/io.tree.d.ts`. Key characteristics:
- `list(path)` returns `ITreeProviderItem[]` — direct children at a given path
- `type` + `sourceUrl` identify the provider (used by CategoryEditor for matching)
- Feature flags (`writable`, `navigable`, `hasTags`, `hasHostnames`, `pinnable`) declare capabilities
- Optional methods (`addItem`, `deleteItem`, `getTags`, `pin`, etc.) implement capabilities

### LinkViewModel state

`LinkViewModel` (`src/renderer/editors/link-editor/LinkViewModel.ts`) manages:
- `state.data.links: LinkItem[]` — all links in the collection
- `state.categories: string[]` — all unique category paths (e.g., `"Tech/Programming/Go"`)
- `state.categoriesSize: Record<string, number>` — item count per category
- `state.tags: string[]`, `state.tagsSize` — tag index with ":" parent hierarchy
- `state.hostnames: string[]`, `state.hostnamesSize` — hostname index
- `state.data.state.pinnedLinks: string[]` — ordered pinned link IDs
- CRUD methods: `addLink()`, `updateLink()`, `deleteLink()`

### How categories work as paths

Categories use "/" separator for hierarchy: `"Bookmarks/Tech/AI"`. The `list()` method must:
1. Find **sub-categories** — unique direct children of the given category path
2. Find **leaf links** — items whose `category` exactly matches the given path
3. Return sub-categories as directory items + leaf links as file items

Example for `list("Bookmarks")`:
- Links with `category = "Bookmarks/Tech"` and `category = "Bookmarks/Design"` → directory items `"Tech"` and `"Design"`
- Links with `category = "Bookmarks"` → file items (the links themselves)

### LinkItem ↔ ITreeProviderItem mapping

```
LinkItem.title     → ITreeProviderItem.name
LinkItem.href      → ITreeProviderItem.href
LinkItem.category  → ITreeProviderItem.category
LinkItem.tags      → ITreeProviderItem.tags
LinkItem.imgSrc    → ITreeProviderItem.imgSrc
LinkItem.isCategory → ITreeProviderItem.isDirectory
```

## Implementation Plan

### Step 1: Create `LinkTreeProvider` class

**File:** `src/renderer/editors/link-editor/LinkTreeProvider.ts` (new)

```typescript
import type { ITreeProvider, ITreeProviderItem, ITreeStat, ITreeTagInfo } from "../../api/types/io.tree";
import { encodeCategoryLink } from "../../content/tree-providers/tree-provider-link";
import { getHostname } from "../../components/tree-provider/favicon-cache";
import type { LinkViewModel } from "./LinkViewModel";
import type { LinkItem } from "./linkTypes";
```

#### Properties

```typescript
readonly type = "link";
readonly displayName: string;   // basename of sourceUrl (or "Links" if no file)
readonly sourceUrl: string;     // file path of .link.json (from vm.host.state.filePath or vm.pageModel.filePath)
readonly rootPath = "";         // root category = empty string

readonly navigable = false;     // no up-navigation for link collections
readonly writable = true;       // supports addItem, deleteItem, updateItem, moveToCategory
readonly hasTags = true;        // supports getTags, getTagItems
readonly hasHostnames = true;   // supports getHostnames, getHostnameItems
readonly pinnable = true;       // supports pin, unpin, getPinnedItems
```

Constructor takes `LinkViewModel` reference and `sourceUrl: string`.

#### `list(categoryPath: string): Promise<ITreeProviderItem[]>`

Core logic — enumerate direct children of a category:

```typescript
async list(categoryPath: string): Promise<ITreeProviderItem[]> {
    const links = this.vm.state.get().data.links;
    const prefix = categoryPath ? categoryPath + "/" : "";
    const subCategories = new Map<string, number>(); // name → item count
    const items: ITreeProviderItem[] = [];

    for (const link of links) {
        const cat = link.category || "";
        if (cat === categoryPath) {
            // Direct child — leaf link item
            items.push(this.linkToItem(link));
        } else if (prefix && cat.startsWith(prefix)) {
            // Sub-category — extract direct child name
            const rest = cat.slice(prefix.length);
            const childName = rest.split("/")[0];
            subCategories.set(childName, (subCategories.get(childName) || 0) + 1);
        } else if (!categoryPath && cat && !cat.includes("/")) {
            // Root level: top-level single-segment categories
            subCategories.set(cat, (subCategories.get(cat) || 0) + 1);
        } else if (!categoryPath && cat && cat.includes("/")) {
            // Root level: multi-segment categories — extract first segment
            const topName = cat.split("/")[0];
            subCategories.set(topName, (subCategories.get(topName) || 0) + 1);
        }
    }

    // Build directory items for sub-categories (sorted alphabetically)
    const dirItems: ITreeProviderItem[] = [];
    for (const [name, count] of [...subCategories.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const fullCategory = prefix ? prefix + name : name;
        dirItems.push({
            name,
            href: fullCategory,         // href = full category path
            category: categoryPath,
            tags: [],
            isDirectory: true,
            size: count,                 // item count as "size"
        });
    }

    return [...dirItems, ...items];
}
```

**Note on root listing:** When `categoryPath === ""`:
- Links with `category === ""` are leaf items (uncategorized)
- Links with `category === "Tech"` contribute to sub-category `"Tech"`
- Links with `category === "Tech/AI"` contribute to sub-category `"Tech"`

#### `linkToItem(link: LinkItem): ITreeProviderItem`

Private helper to convert LinkItem to ITreeProviderItem:

```typescript
private linkToItem(link: LinkItem): ITreeProviderItem {
    return {
        name: link.title || link.href,
        href: link.href,
        category: link.category || "",
        tags: link.tags || [],
        isDirectory: !!link.isCategory,
        imgSrc: link.imgSrc,
    };
}
```

**Note:** We use `link.href` as the item's `href`. For `addItem`/`deleteItem`/`updateItem`, the link is identified by `href`. Since multiple links can share the same href, we'll actually use `link.id` encoded into the href for CRUD operations — see Concern 1.

#### `stat(path: string): Promise<ITreeStat>`

Check if a category or link exists:

```typescript
async stat(path: string): Promise<ITreeStat> {
    // Check if it's a known category
    const cats = this.vm.state.get().categoriesSize;
    if (path in cats) {
        return { exists: true, isDirectory: true };
    }
    // Check if it's a link href
    const link = this.vm.state.get().data.links.find(l => l.href === path);
    if (link) {
        return { exists: true, isDirectory: !!link.isCategory };
    }
    return { exists: false, isDirectory: false };
}
```

#### `resolveLink(path: string): string`

```typescript
resolveLink(path: string): string {
    return path; // href is already a raw link
}
```

#### `getNavigationUrl(item: ITreeProviderItem): string`

```typescript
getNavigationUrl(item: ITreeProviderItem): string {
    if (item.isDirectory) {
        return encodeCategoryLink({ type: this.type, url: this.sourceUrl, category: item.href });
    }
    return item.href;
}
```

#### `getNavigationUrlByHref(href: string): Promise<string>`

```typescript
async getNavigationUrlByHref(href: string): Promise<string> {
    const s = await this.stat(href);
    if (s.isDirectory) {
        return encodeCategoryLink({ type: this.type, url: this.sourceUrl, category: href });
    }
    return href;
}
```

#### Write operations

```typescript
async addItem(item: Partial<ITreeProviderItem> & { href: string }): Promise<ITreeProviderItem> {
    const newLink = this.vm.addLink({
        title: item.name,
        href: item.href,
        category: item.category,
        tags: item.tags,
        imgSrc: item.imgSrc,
    });
    return this.linkToItem(newLink);
}

async updateItem(href: string, changes: Partial<ITreeProviderItem>): Promise<ITreeProviderItem> {
    const link = this.vm.state.get().data.links.find(l => l.href === href);
    if (!link) throw new Error(`Link not found: ${href}`);
    this.vm.updateLink(link.id, {
        title: changes.name,
        href: changes.href,
        category: changes.category,
        tags: changes.tags,
        imgSrc: changes.imgSrc,
    });
    const updated = this.vm.getLinkById(link.id)!;
    return this.linkToItem(updated);
}

async deleteItem(href: string): Promise<void> {
    const link = this.vm.state.get().data.links.find(l => l.href === href);
    if (link) {
        await this.vm.deleteLink(link.id, true); // skipConfirm — caller handles confirmation
    }
}

async moveToCategory(hrefs: string[], targetCategory: string): Promise<void> {
    for (const href of hrefs) {
        const link = this.vm.state.get().data.links.find(l => l.href === href);
        if (link) {
            this.vm.moveLinkToCategory(link.id, targetCategory);
        }
    }
}
```

#### Tag operations

```typescript
getTags(): ITreeTagInfo[] {
    const { tags, tagsSize } = this.vm.state.get();
    return tags.map(t => ({ name: t, count: tagsSize[t] || 0 }));
}

getTagItems(tag: string): ITreeProviderItem[] {
    const links = this.vm.state.get().data.links;
    const separator = ":";
    let filtered: LinkItem[];

    if (tag.endsWith(separator)) {
        filtered = links.filter(l => l.tags?.some(t => t.startsWith(tag) || t === tag));
    } else {
        filtered = links.filter(l => l.tags?.includes(tag));
    }
    return filtered.map(l => this.linkToItem(l));
}
```

#### Hostname operations

```typescript
getHostnames(): ITreeTagInfo[] {
    const { hostnames, hostnamesSize } = this.vm.state.get();
    return hostnames.map(h => ({ name: h, count: hostnamesSize[h] || 0 }));
}

getHostnameItems(hostname: string): ITreeProviderItem[] {
    const links = this.vm.state.get().data.links;
    return links
        .filter(l => getHostname(l.href) === hostname)
        .map(l => this.linkToItem(l));
}
```

#### Pin operations

```typescript
pin(href: string): void {
    const link = this.vm.state.get().data.links.find(l => l.href === href);
    if (link) this.vm.pinLink(link.id);
}

unpin(href: string): void {
    const link = this.vm.state.get().data.links.find(l => l.href === href);
    if (link) this.vm.unpinLink(link.id);
}

getPinnedItems(): ITreeProviderItem[] {
    return this.vm.getPinnedLinks().map(l => this.linkToItem(l));
}
```

### Step 2: Create and expose `treeProvider` from `LinkViewModel`

**File:** `src/renderer/editors/link-editor/LinkViewModel.ts` (modify)

Add a `treeProvider` property that is lazily created on first access:

```typescript
// After constructor, add:
private _treeProvider: LinkTreeProvider | null = null;

get treeProvider(): LinkTreeProvider {
    if (!this._treeProvider) {
        this._treeProvider = new LinkTreeProvider(this, this.pageModel.filePath || "");
    }
    return this._treeProvider;
}
```

Import `LinkTreeProvider` at the top of the file.

**Note:** `sourceUrl` comes from `this.pageModel.filePath` — the `filePath` getter is on `EditorModel` base class (`src/renderer/editors/base/EditorModel.ts:70`). For browser context (no file), it will be empty — that's fine since CategoryEditor matching won't apply there (see Concern 3).

## Concerns

### 1. Link identification by href vs id — RESOLVED

`ITreeProvider` methods like `deleteItem(href)`, `updateItem(href, ...)`, `pin(href)` use `href` to identify items. But `LinkItem` uses `id` (UUID) as its primary key, and multiple links can share the same `href`.

**Resolution:** Use first-match approach (`find(l => l.href === href)`). Duplicate hrefs are uncommon in practice. If it becomes a real issue, we can add a `metadata` field to `ITreeProviderItem` in the future.

### 2. Change notification / watch — RESOLVED

**Resolution:** Implement `watch()` by subscribing to `vm.state`. This keeps the provider self-contained and ensures any consumer (not just LinkEditor) gets updates:

```typescript
watch(callback: () => void): ISubscriptionObject {
    return { dispose: this.vm.state.subscribe(callback) };
}
```

### 3. sourceUrl for browser context — RESOLVED

**Resolution:** `sourceUrl` is never empty. The browser loads bookmarks from a `.link.json` file configured in settings. `TextFileModel` always has a `filePath` in this case. There is no virtual bookmark implementation without a file.

## Acceptance Criteria

- [ ] `LinkTreeProvider` class implements `ITreeProvider` interface
- [ ] `list("")` returns top-level categories as directories + uncategorized links as files
- [ ] `list("category/path")` returns sub-categories + links in that exact category
- [ ] Write operations (`addItem`, `deleteItem`, `updateItem`, `moveToCategory`) delegate to `LinkViewModel`
- [ ] `getTags()` / `getTagItems()` return correct data from LinkViewModel state
- [ ] `getHostnames()` / `getHostnameItems()` return correct data
- [ ] `pin()` / `unpin()` / `getPinnedItems()` delegate to LinkViewModel
- [ ] `watch()` notifies on state changes
- [ ] `LinkViewModel.treeProvider` property returns the provider instance
- [ ] No regressions in existing LinkEditor behavior

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/link-editor/LinkTreeProvider.ts` | **New** — ITreeProvider implementation |
| `src/renderer/editors/link-editor/LinkViewModel.ts` | Add `treeProvider` getter, import LinkTreeProvider |

### Files NOT changed

- `src/renderer/api/types/io.tree.d.ts` — ITreeProvider interface already has all needed methods (tags, hostnames, pinning)
- `src/renderer/editors/link-editor/linkTypes.ts` — LinkItem type unchanged
- `src/renderer/content/tree-providers/` — existing providers unchanged
- `src/renderer/editors/link-editor/LinkEditor.tsx` — no UI changes in this task (Phase 1.2+ will use the provider)
- `src/renderer/editors/category/CategoryEditor.tsx` — no changes needed
