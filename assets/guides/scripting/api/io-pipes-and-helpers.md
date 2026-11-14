---
title: "io: Pipes and Helpers"
audience: user
summary: "How do scripts compose content pipes and use link helpers?"
---

# io: Pipes and Helpers

## IContentPipe

The pipe is the primary abstraction for reading and writing content. Returned by `io.createPipe()`.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `provider` | `IProvider` | The root data source. Read-only. |
| `logicalPath` | `string` | The full source path for the content. For an archive entry, this includes the archive and entry paths. Read-only. |
| `logicalPathFor(sourcePath)` | `string` | Return the logical path using another provider source path. For archive pipes, the entry path is preserved. |
| `transformers` | `ITransformer[]` | Ordered list of transformers. Read-only. |
| `writable` | `boolean` | True if the full chain (provider + all transformers) supports writing. Read-only. |
| `displayName` | `string` | Human-readable name (filename, URL, etc.). Read-only. |
| `encoding` | `string?` | Detected text encoding after the first `readText()` call (e.g., `"utf-8"`, `"utf-16le"`). Read-only. |
| `stages` | `ReadonlyArray<IPipeStage>` | Provider followed by transformers in read order, with each stage's role, type, display name, and optional status. Read-only snapshots. |
| `summary` | `IPipeStageStatus \| undefined` | Current aggregate status: an error takes priority; otherwise the most recently updated stage status. |

For example, `logicalPath` for a pipe reading `data/summary.csv` from
`C:/reports/archive.zip` is `C:/reports/archive.zip!/data/summary.csv`. `logicalPathFor()` is useful
when you need the same content location under a renamed source file:

```javascript
const pipe = io.createPipe(
    new io.FileProvider("C:/reports/archive.zip"),
    new io.ArchiveTransformer("C:/reports/archive.zip", "data/summary.csv"),
);
console.log(pipe.logicalPath);
console.log(pipe.logicalPathFor("C:/reports/renamed.zip"));
```

Each status has a `state` (`idle`, `connecting`, `active`, `done`, or `error`) and may include
`text`, `detail`, byte `progress` (`loaded` and optional `total`), and `rate` in bytes per second.
Status is temporary and is not saved in the pipe descriptor. Providers and transformers may each
report their own status; the pipe gathers those updates.

#### onStatusChange(callback) -> `() => void`

Subscribe to changes from any stage. Read `stages` or `summary` again inside the callback, and call
the returned function when observation is no longer needed.

```javascript
const pipe = io.createPipe(new io.HttpProvider("https://example.com/data.json"));
const unsubscribe = pipe.onStatusChange(() => {
    console.log(pipe.summary, pipe.stages);
});
try {
    return await pipe.readText();
} finally {
    unsubscribe();
}
```

### Reading

#### readText() -> `Promise<string>`

Read the content as text. Encoding is auto-detected on first read (defaults to UTF-8).

```javascript
const pipe = io.createPipe(new io.FileProvider("C:/data/report.csv"));
const text = await pipe.readText();
```

#### readBinary(options?) -> `Promise<Buffer>`

Read raw binary content as a Node.js `Buffer`.

```javascript
const pipe = io.createPipe(new io.HttpProvider("https://example.com/image.png"));
const buffer = await pipe.readBinary();
```

Pass `{ signal }` to make cancellation available to the provider:

```javascript
const controller = new AbortController();
const pending = pipe.readBinary({ signal: controller.signal });
controller.abort();
await pending; // rejects if the provider stops on cancellation
```

#### createReadStream(range?, options?) -> `NodeJS.ReadableStream`

Create a stream of logical pipe bytes. `range` uses inclusive `start` and `end` byte offsets; omit
it to request the whole pipe. The optional `options.signal` is forwarded to the provider where
supported.

```javascript
const stream = pipe.createReadStream({ start: 0, end: 1023 });
```

#### stat(options?) -> `Promise<IProviderStat>`

Read metadata for the logical pipe, including its post-transform size when known. The optional
`options.signal` follows the same cancellation rules as `readBinary()`.

```javascript
const info = await pipe.stat();
console.log(info.exists, info.size);
```

