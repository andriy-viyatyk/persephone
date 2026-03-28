[← API Reference](./index.md)

# io

The content pipe builder. Available as the global `io` variable in scripts.

Use `io` to read and write binary content from files, HTTP URLs, and archives. It exposes the same content pipeline that Persephone uses internally when you open a file or URL -- but from script code you control the provider, transformers, and pipe directly.

```javascript
// Read a CSV from inside a ZIP archive
const pipe = io.createPipe(
    new io.FileProvider("C:/reports/archive.zip"),
    new io.ZipTransformer("data/summary.csv"),
);
const text = await pipe.readText();
return text;
```

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

### ZipTransformer

Extract (or replace) a single entry inside a ZIP archive.

```javascript
const transformer = new io.ZipTransformer("reports/summary.csv");
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `entryPath` | `string` | Path of the entry inside the ZIP archive. |

This transformer supports both read and write. On write, the original archive is rebuilt with the updated entry.

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
    new io.ZipTransformer("readme.md"),
);

// Provider + multiple transformers (chained in order)
const pipe = io.createPipe(
    new io.FileProvider("C:/data/encrypted-archive.zip"),
    new io.DecryptTransformer("password"),
    new io.ZipTransformer("secret/data.json"),
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

#### watch(callback) -> `ISubscriptionObject`

Watch for external changes to the underlying resource (e.g., file modified on disk). Not all providers support watching.

```javascript
const pipe = io.createPipe(new io.FileProvider("C:/data/config.json"));
const sub = pipe.watch((event) => {
    console.log("File changed:", event);
});

// Stop watching
sub.unsubscribe();
```

### Cloning

Pipes are immutable by convention. To modify a pipe's transformer chain, clone it first.

#### clone() -> `IContentPipe`

Create a deep copy of the pipe (same provider and transformers).

```javascript
const clone = pipe.clone();
clone.addTransformer(new io.ZipTransformer("other-entry.txt"));
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

## Event Constructors

The `io` namespace provides constructors for events used in the content open pipeline. Send these events through `app.events` to open content programmatically.

For full details on event channels and the pipeline, see [app.events](./events.md).

### RawLinkEvent

Layer 1 input. Pass a raw string (file path, URL, cURL command) and Persephone will parse, resolve, and open it automatically.

```javascript
const event = new io.RawLinkEvent("https://example.com/data.json");
await app.events.openRawLink.sendAsync(event);
```

```javascript
// Open a local file
await app.events.openRawLink.sendAsync(
    new io.RawLinkEvent("C:/reports/summary.pdf")
);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `raw` | `string` | Raw link string -- file path, URL, or cURL command. |

The returned event has a `raw` property (read-only) and a `handled` property (set to `true` by handlers).

### OpenLinkEvent

Layer 2 input. Skip raw parsing and go directly to provider resolution. Use this when you already have a normalized URL and optionally want to specify the target editor or pass metadata.

```javascript
const event = new io.OpenLinkEvent("C:/data/report.pdf");
await app.events.openLink.sendAsync(event);
```

```javascript
// With metadata (HTTP headers, target page, etc.)
const event = new io.OpenLinkEvent("https://api.example.com/data", undefined, {
    headers: { "Authorization": "Bearer token" },
});
await app.events.openLink.sendAsync(event);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | Normalized URL or file path. |
| `target` | `string?` | Target editor ID. Optional -- auto-resolved if omitted. |
| `metadata` | `Record<string, unknown>?` | Open hints: `pageId`, `revealLine`, `highlightText`, HTTP `headers`/`method`/`body`, or custom data. |

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

### Read a file inside a ZIP archive

```javascript
const pipe = io.createPipe(
    new io.FileProvider("C:/reports/archive.zip"),
    new io.ZipTransformer("reports/summary.csv"),
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
// Persephone auto-selects the right editor (PDF viewer, grid, text, etc.)
await app.events.openRawLink.sendAsync(
    new io.RawLinkEvent("https://example.com/report.pdf")
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
const event = new io.OpenLinkEvent("https://api.example.com/data.json", undefined, {
    headers: {
        "Authorization": "Bearer my-token",
        "Accept": "application/json",
    },
});
await app.events.openLink.sendAsync(event);
```
