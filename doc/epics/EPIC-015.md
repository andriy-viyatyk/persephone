# EPIC-015: ITreeProvider — Browsable Source Abstraction

**Status:** Active
**Priority:** High
**Created:** 2026-03-28

## Goal

Introduce `ITreeProvider` interface that returns **LinkItem-compatible entries**, unifying file browsing and link collection into a single paradigm. Build a new `TreeProviderView` component and `CategoryView` component that replace NavigationPanel's FileExplorer and the standalone Link editor. Enable local file paths, cURL links, and multi-file drop alongside traditional bookmarks.

## Motivation

EPIC-012 introduced `IProvider` (reads/writes one resource) and `IContentPipe` (provider + transformers). But browsing — listing children, navigating directories, renaming/moving files within a source — is still handled by scattered `app.fs` calls with hardcoded archive path detection.

### The "Everything is a Link" Insight

The Link editor's `LinkItem` has: `{ id, title, href, category, tags }`. Its `category` field uses "/" paths (`"src/components/ui"`) and `CategoryTree` already renders these as a hierarchical tree. This maps perfectly to file system structure:

| Link editor concept | File system equivalent |
|---|---|
| `category` (`"src/utils"`) | folder path |
| `title` (`"parser.ts"`) | file name |
| `href` (`"C:/project/src/utils/parser.ts"`) | full file path (resolved link) |
| `tags` (`["ts"]`) | file extension, type metadata |
| Category tree sidebar | folder tree |
| Link list/tiles view | file list in current folder |
| Tag filter | filter by extension |
| `isCategory` (new field) | `isDirectory` — entry is a folder/container |

This means `ITreeProvider` items should be **LinkItem-compatible**. Any tree provider (file system, ZIP, FTP) produces items that the Link editor can display natively. And the Link editor becomes a universal collection browser that can be backed by static `.link.json` data, a file tree, or an archive.

## High-Level Design

### ITreeProvider Interface

```typescript
interface ITreeProvider {
    readonly type: string;           // "file", "zip", "ftp", "link", ...
    readonly displayName: string;    // UI display name
    readonly sourceUrl: string;      // Root URL/path
    readonly rootPath: string;       // Path to pass to list() for root listing

    /** List children at a path. Returns LinkItem-compatible entries. */
    list(path: string): Promise<ITreeProviderItem[]>;

    /** Get metadata for a specific path */
    stat(path: string): Promise<ITreeStat>;

    /** Resolve a child entry to a raw link string for the open pipeline */
    resolveLink(path: string): string;

    /** Whether this tree supports write operations */
    readonly writable: boolean;

    /** Optional directory/path operations (rename works for both files and directories) */
    mkdir?(path: string): Promise<void>;
    rename?(oldPath: string, newPath: string): Promise<void>;

    /** Optional item CRUD operations */
    addItem?(item: Partial<ITreeProviderItem> & { href: string }): Promise<ITreeProviderItem>;
    updateItem?(href: string, changes: Partial<ITreeProviderItem>): Promise<ITreeProviderItem>;
    deleteItem?(href: string): Promise<void>;

    /** Optional bulk operations — providers implement with their own optimization */
    moveToCategory?(hrefs: string[], targetCategory: string): Promise<void>;
    deleteItems?(hrefs: string[]): Promise<void>;

    /** Optional content search — async, yields results progressively */
    search?(query: string, options: ITreeSearchOptions): ITreeSearchHandle;

    /** Optional tag-based navigation (provider-driven) */
    readonly hasTags: boolean;
    getTags?(): ITreeTagInfo[];
    getTagItems?(tag: string): ITreeProviderItem[];

    /** Optional hostname-based navigation (provider-driven) */
    readonly hasHostnames: boolean;
    getHostnames?(): ITreeTagInfo[];
    getHostnameItems?(hostname: string): ITreeProviderItem[];

    /** Optional pinning support */
    readonly pinnable: boolean;
    pin?(href: string): void;
    unpin?(href: string): void;
    getPinnedItems?(): ITreeProviderItem[];

    dispose?(): void;
}

/** Tag or hostname info with item count. */
interface ITreeTagInfo {
    name: string;
    count: number;
}

/** LinkItem-compatible tree entry */
interface ITreeProviderItem {
    /** Display name (= LinkItem.title) */
    name: string;
    /** Resolved link string (= LinkItem.href) */
    href: string;
    /** Folder path using "/" separators (= LinkItem.category) */
    category: string;
    /** Metadata tags — extension, type, etc. (= LinkItem.tags) */
    tags: string[];
    /** Whether this entry is a directory/container (= LinkItem.isCategory) */
    isDirectory: boolean;
    /** File size in bytes (optional) */
    size?: number;
    /** Last modified ISO string (optional) */
    mtime?: string;
}

interface ITreeStat {
    exists: boolean;
    isDirectory: boolean;
    size?: number;
    mtime?: string;
}
```