### Writing

Writing is only available when `pipe.writable` is `true`. For example, `FileProvider` supports writing but `HttpProvider` does not. Calling `writeText()` or `writeBinary()` on a read-only pipe throws an error -- always check `writable` first.

#### writeText(content) -> `Promise<void>`

Write text content. Encodes using the detected encoding from the last read.

```javascript
const pipe = io.createPipe(new io.FileProvider("C:/data/output.txt"));
await pipe.writeText("Hello, world!");
```

#### writeBinary(data) -> `Promise<void>`

Write raw binary content.

```javascript
const pipe = io.createPipe(new io.FileProvider("C:/data/output.bin"));
await pipe.writeBinary(buffer);
```

### Watching

#### watch(callback) -> `() => void`

Watch for external changes to the underlying resource (e.g., file modified on disk). Not all providers support watching.

```javascript
const pipe = io.createPipe(new io.FileProvider("C:/data/config.json"));
const release = pipe.watch((event) => {
    console.log("File changed:", event);
});

// Stop watching
release();
```

### Cloning

Pipes are immutable by convention. To modify a pipe's transformer chain, clone it first.

#### clone() -> `IContentPipe`

Create a deep copy of the pipe (same provider and transformers).

```javascript
const clone = pipe.clone();
clone.addTransformer(new io.ArchiveTransformer("C:/data/archive.zip", "other-entry.txt"));
```

#### cloneWithProvider(provider) -> `IContentPipe`

Clone the pipe but swap the provider, keeping all transformers.

```javascript
const newPipe = pipe.cloneWithProvider(new io.FileProvider("C:/other-file.zip"));
```

### Modifying transformers

These methods are typically used on a cloned pipe, not the active one.

#### addTransformer(transformer, index?)

Insert a transformer. If `index` is omitted, it is appended at the end.

#### removeTransformer(type) -> `ITransformer | undefined`

Remove a transformer by its type string (e.g., `"zip"`, `"decrypt"`). Returns the removed transformer or `undefined`.

### Cleanup

#### dispose()

Release the provider's resources (file handles, connections). Call this when you are done with a pipe you created manually.

---

## Link Helpers

The `io` namespace provides helper functions for creating `ILinkData` objects. Send these objects
through `app.events` to open content programmatically.

For full details on event channels and the pipeline, see [app.events](./events.md).

### io.createLinkData(href, options?)

Creates an `ILinkData` object for sending through `app.events.openRawLink`. Persephone parses the
link, resolves its content, and opens the appropriate page. Options are caller-settable link
metadata; pipeline output fields such as `action` cannot be seeded through this helper.

```javascript
// Open any URL or file — Persephone auto-selects the editor
await app.events.openRawLink.sendAsync(
    io.createLinkData("https://example.com/data.json")
);
```

```javascript
// Open a local file
await app.events.openRawLink.sendAsync(
    io.createLinkData("C:/reports/summary.pdf")
);
```

