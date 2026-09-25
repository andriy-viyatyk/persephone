# Content Delivery Pipeline

## Overview

The content delivery pipeline (`/src/renderer/content/`) is a unified I/O layer that decouples editors from data sources. Instead of editors reading files directly, all content flows through composable pipes that combine a data source (provider) with data effects (transformers). This makes it possible to open a file inside a ZIP archive, decrypt it on the fly, and save it back -- all transparent to the editor.

The pipeline replaces scattered file I/O calls across the codebase. It handles encoding detection, file watching, caching, and serialization for session restore.

## Registry layout

The content registry is split by the kind of extension point it owns:

- `registry.ts` maps persisted provider and transformer type names to factories and
  reconstructs `IContentPipe` instances from `IPipeDescriptor`. It contains the built-in
  provider/transformer registrations and is also the target of the script-facing
  `io.registerProvider()` API.
- `scheme-registry.ts` maps URL schemes to paired parse and resolve hooks. It normalizes scheme
  names, dispatches both the normal open pipeline and the `source-path` reconstruction path, and
  supplies hooks with `delegate()` and descriptor-based pipe creation. Platform and script
  registrations have separate duplicate/replacement rules; trusted and bundled-board registrations use the
  same hook contract and an existing live pipe is never changed by a later registration.
- `builtin-schemes.ts` owns the platform scheme hooks and their scheme-specific parsing and
  resolution behavior. It registers HTTP(S), data URLs, folder/editor links, Mneme links, board,
  guide, toolset, tree-category, and Git-tree schemes. `parsers.ts` and `resolvers.ts` remain the
  event-channel adapters: they dispatch registered schemes and retain the plain-file and archive
  `!` fallbacks.

The `pages.openUrl` validation boundary asks `scheme-registry.ts` whether a scheme is registered,
so adding a platform or script scheme does not require a second hand-maintained allow-list. Plain
filesystem paths and archive `archive.zip!entry` paths are intentionally fallbacks rather than
scheme registrations; the archive adapter is registered after the file fallback so LIFO dispatch
evaluates archive paths ahead of plain files.

### Board provider and scheme registrations

A trusted or bundled board contributes providers through the manifest's `contentProviders` array. Each
declaration pairs a persisted provider `type` with one or more URL `schemes`; the type is registered
verbatim and the scheme registry resolves those schemes through the normal Layer 1/Layer 2 hooks.
Board provider types must contain `/`, because un-namespaced provider types are reserved for the
platform. The board author therefore owns the stable namespace (`acme/torrent`, for example); it is
not derived from the mutable board display name or install path.

Provider types and schemes have one owner. Platform registrations and the hard-reserved names
(`http`, `https`, `file`, `data`, `blob`, `mneme`, and every `persephone-*` scheme) cannot be
claimed by a board. Among board registrations, the first registration wins; a later collision is
rejected and retained as a Board Info registration issue with the existing owner. A trust refresh
rebuilds board-owned registrations, so untrusted, disabled, or removed boards no longer own their names.
`permissions: ["contentProviders"]` discloses the requested surface and participates in service
lifecycle metadata; the `contentProviders` array is the functional provider-registration axis.

The same registered-scheme lookup is used by `pages.openUrl` and by browser page-initiated
navigation. A registered custom scheme is therefore routed into `openRawLink` rather than being
left for Chromium's navigation machinery.

## 3-Layer Pipeline

Opening content flows through three event-driven layers. Each layer is registered as an `EventChannel` subscriber during bootstrap. Subscribers execute in LIFO order, so later registrations act as higher-priority interceptors.

