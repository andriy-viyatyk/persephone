# EPIC-015: ITreeProvider — Browsable Source Abstraction

**Status:** Active
**Priority:** High
**Created:** 2026-03-28

## Goal

Introduce `ITreeProvider` interface that returns **LinkItem-compatible entries**, unifying file browsing and link collection into a single paradigm. Migrate NavigationPanel / FileExplorer to a generic `TreeProviderView` component. Enhance the Link editor to support tree providers as data sources — enabling local file paths, cURL links, and multi-file drop alongside traditional bookmarks.

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

    /** List children at a path. Returns LinkItem-compatible entries. */
    list(path: string): Promise<ITreeProviderItem[]>;

    /** Get metadata for a specific path */
    stat(path: string): Promise<ITreeStat>;

    /** Resolve a child entry to a raw link string for the open pipeline */
    resolveLink(path: string): string;

    /** Whether this tree supports write operations */
    readonly writable: boolean;

    /** Optional directory operations */
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

    /** Optional pinning support */
    readonly pinnable: boolean;
    pin?(href: string): void;
    unpin?(href: string): void;
    getPinnedItems?(): ITreeProviderItem[];

    dispose?(): void;
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
- **Item CRUD is an optional provider capability.** `addItem()`/`updateItem()`/`deleteItem()` are optional methods. Each provider implements what makes sense:

  | Provider | `addItem` | `updateItem` | `deleteItem` |
  |---|---|---|---|
  | `LinkTreeProvider` | Add entry to `.link.json` | Update title/category/tags | Remove entry |
  | `FileTreeProvider` | Create empty file (or copy from href) | Rename file | Delete file |
  | `ZipTreeProvider` | Not supported | Rename entry | Delete entry |

  `CategoryView` checks `provider.writable` and shows/hides add/edit/delete UI accordingly. The "Add Link" dialog in CategoryView calls `provider.addItem()` — for LinkTreeProvider this adds a bookmark, for FileTreeProvider this could create a new file.
- **Bulk operations let providers optimize.** `moveToCategory()` and `deleteItems()` handle batches in one call. TreeProviderView/CategoryView calls bulk methods for drag-drop and multi-select actions instead of looping `updateItem()` N times. Each provider implements optimally:

  | Operation | `LinkTreeProvider` | `FileTreeProvider` |
  |---|---|---|
  | `moveToCategory(hrefs, target)` | Reassign category prefix on all matching items in memory, single `.link.json` write | Single `fs.rename` on the source folder (moves entire directory tree at OS level) |
  | `deleteItems(hrefs)` | Remove all matching items in memory, single `.link.json` write | Individual `fs.unlink`/`fs.rmdir` calls (no OS-level bulk delete) |

  If a bulk method is not implemented, the view falls back to calling single-item methods in a loop.
- **Pinning is an optional provider capability.** `pinnable` flag + `pin()`/`unpin()`/`getPinnedItems()` methods. `LinkTreeProvider` implements them (persists to `.link.json` state). `FileTreeProvider`/`ZipTreeProvider` don't — `pinnable = false`. `CategoryView` checks `provider.pinnable` and shows/hides the pinned panel accordingly.

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

Refactor `FileExplorer` into a generic `TreeProviderView` that renders any `ITreeProvider`:

