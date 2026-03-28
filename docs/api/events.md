[← API Reference](./index.md)

# app.events

Application event channels for scripting integration. Subscribe to events to add custom context menu items, modify bookmark dialogs, trigger custom open behavior, and more.

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

### openRawLink

`IEventChannel<IRawLinkEvent>`

Layer 1 of the content open pipeline. Fired when a raw string (file path, URL, cURL command) needs to be parsed into a structured link. Parsers subscribe here and set `event.handled = true` when they recognize the format.

Scripts can also **send** to this channel to programmatically open content:

```javascript
// Open any URL or file path — Persephone auto-selects the right editor
const event = new io.RawLinkEvent("https://example.com/data.json");
await app.events.openRawLink.sendAsync(event);
```

#### IRawLinkEvent

| Property | Type | Description |
|----------|------|-------------|
| `raw` | `string` | The raw link string (file path, URL, cURL, etc.). Read-only. |
| `handled` | `boolean` | Set to `true` to stop further processing. |

---

### openLink

`IEventChannel<IOpenLinkEvent>`

Layer 2 of the content open pipeline. Fired with a normalized URL to be resolved into a content pipe. Resolvers subscribe here and build provider + transformer chains.

Scripts can send to this channel to open a known URL directly:

```javascript
// Open a specific URL, optionally specifying the target editor
const event = new io.OpenLinkEvent("C:/data/report.pdf");
await app.events.openLink.sendAsync(event);
```

#### IOpenLinkEvent

| Property | Type | Description |
|----------|------|-------------|
| `url` | `string` | Normalized URL or file path. Read-only. |
| `target` | `string \| undefined` | Target editor ID. Optional — auto-resolved if omitted. |
| `metadata` | `ILinkMetadata \| undefined` | Open hints: `pageId`, `revealLine`, `highlightText`, HTTP `headers`/`method`/`body`. |
| `handled` | `boolean` | Set to `true` to stop further processing. |

---

### openContent

`IEventChannel<IOpenContentEvent>`

Layer 3 of the content open pipeline. Fired with an assembled content pipe and target editor. The app's open handler subscribes here and creates/navigates pages.

Scripts can subscribe to observe or intercept page opens:

```javascript
// Log every page open
app.events.openContent.subscribe((event) => {
    console.log(`Opening: ${event.pipe.displayName} in ${event.target}`);
});
```

#### IOpenContentEvent

| Property | Type | Description |
|----------|------|-------------|
| `pipe` | `IContentPipe` | Assembled content pipe (provider + transformers). Read-only. |
| `target` | `string` | Resolved editor ID. Read-only. |
| `metadata` | `ILinkMetadata \| undefined` | Pass-through metadata from Layer 1/2. Read-only. |
| `handled` | `boolean` | Set to `true` to stop further processing. |

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

Every event channel exposes the same interface for subscribing and sending events:

| Method | Returns | Description |
|--------|---------|-------------|
| `subscribe(handler)` | `ISubscriptionObject` | Register a handler. Newest subscribers run first (LIFO order). |
| `send(event)` | `void` | Fire an event synchronously. Subscribers run in LIFO order. The event object is frozen — subscribers can observe but not modify it. |
| `sendAsync(event)` | `Promise<void>` | Fire an event asynchronously. Subscribers run in LIFO order, each awaited in turn. Subscribers can modify the event. Stops early if `event.handled` is set to `true`. |

Handlers can be synchronous or `async` — async handlers are awaited before the next handler runs.

### Sending events from scripts

Scripts can call `send()` or `sendAsync()` on any exposed channel. The link pipeline channels (`openRawLink`, `openLink`) are the primary use case:

```javascript
// Open a URL — routes through all registered parsers and resolvers
const event = new io.RawLinkEvent("https://example.com/data.json");
await app.events.openRawLink.sendAsync(event);
```

```javascript
// Subscribe first, then intercept opens before the app handler runs
app.events.openLink.subscribe((event) => {
    if (event.url.endsWith(".secret")) {
        event.handled = true; // block default behavior
        ui.warn("Access denied: " + event.url);
    }
});
```

Because `sendAsync()` runs subscribers in LIFO order (newest first), a script that subscribes and then sends will have its handler run before any built-in handlers.

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

1. `subscribe()` handlers run in LIFO order (newest subscriber first)
2. For `sendAsync()`: each handler can modify the event; if any handler sets `event.handled = true`, remaining handlers are skipped (short-circuit)
3. For `send()`: the event is frozen — handlers observe but cannot modify it; all handlers always run
4. Errors in individual handlers are caught and logged — they don't break the pipeline

The LIFO order means scripts that subscribe at runtime run **before** the built-in app handlers. This lets autoload scripts intercept and override default behavior.

## ContextMenuTargetKind Values

The `targetKind` field identifies the source of a context menu event. Currently exposed channels use:

- `"file-explorer-item"` — file/folder in the file explorer

Other values exist internally but are not yet exposed as subscribable channels:
`"page-tab"` · `"file-explorer-background"` · `"sidebar-folder"` · `"sidebar-background"` · `"markdown-link"` · `"browser-webview"` · `"browser-url-bar"` · `"browser-tab"` · `"grid-cell"` · `"graph-node"` · `"graph-area"` · `"link-item"` · `"link-pinned"` · `"generic"`