```
  Caller creates ILinkData via createLinkData(href, options?)
         │
  ┌──────▼──────────────────────────────────────────────┐
  │  Layer 1 — Parsers + scheme registry                │
  │  openRawLink → openLink                             │
  │  Dispatch schemes; retain file/archive fallbacks   │
  └──────┬──────────────────────────────────────────────┘
         │  ILinkData { href, url, target?, ...fields }
  ┌──────▼──────────────────────────────────────────────┐
  │  Layer 2 — Resolvers (resolvers.ts)                 │
  │  openLink → openContent                             │
  │  Build pipe, enrich ILinkData (set pipe, pipeDesc.) │
  └──────┬──────────────────────────────────────────────┘
         │  ILinkData { url, pipe, pipeDescriptor, target, ... }
  ┌──────▼──────────────────────────────────────────────┐
  │  Layer 3 — Open Handler (open-handler.ts)           │
  │  openContent → page creation                        │
  │  Pass pipe to PagesModel.lifecycle.openFile()       │
  └─────────────────────────────────────────────────────┘
```

### Layer 1 — Parsers and registered schemes

`registerRawLinkParsers()` in `parsers.ts` installs the event-channel adapters. The generic
registered-scheme adapter delegates to the hooks in `scheme-registry.ts`; the platform hook
implementations are in `builtin-schemes.ts`. Each hook receives the same `ILinkData` object,
enriches it, and delegates to `app.events.openLink`. Registration order is LIFO:

| Adapter | Detects | Owner |
|--------|---------|---------------|
| cURL/fetch auxiliary parser | `curl ` or `fetch(` prefix | `parsers.ts` |
| Registered scheme dispatcher | Platform schemes such as `https://`, `data:`, `mneme://`, `persephone-guide://`, `persephone-board://`, and `tree-category://`; script schemes use the same hook contract | `scheme-registry.ts` + `builtin-schemes.ts` |
| Archive fallback | `!` separator (via `isArchivePath`) | `parsers.ts` |
| File fallback | Everything else, including plain paths and `file://` URLs | `parsers.ts` |

The scripting/MCP `pages.openUrl` boundary applies the same pipeline-input validation before
dispatch. In addition to HTTP(S), `file://`, Windows/UNC paths, and `data:` URLs, it accepts the
any URL whose scheme is currently registered. Built-in schemes are loaded before validation;
script registrations are session-scoped and are therefore accepted by the same registry lookup.

**Fragment extraction.** A trailing `#fragment` on an incoming href is an in-document anchor, not part of the path, so the file, archive, `mneme://`, and `persephone-guide://` parsers split it off into the ephemeral `data.fragment` hint (URL-decoded, without the `#`) before resolving. This is done **only for real URLs** (`file://`, `mneme://`, `persephone-guide://`), never for a bare filesystem path: in a URL a literal `#` must be percent-encoded as `%23`, which makes the split unambiguous, whereas `#` is a legal character in Windows file and folder names (`C:\notes\C#\readme.md`). The HTTP parser leaves fragments in the URL, where the browser handles them.

### Layer 2 — Resolvers

Registered in `resolvers.ts` via `registerResolvers()`. Each resolver uses `resolveUrlToPipeDescriptor()` (from `link-utils.ts`) to create a pipe descriptor, then `createPipeFromDescriptor()` (from `registry.ts`) to instantiate the pipe. Enriches the `ILinkData` object (sets `data.pipe`, `data.pipeDescriptor`, `data.target`) and forwards the same object on `app.events.openContent`.

- **File resolver** (fallback) -- resolves file paths and archive paths (with "!") to pipe descriptors. Resolves target editor via `editorRegistry.resolveId()`. Two short-circuits run before pipe resolution: (1) explicit **browser intent** (`data.target === "browser"` or a `browserMode` is set) normalizes the path to a `file://` URL via `toFileUrl()` and opens it in a browser through the shared `openLinkInBrowser()` helper, bypassing Layer 3; (2) a plain (non-virtual, non-archive) path is `stat`-ed via `app.fs.stat()` and, if it is a **directory**, opens an empty page (no main editor) with the Explorer panel rooted at the folder via `pagesModel.addEmptyPageWithNavPanel()`, assigns that page's id to the ephemeral `data.openedPageId` output, and marks `data.handled`. Directories never produce a content pipe. `openedPageId` is an output for callers such as `PagesModel.openFile()`; it is not an input and is stripped before any link data can be persisted.
- **HTTP resolver** -- resolves HTTP/HTTPS URLs to pipe descriptors. A content-extension set decides whether a URL is content or should open in the browser; once it is content, the normal editor registry resolves the built-in editor and the merged resolver may select an eligible board. URLs without recognized extensions (or explicit browser intent) open in the browser via `openLinkInBrowser()`, short-circuiting Layer 3 the same way. cURL/fetch requests with `Accept` headers use header-based editor resolution.

  The set is intentionally separate from editor matching. `.pdf` remains in it with a browser-fallback override: a qualifying board wins, and without one the browser tab renders it natively. Registered built-in editors and eligible boards otherwise follow the same resolution path as local files.
