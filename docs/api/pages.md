[← API Reference](./index.md)

# app.pages

Manage open pages (tabs) in the current window.

```javascript
// Get active page
const current = app.pages.activePage;

// Open a file
await app.pages.openFile("C:/data.json");

// Add an empty page
app.pages.addEmptyPage();
```

## Queries

| Member | Type | Description |
|--------|------|-------------|
| `activePage` | `IPage \| undefined` | Currently active (visible) page. |
| `groupedPage` | `IPage \| undefined` | Grouped partner of the active page. |
| `findPage(pageId)` | `IPage \| undefined` | Find a page by ID. |
| `getGroupedPage(withPageId)` | `IPage \| undefined` | Get grouped partner of a specific page. |
| `isLastPage(pageId?)` | `boolean` | True if the page is the last tab. |
| `isGrouped(pageId)` | `boolean` | True if the page is grouped (side-by-side). |

## Lifecycle

### openFile(filePath) → `Promise<void>`

Open a file in a new or existing tab.

```javascript
await app.pages.openFile("C:/projects/data.json");
```

### openFileWithDialog() → `Promise<void>`

Show the native Open File dialog and open the selected file.

```javascript
await app.pages.openFileWithDialog();
```

### navigatePageTo(pageId, newFilePath, options?) → `Promise<boolean>`

Navigate an existing page to a different file.

Options:
- `revealLine?: number` — scroll to this line
- `highlightText?: string` — highlight occurrences of this text
- `forceTextEditor?: boolean` — force Monaco text editor

```javascript
await app.pages.navigatePageTo(page.id, "C:/other-file.json", {
    revealLine: 42,
    highlightText: "searchTerm"
});
```

### addEmptyPage() → `IPage`

Add an empty text page. Returns the new page.

### addEditorPage(editor, language, title) → `IPage`

Add a page with a specific editor, language, and title.

```javascript
app.pages.addEditorPage("grid-json", "json", "My Data");
```

### addDrawPage(dataUrl, title?) → `Promise<IPage>`

Create a new drawing page with an embedded image. The image is converted to an Excalidraw scene with the image element pre-inserted.

- `dataUrl` — image as a data URL (e.g., `"data:image/png;base64,..."`)
- `title` — optional page title (default: `"untitled.excalidraw"`)

```javascript
// Capture something as a data URL, then open in the drawing editor
const drawPage = await app.pages.addDrawPage(dataUrl, "annotated-screenshot.excalidraw");
```

### openDiff(params) → `Promise<void>`

Open a diff view for two files side by side.

```javascript
await app.pages.openDiff({
    firstPath: "C:/file-v1.txt",
    secondPath: "C:/file-v2.txt"
});
```

### showAboutPage() → `Promise<void>`

Open the About page.

### showSettingsPage() → `Promise<void>`

Open the Settings page.

### showBrowserPage(options?) → `Promise<void>`

Open a browser page.

Options:
- `profileName?: string` — browser profile to use
- `incognito?: boolean` — open in incognito mode
- `url?: string` — initial URL

```javascript
await app.pages.showBrowserPage({ url: "https://github.com" });
```

### openUrlInBrowserTab(url, options?) → `Promise<void>`

Open a URL in a browser tab (reuses existing browser page if possible).

Options:
- `incognito?: boolean`
- `profileName?: string`
- `external?: boolean` — open in OS default browser instead

```javascript
await app.pages.openUrlInBrowserTab("https://docs.github.com");
```

## Navigation

| Method | Description |
|--------|-------------|
| `showPage(pageId)` | Activate (show) a page by ID. |
| `showNext()` | Activate the next tab (wraps around). |
| `showPrevious()` | Activate the previous tab (wraps around). |

## Layout

| Method | Description |
|--------|-------------|
| `moveTab(fromId, toId)` | Move a tab to a new position. |
| `pinTab(pageId)` | Pin a tab. |
| `unpinTab(pageId)` | Unpin a tab. |
| `group(leftPageId, rightPageId)` | Group two pages side by side. |
| `ungroup(pageId)` | Remove a page from its group. |

```javascript
// Group current page with its output
const outputPage = app.pages.addEmptyPage();
app.pages.group(page.id, outputPage.id);
```