**Key design decisions:**
- **Async-first interface.** `ITreeProvider` is designed for the hardest case (FileTreeProvider doing real disk I/O). ALL content-returning methods are `async`. Simpler providers (ZipTreeProvider with pre-loaded index, LinkTreeProvider with in-memory data) implement the same async signatures but return immediately via `Promise.resolve()`. This keeps the interface uniform — consumers never need to check whether a provider is sync or async.
- `ITreeProviderItem` has the same shape as `LinkItem` (`name`→`title`, `href`, `category`, `tags`) plus tree-specific fields (`isDirectory`, `size`, `mtime`).
- `resolveLink(path)` returns a raw link string, not an `IContentPipe`. The tree doesn't know about transformers — it just builds URLs that flow through the existing open pipeline.
- `list(path)` loads ONE directory at a time (lazy). Items include `category = path` so they slot into the category tree.
- `rootPath` is the path to pass to `list()` for root-level listing. `FileTreeProvider` returns `sourceUrl` (absolute OS path). `ZipTreeProvider` returns `""` (empty string for archive root). This lets the view call `provider.list(provider.rootPath)` without knowing the provider type.
- **Item CRUD is an optional provider capability.** `addItem()`/`updateItem()`/`deleteItem()` are optional methods. Each provider implements what makes sense:

  | Provider | `addItem` | `updateItem` | `deleteItem` |
  |---|---|---|---|
  | `LinkTreeProvider` | Add entry to `.link.json` | Update title/category/tags | Remove entry |
  | `FileTreeProvider` | Create empty file (or copy from href) | Update metadata (use `rename()` for path changes) | Delete file |
  | `ZipTreeProvider` | Not supported | Update metadata (use `rename()` for path changes) | Delete entry |

  `CategoryView` checks `provider.writable` and shows/hides add/edit/delete UI accordingly. The "Add Link" dialog in CategoryView calls `provider.addItem()` — for LinkTreeProvider this adds a bookmark, for FileTreeProvider this could create a new file.
- **Bulk operations let providers optimize.** `moveToCategory()` and `deleteItems()` handle batches in one call. TreeProviderView/CategoryView calls bulk methods for drag-drop and multi-select actions instead of looping `updateItem()` N times. Each provider implements optimally:

  | Operation | `LinkTreeProvider` | `FileTreeProvider` |
  |---|---|---|
  | `moveToCategory(hrefs, target)` | Reassign category prefix on all matching items in memory, single `.link.json` write | Single `fs.rename` on the source folder (moves entire directory tree at OS level) |
  | `deleteItems(hrefs)` | Remove all matching items in memory, single `.link.json` write | Individual `fs.unlink`/`fs.rmdir` calls (no OS-level bulk delete) |

  If a bulk method is not implemented, the view falls back to calling single-item methods in a loop.
- **Pinning is an optional provider capability.** `pinnable` flag + `pin()`/`unpin()`/`getPinnedItems()` methods. `LinkTreeProvider` implements them (persists to `.link.json` state). `FileTreeProvider`/`ZipTreeProvider` don't — `pinnable = false`. `CategoryView` checks `provider.pinnable` and shows/hides the pinned panel accordingly.
- **Tags and hostnames are provider-driven, not view-aggregated.** `hasTags` flag + `getTags()`/`getTagItems()` methods. `hasHostnames` flag + `getHostnames()`/`getHostnameItems()` methods. Only providers with all items in memory implement these (e.g., `LinkTreeProvider`). `FileTreeProvider`/`ZipTreeProvider` set `hasTags = false`, `hasHostnames = false` — scanning an entire disk for file extensions is impractical. TreeProviderView shows Tags/Hostnames panels only when the provider supports them.

  | Provider | `hasTags` | `hasHostnames` | Reason |
  |---|---|---|---|
  | `FileTreeProvider` | false | false | Can't scan entire disk for extensions |
  | `ZipTreeProvider` | false | false | Could enumerate but not critical |
  | `LinkTreeProvider` | true | true | All items in memory, tags are a core Link editor feature |

### Mapping: ITreeProviderItem ↔ LinkItem

Converting between the two is trivial:

```typescript
// ITreeProviderItem → LinkItem (for Link editor display)
function toLink(item: ITreeProviderItem): LinkItem {
    return {
        id: item.href,           // href is unique
        title: item.name,
        href: item.href,
        category: item.category,
        tags: item.tags,
        isCategory: item.isDirectory,
    };
}

// LinkItem → ITreeProviderItem (for tree operations)
function toTreeItem(link: LinkItem): ITreeProviderItem {
    return {
        name: link.title,
        href: link.href,
        category: link.category,
        tags: link.tags,
        isDirectory: link.isCategory ?? false,
    };
}
```