- **Guide resolver** -- resolves `persephone-guide://<corpus-path>[#fragment]` to a read-only `GuideProvider` pipe targeting the Markdown editor. The corpus path is relative to the application-shipped guide index and omits the `.md` suffix; the fragment is carried as the ephemeral navigation hint. The provider's fragment-free `sourceUrl` is the stable scheme identity used in persisted source links.
- **Image-edit resolver** -- when `data.target === "image.edit"` and `data.url` is a `data:image/*` URL, imports the image as a **new untitled drawing** via `pagesModel.addDrawPage()` (which embeds it in a fresh scene) and marks `data.handled`, short-circuiting Layer 3. Registered last so it runs first (LIFO), intercepting before the file resolver would build a pipe. Import-only: the drawing is a new page, never bound to (so never overwriting) the image source. Accepts only data URLs -- a caller with an http/file image converts it to a data URL first.

`openLinkInBrowser()` is the single browser-routing path shared by both resolvers, so `target: "browser"` / `browserMode` works identically for local files and remote URLs. It honors `browserPageId` (route to a specific browser page), `browserMode` (`os-default` → `shell.openExternal`; `internal` / `profile:<name>` / `incognito` → `pagesModel.lifecycle.openUrlInBrowserTab()`), and otherwise the `link-open-behavior` setting.

The `resolveUrlToPipeDescriptor()` utility is also used by tree providers to create pipes from URLs without going through the event channel system.

### Layer 3 — Open Handler

Registered in `open-handler.ts` via `registerOpenHandler()`. Reconstructs the full file path from the pipe (combining provider `sourceUrl` + ArchiveTransformer `entryPath` for archive files). Cleans the `ILinkData` via `cleanForStorage()` (removes pipeline-only and one-shot navigation fields) and stores the resulting `StoredLinkData` as `IEditorState.sourceLink`. Then either:
- Opens a new page via `pagesModel.lifecycle.openFile(filePath, pipe, { sourceLink })` -- the page owns the pipe.
- Navigates an existing page via `pagesModel.lifecycle.navigatePageTo()` (when `data.pageId` is set) -- disposes the pipe since navigation creates its own.

Both paths forward the ephemeral **navigation hints** to the editor: `revealLine`/`highlightText` scroll/highlight a text editor, `diffFrom`/`diffTo` (each an `ILinkDiffRevision` — `unstaged` / `staged` / `head` / `commit`, where a `commit` with an empty hash denotes the empty tree) preselect the two sides of a File Diff comparison, and `fragment` scrolls to an in-document anchor.

Most hints are consumed only on a **fresh editor build**, never on a reuse/activate path, so they cannot perturb an already-open page. `fragment` is the deliberate exception: an anchor link into a document that happens to be open already is still a jump request, so it is applied on every exit of both open paths — including the editor-reuse early returns and `openFile`'s existing-page dedupe — through the optional `EditorModel.revealFragment?(fragment)` hook (same opt-in shape as `onNavigationReuse?()`; editors without in-document anchors simply don't implement it). A fragment also does **not** join `revealLine`/`highlightText` in forcing the Monaco text editor: those hints address lines and therefore need Monaco, whereas an anchor must keep the language preview editor (e.g. the Markdown view) that renders the headings it points at.

The `sourceLink` (`StoredLinkData`, the persistence-safe subset of `ILinkData`) is stored in `IEditorState.sourceLink` and persisted across app restarts. It records the page's origin (URL, target editor, title, ILink metadata, HTTP fields, etc.) but is informational only — it does not affect page content or I/O.

