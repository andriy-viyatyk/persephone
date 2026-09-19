---
title: "io"
audience: user
summary: "Build content pipes and register custom providers and URL schemes."
---

# io

The content-pipe and link helper namespace. Available as the global `io` variable in scripts.

Use `io` to read and write binary content from files, HTTP URLs, and archives. You can also add a
custom provider or URL scheme for the current window session.

```javascript
// Read a CSV from inside a ZIP archive
const pipe = io.createPipe(
    new io.FileProvider("C:/reports/archive.zip"),
    new io.ArchiveTransformer("C:/reports/archive.zip", "data/summary.csv"),
);
const text = await pipe.readText();
return text;
```

---

## Registering providers and URL schemes

Scripts can add a provider factory and a URL scheme to Persephone's link-opening flow. These
registrations belong to the current window session: they remain available after the script
finishes and after another script runs, but a reload or restart clears them. There is currently no
unregister method.

### `io.registerProvider(type, factory)`

The factory receives the descriptor's `config` object and must return an `IProvider`. It is called
without `new`, so return either a plain object or an instance created inside the factory. Build the
provider from the configuration rather than capturing a page, UI object, or other short-lived
script value; this allows the provider to be recreated when a saved page is opened.

The provider contract has these mandatory and optional members:

| Member | Required | Purpose |
|--------|----------|---------|
| `type: string` | Yes | Provider type used in descriptors. |
| `displayName: string` | Yes | Name shown by the page and pipe. |
| `sourceUrl: string` | Yes | URL or path that identifies the provider's source. |
| `restorable: boolean` | Yes | Declares whether the provider can be reconstructed. |
| `writable: boolean` | Yes | Declares whether the pipe can write. |
| `readBinary(): Promise<Buffer>` | Yes | Reads the provider bytes. |
| `toDescriptor(): IProviderDescriptor` | Yes | Serializes the provider configuration. |
| `createReadStream(range?: { start: number; end: number })` | No | Optional ranged stream for large binary content. |
| `writeBinary(data: Buffer)` | No | Optional write operation for writable providers. |
| `stat(): Promise<IProviderStat>` | No | Optional size, modification-time, and existence metadata. |
| `watch(callback: (event: string) => void): () => void` | No | Optional external-change notifications. |
| `dispose(): void` | No | Optional resource cleanup. |

When a script-registered factory is first used, Persephone checks that the returned provider has
the required members. If it is malformed, one error names the provider type and all missing
members, for example `Provider "demo-mem" is missing required member(s): toDescriptor().` The
check is cached for that registration, while optional members remain optional. Platform providers
are not subject to this script registration check.

Registering a type already registered by your scripts replaces that factory and reports an `info`
notification. Built-in provider types cannot be replaced; trying to register one reports an error.
Replacement affects content opened afterward, while an already-open pipe keeps its existing
provider.

### `io.registerScheme(scheme, hooks)`

The hooks object must provide `parse` and `resolve` functions. They receive the `ILinkData` object
used by the link-opening events, plus a context containing `phase`, `delegate()`, and
`createPipe(descriptor)`. Scheme names are trimmed and matched case-insensitively; a trailing `:`
is optional.

The parse hook should set `data.url`, set `data.handled = false`, call `context.delegate()`, and
then set `data.handled = true`. The resolve hook should set `data.target`, provide a persistable
`data.pipeDescriptor`, and create `data.pipe` with `context.createPipe()`. In the `open` phase,
call `context.delegate()` after preparing the data. In the `source-path` phase, create the pipe
and return without delegating.

Registering a scheme already registered by your scripts replaces the hooks and reports an `info`
notification. Built-in schemes cannot be replaced; trying to register one reports an error. The
replacement affects links opened afterward, while existing pipes are unchanged.

### Complete example

This example registers a read-only provider and opens it as a text page:

```javascript
const providerType = "script-demo-provider";
const scheme = "script-demo";

io.registerProvider(providerType, (config) => {
    const text = typeof config.text === "string" ? config.text : "";

    return {
        type: providerType,
        displayName: "Script demo",
        sourceUrl: `${scheme}://hello`,
        restorable: true,
        writable: false,
        async readBinary() {
            return Buffer.from(text, "utf8");
        },
        toDescriptor() {
            return {
                type: providerType,
                config: { text },
            };
        },
    };
});

io.registerScheme(scheme, {
    async parse(data, context) {
        data.url = data.href;
        data.handled = false;
        await context.delegate();
        data.handled = true;
    },

    async resolve(data, context) {
        data.target = "monaco";
        data.pipeDescriptor = {
            provider: {
                type: providerType,
                config: { text: "Hello from a script-registered provider." },
            },
            transformers: [],
        };
        data.pipe = context.createPipe(data.pipeDescriptor);

        if (context.phase === "source-path") return;

        data.handled = false;
        await context.delegate();
        data.handled = true;
    },
});

