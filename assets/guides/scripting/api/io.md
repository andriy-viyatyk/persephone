---
title: "io"
audience: "user"
summary: "How do scripts register content providers and URL schemes?"
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
| `readBinary(options?: { signal?: AbortSignal }): Promise<Buffer>` | Yes | Reads the provider bytes. The optional signal is aborted when Persephone stops waiting for the read. |
| `toDescriptor(): IProviderDescriptor` | Yes | Serializes the provider configuration. |
| `createReadStream(range?: { start: number; end: number }, options?: { signal?: AbortSignal })` | No | Optional ranged stream for large binary content. The range end is inclusive; the signal is optional. |
| `writeBinary(data: Buffer)` | No | Optional write operation for writable providers. |
| `stat(options?: { signal?: AbortSignal }): Promise<IProviderStat>` | No | Optional size, modification-time, and existence metadata. |
| `watch(callback: (event: string) => void): () => void` | No | Optional external-change notifications. |
| `status?: IPipeStageStatus` | No | Current transient status, if the provider reports one. |
| `onStatusChange?(callback: () => void): () => void` | No | Optional transient-status subscription; call the returned function to unsubscribe. |
| `dispose(): void` | No | Optional resource cleanup. |

When a script-registered factory is first used, Persephone checks that the returned provider has
the required members. If it is malformed, one error names the provider type and all missing
members, for example `Provider "demo-mem" is missing required member(s): toDescriptor().` The
check is cached for that registration, while optional members remain optional. Platform providers
are not subject to this script registration check.

When Persephone supplies `options.signal`, the provider must tolerate the extra argument. The
signal is aborted when Persephone stops waiting for the operation, such as when a page is closed or
a request is cancelled. A provider can listen for it to stop its own work early; honoring the signal
is optional. The same signal is forwarded through an `IContentPipe` to the provider and transformers
where supported.

Registering a type already registered by your scripts replaces that factory and reports an `info`
notification. Built-in provider types cannot be replaced; trying to register one reports an error.
Replacement affects content opened afterward, while an already-open pipe keeps its existing
provider.

### `io.registerScheme(scheme, hooks)`

The hooks object must provide `parse` and `resolve` functions. They receive the `ILinkData` object
used by the link-opening events, plus a context containing `phase`, `delegate()`, `handoff()`, and
`createPipe(descriptor)`. Scheme names are trimmed and matched case-insensitively; a trailing `:`
is optional. URL scheme prefixes are also matched case-insensitively when opened. Before hooks run,
the pipeline lowercases only a multi-character scheme prefix and preserves the rest of the URL.

The parse hook should set `data.url` and call `context.handoff()`. The resolve hook should set
`data.target`, provide a persistable `data.pipeDescriptor`, and create `data.pipe` with
`context.createPipe()`. In the `open` phase, call `context.handoff()` after preparing the data. In
the `source-path` phase, `handoff()` only calls the supplied delegate and leaves handled state
unchanged, so resolve hooks can build the pipe and call it in either phase. `context.delegate()`
remains available for custom handled-state logic. Hooks classify and prepare link data; the
platform's Layer 3 action dispatcher owns non-content effects such as browser routing, notices,
folder pages, and capabilities. The public `phase`, `delegate()`, and `handoff()` contract is
unchanged.

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
        async readBinary(options) {
            if (options?.signal?.aborted) throw new Error("Read cancelled");
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
        await context.handoff();
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

        await context.handoff();
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

## IContentPipe

The detailed contract moved to [io-pipes-and-helpers](io-pipes-and-helpers.md#icontentpipe).

---


## Read next

| What you need | Page (object-model path) |
|---|---|
| Content pipes, link helpers and examples | [io-pipes-and-helpers](io-pipes-and-helpers.md) - `guides.scripting.api["io-pipes-and-helpers"]` |