## Content Pipe

The content pipe implementation uses lazy original reads for write transforms and a paired source/cache owner for text pages.

`IContentPipe` is the central abstraction. It composes one `IProvider` with zero or more `ITransformer` instances.

### Read flow

```
provider.readBinary() → transformer[0].read() → transformer[1].read() → ... → result
```

`readText()` adds encoding detection after the binary chain: `readBinary() → decodeBuffer()`.

### Write flow

```
result → ... → transformer[1].write(data, readOriginal) → transformer[0].write(data, readOriginal) → provider.writeBinary()
```

Transformers are walked in reverse order. Each receives the new data and a lazy `readOriginal()` callback for the original data at that stage. `ArchiveTransformer` invokes it to rebuild the archive around the modified entry; transforms that do not need the original avoid reading the provider. The callback memoizes each stage and returns an empty buffer when the provider has no existing content.

`writeText()` encodes the string first: `encodeString() → writeBinary()`.

### Conditional capabilities

- `writable` -- true only if the provider is writable AND all transformers implement `write`.
- `watch` -- delegates to `provider.watch()` if supported. Returns a `() => void` disposer.

### Missing and pending providers

`createProviderFromDescriptor()` preserves a valid descriptor even when its provider type is not
currently registered. It returns a read-only, restorable `MissingProvider` whose `toDescriptor()`
returns the original descriptor unchanged; the first read rejects with a typed error naming the
provider and, when available, its declaring board. A malformed descriptor (not an object or
without a string `type`) still throws immediately.

When the descriptor belongs to a trusted or bundled board whose provider has not become available yet, the
same placeholder enters its pending state on the first read. It acquires the board's module-service
renderer lease, waits for the service registration, then delegates the read to `ProxyProvider`.
Service startup is lazy and bounded; a service that never attaches the lease produces a typed
provider-unavailable error instead of leaving the page pending forever. The placeholder watches
provider availability so a persisted page can recover while retaining its page identity, source
link, and original pipe descriptor.

## Built-in Providers

| Provider | Type | Writable | Watch | Description |
|----------|------|----------|-------|-------------|
| `FileProvider` | `file` | Yes | Yes | Local file read/write via `fs`. Debounced watch (300ms). |
| `HttpProvider` | `http` | No | No | HTTP/HTTPS fetch via `nodeFetch`; adds the content-pipe default User-Agent only when the caller supplied none. Supports method, headers, body. Re-fetches on each read (no internal caching). |
| `CacheFileProvider` | `cache` | Yes | No | Cache directory file (`{userData}/cache/{pageId}.txt`). Used as provider for cache pipes. |
| `GuideProvider` | `guide` | No | No | Read-only access to application-shipped Markdown guides through `persephone-guide://`; strips front matter and returns UTF-8 body bytes. |
| `ProxyProvider` | board-declared type | Depends on service | Service-defined | Renderer-side delegate to a trusted board's module service over the optional renderer `MessagePort` lease. Whole-resource reads and writes are bounded by the buffered payload limit. |

All providers implement `toDescriptor()` for serialization and `sourceUrl` for display/identity. `HttpProvider` builds request headers at call time so its default `CONTENT_USER_AGENT` is not written into the descriptor; an explicitly supplied User-Agent, including one with different casing, wins. `nodeFetch` remains header-neutral because REST requests must send exactly the headers the user supplied. `GuideProvider` is the intentional encoding exception: its packaged corpus has a known UTF-8 encoding, so it decodes the source to remove front matter before returning body bytes.

## Board stream-host delivery

`editorKind: "stream-host"` is the no-materialization custom-editor variant. Persephone owns the
page's `IContentPipe` but does not create the text-host or cache-file path used by `content-host`,
and it does not call `ensureContentPath()` for the board. `persephone.host.streamUrl()` is available
to both content-host and stream-host pages and returns an origin-local
`board://<host>/__pipe/<pageId>` URL.

The range path deliberately stays renderer-mediated because the renderer owns the composed pipe:

```
board fetch(Range)
  → board:// protocol handler in main
  → BoardPipeService → board-pipe:read IPC
  → board-pipe-handler in the owning renderer
  → page's IContentPipe
  → byte reply back through main
```

The handler parses one inclusive byte range, returns `206` with `Content-Range` and
`Accept-Ranges: bytes`, and returns `416` with `bytes */<total>` for an unsatisfiable range. A
transformer-free provider with `createReadStream()` is read directly for bounded chunks; transformed
pipes and providers without a stream are read through a bounded in-memory buffer. Each IPC chunk is
limited to 1 MiB and fallback buffering is limited to 256 MiB. This path can serve a local file,
HTTP source, transformed pipe, or service-backed provider, but a `ProxyProvider` remains a
whole-resource provider, so a range is buffered before it is sent to the board.

## Built-in Transformers

| Transformer | Type | Persistent | Description |
|-------------|------|------------|-------------|
| `ZipTransformer` | `zip` | Yes | Extract/replace a single entry in a ZIP archive via jszip (dynamic import). Write rebuilds the archive with the modified entry. |
| `DecryptTransformer` | `decrypt` | No | AES-GCM encrypt/decrypt via `shell.encryption`. Non-persistent -- password must never be serialized to disk. |

The `persistent` flag controls whether the transformer appears in `toDescriptor()` output. Non-persistent transformers are excluded from serialization but still participate in `clone()` (in-memory only).

## Dual-Pipe Model

`TextFileIOModel` maintains two pipes for each text page:

```
Primary pipe:  FileProvider("report.json") → [ZipTransformer, DecryptTransformer]
               ↕ read/write source file

Cache pipe:    CacheFileProvider(pageId) → [ZipTransformer, DecryptTransformer]
               ↕ auto-save unsaved changes
```

The `PipePair` owner creates the cache via `primaryPipe.cloneWithProvider(new CacheFileProvider(id))`. This ensures the cache pipe shares the same transformer chain -- encrypted files stay encrypted in cache, archive entries stay in ZIP format. It replaces the primary and cache atomically and owns disposal of both.

When the primary pipe changes (e.g., after decryption adds a `DecryptTransformer`), `PipePair.setPrimary()` rebuilds the cache pipe before releasing the old pair. `TextFileIOModel` owns watcher setup around that operation.

## Encoding Detection

`decodeBuffer()` in `encoding.ts` detects text encoding with this priority:

1. **BOM detection** (O(1)) -- UTF-8-BOM (`EF BB BF`), UTF-16LE (`FF FE`), UTF-16BE (`FE FF`)
2. **Large file skip** -- files >20MB default to UTF-8 (skip detection)
3. **Explicit override** -- if encoding was previously detected and passed in
4. **jschardet** -- statistical detection with >70% confidence threshold
5. **UTF-8 probe** -- decode as UTF-8 and check for replacement characters (`U+FFFD`)
6. **Fallback** -- Windows-1251

The detected encoding is stored on the pipe (`pipe.encoding`) and persisted in `IPipeDescriptor` so that write-back uses the same encoding. `encodeString()` handles the reverse, including BOM insertion for UTF-8-BOM and UTF-16 variants.

## Clone-and-Try Pattern

Pipes are immutable-by-convention. When a transformation needs to be tested before committing (e.g., decryption with a user-provided password), use the clone-and-try pattern:

1. `clone()` the active pipe (deep copies provider and all transformers via descriptors)
2. `addTransformer()` or `removeTransformer()` on the clone
3. Attempt `readText()` on the clone
4. **Success** -- pass the clone to `TextFileIOModel.setPrimary()`; `PipePair` swaps the pair and disposes the old pipes
5. **Failure** -- dispose the clone, keep the original pipe unchanged

Example from `TextFileEncryptionModel.decript()`:

```typescript
const candidate = pipe.clone();
candidate.addTransformer(new DecryptTransformer(password));
try {
    const plaintext = await candidate.readText();
    this.model.io.setPrimary(candidate); // swap source and matching cache
} catch {
    candidate.dispose();               // discard on failure
}
```