await app.events.openRawLink.sendAsync(
    io.createLinkData(`${scheme}://hello`),
);
```

Run the example again in the same window after changing its descriptor text. The second run reports
an info notification for both replacements, a newly opened page uses the new factory and hooks,
and the already-open page keeps its old provider. If a saved page uses this provider, run the
registration script before opening that page after a restart.

---

## Providers

Providers are data sources -- they know *where* to get bytes. Create a provider and pass it to `io.createPipe()`.

### FileProvider

Read and write local files.

```javascript
const provider = new io.FileProvider("C:/data/report.json");
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `filePath` | `string` | Absolute path to a local file. |

The resulting provider is **writable** -- pipes built from it support `writeText()` and `writeBinary()`.

### HttpProvider

Fetch content from an HTTP or HTTPS URL.

```javascript
const provider = new io.HttpProvider("https://api.example.com/data.json");
```

```javascript
// With options (POST, custom headers, body)
const provider = new io.HttpProvider("https://api.example.com/users", {
    method: "POST",
    headers: { "Authorization": "Bearer token123" },
    body: JSON.stringify({ name: "Alice" }),
});
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | HTTP or HTTPS URL. |
| `options` | `object?` | Optional request configuration. |
| `options.method` | `string?` | HTTP method (default `"GET"`). |
| `options.headers` | `Record<string, string>?` | Request headers. |
| `options.body` | `string?` | Request body. |

The resulting provider is **read-only** -- pipes built from it do not support writing.

---

## Transformers

Transformers process bytes between the provider and your code. They sit in a chain: on read, data flows provider -> transformer 1 -> transformer 2 -> your code. On write, the chain reverses.

### ArchiveTransformer

Extract (or replace) a single entry inside an archive file. Supports ZIP, RAR, 7z, TAR (including `.tar.gz`, `.tar.bz2`, `.tar.xz`), CAB, ISO, and other formats for reading. Write back (replacing an entry) is supported only for ZIP-based archives.

```javascript
const transformer = new io.ArchiveTransformer("C:/reports/archive.zip", "reports/summary.csv");
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `archivePath` | `string` | Absolute path to the archive file on disk. |
| `entryPath` | `string` | Path of the entry inside the archive. |

On write, the entry is replaced and the archive is rebuilt. Write is only supported for ZIP-based formats (`.zip`, `.docx`, `.xlsx`, etc.). Calling `writeText()` or `writeBinary()` on a non-ZIP archive throws an error — check `pipe.writable` first.

### DecryptTransformer

Decrypt and encrypt content using AES-GCM.

```javascript
const transformer = new io.DecryptTransformer("my-secret-password");
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `password` | `string` | Encryption password. |

This transformer is **non-persistent** -- it is never saved to disk (the password would be exposed). If you close and reopen a tab that used a DecryptTransformer, the transformer will not be restored automatically.

---

## createPipe(provider, ...transformers)

Assemble a content pipe from a provider and zero or more transformers.

```javascript
io.createPipe(provider: IProvider, ...transformers: ITransformer[]): IContentPipe
```

Returns an `IContentPipe` that you can read from (and write to, if the provider and all transformers support it).

```javascript
// Provider only -- no transformers
const pipe = io.createPipe(new io.FileProvider("C:/data/file.txt"));

// Provider + one transformer
const pipe = io.createPipe(
    new io.FileProvider("C:/data/archive.zip"),
    new io.ArchiveTransformer("C:/data/archive.zip", "readme.md"),
);

// Provider + multiple transformers (chained in order)
const pipe = io.createPipe(
    new io.FileProvider("C:/data/encrypted-archive.zip"),
    new io.DecryptTransformer("password"),
    new io.ArchiveTransformer("C:/data/encrypted-archive.zip", "secret/data.json"),
);
```

---

## IContentPipe

The pipe is the primary abstraction for reading and writing content. Returned by `io.createPipe()`.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `provider` | `IProvider` | The root data source. Read-only. |
| `transformers` | `ITransformer[]` | Ordered list of transformers. Read-only. |
| `writable` | `boolean` | True if the full chain (provider + all transformers) supports writing. Read-only. |
| `displayName` | `string` | Human-readable name (filename, URL, etc.). Read-only. |
| `encoding` | `string?` | Detected text encoding after the first `readText()` call (e.g., `"utf-8"`, `"utf-16le"`). Read-only. |

### Reading

#### readText() -> `Promise<string>`

Read the content as text. Encoding is auto-detected on first read (defaults to UTF-8).

```javascript
const pipe = io.createPipe(new io.FileProvider("C:/data/report.csv"));
const text = await pipe.readText();
```

#### readBinary() -> `Promise<Buffer>`

Read raw binary content as a Node.js `Buffer`.

```javascript
const pipe = io.createPipe(new io.HttpProvider("https://example.com/image.png"));
const buffer = await pipe.readBinary();
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
link, resolves its content, and opens the appropriate page. All options are optional top-level
fields on `ILinkData`.

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
| `options` | `Partial<ILinkData>?` | Optional fields to set on the data object (see `ILinkData` fields below). |

**Key `ILinkData` fields you can pass as options:**

| Field | Type | Description |
|-------|------|-------------|
| `target` | `string?` | Target editor ID override (e.g., `"browser"`, `"monaco"`). Auto-resolved from URL if omitted. |
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
