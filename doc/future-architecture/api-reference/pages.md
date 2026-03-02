# IPageCollection — `app.pages`

**Status:** Implemented (Phase 4)

Page (tab) management for the current window. Open, close, navigate, pin, group, and query pages.

Available in scripts as `app.pages`.

## Access

```javascript
app.pages
```

---

## Properties — Queries

### `activePage` (read-only)

Currently active (visible) page, or `undefined` if no pages are open.

```javascript
const page = app.pages.activePage;
if (page) {
  console.log(page.title, page.filePath);
}
```

**Type:** `IPageInfo | undefined`

---

### `groupedPage` (read-only)

The grouped (side-by-side) partner of the active page, or `undefined`.

```javascript
if (app.pages.groupedPage) {
  console.log("Side-by-side with:", app.pages.groupedPage.title);
}
```

**Type:** `IPageInfo | undefined`

---

## Methods — Queries

### `findPage(pageId)`

Find a page by its ID.

```javascript
const page = app.pages.findPage("some-uuid");
if (page) console.log(page.title);
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `pageId` | `string` | Page ID to find |

**Returns:** `IPageInfo | undefined`

---

### `getGroupedPage(withPageId)`

Get the grouped (side-by-side) partner of a specific page.

```javascript
const partner = app.pages.getGroupedPage(app.pages.activePage.id);
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `withPageId` | `string` | ID of the page to find the partner for |

**Returns:** `IPageInfo | undefined`

---

### `isLastPage(pageId?)`

True if the page is the last tab in the tab bar.

```javascript
app.pages.isLastPage(app.pages.activePage.id) // true or false
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `pageId?` | `string` | Page ID to check (optional) |

**Returns:** `boolean`

---

### `isGrouped(pageId)`

True if the page is currently grouped (side-by-side with another page).

```javascript
app.pages.isGrouped(app.pages.activePage.id) // true or false
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `pageId` | `string` | Page ID to check |

**Returns:** `boolean`

---

## Methods — Lifecycle

### `openFile(filePath)`

Open a file in a new or existing tab. If the file is already open, activates that tab instead.

```javascript
await app.pages.openFile("C:/data/file.json");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `filePath` | `string` | Absolute path to the file |

**Returns:** `Promise<void>`

**Side effects:**
- Adds file to recent files list
- Closes the initial empty page if one exists
- Activates existing tab if file already open

---

### `openFileWithDialog()`

Show the OS Open File dialog and open the selected file.

```javascript
await app.pages.openFileWithDialog();
```

**Returns:** `Promise<void>`

**Side effects:** Same as `openFile()` after user selects a file.

---

### `addEmptyPage()`

Add an empty text page (new untitled tab).

```javascript
const page = app.pages.addEmptyPage();
console.log(page.id); // new page's ID
```

**Returns:** `IPageInfo` — the newly created page.

---

### `addEditorPage(editor, language, title)`

Add a page with a specific editor type, language, and title.

```javascript
const page = app.pages.addEditorPage("grid-json", "json", "My Grid");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `editor` | `PageEditor` | Editor type (e.g., `"textFile"`, `"grid-json"`, `"grid-csv"`, `"markdown"`) |
| `language` | `string` | Language identifier (e.g., `"json"`, `"csv"`, `"markdown"`) |
| `title` | `string` | Tab title |

**Returns:** `IPageInfo` — the newly created page.

---

### `navigatePageTo(pageId, newFilePath, options?)`

Navigate an existing page to a different file. The page keeps its position in the tab bar but loads new content.

```javascript
await app.pages.navigatePageTo(app.pages.activePage.id, "C:/other-file.txt");

// With options: reveal a specific line
await app.pages.navigatePageTo(pageId, filePath, { revealLine: 42 });

// With options: highlight search text
await app.pages.navigatePageTo(pageId, filePath, { highlightText: "TODO" });
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `pageId` | `string` | ID of the page to navigate |
| `newFilePath` | `string` | Absolute path to the new file |
| `options?` | `object` | Optional navigation options |
| `options.revealLine?` | `number` | Scroll to this line after opening |
| `options.highlightText?` | `string` | Highlight this text after opening |
| `options.forceTextEditor?` | `boolean` | Force text editor instead of preview |

**Returns:** `Promise<boolean>` — `true` if navigation succeeded, `false` if user cancelled.

**Side effects:**
- Prompts user to save if current page has unsaved changes
- Preserves pinned state and navigation panel across navigation
- Chooses best editor (preview mode) for the new file unless `forceTextEditor` is set

---

### `openDiff(params)`

Open two files side-by-side in compare (diff) mode.

```javascript
await app.pages.openDiff({
  firstPath: "C:/file-v1.txt",
  secondPath: "C:/file-v2.txt"
});
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `params` | `object` | Diff parameters |
| `params.firstPath` | `string` | Path to the first (left) file |
| `params.secondPath` | `string` | Path to the second (right) file |

**Returns:** `Promise<void>`

**Side effects:**
- Opens both files if not already open
- Groups them side-by-side
- Enables compare mode for text files

---

### `showAboutPage()`

Show the About page.

```javascript
await app.pages.showAboutPage();
```

**Returns:** `Promise<void>`

---

### `showSettingsPage()`

Show the Settings page.

```javascript
await app.pages.showSettingsPage();
```

**Returns:** `Promise<void>`

---

### `showBrowserPage(options?)`

Open a new browser page, optionally with a specific profile or URL.