- Uses `CategoryTree` for folder/category navigation (already hierarchical via "/" paths)
- Shows items in the selected category as a list or tiles (reuses Link editor display components)
- Supports tag filtering (e.g., filter by file extension)
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
2. **Inside Link editor** — as category navigation sidebar (links hidden by default, items shown in link list/tiles area)
3. **Standalone** — for any tree browsing need

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
        // Filter links by category prefix, map LinkItem → ITreeProviderItem
        return this.data.links
            .filter(link => link.category === path || link.category.startsWith(path + "/"))
            .map(link => toTreeItem(link));
    }

    resolveLink(path: string): string {
        // Find the link by category+name, return its href
        return href;
    }
}
```

This means the Link editor's data can also be exposed as an ITreeProvider, making it composable with other tree views.

### CategoryView Component

`CategoryView` is the **content area** that displays items from the selected category. It is extracted from the current Link editor's main panel. It receives an `ITreeProvider` reference to work with provider methods directly:

- Displays `ITreeProviderItem[]` for the currently selected category (obtained via `provider.list()`)
- Multiple view modes: list, tiles-landscape, tiles-landscape-big, tiles-portrait, tiles-portrait-big (same as current Link editor)
- Tag filtering (e.g., filter by file extension)
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

The current Link editor sidebar has three switchable panels: Categories, Tags, Hostnames. TreeProviderView adopts this:

| Panel | Source | Shows |
|---|---|---|
| **Categories** (always present) | Directories from `ITreeProvider` | Folder tree built from category paths |
| **Tags** (always present) | Aggregated from `ITreeProviderItem.tags` | Flat list (e.g., file extensions: ts, json, md) |
| **Hostnames** (optional, for link collections) | Extracted from `href` when href is HTTP | Flat list of domains |

The Hostnames panel only makes sense for link collections (HTTP URLs), so it's an optional sub-panel enabled by `TreeProviderView` prop or auto-detected from provider type.

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

3. **Link list shows current directory only.** When used inside the Link editor, only items from the selected category (= expanded directory) are displayed. Not the entire tree flattened.

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

## Phased Implementation Plan

### Phase 1: Core Interface & Components

| Task | Description |
|---|---|
| Define ITreeProvider & ITreeProviderItem types | `io.tree.d.ts` — LinkItem-compatible, async-first |
| Implement FileTreeProvider | Wraps `app.fs` calls, returns ITreeProviderItems |
| Implement ZipTreeProvider | Wraps archive reading, returns ITreeProviderItems |
| Create TreeProviderView component | Refactor FileExplorer into generic tree viewer with show/hide links toggle, sub-panels (categories, tags, optional hostnames) |
| Create CategoryView component | Extract from Link editor — displays items for selected category with list/tiles view modes, tag filter, quick search (name filtering) |

### Phase 2: Page Integration & Search

| Task | Description |
|---|---|
| Migrate NavigationPanel | Use TreeProviderView + FileTreeProvider/ZipTreeProvider |
| Folder selection → CategoryView | When a folder is selected in NavigationPanel, show CategoryView in content area |
| Implement LinkTreeProvider | Wraps .link.json data as ITreeProvider |
| `.link.json` as regular page | Open .link.json with NavigationPanel + LinkTreeProvider + CategoryView |
| Content search in CategoryView | Implement `ITreeProvider.search()`, progressive results, scoping by category + tags |
| Decommission standalone Link editor | Replace with page + NavigationPanel + LinkTreeProvider (verify feature parity first) |
| Decommission NavigationPanel search | Remove old search — CategoryView search covers both title filter and content search |

### Phase 3: Browser & Advanced Features

| Task | Description |
|---|---|
| Browser editor integration | Replace embedded LinkEditor with TreeProviderView + CategoryView |
| Support non-HTTP links | Local paths, cURL in "Add Link" dialog, type-based icons |
| Multi-file drop → .link.json | Create temp link file, open as regular page |
| `navigatePageTo` via openLink | Route through `app.events.openLink()` with `pageId` metadata |
| `TextFileIOModel.renameFile` via ITreeProvider | Delegate rename to tree provider |
| Expose tree providers in script `io` namespace | `io.FileTreeProvider`, `io.ZipTreeProvider` |
| Derive ITreeProvider from pipe provider | Auto-create tree provider from content pipe when appropriate |

## Open Questions / Concerns

1. **Large directory performance:** A directory with 10,000 files would create 10,000 items in CategoryView for a single folder. Virtualized rendering (`RenderGridModel`) should handle this, but needs testing.

2. **ID generation for tree items:** `LinkItem.id` must be unique. Using `href` as ID works for files (paths are unique) but might collide if the same file appears in multiple link collections. Consider using `category + "/" + name` or a hash.

3. **Link editor feature parity:** Before decommissioning the standalone Link editor, verify all features are preserved: pinned links (now via `ITreeProvider.pinnable`), per-category view modes, drag-drop category reassignment, edit/delete link dialogs, browser selection dropdown. These must work in the new page + NavigationPanel + CategoryView setup.

4. **Content area switching:** When the user clicks a folder → CategoryView, then clicks a file → editor, then clicks back to a folder → CategoryView again. The content area needs smooth transitions without losing scroll position, view mode, or filter state in CategoryView. May need a lightweight state cache per category.

5. **Browser editor bookmarks:** The Browser editor currently uses `LinkEditor` with custom hooks (`onInternalLinkOpen`, `onGetLinkMenuItems`). The new TreeProviderView + CategoryView must support these same extension points.

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