### TreeProviderView Component

A new component (built from scratch, not refactoring FileExplorer) that renders any `ITreeProvider`:

- Uses `CategoryTree` for folder/category navigation (already hierarchical via "/" paths)
- Shows items in the selected category as a list or tiles (reuses Link editor display components)
- Supports tag filtering when provider has tags (`provider.hasTags`)
- Lazy loads children on directory expand
- Drag-and-drop support (where the tree provider is writable)

#### Show/Hide Links Toggle

TreeProviderView supports a **show links** toggle that controls whether leaf items (files/links) appear in the tree alongside directories:

| Mode | Tree shows | Behavior | Equivalent to |
|---|---|---|---|
| **Links visible** (default for NavigationPanel) | Directories + files | Full file explorer — expand folders, see files inline | Current FileExplorer |
| **Links hidden** (default for Link editor sidebar) | Directories only | Category-only navigation — select a folder, items appear in the main content area | Current Link editor category tree |

This is a **view-level concern**, not a provider concern — `ITreeProvider.list()` always returns both directories and leaf items. `TreeProviderView` filters the tree display based on the toggle. When links are hidden, selecting a directory still triggers loading its children (for the content area), but only subdirectories appear in the tree.

The toggle can be:
- A prop on `TreeProviderView` (controlled by parent component)
- A UI button in the tree toolbar (user-toggleable)
- Both — prop sets the default, user can override

This component can be used:
1. **Inside NavigationPanel** — replacing current FileExplorer, backed by FileTreeProvider / ZipTreeProvider (links visible by default)
2. **Inside page with CategoryView** — as category navigation sidebar for `.link.json` pages (links hidden by default, items shown in CategoryView)
3. **Inside Browser editor** — replacing embedded LinkEditor for bookmarks
4. **Standalone** — for any tree browsing need

### Provider Implementations

#### FileTreeProvider

```typescript
class FileTreeProvider implements ITreeProvider {
    type = "file";
    constructor(public readonly sourceUrl: string) {}   // root directory

    async list(path: string): Promise<ITreeProviderItem[]> {
        const entries = await app.fs.readdir(path);
        return entries.map(entry => ({
            name: entry.name,
            href: this.resolveLink(join(path, entry.name)),
            category: path,              // folder path = category
            tags: entry.isDirectory ? [] : [extension(entry.name)],
            isDirectory: entry.isDirectory,
            size: entry.size,
            mtime: entry.mtime,
        }));
    }

    resolveLink(path: string): string {
        return path;    // local file path is already a valid raw link
    }
}
```

#### ZipTreeProvider

```typescript
class ZipTreeProvider implements ITreeProvider {
    type = "zip";
    constructor(public readonly sourceUrl: string) {}   // path to .zip file

    async list(path: string): Promise<ITreeProviderItem[]> {
        // Read ZIP directory listing for the given internal path
        // ...
    }

    resolveLink(path: string): string {
        return `${this.sourceUrl}!${path}`;   // "C:/docs.zip!data/report.csv"
    }
}
```

#### LinkTreeProvider (new — wraps .link.json data)

```typescript
class LinkTreeProvider implements ITreeProvider {
    type = "link";

    constructor(private data: LinkEditorData) {}

    async list(path: string): Promise<ITreeProviderItem[]> {
        // Return only DIRECT children of the given path:
        // 1. Links whose category === path (leaf items in this folder)
        // 2. Immediate subcategory names (as isDirectory items)
        const directLinks = this.data.links
            .filter(link => link.category === path)
            .map(link => toTreeItem(link));
        const subCategories = this.getDirectSubcategories(path)
            .map(name => ({
                name,
                href: "",
                category: path,
                tags: [],
                isDirectory: true,
            }));
        return [...subCategories, ...directLinks];
    }

    resolveLink(path: string): string {
        // Find the link by category+name, return its href
        return href;
    }
}
```

This means the Link editor's data can also be exposed as an ITreeProvider, making it composable with other tree views.

### CategoryView Component

