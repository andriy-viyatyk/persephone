---
title: "Scripting: UI and io"
audience: "both"
summary: "How do scripts use Log View, content pipes, and output types?"
---

# Scripting: UI and io

## The `ui` Object (Log View)

Scripts can use the global [`ui`](api/ui-log.md) object for structured logging and inline dialogs. Instead of writing output to a grouped text page, `ui` opens a **Log View** — a scrollable list of typed log entries and interactive dialogs.

```javascript
ui.info("Starting import...");

const data = JSON.parse(page.content);
ui.log(`Found ${data.length} records`);

const result = await ui.dialog.confirm("Continue with import?");
if (result.button === "Yes") {
    // process data...
    ui.success("Import complete!");
} else {
    ui.warn("Import canceled");
}
```

Key points:
- **`await ui()` yield** — call `await ui()` inside long-running loops to yield to the event loop, keeping the UI responsive. This works whether or not you use any logging methods:
  ```javascript
  for (const item of largeArray) {
      // ... heavy processing ...
      await ui(); // let the UI breathe
  }
  ```
- **Lazy initialization** — the Log View page is created on the first `ui` access and auto-grouped with the source page
- **Suppresses default output** — accessing `ui` automatically prevents the return value from being written to a grouped page (same as `preventOutput()`)
- **Console forwarding** — when `ui` is active, `console.log/info/warn/error` are automatically forwarded to the Log View (`console.log` → lighter text, `console.info` → info, etc.). The native console is always called too. Suppress with `ui.preventConsoleLog()`, `ui.preventConsoleWarn()`, `ui.preventConsoleError()`.
- **Logging levels** — `ui.log()` (lighter text), `ui.text()` (normal text), `ui.info()`, `ui.warn()`, `ui.error()`, `ui.success()`
- **Fluent styled text** — logging methods return a builder for chaining: `ui.log("Status: ").append("OK").color("lime").bold().print()`
- **Styled text arrays** — pass an array of `{ text, styles }` segments for custom formatting
- **`styledText()` global** — build styled text for dialog labels: `styledText("Warning").color("red").bold().value`
- **Inline dialogs** — `ui.dialog.confirm()`, `ui.dialog.buttons()`, `ui.dialog.textInput()`, `ui.dialog.checkboxes()`, `ui.dialog.radioboxes()`, `ui.dialog.select()` appear directly in the Log View and return a `Promise` with the user's response
- **Progress bars** — `ui.show.progress()` adds a progress bar to the Log View and returns a `Progress` helper with `label`, `value`, `max`, and `completed` setters for real-time updates. Use `progress.completeWithPromise(promise)` to auto-complete on promise settlement.
- **Inline grids** — `ui.show.grid(data)` displays tabular data inline in the Log View using a full-featured grid with column resizing, reordering, and cell selection/copy. Pass an options object for custom columns and title: `ui.show.grid({ data, columns?, title? })`. The returned `Grid` helper has live `data`, `columns`, and `title` setters, plus `openInEditor()` to open the data in a dedicated Grid editor tab.
- **Inline markdown** — `ui.show.markdown(text)` renders markdown inline in the Log View — headings, tables, code blocks, Mermaid diagrams, task lists, and blockquotes. Pass an options object for a title: `ui.show.markdown({ text, title? })`. The returned `Markdown` helper has live `text` and `title` setters, plus `openInEditor()` to open in a Markdown editor tab.
- **Inline mermaid** — `ui.show.mermaid(text)` renders a Mermaid diagram inline in the Log View with theme-aware light/dark rendering. Pass an options object for a title: `ui.show.mermaid({ text, title? })`. The returned `Mermaid` helper has live `text` and `title` setters, plus `openInEditor()` to open in a Mermaid editor tab. Hover toolbar provides "Copy image to clipboard" and "Open in Mermaid editor" buttons.

See the [ui API reference](api/ui-log.md) for complete details.

## The `io` Namespace

Scripts have access to a global `io` object for building **content pipes** — a way to read (and sometimes write) binary content from files, HTTP URLs, and archives.

### Providers

Providers are data sources. Create one and pass it to `io.createPipe()`.

| Constructor | Description |
|-------------|-------------|
| `new io.FileProvider(filePath)` | Reads/writes a local file |
| `new io.HttpProvider(url, options?)` | Fetches from an HTTP/HTTPS URL |

`HttpProvider` options: `{ method?, headers?, body? }` — useful when you need custom headers or a POST body.

### Transformers

Transformers process the raw bytes before they reach your code.

| Constructor | Description |
|-------------|-------------|
| `new io.ArchiveTransformer(archivePath, entryPath)` | Extracts a single entry from an archive (ZIP, RAR, 7z, TAR, etc.) |
| `new io.DecryptTransformer(password)` | Decrypts AES-GCM encrypted content |

### Creating a pipe

```javascript
const pipe = io.createPipe(provider, ...transformers);
const text = await pipe.readText();
```

Pipe status is available through `pipe.stages` and `pipe.summary`; subscribe to live changes with
`pipe.onStatusChange(callback)`. Provider and transformer stages can report their state, text,
detail, byte progress, and transfer rate. Status is transient and is not saved with a pipe. See the
[`io` API reference](api/io-pipes-and-helpers.md#icontentpipe) for the status shape and subscription example.

### Register custom providers and URL schemes

Scripts can extend the `io` namespace for the current window session:

```javascript
io.registerProvider("memory", (config) => ({
    type: "memory",
    displayName: "Memory",
    sourceUrl: "memory://item",
    restorable: true,
    writable: false,
    readBinary: async () => Buffer.from(String(config.text ?? "")),
    toDescriptor: () => ({ type: "memory", config }),
}));
```

Use `io.registerScheme(scheme, { parse, resolve })` to connect a URL scheme to that provider and
open it with `app.events.openRawLink.sendAsync(io.createLinkData(url))`. Registrations remain
available after the script finishes and are cleared when the window is reloaded or restarted.
See the [`io` API reference](api/io.md#registering-providers-and-url-schemes) for the provider
contract, hook context, duplicate handling, and a complete example.

### Examples

**Read a remote JSON file:**

```javascript
const provider = new io.HttpProvider("https://example.com/data.json");
const pipe = io.createPipe(provider);
const text = await pipe.readText();
return JSON.parse(text);
```

**Read a file inside an archive:**

```javascript
const provider = new io.FileProvider("C:/reports/archive.zip");
const entry = new io.ArchiveTransformer("C:/reports/archive.zip", "reports/summary.csv");
const pipe = io.createPipe(provider, entry);
return await pipe.readText();
```

**Fetch with custom headers (like a cURL command):**

```javascript
const provider = new io.HttpProvider("https://api.example.com/data", {
    method: "GET",
    headers: { "Authorization": "Bearer my-token" },
});
const pipe = io.createPipe(provider);
const text = await pipe.readText();
return JSON.parse(text);
```

### Opening content in an editor

To open content from a pipe in a new tab, fire it through the link pipeline:

```javascript
// Open a URL in Persephone (auto-selects editor by content type)
await app.events.openRawLink.sendAsync(
    io.createLinkData("https://example.com/report.pdf")
);
```

```javascript
// Open a specific file path by supplying its resolved URL
await app.events.openLink.sendAsync(
    io.createLinkData("C:/data/file.json", { url: "C:/data/file.json" })
);
```

See the [Events API](./api/events.md) for the full pipeline reference.


## Output Types

| Return Type | Result |
|-------------|--------|
| String | Written as-is |
| Number/Boolean | Converted to string |
| Object/Array | JSON formatted |
| Error | Error message + stack |
| undefined | "undefined" |