```javascript
// Open in incognito browser
await app.events.openRawLink.sendAsync(
    io.createLinkData("https://example.com", { target: "browser", browserMode: "incognito" })
);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `href` | `string` | Raw link string — file path, URL, or cURL command. |
| `options` | `Partial<Omit<ILinkData, "href" \| "handled" \| "action">>?` | Optional caller-settable fields (see `ILinkData` fields below). |

**Key `ILinkData` fields you can pass as options:**

| Field | Type | Description |
|-------|------|-------------|
| `target` | `string?` | Target editor or capability ID override (e.g., `"browser"`, `"monaco"`, or `"image.edit"`). Auto-resolved from URL if omitted. |
| `url` | `string?` | Resolved URL to use directly instead of parsing `href`. |
| `pageId` | `string?` | Open in this specific existing page instead of a new tab. |
| `revealLine` | `number?` | Scroll to this line after opening. |
| `highlightText` | `string?` | Highlight occurrences of this text after opening. |
| `headers` | `Record<string, string>?` | HTTP request headers. |
| `method` | `string?` | HTTP method. |
| `body` | `string?` | HTTP request body. |
| `title` | `string?` | Page title override. |
| `fallbackTarget` | `string?` | Fallback editor when the URL has no recognized extension. Set to `"monaco"` to force text editor fallback instead of opening in the browser. |
| `browserMode` | `string?` | Route to a specific browser: `"os-default"`, `"internal"`, `"incognito"`, or `"profile:<name>"`. Omit to use the `link-open-behavior` setting. |
| `browserPageId` | `string?` | Route to a specific already-open browser page by ID. URL is added as a new tab (or navigates the active tab if `browserTabMode` is `"navigate"`). |
| `browserTabMode` | `"navigate" \| "addTab"?` | When `browserPageId` is set: `"navigate"` navigates the active tab, `"addTab"` opens a new tab (default). |

`action` is output-only pipeline metadata. Platform parsing and resolution may record it for Layer 3,
but callers must not seed it as an `io.createLinkData()` option; each platform subscriber clears any
pre-existing value before it runs. Scripts that implement a scheme may set `{ kind: "content" }` as
an explicit content marker. Actions are never stored in a page's source link.

### io.linkToLinkData(link)

Converts an `ILink` object (e.g., from a `.link.json` collection) to an `ILinkData`, preserving all fields (title, category, tags, imgSrc, target). Use this when opening a link from a collection through the pipeline.

```javascript
const linkEditor = page.editor;
if (linkEditor.id !== "link-view") throw new Error("Open a Link Editor page first");
for (const link of linkEditor.links) {
    const data = io.linkToLinkData(link);
    await app.events.openRawLink.sendAsync(data);
}
```

### Opening a pre-assembled pipe

To open a pre-assembled content pipe directly in an editor, use `app.events.openContent.sendAsync()`
with a `createLinkData` call that includes `pipe` and `target`:

```javascript
const pipe = io.createPipe(
    new io.FileProvider("C:/data.zip"),
    new io.ArchiveTransformer("C:/data.zip", "report.csv"),
);
await app.events.openContent.sendAsync(
    io.createLinkData("C:/data.zip", { pipe, target: "grid-csv" })
);
```

---

## Examples

### Read a remote JSON file

```javascript
const pipe = io.createPipe(
    new io.HttpProvider("https://api.example.com/users.json")
);
const data = JSON.parse(await pipe.readText());
console.log(data.length + " users");
return data;
```

### Read a file inside an archive

```javascript
const pipe = io.createPipe(
    new io.FileProvider("C:/reports/archive.zip"),
    new io.ArchiveTransformer("C:/reports/archive.zip", "reports/summary.csv"),
);
return await pipe.readText();
```

### Fetch with custom headers

```javascript
const pipe = io.createPipe(
    new io.HttpProvider("https://api.example.com/data", {
        method: "GET",
        headers: { "Authorization": "Bearer my-token" },
    })
);
return JSON.parse(await pipe.readText());
```

### Read an encrypted file

```javascript
const password = await app.ui.password({ title: "Enter password" });
if (!password) return;

const pipe = io.createPipe(
    new io.FileProvider("C:/secrets/data.enc"),
    new io.DecryptTransformer(password),
);
return await pipe.readText();
```

### Write to a file through a pipe

```javascript
const pipe = io.createPipe(new io.FileProvider("C:/output/result.json"));
const data = JSON.parse(page.content);
data.timestamp = new Date().toISOString();
await pipe.writeText(JSON.stringify(data, null, 2));
console.log("Written to " + pipe.displayName);
```

### Open a URL in a new tab

```javascript
// Persephone auto-selects the right editor (grid, text, browser, etc.)
await app.events.openRawLink.sendAsync(
    io.createLinkData("https://example.com/report.pdf")
);
```

### Intercept link opens

```javascript
// Block opening certain URLs
app.events.openLink.subscribe((event) => {
    if (event.url.includes("internal-only.corp")) {
        event.handled = true;
        ui.warn("Blocked: " + event.url);
    }
});
```

### Open a URL with custom HTTP headers

```javascript
await app.events.openLink.sendAsync(
    io.createLinkData("https://api.example.com/data.json", {
        headers: {
            "Authorization": "Bearer my-token",
            "Accept": "application/json",
        },
    })
);
```