`CategoryView` is the **content area** that displays items from the selected category. It is a new component (inspired by the current Link editor's main panel, but built from scratch). It receives an `ITreeProvider` reference to work with provider methods directly:

- Displays `ITreeProviderItem[]` for the currently selected category (obtained via `provider.list()`)
- Multiple view modes: list, tiles-landscape, tiles-landscape-big, tiles-portrait, tiles-portrait-big (same as current Link editor)
- Tag filtering when provider supports it (`provider.hasTags`)
- **Search** (see [Search in CategoryView](#search-in-categoryview) section below)
- Drag-and-drop (where `provider.writable` is true)
- **Pinned items panel** — shown when `provider.pinnable` is true. Calls `provider.getPinnedItems()` to display, `provider.pin()`/`provider.unpin()` on user action. Can be a standalone sub-panel within CategoryView or a separate reusable `PinnedPanel` component.

**Folders in CategoryView:** When `list()` returns items with `isDirectory: true` (mapped to `isCategory` on LinkItem), CategoryView displays them as folder tiles/rows alongside regular links — like Windows Explorer showing files and subfolders in the main area. Clicking a folder item navigates into that category (updates the selected category in TreeProviderView and refreshes CategoryView with the subfolder's contents).

`CategoryView` needs the `ITreeProvider` (not just raw items) because:
- Pinning requires `provider.pin()`/`provider.unpin()`
- Opening items uses `provider.resolveLink()` → `openRawLink` pipeline
- Future write operations (delete, rename) delegate to the provider

### The Unification: Page = Link Browser

The current architecture has two separate code paths for browsing:
- **Regular page:** NavigationPanel (FileExplorer tree) + Monaco editor (file content)
- **Link editor:** Category tree sidebar + link list/tiles content area

With `TreeProviderView` + `CategoryView` as reusable components, these converge:

```
┌─────────────────────────────────────────────────────────┐
│  Any Page                                                │
│  ┌──────────────┐  ┌─────────────────────────────────┐  │
│  │TreeProviderView│  │ Content Area                    │  │
│  │               │  │                                 │  │
│  │ Categories/   │  │ File selected → Monaco editor   │  │
│  │ Tags /        │  │ Folder selected → CategoryView  │  │
│  │ Hosts (opt.)  │  │   (shows folder items as links) │  │
│  │               │  │                                 │  │
│  └──────────────┘  └─────────────────────────────────┘  │
│  [links visible]    [content changes based on selection] │
└─────────────────────────────────────────────────────────┘
```

**When a file is selected** in TreeProviderView → content area shows the file (Monaco, grid, PDF, etc.) — same as today.

**When a folder is selected** in TreeProviderView → content area shows `CategoryView` with the folder's items displayed as links (list/tiles with tag filter, view mode toggle).

This means:
1. **`.link.json` files** open as a regular page. NavigationPanel uses `LinkTreeProvider` → category selection shows items in `CategoryView`. The TreeProviderView shows links hidden (categories only), the content area shows `CategoryView`.
2. **Regular files** work as before — NavigationPanel with `FileTreeProvider`, content area shows the editor. But now selecting a *folder* in the tree shows its contents as a `CategoryView` in the content area.
3. **The standalone Link editor becomes redundant** — it's just "page + NavigationPanel + LinkTreeProvider + CategoryView". We can decommission it.
4. **Browser editor** replaces its embedded `LinkEditor` with the same `TreeProviderView` + `CategoryView` for bookmarks.

### Sub-panels in TreeProviderView

The current Link editor sidebar has three switchable panels: Categories, Tags, Hostnames. TreeProviderView adopts this, but with a key design change: **tags and hostnames are provider-driven, not view-aggregated.**

Scanning an entire disk for file extensions is impractical. Only providers with all items in memory (like `LinkTreeProvider`) can enumerate tags reliably. This is controlled by `ITreeProvider.hasTags` and `ITreeProvider.hasHostnames` flags.

| Panel | Source | Shows | When visible |
|---|---|---|---|
| **Categories** (always present) | Directories from `ITreeProvider` | Folder tree built from category paths | Always |
| **Tags** (optional) | `provider.getTags()` → `ITreeTagInfo[]` | Flat list with counts | When `provider.hasTags` is true |
| **Hostnames** (optional) | `provider.getHostnames()` → `ITreeTagInfo[]` | Flat list of domains with counts | When `provider.hasHostnames` is true |

Provider methods for tag/hostname navigation:
- `getTags()` — returns all tags with item counts
- `getTagItems(tag)` — returns items matching a specific tag
- `getHostnames()` — returns all hostnames with item counts
- `getHostnameItems(hostname)` — returns items matching a specific hostname

`FileTreeProvider` and `ZipTreeProvider` set `hasTags = false` and `hasHostnames = false` — no tags/hostnames panels for file browsing. `LinkTreeProvider` (future, Phase 4) will implement all tag/hostname methods since it has all items in memory.

### Search in CategoryView

CategoryView integrates search functionality that replaces both the current NavigationPanel file search and the Link editor's title filter. The search input sits at the top of CategoryView with two modes:

| Mode | Searches | Scope | Speed | Use case |
|---|---|---|---|---|
| **Quick search** (default) | Item names/titles only | Current category + subcategories | Instant — filters in-memory items | Find a file by name, filter bookmarks |
| **Content search** (toggle) | File contents (grep-like) | Current category + subcategories | Async, progressive results | Find code, text within files |

**How it works:**

1. **Quick search** filters the already-loaded `ITreeProviderItem[]` by `name` match. For `LinkTreeProvider` this is instant (in-memory array). For `FileTreeProvider` this filters the current directory's items — but can also recursively search file names through `list()` calls on subdirectories.

2. **Content search** (toggled via button) is an async operation provided by `ITreeProvider`:

```typescript
interface ITreeProvider {
    // ... existing methods ...

    /** Optional content search — async, yields results progressively */
    search?(query: string, options: ITreeSearchOptions): ITreeSearchHandle;
}

interface ITreeSearchOptions {
    /** Category to search within (empty = root) */
    category: string;
    /** Filter by tags (e.g., only search in ["ts", "tsx"] files) */
    tags?: string[];
    /** Max results (default: 200) */
    limit?: number;
}

interface ITreeSearchHandle {
    /** Subscribe to progressive results — called with each new batch of matches */
    onResults(callback: (items: ITreeSearchResult[]) => void): void;
    /** Subscribe to progress updates */
    onProgress?(callback: (filesSearched: number) => void): void;
    /** Cancel the search */
    cancel(): void;
    /** Resolves when search is complete */
    done: Promise<void>;
}

interface ITreeSearchResult extends ITreeProviderItem {
    /** Matched line numbers within the file (for content search) */
    matchLines?: number[];
    /** Preview snippet of the matched content */
    matchPreview?: string;
}
```

**Provider implementations:**

| Provider | `search()` | Behavior |
|---|---|---|
| `FileTreeProvider` | Walks directories, reads file contents, matches text | Progressive — yields batches as files are scanned. Shows "Searching... N files scanned" progress. Respects tag filter (e.g., only search `.ts` files). |
| `LinkTreeProvider` | Filters in-memory items by title/href/tags | Instant — returns all matches in one batch |
| `ZipTreeProvider` | Reads ZIP entries, matches content | Progressive — similar to FileTreeProvider but reads from archive |

**Scoping by category + tags:** The user selects a folder in TreeProviderView (sets the category), optionally selects a tag (e.g., "ts"), then types a search query. CategoryView calls `provider.search(query, { category: selectedCategory, tags: ["ts"] })`. This searches only `.ts` files within the selected folder — replacing the current NavigationPanel's include/exclude filter patterns with a more intuitive tag-based UI.

**Progressive results in CategoryView:** As `onResults` callbacks fire, CategoryView appends new items to the displayed list. The user sees matches appearing in real-time. The `onProgress` callback updates a "Searching... N files scanned" status bar — same UX as the current NavigationPanel search.

After full migration, the old search built into NavigationPanel can be decommissioned — CategoryView's search covers both title filtering (Link editor) and content search (NavigationPanel).

### Non-HTTP Links in Link Collections

With the "everything is a link" design, `.link.json` files can store any raw link:
- **HTTP URLs:** `href = "https://example.com"` — current behavior
- **Local file paths:** `href = "C:/projects/report.xlsx"` — opens via file parser (Layer 1)
- **cURL commands:** `href = "curl -H 'Auth: ...' https://api.example.com"` — opens via cURL parser (Layer 1)

No new infrastructure needed — these already flow through `openRawLink` → parsers → resolvers → open handler.

Minor UI adjustments needed:
- "Add Link" dialog: accept any raw link string (not just URLs)
- Display: icon indicating link type (file, HTTP, cURL)
- Favicon: skip fetch for non-HTTP links

### Multi-File Drop Enhancement

Currently, dropping files onto the app opens only the first file. With this design:

1. User drops 5 files onto the app
2. App creates a temporary `.link.json` in the cache folder
3. Populates it with `LinkItem` entries for each dropped file:
   ```json
   {
     "links": [
       { "id": "...", "title": "report.xlsx", "href": "C:/docs/report.xlsx", "category": "dropped", "tags": ["xlsx"] },
       { "id": "...", "title": "data.csv", "href": "C:/docs/data.csv", "category": "dropped", "tags": ["csv"] }
     ],
     "state": {}
   }
   ```
4. Opens the `.link.json` as a regular page (backed by `LinkTreeProvider`)
5. NavigationPanel shows categories, content area shows `CategoryView` with dropped files
6. User can click any item to open it, or save the collection permanently

## Lazy Loading — Core Design Principle

The interface is **async-first and lazy by design**. This is driven by `FileTreeProvider` (real disk I/O), but all providers share the same pattern:

### How it works

1. **`list(path)` loads one directory at a time.** The consumer (TreeProviderView) calls `list()` only when a directory node is expanded. It never pre-loads the full tree.

2. **Category tree grows progressively.** As the user expands directories, new category strings are added to the categories array. `CategoryTree` rebuilds from the full array on each render — it handles dynamic additions naturally.

3. **Link list shows current directory only.** CategoryView displays only items from the selected category (= expanded directory). Not the entire tree flattened.

### Provider behavior spectrum

| Provider | `list()` behavior | Why async? |
|---|---|---|
| `FileTreeProvider` | Real `fs.readdir()` call, may take 10-100ms | Disk I/O |
| `ZipTreeProvider` | Filters pre-loaded ZIP index, returns immediately | Index loaded once on init (async), then sync filtering |
| `LinkTreeProvider` | Filters in-memory array, returns immediately | All data already in memory |

All three return `Promise<ITreeProviderItem[]>`. The consumer doesn't know or care whether the result took 100ms or 0ms — it always `await`s.

### Loading states in TreeProviderView

When `list()` is pending (real async), the tree node shows a loading indicator. When it resolves instantly (ZipTreeProvider, LinkTreeProvider), the indicator never appears — the UI updates synchronously within the same render cycle.

The existing `TreeView` component already supports this via `getHasChildren` prop (shows expand arrow before children are loaded) and `onExpandChange` callback (triggers `list()` on expand).

## File Locations

New modules follow the same patterns as EPIC-012's providers/transformers:

| Module | Location | Pattern follows |
|---|---|---|
| **Type definitions** | `src/renderer/api/types/io.tree.d.ts` | Same as `io.provider.d.ts`, `io.pipe.d.ts` |
| **FileTreeProvider** | `src/renderer/content/tree-providers/FileTreeProvider.ts` | Same as `content/providers/FileProvider.ts` |
| **ZipTreeProvider** | `src/renderer/content/tree-providers/ZipTreeProvider.ts` | Same as `content/providers/HttpProvider.ts` |
| **LinkTreeProvider** | `src/renderer/content/tree-providers/LinkTreeProvider.ts` | Same as `content/providers/CacheFileProvider.ts` |
| **TreeProviderView** | `src/renderer/components/tree-provider/TreeProviderView.tsx` | Same as `components/file-explorer/FileExplorer.tsx` |
| **TreeProviderViewModel** | `src/renderer/components/tree-provider/TreeProviderViewModel.ts` | Same as `components/file-explorer/FileExplorerModel.tsx` |
| **CategoryView** | `src/renderer/components/tree-provider/CategoryView.tsx` | New |
| **CategoryViewModel** | `src/renderer/components/tree-provider/CategoryViewModel.ts` | New |

```
src/renderer/
  api/types/
    io.tree.d.ts              ← type definitions (auto-synced to assets/editor-types/)
  content/
    providers/                 ← existing (FileProvider, HttpProvider, CacheFileProvider)
    transformers/              ← existing (ZipTransformer, DecryptTransformer)
    tree-providers/            ← NEW (FileTreeProvider, ZipTreeProvider, LinkTreeProvider)
  components/
    TreeView/                  ← existing (base tree rendering — reused by TreeProviderView)
    file-explorer/             ← existing (will be replaced by TreeProviderView, then deleted)
    tree-provider/             ← NEW (TreeProviderView, CategoryView)
```

## Phased Implementation Plan

Tasks within each phase are listed in implementation order (each task may depend on the previous ones).

### Phase 1: Types & Providers

| # | Task | Description | Depends on |
|---|---|---|---|
| 1.1 | Define ITreeProvider & ITreeProviderItem types | `api/types/io.tree.d.ts` — all interfaces. Add `isCategory?: boolean` to `LinkItem` in `editors/link-editor/linkTypes.ts`. | — |
| 1.2 | Implement FileTreeProvider | `content/tree-providers/FileTreeProvider.ts` — wraps `app.fs` calls, returns ITreeProviderItems. | 1.1 |
| 1.3 | Implement ZipTreeProvider | `content/tree-providers/ZipTreeProvider.ts` — wraps archive reading. Read-only initially. | 1.1 |

### Phase 2: UI Components

| # | Task | Description | Depends on |
|---|---|---|---|
| 2.1 | Create TreeProviderView component | `components/tree-provider/TreeProviderView.tsx` + `TreeProviderViewModel.ts` — generic tree viewer with show/hide links toggle. Lazy loading, expand/collapse, loading indicators. | 1.1, 1.2 (for testing) |
| 2.2 | Create CategoryView component | `components/tree-provider/CategoryView.tsx` + `CategoryViewModel.ts` — displays items for selected category with list/tiles view modes, quick search. Shows folders as tiles/rows. | 1.1 |

### Phase 3: NavigationPanel Integration

| # | Task | Description | Depends on |
|---|---|---|---|
| 3.1 | Replace FileExplorer with TreeProviderView in NavigationPanel | Swap FileExplorer for TreeProviderView + FileTreeProvider. Links visible by default. Test file browsing, expand/collapse, file opening. | 2.1 |
| 3.2 | ZipTreeProvider in NavigationPanel | When opening archive files, NavigationPanel switches to ZipTreeProvider. | 3.1, 1.3 |
| 3.3 | Folder selection → CategoryView | When a folder is selected in NavigationPanel, show CategoryView in content area instead of empty state. | 3.1, 2.2 |
| 3.4 | `navigatePageTo` via openLink | Route file navigation through `app.events.openLink()` with `pageId` in metadata. Replace direct file opening. | 3.1 |

### Phase 4: Link Editor Replacement

| # | Task | Description | Depends on |
|---|---|---|---|
| 4.1 | Implement LinkTreeProvider | `content/tree-providers/LinkTreeProvider.ts` — wraps `.link.json` data as ITreeProvider. Implements `list()` (direct children only), `addItem()`, `updateItem()`, `deleteItem()`, `moveToCategory()`, `pin()`/`unpin()`, `getTags()`/`getTagItems()`, `getHostnames()`/`getHostnameItems()`. | 1.1 |
| 4.2 | Add sub-panels to TreeProviderView | Tags panel (when `provider.hasTags`), Hostnames panel (when `provider.hasHostnames`). Uses `CollapsiblePanelStack` + `TagsList`. Provider-driven — only LinkTreeProvider has data for these panels. | 2.1, 4.1 |
| 4.3 | Add pinned items panel to CategoryView | Shown when `provider.pinnable` is true. Calls `getPinnedItems()`, `pin()`, `unpin()`. Only LinkTreeProvider implements pinning. | 2.2, 4.1 |
| 4.4 | Create TreeProviderItemTile component | `components/tree-provider/TreeProviderItemTile.tsx` — tile renderer for CategoryView. Shows `imgSrc` for links, image preview for image files (.jpg, .png, .webp), `TreeProviderItemIcon` fallback. Enables tiles view modes in CategoryView. | 2.2 |
| 4.5 | `.link.json` as regular page | Open `.link.json` files with NavigationPanel + LinkTreeProvider + CategoryView. TreeProviderView shows links hidden (categories only), content area shows CategoryView. | 4.1, 4.2, 4.3, 4.4, 3.1, 2.2 |
| 4.6 | Support non-HTTP links in link collections | Local file paths and cURL commands as link items. Update "Add Link" dialog, type-based icons, skip favicon for non-HTTP. | 4.5 |
| 4.7 | Verify Link editor feature parity | Test: pinned links, per-category view modes, drag-drop category reassignment, edit/delete dialogs, context menus. Fix gaps. | 4.5 |
| 4.8 | Decommission standalone Link editor | Remove Link editor registration, delete old components. | 4.7 |

### Phase 5: Search

| # | Task | Description | Depends on |
|---|---|---|---|
| 5.1 | Content search in CategoryView | Implement `ITreeProvider.search()` for FileTreeProvider — progressive results, scoping by category + tags, cancel support. | 2.2, 1.2 |
| 5.2 | Content search for LinkTreeProvider | Instant in-memory search by title/href/tags. | 5.1, 4.1 |
| 5.3 | Content search for ZipTreeProvider | Progressive search through archive entries. | 5.1, 1.3 |
| 5.4 | Decommission NavigationPanel search | Remove old search UI and SearchResultsPanel — CategoryView search covers both title filter and content search. | 5.1, 3.1 |

### Phase 6: Browser & Advanced Features

| # | Task | Description | Depends on |
|---|---|---|---|
| 6.1 | Browser editor integration | Replace embedded LinkEditor with TreeProviderView + CategoryView. Implement event channel pattern for link opening and context menus. | 2.1, 2.3, 4.1 |
| 6.2 | Multi-file drop → .link.json | Create temp `.link.json` in cache folder, open as regular page with LinkTreeProvider. | 4.2 |
| 6.3 | `TextFileIOModel.renameFile` via ITreeProvider | Delegate rename to tree provider instead of direct `app.fs` call. | 1.2, 3.1 |
| 6.4 | Expose tree providers in script `io` namespace | `io.FileTreeProvider`, `io.ZipTreeProvider`, `io.LinkTreeProvider`. Script type definitions in `io.tree.d.ts`. | 1.2, 1.3, 4.1 |
| 6.5 | Derive ITreeProvider from pipe provider | Auto-create tree provider from content pipe when appropriate (e.g., file pipe → FileTreeProvider for its directory). | 1.2, 1.3 |

### Phase 7: Cleanup

| # | Task | Description | Depends on |
|---|---|---|---|
| 7.1 | Remove old FileExplorer component | Delete FileExplorer and FileExplorerModel after all integration points verified. | 3.1, 3.2, 3.3 |
| 7.2 | Remove old NavigationPanel search | Delete SearchResultsPanel and search model after content search verified. | 5.4 |
| 7.3 | Final review | Architecture review, documentation update, user documentation. | All above |

## Resolved Concerns

1. **~~Large directory performance~~** — **Resolved.** `RenderGridModel` (virtualized rendering) only renders visible items. It already handles 10,000+ items in the current Link editor. Not a concern.

2. **~~ID generation for tree items~~** — **Resolved.** Use the full file path as ID (`href`). Paths are unique within a provider. Rename operations will delete the old item and create a new one (new path = new ID), which is the natural behavior.

3. **~~Link editor feature parity~~** — **Resolved.** Implementation strategy: **build new components alongside old ones, replace incrementally.** Keep the existing Link editor and FileExplorer unchanged. Build TreeProviderView and CategoryView as new components. Replace old components place by place with testing. Old components serve as reference during development. After full migration is verified, drop unused components.

4. **~~Content area switching~~** — **Resolved: out of scope.** Currently page navigation replaces the page model, causing full re-renders (NavigationPanel already loses scroll position). No point in implementing special state caching for CategoryView until the underlying page navigation design is improved. Future epic can address page navigation state preservation, then revisit CategoryView state restoration.

5. **~~Browser editor bookmarks~~** — **Resolved.** Implement an internal event channel pattern: Browser registers default event handlers on the channel. Anyone (TreeProviderView, CategoryView, scripts) can subscribe their own handler that catches events and sets `e.handled = true` to prevent the default. This is more flexible than direct callback hooks (`onInternalLinkOpen`, `onGetLinkMenuItems`) and also useful for scripting.

## Implementation Strategy

**Build new, replace incrementally, then clean up.**

This epic introduces significant new components (TreeProviderView, CategoryView) that overlap with existing ones (FileExplorer, Link editor, NavigationPanel search). The strategy is:

1. **Build new components from scratch** — do NOT refactor existing components in place. New TreeProviderView, new CategoryView, new providers.
2. **Keep old components untouched** — they serve as working reference and fallback during development.
3. **Replace incrementally** — swap in new components one integration point at a time (first NavigationPanel, then .link.json pages, then Browser editor). Test each replacement before moving to the next.
4. **Clean up** — after all integration points are migrated and verified, delete the old unused components (FileExplorer, standalone Link editor, NavigationPanel search).

## References

- **EPIC-012 design:** ITreeProvider section in [EPIC-012.md](EPIC-012.md) (lines 353-428)
- **Review findings:** Task 5 in [US-288 review report](../tasks/US-288-review-epic-012/review-report.md#task-5-itreeprovider-investigation--refactoring)
- **Link editor types:** `src/renderer/editors/link-editor/linkTypes.ts`
- **CategoryTree component:** `src/renderer/components/TreeView/CategoryTree.tsx`
- **TreeView model:** `src/renderer/components/TreeView/TreeView.model.ts`
- **FileExplorer:** `src/renderer/editors/text/file-explorer/FileExplorerModel.tsx`

---

## Optional: DOMTreeProvider (browser resource inspector)

**Status:** Optional — decide after main epic implementation. May be a separate standalone task.

A developer tool for the built-in browser. User clicks "Open Resource View" on a browser page → `DOMTreeProvider` scrapes the current page's DOM for all linked resources and presents them as browsable link items.

```typescript
class DOMTreeProvider implements ITreeProvider {
    type = "dom";
    // sourceUrl = the page URL being inspected

    async list(path: string): Promise<ITreeProviderItem[]> {
        // Query the webview DOM for resource URLs:
        //   <img src>, <link href>, <script src>, <video>/<audio> <source>,
        //   CSS url(), <a href> to downloadable files, etc.
        // Category = resource type: "images", "scripts", "styles", "media", "fonts", "other"
        // Tags = [extension, element type (img/link/script)]
    }

    resolveLink(path: string): string {
        return absoluteUrl;    // resolved against page base URL
    }
}
```

| Category | Sources | Example tags |
|---|---|---|
| `images` | `<img src>`, CSS `background-image`, `<picture>`, favicons | `png`, `svg`, `webp`, `img` |
| `scripts` | `<script src>` | `js`, `mjs`, `module`, `async` |
| `styles` | `<link rel="stylesheet">`, `@import` | `css` |
| `media` | `<video>`, `<audio>`, `<source>` | `mp4`, `webm`, `mp3` |
| `fonts` | `@font-face src` | `woff2`, `ttf`, `otf` |
| `documents` | `<iframe src>`, `<a href>` to files | `pdf`, `json`, `xml` |
| `links` | `<a href>` to external pages | `html`, `external` |

**External links as folders:** `<a href>` pointing to other pages (not downloadable files) are returned with `isDirectory: true`. In the tree, they appear as expandable folders. Expanding one triggers a fetch + DOM scrape of *that* page, lazily populating its resources as children. This enables recursive site exploration through the tree — a lightweight site crawler driven by user navigation.

Opens a new page with NavigationPanel backed by `DOMTreeProvider`. User browses resources by type (category tree), filters by extension (tags), clicks to open/inspect any resource. Useful for debugging, asset extraction, and understanding page dependencies.