```javascript
// Default browser page
await app.pages.showBrowserPage();

// With a specific URL
await app.pages.showBrowserPage({ url: "https://github.com" });

// Incognito mode
await app.pages.showBrowserPage({ incognito: true });

// Specific profile
await app.pages.showBrowserPage({ profileName: "Work" });
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `options?` | `object` | Browser options |
| `options.profileName?` | `string` | Browser profile name |
| `options.incognito?` | `boolean` | Open in incognito mode |
| `options.url?` | `string` | URL to navigate to |

**Returns:** `Promise<void>`

---

### `openUrlInBrowserTab(url, options?)`

Open a URL in a browser tab. Reuses an existing browser page when possible (searches right-to-left from active tab for a matching profile).

```javascript
// Open in existing or new browser tab
await app.pages.openUrlInBrowserTab("https://example.com");

// Open in incognito
await app.pages.openUrlInBrowserTab("https://example.com", { incognito: true });

// Open as external URL (uses default profile, searches all tabs)
await app.pages.openUrlInBrowserTab("https://example.com", { external: true });
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `url` | `string` | URL to open |
| `options?` | `object` | Options |
| `options.incognito?` | `boolean` | Open in incognito mode |
| `options.profileName?` | `string` | Target profile name |
| `options.external?` | `boolean` | Treat as external URL (uses default profile, left-to-right search) |

**Returns:** `Promise<void>`

---

## Methods — Navigation

### `showPage(pageId)`

Activate (show) a page by ID. Makes the page visible in the editor area.

```javascript
app.pages.showPage("some-uuid");
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `pageId` | `string` | ID of the page to show |

**Returns:** `void`

---

### `showNext()`

Activate the next tab. Wraps around to the first tab after the last.

```javascript
app.pages.showNext();
```

**Returns:** `void`

---

### `showPrevious()`

Activate the previous tab. Wraps around to the last tab from the first.

```javascript
app.pages.showPrevious();
```

**Returns:** `void`

---

## Methods — Layout

### `moveTab(fromId, toId)`

Move a tab to a new position (before the target tab).

```javascript
app.pages.moveTab(draggedPageId, targetPageId);
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `fromId` | `string` | ID of the tab to move |
| `toId` | `string` | ID of the target tab (insert before this) |

**Returns:** `void`

---

### `pinTab(pageId)`

Pin a tab. Pinned tabs appear as compact icon-only tabs at the left of the tab bar.

```javascript
app.pages.pinTab(app.pages.activePage.id);
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `pageId` | `string` | ID of the tab to pin |

**Returns:** `void`

---

### `unpinTab(pageId)`

Unpin a tab.

```javascript
app.pages.unpinTab(app.pages.activePage.id);
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `pageId` | `string` | ID of the tab to unpin |

**Returns:** `void`

---

### `group(leftPageId, rightPageId)`

Group two pages side-by-side.

```javascript
const active = app.pages.activePage;
const other = app.pages.findPage("other-id");
app.pages.group(active.id, other.id);
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `leftPageId` | `string` | ID of the page to show on the left |
| `rightPageId` | `string` | ID of the page to show on the right |

**Returns:** `void`

---

### `ungroup(pageId)`

Remove a page from its side-by-side group.

```javascript
app.pages.ungroup(app.pages.activePage.id);
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `pageId` | `string` | ID of the page to ungroup |

**Returns:** `void`

---

## IPageInfo

Read-only page information returned by queries. Access properties directly on the page object.

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique page identifier (UUID) |
| `type` | `string` | Page type (e.g., `"textFile"`, `"browserPage"`, `"grid-json"`) |
| `title` | `string` | Tab title (file name or custom title) |
| `modified` | `boolean` | Whether the page has unsaved changes |
| `pinned` | `boolean` | Whether the tab is pinned |
| `filePath` | `string \| undefined` | Absolute file path, if page is backed by a file |
| `language` | `string \| undefined` | Language identifier (e.g., `"javascript"`, `"json"`) |

```javascript
const page = app.pages.activePage;
console.log(page.id);        // "a1b2c3d4-..."
console.log(page.title);     // "data.json"
console.log(page.modified);  // false
console.log(page.pinned);    // false
console.log(page.filePath);  // "C:/data/data.json"
console.log(page.language);  // "json"
```

---

## Examples

### Open a file and pin it

```javascript
await app.pages.openFile("C:/important/config.json");
app.pages.pinTab(app.pages.activePage.id);
```

### Navigate active page to a new file

```javascript
const page = app.pages.activePage;
if (page) {
  await app.pages.navigatePageTo(page.id, "C:/other-file.txt");
}
```

### Compare two files

```javascript
await app.pages.openDiff({
  firstPath: "C:/project/old-version.js",
  secondPath: "C:/project/new-version.js"
});
```

### Cycle through all tabs

```javascript
// Switch to next tab (Ctrl+Tab equivalent)
app.pages.showNext();

// Switch to previous tab (Ctrl+Shift+Tab equivalent)
app.pages.showPrevious();
```

### Open URL in browser

```javascript
await app.pages.openUrlInBrowserTab("https://developer.mozilla.org");
```

---

## Implementation Notes

- The `app.pages` singleton is a `PagesModel` instance created in [`/src/renderer/api/pages.ts`](../../../src/renderer/api/pages.ts)
- Internal architecture uses 5 category submodels: Lifecycle, Navigation, Layout, Persistence, Query — see [pages-architecture.md](../../architecture/pages-architecture.md)
- Type declarations: [`/src/renderer/api/types/pages.d.ts`](../../../src/renderer/api/types/pages.d.ts)
- Pages are persisted automatically (debounced) and restored during bootstrap
- Each window has its own `app.pages` instance (Electron multi-window architecture)
- Multi-window page transfer (`movePageIn`/`movePageOut`) is internal — not exposed to scripts
