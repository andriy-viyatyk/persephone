[← API Reference](./index.md)

# app.events

Application event channels for scripting integration. Subscribe to events to add custom context menu items, modify bookmark dialogs, and more.

Subscriptions are **auto-cleaned** when the script finishes — no manual `unsubscribe()` needed (though you can call it earlier if desired).

```javascript
// Add a custom context menu item for package.json files
app.events.fileExplorer.itemContextMenu.subscribe((event) => {
    if (event.target.name === "package.json") {
        event.items.push({
            label: "Show Dependencies",
            onClick: () => { /* ... */ },
        });
    }
});
```

## Event Channels

### fileExplorer.itemContextMenu

`IEventChannel<FileContextMenuEvent>`

Fired when the user right-clicks a file or folder in the file explorer sidebar.

```javascript
app.events.fileExplorer.itemContextMenu.subscribe((event) => {
    // event.target — the file or folder that was right-clicked
    console.log(event.target.path);        // "C:/projects/app/data.json"
    console.log(event.target.name);        // "data.json"
    console.log(event.target.isDirectory); // false

    // event.items — mutable array of context menu items
    event.items.push({
        label: "Open in External Editor",
        onClick: () => app.shell.openExternal(event.target.path),
    });
});
```

#### FileContextMenuEvent

| Property | Type | Description |
|----------|------|-------------|
| `targetKind` | `"file-explorer-item"` | Event source identifier. Read-only. |
| `target` | `IFileTarget` | The right-clicked file or folder. Read-only. |
| `items` | `MenuItem[]` | Context menu items. Mutable — push, remove, or replace items. |
| `handled` | `boolean` | Set to `true` to skip the default handler. |

#### IFileTarget

| Property | Type | Description |
|----------|------|-------------|
| `path` | `string` | Full file path. |
| `name` | `string` | File name with extension. |
| `isDirectory` | `boolean` | True if this is a directory. |

---

### browser.onBookmark

`IEventChannel<IBookmarkEvent>`

Fired before the Add/Edit Bookmark dialog opens in the browser editor. Modify event properties to alter what the user sees in the dialog.

```javascript
app.events.browser.onBookmark.subscribe((event) => {
    // Auto-categorize bookmarks by domain
    if (event.href.includes("github.com")) {
        event.category = "Development";
        event.tags.push("github");
    }

    // Clean up discovered image URLs
    event.discoveredImages = event.discoveredImages
        .filter(url => !url.includes("tracking"));
});
```

#### IBookmarkEvent

| Property | Type | Description |
|----------|------|-------------|
| `title` | `string` | Page title. Editable. |
| `href` | `string` | Page URL. Editable. |
| `discoveredImages` | `string[]` | Images found on the page. Editable — add, remove, or replace. |
| `imgSrc` | `string` | Currently selected image URL. Editable. |
| `category` | `string` | Bookmark category. Editable. |
| `tags` | `string[]` | Bookmark tags. Editable. |
| `isEdit` | `boolean` | True if editing an existing bookmark, false if adding new. Read-only. |
| `handled` | `boolean` | Set to `true` to skip the default handler. |

---

## IEventChannel

Every event channel exposes the same subscription interface:

| Method | Returns | Description |
|--------|---------|-------------|
| `subscribe(handler)` | `ISubscriptionObject` | Register a handler. Runs in registration order. |
| `subscribeDefault(handler)` | `ISubscriptionObject` | Register a default handler that runs last. Skipped if `event.handled` is `true`. Only one default handler per channel. |

Handlers can be synchronous or `async` — async handlers are awaited before the next handler runs.

### ISubscriptionObject

| Method | Description |
|--------|-------------|
| `unsubscribe()` | Remove this handler from the channel. |

```javascript
const sub = app.events.fileExplorer.itemContextMenu.subscribe((event) => {
    // handle event
});

// Optional — unsubscribe early (auto-cleaned on script end regardless)
sub.unsubscribe();
```

---

## MenuItem

Context menu items pushed into `event.items`:

| Property | Type | Description |
|----------|------|-------------|
| `label` | `string` | Menu item text. **Required.** |
| `onClick` | `() => void` | Click handler. |
| `disabled` | `boolean` | Grayed out when true. |
| `invisible` | `boolean` | Hidden when true. |
| `startGroup` | `boolean` | Show a separator line above this item. |
| `hotKey` | `string` | Keyboard shortcut display text. |
| `selected` | `boolean` | Initially highlighted item. |
| `id` | `string` | Optional identifier. |
| `items` | `MenuItem[]` | Sub-menu items. |
| `minor` | `boolean` | Lighter styling. |

```javascript
event.items.push({
    label: "My Tools",
    items: [
        { label: "Format JSON", onClick: () => formatJson(event.target.path) },
        { label: "Validate Schema", onClick: () => validateSchema(event.target.path) },
    ],
});
```

---

## Event Pipeline

Events flow through handlers sequentially:

1. `subscribe()` handlers run in registration order
2. If `event.handled` is still `false`, the `subscribeDefault()` handler runs last
3. Each handler can modify the event (add menu items, change properties)
4. Errors in individual handlers are caught and logged — they don't break the pipeline

## ContextMenuTargetKind Values

The `targetKind` field identifies the source of a context menu event. Currently exposed channels use:

- `"file-explorer-item"` — file/folder in the file explorer

Other values exist internally but are not yet exposed as subscribable channels:
`"page-tab"` · `"file-explorer-background"` · `"sidebar-folder"` · `"sidebar-background"` · `"markdown-link"` · `"browser-webview"` · `"browser-url-bar"` · `"browser-tab"` · `"grid-cell"` · `"graph-node"` · `"graph-area"` · `"link-item"` · `"link-pinned"` · `"generic"`