The same pattern is used for locking (removing `DecryptTransformer`) and removing encryption entirely.

## Pipe Serialization

Pipes serialize to `IPipeDescriptor` for session persistence (stored in `IEditorState.pipe`):

```typescript
interface IPipeDescriptor {
    provider: IProviderDescriptor;       // { type, config }
    transformers: ITransformerDescriptor[]; // [{ type, config }, ...]
    encoding?: string;                   // detected encoding
}
```

Key rules:
- Only transformers with `persistent === true` are included. `DecryptTransformer` (password) is excluded.
- `createPipeFromDescriptor()` in `registry.ts` reconstructs a pipe from its descriptor using registered factories.
- Provider and transformer types are registered at module load time in `registry.ts` (e.g., `registerProvider("file", ...)`, `registerTransformer("archive", ...)`). Script-owned provider registrations can replace earlier script-owned entries; platform-owned entries remain first-wins and report a duplicate.

## Key Files

| File | Purpose |
|------|---------|
| `/src/renderer/content/ContentPipe.ts` | `ContentPipe` class -- pipe implementation |
| `/src/renderer/content/PipePair.ts` | Paired TextFile source/cache pipe lifetime owner |
| `/src/renderer/content/registry.ts` | Provider/transformer factory registry, `createPipeFromDescriptor()` |
| `/src/renderer/content/scheme-registry.ts` | Parse/resolve registry for platform and script URL schemes, including source-path reconstruction |
| `/src/renderer/content/builtin-schemes.ts` | Built-in URL-scheme hooks and browser/content resolution |
| `/src/renderer/content/parsers.ts` | Layer 1 -- scheme dispatch plus plain-file/archive and cURL/fetch adapters |
| `/src/renderer/content/resolvers.ts` | Layer 2 -- fallback resolver and registered-scheme dispatch |
| `/src/renderer/content/link-utils.ts` | URL → pipe descriptor resolution (reusable by tree providers) |
| `/src/renderer/content/open-handler.ts` | Layer 3 -- page creation from pipe |
| `/src/renderer/content/encoding.ts` | Encoding detection (`decodeBuffer`) and encoding (`encodeString`) |
| `/src/renderer/content/providers/FileProvider.ts` | Local file provider |
| `/src/renderer/content/providers/HttpProvider.ts` | HTTP/HTTPS provider |
| `/src/renderer/content/providers/CacheFileProvider.ts` | Cache file provider |
| `/src/renderer/content/providers/GuideProvider.ts` | Read-only application guide provider |
| `/src/renderer/guides/guide-source.ts` | Renderer `GuideSource` over the packaged guide corpus |
| `/src/renderer/guides/index.ts` | Shared renderer guide index and page/tree accessors |
| `/src/renderer/content/transformers/ZipTransformer.ts` | ZIP archive entry transformer |
| `/src/renderer/content/transformers/DecryptTransformer.ts` | AES-GCM encryption transformer |
| `/src/renderer/api/types/io.pipe.d.ts` | `IContentPipe`, `IPipeDescriptor` type definitions |
| `/src/renderer/api/types/io.provider.d.ts` | `IProvider`, `IProviderDescriptor` type definitions |
| `/src/renderer/api/types/io.transformer.d.ts` | `ITransformer`, `ITransformerDescriptor` type definitions |
| `/src/renderer/editors/text/TextFileIOModel.ts` | Dual-pipe model (primary + cache) |
| `/src/renderer/editors/text/TextFileEncryptionModel.ts` | Clone-and-try encryption operations |
| `/src/renderer/scripting/api-wrapper/IoNamespace.ts` | Script `io` namespace exposing pipe APIs |

## Related Documentation

- [Architecture Overview](./overview.md) -- Section 5 covers the pipeline at a high level
- [Editors](./editors.md) -- Editor system that consumes pipes
- [Scripting](./scripting.md) -- Script `io` namespace for pipe access
- [Pages Architecture](./pages-architecture.md) -- Page lifecycle and pipe ownership
